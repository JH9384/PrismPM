//! Actual compiler prerequisite evidence, not an application/service oracle.

use super::*;
use lexlean::LockRequest;
use serde_json::json;
use std::path::PathBuf;

fn repository() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../..")
        .canonicalize()
        .unwrap()
}

fn copy_tree(source: &Path, target: &Path) {
    for entry in walkdir::WalkDir::new(source) {
        let entry = entry.unwrap();
        let path = target.join(entry.path().strip_prefix(source).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(path).unwrap();
        } else {
            assert!(entry.file_type().is_file());
            std::fs::copy(entry.path(), path).unwrap();
        }
    }
}

fn fixture(repository: &Path) -> tempfile::TempDir {
    let project = tempfile::Builder::new()
        .prefix("prismpm-browser-compiler-source-")
        .tempdir()
        .unwrap();
    let base = repository.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
        "prismpm.toml",
    ] {
        let source = std::fs::read_to_string(base.join(name))
            .unwrap()
            .replace("PrismTextRequest", "BrowserContract")
            .replace("TextRequest.lex.tex", "Probe.lex.tex");
        std::fs::write(project.path().join(name), source).unwrap();
    }
    copy_tree(
        &repository.join("language/prism.arch"),
        &project.path().join("language/prism.arch"),
    );
    let model = project
        .path()
        .join("src/Foundation/Browser/Application/V1/Model.lex.tex");
    std::fs::create_dir_all(model.parent().unwrap()).unwrap();
    std::fs::copy(
        repository.join("stdlib/src/Foundation/Browser/Application/V1/Model.lex.tex"),
        model,
    )
    .unwrap();
    // The committed probe is language-1.2 notation that already carries the
    // contract-boundary values (maxima, effects and the extra over-output root).
    std::fs::copy(
        repository.join("tests/fixtures/browser-application/BuildProbe.lex.tex"),
        project.path().join("src/Probe.lex.tex"),
    )
    .unwrap();
    let config = camino::Utf8PathBuf::from_path_buf(project.path().join("lexlean.toml")).unwrap();
    Engine::load(&config)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    project
}

fn materialize(compilation: &Compilation, root: &Path) {
    for (name, bytes) in &compilation.files {
        write(&root.join(name), bytes).unwrap();
    }
}

fn native(compilation: &Compilation, workspace: &Path, standard: bool) {
    let runner = workspace.join(if standard {
        "runner-std"
    } else {
        "runner-no-std"
    });
    let model: crate::holo::model_document::ModelDocument =
        serde_json::from_slice(&compilation.files["source/model.json"]).unwrap();
    let Application::Browser(application) = model.application.unwrap() else {
        panic!("closed profile");
    };
    let mut code = String::from("trait BytesResult { fn bytes(self) -> Vec<u8>; }\nimpl BytesResult for Vec<u8> { fn bytes(self) -> Vec<u8> { self } }\nimpl<E: core::fmt::Debug> BytesResult for Result<Vec<u8>, E> { fn bytes(self) -> Vec<u8> { self.unwrap() } }\nfn main() {\n");
    for target in compilation.plan.targets.values() {
        let leaf = target.leaf().unwrap();
        if leaf == "overOutput" {
            code.push_str("assert_eq!(generated::overOutput(Vec::new()).bytes(), vec![0xde, 0xad]); assert_eq!(generated::overOutput(vec![0]).bytes(), vec![0, 0xde, 0xad]);\n");
            continue;
        }
        let last = match leaf {
            "dispatch" => 0xd1,
            "present" => 0xe2,
            "replay" => 0xf3,
            _ => panic!("fixture root"),
        };
        for length in [0, 1, 255, target.input_maximum] {
            code.push_str(&format!("let input = vec![0x5a; {length}]; let mut expected = input.clone(); expected.push({last}); let actual = generated::{leaf}(input).bytes(); assert_eq!(actual, expected);\n"));
        }
    }
    assert_eq!(application.acceptance_vectors.len(), 1);
    for vector in &application.acceptance_vectors {
        code.push_str(&format!(
            "assert_eq!(generated::dispatch(vec!{:?}).bytes(), vec!{:?});\n",
            vector.request, vector.response
        ));
    }
    code.push_str("println!(\"PASS 23 native source vectors including declared vectors, five maxima and two modeled over-output results\");\n}\n");
    write(&runner.join("src/main.rs"), code.as_bytes()).unwrap();
    write(&runner.join("Cargo.toml"), format!("[package]\nname = \"browser-native-oracle\"\nversion = \"0.1.0\"\nedition = \"2021\"\n[workspace]\n[dependencies]\ngenerated = {{package = {:?}, path = \"../native\", default-features = {standard}}}\n", application.cargo_name).as_bytes()).unwrap();
    write(&runner.join("Cargo.lock"), format!("version = 4\n[[package]]\nname = \"browser-native-oracle\"\nversion = \"0.1.0\"\ndependencies = [{:?}]\n[[package]]\nname = {:?}\nversion = {:?}\n", application.cargo_name, application.cargo_name, application.cargo_version).as_bytes()).unwrap();
    write(
        &workspace.join("rust-toolchain.toml"),
        toolchain::RUST_TOOLCHAIN_FILE,
    )
    .unwrap();
    write(
        &workspace.join("lean-toolchain"),
        b"leanprover/lean4:v4.32.1\n",
    )
    .unwrap();
    let tools = toolchain::resolve(workspace).unwrap();
    let cargo_home = runner.join("cargo-home");
    std::fs::create_dir(&cargo_home).unwrap();
    let mut environment = tools.environment;
    environment.insert(
        "CARGO_HOME".into(),
        cargo_home.to_string_lossy().into_owned(),
    );
    environment.insert("CARGO_NET_OFFLINE".into(), "true".into());
    let output = run_process(
        "browser-native-owning",
        &tools.cargo,
        &["run", "--locked", "--offline", "--release"].map(str::to_owned),
        &runner,
        &environment,
        &[(workspace, "$ORACLE")],
        "PP5004",
    )
    .unwrap();
    assert_eq!(
        output.stdout.trim(),
        "PASS 23 native source vectors including declared vectors, five maxima and two modeled over-output results"
    );
}

