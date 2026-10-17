//! Generic projection of an evaluated Prism application declaration.

use super::model_document::{
    Application, ApplicationAcceptanceVector, ApplicationModel, ApplicationView,
    ApplicationViewOperation, ArchitectureModel, ModelDocument, ProjectionProvenance, QualityModel,
    SecurityModel, TextApplicationModel, TextView,
};
use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

#[cfg(test)]
mod tests;

mod workbench;

pub(super) type Definitions<'a> = BTreeMap<(String, String), &'a Value>;

const MAX_METADATA_ALIASES: usize = 65_536;

pub(super) fn member_name(value: &Value) -> Option<&str> {
    value.get("result")?.get("member")?.get("name")?.as_str()
}

fn definition<'a>(
    definitions: &'a Definitions<'a>,
    module: &'a str,
    reference: &'a Value,
) -> Result<(&'a str, &'a str, &'a Value), PrismError> {
    let name = reference
        .get("name")
        .and_then(Value::as_str)
        .ok_or_else(|| PrismError::new("PP2001", "application call has no function name"))?;
    let owner = match reference.get("module") {
        None => module,
        Some(value) => value.as_str().ok_or_else(|| {
            PrismError::new("PP2001", "application call has a malformed module name")
        })?,
    };
    definitions
        .get(&(owner.to_owned(), name.to_owned()))
        .copied()
        .map(|value| (owner, name, value))
        .ok_or_else(|| {
            PrismError::new(
                "PP2001",
                format!("application value references unknown definition {owner}.{name}"),
            )
        })
}

fn evaluated<'a>(
    definitions: &'a Definitions<'a>,
    module: &'a str,
    value: &'a Value,
) -> Result<(&'a str, &'a Value), PrismError> {
    let mut remaining = MAX_METADATA_ALIASES;
    let mut visited = BTreeSet::new();
    evaluated_with_state(definitions, module, value, &mut remaining, &mut visited)
}

fn evaluated_with_state<'a>(
    definitions: &'a Definitions<'a>,
    mut module: &'a str,
    mut value: &'a Value,
    remaining: &mut usize,
    visited: &mut BTreeSet<(&'a str, &'a str)>,
) -> Result<(&'a str, &'a Value), PrismError> {
    while value.get("kind").and_then(Value::as_str) == Some("call") {
        *remaining = remaining.checked_sub(1).ok_or_else(|| {
            PrismError::new("PP2001", "application metadata exceeds the alias budget")
        })?;
        let arguments = value
            .get("arguments")
            .and_then(Value::as_array)
            .ok_or_else(|| PrismError::new("PP2001", "application call is malformed"))?;
        if !arguments.is_empty() {
            return Err(PrismError::new(
                "PP2001",
                "application metadata calls must be closed",
            ));
        }
        let (owner, name, declaration) = definition(
            definitions,
            module,
            value
                .get("function")
                .ok_or_else(|| PrismError::new("PP2001", "application call is malformed"))?,
        )?;
        if !visited.insert((owner, name)) {
            return Err(PrismError::new(
                "PP2001",
                "application metadata contains a cyclic alias",
            ));
        }
        if !declaration
            .get("parameters")
            .and_then(Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            return Err(PrismError::new(
                "PP2001",
                "application metadata definition is not closed",
            ));
        }
        module = owner;
        value = declaration
            .get("body")
            .ok_or_else(|| PrismError::new("PP2001", "application definition has no body"))?;
    }
    Ok((module, value))
}

pub(super) fn record<'a>(
    definitions: &'a Definitions<'a>,
    module: &'a str,
    value: &'a Value,
) -> Result<BTreeMap<&'a str, (&'a str, &'a Value)>, PrismError> {
    record_with_unevaluated_fields(definitions, module, value, &[])
}

