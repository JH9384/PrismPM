//! `prism-factory`: the command-line host of the Prism factory.
//!
//! The host reads a Git tree and a receipt store, asks the certified `plan`
//! root what to do, runs the obligations the plan routes to `observe` in this
//! environment, and records what happened. It never decides a route, an
//! identity, an order or releasability itself.

use std::collections::BTreeMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitCode, Stdio};

mod actions;
mod forge;

const USAGE: &str = "usage: prism-factory <command> [options]

commands:
  request           print the plan request for a revision (tree, contexts, receipts, weights)
  plan              print the certified plan for a revision
  run               run every obligation the plan routes to `observe` on this host
  workflow          print a generated GitHub workflow (`--name factory|release|cut|delegate`), or --check/--write it
  delegate          print the forge's delegation plan: VERIFIED is a file of `signed`, `trust-*` and `event` lines
  delegate-prepare  VERIFIED NAME: write NAME's closure to --work/NAME for the PrismPM Action's `factory` command
  plan-request      print the certified plan for a request on stdin (as `request` prints it)
  reweigh           print the next weights for `weight` and `outcome` lines on stdin
  actions-route     write the routes of a release run to $GITHUB_OUTPUT (the Actions adapter)
  actions-receipts  record receipts for what a release run established ($FACTORY_PLAN, $FACTORY_RESULTS)
  route-record      write the published route record: OUT REV ROUTE SOURCE_REV RUN_ID RUN_ATTEMPT
                    BUILD_ROUTE BUILD_REV BUILD_RUN_ID BUILD_RUN_ATTEMPT

options:
  --rev REV          the revision to plan (default HEAD)
  --context KEY=VAL  a context input (`@KEY`) only the obligations that declare it read (repeatable)
  --name NAME        workflow: `factory` (default), `release`, `cut` or `delegate`
  --jobs DIR         workflow: the job fragments of `release` (default prism-factory/jobs)
  --receipts DIR     the receipt store (default target/factory/receipts)
  --only NAME        run only these obligations (repeatable)
  --rounds N         at most N plan/run rounds (default 32)
  --work DIR         scratch for closures, outside any repository (default $TMPDIR/prism-factory)
  --check FILE       workflow: fail if FILE differs from the projection
  --write FILE       workflow: write the projection to FILE";

pub(crate) struct Options {
    revision: String,
    contexts: BTreeMap<String, String>,
    name: String,
    jobs: PathBuf,
    arguments: Vec<String>,
    receipts: PathBuf,
    only: Vec<String>,
    rounds: usize,
    work: PathBuf,
    check: Option<PathBuf>,
    write: Option<PathBuf>,
}

fn options(arguments: &[String]) -> Result<Options, String> {
    let mut parsed = Options {
        revision: "HEAD".into(),
        contexts: BTreeMap::new(),
        name: "factory".into(),
        jobs: PathBuf::from("prism-factory/jobs"),
        arguments: Vec::new(),
        receipts: PathBuf::from("target/factory/receipts"),
        only: Vec::new(),
        rounds: 32,
        work: std::env::temp_dir().join("prism-factory"),
        check: None,
        write: None,
    };
    let mut items = arguments.iter();
    while let Some(flag) = items.next() {
        let mut value = || items.next().cloned().ok_or(format!("{flag} needs a value"));
        match flag.as_str() {
            "--rev" => parsed.revision = value()?,
            "--context" => {
                let pair = value()?;
                let (key, val) = pair.split_once('=').ok_or("--context needs KEY=VALUE")?;
                let plain = |text: &str| !text.is_empty() && text.bytes().all(|byte| byte.is_ascii_graphic());
                if !plain(key) || !plain(val) || key.contains('/') {
                    return Err(format!("--context {pair}: key and value must be non-empty printable words"));
                }
                parsed.contexts.insert(key.into(), val.into());
            }
            "--name" => parsed.name = value()?,
            "--jobs" => parsed.jobs = PathBuf::from(value()?),
            "--receipts" => parsed.receipts = PathBuf::from(value()?),
            "--only" => parsed.only.push(value()?),
            "--rounds" => parsed.rounds = value()?.parse().map_err(|_| "--rounds needs a number")?,
            "--work" => parsed.work = PathBuf::from(value()?),
            "--check" => parsed.check = Some(PathBuf::from(value()?)),
            "--write" => parsed.write = Some(PathBuf::from(value()?)),
            other if !other.starts_with("--") => parsed.arguments.push(other.into()),
            other => return Err(format!("unknown option {other}")),
        }
    }
    Ok(parsed)
}

