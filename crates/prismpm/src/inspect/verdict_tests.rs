//! The Rust half of issue #270, held against the JavaScript half: the verdicts
//! `prism-code check --json` prints for the reference archive, the spec's
//! verdict fixtures, and the signed archive of #267.

use super::{
    check_path, read_policy, title_of, verify, Level, NoVerdict, Policy, Verdict, LIMITS,
    VERDICT_SCHEMA,
};
use crate::holo::archive::{attach_attestations, parse_application};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

/// The reference archive, `calculator-example` `artifacts/Calculator.holo`, unsigned.
const CALCULATOR: &[u8] = include_bytes!("../../../../sdk/npm/prism-code/fixtures/Calculator.holo");
const PAYMENT_APPROVAL: &[u8] =
    include_bytes!("../../../../sdk/npm/prism-code/fixtures/PaymentApproval.holo");
/// `appendAttestations(CALCULATOR, two placeholder bundles)` as written by `sdk/npm/prism-code`.
const SIGNED_BY_JAVASCRIPT: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/attestation/Calculator.signed.holo"
);
const FOOTER: &str = "8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba";
const GUEST_LABEL: &str = "blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380";
const GUEST_SHA256: &str = "dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03";
const STATEMENTS: [&str; 3] = [
    "provenance.statement",
    "proof.statement",
    "replay.statement",
];

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

fn fixture(relative: &str) -> Value {
    let bytes =
        std::fs::read(root().join(relative)).unwrap_or_else(|error| panic!("{relative}: {error}"));
    serde_json::from_slice(&bytes).expect("fixture is JSON")
}

fn checks(verdict: &Verdict) -> Vec<&str> {
    verdict
        .reasons
        .iter()
        .map(|reason| reason.check.as_str())
        .collect()
}

fn p0() -> Policy {
    Policy {
        minimum: Some(Level::P0),
        ..Policy::default()
    }
}

/// The reference archive with one byte of the guest blob flipped, as the
/// JavaScript tests tamper it: the content byte 100 after the label.
fn tampered() -> Vec<u8> {
    let mut bytes = CALCULATOR.to_vec();
    let at = guest_content_offset(&bytes) + 100;
    bytes[at] ^= 0xff;
    bytes
}

/// The file offset of the guest blob's content: its row offset in the body plus the label.
fn guest_content_offset(bytes: &[u8]) -> usize {
    let table_at = 10;
    for row in 0..9 {
        let at = table_at + row * 24;
        let offset = u64::from_le_bytes(bytes[at + 8..at + 16].try_into().unwrap()) as usize;
        if bytes.get(offset..offset + 71) == Some(GUEST_LABEL.as_bytes()) {
            return offset + 71;
        }
    }
    panic!("the guest blob is not in the table");
}

fn reseal(bytes: &mut [u8]) {
    let footer = bytes.len() - 32;
    let digest = blake3::hash(&bytes[..footer]);
    bytes[footer..].copy_from_slice(digest.as_bytes());
}

fn validator() -> jsonschema::Validator {
    let schema = fixture("sdk/npm/spec/schemas/verdict/verdict-v1.schema.json");
    jsonschema::validator_for(&schema).expect("the verdict schema compiles")
}

fn assert_valid(verdict: &Verdict) -> Value {
    let value = verdict.value();
    let validator = validator();
    let errors = validator
        .iter_errors(&value)
        .map(|error| error.to_string())
        .collect::<Vec<_>>();
    assert!(errors.is_empty(), "{value}: {errors:?}");
    value
}

/// A verdict without the messages of its reasons: the members 269 makes the contract.
fn without_messages(mut value: Value) -> Value {
    for reason in value["reasons"].as_array_mut().unwrap() {
        reason.as_object_mut().unwrap().remove("message");
    }
    value
}

fn temp_file(name: &str, content: &[u8]) -> (tempfile::TempDir, PathBuf) {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join(name);
    std::fs::write(&path, content).unwrap();
    (dir, path)
}

