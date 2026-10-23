use super::{check, normalize, probe, project, validate_normalized, Declared, Normalized};
use serde_json::{json, Value};

fn string(value: &str) -> Value {
    json!({"kind": "string", "value": value})
}

fn list(values: &[&str]) -> Value {
    values.iter().rev().fold(
        json!({"kind": "nil"}),
        |tail, head| json!({"kind": "cons", "head": string(head), "tail": tail}),
    )
}

fn record(type_name: &str, qualifier: Option<&str>, fields: Vec<(&str, Value)>) -> Value {
    let mut member = json!({"name": type_name});
    if let Some(qualifier) = qualifier {
        member["module"] = json!(qualifier);
    }
    json!({
        "result": {"member": member},
        "body": {
            "kind": "record",
            "fields": fields
                .into_iter()
                .map(|(field, value)| json!({"field": field, "value": value}))
                .collect::<Vec<_>>(),
        },
    })
}

fn feature(calls: &[&str], acceptance: &[&str]) -> Value {
    record(
        "Feature",
        Some("Foundation.Arch"),
        vec![
            ("statement", string("A feature")),
            ("calls", list(calls)),
            ("acceptance", list(acceptance)),
        ],
    )
}

fn journey(actor: &str, steps: &[&str]) -> Value {
    record(
        "Journey",
        Some("Foundation.Arch"),
        vec![("actor", string(actor)), ("steps", list(steps))],
    )
}

fn other() -> Value {
    json!({"result": {"member": {"name": "Nat"}}, "body": {"kind": "nat", "value": "0"}})
}

/// Two features, one journey and the declarations they name.
fn model() -> Vec<(&'static str, &'static str, Value)> {
    vec![
        ("Product", "callCheck", other()),
        ("Product", "callBuild", other()),
        ("Product", "acceptanceCheck", other()),
        ("Product", "acceptanceBuild", other()),
        (
            "Product",
            "featureCheck",
            feature(&["Product::callCheck"], &["Product::acceptanceCheck"]),
        ),
        (
            "Product",
            "featureBuild",
            feature(
                &["Product::callBuild", "Product::callCheck"],
                &["Product::acceptanceBuild"],
            ),
        ),
        (
            "Product",
            "journeyAuthor",
            journey(
                "Architecture::stakeholderAuthor",
                &["Product::featureCheck", "Product::featureBuild"],
            ),
        ),
    ]
}

fn declared(rows: &[(&str, &str, Value)]) -> Declared {
    let mut declared = project(rows.iter().map(|(module, id, value)| (*module, *id, value)))
        .expect("projectable model");
    declared.stakeholders = [
        "Architecture::stakeholderAuthor",
        "Architecture::stakeholderReader",
    ]
    .into_iter()
    .map(str::to_owned)
    .collect();
    declared
}

fn replace(
    rows: &[(&'static str, &'static str, Value)],
    id: &str,
    value: Value,
) -> Vec<(&'static str, &'static str, Value)> {
    rows.iter()
        .map(|(module, name, old)| {
            (
                *module,
                *name,
                if *name == id {
                    value.clone()
                } else {
                    old.clone()
                },
            )
        })
        .collect()
}

#[test]
fn a_complete_model_is_accepted() {
    let rows = model();
    let declared = declared(&rows);
    assert_eq!(declared.features.len(), 2);
    assert_eq!(declared.journeys.len(), 1);
    check(&declared).unwrap();
    assert_eq!(
        declared.features["Product::featureBuild"].calls,
        ["Product::callBuild", "Product::callCheck"]
    );
}

#[test]
fn a_model_without_features_or_journeys_is_not_affected() {
    let rows = [("Product", "callCheck", other())];
    let declared = declared(&rows);
    assert!(declared.features.is_empty() && declared.journeys.is_empty());
    check(&declared).unwrap();
}

#[test]
fn a_feature_without_a_call_is_refused_with_pp2014() {
    let rows = replace(
        &model(),
        "featureCheck",
        feature(&[], &["Product::acceptanceCheck"]),
    );
    let error = check(&declared(&rows)).unwrap_err();
    assert_eq!(error.code, "PP2014", "{}", error.message);
    assert!(error.message.contains("Product::featureCheck"));
}

#[test]
fn a_feature_without_acceptance_is_refused_with_pp2015() {
    let rows = replace(
        &model(),
        "featureBuild",
        feature(&["Product::callBuild"], &[]),
    );
    let error = check(&declared(&rows)).unwrap_err();
    assert_eq!(error.code, "PP2015", "{}", error.message);
    assert!(error.message.contains("Product::featureBuild"));
}

