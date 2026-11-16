//! Internal mailbox-admission semantics must execute from their actual model.

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
        "mailboxCurrentControl" => {
            let mut body = body.clone();
            assert_eq!(body["kind"], "match");
            assert_eq!(body["scrutinee"], json!({"kind":"var","name":"proofClass"}));
            let branches = body["branches"].as_array_mut().unwrap();
            assert_eq!(branches.len(), 2);
            assert_eq!(
                branches[0]["constructor"]["name"],
                "MailboxProofClass.HistoricalVerifiedAddress"
            );
            assert_eq!(branches[0]["body"], json!({"kind":"bool","value":false}));
            branches[0]["body"] = json!({"kind":"bool","value":true});
            body
        }
        "mailboxGateWrongCandidate" => json!({
            "kind":"match", "scrutinee":body,
            "branches":[
                {"constructor":{"name":"Bool.false"},"binders":[],"body":{"kind":"bool","value":true}},
                {"constructor":{"name":"Bool.true"},"binders":[],"body":{"kind":"bool","value":true}}
            ]
        }),
        _ => panic!("unregistered mailbox admission mutant {name}"),
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
    assert_eq!(expected.len(), 233, "complete selected declaration set");
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
        "ST-13: {} modeled roots passed std/no_std; {} exact declaration audits; build {}; attestation {}",
        roots.len(),
        expected.len(),
        verified.build_id,
        verified.attestation_id
    );
}

