//! Source projection for the closed browser orchestration declaration.
//!
//! Declaration acceptance is not runtime, effective-permission or release acceptance.

mod model;
mod source;
pub use model::{
    BrowserApplication, BrowserView, Durability, Label, RequestedAdapter, RequestedEffect,
};

use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

/// Exact source namespace owning this declaration.
pub const MODULE: &str = "Foundation.Browser.Application.V1.Model";
/// Explicit browser application profile, never a portable-profile alias.
pub const PROFILE: &str = "prismpm/browser-application/1";

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2010", message)
}

/// Fail closed until generated orchestration, custody and recovery are available.
pub fn require_runtime(application: &super::model_document::Application) -> Result<(), PrismError> {
    if matches!(application, super::model_document::Application::Browser(_)) {
        return Err(PrismError::new("PP2011", "browser application runtime, effective-grant admission, credential custody and durable uncertain-operation recovery are not implemented"));
    }
    Ok(())
}

fn bounded_text(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty() && value.len() <= maximum && !value.chars().any(char::is_control)
}

fn slug(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-'))
}

fn context(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/' | b':'))
}

fn signature_context(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.as_bytes()[0].is_ascii_alphanumeric()
        && !value.contains("..")
        && value
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'.' | b'_' | b'-' | b'/'))
}

fn memory(input: u32, output: u32, pages: u32) -> bool {
    input > 0
        && output > 0
        && (1..=16384).contains(&pages)
        && u64::from(input) + u64::from(output) <= u64::from(pages) * 65536
}

