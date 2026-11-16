//! Reference codec of host-effect values.
//!
//! The generated host package carries its own codec, rendered from the same
//! declaration. This one admits acceptance transcripts at projection time and
//! lets tests compare the two. All integers are big-endian; every length is a
//! 32-bit word.

use super::model::{HostEffect, HostField, HostKind};

/// A typed value of one declared field.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Value {
    /// `HostKind::U32`.
    U32(u32),
    /// `HostKind::U64`.
    U64(u64),
    /// `HostKind::Flag`.
    Flag(bool),
    /// `HostKind::Bytes`.
    Bytes(Vec<u8>),
    /// `HostKind::Text`.
    Text(String),
}

/// What a host did with a requested effect.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Outcome {
    /// The effect completed with these result values.
    Completed(Vec<Value>),
    /// The effect failed with the declared failure at this index.
    Failed(u32),
}

/// Why bytes are not a value of a declaration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Refusal {
    /// The bytes end inside a value.
    Truncated,
    /// Bytes remain after the last value.
    Trailing,
    /// A flag is neither zero nor one.
    Flag,
    /// Text is not UTF-8.
    Utf8,
    /// The outcome status is neither completed nor failed.
    Status,
    /// A failure index is not declared.
    Failure,
}

struct Reader<'a> {
    bytes: &'a [u8],
    at: usize,
}

impl<'a> Reader<'a> {
    fn take(&mut self, count: usize) -> Result<&'a [u8], Refusal> {
        let end = self.at.checked_add(count).ok_or(Refusal::Truncated)?;
        let slice = self.bytes.get(self.at..end).ok_or(Refusal::Truncated)?;
        self.at = end;
        Ok(slice)
    }

    fn u32(&mut self) -> Result<u32, Refusal> {
        let word = self.take(4)?;
        Ok(u32::from_be_bytes([word[0], word[1], word[2], word[3]]))
    }

    fn u64(&mut self) -> Result<u64, Refusal> {
        let word = self.take(8)?;
        let mut array = [0u8; 8];
        array.copy_from_slice(word);
        Ok(u64::from_be_bytes(array))
    }

    fn chunk(&mut self) -> Result<&'a [u8], Refusal> {
        let length = usize::try_from(self.u32()?).map_err(|_| Refusal::Truncated)?;
        self.take(length)
    }
}

fn read_fields(fields: &[HostField], reader: &mut Reader<'_>) -> Result<Vec<Value>, Refusal> {
    let mut values = Vec::with_capacity(fields.len());
    for field in fields {
        values.push(match field.kind {
            HostKind::U32 => Value::U32(reader.u32()?),
            HostKind::U64 => Value::U64(reader.u64()?),
            HostKind::Flag => match reader.take(1)?[0] {
                0 => Value::Flag(false),
                1 => Value::Flag(true),
                _ => return Err(Refusal::Flag),
            },
            HostKind::Bytes => Value::Bytes(reader.chunk()?.to_vec()),
            HostKind::Text => Value::Text(
                std::str::from_utf8(reader.chunk()?)
                    .map_err(|_| Refusal::Utf8)?
                    .to_owned(),
            ),
        });
    }
    Ok(values)
}

/// Decode a record of `fields` that fills `payload` exactly.
pub fn decode_fields(fields: &[HostField], payload: &[u8]) -> Result<Vec<Value>, Refusal> {
    let mut reader = Reader {
        bytes: payload,
        at: 0,
    };
    let values = read_fields(fields, &mut reader)?;
    if reader.at != payload.len() {
        return Err(Refusal::Trailing);
    }
    Ok(values)
}

/// Encode values of `fields`; the values must match the declared kinds.
pub fn encode_fields(fields: &[HostField], values: &[Value]) -> Option<Vec<u8>> {
    if fields.len() != values.len() {
        return None;
    }
    let mut out = Vec::new();
    for (field, value) in fields.iter().zip(values) {
        match (field.kind, value) {
            (HostKind::U32, Value::U32(number)) => out.extend_from_slice(&number.to_be_bytes()),
            (HostKind::U64, Value::U64(number)) => out.extend_from_slice(&number.to_be_bytes()),
            (HostKind::Flag, Value::Flag(flag)) => out.push(u8::from(*flag)),
            (HostKind::Bytes, Value::Bytes(bytes)) => {
                out.extend_from_slice(&u32::try_from(bytes.len()).ok()?.to_be_bytes());
                out.extend_from_slice(bytes);
            }
            (HostKind::Text, Value::Text(text)) => {
                out.extend_from_slice(&u32::try_from(text.len()).ok()?.to_be_bytes());
                out.extend_from_slice(text.as_bytes());
            }
            _ => return None,
        }
    }
    Some(out)
}

