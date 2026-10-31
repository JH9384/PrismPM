//! `attest` and `verify-attestation`: sign an in-toto statement into a holo's
//! attestation section and check it again (issue #272, design in
//! `docs/proposals/272-attest-verify.md`). The JavaScript implementation in
//! `sdk/npm/prism-code/src/attest.mjs` is the oracle: this module accepts the
//! bundles it writes and refuses what it refuses, with the same typed errors.
//!
//! What runs on a verify, in order, for each bundle of the requested type:
//!   1. every statement subject is a content blob of this holo, both digests equal
//!      (`PP3105`);
//!   2. the DSSE signature under the signing certificate or the given key, the
//!      certificate chain to the pinned root at a signed time, and its signed
//!      certificate timestamps (`PP3102`);
//!   3. the signer identity and issuer equal the policy's, exactly, never as a
//!      pattern unless the policy gives one (`PP3103`);
//!   4. the transparency evidence of #275, offline, over the same bundle and
//!      root: the timestamps, the Rekor v1 or v2 entry body against the envelope,
//!      the inclusion proof and the signed checkpoint (`PP3104`).
//!
//! Nothing is fetched: the trusted root is an argument. Signing is by a local
//! key; keyless signing through Fulcio is the JavaScript CLI's (`prism-code
//! attest`) until the Rust CLI gains an OIDC client.

mod certificate;
mod clock;
mod crypto;
mod der;
mod transparency;
mod trust;

#[cfg(test)]
#[path = "tests.rs"]
mod tests;

use crate::error::PrismError;
use crate::holo::archive::{attach_attestations, parse_application, read_attestations};
use crate::holo::attestation::{Attestation, DSSE_PAYLOAD_TYPE, STATEMENT_TYPE};
use base64::engine::general_purpose::STANDARD;
use base64::Engine;
use serde::Serialize;
use serde_json::{json, Value};
use std::collections::BTreeSet;

pub use transparency::{Check, Reason, Transparency};

/// The Fulcio-issued certificates of GitHub Actions workflows name this issuer.
pub const GITHUB_ACTIONS_ISSUER: &str = "https://token.actions.githubusercontent.com";

/// The result document `verify-attestation` prints.
pub const VERIFICATION_SCHEMA: &str = "prismpm/attestation-verification-result/1";
/// The result document `attest` prints.
pub const ATTEST_SCHEMA: &str = "prismpm/attest-result/1";
/// The media type of a Sigstore bundle v0.3 line.
const BUNDLE_MEDIA_TYPE: &str = crate::holo::attestation::BUNDLE_MEDIA_TYPE;

const ROLES: [&str; 4] = ["guest", "view", "model", "capabilities"];

/// Standard or URL-safe base64, padded or not, whitespace ignored; `None` for any other character.
pub(crate) fn base64_any(text: &str) -> Option<Vec<u8>> {
    let clean: String = text
        .chars()
        .filter(|c| !c.is_whitespace())
        .map(|c| match c {
            '-' => '+',
            '_' => '/',
            other => other,
        })
        .collect();
    let body = clean.trim_end_matches('=');
    if clean.len() - body.len() > 2
        || !body
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'/'))
    {
        return None;
    }
    let engine = base64::engine::GeneralPurpose::new(
        &base64::alphabet::STANDARD,
        base64::engine::GeneralPurposeConfig::new()
            .with_decode_allow_trailing_bits(true)
            .with_decode_padding_mode(base64::engine::DecodePaddingMode::Indifferent),
    );
    engine.decode(body).ok()
}

pub(crate) fn base64_standard(text: &str) -> Option<Vec<u8>> {
    base64_any(text)
}

// ------------------------------------------------------------------------ errors

/// The reasons a verify or an attest refuses, one per registered diagnostic.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    /// `PP3101`: the statement could not be signed.
    SigningFailed,
    /// `PP3102`: the DSSE signature, the certificate chain or its SCTs do not verify.
    SignatureInvalid,
    /// `PP3103`: the signer is not the identity or issuer the policy names.
    IdentityMismatch,
    /// `PP3104`: a log entry or timestamp is missing or does not verify.
    TransparencyFailed,
    /// `PP3105`: a subject is not a content blob of the holo with these digests.
    SubjectMismatch,
    /// `PP3106`: the holo has no attestation of the requested type.
    AttestationNotFound,
    /// `PP3107`: the trusted root cannot be read or pins nothing the policy needs.
    TrustRootInvalid,
    /// `PP1001`: the policy itself is unusable.
    PolicyInvalid,
}

