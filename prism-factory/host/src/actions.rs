//! The Actions adapter: GitHub Actions is one place the host runs. These
//! commands move the certified plan into a release run's job outputs, record
//! what the run established as receipts, and write the published route record.
//! Every identity and route still comes from the certified `plan` root.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::io::Write;
use std::path::Path;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use super::{clone, git, plan_text, read_plan, request, Options, Plan};

/// Evidence a release run uploads is retained for 30 days; a receipt for it
/// expires a day earlier, so a proved route never points at a deleted artifact.
const RETENTION_SECONDS: u64 = 29 * 24 * 60 * 60;

fn now() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|elapsed| elapsed.as_secs()).unwrap_or(0)
}

fn field<'a>(text: &'a str, tag: &str) -> Option<&'a str> {
    text.lines().find_map(|line| line.strip_prefix(tag).and_then(|rest| rest.strip_prefix(' ')))
}

/// A receipt whose evidence has expired is not a receipt.
pub(crate) fn expired(text: &str) -> bool {
    field(text, "expires").and_then(|value| value.parse::<u64>().ok()).is_some_and(|until| until < now())
}

/// Where a passing receipt's evidence lives: the run that established it.
#[derive(Clone)]
struct Provenance {
    run_id: String,
    run_attempt: String,
    revision: String,
}

fn provenance(store: &Path) -> BTreeMap<String, Provenance> {
    let mut found = BTreeMap::new();
    let Ok(listing) = fs::read_dir(store) else { return found };
    let mut paths: Vec<_> = listing.filter_map(|item| item.ok().map(|item| item.path())).collect();
    paths.sort();
    for path in paths.iter().filter(|path| path.extension().is_some_and(|ext| ext == "receipt")) {
        let Ok(text) = fs::read_to_string(path) else { continue };
        if expired(&text) {
            continue;
        }
        let Some(first) = text.lines().next() else { continue };
        let words: Vec<&str> = first.split(' ').collect();
        if words.len() != 3 || words[0] != "receipt" || words[2] != "pass" {
            continue;
        }
        let run: Vec<&str> = field(&text, "run").unwrap_or("").split(' ').collect();
        if let (Some(revision), [run_id, run_attempt]) = (field(&text, "revision"), run.as_slice()) {
            found.insert(
                words[1].to_string(),
                Provenance { run_id: run_id.to_string(), run_attempt: run_attempt.to_string(), revision: revision.to_string() },
            );
        }
    }
    found
}

fn environment(name: &str) -> Result<String, String> {
    std::env::var(name).map_err(|_| format!("${name} is not set"))
}

fn numeric(value: &str) -> bool {
    !value.is_empty() && value.len() <= 20 && value.bytes().all(|byte| byte.is_ascii_digit()) && !value.starts_with('0')
}

