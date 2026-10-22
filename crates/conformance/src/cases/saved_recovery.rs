//! Finite generated-code acceptance for the internal saved-recovery lifecycle.

use prismpm::controller::VerifyRequest;
use prismpm::holo::canonical::{content_id, encode_value};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const SOURCE: &str = "Foundation/Sec/V1/SavedRecovery.lex.tex";
const CORPUS: &str = "Foundation/Sec/V1/SavedRecoveryCorpus.lex.tex";

const CASES: &[&str] = &[
    "acceptInitialIssuance",
    "acceptLastCounterIncrement",
    "acceptLastRetentionSlot",
    "acceptMaximumReferenceWidths",
    "acceptOtherCodeAtNewEpoch",
    "acceptRecoveryAtomic",
    "acceptReplacementAtMaxCredentialRevision",
    "acceptReplacementAtomic",
    "acceptSingleSlotIssuance",
    "rejectConsumedAfterFreshAdmission",
    "rejectConsumedCode",
    "rejectDisabledRecovery",
    "rejectDisabledReplacement",
    "rejectEmptyCode",
    "rejectEmptyCredential",
    "rejectFullRetentionBoundary",
    "rejectInventoryConsumed",
    "rejectInventoryDuplicateCommitment",
    "rejectInventoryDuplicateReference",
    "rejectInventoryEmpty",
    "rejectInventoryOldActiveCommitment",
    "rejectInventoryOldActiveReference",
    "rejectInventoryOldConsumedCommitment",
    "rejectInventoryOldConsumedReference",
    "rejectLongCredential",
    "rejectProofAccount",
    "rejectProofAuthorizationRef",
    "rejectProofCodeSubstitution",
    "rejectProofCredentialRef",
    "rejectProofRecoveryEpoch",
    "rejectProofRevision",
    "rejectProofScope",
    "rejectRecoveryCurrentAuthorizationMismatch",
    "rejectRecoveryCurrentCredentialMismatch",
    "rejectRecoveryReplay",
    "rejectRecoveryRetentionExhausted",
    "rejectRecoveryStaleEpoch",
    "rejectRecoveryStaleRevision",
    "rejectRecoveryWrongAccount",
    "rejectRecoveryWrongScope",
    "rejectRecoveryrecoveryEpochExhausted",
    "rejectRecoveryrevisionExhausted",
    "rejectReplacementCurrentAuthorizationMismatch",
    "rejectReplacementCurrentCredentialMismatch",
    "rejectReplacementEpochExhausted",
    "rejectReplacementEvidenceSubstitution",
    "rejectReplacementKeySubstitution",
    "rejectReplacementReplay",
    "rejectReplacementRetentionExhausted",
    "rejectReplacementStaleEpoch",
    "rejectReplacementStaleRevision",
    "rejectReplacementWrongAccount",
    "rejectReplacementWrongScope",
    "rejectReusedActiveCode",
    "rejectReusedActiveCommitment",
    "rejectReusedConsumedCode",
    "rejectReusedConsumedCommitment",
    "rejectReusedConsumedReplacement",
    "rejectReusedEmptyCommitment",
    "rejectReusedEmptyReference",
    "rejectStateDuplicateCode",
    "rejectStateDuplicateCommitment",
    "rejectStateEmptyAccount",
    "rejectStateEpochOverflow",
    "rejectStateOverfullInventory",
    "rejectStateOversizedCapacity",
    "rejectStateOversizedReference",
    "rejectStateRevisionOverflow",
    "rejectStateZeroCapacity",
    "rejectUnchangedCredential",
    "rejectUnknownCode",
    "rejectVerifierSubstitution",
];

fn expected_roots() -> Vec<String> {
    assert_eq!(CASES.len(), 72);
    assert!(CASES.windows(2).all(|pair| pair[0] < pair[1]));
    CASES
        .iter()
        .map(|name| format!("LibraryProbe.Foundation.Sec.V1.SavedRecoveryCorpus.{name}"))
        .collect()
}

fn fixture(root: &Path) -> tempfile::TempDir {
    let project = tempfile::Builder::new()
        .prefix("prismpm-saved-recovery-")
        .tempdir()
        .unwrap();
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .unwrap();
    for relative in [SOURCE, CORPUS] {
        let target = project.path().join("src").join(relative);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::copy(root.join("stdlib/src").join(relative), target)
            .expect("authoritative saved-recovery model and behavioral corpus");
    }
    std::fs::copy(
        root.join("tests/fixtures/library/saved-recovery/Probe.lex.tex"),
        project.path().join("src/Probe.lex.tex"),
    )
    .unwrap();
    project
}

