//! Threat models a downstream system authors in LexLean.
//!
//! `Foundation.Sec` records stay the identity of every asset, threat and
//! control. A model adds the facts they lack with the `Production.ThreatModel`
//! declarations, each of which names a record by the qualified
//! `<module>::<declaration>` identifier the model document gives it.
//!
//! The check runs over every entrypoint of the project, is the executable form
//! of `Production.ThreatModel.validateNormalizedThreatModel`, and refuses a gap
//! with its own registered diagnostic. A build then emits the checked control
//! set as an OSCAL component definition. Like features and journeys, these
//! declarations are checked and not projected: no model-document schema or
//! emitter digest depends on them. A model with no such declaration is not
//! affected.

mod oscal;

use crate::error::PrismError;
use crate::holo::ModelDocument;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// The only module whose declarations are read.
const OWNER: &str = "Production.ThreatModel";

/// A threat has no mapped control and no accepted risk.
const UNANSWERED: &str = "PP2019";
/// A control names no evidence.
const NO_EVIDENCE: &str = "PP2020";
/// A threat has no STRIDE category.
const NO_CATEGORY: &str = "PP2021";
/// A declaration is malformed, names no record, or is out of bounds.
const INVALID: &str = "PP2022";

/// Longest accepted single-line value, in characters.
const LINE_LIMIT: usize = 256;
/// Longest accepted descriptive text, in characters.
const TEXT_LIMIT: usize = 4096;

fn refuse(code: &'static str, message: impl Into<String>) -> PrismError {
    PrismError::new(code, message)
}

/// The document identity of a threat model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ControlSet {
    pub(crate) id: String,
    pub(crate) title: String,
    pub(crate) text: String,
    pub(crate) version: String,
    pub(crate) last_modified: String,
}

/// A name and a text that describe one `Foundation.Sec` record.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Described {
    pub(crate) name: String,
    pub(crate) text: String,
}

/// One `Production.ThreatModel::ModeledThreat`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Threat {
    pub(crate) described: Described,
    /// The constructor name, for example `tampering`.
    pub(crate) category: String,
}

/// One `Production.ThreatModel::Evidence`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Evidence {
    /// The constructor name, for example `gate`.
    pub(crate) kind: String,
    pub(crate) reference: String,
}

/// One `Production.ThreatModel::ModeledControl`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Control {
    pub(crate) described: Described,
    pub(crate) evidence: Vec<Evidence>,
}

/// Every row a model declares, keyed by the record each row describes, with the
/// records of the model document they resolve against.
#[derive(Debug, Clone, Default)]
pub(crate) struct Declared {
    pub(crate) control_sets: Vec<ControlSet>,
    pub(crate) assets: BTreeMap<String, Described>,
    pub(crate) threats: BTreeMap<String, Threat>,
    pub(crate) controls: BTreeMap<String, Control>,
    pub(crate) mappings: BTreeMap<String, Vec<String>>,
    pub(crate) accepted: BTreeMap<String, String>,
    /// `Foundation.Sec::Asset` identifiers of the model document.
    pub(crate) asset_records: BTreeSet<String>,
    /// `Foundation.Sec::Threat` identifiers of the model document.
    pub(crate) threat_records: BTreeSet<String>,
    /// `Foundation.Sec::ApplicationSecurityControl` identifiers of the document.
    pub(crate) control_records: BTreeSet<String>,
}

impl Declared {
    fn is_empty(&self) -> bool {
        self.control_sets.is_empty()
            && self.assets.is_empty()
            && self.threats.is_empty()
            && self.controls.is_empty()
            && self.mappings.is_empty()
            && self.accepted.is_empty()
    }
}

/// The literal fields of one record.
struct Fields<'a> {
    id: &'a str,
    map: BTreeMap<&'a str, &'a Value>,
}

impl<'a> Fields<'a> {
    fn of(id: &'a str, body: &'a Value) -> Result<Self, PrismError> {
        if body.get("kind").and_then(Value::as_str) != Some("record") {
            return Err(refuse(
                INVALID,
                format!("{id}: row is not a record literal"),
            ));
        }
        let mut map = BTreeMap::new();
        for row in body
            .get("fields")
            .and_then(Value::as_array)
            .ok_or_else(|| refuse(INVALID, format!("{id}: row has no field list")))?
        {
            match (row.get("field").and_then(Value::as_str), row.get("value")) {
                (Some(name), Some(value)) if map.insert(name, value).is_none() => {}
                _ => return Err(refuse(INVALID, format!("{id}: row field is malformed"))),
            }
        }
        Ok(Self { id, map })
    }

