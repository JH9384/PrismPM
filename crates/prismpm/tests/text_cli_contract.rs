//! Closed text/3 command-line contract: schema, validation, source projection
//! and the registered diagnostic vocabulary shared by Lean, the registry and
//! the generated program.

use lexlean::{CheckRequest, Engine, LockRequest, Selection};
use prismpm::holo::canonical::{decode_canonical, encode_canonical};
use prismpm::holo::model_document::{Application, ModelDocument};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

const V3: &str = "Foundation.View.Text.V3.Model";

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

fn cli() -> Value {
    json!({
        "command": "check",
        "description": "Checks one text request.\n",
        "usage_code": 64,
        "io_code": 74,
        "outcomes": [
            {"name": "accepted", "prefix": "Accepted: ", "exit_code": 0},
            {"name": "rejected", "prefix": "invalid", "exit_code": 1},
            {"name": "error", "prefix": "Failure:", "exit_code": 2}
        ],
        "sections": [{"title": "REFERENCE", "body": "See the specification.\n"}],
        "examples": [{"name": "good", "text": "hello\n"}]
    })
}

fn fixture() -> Value {
    let mut value: Value = serde_json::from_slice(
        &std::fs::read(root().join("tests/data/text-model-document.json")).unwrap(),
    )
    .unwrap();
    value["schema"] = json!("prismpm/model-document/6");
    value["application"]["profile"] = json!("prismpm/text-application/3");
    value["application"]["core_memory_pages"] = json!(64);
    value["application"]["core_stack_bytes"] = json!(131072);
    value["application"]["cli"] = cli();
    value
}

fn typed(value: Value) -> ModelDocument {
    serde_json::from_value(value).unwrap()
}

