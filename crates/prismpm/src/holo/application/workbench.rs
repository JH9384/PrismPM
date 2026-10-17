//! Closed Text/3 metadata projection; no executable application behavior is interpreted here.
use super::*;
use crate::holo::workbench::WorkbenchView;

fn source_shape(name: &str) -> Option<&'static [(&'static str, &'static str)]> {
    match name {
        "Choice" => Some(&[("value", "String"), ("label", "String")]),
        "Field" => Some(&[
            ("id", "String"),
            ("label", "String"),
            ("kind", "FieldKind"),
            ("help", "String"),
            ("placeholder", "String"),
            ("initialValue", "String"),
            ("required", "Bool"),
            ("choices", "List Choice"),
        ]),
        "Example" => Some(&[
            ("id", "String"),
            ("label", "String"),
            ("description", "String"),
            ("values", "List String"),
            ("expectedResponse", "String"),
            ("explanation", "String"),
        ]),
        "Operation" => Some(&[
            ("id", "String"),
            ("label", "String"),
            ("summary", "String"),
            ("help", "String"),
            ("requestPrefix", "String"),
            ("fields", "List Field"),
            ("examples", "List Example"),
        ]),
        "Section" => Some(&[
            ("id", "String"),
            ("title", "String"),
            ("paragraphs", "List String"),
        ]),
        "Link" => Some(&[("label", "String"), ("httpsUrl", "String")]),
        "ErrorHint" => Some(&[
            ("code", "String"),
            ("title", "String"),
            ("explanation", "String"),
            ("recovery", "String"),
            ("fields", "List String"),
        ]),
        "StatusCopy" => Some(&[
            ("initializing", "String"),
            ("ready", "String"),
            ("running", "String"),
            ("cancelling", "String"),
            ("cancelled", "String"),
            ("timeout", "String"),
            ("loadError", "String"),
            ("computeError", "String"),
            ("inputError", "String"),
            ("responseError", "String"),
            ("scriptRequired", "String"),
        ]),
        "Design" => Some(&[
            ("palette", "Palette"),
            ("density", "Density"),
            ("width", "Width"),
            ("colorScheme", "ColorScheme"),
        ]),
        "RawEditor" => Some(&[
            ("requestPrefix", "String"),
            ("label", "String"),
            ("help", "String"),
            ("placeholder", "String"),
            ("initialValue", "String"),
            ("submitLabel", "String"),
            ("responseLabel", "String"),
            ("expanded", "Bool"),
        ]),
        "DisplaySpec" => Some(&[
            ("title", "String"),
            ("emptyText", "String"),
            ("rawLabel", "String"),
            ("maximumCells", "UInt32"),
            ("maximumDetails", "UInt32"),
        ]),
        "Execution" => Some(&[
            ("timeoutMilliseconds", "UInt32"),
            ("cancelLabel", "String"),
            ("retryLabel", "String"),
        ]),
        "WorkbenchView" => Some(&[
            ("title", "String"),
            ("heading", "String"),
            ("purpose", "String"),
            ("audience", "String"),
            ("guidance", "List String"),
            ("initialOperation", "String"),
            ("initialExample", "String"),
            ("operations", "List Operation"),
            ("sections", "List Section"),
            ("links", "List Link"),
            ("errors", "List ErrorHint"),
            ("statuses", "StatusCopy"),
            ("design", "Design"),
            ("raw", "RawEditor"),
            ("response", "DisplaySpec"),
            ("execution", "Execution"),
            ("labels", "WorkbenchLabels"),
        ]),
        "WorkbenchLabels" => Some(&[
            ("navigation", "String"),
            ("operation", "String"),
            ("examples", "String"),
            ("loadExample", "String"),
            ("compute", "String"),
            ("guide", "String"),
            ("links", "String"),
            ("fields", "String"),
            ("expectedResponse", "String"),
            ("details", "String"),
            ("resultTable", "String"),
            ("row", "String"),
            ("column", "String"),
            ("request", "String"),
            ("reset", "String"),
            ("skipToWorkbench", "String"),
        ]),
        _ => None,
    }
}
fn enum_values(name: &str) -> Option<&'static [&'static str]> {
    match name {
        "FieldKind" => Some(&["Text", "Multiline", "Natural", "Choice"]),
        "Palette" => Some(&["Indigo", "Ocean"]),
        "Density" => Some(&["Comfortable", "Compact"]),
        "Width" => Some(&["Balanced", "Wide"]),
        "ColorScheme" => Some(&["System", "Light", "Dark"]),
        _ => None,
    }
}
fn snake(value: &str) -> String {
    let mut result = String::new();
    for ch in value.chars() {
        if ch.is_ascii_uppercase() {
            result.push('_');
            result.push(ch.to_ascii_lowercase());
        } else {
            result.push(ch);
        }
    }
    result
}
fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2009", message)
}
fn metadata(
    definitions: &Definitions<'_>,
    module: &str,
    value: &Value,
    kind: &str,
    remaining: &mut usize,
    depth: usize,
) -> Result<Value, PrismError> {
    *remaining = remaining
        .checked_sub(1)
        .ok_or_else(|| invalid("workbench metadata exceeds its node budget"))?;
    if depth > 64 {
        return Err(invalid("workbench metadata exceeds its nesting bound"));
    }
    let (module, value) = evaluated(definitions, module, value)?;
    if let Some(element) = kind.strip_prefix("List ") {
        let mut rows = Vec::new();
        let mut owner = module;
        let mut tail = value;
        loop {
            let (next_owner, next) = evaluated(definitions, owner, tail)?;
            owner = next_owner;
            match next.get("kind").and_then(Value::as_str) {
                Some("nil") => break,
                Some("cons") => {
                    rows.push(metadata(
                        definitions,
                        owner,
                        next.get("head")
                            .ok_or_else(|| invalid("workbench list has no head"))?,
                        element,
                        remaining,
                        depth + 1,
                    )?);
                    tail = next
                        .get("tail")
                        .ok_or_else(|| invalid("workbench list has no tail"))?;
                }
                _ => return Err(invalid("workbench metadata requires a closed list")),
            }
        }
        return Ok(Value::Array(rows));
    }
    let single = BTreeMap::from([("value", (module, value))]);
    match kind {
        "String" => return Ok(Value::String(string(&single, "value")?)),
        "Bool" => return Ok(Value::Bool(boolean(&single, "value")?)),
        "UInt32" => {
            return Ok(Value::from(
                u32::try_from(unsigned(&single, "value", "uint32")?)
                    .map_err(|_| invalid("workbench integer exceeds UInt32"))?,
            ));
        }
        _ => (),
    }
    if let Some(variants) = enum_values(kind) {
        let name = constructor(&single, "value")?;
        let expected = variants
            .iter()
            .find(|variant| name == format!("{kind}.{variant}"));
        if expected.is_none()
            || value.pointer("/constructor/module").and_then(Value::as_str)
                != Some("Foundation.View.Text.V3.Model")
        {
            return Err(invalid(
                "workbench enum requires its exact source-owned constructor",
            ));
        }
        return Ok(Value::String(expected.unwrap().to_ascii_lowercase()));
    }
    let shape = source_shape(kind).ok_or_else(|| invalid("workbench metadata type is unknown"))?;
    if value.pointer("/type/module").and_then(Value::as_str)
        != Some("Foundation.View.Text.V3.Model")
        || value.pointer("/type/name").and_then(Value::as_str) != Some(kind)
    {
        return Err(invalid(
            "workbench record requires its exact source-owned type",
        ));
    }
    let fields = record(definitions, module, value)?;
    exact_fields(
        &fields,
        &shape.iter().map(|(name, _)| *name).collect::<Vec<_>>(),
    )?;
    let mut result = serde_json::Map::new();
    for (name, kind) in shape {
        let (owner, source) = field(&fields, name)?;
        result.insert(
            snake(name),
            metadata(definitions, owner, source, kind, remaining, depth + 1)?,
        );
    }
    Ok(Value::Object(result))
}