    fn field(&self, name: &str) -> Result<&'a Value, PrismError> {
        self.map
            .get(name)
            .copied()
            .ok_or_else(|| refuse(INVALID, format!("{}: field {name} is absent", self.id)))
    }

    fn text(&self, name: &str) -> Result<String, PrismError> {
        literal_text(self.field(name)?).ok_or_else(|| {
            refuse(
                INVALID,
                format!("{}: field {name} is not a literal String", self.id),
            )
        })
    }

    /// The bare constructor name of a nullary constructor of `owner`.
    fn choice(&self, name: &str, owner: &str, allowed: &[&str]) -> Result<String, PrismError> {
        self.field(name)?
            .get("constructor")
            .and_then(|value| value.get("name"))
            .and_then(Value::as_str)
            .and_then(|value| value.rsplit_once('.'))
            .filter(|(prefix, choice)| {
                prefix.rsplit(':').next() == Some(owner) && allowed.contains(choice)
            })
            .map(|(_, choice)| choice.to_owned())
            .ok_or_else(|| {
                refuse(
                    INVALID,
                    format!("{}: field {name} is not a {owner}", self.id),
                )
            })
    }

    /// The elements of a list literal, in source order. A long literal may
    /// be written as the `append` of shorter ones (LexLean's own long
    /// literals are balanced appends), so its depth stays bounded however
    /// many elements it has; the term is walked with a stack, not recursion.
    fn list(&self, name: &str) -> Result<Vec<&'a Value>, PrismError> {
        let malformed = || {
            refuse(
                INVALID,
                format!("{}: field {name} is not a list literal", self.id),
            )
        };
        let mut out = Vec::new();
        let mut pending = vec![self.field(name)?];
        while let Some(term) = pending.pop() {
            match term.get("kind").and_then(Value::as_str) {
                Some("nil") => {}
                Some("cons") => {
                    out.push(term.get("head").ok_or_else(malformed)?);
                    pending.push(term.get("tail").ok_or_else(malformed)?);
                }
                Some("primitive")
                    if term.get("operation").and_then(Value::as_str) == Some("append")
                        && term.pointer("/result/kind").and_then(Value::as_str) == Some("list") =>
                {
                    let Some([left, right]) = term
                        .get("arguments")
                        .and_then(Value::as_array)
                        .map(Vec::as_slice)
                    else {
                        return Err(malformed());
                    };
                    pending.push(right);
                    pending.push(left);
                }
                _ => return Err(malformed()),
            }
        }
        Ok(out)
    }

    fn texts(&self, name: &str) -> Result<Vec<String>, PrismError> {
        self.list(name)?
            .into_iter()
            .map(|value| {
                literal_text(value).ok_or_else(|| {
                    refuse(
                        INVALID,
                        format!("{}: field {name} is not a List String", self.id),
                    )
                })
            })
            .collect()
    }

    fn evidence(&self) -> Result<Vec<Evidence>, PrismError> {
        self.list("evidence")?
            .into_iter()
            .map(|value| {
                let row = Fields::of(self.id, value)?;
                Ok(Evidence {
                    kind: row.choice("kind", "EvidenceKind", &["gate", "proof", "review"])?,
                    reference: row.text("reference")?,
                })
            })
            .collect()
    }
}

fn literal_text(value: &Value) -> Option<String> {
    (value.get("kind").and_then(Value::as_str) == Some("string"))
        .then(|| value.get("value").and_then(Value::as_str))
        .flatten()
        .map(str::to_owned)
}

/// Insert a row, refusing a second row for the same record.
fn unique<T>(
    table: &mut BTreeMap<String, T>,
    kind: &str,
    key: String,
    value: T,
) -> Result<(), PrismError> {
    if table.contains_key(&key) {
        return Err(refuse(
            INVALID,
            format!("{kind} {key} is declared more than once"),
        ));
    }
    table.insert(key, value);
    Ok(())
}

const CATEGORIES: [&str; 6] = [
    "spoofing",
    "tampering",
    "repudiation",
    "informationDisclosure",
    "denialOfService",
    "elevationOfPrivilege",
];

fn described(fields: &Fields<'_>) -> Result<Described, PrismError> {
    Ok(Described {
        name: fields.text("name")?,
        text: fields.text("text")?,
    })
}

