//! Internal scoped-administration semantics must execute from their actual model.

use prismpm::controller::{CheckRequest, VerifyRequest};
use prismpm::holo::canonical::content_id;
use serde::Deserialize;
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct CorpusIndex {
    schema: String,
    roots: Vec<String>,
    errors: Vec<String>,
}

fn semantic(source: &str) -> Value {
    crate::semantic_source::read(source)
}

fn rewrite(source: &str, value: &Value) -> String {
    crate::semantic_source::write(source, value)
}

fn strings(values: &[String]) -> Value {
    values.iter().rev().fold(
        json!({"kind":"nil","element":{"kind":"string"}}),
        |tail, value| json!({"kind":"cons","head":{"kind":"string","value":value},"tail":tail}),
    )
}

fn weakened_body(name: &str, body: &Value) -> Value {
    match name {
        "administrationRetainedMinimum" => {
            let mut body = body.clone();
            assert_eq!(body["kind"], "match");
            assert_eq!(body["scrutinee"], json!({"kind":"var","name":"full"}));
            let branches = body["branches"].as_array_mut().unwrap();
            assert_eq!(branches.len(), 2);
            assert_eq!(branches[0]["constructor"]["name"], "Bool.false");
            assert_eq!(branches[0]["body"], json!({"kind":"nat","value":"1"}));
            assert_eq!(branches[1]["constructor"]["name"], "Bool.true");
            let guarded = &mut branches[1]["body"];
            assert_eq!(guarded["kind"], "match");
            let results = guarded["branches"].as_array_mut().unwrap();
            assert_eq!(results.len(), 2);
            // Corrupt both outcomes, retaining the original scope/full uses so
            // strict Lean warnings do not reject the mutant before execution.
            for branch in results {
                branch["body"] = json!({"kind":"nat","value":"1"});
            }
            body
        }
        "administrationUnscopedUserDelta" => {
            let mut body = body.clone();
            assert_eq!(body["kind"], "match");
            assert_eq!(body["scrutinee"], json!({"kind":"var","name":"users"}));
            let branches = body["branches"].as_array_mut().unwrap();
            assert_eq!(branches.len(), 2);
            assert_eq!(branches[1]["constructor"]["name"], "List.cons");
            let step = &mut branches[1]["body"];
            assert_eq!(step["kind"], "or");
            // Keep the structural recursion and all parameter references;
            // suppress only this member's local delta detection.
            step["left"] = json!({
                "kind":"match",
                "scrutinee":step["left"],
                "branches":[
                    {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bool","value":false}},
                    {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bool","value":false}}
                ]
            });
            body
        }
        _ => panic!("unregistered administration mutant {name}"),
    }
}

fn is_runtime_rejection(error: &prismpm::error::PrismError, root: &str) -> bool {
    let main_panic = error
        .message
        .split_once("\\nthread 'main' ")
        .is_some_and(|(_, suffix)| {
            let suffix = if let Some(pid) = suffix.strip_prefix('(') {
                let Some((pid, rest)) = pid.split_once(") ") else {
                    return false;
                };
                if pid.is_empty() || !pid.bytes().all(|byte| byte.is_ascii_digit()) {
                    return false;
                }
                rest
            } else {
                suffix
            };
            suffix.starts_with("panicked at src/main.rs:")
        });
    error.code == "PP5006"
        && error
            .message
            .starts_with("native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"")
        && main_panic
        && error.message.contains(&format!("\\n{root}\\n"))
        && !error.message.contains("could not compile")
        && !error.message.contains("error[E")
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

fn accepted(
    project: &Path,
    verified: &prismpm::controller::VerifyResult,
    roots: &[String],
    exports: &[String],
) {
    let output = project.join(&verified.verified_root);
    let result_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let result: Value = serde_json::from_slice(&result_bytes).unwrap();
    let manifest_bytes = std::fs::read(output.join("manifest.json")).unwrap();
    let manifest: Value = serde_json::from_slice(&manifest_bytes).unwrap();
    assert_eq!(verified.attestation_id, content_id(&manifest_bytes));
    assert_eq!(manifest["acceptance_sha256"], content_id(&result_bytes));
    assert_eq!(result["scope"], "native-library-only");
    assert_eq!(result["profile"], "prismpm/native-library/1");
    assert_eq!(result["build_id"], verified.build_id);
    assert_eq!(result["status"], "passed");
    assert_eq!(result["regeneration"], "byte-identical");
    assert_eq!(result["export_roots"], json!(exports));
    assert_eq!(
        result["executions"],
        json!([
            {"mode":"std","roots":roots,"status":"passed"},
            {"mode":"no_std","roots":roots,"status":"passed"}
        ])
    );
    assert_eq!(
        result["unclaimed"],
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
        assert_eq!(processes.len(), 1, "exactly one actual {mode} execution");
        assert_eq!(processes[0]["exit_code"], 0);
        let stdout: Value = serde_json::from_str(processes[0]["stdout"].as_str().unwrap()).unwrap();
        assert_eq!(stdout, json!({"roots":roots,"status":"passed"}));
    }
    let build = project.join(".prism/build").join(&verified.build_id);
    let model = super::json(&build.join("model.prism.json"));
    assert!(model.get("application").is_none());
    assert!(model.get("system").is_none());
    assert_eq!(model["library"]["acceptance_roots"], json!(roots));
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
    assert_eq!(expected.len(), 436, "complete selected declaration set");
    let attestation_bytes = std::fs::read(output.join("lexlean-attestation.json")).unwrap();
    assert_eq!(
        manifest["lexlean_attestation_sha256"],
        content_id(&attestation_bytes)
    );
    let attestation: Value = serde_json::from_slice(&attestation_bytes).unwrap();
    assert_eq!(attestation["status"], "verified");
    let audits = super::owned_audits(&attestation);
    assert_eq!(audits.len(), expected.len());
    let mut audited = BTreeSet::new();
    for audit in &audits {
        let name = audit["name"].as_str().unwrap();
        assert!(audited.insert(name));
        let declaration = expected.get(name).expect("selected source declaration");
        assert_eq!(audit["result"], "ok");
        assert_eq!(audit["policy"], declaration["axiom_policy"]);
        assert_eq!(audit["observed"], json!([]));
    }
    assert_eq!(
        audited.into_iter().collect::<Vec<_>>(),
        expected.keys().map(String::as_str).collect::<Vec<_>>()
    );
    eprintln!(
        "ST-12: {} modeled roots passed std/no_std; {} exact declaration audits; build {}; attestation {}",
        roots.len(),
        expected.len(),
        verified.build_id,
        verified.attestation_id
    );
}

pub(super) fn verify(root: &Path) {
    for name in ["Administration", "Corpus"] {
        assert!(
            root.join(format!(
                "stdlib/src/Foundation/Organization/V1/{name}.lex.tex"
            ))
            .is_file(),
            "ST-12 requires the actual modeled scoped-administration reducer and corpus"
        );
    }
    let source_root = root.join("stdlib/src/Foundation/Organization/V1");
    let index: CorpusIndex =
        serde_json::from_slice(&std::fs::read(source_root.join("corpus.json")).unwrap()).unwrap();
    assert_eq!(index.schema, "prismpm/internal-administration-corpus/1");
    assert_eq!(
        index.errors,
        [
            "BadState",
            "ResourceLimit",
            "WrongOrganization",
            "StaleRevision",
            "RevisionExhausted",
            "BadRequest",
            "RootChanged",
            "StageRollback",
            "ScopeRemoval",
            "BadProposal",
            "NoChange",
            "BadApproval",
            "DuplicateApproval",
            "OutOfScopeApproval",
            "InsufficientApproval",
            "CoverageLoss"
        ]
    );
    let acceptance = index.roots;
    assert_eq!(
        acceptance.len(),
        75,
        "complete registered administration corpus"
    );
    assert!(acceptance.windows(2).all(|pair| pair[0] < pair[1]));
    let corpus = semantic(&std::fs::read_to_string(source_root.join("Corpus.lex.tex")).unwrap());
    let actual = corpus["declarations"]
        .as_array()
        .unwrap()
        .iter()
        .filter_map(|row| {
            let name = row["name"].as_str().unwrap();
            name.starts_with("probe").then(|| {
                assert_eq!(row["result"], json!({"kind":"bool"}));
                assert_eq!(row["parameters"], json!([]));
                assert_eq!(row["body"]["kind"], "call");
                format!("LibraryProbe.Foundation.Organization.V1.Corpus.{name}")
            })
        })
        .collect::<BTreeSet<_>>();
    assert_eq!(actual, acceptance.iter().cloned().collect());
    assert_eq!(
        actual.len(),
        acceptance.len(),
        "no duplicate acceptance roots"
    );

    let project = tempfile::Builder::new()
        .prefix("prismpm-scoped-administration-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    let target = project.path().join("src/Foundation/Organization/V1");
    std::fs::create_dir_all(&target).unwrap();
    for name in ["Administration.lex.tex", "Corpus.lex.tex"] {
        let bytes = std::fs::read(source_root.join(name)).unwrap();
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
    let mut exports = acceptance.clone();
    exports.extend([
        "LibraryProbe.Foundation.Organization.V1.Administration.createAdministration".to_owned(),
        "LibraryProbe.Foundation.Organization.V1.Administration.transitionAdministration"
            .to_owned(),
    ]);
    exports.sort();
    for field in probe["declarations"][0]["body"]["fields"]
        .as_array_mut()
        .unwrap()
    {
        match field["field"].as_str().unwrap() {
            "exportRoots" => field["value"] = strings(&exports),
            "acceptanceRoots" => field["value"] = strings(&acceptance),
            "name" => field["value"]["value"] = json!("Internal scoped administration"),
            "cargoName" => field["value"]["value"] = json!("prism-administration-conformance"),
            _ => {}
        }
    }
    let probe_source = probe_source.replace(
        "\\importmodule{Foundation.Library.V1.Model}\n",
        "\\importmodule{Foundation.Library.V1.Model}\n\\importmodule{Foundation.Organization.V1.Corpus}\n",
    );
    std::fs::write(probe_path, rewrite(&probe_source, &probe)).unwrap();

    let controller = prismpm::Controller::load(project.path()).unwrap();
    controller
        .check(CheckRequest { config_path: None })
        .expect("actual authored administration model checks");
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .expect("complete modeled administration corpus passes native acceptance");
    accepted(project.path(), &verified, &acceptance, &exports);

    let model_path = target.join("Administration.lex.tex");
    let model_source = std::fs::read_to_string(&model_path).unwrap();
    let before = verified_names(project.path());
    for (name, rejected_root) in [
        (
            "administrationUnscopedUserDelta",
            "LibraryProbe.Foundation.Organization.V1.Corpus.probeBundledMembershipBothQuorums",
        ),
        (
            "administrationRetainedMinimum",
            "LibraryProbe.Foundation.Organization.V1.Corpus.probeInheritedAndDirectNotTwoUsers",
        ),
    ] {
        assert!(acceptance.iter().any(|root| root == rejected_root));
        let mut defective = semantic(&model_source);
        let guard = defective["declarations"]
            .as_array_mut()
            .unwrap()
            .iter_mut()
            .find(|row| row["name"] == name)
            .unwrap();
        guard["body"] = weakened_body(name, &guard["body"]);
        std::fs::write(&model_path, rewrite(&model_source, &defective)).unwrap();
        let error = controller
            .verify(VerifyRequest { config_path: None })
            .expect_err("weakening actual administration must fail native acceptance");
        assert_eq!(error.code, "PP5006", "{name}: {error:?}");
        assert!(
            is_runtime_rejection(&error, rejected_root),
            "{name}: exact generated runtime root must reject, not compilation: {error:?}"
        );
        eprintln!("ST-12: {name} rejected by generated execution at {rejected_root} (exit 101)");
        assert_eq!(verified_names(project.path()), before);
        std::fs::write(&model_path, &model_source).unwrap();
        let restored = controller
            .verify(VerifyRequest { config_path: None })
            .expect("restored complete model passes the same native acceptance gate");
        accepted(project.path(), &restored, &acceptance, &exports);
        assert_eq!(restored.build_id, verified.build_id);
        assert_eq!(restored.attestation_id, verified.attestation_id);
        assert_eq!(verified_names(project.path()), before);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

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

    #[test]
    fn administration_mutants_preserve_parameter_uses_and_corrupt_only_outcomes() {
        let source = std::fs::read_to_string(
            repo_model::repo_root()
                .join("stdlib/src/Foundation/Organization/V1/Administration.lex.tex"),
        )
        .unwrap();
        let document = semantic(&source);
        for name in [
            "administrationRetainedMinimum",
            "administrationUnscopedUserDelta",
        ] {
            let declaration = document["declarations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"] == name)
                .unwrap();
            let body = weakened_body(name, &declaration["body"]);
            assert_ne!(body, declaration["body"]);
            for parameter in declaration["parameters"].as_array().unwrap() {
                assert!(references(&body, parameter["name"].as_str().unwrap()));
            }
            if name == "administrationRetainedMinimum" {
                assert_eq!(body["scrutinee"], declaration["body"]["scrutinee"]);
                assert_eq!(
                    body["branches"][1]["body"]["scrutinee"],
                    declaration["body"]["branches"][1]["body"]["scrutinee"]
                );
                for branch in body["branches"][1]["body"]["branches"].as_array().unwrap() {
                    assert_eq!(branch["body"], json!({"kind":"nat","value":"1"}));
                }
            } else {
                assert_eq!(body["scrutinee"], declaration["body"]["scrutinee"]);
                assert_eq!(body["branches"][0], declaration["body"]["branches"][0]);
                assert_eq!(
                    body["branches"][1]["body"]["right"],
                    declaration["body"]["branches"][1]["body"]["right"]
                );
                let guard = &body["branches"][1]["body"]["left"];
                assert_eq!(
                    guard["scrutinee"],
                    declaration["body"]["branches"][1]["body"]["left"]
                );
                for branch in guard["branches"].as_array().unwrap() {
                    assert_eq!(branch["body"], json!({"kind":"bool","value":false}));
                }
            }
        }
    }

    #[test]
    fn administration_runtime_guard_rejects_nonbehavioral_failure_transcripts() {
        // Diagnostic-predicate tests only; owning ST-12 supplies real execution.
        let root =
            "LibraryProbe.Foundation.Organization.V1.Corpus.probeBundledMembershipBothQuorums";
        let message = format!(
            "native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"\\nthread 'main' panicked at src/main.rs:12:1:\\n{root}\\n\""
        );
        let rejected = prismpm::error::PrismError::new("PP5006", &message);
        assert!(is_runtime_rejection(&rejected, root));
        let actual_pid = message.replace("thread 'main'", "thread 'main' (519479)");
        assert!(is_runtime_rejection(
            &prismpm::error::PrismError::new("PP5006", &actual_pid),
            root
        ));
        for message in [
            message.replace("exited 101", "exited 0"),
            message.replace("native-library-std-acceptance", "native-library-std-lock"),
            message.replace("thread 'main' panicked", "compilation stopped"),
            message.replace(root, "LibraryProbe.otherRoot"),
            message.replace("stdout=\"\"", "stdout=\"not executed\""),
            format!("{message} error[E0308]: could not compile"),
            actual_pid.replace("(519479)", "()"),
            actual_pid.replace("(519479)", "(not-a-process)"),
            actual_pid.replace("thread 'main'", "thread 'other'"),
        ] {
            assert!(!is_runtime_rejection(
                &prismpm::error::PrismError::new("PP5006", message),
                root
            ));
        }
        assert!(!is_runtime_rejection(
            &prismpm::error::PrismError::new("PP5001", message),
            root
        ));
    }
}
