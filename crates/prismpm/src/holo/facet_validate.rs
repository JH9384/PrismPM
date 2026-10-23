//! Facet record validation: profile, package closure, ordering, and cross-references.
//!
//! The same checks run for a standalone facet document and for an application
//! document that carries the application's own facet records.

use super::facets::PROFILE;
use super::model_document::ModelDocument;
use super::validate::{digest, identifier};
use crate::error::PrismError;
use std::collections::BTreeSet;

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

/// Longest accepted name, in characters.
const NAME_LIMIT: usize = 256;
/// Longest accepted descriptive text, in characters.
const TEXT_LIMIT: usize = 4096;

/// A name carries no control characters; a text carries none but line feeds.
/// Both are bounded. The empty string is the absent value of an older source.
fn described(kind: &str, name: &str, text: &str) -> Result<(), PrismError> {
    if name.chars().count() > NAME_LIMIT
        || name.chars().any(char::is_control)
        || text.chars().count() > TEXT_LIMIT
        || text
            .chars()
            .any(|value| value.is_control() && value != '\n')
    {
        return Err(PrismError::new(
            "PP2001",
            format!("{kind} name or text is out of bounds"),
        ));
    }
    Ok(())
}

fn contains_index<T>(rows: &[T], index: u64) -> bool {
    usize::try_from(index).is_ok_and(|value| value < rows.len())
}

/// True when the document declares any facet profile, package, or record.
pub(super) fn declared(doc: &ModelDocument) -> bool {
    !doc.standards_profile.is_empty()
        || !doc.provenance.facet_packages.is_empty()
        || doc.architecture != Default::default()
        || doc.security != Default::default()
        || doc.quality != Default::default()
}

/// Validate the facet sections of a document: exact profile, exact package
/// closure, canonical ordering and indexes, and every cross-reference.
pub(super) fn validate(doc: &ModelDocument) -> Result<(), PrismError> {
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
        described("component", &row.name, &row.text)?;
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
    for row in doc
        .architecture
        .stakeholders
        .iter()
        .chain(&doc.architecture.concerns)
    {
        described("stakeholder or concern", &row.name, &row.text)?;
    }
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

#[cfg(test)]
mod tests {
    use super::described;

    #[test]
    fn names_and_text_are_bounded_and_free_of_control_characters() {
        described("component", "api", "line one\nline two").unwrap();
        described("component", "", "").unwrap();
        for (name, text) in [
            ("a\nb", ""),
            ("", "a\tb"),
            ("", "a\u{7f}b"),
            (&"n".repeat(257), ""),
            ("", &"t".repeat(4097)),
        ] {
            assert_eq!(
                described("component", name, text).unwrap_err().code,
                "PP2001"
            );
        }
        described("component", &"n".repeat(256), &"t".repeat(4096)).unwrap();
    }
}
