//! Owning source/declaration evidence only; no browser execution acceptance.

use lexlean::{CheckRequest, Engine, LockRequest, Selection};
use prismpm::holo::model_document::{Application, ModelDocument};
use serde_json::{json, Value};
use std::path::Path;

fn copy_tree(source: &Path, destination: &Path) {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.unwrap();
        let target = destination.join(entry.path().strip_prefix(source).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(target).unwrap();
        } else {
            assert!(entry.file_type().is_file());
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn fixture(root: &Path, source: &str, model: &str) -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    let base = root.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lexlean.lock",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
        "prismpm.toml",
    ] {
        let text = std::fs::read_to_string(base.join(name))
            .unwrap()
            .replace("PrismTextRequest", "BrowserContract")
            .replace("TextRequest.lex.tex", "Probe.lex.tex");
        std::fs::write(temp.path().join(name), text).unwrap();
    }
    let path = temp
        .path()
        .join("src/Foundation/Browser/Application/V1/Model.lex.tex");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, model).unwrap();
    std::fs::write(temp.path().join("src/Probe.lex.tex"), source).unwrap();
    copy_tree(
        &root.join("language/prism.arch"),
        &temp.path().join("language/prism.arch"),
    );
    let path = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&path)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    temp
}

// Keep the complete public diagnostic available to owning rejection assertions.
#[allow(clippy::result_large_err)]
fn project(path: &Path) -> Result<ModelDocument, prismpm::PrismError> {
    let config = camino::Utf8PathBuf::from_path_buf(path.join("lexlean.toml")).unwrap();
    let snapshot = Engine::load(&config)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    prismpm::holo::application::project_application(&snapshot).map(Option::unwrap)
}

fn mutate(source: &str, change: impl FnOnce(&mut Value)) -> String {
    let line = source
        .lines()
        .find(|l| l.starts_with("\\semanticdata{"))
        .unwrap();
    let mut value: Value = serde_json::from_str(
        line.strip_prefix("\\semanticdata{")
            .unwrap()
            .strip_suffix('}')
            .unwrap(),
    )
    .unwrap();
    change(&mut value);
    source.replace(
        line,
        &format!(
            "\\semanticdata{{{}}}",
            serde_json::to_string(&value).unwrap()
        ),
    )
}

fn field<'a>(module: &'a mut Value, name: &str) -> &'a mut Value {
    &mut module["declarations"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["name"] == "browserApplication")
        .unwrap()["body"]["fields"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|v| v["field"] == name)
        .unwrap()["value"]
}

fn typed(value: Value) -> prismpm::holo::browser_application::BrowserApplication {
    serde_json::from_value(value).unwrap()
}