/// Decode an effect's outcome: a status word, then the result record or the
/// index of one declared failure, filling `outcome` exactly.
pub fn decode_outcome(effect: &HostEffect, outcome: &[u8]) -> Result<Outcome, Refusal> {
    let mut reader = Reader {
        bytes: outcome,
        at: 0,
    };
    match reader.u32()? {
        0 => {
            let values = read_fields(&effect.result, &mut reader)?;
            if reader.at != outcome.len() {
                return Err(Refusal::Trailing);
            }
            Ok(Outcome::Completed(values))
        }
        1 => {
            let index = reader.u32()?;
            if reader.at != outcome.len() {
                return Err(Refusal::Trailing);
            }
            if usize::try_from(index).map_or(true, |index| index >= effect.failures.len()) {
                return Err(Refusal::Failure);
            }
            Ok(Outcome::Failed(index))
        }
        _ => Err(Refusal::Status),
    }
}

/// Encode an outcome of `effect`.
pub fn encode_outcome(effect: &HostEffect, outcome: &Outcome) -> Option<Vec<u8>> {
    let mut out = Vec::new();
    match outcome {
        Outcome::Completed(values) => {
            out.extend_from_slice(&0u32.to_be_bytes());
            out.extend_from_slice(&encode_fields(&effect.result, values)?);
        }
        Outcome::Failed(index) => {
            if usize::try_from(*index).map_or(true, |index| index >= effect.failures.len()) {
                return None;
            }
            out.extend_from_slice(&1u32.to_be_bytes());
            out.extend_from_slice(&index.to_be_bytes());
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn field(name: &str, kind: HostKind) -> HostField {
        HostField {
            name: name.to_owned(),
            kind,
        }
    }

    fn effect() -> HostEffect {
        HostEffect {
            name: "store.get".to_owned(),
            request: vec![field("key", HostKind::Bytes), field("limit", HostKind::U32)],
            result: vec![
                field("found", HostKind::Flag),
                field("etag", HostKind::U64),
                field("note", HostKind::Text),
            ],
            failures: vec!["denied".to_owned(), "unavailable".to_owned()],
            request_maximum: 64,
            result_maximum: 64,
        }
    }

    #[test]
    fn values_round_trip_through_their_declared_kinds() {
        let effect = effect();
        let request = vec![Value::Bytes(vec![1, 2, 3]), Value::U32(7)];
        let bytes = encode_fields(&effect.request, &request).unwrap();
        assert_eq!(bytes, [0, 0, 0, 3, 1, 2, 3, 0, 0, 0, 7]);
        assert_eq!(decode_fields(&effect.request, &bytes).unwrap(), request);
        let done = Outcome::Completed(vec![
            Value::Flag(true),
            Value::U64(9),
            Value::Text("é".to_owned()),
        ]);
        let encoded = encode_outcome(&effect, &done).unwrap();
        assert_eq!(decode_outcome(&effect, &encoded).unwrap(), done);
        let failed = Outcome::Failed(1);
        let encoded = encode_outcome(&effect, &failed).unwrap();
        assert_eq!(encoded, [0, 0, 0, 1, 0, 0, 0, 1]);
        assert_eq!(decode_outcome(&effect, &encoded).unwrap(), failed);
    }

    #[test]
    fn malformed_values_are_refused_with_their_reason() {
        let effect = effect();
        assert_eq!(
            decode_fields(&effect.request, &[0, 0, 0, 3, 1]),
            Err(Refusal::Truncated)
        );
        assert_eq!(
            decode_fields(&effect.request, &[0, 0, 0, 0, 0, 0, 0, 7, 0]),
            Err(Refusal::Trailing)
        );
        assert_eq!(
            decode_outcome(
                &effect,
                &[0, 0, 0, 0, 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
            ),
            Err(Refusal::Flag)
        );
        assert_eq!(
            decode_outcome(
                &effect,
                &[0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0xff]
            ),
            Err(Refusal::Utf8)
        );
        assert_eq!(decode_outcome(&effect, &[0, 0, 0, 2]), Err(Refusal::Status));
        assert_eq!(
            decode_outcome(&effect, &[0, 0, 0, 1, 0, 0, 0, 2]),
            Err(Refusal::Failure)
        );
        assert_eq!(
            decode_outcome(&effect, &[0, 0, 0, 1, 0, 0, 0, 0, 0]),
            Err(Refusal::Trailing)
        );
        assert!(encode_fields(&effect.request, &[Value::U32(1), Value::U32(1)]).is_none());
        assert!(encode_outcome(&effect, &Outcome::Failed(2)).is_none());
    }
}
