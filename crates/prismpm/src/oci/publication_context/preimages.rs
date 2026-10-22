//! Closed generated responses. This decoder never constructs an identity.

use super::invalid;
use crate::error::PrismError;

const MAXIMUM: usize = 67_108_864;
const DOMAINS: [&[u8]; 7] = [
    b"prismpm/publication-declaration/1\0",
    b"prismpm/publication-services-closure/1\0",
    b"prismpm/publication-controls-closure/1\0",
    b"prismpm/publication-dependencies-closure/1\0",
    b"prismpm/publication-compiler-closure/1\0",
    b"prismpm/publication-runtime-closure/1\0",
    b"prismpm/publication-oracles-closure/1\0",
];

struct Response<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Response<'a> {
    fn take(&mut self, length: usize) -> Result<&'a [u8], PrismError> {
        let end = self
            .offset
            .checked_add(length)
            .filter(|end| *end <= self.bytes.len())
            .ok_or_else(|| invalid("generated publication response is truncated"))?;
        let bytes = &self.bytes[self.offset..end];
        self.offset = end;
        Ok(bytes)
    }

    fn payload(&mut self, domain: &[u8]) -> Result<&'a [u8], PrismError> {
        let first = self.take(1)?[0];
        if first >> 5 != 2 {
            return Err(invalid(
                "generated publication preimage is not a byte string",
            ));
        }
        let size = match first & 31 {
            short @ 0..=23 => usize::from(short),
            width @ 24..=26 => {
                let count = 1 << (width - 24);
                let value = self
                    .take(count)?
                    .iter()
                    .fold(0usize, |value, byte| (value << 8) | usize::from(*byte));
                let minimum = [24, 256, 65_536][usize::from(width - 24)];
                if value < minimum {
                    return Err(invalid(
                        "generated publication preimage has a nonminimal head",
                    ));
                }
                value
            }
            _ => {
                return Err(invalid(
                    "generated publication preimage has a forbidden head",
                ))
            }
        };
        let bytes = self.take(size)?;
        if !bytes.starts_with(domain) || bytes.len() == domain.len() {
            return Err(invalid(
                "generated publication preimage has the wrong domain or no body",
            ));
        }
        Ok(bytes)
    }

    fn complete(&self) -> Result<(), PrismError> {
        if self.offset == self.bytes.len() {
            Ok(())
        } else {
            Err(invalid("generated publication response has trailing bytes"))
        }
    }
}

pub(super) fn linkage(bytes: &[u8]) -> Result<[&[u8]; 7], PrismError> {
    if bytes.len() > MAXIMUM || !bytes.starts_with(&[0x89, 1, 0]) {
        return Err(invalid(
            "generated publication linkage refused the captured metadata",
        ));
    }
    let mut reader = Response { bytes, offset: 3 };
    let mut result = [&[][..]; 7];
    for (index, domain) in DOMAINS.iter().enumerate() {
        result[index] = reader.payload(domain)?;
    }
    reader.complete()?;
    Ok(result)
}

pub(super) fn context(bytes: &[u8]) -> Result<&[u8], PrismError> {
    if bytes.len() > MAXIMUM || !bytes.starts_with(&[0x83, 1, 3]) {
        return Err(invalid(
            "generated OC-09 wire refused the complete publication context",
        ));
    }
    let mut reader = Response { bytes, offset: 3 };
    let result = reader.payload(b"prismpm/publication-context/1\0")?;
    reader.complete()?;
    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;
    fn payload(domain: &[u8]) -> Vec<u8> {
        let mut bytes = vec![0x58, (domain.len() + 1) as u8];
        bytes.extend_from_slice(domain);
        bytes.push(0x80);
        bytes
    }
    #[test]
    fn generated_response_is_closed_ordered_complete_and_domain_separated() {
        let mut bytes = vec![0x89, 1, 0];
        for domain in DOMAINS {
            bytes.extend(payload(domain));
        }
        assert_eq!(linkage(&bytes).unwrap().len(), 7);
        for length in 0..bytes.len() {
            assert!(linkage(&bytes[..length]).is_err());
        }
        let mut trailing = bytes.clone();
        trailing.push(0);
        assert!(linkage(&trailing).is_err());
        for index in [0, 1, 2, 5, bytes.len() - 2] {
            let mut altered = bytes.clone();
            altered[index] ^= 1;
            assert!(linkage(&altered).is_err());
        }
        let mut substituted = vec![0x89, 1, 0];
        for domain in DOMAINS.into_iter().rev() {
            substituted.extend(payload(domain));
        }
        assert!(linkage(&substituted).is_err());
        let mut nonminimal = vec![0x89, 1, 0, 0x59, 0];
        nonminimal.extend_from_slice(&bytes[4..]);
        assert!(linkage(&nonminimal).is_err());
        let mut bad_head = bytes;
        bad_head[3] = 0x5b;
        assert!(linkage(&bad_head).is_err());
    }
    #[test]
    fn context_response_requires_its_own_domain_and_success_variant() {
        let mut bytes = vec![0x83, 1, 3];
        bytes.extend(payload(b"prismpm/publication-context/1\0"));
        assert!(context(&bytes).is_ok());
        for length in 0..bytes.len() {
            assert!(context(&bytes[..length]).is_err());
        }
        let mut wrong = bytes.clone();
        wrong[2] = 2;
        assert!(context(&wrong).is_err());
        let mut wrong = bytes.clone();
        wrong[5] ^= 1;
        assert!(context(&wrong).is_err());
        bytes.push(0);
        assert!(context(&bytes).is_err());
    }
}
