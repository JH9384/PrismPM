//! Immutable authority resolution, acquisition, and scoped oracle execution.

use crate::contracts::CanonicalDocument;
use crate::error::PrismError;
use crate::holo::canonical::{content_id, decode_value, encode_value};
use fs4::fs_std::FileExt;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha1::Sha1;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

const CATALOG: &str = include_str!("../model/authorities.toml");
const WRAPPER_SOURCE: &[u8] = include_bytes!("authority.rs");
const UPSTREAM_CONFORMANCE_SOURCE: &[u8] = include_bytes!("upstream_conformance.rs");
const ASYNCAPI_WRAPPER_SOURCE: &[u8] = include_bytes!("../sdk/oracles/asyncapi-parser.mjs");
const KUBERNETES_WRAPPER_SOURCE: &[u8] = include_bytes!("../sdk/oracles/kubernetes-validator.mjs");
const INTOTO_WRAPPER_SOURCE: &[u8] =
    include_bytes!("../sdk/oracles/go/intoto-statement-validator/main.go");
const OPENAPI_SCHEMA: &[u8] =
    include_bytes!("../standards/oracles/openapi-3.2-schema-2025-11-23.json");
const OSV_SCHEMA: &[u8] = include_bytes!("../standards/oracles/osv-b388-schema.json");
const SIGSTORE_TRUSTED_ROOT: &[u8] =
    include_bytes!("../standards/trust/sigstore-trusted-root-cosign-3.1.3.json");
const SUDO_BMITCH_OPENPGP_ROOT: &[u8] =
    include_bytes!("../standards/trust/github-sudo-bmitch-openpgp-6e0ff28c767a8bee.asc");
const AKIHIROSUDA_OPENPGP_ROOT: &[u8] =
    include_bytes!("../standards/trust/github-akihirosuda-openpgp-49524c6f9f638f1a.asc");
const HAYDEN_IO_SSH_ROOT: &[u8] =
    include_bytes!("../standards/trust/github-hayden-io-ssh-zjmejzisa.pub");
const SONGY23_SSH_ROOT: &[u8] =
    include_bytes!("../standards/trust/github-songy23-ssh-sfmatr1d.pub");

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Authorities {
    spec: String,
    authority: Vec<AuthorityRow>,
    #[serde(default)]
    oracle: Vec<OracleRow>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct AuthorityRow {
    id: String,
    name: String,
    issuer: String,
    canonical_identifier: String,
    edition: String,
    source_role: String,
    immutable_url: String,
    revision: String,
    acquired_sha256: String,
    signature: String,
    #[serde(default)]
    signature_trust_root: Option<SignatureTrustRoot>,
    media_type: String,
    license: String,
    redistribution: String,
    retrieval_date: String,
    supersession_policy: String,
    statement: String,
    realized_by: Vec<String>,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct SignatureTrustRoot {
    algorithm: String,
    path: String,
    sha256: String,
    fingerprint: String,
    owner: String,
    source_url: String,
    source_record_id: String,
    license: String,
    redistribution: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OracleRow {
    id: String,
    authority_ids: Vec<String>,
    edition: String,
    executable: String,
    supported_platforms: Vec<String>,
    input_media_types: Vec<String>,
    output_schema: String,
    arguments: Vec<String>,
    timeout_ms: u64,
    memory_bytes: u64,
    output_bytes: u64,
    network: String,
    normalization: String,
    covers: Vec<String>,
    does_not_cover: Vec<String>,
    expected_exits: Vec<String>,
    upstream_payload_sha256: String,
    #[serde(default)]
    corpus: Option<OracleCorpus>,
    #[serde(default)]
    subject: Option<String>,
    #[serde(default)]
    trusted_root: Option<OracleTrustRoot>,
    wrapper_source: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OracleCorpus {
    path: String,
    sha256: String,
}

#[derive(Debug, Clone, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct OracleTrustRoot {
    path: String,
    sha256: String,
    role: String,
}

/// Result of explicit standards-lock resolution.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ResolveResult {
    /// Stable result schema.
    pub schema: String,
    /// Content identity of the complete canonical lock.
    pub lock_digest: String,
    /// Project-relative lock path.
    pub path: String,
    /// Number of authority bindings.
    pub authorities: u64,
    /// Number of separately bound oracles.
    pub oracles: u64,
    /// Whether locked mode compared without writing.
    pub unchanged: bool,
}

/// Result of explicit immutable input acquisition.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FetchResult {
    /// Stable result schema.
    pub schema: String,
    /// Standards-lock digest.
    pub lock_digest: String,
    /// Newly downloaded immutable objects.
    pub fetched: u64,
    /// Already-present byte-verified immutable objects.
    pub reused: u64,
}

/// Result of offline authority and cache verification.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AuthorityVerifyResult {
    /// Stable result schema.
    pub schema: String,
    /// Standards-lock digest.
    pub lock_digest: String,
    /// Number of verified acquired objects.
    pub acquired_objects: u64,
    /// Number of lawful binding-only authority records.
    pub binding_only: u64,
    /// Canonical in-toto validation statement digest.
    pub attestation_digest: String,
    /// Project-relative validation statement path.
    pub evidence_path: String,
    /// Verification is always offline.
    pub offline: bool,
}

/// Result of one isolated, scoped oracle invocation.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct OracleResult {
    /// Stable result schema.
    pub schema: String,
    /// Oracle identifier.
    pub oracle: String,
    /// Digest of the complete locked oracle execution contract.
    pub oracle_digest: String,
    /// Subject digest.
    pub subject: String,
    /// Exact covered requirements.
    pub covered: Vec<String>,
    /// Exact uncovered requirements.
    pub uncovered: Vec<String>,
    /// Normalized result.
    pub valid: bool,
    /// Digest of the canonical in-toto validation statement.
    pub attestation_digest: String,
    /// Project-relative statement path when a project root was supplied.
    pub evidence_path: Option<String>,
}

fn catalog() -> Result<Authorities, PrismError> {
    let catalog: Authorities = toml::from_str(CATALOG)
        .map_err(|error| PrismError::new("PP9001", format!("authority catalog: {error}")))?;
    if catalog.spec != "prismpm/authorities/2" {
        return Err(PrismError::new(
            "PP9001",
            "embedded authority catalog has the wrong schema",
        ));
    }
    for authority in &catalog.authority {
        let signed = authority.signature.starts_with("signed-tag-object:");
        let root_valid = authority.signature_trust_root.as_ref().is_some_and(|root| {
            signature_trust_root_bytes(&root.path)
                .is_some_and(|bytes| root.sha256 == format!("{:x}", Sha256::digest(bytes)))
        });
        if signed != root_valid {
            return Err(PrismError::new(
                "PP9001",
                format!(
                    "{} has an invalid signature trust-root binding",
                    authority.id
                ),
            ));
        }
    }
    for oracle in &catalog.oracle {
        let has_trusted_root_argument = oracle
            .arguments
            .iter()
            .any(|argument| argument == "{trusted-root}");
        match &oracle.trusted_root {
            Some(root)
                if has_trusted_root_argument
                    && root.path == "standards/trust/sigstore-trusted-root-cosign-3.1.3.json"
                    && root.role == "sigstore-verification-root"
                    && root.sha256 == format!("{:x}", Sha256::digest(SIGSTORE_TRUSTED_ROOT)) => {}
            None if !has_trusted_root_argument => {}
            _ => {
                return Err(PrismError::new(
                    "PP9001",
                    format!("{} has an invalid trusted-root binding", oracle.id),
                ))
            }
        }
    }
    Ok(catalog)
}

fn signature_trust_root_bytes(path: &str) -> Option<&'static [u8]> {
    match path {
        "standards/trust/github-sudo-bmitch-openpgp-6e0ff28c767a8bee.asc" => {
            Some(SUDO_BMITCH_OPENPGP_ROOT)
        }
        "standards/trust/github-akihirosuda-openpgp-49524c6f9f638f1a.asc" => {
            Some(AKIHIROSUDA_OPENPGP_ROOT)
        }
        "standards/trust/github-hayden-io-ssh-zjmejzisa.pub" => Some(HAYDEN_IO_SSH_ROOT),
        "standards/trust/github-songy23-ssh-sfmatr1d.pub" => Some(SONGY23_SSH_ROOT),
        _ => None,
    }
}

fn oracle_ids<'a>(catalog: &'a Authorities, authority: &str) -> Vec<&'a str> {
    catalog
        .oracle
        .iter()
        .filter(|row| row.authority_ids.iter().any(|id| id == authority))
        .map(|row| row.id.as_str())
        .collect()
}

fn authority_value(row: &AuthorityRow, catalog: &Authorities) -> Value {
    let fetched = row.source_role != "binding-only";
    json!({
        "canonical_id": row.canonical_identifier,
        "edition": row.edition,
        "id": row.id,
        "issuer": row.issuer,
        "name": row.name,
        "oracle_ids": oracle_ids(catalog, &row.id),
        "realized_by": row.realized_by,
        "retrieval_date": row.retrieval_date,
        "schema": "prismpm/authority-binding/1",
        "source": {
            "license": row.license,
            "media_type": row.media_type,
            "redistribution": row.redistribution,
            "revision": fetched.then_some(row.revision.as_str()),
            "sha256": fetched.then_some(row.acquired_sha256.as_str()),
            "signature": row.signature,
            "url": row.immutable_url
        },
        "source_role": row.source_role,
        "signature_trust_root": row.signature_trust_root,
        "statement": row.statement,
        "supersession": row.supersession_policy
    })
}

fn oracle_value(row: &OracleRow, wrapper_sha256: &str) -> Value {
    json!({
        "arguments": row.arguments,
        "authority_ids": row.authority_ids,
        "covers": row.covers,
        "corpus": row.corpus,
        "does_not_cover": row.does_not_cover,
        "edition": row.edition,
        "executable": row.executable,
        "expected_exits": row.expected_exits,
        "failure_mapping": {"invalid":"PP5404","unavailable-or-untrusted":"PP5403"},
        "id": row.id,
        "input_media_types": row.input_media_types,
        "memory_bytes": row.memory_bytes,
        "network": row.network,
        "normalization": row.normalization,
        "output_bytes": row.output_bytes,
        "output_schema": row.output_schema,
        "supported_platforms":row.supported_platforms,
        "subject": row.subject,
        "timeout_ms": row.timeout_ms,
        "trusted_root": row.trusted_root,
        "upstream_payload_sha256": row.upstream_payload_sha256,
        "wrapper_sha256": wrapper_sha256
    })
}

fn wrapper_sha256(row: &OracleRow) -> Result<String, PrismError> {
    let bytes = match row.wrapper_source.as_str() {
        "crates/prismpm/src/authority.rs" => WRAPPER_SOURCE,
        "crates/prismpm/src/upstream_conformance.rs" => UPSTREAM_CONFORMANCE_SOURCE,
        "sdk/oracles/asyncapi-parser.mjs" => ASYNCAPI_WRAPPER_SOURCE,
        "sdk/oracles/kubernetes-validator.mjs" => KUBERNETES_WRAPPER_SOURCE,
        "sdk/oracles/go/intoto-statement-validator/main.go" => INTOTO_WRAPPER_SOURCE,
        _ => {
            return Err(PrismError::new(
                "PP5402",
                format!("oracle {} has an unembedded wrapper source", row.id),
            ))
        }
    };
    Ok(format!("{:x}", Sha256::digest(bytes)))
}

fn resolved_lock() -> Result<CanonicalDocument, PrismError> {
    let catalog = catalog()?;
    let mut authorities = catalog.authority.iter().collect::<Vec<_>>();
    authorities.sort_by(|left, right| left.id.as_bytes().cmp(right.id.as_bytes()));
    let mut oracles = catalog.oracle.iter().collect::<Vec<_>>();
    oracles.sort_by(|left, right| left.id.as_bytes().cmp(right.id.as_bytes()));
    let oracle_values = oracles
        .iter()
        .map(|row| wrapper_sha256(row).map(|digest| oracle_value(row, &digest)))
        .collect::<Result<Vec<_>, _>>()?;
    let body = json!({
        "authorities": authorities.iter().map(|row| authority_value(row, &catalog)).collect::<Vec<_>>(),
        "oracles": oracle_values,
        "schema": "prismpm/standards-lock/1"
    });
    let lock_id = format!("sha256:{}", content_id(&encode_value(&body)?));
    let mut value = body;
    value["lock_id"] = Value::String(lock_id);
    CanonicalDocument::from_value("prismpm/standards-lock/1", value)
}

fn lock_path(root: &Path) -> PathBuf {
    root.join("standards.lock")
}

fn parse_lock(root: &Path) -> Result<CanonicalDocument, PrismError> {
    let path = lock_path(root);
    let bytes = std::fs::read(&path)
        .map_err(|error| PrismError::new("PP1101", format!("{}: {error}", path.display())))?;
    let lock = CanonicalDocument::parse("prismpm/standards-lock/1", &bytes)?;
    let mut body = lock.value().clone();
    let declared = body
        .as_object_mut()
        .and_then(|object| object.remove("lock_id"))
        .and_then(|value| value.as_str().map(str::to_owned))
        .ok_or_else(|| PrismError::new("PP1101", "standards lock omits lock_id"))?;
    let actual = format!("sha256:{}", content_id(&encode_value(&body)?));
    if actual != declared {
        return Err(PrismError::new(
            "PP1101",
            "standards lock identity does not match its canonical body",
        ));
    }
    Ok(lock)
}

fn atomic_write(path: &Path, bytes: &[u8]) -> Result<(), PrismError> {
    let parent = path
        .parent()
        .ok_or_else(|| PrismError::new("PP8001", "lock path has no parent"))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", parent.display())))?;
    let staging = tempfile::Builder::new()
        .prefix("authority-")
        .tempfile_in(parent)
        .map_err(|error| PrismError::new("PP4002", format!("lock staging: {error}")))?;
    let (mut file, temporary) = staging
        .keep()
        .map_err(|error| PrismError::new("PP4002", format!("lock staging: {error}")))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("lock write: {error}")))?;
    std::fs::rename(&temporary, path)
        .map_err(|error| PrismError::new("PP4002", format!("lock publish: {error}")))?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("lock directory: {error}")))
}

/// Resolve the embedded reviewed catalog into a canonical project lock.
pub fn resolve(root: &Path, locked: bool) -> Result<ResolveResult, PrismError> {
    let expected = resolved_lock()?;
    let path = lock_path(root);
    let unchanged =
        path.is_file() && std::fs::read(&path).ok().as_deref() == Some(expected.bytes());
    if locked && !unchanged {
        return Err(PrismError::new(
            "PP1101",
            "--locked authority resolution found missing or changed standards.lock",
        ));
    }
    if !locked && !unchanged {
        atomic_write(&path, expected.bytes())?;
    }
    let authorities = expected.value()["authorities"]
        .as_array()
        .map_or(0, |rows| rows.len() as u64);
    let oracles = expected.value()["oracles"]
        .as_array()
        .map_or(0, |rows| rows.len() as u64);
    Ok(ResolveResult {
        schema: "prismpm/authority-result/1".to_owned(),
        lock_digest: expected.digest(),
        path: "standards.lock".to_owned(),
        authorities,
        oracles,
        unchanged,
    })
}

