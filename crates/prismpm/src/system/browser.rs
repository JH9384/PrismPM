//! Closed containing-system profile for an existing generated browser application.

use super::{CanonicalDocument, PrismError, Projection};
use crate::holo::canonical::{content_id, encode_value};
use crate::holo::model_document::ModelDocument;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};

pub(super) const SCHEMA: &str = "prismpm/system-model/2";
pub(super) const MODULE: &str = "Production.BrowserSystem";
pub(super) const CONTROLS: [&str; 4] = [
    "application-acceptance",
    "artifact-closure",
    "source-proof",
    "spdx",
];
pub(crate) const BINDING: &str = "projections/browser-system-release.json";
/// Component kind of the selected browser application; always first.
pub(crate) const BROWSER_COMPONENT: &str = "browser";
/// Component kind of the optional generated command-line program; always second.
pub(crate) const COMMAND_LINE_COMPONENT: &str = "cli";
/// Artifact role of the optional generated command-line program.
pub(crate) const COMMAND_LINE_PROGRAM: &str = "command-line-program";

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2101", message)
}

fn rows<'a>(system: &'a Value, name: &str) -> &'a [Value] {
    system[name].as_array().map_or(&[], Vec::as_slice)
}

/// Whether the system declares the optional command-line component.
pub(crate) fn declares_command_line(system: &Value) -> bool {
    rows(system, "components").len() == 2
}

/// The same exact scalar/list bindings checked by the modeled manifest predicate.
/// The manifest binds the selected application; the system digest binds the
/// optional command-line component with it.
pub(crate) fn certificate(system: &Value) -> Value {
    json!({
        "application_model_digest":system["application_profile"]["application_model_digest"],
        "artifact_id":system["artifacts"][0]["id"],
        "component_id":system["components"][0]["id"],
        "controls":system["controls"],
        "product_id":system["product"]["id"],
        "product_version":system["product"]["version"],
        "target_id":system["targets"][0]["id"]
    })
}

/// Refuse any component graph other than the modeled shapes before schema
/// validation, so the refusal names the closed cardinality instead of a
/// generic contract violation. The shapes are exactly those `validateManifest`
/// admits: one browser component with its selected application, optionally
/// followed by one command-line component with its program artifact, and one
/// browser target.
pub(super) fn validate_shape(system: &Value) -> Result<(), PrismError> {
    let components = rows(system, "components");
    let artifacts = rows(system, "artifacts");
    let targets = rows(system, "targets");
    if components.is_empty() || components.len() > 2 {
        return Err(invalid(
            "browser system admits one browser component and at most one command-line component",
        ));
    }
    if artifacts.len() != components.len() {
        return Err(invalid(
            "browser system admits exactly one generated artifact per component",
        ));
    }
    if targets.len() != 1 {
        return Err(invalid("browser system admits exactly one browser target"));
    }
    if components[0]["kind"] != BROWSER_COMPONENT || artifacts[0]["role"] != "selected-application"
    {
        return Err(invalid(
            "browser system must declare the selected browser application first",
        ));
    }
    if components.len() == 2
        && (components[1]["kind"] != COMMAND_LINE_COMPONENT
            || artifacts[1]["role"] != COMMAND_LINE_PROGRAM)
    {
        return Err(invalid(
            "browser system second component must be the command-line program of the selected application",
        ));
    }
    Ok(())
}

pub(super) fn validate(system: &Value, manifest: &Value) -> Result<(), PrismError> {
    // Closed schema owns cardinalities and profile constants. The authored
    // manifest is never a caller-supplied validity flag.
    validate_shape(system)?;
    let components = rows(system, "components");
    let artifacts = rows(system, "artifacts");
    let ids = std::iter::once(&system["product"]["id"])
        .chain(components.iter().map(|row| &row["id"]))
        .chain(artifacts.iter().map(|row| &row["id"]))
        .chain(rows(system, "targets").iter().map(|row| &row["id"]))
        .collect::<Vec<_>>();
    if ids
        .iter()
        .filter_map(|id| id.as_str())
        .collect::<BTreeSet<_>>()
        .len()
        != ids.len()
        || components
            .iter()
            .zip(artifacts)
            .any(|(component, artifact)| component["artifact"] != artifact["id"])
        || components
            .iter()
            .any(|component| component["version"] != components[0]["version"])
        || &certificate(system) != manifest
    {
        return Err(invalid(
            "browser system identity, reference, or manifest binding differs",
        ));
    }
    let target = &system["targets"][0];
    if target["adapter_digest"] != crate::deployment::digest("github-pages-browser")?
        || target["api_version"] != "github-pages-artifact@v4"
    {
        return Err(PrismError::new(
            "PP7101",
            "browser system target adapter binding differs",
        ));
    }
    Ok(())
}

