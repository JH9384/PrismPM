//! Closed, capability-free Text/3 workbench presentation and result contracts.

use super::model_document::{ApplicationAcceptanceVector, TextApplicationModel, TextView};
use serde::{Deserialize, Serialize};

/// Immutable workbench application profile.
pub const PROFILE: &str = "prismpm/text-application/3";

/// Closed FieldKind presentation choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FieldKind {
    /// Text choice.
    Text,
    /// Multiline choice.
    Multiline,
    /// Natural choice.
    Natural,
    /// Choice choice.
    Choice,
}

/// Closed Palette presentation choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Palette {
    /// Indigo choice.
    Indigo,
    /// Ocean choice.
    Ocean,
}

/// Closed Density presentation choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Density {
    /// Comfortable choice.
    Comfortable,
    /// Compact choice.
    Compact,
}

/// Closed Width presentation choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Width {
    /// Balanced choice.
    Balanced,
    /// Wide choice.
    Wide,
}

/// Closed ColorScheme presentation choices.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ColorScheme {
    /// System choice.
    System,
    /// Light choice.
    Light,
    /// Dark choice.
    Dark,
}

/// Source-owned Choice presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Choice {
    /// Modeled value value.
    pub value: String,
    /// Modeled label value.
    pub label: String,
}

/// Source-owned Field presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Field {
    /// Modeled id value.
    pub id: String,
    /// Modeled label value.
    pub label: String,
    /// Modeled kind value.
    pub kind: FieldKind,
    /// Modeled help value.
    pub help: String,
    /// Modeled placeholder value.
    pub placeholder: String,
    /// Modeled initialValue value.
    pub initial_value: String,
    /// Modeled required value.
    pub required: bool,
    /// Modeled choices value.
    pub choices: Vec<Choice>,
}

/// Source-owned Example presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Example {
    /// Modeled id value.
    pub id: String,
    /// Modeled label value.
    pub label: String,
    /// Modeled description value.
    pub description: String,
    /// Modeled values value.
    pub values: Vec<String>,
    /// Modeled expectedResponse value.
    pub expected_response: String,
    /// Modeled explanation value.
    pub explanation: String,
}

/// Source-owned Operation presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Operation {
    /// Modeled id value.
    pub id: String,
    /// Modeled label value.
    pub label: String,
    /// Modeled summary value.
    pub summary: String,
    /// Modeled help value.
    pub help: String,
    /// Modeled requestPrefix value.
    pub request_prefix: String,
    /// Modeled fields value.
    pub fields: Vec<Field>,
    /// Modeled examples value.
    pub examples: Vec<Example>,
}

/// Source-owned Section presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Section {
    /// Modeled id value.
    pub id: String,
    /// Modeled title value.
    pub title: String,
    /// Modeled paragraphs value.
    pub paragraphs: Vec<String>,
}

/// Source-owned Link presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Link {
    /// Modeled label value.
    pub label: String,
    /// Modeled httpsUrl value.
    pub https_url: String,
}

/// Source-owned ErrorHint presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ErrorHint {
    /// Modeled code value.
    pub code: String,
    /// Modeled title value.
    pub title: String,
    /// Modeled explanation value.
    pub explanation: String,
    /// Modeled recovery value.
    pub recovery: String,
    /// Modeled fields value.
    pub fields: Vec<String>,
}

/// Source-owned StatusCopy presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StatusCopy {
    /// Source-owned message when JavaScript is disabled.
    pub script_required: String,
    /// Modeled initializing value.
    pub initializing: String,
    /// Modeled ready value.
    pub ready: String,
    /// Modeled running value.
    pub running: String,
    /// Modeled cancelling value.
    pub cancelling: String,
    /// Modeled cancelled value.
    pub cancelled: String,
    /// Modeled timeout value.
    pub timeout: String,
    /// Modeled loadError value.
    pub load_error: String,
    /// Modeled computeError value.
    pub compute_error: String,
    /// Modeled inputError value.
    pub input_error: String,
    /// Modeled responseError value.
    pub response_error: String,
}

