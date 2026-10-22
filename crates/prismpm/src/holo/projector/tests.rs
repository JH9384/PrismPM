use super::*;
use serde_json::json;

fn nat_field(name: &str, value: u64) -> Value {
    json!({"field": name, "value": {"kind": "nat", "value": value.to_string()}})
}

fn record(type_name: &str, qualifier: Option<&str>, index: u64) -> Value {
    json!({
        "result": {"member": {"name": type_name, "module": qualifier}},
        "body": {"kind": "record", "fields": [nat_field("index", index)]},
    })
}

fn ids(rows: &[Raw<'_>]) -> Vec<String> {
    rows.iter().map(|row| row.id.clone()).collect()
}

fn collected<'a>(
    table: &Table,
    definitions: &'a [(&'a str, &'a str, Value)],
) -> Result<BTreeMap<String, Vec<Raw<'a>>>, PrismError> {
    collect_entities(
        table,
        definitions
            .iter()
            .map(|(module, name, value)| (*module, *name, value)),
    )
}

#[test]
fn qualified_application_records_are_projected() {
    let table = table().unwrap();
    let definitions = [
        (
            "App.Security",
            "assetB",
            record("Asset", Some("Foundation.Sec"), 1),
        ),
        (
            "App.Security",
            "assetA",
            record("Asset", Some("Foundation.Sec"), 0),
        ),
        (
            "App.Architecture",
            "stakeholder",
            record("Stakeholder", Some("Foundation.Arch"), 0),
        ),
        (
            "App.Quality",
            "characteristic",
            record("ProductQualityCharacteristic", Some("Foundation.Qual"), 0),
        ),
    ];
    let mut entities = collected(&table, &definitions).unwrap();
    let mut assets = entities.remove("assets").unwrap();
    index(&mut assets).unwrap();
    assert_eq!(
        ids(&assets),
        ["App.Security::assetA", "App.Security::assetB"]
    );
    assert_eq!(
        ids(&entities["stakeholders"]),
        ["App.Architecture::stakeholder"]
    );
    assert_eq!(
        ids(&entities["characteristics"]),
        ["App.Quality::characteristic"]
    );
}

#[test]
fn wrong_or_missing_qualifiers_are_not_projected() {
    let table = table().unwrap();
    let definitions = [
        (
            "App.Security",
            "wrongModule",
            record("Asset", Some("Other.Sec"), 0),
        ),
        (
            "App.Security",
            "crossFacet",
            record("Asset", Some("Foundation.Arch"), 0),
        ),
        ("App.Security", "unqualified", record("Asset", None, 0)),
        (
            "App.Security",
            "unmappedType",
            record("StandardReference", Some("Foundation.Arch"), 0),
        ),
    ];
    assert!(collected(&table, &definitions).unwrap().is_empty());
}

#[test]
fn stdlib_sample_rows_survive_without_application_records() {
    let table = table().unwrap();
    let definitions = [
        (
            "Foundation.Sec",
            "assetCredentials",
            record("Asset", None, 0),
        ),
        (
            "App.Security",
            "ignored",
            record("Asset", Some("Other.Sec"), 0),
        ),
    ];
    let entities = collected(&table, &definitions).unwrap();
    assert_eq!(
        ids(&entities["assets"]),
        ["Foundation.Sec::assetCredentials"]
    );
}

#[test]
fn application_records_replace_the_sample_rows_in_every_target() {
    let table = table().unwrap();
    let definitions = [
        (
            "Foundation.Sec",
            "assetCredentials",
            record("Asset", None, 0),
        ),
        (
            "Foundation.Arch",
            "stakeholderSample",
            record("Stakeholder", None, 0),
        ),
        (
            "App.Security",
            "asset",
            record("Asset", Some("Foundation.Sec"), 0),
        ),
    ];
    let entities = collected(&table, &definitions).unwrap();
    assert_eq!(entities.keys().collect::<Vec<_>>(), ["assets"]);
    assert_eq!(ids(&entities["assets"]), ["App.Security::asset"]);
}

#[test]
fn ordering_is_independent_of_declaration_order() {
    let table = table().unwrap();
    let forward = [
        ("A", "one", record("Threat", Some("Foundation.Sec"), 0)),
        ("B", "one", record("Threat", Some("Foundation.Sec"), 1)),
        ("B", "two", record("Threat", Some("Foundation.Sec"), 2)),
    ];
    let reverse = [forward[2].clone(), forward[0].clone(), forward[1].clone()];
    let mut left = collected(&table, &forward)
        .unwrap()
        .remove("threats")
        .unwrap();
    let mut right = collected(&table, &reverse)
        .unwrap()
        .remove("threats")
        .unwrap();
    index(&mut left).unwrap();
    index(&mut right).unwrap();
    assert_eq!(ids(&left), ["A::one", "B::one", "B::two"]);
    assert_eq!(ids(&left), ids(&right));
}

#[test]
fn noncanonical_and_duplicate_identities_are_refused() {
    let table = table().unwrap();
    let skipped = [
        ("A", "one", record("Threat", Some("Foundation.Sec"), 0)),
        ("A", "two", record("Threat", Some("Foundation.Sec"), 2)),
    ];
    let mut rows = collected(&table, &skipped)
        .unwrap()
        .remove("threats")
        .unwrap();
    let error = index(&mut rows).unwrap_err();
    assert_eq!(error.code, "PP4004");
    assert!(error.message.contains("A::two must have canonical index 1"));

    let repeated = [
        ("A", "one", record("Threat", Some("Foundation.Sec"), 0)),
        ("A", "one", record("Threat", Some("Foundation.Sec"), 1)),
    ];
    let mut rows = collected(&table, &repeated)
        .unwrap()
        .remove("threats")
        .unwrap();
    let error = index(&mut rows).unwrap_err();
    assert_eq!(error.code, "PP4004");
    assert!(error.message.contains("duplicate entity ID A::one"));
}

#[test]
fn mapped_application_definitions_must_be_records() {
    let table = table().unwrap();
    let definitions = [(
        "App.Security",
        "asset",
        json!({
            "result": {"member": {"name": "Asset", "module": "Foundation.Sec"}},
            "body": {"kind": "nat", "value": "0"},
        }),
    )];
    let error = collected(&table, &definitions).err().unwrap();
    assert_eq!(error.code, "PP2001");
}
