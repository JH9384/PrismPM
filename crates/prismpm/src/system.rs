//! Projection and validation of an authoritative production-system value.

use crate::contracts::CanonicalDocument;
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use lexlean::SemanticSnapshot;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(crate) mod browser;

const INGRESS_NGINX_KIND: &[u8] = include_bytes!("../adapters/ingress-nginx-kind-v1.15.1.yaml");

// Production.SystemValidation.modelEntityCount counts the product plus these
// collections; modelIdsGloballyUnique checks that same complete identity set.
const MODEL_ID_COLLECTIONS: [&str; 29] = [
    "acceptance",
    "alerts",
    "architecture",
    "artifacts",
    "backups",
    "calls",
    "capabilities",
    "components",
    "controls",
    "drifts",
    "events",
    "flows",
    "identity_requirements",
    "interfaces",
    "migrations",
    "parameters",
    "platform_requirements",
    "persistence",
    "retirements",
    "rollbacks",
    "rollouts",
    "scaling_policies",
    "schemas",
    "secret_references",
    "slis",
    "slos",
    "targets",
    "topology",
    "storage_classes",
];

fn product_id(value: &Value) -> Result<&str, PrismError> {
    value["product"]["id"]
        .as_str()
        .filter(|id| !id.is_empty())
        .ok_or_else(|| PrismError::new("PP2101", "system product identity is absent"))
}

/// One deterministic standard-native projection emitted from a system model.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Projection {
    /// Project-relative output path.
    pub path: String,
    /// Registered media type.
    pub media_type: String,
    /// Exact deterministic bytes.
    pub bytes: Vec<u8>,
}

fn system_root<'a>(
    snapshot: &'a SemanticSnapshot,
    release: Option<&str>,
) -> Result<Option<(&'a str, &'a Value)>, PrismError> {
    let mut found = BTreeMap::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let name = declaration.logical_id();
            if declaration.kind() != "definition"
                || !(name == "systemModel"
                    || name.strip_prefix("systemModel").is_some_and(|value| {
                        !value.is_empty()
                            && value.len() <= 32
                            && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
                    }))
            {
                continue;
            }
            let linked = declaration.linked_ir();
            if linked.pointer("/result/kind").and_then(Value::as_str) != Some("named")
                || linked
                    .pointer("/result/member/name")
                    .and_then(Value::as_str)
                    != Some("SystemModel")
                || !matches!(
                    linked
                        .pointer("/result/member/module")
                        .and_then(Value::as_str),
                    Some("Production.System" | "Production.BrowserSystem")
                )
                || linked.pointer("/body/kind").and_then(Value::as_str) != Some("record")
                || linked.pointer("/body/type/module") != linked.pointer("/result/member/module")
            {
                return Err(PrismError::new(
                    "PP2101",
                    "systemModel must be a typed supported SystemModel record",
                ));
            }
            if found.insert(name, &linked["body"]).is_some() {
                return Err(PrismError::new(
                    "PP2101",
                    "the source graph duplicates a named system model root",
                ));
            }
        }
    }
    if found.is_empty() {
        return Ok(None);
    }
    let selected = if let Some(release) = release {
        if release.is_empty()
            || release.len() > 32
            || !release.bytes().all(|byte| byte.is_ascii_alphanumeric())
        {
            return Err(PrismError::new(
                "PP2101",
                "system release selector is malformed",
            ));
        }
        let name = format!("systemModel{release}");
        let value = found.get(name.as_str()).copied().ok_or_else(|| {
            PrismError::new(
                "PP2101",
                format!("system release {release} is not defined by the source graph"),
            )
        })?;
        (name, value)
    } else if let Some(value) = found.get("systemModel") {
        ("systemModel".to_owned(), *value)
    } else if let Some(value) = found.get("systemModelB") {
        ("systemModelB".to_owned(), *value)
    } else if found.len() == 1 {
        let (name, value) = found.iter().next().expect("one system root");
        ((*name).to_owned(), *value)
    } else {
        return Err(PrismError::new(
            "PP2101",
            "multiple system releases require an explicit release selector",
        ));
    };
    let selected_name = found
        .keys()
        .copied()
        .find(|name| *name == selected.0)
        .expect("selected system root is present");
    Ok(Some((selected_name, selected.1)))
}

fn model_field_name(record: Option<&str>, name: &str) -> String {
    match name {
        "authentication" => return "auth".to_owned(),
        "defaultValue" => return "default".to_owned(),
        "fromComponent" if record == Some("Flow") => return "from".to_owned(),
        "interfaceId" if record == Some("Flow") => return "interface".to_owned(),
        "publiclyAccessible" => return "public".to_owned(),
        "toComponent" if record == Some("Flow") => return "to".to_owned(),
        "valueType" => return "type".to_owned(),
        _ => {}
    }
    let mut out = String::with_capacity(name.len() + 4);
    for character in name.chars() {
        if character.is_ascii_uppercase() {
            out.push('_');
            out.push(character.to_ascii_lowercase());
        } else {
            out.push(character);
        }
    }
    out
}

fn evaluate_model_term(term: &Value) -> Result<Value, PrismError> {
    match term["kind"].as_str() {
        Some("string") => term["value"]
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| PrismError::new("PP2101", "model string literal is malformed")),
        Some("bool") => term["value"]
            .as_bool()
            .map(Value::Bool)
            .ok_or_else(|| PrismError::new("PP2101", "model Boolean literal is malformed")),
        Some("integer" | "nat") => {
            let value = term["value"]
                .as_str()
                .and_then(|value| value.parse::<u64>().ok())
                .ok_or_else(|| PrismError::new("PP2101", "model integer is malformed"))?;
            Ok(Value::Number(value.into()))
        }
        Some("nil") => Ok(Value::Array(Vec::new())),
        Some("cons") => {
            let mut values = vec![evaluate_model_term(&term["head"])?];
            let tail = evaluate_model_term(&term["tail"])?;
            values.extend(
                tail.as_array()
                    .ok_or_else(|| {
                        PrismError::new("PP2101", "model list tail is not a generated List")
                    })?
                    .iter()
                    .cloned(),
            );
            Ok(Value::Array(values))
        }
        Some("record") => {
            let record = term.pointer("/type/name").and_then(Value::as_str);
            let fields = term["fields"]
                .as_array()
                .ok_or_else(|| PrismError::new("PP2101", "model record fields are malformed"))?;
            let mut object = Map::new();
            for field in fields {
                let name = field["field"].as_str().ok_or_else(|| {
                    PrismError::new("PP2101", "model record field name is absent")
                })?;
                if object
                    .insert(
                        model_field_name(record, name),
                        evaluate_model_term(&field["value"])?,
                    )
                    .is_some()
                {
                    return Err(PrismError::new(
                        "PP2101",
                        "model record field is duplicated",
                    ));
                }
            }
            Ok(Value::Object(object))
        }
        Some("constructor") => {
            let constructor = term
                .pointer("/constructor/name")
                .and_then(Value::as_str)
                .unwrap_or_default();
            if constructor.ends_with("Option.none") {
                Ok(Value::Null)
            } else if constructor.ends_with("Option.some") {
                let arguments = term["arguments"].as_array().ok_or_else(|| {
                    PrismError::new("PP2101", "generated Option.some arguments are malformed")
                })?;
                if arguments.len() != 1 {
                    return Err(PrismError::new(
                        "PP2101",
                        "generated Option.some must have exactly one value",
                    ));
                }
                evaluate_model_term(&arguments[0])
            } else {
                Err(PrismError::new(
                    "PP2101",
                    "system model contains a non-data constructor",
                ))
            }
        }
        _ => Err(PrismError::new(
            "PP2101",
            "system model is not a closed generated data value",
        )),
    }
}

fn system_manifest(
    snapshot: &SemanticSnapshot,
    release: Option<&str>,
    expected_model: Option<(&str, &str)>,
) -> Result<Option<Value>, PrismError> {
    let mut found = BTreeMap::new();
    let mut release_ready = BTreeMap::new();
    let mut owners = BTreeMap::new();
    let mut validators = BTreeMap::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            if declaration.kind() == "theorem"
                && declaration.logical_id().ends_with("SystemReleaseReady")
            {
                let linked = declaration.linked_ir();
                let model_name = linked
                    .pointer("/statement/left/arguments/0/function/name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        PrismError::new(
                            "PP2101",
                            "system release-ready theorem omits its system model root",
                        )
                    })?;
                let manifest_name = linked
                    .pointer("/statement/left/arguments/1/function/name")
                    .and_then(Value::as_str)
                    .ok_or_else(|| {
                        PrismError::new(
                            "PP2101",
                            "system release-ready theorem omits its manifest root",
                        )
                    })?;
                if linked.pointer("/proof/kind").and_then(Value::as_str) != Some("decide")
                    || linked
                        .pointer("/statement/left/function/name")
                        .and_then(Value::as_str)
                        != Some("validateManifest")
                    || !matches!(
                        linked
                            .pointer("/statement/left/function/module")
                            .and_then(Value::as_str),
                        Some("Production.SystemValidation" | "Production.BrowserSystem")
                    )
                    || linked
                        .pointer("/statement/left/arguments")
                        .and_then(Value::as_array)
                        .is_none_or(|arguments| arguments.len() != 2)
                    || linked
                        .pointer("/statement/left/arguments/0/kind")
                        .and_then(Value::as_str)
                        != Some("call")
                    || linked
                        .pointer("/statement/left/arguments/0/arguments")
                        .and_then(Value::as_array)
                        .is_none_or(|arguments| !arguments.is_empty())
                    || linked
                        .pointer("/statement/left/arguments/1/kind")
                        .and_then(Value::as_str)
                        != Some("call")
                    || linked
                        .pointer("/statement/left/arguments/1/arguments")
                        .and_then(Value::as_array)
                        .is_none_or(|arguments| !arguments.is_empty())
                    || linked
                        .pointer("/statement/right/value")
                        .and_then(Value::as_bool)
                        != Some(true)
                {
                    return Err(PrismError::new(
                        "PP2101",
                        "system release-ready theorem does not decide the generated manifest validator",
                    ));
                }
                validators.insert(
                    manifest_name.to_owned(),
                    linked
                        .pointer("/statement/left/function/module")
                        .and_then(Value::as_str)
                        .unwrap(),
                );
                if release_ready
                    .insert(manifest_name.to_owned(), model_name.to_owned())
                    .is_some()
                {
                    return Err(PrismError::new(
                        "PP2101",
                        "a system manifest has multiple release-ready theorems",
                    ));
                }
            }
            let name = declaration.logical_id();
            if declaration.kind() != "definition"
                || !(name == "systemManifest"
                    || name.strip_prefix("systemManifest").is_some_and(|value| {
                        !value.is_empty()
                            && value.len() <= 32
                            && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
                    }))
            {
                continue;
            }
            let linked = declaration.linked_ir();
            let member = linked
                .pointer("/result/member/name")
                .and_then(Value::as_str);
            let owner = linked
                .pointer("/result/member/module")
                .and_then(Value::as_str);
            if member != Some("SystemManifest")
                || !matches!(
                    owner,
                    Some("Production.System" | "Production.BrowserSystem")
                )
            {
                return Err(PrismError::new(
                    "PP2101",
                    "systemManifest has the wrong generated type",
                ));
            }
            owners.insert(name, owner.unwrap());
            let manifest = evaluate_model_term(&linked["body"])?;
            const RELATIONS: [&str; 12] = [
                "capability_satisfaction",
                "closure",
                "compatibility",
                "deployment_order",
                "evidence_closure",
                "license_closure",
                "migration_order",
                "referential_integrity",
                "release_completeness",
                "rollback_safety",
                "secret_flow",
                "uniqueness",
            ];
            let relations: &[&str] = if owner == Some(browser::MODULE) {
                &[
                    "application_model_digest",
                    "artifact_id",
                    "component_id",
                    "controls",
                    "product_id",
                    "product_version",
                    "target_id",
                ]
            } else {
                &RELATIONS
            };
            if manifest.as_object().is_none_or(|value| {
                value.len() != relations.len()
                    || relations.iter().any(|name| !value.contains_key(*name))
            }) {
                return Err(PrismError::new(
                    "PP2101",
                    "systemManifest must contain exactly its profile's validation bindings",
                ));
            }
            if found.insert(name, manifest).is_some() {
                return Err(PrismError::new(
                    "PP2101",
                    "the source graph duplicates a named system manifest root",
                ));
            }
        }
    }
    if found.is_empty() {
        return Ok(None);
    }
    if found.keys().any(|name| !release_ready.contains_key(*name))
        || release_ready
            .keys()
            .any(|name| !found.contains_key(name.as_str()))
    {
        return Err(PrismError::new(
            "PP2101",
            "each named system manifest requires exactly one release-ready theorem",
        ));
    }
    for (name, owner) in &owners {
        let validator = if *owner == browser::MODULE {
            browser::MODULE
        } else {
            "Production.SystemValidation"
        };
        if validators.get(*name).copied() != Some(validator) {
            return Err(PrismError::new(
                "PP2101",
                "system manifest validator type differs",
            ));
        }
    }
    let selected = if let Some(release) = release {
        found.get(format!("systemManifest{release}").as_str())
    } else if let Some(value) = found.get("systemManifest") {
        Some(value)
    } else if let Some(value) = found.get("systemManifestB") {
        Some(value)
    } else if found.len() == 1 {
        found.values().next()
    } else {
        None
    }
    .ok_or_else(|| PrismError::new("PP2101", "named system manifest selection is ambiguous"))?;
    if let Some((expected_model, expected_owner)) = expected_model {
        let manifest_name = if let Some(release) = release {
            format!("systemManifest{release}")
        } else if found.contains_key("systemManifest") {
            "systemManifest".to_owned()
        } else if found.contains_key("systemManifestB") {
            "systemManifestB".to_owned()
        } else {
            found
                .keys()
                .next()
                .expect("selected manifest exists")
                .to_string()
        };
        if release_ready.get(&manifest_name).map(String::as_str) != Some(expected_model)
            || owners.get(manifest_name.as_str()).copied() != Some(expected_owner)
        {
            return Err(PrismError::new(
                "PP2101",
                "system release-ready theorem does not bind the selected model and manifest roots",
            ));
        }
    }
    Ok(Some(selected.clone()))
}