#[test]
fn a_journey_step_naming_an_undeclared_feature_is_refused_with_pp2016() {
    let rows = replace(
        &model(),
        "journeyAuthor",
        journey(
            "Architecture::stakeholderAuthor",
            &["Product::featureCheck", "Product::featureMissing"],
        ),
    );
    let error = check(&declared(&rows)).unwrap_err();
    assert_eq!(error.code, "PP2016", "{}", error.message);
    assert!(error.message.contains("step 1"));
    assert!(error.message.contains("Product::featureMissing"));
}

#[test]
fn a_journey_step_naming_a_definition_that_is_not_a_feature_is_refused_with_pp2016() {
    let rows = replace(
        &model(),
        "journeyAuthor",
        journey("Architecture::stakeholderAuthor", &["Product::callCheck"]),
    );
    assert_eq!(check(&declared(&rows)).unwrap_err().code, "PP2016");
}

#[test]
fn a_journey_whose_actor_is_not_a_stakeholder_is_refused_with_pp2017() {
    let rows = replace(
        &model(),
        "journeyAuthor",
        journey(
            "Architecture::stakeholderStranger",
            &["Product::featureCheck"],
        ),
    );
    let error = check(&declared(&rows)).unwrap_err();
    assert_eq!(error.code, "PP2017", "{}", error.message);
    // A feature is not a stakeholder either.
    let rows = replace(
        &model(),
        "journeyAuthor",
        journey("Product::featureCheck", &["Product::featureCheck"]),
    );
    assert_eq!(check(&declared(&rows)).unwrap_err().code, "PP2017");
}

#[test]
fn a_call_or_acceptance_row_that_names_nothing_is_refused_with_pp2018() {
    let rows = replace(
        &model(),
        "featureCheck",
        feature(&["Product::callGone"], &["Product::acceptanceCheck"]),
    );
    assert_eq!(check(&declared(&rows)).unwrap_err().code, "PP2018");
    let rows = replace(
        &model(),
        "featureCheck",
        feature(&["Product::callCheck"], &["Product::acceptanceGone"]),
    );
    assert_eq!(check(&declared(&rows)).unwrap_err().code, "PP2018");
}

#[test]
fn a_malformed_declaration_is_refused_with_pp2018() {
    let not_a_list = record(
        "Feature",
        Some("Foundation.Arch"),
        vec![
            ("statement", string("A feature")),
            ("calls", string("Product::callCheck")),
            ("acceptance", list(&["Product::acceptanceCheck"])),
        ],
    );
    let missing = record(
        "Journey",
        Some("Foundation.Arch"),
        vec![("actor", string("Architecture::stakeholderAuthor"))],
    );
    let mut computed = journey("Architecture::stakeholderAuthor", &[]);
    computed["body"]["kind"] = json!("application");
    for value in [not_a_list, missing, computed] {
        let rows = [("Product", "broken", value)];
        let error =
            project(rows.iter().map(|(module, id, value)| (*module, *id, value))).unwrap_err();
        assert_eq!(error.code, "PP2018", "{}", error.message);
    }
}

#[test]
fn only_the_foundation_arch_types_are_projected() {
    let foreign = record("Feature", Some("Elsewhere"), vec![]);
    let unqualified = record("Feature", None, vec![]);
    let rows = [
        ("Product", "foreign", foreign),
        ("Product", "local", unqualified),
    ];
    let declared = project(rows.iter().map(|(module, id, value)| (*module, *id, value))).unwrap();
    assert!(declared.features.is_empty());
    // Unqualified inside Foundation.Arch itself.
    let mut unqualified = feature(&["a"], &["b"]);
    unqualified["result"]["member"] = json!({"name": "Feature"});
    let rows = [("Foundation.Arch", "sample", unqualified)];
    let declared = project(rows.iter().map(|(module, id, value)| (*module, *id, value))).unwrap();
    assert!(declared.features.contains_key("Foundation.Arch::sample"));
}

#[test]
fn the_first_failure_follows_identifier_order_not_declaration_order() {
    let mut rows = replace(
        &model(),
        "featureCheck",
        feature(&[], &["Product::acceptanceCheck"]),
    );
    rows = replace(&rows, "featureBuild", feature(&["Product::callBuild"], &[]));
    let error = check(&declared(&rows)).unwrap_err();
    assert_eq!(
        error.code, "PP2015",
        "featureBuild sorts before featureCheck"
    );
    rows.reverse();
    assert_eq!(check(&declared(&rows)).unwrap_err().code, "PP2015");
}

