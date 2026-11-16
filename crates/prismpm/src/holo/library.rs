//! Explicit native-library projection; no implicit application fallback.
//! Facet records come only from the library's own declared modules.

use super::application::{
    exact_fields, member_name, record_with_unevaluated_fields, string, Definitions,
};
use super::model_document::{ModelDocument, ModelLibrary, ProjectionProvenance};
use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use serde_json::Value;
use std::collections::BTreeMap;

mod roots;

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP4004", message)
}

pub(crate) fn qualified(root: &str) -> bool {
    root.len() <= 1024
        && root.contains('.')
        && root.split('.').all(|part| {
            !part.is_empty()
                && (part.as_bytes()[0].is_ascii_alphabetic() || part.starts_with('_'))
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
        })
}

/// Validate the closed native-only metadata independently of source loading.
pub fn validate(library: &ModelLibrary) -> Result<(), PrismError> {
    if library.profile != "prismpm/native-library/1" {
        return Err(invalid("unsupported native-library profile"));
    }
    for (value, maximum) in [(&library.name, 128), (&library.cargo_description, 1024)] {
        if value.trim().is_empty() || value.len() > maximum || value.chars().any(char::is_control) {
            return Err(invalid("native-library display metadata is invalid"));
        }
    }
    let name = &library.cargo_name;
    if name.is_empty()
        || name.len() > 64
        || !name.as_bytes()[0].is_ascii_lowercase()
        || !name.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
        })
    {
        return Err(invalid("native-library Cargo name is invalid"));
    }
    let version = semver::Version::parse(&library.cargo_version)
        .map_err(|_| invalid("native-library Cargo version is invalid"))?;
    if !version.pre.is_empty()
        || !version.build.is_empty()
        || version.to_string() != library.cargo_version
    {
        return Err(invalid(
            "native-library Cargo version must be exact and stable",
        ));
    }
    let uri = jsonschema::options()
        .should_validate_formats(true)
        .build(&serde_json::json!({"type":"string", "format":"uri", "pattern":"^https://"}))
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    for value in [&library.cargo_repository, &library.cargo_homepage] {
        if value.len() > 2048
            || !value.is_ascii()
            || value
                .bytes()
                .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
            || !uri.is_valid(&Value::String(value.clone()))
        {
            return Err(invalid(
                "native-library Cargo URL must be a bounded HTTPS URI",
            ));
        }
    }
    for roots in [&library.export_roots, &library.acceptance_roots] {
        if roots.is_empty()
            || roots.len() > 1024
            || roots.iter().any(|root| !qualified(root))
            || roots.windows(2).any(|rows| rows[0] >= rows[1])
        {
            return Err(invalid(
                "native-library roots must be nonempty, bounded, qualified and strictly ordered",
            ));
        }
    }
    if library
        .acceptance_roots
        .iter()
        .any(|root| library.export_roots.binary_search(root).is_err())
    {
        return Err(invalid(
            "native-library acceptance roots must be declared exports",
        ));
    }
    Ok(())
}

/// Resolve every root against the exact typed source snapshot, before any build.
pub fn validate_roots(
    library: &ModelLibrary,
    snapshot: &SemanticSnapshot,
) -> Result<(), PrismError> {
    validate(library)?;
    let mut declarations = BTreeMap::new();
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let name = format!("{}.{}", module.lean_module(), declaration.lean_name());
            if declarations.insert(name, declaration).is_some() {
                return Err(invalid(
                    "native-library snapshot has duplicate generated declarations",
                ));
            }
        }
    }
    for root in &library.export_roots {
        let declaration = declarations.get(root).ok_or_else(|| {
            PrismError::new(
                "PP2001",
                format!("native-library export {root} is not defined"),
            )
        })?;
        if declaration.kind() != "definition" {
            return Err(PrismError::new(
                "PP2001",
                format!("native-library export {root} is not executable"),
            ));
        }
        if library.acceptance_roots.binary_search(root).is_ok() {
            let value = declaration.linked_ir();
            if !value
                .get("parameters")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
                || value.get("result") != Some(&serde_json::json!({"kind":"bool"}))
            {
                return Err(PrismError::new("PP2001", format!("native-library acceptance root {root} must have type Bool with no parameters")));
            }
        }
    }
    Ok(())
}

/// Project exactly one explicit closed NativeLibrary value, if present.
pub fn project_library(snapshot: &SemanticSnapshot) -> Result<Option<ModelDocument>, PrismError> {
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
        .filter(|((owner, _), declaration)| {
            member_name(declaration) == Some("NativeLibrary")
                && declaration
                    .pointer("/result/member/module")
                    .and_then(Value::as_str)
                    .unwrap_or(owner)
                    == "Foundation.Library.V1.Model"
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
        return Err(invalid(
            "a native-library snapshot requires exactly one closed NativeLibrary value",
        ));
    }
    let ((module, _), declaration) = candidates[0];
    let fields = record_with_unevaluated_fields(
        &definitions,
        module,
        &declaration["body"],
        &["exportRoots", "acceptanceRoots"],
    )?;
    exact_fields(
        &fields,
        &[
            "profile",
            "name",
            "cargoName",
            "cargoVersion",
            "cargoDescription",
            "cargoRepository",
            "cargoHomepage",
            "exportRoots",
            "acceptanceRoots",
        ],
    )?;
    let library = ModelLibrary {
        profile: string(&fields, "profile")?,
        name: string(&fields, "name")?,
        cargo_name: string(&fields, "cargoName")?,
        cargo_version: string(&fields, "cargoVersion")?,
        cargo_description: string(&fields, "cargoDescription")?,
        cargo_repository: string(&fields, "cargoRepository")?,
        cargo_homepage: string(&fields, "cargoHomepage")?,
        export_roots: roots::project(&definitions, &fields, "exportRoots")?,
        acceptance_roots: roots::project(&definitions, &fields, "acceptanceRoots")?,
    };
    validate_roots(&library, snapshot)?;
    // A library keeps the Foundation.Arch, Sec and Qual records its own
    // modules declare (model-document/8); without them it stays /3.
    let (schema, facet_packages, standards_profile, records) =
        match super::facets::application_records(snapshot)? {
            Some((packages, records)) => (
                "prismpm/model-document/8",
                packages,
                super::facets::PROFILE
                    .iter()
                    .map(|value| (*value).to_owned())
                    .collect(),
                Some(records),
            ),
            None => ("prismpm/model-document/3", Vec::new(), Vec::new(), None),
        };
    let (architecture, security, quality) = records.map_or_else(Default::default, |records| {
        (records.architecture, records.security, records.quality)
    });
    let document = ModelDocument {
        schema: schema.to_owned(),
        provenance: ProjectionProvenance {
            source_id: snapshot.source_id().to_string(),
            semantic_id: snapshot.semantic_id().to_string(),
            compiler_semantics_id: snapshot.compiler_semantics_id().to_string(),
            snapshot_id: snapshot.snapshot_id().to_string(),
            emitter_semantics_id: super::projector::compute_emitter_semantics_id(),
            facet_packages,
        },
        standards_profile,
        architecture,
        security,
        quality,
        application: None,
        library: Some(library),
    };
    super::validate::validate(&document)?;
    Ok(Some(document))
}
