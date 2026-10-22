//! Private source/capture linkage. This module authorizes no deployment.

#[cfg(test)]
mod capture_tests;
mod corpora;
mod factory;
#[cfg(test)]
pub(super) mod fixture_source;
mod metadata;
mod preimages;
mod requirements;
mod sdk_source;
mod source;

use super::VerifiedReleaseCapture;
use crate::error::PrismError;
use crate::holo::canonical::{content_id, encode_value};
use lexlean::SemanticSnapshot;
use serde_json::Value;
use source::{Literal, Member, Projection};
use std::collections::{BTreeMap, BTreeSet};

fn invalid(message: impl Into<String>) -> PrismError {
    PrismError::new("PP6101", message)
}

#[derive(Debug)]
struct Record {
    id: String,
    digest: Vec<u8>,
}

struct Prepared {
    projection: Projection,
    snapshot: SemanticSnapshot,
    components: Vec<Record>,
    controls: Vec<Record>,
    dependencies: Vec<Record>,
    producer: String,
    source_revision: Vec<u8>,
}

fn hex_bytes(text: &str, length: usize) -> Result<Vec<u8>, PrismError> {
    if text.len() != length * 2
        || !text
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(invalid(
            "captured publication identity is not exact lowercase hexadecimal",
        ));
    }
    (0..length)
        .map(|index| {
            u8::from_str_radix(&text[index * 2..index * 2 + 2], 16)
                .map_err(|_| invalid("captured publication hexadecimal identity is malformed"))
        })
        .collect()
}

fn digest(bytes: &[u8]) -> Vec<u8> {
    // content_id is the same SHA-256 implementation used by OCI replay.
    hex_bytes(&content_id(bytes), 32).expect("SHA-256 implementation emits canonical hex")
}

fn rows(value: &Literal, chunk: usize, maximum: usize) -> Result<Vec<&Literal>, PrismError> {
    rows_field(value, chunk, maximum, "entries")
}

fn rows_field<'a>(
    value: &'a Literal,
    chunk: usize,
    maximum: usize,
    field: &str,
) -> Result<Vec<&'a Literal>, PrismError> {
    let Literal::List(chunks) = value.field("chunks")? else {
        return Err(invalid("source inventory chunks are absent"));
    };
    if chunks.len() > maximum.div_ceil(chunk) {
        return Err(invalid("source inventory has too many chunks"));
    }
    let mut result = Vec::new();
    for (index, group) in chunks.iter().enumerate() {
        let Literal::List(entries) = group.field(field)? else {
            return Err(invalid("source inventory entries are absent"));
        };
        if entries.is_empty()
            || entries.len() > chunk
            || (index + 1 < chunks.len() && entries.len() != chunk)
        {
            return Err(invalid("source inventory chunk partition is not canonical"));
        }
        result.extend(entries);
    }
    if result.len() > maximum {
        return Err(invalid("source inventory exceeds the aggregate bound"));
    }
    Ok(result)
}

fn identifier(value: &Literal) -> Result<String, PrismError> {
    let text = value.text()?;
    if text.is_empty() || text.len() > 128 {
        return Err(invalid("source inventory ID exceeds its UTF-8 byte bound"));
    }
    Ok(text.to_owned())
}

fn ordered(values: &[String]) -> Result<(), PrismError> {
    if values
        .windows(2)
        .any(|pair| pair[0].as_bytes() >= pair[1].as_bytes())
    {
        return Err(invalid(
            "publication inventory is not unique UTF-8 byte order",
        ));
    }
    Ok(())
}

fn ids(value: &Literal) -> Result<Vec<String>, PrismError> {
    let result = rows(value, 256, 65536)?
        .into_iter()
        .map(identifier)
        .collect::<Result<Vec<_>, _>>()?;
    ordered(&result)?;
    Ok(result)
}