/// Validate metadata and source requests only; none of these records grants effects.
pub fn validate(value: &BrowserApplication) -> Result<(), PrismError> {
    // Share established package syntax without sharing application profile semantics.
    let package = super::model_document::ModelLibrary {
        profile: "prismpm/native-library/1".into(),
        name: value.name.clone(),
        cargo_name: value.cargo_name.clone(),
        cargo_version: value.cargo_version.clone(),
        cargo_description: value.cargo_description.clone(),
        cargo_repository: value.cargo_repository.clone(),
        cargo_homepage: value.cargo_homepage.clone(),
        export_roots: value.library_roots.clone(),
        acceptance_roots: vec![value.entry_root.clone()],
    };
    super::library::validate(&package)
        .map_err(|_| invalid("browser application package or root syntax is invalid"))?;
    if value.profile != PROFILE
        || value.protocol != "prismpm/browser-application-session/1"
        || value.core_contract != "hologram:guest/core-wasm@1"
        || !value.capabilities_empty
        || !value.fat_archive
        || value.primary_layer != 0
        || value.view_layer != 1
        || value.request_maximum == 0
        || value.request_maximum > 67_108_864
        || value.response_maximum > 67_108_864
        || value.guest_allocation_maximum < value.request_maximum
        || value.guest_allocation_maximum > 67_108_864
        || !memory(
            value.guest_allocation_maximum,
            value.response_maximum,
            value.memory_pages,
        )
    {
        return Err(invalid(
            "browser application protocol or declared finite bounds are invalid",
        ));
    }
    let mut requests = BTreeSet::new();
    let mut total = 0usize;
    if value.acceptance_vectors.is_empty()
        || value.acceptance_vectors.len() > 256
        || value.acceptance_vectors.iter().any(|v| {
            total = total
                .saturating_add(v.request.len())
                .saturating_add(v.response.len());
            v.request.len() > value.guest_allocation_maximum as usize
                || v.response.len() > value.response_maximum as usize
                || total > 24576
                || !requests.insert(&v.request)
        })
    {
        return Err(invalid("browser declaration requires bounded unique finite vectors with at most 24576 aggregate bytes"));
    }
    if value.requested_effects.is_empty()
        || value.requested_effects.len() > 64
        || value
            .requested_effects
            .windows(2)
            .any(|p| p[0].resource >= p[1].resource)
    {
        return Err(invalid(
            "requested resources must be nonempty, bounded and strictly ordered",
        ));
    }
    let mut namespaces = BTreeSet::new();
    for grant in &value.requested_effects {
        if !slug(&grant.resource) {
            return Err(invalid("requested resource identifier is invalid"));
        }
        let valid = match &grant.adapter {
            RequestedAdapter::Guest {
                entry_root,
                protocol,
                input_maximum,
                output_maximum,
                memory_pages,
            } => {
                value.library_roots.binary_search(entry_root).is_ok()
                    && context(protocol)
                    && *input_maximum <= 2_097_152
                    && *output_maximum <= 2_097_152
                    && memory(*input_maximum, *output_maximum, *memory_pages)
            }
            RequestedAdapter::Random { maximum } => (1..=65536).contains(maximum),
            RequestedAdapter::Digest { maximum } => (1..=1_048_576).contains(maximum),
            RequestedAdapter::Sign {
                credential_slot,
                context: domain,
                maximum,
            } => {
                slug(credential_slot)
                    && signature_context(domain)
                    && (1..=1_048_576).contains(maximum)
            }
            RequestedAdapter::Verify {
                context: domain,
                maximum,
            } => signature_context(domain) && (1..=1_048_576).contains(maximum),
            RequestedAdapter::Store {
                namespace,
                max_object_bytes,
                max_objects,
                max_heads,
            } => {
                slug(namespace)
                    && namespaces.insert(namespace)
                    && (1..=1_048_576).contains(max_object_bytes)
                    && (1..=4096).contains(max_objects)
                    && (1..=64).contains(max_heads)
            }
        };
        if !valid {
            return Err(invalid("requested effect payload or bound is invalid"));
        }
    }
    let durable = &value.durability;
    if durable.protocol != "prismpm/browser-operation-journal/1"
        || durable.max_pending != 1
        || !slug(&durable.resource)
        || !slug(&durable.namespace)
        || !slug(&durable.head)
        || !slug(&durable.staging_head)
        || durable.head == durable.staging_head
        || !slug(&durable.signing_resource)
        || durable.resource == durable.signing_resource
        || !slug(&durable.credential_slot)
        || !(2..=1024).contains(&durable.maximum_records)
        || namespaces.contains(&durable.namespace)
        || value
            .library_roots
            .binary_search(&durable.replay_root)
            .is_err()
        || value.requested_effects.iter().any(|r| {
            r.resource == durable.resource
                || r.resource == durable.signing_resource
                || matches!(&r.adapter, RequestedAdapter::Sign { credential_slot, context, .. }
                    if credential_slot == &durable.credential_slot
                        && context == "prismpm/browser-operation-journal/1")
        })
        || value
            .requested_effects
            .iter()
            .filter(|r| matches!(r.adapter, RequestedAdapter::Sign { .. }))
            .count()
            >= 64
    {
        return Err(invalid("browser application requires isolated private journal storage and signing requests, bounded history, and a generated single-operation replay root"));
    }
    let view = &value.view;
    if view.surface != "prismpm-browser/1"
        || view.protocol != "prismpm/browser-presentation/1"
        || !bounded_text(&view.title, 256)
        || !bounded_text(&view.heading, 256)
        || value
            .library_roots
            .binary_search(&view.presentation_root)
            .is_err()
        || view.maximum == 0
        || view.maximum > value.response_maximum
        || view.labels.is_empty()
        || view.labels.len() > 256
        || view.labels.windows(2).any(|p| p[0].id >= p[1].id)
        || view
            .labels
            .iter()
            .any(|v| !slug(&v.id) || !bounded_text(&v.text, 4096))
    {
        return Err(invalid("browser View must declare bounded ordered plain-text labels and a generated presentation root"));
    }
    Ok(())
}

/// Resolve every executable root against the actual checked semantic graph.
pub fn validate_roots(
    value: &BrowserApplication,
    snapshot: &SemanticSnapshot,
) -> Result<(), PrismError> {
    validate(value)?;
    let mut declarations = BTreeMap::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let name = format!("{}.{}", module.lean_module(), declaration.lean_name());
            if declarations.insert(name, declaration).is_some() {
                return Err(invalid("duplicate generated source declaration"));
            }
        }
    }
    let bytes = json!({"kind":"bytes"});
    for root in &value.library_roots {
        let declaration = declarations
            .get(root)
            .ok_or_else(|| invalid("browser executable root is unresolved"))?;
        let ir = declaration.linked_ir();
        if declaration.kind() != "definition"
            || ir.get("result") != Some(&bytes)
            || !ir
                .get("parameters")
                .and_then(Value::as_array)
                .is_some_and(|p| p.len() == 1 && p[0].get("type") == Some(&bytes))
            || ir
                .get("type_parameters")
                .is_some_and(|p| !p.as_array().is_some_and(Vec::is_empty))
        {
            return Err(invalid(
                "browser executable roots must be monomorphic Bytes to Bytes definitions",
            ));
        }
    }
    Ok(())
}

pub(super) use source::project;
