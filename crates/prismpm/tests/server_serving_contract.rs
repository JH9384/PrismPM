//! HO-36: the closed serving declaration, and the vocabulary of refusals that the
//! generated listener answers with. Nothing here executes an application.

mod support;

use prismpm::holo::model_document::Application;
use prismpm::holo::model_document::{decode_canonical, encode_canonical};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use support::{
    project, rejected, root, schema, served_declaration, served_fixture, source, typed, MODEL,
};

/// What validating a document with this edit says: the code of the refusal, or
/// `deserialize` when the document is not even the closed shape.
fn verdict(value: Value) -> String {
    match serde_json::from_value::<prismpm::holo::model_document::ModelDocument>(value) {
        Err(_) => "deserialize".to_owned(),
        Ok(document) => match prismpm::holo::validate::validate(&document) {
            Ok(()) => "accepted".to_owned(),
            Err(error) => error.code.to_string(),
        },
    }
}

fn edited(pointer: &str, replacement: Value) -> Value {
    let mut value = served_fixture();
    *value
        .pointer_mut(pointer)
        .unwrap_or_else(|| panic!("{pointer} is in the fixture")) = replacement;
    value
}

#[test]
fn serving_declaration_roundtrips_and_requires_the_closed_record() {
    let value = served_fixture();
    assert!(schema().is_valid(&value));
    let document = typed(value.clone());
    prismpm::holo::validate::validate(&document).unwrap();
    let bytes = encode_canonical(&document).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), document);
    assert_eq!(serde_json::to_value(&document).unwrap(), value);
    prismpm::model_contract::contract_from_value("prismpm/model-document/7", value.clone())
        .unwrap();
    let Some(Application::Server(server)) = &document.application else {
        panic!("the server profile projects a server application");
    };
    let serving = &server.serving[0];
    assert_eq!(serving.address, "127.0.0.1");
    assert_eq!(serving.frame.len(), 2);
    // The effect that fills the frame is declared with the others and is not the core's.
    assert_eq!(server.host.effects.len(), 3);
    assert_eq!(
        server.frame_effects().into_iter().collect::<Vec<_>>(),
        ["tool.calls"]
    );
    assert_eq!(server.core_effects().count(), 2);

    // A declaration without the serving list is not a server application; one with an
    // empty list is an application that is not served.
    let mut missing = value.clone();
    missing["application"]
        .as_object_mut()
        .unwrap()
        .remove("serving");
    assert!(!schema().is_valid(&missing));
    assert!(
        prismpm::model_contract::contract_from_value("prismpm/model-document/7", missing).is_err()
    );
    let mut unserved = value.clone();
    unserved["application"]["serving"] = json!([]);
    assert!(schema().is_valid(&unserved));
    assert_eq!(
        verdict(unserved),
        "PP2013",
        "the frame effect now has no section and no transcript"
    );
    for pointer in [
        "/application/serving/0/extra",
        "/application/serving/0/origins/0/extra",
        "/application/serving/0/frame/0/extra",
        "/application/serving/0/vectors/0/extra",
    ] {
        let mut unknown = value.clone();
        let (parent, name) = pointer.rsplit_once('/').unwrap();
        unknown.pointer_mut(parent).unwrap()[name] = json!(1);
        assert!(!schema().is_valid(&unknown), "{pointer}");
        assert!(
            prismpm::model_contract::contract_from_value("prismpm/model-document/7", unknown)
                .is_err(),
            "{pointer}"
        );
    }
    for (pointer, replacement) in [
        ("/application/serving/0/frame/0/kind", json!("u128")),
        ("/application/serving/0/port", json!(-1)),
        ("/application/serving/0/address", json!(127)),
        ("/application/serving/0/origins", json!("any")),
        ("/application/serving/0/vectors/0/request", json!("GET /")),
    ] {
        assert!(
            !schema().is_valid(&edited(pointer, replacement)),
            "{pointer}"
        );
    }
    assert!(
        schema().is_valid(&edited("/application/serving", json!([]))),
        "an unserved application is the schema's too"
    );
}

