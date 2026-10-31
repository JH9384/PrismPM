//! The smallest DER reader that can check an RFC 3161 timestamp, an X.509
//! certificate and a certificate-transparency precertificate: definite
//! lengths only, no high tag numbers. Anything else is an error, so a
//! malformed or BER-encoded input fails closed. A port of
//! `sdk/npm/verify/src/asn1.mjs`, the JavaScript reference.

/// Object identifiers this module recognises.
pub(crate) mod oid {
    pub(crate) const ECDSA_SHA256: &str = "1.2.840.10045.4.3.2";
    pub(crate) const ECDSA_SHA384: &str = "1.2.840.10045.4.3.3";
    pub(crate) const ECDSA_SHA512: &str = "1.2.840.10045.4.3.4";
    pub(crate) const EC_PUBLIC_KEY: &str = "1.2.840.10045.2.1";
    pub(crate) const P256: &str = "1.2.840.10045.3.1.7";
    pub(crate) const P384: &str = "1.3.132.0.34";
    pub(crate) const ED25519: &str = "1.3.101.112";
    pub(crate) const RSA_ENCRYPTION: &str = "1.2.840.113549.1.1.1";
    pub(crate) const RSA_SHA256: &str = "1.2.840.113549.1.1.11";
    pub(crate) const RSA_SHA384: &str = "1.2.840.113549.1.1.12";
    pub(crate) const RSA_SHA512: &str = "1.2.840.113549.1.1.13";
    pub(crate) const SHA256: &str = "2.16.840.1.101.3.4.2.1";
    pub(crate) const SHA384: &str = "2.16.840.1.101.3.4.2.2";
    pub(crate) const SHA512: &str = "2.16.840.1.101.3.4.2.3";
    pub(crate) const SIGNED_DATA: &str = "1.2.840.113549.1.7.2";
    pub(crate) const TST_INFO: &str = "1.2.840.113549.1.9.16.1.4";
    pub(crate) const CONTENT_TYPE: &str = "1.2.840.113549.1.9.3";
    pub(crate) const MESSAGE_DIGEST: &str = "1.2.840.113549.1.9.4";
    pub(crate) const SUBJECT_KEY_IDENTIFIER: &str = "2.5.29.14";
    pub(crate) const SUBJECT_ALT_NAME: &str = "2.5.29.17";
    pub(crate) const EXTENDED_KEY_USAGE: &str = "2.5.29.37";
    pub(crate) const TIME_STAMPING: &str = "1.3.6.1.5.5.7.3.8";
    /// The embedded signed certificate timestamps of a certificate (RFC 6962 3.3).
    pub(crate) const SCT_LIST: &str = "1.3.6.1.4.1.11129.2.4.2";
    /// Fulcio: the OIDC issuer, raw (deprecated in favour of the DER form).
    pub(crate) const FULCIO_ISSUER_V1: &str = "1.3.6.1.4.1.57264.1.1";
    /// Fulcio: the OIDC issuer as a DER UTF8String.
    pub(crate) const FULCIO_ISSUER_V2: &str = "1.3.6.1.4.1.57264.1.8";
}

/// One TLV. `tlv` is the whole encoding (what a signature covers), `body` its content.
#[derive(Debug, Clone, Copy)]
pub(crate) struct Node<'a> {
    pub(crate) tag: u8,
    pub(crate) constructed: bool,
    pub(crate) tlv: &'a [u8],
    pub(crate) body: &'a [u8],
    pub(crate) end: usize,
}

pub(crate) type DerResult<T> = Result<T, String>;

/// Read the TLV that starts at `offset`.
pub(crate) fn parse(bytes: &[u8], offset: usize) -> DerResult<Node<'_>> {
    if offset + 2 > bytes.len() {
        return Err("truncated element".to_owned());
    }
    let tag = bytes[offset];
    if tag & 0x1f == 0x1f {
        return Err("high tag numbers are not supported".to_owned());
    }
    let mut length = usize::from(bytes[offset + 1]);
    let mut at = offset + 2;
    if length == 0x80 {
        return Err("indefinite length (BER) is not DER".to_owned());
    }
    if length & 0x80 != 0 {
        let count = length & 0x7f;
        if count > 4 {
            return Err("length does not fit".to_owned());
        }
        if at + count > bytes.len() {
            return Err("truncated length".to_owned());
        }
        length = 0;
        for _ in 0..count {
            length = length * 256 + usize::from(bytes[at]);
            at += 1;
        }
    }
    let end = at + length;
    if end > bytes.len() {
        return Err("element runs past its container".to_owned());
    }
    Ok(Node {
        tag,
        constructed: tag & 0x20 != 0,
        tlv: &bytes[offset..end],
        body: &bytes[at..end],
        end,
    })
}

/// The child elements of a constructed node.
pub(crate) fn children<'a>(node: &Node<'a>) -> DerResult<Vec<Node<'a>>> {
    if !node.constructed {
        return Err(format!("tag 0x{:02x} is not constructed", node.tag));
    }
    let mut out = Vec::new();
    let mut at = 0;
    while at < node.body.len() {
        let child = parse(node.body, at)?;
        at = child.end;
        out.push(child);
    }
    Ok(out)
}

/// Require a tag and return the node.
pub(crate) fn expect<'a>(node: Option<&Node<'a>>, tag: u8, what: &str) -> DerResult<Node<'a>> {
    match node {
        Some(node) if node.tag == tag => Ok(*node),
        _ => Err(format!("{what} is not tag 0x{tag:02x}")),
    }
}

