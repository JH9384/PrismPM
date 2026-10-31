//! A pinned Sigstore trusted root (`trusted_root.json`), read and normalised.
//! The caller pins it; nothing is fetched.

use super::base64_any;
use super::certificate::{parse_certificate, Certificate};
use super::clock::parse_rfc3339;
use serde_json::Value;

#[derive(Debug, Clone, Copy)]
pub(crate) struct ValidFor {
    pub(crate) start: i64,
    pub(crate) end: Option<i64>,
}

impl ValidFor {
    pub(crate) fn contains(&self, millis: i64) -> bool {
        self.start <= millis && self.end.is_none_or(|end| millis <= end)
    }
}

/// A transparency log or certificate-transparency log: its key, its id and when the key was valid.
#[derive(Debug, Clone)]
pub(crate) struct Log {
    pub(crate) key_id: Vec<u8>,
    pub(crate) spki: Vec<u8>,
    pub(crate) base_url: Option<String>,
    pub(crate) valid_for: ValidFor,
}

/// A certificate or timestamp authority: its chain and when it was valid.
#[derive(Debug, Clone)]
pub(crate) struct Authority {
    pub(crate) certs: Vec<Certificate>,
    pub(crate) valid_for: ValidFor,
}

#[derive(Debug, Clone)]
pub(crate) struct TrustedRoot {
    pub(crate) tlogs: Vec<Log>,
    pub(crate) ctlogs: Vec<Log>,
    pub(crate) certificate_authorities: Vec<Authority>,
    pub(crate) timestamp_authorities: Vec<Authority>,
}

fn valid_for(value: Option<&Value>, where_: &str) -> Result<ValidFor, String> {
    let start = value
        .and_then(|value| value.get("start"))
        .and_then(Value::as_str)
        .and_then(parse_rfc3339)
        .ok_or_else(|| format!("{where_} has no validFor.start"))?;
    let end = match value.and_then(|value| value.get("end")) {
        None => None,
        Some(end) => Some(
            end.as_str()
                .and_then(parse_rfc3339)
                .ok_or_else(|| format!("{where_} has a validFor.end that is not a time"))?,
        ),
    };
    Ok(ValidFor { start, end })
}

fn chain(value: &Value, where_: &str) -> Result<Vec<Certificate>, String> {
    let list = value
        .get("certChain")
        .and_then(|chain| chain.get("certificates"))
        .and_then(Value::as_array)
        .filter(|list| !list.is_empty())
        .ok_or_else(|| format!("{where_} has no certificates"))?;
    list.iter()
        .map(|cert| {
            cert.get("rawBytes")
                .and_then(Value::as_str)
                .and_then(base64_any)
                .ok_or_else(|| "rawBytes is not base64".to_owned())
                .and_then(|der| parse_certificate(&der))
        })
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| format!("{where_} has a certificate that does not parse: {error}"))
}

fn list<'a>(root: &'a Value, name: &str) -> Result<&'a [Value], String> {
    match root.get(name) {
        None => Ok(&[]),
        Some(Value::Array(items)) => Ok(items),
        Some(_) => Err(format!("{name} must be an array")),
    }
}

fn logs(root: &Value, name: &str) -> Result<Vec<Log>, String> {
    list(root, name)?
        .iter()
        .enumerate()
        .map(|(index, log)| {
            let where_ = format!("{name}[{index}]");
            let key_id = log
                .get("logId")
                .and_then(|id| id.get("keyId"))
                .and_then(Value::as_str)
                .and_then(base64_any)
                .ok_or_else(|| format!("{where_} is malformed: logId.keyId is not base64"))?;
            let public_key = log.get("publicKey");
            let spki = public_key
                .and_then(|key| key.get("rawBytes"))
                .and_then(Value::as_str)
                .and_then(base64_any)
                .ok_or_else(|| {
                    format!("{where_} is malformed: publicKey.rawBytes is not base64")
                })?;
            // The key is read when a signature is checked; a key this verifier cannot use (an RSA
            // certificate-transparency log, say) never verifies, as in the JavaScript reader.
            Ok(Log {
                key_id,
                spki,
                base_url: log
                    .get("baseUrl")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                valid_for: valid_for(public_key.and_then(|key| key.get("validFor")), &where_)?,
            })
        })
        .collect()
}

fn authorities(root: &Value, name: &str) -> Result<Vec<Authority>, String> {
    list(root, name)?
        .iter()
        .enumerate()
        .map(|(index, authority)| {
            let where_ = format!("{name}[{index}]");
            Ok(Authority {
                certs: chain(authority, &where_)?,
                valid_for: valid_for(authority.get("validFor"), &where_)?,
            })
        })
        .collect()
}

/// Check and normalise a pinned trusted root. The message names what is wrong.
pub(crate) fn read_trusted_root(root: &Value) -> Result<TrustedRoot, String> {
    if !root.is_object() {
        return Err("the trusted root must be an object".to_owned());
    }
    if !root
        .get("mediaType")
        .and_then(Value::as_str)
        .is_some_and(|media| media.starts_with("application/vnd.dev.sigstore.trustedroot+json"))
    {
        return Err("mediaType is not application/vnd.dev.sigstore.trustedroot+json".to_owned());
    }
    Ok(TrustedRoot {
        tlogs: logs(root, "tlogs")?,
        ctlogs: logs(root, "ctlogs")?,
        certificate_authorities: authorities(root, "certificateAuthorities")?,
        timestamp_authorities: authorities(root, "timestampAuthorities")?,
    })
}
