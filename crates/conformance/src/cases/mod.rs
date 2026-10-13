//! Conformance test cases verifying every registered capability.

#[path = "../../../../tests/support/browser_application.rs"]
mod browser_application;
mod browser_bootstrap;
mod browser_compiler;
mod browser_effect;
mod browser_publication;
mod browser_system;
mod cbor_primitive;
mod holo_browser;
mod mailbox_admission;
mod native_library;
mod node_suite;
mod organization_lifecycle;
mod owner_timing;
mod saved_recovery;
mod scoped_administration;

use node_suite::verify as verify_node_suite;
use repo_model::repo_root;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::OnceLock;

mod scheduling;

static CHECK: OnceLock<Result<prismpm::controller::CheckResult, prismpm::PrismError>> =
    OnceLock::new();
static BUILD: OnceLock<Result<prismpm::controller::BuildResult, prismpm::PrismError>> =
    OnceLock::new();
static VERIFY: OnceLock<Result<prismpm::controller::VerifyResult, prismpm::PrismError>> =
    OnceLock::new();
static UPSTREAM: OnceLock<
    Result<prismpm::upstream_conformance::UpstreamConformanceEvidence, prismpm::PrismError>,
> = OnceLock::new();

fn required<'a, T>(result: &'a Result<T, prismpm::PrismError>, context: &str) -> &'a T {
    result.as_ref().unwrap_or_else(|error| {
        panic!(
            "{context} failed: {}",
            serde_json::to_string(error).expect("structured Prism diagnostic serializes")
        )
    })
}

fn upstream(root: &Path) -> &'static prismpm::upstream_conformance::UpstreamConformanceEvidence {
    required(
        UPSTREAM.get_or_init(|| prismpm::upstream_conformance::verify(root)),
        "authoritative upstream conformance",
    )
}

fn checked(root: &Path) -> &'static prismpm::controller::CheckResult {
    required(
        CHECK.get_or_init(|| {
            prismpm::Controller::load(root).and_then(|controller| {
                controller.check(prismpm::controller::CheckRequest { config_path: None })
            })
        }),
        "shared Prism check",
    )
}

fn built(root: &Path) -> &'static prismpm::controller::BuildResult {
    required(
        BUILD.get_or_init(|| {
            prismpm::Controller::load(root).and_then(|controller| {
                controller.build(prismpm::controller::BuildRequest { config_path: None })
            })
        }),
        "shared Prism build",
    )
}

fn verified(root: &Path) -> &'static prismpm::controller::VerifyResult {
    required(
        scheduling::compiler_once(&VERIFY, || {
            prismpm::Controller::load(root).and_then(|controller| {
                controller.verify(prismpm::controller::VerifyRequest { config_path: None })
            })
        }),
        "shared Prism verification",
    )
}

fn build_root(root: &Path) -> PathBuf {
    root.join(".prism/build").join(&built(root).build_id)
}

fn verified_root(root: &Path) -> PathBuf {
    root.join(&verified(root).verified_root)
}

fn json(path: &Path) -> Value {
    serde_json::from_slice(
        &std::fs::read(path).unwrap_or_else(|error| panic!("{}: {error}", path.display())),
    )
    .unwrap_or_else(|error| panic!("{}: {error}", path.display()))
}

fn build_manifest(root: &Path) -> Value {
    json(&build_root(root).join("manifest.json"))
}

fn verification_manifest(root: &Path) -> Value {
    json(&verified_root(root).join("manifest.json"))
}

fn model_bytes(root: &Path) -> Vec<u8> {
    std::fs::read(build_root(root).join("model.prism.json")).expect("published model.prism.json")
}

fn model(root: &Path) -> Value {
    serde_json::from_slice(&model_bytes(root)).expect("canonical model-document JSON")
}

fn sample_application_holo(root: &Path) -> prismpm::holo::archive::GeneratedHolo {
    let model_document = model_bytes(root);
    let digest = "0".repeat(64);
    let commit = "0".repeat(40);
    prismpm::holo::archive::compose_application(&prismpm::holo::archive::ApplicationArchiveInput {
        application_name: "Conformance".to_owned(),
        guest_wasm: b"\0asm\x01\0\0\0".to_vec(),
        view_bundle: b"HOLOVIEW\0\x01".to_vec(),
        model_document,
        source_manifest: br#"{"version":4}"#.to_vec(),
        provenance: prismpm::holo::archive::ArchiveProvenance {
            source_id: digest.clone(),
            semantic_id: digest.clone(),
            compiler_semantics_id: digest.clone(),
            snapshot_id: digest.clone(),
            stdlib_semantics_id: digest.clone(),
            prism_stdlib_crate_sha256: digest.clone(),
            lexlean_commit: commit.clone(),
            lexlean_package_sha256: digest.clone(),
            lean4_prod_commit: commit.clone(),
            hologram_live_commit: commit.clone(),
            uor_hologram_commit: commit,
            target_profile_id: digest.clone(),
            lean_manifest_sha256: digest.clone(),
            lcnf_manifest_sha256: digest.clone(),
            generated_core_sha256: digest.clone(),
            cargo_name: "conformance".to_owned(),
            cargo_version: "0.1.0".to_owned(),
            cargo_crate_sha256: digest.clone(),
            view_model_id: digest.clone(),
            browser_projection_sha256: digest,
        },
    })
    .expect("sample Holo/1 application composes")
}

fn snapshot(root: &Path) -> Value {
    json(&build_root(root).join("lexlean/snapshot.json"))
}

fn assert_prism_theorems_axiom_free(root: &Path) {
    let snapshot = snapshot(root);
    let theorem_names = snapshot["modules"]
        .as_array()
        .expect("snapshot modules")
        .iter()
        .flat_map(|module| {
            let lean_module = module["lean_module"]
                .as_str()
                .expect("snapshot Lean module");
            module["declarations"]
                .as_array()
                .expect("snapshot declarations")
                .iter()
                .filter(|declaration| declaration["kind"].as_str() == Some("theorem"))
                .map(move |declaration| {
                    format!(
                        "{lean_module}.{}",
                        declaration["lean_name"]
                            .as_str()
                            .expect("snapshot theorem name")
                    )
                })
        })
        .collect::<BTreeSet<_>>();
    assert!(
        !theorem_names.is_empty(),
        "snapshot contains no Prism theorems"
    );

    let attestation = json(&verified_root(root).join("lexlean-attestation.json"));
    let audits = attestation["declarations"]
        .as_array()
        .expect("attested declarations");
    for theorem in theorem_names {
        let audit = audits
            .iter()
            .find(|row| row["name"].as_str() == Some(theorem.as_str()))
            .unwrap_or_else(|| panic!("missing theorem audit for {theorem}"));
        assert_eq!(audit["result"], "ok", "failed theorem audit for {theorem}");
        assert_eq!(
            audit["policy"]["kind"], "none",
            "nonempty theorem policy for {theorem}"
        );
        assert!(
            audit["observed"].as_array().is_some_and(Vec::is_empty),
            "nonempty observed theorem axioms for {theorem}"
        );
    }
}

fn semantic_names(root: &Path, module: &str) -> BTreeSet<String> {
    snapshot(root)["modules"]
        .as_array()
        .expect("snapshot modules")
        .iter()
        .find(|row| row["name"].as_str() == Some(module))
        .unwrap_or_else(|| panic!("snapshot module {module}"))["semantic"]["declarations"]
        .as_array()
        .expect("semantic declarations")
        .iter()
        .map(|row| row["name"].as_str().expect("declaration name").to_owned())
        .collect()
}

fn assert_declarations(root: &Path, module: &str, expected: &[&str]) {
    let names = semantic_names(root, module);
    for name in expected {
        assert!(names.contains(*name), "{module} is missing {name}");
    }
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn assert_hex_digest(value: &str) {
    assert_eq!(value.len(), 64, "digest length: {value}");
    assert!(
        value.bytes().all(|byte| byte.is_ascii_hexdigit()),
        "digest spelling: {value}"
    );
}

fn read(root: &Path, relative: &str) -> String {
    std::fs::read_to_string(root.join(relative))
        .unwrap_or_else(|error| panic!("{relative}: {error}"))
}

fn assert_contains(root: &Path, relative: &str, needles: &[&str]) {
    let source = read(root, relative);
    for needle in needles {
        assert!(source.contains(needle), "{relative} is missing {needle}");
    }
}

fn assert_indexed(array: &Value) {
    let rows = array.as_array().expect("model-document collection");
    let ids: Vec<_> = rows
        .iter()
        .map(|row| row["id"].as_str().expect("qualified entity ID"))
        .collect();
    assert!(
        ids.windows(2).all(|pair| pair[0] < pair[1]),
        "IDs are not strictly sorted"
    );
    for (expected, row) in rows.iter().enumerate() {
        assert_eq!(row["index"].as_u64(), Some(expected as u64));
        assert!(row["id"].as_str().unwrap().contains("::"));
    }
}

fn artifact<'a>(manifest: &'a Value, name: &str) -> &'a Value {
    manifest["artifacts"]
        .get(name)
        .unwrap_or_else(|| panic!("verification manifest is missing {name}"))
}

fn assert_artifact(root: &Path, name: &str, filename: &str) {
    let manifest = verification_manifest(root);
    let bytes = std::fs::read(verified_root(root).join(filename)).expect("published artifact");
    let row = artifact(&manifest, name);
    assert_eq!(row["byte_length"].as_u64(), Some(bytes.len() as u64));
    assert_eq!(row["sha256"].as_str(), Some(sha256(&bytes).as_str()));
}

fn process_tools(root: &Path) -> BTreeSet<String> {
    verification_manifest(root)["processes"]
        .as_array()
        .expect("process records")
        .iter()
        .map(|row| row["tool"].as_str().expect("process tool").to_owned())
        .collect()
}

fn copy_project(root: &Path, destination: &Path) {
    for relative in ["language", "stdlib"] {
        for entry in walkdir::WalkDir::new(root.join(relative)) {
            let entry = entry.unwrap();
            let suffix = entry.path().strip_prefix(root).unwrap();
            let target = destination.join(suffix);
            if entry.file_type().is_dir() {
                std::fs::create_dir_all(target).unwrap();
            } else if entry.file_type().is_file() {
                std::fs::copy(entry.path(), target).unwrap();
            }
        }
    }
    for relative in [
        "lake-manifest.json",
        "lakefile.toml",
        "lean-toolchain",
        "lexlean.lock",
        "lexlean.toml",
        "prismpm.toml",
    ] {
        std::fs::copy(root.join(relative), destination.join(relative)).unwrap();
    }
}

fn tree(root: &Path) -> Vec<(String, Vec<u8>)> {
    let mut files = walkdir::WalkDir::new(root)
        .into_iter()
        .map(Result::unwrap)
        .filter(|entry| entry.file_type().is_file())
        .map(|entry| {
            (
                entry
                    .path()
                    .strip_prefix(root)
                    .unwrap()
                    .to_string_lossy()
                    .replace('\\', "/"),
                std::fs::read(entry.path()).unwrap(),
            )
        })
        .collect::<Vec<_>>();
    files.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes()));
    files
}

/// Execute a conformance case by ID.
pub fn run(id: &str) {
    let root = repo_root();
    run_at(&root, id);
}

/// Execute a conformance case by ID against an explicit PrismPM source root.
pub fn run_at(root: &Path, id: &str) {
    let model = repo_model::Model::load(&root.join("model")).expect("model loads");
    let row = model
        .ids
        .get(id)
        .unwrap_or_else(|| panic!("ID {id} must exist in model/ids.toml"));
    assert_eq!(
        row.level,
        repo_model::Level::Build,
        "{id} must be level build"
    );

    let queued = std::time::Instant::now();
    let _compiler_slot = scheduling::for_owner(id);
    let _owner_timing = owner_timing::OwnerTiming::after_admission(id, queued.elapsed());
    match id {
        "RP-01" => verify_rp_01(root),
        "RP-02" => verify_rp_02(root),
        "RP-03" => verify_rp_03(root),
        "RP-04" => verify_rp_04(root),
        "RP-05" => verify_rp_05(root),
        "RP-06" => verify_rp_06(root),
        "RP-07" => verify_rp_07(root),
        "RP-08" => verify_rp_08(root),
        "RP-09" => verify_rp_09(root),
        "RP-10" => verify_rp_10(root),
        "RP-11" => verify_rp_11(root),
        "RP-12" => verify_rp_12(root),

        "FT-01" | "FT-02" | "FT-03" | "FT-04" | "FT-05" | "FT-06" | "FT-07" | "FT-08" | "FT-09"
        | "FT-10" => {
            verify_facets(root, id);
        }

        "HO-01" | "HO-02" | "HO-03" | "HO-04" | "HO-05" | "HO-06" | "HO-07" | "HO-08" | "HO-09"
        | "HO-10" | "HO-11" | "HO-12" => {
            verify_holo(root, id);
        }
        "HO-13" => holo_browser::verify(root),

        "CT-01" | "CT-02" | "CT-03" | "CT-04" | "CT-05" | "CT-06" | "CT-07" | "CT-08" | "CT-09"
        | "CT-10" | "CT-11" => {
            verify_controller(root, id);
        }

        "ST-01" | "ST-02" | "ST-03" | "ST-04" | "ST-05" | "ST-06" | "ST-07" | "ST-08" | "ST-09"
        | "ST-10" => {
            verify_stdlib(root, id);
        }
        "ST-11" => saved_recovery::verify(root),
        "ST-12" => scoped_administration::verify(root),
        "ST-13" => mailbox_admission::verify(root),
        "ST-14" => browser_bootstrap::verify(root),
        "ST-15" => organization_lifecycle::verify(root),
        "ST-16" => cbor_primitive::verify(root),

        "AR-01" | "AR-02" | "AR-03" | "AR-04" | "AR-05" | "AR-06" | "AR-07" | "AR-08" | "AR-09"
        | "AR-10" => {
            verify_artifacts(root, id);
        }

        "EX-01" | "EX-02" | "EX-03" | "EX-04" | "EX-05" | "EX-06" | "EX-07" | "EX-08" | "EX-09"
        | "EX-10" => {
            verify_execution(root, id);
        }

        "VR-01" | "VR-02" | "VR-03" | "VR-04" | "VR-05" | "VR-06" | "VR-07" | "VR-08" | "VR-09"
        | "VR-10" | "VR-11" | "VR-12" => {
            verify_verification(root, id);
        }

        "SE-01" | "SE-02" | "SE-03" | "SE-04" | "SE-05" | "SE-06" | "SE-07" | "SE-08" => {
            verify_security(root, id);
        }

        "AU-01" | "AU-02" | "AU-03" | "AU-04" | "AU-05" | "AU-06" => verify_authorities(root, id),
        "SY-08" => browser_system::verify(root),
        "SY-01" | "SY-02" | "SY-03" | "SY-04" | "SY-05" | "SY-06" | "SY-07" => {
            verify_system(root, id)
        }
        "DK-01" | "DK-02" | "DK-03" | "DK-04" | "DK-05" | "DK-06" => verify_sdk(id),
        "DK-07" | "DK-08" | "DK-09" | "DK-10" | "DK-11" | "DK-12" | "DK-13" | "DK-14" | "DK-15"
        | "DK-16" | "DK-19" | "DK-20" | "DK-23" | "DK-24" | "DK-25" => {
            verify_browser_host(root, id)
        }
        "DK-17" => native_library::verify(root),
        "DK-21" => browser_application::verify(root),
        "DK-22" => browser_compiler::verify(root),
        "DK-27" => verify_node_suite(
            root,
            id,
            &["sdk/browser/budget-model-test.mjs"],
            13,
            "3600000",
        ),
        "DK-18" => browser_effect::verify(root),
        "DK-28" => verify_node_suite(
            root,
            id,
            &[
                "sdk/platform-lock.test.mjs",
                "sdk/metadata-layer.test.mjs",
                "sdk/metadata-capture.test.mjs",
                "sdk/metadata-transport.test.mjs",
                "sdk/metadata-transport-tls.test.mjs",
                "sdk/metadata-credentials.test.mjs",
                "sdk/metadata-helper.test.mjs",
                "sdk/metadata-cli.test.mjs",
                "sdk/metadata-publisher.test.mjs",
            ],
            54,
            "120000",
        ),
        "OC-07" => verify_browser_export(root),
        "OC-08" => browser_publication::verify(root),
        "OC-09" => verify_node_suite(
            root,
            id,
            &["tests/publication-admission/owner.test.mjs"],
            12,
            "3600000",
        ),
        "OC-01" | "OC-02" | "OC-03" | "OC-04" | "OC-05" | "OC-06" => verify_oci(id),
        "LC-01" | "LC-02" | "LC-03" | "LC-04" | "LC-05" | "LC-06" => verify_lifecycle(root, id),
        "DP-01" | "DP-02" | "DP-03" | "DP-04" | "DP-05" | "DP-06" => verify_deployment(id),
        "OP-01" | "OP-02" | "OP-03" | "OP-04" | "OP-05" | "OP-06" => verify_operations(id),
        "SC-01" | "SC-02" | "SC-03" | "SC-04" | "SC-05" | "SC-06" => verify_supply_chain(id),
        "TM-01" | "TM-02" | "TM-03" | "TM-04" | "TM-05" | "TM-06" => verify_template(root, id),

        _ => panic!("unhandled conformance id: {id}"),
    }
}