fn ids(value: &Value, field: &str) -> Result<BTreeSet<String>, PrismError> {
    let rows = value[field]
        .as_array()
        .ok_or_else(|| PrismError::new("PP2101", format!("system {field} is absent")))?;
    let mut out = BTreeSet::new();
    let mut previous: Option<&str> = None;
    for row in rows {
        let id = row["id"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP2101", format!("{field} row has no id")))?;
        if previous.is_some_and(|prior| prior >= id) || !out.insert(id.to_owned()) {
            return Err(PrismError::new(
                "PP2101",
                format!("system {field} IDs are duplicate or noncanonical"),
            ));
        }
        previous = Some(id);
    }
    Ok(out)
}

fn require_refs(
    rows: &[Value],
    field: &str,
    known: &BTreeSet<String>,
    description: &str,
) -> Result<(), PrismError> {
    for row in rows {
        if let Some(value) = row.get(field) {
            if value.is_null() {
                continue;
            }
            let refs = if let Some(reference) = value.as_str() {
                vec![reference]
            } else {
                value
                    .as_array()
                    .ok_or_else(|| {
                        PrismError::new("PP2101", format!("{description} reference is malformed"))
                    })?
                    .iter()
                    .map(|value| {
                        value.as_str().ok_or_else(|| {
                            PrismError::new(
                                "PP2101",
                                format!("{description} reference is malformed"),
                            )
                        })
                    })
                    .collect::<Result<Vec<_>, _>>()?
            };
            if refs.iter().any(|reference| !known.contains(*reference)) {
                return Err(PrismError::new(
                    "PP2101",
                    format!("{description} contains a dangling reference"),
                ));
            }
        }
    }
    Ok(())
}

fn acyclic_components(rows: &[Value], components: &BTreeSet<String>) -> Result<(), PrismError> {
    let graph = rows
        .iter()
        .map(|row| {
            let id = row["id"].as_str().unwrap_or_default().to_owned();
            let edges = row["depends_on"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>();
            (id, edges)
        })
        .collect::<BTreeMap<_, _>>();
    fn visit(
        node: &str,
        graph: &BTreeMap<String, Vec<String>>,
        visiting: &mut BTreeSet<String>,
        complete: &mut BTreeSet<String>,
    ) -> bool {
        if complete.contains(node) {
            return true;
        }
        if !visiting.insert(node.to_owned()) {
            return false;
        }
        if graph[node]
            .iter()
            .any(|next| !visit(next, graph, visiting, complete))
        {
            return false;
        }
        visiting.remove(node);
        complete.insert(node.to_owned());
        true
    }
    let mut visiting = BTreeSet::new();
    let mut complete = BTreeSet::new();
    if components
        .iter()
        .any(|id| !visit(id, &graph, &mut visiting, &mut complete))
    {
        return Err(PrismError::new(
            "PP2101",
            "component dependency graph contains a cycle",
        ));
    }
    Ok(())
}

fn looks_secret(value: &str) -> bool {
    let lower = value.to_ascii_lowercase();
    value.contains("-----BEGIN")
        || lower.contains("authorization: bearer ")
        || lower.contains("password=")
        || lower.contains("client_secret=")
        || value.starts_with("ghp_")
        || value.starts_with("github_pat_")
}

fn scan_secrets(value: &Value) -> bool {
    match value {
        Value::String(value) => looks_secret(value),
        Value::Array(values) => values.iter().any(scan_secrets),
        Value::Object(values) => values.values().any(scan_secrets),
        _ => false,
    }
}

fn canonical_license_expression_text(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 256
        && value
            .bytes()
            .all(|byte| byte.is_ascii_graphic() || byte == b' ')
        && !value.starts_with(' ')
        && !value.ends_with(' ')
        && !value.contains("  ")
}

fn canonical_sql_identifier(value: &str) -> bool {
    value.len() <= 63
        && value.as_bytes().first().is_some_and(u8::is_ascii_lowercase)
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte == b'_' || byte.is_ascii_digit())
}

fn valid_artifact_path(value: &str) -> bool {
    let Some(authority) = value.split('/').next() else {
        return false;
    };
    let Some((host, port)) = authority.rsplit_once(':') else {
        return true;
    };
    !host.is_empty() && port.parse::<u16>().is_ok_and(|port| port != 0)
}

fn relation(bound: usize, values: Vec<usize>) -> Value {
    json!({"bound":bound,"values":values})
}

fn dependency_order(
    value: &Value,
    collection: &str,
    all_ids: &BTreeMap<String, usize>,
) -> Result<Vec<usize>, PrismError> {
    let identifiers = ids(value, collection)?.into_iter().collect::<Vec<_>>();
    let indexes = identifiers
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let rows = value[collection]
        .as_array()
        .expect("ids validates collection");
    let mut remaining = vec![0_usize; rows.len()];
    let mut dependents = vec![Vec::new(); rows.len()];
    for (index, row) in rows.iter().enumerate() {
        let dependencies = row["depends_on"].as_array().ok_or_else(|| {
            PrismError::new(
                "PP2101",
                format!("{collection} dependency list is absent or malformed"),
            )
        })?;
        for dependency in dependencies {
            let dependency = dependency
                .as_str()
                .ok_or_else(|| PrismError::new("PP2101", "dependency identity is not a string"))?;
            if let Some(&dependency_index) = indexes.get(dependency) {
                remaining[index] += 1;
                dependents[dependency_index].push(index);
            } else if collection != "migrations" || !all_ids.contains_key(dependency) {
                return Err(PrismError::new(
                    "PP2101",
                    format!("{collection} contains a dangling dependency"),
                ));
            }
        }
    }
    let mut ready = remaining
        .iter()
        .enumerate()
        .filter_map(|(index, count)| (*count == 0).then_some(index))
        .collect::<BTreeSet<_>>();
    let mut order = Vec::with_capacity(rows.len());
    while let Some(index) = ready.pop_first() {
        order.push(index);
        for &dependent in &dependents[index] {
            remaining[dependent] -= 1;
            if remaining[dependent] == 0 {
                ready.insert(dependent);
            }
        }
    }
    if order.len() != rows.len() {
        return Err(PrismError::new(
            "PP2101",
            format!("{collection} dependency graph contains a cycle"),
        ));
    }
    Ok(order)
}

fn indexed_references(value: &Value, indexes: &BTreeMap<String, usize>) -> Vec<usize> {
    let mut references = Vec::new();
    fn visit(value: &Value, indexes: &BTreeMap<String, usize>, references: &mut Vec<usize>) {
        match value {
            Value::String(value) => {
                if let Some(index) = indexes.get(value) {
                    references.push(*index);
                }
            }
            Value::Array(values) => {
                for value in values {
                    visit(value, indexes, references);
                }
            }
            Value::Object(values) => {
                for (name, value) in values {
                    if name != "id" {
                        visit(value, indexes, references);
                    }
                }
            }
            _ => {}
        }
    }
    visit(value, indexes, &mut references);
    references.sort_unstable();
    references.dedup();
    references
}

/// Produce the numeric certificate consumed by the generated formal validators.
///
/// String identities are first checked by `validate`; this projection then fixes
/// their unique canonical indexes so the axiom-free generated Lean/Rust roots can
/// independently check every relation without reimplementing strings in a target.
pub fn validation_certificate(value: &Value) -> Result<Value, PrismError> {
    let mut identifiers = vec![product_id(value)?.to_owned()];
    for collection in MODEL_ID_COLLECTIONS {
        for row in value[collection]
            .as_array()
            .ok_or_else(|| PrismError::new("PP2101", format!("system {collection} is absent")))?
        {
            identifiers.push(
                row["id"]
                    .as_str()
                    .ok_or_else(|| PrismError::new("PP2101", "certificate row omits id"))?
                    .to_owned(),
            );
        }
    }
    identifiers.sort();
    if identifiers.windows(2).any(|pair| pair[0] >= pair[1]) {
        return Err(PrismError::new(
            "PP2101",
            "certificate identities are not globally unique",
        ));
    }
    let indexes = identifiers
        .iter()
        .enumerate()
        .map(|(index, id)| (id.clone(), index))
        .collect::<BTreeMap<_, _>>();
    let all_references = indexed_references(value, &indexes);
    let component_ids = ids(value, "components")?;
    let component_indexes = component_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let secret_consumers = value["secret_references"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["consumers"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .filter_map(|id| component_indexes.get(id).copied())
        .collect::<Vec<_>>();
    let capability_ids = ids(value, "capabilities")?.into_iter().collect::<Vec<_>>();
    let capability_indexes = capability_ids
        .iter()
        .enumerate()
        .map(|(index, id)| (id.as_str(), index))
        .collect::<BTreeMap<_, _>>();
    let capability_links = value["components"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["capabilities"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
        .filter_map(|id| capability_indexes.get(id).copied())
        .collect::<Vec<_>>();
    let compatibility = value["interfaces"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| match row["compatibility"].as_str()? {
            "exact" => Some(0),
            "backward" => Some(1),
            "forward" => Some(2),
            "full" => Some(3),
            _ => None,
        })
        .collect::<Vec<_>>();
    let rollback_links = indexed_references(&value["rollbacks"], &indexes);
    let evidence_links = indexed_references(&value["acceptance"], &indexes);
    let artifact_count = value["artifacts"].as_array().map_or(0, Vec::len);
    let license_lengths = value["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|artifact| artifact["license_expression"].as_str())
        .map(|expression| expression.chars().count())
        .collect::<Vec<_>>();
    let component_count = component_ids.len();
    let migration_count = value["migrations"].as_array().map_or(0, Vec::len);
    let deployment_order = dependency_order(value, "components", &indexes)?;
    let migration_order = dependency_order(value, "migrations", &indexes)?;
    let canonical = (0..identifiers.len()).collect::<Vec<_>>();
    Ok(json!({
        "capability_satisfaction":relation(capability_ids.len(),capability_links),
        "closure":relation(identifiers.len(),all_references.clone()),
        "compatibility":relation(4,compatibility),
        "deployment_order":relation(component_count,deployment_order),
        "evidence_closure":relation(identifiers.len(),evidence_links),
        "license_closure":relation(257,license_lengths),
        "migration_order":relation(migration_count,migration_order),
        "referential_integrity":relation(identifiers.len(),all_references),
        "release_completeness":relation(artifact_count,(0..artifact_count).collect()),
        "rollback_safety":relation(identifiers.len(),rollback_links),
        "schema":"prismpm/system-validation-certificate/1",
        "secret_flow":relation(component_count,secret_consumers),
        "uniqueness":relation(identifiers.len(),canonical)
    }))
}

/// Validate graph closure and the generated formal-fact boundary.
pub fn validate(value: &Value, manifest: &Value) -> Result<(), PrismError> {
    if value["lifecycle"].as_object().is_none_or(|rows| {
        rows.values()
            .any(|value| value.as_str().is_none_or(str::is_empty))
    }) {
        return Err(PrismError::new("PP2101", "system lifecycle is incomplete"));
    }
    if scan_secrets(value) {
        return Err(PrismError::new(
            "PP7801",
            "system model contains probable secret material",
        ));
    }
    let profile = &value["application_profile"];
    if profile["contract"] != "prismpm/transactional-command-service/1" {
        return Err(PrismError::new(
            "PP2101",
            "system application profile contract is unsupported",
        ));
    }
    let command_fields = [
        "command_id_field",
        "operation_field",
        "input_a_field",
        "input_b_field",
        "annotation_field",
    ]
    .map(|name| {
        profile[name]
            .as_str()
            .expect("system schema validates profile fields")
    });
    if command_fields.iter().collect::<BTreeSet<_>>().len() != command_fields.len()
        || !["{operation}", "{inputA}", "{inputB}"].iter().all(|term| {
            profile["command_encoding"]
                .as_str()
                .is_some_and(|value| value.contains(term))
        })
        || profile["submitter_role"] == profile["observer_role"]
    {
        return Err(PrismError::new(
            "PP2101",
            "system application profile command, role, or encoding terms are inconsistent",
        ));
    }
    let errors = profile["application_errors"]
        .as_array()
        .expect("system schema validates application errors");
    let wire_names = errors
        .iter()
        .filter_map(|error| error["wire_name"].as_str())
        .collect::<BTreeSet<_>>();
    let model_names = errors
        .iter()
        .filter_map(|error| error["model_name"].as_str())
        .collect::<BTreeSet<_>>();
    let operations = profile["command_operations"]
        .as_array()
        .expect("system schema validates command operations");
    let storage_columns = [
        "command_id_column",
        "operation_column",
        "input_a_column",
        "input_b_column",
        "annotation_column",
    ]
    .map(|name| {
        profile[name]
            .as_str()
            .expect("system schema validates storage column names")
    });
    let acceptance_inputs = [
        "acceptance_error_input_a",
        "acceptance_error_input_b",
        "acceptance_conflict_input_b",
        "acceptance_success_input_a",
        "acceptance_success_input_b",
        "acceptance_expected_result",
    ];
    if wire_names.len() != errors.len()
        || model_names.len() != errors.len()
        || storage_columns.iter().collect::<BTreeSet<_>>().len() != storage_columns.len()
        || storage_columns
            .iter()
            .any(|value| !canonical_sql_identifier(value))
        || ["acceptance_error_operation", "acceptance_success_operation"]
            .iter()
            .any(|name| !operations.contains(&profile[*name]))
        || profile["acceptance_expected_error"]
            .as_str()
            .is_none_or(|name| !model_names.contains(name))
        || acceptance_inputs.iter().any(|name| {
            profile[*name]
                .as_str()
                .and_then(|value| value.parse::<i64>().ok())
                .is_none()
        })
        || profile["acceptance_error_input_b"] == profile["acceptance_conflict_input_b"]
    {
        return Err(PrismError::new(
            "PP2101",
            "system application error, storage, or acceptance bindings are inconsistent",
        ));
    }
    let mut all_ids = BTreeSet::from([product_id(value)?.to_owned()]);
    for field in MODEL_ID_COLLECTIONS {
        for id in ids(value, field)? {
            if !all_ids.insert(id) {
                return Err(PrismError::new(
                    "PP2101",
                    "system IDs are not globally unique",
                ));
            }
        }
    }
    let components = ids(value, "components")?;
    let artifacts = ids(value, "artifacts")?;
    if value["artifacts"]
        .as_array()
        .expect("system schema validates artifacts")
        .iter()
        .any(|artifact| {
            artifact["license_expression"]
                .as_str()
                .is_none_or(|value| !canonical_license_expression_text(value))
        })
    {
        return Err(PrismError::new(
            "PP2101",
            "artifact license expression is not canonical bounded text",
        ));
    }
    if value["artifacts"]
        .as_array()
        .expect("system schema validates artifacts")
        .iter()
        .any(|artifact| {
            artifact["path"]
                .as_str()
                .is_none_or(|value| !valid_artifact_path(value))
        })
    {
        return Err(PrismError::new(
            "PP2101",
            "artifact path has an invalid registry authority or port",
        ));
    }
    let interfaces = ids(value, "interfaces")?;
    let capabilities = ids(value, "capabilities")?;
    let parameters = ids(value, "parameters")?;
    let platform_requirements = ids(value, "platform_requirements")?;
    let scaling_policies = ids(value, "scaling_policies")?;
    let schemas = ids(value, "schemas")?;
    let secrets = ids(value, "secret_references")?;
    let storage_classes = ids(value, "storage_classes")?;
    let targets = ids(value, "targets")?;
    let topology = ids(value, "topology")?;
    require_refs(
        std::slice::from_ref(&value["product"]),
        "supported_platforms",
        &platform_requirements,
        "product supported platform",
    )?;
    require_refs(
        value["artifacts"].as_array().unwrap(),
        "platform_requirements",
        &platform_requirements,
        "artifact platform requirement",
    )?;
    let component_rows = value["components"].as_array().unwrap();
    require_refs(component_rows, "artifact", &artifacts, "component artifact")?;
    require_refs(
        component_rows,
        "capabilities",
        &capabilities,
        "component capability",
    )?;
    require_refs(
        component_rows,
        "depends_on",
        &components,
        "component dependency",
    )?;
    require_refs(
        component_rows,
        "interfaces",
        &interfaces,
        "component interface",
    )?;
    require_refs(
        component_rows,
        "parameters",
        &parameters,
        "component parameter",
    )?;
    require_refs(component_rows, "ports", &topology, "component port")?;
    require_refs(component_rows, "secrets", &secrets, "component secret")?;
    require_refs(component_rows, "volumes", &topology, "component volume")?;
    require_refs(
        component_rows,
        "platform_requirements",
        &platform_requirements,
        "component platform requirement",
    )?;
    require_refs(
        component_rows,
        "placement",
        &topology,
        "component placement",
    )?;
    require_refs(
        component_rows,
        "scaling_policy",
        &scaling_policies,
        "component scaling policy",
    )?;
    if component_rows.iter().any(|component| {
        component["resources"]["replicas_min"].as_u64().unwrap_or(0)
            > component["resources"]["replicas_max"].as_u64().unwrap_or(0)
    }) {
        return Err(PrismError::new(
            "PP2101",
            "component replica bounds are inconsistent",
        ));
    }
    let scaling_rows = value["scaling_policies"].as_array().unwrap();
    require_refs(scaling_rows, "component", &components, "scaling component")?;
    if scaling_rows.iter().any(|row| {
        row["minimum"].as_u64().unwrap_or(0) > row["maximum"].as_u64().unwrap_or(0)
            || row["step"].as_u64().unwrap_or(0) == 0
    }) {
        return Err(PrismError::new(
            "PP2101",
            "scaling policy bounds are inconsistent",
        ));
    }
    acyclic_components(component_rows, &components)?;
    let flows = value["flows"].as_array().unwrap();
    require_refs(flows, "from", &components, "flow source")?;
    require_refs(flows, "to", &components, "flow destination")?;
    require_refs(flows, "interface", &interfaces, "flow interface")?;
    let calls = value["calls"].as_array().unwrap();
    require_refs(calls, "from_component", &components, "call source")?;
    require_refs(calls, "to_component", &components, "call destination")?;
    require_refs(calls, "interface_id", &interfaces, "call interface")?;
    let events = value["events"].as_array().unwrap();
    require_refs(events, "producer", &components, "event producer")?;
    require_refs(events, "owner", &components, "event owner")?;
    require_refs(events, "channel", &interfaces, "event channel")?;
    require_refs(events, "schema_id", &schemas, "event schema")?;
    require_refs(
        value["secret_references"].as_array().unwrap(),
        "consumers",
        &components,
        "secret consumer",
    )?;
    require_refs(
        value["identity_requirements"].as_array().unwrap(),
        "issuer_parameter",
        &parameters,
        "identity issuer parameter",
    )?;
    require_refs(
        value["persistence"].as_array().unwrap(),
        "owner",
        &components,
        "persistence owner",
    )?;
    require_refs(
        value["persistence"].as_array().unwrap(),
        "schema_artifact",
        &artifacts,
        "persistence schema",
    )?;
    let migrations = ids(value, "migrations")?;
    require_refs(
        value["persistence"].as_array().unwrap(),
        "migration_order",
        &migrations,
        "persistence migration order",
    )?;
    let migration_rows = value["migrations"]
        .as_array()
        .expect("system schema validates migrations");
    if migration_rows.iter().any(|row| {
        !matches!(
            row["kind"].as_str(),
            Some("initialize" | "expand" | "contract")
        )
    }) {
        return Err(PrismError::new(
            "PP2101",
            "migration kind is not initialize, expand, or contract",
        ));
    }
    for persistence in value["persistence"].as_array().unwrap() {
        let order = persistence["migration_order"]
            .as_array()
            .expect("system schema validates migration order");
        let mut contract_seen = false;
        for id in order.iter().filter_map(Value::as_str) {
            let row = migration_rows
                .iter()
                .find(|row| row["id"].as_str() == Some(id))
                .expect("migration references were validated");
            match row["kind"].as_str() {
                Some("contract") => {
                    contract_seen = true;
                    let sql = row["value"].as_str().unwrap_or_default();
                    if !sql.trim_end().ends_with(';')
                        || sql.bytes().any(|byte| byte == 0 || byte == b'\r')
                    {
                        return Err(PrismError::new(
                            "PP2101",
                            "contract migration must contain canonical executable SQL",
                        ));
                    }
                }
                Some("initialize" | "expand") if contract_seen => {
                    return Err(PrismError::new(
                        "PP2101",
                        "expand-compatible migration appears after a contract migration",
                    ));
                }
                _ => {}
            }
        }
    }
    require_refs(
        value["interfaces"].as_array().unwrap(),
        "document",
        &schemas,
        "interface document",
    )?;
    require_refs(
        value["interfaces"].as_array().unwrap(),
        "acceptance",
        &ids(value, "acceptance")?,
        "interface acceptance",
    )?;
    require_refs(
        value["acceptance"].as_array().unwrap(),
        "target",
        &targets,
        "acceptance target",
    )?;
    require_refs(
        value["acceptance"].as_array().unwrap(),
        "component",
        &components,
        "acceptance component",
    )?;
    require_refs(
        value["topology"].as_array().unwrap(),
        "owners",
        &components,
        "topology owner",
    )?;
    let topology_rows = value["topology"].as_array().unwrap();
    require_refs(
        topology_rows,
        "capabilities",
        &capabilities,
        "topology capability",
    )?;
    require_refs(
        topology_rows,
        "platform_requirements",
        &platform_requirements,
        "topology platform requirement",
    )?;
    require_refs(
        topology_rows,
        "storage_class",
        &storage_classes,
        "topology storage class",
    )?;
    require_refs(topology_rows, "placement", &topology, "topology placement")?;
    if topology_rows.iter().any(|row| {
        row["scale_min"].as_u64().unwrap_or(0) > row["scale_max"].as_u64().unwrap_or(0)
            || (row["kind"] == "persistent-volume"
                && (row["storage_class"].is_null()
                    || row["storage_bytes"].is_null()
                    || row["mount_path"].is_null()))
            || (row["kind"] == "port" && (row["port"].is_null() || row["protocol"].is_null()))
    }) {
        return Err(PrismError::new(
            "PP2101",
            "topology kind requirements or scale bounds are inconsistent",
        ));
    }
    let storage_rows = value["storage_classes"].as_array().unwrap();
    require_refs(
        storage_rows,
        "capabilities",
        &capabilities,
        "storage capability",
    )?;
    require_refs(
        storage_rows,
        "platform_requirements",
        &platform_requirements,
        "storage platform requirement",
    )?;
    let target_rows = value["targets"].as_array().unwrap();
    require_refs(
        target_rows,
        "platform_requirements",
        &platform_requirements,
        "target platform requirement",
    )?;
    require_refs(
        target_rows,
        "storage_class",
        &storage_classes,
        "target storage class",
    )?;
    require_refs(
        target_rows,
        "ingress_controller_artifact",
        &artifacts,
        "target ingress controller artifact",
    )?;
    require_refs(
        value["architecture"].as_array().unwrap(),
        "verifies",
        &all_ids,
        "architecture verification",
    )?;
    require_refs(
        value["controls"].as_array().unwrap(),
        "verification",
        &all_ids,
        "control verification",
    )?;
    for field in [
        "alerts",
        "architecture",
        "backups",
        "calls",
        "capabilities",
        "controls",
        "drifts",
        "events",
        "migrations",
        "retirements",
        "rollbacks",
        "rollouts",
        "schemas",
        "slis",
        "slos",
        "topology",
    ] {
        require_refs(
            value[field].as_array().unwrap(),
            "depends_on",
            &all_ids,
            &format!("{field} dependency"),
        )?;
    }
    crate::deployment::validate_targets(value)?;
    let certificate = validation_certificate(value)?;
    let mut formal_certificate = certificate.clone();
    formal_certificate
        .as_object_mut()
        .expect("generated validation certificate is an object")
        .remove("schema");
    if *manifest != formal_certificate {
        for (k, v) in manifest.as_object().unwrap() {
            if let Some(other) = formal_certificate.get(k) {
                if v != other {
                    eprintln!("FIELD MISMATCH {k}:\nMANIFEST: {v}\nFORMAL:   {other}");
                }
            } else {
                eprintln!("FIELD MISSING IN FORMAL: {k}");
            }
        }
        for (k, _) in formal_certificate.as_object().unwrap() {
            if !manifest.as_object().unwrap().contains_key(k) {
                eprintln!("FIELD EXTRA IN FORMAL: {k}");
            }
        }
        return Err(PrismError::new(
            "PP2101",
            "authored formal validation certificate does not equal the closed model graph",
        ));
    }
    for name in [
        "capability_satisfaction",
        "closure",
        "compatibility",
        "evidence_closure",
        "license_closure",
        "referential_integrity",
        "rollback_safety",
        "secret_flow",
    ] {
        let relation = &certificate[name];
        let bound = relation["bound"].as_u64().unwrap_or(0);
        if relation["values"].as_array().is_none_or(|values| {
            values
                .iter()
                .any(|value| value.as_u64().is_none_or(|v| v >= bound))
        }) {
            return Err(PrismError::new(
                "PP2101",
                format!("formal {name} relation is out of bounds"),
            ));
        }
    }
    if certificate["license_closure"]["values"]
        .as_array()
        .is_none_or(|values| {
            values.is_empty() || values.iter().any(|value| value.as_u64() == Some(0))
        })
    {
        return Err(PrismError::new(
            "PP2101",
            "formal license closure contains an empty artifact license expression",
        ));
    }
    for name in ["deployment_order", "migration_order"] {
        let relation = &certificate[name];
        let bound = relation["bound"].as_u64().unwrap_or(0);
        let values = relation["values"].as_array().expect("generated relation");
        let indexes = values
            .iter()
            .filter_map(Value::as_u64)
            .collect::<BTreeSet<_>>();
        if values.len() as u64 != bound || !indexes.into_iter().eq(0..bound) {
            return Err(PrismError::new(
                "PP2101",
                format!("formal {name} relation is not a complete permutation"),
            ));
        }
    }
    for name in ["release_completeness", "uniqueness"] {
        let relation = &certificate[name];
        if relation["values"].as_array().is_none_or(|values| {
            values
                .iter()
                .enumerate()
                .any(|(index, value)| value.as_u64() != Some(index as u64))
        }) {
            return Err(PrismError::new(
                "PP2101",
                format!("formal {name} relation is not canonical"),
            ));
        }
    }
    Ok(())
}

/// Project a system root and its generated proof facts from a semantic snapshot.
pub fn project(
    snapshot: &SemanticSnapshot,
    release: Option<&str>,
) -> Result<Option<CanonicalDocument>, PrismError> {
    let Some((root_name, root)) = system_root(snapshot, release)? else {
        if system_manifest(snapshot, release, None)?.is_some() {
            return Err(PrismError::new(
                "PP2101",
                "systemManifest exists without a typed systemModel",
            ));
        }
        return Ok(None);
    };
    let owner = root
        .pointer("/type/module")
        .and_then(Value::as_str)
        .expect("typed root");
    let schema = if owner == browser::MODULE {
        browser::SCHEMA
    } else {
        "prismpm/system-model/1"
    };
    let mut value = evaluate_model_term(root)?;
    value["schema"] = Value::String(schema.to_owned());
    let document = CanonicalDocument::from_value(schema, value)?;
    let manifest =
        system_manifest(snapshot, release, Some((root_name, owner)))?.ok_or_else(|| {
            PrismError::new(
                "PP2101",
                "systemModel requires a generated, proved systemManifest",
            )
        })?;
    if schema == browser::SCHEMA {
        browser::validate(document.value(), &manifest)?;
    } else {
        validate(document.value(), &manifest)?;
    }
    Ok(Some(document))
}

/// Parse only explicitly supported system contracts; never infer a profile.
pub(crate) fn parse(bytes: &[u8]) -> Result<CanonicalDocument, PrismError> {
    if bytes.len() > 16_777_216 {
        return Err(PrismError::new(
            "PP1101",
            "system document exceeds the byte limit",
        ));
    }
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| PrismError::new("PP2101", format!("system document: {error}")))?;
    let schema = match value["schema"].as_str() {
        Some("prismpm/system-model/1") => "prismpm/system-model/1",
        Some(browser::SCHEMA) => browser::SCHEMA,
        _ => return Err(PrismError::new("PP2101", "unsupported system profile")),
    };
    CanonicalDocument::parse(schema, bytes)
}

/// Project every named release root in the closed source graph.
pub(crate) fn project_all(
    snapshot: &SemanticSnapshot,
) -> Result<Vec<CanonicalDocument>, PrismError> {
    let mut selectors = BTreeSet::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let name = declaration.logical_id();
            if declaration.kind() != "definition" {
                continue;
            }
            if name == "systemModel" {
                selectors.insert(None);
            } else if let Some(selector) = name.strip_prefix("systemModel").filter(|value| {
                !value.is_empty()
                    && value.len() <= 32
                    && value.bytes().all(|byte| byte.is_ascii_alphanumeric())
            }) {
                selectors.insert(Some(selector.to_owned()));
            }
        }
    }
    let mut documents = Vec::new();
    for selector in selectors {
        if let Some(document) = project(snapshot, selector.as_deref())? {
            documents.push(document);
        }
    }
    documents.sort_by(|left, right| {
        left.value()["product"]["version"]
            .as_str()
            .cmp(&right.value()["product"]["version"].as_str())
    });
    Ok(documents)
}

fn operations(system: &Value) -> Vec<(&str, &str, &str)> {
    let mut rows = system["architecture"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|row| row["kind"] == "http-operation")
        .filter_map(|row| {
            let id = row["id"].as_str()?;
            let value = row["value"].as_str()?;
            let (method, path) = value.split_once(' ')?;
            Some((id, method, path))
        })
        .collect::<Vec<_>>();
    rows.sort_unstable();
    rows
}

fn openapi(system: &Value) -> Value {
    let profile = &system["application_profile"];
    let integer = json!({"maxLength":20,"minLength":1,"pattern":"^(?:0|-[1-9][0-9]*|[1-9][0-9]*)$","type":"string"});
    let unsigned =
        json!({"maxLength":20,"minLength":1,"pattern":"^(?:0|[1-9][0-9]*)$","type":"string"});
    let application_errors = profile["application_errors"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|error| error["model_name"].as_str())
        .collect::<Vec<_>>();
    let mut protocol_errors = vec![
        "Forbidden",
        "IdempotencyConflict",
        "MalformedJson",
        "NotFound",
        "OversizedInput",
        "ServiceUnavailable",
        "Unauthenticated",
        "UnsupportedMedia",
        "UnsupportedMethod",
    ];
    protocol_errors.extend(application_errors.iter().copied());
    protocol_errors.sort_unstable();
    protocol_errors.dedup();
    let error = json!({
        "additionalProperties":false,
        "properties":{"error":{"additionalProperties":false,"properties":{"code":{"enum":protocol_errors}},"required":["code"],"type":"object"}},
        "required":["error"],"type":"object"
    });
    let outcome = json!({
        "oneOf":[
            {"additionalProperties":false,"properties":{"kind":{"const":"succeeded"},"result":integer.clone()},"required":["kind","result"],"type":"object"},
            {"additionalProperties":false,"properties":{"error":{"enum":application_errors},"kind":{"const":"rejected"}},"required":["error","kind"],"type":"object"}
        ]
    });
    let label_enabled = profile["optional_annotation"] == "optional";
    let request_pattern = profile["command_id_pattern"].clone();
    let user_role = profile["submitter_role"].clone();
    let auditor_role = profile["observer_role"].clone();
    let command_id = profile["command_id_field"]
        .as_str()
        .expect("validated profile");
    let operation = profile["operation_field"]
        .as_str()
        .expect("validated profile");
    let input_a = profile["input_a_field"]
        .as_str()
        .expect("validated profile");
    let input_b = profile["input_b_field"]
        .as_str()
        .expect("validated profile");
    let annotation = profile["annotation_field"]
        .as_str()
        .expect("validated profile");
    let mut record_properties = Map::from_iter([
        (input_a.to_owned(), integer.clone()),
        (
            operation.to_owned(),
            json!({"enum":profile["command_operations"]}),
        ),
        ("outcome".to_owned(), outcome),
        (
            command_id.to_owned(),
            json!({"pattern":request_pattern,"type":"string"}),
        ),
        (input_b.to_owned(), integer.clone()),
        ("sequence".to_owned(), unsigned),
        (
            "subject".to_owned(),
            json!({"maxLength":255,"minLength":1,"pattern":"^[\\u0000-\\u007f]+$","type":"string"}),
        ),
    ]);
    let mut record_required = vec![
        input_a, operation, "outcome", command_id, input_b, "sequence", "subject",
    ];
    let mut request_properties = Map::from_iter([
        (input_a.to_owned(), integer.clone()),
        (
            operation.to_owned(),
            json!({"enum":profile["command_operations"]}),
        ),
        (
            command_id.to_owned(),
            json!({"pattern":request_pattern,"type":"string"}),
        ),
        (input_b.to_owned(), integer.clone()),
    ]);
    if label_enabled {
        record_properties.insert(
            annotation.to_owned(),
            json!({"type":["string","null"],"maxLength":profile["annotation_max_scalars"]}),
        );
        record_required.push(annotation);
        record_required.sort_unstable();
        request_properties.insert(
            annotation.to_owned(),
            json!({"maxLength":profile["annotation_max_scalars"],"type":"string"}),
        );
    }
    let record = json!({
        "additionalProperties":false,
        "properties":record_properties,
        "required":record_required,"type":"object"
    });
    let mut paths = Map::new();
    for (id, method, path) in operations(system) {
        let method = method.to_ascii_lowercase();
        let entry = paths
            .entry(path.to_owned())
            .or_insert_with(|| Value::Object(Map::new()));
        let operation = match (method.as_str(), path.contains('{')) {
            ("post", false) => json!({
                "operationId":id,
                "requestBody":{"content":{"application/json":{"schema":{"additionalProperties":false,"properties":request_properties.clone(),"required":[input_a,operation,command_id,input_b],"type":"object"}}},"required":true},
                "responses":{"200":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/HistoryRecord"}}},"description":"Command succeeded"},"400":{"$ref":"#/components/responses/Error"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Error"},"409":{"$ref":"#/components/responses/Error"},"413":{"$ref":"#/components/responses/Error"},"415":{"$ref":"#/components/responses/Error"},"422":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/HistoryRecord"}}},"description":"Accepted application-domain error"},"503":{"$ref":"#/components/responses/Error"}},
                "security":[{"oidc":[user_role]}]
            }),
            ("get", true) => json!({
                "operationId":id,"parameters":[{"in":"path","name":command_id,"required":true,"schema":{"pattern":request_pattern,"type":"string"}}],
                "responses":{"200":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/HistoryRecord"}}},"description":"Visible history record"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Error"},"404":{"$ref":"#/components/responses/Error"},"503":{"$ref":"#/components/responses/Error"}},
                "security":[{"oidc":[user_role]},{"oidc":[auditor_role]}]
            }),
            ("get", false) => json!({
                "operationId":id,"parameters":[{"in":"query","name":"after","required":false,"schema":{"default":"0","pattern":"^(?:0|[1-9][0-9]*)$","type":"string"}},{"in":"query","name":"limit","required":false,"schema":{"default":system["application_profile"]["history_default_limit"],"maximum":system["application_profile"]["history_max_limit"],"minimum":1,"type":"integer"}}],
                "responses":{"200":{"content":{"application/json":{"schema":{"additionalProperties":false,"properties":{"records":{"items":{"$ref":"#/components/schemas/HistoryRecord"},"type":"array"}},"required":["records"],"type":"object"}}},"description":"Ascending visible history"},"400":{"$ref":"#/components/responses/Error"},"401":{"$ref":"#/components/responses/Unauthorized"},"403":{"$ref":"#/components/responses/Error"},"503":{"$ref":"#/components/responses/Error"}},
                "security":[{"oidc":[user_role]},{"oidc":[auditor_role]}]
            }),
            _ => {
                json!({"operationId":id,"responses":{"200":{"description":"Modeled response"}},"security":[{"oidc":[]}]})
            }
        };
        entry.as_object_mut().unwrap().insert(method, operation);
    }
    json!({
        "components": {
            "responses":{
                "Error":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Error"}}},"description":"Closed modeled error"},
                "Unauthorized":{"content":{"application/json":{"schema":{"$ref":"#/components/schemas/Error"}}},"description":"Authentication required","headers":{"WWW-Authenticate":{"schema":{"type":"string"}}}}
            },
            "schemas":{"Error":error,"HistoryRecord":record},
            "securitySchemes": {"oidc": {"type": "openIdConnect", "openIdConnectUrl": "https://runtime.invalid/.well-known/openid-configuration"}}
        },
        "info": {"title": system["product"]["id"], "version": system["product"]["version"]},
        "openapi": "3.2.0",
        "paths": paths,
        "servers":[{"url":"https://runtime.invalid"}]
    })
}

fn asyncapi(system: &Value) -> Value {
    let mut channels = Map::new();
    for flow in system["flows"].as_array().into_iter().flatten() {
        if flow["delivery"] == "at-least-once" {
            if let Some(id) = flow["id"].as_str() {
                channels.insert(
                    id.to_owned(),
                    json!({"address": id, "messages": {"event": {"$ref": "#/components/messages/CloudEvent"}}}),
                );
            }
        }
    }
    let event = cloudevents(system);
    json!({
        "asyncapi": "3.1.0",
        "channels": channels,
        "components": {"messages": {"CloudEvent": {"contentType": "application/cloudevents+json", "payload": event}}},
        "info": {"title": system["product"]["id"], "version": system["product"]["version"]}
    })
}

fn cloudevents(system: &Value) -> Value {
    let profile = &system["application_profile"];
    let history = openapi(system)["components"]["schemas"]["HistoryRecord"].clone();
    json!({
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "additionalProperties": false,
        "properties": {
            "data": history,
            "id": {"pattern":"^[0-9a-f]{64}$","type": "string"},
            "source": {"const":profile["event_source"],"type": "string"},
            "specversion": {"const": "1.0"},
            "subject": {"pattern":profile["command_id_pattern"],"type": "string"},
            "type": {"enum":[profile["accepted_event_type"],profile["rejected_event_type"]],"type": "string"}
        },
        "required": ["data", "id", "source", "specversion", "subject", "type"],
        "type": "object"
    })
}

pub(crate) fn spdx(system: &Value) -> Value {
    let document_id = format!(
        "urn:spdx:{}:document",
        system["product"]["id"].as_str().unwrap_or("prism-system")
    );
    let creation = json!({
        "comment":"Reproducible-build epoch; wall-clock observations are excluded from deterministic artifacts",
        "created":"1970-01-01T00:00:00Z",
        "createdBy":["https://github.com/UOR-Foundation/PrismPM"],
        "specVersion":"3.0.1",
        "type":"CreationInfo"
    });
    let mut graph = vec![json!({
        "creationInfo": creation,
        "element":[],
        "name": system["product"]["id"],
        "profileConformance":["core","software"],
        "rootElement":[],
        "spdxId": document_id,
        "type": "SpdxDocument"
    })];
    let mut package_ids = Vec::new();
    for component in system["components"].as_array().into_iter().flatten() {
        let package_id = format!("urn:spdx:{}", component["id"].as_str().unwrap_or_default());
        graph.push(json!({
            "creationInfo":creation,
            "name": component["id"],
            "software_packageVersion":component["version"],
            "spdxId": package_id,
            "type": "software_Package"
        }));
        graph.push(json!({
            "creationInfo":creation,
            "from": document_id,
            "relationshipType": "describes",
            "spdxId":format!("urn:spdx:relationship:{}",component["id"].as_str().unwrap_or_default()),
            "to": [package_id],
            "type": "Relationship"
        }));
        package_ids.push(package_id);
    }
    graph[0]["element"] = Value::Array(package_ids.iter().cloned().map(Value::String).collect());
    graph[0]["rootElement"] = Value::Array(package_ids.into_iter().map(Value::String).collect());
    graph.sort_by(|left, right| left["spdxId"].as_str().cmp(&right["spdxId"].as_str()));
    json!({
        "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        "@graph": graph
    })
}

fn opentelemetry(system: &Value) -> Value {
    let redacted = system["observability"]["redacted_fields"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|field| json!({"action":"delete","key":field}))
        .collect::<Vec<_>>();
    json!({
        "exporters": {
            "debug": {"verbosity": "detailed"},
            "file/logs": {"path": "/var/lib/prismpm-telemetry/logs.json"},
            "file/metrics": {"path": "/var/lib/prismpm-telemetry/metrics.json"},
            "file/traces": {"path": "/var/lib/prismpm-telemetry/traces.json"}
        },
        "extensions": {"health_check": {"endpoint": "0.0.0.0:13133"}},
        "processors": {
            "attributes/redact": {"actions": redacted},
            "batch": {}
        },
        "receivers": {
            "otlp": {"protocols": {"grpc": {"endpoint": "0.0.0.0:4317"}, "http": {"endpoint": "0.0.0.0:4318"}}}
        },
        "service": {
            "extensions": ["health_check"],
            "pipelines": {
                "logs": {"exporters": ["debug", "file/logs"], "processors": ["attributes/redact", "batch"], "receivers": ["otlp"]},
                "metrics": {"exporters": ["debug", "file/metrics"], "processors": ["attributes/redact", "batch"], "receivers": ["otlp"]},
                "traces": {"exporters": ["debug", "file/traces"], "processors": ["attributes/redact", "batch"], "receivers": ["otlp"]}
            }
        }
    })
}

fn runtime_profile(system: &Value) -> Value {
    let mut contract = system["application_profile"].clone();
    let object = contract
        .as_object_mut()
        .expect("validated application profile object");
    object.insert("product_id".to_owned(), system["product"]["id"].clone());
    object.insert(
        "redacted_fields".to_owned(),
        system["observability"]["redacted_fields"].clone(),
    );
    object.insert("release".to_owned(), system["product"]["version"].clone());
    contract
}

pub(crate) fn authority_binding_for_feature(feature_id: &str) -> Result<Value, PrismError> {
    let lock: Value = serde_json::from_str(include_str!("../standards.lock"))
        .map_err(|error| PrismError::new("PP9001", format!("standards lock: {error}")))?;
    let mut ids = lock["authorities"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP9001", "standards authorities are absent"))?
        .iter()
        .filter(|authority| {
            authority["realized_by"]
                .as_array()
                .is_some_and(|ids| ids.iter().any(|id| id == feature_id))
        })
        .map(|authority| {
            authority["id"]
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| PrismError::new("PP9001", "standards authority ID is absent"))
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    ids.sort();
    ids.dedup();
    Ok(if ids.is_empty() {
        json!({
            "kind":"none",
            "reason":"Prism-owned behavior; no adopted external standard owns this capability"
        })
    } else {
        json!({"ids":ids,"kind":"present"})
    })
}

fn capability_coverage(model_digest: &str) -> Result<Value, PrismError> {
    let ids: toml::Value = include_str!("../model/ids.toml")
        .parse()
        .map_err(|error| PrismError::new("PP9001", format!("feature register: {error}")))?;
    let errors: toml::Value = include_str!("../model/errors.toml")
        .parse()
        .map_err(|error| PrismError::new("PP9001", format!("diagnostic register: {error}")))?;
    let mut features = ids
        .get("id")
        .and_then(toml::Value::as_array)
        .ok_or_else(|| PrismError::new("PP9001", "feature register rows are absent"))?
        .iter()
        .map(|row| {
            let feature_id = row
                .get("id")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "feature ID is absent"))?;
            let suite = row
                .get("suite")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "feature suite is absent"))?;
            let statement = row
                .get("statement")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "feature statement is absent"))?;
            let scenario = feature_id.to_ascii_lowercase();
            Ok(json!({
                "command":format!("prismpm-conformance --feature {feature_id}"),
                "feature_id":feature_id,
                "generated_outputs":[format!("projections/capability-coverage.json#feature={feature_id}")],
                "model_source":format!("model/ids.toml#{feature_id}"),
                "negative_evidence":format!("production-acceptance://feature/{feature_id}#planted-defect"),
                "negative_scenario":format!("{scenario}-negative"),
                "positive_evidence":format!("production-acceptance://feature/{feature_id}#positive"),
                "positive_scenario":format!("{scenario}-positive"),
                "standard_authorities":authority_binding_for_feature(feature_id)?,
                "statement":statement,
                "suite":suite,
                "visibility":"public"
            }))
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    features.sort_by(|left, right| {
        left["feature_id"]
            .as_str()
            .cmp(&right["feature_id"].as_str())
    });
    let mut diagnostics = errors
        .get("error")
        .and_then(toml::Value::as_array)
        .ok_or_else(|| PrismError::new("PP9001", "diagnostic register rows are absent"))?
        .iter()
        .map(|row| {
            let code = row
                .get("code")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "diagnostic code is absent"))?;
            let class = row
                .get("class")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "diagnostic class is absent"))?;
            let statement = row
                .get("statement")
                .and_then(toml::Value::as_str)
                .ok_or_else(|| PrismError::new("PP9001", "diagnostic statement is absent"))?;
            let scenario = format!("diagnostic-{}", code.to_ascii_lowercase());
            Ok(json!({
                "class":class,
                "code":code,
                "command":format!("prismpm-conformance --diagnostic {code}"),
                "evidence":format!("production-acceptance://diagnostic/{code}"),
                "generated_outputs":[format!("projections/capability-coverage.json#diagnostic={code}")],
                "model_source":format!("model/errors.toml#{code}"),
                "scenario":scenario,
                "standard_authorities":{
                    "kind":"none",
                    "reason":"Prism-owned diagnostic contract; no external standard owns this error code"
                },
                "statement":statement
                ,"visibility":"public"
            }))
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    diagnostics.sort_by(|left, right| left["code"].as_str().cmp(&right["code"].as_str()));
    let value = json!({
        "diagnostics":diagnostics,
        "features":features,
        "model_digest":model_digest,
        "schema":"prismpm/capability-coverage/1"
    });
    CanonicalDocument::from_value("prismpm/capability-coverage/1", value)
        .map(|document| document.value().clone())
}