pub(super) fn record_with_unevaluated_fields<'a>(
    definitions: &'a Definitions<'a>,
    module: &'a str,
    value: &'a Value,
    deferred_fields: &[&str],
) -> Result<BTreeMap<&'a str, (&'a str, &'a Value)>, PrismError> {
    let (module, value) = evaluated(definitions, module, value)?;
    if value.get("kind").and_then(Value::as_str) != Some("record") {
        return Err(PrismError::new(
            "PP2001",
            "application metadata is not a closed record",
        ));
    }
    let mut result = BTreeMap::new();
    for field in value
        .get("fields")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP2001", "application record fields are absent"))?
    {
        let name = field
            .get("field")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP2001", "application field has no name"))?;
        let value = field
            .get("value")
            .ok_or_else(|| PrismError::new("PP2001", "application field has no value"))?;
        let evaluated = if deferred_fields.contains(&name) {
            (module, value)
        } else {
            evaluated(definitions, module, value)?
        };
        if result.insert(name, evaluated).is_some() {
            return Err(PrismError::new(
                "PP2001",
                format!("application field {name} is duplicated"),
            ));
        }
    }
    Ok(result)
}

pub(super) fn field<'a>(
    fields: &'a BTreeMap<&str, (&str, &Value)>,
    name: &str,
) -> Result<(&'a str, &'a Value), PrismError> {
    fields
        .get(name)
        .copied()
        .ok_or_else(|| PrismError::new("PP2001", format!("application field {name} is absent")))
}

pub(super) fn string(
    fields: &BTreeMap<&str, (&str, &Value)>,
    name: &str,
) -> Result<String, PrismError> {
    let (_, value) = field(fields, name)?;
    if value.get("kind").and_then(Value::as_str) != Some("string") {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {name} is not String"),
        ));
    }
    value
        .get("value")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PrismError::new("PP2001", format!("application field {name} is malformed")))
}

fn boolean(fields: &BTreeMap<&str, (&str, &Value)>, name: &str) -> Result<bool, PrismError> {
    let (_, value) = field(fields, name)?;
    if value.get("kind").and_then(Value::as_str) != Some("bool") {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {name} is not Bool"),
        ));
    }
    value
        .get("value")
        .and_then(Value::as_bool)
        .ok_or_else(|| PrismError::new("PP2001", format!("application field {name} is malformed")))
}

pub(super) fn unsigned(
    fields: &BTreeMap<&str, (&str, &Value)>,
    name: &str,
    representation: &str,
) -> Result<u64, PrismError> {
    let (_, value) = field(fields, name)?;
    if value.get("kind").and_then(Value::as_str) != Some("integer")
        || value.get("representation").and_then(Value::as_str) != Some(representation)
    {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {name} is not {representation}"),
        ));
    }
    let text = value.get("value").and_then(Value::as_str).ok_or_else(|| {
        PrismError::new("PP2001", format!("application field {name} is malformed"))
    })?;
    if text != "0" && text.starts_with('0') {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {name} is noncanonical"),
        ));
    }
    text.parse().map_err(|_| {
        PrismError::new(
            "PP2001",
            format!("application field {name} is out of range"),
        )
    })
}

fn constructor(fields: &BTreeMap<&str, (&str, &Value)>, name: &str) -> Result<String, PrismError> {
    let (_, value) = field(fields, name)?;
    if value.get("kind").and_then(Value::as_str) != Some("constructor") {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {name} is not a closed constructor"),
        ));
    }
    value
        .pointer("/constructor/name")
        .and_then(Value::as_str)
        .map(str::to_owned)
        .ok_or_else(|| PrismError::new("PP2001", format!("application field {name} is malformed")))
}

fn constructor_list(
    fields: &BTreeMap<&str, (&str, &Value)>,
    name: &str,
) -> Result<Vec<String>, PrismError> {
    let (_, mut value) = field(fields, name)?;
    let mut result = Vec::new();
    loop {
        match value.get("kind").and_then(Value::as_str) {
            Some("nil") => return Ok(result),
            Some("cons") => {
                let head = value
                    .get("head")
                    .ok_or_else(|| PrismError::new("PP2001", "application list has no head"))?;
                if head.get("kind").and_then(Value::as_str) != Some("constructor") {
                    return Err(PrismError::new(
                        "PP2001",
                        format!("application field {name} contains a non-constructor"),
                    ));
                }
                result.push(
                    head.pointer("/constructor/name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            PrismError::new("PP2001", "application constructor is malformed")
                        })?
                        .to_owned(),
                );
                value = value
                    .get("tail")
                    .ok_or_else(|| PrismError::new("PP2001", "application list has no tail"))?;
            }
            _ => {
                return Err(PrismError::new(
                    "PP2001",
                    format!("application field {name} is not a closed list"),
                ));
            }
        }
    }
}

