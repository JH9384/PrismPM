//! ISO/IEC/IEEE 42010 design views in OPM (ISO/PAS 19450) and UML 2.5.1.
//!
//! A model states its views with the `Foundation.Arch` design primitives
//! (`DesignView` and the `Opm*` and `Uml*` elements, plus the `SystemProcess`
//! and `SystemState` declarations they name). This module projects those
//! declarations out of the semantic snapshot, checks every name against the
//! system model (the components, edges and viewpoints of the model document),
//! and renders each view as a deterministic build artifact: OPL text for OPM
//! and PlantUML source for UML. A model that declares no design primitive
//! produces no artifact and is not otherwise affected.

mod check;
mod group;
mod labels;
mod model;
mod opl;
mod plantuml;

#[cfg(test)]
mod project_tests;
#[cfg(test)]
mod tests;

use crate::error::PrismError;
use crate::holo::ModelDocument;
use check::System;
use lexlean::SemanticSnapshot;
use model::{refuse, Design, Diagram};
use serde_json::{json, Value};
use std::collections::BTreeSet;

/// Build-output directory of the rendered views.
const DIRECTORY: &str = "design";

impl System {
    /// The system model a model document declares.
    fn of(document: &ModelDocument) -> Result<Self, PrismError> {
        let architecture = &document.architecture;
        let component = |index: u64| {
            usize::try_from(index)
                .ok()
                .and_then(|index| architecture.components.get(index))
                .map(|row| row.id.clone())
                .ok_or_else(|| refuse("system model edge endpoint is dangling"))
        };
        let mut edges = std::collections::BTreeMap::new();
        for edge in &architecture.edges {
            edges.insert(
                edge.id.clone(),
                (component(edge.from_index)?, component(edge.to_index)?),
            );
        }
        Ok(Self {
            components: architecture
                .components
                .iter()
                .map(|row| row.id.clone())
                .collect(),
            edges,
            viewpoints: architecture
                .viewpoints
                .iter()
                .map(|row| row.id.clone())
                .collect(),
        })
    }
}

/// File stem of a view identifier: ASCII letters, digits, `.`, `-` and `_`
/// are kept, `::` becomes `.`, and every other character becomes `_`.
fn stem(id: &str) -> String {
    id.replace("::", ".")
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '_') {
                c
            } else {
                '_'
            }
        })
        .collect()
}

/// Check a design against a system model and render its views as
/// `(build-relative path, bytes)` artifacts in view-identifier order.
fn render_design(design: &Design, system: &System) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    if design.is_empty() {
        return Ok(Vec::new());
    }
    check::check(design, system)?;
    let mut groups = group::groups(design)?;
    let mut paths = BTreeSet::new();
    let mut artifacts = Vec::new();
    for view in design.views.values() {
        let group = groups.remove(view.id.as_str()).unwrap_or_default();
        let (extension, text) = match view.diagram {
            Diagram::OpmObjectProcess => ("opl", opl::render(view, &group)),
            _ => (
                "puml",
                plantuml::render(view, &group, system)
                    .ok_or_else(|| refuse(format!("design view {} has no renderer", view.id)))?,
            ),
        };
        let path = format!("{DIRECTORY}/{}.{extension}", stem(&view.id));
        if !paths.insert(path.clone()) {
            return Err(refuse(format!(
                "design view {} renders to the already used artifact path {path}",
                view.id
            )));
        }
        artifacts.push((path, text.into_bytes()));
    }
    Ok(artifacts)
}

/// Check the design views of `definitions` against the system model of
/// `document` and render them.
fn render_definitions<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
    document: &ModelDocument,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    let design = model::project(definitions)?;
    if design.is_empty() {
        return Ok(Vec::new());
    }
    render_design(&design, &System::of(document)?)
}

/// Check the design views a snapshot declares against the system model of the
/// projected model document and render them as build artifacts.
///
/// # Errors
///
/// `PP2012` when a view names a component, edge, process, state or viewpoint
/// the system model does not have, or violates the structure its notation
/// allows.
pub(crate) fn render_snapshot(
    snapshot: &SemanticSnapshot,
    document: &ModelDocument,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    // The features and journeys of the model are 42010 declarations checked on
    // the same snapshot and document, at the same point of `check` and `build`.
    // The Controller owner is source-review pinned, so the check is invoked
    // from here instead of from `prepare_release_in_worker`.
    crate::features::check_snapshot(snapshot, document)?;
    render_definitions(
        snapshot.modules().iter().flat_map(|module| {
            module
                .declarations()
                .iter()
                .filter(|declaration| declaration.kind() == "definition")
                .map(move |declaration| {
                    (
                        module.name(),
                        declaration.logical_id(),
                        declaration.linked_ir(),
                    )
                })
        }),
        document,
    )
}

/// Run the real design-view check over a diagnostic specimen: one component
/// and one viewpoint exist, and one OPM view declares a single object thing
/// that names `specimen["component"]`.
///
/// # Errors
///
/// `PP2012` when the named component is not the specimen system's component.
pub(crate) fn probe(specimen: &Value) -> Result<(), PrismError> {
    let name = specimen["component"]
        .as_str()
        .ok_or_else(|| refuse("design specimen names no component"))?;
    let text = |field: &str, value: &str| json!({"field": field, "value": {"kind": "string", "value": value}});
    let choice = |field: &str, value: &str| json!({"field": field, "value": {"kind": "constructor", "constructor": {"name": value}}});
    let record = |type_name: &str, fields: Vec<Value>| {
        json!({
            "result": {"member": {"name": type_name, "module": "Foundation.Arch"}},
            "body": {"kind": "record", "fields": fields},
        })
    };
    let view = record(
        "DesignView",
        vec![
            text("title", "Probe"),
            text("viewpoint", "Probe::viewpoint"),
            choice("diagram", "DesignDiagram.opmObjectProcess"),
        ],
    );
    let thing = record(
        "OpmThing",
        vec![
            text("view", "Probe::view"),
            choice("kind", "OpmThingKind.object"),
            text("subject", name),
        ],
    );
    let design = model::project([("Probe", "view", &view), ("Probe", "thing", &thing)])?;
    let system = System {
        components: BTreeSet::from(["Probe::component".to_owned()]),
        edges: std::collections::BTreeMap::new(),
        viewpoints: BTreeSet::from(["Probe::viewpoint".to_owned()]),
    };
    render_design(&design, &system).map(|_| ())
}