/// The vectors of `Foundation.Holo` (`featureVector`): two stakeholders, two
/// features, the proved `validateNormalizedFeatures` verdict of each.
#[test]
fn the_normalized_validator_agrees_with_the_proved_vectors() {
    let vector = |calls: &[u64], acceptance: &[u64], actors: &[u64], steps: &[u64]| Normalized {
        stakeholder_count: 2,
        feature_count: 2,
        call_counts: calls.to_vec(),
        acceptance_counts: acceptance.to_vec(),
        journey_actors: actors.to_vec(),
        journey_steps: steps.to_vec(),
    };
    assert!(validate_normalized(&vector(
        &[1, 2],
        &[1, 1],
        &[0, 1],
        &[0, 1, 1]
    )));
    assert!(!validate_normalized(&vector(
        &[1, 0],
        &[1, 1],
        &[0, 1],
        &[0, 1, 1]
    )));
    assert!(!validate_normalized(&vector(
        &[1, 2],
        &[0, 1],
        &[0, 1],
        &[0, 1, 1]
    )));
    assert!(!validate_normalized(&vector(
        &[1, 2],
        &[1, 1],
        &[0, 1],
        &[0, 2]
    )));
    assert!(!validate_normalized(&vector(
        &[1, 2],
        &[1, 1],
        &[0, 2],
        &[0, 1, 1]
    )));
    // The counts must cover exactly the declared features.
    assert!(!validate_normalized(&vector(&[1], &[1, 1], &[0], &[0])));
}

#[test]
fn the_check_and_the_normalized_validator_agree_on_every_small_model() {
    let names = ["F::a", "F::b"];
    let actors = ["S::x", "S::y", "S::z"];
    let calls = ["", "C::one"];
    for first_calls in 0..2 {
        for second_calls in 0..2 {
            for first_acceptance in 0..2 {
                for actor in actors {
                    for step in ["F::a", "F::b", "F::c"] {
                        let mut model = Declared {
                            stakeholders: ["S::x", "S::y"].into_iter().map(str::to_owned).collect(),
                            definitions: ["C::one", "A::one"]
                                .into_iter()
                                .map(str::to_owned)
                                .collect(),
                            ..Declared::default()
                        };
                        for (name, count, acceptance) in [
                            (names[0], first_calls, first_acceptance),
                            (names[1], second_calls, 1),
                        ] {
                            model.features.insert(
                                name.to_owned(),
                                super::Feature {
                                    statement: String::new(),
                                    calls: vec![calls[1].to_owned(); count],
                                    acceptance: vec!["A::one".to_owned(); acceptance],
                                },
                            );
                        }
                        model.journeys.insert(
                            "J::one".to_owned(),
                            super::Journey {
                                actor: actor.to_owned(),
                                steps: vec![step.to_owned()],
                            },
                        );
                        let expected = first_calls == 1
                            && second_calls == 1
                            && first_acceptance == 1
                            && actor != "S::z"
                            && step != "F::c";
                        assert_eq!(check(&model).is_ok(), expected);
                        assert_eq!(validate_normalized(&normalize(&model)), expected);
                    }
                }
            }
        }
    }
}

#[test]
fn the_probe_runs_the_real_check() {
    let valid = json!({
        "stakeholders": ["S::reader"],
        "definitions": ["C::call", "A::row"],
        "features": {"F::read": {"calls": ["C::call"], "acceptance": ["A::row"]}},
        "journeys": {"J::read": {"actor": "S::reader", "steps": ["F::read"]}},
    });
    probe(&valid).unwrap();
    for (code, edit) in [
        (
            "PP2014",
            json!({"features": {"F::read": {"calls": [], "acceptance": ["A::row"]}}}),
        ),
        (
            "PP2015",
            json!({"features": {"F::read": {"calls": ["C::call"], "acceptance": []}}}),
        ),
        (
            "PP2016",
            json!({"journeys": {"J::read": {"actor": "S::reader", "steps": ["F::none"]}}}),
        ),
        (
            "PP2017",
            json!({"journeys": {"J::read": {"actor": "S::none", "steps": ["F::read"]}}}),
        ),
        ("PP2018", json!({"definitions": ["A::row"]})),
    ] {
        let mut invalid = valid.clone();
        for (key, value) in edit.as_object().unwrap() {
            invalid[key] = value.clone();
        }
        assert_eq!(probe(&invalid).unwrap_err().code, code);
    }
}

#[test]
fn a_statement_out_of_bounds_is_refused_with_pp2018() {
    for statement in ["bad\ttab".to_owned(), "x".repeat(4097)] {
        let mut declared = declared(&model());
        declared
            .features
            .get_mut("Product::featureCheck")
            .unwrap()
            .statement = statement;
        let error = check(&declared).unwrap_err();
        assert_eq!(error.code, "PP2018", "{}", error.message);
    }
    let mut declared = declared(&model());
    declared
        .features
        .get_mut("Product::featureCheck")
        .unwrap()
        .statement = format!("line one\nline two {}", "x".repeat(4000));
    check(&declared).unwrap();
}
