//! The attestation bundle section of a `.holo` (issue #267, design
//! `docs/proposals/267-attestation-bundle.md`).
//!
//! The section is the last Extension row (kind 14) of the archive, named
//! [`ATTESTATION_EXTENSION`]. Its payload is JSON Lines: one Sigstore bundle
//! v0.3 per line, each line ended by LF. The wire model owns the row, its name,
//! its position and the line framing; this module only reads what a line says.
//! It does not verify signatures. That is verifier policy (#272, #273).

use crate::error::PrismError;
use base64::alphabet;
use base64::engine::{DecodePaddingMode, GeneralPurpose, GeneralPurposeConfig};
use base64::Engine;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

/// Name of the Extension row that holds the attestation bundles.
pub const ATTESTATION_EXTENSION: &str = "https://uor.foundation/extension/attestation-bundle/v1";
/// Media type of one bundle line.
pub const BUNDLE_MEDIA_TYPE: &str = "application/vnd.dev.sigstore.bundle.v0.3+json";
/// The in-toto statement type carried inside the DSSE envelope.
pub const STATEMENT_TYPE: &str = "https://in-toto.io/Statement/v1";
/// The DSSE payload type of a Prism bundle.
pub const DSSE_PAYLOAD_TYPE: &str = "application/vnd.in-toto+json";
/// Subject name reserved for the registry-facing statement signed at push.
pub const OCI_MANIFEST_SUBJECT: &str = "oci-manifest";

/// Section framing problems: no bundle, an empty line, a repeated bundle.
const LINES: &str = "PP3016";
/// One bundle that is not a Sigstore v0.3 DSSE bundle over a Prism statement.
const BUNDLE: &str = "PP3017";

/// One subject of an in-toto statement inside the holo.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestationSubject {
    /// The subject name, the build-manifest path of a content blob.
    pub name: String,
    /// Lowercase hex SHA-256 over the blob content.
    pub sha256: String,
    /// Lowercase hex BLAKE3 over the same bytes, the blob label without `blake3:`.
    pub blake3: String,
    /// The label of the content blob whose BLAKE3 this subject names, if the archive holds it.
    pub blob: Option<String>,
    /// Whether the named blob's SHA-256 equals the subject's. `None` when the archive has no such blob.
    pub sha256_matches: Option<bool>,
}

/// One line of the attestation section, structurally decoded and not verified.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attestation {
    /// Position in the section, from zero.
    pub index: usize,
    /// The bundle exactly as stored, without its LF.
    pub line: Vec<u8>,
    /// The statement's `predicateType`.
    pub predicate_type: String,
    /// The statement's subjects, in order.
    pub subjects: Vec<AttestationSubject>,
}

impl Attestation {
    /// Every subject names a content blob of the archive with both digests agreeing.
    #[must_use]
    pub fn resolved(&self) -> bool {
        self.subjects
            .iter()
            .all(|subject| subject.sha256_matches == Some(true))
    }
}

fn lines_error(message: impl Into<String>) -> PrismError {
    PrismError::new(LINES, message.into())
}

fn bundle_error(message: impl Into<String>) -> PrismError {
    PrismError::new(BUNDLE, message.into())
}

/// Split a payload into lines without their LF. The wire model already
/// rejects an empty payload, a missing final LF and a blank line, so a failure
/// here means a caller passed a payload the wire model did not produce.
pub(crate) fn split_lines(payload: &[u8]) -> Result<Vec<&[u8]>, PrismError> {
    if payload.last() != Some(&b'\n') {
        return Err(lines_error(
            "the attestation section is empty or its last line does not end with LF",
        ));
    }
    let mut lines = Vec::new();
    for line in payload[..payload.len() - 1].split(|byte| *byte == b'\n') {
        if line.is_empty() {
            return Err(lines_error(format!("line {} is empty", lines.len())));
        }
        lines.push(line);
    }
    Ok(lines)
}

/// Join bundle lines into a section payload, one LF after each.
pub(crate) fn join_lines(lines: &[Vec<u8>]) -> Vec<u8> {
    let mut payload = Vec::with_capacity(lines.iter().map(|line| line.len() + 1).sum());
    for line in lines {
        payload.extend_from_slice(line);
        payload.push(b'\n');
    }
    payload
}

/// Standard or URL-safe base64, padding optional, to bytes.
fn base64_bytes(value: &Value, what: &str) -> Result<Vec<u8>, PrismError> {
    // Same language as the JavaScript reader: [A-Za-z0-9+/_-]* then at most two '='.
    let text = value
        .as_str()
        .filter(|text| {
            let body = text.trim_end_matches('=');
            text.len() - body.len() <= 2
                && body.bytes().all(|byte| {
                    byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/' | b'_' | b'-')
                })
        })
        .ok_or_else(|| bundle_error(format!("{what} is not base64")))?;
    let normal = text
        .trim_end_matches('=')
        .replace('-', "+")
        .replace('_', "/");
    let engine = GeneralPurpose::new(
        &alphabet::STANDARD,
        GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(DecodePaddingMode::Indifferent),
    );
    engine
        .decode(normal)
        .map_err(|error| bundle_error(format!("{what} is not base64: {error}")))
}

fn lowercase_hex64(value: &Value) -> Option<&str> {
    value.as_str().filter(|text| {
        text.len() == 64
            && text
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
    })
}

