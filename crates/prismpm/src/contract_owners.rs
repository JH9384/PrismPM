//! Validate any registered contract with its owner's semantic checks.
//!
//! `contracts` holds the schema table and refuses a contract whose semantic
//! checks belong to another module. This router knows every owner, so a caller
//! that holds only an id, such as a generic test or the conformance runner,
//! gets exactly the checks that owner runs.

use crate::contracts::{owner_of, CanonicalDocument};
use crate::error::PrismError;
use serde_json::Value;

fn unrouted(id: &str, owner: &str) -> PrismError {
    PrismError::new(
        "PP9001",
        format!("{id} names owner {owner}, which has no contract route"),
    )
}

/// Validate an in-memory value of any registered contract.
pub fn from_value(id: &'static str, value: Value) -> Result<CanonicalDocument, PrismError> {
    match owner_of(id) {
        None => CanonicalDocument::from_value(id, value),
        Some("acceptance") => crate::acceptance::contract_from_value(id, value),
        Some("library_build") => crate::library_build::contract_from_value(id, value),
        Some("library_verification") => crate::library_verification::contract_from_value(id, value),
        Some("model_contract") => crate::model_contract::contract_from_value(id, value),
        Some("oci") => crate::oci::contract_from_value(id, value),
        Some("sdk") => crate::sdk::contract_from_value(id, value),
        Some(owner) => Err(unrouted(id, owner)),
    }
}

/// Validate exact canonical bytes of any registered contract.
pub fn parse(id: &'static str, bytes: &[u8]) -> Result<CanonicalDocument, PrismError> {
    match owner_of(id) {
        None => CanonicalDocument::parse(id, bytes),
        Some("acceptance") => crate::acceptance::parse_contract(id, bytes),
        Some("library_build") => crate::library_build::parse_contract(id, bytes),
        Some("library_verification") => crate::library_verification::parse_contract(id, bytes),
        Some("model_contract") => crate::model_contract::parse_contract(id, bytes),
        Some("oci") => crate::oci::parse_contract(id, bytes),
        Some("sdk") => crate::sdk::parse_contract(id, bytes),
        Some(owner) => Err(unrouted(id, owner)),
    }
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn every_owner_checked_contract_reaches_its_owner() {
        for (id, owner) in crate::contracts::OWNER_CHECKED {
            for error in [
                super::from_value(id, json!({"schema": id})).unwrap_err(),
                super::parse(id, br#"{"schema":"x"}"#).unwrap_err(),
            ] {
                assert!(
                    !error.message.contains("has no contract route")
                        && !error.message.contains("carries semantic checks owned by")
                        && !error.message.contains("does not own the semantic checks"),
                    "{id} ({owner}): {}",
                    error.message
                );
            }
        }
    }
}