fn uses_runtime(component: &Value) -> bool {
    matches!(
        component["kind"].as_str(),
        Some(
            "api"
                | "browser"
                | "worker"
                | "identity-provider"
                | "migration"
                | "telemetry-collector"
        )
    )
}

fn secret_file_environment(component: &Value) -> Map<String, Value> {
    component["secrets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .map(|id| {
            (
                format!("{}_FILE", id.replace('-', "_").to_ascii_uppercase()),
                json!(format!("/run/secrets/{id}")),
            )
        })
        .collect()
}

fn compose(system: &Value) -> Result<Value, PrismError> {
    let policy = crate::deployment::projection_policy("compose")?;
    let artifacts = system["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let topology = system["topology"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let parameters = system["parameters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let component_kinds = system["components"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row["kind"].as_str()?)))
        .collect::<BTreeMap<_, _>>();
    let mut services = Map::new();
    for component in system["components"].as_array().into_iter().flatten() {
        let id = component["id"].as_str().unwrap_or_default();
        let artifact = artifacts
            .get(component["artifact"].as_str().unwrap_or_default())
            .copied();
        if let Some(artifact) = artifact {
            let mut environment = Map::new();
            for parameter in component["parameters"].as_array().into_iter().flatten() {
                let Some(parameter_id) = parameter.as_str() else {
                    continue;
                };
                let Some(parameter) = parameters.get(parameter_id) else {
                    continue;
                };
                let name = parameter_id.replace('-', "_").to_ascii_uppercase();
                if parameter["default"].is_null() {
                    let required = format!("${{{name}:?required}}");
                    environment.insert(name, json!(required));
                } else {
                    environment.insert(name, parameter["default"].clone());
                }
            }
            environment.extend(secret_file_environment(component));
            let mut ports = Vec::new();
            let mut expose = Vec::new();
            for port in component["ports"].as_array().into_iter().flatten() {
                let Some(row) = port.as_str().and_then(|id| topology.get(id)).copied() else {
                    continue;
                };
                let number = row["port"].as_u64().unwrap_or_default();
                let protocol = row["protocol"]
                    .as_str()
                    .unwrap_or("TCP")
                    .to_ascii_lowercase();
                if row["public"] == true {
                    ports
                        .push(json!({"target": number, "published": number, "protocol": protocol}));
                } else {
                    expose.push(json!(number));
                }
            }
            let networks = component["ports"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|id| topology.get(id))
                .filter_map(|row| row["network"].as_str())
                .chain(
                    topology
                        .values()
                        .filter(|row| {
                            row["kind"] == "network"
                                && row["owners"]
                                    .as_array()
                                    .is_some_and(|owners| owners.iter().any(|owner| owner == id))
                        })
                        .filter_map(|row| row["id"].as_str()),
                )
                .collect::<BTreeSet<_>>();
            let volumes = component["volumes"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .filter_map(|volume| {
                    let row = topology.get(volume)?;
                    Some(json!({"type":"volume", "source": volume, "target": row["mount_path"]}))
                })
                .chain(uses_runtime(component).then(|| {
                    json!({"type":"bind", "source":"./release", "target":"/opt/prism/release", "read_only":true})
                }))
                .collect::<Vec<_>>();
            let secrets = component["secrets"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|name| json!({"source": name, "target": name}))
                .collect::<Vec<_>>();
            let cpu_millis = component["resources"]["cpu_millis"]
                .as_u64()
                .unwrap_or_default();
            let depends_on = component["depends_on"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(Value::as_str)
                .map(|dependency| {
                    let condition = if component_kinds.get(dependency) == Some(&"migration") {
                        "service_completed_successfully"
                    } else {
                        "service_healthy"
                    };
                    (
                        dependency.to_owned(),
                        json!({"condition":condition,"required":true}),
                    )
                })
                .collect::<Map<_, _>>();
            let mut service = json!({
                "command": component["command"],
                "cap_drop": policy["cap_drop"],
                "depends_on": depends_on,
                    "deploy": {"replicas": component["resources"]["replicas_min"], "resources": {"limits": {"cpus": format!("{:.3}", cpu_millis as f64 / 1000.0), "memory": format!("{}b", component["resources"]["memory_bytes"].as_u64().unwrap_or_default())}, "reservations": {"cpus": format!("{:.3}", cpu_millis as f64 / 1000.0), "memory": format!("{}b", component["resources"]["memory_bytes"].as_u64().unwrap_or_default())}}},
                "environment": environment,
                "expose": expose,
                "image": format!("{}@{}", artifact["path"].as_str().unwrap_or_default(), artifact["digest"].as_str().unwrap_or_default()),
                "networks": networks,
                "ports": ports,
                "read_only": policy["read_only"],
                "restart": if component["kind"] == "migration" { policy["restart_job"].clone() } else { policy["restart_service"].clone() },
                "secrets": secrets,
                "security_opt": policy["security_opt"],
                "tmpfs": policy["tmpfs_default"],
                "volumes": volumes
            });
            if component["kind"] != "migration" {
                service.as_object_mut().expect("service object").insert(
                    "healthcheck".to_owned(),
                    json!({"interval": policy["healthcheck"]["interval"], "retries": policy["healthcheck"]["retries"], "start_period": policy["healthcheck"]["start_period"], "test": std::iter::once(json!("CMD")).chain(component["readiness"].as_array().into_iter().flatten().cloned()).collect::<Vec<_>>(), "timeout": policy["healthcheck"]["timeout"]}),
                );
            }
            if matches!(component["kind"].as_str(), Some("database" | "broker")) {
                service
                    .as_object_mut()
                    .expect("service object")
                    .insert("cap_add".to_owned(), policy["cap_add_stateful"].clone());
            }
            if component["kind"] == "database" {
                service["tmpfs"] = policy["tmpfs_database"].clone();
            }
            if component["kind"] == "telemetry-collector" {
                service["tmpfs"] = policy["tmpfs_telemetry"].clone();
            }
            services.insert(id.to_owned(), service);
        }
    }
    let networks = topology
        .values()
        .filter(|row| row["kind"] == "network")
        .filter_map(|row| {
            Some((
                row["id"].as_str()?.to_owned(),
                json!({"internal": row["public"] != true}),
            ))
        })
        .collect::<Map<_, _>>();
    let volumes = topology
        .values()
        .filter(|row| row["kind"] == "persistent-volume")
        .filter_map(|row| Some((row["id"].as_str()?.to_owned(), json!({}))))
        .collect::<Map<_, _>>();
    let secrets = system["secret_references"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| {
            Some((
                row["id"].as_str()?.to_owned(),
                json!({"file":format!("${{PRISMPM_SECRET_DIR:?required}}/{}", row["provider_key"].as_str()?)}),
            ))
        })
        .collect::<Map<_, _>>();
    Ok(
        json!({"name": system["product"]["id"], "networks": networks, "secrets": secrets, "services": services, "volumes": volumes}),
    )
}

fn base64(bytes: &[u8]) -> String {
    const ALPHABET: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut output = String::with_capacity(bytes.len().div_ceil(3) * 4);
    for chunk in bytes.chunks(3) {
        let bits = (u32::from(chunk[0]) << 16)
            | (u32::from(*chunk.get(1).unwrap_or(&0)) << 8)
            | u32::from(*chunk.get(2).unwrap_or(&0));
        output.push(ALPHABET[((bits >> 18) & 63) as usize] as char);
        output.push(ALPHABET[((bits >> 12) & 63) as usize] as char);
        output.push(if chunk.len() > 1 {
            ALPHABET[((bits >> 6) & 63) as usize] as char
        } else {
            '='
        });
        output.push(if chunk.len() > 2 {
            ALPHABET[(bits & 63) as usize] as char
        } else {
            '='
        });
    }
    output
}

fn runtime_files(artifacts: &[(String, Vec<u8>)]) -> BTreeMap<String, (String, Vec<u8>)> {
    let mut files = BTreeMap::new();
    for (path, bytes) in artifacts {
        let mapped = if path.starts_with("core-wasm/") && path.ends_with(".wasm") {
            Some(("core.wasm".to_owned(), "core.wasm".to_owned()))
        } else if let Some(name) = path.strip_prefix("view/browser/") {
            Some((format!("browser-{name}"), format!("browser/{name}")))
        } else {
            path.strip_prefix("production-browser/").map(|name| {
                (
                    format!("production-browser-{name}"),
                    format!("production-browser/{name}"),
                )
            })
        };
        if let Some((key, destination)) = mapped {
            files.insert(key, (destination, bytes.clone()));
        }
    }
    files
}

fn kubernetes_target(system: &Value) -> Result<&Value, PrismError> {
    let mut targets = system["targets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|target| target["kind"] == "kubernetes");
    let target = targets
        .next()
        .ok_or_else(|| PrismError::new("PP7101", "Kubernetes projection has no target binding"))?;
    if targets.next().is_some() {
        return Err(PrismError::new(
            "PP7101",
            "Kubernetes projection is ambiguous across multiple target bindings",
        ));
    }
    Ok(target)
}

/// Parse the pinned multi-document ingress manifest into JSON values.
///
/// Empty and null documents are skipped. Duplicate mapping keys are refused
/// by the parser's default policy, so a corrupted manifest cannot silently
/// shadow a field.
fn ingress_nginx_documents() -> Result<Vec<Value>, PrismError> {
    serde_saphyr::from_slice_multiple::<Value>(INGRESS_NGINX_KIND).map_err(|error| {
        PrismError::new(
            "PP7101",
            format!("pinned ingress controller manifest: {error}"),
        )
    })
}

fn ingress_controller_resources(target: &Value) -> Result<Vec<Value>, PrismError> {
    if target["ingress_class_name"].is_null() {
        return Ok(Vec::new());
    }
    let mut resources = ingress_nginx_documents()?;
    // The pinned ingress manifest spells the empty ConfigMap as `data: null`.
    // Emit an empty map, as required by the authoritative core/v1 schema;
    // preserve the imported source and every configured value unchanged.
    for resource in &mut resources {
        if resource["apiVersion"] == "v1"
            && resource["kind"] == "ConfigMap"
            && resource.get("data") == Some(&Value::Null)
        {
            resource["data"] = json!({});
        }
    }
    if resources.is_empty()
        || !resources.iter().any(|resource| {
            resource["kind"] == "IngressClass"
                && resource["metadata"]["name"] == target["ingress_class_name"]
        })
        || resources.iter().any(|resource| {
            resource
                .pointer("/spec/template/spec/containers")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|container| container["image"].as_str())
                .any(|image| !image.contains("@sha256:"))
        })
    {
        return Err(PrismError::new(
            "PP7101",
            "pinned ingress controller resources do not satisfy the modeled binding",
        ));
    }
    Ok(resources)
}

fn kubernetes(system: &Value, build_artifacts: &[(String, Vec<u8>)]) -> Result<Value, PrismError> {
    let policy = crate::deployment::projection_policy("kubernetes")?;
    let target = kubernetes_target(system)?;
    let namespace = system["product"]["id"].as_str().unwrap_or("prismpm-system");
    let service_account = namespace;
    let bindings = format!("{namespace}-bindings");
    let artifacts = system["artifacts"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let topology = system["topology"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let parameters = system["parameters"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|row| Some((row["id"].as_str()?, row)))
        .collect::<BTreeMap<_, _>>();
    let mut items = Vec::new();
    items.push(json!({"apiVersion":"v1", "kind":"Namespace", "metadata":{"name":namespace}}));
    items.push(json!({"apiVersion":"v1", "kind":"ServiceAccount", "metadata":{"name":service_account, "namespace":namespace}, "automountServiceAccountToken":policy["automount_service_account_token"]}));
    items.push(json!({"apiVersion":"rbac.authorization.k8s.io/v1", "kind":"Role", "metadata":{"name":service_account, "namespace":namespace}, "rules":policy["rbac_rules"]}));
    items.push(json!({"apiVersion":"rbac.authorization.k8s.io/v1", "kind":"RoleBinding", "metadata":{"name":service_account, "namespace":namespace}, "roleRef":{"apiGroup":"rbac.authorization.k8s.io","kind":"Role","name":service_account}, "subjects":[{"kind":"ServiceAccount","name":service_account,"namespace":namespace}]}));
    let mut release_files = runtime_files(build_artifacts);
    release_files.insert(
        "runtime-contract.json".to_owned(),
        (
            "runtime-contract.json".to_owned(),
            encode_value(&runtime_profile(system)).expect("validated application profile"),
        ),
    );
    release_files.insert(
        "history.sql".to_owned(),
        ("history.sql".to_owned(), history_sql(system)?.into_bytes()),
    );
    if let Some(sql) = contract_sql(system)? {
        release_files.insert(
            "contract.sql".to_owned(),
            ("contract.sql".to_owned(), sql.into_bytes()),
        );
    }
    release_files.insert(
        "opentelemetry-collector.json".to_owned(),
        (
            "opentelemetry-collector.json".to_owned(),
            encode_value(&opentelemetry(system)).expect("validated telemetry model"),
        ),
    );
    let binary_data = release_files
        .values()
        .map(|(path, bytes)| (path.replace('/', "-"), json!(base64(bytes))))
        .collect::<Map<_, _>>();
    let items_mapping = release_files
        .values()
        .map(|(path, _)| json!({"key":path.replace('/', "-"),"path":path}))
        .collect::<Vec<_>>();
    items.push(json!({"apiVersion":"v1","binaryData":binary_data,"immutable":policy["config_map_immutable"],"kind":"ConfigMap","metadata":{"name":"prism-release","namespace":namespace}}));
    let storage_class = target["storage_class"].as_str().and_then(|id| {
        system["storage_classes"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["id"] == id)
    });
    if let Some(storage_class) = storage_class {
        items.push(json!({
            "allowVolumeExpansion":false,
            "apiVersion":"storage.k8s.io/v1",
            "kind":"StorageClass",
            "metadata":{"name":storage_class["id"]},
            "provisioner":"kubernetes.io/no-provisioner",
            "reclaimPolicy": if storage_class["retention"] == "retain" { "Retain" } else { "Delete" },
            "volumeBindingMode":storage_class["binding_mode"]
        }));
    }
    for row in topology
        .values()
        .filter(|row| row["kind"] == "persistent-volume")
    {
        let bytes = row["storage_bytes"].as_u64().unwrap_or_default();
        let mebibytes = bytes.div_ceil(1024 * 1024);
        let class = storage_class.ok_or_else(|| {
            PrismError::new("PP7101", "persistent volume has no modeled storage class")
        })?;
        let volume_name = format!("{namespace}-{}", row["id"].as_str().unwrap_or_default());
        items.push(json!({
            "apiVersion":"v1",
            "kind":"PersistentVolume",
            "metadata":{"name":volume_name},
            "spec":{
                "accessModes":class["access_modes"],
                "capacity":{"storage":format!("{mebibytes}Mi")},
                "claimRef":{"name":row["id"],"namespace":namespace},
                "hostPath":{"path":format!("/var/local/prismpm/{namespace}/{}",row["id"].as_str().unwrap_or_default()),"type":"DirectoryOrCreate"},
                "persistentVolumeReclaimPolicy":policy["storage_reclaim_policy"],
                "storageClassName":class["id"],
                "volumeMode":"Filesystem"
            }
        }));
        items.push(json!({"apiVersion":"v1", "kind":"PersistentVolumeClaim", "metadata":{"name":row["id"],"namespace":namespace}, "spec":{"accessModes":class["access_modes"],"resources":{"requests":{"storage":format!("{mebibytes}Mi")}},"storageClassName":class["id"],"volumeMode":"Filesystem","volumeName":volume_name}}));
    }
    for component in system["components"].as_array().into_iter().flatten() {
        let name = component["id"].as_str().unwrap_or_default();
        let artifact = artifacts
            .get(component["artifact"].as_str().unwrap_or_default())
            .copied();
        let Some(artifact) = artifact else { continue };
        let image = format!(
            "{}@{}",
            artifact["path"].as_str().unwrap_or_default(),
            artifact["digest"].as_str().unwrap_or_default()
        );
        let ports = component["ports"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|id| topology.get(id).map(|row| (id, *row)))
            .map(|(id, row)| json!({"containerPort":row["port"], "name":id, "protocol":row["protocol"]}))
            .collect::<Vec<_>>();
        let env = component["parameters"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|id| parameters.get(id).map(|row| (id, *row)))
            .map(|(id, row)| {
                let name = id.replace('-', "_").to_ascii_uppercase();
                if row["default"].is_null() {
                    json!({"name":name,"valueFrom":{"configMapKeyRef":{"key":id,"name":bindings}}})
                } else {
                    json!({"name":name,"value":row["default"]})
                }
            })
            .chain(component["secrets"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|id| !(component["kind"] == "browser" && id.contains("tls"))).map(|id| json!({"name":format!("{}_FILE",id.replace('-', "_").to_ascii_uppercase()),"value":format!("/run/secrets/{id}")})))
            .collect::<Vec<_>>();
        let mut volume_mounts = component["volumes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .filter_map(|id| topology.get(id).map(|row| (id, *row)))
            .map(|(id, row)| json!({"mountPath":row["mount_path"],"name":id}))
            .chain(uses_runtime(component).then(|| json!({"mountPath":"/opt/prism/release","name":"prism-release","readOnly":true})))
            .chain(component["secrets"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|id| !(component["kind"] == "browser" && id.contains("tls"))).map(|id| json!({"mountPath":format!("/run/secrets/{id}"),"name":format!("secret-{id}"),"readOnly":true,"subPath":"value"})))
            .collect::<Vec<_>>();
        let mut volumes = component["volumes"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(|id| json!({"name":id,"persistentVolumeClaim":{"claimName":id}}))
            .chain(uses_runtime(component).then(|| json!({"configMap":{"items":items_mapping,"name":"prism-release"},"name":"prism-release"})))
            .chain(component["secrets"].as_array().into_iter().flatten().filter_map(Value::as_str).filter(|id| !(component["kind"] == "browser" && id.contains("tls"))).map(|id| json!({"name":format!("secret-{id}"),"secret":{"secretName":id}})))
            .collect::<Vec<_>>();
        let tmpfs_mib = policy["tmpfs_bytes"]
            .as_u64()
            .unwrap_or_default()
            .div_ceil(1024 * 1024);
        volumes.push(json!({"emptyDir":{"medium":"Memory","sizeLimit":format!("{tmpfs_mib}Mi")},"name":"tmp"}));
        volume_mounts.push(json!({"mountPath":"/tmp","name":"tmp"}));
        if component["kind"] == "database" {
            let run_mib = policy["postgres_run_bytes"]
                .as_u64()
                .unwrap_or_default()
                .div_ceil(1024 * 1024);
            volumes.push(json!({"emptyDir":{"medium":"Memory","sizeLimit":format!("{run_mib}Mi")},"name":"postgres-run"}));
            volume_mounts.push(json!({"mountPath":"/var/run/postgresql","name":"postgres-run"}));
        }
        if component["kind"] == "telemetry-collector" {
            let evidence_mib = policy["telemetry_evidence_bytes"]
                .as_u64()
                .unwrap_or_default()
                .div_ceil(1024 * 1024);
            volumes.push(json!({"emptyDir":{"sizeLimit":format!("{evidence_mib}Mi")},"name":"telemetry-evidence"}));
            volume_mounts.push(
                json!({"mountPath":"/var/lib/prismpm-telemetry","name":"telemetry-evidence"}),
            );
        }
        let run_as_user = component["kind"]
            .as_str()
            .and_then(|kind| policy["run_as"][kind].as_u64())
            .or_else(|| policy["run_as"]["default"].as_u64())
            .ok_or_else(|| PrismError::new("PP7101", "adapter run-as policy is absent"))?;
        let mut container = json!({
            "command": component["command"],
            "env": env,
            "image": image,
            "imagePullPolicy": policy["image_pull_policy"],
            "name": name,
            "ports": ports.clone(),
            "resources": {"limits":{"cpu":format!("{}m", component["resources"]["cpu_millis"].as_u64().unwrap_or_default()),"memory":format!("{}", component["resources"]["memory_bytes"].as_u64().unwrap_or_default())},"requests":{"cpu":format!("{}m", component["resources"]["cpu_millis"].as_u64().unwrap_or_default()),"memory":format!("{}", component["resources"]["memory_bytes"].as_u64().unwrap_or_default())}},
            "securityContext": {"allowPrivilegeEscalation":false,"capabilities":{"drop":["ALL"]},"readOnlyRootFilesystem":policy["read_only_root_filesystem"],"runAsGroup":run_as_user,"runAsNonRoot":true,"runAsUser":run_as_user,"seccompProfile":{"type":policy["seccomp_profile"]}},
            "volumeMounts": volume_mounts
        });
        let kind = if component["kind"] == "migration" {
            "Job"
        } else if component["kind"] == "database" {
            "StatefulSet"
        } else {
            "Deployment"
        };
        if kind != "Job" {
            let object = container.as_object_mut().expect("container object");
            object.insert("livenessProbe".to_owned(), json!({"exec":{"command":component["liveness"]},"failureThreshold":policy["probe"]["liveness_failure_threshold"],"periodSeconds":policy["probe"]["liveness_period_seconds"],"timeoutSeconds":policy["probe"]["liveness_timeout_seconds"]}));
            object.insert("readinessProbe".to_owned(), json!({"exec":{"command":component["readiness"]},"failureThreshold":policy["probe"]["readiness_failure_threshold"],"periodSeconds":policy["probe"]["readiness_period_seconds"],"timeoutSeconds":policy["probe"]["readiness_timeout_seconds"]}));
            object.insert("startupProbe".to_owned(), json!({"exec":{"command":component["startup"]},"failureThreshold":policy["probe"]["startup_failure_threshold"],"periodSeconds":policy["probe"]["startup_period_seconds"],"timeoutSeconds":policy["probe"]["startup_timeout_seconds"]}));
        }
        let initializers = component["volumes"].as_array().into_iter().flatten().filter_map(Value::as_str).map(|id| json!({
            "command":["chown","-R",format!("{run_as_user}:{run_as_user}"),"/volume"],
            "image":image,
            "imagePullPolicy":policy["image_pull_policy"],
            "name":format!("initialize-{id}"),
            "resources":{"limits":{"cpu":format!("{}m",policy["volume_initializer_resources"]["cpu_millis"].as_u64().unwrap_or_default()),"memory":format!("{}",policy["volume_initializer_resources"]["memory_bytes"].as_u64().unwrap_or_default())},"requests":{"cpu":format!("{}m",policy["volume_initializer_resources"]["cpu_millis"].as_u64().unwrap_or_default()),"memory":format!("{}",policy["volume_initializer_resources"]["memory_bytes"].as_u64().unwrap_or_default())}},
            "securityContext":{"allowPrivilegeEscalation":false,"capabilities":{"add":["CHOWN"],"drop":["ALL"]},"readOnlyRootFilesystem":true,"runAsNonRoot":false,"runAsUser":0,"seccompProfile":{"type":policy["seccomp_profile"]}},
            "volumeMounts":[{"mountPath":"/volume","name":id}]
        })).collect::<Vec<_>>();
        let mut pod = json!({"metadata":{"labels":{"app.kubernetes.io/name":name,"app.kubernetes.io/part-of":namespace}},"spec":{"automountServiceAccountToken":policy["automount_service_account_token"],"containers":[container],"initContainers":initializers,"securityContext":{"fsGroup":run_as_user,"runAsNonRoot":true,"seccompProfile":{"type":policy["seccomp_profile"]}},"serviceAccountName":service_account,"volumes":volumes}});
        if kind == "Job" {
            pod["spec"]["restartPolicy"] = json!("Never");
        }
        let workload = if kind == "Job" {
            json!({"apiVersion":"batch/v1","kind":kind,"metadata":{"name":name,"namespace":namespace},"spec":{"backoffLimit":policy["job_backoff_limit"],"template":pod}})
        } else if kind == "StatefulSet" {
            json!({"apiVersion":"apps/v1","kind":kind,"metadata":{"name":name,"namespace":namespace},"spec":{"replicas":component["resources"]["replicas_min"],"selector":{"matchLabels":{"app.kubernetes.io/name":name}},"serviceName":name,"template":pod,"updateStrategy":{"type":policy["stateful_update_strategy"]}}})
        } else {
            json!({"apiVersion":"apps/v1","kind":kind,"metadata":{"name":name,"namespace":namespace},"spec":{"replicas":component["resources"]["replicas_min"],"selector":{"matchLabels":{"app.kubernetes.io/name":name}},"strategy":{"type":policy["stateless_update_strategy"]},"template":pod}})
        };
        items.push(workload);
        if !ports.is_empty() {
            items.push(json!({"apiVersion":"v1","kind":"Service","metadata":{"name":name,"namespace":namespace},"spec":{"ports":ports.iter().map(|port| json!({"name":port["name"],"port":port["containerPort"],"protocol":port["protocol"],"targetPort":port["name"]})).collect::<Vec<_>>(),"selector":{"app.kubernetes.io/name":name},"type":policy["service_type"]}}));
        }
        if kind != "Job"
            && component["resources"]["replicas_min"]
                .as_u64()
                .unwrap_or_default()
                > 1
        {
            items.push(json!({"apiVersion":"policy/v1","kind":"PodDisruptionBudget","metadata":{"name":name,"namespace":namespace},"spec":{"maxUnavailable":policy["pod_disruption_max_unavailable"],"selector":{"matchLabels":{"app.kubernetes.io/name":name}}}}));
        }
    }
    items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"default-deny","namespace":namespace},"spec":{"podSelector":{},"policyTypes":["Ingress","Egress"]}}));
    items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":"allow-dns","namespace":namespace},"spec":{"egress":[{"ports":[{"port":53,"protocol":"UDP"},{"port":53,"protocol":"TCP"}],"to":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":"kube-system"}}}]}],"podSelector":{},"policyTypes":["Egress"]}}));
    for destination in system["components"].as_array().into_iter().flatten() {
        let destination_id = destination["id"].as_str().unwrap_or_default();
        let sources = system["components"]
            .as_array()
            .into_iter()
            .flatten()
            .filter(|source| {
                source["depends_on"].as_array().is_some_and(|dependencies| {
                    dependencies
                        .iter()
                        .any(|dependency| dependency == destination_id)
                })
            })
            .filter_map(|source| source["id"].as_str())
            .collect::<BTreeSet<_>>();
        if !sources.is_empty() {
            let from = sources.into_iter().map(|source| json!({"podSelector":{"matchLabels":{"app.kubernetes.io/name":source}}})).collect::<Vec<_>>();
            items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":format!("dependency-{destination_id}"),"namespace":namespace},"spec":{"podSelector":{"matchLabels":{"app.kubernetes.io/name":destination_id}},"ingress":[{"from":from}],"policyTypes":["Ingress"]}}));
        }
    }
    for source in system["components"].as_array().into_iter().flatten() {
        let source_id = source["id"].as_str().unwrap_or_default();
        let destinations = source["depends_on"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .collect::<Vec<_>>();
        if !destinations.is_empty() {
            let to = destinations.into_iter().map(|destination| json!({"podSelector":{"matchLabels":{"app.kubernetes.io/name":destination}}})).collect::<Vec<_>>();
            items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":format!("egress-{source_id}"),"namespace":namespace},"spec":{"egress":[{"to":to}],"podSelector":{"matchLabels":{"app.kubernetes.io/name":source_id}},"policyTypes":["Egress"]}}));
        }
    }
    for flow in system["flows"].as_array().into_iter().flatten() {
        items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"NetworkPolicy","metadata":{"name":flow["id"],"namespace":namespace},"spec":{"podSelector":{"matchLabels":{"app.kubernetes.io/name":flow["to"]}},"ingress":[{"from":[{"podSelector":{"matchLabels":{"app.kubernetes.io/name":flow["from"]}}}]}],"policyTypes":["Ingress"]}}));
    }
    let browser = system["components"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|component| component["kind"] == "browser")
        .and_then(|component| component["id"].as_str());
    let api = system["components"]
        .as_array()
        .into_iter()
        .flatten()
        .find(|component| component["kind"] == "api")
        .and_then(|component| component["id"].as_str());
    let browser_port = topology.values().find(|row| {
        row["kind"] == "port"
            && row["public"] == true
            && row["owners"]
                .as_array()
                .is_some_and(|owners| owners.iter().any(|owner| owner.as_str() == browser))
    });
    let api_port = topology.values().find(|row| {
        row["kind"] == "port"
            && row["owners"]
                .as_array()
                .is_some_and(|owners| owners.iter().any(|owner| owner.as_str() == api))
    });
    let hostname = parameters
        .values()
        .find(|parameter| {
            parameter["id"] == system["application_profile"]["public_hostname_parameter"]
        })
        .and_then(|parameter| parameter["default"].as_str());
    let tls_secret = browser.and_then(|browser| {
        system["components"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|component| component["id"] == browser)
            .and_then(|component| component["secrets"].as_array())
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .find(|secret| secret.contains("tls"))
    });
    if let (
        Some(browser),
        Some(api),
        Some(browser_port),
        Some(api_port),
        Some(hostname),
        Some(tls_secret),
    ) = (browser, api, browser_port, api_port, hostname, tls_secret)
    {
        items.push(json!({"apiVersion":"networking.k8s.io/v1","kind":"Ingress","metadata":{"annotations":{"nginx.ingress.kubernetes.io/ssl-redirect":policy["ingress_ssl_redirect"]},"name":namespace,"namespace":namespace},"spec":{"ingressClassName":target["ingress_class_name"],"rules":[{"host":hostname,"http":{"paths":[{"backend":{"service":{"name":api,"port":{"number":api_port["port"]}}},"path":system["application_profile"]["command_path"],"pathType":"Prefix"},{"backend":{"service":{"name":browser,"port":{"number":browser_port["port"]}}},"path":"/","pathType":"Prefix"}]}}],"tls":[{"hosts":[hostname],"secretName":tls_secret}]}}));
        items.push(json!({
            "apiVersion":"networking.k8s.io/v1",
            "kind":"NetworkPolicy",
            "metadata":{"name":"ingress-controller-backends","namespace":namespace},
            "spec":{
                "ingress":[{"from":[{"namespaceSelector":{"matchLabels":{"kubernetes.io/metadata.name":policy["ingress_namespace"]}},"podSelector":{"matchLabels":{"app.kubernetes.io/component":"controller","app.kubernetes.io/instance":"ingress-nginx","app.kubernetes.io/name":"ingress-nginx"}}}],"ports":[{"port":api_port["port"],"protocol":api_port["protocol"]},{"port":browser_port["port"],"protocol":browser_port["protocol"]}]}],
                "podSelector":{"matchExpressions":[{"key":"app.kubernetes.io/name","operator":"In","values":[api,browser]}]},
                "policyTypes":["Ingress"]
            }
        }));
    }
    items.sort_by(|left, right| {
        (left["kind"].as_str(), left["metadata"]["name"].as_str())
            .cmp(&(right["kind"].as_str(), right["metadata"]["name"].as_str()))
    });
    let mut resources = ingress_controller_resources(target)?;
    resources.extend(items);
    Ok(json!({"apiVersion": "v1", "items": resources, "kind": "List"}))
}