fn subject_of(
    index: usize,
    value: &Value,
    blobs: &BTreeMap<String, Vec<u8>>,
) -> Result<AttestationSubject, PrismError> {
    let where_ = format!("subject {index}");
    let name = value
        .get("name")
        .and_then(Value::as_str)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| bundle_error(format!("{where_} has no name")))?;
    if name == OCI_MANIFEST_SUBJECT {
        return Err(bundle_error(
            "a statement inside the holo cannot name the OCI manifest; that statement is signed at push",
        ));
    }
    let digest = value
        .get("digest")
        .and_then(Value::as_object)
        .ok_or_else(|| bundle_error(format!("{where_} has no digest set")))?;
    if digest.len() != 2 || !digest.contains_key("blake3") || !digest.contains_key("sha256") {
        return Err(bundle_error(format!(
            "{where_} must carry exactly blake3 and sha256 (ADR-015)"
        )));
    }
    let hex = |key: &str| {
        lowercase_hex64(&digest[key])
            .map(str::to_owned)
            .ok_or_else(|| {
                bundle_error(format!("{where_} {key} is not 64 lowercase hex characters"))
            })
    };
    let (blake3, sha256) = (hex("blake3")?, hex("sha256")?);
    let label = format!("blake3:{blake3}");
    let content = blobs.get(&label);
    Ok(AttestationSubject {
        name: name.to_owned(),
        sha256_matches: content.map(|bytes| format!("{:x}", Sha256::digest(bytes)) == sha256),
        blob: content.map(|_| label),
        sha256,
        blake3,
    })
}

/// Decode one bundle line. Structural problems are `PP3017`; what a signature
/// proves is left to a verifier.
pub(crate) fn decode_bundle(
    index: usize,
    line: &[u8],
    blobs: &BTreeMap<String, Vec<u8>>,
) -> Result<Attestation, PrismError> {
    if line.is_empty() || line.contains(&b'\n') {
        return Err(lines_error(
            "a bundle line is empty or contains LF; serialize each bundle on one line",
        ));
    }
    let bundle: Value = serde_json::from_slice(line)
        .map_err(|error| bundle_error(format!("bundle line is not UTF-8 JSON: {error}")))?;
    if bundle.get("mediaType").and_then(Value::as_str) != Some(BUNDLE_MEDIA_TYPE) {
        return Err(bundle_error(format!(
            "bundle mediaType must be {BUNDLE_MEDIA_TYPE}"
        )));
    }
    if !bundle
        .get("verificationMaterial")
        .is_some_and(Value::is_object)
    {
        return Err(bundle_error("bundle has no verificationMaterial"));
    }
    if bundle.get("messageSignature").is_some() {
        return Err(bundle_error(
            "bundle carries a messageSignature; Prism bundles carry a DSSE envelope",
        ));
    }
    let envelope = bundle
        .get("dsseEnvelope")
        .filter(|envelope| envelope.is_object())
        .ok_or_else(|| bundle_error("bundle has no dsseEnvelope"))?;
    if envelope.get("payloadType").and_then(Value::as_str) != Some(DSSE_PAYLOAD_TYPE) {
        return Err(bundle_error(format!(
            "DSSE payloadType must be {DSSE_PAYLOAD_TYPE}"
        )));
    }
    let signatures = envelope
        .get("signatures")
        .and_then(Value::as_array)
        .filter(|signatures| !signatures.is_empty())
        .ok_or_else(|| bundle_error("DSSE envelope has no signature"))?;
    for (position, signature) in signatures.iter().enumerate() {
        let sig = signature
            .get("sig")
            .filter(|_| signature.is_object())
            .ok_or_else(|| bundle_error(format!("DSSE signature {position} has no sig")))?;
        base64_bytes(sig, &format!("DSSE signature {position}"))?;
    }
    let payload = base64_bytes(
        envelope.get("payload").unwrap_or(&Value::Null),
        "DSSE payload",
    )?;
    let statement: Value = serde_json::from_slice(&payload)
        .map_err(|error| bundle_error(format!("DSSE payload is not UTF-8 JSON: {error}")))?;
    if statement.get("_type").and_then(Value::as_str) != Some(STATEMENT_TYPE) {
        return Err(bundle_error(format!(
            "statement _type is not {STATEMENT_TYPE}"
        )));
    }
    let predicate_type = statement
        .get("predicateType")
        .and_then(Value::as_str)
        .filter(|predicate| !predicate.is_empty())
        .ok_or_else(|| bundle_error("statement has no predicateType"))?
        .to_owned();
    let subjects = statement
        .get("subject")
        .and_then(Value::as_array)
        .filter(|subjects| !subjects.is_empty())
        .ok_or_else(|| bundle_error("statement has no subject"))?
        .iter()
        .enumerate()
        .map(|(position, subject)| subject_of(position, subject, blobs))
        .collect::<Result<Vec<_>, _>>()?;
    Ok(Attestation {
        index,
        line: line.to_vec(),
        predicate_type,
        subjects,
    })
}

/// Decode every line of a section payload against the archive's content blobs.
pub(crate) fn decode_section(
    payload: &[u8],
    blobs: &BTreeMap<String, Vec<u8>>,
) -> Result<Vec<Attestation>, PrismError> {
    split_lines(payload)?
        .into_iter()
        .enumerate()
        .map(|(index, line)| decode_bundle(index, line, blobs))
        .collect()
}

#[cfg(test)]
#[path = "attestation_tests.rs"]
mod tests;