/// Source-owned Design presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Design {
    /// Modeled palette value.
    pub palette: Palette,
    /// Modeled density value.
    pub density: Density,
    /// Modeled width value.
    pub width: Width,
    /// Modeled colorScheme value.
    pub color_scheme: ColorScheme,
}

/// Source-owned RawEditor presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RawEditor {
    /// Modeled requestPrefix value.
    pub request_prefix: String,
    /// Modeled label value.
    pub label: String,
    /// Modeled help value.
    pub help: String,
    /// Modeled placeholder value.
    pub placeholder: String,
    /// Modeled initialValue value.
    pub initial_value: String,
    /// Modeled submitLabel value.
    pub submit_label: String,
    /// Modeled responseLabel value.
    pub response_label: String,
    /// Modeled expanded value.
    pub expanded: bool,
}

/// Source-owned DisplaySpec presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct DisplaySpec {
    /// Modeled title value.
    pub title: String,
    /// Modeled emptyText value.
    pub empty_text: String,
    /// Modeled rawLabel value.
    pub raw_label: String,
    /// Modeled maximumCells value.
    pub maximum_cells: u32,
    /// Modeled maximumDetails value.
    pub maximum_details: u32,
}

/// Source-owned Execution presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Execution {
    /// Modeled timeoutMilliseconds value.
    pub timeout_milliseconds: u32,
    /// Modeled cancelLabel value.
    pub cancel_label: String,
    /// Modeled retryLabel value.
    pub retry_label: String,
}

/// Source-owned WorkbenchView presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkbenchView {
    /// Modeled title value.
    pub title: String,
    /// Modeled heading value.
    pub heading: String,
    /// Modeled purpose value.
    pub purpose: String,
    /// Modeled audience value.
    pub audience: String,
    /// Modeled guidance value.
    pub guidance: Vec<String>,
    /// Modeled initialOperation value.
    pub initial_operation: String,
    /// Modeled initialExample value.
    pub initial_example: String,
    /// Modeled operations value.
    pub operations: Vec<Operation>,
    /// Modeled sections value.
    pub sections: Vec<Section>,
    /// Modeled links value.
    pub links: Vec<Link>,
    /// Modeled errors value.
    pub errors: Vec<ErrorHint>,
    /// Modeled statuses value.
    pub statuses: StatusCopy,
    /// Modeled design value.
    pub design: Design,
    /// Modeled raw value.
    pub raw: RawEditor,
    /// Modeled response value.
    pub response: DisplaySpec,
    /// Modeled execution value.
    pub execution: Execution,
    /// Modeled labels value.
    pub labels: WorkbenchLabels,
}

/// Source-owned WorkbenchLabels presentation record.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkbenchLabels {
    /// Modeled navigation value.
    pub navigation: String,
    /// Modeled operation value.
    pub operation: String,
    /// Modeled examples value.
    pub examples: String,
    /// Modeled loadExample value.
    pub load_example: String,
    /// Modeled compute value.
    pub compute: String,
    /// Modeled guide value.
    pub guide: String,
    /// Modeled links value.
    pub links: String,
    /// Modeled fields value.
    pub fields: String,
    /// Modeled expectedResponse value.
    pub expected_response: String,
    /// Modeled details value.
    pub details: String,
    /// Modeled resultTable value.
    pub result_table: String,
    /// Modeled row value.
    pub row: String,
    /// Modeled column value.
    pub column: String,
    /// Modeled request value.
    pub request: String,
    /// Modeled reset value.
    pub reset: String,
    /// Modeled skipToWorkbench value.
    pub skip_to_workbench: String,
}

