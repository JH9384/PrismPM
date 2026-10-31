//! `prismpm check <path.holo>` (#270) through the built binary: the exit codes
//! 0, 1 and 2, the text form, and `--json` holding exactly one canonical verdict
//! on 0 and 1 and nothing on 2.

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

fn reference() -> PathBuf {
    root().join("sdk/npm/prism-code/fixtures/Calculator.holo")
}

struct Run {
    code: Option<i32>,
    out: String,
    err: String,
}

fn prismpm(args: &[&str], cwd: &Path) -> Run {
    let output = Command::new(env!("CARGO_BIN_EXE_prismpm"))
        .args(args)
        .env_remove("PRISM_MINIMUM_LEVEL")
        .current_dir(cwd)
        .output()
        .expect("run the CLI");
    Run {
        code: output.status.code(),
        out: String::from_utf8(output.stdout).expect("UTF-8 stdout"),
        err: String::from_utf8(output.stderr).expect("UTF-8 stderr"),
    }
}

#[test]
fn check_judges_a_holo_anywhere_with_the_documented_exit_codes() {
    let dir = tempfile::tempdir().unwrap();
    let holo = reference();
    let holo = holo.to_str().unwrap();

    // The reference archive carries no statements: P0, which the default policy refuses.
    let failed = prismpm(&["check", holo], dir.path());
    assert_eq!(failed.code, Some(1), "{}", failed.err);
    assert!(
        failed
            .out
            .starts_with("FAILED  P0 unverified  policy default requires P2 or above\n"),
        "{}",
        failed.out
    );
    assert!(failed.out.contains(&format!("\nholo    {holo}\n")));
    assert!(failed
        .out
        .contains("\n  policy.level (PP5601, Verification, policy rule)\n"));
    assert!(!failed.out.contains("cannot know"));
    assert!(failed.err.is_empty());

    // --json: one canonical line, the same verdict, the same exit code.
    let json = prismpm(&["check", holo, "--json"], dir.path());
    assert_eq!(json.code, Some(1));
    assert_eq!(json.out.matches('\n').count(), 1);
    assert!(json.out.ends_with("}\n"));
    let verdict: Value = serde_json::from_str(&json.out).unwrap();
    assert_eq!(verdict["schema"], "prism/verdict/1");
    assert_eq!(verdict["level"], "P0");
    assert_eq!(verdict["passed"], false);
    assert_eq!(
        verdict["policy"],
        serde_json::json!({"minimum": "P2", "name": "default"})
    );
    let keys = verdict
        .as_object()
        .unwrap()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    let mut sorted = keys.clone();
    sorted.sort();
    assert_eq!(keys, sorted, "canonical key order");
    let golden = std::fs::read_to_string(
        root().join("sdk/npm/prism-code/test/fixtures/verdict/calculator.default.json"),
    )
    .unwrap();
    let golden: Value = serde_json::from_str(&golden).unwrap();
    assert_eq!(verdict["holo"], golden["holo"]);
    assert_eq!(
        verdict["reasons"].as_array().unwrap().len(),
        golden["reasons"].as_array().unwrap().len()
    );

    // A policy that accepts P0 passes, named by its path.
    let policy = dir.path().join("p0.json");
    std::fs::write(&policy, br#"{"minimum":"P0"}"#).unwrap();
    let passed = prismpm(
        &[
            "check",
            holo,
            "--policy",
            policy.to_str().unwrap(),
            "--json",
        ],
        dir.path(),
    );
    assert_eq!(passed.code, Some(0), "{}", passed.err);
    let verdict: Value = serde_json::from_str(&passed.out).unwrap();
    assert_eq!(verdict["passed"], true);
    assert_eq!(verdict["policy"]["name"], policy.to_str().unwrap());
    let text = prismpm(
        &["check", holo, "--policy", policy.to_str().unwrap()],
        dir.path(),
    );
    assert_eq!(text.code, Some(0));
    assert!(text.out.starts_with("PASSED  P0 unverified  policy "));

    // The environment sets the minimum when the policy does not.
    let output = Command::new(env!("CARGO_BIN_EXE_prismpm"))
        .args(["check", holo])
        .env("PRISM_MINIMUM_LEVEL", "P0")
        .current_dir(dir.path())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(0));

    // No verdict: exit 2, the diagnostic on stderr, nothing on stdout even with --json.
    let missing = dir.path().join("missing.holo");
    let none = prismpm(&["check", missing.to_str().unwrap(), "--json"], dir.path());
    assert_eq!(none.code, Some(2));
    assert_eq!(none.out, "");
    assert!(
        none.err.starts_with("PP5603: no verdict: load.path: "),
        "{}",
        none.err
    );
    let bad = dir.path().join("bad.holo");
    std::fs::write(&bad, b"HOLX").unwrap();
    let none = prismpm(&["check", bad.to_str().unwrap()], dir.path());
    assert_eq!(none.code, Some(2));
    assert_eq!(none.out, "");
    assert!(
        none.err.contains("no verdict: archive.magic: "),
        "{}",
        none.err
    );
    let unknown = dir.path().join("unknown.json");
    std::fs::write(&unknown, br#"{"minimum":"P0","signer":"me"}"#).unwrap();
    let none = prismpm(
        &[
            "check",
            holo,
            "--policy",
            unknown.to_str().unwrap(),
            "--json",
        ],
        dir.path(),
    );
    assert_eq!(none.code, Some(2));
    assert_eq!(none.out, "");
    assert!(
        none.err.contains("no verdict: policy.invalid: "),
        "{}",
        none.err
    );
    // A Rego policy (#285) is refused by name, not misread as JSON.
    let rego = dir.path().join("release.rego");
    std::fs::write(
        &rego,
        b"package prism.policy

minimum := \"P0\"
",
    )
    .unwrap();
    let none = prismpm(
        &["check", holo, "--policy", rego.to_str().unwrap(), "--json"],
        dir.path(),
    );
    assert_eq!(none.code, Some(2));
    assert_eq!(none.out, "");
    assert!(
        none.err.contains("no verdict: policy.invalid: ") && none.err.contains("Rego"),
        "{}",
        none.err
    );

    // A tampered guest blob fails on its integrity; the verdict is still printed.
    let mut bytes = std::fs::read(reference()).unwrap();
    // The label also appears as text in the manifest and the documents; the blob row,
    // whose label opens the section, is the last occurrence.
    let guest = bytes
        .windows(71)
        .rposition(|window| {
            window == b"blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380"
        })
        .unwrap();
    bytes[guest + 71 + 100] ^= 0xff;
    let tampered = dir.path().join("tampered.holo");
    std::fs::write(&tampered, &bytes).unwrap();
    let run = prismpm(&["check", tampered.to_str().unwrap(), "--json"], dir.path());
    assert_eq!(run.code, Some(1), "{}", run.err);
    let verdict: Value = serde_json::from_str(&run.out).unwrap();
    assert_eq!(verdict["reasons"][0]["check"], "holo.integrity");
    assert_eq!(verdict["reasons"][0]["withholds"], "P1");

    // --policy without a holo is a usage error.
    let usage = prismpm(&["check", "--policy", policy.to_str().unwrap()], dir.path());
    assert_eq!(usage.code, Some(2));
    assert!(usage.out.is_empty());
}
