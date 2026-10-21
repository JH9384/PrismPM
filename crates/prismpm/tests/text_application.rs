//! Closed text application projection, schema, and legacy compatibility witnesses.

use lexlean::{CheckRequest, Engine, LockRequest, Selection};
use prismpm::holo::canonical::{decode_canonical, encode_canonical};
use prismpm::holo::model_document::{Application, ModelDocument};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

fn fixture() -> Value {
    serde_json::from_slice(
        &std::fs::read(root().join("tests/data/text-model-document.json")).unwrap(),
    )
    .unwrap()
}

fn typed(value: Value) -> ModelDocument {
    serde_json::from_value(value).unwrap()
}

fn schema() -> jsonschema::Validator {
    let schema: Value =
        serde_json::from_slice(include_bytes!("../schemas/model-document-v2.schema.json")).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

fn resource_fixture() -> Value {
    let mut value = fixture();
    value["schema"] = json!("prismpm/model-document/5");
    value["application"]["profile"] = json!("prismpm/text-application/2");
    value["application"]["core_memory_pages"] = json!(64);
    value["application"]["core_stack_bytes"] = json!(131072);
    value
}

#[test]
fn text_v2_resource_bounds_are_explicit_and_preserve_legacy_bytes() {
    let value = resource_fixture();
    let doc = typed(value.clone());
    prismpm::holo::validate::validate(&doc).unwrap();
    let bytes = encode_canonical(&doc).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), doc);
    assert_eq!(serde_json::to_value(&doc).unwrap(), value);
    assert_eq!(doc.application.as_ref().unwrap().core_memory_pages(), 64);
    assert_eq!(
        doc.application.as_ref().unwrap().core_stack_bytes(),
        Some(131072)
    );
    let original = std::fs::read(root().join("tests/data/text-model-document.json")).unwrap();
    let legacy = typed(fixture());
    assert_eq!(legacy.application.as_ref().unwrap().core_memory_pages(), 32);
    assert_eq!(
        legacy.application.as_ref().unwrap().core_stack_bytes(),
        None
    );
    let bytes = encode_canonical(&legacy).unwrap();
    assert_eq!(bytes, original.strip_suffix(b"\n").unwrap_or(&original));
}

#[test]
fn text_application_canonical_schema_roundtrip_preserves_unicode() {
    let value = fixture();
    assert!(schema().is_valid(&value));
    let doc = typed(value.clone());
    prismpm::holo::validate::validate(&doc).unwrap();
    let bytes = encode_canonical(&doc).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), doc);
    assert!(matches!(doc.application, Some(Application::Text(_))));
    let legacy: Value =
        serde_json::from_slice(include_bytes!("../schemas/model-document.schema.json")).unwrap();
    assert!(!jsonschema::validator_for(&legacy).unwrap().is_valid(&value));
    assert!(!String::from_utf8(bytes).unwrap().contains("operation_type"));
}

#[test]
fn text_application_rejects_unknown_missing_and_legacy_fields() {
    for pointer in [
        "",
        "/application",
        "/application/view",
        "/application/acceptance_vectors/0",
    ] {
        let mut bad = fixture();
        bad.pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".to_owned(), json!(true));
        assert!(!schema().is_valid(&bad), "{pointer}");
        assert!(
            serde_json::from_value::<ModelDocument>(bad).is_err(),
            "{pointer}"
        );
    }
    for pointer in ["/application", "/application/view"] {
        for field in fixture()
            .pointer(pointer)
            .unwrap()
            .as_object()
            .unwrap()
            .keys()
        {
            let mut bad = fixture();
            bad.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(field);
            assert!(!schema().is_valid(&bad), "{pointer}/{field}");
            assert!(
                serde_json::from_value::<ModelDocument>(bad).is_err(),
                "{pointer}/{field}"
            );
        }
    }
    let mut bad = fixture();
    bad["application"]["operation_type"] = json!("Operation");
    assert!(!schema().is_valid(&bad));
    assert!(serde_json::from_value::<ModelDocument>(bad).is_err());
}

