//! Names and text of Foundation.Arch components, stakeholders and concerns.

use super::records::assemble;
use super::*;
use serde_json::json;

fn string_field(name: &str, value: &str) -> Value {
    json!({"field": name, "value": {"kind": "string", "value": value}})
}

fn row(type_name: &str, extra: Vec<Value>) -> Value {
    let mut fields = vec![json!({"field": "index", "value": {"kind": "nat", "value": "0"}})];
    fields.extend(extra);
    json!({
        "result": {"member": {"name": type_name, "module": "Foundation.Arch"}},
        "body": {"kind": "record", "fields": fields},
    })
}

fn kind() -> Value {
    json!({
        "field": "kind",
        "value": {"kind": "constructor", "constructor": {"name": "ComponentKind.cliAdapter"}},
    })
}

fn project(definitions: &[(&str, &str, Value)]) -> Result<FacetRecords, PrismError> {
    let table = table()?;
    let entities = collect_entities(
        &table,
        definitions
            .iter()
            .map(|(module, name, value)| (*module, *name, value)),
    )?;
    assemble(&table, BTreeMap::new(), entities)
}

#[test]
fn names_and_text_are_projected() {
    let definitions = [
        (
            "App.Architecture",
            "cli",
            row(
                "Component",
                vec![
                    kind(),
                    string_field("name", "prism-code"),
                    string_field("text", "Command line adapter."),
                ],
            ),
        ),
        (
            "App.Architecture",
            "author",
            row(
                "Stakeholder",
                vec![
                    string_field("name", "author"),
                    string_field("text", "Writes the models.\nReads the reports."),
                ],
            ),
        ),
        (
            "App.Architecture",
            "reuse",
            row(
                "Concern",
                vec![
                    string_field("name", "reuse"),
                    string_field("text", "Share code."),
                ],
            ),
        ),
    ];
    let records = project(&definitions).unwrap().architecture;
    assert_eq!(records.components[0].name, "prism-code");
    assert_eq!(records.components[0].text, "Command line adapter.");
    assert_eq!(
        records.components[0].kind_id,
        "prism.arch@1.0.0::ComponentKind.cliAdapter"
    );
    assert_eq!(records.stakeholders[0].name, "author");
    assert_eq!(
        records.stakeholders[0].text,
        "Writes the models.\nReads the reports."
    );
    assert_eq!(records.concerns[0].name, "reuse");
    assert_eq!(records.concerns[0].text, "Share code.");
    let value = serde_json::to_value(&records.stakeholders[0]).unwrap();
    assert_eq!(value["name"], "author");
}

#[test]
fn sources_without_names_project_empty_and_omit_them() {
    let definitions = [("App.Architecture", "author", row("Stakeholder", vec![]))];
    let records = project(&definitions).unwrap().architecture;
    assert_eq!(records.stakeholders[0].name, "");
    assert_eq!(records.stakeholders[0].text, "");
    let value = serde_json::to_value(&records.stakeholders[0]).unwrap();
    assert_eq!(value, json!({"id": "App.Architecture::author", "index": 0}));
}

#[test]
fn a_non_string_name_is_refused() {
    let definitions = [(
        "App.Architecture",
        "author",
        row(
            "Stakeholder",
            vec![json!({"field": "name", "value": {"kind": "nat", "value": "1"}})],
        ),
    )];
    let error = project(&definitions).err().unwrap();
    assert_eq!(error.code, "PP2001");
}