pub(crate) fn validate_application(
    system: &Value,
    model: &ModelDocument,
) -> Result<(), PrismError> {
    let application = model
        .application
        .as_ref()
        .ok_or_else(|| invalid("browser system requires a selected generated application"))?;
    if !matches!(
        application,
        crate::holo::model_document::Application::Legacy(_)
            | crate::holo::model_document::Application::Text(_)
    ) || !application.capabilities_empty()
        || rows(system, "components")
            .iter()
            .any(|component| component["version"] != application.cargo_version().as_str())
        || system["application_profile"]["application_model_digest"]
            != format!(
                "sha256:{}",
                content_id(&encode_value(
                    &serde_json::to_value(model)
                        .map_err(|error| PrismError::new("PP9001", error.to_string()))?
                )?)
            )
    {
        return Err(invalid(
            "browser system selected application or resource requirements differ",
        ));
    }
    if declares_command_line(system) && application.cli().is_none() {
        return Err(invalid(
            "browser system declares a command-line component, but the selected application models no command line",
        ));
    }
    Ok(())
}

fn binding<T: AsRef<[u8]>>(
    system: &CanonicalDocument,
    files: &BTreeMap<String, T>,
) -> Result<CanonicalDocument, PrismError> {
    let model: ModelDocument = serde_json::from_slice(
        files
            .get("model.prism.json")
            .ok_or_else(|| invalid("browser system selected model is absent"))?
            .as_ref(),
    )
    .map_err(|_| invalid("browser system selected model is malformed"))?;
    validate_application(system.value(), &model)?;
    // Reuse the closed supported application browser profile. No arbitrary
    // prefix-owned bundle or substitute generated UI is accepted.
    crate::oci::browser_export::browser_files(files)?;
    let application = model.application.as_ref().expect("validated application");
    if !files.contains_key(&format!("{}.holo", application.name())) {
        return Err(invalid(
            "browser system generated Holo application is absent",
        ));
    }
    if declares_command_line(system.value()) {
        // The declared command-line artifact is the generated static program
        // set of the selected application, not a caller-supplied binary.
        let crate::holo::model_document::Application::Text(text) = application else {
            return Err(invalid(
                "browser system command-line component requires a text application",
            ));
        };
        if crate::text_cli::TARGETS
            .iter()
            .map(|target| crate::text_cli::binary_path(target, text))
            .chain(std::iter::once(crate::text_cli::sbom::SBOM_PATH.to_owned()))
            .any(|path| !files.contains_key(&path))
        {
            return Err(invalid(
                "browser system generated command-line programs or their SBOM are absent",
            ));
        }
    }
    let rows = files
        .iter()
        .filter(|(path, _)| {
            path.as_str() != "system.prism.json"
                && path.as_str() != "manifest.json"
                && !path.starts_with("projections/")
        })
        .map(|(path, bytes)| {
            json!({
                "digest":format!("sha256:{}", content_id(bytes.as_ref())),
                "path":path,
                "size":bytes.as_ref().len()
            })
        })
        .collect::<Vec<_>>();
    CanonicalDocument::from_value(
        "prismpm/browser-system-release/1",
        json!({
            "application_model_digest":system.value()["application_profile"]["application_model_digest"],
            "artifact":system.value()["artifacts"][0]["id"],
            "component":system.value()["components"][0]["id"],
            "controls":CONTROLS,
            "files":rows,
            "schema":"prismpm/browser-system-release/1",
            "system_digest":system.digest(),
            "target":system.value()["targets"][0]["id"]
        }),
    )
}

pub(super) fn projections(
    system: &CanonicalDocument,
    artifacts: &[(String, Vec<u8>)],
) -> Result<Vec<Projection>, PrismError> {
    let files = artifacts
        .iter()
        .map(|(path, bytes)| (path.clone(), bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    if files.len() != artifacts.len() {
        return Err(invalid(
            "browser system generated artifact paths are duplicated",
        ));
    }
    let binding = binding(system, &files)?;
    Ok(vec![
        Projection {
            path: BINDING.to_owned(),
            media_type: "application/vnd.prismpm.browser-system-release.v1+json".to_owned(),
            bytes: binding.bytes().to_vec(),
        },
        Projection {
            path: "projections/spdx.json".to_owned(),
            media_type: "application/spdx+json".to_owned(),
            bytes: encode_value(&super::spdx(system.value()))?,
        },
    ])
}

/// Recompute the complete deterministic output, independently of a source tree.
pub(crate) fn replay(
    system: &CanonicalDocument,
    files: &BTreeMap<String, Vec<u8>>,
) -> Result<(), PrismError> {
    let expected = [
        (BINDING, binding(system, files)?.bytes().to_vec()),
        (
            "projections/spdx.json",
            encode_value(&super::spdx(system.value()))?,
        ),
    ]
    .into_iter()
    .collect::<BTreeMap<_, _>>();
    let actual = files
        .iter()
        .filter(|(path, _)| path.starts_with("projections/"))
        .map(|(path, bytes)| (path.as_str(), bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    let expected = expected
        .iter()
        .map(|(path, bytes)| (*path, bytes.as_slice()))
        .collect::<BTreeMap<_, _>>();
    if actual != expected {
        return Err(invalid(
            "browser system generated projection or artifact closure differs",
        ));
    }
    Ok(())
}
