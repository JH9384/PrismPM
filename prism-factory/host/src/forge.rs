//! The forge's side of delegation (`model/src/Factory/Delegation.lex.tex`).
//!
//! The certified `delegate` root decides every identity, route, what a lent
//! runner establishes and the check. This module only reads the tree, hands
//! the root the receipts that `factory.sh` has already verified (their Sigstore
//! bundles, through `gh attestation verify`), and materializes a closure.

use std::fs;
use std::path::Path;

use crate::{git, materialize, tree, Entry, Options};

fn git_with_input(arguments: &[&str], input: &[u8]) -> Result<Vec<u8>, String> {
    use std::io::Write;
    use std::process::{Command, Stdio};
    let mut child = Command::new("git").args(arguments).stdin(Stdio::piped()).stdout(Stdio::piped()).spawn().map_err(|error| format!("git: {error}"))?;
    child.stdin.take().ok_or("git stdin")?.write_all(input).map_err(|error| error.to_string())?;
    let out = child.wait_with_output().map_err(|error| error.to_string())?;
    if !out.status.success() {
        return Err(format!("git {} failed", arguments.join(" ")));
    }
    Ok(out.stdout)
}

fn git_indexed(index: &Path, arguments: &[&str]) -> Result<Vec<u8>, String> {
    let out = std::process::Command::new("git").env("GIT_INDEX_FILE", index).args(arguments).output().map_err(|error| format!("git: {error}"))?;
    if !out.status.success() {
        return Err(format!("git {} failed: {}", arguments.join(" "), String::from_utf8_lossy(&out.stderr)));
    }
    Ok(out.stdout)
}

/// One obligation as the delegation plan describes it.
#[derive(Default, Debug)]
pub(crate) struct Delegated {
    pub(crate) route: String,
    pub(crate) kappa: String,
    pub(crate) run: String,
    pub(crate) access: String,
    pub(crate) image: String,
    pub(crate) sandbox: String,
    pub(crate) establish: bool,
    pub(crate) status: Option<String>,
    pub(crate) files: Vec<String>,
}

#[derive(Default, Debug)]
pub(crate) struct DelegationPlan {
    pub(crate) order: Vec<String>,
    pub(crate) obligations: std::collections::BTreeMap<String, Delegated>,
    pub(crate) check: String,
}

pub(crate) fn read(text: &str) -> DelegationPlan {
    let mut plan = DelegationPlan::default();
    for line in text.lines() {
        let mut parts = line.splitn(3, ' ');
        let (tag, owner, rest) = (parts.next().unwrap_or(""), parts.next().unwrap_or(""), parts.next().unwrap_or(""));
        if tag == "check" {
            plan.check = owner.to_string();
            continue;
        }
        if tag == "obligation" {
            plan.order.push(owner.to_string());
        }
        let entry = plan.obligations.entry(owner.to_string()).or_default();
        match tag {
            "obligation" => {
                let (route, kappa) = rest.split_once(' ').unwrap_or((rest, ""));
                entry.route = route.into();
                entry.kappa = kappa.into();
            }
            "run" => entry.run = rest.into(),
            "access" => {
                let (access, image) = rest.split_once(' ').unwrap_or((rest, ""));
                entry.access = access.into();
                entry.image = image.into();
            }
            "sandbox" => entry.sandbox = rest.into(),
            "establish" => entry.establish = true,
            "status" => entry.status = Some(rest.into()),
            "file" => entry.files.push(rest.into()),
            _ => {}
        }
    }
    plan
}

/// The base of a revision is its first parent: for a pull request's merge
/// commit, the tip of the branch it merges into; for a push, the previous tip.
/// A check that compares the tree with its base (a ratchet) declares
/// `@base:PATH`, and reads the base's entry at PATH and nothing else of it.
pub(crate) fn base(revision: &str) -> Result<Option<String>, String> {
    let commit = git(&["cat-file", "commit", revision])?;
    let header = String::from_utf8_lossy(&commit);
    let Some(parent) = header.lines().take_while(|line| !line.is_empty()).find_map(|line| line.strip_prefix("parent ")) else {
        return Ok(None);
    };
    let parent = parent.trim().to_string();
    if git(&["cat-file", "-e", &format!("{parent}^{{tree}}")]).is_err() {
        return Err(format!("the base {parent} of {revision} is not here; fetch it (git fetch --depth=1 origin {parent})"));
    }
    Ok(Some(parent))
}

/// Every entry of the tree, then every entry of its base under `@base:`.
fn entries_with_base(revision: &str) -> Result<Vec<Entry>, String> {
    let mut entries = tree(revision)?;
    if let Some(parent) = base(revision)? {
        for entry in tree(&parent)? {
            entries.push(Entry { path: format!("@base:{}", entry.path), object: entry.object });
        }
    }
    Ok(entries)
}

