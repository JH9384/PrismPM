//! HO-39: what `prismpm verify` of a server application refuses.
//!
//! The acceptance refuses a program that disagrees with the model, and the
//! regeneration check refuses host packages that are not the declaration's. The
//! tests plant each disagreement in an otherwise accepted application and require
//! the refusal to name it.

use super::{acceptance, generate, serving_tests, tests, workspace};
use crate::holo::server_application::ServerApplication;
use crate::verification::server::{build_workspace, check_generated};
use serde_json::{json, Value};
use std::collections::BTreeSet;
use std::path::Path;

fn changed(value: Value) -> ServerApplication {
    serde_json::from_value(value).expect("the changed declaration deserializes")
}

#[test]
fn a_replayed_vector_with_a_wrong_effect_result_is_refused() {
    let built = tests::built();
    let work = tempfile::tempdir().unwrap();
    // Vector 1 asks the store for a key. Its transcript says the store failed,
    // where the modeled response was written for a store that found the value.
    let mut value = tests::model_value();
    let failed = value["host"]["transcripts"][1]["steps"][0]["outcome"].clone();
    value["host"]["transcripts"][0]["steps"][0]["outcome"] = failed;
    let error = acceptance::execute(&changed(value), &built.program, work.path(), false)
        .expect_err("an effect result that does not yield the modeled response is refused");
    assert_eq!(error.code, "PP6003", "{}", error.message);
    assert!(error.message.contains("vector"), "{}", error.message);
    // The same declaration with its own transcript is accepted.
    let record = acceptance::execute(&tests::model(), &built.program, work.path(), false).unwrap();
    assert_eq!(record["status"], "verified");
}

#[test]
fn a_served_exchange_whose_response_differs_is_refused() {
    let built = serving_tests::built();
    let work = tempfile::tempdir().unwrap();
    let mut value = serving_tests::served_value();
    value["serving"][0]["vectors"][1]["response"] = json!(b"HTTP/1.1 200 OK\r\n\r\n".to_vec());
    let error = acceptance::execute(&changed(value), &built.program, work.path(), false)
        .expect_err("a served response that differs from the model is refused");
    assert_eq!(error.code, "PP6003", "{}", error.message);
    assert!(error.message.contains("served"), "{}", error.message);
    let record = acceptance::execute(
        &serving_tests::served_model(),
        &built.program,
        work.path(),
        false,
    )
    .unwrap();
    assert_eq!(record["served"], 4);
}

fn laid_out(application: &ServerApplication, directory: &Path) -> BTreeSet<String> {
    for item in generate(application).unwrap().files {
        let target = directory.join(&item.path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, item.bytes).unwrap();
    }
    // The core package is the compiler's, not the generator's.
    let core = directory.join(&application.core.package).join("src");
    std::fs::create_dir_all(&core).unwrap();
    std::fs::write(core.join("lib.rs"), b"// core\n").unwrap();
    BTreeSet::from(["src/lib.rs".to_owned()])
}

#[test]
fn host_packages_equal_to_their_regeneration_are_accepted() {
    let application = tests::model();
    let directory = tempfile::tempdir().unwrap();
    let core = laid_out(&application, directory.path());
    assert!(check_generated(&application, directory.path(), &core).unwrap() > 0);
}