impl ErrorKind {
    /// The registered diagnostic code.
    #[must_use]
    pub fn code(self) -> &'static str {
        match self {
            Self::SigningFailed => "PP3101",
            Self::SignatureInvalid => "PP3102",
            Self::IdentityMismatch => "PP3103",
            Self::TransparencyFailed => "PP3104",
            Self::SubjectMismatch => "PP3105",
            Self::AttestationNotFound => "PP3106",
            Self::TrustRootInvalid => "PP3107",
            Self::PolicyInvalid => "PP1001",
        }
    }

    /// The name the JavaScript error class carries as its `code`.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::SigningFailed => "signing_failed",
            Self::SignatureInvalid => "signature_invalid",
            Self::IdentityMismatch => "identity_mismatch",
            Self::TransparencyFailed => "transparency_failed",
            Self::SubjectMismatch => "subject_mismatch",
            Self::AttestationNotFound => "attestation_not_found",
            Self::TrustRootInvalid => "trust_root_invalid",
            Self::PolicyInvalid => "policy_invalid",
        }
    }
}

/// One typed refusal: its kind, the check that failed and why.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttestationError {
    /// The registered diagnostic code.
    pub code: String,
    /// The kind, named as the JavaScript error class names it.
    pub kind: ErrorKind,
    /// The check id, `identity.signer`, `signature.signature_error`, `transparency.tlog.body`, ...
    pub check: String,
    /// What was found.
    pub message: String,
    /// The transparency reasons, when the kind is `transparency_failed`.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub reasons: Vec<Reason>,
}

impl AttestationError {
    fn new(kind: ErrorKind, check: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: kind.code().to_owned(),
            kind,
            check: check.into(),
            message: message.into(),
            reasons: Vec::new(),
        }
    }
}

impl From<AttestationError> for PrismError {
    fn from(error: AttestationError) -> Self {
        let mut out = PrismError::new(error.kind.code(), error.message)
            .with_note(format!("check: {}", error.check));
        for reason in error.reasons {
            out = out.with_note(format!("{}: {}", reason.check, reason.message));
        }
        out
    }
}

fn signing(check: &str, message: impl Into<String>) -> AttestationError {
    AttestationError::new(ErrorKind::SigningFailed, check, message)
}

fn invalid_policy(message: impl Into<String>) -> AttestationError {
    AttestationError::new(ErrorKind::PolicyInvalid, "policy.invalid", message)
}

fn trust_root(message: impl Into<String>) -> AttestationError {
    AttestationError::new(ErrorKind::TrustRootInvalid, "trustedroot.invalid", message)
}

// ------------------------------------------------------------------------ policy

/// The signer policy of a verify. A keyless policy names an identity (exact,
/// or an anchored pattern) and an issuer; a keyed policy gives a PEM public
/// key. `trusted_root` is the pinned `trusted_root.json`; without one a
/// keyless verify, or a keyed one that requires log entries or timestamps,
/// is refused. `entries` and `timestamps` are the least number of log
/// entries and RFC 3161 timestamps that must verify: 1 each keyless, 0 each
/// keyed.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct VerifyPolicy {
    /// Only bundles with this `predicateType` are checked.
    pub predicate_type: Option<String>,
    /// The signer's certificate identity, compared exactly.
    pub certificate_identity: Option<String>,
    /// A regular expression the signer's certificate identity must match.
    pub certificate_identity_regexp: Option<String>,
    /// The OIDC issuer of the signer's certificate, compared exactly.
    pub certificate_oidc_issuer: Option<String>,
    /// A PEM public key, for keyed bundles.
    pub key: Option<String>,
    /// The pinned Sigstore trusted root.
    pub trusted_root: Option<Value>,
    /// The least number of log entries that must verify.
    pub entries: Option<u64>,
    /// The least number of RFC 3161 timestamps that must verify.
    pub timestamps: Option<u64>,
}

struct Policy {
    keyed: bool,
    entries: u64,
    timestamps: u64,
    identity: Option<String>,
    identity_pattern: Option<regex::Regex>,
    issuer: Option<String>,
    public_key: Option<Vec<u8>>,
}

