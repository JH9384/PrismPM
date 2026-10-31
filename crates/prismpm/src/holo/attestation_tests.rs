use super::*;
use crate::holo::archive::{
    attach_attestations, parse_application, read_attestations, strip_attestations,
    validate_application,
};
use base64::engine::general_purpose::STANDARD;
use prism_stdlib as wire;
use serde_json::{json, Value};

/// The reference archive, `calculator-example` `artifacts/Calculator.holo`, unsigned.
const CALCULATOR: &[u8] = include_bytes!("../../../../sdk/npm/prism-code/fixtures/Calculator.holo");
/// `appendAttestations(CALCULATOR, BUNDLES)` as written by `sdk/npm/prism-code`.
const SIGNED_BY_JAVASCRIPT: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/attestation/Calculator.signed.holo"
);
const BUNDLES: &[u8] = include_bytes!(
    "../../../../sdk/npm/prism-code/test/fixtures/attestation/calculator.bundles.jsonl"
);

const TABLE_AT: usize = 10;
const ROW: usize = 24;

fn modeled<T>(value: Result<T, wire::ComputeError>) -> Result<T, PrismError> {
    value.map_err(|error| PrismError::new("PP3003", format!("{error:?}")))
}

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

fn subject(name: &str, label: &str, content: &[u8]) -> Value {
    json!({
        "name": name,
        "digest": {
            "blake3": label.strip_prefix("blake3:").unwrap(),
            "sha256": format!("{:x}", Sha256::digest(content)),
        }
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

fn reseal(bytes: &mut [u8]) {
    let footer = bytes.len() - 32;
    let digest = blake3::hash(&bytes[..footer]);
    bytes[footer..].copy_from_slice(digest.as_bytes());
}

fn code<T: std::fmt::Debug>(result: Result<T, PrismError>) -> String {
    result.unwrap_err().code.to_string()
}

fn row_kind(bytes: &[u8], row: usize) -> u64 {
    let at = TABLE_AT + row * ROW;
    u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap())
}

fn row_offset(bytes: &[u8], row: usize) -> usize {
    let at = TABLE_AT + row * ROW + 8;
    u64::from_le_bytes(bytes[at..at + 8].try_into().unwrap()) as usize
}

#[test]
fn ho_23_archive_without_the_section_loads_unchanged_and_has_no_attestations() {
    validate_application(CALCULATOR).unwrap();
    assert!(read_attestations(CALCULATOR).unwrap().is_empty());
    assert_eq!(strip_attestations(CALCULATOR).unwrap(), CALCULATOR);
    assert_eq!(
        u16::from_le_bytes(CALCULATOR[8..10].try_into().unwrap()),
        8,
        "an unsigned archive keeps its eight rows"
    );
    assert_eq!(
        modeled(wire::archiveAttestation(CALCULATOR.to_vec())).unwrap(),
        None
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
    assert_eq!(parsed.directory, unsigned.directory);
    assert_eq!(parsed.prism_extension, unsigned.prism_extension);
}

#[test]
fn ho_24_section_is_the_last_row_named_and_the_footer_covers_it() {
    let signed = signed();
    assert_eq!(u16::from_le_bytes(signed[8..10].try_into().unwrap()), 9);
    assert_eq!(row_kind(&signed, 8), 14, "an Extension row, no new kind");
    for row in 0..8 {
        assert_eq!(
            row_kind(&signed, row),
            row_kind(CALCULATOR, row),
            "row {row}"
        );
        assert_eq!(
            row_offset(&signed, row),
            row_offset(CALCULATOR, row) + ROW,
            "row {row} shifts by one table row"
        );
    }
    let start = row_offset(&signed, 8);
    let body = &signed[..signed.len() - 32];
    assert_eq!(
        start + 2 + ATTESTATION_EXTENSION.len() + BUNDLES.len(),
        body.len()
    );
    assert_eq!(&signed[start..start + 2], &54u16.to_le_bytes());
    assert_eq!(
        &signed[start + 2..start + 2 + ATTESTATION_EXTENSION.len()],
        ATTESTATION_EXTENSION.as_bytes()
    );
    assert_eq!(&body[start + 2 + ATTESTATION_EXTENSION.len()..], BUNDLES);
    assert_eq!(
        &signed[signed.len() - 32..],
        blake3::hash(body).as_bytes().as_slice(),
        "the footer is BLAKE3 of the body, bundles included"
    );
}

#[test]
fn ho_24_flipping_a_bundle_byte_breaks_the_footer() {
    let mut signed = signed();
    let at = row_offset(&signed, 8) + 2 + ATTESTATION_EXTENSION.len() + 5;
    signed[at] ^= 1;
    assert_eq!(code(validate_application(&signed)), "PP3004");
}

#[test]
fn ho_24_section_is_at_most_once_and_foreign_names_or_positions_are_refused() {
    let signed = signed();
    // A ninth row with another extension name is not an attestation section.
    let mut renamed = signed.clone();
    let name_at = row_offset(&renamed, 8) + 2 + ATTESTATION_EXTENSION.len() - 1;
    renamed[name_at] = b'2';
    reseal(&mut renamed);
    assert_eq!(code(validate_application(&renamed)), "PP3003");
    // A ninth row of another kind is refused.
    let mut kind = signed.clone();
    kind[TABLE_AT + 8 * ROW] = 16;
    reseal(&mut kind);
    assert_eq!(code(validate_application(&kind)), "PP3003");
    // A tenth row is refused, so the section cannot repeat.
    let mut count = signed.clone();
    count[8] = 10;
    reseal(&mut count);
    assert_eq!(code(validate_application(&count)), "PP3003");
    // The wire model rejects a blank line and a missing final LF in the section.
    let payload_at = row_offset(&signed, 8) + 2 + ATTESTATION_EXTENSION.len();
    let first = lines()[0].len();
    let mut blank = signed.clone();
    blank[payload_at + first + 1] = b'\n';
    reseal(&mut blank);
    assert_eq!(code(validate_application(&blank)), "PP3003");
    let mut unterminated = signed;
    let last = unterminated.len() - 33;
    unterminated[last] = b'}';
    reseal(&mut unterminated);
    assert_eq!(code(validate_application(&unterminated)), "PP3003");
}

#[test]
fn ho_24_appending_to_a_signed_archive_extends_the_same_section_in_order() {
    let first = lines()[0].clone();
    let second = lines()[1].clone();
    let once = attach_attestations(CALCULATOR, std::slice::from_ref(&first)).unwrap();
    let twice = attach_attestations(&once, std::slice::from_ref(&second)).unwrap();
    assert_eq!(twice, signed());
    assert_eq!(u16::from_le_bytes(twice[8..10].try_into().unwrap()), 9);
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
fn ho_25_adding_a_bundle_moves_no_row_of_the_unsigned_archive() {
    let signed = signed();
    let sections = |bytes: &[u8]| {
        (0..8)
            .map(|index| {
                modeled(wire::archiveSection(bytes.to_vec(), index))
                    .unwrap()
                    .unwrap()
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(sections(&signed), sections(CALCULATOR));
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
            assert_eq!(label, &format!("blake3:{}", subject.blake3));
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
fn ho_26_a_subject_naming_no_blob_or_a_wrong_sha256_is_reported_not_resolved() {
    let (label, content) = guest();
    let absent = statement(json!([{
        "name": "model.json",
        "digest": {"blake3": "0".repeat(64), "sha256": "1".repeat(64)}
    }]));
    let mut wrong = subject(
        "core-wasm/prism_calculator_core_wasm.wasm",
        &label,
        &content,
    );
    wrong["digest"]["sha256"] = json!("2".repeat(64));
    let bundles = [
        serde_json::to_vec(&bundle(&absent)).unwrap(),
        serde_json::to_vec(&bundle(&statement(json!([wrong])))).unwrap(),
    ];
    let signed = attach_attestations(CALCULATOR, &bundles).unwrap();
    let read = read_attestations(&signed).unwrap();
    assert_eq!(read[0].subjects[0].blob, None);
    assert_eq!(read[0].subjects[0].sha256_matches, None);
    assert!(!read[0].resolved());
    assert_eq!(read[1].subjects[0].sha256_matches, Some(false));
    assert!(!read[1].resolved());
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
fn ho_27_statements_must_be_in_toto_v1_over_dual_digest_blob_subjects() {
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
        refused_statement(|s| {
            s["subject"][0]["digest"]
                .as_object_mut()
                .unwrap()
                .remove("blake3");
        }),
        "PP3017",
        "a single-digest subject"
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
        refused_statement(|s| s["subject"][0]["digest"]["blake3"] = json!("abc")),
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