pub(super) fn string_list(
    fields: &BTreeMap<&str, (&str, &Value)>,
    name: &str,
) -> Result<Vec<String>, PrismError> {
    let (_, mut value) = field(fields, name)?;
    let mut result = Vec::new();
    loop {
        match value.get("kind").and_then(Value::as_str) {
            Some("nil") => return Ok(result),
            Some("cons") => {
                let head = value
                    .get("head")
                    .ok_or_else(|| PrismError::new("PP2001", "application list has no head"))?;
                if head.get("kind").and_then(Value::as_str) != Some("string") {
                    return Err(PrismError::new(
                        "PP2001",
                        format!("application field {name} contains a non-string"),
                    ));
                }
                result.push(
                    head.get("value")
                        .and_then(Value::as_str)
                        .ok_or_else(|| {
                            PrismError::new("PP2001", "application string is malformed")
                        })?
                        .to_owned(),
                );
                value = value
                    .get("tail")
                    .ok_or_else(|| PrismError::new("PP2001", "application list has no tail"))?;
            }
            _ => {
                return Err(PrismError::new(
                    "PP2001",
                    format!("application field {name} is not a closed list"),
                ));
            }
        }
    }
}

fn operation_list(
    definitions: &Definitions<'_>,
    module: &str,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<Vec<ApplicationViewOperation>, PrismError> {
    let (_, mut value) = field(fields, "operations")?;
    let mut result = Vec::new();
    loop {
        match value.get("kind").and_then(Value::as_str) {
            Some("nil") => return Ok(result),
            Some("cons") => {
                let values = record(
                    definitions,
                    module,
                    value.get("head").ok_or_else(|| {
                        PrismError::new("PP2001", "View operation list has no head")
                    })?,
                )?;
                result.push(ApplicationViewOperation {
                    label: string(&values, "label")?,
                    request_name: string(&values, "requestName")?,
                    rust_variant: string(&values, "rustVariant")?,
                    discriminant: u8::try_from(unsigned(&values, "discriminant", "uint8")?)
                        .map_err(|_| {
                            PrismError::new("PP2001", "View operation discriminant exceeds UInt8")
                        })?,
                });
                value = value
                    .get("tail")
                    .ok_or_else(|| PrismError::new("PP2001", "View operation list has no tail"))?;
            }
            _ => {
                return Err(PrismError::new(
                    "PP2001",
                    "application View operations are not a closed list",
                ));
            }
        }
    }
}

fn bytes(value: &Value, field: &str) -> Result<Vec<u8>, PrismError> {
    if value.get("kind").and_then(Value::as_str) != Some("bytes") {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {field} is not Bytes"),
        ));
    }
    let hex = value.get("hex").and_then(Value::as_str).ok_or_else(|| {
        PrismError::new("PP2001", format!("application field {field} is malformed"))
    })?;
    if hex.len() % 2 != 0
        || !hex
            .bytes()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
    {
        return Err(PrismError::new(
            "PP2001",
            format!("application field {field} is not canonical hexadecimal"),
        ));
    }
    hex.as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).expect("ASCII hex pair");
            u8::from_str_radix(text, 16).map_err(|_| {
                PrismError::new("PP2001", format!("application field {field} is malformed"))
            })
        })
        .collect()
}

