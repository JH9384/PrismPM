//! Features and user journeys of a product.
//!
//! A model states what its product does with the `Foundation.Arch`
//! declarations `Feature` and `Journey`. A feature carries a statement, the
//! interface calls that realize it and the acceptance rows that accept it. A
//! journey carries an actor, which is a declared stakeholder, and ordered steps,
//! each of which names a declared feature. Every cross-reference is the
//! qualified `<module>::<declaration>` identifier of the declaration it names,
//! the identifier the model document gives a stakeholder and the identifier
//! this module gives a feature.
//!
//! This module projects those declarations out of the semantic snapshot and
//! checks them against the stakeholders of the model document. The check is the
//! executable form of `Foundation.Holo.validateNormalizedFeatures`, whose
//! soundness and completeness theorems hold with an empty axiom set. A model
//! that declares no feature and no journey is not affected.

use crate::error::PrismError;
use crate::holo::ModelDocument;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// The only module whose feature and journey declarations are projected.
const OWNER: &str = "Foundation.Arch";

/// A feature is realized by no interface call.
const NO_CALL: &str = "PP2014";
/// A feature is accepted by no acceptance row.
const NO_ACCEPTANCE: &str = "PP2015";
/// A journey step names a feature the model does not declare.
const UNDECLARED_FEATURE: &str = "PP2016";
/// A journey's actor is not a declared stakeholder.
const NOT_A_STAKEHOLDER: &str = "PP2017";
/// A declaration is malformed, or a call or acceptance row names nothing.
const INVALID: &str = "PP2018";

/// Longest accepted statement, in characters.
const STATEMENT_LIMIT: usize = 4096;

/// One `Foundation.Arch::Feature`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Feature {
    pub(crate) statement: String,
    pub(crate) calls: Vec<String>,
    pub(crate) acceptance: Vec<String>,
}

/// One `Foundation.Arch::Journey`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Journey {
    pub(crate) actor: String,
    pub(crate) steps: Vec<String>,
}

/// Every feature and journey a model declares, with the names they resolve
/// against.
#[derive(Debug, Clone, Default)]
pub(crate) struct Declared {
    pub(crate) features: BTreeMap<String, Feature>,
    pub(crate) journeys: BTreeMap<String, Journey>,
    /// Identifiers of the stakeholders of the model document.
    pub(crate) stakeholders: BTreeSet<String>,
    /// Identifiers of every definition of the snapshot.
    pub(crate) definitions: BTreeSet<String>,
}

fn refuse(code: &'static str, message: impl Into<String>) -> PrismError {
    PrismError::new(code, message)
}

/// The literal fields of one record definition.
struct Fields<'a> {
    id: &'a str,
    map: BTreeMap<&'a str, &'a Value>,
}