fn verify_browser_host(root: &Path, id: &str) {
    let (files, minimum_tests): (&[&str], usize) = match id {
        "DK-07" => (
            &[
                "sdk/browser/identity.test.mjs",
                "sdk/browser/identity.browser.test.mjs",
            ],
            15,
        ),
        "DK-08" => (
            &[
                "sdk/browser/store.test.mjs",
                "sdk/browser/boundary.test.mjs",
            ],
            14,
        ),
        "DK-09" => (&["sdk/browser/peer.test.mjs"], 24),
        "DK-10" => (&["sdk/browser/workspace-model-test.mjs"], 6),
        "DK-11" => (&["sdk/browser/envelope-model-test.mjs"], 6),
        "DK-12" => (&["sdk/browser/journal-model-test.mjs"], 13),
        "DK-13" => (&["sdk/browser/command-model-test.mjs"], 12),
        "DK-14" => (&["sdk/browser/query-model-test.mjs"], 11),
        "DK-15" => (&["sdk/browser/view-model-test.mjs"], 7),
        "DK-16" => (&["sdk/browser/view-host-test.mjs"], 10),
        "DK-19" => (
            &[
                "sdk/browser/rs256.test.mjs",
                "sdk/browser/rs256.browser.test.mjs",
            ],
            14,
        ),
        "DK-20" => (
            &[
                "sdk/browser/effects-wire.test.mjs",
                "sdk/browser/effects-module.test.mjs",
                "sdk/browser/effects-test.mjs",
            ],
            18,
        ),
        "DK-23" => (
            &[
                "tests/browser-presentation/wire.test.mjs",
                "tests/browser-presentation/dom.test.mjs",
                "sdk/browser/presentation.test.mjs",
            ],
            9,
        ),
        "DK-24" => (&["sdk/browser/operation-journal.test.mjs"], 28),
        "DK-25" => (&["sdk/browser/credential-custody-test.mjs"], 11),
        _ => unreachable!("closed browser host capability"),
    };
    // Node also applies this limit to the file-level wrapper. Full model and
    // multi-guest View builds carry explicit bounded deadlines; host-only
    // suites retain their short deadline.
    let timeout = if matches!(
        id,
        "DK-15" | "DK-16" | "DK-20" | "DK-23" | "DK-24" | "DK-25"
    ) {
        "3600000"
    } else if matches!(id, "DK-10" | "DK-11" | "DK-12" | "DK-13" | "DK-14") {
        "1500000"
    } else {
        "120000"
    };
    verify_node_suite(root, id, files, minimum_tests, timeout);
}

fn canonical_file(value: &Value) -> tempfile::NamedTempFile {
    let file = tempfile::NamedTempFile::new().expect("temporary canonical document");
    std::fs::write(
        file.path(),
        prismpm::holo::canonical::encode_value(value).expect("canonical JSON"),
    )
    .expect("write canonical document");
    file
}

fn oracle_accepts(profile: &str, value: &Value) -> bool {
    let file = canonical_file(value);
    prismpm::authority::run_oracle(profile, file.path()).is_ok()
}

fn publish_lock(root: &Path, mut lock: Value) {
    lock.as_object_mut().unwrap().remove("lock_id");
    let body = prismpm::holo::canonical::encode_value(&lock).unwrap();
    lock["lock_id"] = Value::String(format!("sha256:{}", sha256(&body)));
    std::fs::write(
        root.join("standards.lock"),
        prismpm::holo::canonical::encode_value(&lock).unwrap(),
    )
    .unwrap();
}

fn binding_only_lock(root: &Path) -> Value {
    let mut lock = prismpm::authority::inspect(root).unwrap();
    for row in lock["authorities"].as_array_mut().unwrap() {
        row["source_role"] = Value::String("binding-only".to_owned());
        row["source"]["revision"] = Value::Null;
        row["source"]["sha256"] = Value::Null;
        row["source"]["signature"] = Value::String("not-published".to_owned());
    }
    lock
}

fn verify_authorities(root: &Path, id: &str) {
    match id {
        "AU-01" => {
            let lock = prismpm::authority::inspect(root).expect("standards lock parses");
            let authorities = lock["authorities"].as_array().expect("authority bindings");
            let oracles = lock["oracles"].as_array().expect("oracle bindings");
            assert!(!authorities.is_empty() && !oracles.is_empty());
            assert!(authorities.iter().all(|row| row["statement"].is_string()
                && row["source"].is_object()
                && row.get("executable").is_none()));
            assert!(oracles.iter().all(|row| row["executable"].is_string()
                && row["authority_ids"]
                    .as_array()
                    .is_some_and(|ids| !ids.is_empty())));
        }
        "AU-02" => {
            let temp = tempfile::tempdir().unwrap();
            let first = prismpm::authority::resolve(temp.path(), false).unwrap();
            let bytes = std::fs::read(temp.path().join("standards.lock")).unwrap();
            let second = prismpm::authority::resolve(temp.path(), true).unwrap();
            assert!(second.unchanged);
            assert_eq!(first.lock_digest, second.lock_digest);
            std::fs::write(
                temp.path().join("standards.lock"),
                [bytes, b"\n".to_vec()].concat(),
            )
            .unwrap();
            assert_eq!(
                prismpm::authority::resolve(temp.path(), true)
                    .unwrap_err()
                    .code,
                "PP1101"
            );
        }
        "AU-03" => {
            let temp = tempfile::tempdir().unwrap();
            prismpm::authority::resolve(temp.path(), false).unwrap();
            let mut value = binding_only_lock(temp.path());
            value["authorities"][0]["source"]["signature"] =
                Value::String("planted-invalid-signature".to_owned());
            publish_lock(temp.path(), value);
            assert_eq!(
                prismpm::authority::verify(temp.path()).unwrap_err().code,
                "PP5402"
            );
            assert!(!temp.path().join(".prism/evidence").exists());
        }
        "AU-04" => {
            let temp = tempfile::tempdir().unwrap();
            prismpm::authority::resolve(temp.path(), false).unwrap();
            publish_lock(temp.path(), binding_only_lock(temp.path()));
            let result = prismpm::authority::verify(temp.path()).unwrap();
            assert!(result.offline);
            assert_eq!(result.acquired_objects, 0);
            assert!(temp.path().join(result.evidence_path).is_file());
        }
        "AU-05" => {
            let temp = tempfile::tempdir().unwrap();
            let standards = prismpm::authority::resolve(temp.path(), false).unwrap();
            let mut sdk_lock = sdk_lock_value();
            sdk_lock["sdk_image"] = Value::String(
                std::env::var("PRISMPM_TEST_SDK_IMAGE")
                    .expect("the no-skip authority gate requires an immutable SDK image"),
            );
            sdk_lock["standards_lock"] = Value::String(standards.lock_digest);
            bind_execution_sdk_fixture(&mut sdk_lock);
            let sdk_lock =
                prismpm::contracts::CanonicalDocument::from_value("prismpm/sdk-lock/1", sdk_lock)
                    .unwrap();
            std::fs::write(temp.path().join("prismpm.lock"), sdk_lock.bytes()).unwrap();
            let event = canonical_file(&serde_json::json!({
                "data": {}, "id": "1", "source": "https://example.test",
                "specversion": "1.0", "type": "example.accepted"
            }));
            let result = prismpm::authority::run_oracle_with_bindings_in_project(
                temp.path(),
                "cloudevents",
                event.path(),
                &BTreeMap::new(),
            )
            .unwrap();
            assert!(result.valid && !result.covered.is_empty());
            assert_hex_digest(result.subject.trim_start_matches("sha256:"));
            assert_eq!(
                prismpm::authority::run_oracle("unknown", event.path())
                    .unwrap_err()
                    .code,
                "PP5403"
            );
        }
        "AU-06" => {
            let valid = serde_json::json!({"info":{"title":"T","version":"1"},"openapi":"3.2.0","paths":{}});
            let mut invalid = valid.clone();
            invalid["planted"] = Value::Bool(true);
            assert!(oracle_accepts("openapi", &valid));
            assert!(!oracle_accepts("openapi", &invalid));
            let self_test = serde_json::json!({
                "instance":{"value":1},
                "schema":{"properties":{"value":{"type":"integer"}},"required":["value"],"type":"object"},
                "valid":true
            });
            assert!(oracle_accepts("json-schema", &self_test));
            let mut false_claim = self_test;
            false_claim["valid"] = Value::Bool(false);
            assert!(!oracle_accepts("json-schema", &false_claim));
            let evidence = upstream(root);
            assert!(evidence.json_schema.positive > 0);
            assert!(evidence.json_schema.negative > 0);
            assert!(evidence.json_schema.planted_rejections > 0);
            assert!(evidence.unicode.positive > 0);
            assert!(evidence.unicode.negative > 0);
            assert!(evidence.unicode.planted_rejections > 0);
        }
        _ => unreachable!(),
    }
}

fn empty_system_relations() -> Value {
    let mut value = serde_json::Map::new();
    value.insert(
        "product".to_owned(),
        serde_json::json!({"id":"system-fixture"}),
    );
    for name in [
        "acceptance",
        "alerts",
        "architecture",
        "artifacts",
        "backups",
        "calls",
        "capabilities",
        "components",
        "controls",
        "drifts",
        "events",
        "flows",
        "identity_requirements",
        "interfaces",
        "migrations",
        "parameters",
        "platform_requirements",
        "persistence",
        "retirements",
        "rollbacks",
        "rollouts",
        "scaling_policies",
        "schemas",
        "secret_references",
        "slis",
        "slos",
        "standards",
        "targets",
        "topology",
        "storage_classes",
    ] {
        value.insert(name.to_owned(), Value::Array(Vec::new()));
    }
    Value::Object(value)
}

fn verify_system(root: &Path, id: &str) {
    match id {
        "SY-07" => {
            assert_declarations(
                root,
                "Production.ControlCoverage",
                &[
                    "ControlObligation",
                    "ControlContribution",
                    "ControlPolicy",
                    "ControlSubmission",
                    "validateControlCoverage",
                ],
            );
            assert_declarations(
                root,
                "Production.ControlCoverageCorpus",
                &["coverageCorpusPassed", "coverageCorpusSound"],
            );
            assert_prism_theorems_axiom_free(root);
            // Controller::verify validates exact case definitions, distinct
            // executed calls, and expectations before emitting this evidence.
            // Exercise that shared implementation, not a parallel checker.
            let model = repo_model::Model::load(&root.join("model")).expect("registered corpus");
            let counts = &model.execution_corpus.control_coverage;
            let evidence = json(&verified_root(root).join("execution.json"));
            assert_eq!(
                evidence["control_coverage"],
                serde_json::json!({
                    "case_count": counts.case_count, "positive": counts.positive, "negative": counts.negative,
                    "status": "passed"
                })
            );
            assert_eq!(
                evidence["case_count"], 597,
                "list inputs retain separate accounting"
            );
            let coverage = json(&verified_root(root).join("coverage.json"));
            for name in [
                "PrismPM.Production.ControlCoverage.validateControlCoverage",
                "PrismPM.Production.ControlCoverageCorpus.coverageCorpusPassed",
                "PrismPM.Production.ControlCoverageCorpus.coverageValidPolicy",
                "PrismPM.Production.ControlCoverageCorpus.coverageValidSubmission",
            ] {
                assert!(
                    coverage["requested_roots"]
                        .as_array()
                        .expect("export roots")
                        .iter()
                        .any(|root| root == name),
                    "missing named runtime root {name}"
                );
            }
        }
        "SY-01" => {
            assert_declarations(
                root,
                "Production.Core",
                &[
                    "Product",
                    "Artifact",
                    "Component",
                    "Configuration",
                    "SecretReference",
                ],
            );
            assert_declarations(
                root,
                "Production.Interface",
                &["Schema", "Interface", "Call", "Event", "Flow"],
            );
            assert_declarations(
                root,
                "Production.Runtime",
                &[
                    "Topology",
                    "Persistence",
                    "Migration",
                    "BackupRecovery",
                    "TargetBinding",
                ],
            );
            assert_declarations(
                root,
                "Production.Operations",
                &[
                    "Observability",
                    "Sli",
                    "Slo",
                    "Alert",
                    "Control",
                    "Acceptance",
                ],
            );
            assert_declarations(
                root,
                "Production.System",
                &[
                    "SystemModel",
                    "Lifecycle",
                    "ApplicationErrorBinding",
                    "TransactionalCommandServiceProfile",
                    "TransactionalCommandView",
                    "SystemManifest",
                ],
            );
            assert_declarations(
                root,
                "Production.SystemValidation",
                &[
                    "validateManifest",
                    "validateModelClosure",
                    "validateModelUniqueness",
                    "validateModelReferentialIntegrity",
                    "validateModelCompatibility",
                    "validateModelCapabilitySatisfaction",
                    "validateModelSecretFlow",
                    "validateModelDeploymentOrder",
                    "validateModelMigrationOrder",
                    "validateModelRollbackSafety",
                    "validateModelEvidenceClosure",
                    "validateModelLicenseClosure",
                    "validateModelReleaseCompleteness",
                ],
            );
        }
        "SY-02" => {
            let mut system = empty_system_relations();
            system["components"] = serde_json::json!([{"id":"component","depends_on":[]}]);
            system["artifacts"] = serde_json::json!([{
                "id":"artifact",
                "license_expression":"Apache-2.0"
            }]);
            let certificate = prismpm::system::validation_certificate(&system).unwrap();
            for name in [
                "closure",
                "uniqueness",
                "referential_integrity",
                "compatibility",
                "capability_satisfaction",
                "secret_flow",
                "deployment_order",
                "migration_order",
                "rollback_safety",
                "evidence_closure",
                "license_closure",
                "release_completeness",
            ] {
                assert!(
                    certificate[name]["bound"].is_u64(),
                    "missing relation {name}"
                );
                assert!(
                    certificate[name]["values"].is_array(),
                    "missing values {name}"
                );
            }
            assert_eq!(certificate["license_closure"]["bound"], 257);
            assert_eq!(
                certificate["license_closure"]["values"],
                serde_json::json!([10])
            );
            system["targets"] = serde_json::json!([{"id":"component"}]);
            assert_eq!(
                prismpm::system::validation_certificate(&system)
                    .unwrap_err()
                    .code,
                "PP2101"
            );
        }
        "SY-03" => {
            assert_prism_theorems_axiom_free(root);
            assert_declarations(
                root,
                "Production.SystemValidation",
                &[
                    "validateModelClosure",
                    "validateModelUniqueness",
                    "validateModelReferentialIntegrity",
                    "validateModelCompatibility",
                    "validateModelCapabilitySatisfaction",
                    "validateModelSecretFlow",
                    "validateModelDeploymentOrder",
                    "validateModelMigrationOrder",
                    "validateModelRollbackSafety",
                    "validateModelEvidenceClosure",
                    "validateModelLicenseClosure",
                    "validateModelReleaseCompleteness",
                    "validateManifest",
                ],
            );
        }
        "SY-04" => {
            let valid = serde_json::json!({"info":{"title":"projection","version":"1"},"openapi":"3.2.0","paths":{}});
            assert!(oracle_accepts("openapi", &valid));
            let evidence = upstream(root);
            assert!(evidence.cloudevents.positive > 0);
            assert!(evidence.cloudevents.negative > 0);
            assert!(evidence.cloudevents.planted_rejections > 0);
            assert_eq!(evidence.asyncapi.published_documents, 24);
            assert_eq!(evidence.asyncapi.embedded_examples, 89);
            assert_eq!(evidence.asyncapi.upstream_negative_fixtures, 0);
            assert_eq!(evidence.asyncapi.negative_mutations, 1);
            assert_eq!(evidence.asyncapi.planted_rejections, 1);
            assert_eq!(
                evidence.opentelemetry.accepted_signals,
                vec!["logs", "metrics", "traces"]
            );
            assert!(evidence.opentelemetry.negative > 0);
        }
        "SY-05" => {
            let model =
                serde_json::json!({"observability":{"redacted_fields":["token","password"]}});
            let mut observed =
                serde_json::json!({"nested":{"token":"planted"},"secret":"secret://provider/key"});
            prismpm::operations::redact(&model, &mut observed).unwrap();
            assert_eq!(observed["nested"]["token"], "[REDACTED]");
            assert_eq!(observed["secret"], "secret://provider/key");
            let evidence = upstream(root);
            assert_eq!(evidence.openid.positive, 11);
            assert_eq!(evidence.openid.negative, 18);
            assert!(evidence.openid.planted_rejections > 0);
        }
        "SY-06" => {
            let invalid = serde_json::json!({"schema":"prismpm/system-model/1"});
            assert_eq!(
                prismpm::contracts::CanonicalDocument::from_value(
                    "prismpm/system-model/1",
                    invalid,
                )
                .unwrap_err()
                .code,
                "PP1101"
            );
        }
        _ => unreachable!(),
    }
}

