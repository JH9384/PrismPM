//! Transparency log entries and signed timestamps (issue #275), checked
//! offline. A port of `sdk/npm/verify/src/transparency.mjs`, the JavaScript
//! reference: every check runs and the result lists every problem at once.
//!
//! What is checked:
//!   `timestamp.*`        each RFC 3161 timestamp is signed by a pinned timestamp
//!                        authority, was issued inside that authority's validity, and
//!                        covers the bundle's signature;
//!   `certificate.chain`  the signing certificate chains to a pinned certificate
//!                        authority and was valid at the signed time;
//!   `tlog.*`             each log entry names a pinned log, records this bundle's
//!                        signature, has an inclusion proof that recomputes to the
//!                        checkpoint's root, and the checkpoint is signed by the pinned
//!                        log key.
//!
//! The entry kinds read are `hashedrekord/0.0.2` and `dsse/0.0.2` (Rekor v2)
//! and `dsse/0.0.1` (Rekor v1, what the public instance still logs for
//! attestations); any other is `tlog.kind`. A log entry is checked by its
//! inclusion proof and signed checkpoint, never by a Rekor v1 signed entry
//! timestamp or its integrated time.

use super::certificate::{chain_problem, parse_certificate, Certificate};
use super::crypto::{self, Hash, Kind, Scheme};
use super::der::{self, oid, Node};
use super::trust::{Authority, TrustedRoot};
use super::{base64_any, clock};
use serde_json::Value;

/// One check of the transparency evidence, passed or not.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Check {
    /// The check id, `timestamp.0`, `certificate.chain`, `tlog.body`, ...
    pub check: String,
    /// Whether it passed.
    pub passed: bool,
    /// What was found.
    pub message: String,
}

/// One reason the evidence did not verify, in the shape of a verdict reason.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct Reason {
    /// The check id without its index, `timestamp`, `tlog.body`, ...
    pub check: String,
    /// What was found.
    pub message: String,
}

/// The outcome of checking a bundle's log entries and timestamps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Transparency {
    /// No check failed.
    pub passed: bool,
    /// The earliest verified signed time, in milliseconds since the epoch.
    pub time: Option<i64>,
    /// Every check that ran.
    pub checks: Vec<Check>,
    /// The failed checks.
    pub reasons: Vec<Reason>,
}

/// The signature and what the log must have recorded about it.
pub(crate) struct Facts {
    pub(crate) signatures: Vec<Vec<u8>>,
    pub(crate) payload: Option<Vec<u8>>,
    pub(crate) digest: Vec<u8>,
}

/// The DSSE pre-authentication encoding the signature covers.
pub(crate) fn pae(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "DSSEv1 {} {} {} ",
        payload_type.len(),
        payload_type,
        payload.len()
    )
    .into_bytes();
    out.extend_from_slice(payload);
    out
}

pub(crate) fn signed_facts(bundle: &Value) -> Option<Facts> {
    if let Some(envelope) = bundle.get("dsseEnvelope") {
        let payload = base64_any(envelope.get("payload")?.as_str()?)?;
        let payload_type = envelope.get("payloadType")?.as_str()?;
        let signatures = envelope
            .get("signatures")?
            .as_array()?
            .iter()
            .map(|signature| base64_any(signature.get("sig")?.as_str()?))
            .collect::<Option<Vec<_>>>()?;
        let digest = crypto::sha256(&pae(payload_type, &payload));
        return Some(Facts {
            signatures,
            payload: Some(payload),
            digest,
        });
    }
    let message = bundle.get("messageSignature")?;
    Some(Facts {
        signatures: vec![base64_any(message.get("signature")?.as_str()?)?],
        payload: None,
        digest: base64_any(message.get("messageDigest")?.get("digest")?.as_str()?)?,
    })
}

// ------------------------------------------------------------------ timestamps

fn find<'a, 'b>(nodes: &'b [Node<'a>], tag: u8) -> Option<&'b Node<'a>> {
    nodes.iter().find(|node| node.tag == tag)
}

struct TimestampInfo {
    gen_time: i64,
    hash: Option<Hash>,
    hashed: Vec<u8>,
}