/// A capability-free byte application with a closed guided workbench.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkbenchApplication {
    /// Exact immutable text profile identifier.
    pub profile: String,
    /// Human-facing application name.
    pub name: String,
    /// Generated registry package name.
    pub cargo_name: String,
    /// Generated registry package version.
    pub cargo_version: String,
    /// Generated package description.
    pub cargo_description: String,
    /// Canonical package source repository URL.
    pub cargo_repository: String,
    /// Canonical package homepage URL.
    pub cargo_homepage: String,
    /// Fully qualified generated library roots in bytewise order.
    pub library_roots: Vec<String>,
    /// Application-owned byte-level acceptance corpus.
    pub acceptance_vectors: Vec<ApplicationAcceptanceVector>,
    /// Fully qualified generated byte request dispatcher.
    pub entry_root: String,
    /// Hologram guest contract.
    pub core_contract: String,
    /// Maximum UTF-8 request byte length.
    pub request_maximum: u32,
    /// Maximum UTF-8 response byte length.
    pub response_maximum: u32,
    /// Guest input allocation cap.
    pub guest_allocation_maximum: u32,
    /// Explicit Core-Wasm guest memory pages, required by text/3.
    pub core_memory_pages: u32,
    /// Explicit Core-Wasm linear-memory stack bytes, required by text/3.
    pub core_stack_bytes: u32,
    /// Whether the capability request is canonically empty.
    pub capabilities_empty: bool,
    /// Whether the application requests a composed fat archive.
    pub fat_archive: bool,
    /// Zero-based primary layer.
    pub primary_layer: u8,
    /// Zero-based View layer.
    pub view_layer: u8,
    /// Text presentation metadata; byte bounds are owned by the application.
    pub view: WorkbenchView,
}

impl WorkbenchApplication {
    /// Existing Text/2 byte and resource contract, without changing its validation.
    pub(super) fn byte_contract(&self) -> TextApplicationModel {
        TextApplicationModel {
            profile: "prismpm/text-application/2".to_owned(),
            name: self.name.clone(),
            cargo_name: self.cargo_name.clone(),
            cargo_version: self.cargo_version.clone(),
            cargo_description: self.cargo_description.clone(),
            cargo_repository: self.cargo_repository.clone(),
            cargo_homepage: self.cargo_homepage.clone(),
            library_roots: self.library_roots.clone(),
            acceptance_vectors: self.acceptance_vectors.clone(),
            entry_root: self.entry_root.clone(),
            core_contract: self.core_contract.clone(),
            request_maximum: self.request_maximum,
            response_maximum: self.response_maximum,
            guest_allocation_maximum: self.guest_allocation_maximum,
            core_memory_pages: Some(self.core_memory_pages),
            core_stack_bytes: Some(self.core_stack_bytes),
            capabilities_empty: self.capabilities_empty,
            fat_archive: self.fat_archive,
            primary_layer: self.primary_layer,
            view_layer: self.view_layer,
            view: TextView {
                title: self.view.title.clone(),
                heading: self.view.heading.clone(),
                input_label: self.view.raw.label.clone(),
                submit_label: self.view.raw.submit_label.clone(),
                output_label: self.view.raw.response_label.clone(),
                input_error: self.view.statuses.input_error.clone(),
                response_error: self.view.statuses.response_error.clone(),
            },
            cli: None,
            workbench: None,
        }
    }
}

/// Strict, source-owned display result. All keys are required and duplicates and
/// unknown fields are refused by Serde before any presentation is constructed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct WorkbenchResult {
    /// Exact schema version.
    pub version: u32,
    /// Closed success or error discriminator.
    pub status: ResultStatus,
    /// Source operation ID, or `raw` for a raw wrapper.
    pub operation: String,
    /// Source-owned result summary.
    pub message: String,
    /// Safe table row count.
    pub rows: u32,
    /// Safe table column count.
    pub columns: u32,
    /// Row-major plain-text cells.
    pub cells: Vec<String>,
    /// Plain-text source explanations.
    pub details: Vec<String>,
    /// Exact underlying protocol request.
    pub request: String,
    /// Exact underlying protocol response.
    pub response: String,
    /// Modeled error code, empty for success.
    pub error: String,
}

