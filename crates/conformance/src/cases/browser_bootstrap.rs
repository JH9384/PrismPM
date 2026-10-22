//! Native-only finite oracle for the internal candidate bootstrap lifecycle.

use super::native_library::runtime_rejection;
use prismpm::controller::{CheckRequest, VerifyRequest};
use prismpm::holo::canonical::{content_id, encode_value};
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const DIRECTORY: &str = "stdlib/src/Foundation/Network/V1";
const ROOT_COUNT: usize = 136;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorpusIndex {
    schema: String,
    roots: Vec<String>,
    errors: Vec<String>,
}

struct Fixture {
    project: tempfile::TempDir,
    roots: Vec<String>,
    exports: Vec<String>,
    declarations: BTreeSet<String>,
}

fn semantic(source: &str) -> Value {
    let line = source
        .lines()
        .find_map(|line| line.strip_prefix("\\semanticdata{"))
        .unwrap();
    serde_json::from_str(line.strip_suffix('}').unwrap()).unwrap()
}

fn rewrite(source: &str, value: &Value) -> String {
    let payload = String::from_utf8(encode_value(value).unwrap()).unwrap();
    source
        .lines()
        .map(|line| {
            if line.starts_with("\\semanticdata{") {
                format!("\\semanticdata{{{payload}}}\n")
            } else {
                format!("{line}\n")
            }
        })
        .collect()
}

fn strings(values: &[String]) -> Value {
    values.iter().rev().fold(
        json!({"kind":"nil","element":{"kind":"string"}}),
        |tail, value| json!({"kind":"cons","head":{"kind":"string","value":value},"tail":tail}),
    )
}

fn root_chunks(values: &[String], prefix: &str, declarations: &mut Vec<Value>) -> Value {
    let mut chunks = Vec::new();
    for (index, values) in values.chunks(16).enumerate() {
        let name = format!("{prefix}{index}");
        declarations.push(json!({"kind":"definition","name":name,"parameters":[],
            "result":{"kind":"list","element":{"kind":"string"}},"body":strings(values)}));
        chunks.push(json!({"kind":"call","function":{"name":name},"arguments":[]}));
    }
    while chunks.len() > 1 {
        chunks = chunks.chunks(2).map(|pair| {
            if pair.len() == 1 { pair[0].clone() } else {
                json!({"kind":"primitive","operation":"append","result":{"kind":"list","element":{"kind":"string"}},"arguments":pair})
            }
        }).collect();
    }
    chunks.pop().unwrap()
}