fn records(rows: &[Value], string_ids: bool) -> Result<Vec<Record>, PrismError> {
    if rows.len() > 65536 {
        return Err(invalid("captured publication inventory exceeds the bound"));
    }
    let mut result = Vec::new();
    for row in rows {
        let id = if string_ids {
            row.as_str()
        } else {
            row["id"].as_str()
        }
        .filter(|id| !id.is_empty() && id.len() <= 128)
        .ok_or_else(|| invalid("captured publication inventory ID is absent or oversized"))?;
        result.push(Record {
            id: id.to_owned(),
            digest: digest(&encode_value(row)?),
        });
    }
    result.sort_by(|left, right| left.id.as_bytes().cmp(right.id.as_bytes()));
    ordered(&result.iter().map(|row| row.id.clone()).collect::<Vec<_>>())?;
    Ok(result)
}

fn selected_system(
    captured: &VerifiedReleaseCapture,
    projection: &Projection,
    snapshot: &SemanticSnapshot,
) -> Result<(Value, Value, String), PrismError> {
    let member = projection.value.field("system")?.member()?;
    let declaration = projection
        .definitions
        .get(&member)
        .ok_or_else(|| invalid("selected publication system source member is absent"))?;
    let module = declaration
        .pointer("/result/member/module")
        .and_then(Value::as_str)
        .filter(|module| matches!(*module, "Production.System" | "Production.BrowserSystem"))
        .ok_or_else(|| {
            invalid("selected publication system is not an exact supported source type")
        })?;
    if declaration["kind"] != "definition"
        || declaration
            .pointer("/result/member/name")
            .and_then(Value::as_str)
            != Some("SystemModel")
    {
        return Err(invalid("selected publication member is not a system model"));
    }
    let selector = member
        .name
        .strip_prefix("systemModel")
        .ok_or_else(|| invalid("selected system is not a modeled release root"))?;
    let document = crate::system::project(
        snapshot,
        if selector.is_empty() {
            None
        } else {
            Some(selector)
        },
    )?
    .ok_or_else(|| invalid("selected system projection is absent"))?;
    let actual = captured
        .build_files
        .get("system.prism.json")
        .ok_or_else(|| invalid("publication context missing: system"))?;
    if document.bytes() != actual {
        return Err(invalid(
            "selected source system differs from the captured release system",
        ));
    }
    let target_id = identifier(projection.value.field("target")?)?;
    let selected = document.value()["targets"]
        .as_array()
        .ok_or_else(|| invalid("selected system targets are absent"))?
        .iter()
        .filter(|target| target["id"] == target_id)
        .collect::<Vec<_>>();
    if selected.len() != 1 {
        return Err(invalid(
            "publication target is absent or ambiguous in the selected source system",
        ));
    }
    let adapter = selected[0]["adapter_digest"]
        .as_str()
        .and_then(|s| s.strip_prefix("sha256:"))
        .ok_or_else(|| invalid("selected publication target adapter identity is absent"))?;
    let declared = projection
        .value
        .field("declaration")?
        .field("target")?
        .field("adapter")?;
    if declared != &Literal::Bytes(hex_bytes(adapter, 32)?) {
        return Err(invalid(
            "source declaration and system target adapters differ",
        ));
    }
    Ok((
        document.value().clone(),
        selected[0].clone(),
        module.to_owned(),
    ))
}

fn services(projection: &Projection, components: &[Record]) -> Result<(), PrismError> {
    let mut result = Vec::new();
    let mut used = BTreeSet::new();
    for row in rows(projection.value.field("services")?, 256, 65536)? {
        let id = identifier(row.field("id")?)?;
        let component_ids = ids(row.field("components")?)?;
        if component_ids.is_empty() {
            return Err(invalid("a declared service has no components"));
        }
        for component in &component_ids {
            if used.len() == 65536 || !used.insert(component.clone()) {
                return Err(invalid(
                    "service component partition duplicates or exceeds the complete inventory",
                ));
            }
        }
        result.push(id);
    }
    ordered(&result)?;
    if result.is_empty() || used != components.iter().map(|row| row.id.clone()).collect() {
        return Err(invalid(
            "service partition does not cover exactly the captured system components",
        ));
    }
    Ok(())
}