fn oid(value: &str) -> bool {
    value.len() == 40 && value.bytes().all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn commit(revision: &str) -> Result<String, String> {
    let out = git(&["rev-parse", "--verify", &format!("{revision}^{{commit}}")])?;
    Ok(String::from_utf8(out).map_err(|_| "revision")?.trim().to_string())
}

/// The plan, and the plan once every obligation that could run in this run is
/// assumed to pass: the certified core's own fixed point decides what runs.
fn routes(options: &Options) -> Result<(Plan, Plan), String> {
    let (base, _) = request(options)?;
    let first = read_plan(&plan_text(&base)?);
    let mut assumed: BTreeSet<String> = BTreeSet::new();
    let mut last = read_plan(&plan_text(&base)?);
    for _ in 0..64 {
        let fresh: Vec<String> = last
            .routes
            .values()
            .filter(|(route, kappa)| route == "observe" && !assumed.contains(kappa))
            .map(|(_, kappa)| kappa.clone())
            .collect();
        if fresh.is_empty() {
            return Ok((first, last));
        }
        assumed.extend(fresh);
        let mut text = base.clone();
        for kappa in &assumed {
            text.push_str(&format!("receipt {kappa} pass\n"));
        }
        last = read_plan(&plan_text(&text)?);
    }
    Err("the schedule reached no fixed point".into())
}

/// What a release run does with each obligation: `proved` by a receipt of an
/// earlier run, `established` here by the factory job itself (a host
/// obligation), or `establish`ed by this run's jobs.
fn statuses(options: &Options) -> Result<Vec<(String, String, String)>, String> {
    let (first, last) = routes(options)?;
    let known = provenance(&options.receipts);
    let mut out = Vec::new();
    let mut stuck = Vec::new();
    for name in &first.order {
        let (route, kappa) = &first.routes[name];
        let status = match route.as_str() {
            "proved" if known.contains_key(kappa) => "proved",
            "proved" => "established",
            _ => match last.routes.get(name).map(|(route, _)| route.as_str()) {
                Some("proved") => "establish",
                Some(other) => {
                    stuck.push(format!("{name} is {other}"));
                    other
                }
                None => return Err(format!("{name} is missing from the plan")),
            },
        };
        out.push((name.clone(), kappa.clone(), status.to_string()));
    }
    if !stuck.is_empty() {
        return Err(format!("this run cannot release: {}", stuck.join(", ")));
    }
    Ok(out)
}

fn release_options(options: &Options) -> Result<Options, String> {
    let mut options = clone(options);
    if let Ok(sha) = std::env::var("GITHUB_SHA") {
        options.revision = sha;
    }
    options.revision = commit(&options.revision)?;
    if let Ok(mode) = std::env::var("FACTORY_MODE") {
        options.contexts.insert("mode".into(), mode);
    }
    if let (Ok(id), Ok(attempt)) = (std::env::var("GITHUB_RUN_ID"), std::env::var("GITHUB_RUN_ATTEMPT")) {
        options.contexts.insert("run".into(), format!("{id}-{attempt}"));
    }
    for key in ["mode", "run"] {
        if !options.contexts.contains_key(key) {
            return Err(format!("a release run needs --context {key}=… (or $FACTORY_MODE and $GITHUB_RUN_ID)"));
        }
    }
    Ok(options)
}

pub(crate) fn route(options: &Options) -> Result<bool, String> {
    let options = release_options(options)?;
    let rows = statuses(&options)?;
    let known = provenance(&options.receipts);
    let mut output = String::new();
    let mut plan = String::new();
    for (name, kappa, status) in &rows {
        eprintln!("factory: {name} {status} {kappa}");
        plan.push_str(&format!("{name} {kappa} {status}\n"));
    }
    let find = |wanted: &str| rows.iter().find(|(name, _, _)| name == wanted).cloned().ok_or(format!("{wanted} is not in the plan"));
    // The legacy outputs every release job reads (factory/src/Factory/Release.lex.tex).
    for (prefix, name) in [("", "source-vv"), ("build-", "build")] {
        let (_, kappa, status) = find(name)?;
        let proved = status == "proved";
        let origin = known.get(&kappa).filter(|_| proved);
        output.push_str(&format!("{prefix}route={}\n", if proved { "proved" } else { "establish" }));
        output.push_str(&format!("{}={kappa}\n", if prefix.is_empty() { "kappa" } else { "build-identity" }));
        let revision = origin.map(|origin| origin.revision.clone()).unwrap_or_else(|| options.revision.clone());
        let label = if prefix.is_empty() { "source-" } else { "build-" };
        output.push_str(&format!("{label}revision={revision}\n"));
        output.push_str(&format!("{prefix}run-id={}\n", origin.map(|origin| origin.run_id.as_str()).unwrap_or("")));
        output.push_str(&format!("{prefix}run-attempt={}\n", origin.map(|origin| origin.run_attempt.as_str()).unwrap_or("")));
    }
    let (_, kappa, status) = find("vv-sdk")?;
    output.push_str(&format!("vv-sdk={}\n", if status == "proved" { "proved" } else { "establish" }));
    let origin = known.get(&kappa).filter(|_| status == "proved");
    output.push_str(&format!("vv-sdk-run-id={}\n", origin.map(|origin| origin.run_id.as_str()).unwrap_or("")));
    output.push_str(&format!("plan<<FACTORY_PLAN\n{plan}FACTORY_PLAN\n"));
    match std::env::var("GITHUB_OUTPUT") {
        Ok(path) => fs::OpenOptions::new()
            .append(true)
            .open(&path)
            .and_then(|mut file| file.write_all(output.as_bytes()))
            .map_err(|error| format!("{path}: {error}"))?,
        Err(_) => print!("{output}"),
    }
    Ok(true)
}

pub(crate) fn receipts(options: &Options) -> Result<bool, String> {
    let plan = environment("FACTORY_PLAN")?;
    let results = environment("FACTORY_RESULTS")?;
    let revision = commit(&environment("GITHUB_SHA")?)?;
    let (run_id, run_attempt) = (environment("GITHUB_RUN_ID")?, environment("GITHUB_RUN_ATTEMPT")?);
    if !numeric(&run_id) || !numeric(&run_attempt) {
        return Err("the run id and attempt must be numbers".into());
    }
    let planned: BTreeMap<&str, (&str, &str)> = plan
        .lines()
        .filter_map(|line| {
            let words: Vec<&str> = line.split(' ').collect();
            (words.len() == 3).then(|| (words[0], (words[1], words[2])))
        })
        .collect();
    fs::create_dir_all(&options.receipts).map_err(|error| error.to_string())?;
    let recorded = now();
    let mut outcomes = Vec::new();
    for line in results.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let mut words = line.split(' ');
        let name = words.next().unwrap_or("");
        let jobs: Vec<&str> = words.collect();
        let Some((kappa, status)) = planned.get(name) else {
            return Err(format!("{name} has a result but is not in the plan"));
        };
        if !matches!(*status, "establish" | "established") {
            continue;
        }
        let verdict = if jobs.iter().all(|result| *result == "success") {
            "pass"
        } else if jobs.contains(&"failure") {
            "fail"
        } else {
            eprintln!("factory: {name} did not finish ({}); no receipt", jobs.join(" "));
            continue;
        };
        let body = format!(
            "receipt {kappa} {verdict}\nobligation {name}\nrevision {revision}\nrun {run_id} {run_attempt}\nrecorded {recorded}\nexpires {}\nenvironment actions\n",
            recorded + RETENTION_SECONDS
        );
        fs::write(options.receipts.join(format!("{kappa}-{verdict}.receipt")), body).map_err(|error| error.to_string())?;
        eprintln!("factory: {name} {verdict} {kappa}");
        outcomes.push((name.to_string(), verdict == "pass"));
    }
    // The outcomes reweigh the published schedule when the receipts are pushed.
    let lines: String = outcomes.iter().map(|(name, passed)| format!("outcome {name} {}\n", if *passed { "pass" } else { "fail" })).collect();
    fs::write(options.receipts.join("outcomes"), lines).map_err(|error| error.to_string())?;
    Ok(true)
}

