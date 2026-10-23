//! SY-02: the host certificate indexes the complete formally modeled identity set.

use super::*;

fn formal_manifest(model: &Value) -> Value {
    let mut certificate = validation_certificate(model).unwrap();
    certificate.as_object_mut().unwrap().remove("schema");
    certificate
}

fn fixture_model() -> Value {
    fn normalize(value: &Value, record: Option<&str>) -> Value {
        match value {
            Value::Array(rows) => rows.iter().map(|row| normalize(row, record)).collect(),
            Value::Object(fields) => fields
                .iter()
                .map(|(name, value)| {
                    (
                        model_field_name(record, name),
                        normalize(value, (name == "flows").then_some("Flow")),
                    )
                })
                .collect(),
            _ => value.clone(),
        }
    }
    let fixture: Value = serde_json::from_str(include_str!("release-fixture.json")).unwrap();
    let mut model = normalize(&fixture["model"], None);
    model["schema"] = json!("prismpm/system-model/1");
    CanonicalDocument::from_value("prismpm/system-model/1", model)
        .unwrap()
        .value()
        .clone()
}

#[test]
fn certificate_covers_product_and_secret_reference_identities() {
    let model = fixture_model();
    let certificate = formal_manifest(&model);
    assert_eq!(certificate["closure"]["bound"], 108);
    assert_eq!(
        certificate["uniqueness"]["values"],
        json!((0..108).collect::<Vec<_>>())
    );
    for relation in [
        "referential_integrity",
        "rollback_safety",
        "evidence_closure",
    ] {
        assert_eq!(certificate[relation]["bound"], 108);
    }
    validate(&model, &certificate).unwrap();
    for bound in [101, 107, 109] {
        let mut stale = certificate.clone();
        stale["closure"]["bound"] = json!(bound);
        assert_eq!(validate(&model, &stale).unwrap_err().code, "PP2101");
    }
    let mut incomplete = certificate.clone();
    incomplete["uniqueness"]["values"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert_eq!(validate(&model, &incomplete).unwrap_err().code, "PP2101");
}

#[test]
fn product_and_secret_reference_cross_collection_collisions_are_rejected() {
    let model = fixture_model();
    let certificate = formal_manifest(&model);
    for (pointer, duplicate) in [
        ("/product/id", model["components"][0]["id"].clone()),
        ("/product/id", model["secret_references"][0]["id"].clone()),
        (
            "/secret_references/0/id",
            model["components"][0]["id"].clone(),
        ),
        (
            "/secret_references/0/id",
            model["secret_references"][1]["id"].clone(),
        ),
    ] {
        let mut changed = model.clone();
        *changed.pointer_mut(pointer).unwrap() = duplicate;
        assert_eq!(validation_certificate(&changed).unwrap_err().code, "PP2101");
        assert_eq!(validate(&changed, &certificate).unwrap_err().code, "PP2101");
    }
    for product in [Value::Null, json!({}), json!({"id":""})] {
        let mut changed = model.clone();
        changed["product"] = product;
        assert_eq!(validation_certificate(&changed).unwrap_err().code, "PP2101");
    }
}

#[test]
fn host_identity_inventory_matches_authoritative_formal_definitions() {
    let source = include_str!("../../stdlib/src/Production/SystemValidation.lex.tex");
    let module = lexlean::sdk::read_module(source).unwrap();
    let declarations = module["declarations"].as_array().unwrap();
    let definition = |name: &str| declarations.iter().find(|row| row["name"] == name).unwrap();
    fn fields(value: &Value, found: &mut Vec<String>) {
        if value["kind"] == "project" && value.pointer("/value/name") == Some(&json!("model")) {
            found.push(model_field_name(None, value["field"].as_str().unwrap()));
        }
        match value {
            Value::Array(rows) => rows.iter().for_each(|row| fields(row, found)),
            Value::Object(rows) => rows.values().for_each(|row| fields(row, found)),
            _ => {}
        }
    }
    let mut all_ids = Vec::new();
    fields(&definition("allModelIds")["body"], &mut all_ids);
    assert_eq!(all_ids, MODEL_ID_COLLECTIONS);
    let mut counted = Vec::new();
    for group in 0..6 {
        fields(
            &definition(&format!("modelEntityCountGroup{group}"))["body"],
            &mut counted,
        );
    }
    assert_eq!(counted.len(), MODEL_ID_COLLECTIONS.len());
    assert_eq!(
        counted.iter().map(String::as_str).collect::<BTreeSet<_>>(),
        MODEL_ID_COLLECTIONS.into_iter().collect()
    );
    assert_eq!(
        definition("modelEntityCount")["body"]["left"],
        json!({"kind":"nat","value":"1"})
    );
}

#[test]
fn product_and_secret_references_are_in_the_global_reference_domain() {
    let mut model = fixture_model();
    let links = json!([model["product"]["id"], model["secret_references"][0]["id"]]);
    model["architecture"][0]["verifies"] = links.clone();
    model["controls"][0]["verification"] = links.clone();
    model["alerts"][0]["depends_on"] = links;
    validate(&model, &formal_manifest(&model)).unwrap();
}

#[test]
fn deployment_and_migration_orders_are_dependency_first_and_deterministic() {
    let model = fixture_model();
    let certificate = formal_manifest(&model);
    assert_eq!(
        certificate["deployment_order"]["values"],
        json!([2, 4, 5, 6, 7, 0, 1, 3])
    );
    validate(&model, &certificate).unwrap();
    for values in [
        json!([0, 1, 2, 3, 4, 5, 6, 7]),
        json!([2, 4, 5, 6, 7, 0, 1]),
        json!([2, 4, 5, 6, 7, 0, 1, 1]),
        json!([2, 4, 5, 6, 7, 0, 1, 8]),
    ] {
        let mut changed = certificate.clone();
        changed["deployment_order"]["values"] = values;
        assert_eq!(validate(&model, &changed).unwrap_err().code, "PP2101");
    }
    let mut graph = json!({"components":[
        {"id":"a","depends_on":["b","c"]},
        {"id":"b","depends_on":["d"]},
        {"id":"c","depends_on":["d"]},
        {"id":"d","depends_on":[]},
        {"id":"e","depends_on":[]}
    ]});
    assert_eq!(
        dependency_order(&graph, "components", &BTreeMap::new()).unwrap(),
        [3, 1, 2, 0, 4]
    );
    for dependencies in [
        json!(["a"]),
        json!(["missing"]),
        Value::Null,
        json!("b"),
        json!([1]),
    ] {
        graph["components"][0]["depends_on"] = dependencies;
        assert_eq!(
            dependency_order(&graph, "components", &BTreeMap::new())
                .unwrap_err()
                .code,
            "PP2101"
        );
    }
    graph["components"][0]["depends_on"] = json!(["b"]);
    graph["components"][1]["depends_on"] = json!(["a"]);
    assert_eq!(
        dependency_order(&graph, "components", &BTreeMap::new())
            .unwrap_err()
            .code,
        "PP2101"
    );
    let mut migrations = json!({"migrations":[
        {"id":"migration-a","depends_on":["migration-z","store"]},
        {"id":"migration-z","depends_on":["store"]}
    ]});
    let external = BTreeMap::from([("store".to_owned(), 0)]);
    assert_eq!(
        dependency_order(&migrations, "migrations", &external).unwrap(),
        [1, 0]
    );
    assert_eq!(
        dependency_order(&migrations, "migrations", &BTreeMap::new())
            .unwrap_err()
            .code,
        "PP2101"
    );
    migrations["migrations"][1]["depends_on"] = json!(["migration-a"]);
    assert_eq!(
        dependency_order(&migrations, "migrations", &external)
            .unwrap_err()
            .code,
        "PP2101"
    );
}