fn sdk_lock_value() -> Value {
    let digest = format!("sha256:{}", "0".repeat(64));
    let ids: repo_model::Ids = toml::from_str(include_str!("../../../../model/ids.toml")).unwrap();
    let errors: repo_model::Errors =
        toml::from_str(include_str!("../../../../model/errors.toml")).unwrap();
    let corpus_version = format!(
        "{}-features-{}-diagnostics",
        ids.id.len(),
        errors.error.len()
    );
    serde_json::json!({
        "inventory":[
            {"digest":digest,"id":"prismpm","kind":"binary","version":"0.3.0"},
            {"digest":format!("sha256:{}", "7".repeat(64)),"id":"runtime-os-lock","kind":"dependency-lock","version":"ubuntu-noble@20260901T000000Z"},
            {"digest":format!("sha256:{}", "1".repeat(64)),"id":"sdk-linux-amd64","kind":"image","version":"0.3.0"},
            {"digest":format!("sha256:{}", "2".repeat(64)),"id":"sdk-linux-arm64","kind":"image","version":"0.3.0"},
            {"digest":format!("sha256:{}", "6".repeat(64)),"id":"sdk-test-corpus","kind":"test-corpus","version":corpus_version},
            {"digest":format!("sha256:{}", "5".repeat(64)),"id":"sigstore-root","kind":"trust-root","version":"2025-10-10"}
        ],
        "schema":"prismpm/sdk-lock/1",
        "sdk_image":format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{}", "3".repeat(64)),
        "sdk_version":"0.3.0",
        "standards_lock":format!("sha256:{}", "4".repeat(64))
    })
}

// Execution fixtures must bind the real running native inventory. The image
// identity remains an explicitly synthetic fixture except AU-05, which supplies
// its real isolated oracle image. Structural parser fixtures stay independent.
fn bind_execution_sdk_fixture(lock: &mut Value) {
    let fixed = Path::new("/opt/prismpm/share/inventory.json");
    let path = if fixed.exists() || Path::new("/etc/profile.d/prismpm-sdk.sh").exists() {
        Some(fixed.to_owned())
    } else {
        std::env::var_os("PRISMPM_SDK_INVENTORY").map(std::path::PathBuf::from)
    };
    if let Some(path) = path {
        let document: Value = serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
        let mut inventory = document["artifacts"].as_array().unwrap().clone();
        let digest = lock["sdk_image"]
            .as_str()
            .unwrap()
            .rsplit_once('@')
            .unwrap()
            .1;
        inventory.push(serde_json::json!({"id":"sdk-manifest","kind":"image","version":"0.3.0","digest":digest}));
        inventory.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
        lock["inventory"] = Value::Array(inventory);
    }
}

fn execution_sdk_lock_value() -> Value {
    let mut value = sdk_lock_value();
    bind_execution_sdk_fixture(&mut value);
    value
}

fn write_sdk_lock(root: &Path) {
    let lock = prismpm::contracts::CanonicalDocument::from_value(
        "prismpm/sdk-lock/1",
        execution_sdk_lock_value(),
    )
    .expect("valid SDK lock fixture");
    std::fs::write(root.join("prismpm.lock"), lock.bytes()).unwrap();
}

fn verify_sdk(id: &str) {
    match id {
        "DK-01" => {
            let lock = prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock/1",
                sdk_lock_value(),
            )
            .unwrap();
            assert_eq!(lock.schema(), "prismpm/sdk-lock/1");
            assert_eq!(lock.value()["inventory"].as_array().unwrap().len(), 6);
            let kinds = lock.value()["inventory"]
                .as_array()
                .unwrap()
                .iter()
                .map(|row| (row["id"].as_str().unwrap(), row["kind"].as_str().unwrap()))
                .collect::<BTreeMap<_, _>>();
            assert_eq!(kinds["sdk-test-corpus"], "test-corpus");
            assert_eq!(kinds["runtime-os-lock"], "dependency-lock");
            assert_eq!(kinds["sigstore-root"], "trust-root");
            let mut platforms = Vec::new();
            let mut manifests = Vec::new();
            let mut inventory_bytes = Vec::new();
            for architecture in ["amd64", "arm64"] {
                let mut inventory = lock.value()["inventory"].clone();
                inventory[0]["digest"] =
                    serde_json::json!(format!("sha256:{}", sha256(architecture.as_bytes())));
                let bytes = serde_json::to_vec(&serde_json::json!({
                    "schema":"prismpm/sdk-inventory/1", "artifacts":inventory,
                    "commands":[{"command":"prismpm","executable":"/usr/local/bin/prismpm","sha256":"a".repeat(64)}]
                }))
                .unwrap();
                let child = format!(
                    "sha256:{}",
                    sha256(format!("test child {architecture}").as_bytes())
                );
                manifests.push(serde_json::json!({"mediaType":"application/vnd.oci.image.manifest.v1+json",
                    "digest":child, "size":100, "platform":{"os":"linux","architecture":architecture}}));
                platforms.push(serde_json::json!({"platform":format!("linux/{architecture}"),
                    "manifest_digest":child, "inventory_digest":format!("sha256:{}", sha256(&bytes)), "inventory_document":String::from_utf8(bytes.clone()).unwrap(), "inventory":inventory}));
                inventory_bytes.push(bytes);
            }
            let index = serde_json::to_string(&serde_json::json!({"schemaVersion":2,
                "mediaType":"application/vnd.oci.image.index.v1+json", "manifests":manifests}))
            .unwrap();
            let value = serde_json::json!({"schema":"prismpm/sdk-lock/2", "sdk_version":"0.3.0",
                "sdk_image":format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{}", sha256(index.as_bytes())),
                "sdk_index":index, "standards_lock":lock.value()["standards_lock"], "platforms":platforms});
            let indexed = prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock/2",
                value.clone(),
            )
            .unwrap();
            let migration = serde_json::json!({"schema":"prismpm/sdk-lock-migration/1",
                "patch":[{"op":"test","path":"","value":lock.value()},
                    {"op":"replace","path":"","value":value}],
                "compatibility_review":"required", "generated_output_diff":"required", "security_review":"required"});
            prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock-migration/1",
                migration.clone(),
            )
            .unwrap();
            for mutation in 0..4 {
                let mut rejected = migration.clone();
                match mutation {
                    0 => rejected["patch"][0]["value"] = serde_json::json!({}),
                    1 => rejected["patch"][1]["value"] = serde_json::json!({}),
                    2 => rejected["patch"].as_array_mut().unwrap().reverse(),
                    _ => rejected["patch"][1]["path"] = serde_json::json!("/sdk_image"),
                }
                assert!(prismpm::contracts::CanonicalDocument::from_value(
                    "prismpm/sdk-lock-migration/1",
                    rejected,
                )
                .is_err());
            }
            let proposal = serde_json::json!({"schema":"prismpm/sdk-lock-update/2",
                "changes":[], "proposed_lock":value,
                "compatibility_review":"required", "generated_output_diff":"required", "security_review":"required"});
            prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock-update/2",
                proposal.clone(),
            )
            .unwrap();
            let mut unreviewed = proposal;
            unreviewed["security_review"] = serde_json::json!("passed");
            assert!(prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock-update/2",
                unreviewed,
            )
            .is_err());
            for (position, platform) in ["linux/amd64", "linux/arm64"].into_iter().enumerate() {
                prismpm::sdk::validate_running_inventory(
                    &indexed,
                    platform,
                    &inventory_bytes[position],
                )
                .unwrap();
                assert!(prismpm::sdk::validate_running_inventory(
                    &indexed,
                    platform,
                    &inventory_bytes[1 - position]
                )
                .is_err());
            }
            let mut missing = value.clone();
            missing["platforms"].as_array_mut().unwrap().pop();
            assert!(prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock/2",
                missing
            )
            .is_err());
            let mut swapped = value.clone();
            swapped["platforms"][0]["manifest_digest"] =
                value["platforms"][1]["manifest_digest"].clone();
            assert!(prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock/2",
                swapped
            )
            .is_err());
        }
        "DK-02" => {
            let lock = sdk_lock_value();
            let platforms = lock["inventory"]
                .as_array()
                .unwrap()
                .iter()
                .filter_map(|row| row["id"].as_str())
                .collect::<BTreeSet<_>>();
            assert!(platforms.contains("sdk-linux-amd64"));
            assert!(platforms.contains("sdk-linux-arm64"));
            let mut floating = lock;
            floating["sdk_image"] =
                Value::String("ghcr.io/uor-foundation/prismpm-sdk:latest".into());
            assert!(prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/sdk-lock/1",
                floating,
            )
            .is_err());
        }
        "DK-03" => {
            let left = tempfile::tempdir().unwrap();
            let right = tempfile::tempdir().unwrap();
            let a = prismpm::sdk::install_project_inputs(left.path()).unwrap();
            let b = prismpm::sdk::install_project_inputs(right.path()).unwrap();
            assert_eq!(
                a, b,
                "native and container installation inputs must be byte-identical"
            );
            assert_eq!(tree(left.path()), tree(right.path()));
        }
        "DK-04" => {
            let temp = tempfile::tempdir().unwrap();
            write_sdk_lock(temp.path());
            let lock = prismpm::sdk::inspect_lock(temp.path()).unwrap();
            assert_eq!(lock, execution_sdk_lock_value());
            assert!(prismpm::sdk::fetch_project_dependencies(temp.path())
                .unwrap()
                .is_empty());
        }
        "DK-05" => {
            let first = tempfile::tempdir().unwrap();
            let second = tempfile::tempdir().unwrap();
            let one = prismpm::sdk::install_project_inputs(first.path()).unwrap();
            let two = prismpm::sdk::install_project_inputs(second.path()).unwrap();
            assert_eq!(one, two, "clean self-rebuild inputs differ");
            assert_eq!(
                prismpm::sdk::install_project_inputs(first.path()).unwrap(),
                one,
                "self-bootstrap is not idempotent"
            );
            let evidence = serde_json::json!({
                "bootstrap": {
                    "archive_digest": format!("sha256:{}", "a".repeat(64)),
                    "binary_digest": format!("sha256:{}", "b".repeat(64)),
                    "source_commit": "f378fd3a8dc5711cb4b22cec9ee2f874353628c3",
                    "version": "0.2.0"
                },
                "compatibility_projection": {
                    "current_result_digest": format!("sha256:{}", "c".repeat(64)),
                    "prior_result_digest": format!("sha256:{}", "d".repeat(64)),
                    "shared_identity": {
                        "entity_count": 1,
                        "semantic_id": "e".repeat(64),
                        "snapshot_id": "f".repeat(64)
                    }
                },
                "production_model": {
                    "entity_count": 18,
                    "result_digest": format!("sha256:{}", "1".repeat(64)),
                    "semantic_id": "2".repeat(64),
                    "snapshot_id": "3".repeat(64)
                },
                "schema": "prismpm/bootstrap-evidence/1",
                "source_manifest": {
                    "digest": format!("sha256:{}", "4".repeat(64)),
                    "file_count": 200
                },
                "status": "passed"
            });
            prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/bootstrap-evidence/1",
                evidence.clone(),
            )
            .expect("bootstrap evidence is a closed canonical contract");
            // Contract-shape witnesses only; the bootstrap gate compares actual
            // prior/current captures through scripts/bootstrap-evidence.mjs.
            let identity = |digit: char| {
                let value = digit.to_string().repeat(64);
                serde_json::json!({
                    "capture_digest": format!("sha256:{value}"),
                    "compiler_semantics_id": value,
                    "emitter_semantics_id": "e".repeat(64),
                    "entity_count": 1,
                    "lock_digest": format!("sha256:{value}"),
                    "model_id": value,
                    "result_digest": format!("sha256:{value}"),
                    "semantic_id": value,
                    "snapshot_id": value,
                    "source_id": value
                })
            };
            let mut content_evidence = evidence;
            content_evidence["schema"] = serde_json::json!("prismpm/bootstrap-evidence/2");
            content_evidence["bootstrap"]["archive_digest"] = serde_json::json!(
                "sha256:f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c"
            );
            content_evidence["compatibility_projection"] = serde_json::json!({
                "current": identity('a'), "prior": identity('b'),
                "shared_content_digest": format!("sha256:{}", "c".repeat(64)),
                "shared_model_digest": format!("sha256:{}", "d".repeat(64))
            });
            content_evidence["production_model"]["schema"] =
                serde_json::json!("prismpm/check-result/1");
            content_evidence["production_model"]["model_id"] = serde_json::json!("1".repeat(64));
            prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/bootstrap-evidence/2",
                content_evidence.clone(),
            )
            .expect("content-compatible evidence preserves separate compiler identities");
            content_evidence["compatibility_projection"]["current"]
                .as_object_mut()
                .unwrap()
                .remove("lock_digest");
            assert!(prismpm::contracts::CanonicalDocument::from_value(
                "prismpm/bootstrap-evidence/2",
                content_evidence,
            )
            .is_err());
        }
        "DK-06" => {
            let temp = tempfile::tempdir().unwrap();
            prismpm::sdk::install_project_inputs(temp.path()).unwrap();
            let path = temp
                .path()
                .join(".prism/sdk/inputs/stdlib/Production/Core.lex.tex");
            std::fs::write(path, b"tampered").unwrap();
            assert_eq!(
                prismpm::sdk::install_project_inputs(temp.path())
                    .unwrap_err()
                    .code,
                "PP5401"
            );
        }
        _ => unreachable!(),
    }
}

struct OciFixture {
    _temp: tempfile::TempDir,
    root: PathBuf,
    descriptor: prismpm::oci::Descriptor,
}

fn oci_fixture() -> OciFixture {
    let source = repo_root();
    let build = built(&source);
    let verification = verified(&source);
    oci_fixture_from_verification(&source, build, verification)
}

