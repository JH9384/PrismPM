//! X.509 certificates reduced to what chain, identity and transparency checks
//! read: the chain to a pinned authority at a signed time, the Fulcio signer
//! identity and issuer, and the embedded signed certificate timestamps.

use super::crypto::{self, Hash, Kind, Scheme};
use super::der::{self, oid, DerResult, Node};
use super::trust::Log;
use std::collections::BTreeMap;

#[derive(Debug, Clone)]
pub(crate) struct Extension {
    pub(crate) value: Vec<u8>,
}

/// Names are kept as their DER encoding, so equality is a byte comparison.
#[derive(Debug, Clone)]
pub(crate) struct Certificate {
    pub(crate) der: Vec<u8>,
    pub(crate) tbs: Vec<u8>,
    pub(crate) serial: String,
    pub(crate) issuer: Vec<u8>,
    pub(crate) subject: Vec<u8>,
    pub(crate) not_before: i64,
    pub(crate) not_after: i64,
    pub(crate) spki: Vec<u8>,
    pub(crate) signature_algorithm: String,
    pub(crate) signature: Vec<u8>,
    pub(crate) extensions: BTreeMap<String, Extension>,
}

pub(crate) fn parse_certificate(bytes: &[u8]) -> DerResult<Certificate> {
    let outer = der::expect(Some(&der::parse(bytes, 0)?), 0x30, "certificate")?;
    if outer.end != bytes.len() {
        return Err("certificate has trailing bytes".to_owned());
    }
    let parts = der::children(&outer)?;
    if parts.len() != 3 {
        return Err("certificate is not tbs, algorithm and signature".to_owned());
    }
    let tbs = der::expect(Some(&parts[0]), 0x30, "tbsCertificate")?;
    let fields = der::children(&tbs)?;
    let mut at = 0;
    if fields.first().is_some_and(|field| field.tag == 0xa0) {
        at += 1;
    }
    let field = |index: usize| {
        fields
            .get(index)
            .copied()
            .ok_or_else(|| "tbsCertificate is too short".to_owned())
    };
    let serial = der::integer_hex(&field(at)?)?;
    let issuer = field(at + 2)?;
    let validity = der::children(&field(at + 3)?)?;
    if validity.len() != 2 {
        return Err("validity is not two times".to_owned());
    }
    let subject = field(at + 4)?;
    let spki = field(at + 5)?;
    let mut extensions = BTreeMap::new();
    for rest in fields.iter().skip(at + 6) {
        if rest.tag != 0xa3 {
            continue;
        }
        let list = der::children(rest)?;
        let sequence = list.first().ok_or_else(|| "empty extensions".to_owned())?;
        for extension in der::children(sequence)? {
            let members = der::children(&extension)?;
            let id = members
                .first()
                .ok_or_else(|| "empty extension".to_owned())?;
            let value = members
                .last()
                .ok_or_else(|| "extension without a value".to_owned())?;
            extensions.insert(
                der::oid(id)?,
                Extension {
                    value: value.body.to_vec(),
                },
            );
        }
    }
    let (signature_algorithm, _) = der::algorithm(&parts[1])?;
    Ok(Certificate {
        der: outer.tlv.to_vec(),
        tbs: tbs.tlv.to_vec(),
        serial,
        issuer: issuer.tlv.to_vec(),
        subject: subject.tlv.to_vec(),
        not_before: der::time(&validity[0])?,
        not_after: der::time(&validity[1])?,
        spki: spki.tlv.to_vec(),
        signature_algorithm,
        signature: der::bit_string(&parts[2])?.to_vec(),
        extensions,
    })
}

fn signature_holds(cert: &Certificate, issuer: &Certificate) -> bool {
    crypto::scheme(&cert.signature_algorithm).is_some_and(|scheme| {
        crypto::verify(&issuer.spki, scheme, None, &cert.tbs, &cert.signature)
    })
}