/// Project the rows out of `(module, declaration, linked IR)` definitions. A
/// definition is a row exactly when its result type is one of the row types of
/// `Production.ThreatModel`, unqualified inside that module or qualified with it.
pub(crate) fn project<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
) -> Result<Declared, PrismError> {
    let mut declared = Declared::default();
    for (module, logical_id, linked) in definitions {
        let Some(member) = linked.get("result").and_then(|value| value.get("member")) else {
            continue;
        };
        let qualifier = member.get("module").and_then(Value::as_str);
        if qualifier.unwrap_or(module) != OWNER {
            continue;
        }
        let Some(type_name) = member.get("name").and_then(Value::as_str) else {
            continue;
        };
        if !matches!(
            type_name,
            "ControlSet"
                | "ModeledAsset"
                | "ModeledThreat"
                | "ModeledControl"
                | "ThreatMapping"
                | "AcceptedRisk"
        ) {
            continue;
        }
        let id = format!("{module}::{logical_id}");
        let body = linked
            .get("body")
            .ok_or_else(|| refuse(INVALID, format!("{id}: row has no body")))?;
        let fields = Fields::of(&id, body)?;
        match type_name {
            "ControlSet" => declared.control_sets.push(ControlSet {
                id: id.clone(),
                title: fields.text("title")?,
                text: fields.text("text")?,
                version: fields.text("version")?,
                last_modified: fields.text("lastModified")?,
            }),
            "ModeledAsset" => unique(
                &mut declared.assets,
                "asset",
                fields.text("asset")?,
                described(&fields)?,
            )?,
            "ModeledThreat" => unique(
                &mut declared.threats,
                "threat",
                fields.text("threat")?,
                Threat {
                    described: described(&fields)?,
                    category: fields.choice("category", "Stride", &CATEGORIES)?,
                },
            )?,
            "ModeledControl" => unique(
                &mut declared.controls,
                "control",
                fields.text("control")?,
                Control {
                    described: described(&fields)?,
                    evidence: fields.evidence()?,
                },
            )?,
            "ThreatMapping" => unique(
                &mut declared.mappings,
                "mapping of threat",
                fields.text("threat")?,
                fields.texts("controls")?,
            )?,
            _ => unique(
                &mut declared.accepted,
                "accepted risk of threat",
                fields.text("threat")?,
                fields.text("rationale")?,
            )?,
        }
    }
    Ok(declared)
}

/// The data of `Production.ThreatModel.NormalizedThreatModel`: threats and
/// controls numbered in identifier order, and every row reduced to a count.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Normalized {
    pub(crate) threat_count: u64,
    pub(crate) category_counts: Vec<u64>,
    pub(crate) mitigation_counts: Vec<u64>,
    pub(crate) acceptance_counts: Vec<u64>,
    pub(crate) evidence_counts: Vec<u64>,
}

/// `Production.ThreatModel.validateNormalizedThreatModel`, clause for clause.
pub(crate) fn validate_normalized(model: &Normalized) -> bool {
    let positive = |values: &[u64]| values.iter().all(|value| *value > 0);
    model.category_counts.len() as u64 == model.threat_count
        && model.mitigation_counts.len() as u64 == model.threat_count
        && model.acceptance_counts.len() as u64 == model.threat_count
        && positive(&model.category_counts)
        && model
            .mitigation_counts
            .iter()
            .zip(&model.acceptance_counts)
            .all(|(mitigation, acceptance)| *mitigation > 0 || *acceptance > 0)
        && positive(&model.evidence_counts)
}

/// Normalize the model against the records of the model document.
pub(crate) fn normalize(declared: &Declared) -> Normalized {
    let count = |present: bool| u64::from(present);
    Normalized {
        threat_count: declared.threat_records.len() as u64,
        category_counts: declared
            .threat_records
            .iter()
            .map(|id| count(declared.threats.contains_key(id)))
            .collect(),
        mitigation_counts: declared
            .threat_records
            .iter()
            .map(|id| {
                declared
                    .mappings
                    .get(id)
                    .map_or(0, |rows| rows.len() as u64)
            })
            .collect(),
        acceptance_counts: declared
            .threat_records
            .iter()
            .map(|id| count(declared.accepted.contains_key(id)))
            .collect(),
        evidence_counts: declared
            .control_records
            .iter()
            .map(|id| {
                declared
                    .controls
                    .get(id)
                    .map_or(0, |row| row.evidence.len() as u64)
            })
            .collect(),
    }
}

/// A value OSCAL holds in one line: nonblank, no control character, no edge
/// whitespace and bounded.
fn line(owner: &str, field: &str, value: &str) -> Result<(), PrismError> {
    if value.is_empty()
        || value.chars().count() > LINE_LIMIT
        || value.chars().any(char::is_control)
        || value.starts_with(char::is_whitespace)
        || value.ends_with(char::is_whitespace)
    {
        return Err(refuse(
            INVALID,
            format!("{owner} has a {field} that is blank or out of bounds"),
        ));
    }
    Ok(())
}