fn policy_of(options: &VerifyPolicy) -> Result<Policy, AttestationError> {
    let keyed = options.key.is_some();
    if options.certificate_identity.is_some() && options.certificate_identity_regexp.is_some() {
        return Err(invalid_policy(
            "name the signer with either --certificate-identity or --certificate-identity-regexp, not both",
        ));
    }
    let identity_pattern = match &options.certificate_identity_regexp {
        None => None,
        Some(pattern) => Some(regex::Regex::new(pattern).map_err(|error| {
            invalid_policy(format!(
                "--certificate-identity-regexp is not a regular expression: {error}"
            ))
        })?),
    };
    if keyed {
        if options.certificate_identity.is_some()
            || options.certificate_identity_regexp.is_some()
            || options.certificate_oidc_issuer.is_some()
        {
            return Err(invalid_policy(
                "a key policy has no certificate identity or issuer",
            ));
        }
    } else {
        if options.certificate_identity.is_none() && options.certificate_identity_regexp.is_none() {
            return Err(invalid_policy(
                "a keyless policy needs --certificate-identity or --certificate-identity-regexp: without it any signer would pass",
            ));
        }
        if options.certificate_oidc_issuer.is_none() {
            return Err(invalid_policy(
                "a keyless policy needs --certificate-oidc-issuer",
            ));
        }
    }
    let entries = options.entries.unwrap_or(u64::from(!keyed));
    let timestamps = options.timestamps.unwrap_or(u64::from(!keyed));
    if keyed && (entries > 0 || timestamps > 0) && options.trusted_root.is_none() {
        return Err(invalid_policy(
            "requiring log entries or timestamps of a keyed bundle needs a --trusted-root",
        ));
    }
    let public_key = match &options.key {
        None => None,
        Some(pem) => {
            let der = der::pem_to_der(pem, Some("PUBLIC KEY")).ok_or_else(|| {
                invalid_policy("the verification key cannot be read: expected a PEM public key")
            })?;
            let key = crypto::key_of(&der).map_err(|error| {
                invalid_policy(format!("the verification key cannot be read: {error}"))
            })?;
            if !crypto::supported(&key) {
                return Err(invalid_policy(
                    "the verification key is not an EC P-256, EC P-384 or Ed25519 key",
                ));
            }
            Some(der)
        }
    };
    Ok(Policy {
        keyed,
        entries,
        timestamps,
        identity: options.certificate_identity.clone(),
        identity_pattern,
        issuer: options.certificate_oidc_issuer.clone(),
        public_key,
    })
}

const EMPTY_ROOT: &str = r#"{"mediaType":"application/vnd.dev.sigstore.trustedroot+json;version=0.1","tlogs":[],"certificateAuthorities":[],"ctlogs":[],"timestampAuthorities":[]}"#;

fn trusted_root_of(options: &VerifyPolicy, needed: bool) -> Result<Value, AttestationError> {
    match &options.trusted_root {
        Some(root) if root.is_object() => Ok(root.clone()),
        Some(_) => Err(trust_root("the trusted root must be an object")),
        None if !needed => Ok(serde_json::from_str(EMPTY_ROOT).expect("the empty root is JSON")),
        None => Err(trust_root(
            "the Sigstore trusted root is not pinned and the Rust CLI does not fetch it; pass --trusted-root",
        )),
    }
}

/// A pinned root must carry what the policy relies on; an empty root would fail every bundle with a misleading reason.
fn check_root(root: &Value, policy: &Policy) -> Result<trust::TrustedRoot, AttestationError> {
    let mut need = Vec::new();
    if !policy.keyed {
        need.push("certificateAuthorities");
    }
    if policy.entries > 0 {
        need.push("tlogs");
    }
    if policy.timestamps > 0 {
        need.push("timestampAuthorities");
    }
    let missing = need
        .into_iter()
        .filter(|member| {
            !root
                .get(member)
                .and_then(Value::as_array)
                .is_some_and(|list| !list.is_empty())
        })
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        return Err(trust_root(format!(
            "the trusted root has no {}",
            missing.join(", ")
        )));
    }
    trust::read_trusted_root(root).map_err(trust_root)
}

// ------------------------------------------------------------------------ verify

/// What a bundle's evidence says about its signer and time.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct BundleOutcome {
    /// The certificate identity, for a keyless bundle.
    pub identity: Option<String>,
    /// The OIDC issuer, for a keyless bundle.
    pub issuer: Option<String>,
    /// The key id (`publicKey.hint`), for a keyed bundle.
    pub key_id: Option<String>,
    /// The signed time, ISO 8601, when transparency evidence was required.
    pub time: Option<String>,
}

/// The signature and signed time of one bundle: its DSSE envelope parts, the
/// leaf certificate when keyless, and the times a verifier may place it at.
struct Evidence {
    pae: Vec<u8>,
    signature: Vec<u8>,
    leaf: Option<certificate::Certificate>,
    hint: Option<String>,
}

