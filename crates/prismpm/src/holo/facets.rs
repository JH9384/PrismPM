//! Foundation.Arch, Foundation.Sec and Foundation.Qual record projection.
//!
//! One implementation serves both document shapes: the standalone facet
//! snapshot (`project_snapshot`) and the application document, which carries
//! the application's own records when its lexicon closure includes the three
//! facet packages.

use super::model_document::{
    ArchitectureModel, CatalogRecord, FacetPackage, IndexedRecord, NamedRecord, QualityModel,
    SecurityModel,
};
use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use serde::Deserialize;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

const TABLE_SOURCE: &str = include_str!("../../model/projection.toml");
const FACET_PACKAGES: [&str; 3] = ["prism.arch", "prism.qual", "prism.sec"];

/// Exact standards profile of every document that carries facet records.
pub(super) const PROFILE: [&str; 5] = [
    "ISO-25010-2023",
    "ISO-27005-2022",
    "ISO-27034-1-2011",
    "ISO-27034-5-2017",
    "ISO-42010-2022",
];

/// The three facet sections of a model document.
pub(super) struct FacetRecords {
    pub(super) architecture: ArchitectureModel,
    pub(super) security: SecurityModel,
    pub(super) quality: QualityModel,
}

/// One declaration of a snapshot, reduced to what the projection reads.
pub(super) struct Declared<'a> {
    module: &'a str,
    logical_id: &'a str,
    kind: &'a str,
    linked: &'a Value,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Table {
    spec: String,
    catalog: Vec<CatalogMap>,
    entity: Vec<EntityMap>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CatalogMap {
    module: String,
    declaration: String,
    facet: String,
    target: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct EntityMap {
    module: String,
    type_name: String,
    target: String,
}

struct Raw<'a> {
    id: String,
    fields: BTreeMap<&'a str, &'a Value>,
}

fn table() -> Result<Table, PrismError> {
    let value: Table = toml::from_str(TABLE_SOURCE)
        .map_err(|error| PrismError::new("PP9001", format!("projection table: {error}")))?;
    if value.spec != "prismpm/projection/1" {
        return Err(PrismError::new("PP9001", "wrong projection schema"));
    }
    let mut keys = BTreeSet::new();
    for row in &value.catalog {
        if !keys.insert(format!("c:{}::{}", row.module, row.declaration)) {
            return Err(PrismError::new("PP9001", "duplicate catalog projection"));
        }
    }
    for row in &value.entity {
        if !keys.insert(format!("e:{}::{}", row.module, row.type_name)) {
            return Err(PrismError::new("PP9001", "duplicate entity projection"));
        }
    }
    Ok(value)
}

fn result_type(value: &Value) -> Option<(&str, Option<&str>)> {
    let member = value.get("result")?.get("member")?;
    Some((
        member.get("name")?.as_str()?,
        member.get("module").and_then(Value::as_str),
    ))
}

fn fields(value: &Value) -> Option<BTreeMap<&str, &Value>> {
    let body = value.get("body")?;
    if body.get("kind")?.as_str()? != "record" {
        return None;
    }
    let mut out = BTreeMap::new();
    for row in body.get("fields")?.as_array()? {
        if out
            .insert(row.get("field")?.as_str()?, row.get("value")?)
            .is_some()
        {
            return None;
        }
    }
    Some(out)
}

fn nat(fields: &BTreeMap<&str, &Value>, name: &str) -> Result<u64, PrismError> {
    let value = fields
        .get(name)
        .ok_or_else(|| PrismError::new("PP2001", format!("missing field {name}")))?;
    if value.get("kind").and_then(Value::as_str) != Some("nat") {
        return Err(PrismError::new(
            "PP2001",
            format!("field {name} is not Nat"),
        ));
    }
    let text = value
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| PrismError::new("PP2001", format!("field {name} is malformed")))?;
    if text != "0" && (text.starts_with('0') || !text.bytes().all(|byte| byte.is_ascii_digit())) {
        return Err(PrismError::new("PP4004", "noncanonical natural number"));
    }
    text.parse()
        .map_err(|_| PrismError::new("PP4004", format!("field {name} exceeds u64")))
}