/// Closed result disposition.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ResultStatus {
    /// A computed result.
    Ok,
    /// A source-rejected request.
    Error,
}

fn invalid(message: &str) -> crate::error::PrismError {
    crate::error::PrismError::new("PP2009", message)
}

fn copy(value: &str) -> bool {
    !value.trim().is_empty() && value.len() <= 16_384 && !value.chars().any(char::is_control)
}

fn id(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_alphabetic()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-'))
}

fn field_value(value: &str) -> bool {
    value.len() <= 1_048_576 && !value.contains('\u{1f}')
}

/// Decode and validate a bounded result without interpreting domain values.
pub fn result(
    application: &WorkbenchApplication,
    operation: &str,
    bytes: &[u8],
) -> Result<WorkbenchResult, crate::error::PrismError> {
    if bytes.len() > application.response_maximum as usize {
        return Err(invalid("workbench result exceeds its response byte limit"));
    }
    let result: WorkbenchResult = serde_json::from_slice(bytes)
        .map_err(|_| invalid("workbench result does not match its closed JSON contract"))?;
    let shape = result.rows <= application.view.response.maximum_cells
        && result.columns <= application.view.response.maximum_cells
        && u64::from(result.rows) * u64::from(result.columns) == result.cells.len() as u64;
    if result.version != 1
        || result.operation != operation
        || !copy(&result.message)
        || !shape
        || result.cells.len() > application.view.response.maximum_cells as usize
        || result.details.len() > application.view.response.maximum_details as usize
        || result.cells.iter().chain(&result.details).any(|v| !copy(v))
        || match result.status {
            ResultStatus::Ok => !result.error.is_empty(),
            ResultStatus::Error => {
                !application
                    .view
                    .errors
                    .iter()
                    .any(|hint| hint.code == result.error)
                    || result.rows != 0
                    || result.columns != 0
                    || !result.cells.is_empty()
            }
        }
    {
        return Err(invalid(
            "workbench result violates its modeled operation, bounds, or error contract",
        ));
    }
    Ok(result)
}

