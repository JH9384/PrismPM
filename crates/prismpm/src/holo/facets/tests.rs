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

fn named_field(name: &str, constructor: &str) -> Value {
    json!({
        "field": name,
        "value": {"kind": "constructor", "constructor": {"name": constructor}},
    })
}

fn record_with(type_name: &str, qualifier: Option<&str>, extra: Vec<Value>) -> Value {
    let mut definition = record(type_name, qualifier, 0);
    definition["body"]["fields"] = Value::Array(extra);
    definition
}

fn row(type_name: &str, qualifier: Option<&str>, index: u64, extra: Vec<Value>) -> Value {
    let mut fields = vec![nat_field("index", index)];
    fields.extend(extra);
    record_with(type_name, qualifier, fields)
}

fn inductive(constructors: &[&str]) -> Value {
    json!({"constructors": constructors.iter().map(|name| json!({"name": name})).collect::<Vec<_>>()})
}

const ARCH: Option<&str> = Some("Foundation.Arch");
const SEC: Option<&str> = Some("Foundation.Sec");
const QUAL: Option<&str> = Some("Foundation.Qual");

/// Catalog inductives of the Foundation modules, the stdlib sample row, and a
/// complete, mutually consistent set of application-owned records.
fn declarations() -> Vec<(&'static str, &'static str, &'static str, Value)> {
    vec![
        (
            "Foundation.Arch",
            "ComponentKind",
            "inductive",
            inductive(&["service"]),
        ),
        (
            "Foundation.Arch",
            "EdgeKind",
            "inductive",
            inductive(&["uses"]),
        ),
        (
            "Foundation.Arch",
            "ModelKind",
            "inductive",
            inductive(&["structure"]),
        ),
        (
            "Foundation.Sec",
            "Likelihood",
            "inductive",
            inductive(&["low"]),
        ),
        (
            "Foundation.Sec",
            "Impact",
            "inductive",
            inductive(&["high"]),
        ),
        (
            "Foundation.Sec",
            "assetSample",
            "definition",
            row("Asset", None, 0, vec![nat_field("componentIndex", 9)]),
        ),
        (
            "App.Architecture",
            "api",
            "definition",
            row(
                "Component",
                ARCH,
                0,
                vec![named_field("kind", "ComponentKind.service")],
            ),
        ),
        (
            "App.Security",
            "assetApi",
            "definition",
            row("Asset", SEC, 0, vec![nat_field("componentIndex", 0)]),
        ),
        (
            "App.Security",
            "threatTamper",
            "definition",
            row("Threat", SEC, 0, vec![]),
        ),
        (
            "App.Security",
            "riskApi",
            "definition",
            row(
                "Risk",
                SEC,
                0,
                vec![
                    nat_field("assetIndex", 0),
                    nat_field("threatIndex", 0),
                    named_field("likelihood", "Likelihood.low"),
                    named_field("impact", "Impact.high"),
                ],
            ),
        ),
        (
            "App.Security",
            "controlApi",
            "definition",
            row(
                "ApplicationSecurityControl",
                SEC,
                0,
                vec![nat_field("riskIndex", 0)],
            ),
        ),
        (
            "App.Quality",
            "characteristic",
            "definition",
            row("ProductQualityCharacteristic", QUAL, 0, vec![]),
        ),
        (
            "App.Quality",
            "subcharacteristic",
            "definition",
            row(
                "QualitySubcharacteristic",
                QUAL,
                0,
                vec![nat_field("characteristicIndex", 0)],
            ),
        ),
        (
            "App.Quality",
            "requirement",
            "definition",
            row(
                "QualityRequirement",
                QUAL,
                0,
                vec![nat_field("subcharacteristicIndex", 0)],
            ),
        ),
        (
            "App.Quality",
            "measure",
            "definition",
            row(
                "QualityMeasure",
                QUAL,
                0,
                vec![nat_field("requirementIndex", 0), nat_field("threshold", 3)],
            ),
        ),
    ]
}