fn oci_fixture_from_verification(
    source: &Path,
    build: &prismpm::controller::BuildResult,
    verification: &prismpm::controller::VerifyResult,
) -> OciFixture {
    // The SDK identity below is a transport fixture, not a shipped-SDK claim.
    // Build and runtime evidence, however, must come from the real verifier.
    assert_eq!(verification.build_id, build.build_id);
    let build_directory = source.join(".prism/build").join(&build.build_id);
    let verification_directory = source.join(&verification.verified_root);
    let model_bytes = std::fs::read(build_directory.join("model.prism.json")).unwrap();
    let model: Value = serde_json::from_slice(&model_bytes).unwrap();
    let family = if model.get("application").is_some() {
        "application"
    } else {
        "native"
    };
    let build_manifest_bytes = std::fs::read(build_directory.join("manifest.json")).unwrap();
    let build_manifest: Value = serde_json::from_slice(&build_manifest_bytes).unwrap();
    let build_digest = format!("sha256:{}", sha256(&build_manifest_bytes));
    let model_digest = format!("sha256:{}", sha256(&model_bytes));
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().to_path_buf();
    let store = prismpm::oci::Store::open(&root).unwrap();
    fn file(
        store: &prismpm::oci::Store,
        path: &str,
        role: &str,
        bytes: &[u8],
    ) -> prismpm::oci::Descriptor {
        let media_type = if path.ends_with(".holo") {
            "application/vnd.hologram.archive.v1"
        } else if path.ends_with(".wasm") {
            "application/wasm"
        } else if path.ends_with(".crate") {
            "application/vnd.rust.crate"
        } else if path.ends_with(".json") {
            "application/json"
        } else {
            "application/octet-stream"
        };
        let mut descriptor = store.put(media_type, bytes).unwrap();
        descriptor.annotations = Some(BTreeMap::from([
            ("org.opencontainers.image.title".into(), path.into()),
            ("org.prismpm.role".into(), role.into()),
        ]));
        descriptor
    }
    let mut layers = build_manifest["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            let path = row["path"].as_str().unwrap();
            let bytes = std::fs::read(build_directory.join(path)).unwrap();
            assert_eq!(row["byte_length"], bytes.len());
            assert_eq!(row["sha256"], sha256(&bytes));
            file(&store, path, "release-artifact", &bytes)
        })
        .collect::<Vec<_>>();
    layers.push(file(
        &store,
        "build-manifest.json",
        "build-manifest",
        &build_manifest_bytes,
    ));
    let standards_lock_bytes = include_bytes!("../../../../standards.lock");
    let standards_lock_digest = format!("sha256:{:x}", sha2::Sha256::digest(standards_lock_bytes));
    let mut sdk_lock_value = sdk_lock_value();
    sdk_lock_value["standards_lock"] = Value::String(standards_lock_digest);
    let sdk_lock_document =
        prismpm::contracts::CanonicalDocument::from_value("prismpm/sdk-lock/1", sdk_lock_value)
            .unwrap();
    let mut sdk_lock = store
        .put("application/json", sdk_lock_document.bytes())
        .unwrap();
    sdk_lock.annotations = Some(BTreeMap::from([
        (
            "org.opencontainers.image.title".to_owned(),
            "prismpm.lock".to_owned(),
        ),
        ("org.prismpm.role".to_owned(), "sdk-lock".to_owned()),
    ]));
    let mut standards_lock = store.put("application/json", standards_lock_bytes).unwrap();
    standards_lock.annotations = Some(BTreeMap::from([
        (
            "org.opencontainers.image.title".to_owned(),
            "standards.lock".to_owned(),
        ),
        ("org.prismpm.role".to_owned(), "standards-lock".to_owned()),
    ]));
    layers.extend([sdk_lock.clone(), standards_lock.clone()]);
    layers.sort_by(|left, right| left.annotations.cmp(&right.annotations));
    let mut artifacts = layers
        .iter()
        .map(|descriptor| {
            serde_json::json!({
                "annotations":descriptor.annotations,
                "digest":descriptor.digest,
                "media_type":descriptor.media_type,
                "role":descriptor.annotations.as_ref().unwrap()["org.prismpm.role"],
                "size":descriptor.size
            })
        })
        .collect::<Vec<_>>();
    artifacts.sort_by(|left, right| left["digest"].as_str().cmp(&right["digest"].as_str()));
    let release = prismpm::contracts::CanonicalDocument::from_value(
        "prismpm/product-release/1",
        serde_json::json!({
            "artifacts":artifacts,
            "external_artifacts":[],
            "model_digest":model_digest,
            "product":"conformance-product",
            "release":"fixture",
            "schema":"prismpm/product-release/1",
            "sdk_digest":format!("sha256:{}", "3".repeat(64)),
            "sdk_lock":sdk_lock.digest,
            "standards_lock":standards_lock.digest,
            "status":"development"
        }),
    )
    .unwrap();
    let config = store
        .put(prismpm::oci::PRISM_RELEASE, release.bytes())
        .unwrap();
    let manifest = prismpm::holo::canonical::encode_value(&serde_json::json!({
        "artifactType":"application/vnd.prismpm.product.release.v1+json",
        "config":config,
        "layers":layers,
        "mediaType":prismpm::oci::OCI_MANIFEST,
        "schemaVersion":2
    }))
    .unwrap();
    let mut descriptor = store.put(prismpm::oci::OCI_MANIFEST, &manifest).unwrap();
    descriptor.artifact_type = Some("application/vnd.prismpm.product.release.v1+json".to_owned());
    descriptor.annotations = Some(BTreeMap::from([(
        "org.opencontainers.image.ref.name".to_owned(),
        "example.test/product:fixture".to_owned(),
    )]));
    let verification_config = prismpm::holo::canonical::encode_value(&serde_json::json!({
        "attestation_id":verification.attestation_id,
        "build_digest":build_digest,
        "build_id":build.build_id,
        "family":family,
        "model_digest":model_digest,
        "schema":"prismpm/verification-closure/1"
    }))
    .unwrap();
    let verification_config = store
        .put(prismpm::oci::PRISM_VERIFICATION, &verification_config)
        .unwrap();
    let runtime_files = tree(&verification_directory);
    let required_runtime = if family == "native" {
        "validator"
    } else {
        "application-acceptance.json"
    };
    assert!(runtime_files
        .iter()
        .any(|(path, _)| path == required_runtime));
    let runtime_layers = runtime_files
        .iter()
        .map(|(path, bytes)| {
            file(
                &store,
                &format!("runtime/{path}"),
                "verification-artifact",
                bytes,
            )
        })
        .collect::<Vec<_>>();
    let verification_manifest = prismpm::holo::canonical::encode_value(&serde_json::json!({
        "artifactType":prismpm::oci::PRISM_VERIFICATION,
        "config":verification_config,
        "layers":runtime_layers,
        "mediaType":prismpm::oci::OCI_MANIFEST,
        "schemaVersion":2,
        "subject":descriptor
    }))
    .unwrap();
    let mut verification_descriptor = store
        .put(prismpm::oci::OCI_MANIFEST, &verification_manifest)
        .unwrap();
    verification_descriptor.artifact_type = Some(prismpm::oci::PRISM_VERIFICATION.to_owned());
    fn referrer(
        store: &prismpm::oci::Store,
        root: &prismpm::oci::Descriptor,
        artifact_type: &str,
        evidence: Value,
    ) -> prismpm::oci::Descriptor {
        let config = store
            .put("application/vnd.oci.empty.v1+json", b"{}")
            .unwrap();
        let bytes = prismpm::holo::canonical::encode_value(&evidence).unwrap();
        let layer = store.put(artifact_type, &bytes).unwrap();
        let manifest = prismpm::holo::canonical::encode_value(&serde_json::json!({
            "artifactType":artifact_type,
            "config":config,
            "layers":[layer],
            "mediaType":prismpm::oci::OCI_MANIFEST,
            "schemaVersion":2,
            "subject":root
        }))
        .unwrap();
        let mut row = store.put(prismpm::oci::OCI_MANIFEST, &manifest).unwrap();
        row.artifact_type = Some(artifact_type.to_owned());
        row
    }
    let semantic_source_id = model["provenance"]["source_id"].as_str().unwrap();
    let sdk_image = sdk_lock_document.value()["sdk_image"].as_str().unwrap();
    let provenance_bytes =
        prismpm::supply_chain::provenance_statement(&prismpm::supply_chain::ProvenanceInputs {
            subject_name: release.value()["product"].as_str().unwrap().to_owned(),
            subject_digest: descriptor.digest.clone(),
            builder_id: sdk_image.to_owned(),
            invocation_id: build.build_id.clone(),
            source_uri: "urn:prismpm:source:conformance-product".to_owned(),
            source_revision: semantic_source_id.to_owned(),
            external_parameters: serde_json::json!({
                "model_digest":release.value()["model_digest"],
                "product_release":release.value()["release"],
                "semantic_source_id":semantic_source_id,
                "standards_lock":release.value()["standards_lock"]
            }),
            dependencies: vec![
                (
                    sdk_image.to_owned(),
                    release.value()["sdk_digest"].as_str().unwrap().to_owned(),
                ),
                ("urn:prismpm:sdk-lock".to_owned(), sdk_lock.digest.clone()),
                (
                    "urn:prismpm:standards-lock".to_owned(),
                    standards_lock.digest.clone(),
                ),
                (
                    "urn:prismpm:build-manifest".to_owned(),
                    build_digest.clone(),
                ),
                (
                    "urn:prismpm:verification-closure".to_owned(),
                    verification_descriptor.digest.clone(),
                ),
            ],
        })
        .unwrap();
    let provenance_value = serde_json::from_slice(&provenance_bytes).unwrap();
    let provenance = referrer(&store, &descriptor, prismpm::oci::INTOTO, provenance_value);
    let validation = referrer(
        &store,
        &descriptor,
        prismpm::oci::PRISM_VALIDATION,
        serde_json::json!({
            "build_digest":build_digest,
            "oracle_results":[],
            "result":"passed",
            "schema":"prismpm/release-validation/1",
            "subject":descriptor.digest,
            "verification_digest":verification_descriptor.digest
        }),
    );
    let spdx = referrer(
        &store,
        &descriptor,
        "application/spdx+json;version=3.0.1",
        spdx_document("urn:spdx:artifact"),
    );
    let supply = referrer(
        &store,
        &descriptor,
        "application/vnd.prismpm.supply-chain.v1+json",
        serde_json::json!({"release_digest":descriptor.digest,"status":"passed"}),
    );
    let mut rows = vec![
        descriptor.clone(),
        verification_descriptor,
        provenance,
        validation,
        spdx,
        supply,
    ];
    rows.sort_by(|left, right| left.digest.cmp(&right.digest));
    let index = prismpm::holo::canonical::encode_value(&serde_json::json!({
        "manifests":rows,
        "mediaType":prismpm::oci::OCI_INDEX,
        "schemaVersion":2
    }))
    .unwrap();
    std::fs::write(store.root().join("index.json"), index).unwrap();
    let mut referrers = rows
        .into_iter()
        .filter(|row| row.digest != descriptor.digest)
        .collect::<Vec<_>>();
    referrers.sort_by(|left, right| left.digest.cmp(&right.digest));
    let graph_digest = format!(
        "sha256:{}",
        sha256(
            &prismpm::holo::canonical::encode_value(
                &serde_json::json!({"referrers":referrers,"root":descriptor})
            )
            .unwrap()
        )
    );
    let marker = prismpm::holo::canonical::encode_value(&serde_json::json!({
        "graph_digest":graph_digest,
        "policy":"release",
        "referrers":referrers,
        "root":descriptor,
        "schema":"prismpm/verified-oci-root/1"
    }))
    .unwrap();
    let verified = store.root().join("verified").join(format!(
        "{}.json",
        descriptor.digest.trim_start_matches("sha256:")
    ));
    std::fs::create_dir_all(verified.parent().unwrap()).unwrap();
    std::fs::write(verified, marker).unwrap();
    OciFixture {
        _temp: temp,
        root,
        descriptor,
    }
}