fn parse_timestamp(
    encoded: &str,
    trusted: &[Authority],
) -> Result<(TimestampInfo, Certificate), String> {
    let bytes = base64_any(encoded).ok_or_else(|| "not base64".to_owned())?;
    let mut token = der::expect(Some(&der::parse(&bytes, 0)?), 0x30, "timestamp")?;
    // Sigstore stores the whole RFC 3161 TimeStampResp: a status, then the token. A bare token is accepted too.
    let outer = der::children(&token)?;
    if outer.first().is_some_and(|first| first.tag == 0x30) && outer.len() > 1 {
        let status = der::children(&outer[0])?;
        let granted = status.first().is_some_and(|status| {
            status.tag == 0x02 && status.body.len() == 1 && status.body[0] <= 1
        });
        if !granted {
            return Err("the timestamp response was not granted".to_owned());
        }
        token = der::expect(Some(&outer[1]), 0x30, "TimeStampToken")?;
    }
    let content_info = der::children(&token)?;
    if content_info.len() < 2 || der::oid(&content_info[0])? != oid::SIGNED_DATA {
        return Err("the timestamp is not CMS SignedData".to_owned());
    }
    let wrapped = der::children(&der::expect(Some(&content_info[1]), 0xa0, "content")?)?;
    let signed_data = der::children(&der::expect(wrapped.first(), 0x30, "SignedData")?)?;
    if signed_data.len() < 4 {
        return Err("SignedData is too short".to_owned());
    }
    let encapsulated = der::children(&signed_data[2])?;
    if encapsulated.len() < 2 || der::oid(&encapsulated[0])? != oid::TST_INFO {
        return Err("the timestamp does not carry a TSTInfo".to_owned());
    }
    let e_content = der::children(&der::expect(Some(&encapsulated[1]), 0xa0, "eContent")?)?;
    let content = der::expect(e_content.first(), 0x04, "eContent")?.body;
    let embedded = match find(&signed_data, 0xa0) {
        Some(certs) => der::children(certs)?
            .iter()
            .map(|cert| parse_certificate(cert.tlv))
            .collect::<Result<Vec<_>, _>>()?,
        None => Vec::new(),
    };
    let signer_infos = der::children(&der::expect(signed_data.last(), 0x31, "signerInfos")?)?;
    if signer_infos.len() != 1 {
        return Err("the timestamp must have exactly one signer".to_owned());
    }
    let fields = der::children(&signer_infos[0])?;
    if fields.len() < 5 {
        return Err("SignerInfo is too short".to_owned());
    }
    let sid = fields[1];
    let digest_algorithm = crypto::hash_of(&der::algorithm(&fields[2])?.0);
    let attributes = find(&fields, 0xa0);
    let (Some(digest_algorithm), Some(attributes)) = (digest_algorithm, attributes) else {
        return Err("the signer has no signed attributes or an unknown digest".to_owned());
    };
    let after = fields
        .iter()
        .position(|field| std::ptr::eq(field, attributes))
        .expect("the attributes were found in the fields");
    let signature_algorithm = crypto::scheme(
        &der::algorithm(
            fields
                .get(after + 1)
                .ok_or_else(|| "no signature algorithm".to_owned())?,
        )?
        .0,
    );
    let signature_bytes = der::expect(fields.get(after + 2), 0x04, "signature")?.body;
    let Some(signature_algorithm) = signature_algorithm else {
        return Err("the signature algorithm is not supported".to_owned());
    };
    fn attribute<'a>(attributes: &Node<'a>, id: &str) -> Result<Option<Node<'a>>, String> {
        for attribute in der::children(attributes)? {
            let members = der::children(&attribute)?;
            if members.len() >= 2 && der::oid(&members[0])? == id {
                return Ok(der::children(&members[1])?.first().copied());
            }
        }
        Ok(None)
    }
    let claimed = attribute(attributes, oid::MESSAGE_DIGEST)?;
    if !claimed.is_some_and(|claimed| claimed.body == crypto::digest(digest_algorithm, content)) {
        return Err("the signed message digest does not match the TSTInfo".to_owned());
    }
    let content_type = attribute(attributes, oid::CONTENT_TYPE)?;
    if !content_type.is_some_and(|node| der::oid(&node).ok().as_deref() == Some(oid::TST_INFO)) {
        return Err("the signed content type is not TSTInfo".to_owned());
    }
    let tst = der::children(&der::expect(
        Some(&der::parse(content, 0)?),
        0x30,
        "TSTInfo",
    )?)?;
    if tst.len() < 5 {
        return Err("TSTInfo is too short".to_owned());
    }
    let imprint = der::children(&tst[2])?;
    if imprint.len() < 2 {
        return Err("the message imprint is malformed".to_owned());
    }
    let info = TimestampInfo {
        gen_time: der::time(&tst[4])?,
        hash: crypto::hash_of(&der::algorithm(&imprint[0])?.0),
        hashed: imprint[1].body.to_vec(),
    };
    let matches = |cert: &Certificate| -> bool {
        if sid.tag == 0x30 {
            let Ok(members) = der::children(&sid) else {
                return false;
            };
            return members.len() == 2
                && cert.issuer == members[0].tlv
                && der::integer_hex(&members[1]).ok().as_deref() == Some(cert.serial.as_str());
        }
        sid.tag == 0x80
            && cert
                .extensions
                .get(oid::SUBJECT_KEY_IDENTIFIER)
                .and_then(|ski| {
                    der::parse(&ski.value, 0)
                        .ok()
                        .map(|node| node.body.to_vec())
                })
                .is_some_and(|ski| ski == sid.body)
    };
    let pool = trusted.iter().flat_map(|authority| authority.certs.iter());
    let signer = embedded
        .iter()
        .chain(pool)
        .find(|cert| matches(cert))
        .cloned()
        .ok_or_else(|| "the signing certificate is neither embedded nor pinned".to_owned())?;
    let purposes = match signer.extensions.get(oid::EXTENDED_KEY_USAGE) {
        Some(eku) => der::children(&der::parse(&eku.value, 0)?)?
            .iter()
            .map(der::oid)
            .collect::<Result<Vec<_>, _>>()?,
        None => Vec::new(),
    };
    if !purposes.iter().any(|purpose| purpose == oid::TIME_STAMPING) {
        return Err("the signing certificate is not for time stamping".to_owned());
    }
    let mut covered = attributes.tlv.to_vec();
    covered[0] = 0x31;
    if !crypto::verify(
        &signer.spki,
        signature_algorithm,
        Some(digest_algorithm),
        &covered,
        signature_bytes,
    ) {
        return Err("the timestamp signature does not verify".to_owned());
    }
    Ok((info, signer))
}

