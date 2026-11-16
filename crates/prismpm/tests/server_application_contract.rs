//! Closed server application contract: schema, validation, source projection
//! and the registered failure vocabulary shared by Lean, the registry and the
//! generated host adapter. Nothing here executes an application.

mod support;

use prismpm::holo::model_document::Application;
use prismpm::holo::model_document::{decode_canonical, encode_canonical};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use support::{declaration, fixture, project, rejected, root, schema, source, typed, MODEL};

#[test]
fn server_contract_roundtrips_and_requires_the_closed_declaration() {
    let value = fixture();
    assert!(schema().is_valid(&value));
    let doc = typed(value.clone());
    prismpm::holo::validate::validate(&doc).unwrap();
    let bytes = encode_canonical(&doc).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), doc);
    assert_eq!(serde_json::to_value(&doc).unwrap(), value);
    let Some(Application::Server(server)) = &doc.application else {
        panic!("the server profile projects a server application");
    };
    assert_eq!(server.host.effects.len(), 2);
    assert_eq!(server.host.transcripts.len(), 2);
    prismpm::model_contract::contract_from_value("prismpm/model-document/7", value.clone())
        .unwrap();

    let mut missing = value.clone();
    missing["application"]
        .as_object_mut()
        .unwrap()
        .remove("host");
    assert!(!schema().is_valid(&missing));
    assert!(
        prismpm::model_contract::contract_from_value("prismpm/model-document/7", missing).is_err()
    );
    for pointer in [
        "/application/extra",
        "/application/core/extra",
        "/application/bindings/0/extra",
        // The version of a workspace crate is its own manifest's, not the declaration's.
        "/application/bindings/0/version",
        "/application/host/extra",
        "/application/host/effects/0/extra",
        "/application/host/effects/0/request/0/extra",
        "/application/host/transcripts/0/extra",
        "/application/host/transcripts/0/steps/0/extra",
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
    let mut kind = value;
    kind["application"]["host"]["effects"][0]["request"][0]["kind"] = json!("u128");
    assert!(!schema().is_valid(&kind));
}

/// Facet records of the shared stdlib document: a real, cross-referenced set of
/// `Foundation.Arch`, `Foundation.Sec` and `Foundation.Qual` rows with their closure.
fn with_facets(mut value: Value) -> Value {
    let facets: Value = serde_json::from_slice(
        &std::fs::read(root().join("tests/golden/stdlib/build/model.prism.json")).unwrap(),
    )
    .unwrap();
    for key in ["architecture", "security", "quality", "standards_profile"] {
        value[key] = facets[key].clone();
    }
    value["provenance"]["facet_packages"] = facets["provenance"]["facet_packages"].clone();
    value
}

fn refusal(value: Value) -> String {
    prismpm::holo::validate::validate(&typed(value))
        .unwrap_err()
        .code
        .to_string()
}

#[test]
fn server_document_carries_application_owned_facet_records_like_the_other_profiles() {
    let value = with_facets(fixture());
    assert!(!value["security"]["assets"].as_array().unwrap().is_empty());
    assert!(schema().is_valid(&value));
    let doc = typed(value.clone());
    prismpm::holo::validate::validate(&doc).unwrap();
    let bytes = encode_canonical(&doc).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), doc);

    // Records without the exact facet closure are refused, as for every application.
    let mut open = value.clone();
    open["provenance"]["facet_packages"] = json!([]);
    assert_eq!(refusal(open), "PP2001");
    let mut short = value.clone();
    short["standards_profile"].as_array_mut().unwrap().pop();
    assert_eq!(refusal(short), "PP2001");
    // A record that the schema does not describe is refused by the schema.
    let mut unknown = value;
    unknown["security"]["assets"][0]["unlisted"] = json!(1);
    assert!(!schema().is_valid(&unknown));
}