fn verify_browser_export(root: &Path) {
    use prismpm::controller::{BuildRequest, ExportBrowserRequest, VerifyRequest};

    fn materialize(root: &Path, files: &[(String, Vec<u8>)]) {
        for (relative, bytes) in files {
            let path = root.join(relative);
            std::fs::create_dir_all(path.parent().unwrap()).unwrap();
            std::fs::write(path, bytes).unwrap();
        }
    }

    let source = tempfile::tempdir().unwrap();
    let source_path = source.path().to_owned();
    let example = root.join("examples/Calculator");
    materialize(&source_path.join("src"), &tree(&example.join("src")));
    for name in [
        "lexlean.toml",
        "lexlean.lock",
        "prismpm.toml",
        "lakefile.toml",
        "lake-manifest.json",
        "lean-toolchain",
    ] {
        // Exact example bytes need no test-only relock or alternate semantics.
        std::fs::copy(example.join(name), source_path.join(name)).unwrap();
    }
    let controller = prismpm::Controller::load(&source_path).unwrap();
    let build = controller
        .build(BuildRequest { config_path: None })
        .unwrap();
    let verification = controller
        .verify(VerifyRequest { config_path: None })
        .unwrap();
    assert_eq!(build.build_id, verification.build_id);
    let build_directory = source_path.join(".prism/build").join(&build.build_id);
    let browser = tree(&build_directory.join("view/browser"));
    assert_eq!(
        browser
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        [
            "app.css",
            "app.js",
            "index.html",
            "prism_calculator.js",
            "prism_calculator_bg.wasm",
            "provenance.json",
        ]
    );
    let model_digest = format!(
        "sha256:{}",
        sha256(&std::fs::read(build_directory.join("model.prism.json")).unwrap())
    );
    let build_digest = format!(
        "sha256:{}",
        sha256(&std::fs::read(build_directory.join("manifest.json")).unwrap())
    );
    let fixture = oci_fixture_from_verification(&source_path, &build, &verification);
    drop(controller);
    source.close().unwrap();
    assert!(
        !source_path.exists(),
        "export must not have an available source project"
    );

    let release_digest = fixture.descriptor.digest.clone();
    let reference = format!("example.test/product@{release_digest}");
    let layout = tree(&fixture.root.join(".prism/oci"));
    assert!(layout.iter().all(|(path, _)| {
        matches!(path.as_str(), "oci-layout" | "index.json")
            || path.starts_with("blobs/sha256/")
            || path.starts_with("verified/")
    }));
    assert!(layout.iter().any(|(path, _)| path.starts_with("verified/")));
    let original_store = fixture.root.clone();
    fixture._temp.close().unwrap();
    assert!(!original_store.exists());

    let receiver = tempfile::tempdir().unwrap();
    materialize(&receiver.path().join(".prism/oci"), &layout);
    for absent in [
        "prismpm.toml",
        "prismpm.lock",
        "src",
        ".lexlean",
        ".prism/build",
        ".prism/verified",
    ] {
        assert!(
            !receiver.path().join(absent).exists(),
            "source-free receiver has {absent}"
        );
    }
    let controller = prismpm::Controller::load(receiver.path()).unwrap();
    let files = browser
        .iter()
        .map(|(path, bytes)| {
            serde_json::json!({
                "digest":format!("sha256:{}", sha256(bytes)),
                "path":path,
                "size":bytes.len()
            })
        })
        .collect::<Vec<_>>();
    let tree_digest = format!(
        "sha256:{}",
        sha256(&prismpm::holo::canonical::encode_value(&serde_json::json!(files)).unwrap())
    );
    let mut receipts = Vec::new();
    for output in ["site-one", "site-two"] {
        let receipt = controller
            .export_browser(ExportBrowserRequest {
                reference: reference.clone(),
                output: PathBuf::from(output),
            })
            .unwrap();
        assert_eq!(
            receipt,
            serde_json::json!({
                "build_digest":build_digest,
                "files":files,
                "model_digest":model_digest,
                "output":output,
                "reference":reference,
                "release_digest":release_digest,
                "schema":"prismpm/browser-export/1",
                "tree_digest":tree_digest
            })
        );
        let document = prismpm::contracts::CanonicalDocument::from_value(
            "prismpm/browser-export/1",
            receipt.clone(),
        )
        .unwrap();
        assert_eq!(
            document.bytes(),
            prismpm::holo::canonical::encode_value(&receipt).unwrap()
        );
        assert_eq!(tree(&receiver.path().join(output)), browser);
        assert_eq!(
            std::fs::read_dir(receiver.path().join(output))
                .unwrap()
                .count(),
            6
        );
        receipts.push(receipt);
    }
    receipts[0]["output"] = receipts[1]["output"].clone();
    assert_eq!(
        receipts[0], receipts[1],
        "export content identities must be deterministic"
    );
    assert_eq!(
        tree(&receiver.path().join(".prism/oci")),
        layout,
        "export must not rewrite the source OCI store"
    );
    for output in [
        "site-one",
        "../escape",
        "/outside",
        "nested/site",
        ".prism",
        "site/",
        "site\\escape",
    ] {
        assert_eq!(
            controller
                .export_browser(ExportBrowserRequest {
                    reference: reference.clone(),
                    output: PathBuf::from(output),
                })
                .unwrap_err()
                .code,
            "PP8001",
            "{output}"
        );
    }
    std::fs::write(receiver.path().join("owned"), b"preserve existing file").unwrap();
    assert_eq!(
        controller
            .export_browser(ExportBrowserRequest {
                reference: reference.clone(),
                output: PathBuf::from("owned"),
            })
            .unwrap_err()
            .code,
        "PP8001"
    );
    assert_eq!(
        std::fs::read(receiver.path().join("owned")).unwrap(),
        b"preserve existing file"
    );
    assert_eq!(tree(&receiver.path().join("site-one")), browser);
    assert!(!receiver.path().join("nested").exists());

    for mutation in ["proof", "artifact", "referrer"] {
        let rejected = tempfile::tempdir().unwrap();
        let store_root = rejected.path().join(".prism/oci");
        materialize(&store_root, &layout);
        let blob = |digest: &str| {
            store_root
                .join("blobs/sha256")
                .join(digest.strip_prefix("sha256:").unwrap())
        };
        let mut index = json(&store_root.join("index.json"));
        let proof = index["manifests"]
            .as_array()
            .unwrap()
            .iter()
            .find(|row| row["artifactType"] == prismpm::oci::PRISM_VERIFICATION)
            .unwrap()
            .clone();
        match mutation {
            "proof" | "artifact" => {
                let manifest = if mutation == "proof" {
                    json(&blob(proof["digest"].as_str().unwrap()))
                } else {
                    json(&blob(&release_digest))
                };
                let title = if mutation == "proof" {
                    "runtime/application-acceptance.json"
                } else {
                    "view/browser/app.js"
                };
                let layer = manifest["layers"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .find(|row| row["annotations"]["org.opencontainers.image.title"] == title)
                    .unwrap();
                let path = blob(layer["digest"].as_str().unwrap());
                let mut bytes = std::fs::read(&path).unwrap();
                bytes[0] ^= 1;
                std::fs::write(path, bytes).unwrap();
            }
            "referrer" => {
                index["manifests"]
                    .as_array_mut()
                    .unwrap()
                    .retain(|row| row["digest"] != proof["digest"]);
                std::fs::write(
                    store_root.join("index.json"),
                    prismpm::holo::canonical::encode_value(&index).unwrap(),
                )
                .unwrap();
            }
            _ => unreachable!(),
        }
        let before = tree(rejected.path());
        let error = prismpm::Controller::load(rejected.path())
            .unwrap()
            .export_browser(ExportBrowserRequest {
                reference: reference.clone(),
                output: PathBuf::from("site"),
            })
            .unwrap_err();
        assert_eq!(error.code, "PP6101", "{mutation}: {error}");
        assert!(
            !rejected.path().join("site").exists(),
            "{mutation} published an output"
        );
        assert_eq!(
            tree(rejected.path()),
            before,
            "{mutation} changed the receiver on rejection"
        );
    }
}

fn verify_oci(id: &str) {
    let fixture = oci_fixture();
    let store = prismpm::oci::Store::open(&fixture.root).unwrap();
    match id {
        "OC-01" => {
            let result = prismpm::oci::verify_graph(&store, &fixture.descriptor.digest).unwrap();
            assert_eq!(result["verified"], true);
            assert!(result["descriptor_count"].as_u64().unwrap() >= 3);
            let evidence = upstream(&repo_root());
            assert!(evidence.oci_image.positive > 0);
            assert!(evidence.oci_image.negative > 0);
            assert!(evidence.oci_image.planted_rejections > 0);
        }
        "OC-02" => {
            let mut changed = fixture.descriptor.clone();
            changed.size += 1;
            assert_eq!(store.read(&changed).unwrap_err().code, "PP6101");
            let marker = store.root().join("verified").join(format!(
                "{}.json",
                fixture.descriptor.digest.trim_start_matches("sha256:")
            ));
            std::fs::remove_file(marker).unwrap();
            assert!(prismpm::oci::verify_graph(&store, &fixture.descriptor.digest).is_ok());
            assert_eq!(
                prismpm::oci::inspect(
                    &fixture.root,
                    &format!("example.test/product@{}", fixture.descriptor.digest)
                )
                .unwrap_err()
                .code,
                "PP6101"
            );
        }
        "OC-03" => {
            let mut value = serde_json::json!({
                "checks":[{
                    "evidence_digest":format!("sha256:{}", "1".repeat(64)),
                    "id":"readiness", "kind":"readiness", "status":"passed"
                }],
                "observed_state":format!("sha256:{}", "2".repeat(64)),
                "operation":"deploy",
                "plan_digest":format!("sha256:{}", "3".repeat(64)),
                "release_digest":fixture.descriptor.digest,
                "schema":"prismpm/deployment-evidence/1",
                "status":"accepted",
                "target":"compose-local"
            });
            let evidence_digest = format!(
                "sha256:{}",
                sha256(&prismpm::holo::canonical::encode_value(&value).unwrap())
            );
            value["evidence_digest"] = Value::String(evidence_digest);
            let evidence = prismpm::holo::canonical::encode_value(&value).unwrap();
            let referrer = prismpm::oci::attach_referrer(
                &fixture.root,
                &fixture.descriptor.digest,
                "application/vnd.prismpm.deployment.evidence.v1+json",
                &evidence,
            )
            .unwrap();
            assert_ne!(referrer, fixture.descriptor.digest);
            let inspected = prismpm::oci::inspect(
                &fixture.root,
                &format!("example.test/product@{}", fixture.descriptor.digest),
            )
            .unwrap();
            assert_eq!(inspected["referrers"].as_array().unwrap().len(), 6);
        }
        "OC-04" => {
            let reference = format!("example.test/product@{}", fixture.descriptor.digest);
            let first = prismpm::oci::inspect(&fixture.root, &reference).unwrap();
            let second = prismpm::oci::inspect(&fixture.root, &reference).unwrap();
            assert_eq!(first, second);
            assert_eq!(
                prismpm::oci::artifact(
                    &fixture.root,
                    &fixture.descriptor.digest,
                    "model.prism.json"
                )
                .unwrap(),
                model_bytes(&repo_root())
            );
        }
        "OC-05" => {
            assert!(prismpm::oci::validate_reference("localhost:5000/product:tag", false).is_ok());
            assert!(prismpm::oci::validate_reference("localhost:5000/product:tag", true).is_err());
            assert!(prismpm::oci::validate_reference("../escape:tag", false).is_err());
            assert!(prismpm::oci::validate_reference("product:latest", false).is_err());
            let evidence = upstream(&repo_root());
            assert_eq!(evidence.oci_distribution.passed, 79);
            assert_eq!(evidence.oci_distribution.failed, 0);
            assert_eq!(evidence.oci_distribution.upstream_skipped, 0);
            assert_eq!(evidence.oci_distribution.raw_reports.len(), 6);
            assert!(evidence
                .oci_distribution
                .raw_reports
                .iter()
                .all(|report| report.official_total == 79));
            assert_eq!(evidence.oci_distribution.planted_rejections, 1);
        }
        "OC-06" => {
            let original = fixture.descriptor.digest.clone();
            for (from, to) in [("development", "candidate"), ("candidate", "accepted")] {
                let evidence = prismpm::holo::canonical::encode_value(&serde_json::json!({
                    "from":from,"signature":{"verified":true},"subject":original,"to":to
                }))
                .unwrap();
                let error = prismpm::oci::attach_referrer(
                    &fixture.root,
                    &original,
                    prismpm::oci::PRISM_PROMOTION,
                    &evidence,
                )
                .unwrap_err();
                assert_eq!(error.code, "PP7401");
            }
            assert_eq!(
                prismpm::oci::verify_graph(&store, &original).unwrap()["root_digest"],
                original
            );
        }
        _ => unreachable!(),
    }
}

fn verify_lifecycle(root: &Path, id: &str) {
    match id {
        "LC-01" => {
            let result = checked(root);
            assert_eq!(result.schema, "prismpm/check-result/1");
            let invalid = prismpm::lifecycle::status(root, "not-a-digest", "local").unwrap_err();
            assert_eq!(invalid.code, "PP6101");
        }
        "LC-02" => {
            let first = serde_json::to_value(checked(root)).unwrap();
            let second = serde_json::to_value(checked(root)).unwrap();
            assert_eq!(first, second, "Controller result is not stable");
            let bytes = prismpm::holo::canonical::encode_value(&first).unwrap();
            assert!(
                !bytes.contains(&b'\n'),
                "pipe result contains framing newlines"
            );
        }
        "LC-03" => {
            let fixture = oci_fixture();
            let reference = format!("example.test/product@{}", fixture.descriptor.digest);
            let error = prismpm::lifecycle::run(&fixture.root, &reference, "invalid/target", false)
                .unwrap_err();
            assert_eq!(error.code, "PP7101");
            assert!(!fixture.root.join(".prism/targets").exists());
            let evidence = upstream(root);
            assert!(evidence.oci_runtime.positive > 0);
            assert!(evidence.oci_runtime.negative > 0);
            assert_eq!(evidence.oci_runtime.engine_positive, 1);
            assert_eq!(evidence.oci_runtime.engine_negative, 1);
            assert_eq!(evidence.oci_runtime.planted_rejections, 1);
        }
        "LC-04" => {
            let fixture = oci_fixture();
            let root = fixture.root.clone();
            let threads = (0..4)
                .map(|_| {
                    let root = root.clone();
                    std::thread::spawn(move || {
                        prismpm::oci::Store::open(&root)
                            .unwrap()
                            .put("application/octet-stream", b"same operation")
                            .unwrap()
                    })
                })
                .collect::<Vec<_>>();
            let digests = threads
                .into_iter()
                .map(|thread| thread.join().unwrap().digest)
                .collect::<BTreeSet<_>>();
            assert_eq!(
                digests.len(),
                1,
                "concurrent publication was not idempotent"
            );
        }
        "LC-05" => {
            for (reference, target, expected) in [
                ("mutable:tag", "local", "PP6101"),
                ("example.test/p@sha256:bad", "local", "PP6101"),
                (
                    &format!("example.test/p@sha256:{}", "0".repeat(64)),
                    "Bad",
                    "PP7101",
                ),
            ] {
                let error = prismpm::lifecycle::status(root, reference, target).unwrap_err();
                assert_eq!(error.code, expected);
                assert!(!error.message.is_empty());
            }
        }
        "LC-06" => {
            let model = repo_model::Model::load(&root.join("model")).unwrap();
            model.check().unwrap();
            let commands = model
                .commands
                .command
                .iter()
                .map(|row| row.name.as_str())
                .collect::<BTreeSet<_>>();
            for executable in [
                "fetch", "build", "push", "pull", "inspect", "run", "plan", "deploy", "status",
                "rollback", "destroy",
            ] {
                assert!(
                    commands.contains(executable),
                    "missing executable command {executable}"
                );
            }
        }
        _ => unreachable!(),
    }
}

fn adapter_system(kind: &str) -> Value {
    let capability = format!("{kind}-capability");
    serde_json::json!({
        "artifacts":[],
        "capabilities":[{"id":capability}],
        "topology":[],
        "targets":[{
            "adapter_digest":prismpm::deployment::digest(kind).unwrap(),
            "api_version":match kind {
                "compose" => "compose-spec@fee041b381ffd4aad263410980bdce0cdf4beb7d",
                "github-pages" => "github-pages-artifact@v4",
                "kubernetes" => "v1.36.4",
                _ => unreachable!(),
            },
            "capabilities":[capability],
            "credentials":"external",
            "id":format!("{kind}-target"),
            "ingress_class_name":null,
            "ingress_controller_artifact":null,
            "kind":kind,
            "minimum_release_status":"development",
            "platform_requirements":[format!("{kind}-linux")],
            "storage_class":null,
            "storage_profile":null
        }]
    })
}

fn verify_deployment(id: &str) {
    match id {
        "DP-01" => {
            for kind in ["compose", "github-pages", "kubernetes"] {
                prismpm::deployment::validate_targets(&adapter_system(kind)).unwrap();
            }
            assert_eq!(
                prismpm::deployment::digest("shell").unwrap_err().code,
                "PP7101"
            );
        }
        "DP-02" => {
            let mut system = adapter_system("compose");
            prismpm::deployment::validate_targets(&system).unwrap();
            system["targets"][0]["adapter_digest"] =
                Value::String(format!("sha256:{}", "0".repeat(64)));
            assert_eq!(
                prismpm::deployment::validate_targets(&system)
                    .unwrap_err()
                    .code,
                "PP7101"
            );
        }
        "DP-03" => {
            let mut system = adapter_system("kubernetes");
            prismpm::deployment::validate_targets(&system).unwrap();
            system["targets"][0]["api_version"] = Value::String("kubernetes/latest".to_owned());
            assert_eq!(
                prismpm::deployment::validate_targets(&system)
                    .unwrap_err()
                    .code,
                "PP7101"
            );
        }
        "DP-04" => {
            let fixture = oci_fixture();
            let reference = format!("example.test/product@{}", fixture.descriptor.digest);
            let first =
                prismpm::lifecycle::plan(&fixture.root, &reference, "compose-target").unwrap_err();
            let second =
                prismpm::lifecycle::plan(&fixture.root, &reference, "compose-target").unwrap_err();
            assert_eq!((first.code, first.message), (second.code, second.message));
            assert!(!fixture.root.join(".prism/plans").exists());
        }
        "DP-05" => {
            let system = adapter_system("compose");
            prismpm::deployment::validate_targets(&system).unwrap();
            let mut incomplete = system;
            incomplete["targets"][0]["capabilities"] = serde_json::json!(["undeclared"]);
            assert_eq!(
                prismpm::deployment::validate_targets(&incomplete)
                    .unwrap_err()
                    .code,
                "PP7101"
            );
        }
        "DP-06" => {
            let fixture = oci_fixture();
            let reference = format!("example.test/product@{}", fixture.descriptor.digest);
            for operation in [
                prismpm::lifecycle::status(&fixture.root, &reference, "invalid/target"),
                prismpm::lifecycle::rollback(&fixture.root, &reference, "invalid/target"),
                prismpm::lifecycle::destroy(&fixture.root, &reference, "invalid/target", false),
            ] {
                assert_eq!(operation.unwrap_err().code, "PP7101");
            }
            assert!(!fixture.root.join(".prism/targets").exists());
        }
        _ => unreachable!(),
    }
}

fn operations_model() -> Value {
    serde_json::json!({
        "alerts":[{"id":"availability-alert"}],
        "components":[{"health":"/healthz","id":"service"}],
        "observability":{
            "alerts":["availability-alert"],
            "logs":"otlp", "metrics":"otlp", "redacted_fields":["authorization","token","password"],
            "slos":["availability-slo"], "traces":"otlp"
        },
        "slis":[{"id":"availability-sli"}],
        "slos":[{"id":"availability-slo"}]
    })
}

fn verify_operations(id: &str) {
    match id {
        "OP-01" | "OP-02" | "OP-05" => {
            let release = format!("sha256:{}", "a".repeat(64));
            let evidence =
                prismpm::operations::model_evidence(&operations_model(), &release).unwrap();
            assert_eq!(evidence.len(), 1);
            assert_eq!(evidence[0]["status"], "passed");
            if id == "OP-05" {
                assert_hex_digest(
                    evidence[0]["evidence_digest"]
                        .as_str()
                        .unwrap()
                        .trim_start_matches("sha256:"),
                );
            }
        }
        "OP-03" => {
            let mut incomplete = operations_model();
            incomplete["slos"] = Value::Array(Vec::new());
            assert_eq!(
                prismpm::operations::model_evidence(
                    &incomplete,
                    &format!("sha256:{}", "a".repeat(64))
                )
                .unwrap_err()
                .code,
                "PP7401"
            );
        }
        "OP-04" => {
            let mut unhealthy = operations_model();
            unhealthy["components"][0]["health"] = Value::String(String::new());
            assert_eq!(
                prismpm::operations::model_evidence(
                    &unhealthy,
                    &format!("sha256:{}", "a".repeat(64))
                )
                .unwrap_err()
                .code,
                "PP7401"
            );
        }
        "OP-06" => {
            let model = operations_model();
            let mut evidence = serde_json::json!({
                "authorization":"Bearer planted",
                "nested":{"password":"planted","token":"planted"},
                "release_digest":format!("sha256:{}", "a".repeat(64))
            });
            prismpm::operations::redact(&model, &mut evidence).unwrap();
            let bytes = prismpm::holo::canonical::encode_value(&evidence).unwrap();
            let text = String::from_utf8(bytes).unwrap();
            assert!(!text.contains("planted"));
            assert!(text.matches("[REDACTED]").count() >= 3);
        }
        _ => unreachable!(),
    }
}

fn spdx_document(target: &str) -> Value {
    let creation = serde_json::json!({
        "created":"1970-01-01T00:00:00Z",
        "createdBy":["urn:spdx:tool:prismpm"],
        "specVersion":"3.0.1",
        "type":"CreationInfo"
    });
    serde_json::json!({
        "@context":"https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        "@graph":[
            {"creationInfo":creation,"name":"artifact","spdxId":"urn:spdx:artifact","type":"software_File"},
            {"creationInfo":creation,"element":["urn:spdx:artifact","urn:spdx:package","urn:spdx:relationship"],
             "rootElement":["urn:spdx:package"],"spdxId":"urn:spdx:document","type":"SpdxDocument"},
            {"creationInfo":creation,"name":"release","spdxId":"urn:spdx:package","type":"software_Package"},
            {"creationInfo":creation,"from":"urn:spdx:package","relationshipType":"contains",
             "spdxId":"urn:spdx:relationship","to":[target],"type":"Relationship"}
        ]
    })
}

fn provenance_statement(subject: Value) -> Value {
    serde_json::json!({
        "_type":"https://in-toto.io/Statement/v1",
        "predicate":{
            "buildDefinition":{
                "buildType":"https://uor.foundation/prismpm/build/v1",
                "externalParameters":{},"internalParameters":{},"resolvedDependencies":[]
            },
            "runDetails":{"builder":{"id":"https://github.com/UOR-Foundation/PrismPM"}}
        },
        "predicateType":"https://slsa.dev/provenance/v1",
        "subject":subject
    })
}

