//! Holo v5: a Prism application is a UORC archive (ADR-017).
//!
//! The file is one self-contained UORC archive (UOR-Foundation/compression,
//! `Uorc.Codec.Archive.rawArchive` generalised to ordered objects, exactly what
//! `uorc::archive::raw_objects` writes):
//!
//! ```text
//! "UORC" 02 01 00 00 uleb(count) uleb(length)* uleb(bodyLength) body seal[32]
//! ```
//!
//! where `body` is the objects laid end to end and `seal` is the
//! UORC-SHA256-CHAIN-v1 digest of every byte before it. Any UORC reader
//! (`uorc verify`, `uorc decompress --objects`, the uorc wasm client) opens a
//! holo without Prism code.
//!
//! Prism defines only the roles of the ordered objects and the manifest. Every
//! identity is a κ-label: `sha256:` and the 64 lowercase hex digits of the
//! SHA-256 of the bytes it names (uor-addr). The κ of a holo is the κ of its
//! file, which is also its OCI layer digest.

use crate::error::PrismError;
use sha2::{Digest, Sha256};

/// The UORC magic, format 2, profile 1.
const MAGIC: &[u8; 6] = b"UORC\x02\x01";
/// Scope 0: a self-contained archive.
const SELF_CONTAINED: u8 = 0;
/// Representation 0: the body is the objects, stored raw.
const RAW: u8 = 0;
const CHAIN_TAG: &[u8] = b"UORC-SHA256-CHAIN-v1\0";
/// Length of the UORC-SHA256-CHAIN-v1 seal that ends every archive.
pub const SEAL: usize = 32;
/// Byte length of a κ-label: `sha256:` and 64 hex digits.
pub const KAPPA_LEN: usize = 71;

/// Decode budget: a reader refuses, with a typed error and no output, an
/// archive that declares more objects or more bytes than this.
#[derive(Debug, Clone, Copy)]
pub struct Budget {
    /// Most objects one archive may declare.
    pub objects: usize,
    /// Most body bytes one archive may declare.
    pub bytes: u64,
}

/// The budget every Prism reader applies to an application holo.
pub const APPLICATION_BUDGET: Budget = Budget {
    objects: 16,
    bytes: 1 << 30,
};

/// The κ-label of `bytes`: `sha256:<64 lowercase hex>`.
pub fn kappa(bytes: &[u8]) -> String {
    format!("sha256:{}", hex(&Sha256::digest(bytes)))
}

