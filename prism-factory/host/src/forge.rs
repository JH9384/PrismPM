//! The forge's side of delegation (`model/src/Factory/Delegation.lex.tex`).
//!
//! The certified `delegate` root decides every identity, route, what a lent
//! runner establishes and the check. This module only reads the tree, hands
//! the root the receipts that `factory.sh` has already verified (their Sigstore
//! bundles, through `gh attestation verify`), and materializes a closure.

use std::fs;
use std::path::Path;

use crate::{git, materialize, tree, Options};

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

/// The request: the tree, each context (`@key`), then the lines `factory.sh`
/// wrote after verifying receipts (`signed`, `trust-repository`,
/// `trust-maintainer`, `event`).
pub(crate) fn request(options: &Options, verified: Option<&Path>) -> Result<String, String> {
    let entries = tree(&options.revision)?;
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
    let entries = tree(&options.revision)?;
    let work = options.work.join(name);
    materialize(&entries, &item.files, &work)?;
    // The closure gets its own repository, whose one commit tracks exactly the
    // closure, so no Git command in it can reach the checkout around it and
    // `git ls-files` lists exactly what the identity covers.
    let at = work.to_string_lossy();
    git(&["init", "--quiet", &at])?;
    git(&["-C", &at, "add", "--all", "--force"])?;
    git(&[
        "-C", &at, "-c", "user.name=prism-factory", "-c", "user.email=prism-factory@users.noreply.github.com",
        "-c", "commit.gpgsign=false", "commit", "--quiet", "--allow-empty", "-m", &format!("closure {}", item.kappa),
    ])?;
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