/// Project the optional text/3 `workbench` field. `Option.none` keeps the
/// unchanged Text/1 page; `Option.some` must hold the exact source-owned
/// `Foundation.View.Text.V3.Model.WorkbenchView` record.
pub(super) fn project_view(
    definitions: &Definitions<'_>,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<Option<WorkbenchView>, PrismError> {
    let (owner, value) = field(fields, "workbench")?;
    let (owner, value) = evaluated(definitions, owner, value)?;
    let constructor = value
        .pointer("/constructor/name")
        .and_then(Value::as_str)
        .filter(|_| value.get("kind").and_then(Value::as_str) == Some("constructor"))
        .ok_or_else(|| invalid("text/3 workbench must be Option WorkbenchView"))?;
    let arguments = value
        .get("arguments")
        .and_then(Value::as_array)
        .map_or(&[][..], Vec::as_slice);
    match (
        constructor.ends_with("Option.none"),
        constructor.ends_with("Option.some"),
        arguments,
    ) {
        (true, false, []) => Ok(None),
        (false, true, [view]) => serde_json::from_value(metadata(
            definitions,
            owner,
            view,
            "WorkbenchView",
            &mut 65_536,
            0,
        )?)
        .map(Some)
        .map_err(|_| invalid("workbench metadata does not match its closed projection")),
        _ => Err(invalid("text/3 workbench must be Option WorkbenchView")),
    }
}