fn schema() -> jsonschema::Validator {
    let schema: Value =
        serde_json::from_slice(include_bytes!("../schemas/model-document-v6.schema.json")).unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

#[test]
fn text_cli_contract_roundtrips_and_requires_the_closed_surface() {
    let value = fixture();
    assert!(schema().is_valid(&value));
    let doc = typed(value.clone());
    prismpm::holo::validate::validate(&doc).unwrap();
    let bytes = encode_canonical(&doc).unwrap();
    assert_eq!(decode_canonical(&bytes).unwrap(), doc);
    assert_eq!(serde_json::to_value(&doc).unwrap(), value);
    let Some(Application::Text(text)) = &doc.application else {
        panic!("text/3 projects a text application");
    };
    let surface = text.cli.as_ref().unwrap();
    assert_eq!(surface.fault_code(), 2);
    assert_eq!(
        surface
            .classify(b"Accepted: x")
            .map(|outcome| outcome.exit_code),
        Some(0)
    );
    assert!(surface.classify(b"other").is_none());
    let mut missing = value.clone();
    missing["application"]
        .as_object_mut()
        .unwrap()
        .remove("cli");
    assert!(!schema().is_valid(&missing));
    assert!(
        prismpm::contracts::CanonicalDocument::from_value("prismpm/model-document/6", missing)
            .is_err()
    );
    let mut unknown = value;
    unknown["application"]["cli"]["extra"] = json!(1);
    assert!(!schema().is_valid(&unknown));
    assert!(
        prismpm::contracts::CanonicalDocument::from_value("prismpm/model-document/6", unknown)
            .is_err()
    );
}

#[test]
fn text_cli_contract_rejects_every_invalid_surface() {
    let mutations: Vec<(&str, Value)> = vec![
        ("/application/cli/command", json!("examples")),
        ("/application/cli/command", json!("Check")),
        ("/application/cli/command", json!("")),
        ("/application/cli/description", json!("  \n")),
        ("/application/cli/usage_code", json!(74)),
        ("/application/cli/usage_code", json!(0)),
        ("/application/cli/usage_code", json!(126)),
        ("/application/cli/io_code", json!(64)),
        ("/application/cli/outcomes", json!([])),
        (
            "/application/cli/outcomes",
            json!([{"name": "accepted", "prefix": "Accepted: ", "exit_code": 0}]),
        ),
        ("/application/cli/outcomes/1/exit_code", json!(0)),
        ("/application/cli/outcomes/1/exit_code", json!(64)),
        ("/application/cli/outcomes/1/name", json!("accepted")),
        ("/application/cli/outcomes/1/name", json!("Bad Name")),
        ("/application/cli/outcomes/1/prefix", json!("")),
        ("/application/cli/outcomes/1/prefix", json!("Accepted")),
        ("/application/cli/outcomes/2/prefix", json!("Failure:\u{0}")),
        ("/application/cli/outcomes/0/prefix", json!("Nothing: ")),
        ("/application/cli/sections/0/title", json!("two\nlines")),
        ("/application/cli/sections/0/body", json!("")),
        ("/application/cli/examples/0/name", json!("Bad")),
        ("/application/cli/examples/0/text", json!("")),
    ];
    for (pointer, replacement) in mutations {
        let mut value = fixture();
        *value.pointer_mut(pointer).unwrap() = replacement.clone();
        let doc: Result<ModelDocument, _> = serde_json::from_value(value);
        let rejected = match doc {
            Ok(doc) => prismpm::holo::validate::validate(&doc).is_err(),
            Err(_) => true,
        };
        assert!(rejected, "{pointer} = {replacement}");
    }
    let mut duplicate_section = fixture();
    let section = duplicate_section["application"]["cli"]["sections"][0].clone();
    duplicate_section["application"]["cli"]["sections"]
        .as_array_mut()
        .unwrap()
        .push(section);
    assert!(prismpm::holo::validate::validate(&typed(duplicate_section)).is_err());
}

#[test]
fn text_cli_contract_binds_the_profile_schema_and_surface_together() {
    let mut v2 = fixture();
    v2["schema"] = json!("prismpm/model-document/5");
    v2["application"]["profile"] = json!("prismpm/text-application/2");
    assert!(prismpm::holo::validate::validate(&typed(v2.clone())).is_err());
    v2["application"].as_object_mut().unwrap().remove("cli");
    prismpm::holo::validate::validate(&typed(v2)).unwrap();
    let mut wrong_schema = fixture();
    wrong_schema["schema"] = json!("prismpm/model-document/5");
    assert!(prismpm::holo::validate::validate(&typed(wrong_schema)).is_err());
    let mut v1 = fixture();
    v1["schema"] = json!("prismpm/model-document/2");
    v1["application"]["profile"] = json!("prismpm/text-application/1");
    assert!(prismpm::holo::validate::validate(&typed(v1)).is_err());
    let mut unclassified = fixture();
    unclassified["application"]["acceptance_vectors"][1]["response"] = json!(b"mystery".to_vec());
    assert!(prismpm::holo::validate::validate(&typed(unclassified)).is_err());
}

fn lean_failures() -> Vec<String> {
    let source =
        std::fs::read_to_string(root().join("stdlib/src/Foundation/View/Text/V3/Model.lex.tex"))
            .unwrap();
    let (_, after) = source.split_once("name: TextCliFailure,").unwrap();
    let (block, _) = after.split_once("]\n}").unwrap();
    block
        .split("{name: ")
        .skip(1)
        .map(|row| row.split_once(',').unwrap().0.to_owned())
        .collect()
}

fn lean_classes() -> Vec<(String, String)> {
    let source =
        std::fs::read_to_string(root().join("stdlib/src/Foundation/View/Text/V3/Model.lex.tex"))
            .unwrap();
    source
        .lines()
        .filter_map(|line| {
            let row = line.trim().strip_prefix("| TextCliFailure.")?;
            let (name, class) = row.split_once(" => (ctor TextCliFailureClass.")?;
            Some((
                name.to_owned(),
                class.trim_end_matches([')', ',']).to_owned(),
            ))
        })
        .collect()
}

#[test]
fn text_cli_failures_agree_across_lean_registry_and_generated_program() {
    let registry: toml::Value = toml::from_str(
        &std::fs::read_to_string(root().join("model/text-cli-diagnostics.toml")).unwrap(),
    )
    .unwrap();
    assert_eq!(
        registry["spec"].as_str(),
        Some("prismpm/text-cli-diagnostics/1")
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
    let template = include_str!("../src/text_cli/main.rs.in");
    let (_, enumeration) = template.split_once("enum AdapterFailure {").unwrap();
    let (enumeration, _) = enumeration.split_once('}').unwrap();
    let program = enumeration
        .split(',')
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(program, lean);
    let (_, arms) = template.split_once("fn class(self)").unwrap();
    let (arms, _) = arms.split_once("fn exit_code").unwrap();
    let segments = arms.split("=> FailureClass::").collect::<Vec<_>>();
    let mut program_classes = Vec::new();
    for (index, segment) in segments[..segments.len() - 1].iter().enumerate() {
        let names = if index == 0 {
            segment
        } else {
            segment.split_once(',').unwrap().1
        };
        let class = segments[index + 1]
            .chars()
            .take_while(char::is_ascii_alphanumeric)
            .collect::<String>();
        for name in names.split("AdapterFailure::").skip(1) {
            let name = name
                .chars()
                .take_while(char::is_ascii_alphanumeric)
                .collect::<String>();
            program_classes.push((name, class.clone()));
        }
    }
    program_classes.sort();
    let mut modeled = classes.clone();
    modeled.sort();
    assert_eq!(program_classes, modeled);
}

fn string(value: &str) -> Value {
    json!({"kind": "string", "value": value})
}

fn uint(representation: &str, value: u64) -> Value {
    json!({"kind": "integer", "representation": representation, "value": value.to_string()})
}

fn record(name: &str, fields: Vec<(&str, Value)>) -> Value {
    json!({
        "kind": "record",
        "type": {"module": V3, "name": name},
        "fields": fields
            .into_iter()
            .map(|(field, value)| json!({"field": field, "value": value}))
            .collect::<Vec<_>>()
    })
}

fn list(name: &str, items: Vec<Value>) -> Value {
    items.into_iter().rev().fold(
        json!({"kind": "nil", "element": {
            "kind": "named", "arguments": [], "member": {"module": V3, "name": name}
        }}),
        |tail, head| json!({"kind": "cons", "head": head, "tail": tail}),
    )
}

fn surface_value() -> Value {
    record(
        "TextCli",
        vec![
            ("command", string("check")),
            ("description", string("Checks one text request.\n")),
            ("usageCode", uint("uint8", 64)),
            ("ioCode", uint("uint8", 74)),
            (
                "outcomes",
                list(
                    "TextCliOutcome",
                    [
                        ("accepted", "Accepted: ", 0),
                        ("rejected", "invalid", 1),
                        ("error", "Failure:", 2),
                    ]
                    .into_iter()
                    .map(|(name, prefix, code)| {
                        record(
                            "TextCliOutcome",
                            vec![
                                ("name", string(name)),
                                ("prefix", string(prefix)),
                                ("exitCode", uint("uint8", code)),
                            ],
                        )
                    })
                    .collect(),
                ),
            ),
            (
                "sections",
                list(
                    "TextCliSection",
                    vec![record(
                        "TextCliSection",
                        vec![
                            ("title", string("REFERENCE")),
                            ("body", string("See the specification.\n")),
                        ],
                    )],
                ),
            ),
            (
                "examples",
                list(
                    "TextCliExample",
                    vec![record(
                        "TextCliExample",
                        vec![("name", string("good")), ("text", string("hello\n"))],
                    )],
                ),
            ),
        ],
    )
}

fn source() -> String {
    let original = std::fs::read_to_string(
        root().join("tests/fixtures/holo/ho-11-text-application/project/src/TextRequest.lex.tex"),
    )
    .unwrap();
    let semantic = original
        .lines()
        .find(|line| line.starts_with("\\semanticdata{"))
        .unwrap();
    let mut value: Value = serde_json::from_str(
        semantic
            .strip_prefix("\\semanticdata{")
            .unwrap()
            .strip_suffix('}')
            .unwrap(),
    )
    .unwrap();
    value["spec"] = json!("lexlean/semantic-module/2");
    let application = value["declarations"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|d| d["name"] == "application")
        .unwrap();
    application["result"]["member"]["module"] = json!(V3);
    application["body"]["type"]["module"] = json!(V3);
    let fields = application["body"]["fields"].as_array_mut().unwrap();
    fields.iter_mut().find(|f| f["field"] == "profile").unwrap()["value"]["value"] =
        json!("prismpm/text-application/3");
    let index = fields
        .iter()
        .position(|f| f["field"] == "guestAllocationMaximum")
        .unwrap()
        + 1;
    fields.insert(
        index,
        json!({"field": "coreMemoryPages", "value": uint("uint32", 64)}),
    );
    fields.insert(
        index + 1,
        json!({"field": "coreStackBytes", "value": uint("uint32", 131072)}),
    );
    fields.push(json!({"field": "cli", "value": surface_value()}));
    original
        .replace(
            semantic,
            &format!("\\semanticdata{{{}}}", serde_json::to_string(&value).unwrap()),
        )
        .replace(
            "\\importmodule{Foundation.View.Text.V1.Model}",
            "\\importmodule{Foundation.View.Text.V1.Model}\n\\importmodule{Foundation.View.Text.V3.Model}",
        )
}

#[allow(clippy::result_large_err)]
fn project(source: &str, owner: &str) -> Result<ModelDocument, prismpm::PrismError> {
    let temp = tempfile::tempdir().unwrap();
    let repo = root();
    let project = repo.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
    ] {
        std::fs::copy(project.join(name), temp.path().join(name)).unwrap();
    }
    // The checked-in fixture project predates the language 1.2 lexicon that the
    // standard library and `language/prism.arch` now use.
    let configuration = temp.path().join("lexlean.toml");
    std::fs::write(
        &configuration,
        std::fs::read_to_string(&configuration)
            .unwrap()
            .replace("language = \"1.1\"", "language = \"1.2\""),
    )
    .unwrap();
    for module in [
        "Foundation/Bytes.lex.tex",
        "Foundation/Utf8.lex.tex",
        "Foundation/View/Text/V1/Model.lex.tex",
    ] {
        let destination = temp.path().join("src").join(module);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::copy(repo.join("stdlib/src").join(module), destination).unwrap();
    }
    let model =
        std::fs::read_to_string(repo.join("stdlib/src/Foundation/View/Text/V3/Model.lex.tex"))
            .unwrap()
            .replace(V3, owner);
    let path = temp
        .path()
        .join("src")
        .join(owner.replace('.', "/") + ".lex.tex");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, model).unwrap();
    std::fs::write(
        temp.path().join("src/TextRequest.lex.tex"),
        lexlean::sdk::to_notation(&source.replace("@1.1.0}", "@1.2.0}")).unwrap(),
    )
    .unwrap();
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
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let manifest = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&manifest)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    let snapshot = Engine::load(&manifest)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    prismpm::holo::application::project_application(&snapshot).map(Option::unwrap)
}

#[test]
fn text_cli_projects_only_from_the_exact_source_owned_type() {
    let source = source();
    let doc = project(&source, V3).unwrap();
    assert_eq!(doc.schema, "prismpm/model-document/6");
    let Some(Application::Text(text)) = &doc.application else {
        panic!("text/3 projects a text application");
    };
    assert_eq!(
        serde_json::to_value(text.cli.as_ref().unwrap()).unwrap(),
        cli()
    );
    assert!(schema().is_valid(&serde_json::to_value(&doc).unwrap()));
    assert_eq!(project(&source, V3).unwrap(), doc);
    let wrong_profile = source.replace("prismpm/text-application/3", "prismpm/text-application/2");
    assert_eq!(project(&wrong_profile, V3).unwrap_err().code, "PP2009");
    let foreign = source.replace(V3, "Foreign.Cli.Model");
    assert_eq!(
        project(&foreign, "Foreign.Cli.Model").unwrap_err().code,
        "PP2009"
    );
    let no_error = source.replace("\"error\"", "\"fault\"");
    assert_eq!(project(&no_error, V3).unwrap_err().code, "PP2009");
}
