//! Independent bytes and original-helper parity for fused payload append.
use publication_context_linkage_core_probe::*;

type Encoded = Result<Result<Vec<u8>, CborError>, ComputeError>;
const LIMIT: usize = 67_108_864;

fn head(size: u64, major: u64, maximum: u64) -> Encoded {
    if size > maximum {
        return Ok(Err(CborError::ValueLimit));
    }
    let width = if size < 24 {
        1
    } else if size <= 255 {
        2
    } else if size <= 65535 {
        3
    } else {
        5
    };
    let total = size.checked_add(width).ok_or(ComputeError::AddOverflow)?;
    if total > LIMIT as u64 {
        return Ok(Err(CborError::ValueLimit));
    }
    let base = major.checked_mul(32).ok_or(ComputeError::MulOverflow)?;
    let first = base
        .checked_add(if width == 1 {
            size
        } else {
            match width {
                2 => 24,
                3 => 25,
                _ => 26,
            }
        })
        .ok_or(ComputeError::AddOverflow)?;
    let mut bytes = Vec::new();
    // The retained primitive has no major discriminator check. Its octet table
    // omits an out-of-range first byte; preserve this private-helper behavior.
    if first < 256 {
        bytes.push(first as u8);
    }
    if width == 2 {
        bytes.push(size as u8);
    }
    if width == 3 {
        bytes.extend_from_slice(&(size as u16).to_be_bytes());
    }
    if width == 5 {
        bytes.extend_from_slice(&(size as u32).to_be_bytes());
    }
    Ok(Ok(bytes))
}

fn expected(acc: Result<Vec<u8>, CborError>, payload: &[u8], major: u64, maximum: u64) -> Encoded {
    let header = head(payload.len() as u64, major, maximum)?;
    let mut output = match acc {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    let header = match header {
        Ok(value) => value,
        Err(error) => return Ok(Err(error)),
    };
    if output.len() + header.len() + payload.len() > LIMIT {
        return Ok(Err(CborError::ValueLimit));
    }
    output.extend(header);
    output.extend_from_slice(payload);
    Ok(Ok(output))
}

fn check(acc: Result<Vec<u8>, CborError>, payload: Vec<u8>, major: u64, maximum: u64) {
    let independent = expected(acc.clone(), &payload, major, maximum);
    let original = cborWritePayload(
        payload.clone(),
        major,
        maximum,
        publicationLinkageWireLimits(),
    )
    .and_then(|value| publicationLinkageWireJoin(acc.clone(), value));
    let fused = publicationLinkagePayloadInto(acc, payload, major, maximum);
    assert_eq!(
        original, independent,
        "original independent bytes/error order"
    );
    assert_eq!(fused, independent, "fused independent bytes/error order");
}

pub fn verify() {
    let mut count = 0;
    for _ in 0..2 {
        for size in [0_usize, 1, 23, 24, 25, 255, 256, 257, 65535, 65536, 65537] {
            for major in [0_u64, 2, 3, 7, 8, 255, u64::MAX] {
                for maximum in [
                    0,
                    size.saturating_sub(1) as u64,
                    size as u64,
                    size as u64 + 1,
                    LIMIT as u64,
                ] {
                    for acc in [
                        Ok(vec![]),
                        Ok(vec![1, 2, 3]),
                        Err(CborError::WrongType),
                        Err(CborError::TrailingInput),
                    ] {
                        check(acc, vec![0xa5; size], major, maximum);
                        count += 1;
                    }
                }
            }
        }
        for size in [LIMIT - 6, LIMIT - 5, LIMIT - 4, LIMIT, LIMIT + 1] {
            for prefix in [0, 1, 2] {
                check(Ok(vec![0x5a; prefix]), vec![0xa5; size], 2, LIMIT as u64);
                count += 1;
            }
            check(Err(CborError::Truncated), vec![0xa5; size], 2, LIMIT as u64);
            count += 1;
        }
        for prefix in [LIMIT - 1, LIMIT, LIMIT + 1] {
            check(Ok(vec![0x5a; prefix]), vec![], 2, 0);
            count += 1;
        }
        for size in [
            0,
            23,
            24,
            255,
            256,
            65535,
            65536,
            LIMIT as u64 - 5,
            LIMIT as u64 - 4,
            u32::MAX as u64,
            u64::MAX,
        ] {
            for major in [2, 8, u64::MAX] {
                assert_eq!(
                    publicationLinkagePayloadHead(size, major, u64::MAX),
                    head(size, major, u64::MAX)
                );
                count += 1;
            }
        }
    }
    assert_eq!(count, 3192);
    println!("PASS {count} independent and original-helper payload boundary/error-order witnesses");
}