impl<'a> Fields<'a> {
    fn of(id: &'a str, linked: &'a Value) -> Result<Self, PrismError> {
        let body = linked
            .get("body")
            .filter(|body| body.get("kind").and_then(Value::as_str) == Some("record"))
            .ok_or_else(|| {
                refuse(
                    INVALID,
                    format!("{id}: declaration is not a record literal"),
                )
            })?;
        let mut map = BTreeMap::new();
        for row in body
            .get("fields")
            .and_then(Value::as_array)
            .ok_or_else(|| refuse(INVALID, format!("{id}: declaration has no field list")))?
        {
            match (row.get("field").and_then(Value::as_str), row.get("value")) {
                (Some(name), Some(value)) if map.insert(name, value).is_none() => {}
                _ => {
                    return Err(refuse(
                        INVALID,
                        format!("{id}: declaration field is malformed"),
                    ))
                }
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
        let value = self.field(name)?;
        (value.get("kind").and_then(Value::as_str) == Some("string"))
            .then(|| value.get("value").and_then(Value::as_str))
            .flatten()
            .map(str::to_owned)
            .ok_or_else(|| {
                refuse(
                    INVALID,
                    format!("{}: field {name} is not a literal String", self.id),
                )
            })
    }

    /// A list literal of String literals, in source order.
    fn texts(&self, name: &str) -> Result<Vec<String>, PrismError> {
        let malformed = || {
            refuse(
                INVALID,
                format!("{}: field {name} is not a literal List String", self.id),
            )
        };
        let mut out = Vec::new();
        let mut term = self.field(name)?;
        loop {
            match term.get("kind").and_then(Value::as_str) {
                Some("nil") => return Ok(out),
                Some("cons") => {
                    let head = term.get("head").ok_or_else(malformed)?;
                    if head.get("kind").and_then(Value::as_str) != Some("string") {
                        return Err(malformed());
                    }
                    out.push(
                        head.get("value")
                            .and_then(Value::as_str)
                            .ok_or_else(malformed)?
                            .to_owned(),
                    );
                    term = term.get("tail").ok_or_else(malformed)?;
                }
                _ => return Err(malformed()),
            }
        }
    }
}

/// The `(type name, qualifier)` a definition declares as its result.
fn result_type(linked: &Value) -> Option<(&str, Option<&str>)> {
    let member = linked.get("result")?.get("member")?;
    Some((
        member.get("name")?.as_str()?,
        member.get("module").and_then(Value::as_str),
    ))
}

/// Project the features and journeys out of `(module, declaration, linked IR)`
/// definitions, and collect the identifiers of every definition. A definition
/// is a feature or a journey exactly when its result type is
/// `Foundation.Arch::Feature` or `Foundation.Arch::Journey`, either unqualified
/// inside that module or qualified with it.
pub(crate) fn project<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
) -> Result<Declared, PrismError> {
    let mut declared = Declared::default();
    for (module, logical_id, linked) in definitions {
        let id = format!("{module}::{logical_id}");
        declared.definitions.insert(id.clone());
        let Some((type_name, qualifier)) = result_type(linked) else {
            continue;
        };
        if qualifier.unwrap_or(module) != OWNER {
            continue;
        }
        match type_name {
            "Feature" => {
                let fields = Fields::of(&id, linked)?;
                declared.features.insert(
                    id.clone(),
                    Feature {
                        statement: fields.text("statement")?,
                        calls: fields.texts("calls")?,
                        acceptance: fields.texts("acceptance")?,
                    },
                );
            }
            "Journey" => {
                let fields = Fields::of(&id, linked)?;
                declared.journeys.insert(
                    id.clone(),
                    Journey {
                        actor: fields.text("actor")?,
                        steps: fields.texts("steps")?,
                    },
                );
            }
            _ => {}
        }
    }
    Ok(declared)
}

/// The data of `Foundation.Holo.NormalizedFeatures`: features and stakeholders
/// numbered in identifier order, and every reference reduced to an index.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct Normalized {
    pub(crate) stakeholder_count: u64,
    pub(crate) feature_count: u64,
    pub(crate) call_counts: Vec<u64>,
    pub(crate) acceptance_counts: Vec<u64>,
    pub(crate) journey_actors: Vec<u64>,
    pub(crate) journey_steps: Vec<u64>,
}

/// `Foundation.Holo.validateNormalizedFeatures`, clause for clause.
pub(crate) fn validate_normalized(model: &Normalized) -> bool {
    let all_positive = |values: &[u64]| values.iter().all(|value| *value > 0);
    let all_below = |bound: u64, values: &[u64]| values.iter().all(|value| *value < bound);
    model.call_counts.len() as u64 == model.feature_count
        && model.acceptance_counts.len() as u64 == model.feature_count
        && all_positive(&model.call_counts)
        && all_positive(&model.acceptance_counts)
        && all_below(model.stakeholder_count, &model.journey_actors)
        && all_below(model.feature_count, &model.journey_steps)
}

/// Normalize a model. An actor or step that resolves to nothing is numbered
/// past the end of its table, which the normalized validator refuses.
pub(crate) fn normalize(declared: &Declared) -> Normalized {
    let stakeholders: Vec<_> = declared.stakeholders.iter().collect();
    let features: Vec<_> = declared.features.keys().collect();
    let index = |table: &[&String], name: &String| {
        table
            .iter()
            .position(|row| *row == name)
            .map_or(table.len() as u64, |position| position as u64)
    };
    Normalized {
        stakeholder_count: stakeholders.len() as u64,
        feature_count: features.len() as u64,
        call_counts: declared
            .features
            .values()
            .map(|row| row.calls.len() as u64)
            .collect(),
        acceptance_counts: declared
            .features
            .values()
            .map(|row| row.acceptance.len() as u64)
            .collect(),
        journey_actors: declared
            .journeys
            .values()
            .map(|row| index(&stakeholders, &row.actor))
            .collect(),
        journey_steps: declared
            .journeys
            .values()
            .flat_map(|row| row.steps.iter().map(|step| index(&features, step)))
            .collect(),
    }
}