pub(crate) fn git(arguments: &[&str]) -> Result<Vec<u8>, String> {
    let out = Command::new("git")
        .args(arguments)
        .stderr(Stdio::inherit())
        .output()
        .map_err(|error| format!("git: {error}"))?;
    if !out.status.success() {
        return Err(format!("git {} failed", arguments.join(" ")));
    }
    Ok(out.stdout)
}

/// One tracked entry: its path, and `mode:object` as its content address.
pub(crate) struct Entry {
    pub(crate) path: String,
    pub(crate) object: String,
}

pub(crate) fn tree(revision: &str) -> Result<Vec<Entry>, String> {
    let listing = git(&["ls-tree", "-r", "-z", "--full-tree", revision])?;
    let mut entries = Vec::new();
    for row in listing.split(|byte| *byte == 0).filter(|row| !row.is_empty()) {
        let row = std::str::from_utf8(row).map_err(|_| "a tracked path is not UTF-8")?;
        let (meta, path) = row.split_once('\t').ok_or("unexpected ls-tree row")?;
        let fields: Vec<&str> = meta.split(' ').collect();
        if fields.len() != 3 || path.contains('\n') {
            return Err(format!("unsupported tree entry {path:?}"));
        }
        entries.push(Entry { path: path.to_string(), object: format!("{}:{}", fields[0], fields[2]) });
    }
    Ok(entries)
}

fn receipt_lines(store: &Path) -> Result<String, String> {
    let mut out = String::new();
    if let Ok(listing) = fs::read_dir(store) {
        let mut names: Vec<PathBuf> = listing.filter_map(|item| item.ok().map(|item| item.path())).collect();
        names.sort();
        for path in names.iter().filter(|path| path.extension().is_some_and(|ext| ext == "receipt")) {
            let text = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
            // A receipt whose retained evidence has expired proves nothing.
            if actions::expired(&text) {
                continue;
            }
            if let Some(first) = text.lines().next().filter(|line| line.starts_with("receipt ")) {
                out.push_str(first);
                out.push('\n');
            }
        }
        if let Ok(weights) = fs::read_to_string(store.join("weights")) {
            for line in weights.lines().filter(|line| line.starts_with("weight ")) {
                out.push_str(line);
                out.push('\n');
            }
        }
    }
    Ok(out)
}

pub(crate) fn request(options: &Options) -> Result<(String, Vec<Entry>), String> {
    let entries = tree(&options.revision)?;
    let mut text = String::new();
    for entry in &entries {
        text.push_str(&format!("tree {} {}\n", entry.object, entry.path));
    }
    // A context is not a file: it enters only the obligations that declare
    // `@key` (the model never lets a plain prefix, even "", reach it).
    for (key, value) in &options.contexts {
        text.push_str(&format!("tree context:{value} @{key}\n"));
    }
    text.push_str(&receipt_lines(&options.receipts)?);
    Ok((text, entries))
}

pub(crate) fn plan_text(request: &str) -> Result<String, String> {
    let out = prism_factory_host::plan(request.as_bytes()).map_err(|_| "the plan root overflowed")?;
    String::from_utf8(out).map_err(|_| "the plan is not UTF-8".into())
}

/// The plan, read back into what the host needs to act on it.
#[derive(Default)]
pub(crate) struct Plan {
    pub(crate) routes: BTreeMap<String, (String, String)>,
    pub(crate) order: Vec<String>,
    environment: BTreeMap<String, String>,
    run: BTreeMap<String, String>,
    files: BTreeMap<String, Vec<String>>,
    schedule: Vec<String>,
    releasable: bool,
}

pub(crate) fn read_plan(text: &str) -> Plan {
    let mut plan = Plan::default();
    for line in text.lines() {
        let mut parts = line.splitn(3, ' ');
        let (tag, owner, rest) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        match tag {
            "obligation" => {
                let (route, kappa) = rest.split_once(' ').unwrap_or((rest, ""));
                plan.routes.insert(owner.into(), (route.into(), kappa.into()));
                plan.order.push(owner.into());
            }
            "environment" => {
                plan.environment.insert(owner.into(), rest.into());
            }
            "run" => {
                plan.run.insert(owner.into(), rest.into());
            }
            "file" => plan.files.entry(owner.into()).or_default().push(rest.into()),
            "schedule" => plan.schedule.push(owner.into()),
            "releasable" => plan.releasable = owner == "yes",
            _ => {}
        }
    }
    plan
}

