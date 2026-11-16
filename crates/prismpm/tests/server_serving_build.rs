//! HO-38: the core of a server application is built through the lexlean
//! production API and served over a real loopback socket.
//!
//! The example is `examples/EchoServer`, a LexLean 1.2 project: a core root
//! that reads the request frame and writes the response frame, and the
//! declaration of the application that serves it. These tests build it through
//! the controller, lay the packages out in the consumer's workspace beside the
//! binding crate, build the program with cargo and run its acceptance, which
//! starts the program as a server and sends every served vector over TCP.
//!
//! They need the Lean toolchain on `PATH`: the production build verifies the
//! project, and Lean's kernel replays the compiler's certificates.

use prismpm::controller::BuildRequest;
use prismpm::holo::model_document::Application;
use prismpm::server_host::{acceptance, program_name, workspace};
use prismpm::Controller;
use std::path::{Path, PathBuf};
use std::process::Command;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("crate is below repository root")
        .to_path_buf()
}

fn example() -> PathBuf {
    repository().join("examples/EchoServer")
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

fn copy(from: &Path, to: &Path) {
    std::fs::create_dir_all(to).unwrap();
    for entry in std::fs::read_dir(from).unwrap() {
        let entry = entry.unwrap();
        let name = entry.file_name();
        if from == example() && GENERATED.contains(&name.to_string_lossy().as_ref()) {
            continue;
        }
        let target = to.join(&name);
        if entry.file_type().unwrap().is_dir() {
            copy(&entry.path(), &target);
        } else {
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

/// A private copy of the example project and a controller over it.
fn project() -> (tempfile::TempDir, Controller) {
    let root = tempfile::tempdir().unwrap();
    copy(&example(), root.path());
    let controller = Controller::load(root.path()).unwrap();
    (root, controller)
}

fn cargo(arguments: &[&str], directory: &Path, target: &Path) -> std::process::Output {
    Command::new("cargo")
        .args(arguments)
        .current_dir(directory)
        .env("CARGO_TARGET_DIR", target)
        .output()
        .expect("cargo runs")
}

#[test]
fn the_example_server_serves_its_vectors_end_to_end() {
    let (root, controller) = project();
    let build = controller
        .build(BuildRequest { config_path: None })
        .expect("the example builds through the production API");
    let artifacts = root.path().join(".prism/build").join(&build.build_id);
    let model: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.path().join(&build.model_path)).expect("the model document"),
    )
    .unwrap();
    let application: Application = serde_json::from_value(model["application"].clone()).unwrap();
    let Application::Server(server) = application else {
        panic!("the example declares a server application");
    };

    // The compiler's record of the export: the one root, the one target, and the
    // effects its package exhibits.
    let result: serde_json::Value = serde_json::from_slice(
        &std::fs::read(artifacts.join("server/production-result.json")).unwrap(),
    )
    .unwrap();
    let outputs = &result["roots"][0]["outputs"][0];
    assert_eq!(result["roots"][0]["root"], "EchoServer.Core.run");
    assert_eq!(outputs["target"]["id"], "rust-std");
    assert_eq!(outputs["package"]["name"], "echo_server_core");

    // The consumer's workspace: the generated packages beside the binding crate.
    let consumer = tempfile::tempdir().unwrap();
    let workspace_root = consumer.path().join("workspace");
    copy(&example(), &workspace_root);
    for entry in walkdir::WalkDir::new(artifacts.join("server")) {
        let entry = entry.unwrap();
        let relative = entry
            .path()
            .strip_prefix(artifacts.join("server"))
            .unwrap()
            .to_path_buf();
        if relative.as_os_str().is_empty() || relative == Path::new("production-result.json") {
            continue;
        }
        let destination = workspace_root.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    workspace::verify(&server, &workspace_root).expect("the workspace holds the declared binding");
    let target = consumer.path().join("target");
    let output = cargo(&["build", "--offline"], &workspace_root, &target);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );

    let work = consumer.path().join("work");
    std::fs::create_dir_all(&work).unwrap();
    // Acceptance starts the program as a server and sends every served vector over TCP.
    let record = acceptance::execute(
        &server,
        &target.join("debug").join(program_name(&server)),
        &work,
        true,
    )
    .expect("the program answers every vector as modeled");
    assert_eq!(record["status"], "verified");
    assert_eq!(record["served"], 2);
    // The core requests one effect for each vector, and the frame needs the other.
    assert_eq!(
        record["effects"],
        serde_json::json!([
            {"name": "tool.calls", "role": "frame", "served": 2, "steps": 0},
            {"name": "echo.stamp", "role": "core", "served": 0, "steps": 2}
        ])
    );
    assert!(record["transports"]
        .as_array()
        .unwrap()
        .iter()
        .any(|transport| transport == acceptance::SOCKET_TRANSPORT));
}

#[test]
fn a_core_that_is_not_a_production_root_is_refused() {
    let (root, controller) = project();
    let core = root.path().join("src/Core.lex.tex");
    let source = std::fs::read_to_string(&core).unwrap();
    let declared = ",\n  production: {effects: [allocation, overflow], targets: [rust-std]}";
    assert!(source.contains(declared));
    std::fs::write(&core, source.replace(declared, "")).unwrap();
    let error = controller
        .build(BuildRequest { config_path: None })
        .expect_err("a core that is no production root is not built");
    assert_eq!(error.code, "PP2025", "{error}");
    assert!(
        !root.path().join("echo_server_core").exists(),
        "nothing is laid out for a refused build"
    );
}

#[test]
fn the_example_holds_the_foundation_modules_it_imports_byte_for_byte() {
    for module in [
        "Foundation/Bytes.lex.tex",
        "Foundation/Server/V1/Model.lex.tex",
    ] {
        assert_eq!(
            std::fs::read(example().join("src").join(module)).unwrap(),
            std::fs::read(repository().join("stdlib/src").join(module)).unwrap(),
            "{module} differs from the standard library"
        );
    }
}