fn evidence_of(bundle: &Value) -> Result<Evidence, AttestationError> {
    let malformed = |what: &str| {
        AttestationError::new(
            ErrorKind::SignatureInvalid,
            "signature.bundle_error",
            format!("the bundle is malformed: {what}"),
        )
    };
    if bundle.get("mediaType").and_then(Value::as_str) != Some(BUNDLE_MEDIA_TYPE) {
        return Err(malformed("mediaType is not a Sigstore bundle v0.3"));
    }
    let envelope = bundle
        .get("dsseEnvelope")
        .ok_or_else(|| malformed("no dsseEnvelope"))?;
    let payload = envelope
        .get("payload")
        .and_then(Value::as_str)
        .and_then(base64_any)
        .ok_or_else(|| malformed("the payload is not base64"))?;
    let payload_type = envelope
        .get("payloadType")
        .and_then(Value::as_str)
        .ok_or_else(|| malformed("no payloadType"))?;
    let signature = envelope
        .pointer("/signatures/0/sig")
        .and_then(Value::as_str)
        .and_then(base64_any)
        .ok_or_else(|| malformed("the signature is not base64"))?;
    let material = bundle
        .get("verificationMaterial")
        .ok_or_else(|| malformed("no verificationMaterial"))?;
    let leaf = match material.pointer("/certificate/rawBytes") {
        None => None,
        Some(raw) => {
            let bytes = raw
                .as_str()
                .and_then(base64_any)
                .ok_or_else(|| malformed("the certificate is not base64"))?;
            Some(certificate::parse_certificate(&bytes).map_err(|error| {
                AttestationError::new(
                    ErrorKind::SignatureInvalid,
                    "signature.certificate_error",
                    format!("the signing certificate does not parse: {error}"),
                )
            })?)
        }
    };
    Ok(Evidence {
        pae: transparency::pae(payload_type, &payload),
        signature,
        leaf,
        hint: material
            .pointer("/publicKey/hint")
            .and_then(Value::as_str)
            .map(str::to_owned),
    })
}

/// A Rekor v1 signed entry timestamp: the log vouches for the integrated time
/// of the body it logged. Returns that time when the promise verifies under
/// the pinned log key.
fn promised_time(entry: &Value, root: &trust::TrustedRoot) -> Option<i64> {
    let key_id = entry
        .pointer("/logId/keyId")?
        .as_str()
        .and_then(base64_any)?;
    let log = root.tlogs.iter().find(|log| log.key_id == key_id)?;
    let body = entry.get("canonicalizedBody")?.as_str()?;
    let integrated: i64 = entry.get("integratedTime")?.as_str()?.parse().ok()?;
    let index: u64 = entry.get("logIndex")?.as_str()?.parse().ok()?;
    let set = entry
        .pointer("/inclusionPromise/signedEntryTimestamp")?
        .as_str()
        .and_then(base64_any)?;
    let signed = serde_json::to_vec(&json!({
        "body": body,
        "integratedTime": integrated,
        "logID": der::hex(&log.key_id),
        "logIndex": index,
    }))
    .ok()?;
    let scheme = crypto::Scheme {
        kind: crypto::Kind::Ecdsa,
        hash: Some(crypto::Hash::Sha256),
    };
    crypto::verify(&log.spki, scheme, None, &signed, &set).then_some(integrated * 1000)
}