fn bundle(statement: &Value) -> Vec<u8> {
    serde_json::to_vec(&json!({
        "mediaType": "application/vnd.dev.sigstore.bundle.v0.3+json",
        "verificationMaterial": {"publicKey": {"hint": "placeholder"}, "tlogEntries": []},
        "dsseEnvelope": {
            "payload": STANDARD.encode(serde_json::to_vec(statement).unwrap()),
            "payloadType": "application/vnd.in-toto+json",
            "signatures": [{"keyid": "", "sig": STANDARD.encode(b"not a real signature")}],
        }
    }))
    .unwrap()
}

fn guest_subject() -> Value {
    let blobs = parse_application(CALCULATOR).unwrap().blobs;
    let content = &blobs[GUEST_LABEL];
    json!({
        "name": "core-wasm/prism_calculator_core_wasm.wasm",
        "digest": {
            "blake3": GUEST_LABEL.strip_prefix("blake3:").unwrap(),
            "sha256": format!("{:x}", Sha256::digest(content)),
        }
    })
}

/// A proof statement whose every check this CLI can run passes for the
/// reference archive. `verified_levels` is the signer's claim.
fn proof_statement(verified_levels: Value) -> Value {
    let parsed = parse_application(CALCULATOR).unwrap();
    let provenance: Value = serde_json::from_slice(&parsed.prism_extension).unwrap();
    let model_label = provenance["model_content_kappa"].as_str().unwrap();
    let model = &parsed.blobs[model_label];
    let digest = |member: &str| provenance[member].as_str().unwrap().to_owned();
    let tcb = [
        "lean4-kernel",
        "leanchecker",
        "lexlean",
        "lean4-prod",
        "rustc",
        "wasm-bindgen-cli",
        "sdk-image",
    ]
    .iter()
    .map(|component| json!({"component": component, "role": "named", "version": "1", "trust": "trusted"}))
    .collect::<Vec<_>>();
    json!({
        "_type": "https://in-toto.io/Statement/v1",
        "subject": [guest_subject()],
        "predicateType": "https://uor.foundation/prism/proof/v1",
        "predicate": {
            "verifier": {
                "id": "https://uor.foundation/prism/verifier/lean4",
                "lean": {"version": "4.32.1", "commit": "0".repeat(40)},
                "lexlean": {"version": "0.4.0", "commit": "0".repeat(40), "crateSha256": "0".repeat(64)},
                "prismpm": {"version": "0.4.0"},
                "sdkImage": format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{}", "0".repeat(64)),
            },
            "policy": {"uri": "https://uor.foundation/prism/axioms/v1", "digest": {"sha256": "0".repeat(64)}},
            "model": {
                "document": {"sha256": format!("{:x}", Sha256::digest(model)), "blake3": model_label.strip_prefix("blake3:").unwrap()},
                "sourceId": digest("source_id"),
                "semanticId": digest("semantic_id"),
                "snapshotId": digest("snapshot_id"),
                "compilerSemanticsId": digest("compiler_semantics_id"),
                "leanManifestSha256": digest("lean_manifest_sha256"),
                "modules": [{"name": "Calculator", "leanSha256": "0".repeat(64)}],
            },
            "theorems": [{"name": "Calculator.total", "module": "Calculator", "verdict": "PASSED", "axioms": {"policy": {"kind": "none", "axioms": []}, "observed": []}}],
            "verificationResult": "PASSED",
            "verifiedLevels": verified_levels,
            "tcb": tcb,
            "evidence": {"lexleanAttestation": {"sha256": "0".repeat(64)}, "verificationManifest": {"sha256": "0".repeat(64)}},
            "timeVerified": "2026-10-30T00:00:00Z",
        }
    })
}

fn with_proof(verified_levels: Value) -> Vec<u8> {
    attach_attestations(CALCULATOR, &[bundle(&proof_statement(verified_levels))]).unwrap()
}