fn history_sql(system: &Value) -> Result<String, PrismError> {
    let contract = &system["application_profile"];
    let name = |field: &str| {
        contract[field]
            .as_str()
            .filter(|value| canonical_sql_identifier(value))
            .ok_or_else(|| {
                PrismError::new("PP2101", format!("runtime SQL name {field} is invalid"))
            })
    };
    let history = name("history_table")?;
    let outbox = name("outbox_table")?;
    let audit = name("audit_table")?;
    let command_id = name("command_id_column")?;
    let operation = name("operation_column")?;
    let input_a = name("input_a_column")?;
    let input_b = name("input_b_column")?;
    let annotation = name("annotation_column")?;
    let label = if contract["optional_annotation"] == "optional" {
        format!(", {annotation} TEXT NULL")
    } else {
        String::new()
    };
    let expand = if contract["optional_annotation"] == "optional" {
        format!("ALTER TABLE {history} ADD COLUMN IF NOT EXISTS {annotation} TEXT NULL;\n")
    } else {
        String::new()
    };
    Ok(format!(
        "CREATE TABLE IF NOT EXISTS prismpm_sequence_allocator (allocator_key TEXT PRIMARY KEY, next_value NUMERIC(20,0) NOT NULL CHECK (next_value BETWEEN 0 AND 18446744073709551616));\n\
CREATE OR REPLACE FUNCTION prismpm_allocate_u64_sequence(sequence_key TEXT) RETURNS NUMERIC LANGUAGE plpgsql VOLATILE AS $prismpm$\n\
DECLARE allocated NUMERIC(20,0);\n\
BEGIN\n\
  UPDATE prismpm_sequence_allocator SET next_value = next_value + 1 WHERE allocator_key = sequence_key AND next_value <= 18446744073709551615 RETURNING next_value - 1 INTO allocated;\n\
  IF allocated IS NULL THEN RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'PrismPM u64 sequence exhausted'; END IF;\n\
  RETURN allocated;\n\
END;\n\
$prismpm$;\n\
DO $prismpm$ DECLARE constraint_name TEXT; BEGIN\n\
  IF to_regclass('{outbox}') IS NOT NULL THEN\n\
    FOR constraint_name IN SELECT c.conname FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY(c.conkey) WHERE c.conrelid = '{outbox}'::regclass AND c.contype = 'f' AND a.attname = 'sequence' LOOP\n\
      EXECUTE format('ALTER TABLE {outbox} DROP CONSTRAINT %I', constraint_name);\n\
    END LOOP;\n\
  END IF;\n\
END $prismpm$;\n\
CREATE TABLE IF NOT EXISTS {history} (sequence NUMERIC(20,0) PRIMARY KEY DEFAULT prismpm_allocate_u64_sequence('{history}'), subject TEXT NOT NULL, {command_id} TEXT NOT NULL UNIQUE, {operation} TEXT NOT NULL, {input_a} TEXT NOT NULL, {input_b} TEXT NOT NULL{label}, canonical_input TEXT NOT NULL, outcome TEXT NOT NULL CHECK (outcome IN ('succeeded','rejected')), result_value TEXT NULL, error_code TEXT NULL);\n\
ALTER TABLE {history} ALTER COLUMN sequence DROP DEFAULT;\n\
ALTER TABLE {history} ALTER COLUMN sequence TYPE NUMERIC(20,0) USING sequence::NUMERIC(20,0);\n\
INSERT INTO prismpm_sequence_allocator(allocator_key,next_value) SELECT '{history}',COALESCE(MAX(sequence),0)+1 FROM {history} ON CONFLICT (allocator_key) DO UPDATE SET next_value = GREATEST(prismpm_sequence_allocator.next_value,EXCLUDED.next_value);\n\
ALTER TABLE {history} ALTER COLUMN sequence SET DEFAULT prismpm_allocate_u64_sequence('{history}');\n\
DO $prismpm$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prismpm_history_sequence_u64' AND conrelid = '{history}'::regclass) THEN ALTER TABLE {history} ADD CONSTRAINT prismpm_history_sequence_u64 CHECK (sequence BETWEEN 0 AND 18446744073709551615); END IF; END $prismpm$;\n\
{expand}CREATE INDEX IF NOT EXISTS {history}_subject_sequence ON {history}(subject, sequence);\n\
CREATE TABLE IF NOT EXISTS {outbox} (sequence NUMERIC(20,0) PRIMARY KEY REFERENCES {history}(sequence), event_id TEXT NOT NULL UNIQUE, event JSONB NOT NULL, published BOOLEAN NOT NULL DEFAULT FALSE, committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(), published_at TIMESTAMPTZ NULL);\n\
ALTER TABLE {outbox} ALTER COLUMN sequence TYPE NUMERIC(20,0) USING sequence::NUMERIC(20,0);\n\
DO $prismpm$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prismpm_outbox_sequence_u64' AND conrelid = '{outbox}'::regclass) THEN ALTER TABLE {outbox} ADD CONSTRAINT prismpm_outbox_sequence_u64 CHECK (sequence BETWEEN 0 AND 18446744073709551615); END IF; IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'prismpm_outbox_history_sequence' AND conrelid = '{outbox}'::regclass) THEN ALTER TABLE {outbox} ADD CONSTRAINT prismpm_outbox_history_sequence FOREIGN KEY (sequence) REFERENCES {history}(sequence); END IF; END $prismpm$;\n\
ALTER TABLE {outbox} ADD COLUMN IF NOT EXISTS committed_at TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp();\n\
ALTER TABLE {outbox} ADD COLUMN IF NOT EXISTS published_at TIMESTAMPTZ NULL;\n\
CREATE TABLE IF NOT EXISTS {audit} (event_id TEXT PRIMARY KEY, event JSONB NOT NULL);\n"
    ))
}