fn sha256_file(path: &Path) -> Result<String, PrismError> {
    let mut file = File::open(path)
        .map_err(|error| PrismError::new("PP5402", format!("{}: {error}", path.display())))?;
    let mut digest = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = file
            .read(&mut buffer)
            .map_err(|error| PrismError::new("PP5402", format!("{}: {error}", path.display())))?;
        if count == 0 {
            break;
        }
        digest.update(&buffer[..count]);
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn acquired_rows(lock: &CanonicalDocument) -> Result<Vec<(String, String)>, PrismError> {
    let rows = lock.value()["authorities"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP1101", "standards lock authorities are absent"))?;
    let mut unique = BTreeMap::new();
    for row in rows {
        let source = &row["source"];
        if let Some(digest) = source["sha256"].as_str() {
            let url = source["url"]
                .as_str()
                .ok_or_else(|| PrismError::new("PP1101", "authority URL is absent"))?;
            match unique.insert(digest.to_owned(), url.to_owned()) {
                Some(previous) if previous != url => {
                    return Err(PrismError::new(
                        "PP1101",
                        "one authority digest is bound to multiple URLs",
                    ));
                }
                _ => {}
            }
        }
    }
    Ok(unique.into_iter().collect())
}

fn download_https(url: &str, destination: &Path, maximum_bytes: u64) -> Result<(), PrismError> {
    let status = Command::new("/usr/bin/curl")
        .env_clear()
        .args([
            "--disable",
            "--fail",
            "--location",
            "--max-filesize",
            &maximum_bytes.to_string(),
            "--max-time",
            "1200",
            "--connect-timeout",
            "30",
            "--retry",
            "3",
            "--retry-all-errors",
            "--proto-redir",
            "=https",
            "--silent",
            "--show-error",
            "--proto",
            "=https",
            "--tlsv1.2",
            "--user-agent",
            "PrismPM-authority-fetch/0.4.0",
        ])
        .arg("--output")
        .arg(destination)
        .arg(url)
        .status()
        .map_err(|error| PrismError::new("PP5401", format!("start curl: {error}")))?;
    if !status.success() {
        return Err(PrismError::new(
            "PP5401",
            format!("authority download failed for {url}"),
        ));
    }
    Ok(())
}

fn signature_evidence_path(root: &Path, tag_object: &str) -> PathBuf {
    root.join(".prism/cache/authorities/git-tag-sha1")
        .join(format!("{tag_object}.json"))
}

fn git_tag_sha1(payload: &str, signature: &str) -> String {
    let body = format!("{payload}{signature}");
    let header = format!("tag {}\0", body.len());
    let mut hasher = Sha1::new();
    hasher.update(header.as_bytes());
    hasher.update(body.as_bytes());
    format!("{:x}", hasher.finalize())
}

fn validate_signature_evidence(authority: &Value, bytes: &[u8]) -> Result<Value, PrismError> {
    let evidence = decode_value(bytes, "authority signature evidence")?;
    if encode_value(&evidence)? != bytes {
        return Err(PrismError::new(
            "PP5402",
            "authority signature evidence is not canonical",
        ));
    }
    let signature_policy = authority["source"]["signature"]
        .as_str()
        .and_then(|value| value.strip_prefix("signed-tag-object:"))
        .ok_or_else(|| PrismError::new("PP5402", "signed tag policy is malformed"))?;
    let revision = authority["source"]["revision"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signed tag target is absent"))?;
    let repository = authority["canonical_id"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signed tag repository is absent"))?;
    let payload = evidence["payload"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signed tag payload is absent"))?;
    let signature = evidence["signature"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signed tag signature is absent"))?;
    if evidence["schema"] != "prismpm/github-tag-verification/1"
        || evidence["authority"] != authority["id"]
        || evidence["provider"] != "github"
        || evidence["repository"] != repository
        || evidence["tag_object_sha1"] != signature_policy
        || evidence["target_revision"] != revision
        || evidence["verification"] != "valid"
        || !payload.starts_with(&format!("object {revision}\ntype commit\n"))
        || git_tag_sha1(payload, signature) != signature_policy
    {
        return Err(PrismError::new(
            "PP5402",
            format!("signed tag evidence is invalid for {}", authority["id"]),
        ));
    }
    Ok(evidence)
}

fn signature_evidence_from_github(
    authority: &Value,
    response: &[u8],
) -> Result<Vec<u8>, PrismError> {
    let response: Value = serde_json::from_slice(response)
        .map_err(|error| PrismError::new("PP5402", format!("GitHub tag response: {error}")))?;
    let tag_object = authority["source"]["signature"]
        .as_str()
        .and_then(|value| value.strip_prefix("signed-tag-object:"))
        .ok_or_else(|| PrismError::new("PP5402", "signed tag policy is malformed"))?;
    let revision = authority["source"]["revision"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signed tag target is absent"))?;
    let verification = &response["verification"];
    let signature = verification["signature"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "GitHub omitted the tag signature"))?;
    let payload = verification["payload"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "GitHub omitted the signed tag payload"))?;
    if response["sha"] != tag_object
        || response["object"]["sha"] != revision
        || response["object"]["type"] != "commit"
        || verification["verified"] != true
        || verification["reason"] != "valid"
        || git_tag_sha1(payload, signature) != tag_object
    {
        return Err(PrismError::new(
            "PP5402",
            format!("GitHub did not verify the tag for {}", authority["id"]),
        ));
    }
    encode_value(&json!({
        "authority":authority["id"],
        "payload":payload,
        "provider":"github",
        "repository":authority["canonical_id"],
        "schema":"prismpm/github-tag-verification/1",
        "signature":signature,
        "tag_object_sha1":tag_object,
        "target_revision":revision,
        "verification":"valid"
    }))
}

fn replay_tag_signature(
    root: &Path,
    authority: &Value,
    evidence: &Value,
) -> Result<Value, PrismError> {
    let trust = &authority["signature_trust_root"];
    let algorithm = trust["algorithm"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signature trust-root algorithm is absent"))?;
    let path = trust["path"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signature trust-root path is absent"))?;
    let digest = trust["sha256"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signature trust-root digest is absent"))?;
    let fingerprint = trust["fingerprint"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5402", "signature trust-root fingerprint is absent"))?;
    let key = signature_trust_root_bytes(path)
        .ok_or_else(|| PrismError::new("PP5402", "signature trust-root bytes are unavailable"))?;
    if format!("{:x}", Sha256::digest(key)) != digest {
        return Err(PrismError::new(
            "PP5402",
            "signature trust-root bytes do not match the reviewed digest",
        ));
    }
    let temporary = tempfile::tempdir()
        .map_err(|error| PrismError::new("PP5403", format!("signature replay: {error}")))?;
    let subject = temporary.path().join("tag-payload");
    let signature = temporary.path().join("tag-signature");
    let trusted_root = temporary.path().join("trusted-root");
    std::fs::write(
        &subject,
        evidence["payload"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP5402", "signed tag payload is absent"))?
            .as_bytes(),
    )
    .and_then(|()| {
        std::fs::write(
            &signature,
            evidence["signature"]
                .as_str()
                .ok_or_else(|| std::io::Error::other("signed tag signature is absent"))?
                .as_bytes(),
        )
    })
    .and_then(|()| std::fs::write(&trusted_root, key))
    .map_err(|error| PrismError::new("PP5402", format!("signature replay input: {error}")))?;
    let oracle = OracleRow {
        id: "git-tag-signature".to_owned(),
        authority_ids: vec![authority["id"].as_str().unwrap_or_default().to_owned()],
        edition: "1".to_owned(),
        executable: "git-signature-validator".to_owned(),
        supported_platforms: vec!["linux/amd64".to_owned(), "linux/arm64".to_owned()],
        input_media_types: vec!["application/vnd.git.tag-payload".to_owned()],
        output_schema: "prismpm/validation-result/1".to_owned(),
        arguments: vec![
            "--format".to_owned(),
            algorithm.to_owned(),
            "--trusted-root".to_owned(),
            "{trusted-root}".to_owned(),
            "--fingerprint".to_owned(),
            fingerprint.to_owned(),
            "--signature".to_owned(),
            "{signature}".to_owned(),
            "{subject}".to_owned(),
        ],
        timeout_ms: 30_000,
        memory_bytes: 268_435_456,
        output_bytes: 1_048_576,
        network: "deny".to_owned(),
        normalization: "prismpm/oracle-diagnostics/1".to_owned(),
        covers: vec!["exact annotated-tag signature and signer fingerprint".to_owned()],
        does_not_cover: vec![
            "signer authorization beyond the pinned upstream account key".to_owned(),
        ],
        expected_exits: vec!["0=pass".to_owned(), "4=invalid".to_owned()],
        upstream_payload_sha256: authority["source"]["sha256"]
            .as_str()
            .unwrap_or_default()
            .to_owned(),
        corpus: None,
        subject: None,
        trusted_root: Some(OracleTrustRoot {
            path: path.to_owned(),
            sha256: digest.to_owned(),
            role: "git-tag-signing-key".to_owned(),
        }),
        wrapper_source: "sdk/oracles/git-signature-validator.mjs".to_owned(),
    };
    let bindings = BTreeMap::from([
        ("signature".to_owned(), signature.display().to_string()),
        ("subject".to_owned(), subject.display().to_string()),
        (
            "trusted-root".to_owned(),
            trusted_root.display().to_string(),
        ),
    ]);
    run_external_oracle(root, &oracle, &subject, &bindings)?;
    let mut verified = evidence.clone();
    verified["offline_verification"] = json!({
        "algorithm": algorithm,
        "fingerprint": fingerprint,
        "runner": "git-signature-validator/1"
    });
    Ok(verified)
}

fn verify_signature_evidence_set(
    root: &Path,
    lock: &CanonicalDocument,
    acquire: bool,
) -> Result<(u64, u64, Vec<Value>), PrismError> {
    let authorities = lock.value()["authorities"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP5402", "standards lock authorities are absent"))?;
    let cache = root.join(".prism/cache/authorities/git-tag-sha1");
    if acquire {
        std::fs::create_dir_all(&cache)
            .map_err(|error| PrismError::new("PP5401", format!("signature cache: {error}")))?;
    }
    let mut fetched = 0;
    let mut reused = 0;
    let mut evidence = Vec::new();
    for authority in authorities {
        let Some(tag_object) = authority["source"]["signature"]
            .as_str()
            .and_then(|value| value.strip_prefix("signed-tag-object:"))
        else {
            continue;
        };
        let repository = authority["canonical_id"]
            .as_str()
            .filter(|value| {
                value.split('/').count() == 2
                    && value.bytes().all(|byte| {
                        byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b'/')
                    })
            })
            .ok_or_else(|| PrismError::new("PP5402", "signed tag repository is malformed"))?;
        let destination = signature_evidence_path(root, tag_object);
        if destination.is_file() {
            let bytes = std::fs::read(&destination)
                .map_err(|error| PrismError::new("PP5402", format!("signature cache: {error}")))?;
            let value = validate_signature_evidence(authority, &bytes)?;
            evidence.push(replay_tag_signature(root, authority, &value)?);
            reused += 1;
            continue;
        }
        if !acquire {
            return Err(PrismError::new(
                "PP5402",
                format!(
                    "verified signature evidence is absent for {}",
                    authority["id"]
                ),
            ));
        }
        let staging = tempfile::Builder::new()
            .prefix("github-tag-")
            .tempfile_in(&cache)
            .map_err(|error| PrismError::new("PP5401", format!("signature staging: {error}")))?;
        let url = format!("https://api.github.com/repos/{repository}/git/tags/{tag_object}");
        download_https(&url, staging.path(), 2_097_152)?;
        let response = std::fs::read(staging.path())
            .map_err(|error| PrismError::new("PP5402", format!("signature response: {error}")))?;
        let bytes = signature_evidence_from_github(authority, &response)?;
        let value = validate_signature_evidence(authority, &bytes)?;
        let mut file = OpenOptions::new()
            .write(true)
            .truncate(true)
            .open(staging.path())
            .map_err(|error| PrismError::new("PP5401", format!("signature staging: {error}")))?;
        file.write_all(&bytes)
            .and_then(|()| file.sync_all())
            .map_err(|error| PrismError::new("PP5401", format!("signature staging: {error}")))?;
        let (_file, temporary) = staging
            .keep()
            .map_err(|error| PrismError::new("PP5401", format!("signature staging: {error}")))?;
        std::fs::rename(temporary, &destination)
            .map_err(|error| PrismError::new("PP5401", format!("signature publish: {error}")))?;
        let mut permissions = std::fs::metadata(&destination)
            .map_err(|error| PrismError::new("PP5401", format!("signature metadata: {error}")))?
            .permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&destination, permissions).map_err(|error| {
            PrismError::new("PP5401", format!("signature permissions: {error}"))
        })?;
        File::open(&cache)
            .and_then(|directory| directory.sync_all())
            .map_err(|error| PrismError::new("PP5401", format!("signature cache sync: {error}")))?;
        evidence.push(replay_tag_signature(root, authority, &value)?);
        fetched += 1;
    }
    Ok((fetched, reused, evidence))
}

fn lowercase_hex(value: &str, length: usize) -> bool {
    value.len() == length
        && value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

#[derive(Clone, Copy)]
enum LockVerificationProfile {
    ReviewedCatalog,
    ReviewedCatalogAsBindingOnly,
}

fn binding_only_verification_lock() -> Result<CanonicalDocument, PrismError> {
    let mut value = resolved_lock()?.value().clone();
    let authorities = value["authorities"]
        .as_array_mut()
        .ok_or_else(|| PrismError::new("PP9001", "reviewed catalog authorities are absent"))?;
    for authority in authorities {
        authority["source_role"] = Value::String("binding-only".to_owned());
        authority["source"]["revision"] = Value::Null;
        authority["source"]["sha256"] = Value::Null;
        authority["source"]["signature"] = Value::String("not-published".to_owned());
    }
    value
        .as_object_mut()
        .ok_or_else(|| PrismError::new("PP9001", "reviewed catalog lock is malformed"))?
        .remove("lock_id");
    let body = encode_value(&value)?;
    value["lock_id"] = Value::String(format!("sha256:{}", content_id(&body)));
    CanonicalDocument::from_value("prismpm/standards-lock/1", value)
}

fn verify_lock_bindings(
    lock: &CanonicalDocument,
    profile: LockVerificationProfile,
) -> Result<(), PrismError> {
    let reviewed = resolved_lock()?;
    let exact_reviewed = lock.bytes() == reviewed.bytes();
    let exact_binding_only = matches!(
        profile,
        LockVerificationProfile::ReviewedCatalogAsBindingOnly
    ) && lock.bytes() == binding_only_verification_lock()?.bytes();
    if !exact_reviewed && !exact_binding_only {
        return Err(PrismError::new(
            "PP5402",
            "standards lock is stale or differs from the exact reviewed catalog profile",
        ));
    }
    let authorities = lock.value()["authorities"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP5402", "standards lock authorities are absent"))?;
    let known = authorities
        .iter()
        .filter_map(|row| row["id"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    for authority in authorities {
        let source = authority["source"]
            .as_object()
            .ok_or_else(|| PrismError::new("PP5402", "authority source binding is malformed"))?;
        let signature = source
            .get("signature")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP5402", "authority signature policy is absent"))?;
        let recognized = matches!(
            signature,
            "not-published"
                | "not-published-or-not-relied-upon"
                | "gcs-generation-and-acquired-sha256"
        ) || signature
            .strip_prefix("signed-tag-object:")
            .is_some_and(|digest| lowercase_hex(digest, 40));
        if !recognized {
            return Err(PrismError::new(
                "PP5402",
                "authority signature policy is unrecognized or malformed",
            ));
        }
        match (
            source.get("sha256").and_then(Value::as_str),
            source.get("url").and_then(Value::as_str),
        ) {
            (Some(digest), Some(url))
                if lowercase_hex(digest, 64)
                    && url.starts_with("https://")
                    && !url.contains('#') => {}
            (None, Some(_)) if authority["source_role"] == "binding-only" => {}
            _ => {
                return Err(PrismError::new(
                    "PP5402",
                    "authority acquisition binding is incomplete or mutable",
                ))
            }
        }
    }
    let oracles = lock.value()["oracles"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP5402", "standards lock oracles are absent"))?;
    let reviewed_catalog = catalog()?;
    for oracle in oracles {
        let expected_wrapper = reviewed_catalog
            .oracle
            .iter()
            .find(|row| oracle["id"] == row.id)
            .ok_or_else(|| PrismError::new("PP5402", "standards lock has an unknown oracle"))
            .and_then(wrapper_sha256)?;
        if oracle["wrapper_sha256"] != expected_wrapper
            || !matches!(
                oracle["network"].as_str(),
                Some("deny" | "isolated-subject")
            )
            || oracle["failure_mapping"]["invalid"] != "PP5404"
            || oracle["failure_mapping"]["unavailable-or-untrusted"] != "PP5403"
            || oracle["supported_platforms"] != json!(["linux/amd64", "linux/arm64"])
            || oracle["authority_ids"].as_array().is_none_or(|ids| {
                ids.is_empty()
                    || ids
                        .iter()
                        .any(|id| id.as_str().is_none_or(|id| !known.contains(id)))
            })
            || oracle["upstream_payload_sha256"]
                .as_str()
                .is_none_or(|digest| !lowercase_hex(digest, 64))
            || oracle["corpus"].as_object().is_some_and(|corpus| {
                corpus
                    .get("path")
                    .and_then(Value::as_str)
                    .is_none_or(|path| !path.starts_with("standards/") || path.contains(".."))
                    || corpus
                        .get("sha256")
                        .and_then(Value::as_str)
                        .is_none_or(|digest| !lowercase_hex(digest, 64))
            })
        {
            return Err(PrismError::new(
                "PP5402",
                "oracle authority, wrapper, network, or payload binding is invalid",
            ));
        }
    }
    Ok(())
}

fn cache_object(root: &Path, digest: &str) -> PathBuf {
    root.join(".prism/cache/authorities/sha256").join(digest)
}

/// Fetch every acquired authority object, checking bytes before atomic publication.
pub fn fetch(root: &Path) -> Result<FetchResult, PrismError> {
    let lock = parse_lock(root)?;
    verify_lock_bindings(&lock, LockVerificationProfile::ReviewedCatalog)?;
    let cache = root.join(".prism/cache/authorities/sha256");
    std::fs::create_dir_all(&cache)
        .map_err(|error| PrismError::new("PP5401", format!("{}: {error}", cache.display())))?;
    let lock_file_path = root.join(".prism/cache/authorities/.lock");
    let lock_file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_file_path)
        .map_err(|error| PrismError::new("PP5401", format!("cache lock: {error}")))?;
    lock_file
        .lock_exclusive()
        .map_err(|error| PrismError::new("PP5401", format!("cache lock: {error}")))?;
    let mut fetched = 0_u64;
    let mut reused = 0_u64;
    for (digest, url) in acquired_rows(&lock)? {
        let destination = cache_object(root, &digest);
        if destination.is_file() && sha256_file(&destination)? == digest {
            reused += 1;
            continue;
        }
        if destination.exists() {
            return Err(PrismError::new(
                "PP5402",
                format!("cached authority object {digest} has changed"),
            ));
        }
        let staging = tempfile::Builder::new()
            .prefix("download-")
            .tempfile_in(&cache)
            .map_err(|error| PrismError::new("PP5401", format!("download staging: {error}")))?;
        let staging_path = staging.path().to_path_buf();
        // Some upstream vulnerability-database snapshots legitimately exceed
        // 512 MiB (the locked Ubuntu OSV snapshot is currently about 642
        // MiB). Keep a finite, fail-closed transfer bound while allowing the
        // complete authoritative snapshot to be acquired.
        download_https(&url, &staging_path, 1_073_741_824)?;
        if sha256_file(&staging_path)? != digest {
            return Err(PrismError::new(
                "PP5402",
                format!("authority bytes disagree with locked digest {digest}"),
            ));
        }
        let (_file, persisted) = staging
            .keep()
            .map_err(|error| PrismError::new("PP5401", format!("cache staging: {error}")))?;
        std::fs::rename(persisted, &destination)
            .map_err(|error| PrismError::new("PP5401", format!("cache publish: {error}")))?;
        let mut permissions = std::fs::metadata(&destination)
            .map_err(|error| PrismError::new("PP5401", format!("cache metadata: {error}")))?
            .permissions();
        permissions.set_readonly(true);
        std::fs::set_permissions(&destination, permissions)
            .map_err(|error| PrismError::new("PP5401", format!("cache permissions: {error}")))?;
        File::open(&destination)
            .and_then(|file| file.sync_all())
            .and_then(|()| File::open(&cache)?.sync_all())
            .map_err(|error| PrismError::new("PP5401", format!("cache sync: {error}")))?;
        fetched += 1;
    }
    let (signature_fetched, signature_reused, _) =
        verify_signature_evidence_set(root, &lock, true)?;
    fetched += signature_fetched;
    reused += signature_reused;
    drop(lock_file);
    Ok(FetchResult {
        schema: "prismpm/fetch-result/1".to_owned(),
        lock_digest: lock.digest(),
        fetched,
        reused,
    })
}

/// Verify the full standards lock from a populated cache without network access.
pub fn verify(root: &Path) -> Result<AuthorityVerifyResult, PrismError> {
    let lock = parse_lock(root)?;
    verify_lock_bindings(&lock, LockVerificationProfile::ReviewedCatalogAsBindingOnly)?;
    let acquired = acquired_rows(&lock)?;
    for (digest, _) in &acquired {
        let path = cache_object(root, digest);
        if !path.is_file() || sha256_file(&path)? != *digest {
            return Err(PrismError::new(
                "PP5402",
                format!("authority cache lacks verified object {digest}"),
            ));
        }
    }
    let (_, _, signature_evidence) = verify_signature_evidence_set(root, &lock, false)?;
    let acquired_objects = acquired.len() + signature_evidence.len();
    let binding_only = lock.value()["authorities"].as_array().map_or(0, |rows| {
        rows.iter()
            .filter(|row| row["source"]["sha256"].is_null())
            .count() as u64
    });
    let statement = json!({
        "_type": "https://in-toto.io/Statement/v1",
        "predicate": {
            "acquired_objects": acquired_objects,
            "binding_only": binding_only,
            "network": "disabled",
            "oracles": lock.value()["oracles"],
            "signature_evidence":signature_evidence,
            "standards_lock": lock.digest()
        },
        "predicateType": "https://schemas.uor.foundation/prismpm/authority-validation/v1",
        "subject": [{"digest": {"sha256": lock.digest().trim_start_matches("sha256:")}, "name": "standards.lock"}]
    });
    let bytes = encode_value(&statement)?;
    let attestation_digest = format!("sha256:{}", content_id(&bytes));
    let evidence_path = format!(
        ".prism/evidence/authority-{}.intoto.json",
        lock.digest().trim_start_matches("sha256:")
    );
    atomic_write(&root.join(&evidence_path), &bytes)?;
    Ok(AuthorityVerifyResult {
        schema: "prismpm/authority-verify-result/1".to_owned(),
        lock_digest: lock.digest(),
        acquired_objects: acquired_objects as u64,
        binding_only,
        attestation_digest,
        evidence_path,
        offline: true,
    })
}

/// Read and validate the committed standards lock without executing content.
pub fn inspect(root: &Path) -> Result<Value, PrismError> {
    let lock = parse_lock(root)?;
    verify_lock_bindings(&lock, LockVerificationProfile::ReviewedCatalog)?;
    Ok(lock.value().clone())
}

fn required_object(value: &Value, fields: &[&str]) -> bool {
    value.is_object()
        && fields
            .iter()
            .all(|field| value.get(*field).is_some_and(|member| !member.is_null()))
}

fn digest_object(value: &Value) -> bool {
    value
        .as_object()
        .is_some_and(|object| !object.is_empty() && object.values().all(Value::is_string))
}

/// Apply Prism's consumer-owned semantic policy for an in-toto Statement.
///
/// The registered external in-toto oracle deliberately validates only the
/// wire shape described by the upstream generated protobuf. The upstream
/// source explicitly delegates these required-field and digest constraints to
/// consumers; this policy therefore remains distinct from the oracle claim.
pub fn intoto_policy_accepts(value: &Value) -> bool {
    value["_type"] == "https://in-toto.io/Statement/v1"
        && value["subject"].as_array().is_some_and(|subjects| {
            !subjects.is_empty()
                && subjects
                    .iter()
                    .all(|subject| subject["name"].is_string() && digest_object(&subject["digest"]))
        })
        && value["predicateType"].is_string()
}

fn schema_accepts(schema_bytes: &[u8], instance: &Value) -> Result<bool, PrismError> {
    let schema: Value = serde_json::from_slice(schema_bytes)
        .map_err(|error| PrismError::new("PP5403", format!("upstream schema: {error}")))?;
    let validator = jsonschema::validator_for(&schema)
        .map_err(|error| PrismError::new("PP5403", format!("upstream schema: {error}")))?;
    Ok(validator.is_valid(instance))
}

fn valid_spdx_profile(value: &Value) -> bool {
    if value["@context"] != "https://spdx.org/rdf/3.0.1/spdx-context.jsonld" {
        return false;
    }
    let Some(elements) = value["@graph"].as_array() else {
        return false;
    };
    if elements.is_empty() {
        return false;
    }
    let accepted_types = [
        "Relationship",
        "SpdxDocument",
        "Tool",
        "simplelicensing_LicenseExpression",
        "software_File",
        "software_Package",
        "software_Sbom",
    ];
    if elements.iter().any(|element| {
        !required_object(element, &["creationInfo", "spdxId", "type"])
            || !element["spdxId"]
                .as_str()
                .is_some_and(|id| id.starts_with("urn:spdx:") && id.len() <= 512)
            || !element["type"]
                .as_str()
                .is_some_and(|kind| accepted_types.contains(&kind))
            || element
                .pointer("/creationInfo/specVersion")
                .and_then(Value::as_str)
                != Some("3.0.1")
            || element
                .pointer("/creationInfo/createdBy")
                .and_then(Value::as_array)
                .is_none_or(Vec::is_empty)
    }) {
        return false;
    }
    let ids = elements
        .iter()
        .filter_map(|element| element["spdxId"].as_str())
        .collect::<std::collections::BTreeSet<_>>();
    if ids.len() != elements.len() {
        return false;
    }
    if elements.windows(2).any(|pair| {
        pair[0]["spdxId"].as_str().unwrap_or_default()
            >= pair[1]["spdxId"].as_str().unwrap_or_default()
    }) {
        return false;
    }
    let external_license = |id: &str| {
        matches!(
            id,
            "expandedlicensing_NoAssertionLicense" | "expandedlicensing_NoneLicense"
        )
    };
    elements
        .iter()
        .all(|element| match element["type"].as_str() {
            Some("Relationship") => {
                element["relationshipType"].is_string()
                    && element["from"]
                        .as_str()
                        .is_some_and(|from| ids.contains(from))
                    && element["to"].as_array().is_some_and(|targets| {
                        !targets.is_empty()
                            && targets.iter().all(|target| {
                                target
                                    .as_str()
                                    .is_some_and(|id| ids.contains(id) || external_license(id))
                            })
                    })
            }
            Some("SpdxDocument" | "software_Sbom") => {
                element["element"].as_array().is_some_and(|members| {
                    members
                        .iter()
                        .all(|member| member.as_str().is_some_and(|member| ids.contains(member)))
                }) && element["rootElement"].as_array().is_some_and(|members| {
                    !members.is_empty()
                        && members.iter().all(|member| {
                            member.as_str().is_some_and(|member| ids.contains(member))
                        })
                })
            }
            _ => true,
        })
        && elements
            .iter()
            .any(|element| element["type"] == "SpdxDocument")
        && elements
            .iter()
            .any(|element| element["type"] == "software_Package")
}

fn oracle_subject(input: &Path) -> Result<(String, u64, Option<Vec<u8>>), PrismError> {
    let metadata = std::fs::symlink_metadata(input)
        .map_err(|error| PrismError::new("PP5403", format!("{}: {error}", input.display())))?;
    if metadata.file_type().is_symlink() {
        return Err(PrismError::new("PP5403", "oracle subject is a symlink"));
    }
    if metadata.is_file() {
        let bytes = std::fs::read(input)
            .map_err(|error| PrismError::new("PP5403", format!("{}: {error}", input.display())))?;
        return Ok((
            format!("sha256:{}", content_id(&bytes)),
            bytes.len() as u64,
            Some(bytes),
        ));
    }
    if !metadata.is_dir() {
        return Err(PrismError::new(
            "PP5403",
            "oracle subject is neither a regular file nor directory",
        ));
    }
    let mut rows = walkdir::WalkDir::new(input)
        .into_iter()
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| PrismError::new("PP5403", format!("oracle subject: {error}")))?;
    rows.sort_by(|left, right| left.path().as_os_str().cmp(right.path().as_os_str()));
    let mut hasher = Sha256::new();
    let mut total = 0_u64;
    for row in rows {
        if row.file_type().is_symlink() {
            return Err(PrismError::new(
                "PP5403",
                "oracle subject directory contains a symlink",
            ));
        }
        if !row.file_type().is_file() {
            continue;
        }
        let relative = row
            .path()
            .strip_prefix(input)
            .map_err(|_| PrismError::new("PP5403", "oracle subject path escaped"))?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = std::fs::read(row.path())
            .map_err(|error| PrismError::new("PP5403", format!("oracle subject: {error}")))?;
        total = total.saturating_add(bytes.len() as u64);
        hasher.update((relative.len() as u64).to_be_bytes());
        hasher.update(relative.as_bytes());
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    Ok((format!("sha256:{:x}", hasher.finalize()), total, None))
}

#[derive(Debug)]
struct SandboxMount {
    host: PathBuf,
    guest: String,
}

#[derive(Debug)]
struct SandboxInvocation {
    arguments: Vec<String>,
    mounts: Vec<SandboxMount>,
}

// Docker cp ownership defaults vary with engine/backend and caller identity.
// Supply one deterministic archive whose metadata is independent of the host;
// the staging container never needs to execute chmod or acquire privileges.
fn oracle_input_archive(
    invocation: &SandboxInvocation,
    destination: &Path,
) -> Result<(), PrismError> {
    let error = |message: String| PrismError::new("PP5403", message);
    let file = File::create(destination)
        .map_err(|cause| error(format!("oracle input archive: {cause}")))?;
    let mut archive = tar::Builder::new(file);
    let mut seen = std::collections::BTreeSet::new();
    let mut mounts = invocation.mounts.iter().collect::<Vec<_>>();
    mounts.sort_by(|left, right| left.guest.cmp(&right.guest));
    for mount in mounts {
        let relative = mount
            .guest
            .strip_prefix("/oracle-inputs/")
            .filter(|value| !value.is_empty())
            .ok_or_else(|| error("oracle input guest path is outside its volume".to_owned()))?;
        let target = Path::new(relative);
        if target
            .components()
            .any(|part| !matches!(part, std::path::Component::Normal(_)))
        {
            return Err(error(
                "oracle input guest path escapes its volume".to_owned(),
            ));
        }
        for entry in walkdir::WalkDir::new(&mount.host)
            .follow_links(false)
            .sort_by_file_name()
        {
            let entry = entry.map_err(|cause| error(format!("oracle input traversal: {cause}")))?;
            let kind = entry.file_type();
            if !kind.is_file() && !kind.is_dir() {
                return Err(error(
                    "oracle input contains a symlink or special file".to_owned(),
                ));
            }
            let suffix = entry
                .path()
                .strip_prefix(&mount.host)
                .map_err(|_| error("oracle input path escaped its source".to_owned()))?;
            let path = target.join(suffix);
            if !seen.insert(path.clone()) {
                return Err(error(
                    "oracle input archive contains overlapping paths".to_owned(),
                ));
            }
            let mut header = tar::Header::new_gnu();
            header.set_uid(1000);
            header.set_gid(1000);
            header.set_mtime(0);
            if kind.is_dir() {
                header.set_entry_type(tar::EntryType::Directory);
                header.set_mode(0o555);
                header.set_size(0);
                header.set_cksum();
                archive
                    .append_data(&mut header, &path, std::io::empty())
                    .map_err(|cause| error(format!("oracle directory archive: {cause}")))?;
            } else {
                let input = File::open(entry.path())
                    .map_err(|cause| error(format!("oracle input archive read: {cause}")))?;
                let metadata = input
                    .metadata()
                    .map_err(|cause| error(format!("oracle input archive metadata: {cause}")))?;
                if !metadata.is_file() {
                    return Err(error("oracle input changed its file type".to_owned()));
                }
                header.set_entry_type(tar::EntryType::Regular);
                header.set_mode(0o444);
                header.set_size(metadata.len());
                header.set_cksum();
                archive
                    .append_data(&mut header, &path, input)
                    .map_err(|cause| error(format!("oracle file archive: {cause}")))?;
            }
        }
    }
    archive
        .finish()
        .map_err(|cause| error(format!("oracle input archive finalization: {cause}")))
}

fn mount_source(path: &Path) -> Result<String, PrismError> {
    let canonical = path
        .canonicalize()
        .map_err(|error| PrismError::new("PP5403", format!("oracle input: {error}")))?;
    let source = canonical
        .to_str()
        .filter(|value| !value.contains([',', '\n', '\r']))
        .ok_or_else(|| PrismError::new("PP5403", "oracle input path cannot be mounted safely"))?;
    Ok(source.to_owned())
}

fn external_invocation(
    oracle: &OracleRow,
    input: &Path,
    bindings: &BTreeMap<String, String>,
) -> Result<SandboxInvocation, PrismError> {
    let input_source = mount_source(input)?;
    let mut mounts = vec![SandboxMount {
        host: PathBuf::from(&input_source),
        guest: "/oracle-inputs/input".to_owned(),
    }];
    let mut arguments = Vec::with_capacity(oracle.arguments.len());
    let mut used_bindings = std::collections::BTreeSet::new();
    let mut subject_argument = false;
    for argument in &oracle.arguments {
        let mut value = argument.clone();
        if value.contains("{input}") {
            value = value.replace("{input}", "/oracle-inputs/input");
            subject_argument = true;
        }
        for name in [
            "bundle",
            "subject",
            "provenance",
            "signature",
            "trusted-root",
            "source-uri",
            "identity",
            "issuer",
        ] {
            let marker = format!("{{{name}}}");
            if !value.contains(&marker) {
                continue;
            }
            let binding = bindings.get(name).ok_or_else(|| {
                PrismError::new("PP5403", format!("oracle invocation requires {{{name}}}"))
            })?;
            used_bindings.insert(name);
            let replacement = if matches!(
                name,
                "bundle" | "subject" | "provenance" | "signature" | "trusted-root"
            ) {
                let path = Path::new(binding);
                oracle_subject(path)?;
                if name == "trusted-root"
                    && oracle.trusted_root.as_ref().is_none_or(|root| {
                        sha256_file(path)
                            .map(|digest| digest != root.sha256)
                            .unwrap_or(true)
                    })
                {
                    return Err(PrismError::new(
                        "PP5403",
                        "the supplied trusted root does not match the oracle lock binding",
                    ));
                }
                let source = mount_source(path)?;
                if name == "subject" {
                    subject_argument = true;
                    if source != input_source {
                        return Err(PrismError::new(
                            "PP5403",
                            "the oracle subject binding differs from the measured input",
                        ));
                    }
                    "/oracle-inputs/input".to_owned()
                } else {
                    let guest = format!("/oracle-inputs/{name}");
                    mounts.push(SandboxMount {
                        host: PathBuf::from(source),
                        guest: guest.clone(),
                    });
                    guest
                }
            } else {
                if binding.is_empty()
                    || binding.len() > 4096
                    || binding
                        .bytes()
                        .any(|byte| matches!(byte, 0 | b'\n' | b'\r'))
                {
                    return Err(PrismError::new(
                        "PP5403",
                        format!("oracle binding {{{name}}} is malformed"),
                    ));
                }
                binding.clone()
            };
            value = value.replace(&marker, &replacement);
        }
        if value.contains('{') || value.contains('}') {
            return Err(PrismError::new(
                "PP5403",
                "oracle invocation contains an unknown context placeholder",
            ));
        }
        arguments.push(value);
    }
    if !subject_argument {
        return Err(PrismError::new(
            "PP5403",
            "oracle invocation does not consume the measured subject",
        ));
    }
    if bindings
        .keys()
        .any(|name| !used_bindings.contains(name.as_str()))
    {
        return Err(PrismError::new(
            "PP5403",
            "oracle invocation contains an unused context binding",
        ));
    }
    Ok(SandboxInvocation { arguments, mounts })
}

fn locked_sdk_image(root: &Path) -> Result<String, PrismError> {
    let lock = crate::sdk::inspect_lock(root).map_err(|error| {
        PrismError::new(
            "PP5403",
            format!("external oracle requires a canonical SDK lock: {error}"),
        )
    })?;
    let image = lock["sdk_image"]
        .as_str()
        .ok_or_else(|| PrismError::new("PP5403", "SDK lock omits sdk_image"))?;
    crate::oci::validate_reference(image, true).map_err(|_| {
        PrismError::new(
            "PP5403",
            "external oracle SDK image is not selected by immutable digest",
        )
    })?;
    Ok(image.to_owned())
}

fn verify_project_oracle_binding(root: &Path, oracle: &OracleRow) -> Result<(), PrismError> {
    let standards = parse_lock(root)?;
    verify_lock_bindings(&standards, LockVerificationProfile::ReviewedCatalog)?;
    let wrapper = wrapper_sha256(oracle)?;
    let expected = oracle_value(oracle, &wrapper);
    let observed = standards.value()["oracles"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["id"] == oracle.id))
        .ok_or_else(|| PrismError::new("PP5403", "project standards lock omits the oracle"))?;
    if observed != &expected {
        return Err(PrismError::new(
            "PP5403",
            "project oracle binding is stale or disagrees with the executable wrapper",
        ));
    }
    let sdk_lock = crate::sdk::inspect_lock(root).map_err(|error| {
        PrismError::new(
            "PP5403",
            format!("oracle execution requires a canonical SDK lock: {error}"),
        )
    })?;
    if sdk_lock["standards_lock"] != standards.digest() {
        return Err(PrismError::new(
            "PP5403",
            "SDK lock does not select the committed standards lock",
        ));
    }
    Ok(())
}

fn emit_oracle_attestation(
    root: Option<&Path>,
    oracle: &OracleRow,
    subject: &str,
    valid: bool,
    runner_image: Option<&str>,
) -> Result<(String, String, Option<String>), PrismError> {
    let wrapper = wrapper_sha256(oracle)?;
    let oracle_binding = oracle_value(oracle, &wrapper);
    let oracle_digest = format!("sha256:{}", content_id(&encode_value(&oracle_binding)?));
    let statement = json!({
        "_type":"https://in-toto.io/Statement/v1",
        "predicate":{
            "authority_ids":oracle.authority_ids,
            "covered":oracle.covers,
            "edition":oracle.edition,
            "normalized_result":if valid { "valid" } else { "invalid" },
            "oracle":oracle.id,
            "oracle_digest":oracle_digest,
            "runner_image":runner_image,
            "uncovered":oracle.does_not_cover
        },
        "predicateType":"https://schemas.uor.foundation/prismpm/oracle-validation/v1",
        "subject":[{"digest":{"sha256":subject.trim_start_matches("sha256:")},"name":"projected-artifact"}]
    });
    let bytes = encode_value(&statement)?;
    let attestation_digest = format!("sha256:{}", content_id(&bytes));
    let evidence_path = root.map(|root| {
        let relative = format!(
            ".prism/evidence/oracle-{}-{}-{}.intoto.json",
            oracle.id,
            subject.trim_start_matches("sha256:"),
            if valid { "valid" } else { "invalid" }
        );
        (root, relative)
    });
    if let Some((root, relative)) = &evidence_path {
        atomic_write(&root.join(relative), &bytes)?;
    }
    Ok((
        oracle_digest,
        attestation_digest,
        evidence_path.map(|(_, relative)| relative),
    ))
}

fn sandbox_arguments(
    sdk_image: &str,
    executable: &str,
    invocation: &SandboxInvocation,
    container_name: &str,
    input_volume: &str,
    memory_bytes: u64,
) -> Result<Vec<String>, PrismError> {
    if executable.is_empty()
        || executable.len() > 128
        || !executable
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PrismError::new(
            "PP5403",
            "oracle executable name is malformed",
        ));
    }
    if container_name.is_empty()
        || container_name.len() > 128
        || !container_name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PrismError::new(
            "PP5403",
            "oracle container name is malformed",
        ));
    }
    if input_volume.is_empty()
        || input_volume.len() > 128
        || !input_volume
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PrismError::new(
            "PP5403",
            "oracle input-volume name is malformed",
        ));
    }
    let scratch_bytes = memory_bytes.min(67_108_864);
    let mut arguments = vec![
        "create".to_owned(),
        "--name".to_owned(),
        container_name.to_owned(),
        "--user".to_owned(),
        "1000:1000".to_owned(),
        "--pull".to_owned(),
        "never".to_owned(),
        "--network".to_owned(),
        "none".to_owned(),
        "--read-only".to_owned(),
        "--cap-drop".to_owned(),
        "ALL".to_owned(),
        "--security-opt".to_owned(),
        "no-new-privileges".to_owned(),
        "--pids-limit".to_owned(),
        "128".to_owned(),
        "--memory".to_owned(),
        memory_bytes.to_string(),
        "--memory-swap".to_owned(),
        memory_bytes.to_string(),
        "--ipc".to_owned(),
        "none".to_owned(),
        "--workdir".to_owned(),
        "/scratch".to_owned(),
        "--tmpfs".to_owned(),
        format!("/scratch:rw,nosuid,nodev,noexec,size={scratch_bytes},mode=1777"),
        "--mount".to_owned(),
        format!("type=volume,source={input_volume},target=/oracle-inputs,readonly"),
    ];
    arguments.extend([
        "--entrypoint".to_owned(),
        "/usr/bin/env".to_owned(),
        sdk_image.to_owned(),
        "-i".to_owned(),
        "HOME=/scratch".to_owned(),
        "TMPDIR=/scratch/tmp".to_owned(),
        "XDG_CACHE_HOME=/scratch/cache".to_owned(),
        "LC_ALL=C".to_owned(),
        "LANG=C".to_owned(),
        "PATH=/usr/local/bin:/usr/bin:/bin".to_owned(),
        "PRISMPM_ORACLE_SANDBOX=1".to_owned(),
    ]);
    if executable == "docker"
        && invocation
            .arguments
            .first()
            .is_some_and(|argument| argument == "compose")
    {
        // Normalize modeled file references without importing host credentials.
        // The target lifecycle separately validates and supplies real secrets.
        arguments.push("PRISMPM_SECRET_DIR=/scratch/prismpm-secret-references".to_owned());
    }
    arguments.push(executable.to_owned());
    arguments.extend(invocation.arguments.iter().cloned());
    Ok(arguments)
}

fn read_bounded<R: Read>(mut reader: R, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut saved = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            return Ok(saved);
        }
        if saved.len() <= limit {
            let remaining = limit.saturating_add(1).saturating_sub(saved.len());
            saved.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
}

fn docker_command(docker: &Path, config: &Path, arguments: &[String]) -> Command {
    let mut command = Command::new(docker);
    command
        .env_clear()
        .arg("--host")
        .arg("unix:///var/run/docker.sock")
        .arg("--config")
        .arg(config)
        .args(arguments);
    command
}

fn remove_container(docker: &Path, config: &Path, id: &str) -> Result<(), PrismError> {
    if id.is_empty()
        || id.len() > 128
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PrismError::new(
            "PP5403",
            "oracle runtime returned a malformed container identity",
        ));
    }
    let arguments = vec![
        "container".to_owned(),
        "rm".to_owned(),
        "--force".to_owned(),
        id.to_owned(),
    ];
    let mut command = docker_command(docker, config, &arguments);
    command.stdout(Stdio::null()).stderr(Stdio::null());
    let mut child = command
        .spawn()
        .map_err(|error| PrismError::new("PP5403", format!("oracle cleanup: {error}")))?;
    let deadline = Instant::now() + Duration::from_secs(5);
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| PrismError::new("PP5403", format!("oracle cleanup: {error}")))?
        {
            if status.success() {
                return Ok(());
            }
            return Err(PrismError::new(
                "PP5403",
                "timed-out oracle container could not be removed",
            ));
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(PrismError::new(
                "PP5403",
                "timed-out oracle container cleanup exceeded its bound",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    }
}

fn remove_volume(docker: &Path, config: &Path, volume: &str) -> Result<(), PrismError> {
    let arguments = vec![
        "volume".to_owned(),
        "rm".to_owned(),
        "--force".to_owned(),
        volume.to_owned(),
    ];
    let (status, _, _) = run_docker_control(docker, config, &arguments, Duration::from_secs(5))?;
    if status.success() {
        Ok(())
    } else {
        Err(PrismError::new(
            "PP5403",
            "oracle input volume could not be removed",
        ))
    }
}

fn created_container_id(
    status: ExitStatus,
    stdout: &[u8],
    stderr: &[u8],
) -> Result<String, PrismError> {
    if !status.success() {
        return Err(PrismError::new(
            "PP5403",
            format!(
                "create oracle sandbox failed: {}",
                String::from_utf8_lossy(stderr)
            ),
        ));
    }
    let id = String::from_utf8_lossy(stdout).trim().to_owned();
    if id.len() != 64
        || !id
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(PrismError::new(
            "PP5403",
            "Docker create returned a malformed container ID",
        ));
    }
    Ok(id)
}

fn run_docker_control(
    docker: &Path,
    config: &Path,
    arguments: &[String],
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrismError> {
    run_docker_control_with_input(docker, config, arguments, timeout, None)
}

fn run_docker_control_with_input(
    docker: &Path,
    config: &Path,
    arguments: &[String],
    timeout: Duration,
    input: Option<&Path>,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrismError> {
    let mut command = docker_command(docker, config, arguments);
    let stdin = match input {
        Some(path) => Stdio::from(File::open(path).map_err(|error| {
            PrismError::new("PP5403", format!("Docker archive input: {error}"))
        })?),
        None => Stdio::null(),
    };
    command
        .stdin(stdin)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| PrismError::new("PP5403", format!("start Docker control: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| PrismError::new("PP5403", "Docker control stdout is absent"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| PrismError::new("PP5403", "Docker control stderr is absent"))?;
    let stdout_thread = std::thread::spawn(move || read_bounded(stdout, 65_536));
    let stderr_thread = std::thread::spawn(move || read_bounded(stderr, 65_536));
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| PrismError::new("PP5403", format!("Docker control wait: {error}")))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(PrismError::new(
                "PP5403",
                "Docker control operation timed out",
            ));
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| PrismError::new("PP5403", "Docker control stdout reader terminated"))?
        .map_err(|error| PrismError::new("PP5403", format!("Docker control stdout: {error}")))?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| PrismError::new("PP5403", "Docker control stderr reader terminated"))?
        .map_err(|error| PrismError::new("PP5403", format!("Docker control stderr: {error}")))?;
    Ok((status, stdout, stderr))
}

fn expected_invalid_exit(oracle: &OracleRow, exit_code: i32) -> bool {
    exit_code != 0
        && oracle.expected_exits.iter().any(|class| {
            class == "nonzero=invalid"
                || class
                    .split_once('=')
                    .and_then(|(code, class)| {
                        code.parse::<i32>()
                            .ok()
                            .map(|code| code == exit_code && class == "invalid")
                    })
                    .unwrap_or(false)
        })
}

fn normalized_runtime_output(bytes: &[u8], scratch: &Path, input: &Path) -> String {
    String::from_utf8_lossy(bytes)
        .replace(&scratch.to_string_lossy().to_string(), "$SCRATCH")
        .replace(&input.to_string_lossy().to_string(), "$INPUT")
}

fn run_external_oracle(
    root: &Path,
    oracle: &OracleRow,
    input: &Path,
    bindings: &BTreeMap<String, String>,
) -> Result<(), PrismError> {
    if std::env::var_os("PRISMPM_ORACLE_SANDBOX").is_some() {
        return Err(PrismError::new(
            "PP5403",
            "recursive external oracle sandbox execution is forbidden",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::FileTypeExt;
        if std::fs::metadata("/var/run/docker.sock")
            .ok()
            .is_none_or(|metadata| !metadata.file_type().is_socket())
        {
            return Err(PrismError::new(
                "PP5403",
                "external oracle isolation requires the Docker socket",
            ));
        }
    }
    #[cfg(not(unix))]
    return Err(PrismError::new(
        "PP5403",
        "external oracle isolation is unavailable on this platform",
    ));

    if oracle.network != "deny"
        || oracle.timeout_ms == 0
        || oracle.memory_bytes == 0
        || oracle.output_bytes == 0
    {
        return Err(PrismError::new(
            "PP5403",
            "external oracle isolation policy is missing a finite deny/bound",
        ));
    }

    let sdk_image = locked_sdk_image(root)?;
    let docker = crate::sdk::executable("docker").map_err(|error| {
        PrismError::new(
            "PP5403",
            format!("Docker oracle sandbox is unavailable: {error}"),
        )
    })?;
    let invocation = external_invocation(oracle, input, bindings)?;
    let scratch = tempfile::Builder::new()
        .prefix("prismpm-oracle-")
        .tempdir()
        .map_err(|error| PrismError::new("PP5403", format!("oracle scratch: {error}")))?;
    for directory in ["tmp", "cache", "docker-config"] {
        std::fs::create_dir(scratch.path().join(directory))
            .map_err(|error| PrismError::new("PP5403", format!("oracle scratch: {error}")))?;
    }
    let nonce = scratch
        .path()
        .file_name()
        .and_then(|value| value.to_str())
        .ok_or_else(|| PrismError::new("PP5403", "oracle scratch identity is malformed"))?;
    let container_name = format!("prismpm-oracle-{nonce}");
    let staging_name = format!("{container_name}-inputs");
    let input_volume = format!("{container_name}-inputs");
    let docker_config = scratch.path().join("docker-config");
    let input_archive = scratch.path().join("inputs.tar");
    oracle_input_archive(&invocation, &input_archive)?;

    let volume_arguments = vec![
        "volume".to_owned(),
        "create".to_owned(),
        input_volume.clone(),
    ];
    let (status, _, stderr) = run_docker_control(
        &docker,
        &docker_config,
        &volume_arguments,
        Duration::from_secs(10),
    )?;
    if !status.success() {
        return Err(PrismError::new(
            "PP5403",
            format!(
                "create oracle input volume failed: {}",
                String::from_utf8_lossy(&stderr)
            ),
        ));
    }

    let staging_arguments = vec![
        "create".to_owned(),
        "--name".to_owned(),
        staging_name.clone(),
        "--pull".to_owned(),
        "never".to_owned(),
        "--network".to_owned(),
        "none".to_owned(),
        "--read-only".to_owned(),
        "--cap-drop".to_owned(),
        "ALL".to_owned(),
        "--security-opt".to_owned(),
        "no-new-privileges".to_owned(),
        "--memory".to_owned(),
        oracle.memory_bytes.to_string(),
        "--memory-swap".to_owned(),
        oracle.memory_bytes.to_string(),
        "--user".to_owned(),
        "1000:1000".to_owned(),
        "--entrypoint".to_owned(),
        "/bin/true".to_owned(),
        "--mount".to_owned(),
        format!("type=volume,source={input_volume},target=/oracle-inputs"),
        sdk_image.clone(),
    ];
    let created = run_docker_control(
        &docker,
        &docker_config,
        &staging_arguments,
        Duration::from_secs(30),
    );
    let staging_id = match created
        .and_then(|(status, stdout, stderr)| created_container_id(status, &stdout, &stderr))
    {
        Ok(id) => id,
        Err(error) => {
            let _ = remove_container(&docker, &docker_config, &staging_name);
            let _ = remove_volume(&docker, &docker_config, &input_volume);
            return Err(error);
        }
    };
    let copy_arguments = vec![
        "container".to_owned(),
        "cp".to_owned(),
        "--archive=true".to_owned(),
        "-".to_owned(),
        format!("{staging_id}:/oracle-inputs"),
    ];
    let copied = run_docker_control_with_input(
        &docker,
        &docker_config,
        &copy_arguments,
        Duration::from_secs(30),
        Some(&input_archive),
    );
    let (status, _, stderr) = match copied {
        Ok(output) => output,
        Err(error) => {
            let _ = remove_container(&docker, &docker_config, &staging_id);
            let _ = remove_volume(&docker, &docker_config, &input_volume);
            return Err(error);
        }
    };
    if !status.success() {
        let _ = remove_container(&docker, &docker_config, &staging_id);
        let _ = remove_volume(&docker, &docker_config, &input_volume);
        return Err(PrismError::new(
            "PP5403",
            format!(
                "copy normalized oracle input archive failed: {}",
                String::from_utf8_lossy(&stderr)
            ),
        ));
    }
    remove_container(&docker, &docker_config, &staging_id)?;

    let arguments = sandbox_arguments(
        &sdk_image,
        &oracle.executable,
        &invocation,
        &container_name,
        &input_volume,
        oracle.memory_bytes,
    )?;
    let created = run_docker_control(&docker, &docker_config, &arguments, Duration::from_secs(30));
    let container_id = match created
        .and_then(|(status, stdout, stderr)| created_container_id(status, &stdout, &stderr))
    {
        Ok(id) => id,
        Err(error) => {
            let _ = remove_container(&docker, &docker_config, &container_name);
            let _ = remove_volume(&docker, &docker_config, &input_volume);
            return Err(error);
        }
    };
    let start_arguments = vec![
        "container".to_owned(),
        "start".to_owned(),
        "--attach".to_owned(),
        container_id.clone(),
    ];
    let mut command = docker_command(&docker, &docker_config, &start_arguments);
    command
        .current_dir(root)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    let mut child = command
        .spawn()
        .map_err(|error| PrismError::new("PP5403", format!("start oracle sandbox: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| PrismError::new("PP5403", "oracle stdout pipe is absent"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| PrismError::new("PP5403", "oracle stderr pipe is absent"))?;
    let output_limit = usize::try_from(oracle.output_bytes).unwrap_or(usize::MAX);
    let stdout_thread = std::thread::spawn(move || read_bounded(stdout, output_limit));
    let stderr_thread = std::thread::spawn(move || read_bounded(stderr, output_limit));
    let deadline = Instant::now() + Duration::from_millis(oracle.timeout_ms);
    let (status, timed_out): (ExitStatus, bool) = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| PrismError::new("PP5403", format!("oracle wait: {error}")))?
        {
            break (status, false);
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let status = child
                .wait()
                .map_err(|error| PrismError::new("PP5403", format!("oracle wait: {error}")))?;
            break (status, true);
        }
        std::thread::sleep(Duration::from_millis(10));
    };
    let stdout = stdout_thread
        .join()
        .map_err(|_| PrismError::new("PP5403", "oracle stdout reader terminated"))?
        .map_err(|error| PrismError::new("PP5403", format!("oracle stdout: {error}")))?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| PrismError::new("PP5403", "oracle stderr reader terminated"))?
        .map_err(|error| PrismError::new("PP5403", format!("oracle stderr: {error}")))?;
    if timed_out {
        remove_container(&docker, &docker_config, &container_id)?;
        remove_volume(&docker, &docker_config, &input_volume)?;
        return Err(PrismError::new("PP5403", "oracle execution timed out"));
    }
    remove_container(&docker, &docker_config, &container_id)?;
    remove_volume(&docker, &docker_config, &input_volume)?;
    if stdout.len().saturating_add(stderr.len()) > output_limit {
        return Err(PrismError::new(
            "PP5403",
            "oracle output exceeded its bound",
        ));
    }
    if status.success() {
        return Ok(());
    }
    let exit_code = status.code().unwrap_or(128);
    let stdout = normalized_runtime_output(&stdout, scratch.path(), input);
    let stderr = normalized_runtime_output(&stderr, scratch.path(), input);
    if expected_invalid_exit(oracle, exit_code) {
        return Err(PrismError::new(
            "PP5404",
            format!(
                "{} rejected the subject: stdout={stdout:?}; stderr={stderr:?}",
                oracle.id
            ),
        ));
    }
    Err(PrismError::new(
        "PP5403",
        format!(
            "{} returned unregistered exit {exit_code}: stdout={stdout:?}; stderr={stderr:?}",
            oracle.id
        ),
    ))
}

fn run_oracle_inner(
    root: Option<&Path>,
    profile: &str,
    input: &Path,
    bindings: &BTreeMap<String, String>,
) -> Result<OracleResult, PrismError> {
    let catalog = catalog()?;
    let oracle_id = match profile {
        "oci-layout" => "oci-layout-1.1",
        "json-schema" => "json-schema-2020-12",
        "openapi" => "openapi-3.2-schema",
        "asyncapi" => "asyncapi-3.1-schema",
        "cloudevents" => "cloudevents-1.0-json",
        "oidc-profile" => "oidc-core-1.0-profile",
        "in-toto" => "in-toto-statement-1.0",
        "spdx" => "spdx-3.0.1-model",
        "cosign" => "sigstore-cosign-3.1.3",
        "osv" => "osv-schema-snapshot",
        "slsa" => "slsa-provenance-1.2",
        "otel" => "otel-collector-0.136.0",
        "devcontainer" => "devcontainer-c95ffeed",
        "compose" => "compose-fee041b3",
        "kubernetes" => "kubernetes-1.36.4",
        _ => {
            return Err(PrismError::new(
                "PP5403",
                format!("unknown oracle profile {profile}"),
            ))
        }
    };
    let oracle = catalog
        .oracle
        .iter()
        .find(|oracle| oracle.id == oracle_id)
        .ok_or_else(|| PrismError::new("PP5403", format!("unknown oracle profile {profile}")))?;
    if let Some(root) = root {
        verify_project_oracle_binding(root, oracle)?;
    }
    let platform = match std::env::consts::ARCH {
        "x86_64" => "linux/amd64",
        "aarch64" => "linux/arm64",
        _ => {
            return Err(PrismError::new(
                "PP5403",
                "oracle platform is not supported by the locked runner",
            ))
        }
    };
    if !oracle
        .supported_platforms
        .iter()
        .any(|supported| supported == platform)
    {
        return Err(PrismError::new(
            "PP5403",
            format!("oracle {} does not support {platform}", oracle.id),
        ));
    }
    let (subject, subject_size, bytes) = oracle_subject(input)?;
    if subject_size > oracle.output_bytes.saturating_mul(16) {
        return Err(PrismError::new("PP7601", "oracle input exceeds its bound"));
    }
    if oracle.executable != "prismpm" {
        let root = root.ok_or_else(|| {
            PrismError::new(
                "PP5403",
                "external oracle execution requires an explicit locked project root",
            )
        })?;
        let runner_image = locked_sdk_image(root)?;
        if let Err(error) = run_external_oracle(root, oracle, input, bindings) {
            if error.code == "PP5404" {
                emit_oracle_attestation(Some(root), oracle, &subject, false, Some(&runner_image))?;
            }
            return Err(error);
        }
        let (observed_subject, _, _) = oracle_subject(input)?;
        if observed_subject != subject {
            return Err(PrismError::new(
                "PP5403",
                "oracle subject changed during validation",
            ));
        }
        let (oracle_digest, attestation_digest, evidence_path) =
            emit_oracle_attestation(Some(root), oracle, &subject, true, Some(&runner_image))?;
        return Ok(OracleResult {
            schema: "prismpm/validation-result/1".to_owned(),
            oracle: oracle.id.clone(),
            oracle_digest,
            subject,
            covered: oracle.covers.clone(),
            uncovered: oracle.does_not_cover.clone(),
            valid: true,
            attestation_digest,
            evidence_path,
        });
    }
    let bytes = bytes.ok_or_else(|| {
        PrismError::new(
            "PP5403",
            "built-in data oracle requires a regular-file subject",
        )
    })?;
    let value = decode_value(&bytes, "oracle input")?;
    let valid = match profile {
        "openapi" => schema_accepts(OPENAPI_SCHEMA, &value)?,
        "cloudevents" => {
            value["specversion"] == "1.0"
                && required_object(&value, &["id", "source", "type", "data"])
        }
        "oidc-profile" => required_object(&value, &["issuer", "audiences", "algorithms", "roles"]),
        "in-toto" => intoto_policy_accepts(&value),
        "spdx" => valid_spdx_profile(&value),
        "osv" => value["vulnerabilities"].as_array().is_some_and(|rows| {
            rows.iter()
                .all(|row| schema_accepts(OSV_SCHEMA, row).unwrap_or(false))
        }),
        "json-schema" => {
            let expected = value["valid"].as_bool();
            let observed = value
                .get("schema")
                .and_then(|schema| jsonschema::validator_for(schema).ok())
                .is_some_and(|validator| validator.is_valid(&value["instance"]));
            expected == Some(observed)
        }
        "oci-layout" => value["imageLayoutVersion"] == "1.0.0",
        _ => false,
    };
    if !valid {
        emit_oracle_attestation(root, oracle, &subject, false, None)?;
        return Err(PrismError::new(
            "PP5404",
            format!("{profile} rejected {}", input.display()),
        ));
    }
    let (oracle_digest, attestation_digest, evidence_path) =
        emit_oracle_attestation(root, oracle, &subject, true, None)?;
    Ok(OracleResult {
        schema: "prismpm/validation-result/1".to_owned(),
        oracle: oracle.id.clone(),
        oracle_digest,
        subject,
        covered: oracle.covers.clone(),
        uncovered: oracle.does_not_cover.clone(),
        valid: true,
        attestation_digest,
        evidence_path,
    })
}

/// Execute one registered oracle with explicit non-secret context bindings.
///
/// Built-in data oracles do not need a project root. External executables fail
/// closed through this compatibility surface; use
/// [`run_oracle_with_bindings_in_project`] so their SDK image is selected from
/// the project's canonical lock.
pub fn run_oracle_with_bindings(
    profile: &str,
    input: &Path,
    bindings: &BTreeMap<String, String>,
) -> Result<OracleResult, PrismError> {
    run_oracle_inner(None, profile, input, bindings)
}

/// Execute an oracle using the immutable SDK selected by the project lock.
pub fn run_oracle_with_bindings_in_project(
    root: &Path,
    profile: &str,
    input: &Path,
    bindings: &BTreeMap<String, String>,
) -> Result<OracleResult, PrismError> {
    run_oracle_inner(Some(root), profile, input, bindings)
}

/// Execute one registered oracle whose complete input is the subject path.
pub fn run_oracle(profile: &str, input: &Path) -> Result<OracleResult, PrismError> {
    run_oracle_with_bindings(profile, input, &BTreeMap::new())
}

/// Execute one project-locked oracle whose complete input is the subject path.
pub fn run_oracle_in_project(
    root: &Path,
    profile: &str,
    input: &Path,
) -> Result<OracleResult, PrismError> {
    run_oracle_with_bindings_in_project(root, profile, input, &BTreeMap::new())
}

#[cfg(test)]
mod tests {
    use super::{
        acquired_rows, cache_object, catalog, emit_oracle_attestation, external_invocation, fetch,
        git_tag_sha1, intoto_policy_accepts, oracle_input_archive, replay_tag_signature,
        resolved_lock, run_oracle, run_oracle_in_project, run_oracle_with_bindings_in_project,
        sandbox_arguments, validate_signature_evidence, verify_project_oracle_binding,
        verify_signature_evidence_set, SandboxInvocation, SandboxMount, AKIHIROSUDA_OPENPGP_ROOT,
        HAYDEN_IO_SSH_ROOT, OPENAPI_SCHEMA, OSV_SCHEMA, SIGSTORE_TRUSTED_ROOT, SONGY23_SSH_ROOT,
        SUDO_BMITCH_OPENPGP_ROOT,
    };
    use crate::contracts::CanonicalDocument;
    use crate::error::PrismError;
    use crate::holo::canonical::{content_id, encode_value};
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};
    use std::collections::BTreeMap;
    use std::fs::File;
    use std::io::{Read, Write};

    fn write_sdk_lock(root: &std::path::Path, standards_lock: String, sdk_image: String) {
        let mut value = json!({
            "inventory":[{
                "digest":format!("sha256:{}", "0".repeat(64)),
                "id":"test-oracle",
                "kind":"oracle",
                "version":"0.3.0"
            }],
            "schema":"prismpm/sdk-lock/1",
            "sdk_image":sdk_image,
            "sdk_version":"0.3.0",
            "standards_lock":standards_lock
        });
        if let Some(path) = crate::sdk::inventory_path() {
            let inventory: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let mut rows = inventory["artifacts"].as_array().unwrap().clone();
            rows.push(json!({
                "id":"sdk-manifest", "kind":"image", "version":"0.3.0",
                "digest":sdk_image.rsplit_once('@').unwrap().1
            }));
            rows.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            value["inventory"] = json!(rows);
        }
        let lock = CanonicalDocument::from_value("prismpm/sdk-lock/1", value).unwrap();
        std::fs::write(root.join("prismpm.lock"), lock.bytes()).unwrap();
    }

    fn signed_tag_corpus(tag: &str) -> &'static [u8] {
        match tag {
            "0eaca84ca040a452ebf87480b3f7bedf79d46f46" => include_bytes!(
                "../standards/corpora/github-signed-tags/0eaca84ca040a452ebf87480b3f7bedf79d46f46.json"
            ),
            "2f3a85b04907df5b770eb049d7e4d08d4b018d86" => include_bytes!(
                "../standards/corpora/github-signed-tags/2f3a85b04907df5b770eb049d7e4d08d4b018d86.json"
            ),
            "36cf70a10c3a65106781469e0557cef6b56aa507" => include_bytes!(
                "../standards/corpora/github-signed-tags/36cf70a10c3a65106781469e0557cef6b56aa507.json"
            ),
            "b5c693e819628420cc04ba7d9263628276d8ca0f" => include_bytes!(
                "../standards/corpora/github-signed-tags/b5c693e819628420cc04ba7d9263628276d8ca0f.json"
            ),
            "de7a13cc5ce022e0486d22211e80eb36f9d4a218" => include_bytes!(
                "../standards/corpora/github-signed-tags/de7a13cc5ce022e0486d22211e80eb36f9d4a218.json"
            ),
            _ => panic!("missing signed-tag corpus for {tag}"),
        }
    }

    #[test]
    fn lock_is_canonical_complete_and_stable() {
        let first = resolved_lock().expect("resolved lock");
        let second = resolved_lock().expect("resolved lock");
        assert_eq!(first.bytes(), second.bytes());
        assert!(first.value()["authorities"].as_array().unwrap().len() >= 20);
        assert!(first.value()["oracles"].as_array().unwrap().len() >= 10);
        assert!(!String::from_utf8_lossy(first.bytes()).contains("latest"));
    }

    #[test]
    fn oracle_attestation_emitter_unit_binds_every_registered_wrapper() {
        // Emitter contract test only: no oracle executes on this synthetic subject.
        let root = tempfile::tempdir().unwrap();
        let subject = format!("sha256:{}", content_id(b"oracle emitter unit subject"));
        let lock = resolved_lock().unwrap();
        let bindings = lock.value()["oracles"].as_array().unwrap();
        for oracle in catalog().unwrap().oracle {
            let binding = bindings.iter().find(|row| row["id"] == oracle.id).unwrap();
            let expected_digest = format!("sha256:{}", content_id(&encode_value(binding).unwrap()));
            for valid in [false, true] {
                let (oracle_digest, attestation_digest, path) =
                    emit_oracle_attestation(Some(root.path()), &oracle, &subject, valid, None)
                        .unwrap();
                let bytes = std::fs::read(root.path().join(path.unwrap())).unwrap();
                let statement: Value = serde_json::from_slice(&bytes).unwrap();
                assert_eq!(encode_value(&statement).unwrap(), bytes);
                assert_eq!(attestation_digest, format!("sha256:{}", content_id(&bytes)));
                assert_eq!(oracle_digest, expected_digest, "oracle {}", oracle.id);
                assert_eq!(
                    statement,
                    json!({
                        "_type":"https://in-toto.io/Statement/v1",
                        "predicate":{
                            "authority_ids":binding["authority_ids"],
                            "covered":binding["covers"],
                            "edition":binding["edition"],
                            "normalized_result":if valid { "valid" } else { "invalid" },
                            "oracle":binding["id"],
                            "oracle_digest":expected_digest,
                            "runner_image":null,
                            "uncovered":binding["does_not_cover"]
                        },
                        "predicateType":"https://schemas.uor.foundation/prismpm/oracle-validation/v1",
                        "subject":[{"digest":{"sha256":subject.trim_start_matches("sha256:")},"name":"projected-artifact"}]
                    }),
                    "oracle {}",
                    oracle.id
                );
                let mut substituted = binding.clone();
                substituted["wrapper_sha256"] = bindings
                    .iter()
                    .find(|row| row["wrapper_sha256"] != binding["wrapper_sha256"])
                    .expect("catalog exercises distinct wrapper implementations")["wrapper_sha256"]
                    .clone();
                let substituted_digest = format!(
                    "sha256:{}",
                    content_id(&encode_value(&substituted).unwrap())
                );
                assert_ne!(statement["predicate"]["oracle_digest"], substituted_digest);
            }
        }
    }

    #[test]
    fn oracle_attestation_emitter_unit_rejects_unknown_wrapper_without_evidence() {
        let root = tempfile::tempdir().unwrap();
        let mut oracle = catalog().unwrap().oracle.remove(0);
        oracle.wrapper_source = "unregistered-wrapper".to_owned();
        let subject = format!("sha256:{}", content_id(b"oracle emitter unit subject"));
        let error =
            emit_oracle_attestation(Some(root.path()), &oracle, &subject, true, None).unwrap_err();
        assert_eq!(error.code, "PP5402");
        assert!(std::fs::read_dir(root.path()).unwrap().next().is_none());
    }

    #[test]
    fn oracle_rejects_a_planted_wrong_edition() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(
            &encode_value(
                &json!({"openapi": "3.1.0", "paths": {}, "info": {"title":"wrong", "version":"1"}}),
            )
            .unwrap(),
        )
        .unwrap();
        let error = run_oracle("openapi", file.path()).unwrap_err();
        assert_eq!(error.code, "PP5404");
    }

    #[test]
    fn acquired_schema_payloads_have_the_reviewed_digests() {
        assert_eq!(
            format!("{:x}", Sha256::digest(OPENAPI_SCHEMA)),
            "7d48f01f37eeae4799041b371ad5f533f9f533fd2b0caa1011a8ba27c5b48b70"
        );
        assert_eq!(
            format!("{:x}", Sha256::digest(OSV_SCHEMA)),
            "cdb8292f72945cfdf06d3e044280d7c0867105a3a1ae6d4547c983eba20810a2"
        );
    }

    #[test]
    fn official_openapi_schema_rejects_an_unknown_root_field() {
        let valid =
            json!({"info":{"title":"Calculator","version":"B"},"openapi":"3.2.0","paths":{}});
        let invalid = json!({"info":{"title":"Calculator","version":"B"},"openapi":"3.2.0","paths":{},"planted":true});
        for (document, accepted) in [(valid, true), (invalid, false)] {
            let mut file = tempfile::NamedTempFile::new().unwrap();
            file.write_all(&encode_value(&document).unwrap()).unwrap();
            assert_eq!(run_oracle("openapi", file.path()).is_ok(), accepted);
        }
    }

    #[test]
    fn official_external_corpus_is_byte_bound_to_the_locked_upstream_files() {
        let cases = [
            (
                include_bytes!("../standards/corpora/kubernetes-1.36.4/valid-service.yaml")
                    .as_slice(),
                "9af93a14bc13bc893c357cf22890124a7372bac19904168dacaf6e1c20831868",
            ),
            (
                include_bytes!("../standards/corpora/kubernetes-1.36.4/invalid-pod.yaml")
                    .as_slice(),
                "ed46a8f1bf7925e077ac74fabcaf88511beafee694754cccba0277fcb489ccdd",
            ),
            (
                include_bytes!("../standards/corpora/cosign-3.1.3/cosign_checksums.txt").as_slice(),
                "aec2a6f68d307b09ae196e388dc691a146fa8bdba7fcce9ca4ca41b918adfa63",
            ),
            (
                include_bytes!(
                    "../standards/corpora/cosign-3.1.3/cosign_checksums.txt.sigstore.json"
                )
                .as_slice(),
                "976bcb216e45ed0274e464e2e16d81e84cc85a69b3ed6e3488c1e7cda116379a",
            ),
            (
                SIGSTORE_TRUSTED_ROOT,
                "844a1c6de3986c9f02070266b25e0d1a2fa99ceccc89f6b9ad90aae47b62a16e",
            ),
            (
                SUDO_BMITCH_OPENPGP_ROOT,
                "e33e1416f08d6ee24f1c66f3895be7d919ff58c0d4318f2934ec4743f75f0a7e",
            ),
            (
                AKIHIROSUDA_OPENPGP_ROOT,
                "cf122ae443d3fcad8b90fe30277d3c37e008c60d56c9658a44848bdb6f2078d4",
            ),
            (
                HAYDEN_IO_SSH_ROOT,
                "929c5c98f56be683921c84a1ccd542d0d8df3e75657c3711d5557da35267b637",
            ),
            (
                SONGY23_SSH_ROOT,
                "c0f83ab885c007561550bda8d540e620b2ac4e36af0a4b48cd320854a3cf2ea4",
            ),
            (
                include_bytes!(
                    "../standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch"
                )
                .as_slice(),
                "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            ),
            (
                include_bytes!(
                    "../standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch.intoto.sigstore"
                )
                .as_slice(),
                "1c6e77e49058e35519a875964231581defb7ee1eb461d5c043051601f5b688a3",
            ),
        ];
        for (bytes, expected) in cases {
            assert_eq!(format!("{:x}", Sha256::digest(bytes)), expected);
        }
    }

    #[test]
    fn every_embedded_oracle_accepts_a_positive_and_rejects_a_named_mutation() {
        let cases = [
            (
                "json-schema",
                json!({"instance":1,"schema":{"type":"integer"},"valid":true}),
                json!({"instance":"one","schema":{"type":"integer"},"valid":true}),
            ),
            (
                "openapi",
                json!({"info":{"title":"T","version":"1"},"openapi":"3.2.0","paths":{}}),
                json!({"info":{"title":"T","version":"1"},"openapi":"3.1.0","paths":{}}),
            ),
            (
                "osv",
                json!({"vulnerabilities":[{"affected":[],"id":"OSV-TEST-1","modified":"2026-09-05T00:00:00Z","schema_version":"1.7.4"}]}),
                json!({"vulnerabilities":[{"id":1}]}),
            ),
        ];
        for (profile, positive, mutation) in cases {
            let mut accepted = tempfile::NamedTempFile::new().unwrap();
            accepted
                .write_all(&encode_value(&positive).unwrap())
                .unwrap();
            assert!(run_oracle(profile, accepted.path()).is_ok(), "{profile}");
            let mut rejected = tempfile::NamedTempFile::new().unwrap();
            rejected
                .write_all(&encode_value(&mutation).unwrap())
                .unwrap();
            let error = run_oracle(profile, rejected.path()).unwrap_err();
            assert_eq!(error.code, "PP5404", "{profile}");
        }
    }

    #[test]
    fn intoto_semantic_policy_is_explicitly_consumer_owned() {
        let accepted = json!({"_type":"https://in-toto.io/Statement/v1","predicate":{},"predicateType":"https://example.test/predicate","subject":[{"digest":{"sha256":"00"},"name":"artifact"}]});
        let rejected = json!({"_type":"https://in-toto.io/Statement/v1","predicate":{},"predicateType":"https://example.test/predicate","subject":[]});
        assert!(intoto_policy_accepts(&accepted));
        assert!(!intoto_policy_accepts(&rejected));
    }

    #[test]
    fn registered_error_is_not_collapsed() {
        assert_eq!(PrismError::new("PP5403", "oracle").exit_code(), 4);
    }

    #[test]
    fn external_oracle_without_locked_project_fails_closed() {
        let mut file = tempfile::NamedTempFile::new().unwrap();
        file.write_all(b"asyncapi: 3.1.0\n").unwrap();
        let error = run_oracle("asyncapi", file.path()).unwrap_err();
        assert_eq!(error.code, "PP5403");
        assert!(error.message.contains("explicit locked project root"));
    }

    #[test]
    fn fake_runtime_argv_enforces_the_complete_sandbox_boundary() {
        let catalog = catalog().unwrap();
        let oracle = catalog
            .oracle
            .iter()
            .find(|oracle| oracle.id == "asyncapi-3.1-schema")
            .unwrap();
        let mut input = tempfile::NamedTempFile::new().unwrap();
        input.write_all(b"{}\n").unwrap();
        let invocation = external_invocation(oracle, input.path(), &BTreeMap::new()).unwrap();
        let arguments = sandbox_arguments(
            &format!(
                "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                "a".repeat(64)
            ),
            "asyncapi-parser",
            &invocation,
            "prismpm-oracle-test",
            "prismpm-oracle-test-inputs",
            oracle.memory_bytes,
        )
        .unwrap();
        let joined = arguments.join("\n");
        for required in [
            "create\n--name\nprismpm-oracle-test",
            "--user\n1000:1000",
            "--pull\nnever",
            "--network\nnone",
            "--read-only",
            "--cap-drop\nALL",
            "--security-opt\nno-new-privileges",
            "--memory\n268435456",
            "--memory-swap\n268435456",
            "--tmpfs\n/scratch:rw,nosuid,nodev,noexec,size=67108864,mode=1777",
            "--entrypoint\n/usr/bin/env",
            "-i\nHOME=/scratch",
            "PRISMPM_ORACLE_SANDBOX=1",
            "asyncapi-parser",
            "/oracle-input",
        ] {
            assert!(
                joined.contains(required),
                "missing sandbox argv: {required}"
            );
        }
        assert!(!joined.contains("type=bind"));
        assert!(joined.contains(
            "type=volume,source=prismpm-oracle-test-inputs,target=/oracle-inputs,readonly"
        ));
        assert_eq!(invocation.mounts[0].guest, "/oracle-inputs/input");
        assert!(!joined.contains("/var/run/docker.sock,target="));
        assert!(!joined.contains("sh -c"));
        assert!(!joined.contains("PRISMPM_SECRET_DIR="));

        let compose = catalog
            .oracle
            .iter()
            .find(|oracle| oracle.id == "compose-fee041b3")
            .unwrap();
        let invocation = external_invocation(compose, input.path(), &BTreeMap::new()).unwrap();
        let arguments = sandbox_arguments(
            &format!("example.test/sdk@sha256:{}", "a".repeat(64)),
            "docker",
            &invocation,
            "prismpm-compose-test",
            "prismpm-compose-inputs",
            compose.memory_bytes,
        )
        .unwrap();
        let joined = arguments.join("\n");
        assert!(joined
            .contains("PRISMPM_SECRET_DIR=/scratch/prismpm-secret-references\ndocker\ncompose"));
        for bypass in [
            "--no-interpolate",
            "--no-consistency",
            "--no-normalize",
            "--no-path-resolution",
        ] {
            assert!(!arguments.iter().any(|argument| argument == bypass));
        }
    }

    #[test]
    fn oracle_input_archive_normalizes_host_metadata_without_changing_bytes() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("source");
        std::fs::create_dir(&input).unwrap();
        std::fs::write(input.join("nested.txt"), b"exact oracle bytes\n").unwrap();
        let invocation = SandboxInvocation {
            arguments: Vec::new(),
            mounts: vec![SandboxMount {
                host: input.clone(),
                guest: "/oracle-inputs/input".to_owned(),
            }],
        };
        let first = root.path().join("first.tar");
        oracle_input_archive(&invocation, &first).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(&input, std::fs::Permissions::from_mode(0o700)).unwrap();
            std::fs::set_permissions(
                input.join("nested.txt"),
                std::fs::Permissions::from_mode(0o600),
            )
            .unwrap();
        }
        let second = root.path().join("second.tar");
        oracle_input_archive(&invocation, &second).unwrap();
        assert_eq!(
            std::fs::read(&first).unwrap(),
            std::fs::read(&second).unwrap()
        );
        let mut archive = tar::Archive::new(File::open(first).unwrap());
        let mut names = Vec::new();
        for entry in archive.entries().unwrap() {
            let mut entry = entry.unwrap();
            names.push(entry.path().unwrap().to_string_lossy().into_owned());
            assert_eq!(entry.header().uid().unwrap(), 1000);
            assert_eq!(entry.header().gid().unwrap(), 1000);
            assert_eq!(entry.header().mtime().unwrap(), 0);
            if entry.header().entry_type().is_dir() {
                assert_eq!(entry.header().mode().unwrap(), 0o555);
            } else {
                assert_eq!(entry.header().mode().unwrap(), 0o444);
                let mut contents = Vec::new();
                entry.read_to_end(&mut contents).unwrap();
                assert_eq!(contents, b"exact oracle bytes\n");
            }
        }
        assert_eq!(names, ["input/", "input/nested.txt"]);
    }

    #[test]
    fn oracle_input_archive_rejects_escape_overlap_and_nonregular_inputs() {
        let root = tempfile::tempdir().unwrap();
        let input = root.path().join("source");
        std::fs::write(&input, b"input").unwrap();
        let destination = root.path().join("input.tar");
        for guest in [
            "/outside/input",
            "/oracle-inputs/../escape",
            "/oracle-inputs/",
        ] {
            let invocation = SandboxInvocation {
                arguments: Vec::new(),
                mounts: vec![SandboxMount {
                    host: input.clone(),
                    guest: guest.to_owned(),
                }],
            };
            assert_eq!(
                oracle_input_archive(&invocation, &destination)
                    .unwrap_err()
                    .code,
                "PP5403"
            );
        }
        let duplicate = SandboxInvocation {
            arguments: Vec::new(),
            mounts: vec![
                SandboxMount {
                    host: input.clone(),
                    guest: "/oracle-inputs/input".to_owned(),
                },
                SandboxMount {
                    host: input.clone(),
                    guest: "/oracle-inputs/input".to_owned(),
                },
            ],
        };
        assert!(oracle_input_archive(&duplicate, &destination).is_err());
        #[cfg(unix)]
        {
            use std::os::unix::{fs::symlink, net::UnixListener};
            let link = root.path().join("link");
            symlink(&input, &link).unwrap();
            let socket = root.path().join("socket");
            let _listener = UnixListener::bind(&socket).unwrap();
            for source in [link, socket] {
                let invocation = SandboxInvocation {
                    arguments: Vec::new(),
                    mounts: vec![SandboxMount {
                        host: source,
                        guest: "/oracle-inputs/input".to_owned(),
                    }],
                };
                assert!(oracle_input_archive(&invocation, &destination).is_err());
            }
        }
    }

    #[test]
    fn external_oracle_cannot_validate_a_different_subject_binding() {
        let catalog = catalog().unwrap();
        let oracle = catalog
            .oracle
            .iter()
            .find(|oracle| oracle.id == "sigstore-cosign-3.1.3")
            .unwrap();
        let input = tempfile::NamedTempFile::new().unwrap();
        let other = tempfile::NamedTempFile::new().unwrap();
        let bundle = tempfile::NamedTempFile::new().unwrap();
        let mut trusted_root = tempfile::NamedTempFile::new().unwrap();
        trusted_root.write_all(SIGSTORE_TRUSTED_ROOT).unwrap();
        let bindings = BTreeMap::from([
            ("bundle".to_owned(), bundle.path().display().to_string()),
            (
                "identity".to_owned(),
                "https://example.test/workflow".to_owned(),
            ),
            ("issuer".to_owned(), "https://example.test".to_owned()),
            ("subject".to_owned(), other.path().display().to_string()),
            (
                "trusted-root".to_owned(),
                trusted_root.path().display().to_string(),
            ),
        ]);
        let error = external_invocation(oracle, input.path(), &bindings).unwrap_err();
        assert_eq!(error.code, "PP5403");
        assert!(error.message.contains("differs from the measured input"));
    }

    #[test]
    fn cosign_oracle_requires_and_mounts_an_explicit_trusted_root() {
        let catalog = catalog().unwrap();
        let oracle = catalog
            .oracle
            .iter()
            .find(|oracle| oracle.id == "sigstore-cosign-3.1.3")
            .unwrap();
        let subject = tempfile::NamedTempFile::new().unwrap();
        let bundle = tempfile::NamedTempFile::new().unwrap();
        let mut trusted_root = tempfile::NamedTempFile::new().unwrap();
        trusted_root.write_all(SIGSTORE_TRUSTED_ROOT).unwrap();
        let mut bindings = BTreeMap::from([
            ("bundle".to_owned(), bundle.path().display().to_string()),
            (
                "identity".to_owned(),
                "https://example.test/workflow".to_owned(),
            ),
            ("issuer".to_owned(), "https://example.test".to_owned()),
            ("subject".to_owned(), subject.path().display().to_string()),
        ]);
        let error = external_invocation(oracle, subject.path(), &bindings).unwrap_err();
        assert_eq!(error.code, "PP5403");
        assert!(error.message.contains("{trusted-root}"));

        bindings.insert(
            "trusted-root".to_owned(),
            trusted_root.path().display().to_string(),
        );
        let invocation = external_invocation(oracle, subject.path(), &bindings).unwrap();
        assert!(invocation
            .arguments
            .windows(2)
            .any(|pair| pair == ["--trusted-root", "/oracle-inputs/trusted-root"]));
        assert!(invocation.mounts.iter().any(|mount| {
            mount.host == trusted_root.path() && mount.guest == "/oracle-inputs/trusted-root"
        }));

        std::fs::write(trusted_root.path(), b"{}\n").unwrap();
        let error = external_invocation(oracle, subject.path(), &bindings).unwrap_err();
        assert_eq!(error.code, "PP5403");
        assert!(error.message.contains("does not match"));
    }

    #[test]
    fn signed_tag_evidence_is_content_bound_and_tamper_evident() {
        let revision = "b".repeat(40);
        let payload = format!(
            "object {revision}\ntype commit\ntag v1\ntagger Example <example@example.test> 0 +0000\n\nv1\n"
        );
        let signature = "-----BEGIN TEST SIGNATURE-----\nabc\n-----END TEST SIGNATURE-----\n";
        let tag = git_tag_sha1(&payload, signature);
        let authority = json!({
            "canonical_id":"example/project",
            "id":"EXAMPLE",
            "source":{"revision":revision,"signature":format!("signed-tag-object:{tag}")}
        });
        let evidence = encode_value(&json!({
            "authority":"EXAMPLE",
            "payload":payload,
            "provider":"github",
            "repository":"example/project",
            "schema":"prismpm/github-tag-verification/1",
            "signature":signature,
            "tag_object_sha1":tag,
            "target_revision":"b".repeat(40),
            "verification":"valid"
        }))
        .unwrap();
        assert!(validate_signature_evidence(&authority, &evidence).is_ok());
        let mut tampered: serde_json::Value = serde_json::from_slice(&evidence).unwrap();
        tampered["payload"] = serde_json::Value::String("changed".to_owned());
        let tampered = encode_value(&tampered).unwrap();
        assert_eq!(
            validate_signature_evidence(&authority, &tampered)
                .unwrap_err()
                .code,
            "PP5402"
        );
    }

    #[test]
    fn immutable_cache_rejects_changed_bytes_without_network_access() {
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        let rows = acquired_rows(&standards).unwrap();
        let digest = &rows.first().unwrap().0;
        let destination = cache_object(root.path(), digest);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(destination, b"planted changed authority bytes").unwrap();
        let error = fetch(root.path()).unwrap_err();
        assert_eq!(error.code, "PP5402");
        assert!(error.message.contains("has changed"));
    }

    #[test]
    fn project_oracle_execution_rejects_a_stale_binding() {
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        let sdk_image = format!(
            "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
            "a".repeat(64)
        );
        write_sdk_lock(root.path(), standards.digest(), sdk_image.clone());
        let catalog = catalog().unwrap();
        let oracle = catalog
            .oracle
            .iter()
            .find(|row| row.id == "openapi-3.2-schema")
            .unwrap();
        verify_project_oracle_binding(root.path(), oracle).unwrap();

        write_sdk_lock(root.path(), format!("sha256:{}", "b".repeat(64)), sdk_image);
        let error = verify_project_oracle_binding(root.path(), oracle).unwrap_err();
        assert_eq!(error.code, "PP5403");
        assert!(error.message.contains("does not select"));
    }

    #[test]
    fn docker_sandbox_spdx_uses_locked_sdk_schema_for_project_validation() {
        let sdk_image = std::env::var("PRISMPM_TEST_SDK_IMAGE")
            .expect("PRISMPM_TEST_SDK_IMAGE must be an exact locally available image digest");
        crate::oci::validate_reference(&sdk_image, true).unwrap();
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        write_sdk_lock(root.path(), standards.digest(), sdk_image.clone());
        // No project-side schema: the sandbox must use the inventory-bound SDK resource.
        assert!(!root.path().join("standards").exists());
        for (name, bytes, valid) in [
            (
                "valid.json",
                include_bytes!("../standards/corpora/spdx-3.0.1/valid-core-software.json")
                    .as_slice(),
                true,
            ),
            (
                "invalid.json",
                include_bytes!("../standards/corpora/spdx-3.0.1/invalid-unknown-element.json")
                    .as_slice(),
                false,
            ),
        ] {
            let input = root.path().join(name);
            std::fs::write(&input, bytes).unwrap();
            let result = run_oracle_in_project(root.path(), "spdx", &input);
            let normalized = if valid { "valid" } else { "invalid" };
            let relative = format!(
                ".prism/evidence/oracle-spdx-3.0.1-model-{}-{normalized}.intoto.json",
                content_id(bytes)
            );
            if valid {
                let accepted = result.expect("valid SPDX corpus must pass the project runner");
                assert!(accepted.valid);
                assert_eq!(accepted.oracle, "spdx-3.0.1-model");
                assert_eq!(accepted.evidence_path.as_deref(), Some(relative.as_str()));
                let attestation = std::fs::read(root.path().join(&relative)).unwrap();
                assert_eq!(
                    accepted.attestation_digest,
                    format!("sha256:{}", content_id(&attestation))
                );
            } else {
                assert_eq!(result.unwrap_err().code, "PP5404");
            }
            let bytes = std::fs::read(root.path().join(relative)).unwrap();
            let statement: Value = serde_json::from_slice(&bytes).unwrap();
            assert_eq!(encode_value(&statement).unwrap(), bytes);
            assert_eq!(statement["predicate"]["normalized_result"], normalized);
            assert_eq!(statement["predicate"]["runner_image"], sdk_image);
            assert_eq!(
                statement["subject"][0]["digest"]["sha256"],
                content_id(&std::fs::read(&input).unwrap())
            );
        }
        assert_eq!(
            std::fs::read_dir(root.path().join(".prism/evidence"))
                .unwrap()
                .count(),
            2
        );
    }

    #[test]
    fn host_effect_system_compose_passes_the_locked_oracle() {
        let sdk_image = std::env::var("PRISMPM_TEST_SDK_IMAGE").unwrap();
        crate::oci::validate_reference(&sdk_image, true).unwrap();
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        write_sdk_lock(root.path(), standards.digest(), sdk_image);
        let (system, _) = crate::system::host_effect::example();
        for projection in crate::system::projections(&system, &[]).unwrap() {
            let name = projection.path.rsplit('/').next().unwrap();
            let (profile, oracle) = match name {
                "compose.json" => ("compose", "compose-fee041b3"),
                "spdx.json" => ("spdx", "spdx-3.0.1-model"),
                other => panic!("unplanned host-effect projection {other}"),
            };
            let path = root.path().join(name);
            std::fs::write(&path, &projection.bytes).unwrap();
            let result = run_oracle_in_project(root.path(), profile, &path)
                .unwrap_or_else(|error| panic!("{name} must pass {oracle}: {error:?}"));
            assert!(result.valid);
            assert_eq!(result.oracle, oracle);
            assert_eq!(std::fs::read(&path).unwrap(), projection.bytes);
            if profile == "compose" {
                // The oracle checks Compose validity; the loopback audit of the
                // emitted bytes is the check a wildcard binding cannot pass.
                let compose: Value = serde_json::from_slice(&projection.bytes).unwrap();
                crate::system::host_effect::audit_compose(&compose).unwrap();
                assert_eq!(
                    compose["services"]["gateway"]["ports"][0]["host_ip"],
                    "127.0.0.1"
                );
                let mut dangling = compose.clone();
                dangling["services"]["gateway"]["depends_on"]["absent"] =
                    json!({"condition":"service_healthy","required":true});
                let path = root.path().join("compose-dangling.json");
                std::fs::write(&path, encode_value(&dangling).unwrap()).unwrap();
                assert_eq!(
                    run_oracle_in_project(root.path(), "compose", &path)
                        .unwrap_err()
                        .code,
                    "PP5404"
                );
            }
        }
    }

    #[test]
    fn docker_sandbox_compose_checks_secret_references_without_credentials() {
        let sdk_image = std::env::var("PRISMPM_TEST_SDK_IMAGE").unwrap();
        crate::oci::validate_reference(&sdk_image, true).unwrap();
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        write_sdk_lock(root.path(), standards.digest(), sdk_image);
        let document = json!({
            "name":"oracle-secret-reference",
            "services":{"app":{"image":"example.test/app:fixture","secrets":["credential"]}},
            "secrets":{"credential":{"file":"${PRISMPM_SECRET_DIR:?required}/credential"}}
        });
        for mutation in 0..3 {
            let mut value = document.clone();
            match mutation {
                0 => {}
                1 => value["services"]["app"]["depends_on"] = json!(["absent"]),
                2 => {
                    value["secrets"]["credential"]["file"] =
                        json!("${UNBOUND_ORACLE_SECRET_ROOT:?required}/credential")
                }
                _ => unreachable!(),
            }
            let bytes = encode_value(&value).unwrap();
            let path = root.path().join(format!("compose-{mutation}.json"));
            std::fs::write(&path, &bytes).unwrap();
            let result = run_oracle_in_project(root.path(), "compose", &path);
            if mutation == 0 {
                assert!(
                    result
                        .expect("modeled secret references must validate without credentials")
                        .valid
                );
            } else {
                assert_eq!(result.unwrap_err().code, "PP5404");
            }
            assert_eq!(std::fs::read(&path).unwrap(), bytes);
        }
        assert!(!root.path().join("credential").exists());
    }

    #[test]
    fn docker_sandbox_executes_all_locked_external_oracle_corpora() {
        let sdk_image = std::env::var("PRISMPM_TEST_SDK_IMAGE")
            .expect("PRISMPM_TEST_SDK_IMAGE must be an exact locally available image digest");
        crate::oci::validate_reference(&sdk_image, true).expect("immutable SDK image reference");
        let root = tempfile::tempdir().unwrap();
        let standards = resolved_lock().unwrap();
        std::fs::write(root.path().join("standards.lock"), standards.bytes()).unwrap();
        write_sdk_lock(root.path(), standards.digest(), sdk_image);

        let valid = root.path().join("valid.json");
        std::fs::write(
            &valid,
            br#"{"asyncapi":"3.1.0","channels":{},"info":{"title":"Calculator","version":"1"}}"#,
        )
        .unwrap();
        let accepted = run_oracle_in_project(root.path(), "asyncapi", &valid).unwrap();
        assert!(accepted.valid);
        assert_eq!(accepted.oracle, "asyncapi-3.1-schema");
        assert!(root.path().join(accepted.evidence_path.unwrap()).is_file());

        let invalid = root.path().join("invalid.json");
        std::fs::write(&invalid, br#"{"asyncapi":"3.1.0","channels":{},"info":{}}"#).unwrap();
        let rejected = run_oracle_in_project(root.path(), "asyncapi", &invalid).unwrap_err();
        assert_eq!(rejected.code, "PP5404");
        assert_eq!(
            std::fs::read_dir(root.path().join(".prism/evidence"))
                .unwrap()
                .count(),
            2
        );

        let statement = root.path().join("statement.json");
        std::fs::write(
            &statement,
            br#"{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":"artifact","digest":{"sha256":"00"}}],"predicateType":"https://example.test/predicate","predicate":{}}"#,
        )
        .unwrap();
        assert!(run_oracle_in_project(root.path(), "in-toto", &statement).is_ok());
        std::fs::write(
            &statement,
            br#"{"_type":"https://in-toto.io/Statement/v1","subject":"wrong-wire-type","predicateType":"https://example.test/predicate"}"#,
        )
        .unwrap();
        assert_eq!(
            run_oracle_in_project(root.path(), "in-toto", &statement)
                .unwrap_err()
                .code,
            "PP5404"
        );

        let otel = root.path().join("otel.yaml");
        std::fs::write(
            &otel,
            "receivers:\n  otlp:\n    protocols:\n      grpc:\n        endpoint: 127.0.0.1:4317\nexporters:\n  debug: {}\nservice:\n  pipelines:\n    traces:\n      receivers: [otlp]\n      exporters: [debug]\n",
        )
        .unwrap();
        assert!(run_oracle_in_project(root.path(), "otel", &otel).is_ok());
        std::fs::write(
            &otel,
            "receivers: {}\nexporters: {}\nservice:\n  pipelines:\n    traces:\n      receivers: [missing]\n      exporters: [missing]\n",
        )
        .unwrap();
        assert_eq!(
            run_oracle_in_project(root.path(), "otel", &otel)
                .unwrap_err()
                .code,
            "PP5404"
        );

        let compose = root.path().join("compose.yaml");
        std::fs::write(
            &compose,
            format!(
                "services:\n  app:\n    image: busybox@sha256:{}\n    command: [\"true\"]\n",
                "0".repeat(64)
            ),
        )
        .unwrap();
        run_oracle_in_project(root.path(), "compose", &compose).unwrap();
        std::fs::write(&compose, "services: []\n").unwrap();
        assert_eq!(
            run_oracle_in_project(root.path(), "compose", &compose)
                .unwrap_err()
                .code,
            "PP5404"
        );

        let workspace = root.path().join("workspace");
        std::fs::create_dir_all(workspace.join(".devcontainer")).unwrap();
        std::fs::write(
            workspace.join(".devcontainer/devcontainer.json"),
            include_bytes!("../standards/corpora/devcontainer-c95ffeed/valid-minimal.json"),
        )
        .unwrap();
        run_oracle_in_project(root.path(), "devcontainer", &workspace).unwrap();
        std::fs::write(
            workspace.join(".devcontainer/devcontainer.json"),
            include_bytes!("../standards/corpora/devcontainer-c95ffeed/invalid-image-type.json"),
        )
        .unwrap();
        assert_eq!(
            run_oracle_in_project(root.path(), "devcontainer", &workspace)
                .unwrap_err()
                .code,
            "PP5404"
        );

        let kubernetes = root.path().join("kubernetes.yaml");
        std::fs::write(
            &kubernetes,
            include_bytes!("../standards/corpora/kubernetes-1.36.4/valid-service.yaml"),
        )
        .unwrap();
        assert!(run_oracle_in_project(root.path(), "kubernetes", &kubernetes).is_ok());
        std::fs::write(
            &kubernetes,
            include_bytes!("../standards/corpora/kubernetes-1.36.4/invalid-pod.yaml"),
        )
        .unwrap();
        assert_eq!(
            run_oracle_in_project(root.path(), "kubernetes", &kubernetes)
                .unwrap_err()
                .code,
            "PP5404"
        );

        let cosign_subject = root.path().join("cosign-checksums.txt");
        let cosign_bundle = root.path().join("cosign-checksums.sigstore.json");
        let cosign_root = root.path().join("sigstore-trusted-root.json");
        std::fs::write(
            &cosign_subject,
            include_bytes!("../standards/corpora/cosign-3.1.3/cosign_checksums.txt"),
        )
        .unwrap();
        std::fs::write(
            &cosign_bundle,
            include_bytes!("../standards/corpora/cosign-3.1.3/cosign_checksums.txt.sigstore.json"),
        )
        .unwrap();
        std::fs::write(&cosign_root, SIGSTORE_TRUSTED_ROOT).unwrap();
        let cosign_bindings = BTreeMap::from([
            ("bundle".to_owned(), cosign_bundle.display().to_string()),
            (
                "identity".to_owned(),
                "keyless@projectsigstore.iam.gserviceaccount.com".to_owned(),
            ),
            (
                "issuer".to_owned(),
                "https://accounts.google.com".to_owned(),
            ),
            ("subject".to_owned(), cosign_subject.display().to_string()),
            ("trusted-root".to_owned(), cosign_root.display().to_string()),
        ]);
        run_oracle_with_bindings_in_project(
            root.path(),
            "cosign",
            &cosign_subject,
            &cosign_bindings,
        )
        .unwrap();
        let mut wrong_cosign_identity = cosign_bindings.clone();
        wrong_cosign_identity.insert("identity".to_owned(), "wrong@example.invalid".to_owned());
        assert_eq!(
            run_oracle_with_bindings_in_project(
                root.path(),
                "cosign",
                &cosign_subject,
                &wrong_cosign_identity,
            )
            .unwrap_err()
            .code,
            "PP5404"
        );
        std::fs::write(&cosign_subject, b"planted mutation\n").unwrap();
        assert_eq!(
            run_oracle_with_bindings_in_project(
                root.path(),
                "cosign",
                &cosign_subject,
                &cosign_bindings,
            )
            .unwrap_err()
            .code,
            "PP5404"
        );

        let slsa_subject = root.path().join("slsa-subject");
        let slsa_provenance = root.path().join("slsa-provenance.sigstore");
        std::fs::write(
            &slsa_subject,
            include_bytes!(
                "../standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch"
            ),
        )
        .unwrap();
        std::fs::write(
            &slsa_provenance,
            include_bytes!(
                "../standards/corpora/slsa-verifier-2.7.1/binary-linux-amd64-workflow_dispatch.intoto.sigstore"
            ),
        )
        .unwrap();
        let slsa_bindings = BTreeMap::from([
            (
                "identity".to_owned(),
                "https://github.com/slsa-framework/slsa-github-generator/.github/workflows/builder_container-based_slsa3.yml@refs/tags/v1.7.0".to_owned(),
            ),
            (
                "issuer".to_owned(),
                "https://token.actions.githubusercontent.com".to_owned(),
            ),
            (
                "provenance".to_owned(),
                slsa_provenance.display().to_string(),
            ),
            (
                "source-uri".to_owned(),
                "github.com/slsa-framework/example-package".to_owned(),
            ),
            (
                "subject".to_owned(),
                slsa_subject.display().to_string(),
            ),
            (
                "trusted-root".to_owned(),
                cosign_root.display().to_string(),
            ),
        ]);
        run_oracle_with_bindings_in_project(root.path(), "slsa", &slsa_subject, &slsa_bindings)
            .unwrap();
        let mut wrong_slsa_source = slsa_bindings.clone();
        wrong_slsa_source.insert(
            "source-uri".to_owned(),
            "github.com/slsa-framework/wrong-source".to_owned(),
        );
        assert_eq!(
            run_oracle_with_bindings_in_project(
                root.path(),
                "slsa",
                &slsa_subject,
                &wrong_slsa_source,
            )
            .unwrap_err()
            .code,
            "PP5404"
        );
        std::fs::write(&slsa_subject, b"planted mutation\n").unwrap();
        assert_eq!(
            run_oracle_with_bindings_in_project(
                root.path(),
                "slsa",
                &slsa_subject,
                &slsa_bindings,
            )
            .unwrap_err()
            .code,
            "PP5404"
        );

        let signed = standards.value()["authorities"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|authority| {
                authority["source"]["signature"]
                    .as_str()
                    .is_some_and(|value| value.starts_with("signed-tag-object:"))
            })
            .collect::<Vec<_>>();
        assert_eq!(signed.len(), 5);
        let signature_cache = root.path().join(".prism/cache/authorities/git-tag-sha1");
        std::fs::create_dir_all(&signature_cache).unwrap();
        let mut verified = Vec::new();
        for authority in &signed {
            let tag = authority["source"]["signature"]
                .as_str()
                .unwrap()
                .trim_start_matches("signed-tag-object:");
            let value: serde_json::Value = serde_json::from_slice(signed_tag_corpus(tag)).unwrap();
            let canonical = encode_value(&value).unwrap();
            let evidence = validate_signature_evidence(authority, &canonical).unwrap();
            std::fs::write(signature_cache.join(format!("{tag}.json")), canonical).unwrap();
            verified.push(((*authority).clone(), evidence));
        }
        let (_, reused, replayed) =
            verify_signature_evidence_set(root.path(), &standards, false).unwrap();
        assert_eq!(reused, 5);
        assert_eq!(replayed.len(), 5);
        assert!(replayed
            .iter()
            .all(|value| value["offline_verification"]["runner"] == "git-signature-validator/1"));

        let (mut wrong_key_authority, pgp_evidence) = verified[0].clone();
        wrong_key_authority["signature_trust_root"] = signed[2]["signature_trust_root"].clone();
        assert_eq!(
            replay_tag_signature(root.path(), &wrong_key_authority, &pgp_evidence)
                .unwrap_err()
                .code,
            "PP5404"
        );
        let mut tampered_payload = verified[3].1.clone();
        tampered_payload["payload"] = serde_json::Value::String(format!(
            "{}planted",
            tampered_payload["payload"].as_str().unwrap()
        ));
        assert_eq!(
            replay_tag_signature(root.path(), &verified[3].0, &tampered_payload)
                .unwrap_err()
                .code,
            "PP5404"
        );
        let mut tampered_signature = pgp_evidence.clone();
        tampered_signature["signature"] = serde_json::Value::String(
            tampered_signature["signature"]
                .as_str()
                .unwrap()
                .replacen("BEGIN PGP", "BEGIN BAD", 1),
        );
        assert_eq!(
            replay_tag_signature(root.path(), &verified[0].0, &tampered_signature)
                .unwrap_err()
                .code,
            "PP5404"
        );
        let mut stale_revision = verified[0].0.clone();
        stale_revision["source"]["revision"] = serde_json::Value::String("0".repeat(40));
        assert_eq!(
            validate_signature_evidence(&stale_revision, &encode_value(&pgp_evidence).unwrap())
                .unwrap_err()
                .code,
            "PP5402"
        );
    }
}