#[test]
fn server_contract_rejects_every_invalid_declaration() {
    let many_effects = (0..65)
        .map(|index| {
            json!({
                "name": format!("effect.n{index}"),
                "request": [],
                "result": [],
                "failures": [],
                "request_maximum": 4,
                "result_maximum": 4
            })
        })
        .collect::<Vec<_>>();
    let mutations: Vec<(&str, Value)> = vec![
        (
            "/application/profile",
            json!("prismpm/server-application/2"),
        ),
        ("/application/profile", json!("prismpm/text-application/3")),
        (
            "/application/host/protocol",
            json!("prismpm/host-effects/2"),
        ),
        ("/application/request_maximum", json!(0)),
        ("/application/request_maximum", json!(64 * 1024 * 1024 + 1)),
        ("/application/response_maximum", json!(0)),
        ("/application/response_maximum", json!(64 * 1024 * 1024 + 1)),
        ("/application/cargo_name", json!("Not A Crate")),
        ("/application/cargo_version", json!("1")),
        ("/application/core/root", json!("dispatch")),
        ("/application/core/package", json!("Not A Crate")),
        ("/application/core/package", json!("server_probe_host")),
        ("/application/core/package", json!("std")),
        ("/application/core/package", json!("fn")),
        ("/application/core/version", json!("1")),
        ("/application/core/version", json!("01.0.0")),
        ("/application/bindings", json!([])),
        (
            "/application/bindings",
            json!([
                {"path": "a", "crate_name": "a-binding", "host": "a_binding::Native"},
                {"path": "b", "crate_name": "b-binding", "host": "b_binding::Native"}
            ]),
        ),
        ("/application/bindings/0/crate_name", json!("Binding")),
        (
            "/application/bindings/0/crate_name",
            json!("server-probe-host"),
        ),
        (
            "/application/bindings/0/crate_name",
            json!("server_probe_core"),
        ),
        (
            "/application/bindings/0/crate_name",
            json!("server-probe-host-api"),
        ),
        ("/application/bindings/0/path", json!("")),
        ("/application/bindings/0/path", json!("/abs/path")),
        ("/application/bindings/0/path", json!("../outside")),
        (
            "/application/bindings/0/path",
            json!("bindings/../../outside"),
        ),
        ("/application/bindings/0/path", json!("bindings/./b")),
        ("/application/bindings/0/path", json!("bindings//b")),
        ("/application/bindings/0/path", json!("bindings/b/")),
        ("/application/bindings/0/path", json!("bindings\\b")),
        ("/application/bindings/0/path", json!(".hidden/b")),
        ("/application/bindings/0/path", json!("target/debug/b")),
        ("/application/bindings/0/path", json!("server-probe-host")),
        (
            "/application/bindings/0/path",
            json!("server-probe-host-api/binding"),
        ),
        ("/application/bindings/0/path", json!("a/b/c/d/e/f/g/h/i")),
        (
            "/application/bindings/0/host",
            json!("other_binding::Native"),
        ),
        ("/application/bindings/0/host", json!("Native")),
        ("/application/bindings/0/host", json!("binding::fn")),
        ("/application/bindings/0/host", json!("binding::")),
        (
            "/application/bindings/0/host",
            json!("binding::Native; evil"),
        ),
        ("/application/host/description", json!("  \n")),
        ("/application/host/description", json!("bell\u{7}")),
        ("/application/host/usage_code", json!(74)),
        ("/application/host/usage_code", json!(0)),
        ("/application/host/usage_code", json!(126)),
        ("/application/host/io_code", json!(70)),
        ("/application/host/fault_code", json!(64)),
        ("/application/host/fault_code", json!(0)),
        ("/application/host/effect_budget", json!(0)),
        ("/application/host/effect_budget", json!(257)),
        ("/application/host/effects", json!(many_effects)),
        ("/application/host/effects/0/name", json!("Store.Get")),
        ("/application/host/effects/0/name", json!("store..get")),
        ("/application/host/effects/0/name", json!("store.")),
        ("/application/host/effects/0/name", json!("")),
        ("/application/host/effects/0/name", json!("fn")),
        ("/application/host/effects/0/name", json!("failure")),
        ("/application/host/effects/0/name", json!("std")),
        ("/application/host/effects/0/name", json!("store_get")),
        ("/application/host/effects/0/name", json!("clock.now")),
        ("/application/host/effects/0/request/0/name", json!("Key")),
        ("/application/host/effects/0/request/0/name", json!("self")),
        ("/application/host/effects/0/request/0/name", json!("limit")),
        (
            "/application/host/effects/0/request/0/name",
            json!("trailing_"),
        ),
        (
            "/application/host/effects/0/request/0/name",
            json!("double__score"),
        ),
        ("/application/host/effects/0/result/0/name", json!("note")),
        ("/application/host/effects/0/failures/0", json!("Denied")),
        ("/application/host/effects/0/failures/0", json!("self")),
        (
            "/application/host/effects/0/failures/0",
            json!("unavailable"),
        ),
        ("/application/host/effects/0/request_maximum", json!(0)),
        ("/application/host/effects/0/request_maximum", json!(7)),
        (
            "/application/host/effects/0/request_maximum",
            json!(16 * 1024 * 1024 + 1),
        ),
        ("/application/host/effects/0/result_maximum", json!(7)),
        (
            "/application/host/effects/0/result_maximum",
            json!(16 * 1024 * 1024 + 1),
        ),
        ("/application/host/effects/1/result_maximum", json!(11)),
        ("/application/host/effects/1/request_maximum", json!(0)),
        ("/application/host/transcripts/0/vector", json!(1)),
        ("/application/host/transcripts/0/vector", json!(2)),
        ("/application/host/transcripts/0/steps", json!([])),
        (
            "/application/host/transcripts/1/steps",
            json!([
                {"effect": "clock.now", "request": [], "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]},
                {"effect": "clock.now", "request": [], "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]},
                {"effect": "clock.now", "request": [], "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1]}
            ]),
        ),
        (
            "/application/host/transcripts/0/steps/0/effect",
            json!("store.put"),
        ),
        (
            "/application/host/transcripts/0/steps/0/request",
            json!([0, 0, 0, 1, 107, 0, 0, 0]),
        ),
        (
            "/application/host/transcripts/0/steps/0/request",
            json!([0, 0, 0, 1, 107, 0, 0, 0, 7, 0]),
        ),
        (
            "/application/host/transcripts/0/steps/0/outcome",
            json!([0, 0, 0, 2]),
        ),
        (
            "/application/host/transcripts/0/steps/0/outcome",
            json!([0, 0, 0, 0, 2, 0, 0, 0, 0]),
        ),
        (
            "/application/host/transcripts/0/steps/0/outcome",
            json!([0, 0, 0, 1, 0, 0, 0, 2]),
        ),
        (
            "/application/host/transcripts/0/steps/0/outcome",
            json!([0, 0, 0, 0, 1, 0, 0, 0, 1, 0xff]),
        ),
        ("/application/acceptance_vectors", json!([])),
        (
            "/application/acceptance_vectors",
            json!([{"request": [97], "response": [98]}, {"request": [97], "response": [99]}]),
        ),
        (
            "/application/acceptance_vectors/0/request",
            json!([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        ),
        (
            "/application/acceptance_vectors/0/response",
            json!([1, 2, 3, 4, 5, 6, 7, 8, 9]),
        ),
    ];
    for (pointer, replacement) in mutations {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = replacement.clone();
        assert!(rejected(value), "{pointer} = {replacement}");
    }
    // No effect is exercised by a transcript: the declaration is incomplete.
    let mut unexercised = fixture();
    unexercised["application"]["host"]["transcripts"]
        .as_array_mut()
        .unwrap()
        .remove(0);
    assert!(rejected(unexercised));
    // The turn of the largest budget must fit a 32-bit length.
    let mut unbounded = fixture();
    unbounded["application"]["request_maximum"] = json!(64 * 1024 * 1024);
    unbounded["application"]["host"]["effect_budget"] = json!(256);
    unbounded["application"]["host"]["effects"][0]["result_maximum"] = json!(16 * 1024 * 1024);
    assert!(rejected(unbounded));
    // With no effects declared the budget, effects and transcripts are empty.
    let mut plain = fixture();
    plain["application"]["host"]["effects"] = json!([]);
    plain["application"]["host"]["transcripts"] = json!([]);
    assert!(rejected(plain.clone()));
    plain["application"]["host"]["effect_budget"] = json!(0);
    // A binding crate without an effect to serve is refused.
    assert!(rejected(plain.clone()));
    plain["application"]["bindings"] = json!([]);
    assert!(!rejected(plain));
}

#[test]
fn server_contract_binds_the_profile_and_schema_together() {
    let mut wrong_schema = fixture();
    wrong_schema["schema"] = json!("prismpm/model-document/6");
    assert!(rejected(wrong_schema));
    let mut older = fixture();
    older["schema"] = json!("prismpm/model-document/2");
    assert!(rejected(older));
    // A text document is not accepted under the server schema.
    let mut text: Value = serde_json::from_slice(
        &std::fs::read(root().join("tests/data/text-model-document.json")).unwrap(),
    )
    .unwrap();
    text["schema"] = json!("prismpm/model-document/7");
    assert!(rejected(text));
}

fn lean_failures() -> Vec<String> {
    let source =
        std::fs::read_to_string(root().join("stdlib/src/Foundation/Server/V1/Model.lex.tex"))
            .unwrap();
    let (_, after) = source.split_once("name: ServerFailure,").unwrap();
    let (block, _) = after.split_once("]\n}").unwrap();
    block
        .split("{name: ")
        .skip(1)
        .map(|row| row.split_once(',').unwrap().0.to_owned())
        .collect()
}

fn lean_classes() -> Vec<(String, String)> {
    let source =
        std::fs::read_to_string(root().join("stdlib/src/Foundation/Server/V1/Model.lex.tex"))
            .unwrap();
    source
        .lines()
        .filter_map(|line| {
            let row = line.trim().strip_prefix("| ServerFailure.")?;
            let (name, class) = row.split_once(" => (ctor ServerFailureClass.")?;
            Some((
                name.to_owned(),
                class.trim_end_matches([')', ',']).to_owned(),
            ))
        })
        .collect()
}

#[test]
fn host_failures_agree_across_lean_registry_and_generated_adapter() {
    let registry: toml::Value = toml::from_str(
        &std::fs::read_to_string(root().join("model/host-effects-diagnostics.toml")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        registry["spec"].as_str(),
        Some("prismpm/host-effects-diagnostics/1")
    );
    let rows = registry["failure"].as_array().unwrap();
    let registered = rows
        .iter()
        .map(|row| row["code"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    let lean = lean_failures();
    assert_eq!(
        registered, lean,
        "registry order must follow the Lean constructors"
    );
    assert_eq!(lean.len(), lean.iter().collect::<BTreeSet<_>>().len());
    let classes = lean_classes();
    assert_eq!(classes.len(), lean.len());
    for row in rows {
        let code = row["code"].as_str().unwrap();
        let class = classes.iter().find(|(name, _)| name == code).unwrap();
        assert_eq!(
            row["class"].as_str().unwrap(),
            class.1.to_lowercase(),
            "{code}"
        );
        assert!(!row["statement"].as_str().unwrap().is_empty(), "{code}");
    }
    let template = include_str!("../src/server_host/failure.rs.in");
    let (_, enumeration) = template.split_once("pub enum Failure {").unwrap();
    let (enumeration, _) = enumeration.split_once('}').unwrap();
    let program = enumeration
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(program, lean);
    let (_, arms) = template.split_once("pub fn class(self)").unwrap();
    let mut program_classes = Vec::new();
    // Each arm lists the failures that precede its `=> FailureClass::Class`.
    let mut remaining = arms;
    while let Some((names, rest)) = remaining.split_once("=> FailureClass::") {
        let class = rest
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .collect::<String>();
        for name in names.split("Failure::").skip(1) {
            let name = name
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect::<String>();
            program_classes.push((name, class.clone()));
        }
        remaining = rest;
    }
    program_classes.sort();
    let mut modeled = classes.clone();
    modeled.sort();
    assert_eq!(program_classes, modeled);
}

#[test]
fn server_application_projects_only_from_the_exact_source_owned_type() {
    let application = declaration();
    let source = source(&application, MODEL);
    let doc = project(&source, MODEL).unwrap();
    assert_eq!(doc.schema, "prismpm/model-document/7");
    let Some(Application::Server(server)) = &doc.application else {
        panic!("the server declaration projects a server application");
    };
    assert_eq!(serde_json::to_value(server).unwrap(), application);
    assert!(schema().is_valid(&serde_json::to_value(&doc).unwrap()));
    assert_eq!(project(&source, MODEL).unwrap(), doc);

    let wrong_profile = source.replace(
        "prismpm/server-application/1",
        "prismpm/server-application/2",
    );
    assert_eq!(project(&wrong_profile, MODEL).unwrap_err().code, "PP2013");
    let foreign = source.replace(MODEL, "Foreign.Server.Model");
    assert_eq!(
        project(&foreign, "Foreign.Server.Model").unwrap_err().code,
        "PP2013"
    );
    // A transcript step that names an undeclared effect is refused when the source is projected.
    let undeclared = source.replace(
        "\"clock.now\", request := 0x",
        "\"clock.tick\", request := 0x",
    );
    assert_eq!(project(&undeclared, MODEL).unwrap_err().code, "PP2013");
    // The entry root must be a definition of the sources.
    let missing = source.replace("name: dispatch,", "name: other,");
    assert_eq!(project(&missing, MODEL).unwrap_err().code, "PP2001");
}

#[test]
#[allow(clippy::result_large_err)]
fn a_verification_build_bound_outside_its_range_is_refused() {
    let validate = |seconds: Value| {
        let mut value = fixture();
        value["application"]["verify_build_timeout_seconds"] = seconds;
        let schema_accepts = schema().is_valid(&value);
        let document =
            serde_json::from_value::<prismpm::holo::model_document::ModelDocument>(value);
        (
            schema_accepts,
            document.map(|doc| prismpm::holo::validate::validate(&doc)),
        )
    };
    // The bound is model data from 1 to 7200 seconds; the ends are admitted.
    for seconds in [1, 1800, 7200] {
        let (schema_accepts, outcome) = validate(json!(seconds));
        assert!(schema_accepts, "{seconds}");
        outcome.unwrap().unwrap();
    }
    // Outside it the declaration is refused by the schema and by validation, with the
    // declaration code.
    for seconds in [0u64, 7201, u64::from(u32::MAX)] {
        let (schema_accepts, outcome) = validate(json!(seconds));
        assert!(!schema_accepts, "{seconds}");
        let error = outcome
            .unwrap()
            .expect_err("a bound outside its range is refused");
        assert_eq!(error.code, "PP2013", "{seconds}: {}", error.message);
        assert!(error.message.contains("7200"), "{}", error.message);
    }
    // A negative or fractional bound is not a number of seconds at all.
    for seconds in [json!(-1), json!(1.5), json!("1800"), json!(null)] {
        let (schema_accepts, outcome) = validate(seconds.clone());
        assert!(!schema_accepts, "{seconds}");
        assert!(outcome.is_err(), "{seconds}");
    }
    // The bound is required: a declaration without it is not a server application.
    let mut missing = fixture();
    missing["application"]
        .as_object_mut()
        .unwrap()
        .remove("verify_build_timeout_seconds");
    assert!(!schema().is_valid(&missing));
    assert!(rejected(missing));

    // From source: the same range is enforced where the declaration is written.
    let declared = declaration();
    for seconds in [0, 7201] {
        let mut value = declared.clone();
        value["verify_build_timeout_seconds"] = json!(seconds);
        let error = project(&source(&value, MODEL), MODEL)
            .and_then(|doc| prismpm::holo::validate::validate(&doc))
            .expect_err("a source bound outside its range is refused");
        assert_eq!(error.code, "PP2013", "{seconds}: {}", error.message);
    }
    project(&source(&declared, MODEL), MODEL).unwrap();
}
