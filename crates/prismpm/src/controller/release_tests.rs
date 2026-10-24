//! OC-02: genuine named-release verification, not synthetic verification receipts.

use super::*;
use serde_json::Value;
use std::collections::BTreeMap;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_owned()
}

fn copy_fixture_file(source: impl AsRef<Path>, destination: impl AsRef<Path>) {
    // The installed/captured SDK source is read-only. A fresh modeled fixture
    // owns mutable input bytes, not the source file's permissions or inode.
    std::fs::write(destination, std::fs::read(source).unwrap()).unwrap();
}

#[cfg(unix)]
#[test]
fn readonly_source_copy_is_mutable_only_in_the_private_fixture() {
    use std::os::unix::fs::{MetadataExt, PermissionsExt};

    let temporary = tempfile::tempdir().unwrap();
    let source = temporary.path().join("captured-source");
    let destination = temporary.path().join("private-fixture");
    std::fs::write(&source, b"exact captured source").unwrap();
    std::fs::set_permissions(&source, std::fs::Permissions::from_mode(0o400)).unwrap();
    let original = std::fs::metadata(&source).unwrap();
    copy_fixture_file(&source, &destination);
    assert_eq!(
        std::fs::read(&destination).unwrap(),
        b"exact captured source"
    );
    assert_ne!(
        std::fs::metadata(&destination).unwrap().ino(),
        original.ino()
    );
    std::fs::write(&destination, b"modeled fixture changes").unwrap();
    assert_eq!(std::fs::read(&source).unwrap(), b"exact captured source");
    let after = std::fs::metadata(&source).unwrap();
    assert_eq!(after.ino(), original.ino());
    assert_eq!(after.permissions().mode(), original.permissions().mode());
}

fn copy_tree(source: &Path, destination: &Path) {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.unwrap();
        let path = destination.join(entry.path().strip_prefix(source).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(path).unwrap();
        } else {
            assert!(entry.file_type().is_file());
            copy_fixture_file(entry.path(), path);
        }
    }
}

pub(super) fn calculator_project() -> tempfile::TempDir {
    let temporary = tempfile::tempdir().unwrap();
    let example = repository().join("examples/Calculator");
    copy_tree(&example.join("src"), &temporary.path().join("src"));
    for path in [
        "lexlean.toml",
        "prismpm.toml",
        "lakefile.toml",
        "lake-manifest.json",
        "lean-toolchain",
    ] {
        copy_fixture_file(example.join(path), temporary.path().join(path));
    }
    relock(temporary.path());
    temporary
}

#[test]
fn browser_system_contract_is_registered_and_closed() {
    let schema = "prismpm/system-model/2";
    let error = crate::contracts::CanonicalDocument::from_value(schema, json!({"schema":schema}))
        .unwrap_err();
    assert!(
        !error.message.contains("unsupported contract"),
        "browser-system contract must be registered: {error:?}"
    );
    assert_eq!(error.code, "PP1101");
}

/// Bind the release at `src/Release.lex.tex` to the application model its
/// Calculator source projects, and lock the result.
fn bind_application_digest(root: &Path) {
    bind_application_digest_of(root, "src/Calculator.lex.tex", 4);
}

/// Bind every `applicationModelDigest` of `src/Release.lex.tex` to the model
/// that `application` projects, expecting exactly `bindings` occurrences.
fn bind_application_digest_of(root: &Path, application: &str, bindings: usize) {
    let snapshot = Engine::load(&utf8(root.join("lexlean.toml")).unwrap())
        .unwrap()
        .snapshot(LexCheckRequest {
            selection: Selection::Files([Utf8PathBuf::from(application)].into()),
        })
        .unwrap();
    let application = crate::holo::application::project_application(&snapshot)
        .unwrap()
        .unwrap();
    let digest = format!(
        "sha256:{}",
        content_id(&encode_canonical(&application).unwrap())
    );
    let path = root.join("src/Release.lex.tex");
    let source = std::fs::read_to_string(&path).unwrap();
    let mut semantic = semantic_data(&source);
    fn bind(value: &mut Value, digest: &str) -> usize {
        if value["field"] == "applicationModelDigest" {
            assert_eq!(value["value"]["kind"], "string");
            value["value"]["value"] = json!(digest);
            return 1;
        }
        match value {
            Value::Object(fields) => fields.values_mut().map(|value| bind(value, digest)).sum(),
            Value::Array(values) => values.iter_mut().map(|value| bind(value, digest)).sum(),
            _ => 0,
        }
    }
    assert_eq!(
        bind(&mut semantic, &digest),
        bindings,
        "every source model and manifest binds the final application"
    );
    std::fs::write(
        &path,
        lexlean::sdk::write_module(&source, &semantic).unwrap(),
    )
    .unwrap();
    relock(root);
}

fn browser_system_project() -> tempfile::TempDir {
    let temporary = calculator_project();
    let root = temporary.path();
    let fixture = repository().join("tests/browser-system");
    std::fs::create_dir(root.join("src/Production")).unwrap();
    for name in ["Core", "BrowserSystem"] {
        copy_fixture_file(
            repository().join(format!("stdlib/src/Production/{name}.lex.tex")),
            root.join(format!("src/Production/{name}.lex.tex")),
        );
    }
    // The SDK stdlib is language 1.2, so the Calculator model and the release
    // that imports it are the fixture's language-1.2 notation, not the 1.1
    // example source.
    copy_fixture_file(
        fixture.join("Calculator.lex.tex"),
        root.join("src/Calculator.lex.tex"),
    );
    copy_fixture_file(
        fixture.join("Release.lex.tex"),
        root.join("src/Release.lex.tex"),
    );
    copy_fixture_file(fixture.join("lexlean.toml"), root.join("lexlean.toml"));
    copy_stdlib_lexicon(root);
    relock(root);
    bind_application_digest(root);
    temporary
}

/// The stdlib modules title themselves from `prism.arch`, so a project that
/// vendors them carries that lexicon beside its sources, as the SDK ships it.
fn copy_stdlib_lexicon(root: &Path) {
    copy_tree(
        &repository().join("language/prism.arch"),
        &root.join("language/prism.arch"),
    );
}

impl Controller {
    /// Fresh modeled publication fixture; caller must build and verify it.
    pub(crate) fn publication_linkage_project() -> tempfile::TempDir {
        let temporary = browser_system_project();
        let root = temporary.path();
        for namespace in ["Foundation", "Production"] {
            copy_tree(
                &repository().join("stdlib/src").join(namespace),
                &root.join("src").join(namespace),
            );
        }
        copy_fixture_file(
            repository().join("tests/publication-context-linkage/src/Publication.lex.tex"),
            root.join("src/Publication.lex.tex"),
        );
        let config = std::fs::read_to_string(root.join("lexlean.toml")).unwrap();
        assert!(config.contains("entrypoints = [\"src/Release.lex.tex\"]"));
        std::fs::write(
            root.join("lexlean.toml"),
            config.replace(
                "entrypoints = [\"src/Release.lex.tex\"]",
                "entrypoints = [\"src/Publication.lex.tex\"]",
            ),
        )
        .unwrap();
        relock(root);
        bind_application_digest(root);
        relock(root);
        temporary
    }
}