fn metadata_bytes(
    definitions: &Definitions<'_>,
    module: &str,
    value: &Value,
    field: &str,
) -> Result<Vec<u8>, PrismError> {
    fn collect<'a>(
        definitions: &'a Definitions<'a>,
        module: &'a str,
        value: &'a Value,
        state: &mut (usize, BTreeSet<(&'a str, &'a str)>, Vec<u8>),
        depth: usize,
        field: &str,
    ) -> Result<(), PrismError> {
        state.0 = state
            .0
            .checked_sub(1)
            .ok_or_else(|| PrismError::new("PP2001", "byte metadata exceeds its work budget"))?;
        if depth > 128 {
            return Err(PrismError::new(
                "PP2001",
                "byte metadata exceeds its depth bound",
            ));
        }
        match value.get("kind").and_then(Value::as_str) {
            Some("call") => {
                if !value
                    .get("arguments")
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
                {
                    return Err(PrismError::new(
                        "PP2001",
                        "byte metadata calls must be closed",
                    ));
                }
                let (owner, name, declaration) = definition(
                    definitions,
                    module,
                    value.get("function").ok_or_else(|| {
                        PrismError::new("PP2001", "byte metadata call is malformed")
                    })?,
                )?;
                if !declaration
                    .get("parameters")
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
                    || declaration.pointer("/result/kind").and_then(Value::as_str) != Some("bytes")
                {
                    return Err(PrismError::new(
                        "PP2001",
                        "byte metadata aliases require a closed Bytes definition",
                    ));
                }
                if !state.1.insert((owner, name)) {
                    return Err(PrismError::new(
                        "PP2001",
                        "byte metadata contains a cyclic alias",
                    ));
                }
                let result = collect(
                    definitions,
                    owner,
                    declaration.get("body").ok_or_else(|| {
                        PrismError::new("PP2001", "byte metadata alias has no body")
                    })?,
                    state,
                    depth + 1,
                    field,
                );
                state.1.remove(&(owner, name));
                result
            }
            Some("primitive") => {
                let arguments = value
                    .get("arguments")
                    .and_then(Value::as_array)
                    .filter(|values| values.len() == 2);
                if value.get("operation").and_then(Value::as_str) != Some("append")
                    || value.pointer("/result/kind").and_then(Value::as_str) != Some("bytes")
                    || arguments.is_none()
                {
                    return Err(PrismError::new(
                        "PP2001",
                        "byte metadata only admits the closed Bytes append primitive",
                    ));
                }
                let arguments = arguments.expect("checked binary append");
                collect(definitions, module, &arguments[0], state, depth + 1, field)?;
                collect(definitions, module, &arguments[1], state, depth + 1, field)
            }
            Some("bytes") => {
                let length = value
                    .get("hex")
                    .and_then(Value::as_str)
                    .map(|hex| hex.len() / 2)
                    .ok_or_else(|| {
                        PrismError::new("PP2001", "byte metadata literal is malformed")
                    })?;
                if length > 16_777_216usize.saturating_sub(state.2.len()) {
                    return Err(PrismError::new(
                        "PP2001",
                        "byte metadata exceeds its 16 MiB bound",
                    ));
                }
                state.2.extend(bytes(value, field)?);
                Ok(())
            }
            _ => Err(PrismError::new(
                "PP2001",
                "byte metadata requires literal Bytes, a closed Bytes alias or binary append",
            )),
        }
    }
    let mut state = (MAX_METADATA_ALIASES, BTreeSet::new(), Vec::new());
    collect(definitions, module, value, &mut state, 0, field)?;
    Ok(state.2)
}

fn acceptance_vectors(
    definitions: &Definitions<'_>,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<Vec<ApplicationAcceptanceVector>, PrismError> {
    let (mut module, mut value) = field(fields, "acceptanceVectors")?;
    let mut result = Vec::new();
    let mut remaining = MAX_METADATA_ALIASES;
    let mut visited = BTreeSet::new();
    loop {
        (module, value) =
            evaluated_with_state(definitions, module, value, &mut remaining, &mut visited)?;
        match value.get("kind").and_then(Value::as_str) {
            Some("nil") => return Ok(result),
            Some("cons") => {
                let values = record_with_unevaluated_fields(
                    definitions,
                    module,
                    value.get("head").ok_or_else(|| {
                        PrismError::new("PP2001", "acceptance vector list has no head")
                    })?,
                    &["request", "response"],
                )?;
                result.push(ApplicationAcceptanceVector {
                    request: {
                        let (owner, value) = field(&values, "request")?;
                        metadata_bytes(definitions, owner, value, "request")?
                    },
                    response: {
                        let (owner, value) = field(&values, "response")?;
                        metadata_bytes(definitions, owner, value, "response")?
                    },
                });
                value = value.get("tail").ok_or_else(|| {
                    PrismError::new("PP2001", "acceptance vector list has no tail")
                })?;
            }
            _ => {
                return Err(PrismError::new(
                    "PP2001",
                    "application acceptanceVectors is not a closed list",
                ));
            }
        }
    }
}