#[test]
fn the_reference_archive_is_p0_and_fails_the_default_policy() {
    let verdict = verify(CALCULATOR, &Policy::default()).unwrap();
    let value = assert_valid(&verdict);
    assert_eq!(value["schema"], VERDICT_SCHEMA);
    assert_eq!(verdict.holo, format!("blake3:{FOOTER}"));
    assert_eq!(verdict.level, Level::P0);
    assert!(!verdict.passed);
    assert_eq!(verdict.exit_code(), 1);
    assert_eq!(verdict.policy_name, "default");
    assert_eq!(verdict.minimum, Level::P2);
    assert_eq!(
        checks(&verdict),
        [&STATEMENTS[..], &["policy.level"]].concat()
    );
    assert_eq!(
        verdict
            .reasons
            .iter()
            .map(|reason| reason.withholds)
            .collect::<Vec<_>>(),
        [Some(Level::P1), Some(Level::P2), Some(Level::P3), None]
    );
    assert_eq!(verdict.reasons[3].code, Some("PP5601"));
    assert_eq!(
        verdict.reasons[3].message,
        "The level is P0; the policy requires P2 or above."
    );
    assert!(!checks(&verdict)
        .iter()
        .any(|check| check.starts_with("holo.")));
}

#[test]
fn a_p0_policy_passes_and_keeps_the_reasons_for_the_missing_levels() {
    let verdict = verify(CALCULATOR, &p0()).unwrap();
    assert_valid(&verdict);
    assert!(verdict.passed);
    assert_eq!(verdict.exit_code(), 0);
    assert_eq!(verdict.level, Level::P0);
    assert_eq!(checks(&verdict), STATEMENTS);
}

#[test]
fn the_json_form_is_the_spec_fixture_for_a_provenance_only_policy() {
    let policy = Policy {
        name: Some("provenance-only".to_owned()),
        minimum: Some(Level::P1),
        ..Policy::default()
    };
    let verdict = verify(CALCULATOR, &policy).unwrap();
    let expected = fixture(
        "sdk/npm/spec/test/fixtures/verdict/verdict-v1/unsigned-p0-provenance-only-policy.json",
    );
    assert_eq!(assert_valid(&verdict), expected);
}

#[test]
fn a_tampered_guest_blob_fails_holo_integrity_twice_and_drops_to_p0() {
    let bytes = tampered();
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_valid(&verdict);
    assert_eq!(verdict.level, Level::P0);
    assert!(!verdict.passed);
    assert_ne!(verdict.holo, format!("blake3:{FOOTER}"));
    assert_eq!(
        checks(&verdict),
        [
            &["holo.integrity", "holo.integrity"][..],
            &STATEMENTS[..],
            &["policy.level"]
        ]
        .concat()
    );
    assert!(verdict.reasons[0].message.starts_with(&format!(
        "The footer {FOOTER} does not equal the BLAKE3 of the body, "
    )));
    assert!(verdict.reasons[0]
        .message
        .ends_with(": the archive was altered."));
    assert!(verdict.reasons[1].message.starts_with(&format!(
        "Section 4 is labelled {GUEST_LABEL} but its content hashes to blake3:"
    )));
    assert_eq!(verdict.reasons[0].withholds, Some(Level::P1));
    // P0 asks only that check could read the file, so a policy of P0 accepts even a damaged holo.
    assert!(verify(&bytes, &p0()).unwrap().passed);
}

#[test]
fn a_resealed_footer_does_not_hide_a_changed_blob() {
    let mut bytes = tampered();
    reseal(&mut bytes);
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_eq!(
        checks(&verdict),
        [&["holo.integrity"][..], &STATEMENTS[..], &["policy.level"]].concat()
    );
    assert!(verdict.reasons[0]
        .message
        .starts_with("Section 4 is labelled"));
}

#[test]
fn a_flipped_document_byte_fails_the_footer_even_when_every_label_matches() {
    let mut bytes = CALCULATOR.to_vec();
    let metadata_offset =
        u64::from_le_bytes(bytes[10 + 24 + 8..10 + 24 + 16].try_into().unwrap()) as usize;
    bytes[metadata_offset + 20] ^= 0x01;
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_eq!(verdict.reasons[0].check, "holo.integrity");
    assert!(verdict.reasons[0].message.starts_with("The footer "));
    assert!(!verdict
        .reasons
        .iter()
        .any(|reason| reason.message.starts_with("Section ")));
}