/// Validate the closed workbench before generation and after strict decoding.
pub fn validate(application: &WorkbenchApplication) -> Result<(), crate::error::PrismError> {
    use std::collections::BTreeSet;
    if application.profile != PROFILE {
        return Err(invalid("unsupported workbench application profile"));
    }
    super::validate::validate_text_application(&application.byte_contract())?;
    let view = &application.view;
    let encoded =
        serde_json::to_value(view).map_err(|_| invalid("workbench view cannot be encoded"))?;
    // Every visible label is source-owned; this exhaustive closed-record pass
    // keeps labels and prose independent from input values and expected JSON.
    fn record_copy(value: &serde_json::Value, key: &str) -> bool {
        match value {
            serde_json::Value::Object(fields) => {
                fields.iter().all(|(key, value)| record_copy(value, key))
            }
            serde_json::Value::Array(values) => values.iter().all(|value| record_copy(value, key)),
            serde_json::Value::String(value) => match key {
                "initial_value" | "placeholder" | "values" | "value" => field_value(value),
                "expected_response" => true,
                _ => copy(value),
            },
            _ => true,
        }
    }
    if !record_copy(&encoded, "view")
        || view.operations.is_empty()
        || view.operations.len() > 32
        || view.guidance.is_empty()
        || view.guidance.len() > 8
        || view.sections.len() > 32
        || view.links.len() > 32
        || view.errors.is_empty()
        || view.errors.len() > 128
        || view.response.maximum_cells == 0
        || view.response.maximum_cells > 4096
        || view.response.maximum_details == 0
        || view.response.maximum_details > 128
        || !(100..=120_000).contains(&view.execution.timeout_milliseconds)
        || !id(&view.raw.request_prefix)
    {
        return Err(invalid(
            "workbench view exceeds its closed copy, count, or execution bounds",
        ));
    }
    let mut operations = BTreeSet::new();
    let mut prefixes = BTreeSet::from([view.raw.request_prefix.as_str()]);
    let mut all_fields = BTreeSet::new();
    for operation in &view.operations {
        if !id(&operation.id)
            || operation.id == "raw"
            || !operations.insert(operation.id.as_str())
            || !id(&operation.request_prefix)
            || !prefixes.insert(&operation.request_prefix)
            || operation.fields.is_empty()
            || operation.fields.len() > 32
            || operation.examples.is_empty()
            || operation.examples.len() > 64
        {
            return Err(invalid(
                "workbench operations require unique IDs, framing prefixes, fields, and examples",
            ));
        }
        let mut fields = BTreeSet::new();
        for field in &operation.fields {
            if !id(&field.id)
                || !fields.insert(field.id.as_str())
                || field.choices.len() > 64
                || (field.kind == FieldKind::Choice) == field.choices.is_empty()
            {
                return Err(invalid("workbench field descriptor or choices are invalid"));
            }
            all_fields.insert(field.id.as_str());
            let mut choices = BTreeSet::new();
            for choice in &field.choices {
                if choice.value.is_empty() || !choices.insert(choice.value.as_str()) {
                    return Err(invalid(
                        "workbench choice values must be unique and nonempty",
                    ));
                }
            }
            let valid_value = |value: &str| {
                field_value(value)
                    && (!field.required || !value.trim().is_empty())
                    && (field.kind != FieldKind::Choice || choices.contains(value))
            };
            if !field_value(&field.initial_value)
                || (field.kind == FieldKind::Choice
                    && !choices.contains(field.initial_value.as_str()))
            {
                return Err(invalid("workbench initial field value is invalid"));
            }
            for example in &operation.examples {
                if example.values.len() != operation.fields.len() {
                    return Err(invalid(
                        "workbench example values do not match the operation fields",
                    ));
                }
                let index = operation
                    .fields
                    .iter()
                    .position(|candidate| candidate.id == field.id)
                    .expect("current field exists");
                if !valid_value(&example.values[index]) {
                    return Err(invalid("workbench example field value is invalid"));
                }
            }
        }
        let mut examples = BTreeSet::new();
        for example in &operation.examples {
            let request = format!(
                "{}\u{1f}{}",
                operation.request_prefix,
                example.values.join("\u{1f}")
            );
            if !id(&example.id)
                || !examples.insert(example.id.as_str())
                || request.len() > application.request_maximum as usize
                || !application.acceptance_vectors.iter().any(|vector| {
                    vector.request == request.as_bytes()
                        && vector.response == example.expected_response.as_bytes()
                })
            {
                return Err(invalid(
                    "workbench examples require unique IDs and exact framed acceptance-vector bindings",
                ));
            }
            result(
                application,
                &operation.id,
                example.expected_response.as_bytes(),
            )?;
        }
    }
    if !view.operations.iter().any(|operation| {
        operation.id == view.initial_operation
            && operation
                .examples
                .iter()
                .any(|example| example.id == view.initial_example)
    }) {
        return Err(invalid(
            "workbench initial operation and example are not source-owned references",
        ));
    }
    let mut sections = BTreeSet::new();
    for section in &view.sections {
        if !id(&section.id)
            || !sections.insert(section.id.as_str())
            || section.paragraphs.is_empty()
            || section.paragraphs.len() > 32
        {
            return Err(invalid("workbench guide section is invalid"));
        }
    }
    for link in &view.links {
        let valid_uri = jsonschema::options().should_validate_formats(true).build(&serde_json::json!({"type":"string","format":"uri","pattern":"^https://[^/?#@]+(?:[/?#]|$)"})).expect("static workbench HTTPS URI schema");
        if !valid_uri.is_valid(&serde_json::Value::String(link.https_url.clone()))
            || !link.https_url.is_ascii()
            || link
                .https_url
                .bytes()
                .any(|b| b.is_ascii_whitespace() || b.is_ascii_control())
        {
            return Err(invalid(
                "workbench links require an absolute credential-free HTTPS URL",
            ));
        }
    }
    let mut codes = BTreeSet::new();
    for hint in &view.errors {
        let refs = hint
            .fields
            .iter()
            .map(String::as_str)
            .collect::<BTreeSet<_>>();
        if !id(&hint.code)
            || !codes.insert(&hint.code)
            || refs.len() != hint.fields.len()
            || refs.iter().any(|field| !all_fields.contains(field))
        {
            return Err(invalid(
                "workbench error hints require unique codes and declared field references",
            ));
        }
    }
    let selected = oracle_vectors(application);
    let mut guided_ok = false;
    let mut raw_ok = false;
    let mut typed_error = false;
    for index in selected.ui {
        let vector = &application.acceptance_vectors[index];
        let request = std::str::from_utf8(&vector.request).expect("selected UTF-8 vector");
        let operation = if request.starts_with(&format!("{}\u{1f}", view.raw.request_prefix)) {
            "raw"
        } else {
            view.operations
                .iter()
                .find(|operation| {
                    request.starts_with(&format!("{}\u{1f}", operation.request_prefix))
                })
                .expect("selected source prefix")
                .id
                .as_str()
        };
        let answer = result(application, operation, &vector.response)?;
        if answer.status == ResultStatus::Ok {
            if operation == "raw" {
                raw_ok = true;
            } else {
                guided_ok = true;
            }
        } else {
            typed_error = true;
        }
    }
    if !guided_ok || !raw_ok || !typed_error {
        return Err(invalid(
            "workbench acceptance requires successful guided/raw frames and a representable typed error",
        ));
    }
    Ok(())
}