pub(super) fn verify(root: &Path) {
    for name in ["MailboxAdmission", "MailboxAdmissionCorpus"] {
        assert!(
            root.join(format!("stdlib/src/Foundation/Sec/V1/{name}.lex.tex"))
                .is_file(),
            "ST-13 requires the actual modeled mailbox-admission reducer and corpus"
        );
    }
    let source_root = root.join("stdlib/src/Foundation/Sec/V1");
    let index: CorpusIndex = serde_json::from_slice(
        &std::fs::read(source_root.join("mailbox-admission-corpus.json")).unwrap(),
    )
    .unwrap();
    assert_eq!(index.schema, "prismpm/internal-mailbox-admission-corpus/1");
    assert_eq!(
        index.errors,
        [
            "BadState",
            "DisabledAccount",
            "ConsumedChallenge",
            "BadPolicy",
            "RetiredAuthority",
            "BadProof",
            "HistoricalProof",
            "WrongAuthority",
            "WrongAudience",
            "OperationDenied",
            "WrongOperation",
            "WrongAccount",
            "StaleRevision",
            "StaleEpoch",
            "WrongCredential",
            "WrongAuthorization",
            "WrongMailbox",
            "WrongCandidate",
            "WrongChallenge",
            "WrongNonce",
            "WrongIntentTime",
            "InvalidTime",
            "FutureProof",
            "ProofBeforeChallenge",
            "ExpiredProof",
            "ExpiredChallenge",
            "StaleProof",
            "AlreadyBound",
            "UnboundAccount",
            "WrongSubject",
            "NoChange",
            "RevisionExhausted",
            "EpochExhausted"
        ]
    );
    let acceptance = index.roots;
    assert_eq!(
        acceptance.len(),
        93,
        "complete registered mailbox admission corpus"
    );
    assert!(acceptance.windows(2).all(|pair| pair[0] < pair[1]));
    let corpus = semantic(
        &std::fs::read_to_string(source_root.join("MailboxAdmissionCorpus.lex.tex")).unwrap(),
    );
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
                format!("LibraryProbe.Foundation.Sec.V1.MailboxAdmissionCorpus.{name}")
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
        .prefix("prismpm-mailbox-admission-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    let target = project.path().join("src/Foundation/Sec/V1");
    std::fs::create_dir_all(&target).unwrap();
    for name in ["MailboxAdmission.lex.tex", "MailboxAdmissionCorpus.lex.tex"] {
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
    exports
        .push("LibraryProbe.Foundation.Sec.V1.MailboxAdmission.admitMailboxAssertion".to_owned());
    exports.sort();
    for field in probe["declarations"][0]["body"]["fields"]
        .as_array_mut()
        .unwrap()
    {
        match field["field"].as_str().unwrap() {
            "exportRoots" => field["value"] = strings(&exports),
            "acceptanceRoots" => field["value"] = strings(&acceptance),
            "name" => field["value"]["value"] = json!("Internal mailbox admission"),
            "cargoName" => field["value"]["value"] = json!("prism-mailbox-admission-conformance"),
            _ => {}
        }
    }
    let probe_source = probe_source.replace(
        "\\importmodule{Foundation.Library.V1.Model}\n",
        "\\importmodule{Foundation.Library.V1.Model}\n\\importmodule{Foundation.Sec.V1.MailboxAdmissionCorpus}\n",
    );
    std::fs::write(probe_path, rewrite(&probe_source, &probe)).unwrap();

    let controller = prismpm::Controller::load(project.path()).unwrap();
    controller
        .check(CheckRequest { config_path: None })
        .expect("actual authored mailbox admission model checks");
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .expect("complete modeled mailbox admission corpus passes native acceptance");
    accepted(project.path(), &verified, &acceptance, &exports);

    let model_path = target.join("MailboxAdmission.lex.tex");
    let model_source = std::fs::read_to_string(&model_path).unwrap();
    let before = verified_names(project.path());
    for (name, rejected_root) in [
        ("mailboxCurrentControl", "LibraryProbe.Foundation.Sec.V1.MailboxAdmissionCorpus.probeHistoricalPolicy"),
        ("mailboxGateWrongCandidate", "LibraryProbe.Foundation.Sec.V1.MailboxAdmissionCorpus.probeProofCandidateCredentialRef"),
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
            .expect_err("weakening actual mailbox admission must fail native acceptance");
        assert_eq!(error.code, "PP5006", "{name}: {error:?}");
        assert!(
            is_runtime_rejection(&error, rejected_root),
            "{name}: exact generated runtime root must reject, not compilation: {error:?}"
        );
        eprintln!("ST-13: {name} rejected by generated execution at {rejected_root} (exit 101)");
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

    #[test]
    fn mailbox_mutants_preserve_inputs_and_change_only_intended_outcomes() {
        let source = std::fs::read_to_string(
            repo_model::repo_root().join("stdlib/src/Foundation/Sec/V1/MailboxAdmission.lex.tex"),
        )
        .unwrap();
        let module = semantic(&source);
        for name in ["mailboxCurrentControl", "mailboxGateWrongCandidate"] {
            let declaration = module["declarations"]
                .as_array()
                .unwrap()
                .iter()
                .find(|row| row["name"] == name)
                .unwrap();
            let changed = weakened_body(name, &declaration["body"]);
            assert_ne!(changed, declaration["body"]);
            if name == "mailboxCurrentControl" {
                assert_eq!(changed["scrutinee"], declaration["body"]["scrutinee"]);
                assert_eq!(changed["branches"][1], declaration["body"]["branches"][1]);
                assert_eq!(
                    changed["branches"][0]["body"],
                    json!({"kind":"bool","value":true})
                );
            } else {
                assert_eq!(changed["scrutinee"], declaration["body"]);
                for branch in changed["branches"].as_array().unwrap() {
                    assert_eq!(branch["body"], json!({"kind":"bool","value":true}));
                }
            }
        }
    }

    #[test]
    fn mailbox_runtime_guard_requires_actual_root_execution() {
        // Predicate fixtures only. ST-13 separately supplies genuine executions.
        let root = "LibraryProbe.Foundation.Sec.V1.MailboxAdmissionCorpus.probeHistoricalPolicy";
        let stderr = format!("\\nthread 'main' (42) panicked at src/main.rs:7:1:\\n{root}\\n");
        let message =
            format!("native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"{stderr}\"");
        assert!(is_runtime_rejection(
            &prismpm::error::PrismError::new("PP5006", &message),
            root
        ));
        for changed in [
            message.replace("exited 101", "exited 0"),
            message.replace("native-library-std-acceptance", "native-library-std-lock"),
            message.replace(root, "LibraryProbe.other"),
            message.replace("(42)", "(not-a-process)"),
            message.replace("thread 'main'", "thread 'other'"),
            format!("{message} error[E0308]: could not compile"),
        ] {
            assert!(!is_runtime_rejection(
                &prismpm::error::PrismError::new("PP5006", changed),
                root
            ));
        }
    }

    #[test]
    fn mailbox_corpus_declares_every_error_and_exact_acceptance_roots() {
        let directory = repo_model::repo_root().join("stdlib/src/Foundation/Sec/V1");
        let index: CorpusIndex = serde_json::from_slice(
            &std::fs::read(directory.join("mailbox-admission-corpus.json")).unwrap(),
        )
        .unwrap();
        let source = semantic(
            &std::fs::read_to_string(directory.join("MailboxAdmissionCorpus.lex.tex")).unwrap(),
        );
        let roots = source["declarations"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|row| row["name"].as_str().unwrap().starts_with("probe"))
            .collect::<Vec<_>>();
        assert_eq!(roots.len(), 93);
        assert_eq!(index.roots.len(), 93);
        let covered = roots
            .iter()
            .filter_map(|row| {
                let body = &row["body"];
                (body["function"]["name"] == "mailboxCorpusRejects").then(|| {
                    body["arguments"].as_array().unwrap().last().unwrap()["constructor"]["name"]
                        .as_str()
                        .unwrap()
                        .strip_prefix("MailboxAdmissionError.")
                        .unwrap()
                        .to_owned()
                })
            })
            .collect::<BTreeSet<_>>();
        assert_eq!(covered, index.errors.into_iter().collect());
    }
}