pub(crate) fn oid(node: &Node<'_>) -> DerResult<String> {
    expect(Some(node), 0x06, "object identifier")?;
    let body = node.body;
    if body.is_empty() {
        return Err("empty object identifier".to_owned());
    }
    let mut parts = vec![u64::from(body[0] / 40), u64::from(body[0] % 40)];
    let mut value: u64 = 0;
    for byte in &body[1..] {
        value = value
            .checked_mul(128)
            .and_then(|value| value.checked_add(u64::from(byte & 0x7f)))
            .ok_or_else(|| "object identifier arc does not fit".to_owned())?;
        if byte & 0x80 == 0 {
            parts.push(value);
            value = 0;
        }
    }
    Ok(parts
        .iter()
        .map(u64::to_string)
        .collect::<Vec<_>>()
        .join("."))
}

/// The content octets of an INTEGER as lowercase hex, leading zeros kept, so two serials compare by string.
pub(crate) fn integer_hex(node: &Node<'_>) -> DerResult<String> {
    expect(Some(node), 0x02, "integer")?;
    Ok(hex(node.body))
}

/// The bits of a BIT STRING that has no unused bits.
pub(crate) fn bit_string<'a>(node: &Node<'a>) -> DerResult<&'a [u8]> {
    expect(Some(node), 0x03, "bit string")?;
    if node.body.first() != Some(&0) {
        return Err("bit string with unused bits".to_owned());
    }
    Ok(&node.body[1..])
}

fn digits(text: &[u8]) -> Option<i64> {
    if text.is_empty() || !text.iter().all(u8::is_ascii_digit) {
        return None;
    }
    std::str::from_utf8(text).ok()?.parse().ok()
}

/// UTCTime or GeneralizedTime as milliseconds since the epoch.
pub(crate) fn time(node: &Node<'_>) -> DerResult<i64> {
    let text = node.body;
    let (year, rest) = match node.tag {
        0x17 => {
            if text.len() != 13 || text[12] != b'Z' {
                return Err("malformed UTCTime".to_owned());
            }
            let short = digits(&text[0..2]).ok_or_else(|| "malformed UTCTime".to_owned())?;
            let year = if short >= 50 {
                1900 + short
            } else {
                2000 + short
            };
            (year, &text[2..12])
        }
        0x18 => {
            if text.len() < 15 || *text.last().unwrap_or(&0) != b'Z' {
                return Err("malformed GeneralizedTime".to_owned());
            }
            let year = digits(&text[0..4]).ok_or_else(|| "malformed GeneralizedTime".to_owned())?;
            (year, &text[4..text.len() - 1])
        }
        _ => return Err("not a time".to_owned()),
    };
    if rest.len() < 10 {
        return Err("malformed time".to_owned());
    }
    let field =
        |from: usize| digits(&rest[from..from + 2]).ok_or_else(|| "malformed time".to_owned());
    let (month, day, hour, minute, second) =
        (field(0)?, field(2)?, field(4)?, field(6)?, field(8)?);
    let mut millis = 0;
    if rest.len() > 10 {
        let fraction = &rest[10..];
        if fraction.first() != Some(&b'.') || fraction.len() < 2 || fraction.len() > 10 {
            return Err("malformed GeneralizedTime".to_owned());
        }
        let mut scaled = String::from_utf8_lossy(&fraction[1..]).to_string();
        scaled.truncate(3);
        while scaled.len() < 3 {
            scaled.push('0');
        }
        millis = digits(scaled.as_bytes()).ok_or_else(|| "malformed GeneralizedTime".to_owned())?;
    }
    super::clock::utc_millis(year, month, day, hour, minute, second, millis)
        .ok_or_else(|| "time out of range".to_owned())
}

/// An AlgorithmIdentifier: its object identifier and its parameters, when present.
pub(crate) fn algorithm<'a>(node: &Node<'a>) -> DerResult<(String, Option<Node<'a>>)> {
    let fields = children(&expect(Some(node), 0x30, "algorithm identifier")?)?;
    let id = fields
        .first()
        .ok_or_else(|| "empty algorithm identifier".to_owned())?;
    Ok((oid(id)?, fields.get(1).copied()))
}

/// Standard DER encoding of a tag and body, for rebuilding a precertificate.
pub(crate) fn encode(tag: u8, body: &[u8]) -> Vec<u8> {
    let mut out = vec![tag];
    let length = body.len();
    if length < 0x80 {
        out.push(length as u8);
    } else {
        let bytes = length.to_be_bytes();
        let significant = bytes
            .iter()
            .skip_while(|byte| **byte == 0)
            .copied()
            .collect::<Vec<_>>();
        out.push(0x80 | significant.len() as u8);
        out.extend_from_slice(&significant);
    }
    out.extend_from_slice(body);
    out
}

pub(crate) fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// A PEM block's DER bytes. The label is checked when given.
pub(crate) fn pem_to_der(text: &str, label: Option<&str>) -> Option<Vec<u8>> {
    let begin = text.find("-----BEGIN ")?;
    let rest = &text[begin + 11..];
    let label_end = rest.find("-----")?;
    let found = &rest[..label_end];
    if label.is_some_and(|label| label != found) {
        return None;
    }
    let after = &rest[label_end + 5..];
    let end = after.find("-----END ")?;
    let body: String = after[..end]
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    super::base64_standard(&body)
}