/// A nonblank bounded text, whose only control character may be a line feed.
fn text(owner: &str, field: &str, value: &str) -> Result<(), PrismError> {
    if value.trim().is_empty()
        || value.chars().count() > TEXT_LIMIT
        || value
            .chars()
            .any(|character| character.is_control() && character != '\n')
    {
        return Err(refuse(
            INVALID,
            format!("{owner} has a {field} that is blank or out of bounds"),
        ));
    }
    Ok(())
}

/// A real calendar instant in the one form the check admits,
/// `YYYY-MM-DDThh:mm:ssZ`, which OSCAL's date-time pattern also accepts.
fn is_timestamp(value: &str) -> bool {
    let bytes = value.as_bytes();
    if bytes.len() != 20
        || bytes[4] != b'-'
        || bytes[7] != b'-'
        || bytes[10] != b'T'
        || bytes[13] != b':'
        || bytes[16] != b':'
        || bytes[19] != b'Z'
    {
        return false;
    }
    let number = |range: std::ops::Range<usize>| -> Option<u32> {
        let part = value.get(range)?;
        part.bytes()
            .all(|byte| byte.is_ascii_digit())
            .then(|| part.parse().ok())
            .flatten()
    };
    let (Some(year), Some(month), Some(day), Some(hour), Some(minute), Some(second)) = (
        number(0..4),
        number(5..7),
        number(8..10),
        number(11..13),
        number(14..16),
        number(17..19),
    ) else {
        return false;
    };
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = match month {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 if leap => 29,
        2 => 28,
        _ => return false,
    };
    (1900..=2999).contains(&year)
        && (1..=days).contains(&day)
        && hour < 24
        && minute < 60
        && second < 60
}

fn resolves(kind: &str, id: &str, records: &BTreeSet<String>) -> Result<(), PrismError> {
    if records.contains(id) {
        Ok(())
    } else {
        Err(refuse(
            INVALID,
            format!("{kind} row names {id}, which the model document does not declare"),
        ))
    }
}

fn check_rows(declared: &Declared) -> Result<(), PrismError> {
    let [set] = declared.control_sets.as_slice() else {
        return Err(refuse(
            INVALID,
            format!(
                "a threat model declares exactly one control set, found {}",
                declared.control_sets.len()
            ),
        ));
    };
    line(&set.id, "title", &set.title)?;
    text(&set.id, "text", &set.text)?;
    line(&set.id, "version", &set.version)?;
    if !is_timestamp(&set.last_modified) {
        return Err(refuse(
            INVALID,
            format!(
                "{} has a lastModified that is not YYYY-MM-DDThh:mm:ssZ",
                set.id
            ),
        ));
    }
    for (id, row) in &declared.assets {
        resolves("asset", id, &declared.asset_records)?;
        line(id, "name", &row.name)?;
        text(id, "text", &row.text)?;
    }
    for (id, row) in &declared.threats {
        resolves("threat", id, &declared.threat_records)?;
        line(id, "name", &row.described.name)?;
        text(id, "text", &row.described.text)?;
    }
    for (id, row) in &declared.controls {
        resolves("control", id, &declared.control_records)?;
        line(id, "name", &row.described.name)?;
        text(id, "text", &row.described.text)?;
        for evidence in &row.evidence {
            line(id, "evidence reference", &evidence.reference)?;
        }
    }
    for (id, controls) in &declared.mappings {
        resolves("mapping", id, &declared.threat_records)?;
        let mut seen = BTreeSet::new();
        for control in controls {
            resolves("mapping", control, &declared.control_records)?;
            if !seen.insert(control) {
                return Err(refuse(
                    INVALID,
                    format!("mapping of threat {id} names control {control} twice"),
                ));
            }
        }
    }
    for (id, rationale) in &declared.accepted {
        resolves("accepted risk", id, &declared.threat_records)?;
        text(id, "rationale", rationale)?;
    }
    Ok(())
}

