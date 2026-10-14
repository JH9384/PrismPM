//! Execute the native-library contract without manufacturing an application.

use prismpm::controller::{BuildRequest, CheckRequest, ProductBuildRequest, VerifyRequest};
use prismpm::holo::canonical::{content_id, encode_value};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

const ACCEPTANCE: &str = "LibraryProbe.Probe.acceptance";
const IDENTITY: &str = "LibraryProbe.Probe.identity";

fn fixture(root: &Path) -> tempfile::TempDir {
    let project = tempfile::Builder::new()
        .prefix("prismpm-native-conformance-")
        .tempdir()
        .expect("native-library fixture directory");
    crate::fixtures::copy_dir_recursive(
        &root.join("tests/fixtures/library/native-library/project"),
        project.path(),
    )
    .expect("copy complete native-library fixture without generated state");
    project
}

fn tree(root: &Path) -> BTreeMap<String, Vec<u8>> {
    walkdir::WalkDir::new(root)
        .follow_links(false)
        .into_iter()
        .map(|entry| {
            let entry = entry.expect("walk native-library evidence");
            assert!(!entry.file_type().is_symlink(), "unexpected symlink");
            let relative = entry
                .path()
                .strip_prefix(root)
                .unwrap()
                .to_str()
                .unwrap()
                .to_owned();
            if entry.file_type().is_dir() {
                (format!("{relative}/"), Vec::new())
            } else {
                assert!(entry.file_type().is_file(), "unexpected special file");
                (relative, std::fs::read(entry.path()).unwrap())
            }
        })
        .collect()
}

fn no_verification(project: &Path) {
    let verified = project.join(".prism/verified");
    assert!(
        !verified.exists() || std::fs::read_dir(verified).unwrap().next().is_none(),
        "failed or unverified source published verification evidence"
    );
}

fn mutate(project: &Path, change: impl FnOnce(&mut Value)) -> String {
    let path = project.join("src/Probe.lex.tex");
    let source = std::fs::read_to_string(&path).unwrap();
    let lines = source.lines().collect::<Vec<_>>();
    let rows = lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.starts_with("\\semanticdata{"))
        .collect::<Vec<_>>();
    assert_eq!(rows.len(), 1, "fixture has exactly one semantic module");
    let (index, line) = rows[0];
    let bytes = line
        .strip_prefix("\\semanticdata{")
        .unwrap()
        .strip_suffix('}')
        .unwrap();
    let mut value: Value = serde_json::from_str(bytes).unwrap();
    change(&mut value);
    let replacement = String::from_utf8(encode_value(&value).unwrap()).unwrap();
    let mut output = lines
        .iter()
        .map(|line| (*line).to_owned())
        .collect::<Vec<_>>();
    output[index] = format!("\\semanticdata{{{replacement}}}");
    std::fs::write(path, format!("{}\n", output.join("\n"))).unwrap();
    source
}

fn declaration<'a>(module: &'a mut Value, name: &str) -> &'a mut Value {
    module["declarations"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|row| row["name"] == name)
        .expect("named modeled declaration")
}

fn roots<'a>(module: &'a mut Value, name: &str) -> &'a mut Value {
    &mut declaration(module, "probeLibrary")["body"]["fields"]
        .as_array_mut()
        .unwrap()
        .iter_mut()
        .find(|row| row["field"] == name)
        .expect("modeled root field")["value"]
}