fn sha256_file(path: &Path) -> Result<String, String> {
    let out = Command::new("sha256sum").arg(path).output().map_err(|error| format!("sha256sum: {error}"))?;
    let text = String::from_utf8(out.stdout).map_err(|_| "sha256sum output")?;
    let digest = text.split(' ').next().unwrap_or("").to_string();
    if !out.status.success() || digest.len() != 64 {
        return Err(format!("sha256sum {} failed", path.display()));
    }
    Ok(digest)
}

fn identity_at(options: &Options, revision: &str, name: &str) -> Result<String, String> {
    let mut at = clone(options);
    at.revision = revision.to_string();
    at.receipts = std::env::temp_dir().join("prism-factory-no-receipts");
    let (text, _) = request(&at)?;
    let plan = read_plan(&plan_text(&text)?);
    plan.routes.get(name).map(|(_, kappa)| kappa.clone()).ok_or(format!("{name} is not in the plan"))
}

fn ancestor(older: &str, newer: &str) -> bool {
    Command::new("git").args(["merge-base", "--is-ancestor", older, newer]).status().is_ok_and(|status| status.success())
}

/// The record published with every release: which identity source V&V and the
/// build were established for, and for each whether this run established it or
/// another run's receipt proved it.
pub(crate) fn route_record(options: &Options) -> Result<bool, String> {
    let [output, revision, route, source_revision, run_id, run_attempt, build_route, build_revision, build_run_id, build_run_attempt] =
        options.arguments.as_slice()
    else {
        return Err("route-record needs OUT REV ROUTE SOURCE_REV RUN_ID RUN_ATTEMPT BUILD_ROUTE BUILD_REV BUILD_RUN_ID BUILD_RUN_ATTEMPT".into());
    };
    for value in [revision, source_revision, build_revision] {
        if !oid(value) {
            return Err(format!("{value} is not a full commit id"));
        }
    }
    for value in [run_id, run_attempt, build_run_id, build_run_attempt] {
        if !numeric(value) {
            return Err(format!("{value} is not a run number"));
        }
    }
    let mut checked = Vec::new();
    for (name, route, origin) in [("source-vv", route, source_revision), ("build", build_route, build_revision)] {
        let current = identity_at(options, revision, name)?;
        match route.as_str() {
            "established" if origin == revision => {}
            "proved" if ancestor(origin, revision) => {}
            _ => return Err(format!("{name}: route {route} from {origin} is not this commit or an ancestor")),
        }
        if identity_at(options, origin, name)? != current {
            return Err(format!("{name}: the receipt from {origin} is for a different identity"));
        }
        checked.push(current);
    }
    let evidence = sha256_file(Path::new("target/source-vv-evidence/source-vv.json"))?;
    let record = format!(
        concat!(
            "{{\"build\":{{\"identity\":\"{}\",\"revision\":\"{}\",\"route\":\"{}\",\"run_attempt\":\"{}\",\"run_id\":\"{}\"}},",
            "\"kappa\":\"{}\",\"model\":\"prism-factory/model/src/Factory/PrismPM.lex.tex\",",
            "\"receipt\":{{\"run_attempt\":\"{}\",\"run_id\":\"{}\",\"source_revision\":\"{}\",\"source_vv_sha256\":\"{}\"}},",
            "\"revision\":\"{}\",\"route\":\"{}\",\"schema\":\"prismpm/factory-route/3\"}}\n"
        ),
        checked[1], build_revision, build_route, build_run_attempt, build_run_id, checked[0], run_attempt, run_id, source_revision,
        evidence, revision, route
    );
    fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(output)
        .and_then(|mut file| file.write_all(record.as_bytes()))
        .map_err(|error| format!("{output}: {error}"))?;
    Ok(true)
}