#[test]
fn browser_system_source_selection_and_requirements_fail_closed() {
    let temporary = browser_system_project();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let a = controller.prepare_release(None, Some("A")).unwrap();
    let b = controller.prepare_release(None, Some("B")).unwrap();
    assert_eq!(a.model_bytes, b.model_bytes);
    assert_eq!(
        a.system.as_ref().unwrap().schema(),
        "prismpm/system-model/2"
    );
    assert_ne!(
        a.system.as_ref().unwrap().bytes(),
        b.system.as_ref().unwrap().bytes()
    );
    // Empty Holo-native capabilities do not mean an effectful browser model
    // satisfies this deliberately static core-Wasm/DOM containing system.
    let mut effectful: crate::holo::model_document::ModelDocument =
        serde_json::from_slice(&a.model_bytes).unwrap();
    let browser: crate::holo::browser_application::BrowserApplication = serde_json::from_slice(
        &std::fs::read(repository().join("tests/data/browser-application-declaration.json"))
            .unwrap(),
    )
    .unwrap();
    crate::holo::browser_application::validate(&browser).unwrap();
    effectful.schema = "prismpm/model-document/4".into();
    effectful.application = Some(crate::holo::model_document::Application::Browser(Box::new(
        browser,
    )));
    let mut selected = a.system.as_ref().unwrap().value().clone();
    selected["components"][0]["version"] =
        json!(effectful.application.as_ref().unwrap().cargo_version());
    selected["application_profile"]["application_model_digest"] = json!(format!(
        "sha256:{}",
        crate::holo::canonical::content_id(
            &crate::holo::canonical::encode_value(&serde_json::to_value(&effectful).unwrap())
                .unwrap()
        )
    ));
    assert_eq!(
        crate::system::browser::validate_application(&selected, &effectful)
            .unwrap_err()
            .code,
        "PP2101"
    );
    assert_eq!(
        controller.prepare(None).unwrap().system.unwrap().bytes(),
        b.system.unwrap().bytes()
    );
    for selector in ["Missing", "../A", ""] {
        assert!(controller.prepare_release(None, Some(selector)).is_err());
    }
    drop(controller);
    let path = root.join("src/Release.lex.tex");
    let original = std::fs::read_to_string(&path).unwrap();
    for changed in [
        original.replace("\"none\"", "\"indexeddb\""),
        original.replace("\"artifact-closure\"", "\"omitted-control\""),
        original.replace("\"webassembly\"", "\"unmodeled-resource\""),
        original.replace("\"github-pages-browser\"", "\"compose\""),
        original.replace("\"selected-application\"", "\"caller-bundle\""),
        original.replace("name: systemModelB,", "name: systemModelA,"),
        original.replace(
            "result: Production.BrowserSystem::SystemModel,",
            "result: Production.Core::Product,",
        ),
        original.replace(
            a.system.as_ref().unwrap().value()["application_profile"]["application_model_digest"]
                .as_str()
                .unwrap(),
            &format!("sha256:{}", "f".repeat(64)),
        ),
    ] {
        assert_ne!(
            changed, original,
            "mutation must change its intended source"
        );
        let stale_application = changed.contains(&format!("sha256:{}", "f".repeat(64)));
        std::fs::write(&path, changed).unwrap();
        relock(root);
        let error = Controller::load(root)
            .unwrap()
            .prepare(None)
            .err()
            .expect("changed browser-system source was accepted");
        if stale_application {
            assert!(error
                .message
                .contains("but the imported application model is"));
            assert!(error.message.contains(
                a.system.as_ref().unwrap().value()["application_profile"]
                    ["application_model_digest"]
                    .as_str()
                    .unwrap()
            ));
        }
        assert!(!root.join(".prism/build").exists());
    }
    let declarations = semantic_data(&original);
    let duplicate = declarations["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "systemModelA")
        .unwrap()
        .clone();
    let other_release = format!(
        "\\begin{{lexlean}}{{OtherRelease}}\n\\useglossary{{lexlean.std.bool@1.2.0}}\n\\importmodule{{Production.Core}}\n\\importmodule{{Production.BrowserSystem}}\n\\title{{Boolean}}\n\\begin{{semanticmodule}}\n\\semanticdata{{{}}}\n\\end{{semanticmodule}}\n\\end{{lexlean}}\n",
        serde_json::to_string(&json!({"spec":"lexlean/semantic-module/2","declarations":[duplicate]})).unwrap()
    );
    std::fs::write(
        root.join("src/OtherRelease.lex.tex"),
        lexlean::sdk::to_notation(&other_release).unwrap(),
    )
    .unwrap();
    std::fs::write(
        &path,
        original.replace(
            "\\title{Boolean}",
            "\\importmodule{OtherRelease}\n\\title{Boolean}",
        ),
    )
    .unwrap();
    relock(root);
    let error = Controller::load(root)
        .unwrap()
        .prepare(None)
        .err()
        .expect("ambiguous source must fail");
    assert_eq!(error.code, "PP2101");
    assert!(error
        .message
        .contains("duplicates a named system model root"));
    std::fs::write(&path, original).unwrap();
    relock(root);
}

/// The mcp-loopback host-effect service of `tests/host-effect-system`, bound to
/// the Calculator application model as the stand-in for the server application
/// that issue 216 will supply.
fn host_effect_system_project() -> tempfile::TempDir {
    let temporary = calculator_project();
    let root = temporary.path();
    std::fs::create_dir(root.join("src/Production")).unwrap();
    for name in ["Core", "HostEffectSystem"] {
        copy_fixture_file(
            repository().join(format!("stdlib/src/Production/{name}.lex.tex")),
            root.join(format!("src/Production/{name}.lex.tex")),
        );
    }
    copy_fixture_file(
        repository().join("tests/browser-system/Calculator.lex.tex"),
        root.join("src/Calculator.lex.tex"),
    );
    let fixture = repository().join("tests/host-effect-system");
    copy_fixture_file(
        fixture.join("Release.lex.tex"),
        root.join("src/Release.lex.tex"),
    );
    copy_fixture_file(fixture.join("lexlean.toml"), root.join("lexlean.toml"));
    copy_stdlib_lexicon(root);
    relock(root);
    bind_application_digest_of(root, "src/Calculator.lex.tex", 2);
    temporary
}

#[test]
fn host_effect_system_named_release_selects_and_binds_its_source() {
    let temporary = host_effect_system_project();
    let root = temporary.path();
    let prepared = Controller::load(root).unwrap().prepare(None).unwrap();
    let system = prepared.system.as_ref().unwrap();
    assert_eq!(system.schema(), "prismpm/system-model/3");
    // The proved Lean value is the registered example, up to the digest of
    // the application model the fixture binds.
    let (example, _) = crate::system::host_effect::example();
    let mut projected = system.value().clone();
    assert_eq!(
        projected["application_profile"]["application_model_digest"],
        format!("sha256:{}", content_id(&prepared.model_bytes))
    );
    projected["application_profile"]["application_model_digest"] =
        example.value()["application_profile"]["application_model_digest"].clone();
    assert_eq!(&projected, example.value());
    let projections = crate::system::projections(system, &[]).unwrap();
    let compose: Value = serde_json::from_slice(&projections[0].bytes).unwrap();
    assert_eq!(projections[0].path, "projections/compose.json");
    assert_eq!(
        compose["services"]["gateway"]["ports"][0]["host_ip"],
        "127.0.0.1"
    );
    drop(prepared);

    let path = root.join("src/Release.lex.tex");
    let original = std::fs::read_to_string(&path).unwrap();
    let adapter = crate::deployment::digest("compose").unwrap();
    for (changed, code) in [
        (original.replace("\"127.0.0.1\"", "\"0.0.0.0\""), "PP1101"),
        (original.replace("\"api\"", "\"worker\""), "PP2101"),
        (
            original.replace(&adapter, &format!("sha256:{}", "0".repeat(64))),
            "PP7101",
        ),
        (
            original.replacen("\"engine.check\"", "\"engine.other\"", 1),
            "PP2101",
        ),
        (
            original.replace(
                "name: mcpLoopbackSystemReleaseReady,",
                "name: mcpLoopbackReady,",
            ),
            "PP2101",
        ),
    ] {
        assert_ne!(
            changed, original,
            "mutation must change its intended source"
        );
        std::fs::write(&path, changed).unwrap();
        relock(root);
        let error = Controller::load(root)
            .unwrap()
            .prepare(None)
            .err()
            .expect("changed host-effect source was accepted");
        assert_eq!(error.code, code, "{}", error.message);
        assert!(!root.join(".prism/build").exists());
    }
    std::fs::write(&path, original).unwrap();
    relock(root);
}

/// The text/3 command-line system fixture: the ho-11 text application raised
/// to text/3 with a modeled command line, contained by a browser system that
/// declares the browser component and, second, the command-line component.
fn text_command_line_system_project() -> tempfile::TempDir {
    const V3: &str = "Foundation.View.Text.V3.Model";
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    let fixture = repository().join("tests/fixtures/holo/ho-11-text-application/project");
    copy_tree(&fixture.join("src"), &root.join("src"));
    copy_tree(&fixture.join("language"), &root.join("language"));
    for name in [
        "lexlean.toml",
        "prismpm.toml",
        "lakefile.toml",
        "lake-manifest.json",
        "lean-toolchain",
    ] {
        copy_fixture_file(fixture.join(name), root.join(name));
    }
    for module in [
        "Foundation/View/Text/V3/Model",
        "Production/Core",
        "Production/BrowserSystem",
    ] {
        let destination = root.join(format!("src/{module}.lex.tex"));
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        copy_fixture_file(
            repository().join(format!("stdlib/src/{module}.lex.tex")),
            destination,
        );
    }
    let record = |name: &str, fields: &str| format!("(record {V3}::{name} {{{fields}}})");
    let list = |name: &str, rows: Vec<String>| {
        rows.into_iter()
            .rev()
            .fold(format!("(nil {V3}::{name})"), |tail, head| {
                format!("(cons {head} {tail})")
            })
    };
    let outcomes = list(
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
                &format!(
                    "name := \"{name}\", prefix := \"{prefix}\", exitCode := ({code} : UInt8)"
                ),
            )
        })
        .collect(),
    );
    let cli = record(
        "TextCli",
        &format!(
            "command := \"check\", description := \"Checks one text request.\", usageCode := (64 : UInt8), ioCode := (74 : UInt8), outcomes := {outcomes}, sections := {}, examples := {}",
            list("TextCliSection", Vec::new()),
            list("TextCliExample", Vec::new())
        ),
    );
    let application_path = root.join("src/TextRequest.lex.tex");
    let mut application = std::fs::read_to_string(&application_path).unwrap();
    for (from, to) in [
        (
            "result: Foundation.View.Text.V1.Model::TextApplication,".to_owned(),
            format!("result: {V3}::TextApplication,"),
        ),
        (
            "(record Foundation.View.Text.V1.Model::TextApplication {".to_owned(),
            format!("(record {V3}::TextApplication {{"),
        ),
        (
            "{profile := \"prismpm/text-application/1\",".to_owned(),
            "{profile := \"prismpm/text-application/3\",".to_owned(),
        ),
        (
            "guestAllocationMaximum := (128 : UInt32),".to_owned(),
            "guestAllocationMaximum := (128 : UInt32), coreMemoryPages := (ctor Option.none [UInt32]), coreStackBytes := (ctor Option.none [UInt32]),".to_owned(),
        ),
        (
            "responseError := \"Invalid response\"})})".to_owned(),
            format!("responseError := \"Invalid response\"}}), cli := {cli}}})"),
        ),
        (
            "\\importmodule{Foundation.View.Text.V1.Model}".to_owned(),
            format!("\\importmodule{{Foundation.View.Text.V1.Model}}\n\\importmodule{{{V3}}}"),
        ),
    ] {
        assert_eq!(application.matches(&from).count(), 1, "edit anchor {from}");
        application = application.replace(&from, &to);
    }
    std::fs::write(&application_path, application).unwrap();
    let adapter = crate::deployment::digest("github-pages-browser").unwrap();
    let digest = "0".repeat(64);
    let controls = "(cons \"application-acceptance\" (cons \"artifact-closure\" (cons \"source-proof\" (cons \"spdx\" (nil String)))))";
    let system_model = format!(
        "(record Production.BrowserSystem::SystemModel {{product := (record Production.Core::Product {{id := \"text-product\", owner := \"UOR Foundation\", version := \"1\", lifecycle := \"development\", sourcePolicy := \"selected LexLean source and kernel proof\", supportedPlatforms := (cons \"browser\" (nil String))}}), applicationProfile := (record Production.BrowserSystem::ApplicationProfile {{contract := \"prismpm/browser-resident-application/1\", applicationModelDigest := \"sha256:{digest}\", execution := \"browser-session\", persistentStorage := \"none\", externalServices := \"none\", resources := (cons \"dom\" (cons \"webassembly\" (nil String))), capabilities := (cons \"portable-static-holo-application\" (nil String))}}), artifacts := (cons (record Production.BrowserSystem::GeneratedArtifact {{id := \"text-application\", role := \"selected-application\", licenseExpression := \"MIT OR Apache-2.0\"}}) (cons {} (nil Production.BrowserSystem::GeneratedArtifact))), components := (cons (record Production.BrowserSystem::Component {{id := \"text-browser\", artifact := \"text-application\", kind := \"browser\", version := \"0.1.0\"}}) (cons {} (nil Production.BrowserSystem::Component))), targets := (cons (record Production.BrowserSystem::Target {{id := \"pages\", kind := \"github-pages-browser\", adapterDigest := \"{adapter}\", apiVersion := \"github-pages-artifact@v4\", minimumReleaseStatus := \"development\"}}) (nil Production.BrowserSystem::Target)), controls := {controls}, standards := (cons \"SPDX-3.0.1\" (nil String))}})",
        CLI_ARTIFACT, CLI_COMPONENT
    );
    let system_manifest = format!(
        "(record Production.BrowserSystem::SystemManifest {{applicationModelDigest := \"sha256:{digest}\", productId := \"text-product\", productVersion := \"1\", componentId := \"text-browser\", artifactId := \"text-application\", targetId := \"pages\", controls := {controls}}})"
    );
    let release = format!(
        "\\begin{{lexlean}}{{Release}}\n\\useglossary{{lexlean.std.bool@1.2.0}}\n\\importmodule{{TextRequest}}\n\\importmodule{{Production.Core}}\n\\importmodule{{Production.BrowserSystem}}\n\\title{{Boolean}}\n\\begin{{semanticmodule}}\ndefinition{{\n  name: systemModel,\n  parameters: [],\n  result: Production.BrowserSystem::SystemModel,\n  body: {system_model}\n}}\n\ndefinition{{\n  name: systemManifest,\n  parameters: [],\n  result: Production.BrowserSystem::SystemManifest,\n  body: {system_manifest}\n}}\n\ntheorem{{\n  name: textSystemReleaseReady,\n  parameters: [],\n  statement: ((Production.BrowserSystem::validateManifest (systemModel) (systemManifest)) = true),\n  proof: decide{{}},\n  axioms: []\n}}\n\\end{{semanticmodule}}\n\\end{{lexlean}}\n"
    );
    std::fs::write(root.join("src/Release.lex.tex"), release).unwrap();
    let config = std::fs::read_to_string(root.join("lexlean.toml")).unwrap();
    assert!(config.contains("entrypoints = [\"src/TextRequest.lex.tex\"]"));
    std::fs::write(
        root.join("lexlean.toml"),
        config.replace(
            "entrypoints = [\"src/TextRequest.lex.tex\"]",
            "entrypoints = [\"src/Release.lex.tex\"]",
        ),
    )
    .unwrap();
    relock(root);
    bind_application_digest_of(root, "src/TextRequest.lex.tex", 2);
    temporary
}

