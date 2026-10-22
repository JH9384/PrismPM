//! Complete private construction from actual modeled artifacts and OCI replay.

use super::*;
use crate::controller::{BuildRequest, Controller, VerifyRequest};
use serde_json::json;
use std::io::Write;
use std::path::Path;

fn retain(root: &Path, name: &str, bytes: &[u8]) {
    let path = root.join(name);
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    let mut output = std::fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(path)
        .unwrap();
    output.write_all(bytes).unwrap();
    output.sync_all().unwrap();
}

fn fixture_binding(captured: &VerifiedReleaseCapture) -> sdk_source::FixtureSourceBinding {
    let snapshot: SemanticSnapshot =
        serde_json::from_slice(&captured.build_files["lexlean/snapshot.json"]).unwrap();
    sdk_source::FixtureSourceBinding::capture(&snapshot, "Production.BrowserSystem").unwrap()
}

fn attempt() -> factory::ConditionalAttempt {
    factory::ConditionalAttempt {
        instance: digest(b"OC-10 conditional fixture attempt"),
        revision: digest(b"OC-10 conditional publisher revision, not authentication")[..20]
            .to_vec(),
        reference: "refs/heads/conditional-fixture".into(),
    }
}

fn failed_source(
    source: tempfile::TempDir,
    output: &Path,
    phase: &str,
    error: crate::error::PrismError,
) -> ! {
    let retained = output.join("failed-producer-source");
    std::fs::rename(source.keep(), &retained).unwrap();
    retain(
        output,
        "capture-failure.json",
        &encode_value(
            &json!({"phase":phase,"code":error.code,"message":error.message,
            "complete_application_accepted":false}),
        )
        .unwrap(),
    );
    panic!(
        "actual {phase} failed; original source retained at {}: {error:?}",
        retained.display()
    );
}

fn graph_refusals(root: &Path, reference: &str, subjects: &[(String, Vec<u8>)]) -> Vec<Value> {
    let mut refused = Vec::new();
    for (role, original) in subjects {
        super::super::browser_export::capture(root, reference).unwrap();
        let path = root
            .join(".prism/oci/blobs/sha256")
            .join(content_id(original));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            *original,
            "actual captured {role}"
        );
        let mut changed = original.clone();
        assert!(!changed.is_empty());
        changed[0] ^= 1;
        std::fs::write(&path, &changed).unwrap();
        let observed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let error = super::super::browser_export::capture(root, reference)
                .err()
                .unwrap();
            assert_eq!(error.code, "PP6101", "changed {role}");
            assert!(
                matches!(
                    error.message.as_str(),
                    "OCI blob size or digest differs" | "OCI blob digest differs"
                ),
                "changed {role} must fail the actual digest check: {error:?}"
            );
            error
        }));
        std::fs::write(&path, original).unwrap();
        let error = observed.unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        refused.push(json!({"role":role,"defect":"changed","code":error.code}));
        super::super::browser_export::capture(root, reference).unwrap();
        let displaced = path.with_extension("conditional-missing");
        assert!(!displaced.exists());
        std::fs::rename(&path, &displaced).unwrap();
        let observed = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            let error = super::super::browser_export::capture(root, reference)
                .err()
                .unwrap();
            assert_eq!(error.code, "PP6101", "missing {role}");
            assert!(
                error
                    .message
                    .starts_with("browser export filesystem operation: ")
                    && error.message.contains("No such file or directory")
                    && error.message.contains("os error 2"),
                "missing {role} must fail the confined file read: {error:?}"
            );
            error
        }));
        std::fs::rename(&displaced, &path).unwrap();
        let error = observed.unwrap_or_else(|panic| std::panic::resume_unwind(panic));
        refused.push(json!({"role":role,"defect":"missing","code":error.code}));
        assert_eq!(
            std::fs::read(&path).unwrap(),
            *original,
            "restored actual {role}"
        );
        super::super::browser_export::capture(root, reference).unwrap();
    }
    super::super::browser_export::capture(root, reference).unwrap();
    refused
}

