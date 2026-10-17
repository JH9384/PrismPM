//! Independent Hologram oracle interoperability acceptance for Calculator and Text artifacts.
//!
//! Validates:
//! 1. Pinned independent Hologram Live and Holo codec oracle source/cargo inputs.
//! 2. Execution and acceptance of Calculator against `prismpm/hologram-oracle/2`.
//! 3. Execution and acceptance of Text application against `prismpm/hologram-oracle/2`.
//! 4. Non-vacuous failure probes for wrong-subject, wrong-edition, and tampered reports.
//! 5. Isolated validation oracle status (not application authority).

use prismpm::controller::{BuildRequest, CheckRequest, Controller, VerifyRequest};
use prismpm::holo::model_document::ModelDocument;
use prismpm::upstream_conformance::validate_hologram_oracle_report;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

struct CleanupGuard(PathBuf);
impl Drop for CleanupGuard {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

fn sha256_file(path: &Path) -> String {
    let bytes =
        std::fs::read(path).unwrap_or_else(|e| panic!("failed to read {}: {e}", path.display()));
    let mut hasher = Sha256::new();
    hasher.update(&bytes);
    format!("{:x}", hasher.finalize())
}

#[test]
fn test_hologram_oracle_pinned_source_identities() {
    let r = root();
    // 1. Pinned Hologram Live source archive checksum
    assert_eq!(
        sha256_file(&r.join("crates/prismpm/vendor/hologram-live.tar")),
        "caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66",
        "pinned Hologram Live vendor tarball checksum changed"
    );

    // 2. Embedded oracle harness matches tests/hologram-oracle/
    assert_eq!(
        std::fs::read(r.join("tests/hologram-oracle/Cargo.toml")).unwrap(),
        std::fs::read(r.join("crates/prismpm/src/embedded/hologram-oracle.Cargo.toml")).unwrap(),
        "hologram-oracle Cargo.toml diverges from embedded"
    );
    assert_eq!(
        std::fs::read(r.join("tests/hologram-oracle/Cargo.lock")).unwrap(),
        std::fs::read(r.join("crates/prismpm/src/embedded/hologram-oracle.Cargo.lock")).unwrap(),
        "hologram-oracle Cargo.lock diverges from embedded"
    );
    assert_eq!(
        std::fs::read(r.join("tests/hologram-oracle/src/main.rs")).unwrap(),
        std::fs::read(r.join("crates/prismpm/src/embedded/hologram-oracle.main.rs")).unwrap(),
        "hologram-oracle main.rs diverges from embedded"
    );
    assert_eq!(
        sha256_file(&r.join("crates/prismpm/src/embedded/hologram-oracle.browser.mjs")),
        "4bcc8d41e26fac39d662a10d57495db9009f859e8940ca1a34957d9c60101d81",
        "hologram-oracle browser.mjs checksum changed"
    );

    // 3. Pinned Holo Codec oracle manifests
    assert_eq!(
        sha256_file(&r.join("tests/holo-codec-oracle/Cargo.toml")),
        "5be0cb25a1bc7ebff4a709c6dd4c724ae787c6d97e4e9b0a9070ca2cafa71f89",
        "holo-codec-oracle Cargo.toml checksum changed"
    );
    assert_eq!(
        sha256_file(&r.join("tests/holo-codec-oracle/Cargo.lock")),
        "8ab0b99efa9ab6f44d9368d026aefadcefae4640cc92c814947609b41aaf0df4",
        "holo-codec-oracle Cargo.lock checksum changed"
    );

    // 4. Frozen Holo wire corpus upstream revision
    let wire_corpus: Value =
        serde_json::from_slice(&std::fs::read(r.join("tests/data/holo-codec-v1.json")).unwrap())
            .unwrap();
    assert_eq!(
        wire_corpus["oracle"]["revision"], "2bda6a9a9476872dade705bd61ece4209607f6da",
        "Holo wire corpus upstream oracle revision changed"
    );
}

static HOLOGRAM_ORACLE_SERIAL_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());

