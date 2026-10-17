//! Structural, ordering, profile, and cross-reference model validation.

use super::model_document::{Application, ModelDocument, TextApplicationModel};
use crate::error::PrismError;
use std::collections::BTreeSet;

const PROFILE: [&str; 5] = [
    "ISO-25010-2023",
    "ISO-27005-2022",
    "ISO-27034-1-2011",
    "ISO-27034-5-2017",
    "ISO-42010-2022",
];

fn digest(value: &str, field: &str) -> Result<(), PrismError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(PrismError::new(
            "PP4004",
            format!("{field} is not a lowercase SHA-256 digest"),
        ))
    }
}

fn identifier(value: &str, field: &str) -> Result<(), PrismError> {
    if value.is_empty()
        || !value.is_ascii()
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'.' | b':' | b'@' | b'-' | b'_')
        })
    {
        return Err(PrismError::new(
            "PP4004",
            format!("{field} is not a qualified ASCII identifier"),
        ));
    }
    Ok(())
}

fn ordered<'a>(
    kind: &str,
    rows: impl IntoIterator<Item = (&'a str, u64)>,
) -> Result<BTreeSet<String>, PrismError> {
    let rows: Vec<_> = rows.into_iter().collect();
    let mut ids = BTreeSet::new();
    let mut previous: Option<&str> = None;
    for (expected, (id, index)) in rows.iter().enumerate() {
        identifier(id, kind)?;
        if !ids.insert((*id).to_owned()) {
            return Err(PrismError::new(
                "PP4004",
                format!("duplicate {kind} ID {id}"),
            ));
        }
        if previous.is_some_and(|prior| prior.as_bytes() >= id.as_bytes()) {
            return Err(PrismError::new(
                "PP4004",
                format!("{kind} IDs are not in canonical ASCII order"),
            ));
        }
        if *index != expected as u64 {
            return Err(PrismError::new(
                "PP4004",
                format!("{kind} {id} has index {index}, expected {expected}"),
            ));
        }
        previous = Some(id);
    }
    Ok(ids)
}

fn contains_index<T>(rows: &[T], index: u64) -> bool {
    usize::try_from(index).is_ok_and(|value| value < rows.len())
}

