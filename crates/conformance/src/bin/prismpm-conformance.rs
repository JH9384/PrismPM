//! SDK conformance and diagnostic transcript runner.

use clap::Parser;
use repo_conformance::{cases, runner};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::BTreeSet;
use std::io::Write;
use std::path::{Component, Path, PathBuf};

#[derive(Parser)]
#[command(name = "prismpm-conformance")]
struct Arguments {
    #[arg(long, default_value = "/opt/prismpm/share/conformance-root")]
    source_root: PathBuf,
    #[arg(long)]
    release_digest: String,
    #[arg(long)]
    coverage_digest: String,
    #[arg(long)]
    sdk_digest: String,
    #[arg(long)]
    feature: Vec<String>,
    #[arg(long)]
    diagnostic: Vec<String>,
}

fn sha(bytes: &[u8]) -> String {
    format!("sha256:{:x}", Sha256::digest(bytes))
}

fn digest(value: &Value) -> Result<String, Box<dyn std::error::Error>> {
    Ok(sha(&prismpm::holo::canonical::encode_value(value)?))
}

fn digest_value(value: &str) -> bool {
    value.strip_prefix("sha256:").is_some_and(|hex| {
        hex.len() == 64
            && hex
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    })
}

fn copy_source(from: &Path, to: &Path) -> Result<(), Box<dyn std::error::Error>> {
    let canonical_root = from.canonicalize()?;
    for entry in walkdir::WalkDir::new(from)
        .follow_links(true)
        .into_iter()
        .filter_entry(|entry| {
            let relative = entry
                .path()
                .strip_prefix(from)
                .unwrap_or_else(|_| Path::new(""));
            !relative.components().any(|component| {
                matches!(component, Component::Normal(name) if name == ".git"
                    || name == ".lake"
                    || name == ".lexlean"
                    || name == ".prism"
                    || name == "node_modules"
                    || name == "release"
                    || name == "target")
            })
        })
    {
        let entry = entry?;
        let relative = entry.path().strip_prefix(from)?;
        if !entry.path().canonicalize()?.starts_with(&canonical_root) {
            return Err(format!(
                "conformance source link escapes its root: {}",
                relative.display()
            )
            .into());
        }
        let destination = to.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination)?;
        } else if entry.file_type().is_file() {
            if let Some(parent) = destination.parent() {
                std::fs::create_dir_all(parent)?;
            }
            std::fs::copy(entry.path(), destination)?;
        } else {
            return Err(format!(
                "conformance source has an unsupported node: {}",
                relative.display()
            )
            .into());
        }
    }
    Ok(())
}

fn panic_text(payload: Box<dyn std::any::Any + Send>) -> String {
    payload
        .downcast_ref::<String>()
        .cloned()
        .or_else(|| {
            payload
                .downcast_ref::<&str>()
                .map(|value| (*value).to_owned())
        })
        .unwrap_or_else(|| "non-string conformance panic".to_owned())
}

fn verify_source_registers(root: &Path) -> Result<(), Box<dyn std::error::Error>> {
    for (name, expected) in [
        (
            "ids.toml",
            include_bytes!("../../../../model/ids.toml").as_slice(),
        ),
        (
            "errors.toml",
            include_bytes!("../../../../model/errors.toml").as_slice(),
        ),
    ] {
        if std::fs::read(root.join("model").join(name))? != expected {
            return Err(format!(
                "the conformance {name} register differs from the shipped authority"
            )
            .into());
        }
    }
    Ok(())
}

