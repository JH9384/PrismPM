//! DK-42: the Rust runtime passes `@prism-code/conformance` (#298) through its
//! shim, `src/bin/prism-conformance-shim.rs`, with every gap declared.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// The checks the Rust runtime passes today, by feature. A check that starts
/// to pass fails the run as an unexpected pass, so this changes with the
/// declaration and never silently.
const PASSING: [(&str, u64); 5] = [
    ("capabilities", 2),
    ("digests", 18),
    ("errors", 6),
    ("verify", 24),
    ("world", 14),
];

/// Build the shim and return its path, as cargo reports the artifact.
fn shim(root: &Path) -> PathBuf {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "build",
            "--locked",
            "--offline",
            "-p",
            "repo-conformance",
            "--bin",
            "prism-conformance-shim",
            "--message-format=json",
        ])
        .output()
        .expect("cargo builds the Rust conformance shim");
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 cargo messages");
    assert!(
        output.status.success(),
        "{stdout}\n{}",
        String::from_utf8_lossy(&output.stderr)
    );
    stdout
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter(|message| {
            message["reason"] == "compiler-artifact"
                && message["target"]["name"] == "prism-conformance-shim"
        })
        .find_map(|message| message["executable"].as_str().map(PathBuf::from))
        .expect("cargo names the shim's executable")
}

pub(super) fn verify(root: &Path) {
    let shim = shim(root);
    let output = Command::new("node")
        .current_dir(root)
        .env_remove("NODE_TEST_CONTEXT")
        .args([
            "sdk/npm/conformance/bin/prism-conformance.mjs",
            "run",
            "--runtime",
            "rust",
            "--declaration",
            "crates/conformance/runtime/declaration.json",
            "--json",
            "--",
        ])
        .arg(&shim)
        .output()
        .expect("node runs @prism-code/conformance");
    let results: Value = serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "the suite printed no results ({error})\n{}",
            String::from_utf8_lossy(&output.stderr)
        )
    });
    assert!(
        output.status.success() && results["passed"] == true,
        "the Rust runtime fails a check it did not declare: {}",
        serde_json::to_string_pretty(&results["summary"]).unwrap_or_default()
    );
    assert_eq!(results["schema"], "prism/conformance-results/1");
    assert_eq!(results["complete"], true, "every check of the suite ran");
    assert_eq!(results["implementation"]["name"], "prismpm");
    let mut passing = BTreeMap::new();
    for check in results["checks"].as_array().expect("checks") {
        if check["status"] == "pass" {
            let feature = check["feature"].as_str().expect("feature").to_owned();
            *passing.entry(feature).or_insert(0u64) += 1;
        }
    }
    let expected = PASSING
        .iter()
        .map(|(feature, count)| ((*feature).to_owned(), *count))
        .collect::<BTreeMap<_, _>>();
    assert_eq!(passing, expected, "the checks the Rust runtime passes");
    let summary = &results["summary"];
    assert_eq!(summary["fail"], 0);
    assert_eq!(summary["unexpected-pass"], 0);
}