/// Complete partition of source vectors exercised by the portable UI oracle.
#[derive(Debug, Default, PartialEq, Eq)]
pub(crate) struct OracleVectors {
    pub(crate) direct: Vec<usize>,
    pub(crate) ui: Vec<usize>,
    pub(crate) transport_rejected: Vec<usize>,
    pub(crate) normalized: Vec<usize>,
    pub(crate) unrepresentable: Vec<usize>,
}

pub(crate) fn oracle_vectors(application: &WorkbenchApplication) -> OracleVectors {
    let mut selected = OracleVectors::default();
    for (index, vector) in application.acceptance_vectors.iter().enumerate() {
        let Ok(request) = std::str::from_utf8(&vector.request) else {
            continue;
        };
        if vector.request.len() > application.request_maximum as usize {
            continue;
        }
        selected.direct.push(index);
        if let Some(raw) =
            request.strip_prefix(&format!("{}\u{1f}", application.view.raw.request_prefix))
        {
            if raw.contains('\u{1f}') {
                selected.transport_rejected.push(index);
            } else if raw.contains('\r') {
                selected.normalized.push(index);
            } else {
                selected.ui.push(index);
            }
        } else if let Some((operation, values)) =
            application.view.operations.iter().find_map(|operation| {
                request
                    .strip_prefix(&format!("{}\u{1f}", operation.request_prefix))
                    .map(|values| (operation, values))
            })
        {
            let values = values.split('\u{1f}').collect::<Vec<_>>();
            if values.len() != operation.fields.len()
                || values.iter().zip(&operation.fields).any(|(value, field)| {
                    field.kind == FieldKind::Choice
                        && !field.choices.iter().any(|choice| choice.value == *value)
                })
            {
                selected.unrepresentable.push(index);
            } else if values
                .iter()
                .zip(&operation.fields)
                .any(|(value, field)| field.required && value.trim().is_empty())
            {
                selected.transport_rejected.push(index);
            } else if values.iter().zip(&operation.fields).any(|(value, field)| {
                value.contains('\r') || field.kind != FieldKind::Multiline && value.contains('\n')
            }) {
                selected.normalized.push(index);
            } else {
                selected.ui.push(index);
            }
        }
    }
    selected
}
