//! Validation of `Foundation.Arch.StandardReference` rows against the exact
//! standards profile.
//!
//! A reference is a citation, not an indexed entity: it carries no `index` and
//! contributes no array to the model document. It is checked so that a wrong
//! `standardIndex`, `standardId` or `edition` is refused instead of passing
//! the kernel unnoticed.

use super::{nat, Raw, PROFILE};
use crate::error::PrismError;
use serde_json::Value;
use std::collections::BTreeMap;

fn required_string<'a>(
    fields: &BTreeMap<&str, &'a Value>,
    name: &str,
) -> Result<&'a str, PrismError> {
    let value = fields
        .get(name)
        .ok_or_else(|| PrismError::new("PP2001", format!("missing field {name}")))?;
    if value.get("kind").and_then(Value::as_str) != Some("string") {
        return Err(PrismError::new(
            "PP2001",
            format!("field {name} is not String"),
        ));
    }
    value
        .get("value")
        .and_then(Value::as_str)
        .ok_or_else(|| PrismError::new("PP2001", format!("field {name} is malformed")))
}

/// The edition of a profile identifier: its final `-` separated segment.
fn profile_edition(id: &str) -> &str {
    id.rsplit_once('-').map_or(id, |pair| pair.1)
}

/// Check every reference. `standardId` must name a profile entry,
/// `standardIndex` must be that entry's position, `edition` must be the
/// entry's edition, and `editionIndex` must be 0 because the profile cites
/// exactly one edition of each standard.
pub(super) fn validate(rows: &[Raw<'_>]) -> Result<(), PrismError> {
    for row in rows {
        let id = required_string(&row.fields, "standardId")?;
        let position = PROFILE
            .iter()
            .position(|entry| *entry == id)
            .ok_or_else(|| {
                PrismError::new(
                    "PP4004",
                    format!(
                        "{} cites {id}, which is not in the standards profile",
                        row.id
                    ),
                )
            })?;
        let standard_index = nat(&row.fields, "standardIndex")?;
        if standard_index != position as u64 {
            return Err(PrismError::new(
                "PP4004",
                format!(
                    "{} must have standardIndex {position} for {id}, found {standard_index}",
                    row.id
                ),
            ));
        }
        let edition = required_string(&row.fields, "edition")?;
        if edition != profile_edition(id) {
            return Err(PrismError::new(
                "PP4004",
                format!(
                    "{} must have edition {} for {id}, found {edition}",
                    row.id,
                    profile_edition(id)
                ),
            ));
        }
        let edition_index = nat(&row.fields, "editionIndex")?;
        if edition_index != 0 {
            return Err(PrismError::new(
                "PP4004",
                format!(
                    "{} must have editionIndex 0 for {id}, found {edition_index}",
                    row.id
                ),
            ));
        }
    }
    Ok(())
}