/// Exercise the entire closed source/projection slice and its build refusal.
pub fn verify(root: &Path) {
    let source =
        std::fs::read_to_string(root.join("tests/fixtures/browser-application/Probe.lex.tex"))
            .unwrap();
    let model = std::fs::read_to_string(
        root.join("stdlib/src/Foundation/Browser/Application/V1/Model.lex.tex"),
    )
    .unwrap();
    let first = fixture(root, &source, &model);
    let second = fixture(root, &source, &model);
    let document = project(first.path()).expect("actual checked source projects");
    assert_eq!(
        document,
        project(second.path()).unwrap(),
        "independent source projection identities agree"
    );
    assert_eq!(document.schema, "prismpm/model-document/4");
    let expected: Value = serde_json::from_slice(
        &std::fs::read(root.join("tests/data/browser-application-declaration.json")).unwrap(),
    )
    .unwrap();
    let mut aliased = expected.clone();
    aliased["durability"]["resource"] = json!("store");
    assert_eq!(
        prismpm::holo::browser_application::validate(&typed(aliased))
            .expect_err("private operation journal cannot reuse an application grant")
            .code,
        "PP2010"
    );
    assert_eq!(
        serde_json::to_value(document.application.as_ref().unwrap()).unwrap(),
        expected
    );
    for label in [
        "Ready",
        "Runtime unavailable",
        "Verified production service",
    ] {
        let mut changed = expected.clone();
        changed["view"]["labels"][0]["text"] = json!(label);
        let browser = typed(changed);
        prismpm::holo::browser_application::validate(&browser).unwrap();
        let application = Application::Browser(Box::new(browser));
        assert_eq!(
            prismpm::holo::browser_application::require_runtime(&application)
                .expect_err("display labels cannot confer runtime acceptance")
                .code,
            "PP2011"
        );
        assert_eq!(source.matches("\"Runtime unavailable\"").count(), 1);
        let relabeled_source = source.replace(
            "\"Runtime unavailable\"",
            &serde_json::to_string(label).unwrap(),
        );
        let relabeled = fixture(root, &relabeled_source, &model);
        assert_eq!(
            project(relabeled.path()).unwrap().application,
            Some(application),
            "actual LexLean source projects the changed label"
        );
        let controller = prismpm::Controller::load(relabeled.path()).unwrap();
        controller
            .check(prismpm::controller::CheckRequest { config_path: None })
            .unwrap();
        assert_eq!(
            controller
                .build(prismpm::controller::BuildRequest { config_path: None })
                .expect_err("a changed source label cannot enable public generation")
                .code,
            "PP2011"
        );
        assert_eq!(
            controller
                .verify(prismpm::controller::VerifyRequest { config_path: None })
                .expect_err("a changed source label cannot enable public verification")
                .code,
            "PP2011"
        );
        for path in [".prism", ".lexlean/build"] {
            assert!(
                !relabeled.path().join(path).exists(),
                "refused source label {label:?} must publish no {path}"
            );
        }
    }
    let bytes = prismpm::holo::canonical::encode_canonical(&document).unwrap();
    assert_eq!(
        prismpm::holo::canonical::decode_canonical(&bytes).unwrap(),
        document
    );
    let value = serde_json::to_value(&document).unwrap();
    let schema: Value = serde_json::from_slice(
        &std::fs::read(root.join("schemas/model-document-v4.schema.json")).unwrap(),
    )
    .unwrap();
    let schema = jsonschema::validator_for(&schema).unwrap();
    assert!(schema.is_valid(&value));
    prismpm::contracts::CanonicalDocument::parse("prismpm/model-document/4", &bytes).unwrap();
    let controller = prismpm::Controller::load(first.path()).unwrap();
    controller
        .check(prismpm::controller::CheckRequest { config_path: None })
        .unwrap();
    assert_eq!(
        controller
            .build(prismpm::controller::BuildRequest { config_path: None })
            .unwrap_err()
            .code,
        "PP2011"
    );
    assert!(
        !first.path().join(".prism").exists(),
        "refused build publishes nothing"
    );
    assert!(
        !first.path().join(".lexlean/build").exists(),
        "refused build starts no code generation"
    );

    // No giant embedded vector or cap reduction substitutes for future runtime maxima.
    let mut large = expected.clone();
    large["request_maximum"] = json!(67_108_864);
    large["guest_allocation_maximum"] = json!(67_108_864);
    large["response_maximum"] = json!(67_108_864);
    large["memory_pages"] = json!(16384);
    prismpm::holo::browser_application::validate(&typed(large)).unwrap();

    for (context, accepted) in [
        ("a".to_owned(), true),
        ("A9._-/context".to_owned(), true),
        ("a".repeat(128), true),
        ("a".repeat(129), false),
        ("scope:record".to_owned(), false),
        ("a..b".to_owned(), false),
        (".scope".to_owned(), false),
        ("/scope".to_owned(), false),
        ("_scope".to_owned(), false),
        ("-scope".to_owned(), false),
        ("é".to_owned(), false),
        ("scope\n".to_owned(), false),
    ] {
        for index in [3, 5] {
            let mut changed = expected.clone();
            changed["requested_effects"][index]["adapter"]["context"] = json!(context);
            let actual = prismpm::holo::browser_application::validate(&typed(changed.clone()));
            assert_eq!(actual.is_ok(), accepted, "signature context {context:?}");
            if let Err(error) = actual {
                assert_eq!(error.code, "PP2010");
            }
            let mut changed_document = value.clone();
            changed_document["application"] = changed;
            assert_eq!(
                schema.is_valid(&changed_document),
                accepted,
                "schema signature context {context:?}"
            );
        }
    }
    let mut guest_protocol = expected.clone();
    guest_protocol["requested_effects"][1]["adapter"]["protocol"] = json!("urn:fixture/1");
    prismpm::holo::browser_application::validate(&typed(guest_protocol)).unwrap();

    for maximum in [2, 3, 1024] {
        let mut changed = expected.clone();
        changed["durability"]["maximum_records"] = json!(maximum);
        prismpm::holo::browser_application::validate(&typed(changed)).unwrap();
    }
    // Slot sharing is safe only when the exact signing context differs.
    let mut alias = expected.clone();
    alias["requested_effects"][3]["adapter"]["context"] =
        json!("prismpm/browser-operation-journal/1");
    assert_eq!(
        prismpm::holo::browser_application::validate(&typed(alias.clone()))
            .unwrap_err()
            .code,
        "PP2010"
    );
    alias["requested_effects"][3]["adapter"]["credential_slot"] = json!("separate-key");
    prismpm::holo::browser_application::validate(&typed(alias)).unwrap();
    for count in [63, 64] {
        let mut changed = expected.clone();
        changed["requested_effects"] = json!((0..count).map(|i| json!({
            "resource": format!("sign{i:02}"),
            "adapter": {"kind":"sign", "credential_slot":format!("slot{i:02}"), "context":"app/1", "maximum":1}
        })).collect::<Vec<_>>());
        assert_eq!(
            prismpm::holo::browser_application::validate(&typed(changed)).is_ok(),
            count == 63,
            "total custody includes private journal"
        );
    }

    for (pointer, bad) in [
        ("/profile", json!("prismpm/browser-application/2")),
        ("/protocol", json!("prismpm/browser-application-session/2")),
        ("/core_contract", json!("other")),
        ("/capabilities_empty", json!(false)),
        ("/view/surface", json!("portable")),
        ("/view/presentation_root", json!("Missing.view")),
        ("/view/labels/0/text", json!("control\u{0000}")),
        ("/durability/max_pending", json!(2)),
        ("/durability/resource", json!("sign")),
        ("/durability/resource", json!("journal-sign")),
        ("/durability/namespace", json!("browser-contract")),
        ("/durability/namespace", json!("../private")),
        ("/durability/staging_head", json!("operations")),
        ("/durability/staging_head", json!("")),
        ("/durability/signing_resource", json!("sign")),
        ("/durability/signing_resource", json!("journal")),
        ("/durability/credential_slot", json!("../key")),
        ("/durability/maximum_records", json!(1)),
        ("/durability/maximum_records", json!(1025)),
        ("/durability/replay_root", json!("Missing.replay")),
        ("/memory_pages", json!(0)),
        ("/memory_pages", json!(16385)),
        ("/guest_allocation_maximum", json!(0)),
        ("/request_maximum", json!(0)),
        ("/requested_effects/0/adapter/maximum", json!(1048577)),
        (
            "/requested_effects/1/adapter/entry_root",
            json!("Missing.guest"),
        ),
        ("/requested_effects/1/adapter/input_maximum", json!(2097153)),
        ("/requested_effects/2/adapter/maximum", json!(65537)),
        (
            "/requested_effects/3/adapter/credential_slot",
            json!("../key"),
        ),
        ("/requested_effects/3/adapter/context", json!("")),
        ("/requested_effects/4/adapter/namespace", json!("../store")),
        ("/requested_effects/4/adapter/max_objects", json!(4097)),
        (
            "/requested_effects/5/adapter/context",
            json!("bad\ncontext"),
        ),
    ] {
        let mut changed = expected.clone();
        *changed.pointer_mut(pointer).unwrap() = bad;
        assert_eq!(
            prismpm::holo::browser_application::validate(&typed(changed))
                .unwrap_err()
                .code,
            "PP2010",
            "{pointer}"
        );
    }
    for pointer in [
        "",
        "/view",
        "/durability",
        "/requested_effects/0",
        "/requested_effects/0/adapter",
        "/view/labels/0",
    ] {
        let mut changed = value.clone();
        changed
            .pointer_mut(&format!("/application{pointer}"))
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("unknown".into(), json!(true));
        assert!(!schema.is_valid(&changed), "unknown field {pointer}");
        assert!(serde_json::from_value::<ModelDocument>(changed).is_err());
    }
    for pointer in [
        "/application",
        "/application/view",
        "/application/durability",
        "/application/requested_effects/0/adapter",
    ] {
        let object = value.pointer(pointer).unwrap().as_object().unwrap();
        for key in object.keys() {
            let mut changed = value.clone();
            changed
                .pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(key);
            assert!(!schema.is_valid(&changed), "missing {pointer}/{key}");
            assert!(serde_json::from_value::<ModelDocument>(changed).is_err());
        }
    }
    for change in [
        "kind",
        "order",
        "duplicate",
        "namespace",
        "labels",
        "vectors",
    ] {
        let mut changed = expected.clone();
        match change {
            "kind" => {
                changed["requested_effects"][0]["adapter"]["kind"] = json!("network");
                assert!(serde_json::from_value::<
                    prismpm::holo::browser_application::BrowserApplication,
                >(changed)
                .is_err());
                continue;
            }
            "order" => changed["requested_effects"]
                .as_array_mut()
                .unwrap()
                .swap(0, 1),
            "duplicate" => {
                let first = changed["requested_effects"][0].clone();
                changed["requested_effects"][1] = first;
            }
            "namespace" => {
                let mut store = changed["requested_effects"][4].clone();
                store["resource"] = json!("store2");
                changed["requested_effects"]
                    .as_array_mut()
                    .unwrap()
                    .insert(5, store);
            }
            "labels" => {
                let row = changed["view"]["labels"][0].clone();
                changed["view"]["labels"].as_array_mut().unwrap().push(row);
            }
            "vectors" => {
                let row = changed["acceptance_vectors"][0].clone();
                changed["acceptance_vectors"]
                    .as_array_mut()
                    .unwrap()
                    .push(row);
            }
            _ => unreachable!(),
        }
        assert_eq!(
            prismpm::holo::browser_application::validate(&typed(changed))
                .unwrap_err()
                .code,
            "PP2010",
            "{change}"
        );
    }
    let mut maxima = expected.clone();
    maxima["request_maximum"] = json!(24576);
    maxima["guest_allocation_maximum"] = json!(24576);
    maxima["acceptance_vectors"] = json!([{"request":vec![0;24575],"response":[0]}]);
    maxima["view"]["labels"] = json!((0..256)
        .map(|i| json!({"id":format!("label{i:03}"),"text":"x".repeat(4096)}))
        .collect::<Vec<_>>());
    let mut resources = (0..63).map(|i|json!({"resource":format!("resource{i:02}"),"adapter":{"kind":"digest","maximum":1048576}})).collect::<Vec<_>>();
    resources.push(expected["requested_effects"][4].clone());
    maxima["requested_effects"] = json!(resources);
    let mut roots = (0..1021)
        .map(|i| format!("BrowserContract.Probe.extra{i:04}"))
        .collect::<Vec<_>>();
    roots.extend(
        expected["library_roots"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned()),
    );
    roots.sort();
    maxima["library_roots"] = json!(roots);
    // DTO/container maxima only: these added symbols do not claim source execution.
    prismpm::holo::browser_application::validate(&typed(maxima.clone())).unwrap();
    let mut maximum_document = value.clone();
    maximum_document["application"] = maxima.clone();
    prismpm::contracts::CanonicalDocument::parse(
        "prismpm/model-document/4",
        &prismpm::holo::canonical::encode_value(&maximum_document).unwrap(),
    )
    .unwrap();
    for pointer in ["/requested_effects", "/view/labels", "/library_roots"] {
        let mut over = maxima.clone();
        let rows = over.pointer_mut(pointer).unwrap().as_array_mut().unwrap();
        rows.push(rows.last().unwrap().clone());
        assert_eq!(
            prismpm::holo::browser_application::validate(&typed(over))
                .unwrap_err()
                .code,
            "PP2010"
        );
    }
    for version in [
        "prismpm/model-document/1",
        "prismpm/model-document/2",
        "prismpm/model-document/3",
    ] {
        let mut wrong = document.clone();
        wrong.schema = version.into();
        assert_eq!(
            prismpm::holo::validate::validate(&wrong).unwrap_err().code,
            "PP4004"
        );
    }
    let mut vectors = expected.clone();
    vectors["guest_allocation_maximum"] = json!(24576);
    vectors["request_maximum"] = json!(24576);
    vectors["acceptance_vectors"] = json!([{"request":vec![0;24575],"response":[0]}]);
    prismpm::holo::browser_application::validate(&typed(vectors.clone())).unwrap();
    vectors["acceptance_vectors"][0]["request"] = json!(vec![0; 24576]);
    assert_eq!(
        prismpm::holo::browser_application::validate(&typed(vectors))
            .unwrap_err()
            .code,
        "PP2010"
    );

    for changed in [
        source.replace(
            "prismpm/browser-application/1",
            "prismpm/browser-application/2",
        ),
        source.replace("prismpm/fixture/1", "scope:record"),
        source.replace("prismpm/fixture/1", "scope..record"),
        mutate(&source, |m| {
            field(m, "entryRoot")["value"] = json!("BrowserContract.Probe.missing")
        }),
        mutate(&source, |m| {
            field(m, "requestMaximum")["value"] = json!("0")
        }),
        mutate(&source, |m| {
            let d = m["declarations"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|v| v["name"] == "present")
                .unwrap();
            d["result"] = json!({"kind":"bool"});
            d["body"] = json!({"kind":"bool","value":true});
        }),
        mutate(&source, |m| {
            field(m, "requestedEffects")["head"]["fields"][1]["value"]["arguments"][0]["value"] =
                json!("1048577")
        }),
    ] {
        let fixture = fixture(root, &changed, &model);
        assert_eq!(project(fixture.path()).unwrap_err().code, "PP2010");
    }
    // Identically shaped, identically named foreign types are not this profile.
    let foreign = fixture(
        root,
        &source.replace("Foundation.Browser.Application.V1.Model", "Foreign.Model"),
        &model.replace("Foundation.Browser.Application.V1.Model", "Foreign.Model"),
    );
    std::fs::create_dir_all(foreign.path().join("src/Foreign")).unwrap();
    std::fs::rename(
        foreign
            .path()
            .join("src/Foundation/Browser/Application/V1/Model.lex.tex"),
        foreign.path().join("src/Foreign/Model.lex.tex"),
    )
    .unwrap();
    assert_eq!(project(foreign.path()).unwrap_err().code, "PP2010");
    assert!(matches!(
        document.application,
        Some(Application::Browser(_))
    ));
    let diagnostics = prismpm::diagnostics::exercise_all().unwrap();
    for code in ["PP2010", "PP2011"] {
        assert_eq!(diagnostics.iter().filter(|p| p.code == code).count(), 1);
    }
}
