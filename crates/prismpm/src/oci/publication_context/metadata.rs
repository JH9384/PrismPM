//! Private input transport only. Identity preimages are emitted by LexLean.

use super::*;

const MAXIMUM: usize = 67_108_864;

fn record(name: &str, fields: Vec<(&str, Literal)>) -> Literal {
    Literal::Record(
        Member {
            module: sdk_source::LINKAGE.to_owned(),
            name: name.to_owned(),
        },
        fields
            .into_iter()
            .map(|(name, value)| (name.to_owned(), value))
            .collect(),
    )
}

fn member(value: &Member) -> Literal {
    record(
        "PublicationMember",
        vec![
            ("module", Literal::Text(value.module.clone())),
            ("name", Literal::Text(value.name.clone())),
        ],
    )
}

fn inventory(name: &str, rows: Vec<Literal>) -> Result<Literal, PrismError> {
    if rows.len() > 65_536 {
        return Err(invalid(
            "captured metadata inventory exceeds its exact limit",
        ));
    }
    let chunks = rows
        .chunks(256)
        .map(|chunk| {
            record(
                &format!("{name}Chunk"),
                vec![("entries", Literal::List(chunk.to_vec()))],
            )
        })
        .collect();
    Ok(record(name, vec![("chunks", Literal::List(chunks))]))
}

fn records(values: &[Record]) -> Result<Literal, PrismError> {
    inventory(
        "PublicationRecords",
        values
            .iter()
            .map(|row| {
                record(
                    "PublicationRecord",
                    vec![
                        ("id", Literal::Text(row.id.clone())),
                        ("digest", Literal::Bytes(row.digest.clone())),
                    ],
                )
            })
            .collect(),
    )
}

fn files<T: AsRef<[u8]>>(values: &BTreeMap<String, T>) -> Result<Literal, PrismError> {
    if values
        .keys()
        .any(|path| path.is_empty() || path.len() > 2048)
    {
        return Err(invalid(
            "captured metadata file path exceeds its UTF-8 byte limit",
        ));
    }
    inventory(
        "PublicationFiles",
        values
            .iter()
            .map(|(path, bytes)| {
                record(
                    "PublicationFile",
                    vec![
                        ("path", Literal::Text(path.clone())),
                        ("digest", Literal::Bytes(digest(bytes.as_ref()))),
                    ],
                )
            })
            .collect(),
    )
}

fn required<'a>(files: &'a BTreeMap<String, Vec<u8>>, path: &str) -> Result<&'a [u8], PrismError> {
    files
        .get(path)
        .map(Vec::as_slice)
        .ok_or_else(|| invalid(format!("publication context missing retained file: {path}")))
}

fn capture(captured: &VerifiedReleaseCapture, prepared: &Prepared) -> Result<Literal, PrismError> {
    let projection = &prepared.projection;
    let source_link = record(
        "PublicationSourceLink",
        vec![
            (
                "snapshot",
                Literal::Bytes(digest(required(
                    &captured.build_files,
                    "lexlean/snapshot.json",
                )?)),
            ),
            (
                "source",
                Literal::Bytes(hex_bytes(&prepared.snapshot.source_id().to_string(), 32)?),
            ),
            (
                "semantic",
                Literal::Bytes(hex_bytes(&prepared.snapshot.semantic_id().to_string(), 32)?),
            ),
            (
                "compiler",
                Literal::Bytes(hex_bytes(
                    &prepared.snapshot.compiler_semantics_id().to_string(),
                    32,
                )?),
            ),
            ("closureMember", member(&projection.member)),
            (
                "moduleSource",
                Literal::Bytes(hex_bytes(&projection.module_source, 32)?),
            ),
            ("systemMember", projection.value.field("system")?.clone()),
            (
                "system",
                Literal::Bytes(digest(required(
                    &captured.build_files,
                    "system.prism.json",
                )?)),
            ),
            ("target", projection.value.field("target")?.clone()),
        ],
    );
    let browser = super::super::browser_export::browser_files(&captured.build_files)?;
    Ok(record(
        "PublicationCapture",
        vec![
            ("sourceLink", source_link),
            ("components", records(&prepared.components)?),
            ("controls", records(&prepared.controls)?),
            (
                "provenance",
                Literal::Bytes(digest(&captured.verification.provenance_bytes)),
            ),
            ("dependencies", records(&prepared.dependencies)?),
            ("sdkLock", Literal::Bytes(digest(captured.sdk_lock.bytes()))),
            (
                "standardsLock",
                Literal::Bytes(digest(captured.standards_lock.bytes())),
            ),
            (
                "lexleanBuildManifest",
                Literal::Bytes(digest(required(
                    &captured.build_files,
                    "lexlean/build/manifest.json",
                )?)),
            ),
            (
                "lexleanAttestation",
                Literal::Bytes(digest(required(
                    &captured.verification.runtime,
                    "lexlean-attestation.json",
                )?)),
            ),
            (
                "buildManifest",
                Literal::Bytes(digest(&captured.build_manifest)),
            ),
            (
                "verificationManifest",
                Literal::Bytes(digest(required(
                    &captured.verification.runtime,
                    "manifest.json",
                )?)),
            ),
            ("verificationFiles", files(&captured.verification.runtime)?),
            ("browserFiles", files(&browser)?),
            (
                "releaseValidation",
                Literal::Bytes(digest(&captured.verification.validation_bytes)),
            ),
            ("oracleAttestations", files(&captured.verification.oracles)?),
        ],
    ))
}

struct Input(Vec<u8>);

