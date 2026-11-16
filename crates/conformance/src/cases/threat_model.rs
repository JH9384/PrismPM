//! FT-14, FT-15 and AU-08: threat models, their check and their OSCAL output.

use std::path::Path;
use std::process::Command;

const DECLARATIONS: [&str; 15] = [
    "Stride",
    "EvidenceKind",
    "Evidence",
    "ControlSet",
    "ModeledAsset",
    "ModeledThreat",
    "ModeledControl",
    "ThreatMapping",
    "AcceptedRisk",
    "NormalizedThreatModel",
    "validateNormalizedThreatModel",
    "normalizedThreatModel_sound_complete",
    "unmappedThreatRefused",
    "controlWithoutEvidenceRefused",
    "threatWithoutCategoryRefused",
];

/// The worked example: prism-code's threat model (browser-only, no storage, no
/// network).
const EXAMPLE: &str = "tests/fixtures/threat-model/tm-01-prism-code";

/// The document `prismpm build` emits for the worked example.
const EMITTED: &str =
    "tests/fixtures/threat-model/tm-01-prism-code/expected/artifacts/rendered/oscal/component-definition.json";

/// The documents the owning unit suite emits from synthetic models.
const COMPLETE: &str = "tests/fixtures/threat-model/oscal-subjects/complete.json";
const ACCEPTED_ONLY: &str = "tests/fixtures/threat-model/oscal-subjects/accepted-risks-only.json";

/// FT-14: the stdlib declares every row type, the validator and its theorems.
pub(super) fn verify_declarations(root: &Path) {
    super::assert_declarations(root, "Production.ThreatModel", &DECLARATIONS);
}

/// Run the owning unit suite and require each named test to have passed.
fn owning_tests(root: &Path, id: &str, names: &[&str]) {
    let output = Command::new("cargo")
        .current_dir(root)
        .args([
            "test",
            "--locked",
            "--offline",
            "-p",
            "prismpm",
            "--lib",
            "threat_model::",
        ])
        .args(["--", "--nocapture", "--test-threads=1"])
        // The outer conformance Cargo owner may retain its target lock; use a
        // disjoint target for the owning suites.
        .env(
            "CARGO_TARGET_DIR",
            root.join("target/conformance-threat-model"),
        )
        .output()
        .unwrap_or_else(|error| panic!("{id} executes its owning suite: {error}"));
    let stdout = String::from_utf8(output.stdout).expect("UTF-8 owning stdout");
    let stderr = String::from_utf8(output.stderr).expect("UTF-8 owning stderr");
    assert!(output.status.success(), "{id}: {stdout}\n{stderr}");
    for name in names {
        assert!(
            stdout
                .lines()
                .any(|line| line.ends_with(&format!("threat_model::tests::{name} ... ok"))),
            "{id} requires passing {name}"
        );
    }
}

/// FT-15: the owning suite passes, including the agreement of the check with the
/// normalized validator, and each negative fixture matches its declared outcome.
pub(super) fn verify_check(root: &Path) {
    owning_tests(
        root,
        "FT-15",
        &[
            "a_complete_model_is_accepted",
            "an_unmapped_threat_is_refused_with_pp2019",
            "a_control_without_evidence_is_refused_with_pp2020",
            "a_threat_without_a_category_is_refused_with_pp2021",
            "malformed_and_unresolved_rows_are_refused_with_pp2022",
            "the_normalized_validator_agrees_with_the_proved_vectors",
            "the_check_and_the_normalized_validator_agree_on_every_small_model",
        ],
    );
    for fixture in [
        "tests/negative/threat-model/unmapped-threat",
        "tests/negative/threat-model/control-without-evidence",
    ] {
        crate::fixtures::check(&root.join(fixture))
            .expect("the threat model fixture matches its declared outcome");
    }
}

/// Run the locked validator, built from its own manifest, over one subject.
fn oracle(root: &Path, subject: &Path) -> std::process::Output {
    Command::new("cargo")
        .current_dir(root)
        .args([
            "run",
            "--quiet",
            "--locked",
            "--offline",
            "--manifest-path",
            "sdk/oracles/oscal/Cargo.toml",
            "--",
        ])
        .arg(subject)
        .env("CARGO_TARGET_DIR", root.join("target/conformance-oscal"))
        .output()
        .expect("AU-08 executes the locked OSCAL validator")
}

/// AU-08: `build` reproduces the committed document, the locked validator
/// accepts it, and the validator refuses a planted defect.
pub(super) fn verify_emission(root: &Path) {
    owning_tests(
        root,
        "AU-08",
        &[
            "the_emitted_documents_match_their_oracle_subjects",
            "the_document_states_the_mapping_the_evidence_and_the_accepted_risks",
            "the_document_is_reproducible_and_its_identity_follows_its_content",
        ],
    );
    crate::fixtures::check(&root.join(EXAMPLE))
        .expect("the worked example builds the committed component definition");
    for subject in [EMITTED, COMPLETE, ACCEPTED_ONLY] {
        let accepted = oracle(root, &root.join(subject));
        assert!(
            accepted.status.success(),
            "AU-08 {subject}: {}",
            String::from_utf8_lossy(&accepted.stderr)
        );
        let report: serde_json::Value =
            serde_json::from_slice(&accepted.stdout).expect("oracle report");
        assert_eq!(report["edition"], "1.1.0");
        assert_eq!(report["valid"], true);
    }

    let scratch = tempfile::tempdir().expect("scratch");
    let planted = scratch.path().join("planted.json");
    let mut document: serde_json::Value =
        serde_json::from_str(&super::read(root, EMITTED)).expect("emitted document");
    document["component-definition"]["metadata"]["oscal-version"] = "1.1.1".into();
    std::fs::write(&planted, document.to_string()).expect("planted subject");
    let refused = oracle(root, &planted);
    assert_eq!(refused.status.code(), Some(4), "AU-08 planted edition");
}