fn verify_supply_chain(id: &str) {
    match id {
        "SC-01" => {
            let evidence = upstream(&repo_root());
            assert!(evidence.spdx.positive >= 2);
            assert!(evidence.spdx.negative > 0);
            assert!(evidence.spdx.planted_rejections > 0);
        }
        "SC-02" => {
            let evidence = upstream(&repo_root());
            assert_eq!(evidence.in_toto.positive, 1);
            assert_eq!(evidence.in_toto.negative, 1);
            assert_eq!(evidence.in_toto.planted_rejections, 1);
            assert_eq!(
                evidence.in_toto.semantic_validation,
                "consumer-policy-required-by-upstream"
            );
            let subject = serde_json::json!([{
                "digest":{"sha256":"a".repeat(64)},"name":"product"
            }]);
            assert!(prismpm::authority::intoto_policy_accepts(
                &provenance_statement(subject)
            ));
            assert!(!prismpm::authority::intoto_policy_accepts(
                &provenance_statement(serde_json::json!([]))
            ));
        }
        "SC-03" => {
            let subject = serde_json::json!([{
                "digest":{"sha256":"a".repeat(64)},"name":"product"
            }]);
            let accepted = provenance_statement(subject);
            assert!(prismpm::authority::intoto_policy_accepts(&accepted));
            let mut wrong = accepted;
            wrong["subject"][0]
                .as_object_mut()
                .unwrap()
                .remove("digest");
            assert!(!prismpm::authority::intoto_policy_accepts(&wrong));
        }
        "SC-04" => {
            let valid = serde_json::json!({"vulnerabilities":[]});
            assert!(oracle_accepts("osv", &valid));
            let stale_shape = serde_json::json!({"vulnerabilities":[{"id":1}]});
            assert!(!oracle_accepts("osv", &stale_shape));
        }
        "SC-05" => {
            let model = operations_model();
            let mut evidence = serde_json::json!({
                "authorization":"Bearer planted", "safe":"secret://external/reference"
            });
            prismpm::operations::redact(&model, &mut evidence).unwrap();
            assert_eq!(evidence["authorization"], "[REDACTED]");
            assert_eq!(evidence["safe"], "secret://external/reference");
        }
        "SC-06" => {
            let fixture = oci_fixture();
            let store = prismpm::oci::Store::open(&fixture.root).unwrap();
            let mut wrong_subject = fixture.descriptor.clone();
            wrong_subject.digest = format!("sha256:{}", "f".repeat(64));
            assert_eq!(store.read(&wrong_subject).unwrap_err().code, "PP6101");
            assert!(prismpm::oci::attach_referrer(
                &fixture.root,
                &wrong_subject.digest,
                prismpm::oci::INTOTO,
                b"{}",
            )
            .is_err());
        }
        _ => unreachable!(),
    }
}

fn template_fixture() -> tempfile::TempDir {
    let temp = tempfile::tempdir().unwrap();
    for directory in [".devcontainer", ".github/workflows"] {
        std::fs::create_dir_all(temp.path().join(directory)).unwrap();
    }
    let required = serde_json::json!([
        ".devcontainer/devcontainer.json",
        ".github/workflows/bootstrap.yml",
        "AGENTS.md",
        "CONFORMANCE.md",
        "VERIFICATION.md",
        "prismpm.lock",
        "template-contract.json",
        "template.lock"
    ]);
    let universal = serde_json::json!([
        ".devcontainer/devcontainer.json",
        ".github/workflows/bootstrap.yml",
        "AGENTS.md",
        "VERIFICATION.md",
        "prismpm.lock",
        "template-contract.json",
        "template.lock"
    ]);
    let contract = serde_json::json!({
        "project_content_paths":["CONFORMANCE.md"],
        "required_paths":required,
        "schema":"uor/template-contract/1",
        "universal_policy_paths":universal,
        "version":"1.0.0"
    });
    let contract_bytes = prismpm::holo::canonical::encode_value(&contract).unwrap();
    std::fs::write(temp.path().join("template-contract.json"), &contract_bytes).unwrap();
    write_sdk_lock(temp.path());
    std::fs::write(temp.path().join(".devcontainer/devcontainer.json"), b"{}").unwrap();
    std::fs::write(
        temp.path().join(".github/workflows/bootstrap.yml"),
        b"uses: actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683\n",
    )
    .unwrap();
    for name in ["AGENTS.md", "CONFORMANCE.md", "VERIFICATION.md"] {
        std::fs::write(temp.path().join(name), b"contract fixture\n").unwrap();
    }
    std::fs::write(temp.path().join("Justfile"), b"model-write:\n    @true\n").unwrap();
    let sdk_image = sdk_lock_value()["sdk_image"].as_str().unwrap().to_owned();
    let contract_digest = format!("sha256:{}", sha256(&contract_bytes));
    let policy_files = [
        ".devcontainer/devcontainer.json",
        ".github/workflows/bootstrap.yml",
        "AGENTS.md",
        "VERIFICATION.md",
        "prismpm.lock",
        "template-contract.json",
    ]
    .into_iter()
    .map(|path| {
        serde_json::json!({
            "path":path,
            "sha256":format!("sha256:{}",sha256(&std::fs::read(temp.path().join(path)).unwrap()))
        })
    })
    .collect::<Vec<_>>();
    let policy_tree_sha256 = format!(
        "sha256:{}",
        sha256(
            &prismpm::holo::canonical::encode_value(&Value::Array(policy_files.clone())).unwrap()
        )
    );
    let lock = serde_json::json!({
        "contract_digest":contract_digest,
        "policy_files":policy_files,
        "policy_tree_sha256":policy_tree_sha256,
        "schema":"uor/template-lock/1",
        "sdk_image":sdk_image,
        "template_repository":"https://github.com/UOR-Foundation/template",
        "template_revision":"a".repeat(40)
    });
    std::fs::write(
        temp.path().join("template.lock"),
        prismpm::holo::canonical::encode_value(&lock).unwrap(),
    )
    .unwrap();
    temp
}

fn verify_template(root: &Path, id: &str) {
    let temp = template_fixture();
    match id {
        "TM-01" => {
            let result = prismpm::template::check(temp.path()).unwrap();
            assert_eq!(result["status"], "passed");
            std::fs::write(
                temp.path().join("Justfile"),
                b"model-write:\n    @printf 'stale\\n' > CONFORMANCE.md\n",
            )
            .unwrap();
            assert_eq!(
                prismpm::template::check(temp.path()).unwrap_err().code,
                "PP1101"
            );
            std::fs::write(temp.path().join("Justfile"), b"model-write:\n    @true\n").unwrap();
            let mut contract: Value = serde_json::from_slice(
                &std::fs::read(temp.path().join("template-contract.json")).unwrap(),
            )
            .unwrap();
            contract["required_paths"].as_array_mut().unwrap().pop();
            std::fs::write(
                temp.path().join("template-contract.json"),
                prismpm::holo::canonical::encode_value(&contract).unwrap(),
            )
            .unwrap();
            assert_eq!(
                prismpm::template::check(temp.path()).unwrap_err().code,
                "PP1101"
            );
        }
        "TM-02" => {
            assert!(prismpm::template::check(temp.path()).is_ok());
            std::fs::write(
                temp.path().join(".devcontainer/devcontainer.json"),
                b"{\"features\":{}}",
            )
            .unwrap();
            assert_eq!(
                prismpm::template::check(temp.path()).unwrap_err().code,
                "PP1101"
            );
        }
        "TM-03" => {
            verify_node_suite(
                root,
                id,
                &["action/entrypoint.test.mjs", "scripts/ci-capacity.test.mjs"],
                29,
                "120000",
            );
            assert!(prismpm::template::check(temp.path()).is_ok());
            std::fs::write(
                temp.path().join(".github/workflows/bootstrap.yml"),
                b"uses: actions/checkout@main\n",
            )
            .unwrap();
            assert_eq!(
                prismpm::template::check(temp.path()).unwrap_err().code,
                "PP1101"
            );
        }
        "TM-04" => {
            let checked = prismpm::template::check(temp.path()).unwrap();
            assert_eq!(checked["sdk_image"], sdk_lock_value()["sdk_image"]);
            assert!(checked["template_revision"]
                .as_str()
                .is_some_and(|value| value.len() == 40));
        }
        "TM-05" => {
            let before = tree(temp.path());
            let update = prismpm::template::update(
                temp.path(),
                &format!(
                    "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                    "5".repeat(64)
                ),
                &"b".repeat(40),
            )
            .unwrap();
            assert_eq!(
                tree(temp.path()),
                before,
                "template update mutated the project"
            );
            assert_eq!(update["changed"], true);
            assert!(update["patch"]
                .as_str()
                .unwrap()
                .contains("+++ b/template.lock"));
        }
        "TM-06" => {
            assert!(prismpm::template::check(temp.path()).is_ok());
            assert_eq!(
                prismpm::template::update(
                    temp.path(),
                    "ghcr.io/uor-foundation/prismpm-sdk:latest",
                    &"b".repeat(40)
                )
                .unwrap_err()
                .code,
                "PP1101"
            );
        }
        _ => unreachable!(),
    }
}

fn verify_rp_01(root: &Path) {
    assert!(root.join("Cargo.toml").exists());
    assert!(root.join("crates/prismpm").exists());
    assert!(root.join("crates/model").exists());
    assert!(root.join("crates/conformance").exists());
    assert!(root.join("xtask").exists());
    assert!(!root.join("src").exists());
    assert_contains(
        root,
        "Cargo.toml",
        &["[workspace]", "members = [\"crates/*\", \"xtask\"]"],
    );
}

fn verify_rp_02(root: &Path) {
    let rust_toolchain = std::fs::read_to_string(root.join("rust-toolchain.toml")).unwrap();
    assert!(rust_toolchain.contains("1.97.1"));
    let lean_toolchain = std::fs::read_to_string(root.join("lean-toolchain")).unwrap();
    assert!(lean_toolchain.contains("leanprover/lean4:v4.32.1"));
    assert_contains(
        root,
        "tools.lock",
        &["1.97.1", "v4.32.1", "4.2.3", "1.57.0", "0.20.2"],
    );
}

fn verify_rp_03(root: &Path) {
    let model = repo_model::Model::load(&root.join("model")).unwrap();
    model.check().unwrap();
}

fn verify_rp_04(root: &Path) {
    assert_contains(
        root,
        ".devcontainer/Dockerfile",
        &["rustup-init", "sha256sum -c", "leanprover/lean4:v4.32.1"],
    );
    let workflow = read(root, ".github/workflows/vv.yml");
    assert!(workflow.contains("actions/checkout@11bd71901bbe5b1630ceea73d27597364c9af683"));
    assert!(workflow.contains("runCmd: |"));
    assert_eq!(
        workflow.matches("just vv").count(),
        2,
        "the CI workflow must exercise repeatable verification"
    );
}

fn verify_rp_05(root: &Path) {
    let cargo_toml = std::fs::read_to_string(root.join("Cargo.toml")).unwrap();
    assert!(cargo_toml.contains("missing_docs = \"deny\""));
}

fn verify_rp_06(root: &Path) {
    let justfile = std::fs::read_to_string(root.join("Justfile")).unwrap();
    assert!(justfile.contains("vv:"));
}

fn verify_rp_07(root: &Path) {
    let spec = std::fs::read_to_string(root.join("SPEC.md")).unwrap();
    assert!(spec.contains("## Appendix A. Conformance ID Registry"));
}

fn verify_rp_08(root: &Path) {
    let report = crate::runner::scenarios_in(&root.join("features/suites")).unwrap();
    assert!(
        report.violations.is_empty(),
        "violations: {:?}",
        report.violations
    );
}

fn verify_rp_09(root: &Path) {
    let left = tempfile::tempdir().unwrap();
    let right = tempfile::tempdir().unwrap();
    copy_project(root, left.path());
    copy_project(root, right.path());
    let first = prismpm::Controller::load(left.path())
        .unwrap()
        .build(prismpm::controller::BuildRequest { config_path: None })
        .unwrap();
    let second = prismpm::Controller::load(right.path())
        .unwrap()
        .build(prismpm::controller::BuildRequest { config_path: None })
        .unwrap();
    assert_eq!(first.build_id, second.build_id);
    assert_eq!(
        tree(&left.path().join(".prism/build").join(&first.build_id)),
        tree(&right.path().join(".prism/build").join(&second.build_id))
    );
}

fn verify_rp_10(root: &Path) {
    let model = repo_model::Model::load(&root.join("model")).unwrap();
    let conformance = read(root, "CONFORMANCE.md");
    let errors = read(root, "ERRORS.md");
    assert!(model.ids.id.iter().all(|row| conformance.contains(&row.id)));
    assert!(model
        .errors
        .error
        .iter()
        .all(|row| errors.contains(&row.code)));
}

fn verify_rp_11(root: &Path) {
    assert_contains(
        root,
        "LICENSE-MIT",
        &["MIT License", "Permission is hereby granted"],
    );
    assert_contains(root, "LICENSE-APACHE", &["Apache License", "Version 2.0"]);
    assert_contains(root, "Cargo.toml", &["license = \"MIT OR Apache-2.0\""]);
}