/// Signature, signer and transparency evidence of one bundle, with no reference to a holo.
fn verify_evidence(
    bundle: &Value,
    policy: &Policy,
    root: &trust::TrustedRoot,
) -> Result<BundleOutcome, AttestationError> {
    let evidence = evidence_of(bundle)?;
    let invalid = |check: &str, message: String| {
        AttestationError::new(ErrorKind::SignatureInvalid, check, message)
    };
    let mut identity = None;
    let mut issuer = None;
    let mut key_id = None;
    if policy.keyed {
        let spki = policy
            .public_key
            .as_ref()
            .expect("a keyed policy has a key");
        let key = crypto::key_of(spki).expect("the policy key was checked");
        let scheme = crypto::dsse_scheme(&key).expect("the policy key is supported");
        if !crypto::verify(spki, scheme, None, &evidence.pae, &evidence.signature) {
            return Err(invalid(
                "signature.signature_error",
                "the DSSE signature does not verify under the given key".to_owned(),
            ));
        }
        key_id = evidence.hint.clone();
    } else {
        let Some(leaf) = &evidence.leaf else {
            return Err(invalid(
                "signature.certificate_error",
                "the bundle carries no signing certificate; a keyless policy needs one".to_owned(),
            ));
        };
        let key = crypto::key_of(&leaf.spki).map_err(|error| {
            invalid(
                "signature.certificate_error",
                format!("the signing certificate's key does not parse: {error}"),
            )
        })?;
        let scheme = crypto::dsse_scheme(&key).ok_or_else(|| {
            invalid(
                "signature.certificate_error",
                "the signing certificate's key is neither EC nor Ed25519".to_owned(),
            )
        })?;
        if !crypto::verify(&leaf.spki, scheme, None, &evidence.pae, &evidence.signature) {
            return Err(invalid(
                "signature.signature_error",
                "the DSSE signature does not verify under the signing certificate".to_owned(),
            ));
        }
        // The times the evidence places the signature at: every verified RFC 3161 timestamp and, for a Rekor v1
        // entry, the integrated time the log promised. The certificate lived minutes, so without one of them it
        // cannot be placed in time.
        let material = bundle
            .get("verificationMaterial")
            .cloned()
            .unwrap_or(Value::Null);
        let mut times = Vec::new();
        for stamp in material
            .pointer("/timestampVerificationData/rfc3161Timestamps")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            let encoded = stamp
                .get("signedTimestamp")
                .and_then(Value::as_str)
                .unwrap_or("");
            if let Ok(time) = transparency::check_timestamp(
                encoded,
                &evidence.signature,
                &root.timestamp_authorities,
            ) {
                times.push(time);
            }
        }
        for entry in material
            .get("tlogEntries")
            .and_then(Value::as_array)
            .into_iter()
            .flatten()
        {
            if let Some(time) = promised_time(entry, root) {
                times.push(time);
            }
        }
        if times.is_empty() {
            return Err(AttestationError::new(
                ErrorKind::TransparencyFailed,
                "transparency.timestamp_error",
                "no verified timestamp or log promise places the signing certificate in time",
            ));
        }
        let mut chained = None;
        for at in &times {
            let authorities = root
                .certificate_authorities
                .iter()
                .filter(|authority| authority.valid_for.contains(*at));
            let mut problem =
                Some("no pinned certificate authority was valid at the signed time".to_owned());
            for authority in authorities {
                problem = certificate::chain_problem(leaf, &authority.certs, *at);
                if problem.is_none() {
                    chained = Some(authority);
                    break;
                }
            }
            if let Some(problem) = problem {
                return Err(invalid(
                    "signature.certificate_error",
                    format!("the signing certificate: {problem}"),
                ));
            }
        }
        let authority = chained.expect("a time verified the chain");
        let issuer_cert = authority
            .certs
            .iter()
            .find(|cert| cert.subject == leaf.issuer)
            .expect("the chain found the issuer");
        match certificate::verify_scts(leaf, issuer_cert, &root.ctlogs) {
            Ok(0) => {
                return Err(invalid(
                    "signature.certificate_error",
                    "the signing certificate carries no signed certificate timestamp".to_owned(),
                ))
            }
            Ok(_) => {}
            Err(error) => return Err(invalid("signature.certificate_error", error)),
        }
        identity = certificate::subject_alternative_name(leaf);
        issuer = certificate::oidc_issuer(leaf);
        let matches = match (&policy.identity, &policy.identity_pattern) {
            (Some(exact), _) => identity.as_deref() == Some(exact.as_str()),
            (None, Some(pattern)) => identity
                .as_deref()
                .is_some_and(|value| pattern.is_match(value)),
            (None, None) => false,
        };
        if !matches {
            return Err(AttestationError::new(
                ErrorKind::IdentityMismatch,
                "identity.signer",
                format!(
                    "the signer is {}, which is not the certificate identity the policy names",
                    identity.as_deref().unwrap_or("unnamed")
                ),
            ));
        }
        if issuer != policy.issuer {
            return Err(AttestationError::new(
                ErrorKind::IdentityMismatch,
                "identity.issuer",
                format!(
                    "the signer's OIDC issuer is {}, expected {}",
                    issuer.as_deref().unwrap_or("unnamed"),
                    policy.issuer.as_deref().unwrap_or("")
                ),
            ));
        }
    }
    let mut time = None;
    if policy.entries > 0 || policy.timestamps > 0 {
        let transparency =
            transparency::verify_transparency(bundle, root, policy.entries, policy.timestamps);
        if !transparency.passed {
            let first = &transparency.reasons[0];
            let mut error = AttestationError::new(
                ErrorKind::TransparencyFailed,
                format!("transparency.{}", first.check),
                transparency
                    .reasons
                    .iter()
                    .map(|reason| reason.message.as_str())
                    .collect::<Vec<_>>()
                    .join(" "),
            );
            error.reasons = transparency.reasons;
            return Err(error);
        }
        time = transparency.time.map(clock::iso8601);
    }
    Ok(BundleOutcome {
        identity,
        issuer,
        key_id,
        time,
    })
}