#[test]
fn browser_compiler_plan_preserves_roles_roots_and_exact_budgets() {
    toolchain::assert_selector_rejection();
    let repository = repository();
    let project = fixture(&repository);
    let configuration =
        camino::Utf8PathBuf::from_path_buf(project.path().join("lexlean.toml")).unwrap();
    let snapshot = Engine::load(&configuration)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    let mut normalized_files = BTreeMap::new();
    freeze_source(project.path(), &snapshot, &mut normalized_files).unwrap();
    let probe_path = project.path().join("src/Probe.lex.tex");
    let original = std::fs::read_to_string(&probe_path).unwrap();
    std::fs::write(&probe_path, original.replace('\n', "\r\n")).unwrap();
    let mut crlf_files = BTreeMap::new();
    freeze_source(project.path(), &snapshot, &mut crlf_files).unwrap();
    assert_eq!(
        normalized_files["source/project/src/Probe.lex.tex"],
        crlf_files["source/project/src/Probe.lex.tex"]
    );
    assert_ne!(
        normalized_files["source/original/src/Probe.lex.tex"],
        crlf_files["source/original/src/Probe.lex.tex"]
    );
    std::fs::write(
        &probe_path,
        original.replace("request 0xd1 :", "request 0xd2 :"),
    )
    .unwrap();
    assert!(
        freeze_source(project.path(), &snapshot, &mut BTreeMap::new()).is_err(),
        "changed source fails before compilation"
    );
    std::fs::write(&probe_path, original).unwrap();
    let model = project_application(&snapshot).unwrap().unwrap();
    let bytes = encode_canonical(&model).unwrap();
    let Some(Application::Browser(application)) = model.application else {
        panic!("source profile");
    };
    let plan = Plan::new(&application, &bytes).unwrap();
    assert_eq!(plan.targets.len(), 6);
    let value = decode(&plan.binding(&BTreeMap::new()).unwrap()).unwrap();
    let policy = decode(&Plan::requested_policy(&application).unwrap()).unwrap();
    assert_eq!(
        policy["durability"],
        serde_json::to_value(&application.durability).unwrap()
    );
    assert_eq!(
        policy["effects"],
        serde_json::to_value(&application.requested_effects).unwrap()
    );
    for field in [
        "namespace",
        "head",
        "staging_head",
        "resource",
        "signing_resource",
        "credential_slot",
        "maximum_records",
    ] {
        let mut changed = serde_json::to_value(&application).unwrap();
        changed["durability"][field] = if field == "maximum_records" {
            json!(2)
        } else {
            json!("other-private-binding")
        };
        let changed = serde_json::from_value(changed).unwrap();
        let binding = decode(
            &Plan::new(&changed, &bytes)
                .unwrap()
                .binding(&BTreeMap::new())
                .unwrap(),
        )
        .unwrap();
        assert_ne!(
            binding["policy_sha256"], value["policy_sha256"],
            "private binding {field}"
        );
    }
    assert_eq!(value["roles"].as_object().unwrap().len(), 7);
    assert_eq!(
        value["roles"]["resource:guest-large"],
        value["roles"]["resource:guest-same"]
    );
    assert_ne!(value["roles"]["primary"], value["roles"]["resource:guest"]);
    assert!(plan.targets.values().any(|v| v.input_maximum == 2_097_151
        && v.output_maximum == 2_097_152
        && v.memory_pages == 256));
    for path in ["", "/root", "a//b", "a/../b", "a/./b", "a\\b", "a/"] {
        assert!(plan::relative(path).is_err(), "{path}");
    }
    let result = crate::Controller::load(project.path())
        .unwrap()
        .build(crate::controller::BuildRequest { config_path: None })
        .unwrap_err();
    assert_eq!(result.code, "PP2011");
    assert!(!project.path().join(".lexlean/build").exists());
    assert!(!project.path().join(".prism").exists());
}