fn project(
    items: &[(&'static str, &'static str, &'static str, Value)],
) -> Result<Option<FacetRecords>, PrismError> {
    let table = table()?;
    let declared: Vec<_> = items
        .iter()
        .map(|(module, logical_id, kind, linked)| Declared {
            module,
            logical_id,
            kind,
            linked,
        })
        .collect();
    application_from(&table, &declared)
}

fn closure(ids: &[&str]) -> Value {
    json!({"packages": ids.iter().map(|id| json!({
        "id": id,
        "version": "1.0.0",
        "tree_sha256": "a".repeat(64),
    })).collect::<Vec<_>>()})
}

#[test]
fn application_closure_requires_all_three_facets_and_ignores_others() {
    let all = closure(&[
        "prism.sec",
        "prism.arch",
        "prism.qual",
        "prism.other",
        "std",
    ]);
    let packages = application_closure(&all).unwrap().unwrap();
    let names: Vec<_> = packages.iter().map(|row| row.package.as_str()).collect();
    assert_eq!(names, ["prism.arch", "prism.qual", "prism.sec"]);
    for partial in [
        closure(&["prism.arch", "prism.sec"]),
        closure(&["prism.qual"]),
        closure(&["std"]),
        closure(&[]),
        json!({}),
    ] {
        assert!(
            application_closure(&partial).unwrap().is_none(),
            "{partial}"
        );
    }
    let broken = json!({"packages": [{"id": "prism.arch", "version": "1.0.0"}]});
    assert_eq!(application_closure(&broken).unwrap_err().code, "PP4004");
}

#[test]
fn application_projection_excludes_sample_rows_and_keeps_catalogs() {
    let records = project(&declarations()).unwrap().unwrap();
    let assets: Vec<_> = records
        .security
        .assets
        .iter()
        .map(|row| row.id.as_str())
        .collect();
    assert_eq!(assets, ["App.Security::assetApi"]);
    assert_eq!(records.security.assets[0].component_index, 0);
    assert_eq!(
        records.architecture.components[0].id,
        "App.Architecture::api"
    );
    assert_eq!(
        records.architecture.components[0].kind_id,
        "prism.arch@1.0.0::ComponentKind.service"
    );
    assert_eq!(
        records.security.likelihoods[0].id,
        "prism.sec@1.0.0::Likelihood.low"
    );
    assert_eq!(records.quality.measures[0].threshold, 3);
}

#[test]
fn application_projection_is_absent_without_application_records() {
    let sample_only: Vec<_> = declarations()
        .into_iter()
        .filter(|(module, ..)| module.starts_with("Foundation."))
        .collect();
    assert!(project(&sample_only).unwrap().is_none());
    assert!(project(&[]).unwrap().is_none());
}

#[test]
fn application_projection_applies_the_entity_rules() {
    let mut skipped = declarations();
    skipped.push((
        "App.Security",
        "threatZ",
        "definition",
        row("Threat", SEC, 2, vec![]),
    ));
    let error = project(&skipped).err().unwrap();
    assert_eq!(error.code, "PP4004");
    assert!(error
        .message
        .contains("App.Security::threatZ must have canonical index 1"));

    let mut repeated = declarations();
    repeated.push((
        "App.Security",
        "threatTamper",
        "definition",
        row("Threat", SEC, 1, vec![]),
    ));
    let error = project(&repeated).err().unwrap();
    assert_eq!(error.code, "PP4004");
    assert!(error
        .message
        .contains("duplicate entity ID App.Security::threatTamper"));

    let mut not_a_record = declarations();
    not_a_record.push((
        "App.Security",
        "asset",
        "definition",
        json!({
            "result": {"member": {"name": "Asset", "module": "Foundation.Sec"}},
            "body": {"kind": "nat", "value": "0"},
        }),
    ));
    assert_eq!(project(&not_a_record).err().unwrap().code, "PP2001");
}

mod document {
    use super::*;
    use crate::holo::model_document::ModelDocument;
    use crate::holo::validate::validate;

    const FIXTURE: &[u8] = include_bytes!("../../../../../tests/data/text-model-document.json");

    fn plain() -> ModelDocument {
        serde_json::from_slice(FIXTURE).unwrap()
    }

    fn with_facets() -> ModelDocument {
        let mut doc = plain();
        let records = project(&declarations()).unwrap().unwrap();
        doc.provenance.facet_packages =
            application_closure(&closure(&["prism.arch", "prism.qual", "prism.sec"]))
                .unwrap()
                .unwrap();
        doc.standards_profile = PROFILE.iter().map(|value| (*value).to_owned()).collect();
        doc.architecture = records.architecture;
        doc.security = records.security;
        doc.quality = records.quality;
        doc
    }

    fn schema_accepts(doc: &ModelDocument) -> bool {
        let schema: Value = serde_json::from_slice(include_bytes!(
            "../../../schemas/model-document-v2.schema.json"
        ))
        .unwrap();
        jsonschema::validator_for(&schema)
            .unwrap()
            .is_valid(&serde_json::to_value(doc).unwrap())
    }

    #[test]
    fn application_without_facets_is_unchanged() {
        let doc = plain();
        validate(&doc).unwrap();
        assert!(schema_accepts(&doc));
        let value = serde_json::to_value(&doc).unwrap();
        assert_eq!(value["standards_profile"], json!([]));
        assert_eq!(value["provenance"]["facet_packages"], json!([]));
    }

    #[test]
    fn application_with_consistent_facets_validates_and_round_trips() {
        let doc = with_facets();
        validate(&doc).unwrap();
        assert!(schema_accepts(&doc));
        let bytes = crate::holo::canonical::encode_canonical(&doc).unwrap();
        assert_eq!(
            crate::holo::canonical::decode_canonical(&bytes).unwrap(),
            doc
        );
    }

    #[test]
    fn facet_records_without_the_facet_closure_are_refused() {
        let mut doc = with_facets();
        doc.provenance.facet_packages.clear();
        let error = validate(&doc).unwrap_err();
        assert_eq!(error.code, "PP2001");
        assert!(error.message.contains("lexicon closure includes"));

        let mut doc = plain();
        doc.security = project(&declarations()).unwrap().unwrap().security;
        assert_eq!(validate(&doc).unwrap_err().code, "PP2001");
    }

    #[test]
    fn facet_closure_and_profile_must_be_exact_beside_an_application() {
        let mut doc = with_facets();
        doc.provenance.facet_packages.pop();
        assert_eq!(validate(&doc).unwrap_err().code, "PP2001");
        let mut doc = with_facets();
        doc.standards_profile.pop();
        assert_eq!(validate(&doc).unwrap_err().code, "PP2001");
        let mut doc = with_facets();
        doc.provenance.facet_packages[0].version = "2.0.0".to_owned();
        assert_eq!(validate(&doc).unwrap_err().code, "PP2001");
    }

    #[test]
    fn facet_cross_references_are_checked_beside_an_application() {
        let mut doc = with_facets();
        doc.security.assets[0].component_index = 1;
        assert_eq!(validate(&doc).unwrap_err().code, "PP2005");
        let mut doc = with_facets();
        doc.security.controls[0].risk_index = 1;
        assert_eq!(validate(&doc).unwrap_err().code, "PP2006");
        let mut doc = with_facets();
        doc.quality.measures[0].requirement_index = 1;
        assert_eq!(validate(&doc).unwrap_err().code, "PP2007");
        let mut doc = with_facets();
        doc.architecture.components[0].kind_id = "prism.arch@1.0.0::ComponentKind.none".to_owned();
        assert_eq!(validate(&doc).unwrap_err().code, "PP2001");
        let mut doc = with_facets();
        doc.security.threats[0].index = 1;
        assert_eq!(validate(&doc).unwrap_err().code, "PP4004");
    }
}