/// Check one Sigstore bundle on its own: the signature, the signer against
/// the policy, and the log entries and timestamps. It does not look at what
/// the statement is about.
pub fn verify_bundle(bundle: &Value, options: &VerifyPolicy) -> Result<BundleOutcome, PrismError> {
    let policy = policy_of(options)?;
    let needed = !policy.keyed || policy.entries > 0 || policy.timestamps > 0;
    let root = check_root(&trusted_root_of(options, needed)?, &policy)?;
    Ok(verify_evidence(bundle, &policy, &root)?)
}

/// Check the transparency log entries and timestamps of one Sigstore bundle
/// against a pinned trusted root, offline (#275). Every check runs; the
/// result lists every problem at once. `entries` and `timestamps` are the
/// least number that must verify.
pub fn verify_transparency(
    bundle: &Value,
    trusted_root: &Value,
    entries: u64,
    timestamps: u64,
) -> Result<Transparency, PrismError> {
    let root = trust::read_trusted_root(trusted_root).map_err(trust_root)?;
    Ok(transparency::verify_transparency(
        bundle, &root, entries, timestamps,
    ))
}

/// Who signed a verified attestation.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Signer {
    /// The certificate identity, keyless.
    pub identity: Option<String>,
    /// The OIDC issuer, keyless.
    pub issuer: Option<String>,
    /// The key id, keyed.
    pub key_id: Option<String>,
}

/// The outcome for one attestation of the holo.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AttestationOutcome {
    /// Position in the attestation section, from zero.
    pub index: usize,
    /// The statement's `predicateType`.
    pub predicate_type: String,
    /// The subject names, in statement order.
    pub subjects: Vec<String>,
    /// Whether every check passed.
    pub passed: bool,
    /// The signer, when it passed.
    pub signer: Option<Signer>,
    /// The signed time, ISO 8601, when transparency evidence was required and it passed.
    pub time: Option<String>,
    /// The first failing check, when it did not pass.
    pub error: Option<AttestationError>,
}

/// The result of checking a holo's attestations against a policy.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct VerificationResult {
    /// The result document name.
    pub schema: &'static str,
    /// At least one attestation of the requested type passed every check.
    pub passed: bool,
    /// One outcome per attestation of the requested type.
    pub results: Vec<AttestationOutcome>,
    /// Why the result did not pass: the first failing attestation's error, or why none was checked.
    pub error: Option<AttestationError>,
}

impl VerificationResult {
    /// The canonical document, for `--json`.
    #[must_use]
    pub fn to_value(&self) -> Value {
        serde_json::to_value(self).expect("a verification result serializes")
    }
}

fn check_subjects(attestation: &Attestation) -> Result<(), AttestationError> {
    for subject in &attestation.subjects {
        if subject.blob.is_none() {
            return Err(AttestationError::new(
                ErrorKind::SubjectMismatch,
                "attestation.subject",
                format!(
                    "subject {} is not a content blob of this holo",
                    subject.name
                ),
            ));
        }
        if subject.sha256_matches != Some(true) {
            return Err(AttestationError::new(
                ErrorKind::SubjectMismatch,
                "attestation.subject",
                format!(
                    "subject {} names blake3:{} but its digests are not the blob's",
                    subject.name, subject.blake3
                ),
            ));
        }
    }
    Ok(())
}