/// A String field that older Foundation.Arch sources do not declare: absent
/// reads as the empty string, present must be a String literal.
fn text_field(fields: &BTreeMap<&str, &Value>, name: &str) -> Result<String, PrismError> {
    let Some(value) = fields.get(name) else {
        return Ok(String::new());
    };
    if value.get("kind").and_then(Value::as_str) != Some("string") {
        return Err(PrismError::new(
            "PP2001",
            format!("field {name} is not String"),
        ));
    }
    value
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PrismError::new("PP2001", format!("field {name} is malformed")))
}

fn bool_field(fields: &BTreeMap<&str, &Value>, name: &str) -> Result<bool, PrismError> {
    let value = fields
        .get(name)
        .ok_or_else(|| PrismError::new("PP2001", format!("missing field {name}")))?;
    if value.get("kind").and_then(Value::as_str) != Some("bool") {
        return Err(PrismError::new(
            "PP2001",
            format!("field {name} is not Bool"),
        ));
    }
    value
        .get("value")
        .and_then(Value::as_bool)
        .ok_or_else(|| PrismError::new("PP2001", format!("field {name} is malformed")))
}

fn constructor<'a>(fields: &'a BTreeMap<&str, &Value>, name: &str) -> Result<&'a str, PrismError> {
    fields
        .get(name)
        .filter(|value| value.get("kind").and_then(Value::as_str) == Some("constructor"))
        .and_then(|value| value.get("constructor"))
        .and_then(|value| value.get("name"))
        .and_then(Value::as_str)
        .ok_or_else(|| PrismError::new("PP2001", format!("field {name} is not a constructor")))
}

fn catalog_id(table: &Table, module: &str, constructor: &str) -> Result<String, PrismError> {
    let owner = constructor
        .split_once('.')
        .map(|pair| pair.0)
        .ok_or_else(|| PrismError::new("PP2001", "unqualified catalog value"))?;
    let row = table
        .catalog
        .iter()
        .find(|row| row.module == module && row.declaration == owner)
        .ok_or_else(|| PrismError::new("PP2001", format!("unmapped catalog {constructor}")))?;
    Ok(format!("{}::{constructor}", row.facet))
}

fn index(rows: &mut [Raw<'_>]) -> Result<(), PrismError> {
    rows.sort_by(|a, b| a.id.as_bytes().cmp(b.id.as_bytes()));
    for pair in rows.windows(2) {
        if pair[0].id == pair[1].id {
            return Err(PrismError::new(
                "PP4004",
                format!("duplicate entity ID {}", pair[0].id),
            ));
        }
    }
    for (expected, row) in rows.iter().enumerate() {
        let expected = u64::try_from(expected)
            .map_err(|_| PrismError::new("PP4004", "entity count exceeds u64"))?;
        if nat(&row.fields, "index")? != expected {
            return Err(PrismError::new(
                "PP4004",
                format!("{} must have canonical index {expected}", row.id),
            ));
        }
    }
    Ok(())
}

fn named(rows: Vec<Raw<'_>>) -> Result<Vec<NamedRecord>, PrismError> {
    rows.into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(NamedRecord {
                name: text_field(&row.fields, "name")?,
                text: text_field(&row.fields, "text")?,
                id: row.id,
                index: index as u64,
            })
        })
        .collect()
}

fn indexed(rows: Vec<Raw<'_>>) -> Vec<IndexedRecord> {
    rows.into_iter()
        .enumerate()
        .map(|(index, row)| IndexedRecord {
            id: row.id,
            index: index as u64,
        })
        .collect()
}