#[test]
fn text_application_rejects_semantically_invalid_profiles() {
    for (pointer, replacement) in [
        ("/application/profile", json!("prismpm/text-application/3")),
        ("/application/name", json!("../outside")),
        ("/application/name", json!("/absolute")),
        ("/application/name", json!("nested\\outside")),
        ("/application/name", json!("name:stream")),
        ("/application/name", json!("name?query")),
        ("/application/core_contract", json!("unregistered")),
        ("/application/cargo_name", json!("../escape")),
        ("/application/cargo_version", json!("1.0.0-preview")),
        (
            "/application/cargo_repository",
            json!("http://github.com/UOR-Foundation/PrismPM"),
        ),
        ("/application/request_maximum", json!(0)),
        ("/application/response_maximum", json!(0)),
        ("/application/guest_allocation_maximum", json!(1)),
        ("/application/capabilities_empty", json!(false)),
        ("/application/fat_archive", json!(false)),
        ("/application/primary_layer", json!(1)),
        ("/application/primary_layer", json!(255)),
        ("/application/view_layer", json!(0)),
        ("/application/view_layer", json!(255)),
        ("/application/library_roots", json!([])),
        ("/application/library_roots", json!(["Different.dispatch"])),
        (
            "/application/library_roots",
            json!([
                "PrismTextRequest.TextRequest.dispatch",
                "PrismTextRequest.TextRequest.dispatch"
            ]),
        ),
        (
            "/application/library_roots",
            json!(["Z.last", "PrismTextRequest.TextRequest.dispatch"]),
        ),
        ("/application/entry_root", json!("unqualified")),
        ("/application/view/input_label", json!(" ")),
        ("/application/view/response_error", json!("bad\u{0}label")),
        ("/application/acceptance_vectors", json!([])),
        (
            "/application/acceptance_vectors/0/request",
            json!(vec![0; 129]),
        ),
        (
            "/application/acceptance_vectors/0/response",
            json!(vec![0; 257]),
        ),
        ("/application/acceptance_vectors/0/response", json!([255])),
        (
            "/application/acceptance_vectors/1/request",
            json!([104, 195, 169]),
        ),
    ] {
        let mut bad = fixture();
        *bad.pointer_mut(pointer).unwrap() = replacement;
        let error = prismpm::holo::validate::validate(&typed(bad)).unwrap_err();
        assert_eq!(error.code, "PP2009", "{pointer}");
    }
}

#[test]
fn text_application_schema_and_domain_sections_cannot_be_substituted() {
    let mut bad = fixture();
    bad["schema"] = json!("prismpm/model-document/1");
    assert_eq!(
        prismpm::holo::validate::validate(&typed(bad))
            .unwrap_err()
            .code,
        "PP4004"
    );
    let mut bad = fixture();
    bad.as_object_mut().unwrap().remove("application");
    assert_eq!(
        prismpm::holo::validate::validate(&typed(bad))
            .unwrap_err()
            .code,
        "PP4004"
    );
    let mut bad = fixture();
    bad["standards_profile"] = json!(["invented-standard"]);
    assert!(!schema().is_valid(&bad));
    assert_eq!(
        prismpm::holo::validate::validate(&typed(bad))
            .unwrap_err()
            .code,
        "PP2001"
    );
}

#[test]
fn text_application_vectors_exercise_request_limits_up_to_guest_allocation() {
    let mut value = fixture();
    value["application"]["guest_allocation_maximum"] = json!(256);
    value["application"]["acceptance_vectors"][3]["request"] = json!(vec![98; 256]);
    value["application"]["acceptance_vectors"][3]["response"] = json!(vec![98; 256]);
    value["application"]["acceptance_vectors"][0]["request"] = json!(vec![97; 129]);
    value["application"]["acceptance_vectors"][0]["response"] = json!(vec![97; 129]);
    prismpm::holo::validate::validate(&typed(value.clone())).unwrap();
    value["application"]["acceptance_vectors"][0]["request"] = json!(vec![97; 256]);
    value["application"]["acceptance_vectors"][0]["response"] = json!(vec![97; 256]);
    prismpm::holo::validate::validate(&typed(value.clone())).unwrap();
    value["application"]["acceptance_vectors"][0]["request"] = json!(vec![97; 257]);
    assert_eq!(
        prismpm::holo::validate::validate(&typed(value))
            .unwrap_err()
            .code,
        "PP2009"
    );
}