fn verify_rp_12(root: &Path) {
    let source = std::fs::read_to_string(root.join("crates/model/src/release.rs")).unwrap();
    for criterion in [
        "vv-evidence.json",
        "release source tree is not clean",
        "coverage_state",
        "CHANGELOG.md",
    ] {
        assert!(
            source.contains(criterion),
            "missing release criterion {criterion}"
        );
    }
    let fixture = tempfile::tempdir().unwrap();
    for entry in walkdir::WalkDir::new(root.join("model")) {
        let entry = entry.unwrap();
        let suffix = entry.path().strip_prefix(root).unwrap();
        let target = fixture.path().join(suffix);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(target).unwrap();
        } else if entry.file_type().is_file() {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
    for relative in ["Cargo.toml", "CHANGELOG.md"] {
        std::fs::copy(root.join(relative), fixture.path().join(relative)).unwrap();
    }
    for args in [
        &["init", "--quiet"][..],
        &["config", "user.name", "PrismPM conformance"][..],
        &["config", "user.email", "conformance@example.invalid"][..],
        &["add", "."][..],
        &["commit", "--quiet", "-m", "release fixture"][..],
    ] {
        let status = Command::new("git")
            .args(args)
            .current_dir(fixture.path())
            .status()
            .unwrap();
        assert!(status.success(), "git {} failed", args.join(" "));
    }
    std::fs::write(fixture.path().join("dirty.fixture"), b"dirty\n").unwrap();

    let issues = repo_model::release::check(fixture.path(), &[])
        .expect_err("the local untagged, dirty, missing-evidence fixture must be refused");
    assert!(issues.iter().any(|issue| issue.contains("not clean")));
    assert!(issues.iter().any(|issue| issue.contains("not tagged")));
    assert!(issues.iter().any(|issue| issue.contains("evidence")));
}

fn verify_facets(root: &Path, id: &str) {
    match id {
        "FT-01" => assert_declarations(
            root,
            "Foundation.Arch",
            &[
                "Component",
                "Edge",
                "Stakeholder",
                "Concern",
                "Viewpoint",
                "View",
            ],
        ),
        "FT-02" => assert_declarations(root, "Foundation.Sec", &["Asset", "SecurityActivity"]),
        "FT-03" => assert_declarations(
            root,
            "Foundation.Sec",
            &["ApplicationSecurityControl", "VerificationMeasurement"],
        ),
        "FT-04" => assert_declarations(
            root,
            "Foundation.Sec",
            &["Threat", "Risk", "Likelihood", "Impact"],
        ),
        "FT-05" => assert_declarations(
            root,
            "Foundation.Qual",
            &[
                "ProductQualityCharacteristic",
                "QualitySubcharacteristic",
                "QualityRequirement",
                "QualityMeasure",
            ],
        ),
        "FT-06" => {
            for package in ["prism.arch", "prism.sec", "prism.qual"] {
                assert_contains(
                    root,
                    &format!("language/{package}/lexicon.toml"),
                    &["spec = \"lexlean/lexicon/1\"", "language = \"1.1\""],
                );
                for entry in
                    walkdir::WalkDir::new(root.join("language").join(package).join("entries"))
                {
                    let entry = entry.unwrap();
                    if entry.path().extension().and_then(|value| value.to_str()) == Some("toml") {
                        let source = std::fs::read_to_string(entry.path()).unwrap();
                        for field in ["[denotation]", "[[form]]", "canonical_source = true"] {
                            assert!(
                                source.contains(field),
                                "{} lacks {field}",
                                entry.path().display()
                            );
                        }
                    }
                }
            }
        }
        "FT-07" => {
            assert_contains(
                root,
                "language/prism.sec/lexicon.toml",
                &["prism.arch@1.0.0"],
            );
            assert_contains(
                root,
                "language/prism.qual/lexicon.toml",
                &["prism.arch@1.0.0"],
            );
            assert!(!read(root, "language/prism.arch/lexicon.toml").contains("prism.sec"));
        }
        "FT-08" => {
            let standards = read(root, "model/standards.toml");
            for entry in walkdir::WalkDir::new(root.join("language")) {
                let entry = entry.unwrap();
                if entry.path().extension().and_then(|value| value.to_str()) == Some("toml")
                    && entry
                        .path()
                        .components()
                        .any(|part| part.as_os_str() == "entries")
                {
                    let value: toml::Value =
                        toml::from_str(&std::fs::read_to_string(entry.path()).unwrap()).unwrap();
                    let entry_id = value["id"].as_str().unwrap();
                    assert!(
                        standards.contains(&format!("\"{entry_id}\"")),
                        "unmapped entry {entry_id}"
                    );
                }
            }
        }
        "FT-09" => {
            let manifest = build_manifest(root);
            let outputs = manifest["files"]
                .as_array()
                .or_else(|| manifest["outputs"].as_array())
                .expect("build outputs");
            assert!(outputs
                .iter()
                .any(|row| row["kind"].as_str() == Some("lean")));
            assert!(outputs
                .iter()
                .any(|row| matches!(row["kind"].as_str(), Some("latex" | "tex"))));
        }
        "FT-10" => {
            assert_contains(
                root,
                "lexlean.lock",
                &[
                    "language = \"1.1\"",
                    "prism.arch",
                    "prism.sec",
                    "prism.qual",
                ],
            );
            assert_contains(root, "Justfile", &["repro"]);
        }
        _ => unreachable!(),
    }
}

// This corpus exercises the owning report validator, not a simulated browser.
// The ordinary application verification gate separately runs actual Chromium.
fn verify_portable_view_report(root: &Path) {
    let document: prismpm::holo::ModelDocument =
        serde_json::from_value(json(&root.join("tests/data/text-model-document.json"))).unwrap();
    prismpm::holo::validate::validate(&document).unwrap();
    let application = document.application.as_ref().unwrap();
    let identities = serde_json::json!({
        "application_kappa":format!("blake3:{}", "a".repeat(64)),
        "archive_fingerprint":"b".repeat(64),
        "archive_kappa":format!("blake3:{}", "c".repeat(64))
    });
    let cases = [
        "attachment-assets",
        "modeled-vectors",
        "input-validation-recovery",
        "transport-failure-recovery",
        "pre-init-privacy",
        "delayed-init",
        "intent-boundaries",
        "text-response-bounds",
        "text-safe-rendering",
        "detached-session",
    ]
    .into_iter()
    .map(|name| serde_json::json!({"name":name,"status":"passed","attempts":1}))
    .collect::<Vec<_>>();
    let report = serde_json::json!({
        "application_kappa":format!("blake3:{}", "a".repeat(64)),
        "archive_fingerprint":"b".repeat(64),
        "archive_kappa":format!("blake3:{}", "c".repeat(64)),
        "direct_vectors":6,
        "footer_verified":true,
        "guest_allocation_boundary":"verified",
        "intent_vectors":5,
        "portable_browser":{
            "schema":"prismpm/portable-browser-oracle/1",
            "profile":"utf8-text",
            "engine":"chromium",
            "browser_version":"151.0.7922.34",
            "playwright":"1.62.1",
            "cases":cases,
            "vector_indexes":[0,2,3],
            "skipped":0,
            "retries":0,
            "status":"passed"
        },
        "resident_vectors":6,
        "schema":"prismpm/hologram-oracle/2",
        "view_attached":1,
        "view_detached":1
    });
    let validate = prismpm::upstream_conformance::validate_hologram_oracle_report;
    validate(&report, application, &identities).unwrap();
    let reject = |bad: &Value| {
        assert_eq!(
            validate(bad, application, &identities).unwrap_err().code,
            "PP5301"
        );
    };
    for field in ["application_kappa", "archive_fingerprint", "archive_kappa"] {
        let different = if field == "archive_fingerprint" {
            "d".repeat(64)
        } else {
            format!("blake3:{}", "d".repeat(64))
        };
        let mut substituted_report = report.clone();
        substituted_report[field] = serde_json::json!(different);
        reject(&substituted_report);
        let mut substituted_build = identities.clone();
        substituted_build[field] = serde_json::json!(different);
        assert_eq!(
            validate(&report, application, &substituted_build)
                .unwrap_err()
                .code,
            "PP5301"
        );
    }
    reject(&serde_json::json!({
        "schema":"prismpm/hologram-oracle/1",
        "footer_verified":true
    }));
    for pointer in ["", "/portable_browser", "/portable_browser/cases/0"] {
        for field in report.pointer(pointer).unwrap().as_object().unwrap().keys() {
            let mut bad = report.clone();
            bad.pointer_mut(pointer)
                .unwrap()
                .as_object_mut()
                .unwrap()
                .remove(field);
            reject(&bad);
        }
        let mut bad = report.clone();
        bad.pointer_mut(pointer)
            .unwrap()
            .as_object_mut()
            .unwrap()
            .insert("extra".to_owned(), serde_json::json!(true));
        reject(&bad);
    }
    for (pointer, value) in [
        ("/schema", serde_json::json!("prismpm/hologram-oracle/1")),
        ("/application_kappa", serde_json::json!("blake3:abc")),
        (
            "/archive_kappa",
            serde_json::json!(format!("blake3:{}", "A".repeat(64))),
        ),
        (
            "/archive_fingerprint",
            serde_json::json!(format!("blake3:{}", "b".repeat(64))),
        ),
        ("/footer_verified", serde_json::json!(false)),
        ("/guest_allocation_boundary", serde_json::json!("missing")),
        ("/direct_vectors", serde_json::json!(5)),
        ("/intent_vectors", serde_json::json!(6)),
        ("/resident_vectors", serde_json::json!(5)),
        ("/view_attached", serde_json::json!(2)),
        ("/view_detached", serde_json::json!(0)),
        (
            "/portable_browser/profile",
            serde_json::json!("legacy-numeric"),
        ),
        ("/portable_browser/engine", serde_json::json!("webkit")),
        (
            "/portable_browser/browser_version",
            serde_json::json!("151.0.7922.35"),
        ),
        ("/portable_browser/playwright", serde_json::json!("1.62.0")),
        ("/portable_browser/skipped", serde_json::json!(1)),
        ("/portable_browser/retries", serde_json::json!(1)),
        ("/portable_browser/status", serde_json::json!("failed")),
        (
            "/portable_browser/cases/0/status",
            serde_json::json!("failed"),
        ),
        ("/portable_browser/cases/0/attempts", serde_json::json!(2)),
        ("/portable_browser/vector_indexes", serde_json::json!([0])),
        (
            "/portable_browser/vector_indexes",
            serde_json::json!([0, 0, 2, 3]),
        ),
        (
            "/portable_browser/vector_indexes",
            serde_json::json!([3, 2, 0]),
        ),
        (
            "/portable_browser/vector_indexes",
            serde_json::json!([0, 1, 2, 3]),
        ),
    ] {
        let mut bad = report.clone();
        *bad.pointer_mut(pointer).unwrap() = value;
        reject(&bad);
    }
    let mut missing = report.clone();
    missing["portable_browser"]["cases"]
        .as_array_mut()
        .unwrap()
        .pop();
    reject(&missing);
    let mut reordered = report.clone();
    reordered["portable_browser"]["cases"]
        .as_array_mut()
        .unwrap()
        .swap(0, 1);
    reject(&reordered);
    let mut changed_application = application.clone();
    let prismpm::holo::model_document::Application::Text(text) = &mut changed_application else {
        panic!("the HO-12 report fixture must retain the text profile");
    };
    text.request_maximum = 2;
    assert_eq!(
        validate(&report, &changed_application, &identities)
            .unwrap_err()
            .code,
        "PP5301"
    );
    // Generic models retain u32 caps, but this pinned portable target must
    // reject incompatible declared bounds before invoking or allocating them.
    for (request, response) in [
        (65_537, application.response_maximum()),
        (u32::MAX, application.response_maximum()),
        (application.request_maximum(), 1_048_577),
        (application.request_maximum(), u32::MAX),
    ] {
        let mut incompatible = application.clone();
        let prismpm::holo::model_document::Application::Text(text) = &mut incompatible else {
            panic!("the HO-12 report fixture must retain the text profile");
        };
        text.request_maximum = request;
        text.response_maximum = response;
        for candidate in [&report, &serde_json::Value::Null] {
            let error = validate(candidate, &incompatible, &identities).unwrap_err();
            assert_eq!(error.code, "PP5301");
            assert!(error
                .to_string()
                .contains("application bounds exceed pinned portable View"));
        }
    }
}

fn verify_holo(root: &Path, id: &str) {
    if id == "HO-12" {
        verify_portable_view_report(root);
        return;
    }
    if id == "HO-11" {
        for relative in [
            "tests/fixtures/holo/ho-11-text-application",
            "tests/negative/text-application/bad-profile",
        ] {
            crate::fixtures::check(&root.join(relative))
                .expect("the complete text source fixture matches its declared outcome");
        }
        let value = json(&root.join("tests/data/text-model-document.json"));
        let document: prismpm::holo::ModelDocument = serde_json::from_value(value.clone()).unwrap();
        let bytes = prismpm::holo::canonical::encode_canonical(&document).unwrap();
        assert_eq!(
            prismpm::holo::canonical::decode_canonical(&bytes).unwrap(),
            document
        );
        prismpm::contracts::CanonicalDocument::from_value(
            "prismpm/model-document/2",
            value.clone(),
        )
        .unwrap();
        for (pointer, replacement, code) in [
            (
                "/schema",
                serde_json::json!("prismpm/model-document/1"),
                "PP4004",
            ),
            (
                "/application/profile",
                serde_json::json!("prismpm/text-application/2"),
                "PP2009",
            ),
            (
                "/application/request_maximum",
                serde_json::json!(0),
                "PP2009",
            ),
            (
                "/application/library_roots",
                serde_json::json!([]),
                "PP2009",
            ),
            (
                "/application/acceptance_vectors/0/response",
                serde_json::json!([255]),
                "PP2009",
            ),
        ] {
            let mut bad = value.clone();
            *bad.pointer_mut(pointer).unwrap() = replacement;
            let bad: prismpm::holo::ModelDocument = serde_json::from_value(bad).unwrap();
            assert_eq!(
                prismpm::holo::validate::validate(&bad).unwrap_err().code,
                code
            );
        }
        let mut bad = value;
        bad["application"]["view"]["operation_type"] = serde_json::json!("Invented");
        assert!(serde_json::from_value::<prismpm::holo::ModelDocument>(bad).is_err());
        return;
    }
    let document = model(root);
    let bytes = model_bytes(root);
    match id {
        "HO-01" => {
            let holo = sample_application_holo(root);
            assert_eq!(&holo.bytes[..6], b"HOLO\x04\0");
            prismpm::holo::archive::validate_application(&holo.bytes).unwrap();
        }
        "HO-02" => {
            assert_eq!(document["schema"], "prismpm/model-document/1");
            let _: prismpm::holo::model_document::ModelDocument =
                serde_json::from_slice(&bytes).unwrap();
            let schema = json(&root.join("schemas/model-document.schema.json"));
            assert_eq!(schema["$id"], "prismpm/model-document/1");
        }
        "HO-03" => {
            assert!(!bytes.ends_with(b"\n"));
            assert_eq!(
                prismpm::holo::canonical::encode_value(&document).unwrap(),
                bytes
            );
            assert_eq!(checked(root).model_id, sha256(&bytes));
        }
        "HO-04" => {
            assert_eq!(
                document["provenance"]["snapshot_id"].as_str().unwrap(),
                sha256(&std::fs::read(build_root(root).join("lexlean/snapshot.json")).unwrap())
            );
            assert_eq!(
                document["provenance"]["semantic_id"],
                snapshot(root)["semantic_id"]
            );
        }
        "HO-05" => {
            for section in ["architecture", "security", "quality"] {
                for rows in document[section].as_object().unwrap().values() {
                    assert_indexed(rows);
                }
            }
        }
        "HO-06" => {
            let text = std::str::from_utf8(&bytes).unwrap();
            for forbidden in [
                root.to_string_lossy().as_ref(),
                "/workspaces/",
                "timestamp",
                "hostname",
            ] {
                assert!(
                    !text.contains(forbidden),
                    "model document contains unstable value {forbidden}"
                );
            }
        }
        "HO-07" => {
            assert!(prismpm::holo::archive::validate_application(&bytes).is_err());
            let mut wrong_version = sample_application_holo(root).bytes;
            wrong_version[4] = 5;
            assert!(prismpm::holo::archive::validate_application(&wrong_version).is_err());
        }
        "HO-08" => {
            let emitter = document["provenance"]["emitter_semantics_id"]
                .as_str()
                .unwrap();
            assert_hex_digest(emitter);
            assert_contains(root, "model/emitter-inputs.toml", &[emitter]);
        }
        "HO-09" => {
            assert!(root
                .join("tests/golden/stdlib/build/model.prism.json")
                .exists());
            assert!(root
                .join("tests/golden/stdlib/golden-manifest.json")
                .exists());
            let files = crate::golden::read(&root.join("tests/golden/stdlib")).unwrap();
            crate::golden::compare(&files, &files).expect("complete source-bound golden integrity");
            let mut changed = files.clone();
            changed
                .iter_mut()
                .find(|(path, _)| path == "build/model.prism.json")
                .unwrap()
                .1
                .push(b' ');
            assert!(
                crate::golden::compare(&files, &changed).is_err(),
                "model drift cannot become golden caller variation"
            );
        }
        "HO-10" => {
            let holo = sample_application_holo(root);
            prismpm::holo::archive::validate_application(&holo.bytes).unwrap();
            let mut mutation = holo.bytes;
            let middle = mutation.len() / 2;
            mutation[middle] ^= 1;
            assert!(prismpm::holo::archive::validate_application(&mutation).is_err());
        }
        _ => unreachable!(),
    }
}

fn verify_controller(root: &Path, id: &str) {
    if id == "CT-11" {
        let project = tempfile::tempdir().unwrap();
        std::fs::copy(
            root.join("prismpm.toml"),
            project.path().join("prismpm.toml"),
        )
        .unwrap();
        std::fs::copy(
            root.join("lexlean.toml"),
            project.path().join("lexlean.toml"),
        )
        .unwrap();
        let output = project.path().join(".prism");
        std::fs::create_dir(&output).unwrap();
        std::fs::write(output.join("owned"), b"owned").unwrap();
        let controller = prismpm::Controller::load(project.path()).unwrap();
        let result = controller
            .clean(prismpm::controller::CleanRequest { config_path: None })
            .unwrap();
        assert_eq!(result.schema, "prismpm/clean-result/1");
        assert_eq!(result.removed, ".prism");
        assert!(!output.exists());

        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("preserved"), b"outside").unwrap();
        #[cfg(unix)]
        std::os::unix::fs::symlink(outside.path(), &output).unwrap();
        #[cfg(not(unix))]
        panic!("CT-11 is normative on the supported Unix host");
        let error = controller
            .clean(prismpm::controller::CleanRequest { config_path: None })
            .unwrap_err();
        assert_eq!(error.code, "PP8001");
        assert!(outside.path().join("preserved").exists());
        return;
    }
    match id {
        "CT-01" => {
            let _: prismpm::controller::CheckRequest =
                prismpm::controller::CheckRequest { config_path: None };
            let _: prismpm::controller::BuildRequest =
                prismpm::controller::BuildRequest { config_path: None };
            assert_eq!(checked(root).schema, "prismpm/check-result/1");
            assert_eq!(built(root).schema, "prismpm/build-result/1");
        }
        "CT-02" => assert_contains(
            root,
            "crates/prismpm/src/controller/mod.rs",
            &["Engine", ".snapshot(", ".build("],
        ),
        "CT-03" => {
            let result = checked(root);
            assert_hex_digest(&result.snapshot_id);
            assert_hex_digest(&result.model_id);
        }
        "CT-04" => {
            let result = built(root);
            assert_eq!(
                build_root(root),
                root.join(&result.manifest_path).parent().unwrap()
            );
            assert!(build_root(root).join("manifest.json").exists());
        }
        "CT-05" => assert_contains(
            root,
            "crates/prismpm/src/cli.rs",
            &[
                "encode_value",
                "Commands::Check",
                "Commands::Build",
                "Commands::Verify",
            ],
        ),
        "CT-06" => assert_contains(
            root,
            "prismpm.toml",
            &["max_holo_bytes", "max_entities", "max_diagnostics"],
        ),
        "CT-07" => {
            let errors = read(root, "model/errors.toml");
            for code in [
                "PP1001", "PP2001", "PP3001", "PP4001", "PP5001", "PP8001", "PP9001",
            ] {
                assert!(errors.contains(code), "missing diagnostic range {code}");
            }
        }
        "CT-08" => assert!(!read(root, "crates/prismpm/src/controller/mod.rs").contains("reqwest")),
        "CT-09" => {
            let config: toml::Value = toml::from_str(&read(root, "prismpm.toml")).unwrap();
            assert_eq!(config["spec"].as_str(), Some("prismpm/project/1"));
            assert!(root.join("schemas/project.schema.json").exists());
        }
        "CT-10" => assert_contains(root, "crates/prismpm/src/error.rs", &["causes", "LexLean"]),
        _ => unreachable!(),
    }
}