#[test]
fn host_packages_that_differ_from_their_regeneration_are_refused() {
    let application = tests::model();
    let directory = tempfile::tempdir().unwrap();
    let core = laid_out(&application, directory.path());
    let generated = generate(&application).unwrap();
    let first = &generated.files[0].path;
    let path = directory.path().join(first);
    let original = std::fs::read(&path).unwrap();

    // A generated file edited by hand.
    std::fs::write(&path, [original.as_slice(), b"// edited\n"].concat()).unwrap();
    let error = check_generated(&application, directory.path(), &core).unwrap_err();
    assert_eq!(error.code, "PP4102", "{}", error.message);
    assert!(error.message.contains(first.as_str()), "{}", error.message);

    // A generated file removed.
    std::fs::remove_file(&path).unwrap();
    let error = check_generated(&application, directory.path(), &core).unwrap_err();
    assert_eq!(error.code, "PP4102", "{}", error.message);
    assert!(error.message.contains("missing"), "{}", error.message);

    // A file the declaration does not generate.
    std::fs::write(&path, &original).unwrap();
    let extra = directory
        .path()
        .join(super::api_name(&application))
        .join("src/extra.rs");
    std::fs::write(&extra, b"pub fn backdoor() {}\n").unwrap();
    let error = check_generated(&application, directory.path(), &core).unwrap_err();
    assert_eq!(error.code, "PP4102", "{}", error.message);
    assert!(error.message.contains("extra.rs"), "{}", error.message);

    // A file in the core package that the compiler did not export.
    std::fs::remove_file(extra).unwrap();
    std::fs::write(
        directory
            .path()
            .join(&application.core.package)
            .join("src/other.rs"),
        b"",
    )
    .unwrap();
    let error = check_generated(&application, directory.path(), &core).unwrap_err();
    assert_eq!(error.code, "PP4102", "{}", error.message);
    assert!(error.message.contains("other.rs"), "{}", error.message);
}

/// A project as the consumer commits it: the workspace manifest, its lock and the
/// binding, with the generated packages not yet laid out.
fn project(application: &ServerApplication) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(
        directory.path().join("Cargo.toml"),
        tests::members(application),
    )
    .unwrap();
    std::fs::write(directory.path().join("Cargo.lock"), b"# lock\n").unwrap();
    tests::write_binding(directory.path(), application, "// binding\n");
    directory
}

fn build_below(application: &ServerApplication) -> tempfile::TempDir {
    let server = tempfile::tempdir().unwrap();
    laid_out(application, server.path());
    server
}

#[test]
fn staging_lays_the_consumers_files_beside_the_build_and_nothing_else() {
    let application = tests::model();
    let project = project(&application);
    // Files of the working tree that the build does not own are not the consumer's workspace.
    std::fs::write(project.path().join("notes.txt"), b"private").unwrap();
    std::fs::create_dir_all(project.path().join("bindings/echo-binding/target")).unwrap();
    std::fs::write(
        project.path().join("bindings/echo-binding/target/stale"),
        b"",
    )
    .unwrap();
    let server = build_below(&application);
    // The compiler's record names the build; it is not a workspace file.
    std::fs::write(server.path().join("production-result.json"), b"{}").unwrap();
    let staged = tempfile::tempdir().unwrap();
    let destination = staged.path().join("workspace");
    workspace::stage(&application, project.path(), server.path(), &destination).unwrap();
    assert_eq!(
        std::fs::read(destination.join("Cargo.lock")).unwrap(),
        b"# lock\n"
    );
    assert!(destination
        .join("bindings/echo-binding/src/lib.rs")
        .is_file());
    assert!(destination
        .join(super::api_name(&application))
        .join("Cargo.toml")
        .is_file());
    assert!(destination
        .join(&application.core.package)
        .join("src/lib.rs")
        .is_file());
    assert!(!destination.join("notes.txt").exists());
    assert!(!destination.join("production-result.json").exists());
    assert!(!destination.join("bindings/echo-binding/target").exists());
}