/// Check one RFC 3161 timestamp over `signature`. `Ok` carries the signed time in milliseconds.
pub(crate) fn check_timestamp(
    encoded: &str,
    signature: &[u8],
    trusted: &[Authority],
) -> Result<i64, String> {
    let (info, signer) = parse_timestamp(encoded, trusted)
        .map_err(|error| format!("the timestamp does not parse: {error}"))?;
    let authorities = trusted
        .iter()
        .filter(|authority| authority.valid_for.contains(info.gen_time))
        .collect::<Vec<_>>();
    if authorities.is_empty() {
        return Err("no pinned timestamp authority was valid at the signed time".to_owned());
    }
    let mut reason = "no pinned timestamp authority vouches for the signer".to_owned();
    let mut vouched = false;
    for authority in authorities {
        match chain_problem(&signer, &authority.certs, info.gen_time) {
            None => {
                vouched = true;
                break;
            }
            Some(problem) => reason = problem,
        }
    }
    if !vouched {
        return Err(reason);
    }
    let Some(hash) = info.hash else {
        return Err("the timestamp imprint uses an unknown hash".to_owned());
    };
    if info.hashed != crypto::digest(hash, signature) {
        return Err("the timestamp does not cover this bundle's signature".to_owned());
    }
    Ok(info.gen_time)
}

// ------------------------------------------------------------------ Merkle tree

fn node_hash(left: &[u8], right: &[u8]) -> Vec<u8> {
    let mut bytes = vec![1];
    bytes.extend_from_slice(left);
    bytes.extend_from_slice(right);
    crypto::sha256(&bytes)
}

