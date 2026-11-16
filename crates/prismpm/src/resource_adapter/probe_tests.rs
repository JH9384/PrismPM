//! Actual source -> pinned Lean/export -> native archive -> wasm-bindgen probe.
//! This is private component evidence, not a resource-profile acceptance receipt.
use crate::controller::VerifyRequest;
use crate::holo::model_document::ModelDocument;
use crate::library_build::{regular_bytes, write};
use crate::verification::{executable, run_process};
use std::collections::BTreeMap;
use std::io::Cursor;
use std::path::{Path, PathBuf};

fn copy_tree(source: &Path, destination: &Path) {
    std::fs::create_dir_all(destination).unwrap();
    for entry in std::fs::read_dir(source).unwrap() {
        let entry = entry.unwrap();
        if matches!(
            entry.file_name().to_str(),
            Some(".prism" | ".lexlean" | ".lake")
        ) {
            continue;
        }
        let target = destination.join(entry.file_name());
        let kind = entry.file_type().unwrap();
        if kind.is_dir() {
            copy_tree(&entry.path(), &target);
        } else {
            assert!(kind.is_file());
            std::fs::copy(entry.path(), target).unwrap();
        }
    }
}

#[test]
fn private_resource_host_counterexamples_execute_without_skips() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let record = run_process(
        "private-resource-host-counterexamples",
        &executable("node").unwrap(),
        &[
            "--test".to_owned(),
            "--test-concurrency=1".to_owned(),
            "scripts/resource-adapter.test.mjs".to_owned(),
        ],
        &root,
        &BTreeMap::new(),
        &[],
        "PP5203",
    )
    .unwrap();
    let count = record
        .stdout
        .lines()
        .find_map(|line| line.strip_prefix("# tests "))
        .unwrap()
        .parse::<usize>()
        .unwrap();
    assert!(
        count >= 30,
        "complete original host counterexamples must execute"
    );
    for summary in ["# fail 0", "# cancelled 0", "# skipped 0", "# todo 0"] {
        assert!(
            record.stdout.lines().any(|line| line == summary),
            "{}",
            record.stdout
        );
    }
    assert!(record.stderr.is_empty(), "{}", record.stderr);
}