fn fixture(root: &Path) -> Fixture {
    let source = root.join(DIRECTORY);
    for name in ["BrowserBootstrap.lex.tex", "Corpus.lex.tex", "corpus.json"] {
        assert!(
            source.join(name).is_file(),
            "ST-14 requires its actual model and finite oracle: {name}"
        );
    }
    let index: CorpusIndex =
        serde_json::from_slice(&std::fs::read(source.join("corpus.json")).unwrap()).unwrap();
    assert_eq!(index.schema, "prismpm/internal-browser-bootstrap-corpus/1");
    assert_eq!(index.roots.len(), ROOT_COUNT);
    assert!(index.roots.windows(2).all(|pair| pair[0] < pair[1]));
    let model =
        semantic(&std::fs::read_to_string(source.join("BrowserBootstrap.lex.tex")).unwrap());
    let errors = model["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["name"] == "BootstrapError")
        .unwrap()["constructors"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["name"].as_str().unwrap().to_owned())
        .collect::<Vec<_>>();
    assert_eq!(errors.len(), 23);
    assert_eq!(index.errors, errors);
    let corpus = semantic(&std::fs::read_to_string(source.join("Corpus.lex.tex")).unwrap());
    let actual = corpus["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|row| {
            let name = row["name"].as_str().unwrap();
            name.starts_with("probe").then(|| {
                assert_eq!(row["parameters"], json!([]));
                assert_eq!(row["result"], json!({"kind":"bool"}));
                assert_eq!(row["body"]["kind"], "call");
                format!("LibraryProbe.Foundation.Network.V1.Corpus.{name}")
            })
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, index.roots.iter().cloned().collect());
    assert_eq!(actual.len(), ROOT_COUNT);

    let project = tempfile::Builder::new()
        .prefix("prismpm-browser-bootstrap-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    let target = project.path().join("src/Foundation/Network/V1");
    std::fs::create_dir_all(&target).unwrap();
    for name in ["BrowserBootstrap.lex.tex", "Corpus.lex.tex"] {
        let bytes = std::fs::read(source.join(name)).unwrap();
        std::fs::write(target.join(name), &bytes).unwrap();
        assert_eq!(std::fs::read(target.join(name)).unwrap(), bytes);
    }
    let probe_path = project.path().join("src/Probe.lex.tex");
    let probe_source = std::fs::read_to_string(&probe_path).unwrap();
    let mut probe = semantic(&probe_source);
    probe["declarations"]
        .as_array_mut()
        .unwrap()
        .retain(|row| row["name"] == "probeLibrary");
    let mut exports = index.roots.clone();
    exports.extend([
        "LibraryProbe.Foundation.Network.V1.BrowserBootstrap.createBrowserBootstrap".to_owned(),
        "LibraryProbe.Foundation.Network.V1.BrowserBootstrap.transitionBrowserBootstrap".to_owned(),
    ]);
    exports.sort();
    let declarations = probe["declarations"].as_array_mut().unwrap();
    let mut descriptor = declarations.pop().unwrap();
    let export_roots = root_chunks(&exports, "exportChunk", declarations);
    let acceptance_roots = root_chunks(&index.roots, "acceptanceChunk", declarations);
    for field in descriptor["body"]["fields"].as_array_mut().unwrap() {
        match field["field"].as_str().unwrap() {
            "exportRoots" => field["value"] = export_roots.clone(),
            "acceptanceRoots" => field["value"] = acceptance_roots.clone(),
            "name" => field["value"]["value"] = json!("Internal candidate browser bootstrap"),
            "cargoName" => field["value"]["value"] = json!("prism-bootstrap-conformance"),
            _ => {}
        }
    }
    declarations.push(descriptor);
    let probe_source = probe_source.replace(
        "\\importmodule{Foundation.Library.V1.Model}\n",
        "\\importmodule{Foundation.Library.V1.Model}\n\\importmodule{Foundation.Network.V1.Corpus}\n",
    );
    std::fs::write(probe_path, rewrite(&probe_source, &probe)).unwrap();

    // Bind the audit to every authored declaration, not only exported roots.
    let mut declarations = BTreeSet::new();
    for name in [
        "Probe.lex.tex",
        "Foundation/Library/V1/Model.lex.tex",
        "Foundation/Network/V1/BrowserBootstrap.lex.tex",
        "Foundation/Network/V1/Corpus.lex.tex",
    ] {
        let source = std::fs::read_to_string(project.path().join("src").join(name)).unwrap();
        let module = source
            .lines()
            .find_map(|line| line.strip_prefix("\\begin{lexlean}{"))
            .unwrap()
            .strip_suffix('}')
            .unwrap();
        for row in semantic(&source)["declarations"].as_array().unwrap() {
            assert!(declarations.insert(format!(
                "LibraryProbe.{module}.{}",
                row["name"].as_str().unwrap()
            )));
        }
    }
    Fixture {
        project,
        roots: index.roots,
        exports,
        declarations,
    }
}

fn verified_names(project: &Path) -> BTreeSet<String> {
    let root = project.join(".prism/verified");
    if !root.exists() {
        return BTreeSet::new();
    }
    std::fs::read_dir(root)
        .unwrap()
        .map(|entry| entry.unwrap().file_name().into_string().unwrap())
        .collect()
}

fn accepted(fixture: &Fixture, verified: &prismpm::controller::VerifyResult) {
    let project = fixture.project.path();
    let output = project.join(&verified.verified_root);
    let acceptance_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let acceptance: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    let manifest_bytes = std::fs::read(output.join("manifest.json")).unwrap();
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(verified.attestation_id, content_id(&manifest_bytes));
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    assert_eq!(acceptance["scope"], "native-library-only");
    assert_eq!(acceptance["profile"], "prismpm/native-library/1");
    assert_eq!(acceptance["build_id"], verified.build_id);
    assert_eq!(acceptance["status"], "passed");
    assert_eq!(acceptance["regeneration"], "byte-identical");
    assert_eq!(acceptance["export_roots"], json!(fixture.exports));
    assert_eq!(
        acceptance["executions"],
        json!([
            {"mode":"std","roots":fixture.roots,"status":"passed"},
            {"mode":"no_std","roots":fixture.roots,"status":"passed"}
        ])
    );
    assert_eq!(
        acceptance["unclaimed"],
        json!([
            "application",
            "browser",
            "holo",
            "production-release",
            "deployment"
        ])
    );
    for mode in ["std", "no_std"] {
        let tool = format!("native-library-{mode}-acceptance");
        let processes = manifest["processes"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["tool"] == tool)
            .collect::<Vec<_>>();
        assert_eq!(processes.len(), 1);
        assert_eq!(processes[0]["exit_code"], 0);
        let stdout: Value = serde_json::from_str(processes[0]["stdout"].as_str().unwrap()).unwrap();
        assert_eq!(stdout, json!({"roots":fixture.roots,"status":"passed"}));
    }
    let build = project.join(".prism/build").join(&verified.build_id);
    let model = super::json(&build.join("model.prism.json"));
    assert!(model.get("application").is_none());
    assert!(model.get("system").is_none());
    assert_eq!(model["library"]["acceptance_roots"], json!(fixture.roots));
    let snapshot = super::json(&build.join("lexlean/snapshot.json"));
    let mut expected = BTreeMap::new();
    for module in snapshot["modules"].as_array().unwrap() {
        for declaration in module["declarations"].as_array().unwrap() {
            let name = format!(
                "{}.{}",
                module["lean_module"].as_str().unwrap(),
                declaration["lean_name"].as_str().unwrap()
            );
            assert!(expected.insert(name, declaration).is_none());
        }
    }
    assert_eq!(
        expected.keys().cloned().collect::<BTreeSet<_>>(),
        fixture.declarations
    );
    let attestation_bytes = std::fs::read(output.join("lexlean-attestation.json")).unwrap();
    assert_eq!(
        manifest["lexlean_attestation_sha256"],
        content_id(&attestation_bytes)
    );
    let attestation: Value = serde_json::from_slice(&attestation_bytes).unwrap();
    assert_eq!(attestation["status"], "verified");
    let audits = attestation["declarations"].as_array().unwrap();
    assert_eq!(audits.len(), expected.len());
    let mut audited = BTreeSet::new();
    for audit in audits {
        let name = audit["name"].as_str().unwrap();
        assert!(audited.insert(name.to_owned()));
        assert_eq!(audit["result"], "ok");
        assert_eq!(audit["policy"], expected.get(name).unwrap()["axiom_policy"]);
        assert_eq!(audit["observed"], json!([]));
    }
    assert_eq!(audited, fixture.declarations);
    eprintln!("ST-14: {} modeled roots passed std/no_std; {} exact declaration audits; build {}; attestation {}", fixture.roots.len(), audited.len(), verified.build_id, verified.attestation_id);
}

fn weakened_body(name: &str, body: &Value) -> Value {
    let total_true = |condition: Value| {
        json!({"kind":"match","scrutinee":condition,"branches":[
            {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bool","value":true}},
            {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bool","value":true}}
        ]})
    };
    match name {
        "bootstrapAuthorizationMatches" | "bootstrapConsentMatches" => total_true(body.clone()),
        "bootstrapSend" => {
            let mut body = body.clone();
            assert_eq!(body["kind"], "match");
            body["scrutinee"] = total_true(body["scrutinee"].clone());
            body
        }
        _ => panic!("unregistered candidate bootstrap mutant {name}"),
    }
}

pub(super) fn verify(root: &Path) {
    let fixture = fixture(root);
    let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
    controller
        .check(CheckRequest { config_path: None })
        .expect("actual candidate bootstrap model checks");
    let verified = match controller.verify(VerifyRequest { config_path: None }) {
        Ok(verified) => verified,
        Err(error) => {
            let retained = fixture.project.keep();
            panic!(
                "complete candidate bootstrap corpus failed; retained {}: {error:?}",
                retained.display()
            );
        }
    };
    accepted(&fixture, &verified);
    let path = fixture
        .project
        .path()
        .join("src/Foundation/Network/V1/BrowserBootstrap.lex.tex");
    let source = std::fs::read_to_string(&path).unwrap();
    let before = verified_names(fixture.project.path());
    for (name, rejected) in [
        ("bootstrapAuthorizationMatches", "probeAuthorizationbinding"),
        ("bootstrapConsentMatches", "probeConsentconsentRef"),
        ("bootstrapSend", "probeSendAfterOperatorRestored"),
    ] {
        let rejected = format!("LibraryProbe.Foundation.Network.V1.Corpus.{rejected}");
        assert!(fixture.roots.contains(&rejected));
        let mut mutant = semantic(&source);
        let declaration = mutant["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["name"] == name)
            .unwrap();
        declaration["body"] = weakened_body(name, &declaration["body"]);
        std::fs::write(&path, rewrite(&source, &mutant)).unwrap();
        let error = controller
            .verify(VerifyRequest { config_path: None })
            .expect_err("actual candidate bootstrap defect must fail generated execution");
        assert!(
            runtime_rejection(&error, &rejected),
            "{name}: exact modeled runtime root must reject, not compilation: {error:?}"
        );
        assert_eq!(verified_names(fixture.project.path()), before);
        eprintln!("ST-14: {name} rejected at {rejected} (generated runtime exit 101)");
        std::fs::write(&path, &source).unwrap();
        let restored = controller
            .verify(VerifyRequest { config_path: None })
            .expect("restored candidate passes the identical gate");
        accepted(&fixture, &restored);
        assert_eq!(restored.build_id, verified.build_id);
        assert_eq!(restored.attestation_id, verified.attestation_id);
        assert_eq!(verified_names(fixture.project.path()), before);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn candidate_bootstrap_authored_fixture_checks_without_native_acceptance() {
        let fixture = fixture(&repo_model::repo_root());
        let controller = prismpm::Controller::load(fixture.project.path()).unwrap();
        let checked = controller
            .check(CheckRequest { config_path: None })
            .unwrap();
        assert_eq!(checked.entity_count, u64::try_from(ROOT_COUNT + 2).unwrap());
        assert!(!fixture.project.path().join(".prism").exists());
        assert!(verified_names(fixture.project.path()).is_empty());
    }

    #[test]
    fn candidate_bootstrap_mutants_preserve_parameter_uses_and_owned_guards() {
        fn references(value: &Value, name: &str) -> bool {
            if value["kind"] == "var" && value["name"] == name {
                return true;
            }
            match value {
                Value::Object(fields) => fields.values().any(|value| references(value, name)),
                Value::Array(values) => values.iter().any(|value| references(value, name)),
                _ => false,
            }
        }
        let source = std::fs::read_to_string(
            repo_model::repo_root()
                .join(DIRECTORY)
                .join("BrowserBootstrap.lex.tex"),
        )
        .unwrap();
        let model = semantic(&source);
        for name in [
            "bootstrapAuthorizationMatches",
            "bootstrapConsentMatches",
            "bootstrapSend",
        ] {
            let declaration = model["declarations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"] == name)
                .unwrap();
            let changed = weakened_body(name, &declaration["body"]);
            assert_ne!(changed, declaration["body"]);
            for parameter in declaration["parameters"].as_array().unwrap() {
                assert!(references(&changed, parameter["name"].as_str().unwrap()));
            }
            let guard = if name == "bootstrapSend" {
                assert_eq!(changed["branches"], declaration["body"]["branches"]);
                assert_eq!(
                    declaration["body"]["scrutinee"]["scrutinee"],
                    json!({"kind":"project","value":{"kind":"var","name":"state"},"field":"phase"})
                );
                assert_eq!(
                    changed["scrutinee"]["scrutinee"],
                    declaration["body"]["scrutinee"]
                );
                &changed["scrutinee"]
            } else {
                assert_eq!(changed["scrutinee"], declaration["body"]);
                &changed
            };
            for branch in guard["branches"].as_array().unwrap() {
                assert_eq!(branch["body"], json!({"kind":"bool","value":true}));
            }
        }
    }

    #[test]
    fn candidate_bootstrap_runtime_guard_rejects_nonbehavioral_failure() {
        let root = "LibraryProbe.Foundation.Network.V1.Corpus.probeSendAfterOperatorRestored";
        let message = format!("native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"\\nthread 'main' (123) panicked at src/main.rs:12:1:\\n{root}\\n\"");
        assert!(runtime_rejection(
            &prismpm::PrismError::new("PP5006", &message),
            root
        ));
        assert!(runtime_rejection(
            &prismpm::PrismError::new("PP5006", message.replace(" (123)", "")),
            root
        ));
        for changed in [
            message.replace("exited 101", "exited 0"),
            message.replace("std-acceptance", "std-lock"),
            message.replace("(123)", "(not-a-pid)"),
            message.replace(root, "anotherRoot"),
            message.replace(root, &format!("anotherRoot\\n{root}")),
            message.replace("src/main.rs:12:1", "src/other.rs:12:1"),
            message.replace("src/main.rs:12:1", "src/main.rs:x:1"),
            message.replace("src/main.rs:12:1", "src/main.rs:0:1"),
            "native modeled acceptance transcript differs".to_owned(),
            "native-library-std-acceptance timed out".to_owned(),
            format!("{message} error[E0308]: could not compile"),
        ] {
            assert!(!runtime_rejection(
                &prismpm::PrismError::new("PP5006", changed),
                root
            ));
        }
        assert!(!runtime_rejection(
            &prismpm::PrismError::new("PP5001", message),
            root
        ));
    }
}
