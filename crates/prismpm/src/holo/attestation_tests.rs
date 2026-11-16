use super::*;
use crate::holo::archive::{
    attach_attestations, parse_application, read_attestations, strip_attestations,
    validate_application, ROLES_V5,
};
use crate::holo::v5;
use base64::engine::general_purpose::STANDARD;
use serde_json::{json, Value};

/// The reference archive, `calculator-example` `artifacts/Calculator.holo`,
/// re-emitted as a holo v5 (`upgrade_application`), unsigned.
const CALCULATOR: &[u8] =
    include_bytes!("../../../../sdk/npm/prism-code/fixtures/Calculator.v5.holo");
/// `appendAttestations(CALCULATOR, BUNDLES)` as written by `sdk/npm/prism-code`.
const SIGNED_BY_JAVASCRIPT: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/attestation/Calculator.v5.signed.holo"
);
const BUNDLES: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/attestation/calculator.v5.bundles.jsonl"
);
/// Index of the attestation object in a signed v5 holo.
const ATTESTATIONS: usize = ROLES_V5.len();

fn lines() -> Vec<Vec<u8>> {
    BUNDLES
        .split(|byte| *byte == b'\n')
        .filter(|line| !line.is_empty())
        .map(<[u8]>::to_vec)
        .collect()
}

fn blobs() -> BTreeMap<String, Vec<u8>> {
    parse_application(CALCULATOR).unwrap().blobs
}

fn guest() -> (String, Vec<u8>) {
    blobs()
        .into_iter()
        .find(|(_, content)| content.starts_with(b"\0asm"))
        .unwrap()
}

/// A subject naming one object of the holo by its κ.
fn subject(name: &str, label: &str, _content: &[u8]) -> Value {
    json!({
        "name": name,
        "digest": { "sha256": label.strip_prefix("sha256:").unwrap() }
    })
}

fn statement(subjects: Value) -> Value {
    json!({
        "_type": STATEMENT_TYPE,
        "subject": subjects,
        "predicateType": "https://uor.foundation/prism/proof/v1",
        "predicate": {}
    })
}

/// An unsigned placeholder bundle: the shape is real, the signature is not.
fn bundle(statement: &Value) -> Value {
    json!({
        "mediaType": BUNDLE_MEDIA_TYPE,
        "verificationMaterial": {"publicKey": {"hint": "placeholder"}, "tlogEntries": []},
        "dsseEnvelope": {
            "payload": STANDARD.encode(serde_json::to_vec(statement).unwrap()),
            "payloadType": DSSE_PAYLOAD_TYPE,
            "signatures": [{"keyid": "", "sig": STANDARD.encode(b"not a real signature")}],
        }
    })
}

fn guest_bundle() -> Vec<u8> {
    let (label, content) = guest();
    serde_json::to_vec(&bundle(&statement(json!([subject(
        "core-wasm/prism_calculator_core_wasm.wasm",
        &label,
        &content
    )]))))
    .unwrap()
}

fn signed() -> Vec<u8> {
    attach_attestations(CALCULATOR, &lines()).unwrap()
}

fn objects(bytes: &[u8]) -> Vec<Vec<u8>> {
    v5::read_objects(bytes, v5::APPLICATION_BUDGET)
        .unwrap()
        .into_iter()
        .map(<[u8]>::to_vec)
        .collect()
}

fn code<T: std::fmt::Debug>(result: Result<T, PrismError>) -> String {
    result.unwrap_err().code.to_string()
}

#[test]
fn ho_23_archive_without_the_section_loads_unchanged_and_has_no_attestations() {
    validate_application(CALCULATOR).unwrap();
    assert!(read_attestations(CALCULATOR).unwrap().is_empty());
    assert_eq!(strip_attestations(CALCULATOR).unwrap(), CALCULATOR);
    assert_eq!(
        objects(CALCULATOR).len(),
        ROLES_V5.len(),
        "an unsigned holo keeps its seven objects"
    );
}