fn dependencies(provenance: &Value) -> Result<(Vec<Record>, String, Vec<u8>), PrismError> {
    let values = provenance
        .pointer("/predicate/buildDefinition/resolvedDependencies")
        .and_then(Value::as_array)
        .filter(|rows| !rows.is_empty() && rows.len() <= 65536)
        .ok_or_else(|| invalid("publication dependency closure is absent or oversized"))?;
    let mut result = Vec::new();
    let mut source = None;
    for row in values {
        let uri = row["uri"]
            .as_str()
            .filter(|uri| !uri.is_empty() && uri.len() <= 2048)
            .ok_or_else(|| invalid("publication dependency URI is absent or oversized"))?;
        let fields = row
            .as_object()
            .ok_or_else(|| invalid("publication dependency is malformed"))?;
        if fields.len() != 2 || !fields.contains_key("uri") || !fields.contains_key("digest") {
            return Err(invalid("publication dependency has unknown fields"));
        }
        let hash = row["digest"]
            .as_object()
            .filter(|hash| hash.len() == 1)
            .ok_or_else(|| invalid("publication dependency identity is ambiguous"))?;
        if let Some(revision) = hash.get("gitCommit").and_then(Value::as_str) {
            let revision = hex_bytes(revision, 20)?;
            if source.replace((uri.to_owned(), revision)).is_some() {
                return Err(invalid("publication source revision is ambiguous"));
            }
        } else if let Some(hash) = hash.get("sha256").and_then(Value::as_str) {
            hex_bytes(hash, 32)?;
        } else {
            return Err(invalid("publication dependency hash kind is unsupported"));
        }
        result.push(Record {
            id: uri.to_owned(),
            digest: digest(&encode_value(row)?),
        });
    }
    result.sort_by(|left, right| left.id.as_bytes().cmp(right.id.as_bytes()));
    ordered(&result.iter().map(|row| row.id.clone()).collect::<Vec<_>>())?;
    let (producer, revision) =
        source.ok_or_else(|| invalid("publication context missing: producer, source"))?;
    Ok((result, producer, revision))
}

fn prepare(captured: &VerifiedReleaseCapture) -> Result<Prepared, PrismError> {
    prepare_bound(captured, &SourceBinding::InstalledSdk)
}

enum SourceBinding {
    InstalledSdk,
    #[cfg(test)]
    Fixture(sdk_source::FixtureSourceBinding),
}

fn prepare_bound(
    captured: &VerifiedReleaseCapture,
    binding: &SourceBinding,
) -> Result<Prepared, PrismError> {
    let snapshot: SemanticSnapshot = serde_json::from_slice(
        captured
            .build_files
            .get("lexlean/snapshot.json")
            .ok_or_else(|| invalid("publication context missing: source snapshot"))?,
    )
    .map_err(|e| invalid(e.to_string()))?;
    let projection = source::project(&snapshot)?;
    let (system, _target, system_module) = selected_system(captured, &projection, &snapshot)?;
    let source_modules = match binding {
        SourceBinding::InstalledSdk => {
            sdk_source::capture(&snapshot, captured.sdk_lock.value(), &system_module)?
                .into_keys()
                .collect()
        }
        #[cfg(test)]
        SourceBinding::Fixture(binding) => binding.modules(&snapshot, &system_module)?,
    };
    let components = records(
        system["components"]
            .as_array()
            .ok_or_else(|| invalid("publication context missing: components"))?,
        false,
    )?;
    let controls = records(
        system["controls"]
            .as_array()
            .ok_or_else(|| invalid("publication context missing: controls"))?,
        system["schema"] == "prismpm/system-model/2",
    )?;
    services(&projection, &components)?;
    if ids(projection.value.field("controls")?)?
        != controls
            .iter()
            .map(|row| row.id.clone())
            .collect::<Vec<_>>()
    {
        return Err(invalid(
            "source control references do not equal the complete selected system inventory",
        ));
    }
    let (dependencies, producer, source_revision) =
        dependencies(&captured.verification.provenance)?;
    let corpora = corpora::CapturedCorpora::from_installed(captured, &projection)?;
    requirements::validate(captured, &snapshot, &projection, &source_modules, &corpora)?;
    Ok(Prepared {
        projection,
        snapshot,
        components,
        controls,
        dependencies,
        producer,
        source_revision,
    })
}