/// The request: the tree and its base, each context (`@key`), then the lines
/// `factory.sh` wrote after verifying receipts (`signed`, `trust-repository`,
/// `trust-maintainer`, `event`).
pub(crate) fn request(options: &Options, verified: Option<&Path>) -> Result<String, String> {
    let entries = entries_with_base(&options.revision)?;
    let mut text = String::new();
    for entry in &entries {
        text.push_str(&format!("tree {} {}\n", entry.object, entry.path));
    }
    for (key, value) in &options.contexts {
        text.push_str(&format!("tree context:{value} @{key}\n"));
    }
    if let Some(path) = verified {
        let lines = fs::read_to_string(path).map_err(|error| format!("{}: {error}", path.display()))?;
        for line in lines.lines() {
            let tag = line.split(' ').next().unwrap_or("");
            if !matches!(tag, "signed" | "trust-repository" | "trust-maintainer" | "event") {
                return Err(format!("{}: unexpected line {line:?}", path.display()));
            }
            text.push_str(line);
            text.push('\n');
        }
    }
    Ok(text)
}

pub(crate) fn plan_text(options: &Options) -> Result<String, String> {
    let verified = options.arguments.first().map(Path::new);
    let text = request(options, verified)?;
    let out = prism_factory_host::delegate(text.as_bytes()).map_err(|_| "the delegate root overflowed")?;
    String::from_utf8(out).map_err(|_| "the delegation plan is not UTF-8".into())
}

/// `delegate VERIFIED`: print the plan.
pub(crate) fn plan(options: &Options) -> Result<bool, String> {
    print!("{}", plan_text(options)?);
    Ok(true)
}

/// `delegate-prepare VERIFIED NAME`: write exactly NAME's closure into
/// `--work`/NAME, and NAME's command, access, image, identity and sandbox
/// beside it (outside the closure), for the PrismPM Action's `factory` command.
pub(crate) fn prepare(options: &Options) -> Result<bool, String> {
    let name = options.arguments.get(1).ok_or("delegate-prepare needs VERIFIED NAME")?;
    let plan = read(&plan_text(options)?);
    let item = plan.obligations.get(name).ok_or(format!("{name} is not an obligation"))?;
    if !item.establish {
        return Err(format!("{name} is {} and is not for a lent runner to establish", item.route));
    }
    let entries = entries_with_base(&options.revision)?;
    let work = options.work.join(name);
    let (based, files): (Vec<String>, Vec<String>) = item.files.iter().cloned().partition(|path| path.starts_with("@base:"));
    // A context (`@key`) is part of the identity, not a file.
    let files: Vec<String> = files.into_iter().filter(|path| !path.starts_with('@')).collect();
    materialize(&entries, &files, &work)?;
    // The closure gets its own repository, whose one commit tracks exactly the
    // closure, so no Git command in it can reach the checkout around it and
    // `git ls-files` lists exactly what the identity covers. When the closure
    // reads its base, that commit's parent holds exactly the base entries it
    // declared, named `origin/main` as a full checkout names the base.
    let at = work.to_string_lossy();
    git(&["init", "--quiet", &at])?;
    let identity = ["-c", "user.name=prism-factory", "-c", "user.email=prism-factory@users.noreply.github.com", "-c", "commit.gpgsign=false"];
    if !based.is_empty() {
        let by_path: std::collections::BTreeMap<&str, &str> = entries.iter().map(|entry| (entry.path.as_str(), entry.object.as_str())).collect();
        // GIT_INDEX_FILE resolves against the directory `-C` enters, so name it absolutely.
        let index = fs::canonicalize(&work).map_err(|error| format!("{}: {error}", work.display()))?.join(".git/prism-base-index");
        let _ = fs::remove_file(&index);
        for path in &based {
            let object = by_path.get(path.as_str()).ok_or(format!("{path} is not in the base"))?;
            let (mode, oid) = object.split_once(':').ok_or("bad object")?;
            let blob = git(&["cat-file", "blob", oid])?;
            let stored = String::from_utf8(git_with_input(&["-C", &at, "hash-object", "-w", "--stdin"], &blob)?).map_err(|_| "git hash-object")?;
            git_indexed(&index, &["-C", &at, "update-index", "--add", "--cacheinfo", &format!("{mode},{},{}", stored.trim(), &path["@base:".len()..])])?;
        }
        let tree = String::from_utf8(git_indexed(&index, &["-C", &at, "write-tree"])?).map_err(|_| "git write-tree")?;
        let _ = fs::remove_file(&index);
        let mut arguments = vec!["-C", &*at];
        arguments.extend(identity);
        let message = format!("base of closure {}", item.kappa);
        arguments.extend(["commit-tree", tree.trim(), "-m", &message]);
        let commit = String::from_utf8(git(&arguments)?).map_err(|_| "git commit-tree")?;
        git(&["-C", &at, "update-ref", "refs/remotes/origin/main", commit.trim()])?;
        git(&["-C", &at, "update-ref", "HEAD", commit.trim()])?;
    }
    git(&["-C", &at, "add", "--all", "--force"])?;
    let mut arguments = vec!["-C", &*at];
    arguments.extend(identity);
    let message = format!("closure {}", item.kappa);
    arguments.extend(["commit", "--quiet", "--allow-empty", "-m", &message]);
    git(&arguments)?;
    let beside = |suffix: &str, value: &str| {
        let path = options.work.join(format!("{name}.{suffix}"));
        fs::write(&path, format!("{value}\n")).map_err(|error| format!("{}: {error}", path.display()))
    };
    beside("run", &item.run)?;
    beside("access", &item.access)?;
    beside("image", &item.image)?;
    beside("kappa", &item.kappa)?;
    beside("sandbox", &item.sandbox)?;
    println!("{}", work.display());
    Ok(true)
}