#[test]
fn actual_source_free_capture_constructs_complete_conditional_context() {
    // The complete Cargo gate runs in the tools container. This one test
    // requires the already-built immutable runtime; do not filter the gate,
    // copy an inventory into tools, or compile a second test executable.
    let _compiler = crate::test_compiler::acquire();
    if !Path::new("/etc/profile.d/prismpm-sdk.sh").exists()
        && !Path::new("/opt/prismpm/share/inventory.json").exists()
    {
        assert!(
            std::env::var_os("PRISMPM_OC10_SDK_CHILD").is_none(),
            "SDK child lost its installed inventory"
        );
        let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap();
        let result = std::process::Command::new("/usr/bin/python3")
            .args(["-I", "-B"])
            .arg(repository.join("scripts/conditional-capture-sdk.py"))
            .arg("parent")
            .arg(repository)
            .arg(std::env::current_exe().unwrap())
            .status()
            .expect("start the exact capture executable's immutable SDK owner");
        assert!(
            result.success(),
            "conditional SDK capture or its retirement failed"
        );
        return;
    }
    let started = std::time::Instant::now();
    let output = std::env::var_os("PRISMPM_OC10_CAPTURE_OUTPUT")
        .map(std::path::PathBuf::from)
        .unwrap_or_else(|| tempfile::tempdir().unwrap().keep());
    assert!(output.is_absolute());
    assert!(std::fs::read_dir(&output).unwrap().next().is_none());
    let inventory = crate::sdk::inventory_path().expect("actual installed SDK inventory required");
    assert_eq!(inventory, Path::new("/opt/prismpm/share/inventory.json"));
    let inventory = std::fs::read(inventory).unwrap();
    let executable = std::fs::read(std::env::current_exe().unwrap()).unwrap();
    let sdk_image =
        std::env::var("PRISMPM_TEST_SDK_IMAGE").expect("actual immutable oracle SDK required");
    super::super::validate_reference(&sdk_image, true).unwrap();
    retain(&output, "installed-sdk-inventory.json", &inventory);

    let source = Controller::publication_linkage_project();
    let measured = fixture_source::MeasuredFixtureSource::commit(source.path());
    let controller = Controller::load(source.path()).unwrap();
    eprintln!(
        "OC-10 actual fixture build started at {:?}",
        started.elapsed()
    );
    let built = match controller.build(BuildRequest { config_path: None }) {
        Ok(value) => value,
        Err(error) => failed_source(source, &output, "build", error),
    };
    eprintln!(
        "OC-10 actual fixture verification started at {:?}",
        started.elapsed()
    );
    let verified = match controller.verify(VerifyRequest { config_path: None }) {
        Ok(value) => value,
        Err(error) => failed_source(source, &output, "verification", error),
    };
    eprintln!(
        "OC-10 actual source-free release construction started at {:?}",
        started.elapsed()
    );
    assert_eq!(built.build_id, verified.build_id);
    measured.assert_unchanged(source.path());
    let release = tempfile::tempdir().unwrap();
    let (_, descriptor) = super::super::tests::measured_application_fixture(
        release.path(),
        "oc10",
        source.path(),
        &built,
        &verified,
        &measured,
    );
    let reference = format!("fixture.invalid/oc10@{}", descriptor.digest);
    let source_path = source.keep();
    std::fs::rename(&source_path, output.join("producer-source")).unwrap();
    assert!(
        !source_path.exists(),
        "capture cannot reread the original producer path"
    );
    let release_path = release.keep();
    std::fs::rename(&release_path, output.join("release")).unwrap();
    let release_path = output.join("release");
    let captured = super::super::browser_export::capture(&release_path, &reference).unwrap();
    let actual_sdk_lock = captured.sdk_lock.bytes().to_vec();
    assert_eq!(captured.sdk_lock.value()["sdk_image"], sdk_image);
    let installed: Value = serde_json::from_slice(&inventory).unwrap();
    let original_rows = installed["artifacts"].as_array().unwrap();
    let captured_rows = captured.sdk_lock.value()["inventory"].as_array().unwrap();
    for original in original_rows {
        assert_eq!(
            captured_rows
                .iter()
                .filter(|row| row["id"] == original["id"])
                .collect::<Vec<_>>(),
            [original]
        );
    }
    assert_eq!(
        captured_rows.len(),
        original_rows.len() + 1,
        "only the actual immutable image row is added"
    );
    let installed_context = factory::construct(
        super::super::browser_export::capture(&release_path, &reference).unwrap(),
        attempt(),
    );
    let installed_source_matches = installed_context.is_ok();
    if let Err(error) = &installed_context {
        assert_eq!(error.code, "PP6101");
        assert!(
            error
                .message
                .contains("captured SDK does not bind this exact source archive"),
            "{error:?}"
        );
    }
    let binding = fixture_binding(&captured);
    let fixture_archive = binding.archive.clone();
    let prepared = prepare_bound(&captured, &SourceBinding::Fixture(binding)).unwrap();
    let metadata = metadata::request(&captured, &prepared).unwrap();
    let measured_identity = measured.identity();
    assert_eq!(
        (
            prepared.producer.as_str(),
            prepared.source_revision.as_slice()
        ),
        (
            measured_identity.0.as_str(),
            hex_bytes(&measured_identity.1, 20).unwrap().as_slice()
        )
    );
    retain(&output, "metadata.request", &metadata);
    retain(&output, "sdk-lock.json", &actual_sdk_lock);
    retain(
        &output,
        "standards-lock.json",
        captured.standards_lock.bytes(),
    );
    retain(&output, "build-manifest.json", &captured.build_manifest);
    retain(&output, "release-config.json", captured.release.bytes());
    retain(
        &output,
        "provenance.json",
        &captured.verification.provenance_bytes,
    );
    retain(
        &output,
        "validation.json",
        &captured.verification.validation_bytes,
    );
    for (prefix, files) in [
        ("build", &captured.build_files),
        ("runtime", &captured.verification.runtime),
        ("oracles", &captured.verification.oracles),
    ] {
        for (path, bytes) in files {
            retain(&output, &format!("captured/{prefix}/{path}"), bytes);
        }
    }
    let subjects = [
        ("build-manifest", captured.build_manifest.clone()),
        ("sdk-lock", captured.sdk_lock.bytes().to_vec()),
        ("standards-lock", captured.standards_lock.bytes().to_vec()),
        (
            "semantic-snapshot",
            captured.build_files["lexlean/snapshot.json"].clone(),
        ),
        ("model", captured.build_files["model.prism.json"].clone()),
        ("system", captured.build_files["system.prism.json"].clone()),
        (
            "runtime-manifest",
            captured.verification.runtime["manifest.json"].clone(),
        ),
        (
            "kernel-attestation",
            captured.verification.runtime["lexlean-attestation.json"].clone(),
        ),
        ("provenance", captured.verification.provenance_bytes.clone()),
        ("validation", captured.verification.validation_bytes.clone()),
        (
            "oracle-attestation",
            captured
                .verification
                .oracles
                .first_key_value()
                .unwrap()
                .1
                .clone(),
        ),
    ]
    .into_iter()
    .map(|(role, bytes)| (role.to_owned(), bytes))
    .collect::<Vec<_>>();
    let expected_tree = super::super::browser_export::browser_files(&captured.build_files).unwrap()
        .iter().map(|(path, bytes)| json!({"path":path,"digest":format!("sha256:{}",content_id(bytes)),"size":bytes.len()}))
        .collect::<Vec<_>>();
    let expected = json!({
        "producer":measured_identity.0, "source":measured_identity.1,
        "release":descriptor.digest.trim_start_matches("sha256:"),
        "model":content_id(&captured.build_files["model.prism.json"]),
        "build":content_id(&captured.build_manifest),
        "sdk":sdk_image.rsplit_once("@sha256:").unwrap().1,
        "tree":content_id(&encode_value(&json!(expected_tree)).unwrap())
    });
    let linked = factory::construct_fixture(
        captured,
        attempt(),
        fixture_binding(&super::super::browser_export::capture(&release_path, &reference).unwrap()),
    )
    .unwrap();
    if let Ok(strict) = installed_context {
        assert_eq!(strict.context, linked.context);
        assert_eq!(strict.context_preimage, linked.context_preimage);
        assert_eq!(strict.context_request, linked.context_request);
        assert_eq!(strict.linkage_preimages, linked.linkage_preimages);
    }
    assert_eq!(
        linked.context.subject.producer,
        expected["producer"].as_str().unwrap()
    );
    for (field, actual) in [
        ("source", &linked.context.subject.source),
        ("release", &linked.context.subject.release),
        ("model", &linked.context.subject.model),
        ("build", &linked.context.subject.build),
        ("sdk", &linked.context.subject.sdk),
        ("tree", &linked.context.subject.tree),
    ] {
        assert_eq!(
            *actual,
            hex_bytes(
                expected[field].as_str().unwrap(),
                if field == "source" { 20 } else { 32 }
            )
            .unwrap(),
            "{field}"
        );
    }
    assert_eq!(
        linked.context.declarationIdentity,
        digest(&linked.linkage_preimages[0])
    );
    for (index, actual) in [
        &linked.context.subject.services,
        &linked.context.subject.controls,
        &linked.context.subject.dependencies,
        &linked.context.subject.compiler,
        &linked.context.subject.runtime,
        &linked.context.subject.oracles,
    ]
    .into_iter()
    .enumerate()
    {
        assert_eq!(*actual, digest(&linked.linkage_preimages[index + 1]));
    }
    assert_eq!(linked.context.digest, digest(&linked.context_preimage));
    retain(&output, "context.preimage", &linked.context_preimage);
    retain(&output, "context.request", &linked.context_request);
    for (index, bytes) in linked.linkage_preimages.iter().enumerate() {
        retain(&output, &format!("linkage-{index}.preimage"), bytes);
    }
    let mut rejected = Vec::new();
    for defect in ["instance", "revision", "empty-ref", "oversized-ref"] {
        let captured = super::super::browser_export::capture(&release_path, &reference).unwrap();
        let binding = fixture_binding(&captured);
        let mut changed = attempt();
        match defect {
            "instance" => {
                changed.instance.pop();
            }
            "revision" => {
                changed.revision.push(0);
            }
            "empty-ref" => changed.reference.clear(),
            "oversized-ref" => changed.reference = "x".repeat(2049),
            _ => unreachable!(),
        }
        let error = factory::construct_fixture(captured, changed, binding)
            .err()
            .unwrap();
        assert!(
            error
                .message
                .contains("conditional publisher attempt exceeds"),
            "{error:?}"
        );
        rejected.push(defect);
    }
    for field in ["instance", "revision", "reference"] {
        let captured = super::super::browser_export::capture(&release_path, &reference).unwrap();
        let binding = fixture_binding(&captured);
        let mut changed = attempt();
        match field {
            "instance" => changed.instance[0] ^= 1,
            "revision" => changed.revision[0] ^= 1,
            "reference" => changed.reference.push_str("-changed"),
            _ => unreachable!(),
        }
        let value = factory::construct_fixture(captured, changed, binding).unwrap();
        assert_ne!(value.context.digest, linked.context.digest, "{field}");
        assert_ne!(value.context_preimage, linked.context_preimage, "{field}");
        assert_eq!(value.linkage_preimages, linked.linkage_preimages);
    }
    let recaptured = super::super::browser_export::capture(&release_path, &reference).unwrap();
    assert_eq!(
        recaptured.sdk_lock.bytes(),
        actual_sdk_lock,
        "fixture never relabels captured SDK provenance"
    );
    eprintln!(
        "OC-10 actual graph substitution checks started at {:?}",
        started.elapsed()
    );
    let graph_refusals = graph_refusals(&release_path, &reference, &subjects);
    assert_eq!(graph_refusals.len(), 22);
    let receipt = json!({
        "schema":"prismpm/conditional-publication-capture-evidence/1", "complete_application_accepted":false,
        "runtime_scope":"conditional source-built test controller in immutable SDK; not installed-controller acceptance",
        "runtime_inventory_sha256":content_id(&inventory),"test_executable_sha256":content_id(&executable),
        "source_uri":measured_identity.0,"source_revision":measured_identity.1,
        "build_id":built.build_id,"attestation_id":verified.attestation_id,
        "root_digest":descriptor.digest,"sdk_image":sdk_image,
        "sdk_lock_sha256":content_id(&actual_sdk_lock), "fixture_source_archive_sha256":fixture_archive,
        "installed_sdk_source_matches":installed_source_matches,
        "context_digest":content_id(&linked.context_preimage), "expected_subject":expected,
        "publisher_field_substitutions":3,"refused_attempts":rejected,
        "graph_refusals":graph_refusals,"elapsed_seconds":started.elapsed().as_secs(),
        "source_free":!source_path.exists(),"metadata_sha256":content_id(&metadata),
        "linkage_sha256":linked.linkage_preimages.iter().map(|bytes| content_id(bytes)).collect::<Vec<_>>()
    });
    retain(
        &output,
        "capture-evidence.json",
        &encode_value(&receipt).unwrap(),
    );
    println!(
        "PASS complete actual conditional publication capture: {}",
        output.display()
    );
}

#[test]
fn conditional_sdk_boundary_controls_use_actual_files_processes_and_test_inventory() {
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap();
    let result = std::process::Command::new("/usr/bin/python3")
        .args(["-I", "-B"])
        .arg(repository.join("scripts/conditional-capture-sdk.test.py"))
        .arg(std::env::current_exe().unwrap())
        .status()
        .expect("start actual conditional SDK boundary controls");
    assert!(result.success(), "conditional SDK boundary controls failed");
}

#[test]
fn conditional_sdk_boundary_libtest_printing_probe() {
    println!("actual nocapture printing control");
}