fn run() -> Result<Vec<u8>, Box<dyn std::error::Error>> {
    let arguments = Arguments::parse();
    if ![
        &arguments.release_digest,
        &arguments.coverage_digest,
        &arguments.sdk_digest,
    ]
    .into_iter()
    .all(|value| digest_value(value))
    {
        return Err("release, coverage, and SDK identities must be sha256 digests".into());
    }
    verify_source_registers(&arguments.source_root)?;
    let model = repo_model::Model::load(&arguments.source_root.join("model"))?;
    let registered_features = model
        .ids
        .id
        .iter()
        .map(|row| row.id.clone())
        .collect::<BTreeSet<_>>();
    let registered_diagnostics = model
        .errors
        .error
        .iter()
        .map(|row| row.code.clone())
        .collect::<BTreeSet<_>>();
    let requested_features = if arguments.feature.is_empty() {
        registered_features.clone()
    } else {
        arguments.feature.into_iter().collect()
    };
    let requested_diagnostics = if arguments.diagnostic.is_empty() {
        registered_diagnostics.clone()
    } else {
        arguments.diagnostic.into_iter().collect()
    };
    if !requested_features.is_subset(&registered_features)
        || !requested_diagnostics.is_subset(&registered_diagnostics)
    {
        return Err("requested feature or diagnostic is not registered".into());
    }
    let suite = runner::scenarios_in(&arguments.source_root.join("features/suites"))?;
    if !suite.violations.is_empty() {
        return Err(format!("feature suite violations: {:?}", suite.violations).into());
    }
    let temporary = tempfile::tempdir()?;
    copy_source(&arguments.source_root, temporary.path())?;
    let executable = std::env::current_exe()?;
    let runner_digest = sha(&std::fs::read(executable)?);
    let mut rows = Vec::new();
    for feature in &requested_features {
        let scenarios = suite
            .scenarios
            .iter()
            .filter(|scenario| &scenario.id == feature)
            .collect::<Vec<_>>();
        if scenarios.len() != 1 {
            return Err(
                format!("feature {feature} does not have exactly one executable scenario").into(),
            );
        }
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            cases::run_at(temporary.path(), feature)
        }))
        .map_err(|payload| format!("feature {feature} failed: {}", panic_text(payload)))?;
        let scenario = scenarios[0];
        let evidence = json!({
            "coverage_digest":arguments.coverage_digest,
            "feature_id":feature,
            "negative_status":"rejected",
            "positive_status":"passed",
            "release_digest":arguments.release_digest,
            "runner_digest":runner_digest,
            "sdk_digest":arguments.sdk_digest,
            "statement":scenario.statement,
            "steps":scenario.steps,
            "suite":scenario.suite
        });
        rows.push(json!({
            "command":format!("prismpm-conformance --feature {feature}"),
            "diagnostic":Value::Null,
            "evidence_digest":digest(&evidence)?,
            "feature_id":feature,
            "kind":"feature",
            "status":"passed"
        }));
    }
    let probes = prismpm::diagnostics::exercise_all()?;
    let observed_codes = probes
        .iter()
        .map(|probe| probe.code.clone())
        .collect::<BTreeSet<_>>();
    if observed_codes != registered_diagnostics {
        return Err("diagnostic trigger registry differs from model/errors.toml".into());
    }
    for probe in probes
        .into_iter()
        .filter(|probe| requested_diagnostics.contains(&probe.code))
    {
        rows.push(json!({
            "command":format!("prismpm-conformance --diagnostic {}",probe.code),
            "diagnostic":probe.code,
            "evidence_digest":probe.negative_digest,
            "feature_id":Value::Null,
            "kind":"diagnostic",
            "status":"passed"
        }));
    }
    rows.sort_by_key(|row| match row["kind"].as_str() {
        Some("feature") => format!("0/{}", row["feature_id"].as_str().unwrap_or_default()),
        Some("diagnostic") => format!("1/{}", row["diagnostic"].as_str().unwrap_or_default()),
        _ => "2".to_owned(),
    });
    if rows.len() != requested_features.len() + requested_diagnostics.len() {
        return Err("one or more requested conformance executions were not recorded".into());
    }
    let complete = requested_features == registered_features
        && requested_diagnostics == registered_diagnostics;
    let transcript = json!({
        "cases":rows,
        "coverage_digest":arguments.coverage_digest,
        "diagnostic_count":requested_diagnostics.len(),
        "feature_count":requested_features.len(),
        "release_digest":arguments.release_digest,
        "runner_digest":runner_digest,
        "schema":"prismpm/production-acceptance/1",
        "sdk_digest":arguments.sdk_digest,
        "status":if complete { "accepted" } else { "passed" }
    });
    Ok(
        prismpm::acceptance::contract_from_value("prismpm/production-acceptance/1", transcript)?
            .bytes()
            .to_vec(),
    )
}

fn main() -> std::process::ExitCode {
    match run() {
        Ok(bytes) => {
            let mut stdout = std::io::stdout().lock();
            if stdout
                .write_all(&bytes)
                .and_then(|()| stdout.write_all(b"\n"))
                .is_ok()
            {
                std::process::ExitCode::SUCCESS
            } else {
                std::process::ExitCode::from(1)
            }
        }
        Err(error) => {
            eprintln!("prismpm-conformance: {error}");
            std::process::ExitCode::from(1)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::verify_source_registers;

    #[test]
    fn shipped_registers_reject_omitted_substituted_and_duplicate_identities() {
        let root = tempfile::tempdir().unwrap();
        let model = root.path().join("model");
        std::fs::create_dir(&model).unwrap();
        let ids = include_str!("../../../../model/ids.toml");
        let errors = include_str!("../../../../model/errors.toml");
        std::fs::write(model.join("ids.toml"), ids).unwrap();
        std::fs::write(model.join("errors.toml"), errors).unwrap();
        verify_source_registers(root.path()).unwrap();
        for changed in [
            ids.replace("id = \"HO-11\"", "id = \"HO-12\""),
            ids.replace("id = \"HO-11\"", "id = \"HO-10\""),
            ids.replace("id = \"HO-11\"", ""),
            ids.replace("id = \"HO-12\"", ""),
        ] {
            assert_ne!(changed, ids);
            std::fs::write(model.join("ids.toml"), changed).unwrap();
            assert!(verify_source_registers(root.path()).is_err());
        }
        std::fs::write(model.join("ids.toml"), ids).unwrap();
        let changed = errors.replace("code = \"PP2009\"", "code = \"PP2008\"");
        assert_ne!(changed, errors);
        std::fs::write(model.join("errors.toml"), changed).unwrap();
        assert!(verify_source_registers(root.path()).is_err());
    }
}