#[test]
fn text_application_requires_explicit_guest_allocation_boundary_evidence() {
    let mut value = fixture();
    value["application"]["acceptance_vectors"]
        .as_array_mut()
        .unwrap()
        .pop();
    assert_eq!(
        prismpm::holo::validate::validate(&typed(value))
            .unwrap_err()
            .code,
        "PP2009"
    );
}

// Exercise the complete public diagnostic value, including its exact registered code.
#[allow(clippy::result_large_err)]
fn project_fixture(source: &str) -> Result<ModelDocument, prismpm::PrismError> {
    project_fixture_with_resource_model(source, "Foundation.View.Text.V2.Model")
}

#[allow(clippy::result_large_err)]
fn project_fixture_with_resource_model(
    source: &str,
    resource_owner: &str,
) -> Result<ModelDocument, prismpm::PrismError> {
    let temp = tempfile::tempdir().unwrap();
    let repo = root();
    let fixture_project = repo.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lexlean.lock",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
    ] {
        std::fs::copy(fixture_project.join(name), temp.path().join(name)).unwrap();
    }
    for module in [
        "Foundation/Bytes.lex.tex",
        "Foundation/Utf8.lex.tex",
        "Foundation/View/Text/V1/Model.lex.tex",
    ] {
        let destination = temp.path().join("src").join(module);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::copy(repo.join("stdlib/src").join(module), destination).unwrap();
    }
    let resource_model =
        std::fs::read_to_string(repo.join("stdlib/src/Foundation/View/Text/V2/Model.lex.tex"))
            .unwrap()
            .replace("Foundation.View.Text.V2.Model", resource_owner);
    let resource_path = temp
        .path()
        .join("src")
        .join(resource_owner.replace('.', "/") + ".lex.tex");
    std::fs::create_dir_all(resource_path.parent().unwrap()).unwrap();
    std::fs::write(resource_path, resource_model).unwrap();
    std::fs::write(temp.path().join("src/TextRequest.lex.tex"), source).unwrap();
    let language = repo.join("language/prism.arch");
    for entry in walkdir::WalkDir::new(&language) {
        let entry = entry.unwrap();
        let destination = temp
            .path()
            .join("language/prism.arch")
            .join(entry.path().strip_prefix(&language).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            assert!(entry.file_type().is_file());
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let path = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&path)
        .unwrap()
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
    prismpm::holo::application::project_application(&snapshot).map(Option::unwrap)
}

fn resource_source() -> String {
    // The fixture is language-1.2 notation: derive the V2 resource application
    // by exact textual edits and require each edit to apply exactly once.
    let original = std::fs::read_to_string(
        root().join("tests/fixtures/holo/ho-11-text-application/project/src/TextRequest.lex.tex"),
    )
    .unwrap();
    let edits = [
        (
            "result: Foundation.View.Text.V1.Model::TextApplication,",
            "result: Foundation.View.Text.V2.Model::TextApplication,",
        ),
        (
            "(record Foundation.View.Text.V1.Model::TextApplication {",
            "(record Foundation.View.Text.V2.Model::TextApplication {",
        ),
        (
            "{profile := \"prismpm/text-application/1\",",
            "{profile := \"prismpm/text-application/2\",",
        ),
        (
            "guestAllocationMaximum := (128 : UInt32),",
            "guestAllocationMaximum := (128 : UInt32), coreMemoryPages := (64 : UInt32), coreStackBytes := (131072 : UInt32),",
        ),
        (
            "\\importmodule{Foundation.View.Text.V1.Model}",
            "\\importmodule{Foundation.View.Text.V1.Model}\n\\importmodule{Foundation.View.Text.V2.Model}",
        ),
    ];
    let mut source = original;
    for (from, to) in edits {
        assert_eq!(
            source.matches(from).count(),
            1,
            "fixture edit anchor {from}"
        );
        source = source.replace(from, to);
    }
    source
}