const CLI_ARTIFACT: &str = "(record Production.BrowserSystem::GeneratedArtifact {id := \"text-program\", role := \"command-line-program\", licenseExpression := \"MIT OR Apache-2.0\"})";
const CLI_COMPONENT: &str = "(record Production.BrowserSystem::Component {id := \"text-command-line\", artifact := \"text-program\", kind := \"cli\", version := \"0.1.0\"})";

#[test]
fn browser_system_admits_one_command_line_component_of_a_text_command_line_application() {
    let temporary = text_command_line_system_project();
    let root = temporary.path();
    let prepared = Controller::load(root).unwrap().prepare(None).unwrap();
    let system = prepared
        .system
        .as_ref()
        .expect("two-component browser system");
    assert_eq!(system.schema(), "prismpm/system-model/2");
    let value = system.value();
    assert!(crate::system::browser::declares_command_line(value));
    assert_eq!(value["components"][1]["kind"], "cli");
    assert_eq!(value["artifacts"][1]["role"], "command-line-program");
    // The manifest binds the selected application; the command-line pair is
    // bound by the system digest. The release's SPDX names both packages.
    assert_eq!(
        crate::system::browser::certificate(value)["component_id"],
        "text-browser"
    );
    let spdx = crate::system::spdx(value);
    let packages = spdx["@graph"]
        .as_array()
        .unwrap()
        .iter()
        .filter(|row| row["type"] == "software_Package")
        .map(|row| row["name"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(packages, ["text-browser", "text-command-line"]);
    let model: crate::holo::model_document::ModelDocument =
        serde_json::from_slice(&prepared.model_bytes).unwrap();
    assert_eq!(
        model.application.as_ref().unwrap().core_memory_pages(),
        32,
        "an absent text/3 budget is the text/1 budget"
    );
    drop(prepared);

    // Every other shape is refused by the registered PP2101 before any schema
    // contract violation, naming the closed cardinality it breaks.
    let path = root.join("src/Release.lex.tex");
    let original = std::fs::read_to_string(&path).unwrap();
    let artifact_tail =
        format!("(cons {CLI_ARTIFACT} (nil Production.BrowserSystem::GeneratedArtifact))");
    let component_tail =
        format!("(cons {CLI_COMPONENT} (nil Production.BrowserSystem::Component))");
    for (changed, expected) in [
        (
            original.replace(
                &artifact_tail,
                &format!(
                    "(cons {CLI_ARTIFACT} (cons {} (nil Production.BrowserSystem::GeneratedArtifact)))",
                    CLI_ARTIFACT.replace("text-program", "extra-program")
                ),
            ),
            "exactly one generated artifact per component",
        ),
        (
            original.replace(
                &component_tail,
                &format!(
                    "(cons {CLI_COMPONENT} (cons {} (nil Production.BrowserSystem::Component)))",
                    CLI_COMPONENT.replace("text-command-line", "extra-command-line")
                ),
            ),
            "one browser component and at most one command-line component",
        ),
        (
            original.replace(
                CLI_COMPONENT,
                &CLI_COMPONENT.replace("kind := \"cli\"", "kind := \"browser\""),
            ),
            "second component must be the command-line program",
        ),
        (
            original.replace(
                CLI_COMPONENT,
                &CLI_COMPONENT.replace("version := \"0.1.0\"", "version := \"0.2.0\""),
            ),
            "identity, reference, or manifest binding differs",
        ),
        (
            original.replace(
                CLI_COMPONENT,
                &CLI_COMPONENT.replace(
                    "artifact := \"text-program\"",
                    "artifact := \"text-application\"",
                ),
            ),
            "identity, reference, or manifest binding differs",
        ),
    ] {
        assert_ne!(
            changed, original,
            "mutation must change its intended source"
        );
        std::fs::write(&path, changed).unwrap();
        relock(root);
        let error = Controller::load(root)
            .unwrap()
            .prepare(None)
            .err()
            .expect("changed browser-system source was accepted");
        assert_eq!(error.code, "PP2101", "{expected}: {error:?}");
        assert!(error.message.contains(expected), "{error:?}");
        assert!(!root.join(".prism/build").exists());
    }
    std::fs::write(&path, original).unwrap();
    relock(root);
}

#[test]
fn browser_system_refuses_a_command_line_component_without_a_modeled_command_line() {
    // The Calculator is a legacy application: it models no command line, so a
    // `cli` component has no generated program to bind.
    let temporary = browser_system_project();
    let root = temporary.path();
    let path = root.join("src/Release.lex.tex");
    let original = std::fs::read_to_string(&path).unwrap();
    let artifact = "(record Production.BrowserSystem::GeneratedArtifact {id := \"generated-application\", role := \"selected-application\", licenseExpression := \"MIT OR Apache-2.0\"}) (nil Production.BrowserSystem::GeneratedArtifact)";
    let component = "(record Production.BrowserSystem::Component {id := \"browser-application\", artifact := \"generated-application\", kind := \"browser\", version := \"0.1.0\"}) (nil Production.BrowserSystem::Component)";
    assert_eq!(original.matches(artifact).count(), 2);
    assert_eq!(original.matches(component).count(), 2);
    let changed = original
        .replace(
            artifact,
            &artifact.replace(
                "(nil Production.BrowserSystem::GeneratedArtifact)",
                "(cons (record Production.BrowserSystem::GeneratedArtifact {id := \"command-line-program\", role := \"command-line-program\", licenseExpression := \"MIT OR Apache-2.0\"}) (nil Production.BrowserSystem::GeneratedArtifact))",
            ),
        )
        .replace(
            component,
            &component.replace(
                "(nil Production.BrowserSystem::Component)",
                "(cons (record Production.BrowserSystem::Component {id := \"command-line\", artifact := \"command-line-program\", kind := \"cli\", version := \"0.1.0\"}) (nil Production.BrowserSystem::Component))",
            ),
        );
    std::fs::write(&path, changed).unwrap();
    relock(root);
    let error = Controller::load(root)
        .unwrap()
        .prepare_release(None, Some("A"))
        .err()
        .expect("a legacy application cannot own a command-line component");
    assert_eq!(error.code, "PP2101", "{error:?}");
    assert!(
        error.message.contains("models no command line"),
        "{error:?}"
    );
}

#[test]
fn browser_system_named_release_proves_artifacts_oracles_and_source_free_export() {
    let _compiler = crate::test_compiler::acquire();
    let temporary = browser_system_project();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let a = controller
        .build_release(BuildRequest { config_path: None }, Some("A"))
        .unwrap();
    let verified_a = controller
        .verify_release(VerifyRequest { config_path: None }, Some("A"))
        .unwrap();
    assert_receipt(root, &verified_a, &a);
    let b = controller
        .build_release(BuildRequest { config_path: None }, Some("B"))
        .unwrap();
    let verified_b = controller
        .verify_release(VerifyRequest { config_path: None }, Some("B"))
        .unwrap();
    assert_receipt(root, &verified_b, &b);
    assert_eq!(
        require_verified_build(&verified_a, &b).unwrap_err().code,
        "PP6101"
    );
    assert_eq!(
        require_verified_build(&verified_b, &a).unwrap_err().code,
        "PP6101"
    );
    let mut releases = Vec::new();
    for (build, verified) in [(&a, &verified_a), (&b, &verified_b)] {
        let directory = root.join(&build.manifest_path).parent().unwrap().to_owned();
        let manifest: Value =
            serde_json::from_slice(&std::fs::read(root.join(&build.manifest_path)).unwrap())
                .unwrap();
        let files = manifest["files"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                let path = row["path"].as_str().unwrap();
                (
                    path.to_owned(),
                    std::fs::read(directory.join(path)).unwrap(),
                )
            })
            .collect::<BTreeMap<_, _>>();
        let system = crate::system::parse(&files["system.prism.json"]).unwrap();
        crate::system::browser::replay(&system, &files).unwrap();
        let binding_path = crate::system::browser::BINDING;
        let binding: Value = serde_json::from_slice(&files[binding_path]).unwrap();
        for mode in ["reordered", "duplicate", "parent", "empty-segment"] {
            let mut changed = binding.clone();
            let rows = changed["files"].as_array_mut().unwrap();
            match mode {
                "reordered" => rows.swap(0, 1),
                "duplicate" => rows[1] = rows[0].clone(),
                "parent" => rows[0]["path"] = json!("a/../outside"),
                "empty-segment" => rows[0]["path"] = json!("a//outside"),
                _ => unreachable!(),
            }
            let error = crate::contracts::CanonicalDocument::from_value(
                "prismpm/browser-system-release/1",
                changed,
            )
            .unwrap_err();
            assert_eq!(error.code, "PP1101", "{mode}");
        }
        for mode in ["missing", "extra", "stale", "substitution"] {
            let mut changed = files.clone();
            match mode {
                "missing" => {
                    changed.remove("view/browser/app.js");
                }
                "extra" => {
                    changed.insert(
                        "view/browser/injected.js".to_owned(),
                        b"not generated".to_vec(),
                    );
                }
                "stale" => {
                    changed.insert(binding_path.to_owned(), b"{}".to_vec());
                }
                "substitution" => {
                    changed.insert(
                        "view/browser/app.js".to_owned(),
                        b"not the generated app".to_vec(),
                    );
                }
                _ => unreachable!(),
            }
            assert!(
                crate::system::browser::replay(&system, &changed).is_err(),
                "{mode}"
            );
        }
        let results = crate::oci::projection_oracle_fixture(root, build);
        assert_eq!(
            results
                .iter()
                .map(|r| r["oracle"].as_str().unwrap())
                .collect::<Vec<_>>(),
            ["spdx-3.0.1-model"]
        );
        assert!(results.iter().all(|r| r["valid"] == true));
        releases.push(browser_release(root, build, verified));
    }
    assert_ne!(releases[0].digest, releases[1].digest);
    assert_eq!(
        releases[0].files, releases[1].files,
        "containing-system selection must not rewrite the selected Calculator browser bytes"
    );
    drop(controller);
    let source = root.to_owned();
    temporary.close().unwrap();
    assert!(!source.exists());
    for release in releases {
        assert_source_free_browser_export(&release);
    }
}

#[test]
fn application_build_identity_binds_closed_artifacts_and_rejects_tampering() {
    let _compiler = crate::test_compiler::acquire();
    let temporary = calculator_project();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let first = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    let manifest: Value =
        serde_json::from_slice(&std::fs::read(root.join(&first.manifest_path)).unwrap()).unwrap();
    let closure = content_id(&encode_value(&manifest["files"]).unwrap());
    assert_eq!(manifest["inputs"]["schema"], "prismpm/build-inputs/2");
    assert_eq!(
        manifest["inputs"]["application_artifacts_sha256"], closure,
        "application build identity must bind every actual generated artifact"
    );
    assert_eq!(
        first.build_id,
        content_id(&encode_value(&manifest["inputs"]).unwrap())
    );
    // Exercise the actual publisher twice, not merely a digest helper. Exact
    // bytes remain reusable; a modified published artifact must still fail.
    let second = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    assert_eq!(first.build_id, second.build_id);
    let archive = root
        .join(&first.manifest_path)
        .parent()
        .unwrap()
        .join("Calculator.holo");
    let mut changed = std::fs::read(&archive).unwrap();
    changed[0] ^= 1;
    std::fs::write(&archive, changed).unwrap();
    let error = controller
        .build(BuildRequest { config_path: None })
        .unwrap_err();
    assert_eq!(error.code, "PP4001");
    assert_eq!(
        error.message,
        "published artifact was modified: Calculator.holo"
    );
}

#[test]
fn physical_archive_limit_rejects_before_publishing_any_build() {
    let _compiler = crate::test_compiler::acquire();
    let temporary = calculator_project();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let initial = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    let directory = root.join(".prism/build").join(&initial.build_id);
    let archive = walkdir::WalkDir::new(&directory)
        .into_iter()
        .map(Result::unwrap)
        .find(|entry| {
            entry.file_type().is_file()
                && entry
                    .path()
                    .extension()
                    .is_some_and(|value| value == "holo")
        })
        .unwrap();
    let archive_bytes = std::fs::read(archive.path()).unwrap();
    let model_bytes = std::fs::read(root.join(&initial.model_path)).unwrap();
    assert!(archive_bytes.len() > model_bytes.len());
    let builds = || {
        std::fs::read_dir(root.join(".prism/build"))
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect::<BTreeSet<_>>()
    };
    let initial_builds = builds();
    let config_path = root.join("prismpm.toml");
    let mut config: toml::Value =
        toml::from_str(&std::fs::read_to_string(&config_path).unwrap()).unwrap();
    config["limits"]["max_holo_bytes"] = toml::Value::Integer(archive_bytes.len() as i64 - 1);
    std::fs::write(&config_path, toml::to_string(&config).unwrap()).unwrap();
    // The model fits; it is the physical archive boundary that must reject.
    controller
        .check(CheckRequest { config_path: None })
        .unwrap();
    assert_eq!(
        controller
            .build(BuildRequest { config_path: None })
            .unwrap_err()
            .code,
        "PP1003"
    );
    assert_eq!(builds(), initial_builds);
    assert_eq!(std::fs::read(archive.path()).unwrap(), archive_bytes);
    config["limits"]["max_holo_bytes"] = toml::Value::Integer(archive_bytes.len() as i64);
    std::fs::write(&config_path, toml::to_string(&config).unwrap()).unwrap();
    controller
        .build(BuildRequest { config_path: None })
        .unwrap();
}

fn relock(root: &Path) {
    Engine::load(&utf8(root.join("lexlean.toml")).unwrap())
        .unwrap()
        .lock(lexlean::LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
}

fn semantic_data(source: &str) -> Value {
    lexlean::sdk::read_module(source).unwrap()
}

// Render test data through the actual stdlib structure declarations. The
// fixture contains only field values; LexLean still typechecks the generated
// semantic module and Lean proves both exact SystemReleaseReady statements.
fn term(value: &Value, ty: &Value, module: &str, types: &BTreeMap<String, Value>) -> Value {
    match ty["kind"].as_str().unwrap() {
        "string" | "bool" => json!({"kind":ty["kind"], "value":value}),
        "nat" => json!({"kind":"nat", "value":value.as_str().unwrap().parse::<u64>().unwrap().to_string()}),
        "uint8" | "uint16" | "uint32" | "uint64" => {
            json!({"kind":"integer", "representation":ty["kind"], "value":value.to_string()})
        }
        "list" => value.as_array().unwrap().iter().rev().fold(
            json!({"kind":"nil", "element":qualified_type(&ty["element"], module)}),
            |tail, head| json!({"kind":"cons", "head":term(head, &ty["element"], module, types), "tail":tail}),
        ),
        "option" => json!({
            "kind":"constructor",
            "constructor":{"name":if value.is_null() {"Option.none"} else {"Option.some"}},
            "type_arguments":[qualified_type(&ty["value"], module)],
            "arguments":if value.is_null() {vec![]} else {vec![term(value, &ty["value"], module, types)]}
        }),
        "named" => {
            let name = ty["member"]["name"].as_str().unwrap();
            let module = ty["member"]["module"].as_str().unwrap_or(module);
            let declaration = &types[&format!("{module}.{name}")];
            let fields = declaration["fields"].as_array().unwrap();
            assert_eq!(fields.len(), value.as_object().unwrap().len());
            json!({"kind":"record", "type":{"module":module,"name":name}, "fields":fields.iter().map(|field| {
                let name = field["name"].as_str().unwrap();
                json!({"field":name,"value":term(&value[name], &field["type"], module, types)})
            }).collect::<Vec<_>>()})
        }
        kind => panic!("unhandled fixture type {kind}"),
    }
}

fn qualified_type(ty: &Value, module: &str) -> Value {
    let mut ty = ty.clone();
    match ty["kind"].as_str().unwrap() {
        "named" if ty["member"]["module"].is_null() => ty["member"]["module"] = json!(module),
        "list" => ty["element"] = qualified_type(&ty["element"], module),
        "option" => ty["value"] = qualified_type(&ty["value"], module),
        _ => {}
    }
    ty
}

fn named(name: &str) -> Value {
    json!({"kind":"named", "member":{"module":"Production.System","name":name},"arguments":[]})
}

fn named_releases() -> tempfile::TempDir {
    let temporary = calculator_project();
    let root = temporary.path();
    // The stdlib is language 1.2, so the release builds on the language-1.2
    // notation Calculator and the configuration that declares its glossaries.
    let fixture_root = repository().join("tests/browser-system");
    copy_fixture_file(
        fixture_root.join("Calculator.lex.tex"),
        root.join("src/Calculator.lex.tex"),
    );
    copy_fixture_file(fixture_root.join("lexlean.toml"), root.join("lexlean.toml"));
    copy_stdlib_lexicon(root);
    // Calculator production scenario from calculator-example@5051dc6adb18e9ca2b6ae4ca7090e638329831ef,
    // with its complete certificate regenerated against the current stdlib.
    // B differs only in release identity; no application dependencies are removed.
    let mut fixture: Value =
        serde_json::from_str(include_str!("../system/release-fixture.json")).unwrap();
    copy_tree(
        &repository().join("stdlib/src/Production"),
        &root.join("src/Production"),
    );
    let mut types = BTreeMap::new();
    for module in [
        "Core",
        "Interface",
        "Runtime",
        "Operations",
        "Validation",
        "System",
    ] {
        let source =
            std::fs::read_to_string(root.join(format!("src/Production/{module}.lex.tex"))).unwrap();
        for declaration in semantic_data(&source)["declarations"].as_array().unwrap() {
            if declaration["kind"] == "structure" {
                types.insert(
                    format!(
                        "Production.{module}.{}",
                        declaration["name"].as_str().unwrap()
                    ),
                    declaration.clone(),
                );
            }
        }
    }
    let mut declarations = Vec::new();
    for release in ["A", "B"] {
        fixture["model"]["product"]["version"] = json!(release);
        for (name, field, ty) in [
            ("systemModel", "model", "SystemModel"),
            ("systemManifest", "manifest", "SystemManifest"),
        ] {
            declarations.push(json!({"kind":"definition","name":format!("{name}{release}"),"parameters":[],"result":named(ty),"body":term(&fixture[field], &named(ty), "Production.System", &types)}));
        }
        declarations.push(json!({
            "kind":"theorem", "name":format!("release{release}SystemReleaseReady"),"parameters":[],"axioms":[],"proof":{"kind":"decide"},
            "statement":{"kind":"eq","left":{"kind":"call","function":{"module":"Production.SystemValidation","name":"validateManifest"},"arguments":[
                {"kind":"call","function":{"name":format!("systemModel{release}")},"arguments":[]},
                {"kind":"call","function":{"name":format!("systemManifest{release}")},"arguments":[]}
            ]},"right":{"kind":"bool","value":true}}
        }));
    }
    let release_source = format!(
        "\\begin{{lexlean}}{{Release}}\n\\useglossary{{lexlean.std.bool@1.2.0}}\n\\useglossary{{lexlean.std.nat@1.2.0}}\n\\importmodule{{Calculator}}\n\\importmodule{{Production.Core}}\n\\importmodule{{Production.Interface}}\n\\importmodule{{Production.Runtime}}\n\\importmodule{{Production.Operations}}\n\\importmodule{{Production.Validation}}\n\\importmodule{{Production.System}}\n\\importmodule{{Production.SystemValidation}}\n\\title{{Boolean}}\n\\begin{{semanticmodule}}\n\\semanticdata{{{}}}\n\\end{{semanticmodule}}\n\\end{{lexlean}}\n",
        serde_json::to_string(&json!({"spec":"lexlean/semantic-module/2","declarations":declarations})).unwrap()
    );
    std::fs::write(
        root.join("src/Release.lex.tex"),
        lexlean::sdk::to_notation(&release_source).unwrap(),
    )
    .unwrap();
    let config = std::fs::read_to_string(root.join("lexlean.toml"))
        .unwrap()
        .replace(
            "entrypoints = [\"src/Calculator.lex.tex\"]",
            "entrypoints = [\"src/Release.lex.tex\"]",
        );
    std::fs::write(root.join("lexlean.toml"), config).unwrap();
    relock(root);
    // Application identity includes the final project configuration. Bind the
    // exact selected application snapshot only after installing that config.
    let snapshot = Engine::load(&utf8(root.join("lexlean.toml")).unwrap())
        .unwrap()
        .snapshot(LexCheckRequest {
            selection: Selection::Files([Utf8PathBuf::from("src/Calculator.lex.tex")].into()),
        })
        .unwrap();
    let application = crate::holo::application::project_application(&snapshot)
        .unwrap()
        .unwrap();
    let digest = format!(
        "sha256:{}",
        content_id(&encode_canonical(&application).unwrap())
    );
    let source = std::fs::read_to_string(root.join("src/Release.lex.tex")).unwrap();
    let source = source.replace(
        fixture["model"]["applicationProfile"]["applicationModelDigest"]
            .as_str()
            .unwrap(),
        &digest,
    );
    std::fs::write(root.join("src/Release.lex.tex"), source).unwrap();
    relock(root);
    temporary
}

#[test]
fn complete_named_release_projection_is_safe_on_a_small_caller_stack() {
    // This is the same complete 108-element certificate fixture used by the
    // original release build/verification case, not a shortened model.
    let temporary = named_releases();
    let controller = Controller::load(temporary.path()).unwrap();
    std::thread::Builder::new()
        .name("small-model-caller".to_owned())
        .stack_size(2 * 1024 * 1024)
        .spawn(move || {
            let _temporary = temporary;
            let checked = controller
                .check(CheckRequest { config_path: None })
                .unwrap();
            assert_eq!(checked.schema, "prismpm/check-result/1");
            assert_eq!(checked.entity_count, 0);
            for digest in [checked.semantic_id, checked.snapshot_id, checked.model_id] {
                assert_eq!(digest.len(), 64);
                assert!(digest.bytes().all(|byte| byte.is_ascii_hexdigit()));
            }
            let systems = controller.production_systems().unwrap();
            assert_eq!(systems.len(), 2);
            assert_eq!(systems[0].value()["product"]["version"], "A");
            assert_eq!(systems[1].value()["product"]["version"], "B");
            // Closed system-domain JSON may cross the boundary. Its existing
            // public consumer also clones and drops it on the caller stack.
            for system in &systems {
                let value = system.value().clone();
                assert_eq!(value, *system.value());
                drop(value);
            }
            drop(systems);
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn prepared_work_preserves_the_verification_reentrancy_scope() {
    let temporary = calculator_project();
    let controller = Controller::load(temporary.path()).unwrap();
    let plan = model_worker::Plan::load(temporary.path(), None).unwrap();
    model_worker::run(&plan, model_worker::Kind::Verification, || {
        let _guard = VerifyWorkerGuard::enter()?;
        let thread = std::thread::current().id();
        controller.with_prepared_release(None, None, |_| {
            assert_eq!(std::thread::current().id(), thread);
            assert_eq!(ensure_verification_not_active().unwrap_err().code, "PP5008");
            assert_eq!(
                controller
                    .verify(VerifyRequest { config_path: None })
                    .unwrap_err()
                    .code,
                "PP5008"
            );
            Ok(true)
        })?;
        Ok(())
    })
    .unwrap();
    ensure_verification_not_active().unwrap();
}

#[test]
fn actual_prepared_snapshot_unwinds_inside_its_model_worker() {
    let temporary = calculator_project();
    let controller = Controller::load(temporary.path()).unwrap();
    let error = controller
        .with_prepared_release::<bool>(None, None, |_| {
            panic!("unwind after the actual selected compiler snapshot was prepared");
        })
        .unwrap_err();
    assert_eq!(error.code, "PP9001");
    controller
        .check(CheckRequest { config_path: None })
        .unwrap();
    ensure_verification_not_active().unwrap();
}

#[test]
fn changed_model_budget_is_refused_before_loading_the_engine() {
    let temporary = calculator_project();
    let controller = Controller::load(temporary.path()).unwrap();
    let plan = model_worker::Plan::load(temporary.path(), None).unwrap();
    let path = temporary.path().join("lexlean.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    let changed = original.replace("max_scope_depth = 1024", "max_scope_depth = 2048");
    assert_ne!(original, changed, "the actual selected budget must change");
    let error = model_worker::run(&plan, model_worker::Kind::Model, || {
        std::fs::write(&path, changed).unwrap();
        let _prepared = controller.prepare_release_in_worker(&plan, None)?;
        Ok(())
    })
    .unwrap_err();
    assert_eq!(error.code, "PP9001");
    assert!(error.message.contains("configuration changed"));
    assert!(!temporary.path().join(".prism/build").exists());
}

#[test]
fn verification_selection_reload_cannot_change_its_worker_binding() {
    let temporary = calculator_project();
    let controller = Controller::load(temporary.path()).unwrap();
    let plan = model_worker::Plan::load(temporary.path(), None).unwrap();
    let path = temporary.path().join("prismpm.toml");
    let original = std::fs::read_to_string(&path).unwrap();
    let changed = original.replace("lexlean.toml", "another.toml");
    assert_ne!(original, changed);
    let error = model_worker::run(&plan, model_worker::Kind::Verification, || {
        let _guard = VerifyWorkerGuard::enter()?;
        std::fs::write(&path, changed).unwrap();
        controller.check_model_configuration(None)
    })
    .unwrap_err();
    assert_eq!(error.code, "PP9001");
    assert!(error.message.contains("configuration changed"));
    assert!(!temporary.path().join(".prism/build").exists());
    ensure_verification_not_active().unwrap();
}

#[cfg(unix)]
#[test]
fn existing_selected_configuration_hardlink_is_accepted() {
    let temporary = calculator_project();
    let original = temporary.path().join("lexlean.toml");
    let alias = temporary.path().join("chosen.toml");
    std::fs::hard_link(original, &alias).unwrap();
    let path = temporary.path().join("prismpm.toml");
    let selected = std::fs::read_to_string(&path)
        .unwrap()
        .replace("lexlean.toml", "chosen.toml");
    std::fs::write(path, selected).unwrap();
    let plan = model_worker::Plan::load(temporary.path(), None).unwrap();
    assert_eq!(plan.project_file.as_std_path(), alias);
    plan.observe().unwrap();
    model_worker::run(&plan, model_worker::Kind::Model, || {
        model_worker::require_current_selection(temporary.path(), None)
    })
    .unwrap();
}

fn assert_receipt(root: &Path, receipt: &VerifyResult, build: &BuildResult) {
    assert_eq!(receipt.build_id, build.build_id);
    let verified = root.join(&receipt.verified_root);
    let bytes = std::fs::read(verified.join("manifest.json")).unwrap();
    assert_eq!(content_id(&bytes), receipt.attestation_id);
    let manifest: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(encode_value(&manifest).unwrap(), bytes);
    assert_eq!(manifest["build_id"], build.build_id);
    assert_eq!(
        manifest["model_sha256"],
        content_id(&std::fs::read(root.join(&build.model_path)).unwrap())
    );
    let acceptance_bytes = std::fs::read(verified.join("application-acceptance.json")).unwrap();
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    let acceptance: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    assert_eq!(acceptance["build_id"], build.build_id);
    assert_eq!(acceptance["source_id"], build.source_id);
    assert_eq!(acceptance["status"], "verified");
    let lexlean_bytes = std::fs::read(verified.join("lexlean-attestation.json")).unwrap();
    assert_eq!(
        manifest["lexlean_attestation_sha256"],
        content_id(&lexlean_bytes)
    );
    let lexlean: Value = serde_json::from_slice(&lexlean_bytes).unwrap();
    assert_eq!(lexlean["source_id"], build.source_id);
    assert_eq!(lexlean["semantic_id"], build.semantic_id);
    assert_eq!(lexlean["status"], "verified");

    let build_root = root.join(&build.manifest_path).parent().unwrap().to_owned();
    let build_manifest_bytes = std::fs::read(root.join(&build.manifest_path)).unwrap();
    let build_manifest: Value = serde_json::from_slice(&build_manifest_bytes).unwrap();
    let build_files = build_manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let name = row["path"].as_str().unwrap();
            (
                name.to_owned(),
                std::fs::read(build_root.join(name)).unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let verification_files = walkdir::WalkDir::new(&verified)
        .min_depth(1)
        .into_iter()
        .map(|entry| {
            let entry = entry.unwrap();
            assert!(entry.file_type().is_file() && !entry.file_type().is_symlink());
            (
                entry
                    .path()
                    .strip_prefix(&verified)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned(),
                std::fs::read(entry.path()).unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    let binding = crate::release_verification::validate(
        &build_manifest_bytes,
        &build_files,
        &verification_files,
    )
    .unwrap();
    assert_eq!(binding.build_id, build.build_id);
    assert_eq!(
        binding.build_digest,
        format!("sha256:{}", content_id(&build_manifest_bytes))
    );
    assert_eq!(
        binding.model_digest,
        format!("sha256:{}", content_id(&build_files["model.prism.json"]))
    );
    assert_eq!(binding.attestation_id, receipt.attestation_id);
    assert_eq!(binding.family, "application");
    crate::release_verification::tests::reject_mutations(
        &build_manifest_bytes,
        &build_files,
        &verification_files,
    );
}

struct BrowserRelease {
    reference: String,
    digest: String,
    model_digest: String,
    build_digest: String,
    files: BTreeMap<String, Vec<u8>>,
    layout: BTreeMap<String, Vec<u8>>,
}

fn browser_release(root: &Path, build: &BuildResult, verified: &VerifyResult) -> BrowserRelease {
    let staging = tempfile::tempdir().unwrap();
    let (store, descriptor) = crate::oci::browser_export_fixture(
        staging.path(),
        "example.invalid/calculator:fixture",
        root,
        build,
        verified,
    );
    let build_root = root.join(&build.manifest_path).parent().unwrap().to_owned();
    let files = [
        "app.css",
        "app.js",
        "index.html",
        "prism_calculator.js",
        "prism_calculator_bg.wasm",
        "provenance.json",
    ]
    .into_iter()
    .map(|name| {
        (
            name.to_owned(),
            std::fs::read(build_root.join("view/browser").join(name)).unwrap(),
        )
    })
    .collect();
    let mut layout = BTreeMap::new();
    let marker = format!(
        "verified/{}.json",
        descriptor.digest.strip_prefix("sha256:").unwrap()
    );
    for entry in walkdir::WalkDir::new(store.root()).min_depth(1) {
        let entry = entry.unwrap();
        if entry.file_type().is_dir() {
            continue;
        }
        assert!(entry.file_type().is_file() && !entry.file_type().is_symlink());
        let name = entry.path().strip_prefix(store.root()).unwrap();
        if name.starts_with("blobs")
            || name == Path::new("index.json")
            || name == Path::new("oci-layout")
            || name == Path::new(&marker)
        {
            layout.insert(
                name.to_str().unwrap().to_owned(),
                std::fs::read(entry.path()).unwrap(),
            );
        }
    }
    // This is publication-consistency metadata, not a substitute for replaying
    // the complete proof closure. Its removal/forgery is tested below.
    assert!(layout.contains_key(&marker));
    let release = BrowserRelease {
        reference: format!("example.invalid/calculator@{}", descriptor.digest),
        digest: descriptor.digest,
        model_digest: format!(
            "sha256:{}",
            content_id(&std::fs::read(root.join(&build.model_path)).unwrap())
        ),
        build_digest: format!(
            "sha256:{}",
            content_id(&std::fs::read(root.join(&build.manifest_path)).unwrap())
        ),
        files,
        layout,
    };
    drop(store);
    staging.close().unwrap();
    release
}

fn browser_receiver(release: &BrowserRelease) -> tempfile::TempDir {
    let boundary = tempfile::tempdir().unwrap();
    let receiver = boundary.path().join("receiver");
    std::fs::create_dir(&receiver).unwrap();
    for (name, bytes) in &release.layout {
        let destination = receiver.join(".prism/oci").join(name);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(destination, bytes).unwrap();
    }
    for absent in [
        "src",
        "prismpm.toml",
        ".lexlean",
        ".prism/build",
        ".prism/verified",
    ] {
        assert!(!receiver.join(absent).exists());
    }
    boundary
}

fn assert_browser_refused(root: &Path, reference: &str, output: &Path) {
    let before = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<BTreeSet<_>>();
    let error = Controller::load(root)
        .unwrap()
        .export_browser(ExportBrowserRequest {
            reference: reference.to_owned(),
            output: output.to_owned(),
        })
        .unwrap_err();
    assert!(
        matches!(error.code.as_str(), "PP6101" | "PP8001"),
        "{error:?}"
    );
    let after = std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name())
        .collect::<BTreeSet<_>>();
    assert_eq!(after, before, "failure left an output or staging directory");
}

fn assert_source_free_browser_export(release: &BrowserRelease) {
    let boundary = browser_receiver(release);
    let root = boundary.path().join("receiver");
    let result = Controller::load(&root)
        .unwrap()
        .export_browser(ExportBrowserRequest {
            reference: release.reference.clone(),
            output: "browser-output".into(),
        })
        .unwrap();
    let rows = release
        .files
        .iter()
        .map(|(path, bytes)| {
            json!({"path":path,"digest":format!("sha256:{}",content_id(bytes)),"size":bytes.len()})
        })
        .collect::<Vec<_>>();
    assert_eq!(
        result,
        json!({
            "schema":"prismpm/browser-export/1",
            "reference":release.reference,
            "release_digest":release.digest,
            "model_digest":release.model_digest,
            "build_digest":release.build_digest,
            "output":"browser-output",
            "files":rows,
            "tree_digest":format!("sha256:{}",content_id(&encode_value(&json!(rows)).unwrap()))
        })
    );
    let exported = std::fs::read_dir(root.join("browser-output"))
        .unwrap()
        .map(|entry| {
            let entry = entry.unwrap();
            assert!(entry.file_type().unwrap().is_file());
            (
                entry.file_name().to_str().unwrap().to_owned(),
                std::fs::read(entry.path()).unwrap(),
            )
        })
        .collect::<BTreeMap<_, _>>();
    assert_eq!(exported, release.files);
    for absent in [
        "src",
        "prismpm.toml",
        ".lexlean",
        ".prism/build",
        ".prism/verified",
    ] {
        assert!(!root.join(absent).exists(), "export rebuilt {absent}");
    }
    for (name, bytes) in &release.layout {
        assert_eq!(
            std::fs::read(root.join(".prism/oci").join(name)).unwrap(),
            *bytes,
            "export modified the copied OCI closure"
        );
    }
    assert_eq!(
        walkdir::WalkDir::new(root.join(".prism/oci"))
            .into_iter()
            .map(Result::unwrap)
            .filter(|entry| entry.file_type().is_file())
            .count(),
        release.layout.len(),
        "export created additional OCI evidence"
    );

    // Existing directory/file/symlink destinations must never be replaced.
    assert_browser_refused(&root, &release.reference, Path::new("browser-output"));
    for (name, bytes) in &release.files {
        assert_eq!(
            std::fs::read(root.join("browser-output").join(name)).unwrap(),
            *bytes
        );
    }
    assert_eq!(
        std::fs::read_dir(root.join("browser-output"))
            .unwrap()
            .count(),
        6
    );
    std::fs::write(root.join("existing-file"), b"preserve").unwrap();
    assert_browser_refused(&root, &release.reference, Path::new("existing-file"));
    assert_eq!(
        std::fs::read(root.join("existing-file")).unwrap(),
        b"preserve"
    );
    for name in [
        "",
        ".",
        "..",
        "../escape",
        "nested/output",
        "./output",
        ".hidden",
        "-output",
        "with space",
        "with\\slash",
        "with:colon",
        "é",
    ] {
        assert_browser_refused(&root, &release.reference, Path::new(name));
    }
    assert_browser_refused(&root, &release.reference, Path::new(&"a".repeat(129)));
    assert_browser_refused(
        &root,
        &release.reference,
        &boundary.path().join("absolute-output"),
    );
    assert!(!boundary.path().join("absolute-output").exists());
    assert!(!boundary.path().join("escape").exists());
    assert_browser_refused(
        &root,
        "example.invalid/calculator:fixture",
        Path::new("tag-output"),
    );

    #[cfg(unix)]
    {
        let outside = boundary.path().join("outside");
        std::fs::create_dir(&outside).unwrap();
        std::fs::write(outside.join("sentinel"), b"preserve").unwrap();
        std::os::unix::fs::symlink(&outside, root.join("linked-output")).unwrap();
        assert_browser_refused(&root, &release.reference, Path::new("linked-output"));
        assert_eq!(
            std::fs::read(outside.join("sentinel")).unwrap(),
            b"preserve"
        );
        assert_eq!(std::fs::read_dir(&outside).unwrap().count(), 1);
    }

    for mutation in [
        "browser-bytes",
        "missing-proof",
        "missing-proof-blob",
        "missing-marker",
        "forged-marker",
    ] {
        let damaged = browser_receiver(release);
        let root = damaged.path().join("receiver");
        let layout = root.join(".prism/oci");
        let mut index: Value =
            serde_json::from_slice(&std::fs::read(layout.join("index.json")).unwrap()).unwrap();
        if matches!(mutation, "missing-marker" | "forged-marker") {
            let marker = layout.join("verified").join(format!(
                "{}.json",
                release.digest.strip_prefix("sha256:").unwrap()
            ));
            if mutation == "missing-marker" {
                std::fs::remove_file(marker).unwrap();
            } else {
                let mut value: Value =
                    serde_json::from_slice(&std::fs::read(&marker).unwrap()).unwrap();
                value["graph_digest"] = json!(format!("sha256:{}", "0".repeat(64)));
                std::fs::write(marker, encode_value(&value).unwrap()).unwrap();
            }
        } else if mutation == "missing-proof" {
            index["manifests"]
                .as_array_mut()
                .unwrap()
                .retain(|row| row["artifactType"] != crate::oci::PRISM_VERIFICATION);
            std::fs::write(layout.join("index.json"), encode_value(&index).unwrap()).unwrap();
        } else {
            let digest = if mutation == "browser-bytes" {
                content_id(&release.files["app.js"])
            } else {
                index["manifests"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|row| row["artifactType"] == crate::oci::PRISM_VERIFICATION)
                    .unwrap()["digest"]
                    .as_str()
                    .unwrap()
                    .strip_prefix("sha256:")
                    .unwrap()
                    .to_owned()
            };
            let blob = layout.join("blobs/sha256").join(digest);
            if mutation == "browser-bytes" {
                std::fs::write(blob, b"tampered browser code").unwrap();
            } else {
                std::fs::remove_file(blob).unwrap();
            }
        }
        assert_browser_refused(&root, &release.reference, Path::new("browser-output"));
        assert!(!root.join("browser-output").exists());
    }

    #[cfg(unix)]
    {
        let linked = browser_receiver(release);
        let root = linked.path().join("receiver");
        let outside = linked.path().join("external-blob");
        std::fs::write(&outside, &release.files["app.js"]).unwrap();
        let blob = root
            .join(".prism/oci/blobs/sha256")
            .join(content_id(&release.files["app.js"]));
        std::fs::remove_file(&blob).unwrap();
        std::os::unix::fs::symlink(&outside, &blob).unwrap();
        assert_browser_refused(&root, &release.reference, Path::new("browser-output"));
        assert_eq!(std::fs::read(outside).unwrap(), release.files["app.js"]);
    }
}

#[test]
fn browser_export_without_a_store_is_no_write() {
    let root = tempfile::tempdir().unwrap();
    assert_browser_refused(
        root.path(),
        &format!("example.invalid/calculator@sha256:{}", "1".repeat(64)),
        Path::new("browser-output"),
    );
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn explicit_release_requires_a_system_graph() {
    let temporary = calculator_project();
    let controller = Controller::load(temporary.path()).unwrap();
    assert!(controller.prepare(None).unwrap().system.is_none());
    for release in ["A", "Missing", "../A", ""] {
        let error = controller
            .verify_release(VerifyRequest { config_path: None }, Some(release))
            .unwrap_err();
        assert_eq!(error.code, "PP2101");
    }
    assert!(!temporary.path().join(".prism/verified").exists());
    assert!(!temporary.path().join(".prism/build").exists());
}

#[test]
fn modeled_system_projections_pass_all_seven_locked_oracles() {
    let _compiler = crate::test_compiler::acquire();
    let temporary = named_releases();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let build = controller
        .build_release(BuildRequest { config_path: None }, Some("A"))
        .unwrap();
    let manifest_path = root.join(&build.manifest_path);
    let manifest = std::fs::read(&manifest_path).unwrap();
    let results = crate::oci::projection_oracle_fixture(root, &build);
    assert_eq!(
        results
            .iter()
            .map(|result| result["oracle"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "asyncapi-3.1-schema",
            "cloudevents-1.0-json",
            "compose-fee041b3",
            "kubernetes-1.36.4",
            "openapi-3.2-schema",
            "otel-collector-0.136.0",
            "spdx-3.0.1-model",
        ]
    );
    for result in results {
        assert_eq!(result["schema"], "prismpm/validation-result/1");
        assert_eq!(result["valid"], true);
        assert!(result["evidence_path"].as_str().is_some());
    }
    assert_eq!(std::fs::read(manifest_path).unwrap(), manifest);
    assert!(!root.join(".prism/verified").exists());
}

#[test]
fn alternate_release_verification_is_bound_to_the_selected_build() {
    let _compiler = crate::test_compiler::acquire();
    let temporary = named_releases();
    let root = temporary.path();
    let controller = Controller::load(root).unwrap();
    let a = controller
        .build_release(BuildRequest { config_path: None }, Some("A"))
        .unwrap();
    let b = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    assert_ne!(a.build_id, b.build_id);
    assert_eq!(a.source_id, b.source_id);
    assert_eq!(a.semantic_id, b.semantic_id);
    for (build, version) in [(&a, "A"), (&b, "B")] {
        let system: Value = serde_json::from_slice(
            &std::fs::read(
                root.join(".prism/build")
                    .join(&build.build_id)
                    .join("system.prism.json"),
            )
            .unwrap(),
        )
        .unwrap();
        assert_eq!(system["product"]["version"], version);
    }
    let verified_a = controller
        .verify_release(VerifyRequest { config_path: None }, Some("A"))
        .unwrap();
    assert_receipt(root, &verified_a, &a);
    require_verified_build(&verified_a, &a).unwrap();
    assert_eq!(
        require_verified_build(&verified_a, &b).unwrap_err().code,
        "PP6101"
    );
    let verified_b = controller
        .verify(VerifyRequest { config_path: None })
        .unwrap();
    assert_receipt(root, &verified_b, &b);
    require_verified_build(&verified_b, &b).unwrap();
    assert_eq!(
        require_verified_build(&verified_b, &a).unwrap_err().code,
        "PP6101"
    );
    for release in ["Missing", "../A", ""] {
        assert_eq!(
            controller
                .verify_release(VerifyRequest { config_path: None }, Some(release))
                .unwrap_err()
                .code,
            "PP2101"
        );
    }
    let releases = [
        browser_release(root, &a, &verified_a),
        browser_release(root, &b, &verified_b),
    ];
    assert_ne!(releases[0].digest, releases[1].digest);
    let deleted_source = root.to_owned();
    drop(controller);
    temporary.close().unwrap();
    assert!(!deleted_source.exists());
    for release in releases {
        assert_source_free_browser_export(&release);
    }
}
