//! HO-39: `prismpm verify` of a server application, end to end.
//!
//! The example is `examples/EchoServer`. These tests build it through the
//! controller, verify it, and read what verification published: the acceptance of
//! the program that the published build produces, and the process that built it.
//!
//! They need the Lean toolchain on `PATH`, as the production build does.

use prismpm::controller::{BuildRequest, VerifyRequest};
use prismpm::Controller;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

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

fn read(path: &Path) -> Value {
    serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap()
}

#[test]
fn verify_of_the_example_server_runs_the_application_acceptance() {
    let root = tempfile::tempdir().unwrap();
    copy(&example(), root.path(), true);
    let controller = Controller::load(root.path()).unwrap();
    controller
        .build(BuildRequest { config_path: None })
        .expect("the example builds through the production API");
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .expect("a server application is verified by accepting its program");
    let directory = root.path().join(&verified.verified_root);
    let acceptance = read(&directory.join("application-acceptance.json"));
    let manifest = read(&directory.join("manifest.json"));

    println!("{acceptance:#}\n{manifest:#}");
    assert_eq!(acceptance["schema"], "prismpm/application-acceptance/1");
    assert_eq!(acceptance["status"], "verified");
    assert_eq!(acceptance["artifact_closure"], "verified");
    assert_eq!(acceptance["application"], "Echo Server");
    assert_eq!(acceptance["modeled_vectors"], 2);
    assert_eq!(
        acceptance["host_packages"]["regeneration"],
        "byte-identical"
    );
    // The build ran under the bound the declaration states, and the evidence says so.
    assert_eq!(acceptance["bounds"]["verify_build_timeout_seconds"], 1800);

    // Every declared effect is reached: the frame effect by the served exchanges, the
    // core's own by the transcript steps that request it.
    let server = &acceptance["server"];
    assert_eq!(server["schema"], "prismpm/server-host-acceptance/1");
    assert_eq!(server["status"], "verified");
    assert_eq!(server["vectors"], 2);
    assert_eq!(server["served"], 2);
    assert_eq!(
        server["effects"],
        json!([
            {"name": "tool.calls", "role": "frame", "served": 2, "steps": 0},
            {"name": "echo.stamp", "role": "core", "served": 0, "steps": 2}
        ])
    );
    assert_eq!(
        server["transports"],
        json!(["file", "stdin", "binding", "socket"])
    );
    assert_eq!(server["binding"], "echo-binding");
    // The digest of the program depends on the host that built it: it is not evidence.
    assert!(server.get("program_sha256").is_none());

    // The program was built from the staged workspace, locked and offline.
    let build = manifest["processes"]
        .as_array()
        .unwrap()
        .iter()
        .find(|process| process["tool"] == "server-workspace-build")
        .expect("the workspace build is recorded");
    let argv = build["argv"].as_array().unwrap();
    for flag in ["--release", "--locked", "--offline"] {
        assert!(argv.iter().any(|argument| argument == flag), "{flag}");
    }
    assert_eq!(build["exit_code"], 0);
    assert_eq!(
        manifest["acceptance_sha256"],
        format!(
            "{:x}",
            Sha256::digest(std::fs::read(directory.join("application-acceptance.json")).unwrap())
        )
    );
}
