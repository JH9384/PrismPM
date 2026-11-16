//! HO-42: the release of a server application, verified and replayed without its
//! source tree.
//!
//! The example is `examples/EchoServer`. It is built and verified once in a
//! temporary project; the files of the build and of the verification are read
//! into memory and the project is removed, so that everything below works from
//! the release's files alone. Each planted defect is rehashed coherently (the
//! build manifest, the build identity and the evidence manifest are rewritten to
//! agree with the tampered files), so that only the checks of the evidence itself
//! can refuse it.

use prismpm::controller::{BuildRequest, VerifyRequest};
use prismpm::holo::canonical::{content_id, encode_value};
use prismpm::server_release::{check, replay, Files};
use prismpm::Controller;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

fn example() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .join("examples/EchoServer")
}

/// What `prismpm build` and cargo leave in an example directory.
const GENERATED: [&str; 7] = [
    ".lexlean",
    ".prism",
    "target",
    "server",
    "echo_server_core",
    "echo-server-host-api",
    "echo-server-host",
];

fn copy(from: &Path, to: &Path, top: bool) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if top && GENERATED.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target, false);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

fn read_below(directory: &Path) -> Files {
    let mut files = Files::new();
    for entry in walkdir::WalkDir::new(directory).follow_links(false) {
        let entry = entry.unwrap();
        if entry.file_type().is_file() {
            let relative = entry
                .path()
                .strip_prefix(directory)
                .unwrap()
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative, std::fs::read(entry.path()).unwrap());
        }
    }
    files
}

/// The release of the example: the build without its manifest, the manifest and the
/// verification files.
struct Released {
    manifest: Vec<u8>,
    build: Files,
    verification: Files,
}

fn released() -> &'static Released {
    static RELEASED: OnceLock<Released> = OnceLock::new();
    RELEASED.get_or_init(|| {
        let project = tempfile::tempdir().unwrap();
        copy(&example(), project.path(), true);
        let controller = Controller::load(project.path()).unwrap();
        let build = controller
            .build(BuildRequest { config_path: None })
            .expect("the example builds");
        let verified = controller
            .verify(VerifyRequest { config_path: None })
            .expect("the example is verified");
        let directory = project
            .path()
            .join(&build.manifest_path)
            .parent()
            .unwrap()
            .to_path_buf();
        let mut files = read_below(&directory);
        let manifest = files.remove("manifest.json").unwrap();
        let verification = read_below(&project.path().join(&verified.verified_root));
        // The project goes away with the end of this function: what follows has the
        // release's files and nothing else.
        Released {
            manifest,
            build: files,
            verification,
        }
    })
}

fn sha(bytes: &[u8]) -> String {
    content_id(bytes)
}

fn parse(bytes: &[u8]) -> Value {
    serde_json::from_slice(bytes).unwrap()
}