fn view(
    definitions: &Definitions<'_>,
    module: &str,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<ApplicationView, PrismError> {
    let (_, value) = field(fields, "view")?;
    let values = record(definitions, module, value)?;
    Ok(ApplicationView {
        title: string(&values, "title")?,
        heading: string(&values, "heading")?,
        left_label: string(&values, "leftLabel")?,
        right_label: string(&values, "rightLabel")?,
        operation_label: string(&values, "operationLabel")?,
        submit_label: string(&values, "submitLabel")?,
        input_error: string(&values, "inputError")?,
        division_error: string(&values, "divisionError")?,
        overflow_error: string(&values, "overflowError")?,
        operations: operation_list(definitions, module, &values)?,
        initial_operation: u8::try_from(unsigned(&values, "initialOperation", "uint8")?)
            .map_err(|_| PrismError::new("PP2001", "initialOperation exceeds UInt8"))?,
        live_polite: boolean(&values, "livePolite")?,
        retain_focus: boolean(&values, "retainFocus")?,
        submit_on_enter: boolean(&values, "submitOnEnter")?,
        hologram_intent: boolean(&values, "hologramIntent")?,
        pages_adapter: boolean(&values, "pagesAdapter")?,
    })
}

pub(super) fn exact_fields(
    fields: &BTreeMap<&str, (&str, &Value)>,
    expected: &[&str],
) -> Result<(), PrismError> {
    if fields.len() != expected.len() || expected.iter().any(|name| !fields.contains_key(name)) {
        return Err(PrismError::new(
            "PP2009",
            "text application record fields do not match its closed profile",
        ));
    }
    Ok(())
}

fn text_view(
    definitions: &Definitions<'_>,
    module: &str,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<TextView, PrismError> {
    let (_, value) = field(fields, "view")?;
    let values = record(definitions, module, value)?;
    exact_fields(
        &values,
        &[
            "title",
            "heading",
            "inputLabel",
            "submitLabel",
            "outputLabel",
            "inputError",
            "responseError",
        ],
    )?;
    Ok(TextView {
        title: string(&values, "title")?,
        heading: string(&values, "heading")?,
        input_label: string(&values, "inputLabel")?,
        submit_label: string(&values, "submitLabel")?,
        output_label: string(&values, "outputLabel")?,
        input_error: string(&values, "inputError")?,
        response_error: string(&values, "responseError")?,
    })
}

/// Project the unique closed application definition, or return None for a
/// non-application model. Discovery is structural and contains no project or
/// application-name special case.
pub fn project_application(
    snapshot: &SemanticSnapshot,
) -> Result<Option<ModelDocument>, PrismError> {
    let mut definitions = Definitions::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            if declaration.kind() == "definition" {
                definitions.insert(
                    (
                        module.name().to_owned(),
                        declaration.logical_id().to_owned(),
                    ),
                    declaration.linked_ir(),
                );
            }
        }
    }
    let candidates = definitions
        .iter()
        .filter(|(_, declaration)| {
            member_name(declaration).is_some_and(|name| name.ends_with("Application"))
                && declaration
                    .get("parameters")
                    .and_then(Value::as_array)
                    .is_some_and(Vec::is_empty)
                && declaration.pointer("/body/kind").and_then(Value::as_str) == Some("record")
        })
        .collect::<Vec<_>>();
    if candidates.is_empty() {
        return Ok(None);
    }
    if candidates.len() != 1 {
        return Err(PrismError::new(
            "PP2001",
            "a Prism application snapshot must contain exactly one closed application value",
        ));
    }
    let ((module, _), declaration) = candidates[0];
    if member_name(declaration) == Some("BrowserApplication") {
        let browser = super::browser_application::project(&definitions, module, declaration)?;
        super::browser_application::validate_roots(&browser, snapshot)?;
        return projected_document(snapshot, Application::Browser(Box::new(browser)));
    }
    let fields = record_with_unevaluated_fields(
        &definitions,
        module,
        declaration
            .get("body")
            .ok_or_else(|| PrismError::new("PP2001", "application has no body"))?,
        &["acceptanceVectors"],
    )?;
    if fields
        .get("profile")
        .is_some_and(|(_, value)| value["value"] == super::browser_application::PROFILE)
    {
        return Err(PrismError::new(
            "PP2010",
            "browser application profile requires its exact source-owned type",
        ));
    }
    let request_maximum = u32::try_from(unsigned(&fields, "requestMaximum", "uint32")?)
        .map_err(|_| PrismError::new("PP2001", "requestMaximum exceeds UInt32"))?;
    let response_maximum = u32::try_from(unsigned(&fields, "responseMaximum", "uint32")?)
        .map_err(|_| PrismError::new("PP2001", "responseMaximum exceeds UInt32"))?;
    let guest_allocation_maximum =
        u32::try_from(unsigned(&fields, "guestAllocationMaximum", "uint32")?)
            .map_err(|_| PrismError::new("PP2001", "guestAllocationMaximum exceeds UInt32"))?;
    let primary_layer = u8::try_from(unsigned(&fields, "primaryLayer", "uint8")?)
        .map_err(|_| PrismError::new("PP2001", "primaryLayer exceeds UInt8"))?;
    let view_layer = u8::try_from(unsigned(&fields, "viewLayer", "uint8")?)
        .map_err(|_| PrismError::new("PP2001", "viewLayer exceeds UInt8"))?;
    let application = if fields.contains_key("profile") {
        let profile = string(&fields, "profile")?;
        let resource_profile = matches!(
            profile.as_str(),
            "prismpm/text-application/2" | "prismpm/text-application/3"
        );
        let command_profile = profile == "prismpm/text-application/3";
        let expected_owner = match profile.as_str() {
            "prismpm/text-application/2" => Some("Foundation.View.Text.V2.Model"),
            "prismpm/text-application/3" => Some("Foundation.View.Text.V3.Model"),
            _ => None,
        };
        let actual_owner = declaration
            .pointer("/result/member/module")
            .and_then(Value::as_str)
            .filter(|owner| {
                member_name(declaration) == Some("TextApplication")
                    && matches!(
                        *owner,
                        "Foundation.View.Text.V2.Model" | "Foundation.View.Text.V3.Model"
                    )
            });
        if expected_owner != actual_owner {
            return Err(PrismError::new(
                "PP2009",
                "text/2 and text/3 require the exact source-owned Text.V2 or Text.V3 application type and profile",
            ));
        }
        let mut expected_fields = vec![
            "profile",
            "name",
            "cargoName",
            "cargoVersion",
            "cargoDescription",
            "cargoRepository",
            "cargoHomepage",
            "libraryRoots",
            "acceptanceVectors",
            "entryRoot",
            "coreContract",
            "requestMaximum",
            "responseMaximum",
            "guestAllocationMaximum",
            "capabilitiesEmpty",
            "fatArchive",
            "primaryLayer",
            "viewLayer",
            "view",
        ];
        if resource_profile {
            expected_fields.extend(["coreMemoryPages", "coreStackBytes"]);
        }
        if command_profile {
            expected_fields.extend(["cli", "workbench"]);
        }
        exact_fields(&fields, &expected_fields)?;
        Application::Text(Box::new(TextApplicationModel {
            profile,
            name: string(&fields, "name")?,
            cargo_name: string(&fields, "cargoName")?,
            cargo_version: string(&fields, "cargoVersion")?,
            cargo_description: string(&fields, "cargoDescription")?,
            cargo_repository: string(&fields, "cargoRepository")?,
            cargo_homepage: string(&fields, "cargoHomepage")?,
            library_roots: string_list(&fields, "libraryRoots")?,
            acceptance_vectors: acceptance_vectors(&definitions, &fields)?,
            entry_root: string(&fields, "entryRoot")?,
            core_contract: string(&fields, "coreContract")?,
            request_maximum,
            response_maximum,
            guest_allocation_maximum,
            core_memory_pages: if resource_profile {
                Some(
                    u32::try_from(unsigned(&fields, "coreMemoryPages", "uint32")?)
                        .map_err(|_| PrismError::new("PP2001", "coreMemoryPages exceeds UInt32"))?,
                )
            } else {
                None
            },
            core_stack_bytes: if resource_profile {
                Some(
                    u32::try_from(unsigned(&fields, "coreStackBytes", "uint32")?)
                        .map_err(|_| PrismError::new("PP2001", "coreStackBytes exceeds UInt32"))?,
                )
            } else {
                None
            },
            capabilities_empty: boolean(&fields, "capabilitiesEmpty")?,
            fat_archive: boolean(&fields, "fatArchive")?,
            primary_layer,
            view_layer,
            view: text_view(&definitions, module, &fields)?,
            cli: if command_profile {
                Some(super::text_cli::project(&definitions, &fields)?)
            } else {
                None
            },
            workbench: if command_profile {
                workbench::project_view(&definitions, &fields)?
            } else {
                None
            },
        }))
    } else {
        Application::Legacy(Box::new(ApplicationModel {
            name: string(&fields, "name")?,
            cargo_name: string(&fields, "cargoName")?,
            cargo_version: string(&fields, "cargoVersion")?,
            cargo_description: string(&fields, "cargoDescription")?,
            cargo_repository: string(&fields, "cargoRepository")?,
            cargo_homepage: string(&fields, "cargoHomepage")?,
            library_roots: string_list(&fields, "libraryRoots")?,
            operation_type: string(&fields, "operationType")?,
            error_type: string(&fields, "errorType")?,
            function_name: string(&fields, "functionName")?,
            acceptance_vectors: acceptance_vectors(&definitions, &fields)?,
            entry_root: string(&fields, "entryRoot")?,
            core_contract: string(&fields, "coreContract")?,
            request_maximum,
            response_maximum,
            guest_allocation_maximum,
            capabilities_empty: boolean(&fields, "capabilitiesEmpty")?,
            fat_archive: boolean(&fields, "fatArchive")?,
            primary_layer,
            view_layer,
            view: view(&definitions, module, &fields)?,
            input_grammar: constructor(&fields, "inputGrammar")?,
            live_mode: constructor(&fields, "liveMode")?,
            layout: constructor(&fields, "layout")?,
            color: constructor(&fields, "color")?,
            typography: constructor(&fields, "typography")?,
            actions: constructor_list(&fields, "actions")?,
            targets: constructor_list(&fields, "targets")?,
        }))
    };
    projected_document(snapshot, application)
}

