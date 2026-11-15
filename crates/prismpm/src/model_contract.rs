//! The semantic checks of the model-document contracts.
//!
//! The model document belongs to `images` (docs/proposals/440-nine-modules.md),
//! so its typed shape and model validation run here, as that contract's owner
//! check, and not in the `errors` schema table.

use crate::contracts::{CanonicalDocument, OwnerCheck};
use crate::error::PrismError;
use crate::holo::model_document::ModelDocument;
use serde_json::Value;

/// The semantic checks of the model-document contracts, which this module owns:
/// the typed shape and the model validation.
const CONTRACT_CHECK: OwnerCheck = OwnerCheck {
    owner: "model_contract",
    check: check_contract,
};

fn check_contract(id: &str, value: &Value) -> Result<(), PrismError> {
    if !matches!(
        id,
        "prismpm/model-document/2"
            | "prismpm/model-document/3"
            | "prismpm/model-document/4"
            | "prismpm/model-document/5"
            | "prismpm/model-document/6"
            | "prismpm/model-document/7"
            | "prismpm/model-document/8"
    ) {
        return Err(PrismError::new(
            "PP9001",
            format!("model_contract owns no semantic check for {id}"),
        ));
    }
    let document: ModelDocument = serde_json::from_value(value.clone()).map_err(|error| {
        PrismError::new(
            if id == "prismpm/model-document/4" {
                "PP2010"
            } else if id == "prismpm/model-document/7" {
                "PP2013"
            } else if matches!(
                id,
                "prismpm/model-document/2"
                    | "prismpm/model-document/5"
                    | "prismpm/model-document/6"
            ) {
                "PP2009"
            } else {
                "PP4004"
            },
            format!("model document shape: {error}"),
        )
    })?;
    crate::holo::validate::validate(&document)
}

/// Validate a model-document contract value, including the typed shape and
/// model validation this module owns.
pub fn contract_from_value(
    id: &'static str,
    value: Value,
) -> Result<CanonicalDocument, PrismError> {
    CanonicalDocument::from_value_owned(id, value, CONTRACT_CHECK)
}

/// Validate exact canonical model-document contract bytes, including the
/// rules this module owns.
pub fn parse_contract(id: &'static str, bytes: &[u8]) -> Result<CanonicalDocument, PrismError> {
    CanonicalDocument::parse_owned(id, bytes, CONTRACT_CHECK)
}
