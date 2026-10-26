//! Total projection from the stable LexLean semantic snapshot.

use super::facets::{exact_closure, snapshot_records, FacetRecords, PROFILE};
use super::model_document::{ModelDocument, ProjectionProvenance};
use crate::error::PrismError;
use lexlean::artifact::snapshot::snapshot_spec;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use sha2::{Digest, Sha256};

/// Validate the stable snapshot envelope before semantic projection.
pub fn validate_snapshot_envelope(bytes: &[u8]) -> Result<(), PrismError> {
    let value: Value = serde_json::from_slice(bytes)
        .map_err(|error| PrismError::new("PP4004", format!("semantic snapshot: {error}")))?;
    let supported = value
        .get("language")
        .and_then(Value::as_str)
        .is_some_and(|language| {
            matches!(language, "1.1" | "1.2")
                && value.get("spec").and_then(Value::as_str) == Some(snapshot_spec(language))
        });
    if !supported || !value.get("modules").is_some_and(Value::is_array) {
        return Err(PrismError::new("PP4004", "unsupported semantic snapshot"));
    }
    Ok(())
}

/// Project one checked LexLean snapshot without filesystem writes or child processes.
pub fn project_snapshot(snapshot: &SemanticSnapshot) -> Result<ModelDocument, PrismError> {
    let language = snapshot.language();
    if !matches!(language, "1.1" | "1.2") || snapshot.spec() != snapshot_spec(language) {
        return Err(PrismError::new("PP4004", "unsupported semantic snapshot"));
    }
    let FacetRecords {
        architecture,
        security,
        quality,
    } = snapshot_records(snapshot)?;
    let doc = ModelDocument {
        schema: "prismpm/model-document/1".to_owned(),
        provenance: ProjectionProvenance {
            source_id: snapshot.source_id().to_string(),
            semantic_id: snapshot.semantic_id().to_string(),
            compiler_semantics_id: snapshot.compiler_semantics_id().to_string(),
            snapshot_id: snapshot.snapshot_id().to_string(),
            emitter_semantics_id: compute_emitter_semantics_id(),
            facet_packages: exact_closure(snapshot)?,
        },
        standards_profile: PROFILE.iter().map(|value| (*value).to_owned()).collect(),
        architecture,
        security,
        quality,
        application: None,
        library: None,
    };
    super::validate::validate(&doc)?;
    Ok(doc)
}

/// Compute the canonical tree digest of the exact declared emitter inputs.
#[must_use]
pub fn compute_emitter_semantics_id() -> String {
    const INPUTS: [(&str, &[u8]); 31] = [
        (
            "crates/prismpm/src/application_build.rs",
            include_bytes!("../application_build.rs"),
        ),
        (
            "crates/prismpm/src/holo/application.rs",
            include_bytes!("application.rs"),
        ),
        (
            "crates/prismpm/src/holo/application/workbench.rs",
            include_bytes!("application/workbench.rs"),
        ),
        (
            "crates/prismpm/src/holo/browser_application.rs",
            include_bytes!("browser_application.rs"),
        ),
        (
            "crates/prismpm/src/holo/browser_application/model.rs",
            include_bytes!("browser_application/model.rs"),
        ),
        (
            "crates/prismpm/src/holo/browser_application/source.rs",
            include_bytes!("browser_application/source.rs"),
        ),
        (
            "crates/prismpm/src/holo/canonical.rs",
            include_bytes!("canonical.rs"),
        ),
        (
            "crates/prismpm/src/holo/facet_validate.rs",
            include_bytes!("facet_validate.rs"),
        ),
        (
            "crates/prismpm/src/holo/facets.rs",
            include_bytes!("facets.rs"),
        ),
        (
            "crates/prismpm/src/holo/facets/records.rs",
            include_bytes!("facets/records.rs"),
        ),
        (
            "crates/prismpm/src/holo/facets/standards.rs",
            include_bytes!("facets/standards.rs"),
        ),
        (
            "crates/prismpm/src/holo/library.rs",
            include_bytes!("library.rs"),
        ),
        (
            "crates/prismpm/src/holo/library/roots.rs",
            include_bytes!("library/roots.rs"),
        ),
        ("crates/prismpm/src/holo/mod.rs", include_bytes!("mod.rs")),
        (
            "crates/prismpm/src/holo/model_document.rs",
            include_bytes!("model_document.rs"),
        ),
        (
            "crates/prismpm/src/holo/projector.rs",
            include_bytes!("projector.rs"),
        ),
        (
            "crates/prismpm/src/holo/text_cli.rs",
            include_bytes!("text_cli.rs"),
        ),
        (
            "crates/prismpm/src/holo/validate.rs",
            include_bytes!("validate.rs"),
        ),
        (
            "crates/prismpm/src/holo/workbench.rs",
            include_bytes!("workbench.rs"),
        ),
        (
            "crates/prismpm/src/workbench.rs",
            include_bytes!("../workbench.rs"),
        ),
        (
            "crates/prismpm/src/workbench/runtime.js",
            include_bytes!("../workbench/runtime.js"),
        ),
        (
            "crates/prismpm/src/workbench/style.css",
            include_bytes!("../workbench/style.css"),
        ),
        (
            "model/projection.toml",
            include_bytes!("../../model/projection.toml"),
        ),
        (
            "model/standards.toml",
            include_bytes!("../../model/standards.toml"),
        ),
        (
            "schemas/model-document-v2.schema.json",
            include_bytes!("../../schemas/model-document-v2.schema.json"),
        ),
        (
            "schemas/model-document-v3.schema.json",
            include_bytes!("../../schemas/model-document-v3.schema.json"),
        ),
        (
            "schemas/model-document-v4.schema.json",
            include_bytes!("../../schemas/model-document-v4.schema.json"),
        ),
        (
            "schemas/model-document-v5.schema.json",
            include_bytes!("../../schemas/model-document-v5.schema.json"),
        ),
        (
            "schemas/model-document-v6.schema.json",
            include_bytes!("../../schemas/model-document-v6.schema.json"),
        ),
        (
            "schemas/model-document.schema.json",
            include_bytes!("../../schemas/model-document.schema.json"),
        ),
        (
            "schemas/workbench-view-projection.schema.json",
            include_bytes!("../../schemas/workbench-view-projection.schema.json"),
        ),
    ];
    let mut hasher = Sha256::new();
    for (path, bytes) in INPUTS {
        hasher.update((path.len() as u64).to_be_bytes());
        hasher.update(path.as_bytes());
        hasher.update((bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    format!("{:x}", hasher.finalize())
}