fn verify_stdlib(root: &Path, id: &str) {
    match id {
        "ST-01" => assert_declarations(
            root,
            "Foundation.Arch",
            &[
                "StandardReference",
                "Component",
                "Edge",
                "ViewpointClass",
                "ViewClass",
            ],
        ),
        "ST-02" => assert_declarations(
            root,
            "Foundation.Sec",
            &[
                "Asset",
                "ApplicationSecurityControl",
                "SecurityActivity",
                "VerificationMeasurement",
            ],
        ),
        "ST-03" => assert_declarations(
            root,
            "Foundation.Sec",
            &["Threat", "Risk", "Likelihood", "Impact"],
        ),
        "ST-04" => assert_declarations(
            root,
            "Foundation.Qual",
            &[
                "ProductQualityCharacteristic",
                "QualitySubcharacteristic",
                "QualityRequirement",
                "QualityMeasure",
            ],
        ),
        "ST-05" => {
            for entry in walkdir::WalkDir::new(root.join("stdlib")) {
                let entry = entry.unwrap();
                assert_ne!(
                    entry.path().extension().and_then(|value| value.to_str()),
                    Some("lean"),
                    "handwritten Lean: {}",
                    entry.path().display()
                );
                assert_ne!(entry.file_name().to_str(), Some("lakefile.lean"));
            }
        }
        "ST-06" => {
            assert_declarations(root, "Foundation.Arch", &["edgeIngress", "edgeReturnCycle"]);
            assert!(root.join("tests/negative/dangling-edge/case.toml").exists());
        }
        "ST-07" => {
            assert_prism_theorems_axiom_free(root);
        }
        "ST-08" => {
            let roots = json(&verified_root(root).join("roots.json"));
            let model = repo_model::Model::load(&root.join("model")).expect("registered exports");
            let exports = model
                .stdlib_exports
                .union_with_runtime(&model.runtime_roots.roots)
                .expect("canonical export union");
            assert_eq!(roots["requested_roots"], serde_json::json!(exports));
            let manifest = verification_manifest(root);
            assert_eq!(roots["requested_roots"], manifest["export_roots"]);
            assert_eq!(
                manifest["runtime_roots"],
                serde_json::json!(model.runtime_roots.roots)
            );
            assert_eq!(
                manifest["package_export_roots"],
                serde_json::json!(model
                    .stdlib_exports
                    .export
                    .iter()
                    .map(|row| &row.lean_name)
                    .collect::<Vec<_>>())
            );
        }
        "ST-09" => {
            let golden = root.join("tests/golden/stdlib");
            for path in [
                "build/model.prism.json",
                "build/manifest.json",
                "build/lexlean/snapshot.json",
                "golden-manifest.json",
            ] {
                assert!(golden.join(path).exists(), "missing golden {path}");
            }
            let files = crate::golden::read(&golden).unwrap();
            crate::golden::compare(&files, &files)
                .expect("complete retained verification integrity");
            let mut changed = files.clone();
            changed
                .iter_mut()
                .find(|(path, _)| path == "verified/lexlean-attestation.json")
                .unwrap()
                .1
                .push(b' ');
            assert!(
                crate::golden::compare(&files, &changed).is_err(),
                "raw attestation drift must be rejected before comparison"
            );
        }
        "ST-10" => {
            assert_eq!(verified(root).schema, "prismpm/verify-result/1");
            assert_eq!(model(root)["schema"], "prismpm/model-document/1");
        }
        _ => unreachable!(),
    }
}

fn verify_artifacts(root: &Path, id: &str) {
    let manifest = build_manifest(root);
    let bytes = std::fs::read(build_root(root).join("manifest.json")).unwrap();
    let outputs = manifest["files"]
        .as_array()
        .or_else(|| manifest["outputs"].as_array())
        .expect("build files");
    match id {
        "AR-01" => assert_eq!(
            build_root(root).file_name().unwrap().to_str(),
            Some(built(root).build_id.as_str())
        ),
        "AR-02" => {
            for row in outputs {
                assert!(row["path"].is_string() && row["kind"].is_string());
                assert!(row["byte_length"].is_u64());
                assert_hex_digest(row["sha256"].as_str().unwrap());
            }
        }
        "AR-03" => {
            assert_hex_digest(&built(root).build_id);
            for row in outputs {
                assert_hex_digest(row["sha256"].as_str().unwrap());
            }
        }
        "AR-04" => {
            let text = std::str::from_utf8(&bytes).unwrap();
            assert!(!text.contains(root.to_string_lossy().as_ref()));
            assert!(!text.contains("timestamp"));
        }
        "AR-05" => assert_contains(
            root,
            "crates/prismpm/src/controller/mod.rs",
            &["rename", "staging"],
        ),
        "AR-06" => assert_contains(
            root,
            "crates/prismpm/src/controller/mod.rs",
            &["verify_existing"],
        ),
        "AR-07" => assert!(root.join("tests/negative/artifact").exists()),
        "AR-08" => {
            assert!(outputs
                .iter()
                .any(|row| row["kind"].as_str() == Some("lean")));
            assert!(outputs
                .iter()
                .any(|row| matches!(row["kind"].as_str(), Some("latex" | "tex"))));
        }
        "AR-09" => assert!(
            outputs
                .iter()
                .filter(|row| row["kind"].as_str() == Some("source-map"))
                .count()
                >= 5
        ),
        "AR-10" => assert!(
            outputs
                .iter()
                .filter(|row| row["kind"].as_str() == Some("coverage"))
                .count()
                >= 5
        ),
        _ => unreachable!(),
    }
}

fn verify_execution(root: &Path, id: &str) {
    let manifest = verification_manifest(root);
    let evidence = json(&verified_root(root).join("execution.json"));
    let coverage = json(&verified_root(root).join("coverage.json"));
    let roots = json(&verified_root(root).join("roots.json"));
    match id {
        "EX-01" => {
            assert_artifact(root, "kernel_ir", "kernel.ir");
            assert!(process_tools(root).contains("prod-export"));
        }
        "EX-02" => {
            for field in ["opaque_nodes", "unsupported_types", "external_calls"] {
                assert!(
                    coverage[field].as_array().is_some_and(Vec::is_empty),
                    "nonempty coverage {field}"
                );
            }
            assert_eq!(coverage["requested_roots"], roots["requested_roots"]);
        }
        "EX-03" => {
            assert_eq!(evidence["no_allocation"], true);
            assert_contains(
                root,
                "crates/prismpm/src/verification.rs",
                &["prod_alloc_counter", "allocation"],
            );
        }
        "EX-04" => {
            assert_eq!(model(root)["schema"], "prismpm/model-document/1");
            assert_contains(
                root,
                "crates/prismpm/src/verification.rs",
                &["decode_canonical", "normalize"],
            );
        }
        "EX-05" => {
            assert_eq!(evidence["status"], "passed");
            assert_eq!(manifest["execution"], evidence);
        }
        "EX-06" => {
            assert_eq!(evidence["case_count"], 597);
            assert_eq!(evidence["strategy"], "exhaustive-v1+lcg-v1");
            assert!(evidence["corpus_sha256"].is_string());
        }
        "EX-07" => {
            assert_eq!(evidence["seed"], "5eedcafef00dbeef");
            assert_eq!(evidence["bounds"]["max_length"], 16);
            assert_artifact(root, "execution_corpus", "execution-corpus.toml");
        }
        "EX-08" => assert_eq!(evidence["no_panic"], true),
        "EX-09" => assert!(roots["erased_proof_dependencies"].as_array().is_some()),
        "EX-10" => {
            assert_eq!(evidence["bounds"]["value_domain"], "u64");
            let corpus: toml::Value =
                toml::from_str(&read(root, "model/execution-corpus.toml")).unwrap();
            assert_eq!(
                corpus["property"]["generated_value_modulus"].as_integer(),
                Some(20)
            );
            assert_eq!(corpus["property"]["max_length"].as_integer(), Some(16));
        }
        _ => unreachable!(),
    }
}

fn verify_verification(root: &Path, id: &str) {
    let manifest = verification_manifest(root);
    let tools = process_tools(root);
    match id {
        "VR-01" => {
            assert!(tools.contains("lake-build-generated"));
            assert_contains(root, "lean-toolchain", &["leanprover/lean4:v4.32.1"]);
        }
        "VR-02" => {
            for row in manifest["processes"].as_array().unwrap() {
                assert!(row["argv"].is_array());
                assert_hex_digest(row["executable_sha256"].as_str().unwrap());
                assert_eq!(row["exit_code"], 0);
            }
        }
        "VR-03" => assert_contains(
            root,
            "crates/prismpm/src/verification.rs",
            &["tempdir", "lakefile.toml"],
        ),
        "VR-04" => assert!(tools.contains("leanchecker")),
        "VR-05" => assert_prism_theorems_axiom_free(root),
        "VR-06" => {
            assert_eq!(verified(root).schema, "prismpm/verify-result/1");
            assert_eq!(
                verified_root(root).file_name().unwrap().to_str(),
                Some(verified(root).attestation_id.as_str())
            );
        }
        "VR-07" => {
            let model_bytes = std::fs::read(build_root(root).join("model.prism.json")).unwrap();
            let holo_row = artifact(&manifest, "model");
            assert_eq!(holo_row["byte_length"], model_bytes.len() as u64);
            assert_eq!(holo_row["sha256"], sha256(&model_bytes));
            for (name, filename) in [
                ("execution_evidence", "execution.json"),
                ("kernel_ir", "kernel.ir"),
                ("generated_rust", "generated.rs"),
                ("lexlean_attestation", "lexlean-attestation.json"),
            ] {
                assert_artifact(root, name, filename);
            }
        }
        "VR-08" => assert_contains(
            root,
            "crates/prismpm/src/verification.rs",
            &["PP5002", "PP5003", "PP5004"],
        ),
        "VR-09" => assert!(!read(root, "crates/prismpm/src/verification.rs").contains("http")),
        "VR-10" => assert_contains(
            root,
            "crates/prismpm/src/verification.rs",
            &["timeout", "CHILD_OUTPUT_LIMIT"],
        ),
        "VR-11" => assert_contains(root, "VERIFICATION.md", &["Planted", "restoring commit"]),
        "VR-12" => {
            assert_hex_digest(&verified(root).attestation_id);
            assert_eq!(
                sha256(&std::fs::read(verified_root(root).join("manifest.json")).unwrap()),
                verified(root).attestation_id
            );
        }
        _ => unreachable!(),
    }
}

fn verify_security(root: &Path, id: &str) {
    match id {
        "SE-01" => assert_contains(
            root,
            "crates/prismpm/src/controller/mod.rs",
            &["confined", "output_root"],
        ),
        "SE-02" => {
            assert!(root.join("tests/negative/path").exists());
            assert_contains(root, "crates/prismpm/src/controller/mod.rs", &["symlink"]);
            assert_contains(root, "crates/prismpm/src/config.rs", &["ParentDir"]);
        }
        "SE-03" => {
            let source = read(root, "crates/prismpm/src/verification.rs");
            assert!(source.contains("Command::new"));
            assert!(!source.contains("sh -c"));
        }
        "SE-04" => assert_contains(
            root,
            "crates/prismpm/src/verification.rs",
            &["env_clear", "LC_ALL", "LANG"],
        ),
        "SE-05" => assert_contains(
            root,
            "crates/prismpm/src/controller/mod.rs",
            &["rename", "sync_all"],
        ),
        "SE-06" => {
            for relative in [
                "crates/prismpm/src/lib.rs",
                "crates/model/src/lib.rs",
                "crates/conformance/src/lib.rs",
            ] {
                assert_contains(root, relative, &["forbid(unsafe_code)"]);
            }
        }
        "SE-07" => {
            assert!(checked(root).entity_count > 0);
            assert_contains(
                root,
                "crates/prismpm/src/config.rs",
                &["max_holo_bytes", "max_entities", "max_diagnostics"],
            );
        }
        "SE-08" => {
            assert!(root.join("deny.toml").exists());
            assert_contains(root, "xtask/src/main.rs", &["deny", "--all-features"]);
        }
        _ => unreachable!(),
    }
}

#[cfg(test)]
mod node_suite_tests {
    use super::{required, verify_node_suite};

    #[test]
    fn owning_node_gate_rejects_a_partially_missing_selected_file() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("present.mjs"),
            "import {test} from 'node:test'; for(let i=0;i<11;i++)test('case '+i,()=>{});",
        )
        .unwrap();
        assert!(std::panic::catch_unwind(|| {
            verify_node_suite(
                root.path(),
                "TM-03",
                &["present.mjs", "missing.mjs"],
                11,
                "5000",
            );
        })
        .is_err());
        std::fs::write(
            root.path().join("missing.mjs"),
            "import {test} from 'node:test'; test('restored',()=>{});",
        )
        .unwrap();
        verify_node_suite(
            root.path(),
            "TM-03",
            &["present.mjs", "missing.mjs"],
            11,
            "5000",
        );
    }

    #[test]
    fn owning_node_gate_rejects_an_empty_selected_file_beside_a_complete_sibling() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(
            root.path().join("present.mjs"),
            "import {test} from 'node:test'; for(let i=0;i<11;i++)test('case '+i,()=>{});",
        )
        .unwrap();
        std::fs::write(root.path().join("empty.mjs"), "").unwrap();
        assert!(std::panic::catch_unwind(|| {
            verify_node_suite(
                root.path(),
                "TM-03",
                &["present.mjs", "empty.mjs"],
                11,
                "5000",
            );
        })
        .is_err());
        std::fs::write(
            root.path().join("empty.mjs"),
            "import {test} from 'node:test'; test('restored',()=>{});",
        )
        .unwrap();
        verify_node_suite(
            root.path(),
            "TM-03",
            &["present.mjs", "empty.mjs"],
            11,
            "5000",
        );
    }

    #[test]
    fn cached_prism_diagnostic_preserves_the_original_structured_cause() {
        let mut error = prismpm::PrismError::new("PP5001", "LexLean verification failed");
        error.causes.push(prismpm::error::PrismCause {
            subsystem: "lexlean".to_owned(),
            code: "LL9001".to_owned(),
            message: "original child failure".to_owned(),
            primary: None,
            labels: Vec::new(),
            notes: vec![prismpm::error::PrismNote {
                message: "bounded child phase and observed exit".to_owned(),
                span: None,
            }],
            help: Vec::new(),
        });
        let cache = std::sync::OnceLock::<Result<(), prismpm::PrismError>>::new();
        for attempt in 0..2 {
            let panic = std::panic::catch_unwind(|| {
                required(
                    cache.get_or_init(|| {
                        assert_eq!(attempt, 0, "cached failure must not be recomputed");
                        Err(error.clone())
                    }),
                    "shared Prism verification",
                );
            })
            .unwrap_err();
            let message = panic.downcast_ref::<String>().unwrap();
            let encoded = message
                .strip_prefix("shared Prism verification failed: ")
                .unwrap();
            assert_eq!(
                serde_json::from_str::<prismpm::PrismError>(encoded).unwrap(),
                error
            );
            assert!(encoded.contains("original child failure"));
            assert!(encoded.contains("bounded child phase and observed exit"));
        }
        assert!(!error.to_string().contains("original child failure"));
    }

    #[test]
    fn owning_node_gate_rejects_incomplete_skipped_missing_and_timed_out_suites() {
        let root = tempfile::tempdir().unwrap();
        let suite = root.path().join("suite.mjs");
        let prefix = "import {test} from 'node:test';\n";
        let passed = "for(let i=0;i<11;i++)test('case '+i,()=>{});\n";
        std::fs::write(&suite, format!("{prefix}{passed}")).unwrap();
        verify_node_suite(root.path(), "TM-03", &["suite.mjs"], 11, "5000");

        for source in [
            "",
            "for(let i=0;i<10;i++)test('case '+i,()=>{});",
            "for(let i=0;i<11;i++)test('case '+i,{skip:i===0},()=>{});",
            "for(let i=0;i<11;i++)test('case '+i,{todo:i===0},()=>{});",
        ] {
            std::fs::write(&suite, format!("{prefix}{source}")).unwrap();
            assert!(std::panic::catch_unwind(|| {
                verify_node_suite(root.path(), "TM-03", &["suite.mjs"], 11, "5000");
            })
            .is_err());
        }
        assert!(std::panic::catch_unwind(|| {
            verify_node_suite(root.path(), "TM-03", &["missing.mjs"], 11, "5000");
        })
        .is_err());
        std::fs::write(
            &suite,
            format!("{prefix}test('deadline',()=>new Promise(resolve=>setTimeout(resolve,5000)));"),
        )
        .unwrap();
        assert!(std::panic::catch_unwind(|| {
            verify_node_suite(root.path(), "TM-03", &["suite.mjs"], 1, "100");
        })
        .is_err());
    }
}