#[test]
fn ho_23_signed_archive_loads_with_the_same_application_identities() {
    let unsigned = parse_application(CALCULATOR).unwrap();
    let signed = signed();
    let parsed = parse_application(&signed).unwrap();
    assert_eq!(
        parsed.identities.guest_content_kappa,
        unsigned.identities.guest_content_kappa
    );
    assert_eq!(
        parsed.identities.view_content_kappa,
        unsigned.identities.view_content_kappa
    );
    assert_eq!(
        parsed.identities.model_content_kappa,
        unsigned.identities.model_content_kappa
    );
    assert_eq!(
        parsed.identities.application_kappa,
        unsigned.identities.application_kappa
    );
    assert_ne!(
        parsed.identities.archive_fingerprint,
        unsigned.identities.archive_fingerprint
    );
    assert_ne!(
        parsed.identities.archive_kappa,
        unsigned.identities.archive_kappa
    );
    assert_eq!(parsed.blobs, unsigned.blobs);
    assert_eq!(parsed.prism_extension, unsigned.prism_extension);
}

#[test]
fn ho_24_section_is_the_last_object_and_the_seal_covers_it() {
    let signed = signed();
    let signed_objects = objects(&signed);
    assert_eq!(signed_objects.len(), ROLES_V5.len() + 1);
    assert_eq!(signed_objects[..ATTESTATIONS], objects(CALCULATOR)[..]);
    assert_eq!(signed_objects[ATTESTATIONS], BUNDLES);
    let (preimage, seal) = signed.split_at(signed.len() - v5::SEAL);
    assert_eq!(
        v5::chain(preimage),
        seal,
        "the seal is UORC-SHA256-CHAIN-v1 over the archive, bundles included"
    );
}

#[test]
fn ho_24_flipping_a_bundle_byte_breaks_the_seal() {
    let mut signed = signed();
    let at = signed.len() - v5::SEAL - BUNDLES.len() + 5;
    signed[at] ^= 1;
    assert_eq!(code(validate_application(&signed)), "PP3004");
}

#[test]
fn ho_24_section_is_at_most_once_and_its_lines_are_framed() {
    let signed_objects = objects(&signed());
    // A ninth object is refused, so the section cannot repeat.
    let mut twice = signed_objects.clone();
    twice.push(BUNDLES.to_vec());
    assert_eq!(
        code(validate_application(&v5::write_objects(&twice))),
        "PP3003"
    );
    // A blank line and a missing final LF are refused.
    let first = lines()[0].len();
    let mut blank = signed_objects.clone();
    blank[ATTESTATIONS][first + 1] = b'\n';
    assert_eq!(
        code(validate_application(&v5::write_objects(&blank))),
        "PP3016"
    );
    let mut unterminated = signed_objects;
    unterminated[ATTESTATIONS].pop();
    assert_eq!(
        code(validate_application(&v5::write_objects(&unterminated))),
        "PP3016"
    );
}

#[test]
fn ho_24_appending_to_a_signed_archive_extends_the_same_section_in_order() {
    let first = lines()[0].clone();
    let second = lines()[1].clone();
    let once = attach_attestations(CALCULATOR, std::slice::from_ref(&first)).unwrap();
    let twice = attach_attestations(&once, std::slice::from_ref(&second)).unwrap();
    assert_eq!(twice, signed());
    assert_eq!(objects(&twice).len(), ROLES_V5.len() + 1);
    assert_eq!(
        read_attestations(&twice)
            .unwrap()
            .into_iter()
            .map(|bundle| bundle.line)
            .collect::<Vec<_>>(),
        vec![first.clone(), second]
    );
    assert_eq!(code(attach_attestations(&once, &[first])), "PP3016");
    assert_eq!(code(attach_attestations(CALCULATOR, &[])), "PP3016");
}

#[test]
fn ho_25_stripping_the_section_returns_the_unsigned_archive_byte_for_byte() {
    assert_eq!(strip_attestations(&signed()).unwrap(), CALCULATOR);
    assert_eq!(
        strip_attestations(SIGNED_BY_JAVASCRIPT).unwrap(),
        CALCULATOR
    );
    let one = attach_attestations(CALCULATOR, &lines()[..1]).unwrap();
    assert_eq!(strip_attestations(&one).unwrap(), CALCULATOR);
}