/// `None` when `cert` chains to a self-signed root in `pool` and every
/// certificate was valid at `at`; else the reason.
pub(crate) fn chain_problem(cert: &Certificate, pool: &[Certificate], at: i64) -> Option<String> {
    chain_problem_at(cert, pool, at, 0)
}

fn chain_problem_at(
    cert: &Certificate,
    pool: &[Certificate],
    at: i64,
    depth: usize,
) -> Option<String> {
    if at < cert.not_before || at > cert.not_after {
        return Some("a certificate in the chain was not valid at the signed time".to_owned());
    }
    if depth > 6 {
        return Some("the chain is longer than six certificates".to_owned());
    }
    if cert.issuer == cert.subject {
        if !pool.iter().any(|pinned| pinned.der == cert.der) {
            return Some("the chain ends in a root that is not pinned".to_owned());
        }
        return (!signature_holds(cert, cert))
            .then(|| "a root certificate is not validly self-signed".to_owned());
    }
    let mut reason = "no pinned certificate issued it".to_owned();
    for issuer in pool {
        if issuer.subject != cert.issuer {
            continue;
        }
        if !signature_holds(cert, issuer) {
            reason = "a certificate signature does not verify under the pinned issuer".to_owned();
            continue;
        }
        reason = chain_problem_at(issuer, pool, at, depth + 1)?;
    }
    Some(reason)
}

/// The signer identity Fulcio recorded: the first URI subject alternative
/// name, else the first e-mail one, as `sigstore-js` reads it.
pub(crate) fn subject_alternative_name(cert: &Certificate) -> Option<String> {
    let extension = cert.extensions.get(oid::SUBJECT_ALT_NAME)?;
    let names = der::children(&der::parse(&extension.value, 0).ok()?).ok()?;
    let text = |node: &Node<'_>| String::from_utf8(node.body.to_vec()).ok();
    names
        .iter()
        .find(|name| name.tag == 0x86)
        .and_then(text)
        .or_else(|| names.iter().find(|name| name.tag == 0x81).and_then(text))
}

/// The OIDC issuer Fulcio recorded: the DER UTF8String extension, else the raw one.
pub(crate) fn oidc_issuer(cert: &Certificate) -> Option<String> {
    if let Some(extension) = cert.extensions.get(oid::FULCIO_ISSUER_V2) {
        let node = der::parse(&extension.value, 0).ok()?;
        return String::from_utf8(node.body.to_vec()).ok();
    }
    let raw = cert.extensions.get(oid::FULCIO_ISSUER_V1)?;
    String::from_utf8(raw.value.clone()).ok()
}

/// One embedded signed certificate timestamp (RFC 6962 3.2), TLS-encoded inside the extension.
struct Sct {
    log_id: Vec<u8>,
    timestamp: u64,
    extensions: Vec<u8>,
    hash: u8,
    signature_algorithm: u8,
    signature: Vec<u8>,
}

fn take<'a>(bytes: &mut &'a [u8], count: usize) -> Result<&'a [u8], String> {
    if bytes.len() < count {
        return Err("the SCT list is truncated".to_owned());
    }
    let (head, rest) = bytes.split_at(count);
    *bytes = rest;
    Ok(head)
}

fn u16_of(bytes: &mut &[u8]) -> Result<usize, String> {
    let head = take(bytes, 2)?;
    Ok(usize::from(u16::from_be_bytes([head[0], head[1]])))
}

