//! OCI reference and digest syntax.
//!
//! Reading a reference is a verification decision that `verify` code such as
//! `authority` and `sdk` makes, so the syntax lives here and `oci` re-exports
//! it (docs/proposals/440-nine-modules.md, "reference syntax from oci").

use crate::error::PrismError;

pub(crate) fn digest_hex(digest: &str) -> Result<&str, PrismError> {
    let value = digest
        .strip_prefix("sha256:")
        .ok_or_else(|| PrismError::new("PP6101", "OCI digest algorithm is not sha256"))?;
    if value.len() != 64
        || !value
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(PrismError::new(
            "PP6101",
            "OCI descriptor digest is malformed",
        ));
    }
    Ok(value)
}

fn valid_registry_authority(authority: &str) -> bool {
    let (host, port) = if let Some((host, port)) = authority.rsplit_once(':') {
        (host, Some(port))
    } else {
        (authority, None)
    };
    let valid_label = |label: &str| {
        !label.is_empty()
            && label.len() <= 63
            && label
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            && label
                .bytes()
                .next()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
            && label
                .bytes()
                .last()
                .is_some_and(|byte| byte.is_ascii_alphanumeric())
    };
    (host == "localhost"
        || host.contains('.') && host.len() <= 253 && host.split('.').all(valid_label))
        && port.is_none_or(|port| {
            !port.is_empty()
                && port.bytes().all(|byte| byte.is_ascii_digit())
                && port.parse::<u16>().ok().is_some_and(|value| value != 0)
        })
}

fn valid_repository_component(value: &str) -> bool {
    let bytes = value.as_bytes();
    let mut cursor = 0;
    let consume_alphanumeric = |cursor: &mut usize| {
        let start = *cursor;
        while *cursor < bytes.len()
            && (bytes[*cursor].is_ascii_lowercase() || bytes[*cursor].is_ascii_digit())
        {
            *cursor += 1;
        }
        *cursor > start
    };
    if !consume_alphanumeric(&mut cursor) {
        return false;
    }
    while cursor < bytes.len() {
        match bytes[cursor] {
            b'.' => cursor += 1,
            b'_' if bytes.get(cursor + 1) == Some(&b'_') => cursor += 2,
            b'_' => cursor += 1,
            b'-' => {
                while bytes.get(cursor) == Some(&b'-') {
                    cursor += 1;
                }
            }
            _ => return false,
        }
        if !consume_alphanumeric(&mut cursor) {
            return false;
        }
    }
    true
}

/// Validate a tagged build reference or an immutable operation reference.
pub fn validate_reference(reference: &str, require_digest: bool) -> Result<&str, PrismError> {
    if reference.len() > 1024
        || reference.is_empty()
        || reference
            .bytes()
            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
    {
        return Err(PrismError::new("PP6101", "OCI reference is malformed"));
    }
    if reference.contains("\\")
        || reference.contains("://")
        || reference.contains('?')
        || reference.contains('#')
        || reference.matches('@').count() > 1
    {
        return Err(PrismError::new("PP6101", "OCI reference is malformed"));
    }
    let (name, digest) = if let Some((name, digest)) = reference.rsplit_once('@') {
        digest_hex(digest)?;
        (name, Some(digest))
    } else {
        (reference, None)
    };
    let segments = name.split('/').collect::<Vec<_>>();
    if segments.len() < 2
        || segments
            .iter()
            .any(|segment| segment.is_empty() || matches!(*segment, "." | ".."))
        || !valid_registry_authority(segments[0])
    {
        return Err(PrismError::new("PP6101", "OCI registry path is malformed"));
    }
    let last = segments.last().copied().unwrap_or_default();
    let (repository, tag) = if let Some((repository, tag)) = last.rsplit_once(':') {
        (repository, Some(tag))
    } else {
        (last, None)
    };
    if !valid_repository_component(repository)
        || segments[1..segments.len() - 1]
            .iter()
            .any(|segment| !valid_repository_component(segment))
    {
        return Err(PrismError::new(
            "PP6101",
            "OCI repository path is malformed",
        ));
    }
    if let Some(digest) = digest {
        if tag.is_some() {
            return Err(PrismError::new(
                "PP6101",
                "immutable OCI references cannot also contain a mutable tag",
            ));
        }
        return Ok(digest);
    }
    if require_digest {
        return Err(PrismError::new(
            "PP6101",
            "operation requires an immutable digest reference",
        ));
    }
    let tag = tag.ok_or_else(|| {
        PrismError::new("PP6101", "build reference requires a registry path and tag")
    })?;
    if tag.len() > 128
        || !tag
            .bytes()
            .next()
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        || !tag
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'.' | b'-'))
    {
        return Err(PrismError::new("PP6101", "OCI tag is malformed"));
    }
    Ok(reference)
}
