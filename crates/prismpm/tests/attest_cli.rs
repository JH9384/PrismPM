//! `prismpm attest` and `prismpm verify-attestation` (#272): a round trip with a local key, the exit
//! codes, the text and the JSON result, end to end through the binary. The JavaScript CLI's
//! `test/attest-cli.test.mjs` is the oracle.

use std::path::{Path, PathBuf};
use std::process::Command;

const PROOF: &str = "https://uor.foundation/prism/proof/v1";

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../sdk/npm/prism-code/fixtures/Calculator.holo")
}

fn key(name: &str) -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests/data/attest")
        .join(name)
}

struct Run {
    code: i32,
    stdout: String,
    stderr: String,
}

fn run(dir: &Path, arguments: &[&str]) -> Run {
    let output = Command::new(env!("CARGO_BIN_EXE_prismpm"))
        .current_dir(dir)
        .args(arguments)
        .output()
        .expect("prismpm runs");
    Run {
        code: output.status.code().expect("an exit code"),
        stdout: String::from_utf8(output.stdout).expect("UTF-8 stdout"),
        stderr: String::from_utf8(output.stderr).expect("UTF-8 stderr"),
    }
}

fn workspace() -> tempfile::TempDir {
    let dir = tempfile::tempdir().expect("a scratch directory");
    std::fs::write(dir.path().join("predicate.json"), br#"{"accepted":true}"#).unwrap();
    dir
}

fn p(dir: &tempfile::TempDir, name: &str) -> String {
    dir.path().join(name).display().to_string()
}

#[test]
fn attest_writes_the_signed_holo_to_output_and_verify_attestation_accepts_it() {
    let dir = workspace();
    std::fs::copy(fixture(), dir.path().join("app.holo")).unwrap();
    let before = std::fs::read(dir.path().join("app.holo")).unwrap();
    let private = key("p256.private.pem").display().to_string();
    let attested = run(
        dir.path(),
        &[
            "attest",
            &p(&dir, "app.holo"),
            "--predicate",
            &p(&dir, "predicate.json"),
            "--type",
            PROOF,
            "--key",
            &private,
            "--output",
            &p(&dir, "signed.holo"),
        ],
    );
    assert_eq!(attested.code, 0, "{}", attested.stderr);
    assert!(
        attested
            .stdout
            .contains(&format!("signed.holo: attested {PROOF} (guest), key "))
            && attested.stdout.trim_end().ends_with("; 1 attestation"),
        "{}",
        attested.stdout
    );
    assert_eq!(
        std::fs::read(dir.path().join("app.holo")).unwrap(),
        before,
        "the input is untouched"
    );
    let leftovers = std::fs::read_dir(dir.path())
        .unwrap()
        .filter_map(Result::ok)
        .filter(|entry| entry.file_name().to_string_lossy().ends_with(".tmp"))
        .count();
    assert_eq!(leftovers, 0, "no scratch file is left behind");

    let public = key("p256.public.pem").display().to_string();
    let verified = run(
        dir.path(),
        &[
            "verify-attestation",
            &p(&dir, "signed.holo"),
            "--key",
            &public,
            "--type",
            PROOF,
        ],
    );
    assert_eq!(verified.code, 0, "{}", verified.stderr);
    let lines = verified.stdout.lines().collect::<Vec<_>>();
    assert_eq!(lines.len(), 2, "{}", verified.stdout);
    assert!(
        lines[0].starts_with(&format!("attestation 0 {PROOF} (guest): verified key ")),
        "{}",
        lines[0]
    );
    assert_eq!(lines[1], "verified");

    // The JSON form is the registered result document.
    let json = run(
        dir.path(),
        &[
            "verify-attestation",
            &p(&dir, "signed.holo"),
            "--key",
            &public,
            "--json",
        ],
    );
    assert_eq!(json.code, 0, "{}", json.stderr);
    let value: serde_json::Value = serde_json::from_str(&json.stdout).unwrap();
    assert_eq!(value["schema"], "prismpm/attestation-verification-result/1");
    assert_eq!(value["passed"], true);
    assert_eq!(
        value["results"][0]["subjects"],
        serde_json::json!(["guest"])
    );
    assert_eq!(value["error"], serde_json::Value::Null);

    // The section is an ordinary Extension row, so the holo still inspects.
    let inspected = run(dir.path(), &["inspect", &p(&dir, "signed.holo")]);
    assert_eq!(inspected.code, 0, "{}", inspected.stderr);
}

#[test]
fn without_output_attest_signs_in_place_and_a_second_attest_adds_a_second_bundle() {
    let dir = workspace();
    std::fs::copy(fixture(), dir.path().join("inplace.holo")).unwrap();
    let private = key("p256.private.pem").display().to_string();
    for (count, subject) in ["guest", "view"].iter().enumerate() {
        let out = run(
            dir.path(),
            &[
                "attest",
                &p(&dir, "inplace.holo"),
                "--predicate",
                &p(&dir, "predicate.json"),
                "--type",
                PROOF,
                "--subject",
                subject,
                "--key",
                &private,
            ],
        );
        assert_eq!(out.code, 0, "{}", out.stderr);
        assert!(
            out.stdout.contains(&format!("({subject}), key ")),
            "{}",
            out.stdout
        );
        assert!(
            out.stdout.contains(&format!("; {} attestation", count + 1)),
            "{}",
            out.stdout
        );
    }
    let json = run(
        dir.path(),
        &[
            "--json",
            "verify-attestation",
            &p(&dir, "inplace.holo"),
            "--key",
            &key("p256.public.pem").display().to_string(),
        ],
    );
    assert_eq!(json.code, 0, "{}", json.stderr);
    let value: serde_json::Value = serde_json::from_str(&json.stdout).unwrap();
    assert_eq!(value["passed"], true);
    assert_eq!(
        value["results"][0]["subjects"],
        serde_json::json!(["guest"])
    );
    assert_eq!(value["results"][1]["subjects"], serde_json::json!(["view"]));
}

#[test]
fn a_failed_verify_is_data_with_the_typed_error_and_exit_1() {
    let dir = workspace();
    std::fs::copy(fixture(), dir.path().join("app.holo")).unwrap();
    let private = key("p256.private.pem").display().to_string();
    let attested = run(
        dir.path(),
        &[
            "attest",
            &p(&dir, "app.holo"),
            "--predicate",
            &p(&dir, "predicate.json"),
            "--type",
            PROOF,
            "--key",
            &private,
        ],
    );
    assert_eq!(attested.code, 0, "{}", attested.stderr);
    let other = key("other.public.pem").display().to_string();
    let json = run(
        dir.path(),
        &[
            "verify-attestation",
            &p(&dir, "app.holo"),
            "--key",
            &other,
            "--json",
        ],
    );
    assert_eq!(json.code, 1, "{}", json.stderr);
    let value: serde_json::Value = serde_json::from_str(&json.stdout).unwrap();
    assert_eq!(value["passed"], false);
    assert_eq!(value["results"][0]["error"]["code"], "PP3102");
    assert_eq!(value["results"][0]["error"]["kind"], "signature_invalid");
    assert!(value["results"][0]["error"]["check"]
        .as_str()
        .unwrap()
        .starts_with("signature."));
    assert_eq!(value["error"]["code"], "PP3102");

    let text = run(
        dir.path(),
        &["verify-attestation", &p(&dir, "app.holo"), "--key", &other],
    );
    assert_eq!(text.code, 1);
    assert!(
        text.stdout.contains("PP3102 (signature_invalid): "),
        "{}",
        text.stdout
    );
    assert!(
        text.stdout.trim_end().ends_with("not verified"),
        "{}",
        text.stdout
    );

    // A holo with no attestation exits 1 and names the diagnostic inside the result.
    let bare = run(
        dir.path(),
        &[
            "verify-attestation",
            &fixture().display().to_string(),
            "--key",
            &key("p256.public.pem").display().to_string(),
        ],
    );
    assert_eq!(bare.code, 1);
    assert!(
        bare.stdout
            .contains("PP3106 (attestation_not_found): the holo has no attestation section"),
        "{}",
        bare.stdout
    );
}

#[test]
fn a_policy_that_would_let_any_signer_pass_and_missing_operands_are_usage_errors() {
    let dir = workspace();
    let holo = fixture().display().to_string();
    let none = run(dir.path(), &["verify-attestation", &holo]);
    assert_eq!(none.code, 2, "{}", none.stdout);
    assert!(none.stderr.contains("PP1001"), "{}", none.stderr);
    let issuer_only = run(
        dir.path(),
        &[
            "verify-attestation",
            &holo,
            "--certificate-oidc-issuer",
            "https://token.actions.githubusercontent.com",
        ],
    );
    assert_eq!(issuer_only.code, 2);
    assert!(
        issuer_only.stderr.contains("PP1001"),
        "{}",
        issuer_only.stderr
    );
    // A keyless policy with no pinned root is refused: nothing is fetched.
    let no_root = run(
        dir.path(),
        &[
            "verify-attestation",
            &holo,
            "--certificate-identity",
            "someone",
            "--certificate-oidc-issuer",
            "https://token.actions.githubusercontent.com",
        ],
    );
    assert_eq!(no_root.code, 1, "{}", no_root.stdout);
    assert!(
        no_root.stdout.contains("PP3106") || no_root.stderr.contains("PP3107"),
        "{}{}",
        no_root.stdout,
        no_root.stderr
    );
    assert_eq!(
        run(
            dir.path(),
            &[
                "verify-attestation",
                &holo,
                "--key",
                &key("p256.public.pem").display().to_string(),
                "--entries",
                "many"
            ]
        )
        .code,
        2
    );
    assert_eq!(run(dir.path(), &["attest"]).code, 2);
    assert_eq!(run(dir.path(), &["attest", &holo]).code, 2);
    assert_eq!(
        run(
            dir.path(),
            &["attest", &holo, "--predicate", &p(&dir, "predicate.json")]
        )
        .code,
        2
    );
    assert_eq!(run(dir.path(), &["verify-attestation"]).code, 2);
    assert_eq!(
        run(dir.path(), &["verify-attestation", &holo, "--key"]).code,
        2
    );

    // Unreadable operands exit 2 and leave the holo as it was; a bad key is a signing failure, exit 3.
    let missing = run(
        dir.path(),
        &[
            "attest",
            &holo,
            "--predicate",
            &p(&dir, "nope.json"),
            "--type",
            PROOF,
            "--key",
            &key("p256.private.pem").display().to_string(),
            "--output",
            &p(&dir, "x.holo"),
        ],
    );
    assert_eq!(missing.code, 2, "{}", missing.stderr);
    assert!(
        missing.stderr.contains("PP1002") && missing.stderr.contains("the predicate"),
        "{}",
        missing.stderr
    );
    assert!(!dir.path().join("x.holo").exists());
    assert_eq!(
        run(
            dir.path(),
            &["verify-attestation", &holo, "--key", &p(&dir, "nope.pem")]
        )
        .code,
        2
    );
    let bad_key = run(
        dir.path(),
        &[
            "attest",
            &holo,
            "--predicate",
            &p(&dir, "predicate.json"),
            "--type",
            PROOF,
            "--key",
            &key("p256.public.pem").display().to_string(),
            "--output",
            &p(&dir, "x.holo"),
        ],
    );
    assert_eq!(bad_key.code, 3, "{}", bad_key.stderr);
    assert!(bad_key.stderr.contains("PP3101"), "{}", bad_key.stderr);
    assert!(!dir.path().join("x.holo").exists());

    let help = run(dir.path(), &["--help"]);
    assert!(
        help.stdout.contains("attest") && help.stdout.contains("verify-attestation"),
        "{}",
        help.stdout
    );
}