impl Input {
    fn bytes(&mut self, bytes: &[u8]) -> Result<(), PrismError> {
        if self
            .0
            .len()
            .checked_add(bytes.len())
            .is_none_or(|length| length > MAXIMUM)
        {
            return Err(invalid(
                "complete publication metadata frame exceeds 64 MiB",
            ));
        }
        self.0.extend_from_slice(bytes);
        Ok(())
    }

    fn head(&mut self, major: u8, value: usize) -> Result<(), PrismError> {
        let initial = major << 5;
        if value < 24 {
            self.bytes(&[initial | value as u8])
        } else if value <= u8::MAX as usize {
            self.bytes(&[initial | 24, value as u8])
        } else if value <= u16::MAX as usize {
            self.bytes(&[initial | 25])?;
            self.bytes(&(value as u16).to_be_bytes())
        } else if value <= u32::MAX as usize {
            self.bytes(&[initial | 26])?;
            self.bytes(&(value as u32).to_be_bytes())
        } else {
            Err(invalid("publication metadata integer exceeds UInt32"))
        }
    }

    fn values<'a>(
        &mut self,
        values: impl IntoIterator<Item = &'a Literal>,
        length: usize,
        depth: usize,
    ) -> Result<(), PrismError> {
        self.head(4, length)?;
        for value in values {
            self.value(value, depth + 1)?;
        }
        Ok(())
    }

    fn value(&mut self, value: &Literal, depth: usize) -> Result<(), PrismError> {
        if depth > 64 {
            return Err(invalid(
                "publication metadata transport nesting exceeds its limit",
            ));
        }
        match value {
            Literal::Nat(value) => self.head(0, *value as usize),
            Literal::Text(value) => {
                self.head(3, value.len())?;
                self.bytes(value.as_bytes())
            }
            Literal::Bytes(value) => {
                self.head(2, value.len())?;
                self.bytes(value)
            }
            Literal::List(values) => self.values(values, values.len(), depth),
            Literal::Record(member, fields) => {
                let width = if member.module == sdk_source::ADMISSION
                    && member.name == "PublicationObligations"
                {
                    Some((64, 4096, "items"))
                } else if member.module == sdk_source::LINKAGE
                    && member.name == "PublicationRequirements"
                {
                    Some((64, 4096, "entries"))
                } else if member.module == sdk_source::LINKAGE
                    && matches!(
                        member.name.as_str(),
                        "PublicationIds"
                            | "PublicationServices"
                            | "PublicationRecords"
                            | "PublicationFiles"
                    )
                {
                    Some((256, 65536, "entries"))
                } else {
                    None
                };
                if let Some((chunk, maximum, field)) = width {
                    let rows = rows_field(value, chunk, maximum, field)?;
                    self.values(rows.iter().copied(), rows.len(), depth)
                } else {
                    self.values(fields.iter().map(|(_, value)| value), fields.len(), depth)
                }
            }
            Literal::Variant(member, tag, fields) => {
                if member.module == sdk_source::ADMISSION {
                    if !fields.is_empty() {
                        return Err(invalid("OC-09 enum metadata contains fields"));
                    }
                    self.head(4, 1)?;
                    return self.head(0, *tag);
                }
                if member.module != sdk_source::LINKAGE {
                    return Err(invalid("publication transport variant has a foreign owner"));
                }
                let flattened = if member.name == "PublicationRequirementValue" {
                    match fields.as_slice() {
                        [Literal::Record(_, fields)] => {
                            fields.iter().map(|(_, value)| value).collect::<Vec<_>>()
                        }
                        _ => {
                            return Err(invalid("publication requirement payload is not a record"))
                        }
                    }
                } else {
                    fields.iter().collect()
                };
                self.head(4, flattened.len() + 1)?;
                self.head(0, *tag)?;
                for value in flattened {
                    self.value(value, depth + 1)?;
                }
                Ok(())
            }
        }
    }
}

pub(super) fn request(
    captured: &VerifiedReleaseCapture,
    prepared: &Prepared,
) -> Result<Vec<u8>, PrismError> {
    let metadata = capture(captured, prepared)?;
    let mut input = Input(Vec::new());
    input.head(4, 4)?;
    input.head(0, 1)?;
    input.head(0, 0)?;
    input.value(&prepared.projection.value, 0)?;
    input.value(&metadata, 0)?;
    Ok(input.0)
}

/// OC-09 input transport, not an identity serializer. The generated wire
/// validates the complete context and emits its own canonical preimage.
pub(super) fn context_request(context: &Literal) -> Result<Vec<u8>, PrismError> {
    let mut input = Input(Vec::new());
    input.head(4, 3)?;
    input.head(0, 1)?;
    input.head(0, 4)?;
    input.value(context, 0)?;
    Ok(input.0)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn input_transport_uses_shortest_heads_and_utf8_byte_lengths() {
        let mut input = Input(Vec::new());
        for value in [0, 23, 24, 255, 256, 65535, 65536] {
            input.head(0, value).unwrap();
        }
        input.value(&Literal::Text("é".to_owned()), 0).unwrap();
        assert_eq!(
            input.0,
            [0, 23, 24, 24, 24, 255, 25, 1, 0, 25, 255, 255, 26, 0, 1, 0, 0, 0x62, 0xc3, 0xa9]
        );
    }

    #[test]
    fn complete_input_frame_limit_is_aggregate_and_exact() {
        let mut input = Input(Vec::with_capacity(MAXIMUM));
        let part = vec![0; MAXIMUM / 2];
        input.bytes(&part).unwrap();
        input.bytes(&part).unwrap();
        assert_eq!(input.0.len(), MAXIMUM);
        assert!(input.bytes(&[0]).is_err());
        assert_eq!(input.0.len(), MAXIMUM);
    }
}