/// RFC 9162 section 2.1.3.2: does `path` take the entry at `index` to `root` in a tree of `size` leaves?
pub(crate) fn inclusion_holds(
    entry: &[u8],
    index: u64,
    size: u64,
    path: &[Vec<u8>],
    root: &[u8],
) -> bool {
    if size == 0 {
        return false;
    }
    let mut fn_ = index;
    let mut sn = size - 1;
    if fn_ > sn {
        return false;
    }
    let mut leaf = vec![0];
    leaf.extend_from_slice(entry);
    let mut hash = crypto::sha256(&leaf);
    for sibling in path {
        if sn == 0 {
            return false;
        }
        if fn_ & 1 == 1 || fn_ == sn {
            hash = node_hash(sibling, &hash);
            while fn_ & 1 == 0 && fn_ != 0 {
                fn_ >>= 1;
                sn >>= 1;
            }
        } else {
            hash = node_hash(&hash, sibling);
        }
        fn_ >>= 1;
        sn >>= 1;
    }
    sn == 0 && hash == root
}

struct Checkpoint {
    origin: String,
    size: String,
    root: Vec<u8>,
    signed: Vec<u8>,
    signatures: Vec<(String, Vec<u8>)>,
}

fn is_count(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 19
        && text.bytes().all(|byte| byte.is_ascii_digit())
        && (text == "0" || !text.starts_with('0'))
}

/// A signed note in the c2sp.org/tlog-checkpoint form. `None` when it is not one.
fn read_checkpoint(text: &str) -> Option<Checkpoint> {
    let split = text.find("\n\n")?;
    let body = &text[..split + 1];
    let mut lines = body.split('\n').collect::<Vec<_>>();
    lines.pop();
    if lines.len() < 3 || lines[0].is_empty() || !is_count(lines[1]) {
        return None;
    }
    let root = base64_any(lines[2])?;
    if root.len() != 32 {
        return None;
    }
    let mut signatures = Vec::new();
    for line in text[split + 2..].split('\n') {
        if line.is_empty() {
            continue;
        }
        let rest = line.strip_prefix("\u{2014} ")?;
        let mut parts = rest.split(' ');
        let (name, encoded, extra) = (parts.next()?, parts.next()?, parts.next());
        if name.is_empty() || encoded.is_empty() || extra.is_some() {
            return None;
        }
        let raw = base64_any(encoded)?;
        if raw.len() > 4 {
            signatures.push((name.to_owned(), raw[4..].to_vec()));
        }
    }
    Some(Checkpoint {
        origin: lines[0].to_owned(),
        size: lines[1].to_owned(),
        root,
        signed: body.as_bytes().to_vec(),
        signatures,
    })
}

// ---------------------------------------------------------------------- bodies

/// The DER of a PEM certificate, or `None`. Rekor v1 logs the verifier as base64 of the PEM text.
fn pem_to_der(bytes: &[u8]) -> Option<Vec<u8>> {
    der::pem_to_der(std::str::from_utf8(bytes).ok()?, None)
}

struct Logged {
    signature: Vec<u8>,
    certificate: Option<Vec<u8>>,
}

fn safe_base64(value: Option<&Value>) -> Vec<u8> {
    value
        .and_then(Value::as_str)
        .and_then(base64_any)
        .unwrap_or_default()
}

/// The signature of `logged` that is this bundle's first, with the certificate it names.
fn logged_signature<'a>(facts: &Facts, logged: &'a [Logged]) -> Option<&'a Logged> {
    let first = facts.signatures.first()?;
    logged.iter().find(|entry| entry.signature == *first)
}

const SUPPORTED_KINDS: [&str; 3] = ["hashedrekord/0.0.2", "dsse/0.0.2", "dsse/0.0.1"];