#[test]
fn a_workspace_without_the_declared_binding_or_its_lock_is_refused() {
    let application = tests::model();
    let server = build_below(&application);
    let stage = |project: &Path| {
        let staged = tempfile::tempdir().unwrap();
        workspace::stage(
            &application,
            project,
            server.path(),
            &staged.path().join("w"),
        )
        .expect_err("the workspace is refused")
    };

    // The consumer commits the lock; verification does not make one.
    let unlocked = project(&application);
    std::fs::remove_file(unlocked.path().join("Cargo.lock")).unwrap();
    let error = stage(unlocked.path());
    assert_eq!(error.code, "PP2013", "{}", error.message);
    assert!(error.message.contains("Cargo.lock"), "{}", error.message);

    // The binding the model declares is not in the project.
    let unbound = project(&application);
    std::fs::remove_dir_all(unbound.path().join("bindings")).unwrap();
    let error = stage(unbound.path());
    assert_eq!(error.code, "PP2013", "{}", error.message);

    // The binding is a crate of another name.
    let renamed = project(&application);
    let manifest = renamed.path().join("bindings/echo-binding/Cargo.toml");
    let text = std::fs::read_to_string(&manifest).unwrap();
    std::fs::write(
        &manifest,
        text.replace("name = \"echo-binding\"", "name = \"other\""),
    )
    .unwrap();
    let error = stage(renamed.path());
    assert_eq!(error.code, "PP2013", "{}", error.message);
    assert!(error.message.contains("echo-binding"), "{}", error.message);

    // A member that leaves the project, and a link out of one, are not staged.
    let escaping = project(&application);
    let text = std::fs::read_to_string(escaping.path().join("Cargo.toml")).unwrap();
    std::fs::write(
        escaping.path().join("Cargo.toml"),
        text.replace(
            "\"bindings/echo-binding\"",
            "\"../outside\", \"bindings/echo-binding\"",
        ),
    )
    .unwrap();
    let error = stage(escaping.path());
    assert_eq!(error.code, "PP2013", "{}", error.message);
    assert!(error.message.contains("plain path"), "{}", error.message);

    let linked = project(&application);
    std::os::unix::fs::symlink(
        "/etc/hostname",
        linked.path().join("bindings/echo-binding/link"),
    )
    .unwrap();
    let error = stage(linked.path());
    assert_eq!(error.code, "PP2013", "{}", error.message);
    assert!(error.message.contains("regular file"), "{}", error.message);
}

/// A workspace whose only member takes `seconds` seconds to build.
fn slow_workspace(seconds: u32) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    let write = |path: &str, text: String| {
        let target = directory.path().join(path);
        std::fs::create_dir_all(target.parent().unwrap()).unwrap();
        std::fs::write(target, text).unwrap();
    };
    write(
        "Cargo.toml",
        "[workspace]\nresolver = \"2\"\nmembers = [\"slow\"]\n".to_owned(),
    );
    write(
        "Cargo.lock",
        "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"slow\"\nversion = \"0.1.0\"\n".to_owned(),
    );
    write(
        "slow/Cargo.toml",
        "[package]\nname = \"slow\"\nversion = \"0.1.0\"\nedition = \"2021\"\nbuild = \"build.rs\"\n".to_owned(),
    );
    write(
        "slow/build.rs",
        format!("fn main() {{ std::thread::sleep(std::time::Duration::from_secs({seconds})); }}\n"),
    );
    write("slow/src/lib.rs", String::new());
    directory
}

#[test]
fn the_workspace_build_runs_under_the_declared_bound() {
    let workspace = slow_workspace(8);
    let target = tempfile::tempdir().unwrap();
    let declared = |seconds: u32| {
        let mut value = tests::model_value();
        value["verify_build_timeout_seconds"] = json!(seconds);
        changed(value)
    };
    let build =
        |seconds: u32| build_workspace(&declared(seconds), workspace.path(), target.path(), &[]);

    // A build that outlasts the declared bound is stopped at it, not at the SDK's own.
    let started = std::time::Instant::now();
    let error = build(2).expect_err("a build over its bound is refused");
    assert_eq!(error.code, "PP5007", "{}", error.message);
    assert!(error.message.contains("timed out"), "{}", error.message);
    assert!(
        started.elapsed() < std::time::Duration::from_secs(7),
        "the build was stopped by the declared bound, not by finishing"
    );

    // The same build under a bound that fits it is accepted, locked and offline.
    let record = build(600).expect("a build within its bound is accepted");
    assert_eq!(record.exit_code, 0);
    assert_eq!(record.tool, "server-workspace-build");
    for flag in ["--release", "--locked", "--offline"] {
        assert!(
            record.argv.iter().any(|argument| argument == flag),
            "{flag}"
        );
    }
}