#[test]
fn pinned_digests_pass_and_one_wrong_digest_fails_the_policy_not_the_level() {
    let mut right = p0();
    right.digests.insert(
        "archive".to_owned(),
        [
            (
                "sha256".to_owned(),
                format!("{:x}", Sha256::digest(CALCULATOR)),
            ),
            (
                "blake3".to_owned(),
                blake3::hash(CALCULATOR).to_hex().to_string(),
            ),
        ]
        .into_iter()
        .collect(),
    );
    right.digests.insert(
        "guest".to_owned(),
        [("sha256".to_owned(), GUEST_SHA256.to_owned())]
            .into_iter()
            .collect(),
    );
    assert!(verify(CALCULATOR, &right).unwrap().passed);

    let mut wrong = p0();
    wrong.digests.insert(
        "guest".to_owned(),
        [("sha256".to_owned(), "0".repeat(64))]
            .into_iter()
            .collect(),
    );
    let verdict = verify(CALCULATOR, &wrong).unwrap();
    assert_valid(&verdict);
    assert!(!verdict.passed);
    assert_eq!(verdict.level, Level::P0);
    let reason = verdict.reasons.last().unwrap();
    assert_eq!(reason.check, "policy.digests.guest");
    assert_eq!(reason.withholds, None);
    assert!(reason.message.contains(&format!(
        "its sha256 is {GUEST_SHA256}, the policy pins 0000"
    )));
}

#[test]
fn a_pinned_world_is_compared_with_the_declared_one() {
    let mut pinned = p0();
    pinned.world = Some(Some(super::WorldPin {
        contract: Some("hologram:guest/core-wasm@1".to_owned()),
        blake3: Some(super::CORE_WASM_WORLD_BLAKE3.to_owned()),
        sha256: Some(super::CORE_WASM_WORLD_SHA256.to_owned()),
    }));
    assert!(verify(CALCULATOR, &pinned).unwrap().passed);
    let mut none = p0();
    none.world = Some(None);
    let verdict = verify(CALCULATOR, &none).unwrap();
    assert!(!verdict.passed);
    assert_eq!(verdict.reasons.last().unwrap().check, "world.hash");
    assert_eq!(title_of("world.hash"), "WorldMismatch");
    let mut pure = p0();
    pure.effects = Some(Vec::new());
    assert!(
        verify(CALCULATOR, &pure).unwrap().passed,
        "core-wasm imports nothing"
    );
}