#[test]
fn text_v2_resource_bounds_project_only_from_the_exact_source_owned_type() {
    let source = resource_source();
    let doc = project_fixture(&source).unwrap();
    assert_eq!(doc.schema, "prismpm/model-document/5");
    assert_eq!(doc.application.as_ref().unwrap().core_memory_pages(), 64);
    assert_eq!(
        doc.application.as_ref().unwrap().core_stack_bytes(),
        Some(131072)
    );
    assert_eq!(project_fixture(&source).unwrap(), doc);
    let wrong_profile = source.replace("prismpm/text-application/2", "prismpm/text-application/1");
    assert_eq!(project_fixture(&wrong_profile).unwrap_err().code, "PP2009");
    let foreign = source.replace("Foundation.View.Text.V2.Model", "Foreign.Resource.Model");
    assert_eq!(
        project_fixture_with_resource_model(&foreign, "Foreign.Resource.Model")
            .unwrap_err()
            .code,
        "PP2009"
    );
}

#[test]
fn authoritative_text_application_projects_from_lexlean_imported_types() {
    for project in [
        "tests/fixtures/holo/ho-11-text-application/project",
        "tests/negative/text-application/bad-profile/project",
    ] {
        for module in [
            "Foundation/Bytes.lex.tex",
            "Foundation/Utf8.lex.tex",
            "Foundation/View/Text/V1/Model.lex.tex",
        ] {
            assert_eq!(
                std::fs::read(root().join(project).join("src").join(module)).unwrap(),
                std::fs::read(root().join("stdlib/src").join(module)).unwrap(),
                "{project} must exercise the authoritative standard-library module {module}",
            );
        }
    }
    let source = std::fs::read_to_string(
        root().join("tests/fixtures/holo/ho-11-text-application/project/src/TextRequest.lex.tex"),
    )
    .unwrap();
    let doc = project_fixture(&source).unwrap();
    assert_eq!(doc.schema, "prismpm/model-document/2");
    assert_eq!(
        serde_json::to_value(doc.application.as_ref().unwrap()).unwrap(),
        fixture()["application"]
    );
    assert!(schema().is_valid(&serde_json::to_value(&doc).unwrap()));
    assert_eq!(project_fixture(&source).unwrap(), doc);
    let invalid = source.replace("prismpm/text-application/1", "prismpm/text-application/2");
    assert_eq!(project_fixture(&invalid).unwrap_err().code, "PP2009");
}

#[test]
fn legacy_calculator_projection_retains_untagged_v1_shape() {
    let path = camino::Utf8PathBuf::from_path_buf(root().join("examples/Calculator/lexlean.toml"))
        .unwrap();
    let snapshot = Engine::load(&path)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    let doc = prismpm::holo::application::project_application(&snapshot)
        .unwrap()
        .unwrap();
    assert_eq!(doc.schema, "prismpm/model-document/1");
    let Application::Legacy(legacy) = doc.application.as_ref().unwrap() else {
        panic!("legacy profile changed")
    };
    assert_eq!(
        serde_json::to_value(doc.application.as_ref().unwrap()).unwrap(),
        serde_json::to_value(legacy).unwrap()
    );
    let value = serde_json::to_value(doc).unwrap();
    let mut wrong_version = value.clone();
    wrong_version["schema"] = json!("prismpm/model-document/2");
    assert_eq!(
        prismpm::holo::validate::validate(&typed(wrong_version))
            .unwrap_err()
            .code,
        "PP4004"
    );
    let schema: Value =
        serde_json::from_slice(include_bytes!("../schemas/model-document.schema.json")).unwrap();
    let schema = jsonschema::validator_for(&schema).unwrap();
    assert!(schema.is_valid(&value));
    for (primary, view) in [(1, 0), (2, 3), (0, 255), (255, 1)] {
        let mut bad = value.clone();
        bad["application"]["primary_layer"] = json!(primary);
        bad["application"]["view_layer"] = json!(view);
        assert!(!schema.is_valid(&bad));
        assert_eq!(
            prismpm::holo::validate::validate(&typed(bad))
                .unwrap_err()
                .code,
            "PP2001"
        );
    }
}