fn acceptance(project: &Path, verified: &prismpm::controller::VerifyResult) {
    let roots = expected_roots();
    let output = project.join(&verified.verified_root);
    let manifest = super::json(&output.join("manifest.json"));
    let acceptance_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let evidence: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    assert_eq!(
        manifest["schema"],
        "prismpm/library-verification-manifest/2"
    );
    assert_eq!(manifest["scope"], "native-library-only");
    assert_eq!(manifest["build_id"], verified.build_id);
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    assert_eq!(
        verified.attestation_id,
        content_id(&std::fs::read(output.join("manifest.json")).unwrap())
    );
    assert_eq!(evidence["scope"], "native-library-only");
    assert_eq!(evidence["status"], "passed");
    assert_eq!(evidence["regeneration"], "byte-identical");
    assert_eq!(
        evidence["executions"],
        json!([
            {"mode":"std", "roots": roots, "status":"passed"},
            {"mode":"no_std", "roots": roots, "status":"passed"}
        ])
    );
    assert_eq!(
        evidence["unclaimed"],
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
        assert_eq!(processes.len(), 1, "exactly one actual execution per mode");
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
    assert_eq!(
        expected.len(),
        165,
        "all model, corpus, descriptor and fixture declarations"
    );
    let attestation = super::json(&output.join("lexlean-attestation.json"));
    assert_eq!(attestation["status"], "verified");
    let audits = attestation["declarations"].as_array().unwrap();
    assert_eq!(audits.len(), expected.len());
    let mut audited = BTreeSet::new();
    for audit in audits {
        let name = audit["name"].as_str().unwrap();
        assert!(audited.insert(name));
        let declaration = expected
            .get(name)
            .expect("audit names a selected source declaration");
        assert_eq!(audit["result"], "ok");
        assert_eq!(audit["policy"], declaration["axiom_policy"]);
        assert_eq!(audit["observed"], audit["policy"]["axioms"]);
        assert!([json!([]), json!(["propext"])].contains(&audit["observed"]));
        if declaration["kind"] == "theorem" {
            assert_eq!(audit["observed"], json!([]));
        }
    }
    assert_eq!(
        audited.into_iter().collect::<Vec<_>>(),
        expected.keys().map(String::as_str).collect::<Vec<_>>()
    );
    eprintln!(
        "ST-11: {} modeled roots passed std/no_std; {} exact declaration audits; build {}",
        roots.len(),
        expected.len(),
        verified.build_id
    );
}

fn mutate(project: &Path, mutant: &str) {
    fn visit(value: &mut Value, change: &mut impl FnMut(&mut Value) -> bool) -> usize {
        if change(value) {
            return 1;
        }
        match value {
            Value::Array(values) => values.iter_mut().map(|value| visit(value, change)).sum(),
            Value::Object(values) => values.values_mut().map(|value| visit(value, change)).sum(),
            _ => 0,
        }
    }
    let path = project.join("src").join(SOURCE);
    let source = std::fs::read_to_string(&path).unwrap();
    let line = source
        .lines()
        .find(|line| line.starts_with("\\semanticdata{"))
        .unwrap();
    let mut module: Value = serde_json::from_str(
        line.strip_prefix("\\semanticdata{")
            .unwrap()
            .strip_suffix('}')
            .unwrap(),
    )
    .unwrap();
    let name = match mutant {
        "key-substitution" => "savedRecoveryRequestsEqual",
        "non-consumption" => "consumeSavedCode",
        _ => "recoverSavedCredential",
    };
    let declaration = module["declarations"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|declaration| declaration["name"] == name)
        .unwrap();
    let changed = visit(&mut declaration["body"], &mut |value| match mutant {
        "disabled-identity"
            if value["kind"] == "match" && value["scrutinee"]["field"] == "enabled" =>
        {
            value["scrutinee"] = json!({"kind":"bool","value":true});
            true
        }
        "key-substitution"
            if value["kind"] == "call"
                && value["function"]["name"] == "recoveryBytesEqual"
                && value["arguments"][0]["field"] == "replacementCredentialRef" =>
        {
            *value = json!({"kind":"bool","value":true});
            true
        }
        "non-consumption"
            if value["field"] == "consumed"
                && value["value"] == json!({"kind":"bool","value":true}) =>
        {
            value["value"] = json!({"kind":"bool","value":false});
            true
        }
        "authorization-rewrite" | "epoch-replay"
            if value["kind"] == "record" && value["type"]["name"] == "CredentialBinding" =>
        {
            let field = if mutant == "authorization-rewrite" {
                "authorizationRef"
            } else {
                "recoveryEpoch"
            };
            let assignment = value["fields"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|row| row["field"] == field)
                .unwrap();
            assignment["value"] = if mutant == "authorization-rewrite" {
                json!({"kind":"bytes","hex":"ffff"})
            } else {
                assert_eq!(assignment["value"]["kind"], "add");
                assignment["value"]["left"].clone()
            };
            true
        }
        _ => false,
    });
    assert_eq!(
        changed, 1,
        "mutant {mutant} changes exactly one runtime decision"
    );
    let replacement = format!(
        "\\semanticdata{{{}}}",
        String::from_utf8(encode_value(&module).unwrap()).unwrap()
    );
    assert_eq!(source.matches(line).count(), 1);
    std::fs::write(path, source.replacen(line, &replacement, 1)).unwrap();
}

fn modeled_rejection(error: &prismpm::PrismError, case: &str) -> bool {
    let root = format!("LibraryProbe.Foundation.Sec.V1.SavedRecoveryCorpus.{case}");
    error.code == "PP5006"
        && error
            .message
            .starts_with("native-library-std-acceptance exited 101: stdout=\"\"; stderr=")
        && error.message.contains("thread 'main'")
        && error.message.contains("panicked at src/main.rs:")
        && error.message.contains(&format!("\\n{root}\\n"))
        && !error.message.contains("could not compile")
        && !error.message.contains("error[E")
}

pub(super) fn verify(root: &Path) {
    let project = fixture(root);
    let verified = prismpm::Controller::load(project.path())
        .unwrap()
        .verify(VerifyRequest { config_path: None })
        .expect("all modeled recovery cases pass the complete native-library pipeline");
    acceptance(project.path(), &verified);
    for (mutant, rejected_case) in [
        ("disabled-identity", "rejectDisabledRecovery"),
        ("key-substitution", "rejectReplacementKeySubstitution"),
        ("non-consumption", "acceptLastCounterIncrement"),
        ("authorization-rewrite", "acceptLastCounterIncrement"),
        ("epoch-replay", "acceptLastCounterIncrement"),
    ] {
        let project = fixture(root);
        mutate(project.path(), mutant);
        let error = prismpm::Controller::load(project.path())
            .unwrap()
            .verify(VerifyRequest { config_path: None })
            .unwrap_err();
        assert!(
            modeled_rejection(&error, rejected_case),
            "{mutant} must fail actual generated assertion {rejected_case}: {error}"
        );
        let verified = project.path().join(".prism/verified");
        assert!(
            !verified.exists() || std::fs::read_dir(verified).unwrap().next().is_none(),
            "mutant published verification"
        );
        eprintln!("ST-11: {mutant} rejected by generated assertion {rejected_case} with PP5006");
    }
    let restored = fixture(root);
    let restored_verified = prismpm::Controller::load(restored.path())
        .unwrap()
        .verify(VerifyRequest { config_path: None })
        .expect("pristine source still verifies after every behavioral mutant");
    acceptance(restored.path(), &restored_verified);
    assert_eq!(verified.build_id, restored_verified.build_id);
}

#[cfg(test)]
mod tests {
    use super::modeled_rejection;
    use prismpm::PrismError;

    #[test]
    fn runtime_rejection_requires_the_exact_executed_corpus_assertion() {
        // Diagnostic-parser unit data, never execution or acceptance evidence.
        let stderr = "\nthread 'main' (42) panicked at src/main.rs:7:1:\nLibraryProbe.Foundation.Sec.V1.SavedRecoveryCorpus.rejectDisabledRecovery\n";
        let message =
            format!("native-library-std-acceptance exited 101: stdout=\"\"; stderr={stderr:?}");
        assert!(modeled_rejection(
            &PrismError::new("PP5006", &message),
            "rejectDisabledRecovery"
        ));
        assert!(!modeled_rejection(
            &PrismError::new("PP5006", &message),
            "rejectReplacementKeySubstitution"
        ));
        assert!(!modeled_rejection(
            &PrismError::new("PP4102", &message),
            "rejectDisabledRecovery"
        ));
        for mutant in [
            message.replace("std-acceptance", "no_std-acceptance"),
            message.replace("exited 101", "exited 1"),
            message.replace("stdout=\"\"", "stdout=\"unaccepted output\""),
            message.replace("thread 'main'", "thread 'rustc'"),
            message.replace("panicked at src/main.rs:", "compiling src/main.rs:"),
            message.replace(
                "rejectDisabledRecovery\\n",
                "rejectDisabledRecoveryOther\\n",
            ),
            format!("{message}; error: could not compile generated package"),
            format!("{message}; error[E0308]: mismatched types"),
        ] {
            assert!(!modeled_rejection(
                &PrismError::new("PP5006", mutant),
                "rejectDisabledRecovery"
            ));
        }
    }
}