/// Resolve the mapped entity row named by a definition's declared result type.
///
/// An unqualified result type matches only inside the mapped Foundation module
/// itself (the stdlib sample rows). A qualified result type matches when the
/// qualifier is exactly the mapped Foundation module, which is how an
/// application's own modules state `Foundation.Sec::Asset` and the like. The
/// returned flag is true when the declaring module is the Foundation module.
fn entity_mapping<'t>(
    table: &'t Table,
    module: &str,
    linked: &Value,
) -> Option<(&'t EntityMap, bool)> {
    let (type_name, qualifier) = result_type(linked)?;
    let owner = qualifier.unwrap_or(module);
    table
        .entity
        .iter()
        .find(|row| row.module == owner && row.type_name == type_name)
        .map(|row| (row, module == row.module))
}

type Buckets<'a> = BTreeMap<String, Vec<Raw<'a>>>;

/// Group mapped entity definitions by projection target, separating the stdlib
/// sample rows (declared inside the Foundation modules) from the rows declared
/// by application modules.
fn split_entities<'a>(
    table: &Table,
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
) -> Result<(Buckets<'a>, Buckets<'a>), PrismError> {
    let mut sample: Buckets<'a> = BTreeMap::new();
    let mut application: Buckets<'a> = BTreeMap::new();
    for (module, logical_id, linked) in definitions {
        let Some((mapping, in_foundation)) = entity_mapping(table, module, linked) else {
            continue;
        };
        let raw = Raw {
            id: format!("{module}::{logical_id}"),
            fields: fields(linked).ok_or_else(|| {
                PrismError::new("PP2001", "mapped entity is not a record definition")
            })?,
        };
        let bucket = if in_foundation {
            &mut sample
        } else {
            &mut application
        };
        bucket.entry(mapping.target.clone()).or_default().push(raw);
    }
    Ok((sample, application))
}

/// Group mapped entity definitions of a standalone facet snapshot.
///
/// When any application module supplies a mapped record, the sample rows are
/// withheld from every target: their cross-reference indexes belong to the
/// sample set and cannot be mixed with application-authored indexes. A build
/// that supplies no application records keeps the sample rows unchanged.
fn collect_entities<'a>(
    table: &Table,
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
) -> Result<Buckets<'a>, PrismError> {
    let (sample, application) = split_entities(table, definitions)?;
    Ok(if application.is_empty() {
        sample
    } else {
        application
    })
}

fn take_raw<'a>(map: &mut BTreeMap<String, Vec<Raw<'a>>>, name: &str) -> Vec<Raw<'a>> {
    map.remove(name).unwrap_or_default()
}

fn declared(snapshot: &SemanticSnapshot) -> Vec<Declared<'_>> {
    snapshot
        .modules()
        .iter()
        .flat_map(|module| {
            module
                .declarations()
                .iter()
                .map(move |declaration| Declared {
                    module: module.name(),
                    logical_id: declaration.logical_id(),
                    kind: declaration.kind(),
                    linked: declaration.linked_ir(),
                })
        })
        .collect()
}

fn closure_packages(
    closure: &Value,
    keep: impl Fn(&str) -> bool,
) -> Result<Option<Vec<FacetPackage>>, PrismError> {
    let Some(packages) = closure.get("packages").and_then(Value::as_array) else {
        return Ok(None);
    };
    let mut out = Vec::new();
    for package in packages {
        let id = package
            .get("id")
            .and_then(Value::as_str)
            .unwrap_or_default();
        if keep(id) {
            out.push(FacetPackage {
                package: id.to_owned(),
                version: package
                    .get("version")
                    .and_then(Value::as_str)
                    .ok_or_else(|| PrismError::new("PP4004", "missing facet version"))?
                    .to_owned(),
                content_id: package
                    .get("tree_sha256")
                    .and_then(Value::as_str)
                    .ok_or_else(|| PrismError::new("PP4004", "missing facet digest"))?
                    .to_owned(),
            });
        }
    }
    out.sort_by(|a, b| a.package.as_bytes().cmp(b.package.as_bytes()));
    Ok(Some(out))
}