/// Check the attestations of a holo against a signer policy. The result
/// passes when at least one bundle of the requested type passes every check,
/// as `cosign verify-attestation` does. The holo itself must verify first;
/// a holo with no matching bundle is `PP3106`, inside the result.
pub fn verify_attestations(
    holo: &[u8],
    options: &VerifyPolicy,
) -> Result<VerificationResult, PrismError> {
    let policy = policy_of(options)?;
    let all = read_attestations(holo)?;
    let matching = all
        .iter()
        .filter(|attestation| {
            options
                .predicate_type
                .as_deref()
                .is_none_or(|wanted| attestation.predicate_type == wanted)
        })
        .collect::<Vec<_>>();
    let mut results = Vec::new();
    let mut error = None;
    if matching.is_empty() {
        let found = all
            .iter()
            .map(|attestation| attestation.predicate_type.as_str())
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect::<Vec<_>>()
            .join(", ");
        error = Some(if all.is_empty() {
            AttestationError::new(
                ErrorKind::AttestationNotFound,
                "attestation.none",
                "the holo has no attestation section",
            )
        } else {
            AttestationError::new(
                ErrorKind::AttestationNotFound,
                "attestation.type",
                format!(
                    "none of the {} attestations has predicate type {}; found {found}",
                    all.len(),
                    options.predicate_type.as_deref().unwrap_or("")
                ),
            )
        });
    } else {
        let needed = !policy.keyed || policy.entries > 0 || policy.timestamps > 0;
        let root = check_root(&trusted_root_of(options, needed)?, &policy)?;
        for attestation in matching {
            let bundle: Value = serde_json::from_slice(&attestation.line).map_err(|error| {
                PrismError::new("PP3017", format!("bundle line is not UTF-8 JSON: {error}"))
            })?;
            let outcome =
                check_subjects(attestation).and_then(|()| verify_evidence(&bundle, &policy, &root));
            let mut entry = AttestationOutcome {
                index: attestation.index,
                predicate_type: attestation.predicate_type.clone(),
                subjects: attestation
                    .subjects
                    .iter()
                    .map(|subject| subject.name.clone())
                    .collect(),
                passed: false,
                signer: None,
                time: None,
                error: None,
            };
            match outcome {
                Ok(outcome) => {
                    entry.passed = true;
                    entry.signer = Some(Signer {
                        identity: outcome.identity,
                        issuer: outcome.issuer,
                        key_id: outcome.key_id,
                    });
                    entry.time = outcome.time;
                }
                Err(caught) => {
                    if error.is_none() {
                        error = Some(caught.clone());
                    }
                    entry.error = Some(caught);
                }
            }
            results.push(entry);
        }
        if results.iter().any(|entry| entry.passed) {
            error = None;
        }
    }
    Ok(VerificationResult {
        schema: VERIFICATION_SCHEMA,
        passed: error.is_none(),
        results,
        error,
    })
}

// ------------------------------------------------------------------------ attest

/// What to sign: the predicate, its type, the subjects and the key.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttestRequest {
    /// The statement's `predicateType`, a URI.
    pub predicate_type: String,
    /// The predicate, as JSON text.
    pub predicate: Vec<u8>,
    /// Subjects: a role (`guest`, `view`, `model`, `capabilities`), a `blake3:` label, or `name=<either>`. Empty means the guest.
    pub subjects: Vec<String>,
    /// An unencrypted PKCS#8 or SEC1 PEM private key.
    pub key: String,
}

/// The holo with the new bundle, and what was signed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Attested {
    /// The holo with the bundle appended to its attestation section.
    pub holo: Vec<u8>,
    /// The bundle as stored, one JSON line without its LF.
    pub bundle: Vec<u8>,
    /// The statement that was signed.
    pub statement: Value,
    /// The subject names, in statement order.
    pub subjects: Vec<String>,
    /// The key id (`publicKey.hint`) of the signing key.
    pub key_id: String,
    /// How many bundles the holo now carries.
    pub attestations: usize,
}

fn is_uri(text: &str) -> bool {
    let Some((scheme, rest)) = text.split_once(':') else {
        return false;
    };
    scheme.starts_with(|c: char| c.is_ascii_alphabetic())
        && scheme
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'.' | b'-'))
        && !rest.is_empty()
        && !rest.chars().any(char::is_whitespace)
}

struct ResolvedSubject {
    name: String,
    label: String,
    sha256: String,
}