fn projected_document(
    snapshot: &SemanticSnapshot,
    application: Application,
) -> Result<Option<ModelDocument>, PrismError> {
    let document = ModelDocument {
        schema: match &application {
            Application::Legacy(_) => "prismpm/model-document/1",
            Application::Text(value) if value.profile == "prismpm/text-application/3" => {
                "prismpm/model-document/6"
            }
            Application::Text(value) if value.profile == "prismpm/text-application/2" => {
                "prismpm/model-document/5"
            }
            Application::Text(_) => "prismpm/model-document/2",
            Application::Browser(_) => "prismpm/model-document/4",
        }
        .to_owned(),
        provenance: ProjectionProvenance {
            source_id: snapshot.source_id().to_string(),
            semantic_id: snapshot.semantic_id().to_string(),
            compiler_semantics_id: snapshot.compiler_semantics_id().to_string(),
            snapshot_id: snapshot.snapshot_id().to_string(),
            emitter_semantics_id: super::projector::compute_emitter_semantics_id(),
            facet_packages: Vec::new(),
        },
        standards_profile: Vec::new(),
        architecture: ArchitectureModel::default(),
        security: SecurityModel::default(),
        quality: QualityModel::default(),
        application: Some(application),
        library: None,
    };
    super::validate::validate(&document)?;
    Ok(Some(document))
}