fn contract_sql(system: &Value) -> Result<Option<String>, PrismError> {
    let migrations = system["migrations"]
        .as_array()
        .expect("system schema validates migrations");
    let mut statements = Vec::new();
    let mut seen = BTreeSet::new();
    for id in system["persistence"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|row| row["migration_order"].as_array().into_iter().flatten())
        .filter_map(Value::as_str)
    {
        let row = migrations
            .iter()
            .find(|row| row["id"].as_str() == Some(id))
            .expect("migration references were validated");
        if row["kind"] == "contract" && seen.insert(id) {
            statements.push(
                row["value"]
                    .as_str()
                    .map(str::to_owned)
                    .ok_or_else(|| PrismError::new("PP2101", "contract migration SQL is absent"))?,
            );
        }
    }
    if statements.is_empty() {
        return Ok(None);
    }
    Ok(Some(format!("{}\n", statements.join("\n"))))
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}

fn production_browser(system: &Value) -> Result<Vec<Projection>, PrismError> {
    let contract = encode_value(&system["application_profile"])?;
    let contract = String::from_utf8(contract)
        .map_err(|_| PrismError::new("PP2101", "application profile is not UTF-8"))?;
    let view = &system["application_profile"]["view"];
    let text = |name: &str| {
        view[name]
            .as_str()
            .map(html_escape)
            .ok_or_else(|| PrismError::new("PP2101", format!("runtime View omits {name}")))
    };
    let user_role = html_escape(
        system["application_profile"]["submitter_role"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP2101", "application submitter role is absent"))?,
    );
    let auditor_role = html_escape(
        system["application_profile"]["observer_role"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP2101", "application observer role is absent"))?,
    );
    let pattern = html_escape(
        system["application_profile"]["command_id_pattern"]
            .as_str()
            .ok_or_else(|| PrismError::new("PP2101", "request ID pattern is absent"))?
            .trim_start_matches('^')
            .trim_end_matches('$'),
    );
    let html = format!(
        r#"<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>{title}</title><link rel="stylesheet" href="app.css"></head><body><main><header><h1>{heading}</h1><p id="release"></p></header><section id="identity"><h2>{identity_heading}</h2><form id="login"><label>{subject_label}<input id="subject" required value="{subject_default}"></label><label>{role_label}<select id="role"><option value="{user_role}">{user_role_label}</option><option value="{auditor_role}">{auditor_role_label}</option><option value="">{denied_role_label}</option></select></label><button>{authenticate_label}</button></form></section><section id="command" hidden><h2>{command_heading}</h2><form id="submit-command"><label>{command_id_label}<input id="command-id" required pattern="{pattern}"></label><label>{input_a_label}<input id="input-a" required inputmode="numeric"></label><label>{operation_label}<select id="operation"></select></label><label>{input_b_label}<input id="input-b" required inputmode="numeric"></label><label id="annotation-field" hidden>{annotation_label}<input id="annotation" maxlength="{annotation_max}"></label><button>{submit_label}</button></form></section><section id="history" hidden><h2>{history_heading}</h2><button id="refresh" type="button">{refresh_label}</button><p id="empty" hidden>{empty_text}</p><table><thead><tr><th>{sequence_heading}</th><th>{command_heading_column}</th><th>{input_summary_heading}</th><th>{outcome_heading}</th><th>{annotation_heading}</th></tr></thead><tbody id="records"></tbody></table></section><p id="status" role="status" aria-live="polite"></p><button id="retry" type="button" hidden>{retry_label}</button></main><script type="module" src="app.js"></script></body></html>"#,
        title = text("title")?,
        heading = text("heading")?,
        identity_heading = text("identity_heading")?,
        subject_label = text("principal_label")?,
        subject_default = text("principal_default")?,
        role_label = text("role_label")?,
        user_role_label = text("submitter_role_label")?,
        auditor_role_label = text("observer_role_label")?,
        denied_role_label = text("denied_role_label")?,
        authenticate_label = text("authenticate_label")?,
        command_heading = text("command_form_heading")?,
        command_id_label = text("command_id_label")?,
        input_a_label = text("input_a_label")?,
        operation_label = text("operation_label")?,
        input_b_label = text("input_b_label")?,
        annotation_label = text("annotation_label")?,
        submit_label = text("submit_label")?,
        history_heading = text("history_heading")?,
        refresh_label = text("refresh_label")?,
        empty_text = text("empty_text")?,
        sequence_heading = text("sequence_heading")?,
        command_heading_column = text("command_column_heading")?,
        input_summary_heading = text("input_summary_heading")?,
        outcome_heading = text("outcome_heading")?,
        annotation_heading = text("annotation_heading")?,
        retry_label = text("retry_label")?,
        annotation_max = system["application_profile"]["annotation_max_scalars"],
    );
    let css = r#"*{box-sizing:border-box}body{margin:0;background:#f6f7fb;color:#172033;font-family:ui-sans-serif,system-ui,sans-serif}main{width:min(72rem,calc(100% - 2rem));margin:2rem auto;padding:2rem;border:1px solid #c9d1df;border-radius:.75rem;background:#fff;box-shadow:0 .5rem 2rem #17203318}header{display:flex;align-items:baseline;justify-content:space-between;gap:1rem}form{display:grid;grid-template-columns:repeat(auto-fit,minmax(12rem,1fr));gap:.75rem;align-items:end}.field,label{display:grid;gap:.35rem;min-width:0}label{font-weight:600}input,select,button{width:100%;min-height:2.75rem;border:1px solid #77839a;border-radius:.4rem;padding:.55rem;font:inherit}button{background:#234fdb;color:#fff;border-color:#234fdb;font-weight:700;cursor:pointer}input:focus,select:focus,button:focus{outline:3px solid #9bb4ff;outline-offset:2px}section{margin-top:2rem}table{width:100%;margin-top:1rem;border-collapse:collapse}th,td{padding:.6rem;border-bottom:1px solid #d8deea;text-align:left}#status{min-height:2rem;margin-top:1.25rem;font-weight:700}@media(max-width:40rem){main{padding:1rem;overflow-x:auto}header{display:block}}"#;
    let path = serde_json::to_string(&system["application_profile"]["command_path"])
        .map_err(|error| PrismError::new("PP2101", error.to_string()))?;
    let default_limit = &system["application_profile"]["history_default_limit"];
    let client = format!(
        r#"const base={path};async function request(token,path,options={{}},accepted=[]){{const response=await fetch(path,{{...options,headers:{{authorization:`Bearer ${{token}}`,...(options.body?{{"content-type":"application/json"}}:{{}}),...options.headers}}}});const value=await response.json();if(!response.ok&&!accepted.includes(response.status)){{const error=new Error(value.error?.code||`HTTP ${{response.status}}`);error.status=response.status;throw error}}return value}}export function createClient(token){{return{{submit:(value)=>request(token,base,{{body:JSON.stringify(value),method:"POST"}},[422]),get:(commandId)=>request(token,`${{base}}/${{encodeURIComponent(commandId)}}`),list:(after="0",limit={default_limit})=>request(token,`${{base}}?after=${{encodeURIComponent(after)}}&limit=${{encodeURIComponent(String(limit))}}`)}}}}"#
    );
    let js = format!(
        r#"import{{createClient}}from"./openapi-client.js";const contract={contract};
let client=null;let retry=()=>{{}};
const byId=(id)=>document.getElementById(id);const status=(text)=>{{byId("status").textContent=text}};
byId("release").textContent=`${{contract.view.release_prefix}} ${{contract.release}}`;
for(const operation of contract.command_operations){{const option=document.createElement("option");option.value=operation;option.textContent=operation;byId("operation").append(option)}}
byId("annotation-field").hidden=contract.optional_annotation!=="optional";
function outcome(row){{return row.outcome.kind==="succeeded"?row.outcome.result:row.outcome.error}}
function clearIdentityData(){{client=null;byId("command").hidden=true;byId("history").hidden=true;byId("records").replaceChildren();byId("empty").hidden=true;byId("retry").hidden=true}}
async function refresh(){{const body=byId("records");body.replaceChildren();byId("empty").hidden=true;byId("retry").hidden=true;status(contract.view.loading_text);try{{const value=await client.list("0",contract.history_max_limit);for(const row of value.records){{const tr=document.createElement("tr");for(const value of [row.sequence,row[contract.command_id_field],`${{row[contract.input_a_field]}} ${{row[contract.operation_field]}} ${{row[contract.input_b_field]}}`,outcome(row),row[contract.annotation_field]??""]){{const td=document.createElement("td");td.textContent=value;tr.append(td)}}body.append(tr)}}byId("empty").hidden=value.records.length!==0;status(value.records.length?contract.view.history_loaded_text:contract.view.history_empty_text)}}catch(error){{body.replaceChildren();byId("empty").hidden=true;status(error.status===403?contract.view.access_denied_text:`${{contract.view.history_failed_text}} ${{error.message}}`);retry=refresh;byId("retry").hidden=false}}}}
byId("login").addEventListener("submit",async(event)=>{{event.preventDefault();clearIdentityData();status(contract.view.authenticating_text);try{{const selectedRole=byId("role").value;const response=await fetch(contract.token_path,{{body:JSON.stringify({{roles:selectedRole?[selectedRole]:[],sub:byId("subject").value}}),headers:{{"content-type":"application/json"}},method:"POST"}});const value=await response.json();if(!response.ok)throw new Error(value.error?.code||contract.view.authentication_failed_text);client=createClient(value.access_token);byId("command").hidden=selectedRole!==contract.submitter_role;byId("history").hidden=false;status(contract.view.authenticated_text);await refresh()}}catch(error){{clearIdentityData();status(error.message);retry=()=>byId("login").requestSubmit();byId("retry").hidden=false}}}});
byId("submit-command").addEventListener("submit",async(event)=>{{event.preventDefault();byId("retry").hidden=true;const value={{[contract.input_a_field]:byId("input-a").value,[contract.operation_field]:byId("operation").value,[contract.command_id_field]:byId("command-id").value,[contract.input_b_field]:byId("input-b").value}};if(contract.optional_annotation==="optional"&&byId("annotation").value)value[contract.annotation_field]=byId("annotation").value.normalize("NFC");status(contract.view.submitting_text);try{{const row=await client.submit(value);status(`${{contract.view.outcome_prefix}} ${{outcome(row)}}`);await refresh()}}catch(error){{status(`${{contract.view.command_failed_text}} ${{error.message}}`);retry=()=>byId("submit-command").requestSubmit();byId("retry").hidden=false}}}});
byId("refresh").addEventListener("click",()=>void refresh());byId("retry").addEventListener("click",()=>{{byId("retry").hidden=true;void retry()}});
"#
    );
    Ok(vec![
        Projection {
            path: "production-browser/app.css".to_owned(),
            media_type: "text/css".to_owned(),
            bytes: css.as_bytes().to_vec(),
        },
        Projection {
            path: "production-browser/app.js".to_owned(),
            media_type: "text/javascript".to_owned(),
            bytes: js.into_bytes(),
        },
        Projection {
            path: "production-browser/index.html".to_owned(),
            media_type: "text/html".to_owned(),
            bytes: html.into_bytes(),
        },
        Projection {
            path: "production-browser/openapi-client.js".to_owned(),
            media_type: "text/javascript".to_owned(),
            bytes: client.into_bytes(),
        },
    ])
}

/// Generate deterministic standard-native projection inputs without adding behavior.
pub fn projections(
    system: &CanonicalDocument,
    artifacts: &[(String, Vec<u8>)],
) -> Result<Vec<Projection>, PrismError> {
    if system.schema() == browser::SCHEMA {
        return browser::projections(system, artifacts);
    }
    let value = system.value();
    let coverage = capability_coverage(&system.digest())?;
    let documents = [
        (
            "projections/asyncapi.json",
            "application/vnd.aai.asyncapi+json;version=3.1.0",
            asyncapi(value),
        ),
        (
            "projections/capability-coverage.json",
            "application/vnd.prismpm.capability-coverage.v1+json",
            coverage,
        ),
        (
            "projections/cloudevents.schema.json",
            "application/schema+json",
            cloudevents(value),
        ),
        (
            "projections/compose.json",
            "application/vnd.docker.compose.project+yaml",
            compose(value)?,
        ),
        (
            "projections/kubernetes.json",
            "application/yaml",
            kubernetes(value, artifacts)?,
        ),
        (
            "projections/openapi.json",
            "application/vnd.oai.openapi+json;version=3.2.0",
            openapi(value),
        ),
        (
            "projections/opentelemetry-collector.json",
            "application/yaml",
            opentelemetry(value),
        ),
        (
            "projections/spdx.json",
            "application/spdx+json;version=3.0.1",
            spdx(value),
        ),
        (
            "projections/system-validation-certificate.json",
            "application/vnd.prismpm.system-validation-certificate.v1+json",
            validation_certificate(value)?,
        ),
    ];
    let mut projections = documents
        .into_iter()
        .map(|(path, media_type, value)| {
            Ok(Projection {
                path: path.to_owned(),
                media_type: media_type.to_owned(),
                bytes: encode_value(&value)?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    projections.push(Projection {
        path: "projections/history.sql".to_owned(),
        media_type: "application/sql".to_owned(),
        bytes: history_sql(value)?.into_bytes(),
    });
    if let Some(sql) = contract_sql(value)? {
        projections.push(Projection {
            path: "projections/contract.sql".to_owned(),
            media_type: "application/sql".to_owned(),
            bytes: sql.into_bytes(),
        });
    }
    projections.extend(production_browser(value)?);
    projections.push(Projection {
        path: "projections/runtime-contract.json".to_owned(),
        media_type: "application/json".to_owned(),
        bytes: encode_value(&runtime_profile(value))?,
    });
    projections.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    Ok(projections)
}

/// Generate the canonical Compose target projection from the system model.
pub fn compose_projection(system: &Value) -> Result<Value, PrismError> {
    compose(system)
}

/// Generate the canonical Kubernetes target projection from the system model.
pub fn kubernetes_projection(
    system: &Value,
    build_artifacts: &[(String, Vec<u8>)],
) -> Result<Value, PrismError> {
    kubernetes(system, build_artifacts)
}

#[cfg(test)]
mod certificate_tests;

#[cfg(test)]
mod tests {
    use super::{
        acyclic_components, asyncapi, authority_binding_for_feature,
        canonical_license_expression_text, cloudevents, history_sql, looks_secret,
        model_field_name, openapi, production_browser, valid_artifact_path, validation_certificate,
    };
    use serde_json::json;
    use std::collections::BTreeSet;

    #[test]
    fn ingress_manifest_yaml_refuses_duplicate_keys_and_skips_empty_documents() {
        use serde_json::Value;

        let duplicate = serde_saphyr::from_slice_multiple::<Value>(b"kind: A\nkind: B\n");
        assert!(duplicate.is_err(), "duplicate keys must be refused");
        let documents = serde_saphyr::from_slice_multiple::<Value>(
            b"---\n---\nkind: A\n---\nnull\n---\nkind: B\n",
        )
        .unwrap();
        assert_eq!(documents, vec![json!({"kind": "A"}), json!({"kind": "B"})]);
        let pinned = super::ingress_nginx_documents().unwrap();
        assert_eq!(pinned.len(), 19);
        assert!(pinned.iter().all(|resource| resource["kind"].is_string()));
    }

    #[test]
    fn ingress_projection_normalizes_only_empty_configmap_data() {
        use serde_json::Value;

        let resources = super::ingress_controller_resources(&json!({
            "ingress_class_name": "nginx"
        }))
        .unwrap();
        let imported = super::ingress_nginx_documents().unwrap();
        assert_eq!(resources.len(), imported.len());
        let mut normalized = 0;
        for (actual, mut original) in resources.into_iter().zip(imported) {
            if original["apiVersion"] == "v1"
                && original["kind"] == "ConfigMap"
                && original.get("data") == Some(&Value::Null)
            {
                original["data"] = json!({});
                normalized += 1;
            }
            assert_eq!(actual, original);
        }
        assert_eq!(normalized, 1);
        assert!(super::ingress_controller_resources(&json!({}))
            .unwrap()
            .is_empty());
        assert_eq!(
            super::ingress_controller_resources(&json!({"ingress_class_name": "unknown"}))
                .unwrap_err()
                .code,
            "PP7101"
        );
    }

    #[test]
    fn capability_authority_links_are_exact_and_honest() {
        assert_eq!(
            authority_binding_for_feature("DP-02").unwrap(),
            json!({"ids":["COMPOSE-FEE041B3"],"kind":"present"})
        );
        assert_eq!(
            authority_binding_for_feature("RP-12").unwrap(),
            json!({
                "kind":"none",
                "reason":"Prism-owned behavior; no adopted external standard owns this capability"
            })
        );
    }

    #[test]
    fn cycle_and_secret_mutations_are_detected() {
        let rows = vec![
            json!({"id":"a","depends_on":["b"]}),
            json!({"id":"b","depends_on":["a"]}),
        ];
        assert!(acyclic_components(&rows, &BTreeSet::from(["a".into(), "b".into()])).is_err());
        assert!(looks_secret("Authorization: Bearer token"));
        assert!(!looks_secret("secret://application/database-password"));
    }

    #[test]
    fn call_and_flow_fields_remain_distinct_and_registry_ports_are_bounded() {
        assert_eq!(
            model_field_name(Some("Call"), "fromComponent"),
            "from_component"
        );
        assert_eq!(
            model_field_name(Some("Call"), "interfaceId"),
            "interface_id"
        );
        assert_eq!(model_field_name(Some("Flow"), "fromComponent"), "from");
        assert_eq!(model_field_name(Some("Flow"), "interfaceId"), "interface");
        assert!(valid_artifact_path("system/api-image.tar"));
        assert!(valid_artifact_path("localhost:5000/prismpm-runtime"));
        assert!(!valid_artifact_path("localhost:0/prismpm-runtime"));
        assert!(!valid_artifact_path("localhost:65536/prismpm-runtime"));
    }

    #[test]
    fn artifact_license_text_and_formal_projection_fail_closed() {
        for accepted in ["Apache-2.0", "Apache-2.0 OR MIT", "PostgreSQL"] {
            assert!(canonical_license_expression_text(accepted));
        }
        for rejected in ["", " Apache-2.0", "Apache-2.0 ", "Apache-2.0  OR MIT"] {
            assert!(!canonical_license_expression_text(rejected));
        }
        assert!(!canonical_license_expression_text(&"X".repeat(257)));
        assert!(!canonical_license_expression_text("Apache-2.0\n"));

        let mut system = serde_json::Map::new();
        system.insert("product".to_owned(), json!({"id":"license-fixture"}));
        system.insert("secret_references".to_owned(), json!([]));
        for name in [
            "acceptance",
            "alerts",
            "architecture",
            "artifacts",
            "backups",
            "calls",
            "capabilities",
            "components",
            "controls",
            "drifts",
            "events",
            "flows",
            "identity_requirements",
            "interfaces",
            "migrations",
            "parameters",
            "platform_requirements",
            "persistence",
            "retirements",
            "rollbacks",
            "rollouts",
            "scaling_policies",
            "schemas",
            "secret_references",
            "slis",
            "slos",
            "standards",
            "targets",
            "topology",
            "storage_classes",
        ] {
            system.insert(name.to_owned(), json!([]));
        }
        system.insert(
            "artifacts".to_owned(),
            json!([
                {"id":"a","license_expression":"MPL-2.0"},
                {"id":"b","license_expression":"Apache-2.0 OR MIT"}
            ]),
        );
        let certificate = validation_certificate(&serde_json::Value::Object(system)).unwrap();
        assert_eq!(certificate["license_closure"]["bound"], 257);
        assert_eq!(certificate["license_closure"]["values"], json!([7, 17]));
    }

    #[test]
    fn transactional_host_uses_only_modeled_application_terms() {
        let system = json!({
            "acceptance":[
                {"id":"application-smoke","kind":"positive"},
                {"id":"application-rejects-input","kind":"negative"}
            ],
            "application_profile":{
                "annotation_column":"note_value",
                "application_errors":[{"model_name":"DomainRejected","wire_name":"domain-rejected"}],
                "command_id_column":"command_key",
                "command_id_field":"command_id",
                "command_id_pattern":"^[a-z]+$",
                "command_operations":["execute"],
                "command_path":"/v1/commands",
                "history_default_limit":25,
                "history_max_limit":100,
                "history_table":"service_history",
                "input_a_column":"first_input",
                "input_a_field":"first",
                "input_b_column":"second_input",
                "input_b_field":"second",
                "observer_role":"application.observer",
                "operation_column":"command_operation",
                "operation_field":"operation",
                "optional_annotation":"optional",
                "annotation_field":"note",
                "annotation_max_scalars":128,
                "outbox_table":"service_outbox",
                "audit_table":"service_audit",
                "submitter_role":"application.submitter"
            },
            "architecture":[
                {"id":"submit","kind":"http-operation","value":"POST /v1/commands"}
            ],
            "product":{"id":"application","version":"1"}
        });
        let sql = history_sql(&system).unwrap();
        assert!(sql.contains("command_key TEXT NOT NULL UNIQUE"));
        assert!(sql.contains("first_input TEXT NOT NULL"));
        assert!(sql.contains("second_input TEXT NOT NULL"));
        assert!(sql.contains("note_value TEXT NULL"));
        assert!(sql.contains("sequence NUMERIC(20,0)"));
        assert!(sql.contains("18446744073709551615"));
        assert!(sql.contains("prismpm_allocate_u64_sequence"));
        assert!(!sql.contains("BIGSERIAL"));
        assert!(!sql.contains("BIGINT"));
        assert!(!sql.contains("request_id"));
        assert!(!sql.contains("operand"));
        let api = openapi(&system);
        let errors = api["components"]["schemas"]["Error"]["properties"]["error"]["properties"]
            ["code"]["enum"]
            .as_array()
            .unwrap();
        assert!(errors.contains(&json!("DomainRejected")));
        assert!(!errors.contains(&json!("DivisionByZero")));
        let event = cloudevents(&system);
        assert_eq!(
            event["properties"]["data"]["properties"]["command_id"]["pattern"],
            "^[a-z]+$"
        );
        assert_eq!(
            event["properties"]["data"]["properties"]["outcome"]["oneOf"][0]["properties"]["kind"]
                ["const"],
            "succeeded"
        );
        assert_eq!(
            asyncapi(&system)["components"]["messages"]["CloudEvent"]["payload"],
            event
        );
    }

    #[test]
    fn production_view_clears_prior_identity_data_and_stale_retry_state() {
        let mut view = serde_json::Map::new();
        for field in [
            "access_denied_text",
            "annotation_heading",
            "annotation_label",
            "authenticate_label",
            "authenticated_text",
            "authenticating_text",
            "authentication_failed_text",
            "command_column_heading",
            "command_failed_text",
            "command_form_heading",
            "command_id_label",
            "empty_text",
            "heading",
            "history_empty_text",
            "history_failed_text",
            "history_heading",
            "history_loaded_text",
            "identity_heading",
            "input_a_label",
            "input_b_label",
            "input_summary_heading",
            "loading_text",
            "observer_role_label",
            "operation_label",
            "outcome_heading",
            "outcome_prefix",
            "principal_default",
            "principal_label",
            "refresh_label",
            "release_prefix",
            "retry_label",
            "role_label",
            "sequence_heading",
            "submit_label",
            "submitter_role_label",
            "title",
            "denied_role_label",
            "submitting_text",
        ] {
            view.insert(field.to_owned(), json!(field));
        }
        let system = json!({
            "application_profile":{
                "annotation_field":"label",
                "annotation_max_scalars":128,
                "command_id_field":"request_id",
                "command_id_pattern":"^[a-z]+$",
                "command_operations":["add"],
                "command_path":"/v1/calculations",
                "history_default_limit":25,
                "history_max_limit":100,
                "input_a_field":"left",
                "input_b_field":"right",
                "observer_role":"calculator.auditor",
                "operation_field":"operation",
                "optional_annotation":"optional",
                "submitter_role":"calculator.user",
                "token_path":"/oidc/token",
                "view":view
            }
        });
        let projections = production_browser(&system).unwrap();
        let script = String::from_utf8(
            projections
                .iter()
                .find(|projection| projection.path == "production-browser/app.js")
                .unwrap()
                .bytes
                .clone(),
        )
        .unwrap();
        assert!(script.contains("function clearIdentityData(){client=null;"));
        assert!(script.contains("event.preventDefault();clearIdentityData();status("));
        assert!(script.contains("body.replaceChildren();byId(\"empty\").hidden=true;"));
        assert!(script.contains("byId(\"retry\").hidden=true;status(contract.view.loading_text)"));
        assert!(script.contains("catch(error){clearIdentityData();status(error.message)"));
    }
}