#[test]
fn a_policy_file_is_named_by_its_path_unless_it_names_itself() {
    let (_dir, path) = temp_file("p0.json", br#"{"minimum":"P0"}"#);
    let policy = read_policy(&path).unwrap();
    assert_eq!(
        policy.name.as_deref(),
        Some(path.display().to_string().as_str())
    );
    let verdict = check_path(
        Path::new(&root().join("sdk/npm/prism-code/fixtures/Calculator.holo")),
        Some(&path),
        None,
    )
    .unwrap();
    assert!(verdict.passed);
    assert_eq!(verdict.policy_name, path.display().to_string());
    let (_dir, named) = temp_file("named.json", br#"{"name":"pure","minimum":"P0"}"#);
    assert_eq!(read_policy(&named).unwrap().name.as_deref(), Some("pure"));
}

#[test]
fn the_environment_sets_the_minimum_only_when_the_policy_does_not() {
    assert!(
        verify(
            CALCULATOR,
            &Policy::default().with_environment(Some("P0")).unwrap()
        )
        .unwrap()
        .passed
    );
    let strict = Policy {
        minimum: Some(Level::P2),
        ..Policy::default()
    };
    assert!(
        !verify(CALCULATOR, &strict.with_environment(Some("P0")).unwrap())
            .unwrap()
            .passed
    );
    assert_eq!(
        Policy::default()
            .with_environment(Some(""))
            .unwrap()
            .minimum,
        None
    );
    let error = Policy::default().with_environment(Some("L2")).unwrap_err();
    assert_eq!(error.check, "policy.invalid");
    assert!(error
        .message
        .starts_with("PRISM_MINIMUM_LEVEL is \"L2\"; expected one of P0, P1, P2, P3"));
}

#[test]
fn no_verdict_names_what_stopped_it() {
    let dir = tempfile::tempdir().unwrap();
    let file = |name: &str, content: &[u8]| {
        let path = dir.path().join(name);
        std::fs::write(&path, content).unwrap();
        path
    };
    let holo = file("Calculator.holo", CALCULATOR);
    let not_holo = file("bad.holo", &[b"HOLX".as_slice(), &[0u8; 60]].concat());
    let not_json = file("policy.txt", b"minimum: P0");
    let unknown = file("unknown.json", br#"{"minimum":"P0","signer":"me"}"#);
    let bad_level = file("p4.json", br#"{"minimum":"P4"}"#);
    let folder = dir.path().join("closure.holo");
    std::fs::create_dir(&folder).unwrap();
    let cases: [(&Path, Option<&Path>, &str, &str); 7] = [
        (
            &dir.path().join("missing.holo"),
            None,
            "load.path",
            "does not exist",
        ),
        (
            &not_holo,
            None,
            "archive.magic",
            "expected magic HOLO, found \"HOLX\"",
        ),
        (
            &holo,
            Some(&dir.path().join("missing.json")),
            "policy.unreadable",
            "cannot be read",
        ),
        (&holo, Some(&not_json), "policy.invalid", "is not JSON"),
        (
            &holo,
            Some(&unknown),
            "policy.invalid",
            "unknown members signer; expected name, minimum, digests, world, effects",
        ),
        (
            &holo,
            Some(&bad_level),
            "policy.invalid",
            "policy.minimum \"P4\" is not one of P0, P1, P2, P3",
        ),
        (&folder, None, "verify.kind", "is a directory"),
    ];
    for (path, policy, check, needle) in cases {
        let error = check_path(path, policy, None).unwrap_err();
        assert_eq!(error.check, check, "{}", path.display());
        assert!(error.message.contains(needle), "{error}");
        let diagnostic = error.diagnostic();
        assert_eq!(diagnostic.code, "PP5603");
        assert_eq!(diagnostic.exit_code(), 2);
        assert!(diagnostic
            .message
            .starts_with(&format!("no verdict: {check}: ")));
    }
    assert_eq!(
        verify(b"HOL", &Policy::default()).unwrap_err().check,
        "archive.magic"
    );
    let mut version = CALCULATOR.to_vec();
    version[4] = 5;
    assert_eq!(
        verify(&version, &Policy::default()).unwrap_err().check,
        "archive.version"
    );
    let mut truncated = CALCULATOR.to_vec();
    truncated.truncate(CALCULATOR.len() - 1);
    assert_eq!(
        verify(&truncated, &Policy::default()).unwrap_err().check,
        "archive.table"
    );
}

#[test]
fn an_intact_holo_of_an_unknown_layout_has_no_verdict() {
    // Rename the model extension, keeping its length, and reseal: a newer writer. The
    // modeled wire reader owns the layout, so it refuses the table before this reader
    // can name the revision: no verdict either way, as archive.table.
    let mut bytes = CALCULATOR.to_vec();
    let row = 10 + 3 * 24;
    let offset = u64::from_le_bytes(bytes[row + 8..row + 16].try_into().unwrap()) as usize;
    let name = b"https://uor.foundation/extension/prismpm-model/v9";
    bytes[offset + 2..offset + 2 + name.len()].copy_from_slice(name);
    reseal(&mut bytes);
    let error = verify(&bytes, &Policy::default()).unwrap_err();
    assert_eq!(error.check, "archive.table");
    assert!(error.message.contains("wire model admits"), "{error}");
}

#[test]
fn the_text_form_names_the_human_title_of_each_reason_and_the_limits_from_p2_up() {
    let fixture_p1 =
        fixture("sdk/npm/spec/test/fixtures/verdict/verdict-v1/calculator-p1-tampered-guest.json");
    let verdict = Verdict {
        holo: fixture_p1["holo"].as_str().unwrap().to_owned(),
        level: Level::P1,
        policy_name: "default".to_owned(),
        minimum: Level::P2,
        passed: false,
        reasons: vec![
            super::Reason {
                check: "proof.subject".to_owned(),
                code: Some("PP5503"),
                withholds: Some(Level::P2),
                message: "The proof statement names a guest blob this holo does not contain."
                    .to_owned(),
            },
            super::Reason {
                check: "policy.level".to_owned(),
                code: Some("PP5601"),
                withholds: None,
                message: "The level is P1; the policy requires P2 or above.".to_owned(),
            },
        ],
    };
    let text = verdict.text(Some("app.holo"));
    assert!(text.starts_with("FAILED  P1 provenance  policy default requires P2 or above\nholo    app.holo\ndigest  blake3:"));
    assert!(text.contains(
        "\n  proof.subject (PP5503, ProofMismatch, withholds P2)\n    The proof statement names"
    ));
    assert!(text.contains("\n  policy.level (PP5601, Verification, policy rule)\n"));
    assert!(!text.contains("cannot know"));
    assert_eq!(title_of("proof.subject"), "ProofMismatch");
    assert_eq!(title_of("world.capabilities"), "CapabilityDenied");
    assert_eq!(title_of("replay.divergence"), "DeterminismViolation");
    assert_eq!(title_of("replay.statement"), "Replay");
    let passed = Verdict {
        level: Level::P2,
        passed: true,
        reasons: Vec::new(),
        ..verdict
    };
    let text = passed.text(None);
    assert!(text.starts_with(
        "PASSED  P2 proof checked  policy default requires P2 or above\ndigest  blake3:"
    ));
    let limits = LIMITS
        .iter()
        .map(|limit| format!("  {limit}\n"))
        .collect::<String>();
    assert!(text.ends_with(&format!(
        "This check trusts the signer for what it cannot know:\n{limits}"
    )));
}

// --- The attestation section (#267): a signed archive has a verdict, never exit 2.

#[test]
fn al_03_a_holo_without_provenance_is_p0_even_with_a_proof_statement_that_passes_every_other_check()
{
    let bytes = with_proof(json!(["P2"]));
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_valid(&verdict);
    assert_eq!(verdict.level, Level::P0);
    assert!(!verdict.passed);
    let ids = checks(&verdict);
    assert_eq!(
        ids,
        [
            "provenance.statement",
            "proof.envelope",
            "replay.statement",
            "policy.level"
        ]
    );
    // The proof checks this CLI can run all pass: only the unverified envelope is listed.
    for check in [
        "proof.statement",
        "proof.subject",
        "proof.model",
        "proof.verdict",
        "proof.tcb",
    ] {
        assert!(!ids.contains(&check), "{check}");
    }
    assert_eq!(verdict.reasons[1].code, Some("PP5501"));
    assert_eq!(verdict.reasons[1].withholds, Some(Level::P2));
}

#[test]
fn al_03_the_javascript_signed_fixture_reaches_a_verdict_and_its_bare_proof_statement_fails_its_shape(
) {
    // The fixture carries a bare proof statement and a provenance statement with placeholder
    // signatures: both are present, neither verifies, and the level stays P0.
    let verdict = verify(SIGNED_BY_JAVASCRIPT, &Policy::default()).unwrap();
    assert_valid(&verdict);
    assert_eq!(verdict.level, Level::P0);
    assert_eq!(
        verdict.holo,
        format!(
            "blake3:{}",
            blake3::hash(&SIGNED_BY_JAVASCRIPT[..SIGNED_BY_JAVASCRIPT.len() - 32]).to_hex()
        )
    );
    assert_eq!(
        checks(&verdict),
        [
            "provenance.envelope",
            "proof.envelope",
            "proof.statement",
            "replay.statement",
            "policy.level"
        ]
    );
    assert_eq!(verdict.reasons[2].code, Some("PP5502"));
    assert!(verdict.reasons[2]
        .message
        .starts_with("The proof statement has the wrong shape: "));
    assert!(verify(SIGNED_BY_JAVASCRIPT, &p0()).unwrap().passed);
}

#[test]
fn a_tampered_guest_under_a_proof_statement_fails_with_proof_mismatch() {
    let mut bytes = with_proof(json!(["P2"]));
    let at = guest_content_offset(&bytes) + 100;
    bytes[at] ^= 0xff;
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_valid(&verdict);
    assert_eq!(verdict.level, Level::P0);
    let mismatch = verdict
        .reasons
        .iter()
        .find(|reason| reason.check == "proof.subject")
        .expect("ProofMismatch");
    assert_eq!(mismatch.code, Some("PP5503"));
    assert_eq!(mismatch.withholds, Some(Level::P2));
    assert_eq!(title_of(&mismatch.check), "ProofMismatch");
    assert!(mismatch
        .message
        .contains("which is not this holo's guest (blake3 "));
    assert_eq!(&checks(&verdict)[..2], ["holo.integrity", "holo.integrity"]);
}

#[test]
fn a_proof_about_another_model_or_a_failed_theorem_or_a_short_tcb_is_reported() {
    let mut statement = proof_statement(json!(["P2"]));
    statement["predicate"]["model"]["sourceId"] = json!("0".repeat(64));
    statement["predicate"]["theorems"][0]["verdict"] = json!("FAILED");
    statement["predicate"]["tcb"].as_array_mut().unwrap().pop();
    let bytes = attach_attestations(CALCULATOR, &[bundle(&statement)]).unwrap();
    let verdict = verify(&bytes, &Policy::default()).unwrap();
    assert_valid(&verdict);
    let codes = verdict
        .reasons
        .iter()
        .filter_map(|reason| reason.code)
        .collect::<Vec<_>>();
    assert_eq!(codes, ["PP5501", "PP5504", "PP5506", "PP5507", "PP5601"]);
    assert!(verdict.reasons[2]
        .message
        .contains("model.sourceId is not the extension's source_id"));
    assert!(verdict.reasons[3]
        .message
        .contains("Calculator.total is FAILED"));
    assert!(verdict.reasons[4].message.ends_with("lacks sdk-image."));
}

#[test]
fn al_05_a_verified_levels_claim_never_changes_the_computed_level() {
    let claims_p3 = verify(&with_proof(json!(["P3"])), &Policy::default()).unwrap();
    assert_valid(&claims_p3);
    assert_eq!(claims_p3.level, Level::P0);
    let shape = claims_p3
        .reasons
        .iter()
        .find(|reason| reason.check == "proof.statement")
        .expect("a claim other than P2 is a shape failure");
    assert_eq!(shape.code, Some("PP5502"));
    assert!(shape
        .message
        .contains("predicate.verifiedLevels is [\"P3\"], expected [\"P2\"]"));
    let claims_p2 = verify(&with_proof(json!(["P2"])), &Policy::default()).unwrap();
    assert_eq!(claims_p2.level, claims_p3.level);
    assert_eq!(
        verify(&with_proof(json!(["P2"])), &p0()).unwrap().level,
        Level::P0
    );
}

#[test]
fn al_05_a_claimed_level_is_never_an_input_to_the_policy() {
    for claim in [json!(["P2"]), json!(["P3"]), json!(["P2", "P3"])] {
        let bytes = with_proof(claim);
        for minimum in [Level::P1, Level::P2, Level::P3] {
            let policy = Policy {
                minimum: Some(minimum),
                ..Policy::default()
            };
            let verdict = verify(&bytes, &policy).unwrap();
            assert_eq!(verdict.level, Level::P0);
            assert!(!verdict.passed);
            assert_eq!(verdict.reasons.last().unwrap().check, "policy.level");
        }
    }
}

#[test]
fn al_06_the_rust_verdicts_equal_the_javascript_goldens_in_every_member_but_the_messages() {
    let goldens = "sdk/npm/prism-code/test/fixtures/verdict";
    let p0_named = Policy {
        name: Some("p0".to_owned()),
        minimum: Some(Level::P0),
        ..Policy::default()
    };
    for (name, bytes, policy) in [
        (
            "calculator.default.json",
            CALCULATOR.to_vec(),
            Policy::default(),
        ),
        ("calculator.p0.json", CALCULATOR.to_vec(), p0_named),
        (
            "calculator.tampered-guest.json",
            tampered(),
            Policy::default(),
        ),
        (
            "payment-approval.default.json",
            PAYMENT_APPROVAL.to_vec(),
            Policy::default(),
        ),
    ] {
        let golden = fixture(&format!("{goldens}/{name}"));
        let verdict = verify(&bytes, &policy).unwrap();
        assert_eq!(
            without_messages(assert_valid(&verdict)),
            without_messages(golden),
            "{name}"
        );
    }
}

/// The signer policy of `check --key <public.pem>`.
fn signed_by(pem: &str) -> Policy {
    Policy {
        signer: Some(crate::attest::VerifyPolicy {
            key: Some(pem.to_owned()),
            ..crate::attest::VerifyPolicy::default()
        }),
        ..Policy::default()
    }
}

/// Parity (#270): the signed fixtures `prism-code check` prints its goldens for, with signatures verified for
/// real by both CLIs against `signer.pub.pem`, give the same verdict here in every member but the messages.
#[test]
fn parity_the_rust_verdicts_for_the_signed_fixtures_equal_the_javascript_goldens() {
    let dir = "sdk/npm/prism-code/test/fixtures/signed";
    let read = |name: &str| std::fs::read(root().join(dir).join(name)).unwrap();
    let text = |name: &str| String::from_utf8(read(name)).unwrap();
    let trusted = text("signer.pub.pem");
    let stranger = text("stranger.pub.pem");
    let calculator = read("Calculator.signed.holo");
    let mut damaged = calculator.clone();
    let at = guest_content_offset(&damaged) + 100;
    damaged[at] ^= 0xff;
    let cases = [
        (
            "calculator.trusted.json",
            calculator.clone(),
            signed_by(&trusted),
        ),
        (
            "payment-approval.trusted.json",
            read("PaymentApproval.signed.holo"),
            signed_by(&trusted),
        ),
        (
            "calculator.no-signer.json",
            calculator.clone(),
            Policy::default(),
        ),
        (
            "calculator.stranger.json",
            calculator.clone(),
            signed_by(&stranger),
        ),
        (
            "payment-approval.mismatch.json",
            read("PaymentApproval.mismatch.holo"),
            signed_by(&trusted),
        ),
        ("calculator.tampered.json", damaged, signed_by(&trusted)),
    ];
    for (name, bytes, policy) in cases {
        let verdict = verify(&bytes, &policy).unwrap();
        let golden: Value = serde_json::from_str(&text(name)).unwrap();
        assert_eq!(
            without_messages(assert_valid(&verdict)),
            without_messages(golden),
            "{name}"
        );
    }
}

#[test]
fn a_signer_policy_that_is_unusable_is_no_verdict() {
    let bytes = std::fs::read(
        root().join("sdk/npm/prism-code/test/fixtures/signed/Calculator.signed.holo"),
    )
    .unwrap();
    // A keyless policy that names no issuer: the same refusal `prism-code check` gives (exit 2).
    let policy = Policy {
        signer: Some(crate::attest::VerifyPolicy {
            certificate_identity: Some("ci@example.org".to_owned()),
            ..crate::attest::VerifyPolicy::default()
        }),
        ..Policy::default()
    };
    let error = verify(&bytes, &policy).unwrap_err();
    assert_eq!(error.check, "policy.invalid");
}

#[test]
fn the_no_verdict_diagnostic_is_registered_with_exit_two() {
    let error = NoVerdict {
        check: "policy.invalid",
        message: "x".to_owned(),
    };
    assert_eq!(error.to_string(), "no verdict: policy.invalid: x");
    assert_eq!(
        error.diagnostic().to_string(),
        "PP5603: no verdict: policy.invalid: x"
    );
    assert_eq!(error.diagnostic().exit_code(), super::EXIT_NO_VERDICT);
}