fn accepted(project: &Path, verified: &prismpm::controller::VerifyResult) {
    let output = project.join(&verified.verified_root);
    let manifest = super::json(&output.join("manifest.json"));
    let acceptance_bytes = std::fs::read(output.join("library-acceptance.json")).unwrap();
    let acceptance: Value = serde_json::from_slice(&acceptance_bytes).unwrap();
    assert_eq!(
        manifest["schema"],
        "prismpm/library-verification-manifest/1"
    );
    assert_eq!(manifest["scope"], "native-library-only");
    assert_eq!(manifest["build_id"], verified.build_id);
    assert_eq!(manifest["acceptance_sha256"], content_id(&acceptance_bytes));
    assert_eq!(
        verified.attestation_id,
        content_id(&std::fs::read(output.join("manifest.json")).unwrap())
    );
    assert_eq!(acceptance["schema"], "prismpm/library-acceptance/1");
    assert_eq!(acceptance["scope"], "native-library-only");
    assert_eq!(acceptance["profile"], "prismpm/native-library/1");
    assert_eq!(acceptance["status"], "passed");
    assert_eq!(acceptance["regeneration"], "byte-identical");
    assert_eq!(acceptance["build_id"], verified.build_id);
    assert_eq!(acceptance["export_roots"], json!([ACCEPTANCE, IDENTITY]));
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
    assert_eq!(
        acceptance["executions"],
        json!([
            {"mode":"std", "roots":[ACCEPTANCE], "status":"passed"},
            {"mode":"no_std", "roots":[ACCEPTANCE], "status":"passed"}
        ])
    );
    let processes = manifest["processes"].as_array().unwrap();
    assert!(!processes.is_empty());
    assert!(processes.iter().all(|row| row["exit_code"] == 0));
    assert_eq!(
        processes
            .iter()
            .map(|row| row["tool"].as_str().unwrap())
            .collect::<Vec<_>>(),
        [
            "lean-version",
            "lake-version",
            "rustfmt-version",
            "rustc-version",
            "timeout-version",
            "lake-build-generated",
            "lean4-prod-build",
            "prod-export",
            "native-library-package",
            "native-library-std-lock",
            "native-library-std-acceptance",
            "native-library-no_std-lock",
            "native-library-no_std-acceptance",
        ],
        "all thirteen original actual commands remain mandatory"
    );
    for process in processes {
        assert_eq!(
            process
                .as_object()
                .unwrap()
                .keys()
                .map(String::as_str)
                .collect::<Vec<_>>(),
            [
                "argv",
                "executable_sha256",
                "exit_code",
                "stderr",
                "stdout",
                "tool"
            ],
            "original process record schema is not extended or narrowed"
        );
    }
    assert_eq!(processes[5]["argv"], json!(["build", "PrismGenerated"]));
    assert_eq!(processes[6]["argv"], json!(["build", "prod-export"]));
    assert_eq!(
        processes[8]["argv"],
        json!(["package", "--locked", "--offline", "--allow-dirty"])
    );
    for mode in ["std", "no_std"] {
        let tool = format!("native-library-{mode}-acceptance");
        let rows = processes
            .iter()
            .filter(|row| row["tool"] == tool)
            .collect::<Vec<_>>();
        assert_eq!(rows.len(), 1, "exactly one actual {mode} execution");
        let actual: Value = serde_json::from_str(rows[0]["stdout"].as_str().unwrap()).unwrap();
        assert_eq!(actual, json!({"roots":[ACCEPTANCE], "status":"passed"}));
    }
    let names = tree(&output).into_keys().collect::<BTreeSet<_>>();
    assert_eq!(
        names,
        BTreeSet::from([
            "/".to_owned(),
            "library-acceptance.json".to_owned(),
            "lexlean-attestation.json".to_owned(),
            "manifest.json".to_owned(),
        ])
    );
}