/// Writes exactly the obligation's closure into a fresh directory.
pub(crate) fn materialize(entries: &[Entry], files: &[String], destination: &Path) -> Result<(), String> {
    if destination.exists() {
        fs::remove_dir_all(destination).map_err(|error| format!("{}: {error}", destination.display()))?;
    }
    fs::create_dir_all(destination).map_err(|error| format!("{}: {error}", destination.display()))?;
    let by_path: BTreeMap<&str, &str> = entries.iter().map(|entry| (entry.path.as_str(), entry.object.as_str())).collect();
    let mut batch = Command::new("git")
        .args(["cat-file", "--batch"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .map_err(|error| format!("git cat-file: {error}"))?;
    let mut input = batch.stdin.take().ok_or("git cat-file stdin")?;
    let mut output = BufReader::new(batch.stdout.take().ok_or("git cat-file stdout")?);
    for path in files {
        let object = by_path.get(path.as_str()).ok_or(format!("{path} is not in the tree"))?;
        let (mode, oid) = object.split_once(':').ok_or("bad object")?;
        if mode == "160000" {
            continue;
        }
        writeln!(input, "{oid}").map_err(|error| error.to_string())?;
        input.flush().map_err(|error| error.to_string())?;
        let mut header = String::new();
        output.read_line(&mut header).map_err(|error| error.to_string())?;
        let size: usize = header.trim_end().rsplit(' ').next().and_then(|size| size.parse().ok()).ok_or(format!("git cat-file: {header}"))?;
        let mut content = vec![0; size + 1];
        output.read_exact(&mut content).map_err(|error| error.to_string())?;
        content.pop();
        let target = destination.join(path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|error| error.to_string())?;
        }
        if mode == "120000" {
            #[cfg(unix)]
            std::os::unix::fs::symlink(String::from_utf8_lossy(&content).as_ref(), &target).map_err(|error| error.to_string())?;
        } else {
            fs::write(&target, &content).map_err(|error| error.to_string())?;
            #[cfg(unix)]
            if mode == "100755" {
                use std::os::unix::fs::PermissionsExt;
                fs::set_permissions(&target, fs::Permissions::from_mode(0o755)).map_err(|error| error.to_string())?;
            }
        }
    }
    drop(input);
    batch.wait().map_err(|error| error.to_string())?;
    Ok(())
}

fn record(store: &Path, name: &str, kappa: &str, passed: bool, revision: &str) -> Result<(), String> {
    fs::create_dir_all(store).map_err(|error| format!("{}: {error}", store.display()))?;
    let verdict = if passed { "pass" } else { "fail" };
    let body = format!("receipt {kappa} {verdict}\nobligation {name}\nrevision {revision}\nenvironment host\nnetwork host\n");
    fs::write(store.join(format!("{kappa}-{verdict}.receipt")), body).map_err(|error| error.to_string())
}

pub(crate) fn reweigh(store: &Path, outcomes: &[(String, bool)]) -> Result<(), String> {
    let mut request = fs::read_to_string(store.join("weights")).unwrap_or_default();
    for (name, passed) in outcomes {
        request.push_str(&format!("outcome {name} {}\n", if *passed { "pass" } else { "fail" }));
    }
    let next = prism_factory_host::reweigh(request.as_bytes()).map_err(|_| "the reweigh root overflowed")?;
    fs::write(store.join("weights"), next).map_err(|error| error.to_string())
}

fn run(options: &Options) -> Result<bool, String> {
    let revision = String::from_utf8(git(&["rev-parse", "--verify", &format!("{}^{{commit}}", options.revision)])?)
        .map_err(|_| "revision")?
        .trim()
        .to_string();
    let mut attempted = std::collections::BTreeSet::new();
    let mut failed = false;
    for round in 0..options.rounds {
        let (text, entries) = request(&Options { revision: revision.clone(), ..clone(options) })?;
        let plan = read_plan(&plan_text(&text)?);
        let runnable: Vec<String> = plan
            .schedule
            .iter()
            .filter(|name| plan.environment.get(*name).map(String::as_str) == Some("host"))
            .filter(|name| options.only.is_empty() || options.only.contains(name))
            .filter(|name| !attempted.contains(*name))
            .cloned()
            .collect();
        if runnable.is_empty() {
            for (name, (route, _)) in &plan.routes {
                if route != "proved" {
                    let place = plan.environment.get(name).map(String::as_str).unwrap_or("");
                    eprintln!("factory: {name} is {route} (environment {place})");
                }
            }
            eprintln!("factory: releasable {}", if plan.releasable { "yes" } else { "no" });
            return Ok(!failed);
        }
        let mut outcomes = Vec::new();
        for name in runnable {
            attempted.insert(name.clone());
            let kappa = plan.routes[&name].1.clone();
            let work = options.work.join(&name);
            if git(&["-C", &options.work.to_string_lossy(), "rev-parse", "--show-toplevel"]).is_ok() {
                return Err(format!("{} is inside a Git repository; a closure must not see anything else", options.work.display()));
            }
            materialize(&entries, plan.files.get(&name).map(Vec::as_slice).unwrap_or(&[]), &work)?;
            eprintln!("factory: round {round}: running {name} ({kappa})");
            let status = Command::new("bash")
                .args(["-euo", "pipefail", "-c", &plan.run[&name]])
                .current_dir(&work)
                .env("FACTORY_OBLIGATION", &name)
                .env("FACTORY_KAPPA", &kappa)
                .env("FACTORY_REVISION", &revision)
                .status()
                .map_err(|error| format!("{name}: {error}"))?;
            let passed = status.success();
            failed |= !passed;
            eprintln!("factory: {name} {}", if passed { "passed" } else { "failed" });
            record(&options.receipts, &name, &kappa, passed, &revision)?;
            outcomes.push((name, passed));
        }
        reweigh(&options.receipts, &outcomes)?;
    }
    Err(format!("no fixed point within {} rounds", options.rounds))
}

pub(crate) fn clone(options: &Options) -> Options {
    Options {
        revision: options.revision.clone(),
        contexts: options.contexts.clone(),
        name: options.name.clone(),
        jobs: options.jobs.clone(),
        arguments: options.arguments.clone(),
        receipts: options.receipts.clone(),
        only: options.only.clone(),
        rounds: options.rounds,
        work: options.work.clone(),
        check: options.check.clone(),
        write: options.write.clone(),
    }
}

fn main() -> ExitCode {
    let arguments: Vec<String> = std::env::args().skip(1).collect();
    let Some(command) = arguments.first() else {
        eprintln!("{USAGE}");
        return ExitCode::from(64);
    };
    let options = match options(&arguments[1..]) {
        Ok(options) => options,
        Err(error) => {
            eprintln!("prism-factory: {error}\n{USAGE}");
            return ExitCode::from(64);
        }
    };
    let result: Result<bool, String> = match command.as_str() {
        "request" => request(&options).map(|(text, _)| {
            print!("{text}");
            true
        }),
        "plan" => request(&options).and_then(|(text, _)| plan_text(&text)).map(|plan| {
            print!("{plan}");
            true
        }),
        "run" => run(&options),
        "delegate" => forge::plan(&options),
        "delegate-prepare" => forge::prepare(&options),
        "workflow" => actions::workflow(&options),
        "actions-route" => actions::route(&options),
        "plan-request" => {
            let mut text = String::new();
            std::io::stdin().read_to_string(&mut text).map_err(|error| error.to_string()).and_then(|_| plan_text(&text)).map(|plan| {
                print!("{plan}");
                true
            })
        }
        "reweigh" => {
            let mut request = Vec::new();
            std::io::stdin().read_to_end(&mut request).map_err(|error| error.to_string()).and_then(|_| {
                let next = prism_factory_host::reweigh(&request).map_err(|_| "the reweigh root overflowed".to_string())?;
                std::io::stdout().write_all(&next).map(|_| true).map_err(|error| error.to_string())
            })
        }
        "actions-receipts" => actions::receipts(&options),
        "route-record" => actions::route_record(&options),
        _ => Err(format!("unknown command {command}")),
    };
    match result {
        Ok(true) => ExitCode::SUCCESS,
        Ok(false) => ExitCode::from(1),
        Err(error) => {
            eprintln!("prism-factory: {error}");
            ExitCode::from(2)
        }
    }
}