/// Validate a model-document DTO before encoding or after strict decoding.
pub fn validate(doc: &ModelDocument) -> Result<(), PrismError> {
    let expected_schema = if doc.library.is_some() {
        "prismpm/model-document/3"
    } else if matches!(&doc.application, Some(Application::Browser(_))) {
        "prismpm/model-document/4"
    } else if let Some(Application::Text(application)) = &doc.application {
        if application.profile == "prismpm/text-application/3" {
            "prismpm/model-document/6"
        } else if application.profile == "prismpm/text-application/2" {
            "prismpm/model-document/5"
        } else {
            "prismpm/model-document/2"
        }
    } else {
        "prismpm/model-document/1"
    };
    if doc.schema != expected_schema {
        return Err(PrismError::new(
            "PP4004",
            "unsupported model-document schema",
        ));
    }
    digest(&doc.provenance.source_id, "source_id")?;
    digest(&doc.provenance.semantic_id, "semantic_id")?;
    digest(
        &doc.provenance.compiler_semantics_id,
        "compiler_semantics_id",
    )?;
    digest(&doc.provenance.snapshot_id, "snapshot_id")?;
    digest(&doc.provenance.emitter_semantics_id, "emitter_semantics_id")?;
    if let Some(library) = &doc.library {
        if doc.application.is_some()
            || !doc.standards_profile.is_empty()
            || !doc.provenance.facet_packages.is_empty()
            || doc.architecture != Default::default()
            || doc.security != Default::default()
            || doc.quality != Default::default()
        {
            return Err(PrismError::new(
                "PP4004",
                "native libraries cannot declare application or facet records",
            ));
        }
        return super::library::validate(library);
    }
    if let Some(application) = &doc.application {
        if !doc.standards_profile.is_empty()
            || !doc.provenance.facet_packages.is_empty()
            || doc.architecture != Default::default()
            || doc.security != Default::default()
            || doc.quality != Default::default()
        {
            return Err(PrismError::new(
                "PP2001",
                "an application model may not contain architecture facet records",
            ));
        }
        match application {
            Application::Legacy(value) => validate_application(value)?,
            Application::Text(value) => {
                validate_text_application(value)?;
                if value.workbench.is_some() && value.profile != super::workbench::PROFILE {
                    return Err(PrismError::new(
                        "PP2009",
                        "a workbench is admitted only by the text/3 profile",
                    ));
                }
                if let Some(workbench) = value.workbench_application() {
                    super::workbench::validate(&workbench)?;
                    // Web and command line state one purpose: the CLI help
                    // paragraph is the workbench purpose plus its line end.
                    let description = value.cli.as_ref().map(|cli| cli.description.as_str());
                    if description.map(|text| text.strip_suffix('\n').unwrap_or(text))
                        != Some(workbench.view.purpose.as_str())
                    {
                        return Err(PrismError::new(
                            "PP2009",
                            "a text/3 workbench purpose must equal its command-line description",
                        ));
                    }
                }
            }
            Application::Browser(value) => super::browser_application::validate(value)?,
        }
        return Ok(());
    }
    if doc
        .standards_profile
        .iter()
        .map(String::as_str)
        .collect::<Vec<_>>()
        != PROFILE
    {
        return Err(PrismError::new("PP2001", "standards profile is not exact"));
    }
    let packages: Vec<_> = doc
        .provenance
        .facet_packages
        .iter()
        .map(|row| row.package.as_str())
        .collect();
    if packages != ["prism.arch", "prism.qual", "prism.sec"] {
        return Err(PrismError::new("PP2001", "facet package list is not exact"));
    }
    for package in &doc.provenance.facet_packages {
        identifier(&package.package, "facet package")?;
        if package.version != "1.0.0" {
            return Err(PrismError::new("PP2001", "facet version is not exact"));
        }
        digest(&package.content_id, "facet content_id")?;
    }

    let component_kinds = ordered(
        "component kind",
        doc.architecture
            .component_kinds
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    let edge_kinds = ordered(
        "edge kind",
        doc.architecture
            .edge_kinds
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "model kind",
        doc.architecture
            .model_kinds
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "component",
        doc.architecture
            .components
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.architecture.components {
        if !component_kinds.contains(&row.kind_id) {
            return Err(PrismError::new("PP2001", "component kind is unresolved"));
        }
    }
    ordered(
        "edge",
        doc.architecture
            .edges
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.architecture.edges {
        if !contains_index(&doc.architecture.components, row.from_index)
            || !contains_index(&doc.architecture.components, row.to_index)
        {
            return Err(PrismError::new("PP2004", "edge endpoint is dangling"));
        }
        if !edge_kinds.contains(&row.kind_id) {
            return Err(PrismError::new("PP2001", "edge kind is unresolved"));
        }
    }
    ordered(
        "stakeholder",
        doc.architecture
            .stakeholders
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "concern",
        doc.architecture
            .concerns
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "viewpoint",
        doc.architecture
            .viewpoints
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.architecture.viewpoints {
        if !contains_index(&doc.architecture.stakeholders, row.stakeholder_index)
            || !contains_index(&doc.architecture.concerns, row.concern_index)
            || !contains_index(&doc.architecture.model_kinds, row.model_kind_index)
        {
            return Err(PrismError::new("PP2001", "viewpoint link is unresolved"));
        }
    }
    ordered(
        "view",
        doc.architecture
            .views
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.architecture.views {
        if !contains_index(&doc.architecture.viewpoints, row.viewpoint_index)
            || !contains_index(&doc.architecture.model_kinds, row.model_kind_index)
        {
            return Err(PrismError::new("PP2001", "view link is unresolved"));
        }
    }

    let likelihoods = ordered(
        "likelihood",
        doc.security
            .likelihoods
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    let impacts = ordered(
        "impact",
        doc.security
            .impacts
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "asset",
        doc.security
            .assets
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.security.assets {
        if !contains_index(&doc.architecture.components, row.component_index) {
            return Err(PrismError::new("PP2005", "asset component is unresolved"));
        }
    }
    ordered(
        "threat",
        doc.security
            .threats
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "risk",
        doc.security
            .risks
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.security.risks {
        if !contains_index(&doc.security.assets, row.asset_index)
            || !contains_index(&doc.security.threats, row.threat_index)
            || !likelihoods.contains(&row.likelihood_id)
            || !impacts.contains(&row.impact_id)
        {
            return Err(PrismError::new("PP2005", "risk link is unresolved"));
        }
    }
    ordered(
        "control",
        doc.security
            .controls
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.security.controls {
        if !contains_index(&doc.security.risks, row.risk_index) {
            return Err(PrismError::new("PP2006", "control risk is unresolved"));
        }
    }
    ordered(
        "activity",
        doc.security
            .activities
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.security.activities {
        if !contains_index(&doc.security.controls, row.control_index) {
            return Err(PrismError::new("PP2006", "activity control is unresolved"));
        }
    }
    ordered(
        "measurement",
        doc.security
            .measurements
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.security.measurements {
        if !contains_index(&doc.security.controls, row.control_index) {
            return Err(PrismError::new(
                "PP2006",
                "measurement control is unresolved",
            ));
        }
    }

    ordered(
        "quality characteristic",
        doc.quality
            .characteristics
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    ordered(
        "quality subcharacteristic",
        doc.quality
            .subcharacteristics
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.quality.subcharacteristics {
        if !contains_index(&doc.quality.characteristics, row.characteristic_index) {
            return Err(PrismError::new(
                "PP2007",
                "quality characteristic is unresolved",
            ));
        }
    }
    ordered(
        "quality requirement",
        doc.quality
            .requirements
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.quality.requirements {
        if !contains_index(&doc.quality.subcharacteristics, row.subcharacteristic_index) {
            return Err(PrismError::new("PP2007", "subcharacteristic is unresolved"));
        }
    }
    ordered(
        "quality measure",
        doc.quality
            .measures
            .iter()
            .map(|row| (row.id.as_str(), row.index)),
    )?;
    for row in &doc.quality.measures {
        if !contains_index(&doc.quality.requirements, row.requirement_index) {
            return Err(PrismError::new(
                "PP2007",
                "measure requirement is unresolved",
            ));
        }
    }
    Ok(())
}

pub(crate) fn validate_text_application(
    application: &TextApplicationModel,
) -> Result<(), PrismError> {
    let invalid = |message| PrismError::new("PP2009", message);
    static HTTPS_URI: std::sync::OnceLock<jsonschema::Validator> = std::sync::OnceLock::new();
    let https_uri = HTTPS_URI.get_or_init(|| {
        jsonschema::options()
            .should_validate_formats(true)
            .build(&serde_json::json!({
                "type": "string",
                "format": "uri",
                "pattern": "^https://[^/?#]+"
            }))
            .expect("static HTTPS URI schema")
    });
    let cargo_name = &application.cargo_name;
    let name = &application.name;
    let version = semver::Version::parse(&application.cargo_version).map_err(|_| {
        invalid("text application Cargo version is not canonical major.minor.patch")
    })?;
    if name.is_empty()
        || name.len() > 128
        || !name.as_bytes()[0].is_ascii_alphanumeric()
        || !name
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.' | b' '))
        || name.ends_with(['.', ' '])
        || cargo_name.is_empty()
        || cargo_name.len() > 64
        || !cargo_name.as_bytes()[0].is_ascii_lowercase()
        || !cargo_name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
        || !version.pre.is_empty()
        || !version.build.is_empty()
        || version.to_string() != application.cargo_version
        || [&application.name, &application.cargo_description]
            .iter()
            .any(|value| value.trim().is_empty() || value.chars().any(char::is_control))
        || [&application.cargo_repository, &application.cargo_homepage]
            .iter()
            .any(|value| {
                !https_uri.is_valid(&serde_json::Value::String((*value).clone()))
                    || !value.is_ascii()
                    || value
                        .bytes()
                        .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
            })
    {
        return Err(invalid("text application package metadata is invalid"));
    }
    let valid_root = |root: &str| {
        root.contains('.')
            && root.split('.').all(|part| {
                !part.is_empty()
                    && (part.as_bytes()[0].is_ascii_alphabetic() || part.starts_with('_'))
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
            })
    };
    let resource_profile_valid = match (
        application.profile.as_str(),
        application.core_memory_pages,
        application.core_stack_bytes,
    ) {
        ("prismpm/text-application/1", None, None) => true,
        ("prismpm/text-application/2" | "prismpm/text-application/3", Some(pages), Some(stack)) => {
            let bytes = u64::from(pages) * 65_536;
            (1..=32_767).contains(&pages)
                && stack > 0
                && stack % 16 == 0
                && u64::from(stack) < bytes
                && u64::from(application.request_maximum) <= bytes
                && u64::from(application.response_maximum) <= bytes
                && u64::from(application.guest_allocation_maximum) <= bytes
        }
        _ => false,
    };
    let command_surface_valid = matches!(
        (application.profile.as_str(), &application.cli),
        ("prismpm/text-application/3", Some(_))
            | (
                "prismpm/text-application/1" | "prismpm/text-application/2",
                None
            )
    );
    if !resource_profile_valid
        || !command_surface_valid
        || application.core_contract != "hologram:guest/core-wasm@1"
        || application.request_maximum == 0
        || application.response_maximum == 0
        || application.guest_allocation_maximum < application.request_maximum
        || !application.capabilities_empty
        || !application.fat_archive
        || application.primary_layer != 0
        || application.view_layer != 1
        || application.library_roots.is_empty()
        || !valid_root(&application.entry_root)
        || !application.library_roots.contains(&application.entry_root)
        || application
            .library_roots
            .iter()
            .any(|root| !valid_root(root))
        || application
            .library_roots
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
    {
        return Err(invalid(
            "text application declaration violates its closed byte-request profile",
        ));
    }
    for label in [
        &application.view.title,
        &application.view.heading,
        &application.view.input_label,
        &application.view.submit_label,
        &application.view.output_label,
        &application.view.input_error,
        &application.view.response_error,
    ] {
        if label.trim().is_empty() || label.chars().any(char::is_control) {
            return Err(invalid(
                "text View labels must be nonempty Unicode text without control characters",
            ));
        }
    }
    let mut requests = BTreeSet::new();
    if application.acceptance_vectors.is_empty()
        || !application
            .acceptance_vectors
            .iter()
            .any(|vector| vector.request.len() == application.guest_allocation_maximum as usize)
        || application.acceptance_vectors.iter().any(|vector| {
            vector.request.len() > application.guest_allocation_maximum as usize
                || vector.response.len() > application.response_maximum as usize
                || std::str::from_utf8(&vector.response).is_err()
                || !requests.insert(&vector.request)
        })
    {
        return Err(invalid(
            "text acceptance vectors must have unique guest-allocation-bounded requests, an exact allocation-boundary vector, and bounded UTF-8 responses",
        ));
    }
    if let Some(cli) = &application.cli {
        super::text_cli::validate(cli, application)?;
    }
    Ok(())
}

fn validate_application(
    application: &super::model_document::ApplicationModel,
) -> Result<(), PrismError> {
    for (value, field) in [
        (&application.name, "application name"),
        (&application.cargo_name, "Cargo package name"),
        (&application.cargo_version, "Cargo package version"),
        (&application.cargo_description, "Cargo package description"),
        (&application.cargo_repository, "Cargo repository"),
        (&application.cargo_homepage, "Cargo homepage"),
        (&application.operation_type, "operation type"),
        (&application.error_type, "error type"),
        (&application.function_name, "function name"),
        (&application.entry_root, "entry root"),
        (&application.core_contract, "core contract"),
    ] {
        if value.is_empty() || !value.is_ascii() {
            return Err(PrismError::new(
                "PP2001",
                format!("{field} is empty or non-ASCII"),
            ));
        }
    }
    if application.request_maximum == 0
        || application.response_maximum == 0
        || application.guest_allocation_maximum < application.request_maximum
        || !application.capabilities_empty
        || !application.fat_archive
        || application.primary_layer != 0
        || application.view_layer != 1
        || !application.view.live_polite
        || !application.view.retain_focus
        || !application.view.submit_on_enter
        || !application.view.hologram_intent
        || !application.view.pages_adapter
        || application.actions.is_empty()
        || application.targets.is_empty()
        || application.library_roots.is_empty()
        || application.view.operations.is_empty()
        || application.acceptance_vectors.is_empty()
        || !application
            .view
            .operations
            .iter()
            .any(|operation| operation.discriminant == application.view.initial_operation)
    {
        return Err(PrismError::new(
            "PP2001",
            "application declaration violates the portable application contract",
        ));
    }
    let mut actions = BTreeSet::new();
    let mut targets = BTreeSet::new();
    let mut library_roots = BTreeSet::new();
    let mut operation_labels = BTreeSet::new();
    let mut operation_names = BTreeSet::new();
    let mut operation_variants = BTreeSet::new();
    let mut operation_discriminants = BTreeSet::new();
    let mut acceptance_requests = BTreeSet::new();
    if application
        .actions
        .iter()
        .any(|value| !actions.insert(value))
        || application
            .targets
            .iter()
            .any(|value| !targets.insert(value))
        || application
            .library_roots
            .iter()
            .any(|value| !library_roots.insert(value))
        || application.view.operations.iter().any(|operation| {
            operation.label.is_empty()
                || operation.request_name.is_empty()
                || operation.rust_variant.is_empty()
                || !operation_labels.insert(&operation.label)
                || !operation_names.insert(&operation.request_name)
                || !operation_variants.insert(&operation.rust_variant)
                || !operation_discriminants.insert(operation.discriminant)
        })
        || application
            .library_roots
            .windows(2)
            .any(|pair| pair[0] >= pair[1])
        || application
            .acceptance_vectors
            .iter()
            .any(|vector| !acceptance_requests.insert(&vector.request))
    {
        return Err(PrismError::new(
            "PP2001",
            "application roots, actions, targets, or View operations are invalid or duplicated",
        ));
    }
    Ok(())
}
