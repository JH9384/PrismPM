//! HO-42: a release in the local OCI store, replayed by reference in a receiver
//! that holds neither the source nor the build.

use super::{replay_release, Files};
use crate::controller::{BuildRequest, VerifyRequest};
use crate::Controller;
use std::path::Path;

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

/// The release of the example server in a store, and a receiver holding the layout
/// of that store and nothing else: no source, no build, no verification.
fn receiver() -> (tempfile::TempDir, String) {
    let project = tempfile::tempdir().unwrap();
    copy(
        &Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap()
            .join("examples/EchoServer"),
        project.path(),
        true,
    );
    let controller = Controller::load(project.path()).unwrap();
    let build = controller
        .build(BuildRequest { config_path: None })
        .expect("the example builds");
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .expect("the example is verified");
    let staging = tempfile::tempdir().unwrap();
    let (store, descriptor) = crate::oci::browser_export_fixture(
        staging.path(),
        "example.invalid/echo:fixture",
        project.path(),
        &build,
        &verified,
    );
    let marker = format!(
        "verified/{}.json",
        descriptor.digest.strip_prefix("sha256:").unwrap()
    );
    let boundary = tempfile::tempdir().unwrap();
    let mut layout = Files::new();
    for entry in walkdir::WalkDir::new(store.root()).min_depth(1) {
        let entry = entry.unwrap();
        if entry.file_type().is_dir() {
            continue;
        }
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
    for (name, bytes) in &layout {
        let destination = boundary.path().join(".prism/oci").join(name);
        std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
        std::fs::write(destination, bytes).unwrap();
    }
    drop(store);
    staging.close().unwrap();
    project.close().unwrap();
    (
        boundary,
        format!("example.invalid/echo@{}", descriptor.digest),
    )
}

#[test]
fn a_release_in_a_receiver_without_the_source_is_replayed_by_reference() {
    let (receiver, reference) = receiver();
    for absent in [
        "src",
        "prismpm.toml",
        "Cargo.toml",
        ".lexlean",
        ".prism/build",
    ] {
        assert!(!receiver.path().join(absent).exists(), "{absent}");
    }
    let result = replay_release(receiver.path(), &reference)
        .expect("the release is replayed from the store alone");
    assert_eq!(result["schema"], "prismpm/server-release-replay/1");
    assert_eq!(result["status"], "verified");
    assert_eq!(result["reference"], reference);
    assert_eq!(result["application"], "Echo Server");
    assert_eq!(result["server"]["served"], 2);

    // A digest the store does not hold is no release.
    let absent = format!("example.invalid/echo@sha256:{}", "0".repeat(64));
    let error = replay_release(receiver.path(), &absent).unwrap_err();
    assert!(
        matches!(error.code.as_str(), "PP6101" | "PP8001"),
        "{error:?}"
    );
}