fn is_exact(packages: &[FacetPackage]) -> bool {
    packages
        .iter()
        .map(|row| row.package.as_str())
        .eq(FACET_PACKAGES)
}

/// The exact facet closure of a standalone facet snapshot; any other `prism.*`
/// package set is refused.
pub(super) fn exact_closure(snapshot: &SemanticSnapshot) -> Result<Vec<FacetPackage>, PrismError> {
    let packages = closure_packages(snapshot.lexicon_closure(), |id| id.starts_with("prism."))?
        .ok_or_else(|| PrismError::new("PP4004", "malformed package closure"))?;
    if !is_exact(&packages) {
        return Err(PrismError::new("PP2001", "facet closure is not exact"));
    }
    Ok(packages)
}

/// The three facet packages of an application closure, or None when the
/// closure does not include all of them. Other packages are ignored.
fn application_closure(closure: &Value) -> Result<Option<Vec<FacetPackage>>, PrismError> {
    Ok(
        closure_packages(closure, |id| FACET_PACKAGES.contains(&id))?
            .filter(|packages| is_exact(packages)),
    )
}

struct Scan<'a> {
    catalogs: BTreeMap<String, Vec<CatalogRecord>>,
    definitions: Vec<(&'a str, &'a str, &'a Value)>,
}

fn scan<'a>(table: &Table, declared: &[Declared<'a>]) -> Result<Scan<'a>, PrismError> {
    let mut catalogs: BTreeMap<String, Vec<CatalogRecord>> = BTreeMap::new();
    let mut definitions = Vec::new();
    for item in declared {
        if item.kind == "inductive" {
            if let Some(mapping) = table
                .catalog
                .iter()
                .find(|row| row.module == item.module && row.declaration == item.logical_id)
            {
                let constructors = item
                    .linked
                    .get("constructors")
                    .and_then(Value::as_array)
                    .ok_or_else(|| PrismError::new("PP4004", "missing constructors"))?;
                for constructor in constructors {
                    let name = constructor
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| PrismError::new("PP4004", "missing constructor name"))?;
                    catalogs
                        .entry(mapping.target.clone())
                        .or_default()
                        .push(CatalogRecord {
                            id: format!("{}::{}.{}", mapping.facet, mapping.declaration, name),
                            index: 0,
                        });
                }
            }
        } else if item.kind == "definition" {
            definitions.push((item.module, item.logical_id, item.linked));
        }
    }
    Ok(Scan {
        catalogs,
        definitions,
    })
}

/// Project the standalone facet snapshot, falling back to the stdlib sample
/// rows when no application record maps.
pub(super) fn snapshot_records(snapshot: &SemanticSnapshot) -> Result<FacetRecords, PrismError> {
    let table = table()?;
    let scan = scan(&table, &declared(snapshot))?;
    let entities = collect_entities(&table, scan.definitions)?;
    assemble(&table, scan.catalogs, entities)
}

/// Project the application's own facet records. None when the lexicon closure
/// lacks any of the three facet packages or when no application module
/// declares a mapped record; stdlib sample rows are never included.
pub(super) fn application_records(
    snapshot: &SemanticSnapshot,
) -> Result<Option<(Vec<FacetPackage>, FacetRecords)>, PrismError> {
    let Some(packages) = application_closure(snapshot.lexicon_closure())? else {
        return Ok(None);
    };
    let table = table()?;
    Ok(application_from(&table, &declared(snapshot))?.map(|records| (packages, records)))
}

fn application_from(
    table: &Table,
    declared: &[Declared<'_>],
) -> Result<Option<FacetRecords>, PrismError> {
    let scan = scan(table, declared)?;
    let (_, application) = split_entities(table, scan.definitions)?;
    if application.is_empty() {
        return Ok(None);
    }
    assemble(table, scan.catalogs, application).map(Some)
}

mod records;
use records::assemble;

#[cfg(test)]
mod named_tests;
#[cfg(test)]
mod tests;
