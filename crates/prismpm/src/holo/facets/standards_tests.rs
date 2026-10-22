//! StandardReference rows are validated against the exact standards profile.

use super::records::assemble;
use super::*;
use serde_json::json;

fn field(name: &str, kind: &str, value: Value) -> Value {
    json!({"field": name, "value": {"kind": kind, "value": value}})
}

fn reference(standard_index: u64, edition_index: u64, id: &str, edition: &str) -> Value {
    json!({
        "result": {"member": {"name": "StandardReference", "module": "Foundation.Arch"}},
        "body": {"kind": "record", "fields": [
            field("standardIndex", "nat", json!(standard_index.to_string())),
            field("editionIndex", "nat", json!(edition_index.to_string())),
            field("standardId", "string", json!(id)),
            field("edition", "string", json!(edition)),
        ]},
    })
}

fn project(rows: &[(&str, &str, Value)]) -> Result<FacetRecords, PrismError> {
    let table = table()?;
    let entities = collect_entities(
        &table,
        rows.iter()
            .map(|(module, name, value)| (*module, *name, value)),
    )?;
    assemble(&table, BTreeMap::new(), entities)
}

fn refused(index: u64, edition_index: u64, id: &str, edition: &str) -> PrismError {
    let rows = [(
        "App.Architecture",
        "standardCited",
        reference(index, edition_index, id, edition),
    )];
    project(&rows).err().unwrap()
}

#[test]
fn every_profile_entry_is_accepted_at_its_position() {
    for (position, id) in PROFILE.iter().enumerate() {
        let edition = id.rsplit_once('-').unwrap().1;
        let rows = [(
            "App.Architecture",
            "standardCited",
            reference(position as u64, 0, id, edition),
        )];
        project(&rows).unwrap();
    }
}

#[test]
fn the_stdlib_sample_reference_is_valid() {
    let rows = [(
        "Foundation.Arch",
        "standardArchitectureDescription",
        reference(4, 0, "ISO-42010-2022", "2022"),
    )];
    project(&rows).unwrap();
}

#[test]
fn a_wrong_standard_index_is_refused() {
    for index in [0, 3, 5, 42010] {
        let error = refused(index, 0, "ISO-42010-2022", "2022");
        assert_eq!(error.code, "PP4004");
        assert!(
            error
                .message
                .contains("App.Architecture::standardCited must have standardIndex 4"),
            "{}",
            error.message
        );
    }
}

#[test]
fn an_id_outside_the_profile_is_refused() {
    let error = refused(4, 0, "ISO-42010-2011", "2011");
    assert_eq!(error.code, "PP4004");
    assert!(error.message.contains("not in the standards profile"));
}

#[test]
fn a_wrong_edition_or_edition_index_is_refused() {
    let error = refused(4, 0, "ISO-42010-2022", "2011");
    assert_eq!(error.code, "PP4004");
    assert!(error.message.contains("must have edition 2022"));
    let error = refused(4, 1, "ISO-42010-2022", "2022");
    assert_eq!(error.code, "PP4004");
    assert!(error.message.contains("must have editionIndex 0"));
}

#[test]
fn a_reference_with_a_missing_field_is_refused() {
    let mut value = reference(4, 0, "ISO-42010-2022", "2022");
    value["body"]["fields"].as_array_mut().unwrap().remove(2);
    let rows = [("App.Architecture", "standardCited", value)];
    let error = project(&rows).err().unwrap();
    assert_eq!(error.code, "PP2001");
    assert!(error.message.contains("missing field standardId"));
}