struct VerifiedSubject {
    artifacts: PathBuf,
    binding: Value,
    _guards: [CleanupGuard; 2],
}

fn subject_binding(artifacts: &Path, verified: &Path, name: &str, cargo_name: &str) -> Value {
    json!({
        "verification_manifest": verified.join("manifest.json"),
        "verification_sha256": sha256_file(&verified.join("manifest.json")),
        "model_sha256": sha256_file(&artifacts.join("model.prism.json")),
        "archive_sha256": sha256_file(&artifacts.join(format!("{name}.holo"))),
        "wasm_sha256": sha256_file(&artifacts.join("core-wasm").join(format!("{}_core_wasm.wasm", cargo_name.replace('-', "_")))),
    })
}

fn calculator_hologram_oracle_interoperability_acceptance() -> VerifiedSubject {
    let r = root();
    let app_root = r.join("examples/Calculator");
    let _ = std::fs::remove_dir_all(app_root.join(".prism"));
    let _ = std::fs::remove_dir_all(app_root.join(".lexlean/verified"));
    let _guard = CleanupGuard(app_root.join(".prism"));
    let _lexlean_guard = CleanupGuard(app_root.join(".lexlean/verified"));

    let controller = Controller::load(&app_root).expect("load Calculator controller");
    let check = controller
        .check(CheckRequest { config_path: None })
        .expect("check Calculator");
    assert!(!check.model_id.is_empty());

    let build = controller
        .build(BuildRequest { config_path: None })
        .expect("build Calculator");
    assert!(!build.build_id.is_empty());

    let verify = controller
        .verify(VerifyRequest { config_path: None })
        .expect("verify Calculator");
    assert!(!verify.attestation_id.is_empty());

    let verified_dir = app_root
        .join(".prism/verified")
        .join(&verify.attestation_id);
    let manifest_bytes = std::fs::read(verified_dir.join("manifest.json"))
        .expect("read Calculator verification manifest");
    let manifest: Value =
        serde_json::from_slice(&manifest_bytes).expect("parse Calculator verification manifest");

    let processes = manifest["processes"]
        .as_array()
        .expect("manifest processes array");

    let oracle_proc = processes
        .iter()
        .find(|p| p["tool"] == "hologram-oracle")
        .expect("hologram-oracle process record in Calculator manifest");

    assert_eq!(oracle_proc["exit_code"], 0);

    let report: Value = serde_json::from_str(
        oracle_proc["stdout"]
            .as_str()
            .expect("hologram-oracle stdout string")
            .trim(),
    )
    .expect("parse Calculator hologram-oracle report");

    assert_eq!(report["schema"], "prismpm/hologram-oracle/2");
    assert_eq!(report["footer_verified"], true);
    assert_eq!(report["guest_allocation_boundary"], "verified");
    assert_eq!(report["view_attached"], 1);
    assert_eq!(report["view_detached"], 1);
    assert_eq!(report["direct_vectors"], 22);
    assert_eq!(report["resident_vectors"], 22);
    assert_eq!(report["intent_vectors"], 21);

    let browser = &report["portable_browser"];
    assert_eq!(browser["schema"], "prismpm/portable-browser-oracle/1");
    assert_eq!(browser["engine"], "chromium");
    assert_eq!(browser["profile"], "legacy-numeric");
    assert_eq!(browser["status"], "passed");
    assert_eq!(browser["skipped"], 0);
    assert_eq!(browser["retries"], 0);
    assert_eq!(
        browser["vector_indexes"],
        json!([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])
    );

    let cases = browser["cases"].as_array().expect("browser cases array");
    assert_eq!(cases.len(), 8);
    for case in cases {
        assert_eq!(case["status"], "passed");
        assert_eq!(case["attempts"], 1);
    }

    let model_doc: ModelDocument = serde_json::from_slice(
        &std::fs::read(
            app_root
                .join(".prism/build")
                .join(&build.build_id)
                .join("model.prism.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let app = model_doc.application.as_ref().unwrap();

    let identities: Value = serde_json::from_slice(
        &std::fs::read(
            app_root
                .join(".prism/build")
                .join(&build.build_id)
                .join("application/holo-identities.json"),
        )
        .unwrap(),
    )
    .unwrap();

    // Verify report passes the owning validator
    validate_hologram_oracle_report(&report, app, &identities)
        .expect("Calculator report must validate cleanly");
    VerifiedSubject {
        binding: subject_binding(
            &app_root.join(".prism/build").join(&build.build_id),
            &verified_dir,
            "Calculator",
            "prism-calculator",
        ),
        artifacts: app_root.join(".prism/build").join(&build.build_id),
        _guards: [_guard, _lexlean_guard],
    }
}

fn text_application_hologram_oracle_interoperability_acceptance() -> VerifiedSubject {
    let r = root();
    let app_root = r.join("tests/fixtures/holo/ho-11-text-application/project");
    let _ = std::fs::remove_dir_all(app_root.join(".prism"));
    let _ = std::fs::remove_dir_all(app_root.join(".lexlean/verified"));
    let _guard = CleanupGuard(app_root.join(".prism"));
    let _lexlean_guard = CleanupGuard(app_root.join(".lexlean/verified"));

    let controller = Controller::load(&app_root).expect("load Text controller");
    let check = controller
        .check(CheckRequest { config_path: None })
        .expect("check Text");
    assert!(!check.model_id.is_empty());

    let build = controller
        .build(BuildRequest { config_path: None })
        .expect("build Text");
    assert!(!build.build_id.is_empty());

    let verify = controller
        .verify(VerifyRequest { config_path: None })
        .expect("verify Text");
    assert!(!verify.attestation_id.is_empty());

    let verified_dir = app_root
        .join(".prism/verified")
        .join(&verify.attestation_id);
    let manifest_bytes =
        std::fs::read(verified_dir.join("manifest.json")).expect("read Text verification manifest");
    let manifest: Value =
        serde_json::from_slice(&manifest_bytes).expect("parse Text verification manifest");

    let processes = manifest["processes"]
        .as_array()
        .expect("manifest processes array");

    let oracle_proc = processes
        .iter()
        .find(|p| p["tool"] == "hologram-oracle")
        .expect("hologram-oracle process record in Text manifest");

    assert_eq!(oracle_proc["exit_code"], 0);

    let report: Value = serde_json::from_str(
        oracle_proc["stdout"]
            .as_str()
            .expect("hologram-oracle stdout string")
            .trim(),
    )
    .expect("parse Text hologram-oracle report");

    assert_eq!(report["schema"], "prismpm/hologram-oracle/2");
    assert_eq!(report["footer_verified"], true);
    assert_eq!(report["guest_allocation_boundary"], "verified");
    assert_eq!(report["view_attached"], 1);
    assert_eq!(report["view_detached"], 1);
    assert_eq!(report["direct_vectors"], 6);
    assert_eq!(report["resident_vectors"], 6);
    assert_eq!(report["intent_vectors"], 5);

    let browser = &report["portable_browser"];
    assert_eq!(browser["schema"], "prismpm/portable-browser-oracle/1");
    assert_eq!(browser["engine"], "chromium");
    assert_eq!(browser["profile"], "utf8-text");
    assert_eq!(browser["status"], "passed");
    assert_eq!(browser["skipped"], 0);
    assert_eq!(browser["retries"], 0);
    assert_eq!(browser["vector_indexes"], json!([0, 2, 3]));

    let cases = browser["cases"].as_array().expect("browser cases array");
    assert_eq!(cases.len(), 10);
    for case in cases {
        assert_eq!(case["status"], "passed");
        assert_eq!(case["attempts"], 1);
    }

    let model_doc: ModelDocument = serde_json::from_slice(
        &std::fs::read(
            app_root
                .join(".prism/build")
                .join(&build.build_id)
                .join("model.prism.json"),
        )
        .unwrap(),
    )
    .unwrap();
    let app = model_doc.application.as_ref().unwrap();

    let identities: Value = serde_json::from_slice(
        &std::fs::read(
            app_root
                .join(".prism/build")
                .join(&build.build_id)
                .join("application/holo-identities.json"),
        )
        .unwrap(),
    )
    .unwrap();

    // Verify report passes the owning validator
    validate_hologram_oracle_report(&report, app, &identities)
        .expect("Text report must validate cleanly");
    VerifiedSubject {
        binding: subject_binding(
            &app_root.join(".prism/build").join(&build.build_id),
            &verified_dir,
            "Text Request",
            "prism-text-request",
        ),
        artifacts: app_root.join(".prism/build").join(&build.build_id),
        _guards: [_guard, _lexlean_guard],
    }
}

#[test]
fn test_portable_view_profiles_and_owned_failure_matrix() {
    let _serial_guard = HOLOGRAM_ORACLE_SERIAL_MUTEX.lock().unwrap();
    // Preserve both complete acceptance bodies and keep their exact artifacts
    // alive until the single fresh matrix compiler owner has finished.
    let calculator = calculator_hologram_oracle_interoperability_acceptance();
    let text = text_application_hologram_oracle_interoperability_acceptance();
    let status = std::process::Command::new("timeout")
        .args(["--signal=TERM", "--kill-after=15s", "1800s", "node"])
        .arg(root().join("scripts/portable-oracle-matrix.mjs"))
        .arg(&calculator.artifacts)
        .arg(&text.artifacts)
        .arg(calculator.binding.to_string())
        .arg(text.binding.to_string())
        .current_dir(root())
        .status()
        .expect("start bounded source-owned portable View matrix");
    assert!(
        status.success(),
        "complete portable View matrix failed: {status}"
    );
}

#[test]
fn test_hologram_oracle_negative_probes_reject_wrong_subject_edition_and_mutations() {
    let r = root();
    let doc_value: Value = serde_json::from_slice(
        &std::fs::read(r.join("tests/data/text-model-document.json")).unwrap(),
    )
    .unwrap();
    let doc: ModelDocument = serde_json::from_value(doc_value).unwrap();
    let app = doc.application.as_ref().unwrap();

    let app_kappa = format!("blake3:{}", "a".repeat(64));
    let arch_fingerprint = "b".repeat(64);
    let arch_kappa = format!("blake3:{}", "c".repeat(64));

    let identities = json!({
        "application_kappa": app_kappa,
        "archive_fingerprint": arch_fingerprint,
        "archive_kappa": arch_kappa,
    });

    let cases = [
        "attachment-assets",
        "modeled-vectors",
        "input-validation-recovery",
        "transport-failure-recovery",
        "pre-init-privacy",
        "delayed-init",
        "intent-boundaries",
        "text-response-bounds",
        "text-safe-rendering",
        "detached-session",
    ]
    .into_iter()
    .map(|name| json!({"name": name, "status": "passed", "attempts": 1}))
    .collect::<Vec<_>>();

    let valid_report = json!({
        "application_kappa": app_kappa,
        "archive_fingerprint": arch_fingerprint,
        "archive_kappa": arch_kappa,
        "direct_vectors": 6,
        "footer_verified": true,
        "guest_allocation_boundary": "verified",
        "intent_vectors": 5,
        "portable_browser": {
            "browser_version": "157.0.8099.0",
            "cases": cases,
            "engine": "chromium",
            "playwright": "1.62.1",
            "profile": "utf8-text",
            "retries": 0,
            "schema": "prismpm/portable-browser-oracle/1",
            "skipped": 0,
            "status": "passed",
            "vector_indexes": [0, 2, 3],
        },
        "resident_vectors": 6,
        "schema": "prismpm/hologram-oracle/2",
        "view_attached": 1,
        "view_detached": 1,
    });

    // Baseline validation succeeds
    validate_hologram_oracle_report(&valid_report, app, &identities)
        .expect("baseline valid report must pass");

    let reject = |bad: &Value| {
        let err = validate_hologram_oracle_report(bad, app, &identities)
            .expect_err("tampered report must be rejected");
        assert_eq!(err.code, "PP5301");
    };

    // 1. Wrong edition: report /1 or unknown schema
    let mut bad_edition = valid_report.clone();
    bad_edition["schema"] = json!("prismpm/hologram-oracle/1");
    reject(&bad_edition);

    let mut bad_edition_unknown = valid_report.clone();
    bad_edition_unknown["schema"] = json!("prismpm/hologram-oracle/3");
    reject(&bad_edition_unknown);

    // 2. Wrong subject / substituted identities
    for field in ["application_kappa", "archive_fingerprint", "archive_kappa"] {
        let wrong_val = if field == "archive_fingerprint" {
            "f".repeat(64)
        } else {
            format!("blake3:{}", "f".repeat(64))
        };
        let mut bad_id = valid_report.clone();
        bad_id[field] = json!(wrong_val);
        reject(&bad_id);
    }

    // 3. Unverified footer and boundary
    let mut unverified_footer = valid_report.clone();
    unverified_footer["footer_verified"] = json!(false);
    reject(&unverified_footer);

    let mut unverified_boundary = valid_report.clone();
    unverified_boundary["guest_allocation_boundary"] = json!("unverified");
    reject(&unverified_boundary);

    // 4. Mismatched vector counts
    let mut bad_direct = valid_report.clone();
    bad_direct["direct_vectors"] = json!(5);
    reject(&bad_direct);

    let mut bad_resident = valid_report.clone();
    bad_resident["resident_vectors"] = json!(7);
    reject(&bad_resident);

    let mut bad_intent = valid_report.clone();
    bad_intent["intent_vectors"] = json!(4);
    reject(&bad_intent);

    // 5. Attached / detached count != 1
    let mut bad_attach = valid_report.clone();
    bad_attach["view_attached"] = json!(0);
    reject(&bad_attach);

    let mut bad_detach = valid_report.clone();
    bad_detach["view_detached"] = json!(2);
    reject(&bad_detach);

    // 6. Failed, retried, or skipped browser case
    let mut failed_case = valid_report.clone();
    failed_case["portable_browser"]["cases"][0]["status"] = json!("failed");
    reject(&failed_case);

    let mut retried_browser = valid_report.clone();
    retried_browser["portable_browser"]["retries"] = json!(1);
    reject(&retried_browser);

    let mut skipped_browser = valid_report.clone();
    skipped_browser["portable_browser"]["skipped"] = json!(1);
    reject(&skipped_browser);

    // 7. Wrong browser profile or engine
    let mut bad_profile = valid_report.clone();
    bad_profile["portable_browser"]["profile"] = json!("legacy-numeric");
    reject(&bad_profile);

    let mut bad_engine = valid_report.clone();
    bad_engine["portable_browser"]["engine"] = json!("firefox");
    reject(&bad_engine);

    // 8. Missing required keys
    for key in [
        "schema",
        "application_kappa",
        "archive_fingerprint",
        "archive_kappa",
        "direct_vectors",
        "footer_verified",
        "guest_allocation_boundary",
        "intent_vectors",
        "portable_browser",
        "resident_vectors",
        "view_attached",
        "view_detached",
    ] {
        let mut missing_key = valid_report.clone();
        missing_key.as_object_mut().unwrap().remove(key);
        reject(&missing_key);
    }

    // 9. Extra unknown key in report
    let mut extra_key = valid_report.clone();
    extra_key["unexpected"] = json!(true);
    reject(&extra_key);

    // 10. Transport limits: request > 64KiB or response > 1MiB
    for (req_max, resp_max) in [
        (65_537, app.response_maximum()),
        (app.request_maximum(), 1_048_577),
    ] {
        let mut bad_app = app.clone();
        if let prismpm::holo::model_document::Application::Text(ref mut text) = bad_app {
            text.request_maximum = req_max;
            text.response_maximum = resp_max;
        }
        let err = validate_hologram_oracle_report(&valid_report, &bad_app, &identities)
            .expect_err("over-limit application bounds must be rejected");
        assert_eq!(err.code, "PP5301");
    }
}