fn check_kind(
    kind: &str,
    body: &Value,
    facts: &Facts,
    certificate: Option<&[u8]>,
) -> Option<String> {
    let problem = |text: &str| Some(text.to_owned());
    let certificate_matches = |logged: Option<&Vec<u8>>| match certificate {
        None => true,
        Some(certificate) => logged.is_some_and(|logged| logged == certificate),
    };
    match kind {
        "hashedrekord/0.0.2" => {
            let Some(record) = body.pointer("/spec/hashedRekordV002") else {
                return problem("the logged body is not the entry kind it declares");
            };
            let digest = record
                .pointer("/data/digest")
                .and_then(Value::as_str)
                .and_then(base64_any);
            if record.pointer("/data/algorithm").and_then(Value::as_str) != Some("SHA2_256")
                || digest.as_deref() != Some(facts.digest.as_slice())
            {
                return problem("the logged digest is not the digest of what this bundle signed");
            }
            let logged = safe_base64(record.pointer("/signature/content"));
            if !facts.signatures.contains(&logged) {
                return problem("the logged signature is not this bundle's signature");
            }
            let verifier = record
                .pointer("/signature/verifier/x509Certificate/rawBytes")
                .and_then(Value::as_str)
                .and_then(base64_any);
            if !certificate_matches(verifier.as_ref()) {
                return problem("the logged certificate is not this bundle's certificate");
            }
            None
        }
        "dsse/0.0.2" => {
            let Some(record) = body.pointer("/spec/dsseV002") else {
                return problem("the logged body is not the entry kind it declares");
            };
            let Some(payload) = facts.payload.as_ref() else {
                return problem("a DSSE entry is not about a message-signature bundle");
            };
            let digest = record
                .pointer("/payloadHash/digest")
                .and_then(Value::as_str)
                .and_then(base64_any);
            if record
                .pointer("/payloadHash/algorithm")
                .and_then(Value::as_str)
                != Some("SHA2_256")
                || digest != Some(crypto::sha256(payload))
            {
                return problem("the logged payload hash is not the hash of the envelope payload");
            }
            let logged = record
                .get("signatures")
                .and_then(Value::as_array)
                .map(|signatures| {
                    signatures
                        .iter()
                        .map(|signature| Logged {
                            signature: safe_base64(signature.get("content")),
                            certificate: signature
                                .pointer("/verifier/x509Certificate/rawBytes")
                                .map(|raw| safe_base64(Some(raw))),
                        })
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            let Some(mine) = logged_signature(facts, &logged) else {
                return problem("the logged signature is not this bundle's signature");
            };
            if !certificate_matches(mine.certificate.as_ref()) {
                return problem("the logged certificate is not this bundle's certificate");
            }
            None
        }
        "dsse/0.0.1" => {
            let Some(signatures) = body.pointer("/spec/signatures").and_then(Value::as_array)
            else {
                return problem("the logged body is not the entry kind it declares");
            };
            let Some(payload) = facts.payload.as_ref() else {
                return problem("a DSSE entry is not about a message-signature bundle");
            };
            let value = body
                .pointer("/spec/payloadHash/value")
                .and_then(Value::as_str)
                .unwrap_or("");
            if body
                .pointer("/spec/payloadHash/algorithm")
                .and_then(Value::as_str)
                != Some("sha256")
                || value.len() != 64
                || !value
                    .bytes()
                    .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
                || value != der::hex(&crypto::sha256(payload))
            {
                return problem("the logged payload hash is not the hash of the envelope payload");
            }
            let logged = signatures
                .iter()
                .map(|signature| Logged {
                    signature: safe_base64(signature.get("signature")),
                    certificate: signature.get("verifier").and_then(Value::as_str).and_then(
                        |verifier| {
                            pem_to_der(&safe_base64(Some(&Value::String(verifier.to_owned()))))
                        },
                    ),
                })
                .collect::<Vec<_>>();
            let Some(mine) = logged_signature(facts, &logged) else {
                return problem("the logged signature is not this bundle's signature");
            };
            if !certificate_matches(mine.certificate.as_ref()) {
                return problem("the logged certificate is not this bundle's certificate");
            }
            None
        }
        _ => problem("the logged body is not the entry kind it declares"),
    }
}

fn kind_of(entry: &Value) -> (String, String) {
    let text = |key: &str| {
        entry
            .pointer(&format!("/kindVersion/{key}"))
            .and_then(Value::as_str)
            .unwrap_or("undefined")
            .to_owned()
    };
    (text("kind"), text("version"))
}

/// `None` when the logged body records exactly this bundle's signature, digest and certificate.
pub(crate) fn body_problem(
    entry: &Value,
    facts: &Facts,
    certificate: Option<&[u8]>,
) -> Option<String> {
    let body: Value = match entry
        .get("canonicalizedBody")
        .and_then(Value::as_str)
        .and_then(base64_any)
        .and_then(|bytes| serde_json::from_slice(&bytes).ok())
    {
        Some(body) => body,
        None => return Some("the logged body is not JSON".to_owned()),
    };
    let (kind, version) = kind_of(entry);
    let key = format!("{kind}/{version}");
    if !SUPPORTED_KINDS.contains(&key.as_str())
        || body.get("kind").and_then(Value::as_str) != Some(kind.as_str())
        || body.get("apiVersion").and_then(Value::as_str) != Some(version.as_str())
    {
        return Some("the logged body is not the entry kind it declares".to_owned());
    }
    check_kind(&key, &body, facts, certificate)
}

// --------------------------------------------------------------------- entries

fn entry_problems(
    entry: &Value,
    facts: &Facts,
    certificate: Option<&[u8]>,
    root: &TrustedRoot,
    signed_at: Option<i64>,
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let (kind, version) = kind_of(entry);
    let key = format!("{kind}/{version}");
    if !SUPPORTED_KINDS.contains(&key.as_str()) {
        return vec![(
            "tlog.kind".to_owned(),
            format!(
                "the entry kind {key} is none of {}",
                SUPPORTED_KINDS.join(", ")
            ),
        )];
    }
    let key_id = entry
        .pointer("/logId/keyId")
        .and_then(Value::as_str)
        .and_then(base64_any);
    let Some(log) = root
        .tlogs
        .iter()
        .find(|log| Some(&log.key_id) == key_id.as_ref())
    else {
        return vec![(
            "tlog.log".to_owned(),
            "the entry names a log that the trusted root does not pin".to_owned(),
        )];
    };
    let Some(proof) = entry
        .get("inclusionProof")
        .filter(|proof| proof.is_object())
    else {
        return vec![(
            "tlog.inclusion".to_owned(),
            "the entry has no inclusion proof; a Rekor v2 entry is verified by its proof, never by a promise"
                .to_owned(),
        )];
    };
    let text = |value: Option<&Value>| value.and_then(Value::as_str).unwrap_or("").to_owned();
    let (entry_index, proof_index, tree_size) = (
        text(entry.get("logIndex")),
        text(proof.get("logIndex")),
        text(proof.get("treeSize")),
    );
    // A Rekor v2 log is one tree, so the proof's index is the entry's. A Rekor v1 log is sharded: `logIndex` is global
    // across shards and the proof's index is within the tree it was proved in.
    let sharded = version == "0.0.1";
    if ![&entry_index, &proof_index, &tree_size]
        .iter()
        .all(|count| is_count(count))
        || (!sharded && proof_index != entry_index)
    {
        out.push((
            "tlog.inclusion".to_owned(),
            "the proof is for a different log index than the entry".to_owned(),
        ));
    }
    if let Some(problem) = body_problem(entry, facts, certificate) {
        out.push(("tlog.body".to_owned(), problem));
    }
    let included = (|| {
        let path = proof
            .get("hashes")?
            .as_array()?
            .iter()
            .map(|hash| hash.as_str().and_then(base64_any))
            .collect::<Option<Vec<_>>>()?;
        let index: u64 = proof_index.parse().ok()?;
        let size: u64 = tree_size.parse().ok()?;
        let root_hash = base64_any(proof.get("rootHash")?.as_str()?)?;
        let body = base64_any(entry.get("canonicalizedBody")?.as_str()?)?;
        Some(
            path.len() <= 64
                && path.iter().all(|hash| hash.len() == 32)
                && size > index
                && inclusion_holds(&body, index, size, &path, &root_hash),
        )
    })()
    .unwrap_or(false);
    if !included {
        out.push((
            "tlog.inclusion".to_owned(),
            "the inclusion proof does not recompute to the root hash".to_owned(),
        ));
    }
    let Some(note) = proof
        .pointer("/checkpoint/envelope")
        .and_then(Value::as_str)
        .and_then(read_checkpoint)
    else {
        out.push((
            "tlog.checkpoint".to_owned(),
            "the checkpoint is missing or is not a signed note with an origin, a size and a root hash".to_owned(),
        ));
        return out;
    };
    let root_hash = safe_base64(proof.get("rootHash"));
    if note.size != tree_size || note.root != root_hash {
        out.push((
            "tlog.checkpoint".to_owned(),
            "the checkpoint size or root hash differs from the inclusion proof".to_owned(),
        ));
    }
    // A Rekor v2 origin is the log's host; a Rekor v1 origin is the host, ` - `, and the tree id.
    let host = log.base_url.as_deref().map(|url| {
        url.trim_start_matches("https://")
            .trim_start_matches("http://")
            .trim_end_matches('/')
            .to_owned()
    });
    if let Some(host) = &host {
        if note.origin != *host && !note.origin.starts_with(&format!("{host} - ")) {
            out.push((
                "tlog.checkpoint".to_owned(),
                format!(
                    "the checkpoint origin {} is not the pinned log {}",
                    note.origin,
                    log.base_url.as_deref().unwrap_or("")
                ),
            ));
        }
    }
    if signed_at.is_some_and(|at| !log.valid_for.contains(at)) {
        out.push((
            "tlog.checkpoint".to_owned(),
            "the pinned log key was not valid at the signed time".to_owned(),
        ));
    }
    let scheme = match crypto::key_of(&log.spki) {
        Ok(key) if key.kind == oid::ED25519 => Scheme {
            kind: Kind::Ed25519,
            hash: None,
        },
        Ok(key) => Scheme {
            kind: Kind::Ecdsa,
            hash: Some(if key.curve.as_deref() == Some(oid::P384) {
                Hash::Sha384
            } else {
                Hash::Sha256
            }),
        },
        Err(_) => Scheme {
            kind: Kind::Ecdsa,
            hash: Some(Hash::Sha256),
        },
    };
    // The signer of a Rekor v2 checkpoint is named by the origin; a Rekor v1 origin is `<host> - <tree id>` and its signer is `<host>`.
    let signed_by =
        |name: &str| name == note.origin || note.origin.starts_with(&format!("{name} - "));
    let signed = note
        .signatures
        .iter()
        .filter(|(name, _)| signed_by(name))
        .any(|(_, signature)| crypto::verify(&log.spki, scheme, None, &note.signed, signature));
    if !signed {
        out.push((
            "tlog.checkpoint".to_owned(),
            "no signature on the checkpoint from the log's pinned key verifies".to_owned(),
        ));
    }
    out
}

/// Check the transparency log entries and timestamps of one Sigstore bundle
/// against a pinned trusted root. `entries` and `timestamps` are the least
/// number that must verify.
pub(crate) fn verify_transparency(
    bundle: &Value,
    root: &TrustedRoot,
    entries: u64,
    timestamps: u64,
) -> Transparency {
    let mut checks: Vec<Check> = Vec::new();
    let mut record = |check: String, passed: bool, message: String| {
        checks.push(Check {
            check,
            passed,
            message,
        });
    };
    let material = bundle
        .get("verificationMaterial")
        .cloned()
        .unwrap_or(Value::Null);
    let Some(facts) = signed_facts(bundle) else {
        record(
            "bundle.shape".to_owned(),
            false,
            "The bundle has neither a readable DSSE envelope nor a message signature.".to_owned(),
        );
        return finish(checks, None);
    };
    let mut certificate = None;
    let mut leaf = None;
    if let Some(raw) = material.pointer("/certificate/rawBytes") {
        match raw
            .as_str()
            .and_then(base64_any)
            .ok_or_else(|| "rawBytes is not base64".to_owned())
        {
            Ok(bytes) => match parse_certificate(&bytes) {
                Ok(parsed) => {
                    certificate = Some(bytes);
                    leaf = Some(parsed);
                }
                Err(error) => record(
                    "certificate.chain".to_owned(),
                    false,
                    format!("The signing certificate does not parse: {error}."),
                ),
            },
            Err(error) => record(
                "certificate.chain".to_owned(),
                false,
                format!("The signing certificate does not parse: {error}."),
            ),
        }
    }

    // Timestamps first: a Rekor v2 entry has no integrated time, so the signed time is the only clock.
    let mut times = Vec::new();
    let stamps = material
        .pointer("/timestampVerificationData/rfc3161Timestamps")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let first_signature = facts.signatures.first().cloned().unwrap_or_default();
    for (index, stamp) in stamps.iter().enumerate() {
        let encoded = stamp
            .get("signedTimestamp")
            .and_then(Value::as_str)
            .unwrap_or("");
        let outcome = check_timestamp(encoded, &first_signature, &root.timestamp_authorities);
        let outcome = match (outcome, &leaf) {
            (Ok(time), Some(leaf)) if time < leaf.not_before || time > leaf.not_after => {
                Err("the signed time is outside the signing certificate's validity".to_owned())
            }
            (outcome, _) => outcome,
        };
        match outcome {
            Ok(time) => {
                times.push(time);
                record(
                    format!("timestamp.{index}"),
                    true,
                    format!("Signed at {}.", clock::iso8601(time)),
                );
            }
            Err(problem) => record(
                format!("timestamp.{index}"),
                false,
                format!("Timestamp {index}: {problem}."),
            ),
        }
    }
    if (times.len() as u64) < timestamps {
        record(
            "timestamp.count".to_owned(),
            false,
            format!(
                "{} of the required {timestamps} timestamps verified.",
                times.len()
            ),
        );
    }
    let signed_at = times.iter().copied().min();

    if let Some(leaf) = &leaf {
        match signed_at {
            None => record(
                "certificate.chain".to_owned(),
                false,
                "The signing certificate cannot be placed in time without a verified timestamp."
                    .to_owned(),
            ),
            Some(at) => {
                let mut problem =
                    Some("no pinned certificate authority was valid at the signed time".to_owned());
                for authority in root
                    .certificate_authorities
                    .iter()
                    .filter(|authority| authority.valid_for.contains(at))
                {
                    problem = chain_problem(leaf, &authority.certs, at);
                    if problem.is_none() {
                        break;
                    }
                }
                match problem {
                    None => record(
                        "certificate.chain".to_owned(),
                        true,
                        "The signing certificate chains to a pinned authority.".to_owned(),
                    ),
                    Some(problem) => record(
                        "certificate.chain".to_owned(),
                        false,
                        format!("The signing certificate: {problem}."),
                    ),
                }
            }
        }
    }

    let log_entries = material
        .get("tlogEntries")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let mut verified = 0;
    for (index, entry) in log_entries.iter().enumerate() {
        let problems = entry_problems(entry, &facts, certificate.as_deref(), root, signed_at);
        for (check, message) in &problems {
            record(check.clone(), false, format!("Entry {index}: {message}."));
        }
        if problems.is_empty() {
            verified += 1;
            record(
                format!("tlog.{index}"),
                true,
                format!(
                    "Entry {} is included in the log.",
                    entry.get("logIndex").and_then(Value::as_str).unwrap_or("")
                ),
            );
        }
    }
    if verified < entries {
        record(
            "tlog.count".to_owned(),
            false,
            format!("{verified} of the required {entries} log entries verified."),
        );
    }
    finish(checks, signed_at)
}

fn finish(checks: Vec<Check>, signed_at: Option<i64>) -> Transparency {
    let reasons = checks
        .iter()
        .filter(|check| !check.passed)
        .map(|check| Reason {
            check: strip_index(&check.check),
            message: check.message.clone(),
        })
        .collect::<Vec<_>>();
    Transparency {
        passed: reasons.is_empty(),
        time: signed_at,
        checks,
        reasons,
    }
}

fn strip_index(check: &str) -> String {
    match check.rsplit_once('.') {
        Some((head, tail))
            if !tail.is_empty() && tail.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            head.to_owned()
        }
        _ => check.to_owned(),
    }
}