/// Whether `label` is a well-formed κ-label.
pub fn is_kappa(label: &str) -> bool {
    label.len() == KAPPA_LEN
        && label.starts_with("sha256:")
        && label[7..]
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn hex(bytes: &[u8]) -> String {
    use std::fmt::Write;
    bytes
        .iter()
        .fold(String::with_capacity(64), |mut out, byte| {
            let _ = write!(out, "{byte:02x}");
            out
        })
}

/// Whether `bytes` begins like a UORC archive (any version a holo v5 reader
/// would consider).
pub fn is_uorc(bytes: &[u8]) -> bool {
    bytes.starts_with(b"UORC")
}

/// The UORC-SHA256-CHAIN-v1 digest of `preimage`: SHA-256 over the tag and a
/// zero, then one chained SHA-256 per whole 64-byte block, then a final
/// SHA-256 over the chain value and the remaining tail.
pub fn chain(preimage: &[u8]) -> [u8; 32] {
    let mut c: [u8; 32] = Sha256::new()
        .chain_update(CHAIN_TAG)
        .chain_update([0u8])
        .finalize()
        .into();
    let mut blocks = preimage.chunks_exact(64);
    for block in &mut blocks {
        c = Sha256::new()
            .chain_update(CHAIN_TAG)
            .chain_update([1u8])
            .chain_update(c)
            .chain_update(block)
            .finalize()
            .into();
    }
    let tail = blocks.remainder();
    Sha256::new()
        .chain_update(CHAIN_TAG)
        .chain_update([2u8])
        .chain_update(c)
        .chain_update([tail.len() as u8])
        .chain_update(tail)
        .finalize()
        .into()
}

fn push_uleb(out: &mut Vec<u8>, mut n: u64) {
    while n >= 0x80 {
        out.push((n as u8 & 0x7F) | 0x80);
        n >>= 7;
    }
    out.push(n as u8);
}

/// A shortest-form ULEB128 number at `at`: the value and the offset after it.
fn read_uleb(data: &[u8], mut at: usize) -> Option<(u64, usize)> {
    let start = at;
    let mut value = 0u64;
    for shift in (0..64).step_by(7) {
        let byte = *data.get(at)?;
        at += 1;
        let part = u64::from(byte & 0x7F);
        if shift == 63 && part > 1 {
            return None;
        }
        value |= part << shift;
        if byte < 0x80 {
            // Shortest form only: a trailing zero group is a second spelling.
            if byte == 0 && at - start > 1 {
                return None;
            }
            return Some((value, at));
        }
    }
    None
}

/// The self-contained raw UORC archive of `objects`, in order.
pub fn write_objects<T: AsRef<[u8]>>(objects: &[T]) -> Vec<u8> {
    let body: usize = objects.iter().map(|object| object.as_ref().len()).sum();
    let mut out = Vec::with_capacity(16 + 10 * objects.len() + body + SEAL);
    out.extend_from_slice(MAGIC);
    out.push(SELF_CONTAINED);
    out.push(RAW);
    push_uleb(&mut out, objects.len() as u64);
    for object in objects {
        push_uleb(&mut out, object.as_ref().len() as u64);
    }
    push_uleb(&mut out, body as u64);
    for object in objects {
        out.extend_from_slice(object.as_ref());
    }
    let seal = chain(&out);
    out.extend_from_slice(&seal);
    out
}

/// The ordered objects of a self-contained raw UORC archive, checked against
/// its seal and `budget`. Nothing is returned unless every check passes.
pub fn read_objects(bytes: &[u8], budget: Budget) -> Result<Vec<&[u8]>, PrismError> {
    // The seal is checked before the framing, so any changed byte is an
    // integrity failure (UORC UC-INT-01), not a structural one.
    if bytes.starts_with(MAGIC)
        && bytes.len() >= SEAL
        && chain(&bytes[..bytes.len() - SEAL]) != bytes[bytes.len() - SEAL..]
    {
        return Err(PrismError::new(
            "PP3004",
            "UORC-SHA256-CHAIN-v1 seal does not match the archive",
        ));
    }
    Ok(layout(bytes, budget)?.0)
}

/// The ordered objects of a self-contained raw UORC archive and whether its
/// seal matches, for readers (`inspect`) that report a broken seal rather than
/// refuse. The framing and `budget` are still enforced.
pub fn layout(bytes: &[u8], budget: Budget) -> Result<(Vec<&[u8]>, bool), PrismError> {
    let structure = |message: &str| PrismError::new("PP3003", message.to_owned());
    if !bytes.starts_with(MAGIC) {
        return Err(PrismError::new(
            "PP3001",
            "a holo v5 file is a UORC archive (format 2, profile 1)",
        ));
    }
    if bytes.len() < MAGIC.len() + 2 + SEAL {
        return Err(structure("UORC archive is truncated"));
    }
    let (preimage, seal) = bytes.split_at(bytes.len() - SEAL);
    let sealed = chain(preimage) == seal;
    if preimage[6] != SELF_CONTAINED || preimage[7] != RAW {
        return Err(structure(
            "a holo is a self-contained archive whose objects are stored raw",
        ));
    }
    let (count, mut at) =
        read_uleb(preimage, 8).ok_or_else(|| structure("object count is not a ULEB128"))?;
    if count == 0 || count > budget.objects as u64 {
        return Err(PrismError::new(
            "PP3003",
            format!(
                "archive declares {count} objects; a holo holds 1 to {}",
                budget.objects
            ),
        ));
    }
    let mut lengths = Vec::with_capacity(count as usize);
    let mut total = 0u64;
    for _ in 0..count {
        let (length, next) =
            read_uleb(preimage, at).ok_or_else(|| structure("object length is not a ULEB128"))?;
        total = total
            .checked_add(length)
            .filter(|total| *total <= budget.bytes)
            .ok_or_else(|| structure("archive exceeds the decode budget"))?;
        lengths.push(length as usize);
        at = next;
    }
    let (body_length, start) =
        read_uleb(preimage, at).ok_or_else(|| structure("body length is not a ULEB128"))?;
    if body_length != total || preimage.len() - start != total as usize {
        return Err(structure(
            "body length disagrees with the objects or the archive has trailing bytes",
        ));
    }
    let mut objects = Vec::with_capacity(lengths.len());
    let mut offset = start;
    for length in lengths {
        objects.push(&preimage[offset..offset + length]);
        offset += length;
    }
    Ok((objects, sealed))
}

#[cfg(test)]
#[path = "v5_tests.rs"]
mod tests;