/// Check the model. Failures are reported in a fixed order: the rows, every
/// asset, then by threat identifier (category, then answer), then by control
/// identifier.
pub(crate) fn check(declared: &Declared) -> Result<(), PrismError> {
    check_rows(declared)?;
    for id in &declared.asset_records {
        if !declared.assets.contains_key(id) {
            return Err(refuse(
                INVALID,
                format!("asset {id} has no modeled asset row"),
            ));
        }
    }
    for id in &declared.threat_records {
        if !declared.threats.contains_key(id) {
            return Err(refuse(
                NO_CATEGORY,
                format!("threat {id} has no STRIDE category"),
            ));
        }
        if declared.mappings.get(id).is_none_or(Vec::is_empty)
            && !declared.accepted.contains_key(id)
        {
            return Err(refuse(
                UNANSWERED,
                format!("threat {id} has no mapped control and no accepted risk"),
            ));
        }
    }
    for id in &declared.control_records {
        if declared
            .controls
            .get(id)
            .is_none_or(|row| row.evidence.is_empty())
        {
            return Err(refuse(
                NO_EVIDENCE,
                format!("control {id} names no evidence that realizes it"),
            ));
        }
    }
    if !validate_normalized(&normalize(declared)) {
        return Err(refuse(
            INVALID,
            "the threat model disagrees with the normalized validator",
        ));
    }
    Ok(())
}

/// Bind the rows to the security records of the model document.
fn bind(declared: &mut Declared, document: &ModelDocument) {
    let security = &document.security;
    declared.asset_records = security.assets.iter().map(|row| row.id.clone()).collect();
    declared.threat_records = security.threats.iter().map(|row| row.id.clone()).collect();
    declared.control_records = security.controls.iter().map(|row| row.id.clone()).collect();
}

fn render_definitions<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
    document: &ModelDocument,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    let mut declared = project(definitions)?;
    if declared.is_empty() {
        return Ok(Vec::new());
    }
    bind(&mut declared, document);
    check(&declared)?;
    Ok(vec![(
        oscal::ARTIFACT.to_owned(),
        oscal::component_definition(&declared)?,
    )])
}

/// Check the threat model a snapshot declares and render its build artifact.
/// The snapshot is the one covering every entrypoint, because a threat model
/// usually sits outside the application roots.
///
/// # Errors
///
/// `PP2019` for a threat with no mapped control and no accepted risk, `PP2020`
/// for a control that names no evidence, `PP2021` for a threat with no STRIDE
/// category and `PP2022` for a malformed or unresolved row.
pub(crate) fn render_snapshot(
    snapshot: &SemanticSnapshot,
    document: &ModelDocument,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    render_definitions(
        snapshot.modules().iter().flat_map(|module| {
            module
                .declarations()
                .iter()
                .filter(|declaration| declaration.kind() == "definition")
                .map(move |declaration| {
                    (
                        module.name(),
                        declaration.logical_id(),
                        declaration.linked_ir(),
                    )
                })
        }),
        document,
    )
}

/// Run the real check over a diagnostic specimen, which lists the `threats` and
/// `controls` records, the threats `categorized`, the `mappings` and `accepted`
/// risks of a threat, and the `evidence` of a control.
///
/// # Errors
///
/// The diagnostic the specimen provokes.
pub(crate) fn probe(specimen: &Value) -> Result<(), PrismError> {
    let probe_row = || Described {
        name: "Probe".to_owned(),
        text: "Probe".to_owned(),
    };
    let names = |value: &Value| -> BTreeSet<String> {
        value
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect()
    };
    let mut declared = Declared {
        control_sets: vec![ControlSet {
            id: "Probe::set".to_owned(),
            title: "Probe".to_owned(),
            text: "Probe".to_owned(),
            version: "1.0.0".to_owned(),
            last_modified: specimen["last_modified"]
                .as_str()
                .unwrap_or_default()
                .to_owned(),
        }],
        threat_records: names(&specimen["threats"]),
        control_records: names(&specimen["controls"]),
        ..Declared::default()
    };
    for id in names(&specimen["categorized"]) {
        declared.threats.insert(
            id,
            Threat {
                described: probe_row(),
                category: "tampering".to_owned(),
            },
        );
    }
    for (id, controls) in specimen["mappings"].as_object().into_iter().flatten() {
        declared
            .mappings
            .insert(id.clone(), names(controls).into_iter().collect());
    }
    for (id, rationale) in specimen["accepted"].as_object().into_iter().flatten() {
        declared.accepted.insert(
            id.clone(),
            rationale.as_str().unwrap_or_default().to_owned(),
        );
    }
    for (id, evidence) in specimen["evidence"].as_object().into_iter().flatten() {
        declared.controls.insert(
            id.clone(),
            Control {
                described: probe_row(),
                evidence: names(evidence)
                    .into_iter()
                    .map(|reference| Evidence {
                        kind: "gate".to_owned(),
                        reference,
                    })
                    .collect(),
            },
        );
    }
    check(&declared)
}

#[cfg(test)]
mod tests;