#[test]
fn serving_rejects_every_invalid_declaration() {
    let many_origins = (0..65)
        .map(|index| json!({"scheme": "http", "host": format!("host{index}"), "port": 0}))
        .collect::<Vec<_>>();
    let many_sections = (0..17)
        .map(|index| {
            json!({"name": format!("s{index}"), "kind": "u32", "effect": "", "field": "", "values": ["1"]})
        })
        .collect::<Vec<_>>();
    let section = |edit: &dyn Fn(&mut Value)| {
        let mut value = served_fixture();
        edit(&mut value["application"]["serving"][0]["frame"][0]);
        value
    };
    let serving = |name: &str, replacement: Value| {
        edited(&format!("/application/serving/0/{name}"), replacement)
    };
    let mut cases: Vec<(String, Value)> = Vec::new();
    for address in [
        "0.0.0.0",
        "localhost",
        "::1",
        "::",
        "127.0.0.2",
        "127.0.0.1 ",
        "192.168.0.1",
        "10.1.2.3",
        "",
    ] {
        cases.push((
            format!("address {address:?}"),
            serving("address", json!(address)),
        ));
    }
    for (name, replacement) in [
        ("port", json!(65_536)),
        ("connection_maximum", json!(0)),
        ("connection_maximum", json!(1025)),
        ("read_timeout_millis", json!(0)),
        ("read_timeout_millis", json!(3_600_001)),
        ("root_stack_bytes", json!(0)),
        ("root_stack_bytes", json!(65_535)),
        ("root_stack_bytes", json!((1u64 << 30) + 1)),
        ("request_line_maximum", json!(0)),
        ("request_line_maximum", json!(15)),
        ("request_line_maximum", json!((1u64 << 20) + 1)),
        ("header_count_maximum", json!(0)),
        ("header_count_maximum", json!(1025)),
        ("header_bytes_maximum", json!(0)),
        ("header_bytes_maximum", json!((16u64 << 20) + 1)),
        ("body_maximum", json!(0)),
        ("body_maximum", json!(64 * 1024 * 1024 + 1)),
        ("origins", json!(many_origins)),
        (
            "origins",
            json!([{"scheme": "ftp", "host": "localhost", "port": 0}]),
        ),
        (
            "origins",
            json!([{"scheme": "http", "host": "LocalHost", "port": 0}]),
        ),
        (
            "origins",
            json!([{"scheme": "http", "host": "local host", "port": 0}]),
        ),
        (
            "origins",
            json!([{"scheme": "http", "host": "", "port": 0}]),
        ),
        (
            "origins",
            json!([{"scheme": "http", "host": "localhost", "port": 65_536}]),
        ),
        (
            "origins",
            json!([
                {"scheme": "http", "host": "localhost", "port": 0},
                {"scheme": "http", "host": "localhost", "port": 0}
            ]),
        ),
        ("accept", json!(["*/*"])),
        ("accept", json!(["text/*"])),
        ("accept", json!(["Application/JSON"])),
        ("accept", json!(["application/json;q=1"])),
        ("accept", json!(["application/json", "application/json"])),
        ("accept", json!(["json"])),
        ("content_types", json!(["application/json; charset=utf-8"])),
        ("content_types", json!(["a/b", "a/b"])),
        ("enforced_methods", json!([])),
        ("enforced_methods", json!(["post"])),
        ("enforced_methods", json!(["POST", "POST"])),
        ("enforced_methods", json!(["PO ST"])),
        ("enforced_methods", json!(["POSTPOSTPOSTPOSTP"])),
        ("counted_field", json!("")),
        ("counted_field", json!("Mcp Method")),
        ("counted_value", json!("")),
        ("counted_value", json!("tools/\u{7}call")),
        ("frame", json!(many_sections)),
        ("vectors", json!([])),
    ] {
        cases.push((
            format!("{name} = {replacement}"),
            serving(name, replacement),
        ));
    }
    cases.push(("an accept requirement with no method".to_owned(), {
        let mut value = served_fixture();
        value["application"]["serving"][0]["enforced_methods"] = json!([]);
        value["application"]["serving"][0]["accept"] = json!([]);
        value["application"]["serving"][0]["content_types"] = json!([]);
        // Not a refusal: nothing is required, so no method is named.
        value
    }));
    let accepted_case = cases.pop().unwrap();
    assert_eq!(verdict(accepted_case.1), "accepted", "{}", accepted_case.0);
    for (name, edit) in [
        ("an unnamed section", section(&|s| s["name"] = json!(""))),
        (
            "an uppercase section name",
            section(&|s| s["name"] = json!("Calls")),
        ),
        (
            "a section of an undeclared effect",
            section(&|s| s["effect"] = json!("tool.nothing")),
        ),
        (
            "a section of an undeclared field",
            section(&|s| s["field"] = json!("nothing")),
        ),
        (
            "a section of the wrong kind",
            section(&|s| s["kind"] = json!("u32")),
        ),
        (
            "a section with two sources",
            section(&|s| s["values"] = json!(["1"])),
        ),
        (
            "a section with no source",
            section(&|s| {
                s["effect"] = json!("");
                s["field"] = json!("");
            }),
        ),
        (
            "model bytes",
            section(&|s| {
                s["effect"] = json!("");
                s["field"] = json!("");
                s["kind"] = json!("bytes");
                s["values"] = json!(["00"]);
            }),
        ),
        (
            "a number that is not canonical",
            section(&|s| {
                s["effect"] = json!("");
                s["field"] = json!("");
                s["values"] = json!(["007"]);
            }),
        ),
        ("an effect that asks for more than the connection knows", {
            let mut value = served_fixture();
            value["application"]["host"]["effects"][2]["request"] =
                json!([{"name": "secret", "kind": "text"}]);
            value["application"]["host"]["effects"][2]["request_maximum"] = json!(16);
            value
        }),
        (
            "a frame that can be larger than the exchange allows",
            edited("/application/request_maximum", json!(4096)),
        ),
        (
            "a served vector of a frame vector that does not exist",
            edited("/application/serving/0/vectors/0/vector", json!(2)),
        ),
        ("two served vectors of the same request", {
            let mut value = served_fixture();
            let vector = value["application"]["serving"][0]["vectors"][0].clone();
            value["application"]["serving"][0]["vectors"] = json!([vector.clone(), vector]);
            value
        }),
        ("two serving records", {
            let mut value = served_fixture();
            let record = value["application"]["serving"][0].clone();
            value["application"]["serving"] = json!([record.clone(), record]);
            value
        }),
    ] {
        cases.push((name.to_owned(), edit));
    }
    for (name, value) in cases {
        assert_eq!(verdict(value.clone()), "PP2024", "{name}");
        assert!(rejected(value), "{name}");
    }
    // A frame effect is not the core's to request: no transcript may name it.
    let mut transcript = served_fixture();
    transcript["application"]["host"]["transcripts"][1]["steps"] = json!([
        {"effect": "tool.calls", "request": [0], "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]}
    ]);
    assert_eq!(verdict(transcript), "PP2013");
    // An application that is served and has no effect for the core is the plain frame function.
    let mut plain = served_fixture();
    plain["application"]["host"]["effects"] =
        json!([plain["application"]["host"]["effects"][2].clone()]);
    plain["application"]["host"]["transcripts"] = json!([]);
    plain["application"]["host"]["effect_budget"] = json!(0);
    assert_eq!(verdict(plain.clone()), "accepted");
    plain["application"]["host"]["effect_budget"] = json!(1);
    assert_eq!(verdict(plain), "PP2013");
}

fn registry() -> Vec<(String, u64)> {
    let registry: toml::Value = toml::from_str(
        &std::fs::read_to_string(root().join("model/serving-diagnostics.toml")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        registry["spec"].as_str(),
        Some("prismpm/serving-diagnostics/1")
    );
    registry["refusal"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            assert!(!row["statement"].as_str().unwrap().is_empty());
            (
                row["code"].as_str().unwrap().to_owned(),
                row["status"].as_integer().unwrap() as u64,
            )
        })
        .collect()
}

fn lean_refusals() -> (Vec<String>, Vec<(String, u64)>) {
    let source =
        std::fs::read_to_string(root().join("stdlib/src/Foundation/Server/V1/Model.lex.tex"))
            .unwrap();
    let (_, after) = source.split_once("name: ServingRefusal,").unwrap();
    let (block, _) = after.split_once("]\n}").unwrap();
    let names = block
        .split("{name: ")
        .skip(1)
        .map(|row| row.split_once(',').unwrap().0.to_owned())
        .collect();
    let statuses = source
        .lines()
        .filter_map(|line| {
            let row = line.trim().strip_prefix("| ServingRefusal.")?;
            let (name, status) = row.split_once(" => ")?;
            Some((
                name.to_owned(),
                status.trim_end_matches([')', ',']).parse().ok()?,
            ))
        })
        .collect();
    (names, statuses)
}

#[test]
fn serving_refusals_agree_across_lean_registry_and_generated_adapter() {
    let registered = registry();
    let (lean, statuses) = lean_refusals();
    assert_eq!(
        registered
            .iter()
            .map(|row| row.0.clone())
            .collect::<Vec<_>>(),
        lean,
        "the registry follows the Lean constructors in order"
    );
    assert_eq!(lean.len(), lean.iter().collect::<BTreeSet<_>>().len());
    assert_eq!(
        statuses, registered,
        "the Lean status table is the registry's"
    );
    for (code, status) in &registered {
        assert!((400..=599).contains(status), "{code}");
    }
    let template = include_str!("../src/server_host/refusal.rs.in");
    let (_, enumeration) = template.split_once("pub enum ServingRefusal {").unwrap();
    let (enumeration, _) = enumeration.split_once('}').unwrap();
    let program = enumeration
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(program, lean);
    let arms = |function: &str| {
        let (_, body) = template.split_once(function).unwrap();
        let (body, _) = body.split_once("\n    }\n").unwrap();
        body.lines()
            .filter_map(|line| {
                let (name, value) = line
                    .trim()
                    .strip_prefix("ServingRefusal::")?
                    .split_once(" => ")?;
                Some((
                    name.to_owned(),
                    value.trim_end_matches(',').trim_matches('"').to_owned(),
                ))
            })
            .collect::<Vec<_>>()
    };
    assert_eq!(
        arms("pub fn status(self)"),
        registered
            .iter()
            .map(|(code, status)| (code.clone(), status.to_string()))
            .collect::<Vec<_>>()
    );
    assert_eq!(
        arms("pub fn code(self)"),
        registered
            .iter()
            .map(|(code, _)| (code.clone(), code.clone()))
            .collect::<Vec<_>>()
    );
}

#[test]
fn a_served_application_projects_from_source() {
    let application = served_declaration();
    let text = source(&application, MODEL);
    let document = project(&text, MODEL).unwrap();
    assert_eq!(document.schema, "prismpm/model-document/7");
    let Some(Application::Server(server)) = &document.application else {
        panic!("the served declaration projects a server application");
    };
    assert_eq!(serde_json::to_value(server).unwrap(), application);
    assert!(schema().is_valid(&serde_json::to_value(&document).unwrap()));
    assert_eq!(project(&text, MODEL).unwrap(), document);
    // The address is data of the source, and the only one that is admitted is checked
    // when the source is projected.
    let open = text.replace("address := \"127.0.0.1\"", "address := \"0.0.0.0\"");
    assert_ne!(open, text);
    assert_eq!(project(&open, MODEL).unwrap_err().code, "PP2024");
    // A frame section of an undeclared effect is refused in the source as in the document.
    let undeclared = text.replace("effect := \"tool.calls\"", "effect := \"tool.nothing\"");
    assert_ne!(undeclared, text);
    assert_eq!(project(&undeclared, MODEL).unwrap_err().code, "PP2024");
}