#[test]
fn ho_25_rust_writes_the_section_the_javascript_appender_writes() {
    assert_eq!(signed(), SIGNED_BY_JAVASCRIPT);
    let javascript = read_attestations(SIGNED_BY_JAVASCRIPT).unwrap();
    let lines = lines();
    assert_eq!(javascript.len(), lines.len());
    for (read, line) in javascript.iter().zip(&lines) {
        assert_eq!(&read.line, line, "stored exactly as written");
    }
}

#[test]
fn ho_25_adding_a_bundle_changes_no_object_of_the_unsigned_archive() {
    let signed = signed();
    assert_eq!(objects(&signed)[..ATTESTATIONS], objects(CALCULATOR)[..]);
    let unsigned = parse_application(CALCULATOR).unwrap();
    let signed = parse_application(&signed).unwrap();
    assert_eq!(signed.application_manifest, unsigned.application_manifest);
    assert_eq!(
        signed.blobs.keys().collect::<Vec<_>>(),
        unsigned.blobs.keys().collect::<Vec<_>>()
    );
}

#[test]
fn ho_26_every_line_is_a_bundle_over_a_statement_naming_archive_blobs() {
    let read = read_attestations(&signed()).unwrap();
    assert_eq!(read.len(), 2);
    assert_eq!(read[0].index, 0);
    assert_eq!(
        read[0].predicate_type,
        "https://uor.foundation/prism/proof/v1"
    );
    assert_eq!(read[1].predicate_type, "https://slsa.dev/provenance/v1");
    assert_eq!(read[0].subjects.len(), 1);
    assert_eq!(read[1].subjects.len(), 2);
    let blobs = blobs();
    for bundle in &read {
        assert!(bundle.resolved());
        for subject in &bundle.subjects {
            let label = subject.blob.as_ref().unwrap();
            assert_eq!(label, &format!("sha256:{}", subject.sha256));
            assert_eq!(subject.blake3, None, "no BLAKE3 in a v5 subject");
            assert_eq!(
                format!("{:x}", Sha256::digest(&blobs[label])),
                subject.sha256
            );
            assert_eq!(subject.sha256_matches, Some(true));
        }
    }
    assert_eq!(
        read[0].subjects[0].name,
        "core-wasm/prism_calculator_core_wasm.wasm"
    );
}

#[test]
fn ho_26_a_subject_naming_no_object_is_reported_not_resolved() {
    let absent = statement(json!([{
        "name": "model.json",
        "digest": {"sha256": "1".repeat(64)}
    }]));
    let bundles = [serde_json::to_vec(&bundle(&absent)).unwrap()];
    let signed = attach_attestations(CALCULATOR, &bundles).unwrap();
    let read = read_attestations(&signed).unwrap();
    assert_eq!(read[0].subjects[0].blob, None);
    assert_eq!(read[0].subjects[0].sha256_matches, None);
    assert!(!read[0].resolved());
}

fn refused(mutate: impl FnOnce(&mut Value)) -> String {
    let mut value: Value = serde_json::from_slice(&guest_bundle()).unwrap();
    mutate(&mut value);
    code(attach_attestations(
        CALCULATOR,
        &[serde_json::to_vec(&value).unwrap()],
    ))
}

fn refused_statement(mutate: impl FnOnce(&mut Value)) -> String {
    let (label, content) = guest();
    let mut statement = statement(json!([subject("guest.wasm", &label, &content)]));
    mutate(&mut statement);
    code(attach_attestations(
        CALCULATOR,
        &[serde_json::to_vec(&bundle(&statement)).unwrap()],
    ))
}