#[test]
fn browser_compiler_toolchain_rejects_ambient_selection_and_spoofed_cargo() {
    const NAME: &str = "browser_build::tests::browser_compiler_toolchain_rejects_ambient_selection_and_spoofed_cargo";
    let repository = repository();
    if let Ok(mode) = std::env::var("PRISMPM_TEST_BROWSER_TOOLCHAIN_NEGATIVE") {
        let result = toolchain::resolve(&repository);
        match result {
            Err(error) => {
                assert_eq!(error.code, "PP5008");
                assert!(
                    error.message.contains(if mode == "selector" {
                        "non-pinned ambient"
                    } else {
                        "Cargo launcher"
                    }),
                    "{}",
                    error.message
                );
            }
            Ok(tools) => {
                assert_eq!(mode, "cargo");
                assert!(
                    crate::sdk::inventory_path().is_some(),
                    "native Cargo spoof must reject"
                );
                assert!(
                    !tools
                        .cargo
                        .starts_with(std::env::var_os("PRISMPM_TEST_BROWSER_SPOOF_DIR").unwrap()),
                    "SDK inventory never selects PATH spoof"
                );
            }
        }
        return;
    }
    let fake = tempfile::Builder::new()
        .prefix("prismpm-browser-cargo-spoof-")
        .tempdir()
        .unwrap();
    let cargo = fake.path().join("cargo");
    std::fs::write(&cargo, b"#!/bin/sh\nexit 99\n").unwrap();
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&cargo, std::fs::Permissions::from_mode(0o755)).unwrap();
    }
    for mode in ["selector", "cargo"] {
        let mut child = std::process::Command::new(std::env::current_exe().unwrap());
        child
            .args(["--exact", NAME, "--nocapture"])
            .env("PRISMPM_TEST_BROWSER_TOOLCHAIN_NEGATIVE", mode);
        if mode == "selector" {
            child.env("RUSTUP_TOOLCHAIN", "1.96.0");
        } else {
            let mut paths = vec![fake.path().to_owned()];
            paths.extend(std::env::split_paths(&std::env::var_os("PATH").unwrap()));
            child
                .env("PATH", std::env::join_paths(paths).unwrap())
                .env("PRISMPM_TEST_BROWSER_SPOOF_DIR", fake.path());
        }
        let output = child.output().unwrap();
        assert!(
            output.status.success(),
            "{}\n{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed; 0 ignored"));
    }
}

