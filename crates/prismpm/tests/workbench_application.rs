//! Text/3 closed source projection, cross-reference and result witnesses.
use prismpm::holo::{
    model_document::{Application, ModelDocument},
    workbench::{ResultStatus, WorkbenchApplication},
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_owned()
}
fn fixture() -> Value {
    serde_json::from_slice(include_bytes!(
        "../../../tests/data/workbench-model-document.json"
    ))
    .unwrap()
}
/// The derived workbench application: the text/3 record with its optional
/// `workbench` in the place of the Text/1 `view`, without `cli`.
fn workbench_value() -> Value {
    let mut value = fixture()["application"].clone();
    let object = value.as_object_mut().unwrap();
    let workbench = object.remove("workbench").unwrap();
    object.remove("cli").unwrap();
    object.insert("view".into(), workbench);
    value
}
fn app() -> WorkbenchApplication {
    serde_json::from_value(workbench_value()).unwrap()
}
#[test]
fn workbench_closed_contract_roundtrip_preserves_explicit_resources() {
    let value = fixture();
    let doc: ModelDocument = serde_json::from_value(value.clone()).unwrap();
    prismpm::holo::validate::validate(&doc).unwrap();
    let Some(Application::Text(text)) = &doc.application else {
        panic!("a workbench is an optional field of the text/3 application");
    };
    assert!(text.cli.is_some());
    assert_eq!(
        doc.application.as_ref().unwrap().workbench().unwrap(),
        app()
    );
    assert_eq!(doc.application.as_ref().unwrap().core_memory_pages(), 64);
    assert_eq!(
        doc.application.as_ref().unwrap().core_stack_bytes(),
        Some(131072)
    );
    let canonical = prismpm::holo::canonical::encode_canonical(&doc).unwrap();
    assert_eq!(
        prismpm::holo::canonical::decode_canonical(&canonical).unwrap(),
        doc
    );
    prismpm::contracts::CanonicalDocument::from_value("prismpm/model-document/6", value.clone())
        .unwrap();
    let schema: Value = serde_json::from_slice(include_bytes!(
        "../../../schemas/model-document-v6.schema.json"
    ))
    .unwrap();
    let validator = jsonschema::validator_for(&schema).unwrap();
    assert!(validator.is_valid(&value));
    // Without the optional workbench the same document is a plain text/3
    // command-line document and still validates.
    let mut plain = value.clone();
    plain["application"]
        .as_object_mut()
        .unwrap()
        .remove("workbench");
    assert!(validator.is_valid(&plain));
    let plain: ModelDocument = serde_json::from_value(plain).unwrap();
    prismpm::holo::validate::validate(&plain).unwrap();
    assert!(plain.application.as_ref().unwrap().workbench().is_none());
    for pointer in [
        "/application",
        "/application/view",
        "/application/workbench",
        "/application/workbench/operations/0",
        "/application/workbench/operations/0/fields/0",
        "/application/workbench/errors/0",
        "/application/workbench/statuses",
        "/application/workbench/labels",
        "/application/workbench/execution",
    ] {
        let original = value.pointer(pointer).unwrap().as_object().unwrap();
        for key in original
            .keys()
            .filter(|key| !(pointer == "/application" && key.as_str() == "workbench"))
        {
            let mut bad = value.clone();
            bad.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(!validator.is_valid(&bad), "{pointer}/{key}");
            // text/3's `cli` and Core-Wasm budgets are optional in the shared
            // text DTO and required by validation, so either owner may refuse.
            assert!(
                serde_json::from_value::<ModelDocument>(bad)
                    .map_or(true, |doc| prismpm::holo::validate::validate(&doc).is_err()),
                "{pointer}/{key}"
            );
        }
        let mut bad = value.clone();
        bad.pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unmodeled".into(), json!(true));
        assert!(!validator.is_valid(&bad));
        assert!(serde_json::from_value::<ModelDocument>(bad).is_err());
    }
    assert_eq!(
        value["application"]["workbench"]["execution"]["wasm_cache_policy"],
        "no-store"
    );
    for policy in [
        json!("default"),
        json!("force-cache"),
        json!(""),
        json!(null),
        json!(0),
    ] {
        let mut bad = value.clone();
        bad["application"]["workbench"]["execution"]["wasm_cache_policy"] = policy;
        assert!(!validator.is_valid(&bad));
        assert!(serde_json::from_value::<ModelDocument>(bad).is_err());
    }
}
#[test]
fn workbench_model_rejects_unbound_copy_references_limits_and_examples() {
    for (pointer, replacement) in [
        ("/profile", json!("prismpm/text-application/2")),
        ("/guest_allocation_maximum", json!(511)),
        ("/core_memory_pages", json!(0)),
        ("/core_stack_bytes", json!(4194304)),
        ("/view/title", json!("")),
        ("/view/labels/compute", json!("<button>\n")),
        ("/view/initial_operation", json!("absent")),
        ("/view/initial_example", json!("absent")),
        ("/view/operations/0/id", json!("raw")),
        ("/view/operations/0/request_prefix", json!("ui-raw-v1")),
        ("/view/operations/0/fields/0/id", json!("../script")),
        (
            "/view/operations/0/fields/0/choices",
            json!([{"value":"x","label":"x"}]),
        ),
        ("/view/operations/0/examples/0/values", json!([])),
        (
            "/view/operations/0/examples/0/expected_response",
            json!("{}"),
        ),
        ("/view/errors/0/fields", json!(["absent"])),
        ("/view/links/0/https_url", json!("javascript:alert(1)")),
        (
            "/view/links/0/https_url",
            json!("https://user:password@example.com"),
        ),
        ("/view/response/maximum_cells", json!(4097)),
        ("/view/response/maximum_details", json!(129)),
        ("/view/execution/timeout_milliseconds", json!(0)),
    ] {
        let mut bad = workbench_value();
        *bad.pointer_mut(pointer).unwrap() = replacement;
        let bad: WorkbenchApplication = serde_json::from_value(bad).unwrap();
        assert_eq!(
            prismpm::holo::workbench::validate(&bad).unwrap_err().code,
            "PP2009",
            "{pointer}"
        );
    }
    let mut independent = app();
    independent.response_maximum = 262144;
    assert_eq!(independent.guest_allocation_maximum, 512);
    prismpm::holo::workbench::validate(&independent).unwrap();
}
#[test]
fn workbench_result_refuses_duplicate_keys_shapes_and_unmodeled_errors() {
    let app = app();
    let good = &app.view.operations[0].examples[0].expected_response;
    assert_eq!(
        prismpm::holo::workbench::result(&app, "echo", good.as_bytes())
            .unwrap()
            .status,
        ResultStatus::Ok
    );
    for change in [
        json!({"version":2}),
        json!({"status":"unknown"}),
        json!({"operation":"raw"}),
        json!({"rows":4294967295u64,"columns":4294967295u64}),
        json!({"rows":1,"columns":2}),
        json!({"cells":[7]}),
        json!({"error":"invalid"}),
        json!({"details":vec!["x";17]}),
        json!({"unexpected":true}),
    ] {
        let mut bad: Value = serde_json::from_str(good).unwrap();
        for (k, v) in change.as_object().unwrap() {
            bad[k] = v.clone();
        }
        assert!(
            prismpm::holo::workbench::result(&app, "echo", &serde_json::to_vec(&bad).unwrap())
                .is_err()
        );
    }
    for bad in [
        good.replacen("\"version\":1", "\"version\":1,\"version\":1", 1),
        good.replacen("\"hello\"", "\"\\ud800\"", 1),
        "x".repeat(16385),
    ] {
        assert!(prismpm::holo::workbench::result(&app, "echo", bad.as_bytes()).is_err());
    }
}
#[test]
fn workbench_source_projection_uses_real_lexlean_snapshot() {
    use lexlean::{CheckRequest, Engine, LockRequest, Selection};
    let r = root();
    let work = tempfile::tempdir().unwrap();
    let source = r.join("tests/fixtures/holo/ho-19-workbench/project");
    for entry in walkdir::WalkDir::new(&source)
        .into_iter()
        .filter_entry(|entry| {
            !matches!(
                entry.file_name().to_str(),
                Some(".prism" | ".lexlean" | ".lake")
            )
        })
    {
        let entry = entry.unwrap();
        let target = work
            .path()
            .join(entry.path().strip_prefix(&source).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(target).unwrap();
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
    for name in [
        "Foundation/Bytes.lex.tex",
        "Foundation/Utf8.lex.tex",
        "Foundation/View/Text/V1/Model.lex.tex",
        "Foundation/View/Text/V3/Model.lex.tex",
    ] {
        let target = work.path().join("src").join(name);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(r.join("stdlib/src").join(name), target).unwrap();
    }
    let path = camino::Utf8PathBuf::from_path_buf(work.path().join("lexlean.toml")).unwrap();
    let engine = Engine::load(&path).unwrap();
    engine
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    let snapshot = Engine::load(&path)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    let projected = prismpm::holo::application::project_application(&snapshot)
        .unwrap()
        .unwrap();
    prismpm::holo::validate::validate(&projected).unwrap();
    assert_eq!(projected.schema, "prismpm/model-document/6");
    assert_eq!(
        serde_json::to_value(projected.application.unwrap()).unwrap(),
        fixture()["application"]
    );
}
#[test]
fn workbench_is_text3_only_and_shares_the_command_line_purpose() {
    let valid: ModelDocument = serde_json::from_value(fixture()).unwrap();
    prismpm::holo::validate::validate(&valid).unwrap();
    for (pointer, replacement) in [
        ("/application/cli/description", json!("Another purpose.\n")),
        ("/application/workbench/purpose", json!("Another purpose.")),
    ] {
        let mut bad = fixture();
        *bad.pointer_mut(pointer).unwrap() = replacement;
        let bad: ModelDocument = serde_json::from_value(bad).unwrap();
        assert_eq!(
            prismpm::holo::validate::validate(&bad).unwrap_err().code,
            "PP2009",
            "{pointer}"
        );
    }
    let mut text2 = fixture();
    let application = text2["application"].as_object_mut().unwrap();
    application.remove("cli");
    application.insert("profile".into(), json!("prismpm/text-application/2"));
    text2["schema"] = json!("prismpm/model-document/5");
    let text2: ModelDocument = serde_json::from_value(text2).unwrap();
    assert_eq!(
        prismpm::holo::validate::validate(&text2).unwrap_err().code,
        "PP2009"
    );
}

/// The fixture with a command line that speaks its own text protocol: text
/// outcome prefixes, a text response for every unframed vector, and one more
/// plain text vector. The
/// framed `ui-…-v1 U+001F …` vectors keep their JSON workbench results.
fn text_command_line_beside_workbench() -> Value {
    let mut value = fixture();
    *value.pointer_mut("/application/cli/outcomes").unwrap() = json!([
        {"name": "ok", "prefix": "ok ", "exit_code": 0},
        {"name": "error", "prefix": "error ", "exit_code": 2}
    ]);
    let vectors = value
        .pointer_mut("/application/acceptance_vectors")
        .unwrap()
        .as_array_mut()
        .unwrap();
    for vector in vectors.iter_mut() {
        if vector["request"][0] != json!(b'u') {
            vector["response"] = json!(b"error boundary".to_vec());
        }
    }
    vectors.push(json!({"request": b"plain".to_vec(), "response": b"ok plain".to_vec()}));
    value
}
#[test]
fn workbench_framed_vectors_are_not_command_line_reports() {
    let mixed: ModelDocument =
        serde_json::from_value(text_command_line_beside_workbench()).unwrap();
    prismpm::holo::validate::validate(&mixed).unwrap();
    // Without a workbench the same corpus is not a command-line corpus.
    let mut bare = text_command_line_beside_workbench();
    bare["application"]
        .as_object_mut()
        .unwrap()
        .remove("workbench");
    let bare: ModelDocument = serde_json::from_value(bare).unwrap();
    assert_eq!(
        prismpm::holo::validate::validate(&bare).unwrap_err().code,
        "PP2009"
    );
    // A workbench exempts only its own framing: an unframed report that no
    // command-line outcome classifies is still refused.
    let mut stray = text_command_line_beside_workbench();
    stray["application"]["acceptance_vectors"]
        .as_array_mut()
        .unwrap()
        .push(json!({"request": b"other".to_vec(), "response": b"{}".to_vec()}));
    let stray: ModelDocument = serde_json::from_value(stray).unwrap();
    assert_eq!(
        prismpm::holo::validate::validate(&stray).unwrap_err().code,
        "PP2009"
    );
}