#[test]
fn ho_27_malformed_bundles_are_refused_before_anything_is_written() {
    assert!(attach_attestations(CALCULATOR, &[guest_bundle()]).is_ok());
    assert_eq!(
        code(attach_attestations(CALCULATOR, &[b"{".to_vec()])),
        "PP3017"
    );
    assert_eq!(
        code(attach_attestations(CALCULATOR, &[b"[]".to_vec()])),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["mediaType"] = json!("application/json")),
        "PP3017"
    );
    assert_eq!(
        refused(|v| {
            v["mediaType"] = json!("application/vnd.dev.sigstore.bundle+json;version=0.2");
            v["verificationMaterial"] = json!({"x509CertificateChain": {"certificates": []}});
        }),
        "PP3017",
        "a v0.2 bundle"
    );
    assert_eq!(
        refused(|v| {
            v.as_object_mut().unwrap().remove("dsseEnvelope");
            v["messageSignature"] = json!({"signature": "AA=="});
        }),
        "PP3017",
        "a messageSignature instead of a DSSE envelope"
    );
    assert_eq!(refused(|v| v["messageSignature"] = json!({})), "PP3017");
    assert_eq!(
        refused(|v| {
            v.as_object_mut().unwrap().remove("verificationMaterial");
        }),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["payloadType"] = json!("text/plain")),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["signatures"] = json!([])),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["signatures"] = json!([{"keyid": ""}])),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["payload"] = json!("***")),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["payload"] = json!("AAAAA")),
        "PP3017"
    );
    assert_eq!(
        refused(|v| v["dsseEnvelope"]["payload"] = json!("bm90IGpzb24=")),
        "PP3017"
    );
}

#[test]
fn ho_27_statements_must_be_in_toto_v1_over_kappa_subjects() {
    assert_eq!(
        refused_statement(|s| s["_type"] = json!("https://in-toto.io/Statement/v0.1")),
        "PP3017"
    );
    assert_eq!(
        refused_statement(|s| {
            s.as_object_mut().unwrap().remove("predicateType");
        }),
        "PP3017"
    );
    assert_eq!(
        refused_statement(|s| s["predicateType"] = json!("")),
        "PP3017"
    );
    assert_eq!(refused_statement(|s| s["subject"] = json!([])), "PP3017");
    assert_eq!(
        refused_statement(|s| s["subject"][0]["name"] = json!("")),
        "PP3017"
    );
    assert_eq!(
        refused_statement(|s| s["subject"][0]["digest"]["blake3"] = json!("a".repeat(64))),
        "PP3017",
        "a v5 subject is sha256 alone (ADR-017)"
    );
    assert_eq!(
        refused_statement(|s| s["subject"][0]["digest"]["sha512"] = json!("a".repeat(64))),
        "PP3017"
    );
    assert_eq!(
        refused_statement(|s| s["subject"][0]["digest"]["sha256"] = json!("A".repeat(64))),
        "PP3017",
        "uppercase hex"
    );
    assert_eq!(
        refused_statement(|s| {
            s["subject"][0]["digest"]
                .as_object_mut()
                .unwrap()
                .remove("sha256");
        }),
        "PP3017"
    );
    assert_eq!(
        refused_statement(|s| s["subject"][0]["name"] = json!("oci-manifest")),
        "PP3017",
        "the OCI manifest is signed at push, never inside the holo"
    );
}

#[test]
fn ho_27_lines_are_single_nonempty_bundles() {
    assert_eq!(
        code(attach_attestations(CALCULATOR, &[Vec::new()])),
        "PP3016"
    );
    let mut multi = guest_bundle();
    multi.insert(1, b'\n');
    assert_eq!(code(attach_attestations(CALCULATOR, &[multi])), "PP3016");
    assert_eq!(code(split_lines(b"")), "PP3016");
    assert_eq!(code(split_lines(b"{}")), "PP3016");
    assert_eq!(code(split_lines(b"{}\n\n{}\n")), "PP3016");
    assert_eq!(code(split_lines(b"\n")), "PP3016");
    assert_eq!(split_lines(b"{}\n{}\n").unwrap().len(), 2);
    assert_eq!(join_lines(&[b"{}".to_vec(), b"{}".to_vec()]), b"{}\n{}\n");
}