pub(super) fn verify(root: &Path) {
    let first = fixture(root);
    let controller = prismpm::Controller::load(first.path()).unwrap();
    let before = tree(first.path());
    let checked = controller
        .check(CheckRequest { config_path: None })
        .unwrap();
    assert_eq!(tree(first.path()), before, "check must remain read-only");
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .unwrap();
    accepted(first.path(), &verified);
    let build = first.path().join(".prism/build").join(&verified.build_id);
    let document = super::json(&build.join("model.prism.json"));
    assert_eq!(document["schema"], "prismpm/model-document/3");
    assert!(document.get("application").is_none());
    assert_eq!(document["library"]["profile"], "prismpm/native-library/1");
    assert_eq!(
        checked.model_id,
        content_id(&std::fs::read(build.join("model.prism.json")).unwrap())
    );
    let built = tree(&build);
    assert!(built
        .keys()
        .any(|path| path.starts_with("library/package/")));
    assert!(built
        .keys()
        .all(|path| !path.ends_with(".holo") && !path.starts_with("application/")));

    let second = fixture(root);
    assert_ne!(first.path(), second.path());
    let second_build = prismpm::Controller::load(second.path())
        .unwrap()
        .build(BuildRequest { config_path: None })
        .unwrap();
    assert_eq!(verified.build_id, second_build.build_id);
    assert_eq!(
        built,
        tree(
            &second
                .path()
                .join(".prism/build")
                .join(&second_build.build_id)
        ),
        "all native-library build bytes reproduce in another root"
    );
    no_verification(second.path());

    let product_before = tree(first.path());
    let error = controller
        .product_build(ProductBuildRequest {
            config_path: None,
            reference: "ghcr.io/uor-foundation/prismpm-library-probe:0.1.0".to_owned(),
            locked: true,
            release: None,
        })
        .unwrap_err();
    assert_eq!(error.code.as_str(), "PP6101");
    assert_eq!(
        error.message,
        "native-library acceptance is not product-release or deployment acceptance"
    );
    assert_eq!(
        tree(first.path()),
        product_before,
        "library cannot publish a product release"
    );

    // Retain only genuinely produced evidence, without a source checkout.
    let retained = tempfile::tempdir().unwrap();
    crate::fixtures::copy_dir_recursive(
        &build,
        &retained
            .path()
            .join(".prism/build")
            .join(&verified.build_id),
    )
    .unwrap();
    crate::fixtures::copy_dir_recursive(
        &first.path().join(&verified.verified_root),
        &retained.path().join(&verified.verified_root),
    )
    .unwrap();
    assert!(!retained.path().join("src").exists());
    assert!(!retained.path().join("lexlean.toml").exists());
    let retained_before = tree(retained.path());
    // Identical builds have interchangeable relative receipts. This public
    // entry captures the genuine artifact maps and replays the source-free
    // validator, independently of the Controller's earlier profile guard.
    let error = prismpm::oci::assemble(
        retained.path(),
        &second_build,
        &verified,
        "ghcr.io/uor-foundation/prismpm-library-probe:0.1.0",
        &[],
    )
    .unwrap_err();
    assert_eq!(error.code.as_str(), "PP6101");
    assert_eq!(
        error.message, "native-library evidence cannot authorize a product release",
        "must reach the native-library guard, not reject malformed evidence"
    );
    assert_eq!(
        tree(retained.path()),
        retained_before,
        "source-free rejection must leave no OCI publication or staging files"
    );

    for mutation in 0..4 {
        let invalid = fixture(root);
        let descriptor = std::fs::read_to_string(
            invalid
                .path()
                .join("src/Foundation/Library/V1/Model.lex.tex"),
        )
        .unwrap();
        let descriptor: Value = serde_json::from_str(
            descriptor
                .lines()
                .find_map(|line| line.strip_prefix("\\semanticdata{"))
                .unwrap()
                .strip_suffix('}')
                .unwrap(),
        )
        .unwrap();
        mutate(invalid.path(), |module| match mutation {
            0 => {
                roots(module, "exportRoots")["tail"]["head"]["value"] =
                    json!("LibraryProbe.Probe.missing")
            }
            1 => roots(module, "acceptanceRoots")["head"]["value"] = json!(IDENTITY),
            2 => {
                declaration(module, "acceptance")["parameters"] =
                    json!([{"name":"unused","type":{"kind":"nat"}}])
            }
            _ => {
                // Equal fields and profile text do not establish nominal identity.
                module["declarations"]
                    .as_array_mut()
                    .unwrap()
                    .insert(0, descriptor["declarations"][0].clone());
                let library = declaration(module, "probeLibrary");
                library["result"]["member"]
                    .as_object_mut()
                    .unwrap()
                    .remove("module");
                library["body"]["type"]
                    .as_object_mut()
                    .unwrap()
                    .remove("module");
            }
        });
        let before = tree(invalid.path());
        let error = prismpm::Controller::load(invalid.path())
            .unwrap()
            .check(CheckRequest { config_path: None })
            .unwrap_err();
        assert_eq!(
            error.code.as_str(),
            "PP2001",
            "invalid typed root {mutation}"
        );
        let expected = match mutation {
            0 => "native-library export LibraryProbe.Probe.missing is not defined",
            1 => "native-library acceptance root LibraryProbe.Probe.identity must have type Bool with no parameters",
            2 => "native-library acceptance root LibraryProbe.Probe.acceptance must have type Bool with no parameters",
            _ => "facet closure is not exact",
        };
        assert_eq!(error.message, expected, "{error:#?}");
        assert_eq!(tree(invalid.path()), before);
        no_verification(invalid.path());
    }

    let mutant = fixture(root);
    let original = mutate(mutant.path(), |module| {
        declaration(module, "identity")["body"] = json!({
            "kind":"add", "left":{"kind":"var","name":"value"},
            "right":{"kind":"nat","value":"1"}
        });
    });
    let controller = prismpm::Controller::load(mutant.path()).unwrap();
    let changed = controller
        .check(CheckRequest { config_path: None })
        .unwrap();
    assert_ne!(changed.semantic_id, checked.semantic_id);
    let error = controller
        .verify(VerifyRequest { config_path: None })
        .unwrap_err();
    assert_eq!(
        error.code.as_str(),
        "PP5006",
        "the generated oracle must reject identity(42) = 43: {error:#?}"
    );
    no_verification(mutant.path());
    std::fs::write(mutant.path().join("src/Probe.lex.tex"), original).unwrap();
    let restored = controller
        .verify(VerifyRequest { config_path: None })
        .unwrap();
    assert_eq!(restored.build_id, verified.build_id);
    accepted(mutant.path(), &restored);
}