fn parse_scts(extension: &[u8]) -> Result<Vec<Sct>, String> {
    let octets = der::parse(extension, 0)?;
    der::expect(Some(&octets), 0x04, "SCT list")?;
    let mut list = octets.body;
    let total = u16_of(&mut list)?;
    let mut list = take(&mut list, total)?;
    let mut out = Vec::new();
    while !list.is_empty() {
        let length = u16_of(&mut list)?;
        let mut sct = take(&mut list, length)?;
        if take(&mut sct, 1)?[0] != 0 {
            return Err("an SCT is not version 1".to_owned());
        }
        let log_id = take(&mut sct, 32)?.to_vec();
        let stamp = take(&mut sct, 8)?;
        let timestamp = u64::from_be_bytes(stamp.try_into().expect("eight bytes"));
        let extensions_length = u16_of(&mut sct)?;
        let extensions = take(&mut sct, extensions_length)?.to_vec();
        let hash = take(&mut sct, 1)?[0];
        let signature_algorithm = take(&mut sct, 1)?[0];
        let signature_length = u16_of(&mut sct)?;
        let signature = take(&mut sct, signature_length)?.to_vec();
        if !sct.is_empty() {
            return Err("an SCT has trailing bytes".to_owned());
        }
        out.push(Sct {
            log_id,
            timestamp,
            extensions,
            hash,
            signature_algorithm,
            signature,
        });
    }
    Ok(out)
}

/// The TBSCertificate with the SCT list extension removed: what the log signed.
fn precertificate_tbs(cert: &Certificate) -> Result<Vec<u8>, String> {
    let tbs = der::parse(&cert.tbs, 0)?;
    let mut body = Vec::new();
    for field in der::children(&tbs)? {
        if field.tag != 0xa3 {
            body.extend_from_slice(field.tlv);
            continue;
        }
        let list = der::children(&field)?;
        let sequence = list.first().ok_or_else(|| "empty extensions".to_owned())?;
        let mut kept = Vec::new();
        for extension in der::children(sequence)? {
            let members = der::children(&extension)?;
            let id = members
                .first()
                .ok_or_else(|| "empty extension".to_owned())?;
            if der::oid(id)? != oid::SCT_LIST {
                kept.extend_from_slice(extension.tlv);
            }
        }
        body.extend_from_slice(&der::encode(0xa3, &der::encode(0x30, &kept)));
    }
    Ok(der::encode(0x30, &body))
}

/// Verify every embedded SCT against the pinned certificate-transparency
/// logs, returning how many verified. A certificate without the extension
/// has none. The issuer is the certificate that signed `cert`.
pub(crate) fn verify_scts(
    cert: &Certificate,
    issuer: &Certificate,
    ctlogs: &[Log],
) -> Result<usize, String> {
    let Some(extension) = cert.extensions.get(oid::SCT_LIST) else {
        return Ok(0);
    };
    let scts = parse_scts(&extension.value)?;
    let tbs = precertificate_tbs(cert)?;
    if tbs.len() >= 1 << 24 {
        return Err("the precertificate is too long".to_owned());
    }
    let issuer_key_hash = crypto::sha256(&issuer.spki);
    let mut verified = 0;
    for (index, sct) in scts.iter().enumerate() {
        if sct.hash != 4 || sct.signature_algorithm != 3 {
            return Err(format!("SCT {index} is not ECDSA over SHA-256"));
        }
        let mut signed = vec![0, 0];
        signed.extend_from_slice(&sct.timestamp.to_be_bytes());
        signed.extend_from_slice(&[0, 1]);
        signed.extend_from_slice(&issuer_key_hash);
        signed.extend_from_slice(&(tbs.len() as u32).to_be_bytes()[1..]);
        signed.extend_from_slice(&tbs);
        signed.extend_from_slice(&(sct.extensions.len() as u16).to_be_bytes());
        signed.extend_from_slice(&sct.extensions);
        let at =
            i64::try_from(sct.timestamp).map_err(|_| format!("SCT {index} time does not fit"))?;
        let scheme = Scheme {
            kind: Kind::Ecdsa,
            hash: Some(Hash::Sha256),
        };
        let holds = ctlogs
            .iter()
            .filter(|log| log.key_id == sct.log_id && log.valid_for.contains(at))
            .any(|log| crypto::verify(&log.spki, scheme, None, &signed, &sct.signature));
        if !holds {
            return Err(format!(
                "SCT {index} does not verify under a pinned certificate-transparency log valid at its time"
            ));
        }
        verified += 1;
    }
    Ok(verified)
}