/// A workflow projection. `release` places each job fragment
/// (prism-factory/jobs/NAME.yml) where the model puts `#fragment NAME`, and
/// refuses a fragment the model does not place.
fn projection(options: &Options) -> Result<Vec<u8>, String> {
    match options.name.as_str() {
        "factory" => prism_factory_host::workflow(b"").map_err(|_| "overflow".to_string()),
        "cut" => prism_factory_host::workflow(b"cut").map_err(|_| "overflow".to_string()),
        "delegate" => prism_factory_host::workflow(b"delegate").map_err(|_| "overflow".to_string()),
        "release" => {
            let skeleton = String::from_utf8(prism_factory_host::workflow(b"release").map_err(|_| "overflow")?).map_err(|_| "projection")?;
            let mut placed = BTreeSet::new();
            let mut out = String::new();
            for line in skeleton.split_inclusive('\n') {
                match line.strip_prefix("#fragment ") {
                    Some(name) => {
                        let name = name.trim_end();
                        let path = options.jobs.join(format!("{name}.yml"));
                        out.push_str(&fs::read_to_string(&path).map_err(|error| format!("{}: {error}", path.display()))?);
                        placed.insert(format!("{name}.yml"));
                    }
                    None => out.push_str(line),
                }
            }
            let listing = fs::read_dir(&options.jobs).map_err(|error| format!("{}: {error}", options.jobs.display()))?;
            for item in listing.filter_map(Result::ok) {
                let file = item.file_name().to_string_lossy().to_string();
                if !placed.contains(&file) {
                    return Err(format!("{} is not a job of the model", options.jobs.join(file).display()));
                }
            }
            Ok(out.into_bytes())
        }
        other => Err(format!("unknown workflow {other}")),
    }
}

pub(crate) fn workflow(options: &Options) -> Result<bool, String> {
    let projection = projection(options)?;
    match (&options.check, &options.write) {
        (Some(path), _) => match fs::read(path) {
            Ok(bytes) if bytes == projection => Ok(true),
            Ok(_) => Err(format!(
                "{} differs from the factory's projection; run `prism-factory workflow --name {} --write {}`",
                path.display(),
                options.name,
                path.display()
            )),
            Err(error) => Err(format!("{}: {error}", path.display())),
        },
        (None, Some(path)) => fs::write(path, &projection).map(|_| true).map_err(|error| error.to_string()),
        (None, None) => std::io::stdout().write_all(&projection).map(|_| true).map_err(|error| error.to_string()),
    }
}