/// Check the features and journeys of `declared`. Failures are reported in a
/// fixed order: by feature identifier (statement bounds, no call, no acceptance
/// row, a call or acceptance row that names no declaration), then by journey identifier (actor,
/// then steps in order).
pub(crate) fn check(declared: &Declared) -> Result<(), PrismError> {
    for (id, feature) in &declared.features {
        if feature.statement.chars().count() > STATEMENT_LIMIT
            || feature
                .statement
                .chars()
                .any(|value| value.is_control() && value != '\n')
        {
            return Err(refuse(
                INVALID,
                format!("feature {id} has a statement out of bounds"),
            ));
        }
        if feature.calls.is_empty() {
            return Err(refuse(
                NO_CALL,
                format!("feature {id} is realized by no interface call"),
            ));
        }
        if feature.acceptance.is_empty() {
            return Err(refuse(
                NO_ACCEPTANCE,
                format!("feature {id} is accepted by no acceptance row"),
            ));
        }
        for (kind, names) in [
            ("call", &feature.calls),
            ("acceptance row", &feature.acceptance),
        ] {
            for name in names {
                if !declared.definitions.contains(name) {
                    return Err(refuse(
                        INVALID,
                        format!("feature {id} names {kind} {name}, which no declaration defines"),
                    ));
                }
            }
        }
    }
    for (id, journey) in &declared.journeys {
        if !declared.stakeholders.contains(&journey.actor) {
            return Err(refuse(
                NOT_A_STAKEHOLDER,
                format!(
                    "journey {id} has actor {}, which is not a declared stakeholder",
                    journey.actor
                ),
            ));
        }
        for (position, step) in journey.steps.iter().enumerate() {
            if !declared.features.contains_key(step) {
                return Err(refuse(
                    UNDECLARED_FEATURE,
                    format!(
                        "journey {id} step {position} names {step}, which is not a declared feature"
                    ),
                ));
            }
        }
    }
    if !validate_normalized(&normalize(declared)) {
        return Err(refuse(
            INVALID,
            "features and journeys disagree with the normalized validator",
        ));
    }
    Ok(())
}

/// Check the features and journeys a snapshot declares against the
/// stakeholders of the projected model document.
///
/// # Errors
///
/// `PP2014` for a feature without a call, `PP2015` for a feature without an
/// acceptance row, `PP2016` for a journey step that names an undeclared feature,
/// `PP2017` for a journey whose actor is not a declared stakeholder, and
/// `PP2018` for a malformed declaration or a call or acceptance row that names
/// no declaration.
pub(crate) fn check_snapshot(
    snapshot: &SemanticSnapshot,
    document: &ModelDocument,
) -> Result<(), PrismError> {
    check_definitions(
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

fn check_definitions<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
    document: &ModelDocument,
) -> Result<(), PrismError> {
    let mut declared = project(definitions)?;
    if declared.features.is_empty() && declared.journeys.is_empty() {
        return Ok(());
    }
    declared.stakeholders = document
        .architecture
        .stakeholders
        .iter()
        .map(|row| row.id.clone())
        .collect();
    check(&declared)
}

/// Run the real check over a diagnostic specimen. The specimen lists the
/// `stakeholders` and the other `definitions` that exist, the `features`
/// (`calls` and `acceptance`) and the `journeys` (`actor` and `steps`).
///
/// # Errors
///
/// The diagnostic the specimen provokes.
pub(crate) fn probe(specimen: &Value) -> Result<(), PrismError> {
    let names = |value: &Value| -> Vec<String> {
        value
            .as_array()
            .map(|rows| {
                rows.iter()
                    .filter_map(Value::as_str)
                    .map(str::to_owned)
                    .collect()
            })
            .unwrap_or_default()
    };
    let mut declared = Declared {
        stakeholders: names(&specimen["stakeholders"]).into_iter().collect(),
        definitions: names(&specimen["definitions"]).into_iter().collect(),
        ..Declared::default()
    };
    for (id, row) in specimen["features"].as_object().into_iter().flatten() {
        declared.definitions.insert(id.clone());
        declared.features.insert(
            id.clone(),
            Feature {
                statement: String::new(),
                calls: names(&row["calls"]),
                acceptance: names(&row["acceptance"]),
            },
        );
    }
    for (id, row) in specimen["journeys"].as_object().into_iter().flatten() {
        declared.definitions.insert(id.clone());
        declared.journeys.insert(
            id.clone(),
            Journey {
                actor: row["actor"].as_str().unwrap_or_default().to_owned(),
                steps: names(&row["steps"]),
            },
        );
    }
    check(&declared)
}

#[cfg(test)]
mod tests;
