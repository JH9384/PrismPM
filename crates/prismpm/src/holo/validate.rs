//! Structural, ordering, profile, and cross-reference model validation.

use super::model_document::{
    Application, ModelDocument, TextApplicationModel, DEFAULT_CORE_MEMORY_PAGES,
    DEFAULT_CORE_STACK_BYTES,
};
use crate::error::PrismError;
use std::collections::BTreeSet;

pub(super) fn digest(value: &str, field: &str) -> Result<(), PrismError> {
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

pub(super) fn identifier(value: &str, field: &str) -> Result<(), PrismError> {
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
        if super::facet_validate::declared(doc) {
            if doc.provenance.facet_packages.is_empty() {
                return Err(PrismError::new(
                    "PP2001",
                    "an application model may carry architecture facet records only when its lexicon closure includes prism.arch, prism.qual and prism.sec",
                ));
            }
            super::facet_validate::validate(doc)?;
        }
        match application {
            Application::Legacy(value) => validate_application(value)?,
            Application::Text(value) => validate_text_application(value)?,
            Application::Browser(value) => super::browser_application::validate(value)?,
        }
        return Ok(());
    }
    super::facet_validate::validate(doc)
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
    // text/3 treats an absent bound as the V1 implicit budget; text/2 requires both.
    let (pages, stack) = if application.profile == "prismpm/text-application/3" {
        (
            Some(
                application
                    .core_memory_pages
                    .unwrap_or(DEFAULT_CORE_MEMORY_PAGES),
            ),
            Some(
                application
                    .core_stack_bytes
                    .unwrap_or(DEFAULT_CORE_STACK_BYTES),
            ),
        )
    } else {
        (application.core_memory_pages, application.core_stack_bytes)
    };
    let resource_profile_valid = match (application.profile.as_str(), pages, stack) {
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