/// The subjects of a statement over content blobs of the holo.
fn resolve_subjects(
    parsed: &crate::holo::archive::ParsedApplicationArchive,
    requests: &[String],
) -> Result<Vec<ResolvedSubject>, AttestationError> {
    let default = vec!["guest".to_owned()];
    let wanted: &[String] = if requests.is_empty() {
        &default
    } else {
        requests
    };
    let directory: Value = serde_json::from_slice(&parsed.directory).unwrap_or(Value::Null);
    let mut subjects = Vec::new();
    for request in wanted {
        if request.is_empty() {
            return Err(signing(
                "sign.subject",
                "a subject is a role or a blob label",
            ));
        }
        let (name, target) = match request.split_once('=') {
            Some((name, target)) if !name.is_empty() => (Some(name), target),
            _ => (None, request.as_str()),
        };
        let is_role = ROLES.contains(&target);
        let label = if is_role {
            let identities = &parsed.identities;
            match target {
                "guest" => Some(identities.guest_content_kappa.clone()),
                "view" => Some(identities.view_content_kappa.clone()),
                "model" => Some(identities.model_content_kappa.clone()),
                _ => directory
                    .get("requires_kappa")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
            }
        } else if target.len() == 71
            && target.starts_with("blake3:")
            && target[7..]
                .bytes()
                .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
        {
            Some(target.to_owned())
        } else {
            return Err(signing(
                "sign.subject",
                format!(
                    "subject {request:?} is neither a role ({}) nor a blake3 label",
                    ROLES.join(", ")
                ),
            ));
        };
        let label = label.ok_or_else(|| {
            signing(
                "sign.subject",
                format!("subject {target} has no blob in this holo"),
            )
        })?;
        let content = parsed.blobs.get(&label).ok_or_else(|| {
            signing(
                "sign.subject",
                format!("subject {label} is not a content blob of this holo"),
            )
        })?;
        subjects.push(ResolvedSubject {
            name: name.map(str::to_owned).unwrap_or_else(|| {
                if is_role {
                    target.to_owned()
                } else {
                    label.clone()
                }
            }),
            sha256: der::hex(&crypto::sha256(content)),
            label,
        });
    }
    let names = subjects
        .iter()
        .map(|subject| subject.name.as_str())
        .collect::<BTreeSet<_>>();
    if names.len() != subjects.len() {
        return Err(signing("sign.subject", "two subjects have the same name"));
    }
    Ok(subjects)
}

/// Sign a statement about a holo and return the holo with the bundle appended
/// to its attestation section. The input holo is not modified; it must verify.
pub fn attest(holo: &[u8], request: &AttestRequest) -> Result<Attested, PrismError> {
    if !is_uri(&request.predicate_type) {
        return Err(signing(
            "sign.predicate",
            "the predicate type must be a URI, such as https://slsa.dev/provenance/v1",
        )
        .into());
    }
    let predicate: Value = serde_json::from_slice(&request.predicate).map_err(|error| {
        signing(
            "sign.predicate",
            format!("the predicate is not JSON: {error}"),
        )
    })?;
    let key = crypto::SigningKey::from_pem(&request.key).map_err(|error| {
        signing(
            "sign.key",
            format!("the signing key cannot be read: {error}; expected an unencrypted PKCS#8 or SEC1 PEM"),
        )
    })?;
    let parsed = parse_application(holo)?;
    let subjects = resolve_subjects(&parsed, &request.subjects)?;
    // The statement text in the member order the JavaScript signer writes, so both read alike.
    let subject_text = subjects
        .iter()
        .map(|subject| {
            format!(
                r#"{{"name":{},"digest":{{"sha256":"{}","blake3":"{}"}}}}"#,
                serde_json::to_string(&subject.name).expect("a string serializes"),
                subject.sha256,
                &subject.label[7..]
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let payload = format!(
        r#"{{"_type":"{STATEMENT_TYPE}","subject":[{subject_text}],"predicateType":{},"predicate":{}}}"#,
        serde_json::to_string(&request.predicate_type).expect("a string serializes"),
        serde_json::to_string(&predicate).expect("a value serializes"),
    );
    let statement: Value = serde_json::from_str(&payload).expect("the statement is JSON");
    let signature = key.sign(&transparency::pae(DSSE_PAYLOAD_TYPE, payload.as_bytes()));
    let key_id = crypto::key_id(&key.spki());
    let bundle = format!(
        r#"{{"mediaType":"{BUNDLE_MEDIA_TYPE}","verificationMaterial":{{"publicKey":{{"hint":"{key_id}"}},"timestampVerificationData":{{}}}},"dsseEnvelope":{{"payload":"{}","payloadType":"{DSSE_PAYLOAD_TYPE}","signatures":[{{"sig":"{}","keyid":"{key_id}"}}]}}}}"#,
        STANDARD.encode(payload.as_bytes()),
        STANDARD.encode(&signature),
    )
    .into_bytes();
    let signed = attach_attestations(holo, std::slice::from_ref(&bundle))?;
    let attestations = read_attestations(&signed)?.len();
    Ok(Attested {
        holo: signed,
        bundle,
        statement,
        subjects: subjects.into_iter().map(|subject| subject.name).collect(),
        key_id,
        attestations,
    })
}