#[test]
fn browser_compiler_actual_source_native_wasm_and_complete_replay() {
    let _compiler = crate::test_compiler::acquire();
    let repository = repository();
    let sources = [fixture(&repository), fixture(&repository)];
    let first = compile(sources[0].path()).unwrap();
    let second = compile(sources[1].path()).unwrap();
    assert_eq!(
        first.files, second.files,
        "all independent source/kernel/generated artifact bytes agree"
    );
    assert_eq!(first.plan.targets.len(), 6);
    assert_eq!(first.processes.len(), 16);
    assert_eq!(second.processes.len(), 16);
    for compilation in [&first, &second] {
        assert!(compilation
            .processes
            .iter()
            .all(|row| row.exit_code == 0 && row.executable_sha256.len() == 64));
        let output = tempfile::Builder::new()
            .prefix("prismpm-browser-compiler-oracle-")
            .tempdir()
            .unwrap();
        materialize(compilation, output.path());
        native(compilation, output.path(), true);
        native(compilation, output.path(), false);
        let checked = run_process(
            "browser-wasm-owning",
            &executable("node").unwrap(),
            &[
                repository
                    .join("tests/browser-compiler/wasm.mjs")
                    .to_string_lossy()
                    .into_owned(),
                output.path().to_string_lossy().into_owned(),
            ],
            &repository,
            &BTreeMap::new(),
            &[(output.path(), "$ORACLE"), (&repository, "$SDK")],
            "PP5004",
        )
        .unwrap();
        assert_eq!(checked.stdout.trim(), "PASS 21 Wasm source vectors, five exact maxima, six input overruns, six memory limits, two output overruns");
    }
    plan::require_replay(&first, &second.files).unwrap();
    for path in first.files.keys() {
        let mut mutation = first.files.clone();
        mutation.remove(path);
        assert!(
            plan::require_replay(&first, &mutation).is_err(),
            "missing {path}"
        );
        let mut mutation = first.files.clone();
        mutation.get_mut(path).unwrap().push(b'\n');
        assert!(
            plan::require_replay(&first, &mutation).is_err(),
            "changed {path}"
        );
    }
    let mut extra = first.files.clone();
    extra.insert("guests/extra.wasm".into(), b"unrequested".to_vec());
    extra.insert(
        "compiler/binding.json".into(),
        first.plan.binding(&extra).unwrap(),
    );
    assert!(
        plan::require_replay(&first, &extra).is_err(),
        "coherently rehashed extra artifact"
    );
    for target in first.plan.targets.values() {
        let prefix = format!("guests/{}/", target.id().unwrap());
        let mut forged = first.files.clone();
        forged
            .get_mut(&format!("{prefix}core.wasm"))
            .unwrap()
            .push(0);
        forged.insert(
            "compiler/binding.json".into(),
            first.plan.binding(&forged).unwrap(),
        );
        assert!(
            plan::require_replay(&first, &forged).is_err(),
            "coherently rehashed forged module"
        );
        for (field, value) in [
            ("entry", json!("other")),
            ("input_allocation_cap", json!(target.input_maximum - 1)),
            ("output_allocation_cap", json!(target.output_maximum + 1)),
            ("maximum_pages", json!(target.memory_pages + 1)),
        ] {
            let mut mutation = first.files.clone();
            let path = format!("{prefix}generation-manifest.json");
            let mut metadata = decode(&mutation[&path]).unwrap();
            metadata[field] = value;
            mutation.insert(path, encode_value(&metadata).unwrap());
            mutation.insert(
                "compiler/binding.json".into(),
                first.plan.binding(&mutation).unwrap(),
            );
            assert!(
                plan::require_replay(&first, &mutation).is_err(),
                "root/budget {field}"
            );
        }
    }
    for field in [
        "source/model.json",
        "compiler/policy.json",
        "source/attestation.json",
        "compiler/roots.json",
        "compiler/coverage.json",
    ] {
        let mut mutation = first.files.clone();
        let mut value = decode(&mutation[field]).unwrap();
        if let Some(object) = value.as_object_mut() {
            object.insert("unrequested".into(), json!(true));
        } else {
            value
                .as_array_mut()
                .unwrap()
                .push(json!({"resource":"unrequested"}));
        }
        mutation.insert(field.into(), encode_value(&value).unwrap());
        mutation.insert(
            "compiler/binding.json".into(),
            first.plan.binding(&mutation).unwrap(),
        );
        assert!(
            plan::require_replay(&first, &mutation).is_err(),
            "coherent policy/proof {field}"
        );
    }
}