#[test]
fn source_generated_typed_state_executes_in_real_wasm_bindgen_resource_objects() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap();
    let work = tempfile::Builder::new()
        .prefix("prism-resource-component-")
        .tempdir()
        .unwrap();
    let project = work.path().join("project");
    // The overlay is authored notation only. Reuse the genuine locked library
    // closure; do not fabricate an IR module or handwritten Lean implementation.
    copy_tree(
        &root.join("tests/fixtures/library/native-library/project"),
        &project,
    );
    copy_tree(
        &root.join("tests/fixtures/stream/resource-component/project"),
        &project,
    );
    let verified = crate::Controller::load(&project)
        .unwrap()
        .verify(VerifyRequest { config_path: None })
        .expect("the real typed source must pass existing proof and native-library verification");
    let build = project.join(".prism/build").join(&verified.build_id);
    let model: ModelDocument =
        serde_json::from_slice(&regular_bytes(&build, "model.prism.json").unwrap()).unwrap();
    let library = model.library.as_ref().unwrap();
    assert_eq!(model.schema, "prismpm/model-document/3");
    let generated =
        String::from_utf8(regular_bytes(&build, "library/package/src/lib.rs").unwrap()).unwrap();
    assert!(generated.contains("pub fn step(state: &crate::State, event: &crate::InputEvent) -> Result<crate::Transition, crate::ComputeError>"), "actual generated signature changed: {generated}");
    assert!(generated.contains("alloc::borrow::ToOwned::to_owned(state)"));
    assert!(generated.contains("pub struct State"));
    // This clone path is an explicit limitation: typed residency eliminates
    // boundary serialization, not deep copies in the pinned pure codegen.
    assert!(generated.contains("marker: alloc::borrow::ToOwned::to_owned"));

    let component = work.path().join("component");
    let archive = regular_bytes(
        &build,
        &format!(
            "library/{}-{}.crate",
            library.cargo_name, library.cargo_version
        ),
    )
    .unwrap();
    let cargo_home =
        crate::library_verification::registry_cargo_home(&component, library, &archive).unwrap();
    // Add the exact checked-in dependency registry, retaining the independently
    // generated native archive's own index/checksum. No path/Git dependency.
    tar::Archive::new(Cursor::new(include_bytes!(
        "../../../../vendor/registry.tar"
    )))
    .unpack(component.join("registry"))
    .unwrap();
    let backend = component.join("backend");
    write(&backend.join("Cargo.toml"), format!(
        "[package]\nname = \"prism-resource-component-browser\"\nversion = \"0.1.0\"\nedition = \"2021\"\npublish = false\n\n[lib]\ncrate-type = [\"cdylib\"]\n\n[dependencies]\njs-sys = \"=0.3.99\"\nwasm-bindgen = \"=0.2.122\"\nprism_resource_core = {{ package = {:?}, version = {:?} }}\n\n[profile.release]\npanic = \"abort\"\n", library.cargo_name, format!("={}", library.cargo_version)
    ).as_bytes()).unwrap();
    write(
        &backend.join("src/lib.rs"),
        include_bytes!("probe_facade.rs.in"),
    )
    .unwrap();
    let environment = BTreeMap::from([
        (
            "CARGO_HOME".to_owned(),
            cargo_home.to_string_lossy().into_owned(),
        ),
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
    ]);
    let replacements = [(work.path(), "$RESOURCE_COMPONENT")];
    let cargo = executable("cargo").unwrap();
    for arguments in [
        vec!["generate-lockfile", "--offline"],
        vec![
            "build",
            "--locked",
            "--offline",
            "--release",
            "--target",
            "wasm32-unknown-unknown",
        ],
    ] {
        run_process(
            "private-resource-component-build",
            &cargo,
            &arguments.into_iter().map(str::to_owned).collect::<Vec<_>>(),
            &backend,
            &environment,
            &replacements,
            "PP5203",
        )
        .unwrap();
    }
    let wasm =
        backend.join("target/wasm32-unknown-unknown/release/prism_resource_component_browser.wasm");
    let binding = component.join("binding");
    std::fs::create_dir(&binding).unwrap();
    run_process(
        "private-resource-component-bindgen",
        &executable("wasm-bindgen").unwrap(),
        &[
            "--target".to_owned(),
            "web".to_owned(),
            "--out-name".to_owned(),
            "resource".to_owned(),
            "--out-dir".to_owned(),
            binding.to_string_lossy().into_owned(),
            wasm.to_string_lossy().into_owned(),
        ],
        &backend,
        &environment,
        &replacements,
        "PP5203",
    )
    .unwrap();
    write(&binding.join("package.json"), b"{\"type\":\"module\"}\n").unwrap();
    let record = run_process(
        "private-resource-component-node",
        &executable("node").unwrap(),
        &[
            PathBuf::from(env!("CARGO_MANIFEST_DIR"))
                .join("src/resource_adapter/probe.mjs")
                .to_string_lossy()
                .into_owned(),
            root.join("crates/prismpm/src/resource_adapter/runtime.mjs")
                .to_string_lossy()
                .into_owned(),
            binding.join("resource.js").to_string_lossy().into_owned(),
            binding
                .join("resource_bg.wasm")
                .to_string_lossy()
                .into_owned(),
        ],
        &component,
        &BTreeMap::new(),
        &replacements,
        "PP5203",
    )
    .unwrap();
    assert!(
        record
            .stdout
            .starts_with("private generated typed-state Wasm component passed:"),
        "{}",
        record.stdout
    );
    assert!(record.stderr.is_empty(), "{}", record.stderr);
    println!("{}", record.stdout.trim_end());
}