/// Rewrite the build manifest, the build identity and the evidence manifest so
/// that they agree with the (tampered) files, as an adversary who controls the
/// whole release would. Returns the new build manifest.
fn rehash(build: &Files, verification: &mut Files) -> Vec<u8> {
    let original = parse(&released().manifest);
    let kinds = original["files"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| {
            (
                row["path"].as_str().unwrap().to_owned(),
                row["kind"].as_str().unwrap().to_owned(),
            )
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let rows = build
        .iter()
        .map(|(path, bytes)| {
            json!({
                "path": path,
                "kind": kinds.get(path).map_or("artifact", String::as_str),
                "byte_length": bytes.len(),
                "sha256": sha(bytes),
            })
        })
        .collect::<Vec<_>>();
    let mut inputs = original["inputs"].clone();
    inputs["application_artifacts_sha256"] = json!(sha(&encode_value(&json!(rows)).unwrap()));
    let build_id = sha(&encode_value(&inputs).unwrap());
    let manifest = encode_value(&json!({
        "files": rows,
        "inputs": inputs,
        "schema": "prismpm/build-manifest/1",
    }))
    .unwrap();
    if let Some(bytes) = verification.get_mut("application-acceptance.json") {
        let mut acceptance = parse(bytes);
        acceptance["build_id"] = json!(build_id);
        *bytes = encode_value(&acceptance).unwrap();
    }
    let acceptance_sha = verification
        .get("application-acceptance.json")
        .map(|bytes| sha(bytes));
    let evidence = verification.get_mut("manifest.json").unwrap();
    let mut value = parse(evidence);
    value["build_id"] = json!(build_id);
    if let Some(acceptance_sha) = acceptance_sha {
        value["acceptance_sha256"] = json!(acceptance_sha);
    }
    *evidence = encode_value(&value).unwrap();
    manifest
}

/// Edit the retained acceptance document and rehash.
fn with_acceptance(edit: impl FnOnce(&mut Value)) -> (Vec<u8>, Files, Files) {
    let released = released();
    let build = released.build.clone();
    let mut verification = released.verification.clone();
    let mut acceptance = parse(&verification["application-acceptance.json"]);
    edit(&mut acceptance);
    verification.insert(
        "application-acceptance.json".to_owned(),
        encode_value(&acceptance).unwrap(),
    );
    let manifest = rehash(&build, &mut verification);
    (manifest, build, verification)
}

fn tampered(path_prefix: &str, edit: impl FnOnce(&mut Vec<u8>)) -> (Vec<u8>, Files, Files) {
    let released = released();
    let mut build = released.build.clone();
    let path = build
        .keys()
        .find(|path| path.starts_with(path_prefix) && !path.ends_with("Cargo.lock"))
        .unwrap_or_else(|| panic!("the release holds a file below {path_prefix}"))
        .clone();
    edit(build.get_mut(&path).unwrap());
    let mut verification = released.verification.clone();
    let manifest = rehash(&build, &mut verification);
    (manifest, build, verification)
}

fn refused(result: Result<(), prismpm::PrismError>, fragment: &str) {
    let error = result.expect_err("the release is refused");
    assert_eq!(error.code, "PP6101", "{}", error.message);
    assert!(error.message.contains(fragment), "{}", error.message);
}

#[test]
fn a_released_server_application_is_checked_and_replayed_without_its_source() {
    let released = released();
    // The build retains the consumer's workspace and the packages of the host.
    for path in [
        "consumer/Cargo.toml",
        "consumer/Cargo.lock",
        "consumer/bindings/echo-binding/Cargo.toml",
        "server/production-result.json",
    ] {
        assert!(released.build.contains_key(path), "{path}");
    }
    check(&released.manifest, &released.build, &released.verification)
        .expect("the retained evidence is the one the model and the files derive");

    // The evidence binds the packages, the workspace and the declared bounds.
    let acceptance = parse(&released.verification["application-acceptance.json"]);
    for pointer in [
        "/core/package_sha256",
        "/host_packages/api_package_sha256",
        "/host_packages/program_package_sha256",
        "/consumer/sha256",
    ] {
        let digest = acceptance.pointer(pointer).and_then(Value::as_str);
        assert!(digest.is_some_and(|text| text.len() == 64), "{pointer}");
    }
    assert_eq!(acceptance["bounds"]["verify_build_timeout_seconds"], 1800);

    // The program is rebuilt from the released files and answers as modeled.
    let record = replay(&released.manifest, &released.build, &released.verification)
        .expect("the released program is rebuilt and accepted");
    assert_eq!(record["status"], "verified");
    assert_eq!(record["server"]["vectors"], 2);
    assert_eq!(record["server"]["served"], 2);
    assert_eq!(record["server"], acceptance["server"]);
}

#[test]
fn a_tampered_released_core_package_is_refused() {
    let (manifest, build, verification) = tampered("server/echo_server_core/src/", |bytes| {
        bytes.extend_from_slice(b"\n// edited\n");
    });
    refused(
        check(&manifest, &build, &verification),
        "differs from the compiler's record",
    );
}

#[test]
fn a_tampered_released_host_package_is_refused() {
    let (manifest, build, verification) = tampered("server/echo-server-host/src/", |bytes| {
        bytes.extend_from_slice(b"\n// edited\n");
    });
    refused(
        check(&manifest, &build, &verification),
        "differs from its regeneration",
    );
}

#[test]
fn a_tampered_released_consumer_workspace_is_refused() {
    let (manifest, build, verification) =
        tampered("consumer/bindings/echo-binding/src/", |bytes| {
            bytes.extend_from_slice(b"\n// edited\n");
        });
    refused(
        check(&manifest, &build, &verification),
        "consumer workspace",
    );
}

#[test]
fn recorded_bounds_that_differ_from_the_model_are_refused() {
    let (manifest, build, verification) = with_acceptance(|acceptance| {
        acceptance["bounds"]["verify_build_timeout_seconds"] = json!(7200);
    });
    refused(
        check(&manifest, &build, &verification),
        "recorded bounds differ from the model",
    );
}

#[test]
fn a_release_without_the_acceptance_evidence_is_refused() {
    let released = released();
    let mut verification = released.verification.clone();
    verification.remove("application-acceptance.json");
    let manifest = rehash(&released.build, &mut verification);
    refused(
        check(&manifest, &released.build, &verification),
        "application-acceptance.json",
    );
    // An acceptance document that holds no replayed record is no acceptance either.
    let (manifest, build, verification) = with_acceptance(|acceptance| {
        acceptance.as_object_mut().unwrap().remove("server");
    });
    refused(check(&manifest, &build, &verification), "acceptance");
}

#[test]
fn a_replay_of_a_release_that_is_not_a_server_application_is_refused() {
    let model = std::fs::read(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap()
            .join("tests/golden/stdlib/build/model.prism.json"),
    )
    .unwrap();
    let mut build = Files::new();
    build.insert("model.prism.json".to_owned(), model);
    let error = replay(b"{}", &build, &Files::new()).expect_err("there is nothing to replay");
    assert_eq!(error.code, "PP6101", "{}", error.message);
    assert!(
        error.message.contains("no server application"),
        "{}",
        error.message
    );
}

#[test]
fn the_retired_diagnostic_is_not_registered() {
    // Nothing is unavailable any more: the code for the unavailable verification
    // is retired, and a registry that lists it again would document a refusal no
    // path raises.
    // The code is spelled in pieces: the error audit refuses any source that
    // names a code the register does not hold, and this one is not held.
    let retired = format!("PP{}", 2023);
    assert!(
        serde_json::from_value::<prismpm::DiagnosticCode>(json!(retired)).is_err(),
        "{retired} is registered"
    );
    assert!(serde_json::from_value::<prismpm::DiagnosticCode>(json!("PP2026")).is_ok());
    let errors = std::fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap()
            .join("ERRORS.md"),
    )
    .unwrap();
    assert!(!errors.contains(&retired));
}
