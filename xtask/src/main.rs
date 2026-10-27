//! Repository gates and verification commands for PrismPM.

// Gate orchestration preserves the complete public PrismError before
// converting it into the repository's boxed failure type.
#![allow(clippy::result_large_err)]

use sha2::Digest;
use std::path::Path;
use std::process::{Command, ExitCode, Output};
use std::sync::OnceLock;

mod audit;
mod codegen;
mod formatting;
mod gate_driver;
mod gate_root;
mod golden_preflight;
mod source_copy;
mod spec_links;
mod stdlib;

/// General error type for xtask commands.
pub type Fail = Box<dyn std::error::Error>;

static BUILD: OnceLock<Result<prismpm::controller::BuildResult, prismpm::PrismError>> =
    OnceLock::new();
static VERIFY: OnceLock<Result<prismpm::controller::VerifyResult, prismpm::PrismError>> =
    OnceLock::new();

fn diagnostic_failure(error: &prismpm::PrismError) -> Fail {
    serde_json::to_string(error)
        .expect("structured Prism diagnostic serializes")
        .into()
}

// A source build returns only owned identifiers. Join its temporary worker
// before verification so the allocator can reuse its arenas for verification,
// rather than retaining a separate main-thread arena for decoded build graphs.
fn join_build_worker<T: Send>(build: impl FnOnce() -> T + Send) -> T {
    std::thread::scope(|scope| {
        std::thread::Builder::new()
            .name("prismpm-gate-build".to_owned())
            .stack_size(16 * 1024 * 1024)
            .spawn_scoped(scope, build)
            .expect("start private gate build worker")
            .join()
            .expect("private gate build worker terminated unexpectedly")
    })
}

fn build_on_worker(
    controller: &prismpm::Controller,
) -> Result<prismpm::controller::BuildResult, prismpm::PrismError> {
    join_build_worker(|| controller.build(prismpm::controller::BuildRequest { config_path: None }))
}

fn build_once(root: &Path) -> Result<&'static prismpm::controller::BuildResult, Fail> {
    BUILD
        .get_or_init(|| {
            prismpm::Controller::load(root).and_then(|controller| build_on_worker(&controller))
        })
        .as_ref()
        .map_err(diagnostic_failure)
}

fn verify_once(root: &Path) -> Result<&'static prismpm::controller::VerifyResult, Fail> {
    VERIFY
        .get_or_init(|| {
            prismpm::Controller::load(root).and_then(|controller| {
                controller.verify(prismpm::controller::VerifyRequest { config_path: None })
            })
        })
        .as_ref()
        .map_err(diagnostic_failure)
}

#[cfg(test)]
mod build_worker_tests {
    #[test]
    fn owned_build_worker_finishes_before_results_escape() {
        use std::sync::atomic::{AtomicBool, Ordering};
        struct Finished<'a>(&'a AtomicBool);
        impl Drop for Finished<'_> {
            fn drop(&mut self) {
                self.0.store(true, Ordering::SeqCst);
            }
        }
        let finished = AtomicBool::new(false);
        let caller = std::thread::current().id();
        let borrowed = String::from("owned build identifiers");
        let result = super::join_build_worker(|| {
            assert_ne!(std::thread::current().id(), caller);
            let _finished = Finished(&finished);
            borrowed.clone()
        });
        assert!(finished.load(Ordering::SeqCst));
        assert_eq!(result, borrowed);
    }

    #[test]
    fn owned_build_worker_preserves_structured_failures() {
        let error = prismpm::PrismError::new("PP5007", "original build refusal");
        let result = super::join_build_worker(|| Err::<(), _>(error.clone()));
        assert_eq!(result.unwrap_err(), error);
    }

    #[test]
    fn owned_build_worker_panics_cannot_initialize_success_cache() {
        let cache = std::sync::OnceLock::<Result<(), prismpm::PrismError>>::new();
        assert!(std::panic::catch_unwind(|| {
            cache.get_or_init(|| super::join_build_worker(|| panic!("infrastructure failure")));
        })
        .is_err());
        assert!(cache.get().is_none());
    }
}

fn main() -> ExitCode {
    let task = std::env::args().nth(1).unwrap_or_else(|| "help".to_owned());
    let write = std::env::args().any(|arg| arg == "--write");
    let root = match std::env::current_dir()
        .map_err(|error| error.to_string())
        .and_then(|invocation| {
            gate_root::checked_root(
                &repo_model::repo_root(),
                Path::new(env!("CARGO_MANIFEST_DIR"))
                    .parent()
                    .expect("xtask is directly beneath the repository root"),
                &invocation,
            )
        }) {
        Ok(root) => root,
        Err(error) => {
            eprintln!("gate failed: {error}");
            return ExitCode::FAILURE;
        }
    };

    let result = match task.as_str() {
        "validate-model" => codegen::check_model(&root, write),
        "validate-spec-links" => spec_links::validate(&root),
        "validate-contract" => validate_contract(),
        "verify-examples" => verify_examples(&root, write),
        "check-golden" => check_golden(&root, write),
        "check-reproducibility" => check_reproducibility(&root),
        "check-fixtures" => check_fixtures(&root, write),
        "package-api" => package_api_check(&root),
        "stdlib-package" => stdlib::run(&root, &std::env::args().skip(2).collect::<Vec<_>>()),
        "release-artifacts" => release_artifacts(&root),
        "release-check" => release_check(&root),
        "validate" => validate_all(&root, false),
        "conformance" => run_conformance(&root, &std::env::args().skip(2).collect::<Vec<_>>()),
        "unit-tests" => run_unit_tests(&root),
        "vv" => run_vv(&root),
        _ => {
            eprintln!("Usage: cargo xtask <task>");
            return ExitCode::from(2);
        }
    };

    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("gate failed: {err}");
            ExitCode::FAILURE
        }
    }
}

fn validate_contract() -> Result<(), Fail> {
    let mut arguments = std::env::args().skip(2);
    let id = arguments
        .next()
        .ok_or("validate-contract requires a contract identifier")?;
    let path = arguments
        .next()
        .ok_or("validate-contract requires a document path")?;
    if arguments.next().is_some() {
        return Err("validate-contract accepts exactly two arguments".into());
    }
    let id: &'static str = match id.as_str() {
        "prismpm/bootstrap-evidence/1" => "prismpm/bootstrap-evidence/1",
        "prismpm/bootstrap-evidence/2" => "prismpm/bootstrap-evidence/2",
        _ => return Err(format!("validate-contract does not expose {id}").into()),
    };
    let bytes = std::fs::read(&path)?;
    let document = prismpm::contracts::CanonicalDocument::parse(id, &bytes)?;
    println!("{} {}", document.schema(), document.digest());
    Ok(())
}

fn run_conformance(root: &Path, args: &[String]) -> Result<(), Fail> {
    let category = args.first().map(|s| s.as_str()).unwrap_or("all");
    let filters: &[&str] = match category {
        "all" => &[],
        "contracts" => &["conformance_rp", "conformance_ar", "conformance_au"],
        "core" => &["conformance_ct", "conformance_ft", "conformance_lc"],
        "holo-stdlib" => &["conformance_ho", "conformance_st"],
        "desktop-browser" => &["conformance_dk"],
        "system-oci" => &[
            "conformance_sy",
            "conformance_oc",
            "conformance_dp",
            "conformance_op",
        ],
        "verification-schemas" => &[
            "conformance_sc",
            "conformance_se",
            "conformance_tm",
            "conformance_vr",
            "conformance_ex",
        ],
        custom => &[custom],
    };

    let mut cargo_args = vec![
        "test",
        "-p",
        "repo-conformance",
        "--test",
        "conformance",
        "--locked",
        "--offline",
    ];
    if !filters.is_empty() {
        cargo_args.push("--");
        cargo_args.extend_from_slice(filters);
    }

    println!("Running conformance suite: {category}");
    command(root, "cargo", &cargo_args)?;
    if matches!(category, "all" | "desktop-browser") {
        verify_standalone_browser_owners(root)?;
    }
    Ok(())
}

fn verify_standalone_browser_owners(root: &Path) -> Result<(), Fail> {
    command(
        root,
        "node",
        &["scripts/browser-api-sdk-check.mjs", "standalone"],
    )
}

fn run_unit_tests(root: &Path) -> Result<(), Fail> {
    println!("Running workspace unit and integration tests");
    command(
        root,
        "cargo",
        &[
            "test",
            "--workspace",
            "--bins",
            "--lib",
            "--tests",
            "--exclude",
            "repo-conformance",
            "--all-features",
            "--locked",
            "--offline",
        ],
    )?;
    // The separately owned integration suite must not run twice. Its library
    // and binary regressions still belong to the complete workspace unit gate.
    command(
        root,
        "cargo",
        &[
            "test",
            "--package",
            "repo-conformance",
            "--lib",
            "--bins",
            "--all-features",
            "--locked",
            "--offline",
        ],
    )?;
    Ok(())
}

fn validate_all(root: &Path, write: bool) -> Result<(), Fail> {
    codegen::check_model(root, write)?;
    spec_links::validate(root)?;
    audit_all(root)
}

fn audit_all(root: &Path) -> Result<(), Fail> {
    audit::audit_retained_native_profiles(root)?;
    audit::audit_shipped_standards_lock(root)?;
    command(
        root,
        "node",
        &[
            "--test",
            "scripts/oracle-source-closure.test.mjs",
            "scripts/hologram-source-pins.test.mjs",
            "scripts/fetch-oracle-cargo.test.mjs",
            "scripts/browser-api-sdk-check.test.mjs",
            "scripts/product-sdk-check.test.mjs",
            "scripts/library-sdk-check.test.mjs",
            "scripts/library-sdk-check-shell.test.mjs",
            "scripts/installed-exporter-concurrency.test.mjs",
            "sdk/migration-qualification.test.mjs",
            "sdk/npm/prism-code/test/archive.test.mjs",
            "sdk/npm/prism-code/test/blake3.test.mjs",
            "sdk/npm/prism-code/test/canonical.test.mjs",
            "sdk/npm/prism-code/test/cli.test.mjs",
            "sdk/npm/prism-code/test/closure.test.mjs",
            "sdk/npm/prism-code/test/errors.test.mjs",
            "sdk/npm/prism-code/test/inspect.test.mjs",
            "sdk/npm/prism-code/test/node.test.mjs",
            "sdk/npm/prism-code/test/verify.test.mjs",
            "sdk/npm/spec/test/agreement.test.mjs",
            "sdk/npm/spec/test/package.test.mjs",
            "sdk/npm/spec/test/reference.test.mjs",
            "sdk/npm/spec/test/schemas.test.mjs",
            "sdk/npm/verify/test/agreement.test.mjs",
            "sdk/npm/verify/test/browser.test.mjs",
            "sdk/npm/verify/test/entry-kinds.test.mjs",
            "sdk/npm/verify/test/inspect.test.mjs",
            "sdk/npm/verify/test/transparency.test.mjs",
            "sdk/npm/verify/test/verify.test.mjs",
            "scripts/sdk-vv-inputs.test.mjs",
            "scripts/sdk-vv-run.test.mjs",
            "scripts/sdk-image-inputs.test.mjs",
            "scripts/sdk-construction-workflow.test.mjs",
            "scripts/sdk-construction-record.test.mjs",
            "scripts/sdk-construction-handoff.test.mjs",
            "scripts/sdk-construction-archive.test.mjs",
            "scripts/sdk-construction-stage.test.mjs",
            "scripts/sdk-construction-metadata.test.mjs",
            "scripts/sdk-construction-provider.test.mjs",
            "scripts/sdk-construction-acquire.test.mjs",
            "scripts/sdk-construction-observe.test.mjs",
            "scripts/sdk-construction-acquisition-workflow.test.mjs",
            "scripts/unpublished-sdk-registry.test.mjs",
            "scripts/unpublished-sdk-qualification.test.mjs",
            "scripts/sdk-qualification-trust.test.mjs",
            "scripts/sdk-vv-check.test.mjs",
            "scripts/sdk-command-owner.test.mjs",
            "scripts/sdk-registry-reader.test.mjs",
            "scripts/sdk-registry-qualification.test.mjs",
            "scripts/native-golden.test.mjs",
            "scripts/browser-prerequisites.test.mjs",
            "scripts/browser-environment-preflight.test.mjs",
            "scripts/browser-engine-input.test.mjs",
            "scripts/chromium-interop-reader.test.mjs",
            "scripts/rust-oracle-tools-inputs.test.mjs",
            "scripts/qualify-debian-browser-inputs.test.mjs",
            "scripts/compiler-driver-cache.test.mjs",
            "scripts/compiler-phase-observation.test.mjs",
            "scripts/compiler-phase-transport.test.mjs",
            "tests/browser-view/compiler-artifact.test.mjs",
            "tests/browser-view/generated-package.test.mjs",
            "tests/browser-view/file-custody.test.mjs",
            "tests/browser-view/workspace-products.test.mjs",
            "tests/browser-session-payloads/transcript-retention.test.mjs",
            "tests/browser-view/generated-wasm.test.mjs",
            "tests/browser-presentation/provenance.test.mjs",
            "tests/browser-presentation/replay.test.mjs",
            "tests/browser-view/compiler-artifact-mutations.test.mjs",
            "tests/browser-view/compiler-owner.test.mjs",
            "tests/browser-view/compiler-component-binding.test.mjs",
            "tests/browser-view/compiler-runtime.test.mjs",
            "tests/browser-view/compiler-runtime-mutations.test.mjs",
            "scripts/portable-oracle-matrix.test.mjs",
            "tests/native-lease/corpus.test.mjs",
            "tests/native-lease/rust-corpus.test.mjs",
            "sdk/exporter-seed.test.mjs",
            "sdk/exporter-qualification.test.mjs",
            "tests/browser-view/generated-wasm-mutations.test.mjs",
            "tests/browser-session-journal/wasm-artifact-checks.test.mjs",
            "scripts/release-phases.test.mjs",
            "scripts/crate-readiness.test.mjs",
            "scripts/sdk-release-evidence.test.mjs",
            "scripts/release-gate-evidence.test.mjs",
            "scripts/refresh-osv.test.mjs",
            "scripts/qualify-osv.test.mjs",
            "scripts/ci-observe.test.mjs",
            "scripts/ci-capacity.test.mjs",
            "scripts/vv-sdk-session.test.mjs",
            "scripts/reconcile-lexlean.test.mjs",
            "sdk/bootstrap/runner.test.mjs",
        ],
    )?;
    audit::audit_no_handwritten_lean(root)?;
    audit::audit_formal_contract(root)?;
    audit::audit_no_unsafe(root)?;
    audit::audit_shipped(root)?;
    audit::audit_dependencies(root)?;
    audit::audit_runtime_oracle_separation(root)?;
    audit::audit_tools_ci(root)?;
    let model = repo_model::Model::load_from_repo_root()?;
    audit::audit_errors(root, &model)?;
    audit::audit_emitter_inputs(root, &model)?;
    audit::audit_standards_map(root, &model)?;
    Ok(())
}

fn command(root: &Path, program: &str, args: &[&str]) -> Result<(), Fail> {
    let mut child = Command::new(program);
    child
        .args(args)
        .current_dir(root)
        .env("CARGO_NET_OFFLINE", "true");
    // Cargo injects its Rust loader search path into xtask. It is not a Node
    // compiler input; use the same boundary as the owning conformance runner.
    if program == "node" {
        child.env_remove("LD_LIBRARY_PATH");
    }
    let status = child.status()?;
    if !status.success() {
        return Err(format!("{program} {} exited {status}", args.join(" ")).into());
    }
    Ok(())
}

fn command_quiet_stdout(root: &Path, program: &str, args: &[&str]) -> Result<(), Fail> {
    let output = Command::new(program)
        .args(args)
        .current_dir(root)
        .env("CARGO_NET_OFFLINE", "true")
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "{program} {} exited {}: {}",
            args.join(" "),
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    Ok(())
}

fn require_clean_worktree(root: &Path) -> Result<(), Fail> {
    let output = Command::new("git")
        .args(["status", "--porcelain=v1", "--untracked-files=all"])
        .current_dir(root)
        .output()?;
    if !output.status.success() {
        return Err(format!(
            "cannot inspect VV source worktree: {}",
            String::from_utf8_lossy(&output.stderr).trim()
        )
        .into());
    }
    if !output.stdout.is_empty() {
        return Err(format!(
            "VV requires a clean source commit; worktree changes:\n{}",
            String::from_utf8_lossy(&output.stdout).trim_end()
        )
        .into());
    }
    Ok(())
}

fn docker_sdk_command(image: &str, extra: &[&str]) -> Result<Output, Fail> {
    let mut arguments = vec![
        "run",
        "--rm",
        "--network",
        "none",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,noexec,nosuid,nodev",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
    ];
    arguments.extend_from_slice(extra);
    arguments.extend_from_slice(&[
        "--entrypoint",
        "/usr/local/bin/prismpm",
        image,
        "--json",
        "completion",
        "bash",
    ]);
    Ok(Command::new("docker").args(arguments).output()?)
}

fn assert_sdk_inventory_rejection(output: &Output, mutation: &str) -> Result<(), Fail> {
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    if output.status.success()
        || !stdout.contains("\"schema\":\"prismpm/error-result/1\"")
        || !stdout.contains("\"code\":\"PP5401\"")
    {
        return Err(format!(
            "released SDK accepted {mutation}, or returned the wrong diagnostic: status={} stdout={} stderr={}",
            output.status,
            stdout.trim(),
            stderr.trim()
        )
        .into());
    }
    Ok(())
}

fn mutated_sdk_command(
    image: &str,
    environment: Option<&str>,
    source: &Path,
    target: &str,
) -> Result<Output, Fail> {
    let mut arguments = vec![
        "create",
        "--network",
        "none",
        "--user",
        "1000:1000",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
    ];
    if let Some(environment) = environment {
        arguments.extend_from_slice(&["--env", environment]);
    }
    arguments.extend_from_slice(&[
        "--entrypoint",
        "/usr/local/bin/prismpm",
        image,
        "--json",
        "completion",
        "bash",
    ]);
    let created = Command::new("docker").args(arguments).output()?;
    if !created.status.success() {
        return Err(format!(
            "cannot create SDK mutation container: {}",
            String::from_utf8_lossy(&created.stderr).trim()
        )
        .into());
    }
    let container = String::from_utf8(created.stdout)?.trim().to_owned();
    if container.len() != 64 || !container.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("Docker returned a malformed mutation container ID".into());
    }
    let destination = format!("{container}:{target}");
    let copied = Command::new("docker")
        .arg("cp")
        .arg(source)
        .arg(&destination)
        .output()?;
    if !copied.status.success() {
        let _ = Command::new("docker")
            .args(["rm", "--force", &container])
            .output();
        return Err(format!(
            "cannot plant SDK mutation at {target}: {}",
            String::from_utf8_lossy(&copied.stderr).trim()
        )
        .into());
    }
    let output = Command::new("docker")
        .args(["start", "--attach", &container])
        .output();
    let removed = Command::new("docker")
        .args(["rm", "--force", &container])
        .output()?;
    if !removed.status.success() {
        return Err(format!(
            "cannot remove SDK mutation container: {}",
            String::from_utf8_lossy(&removed.stderr).trim()
        )
        .into());
    }
    Ok(output?)
}

fn validate_sdk_runtime_reference(image: &str) -> Result<(), Fail> {
    prismpm::oci::validate_reference(image, true)
        .map_err(|_| "SDK runtime boundary requires a valid immutable OCI SDK reference")?;
    Ok(())
}

fn check_sdk_runtime_boundary() -> Result<(), Fail> {
    let image = std::env::var("PRISMPM_TEST_SDK_IMAGE")
        .map_err(|_| "PRISMPM_TEST_SDK_IMAGE is required for the SDK runtime boundary gate")?;
    check_sdk_runtime_boundary_for_image(&image)
}

fn check_sdk_runtime_boundary_for_image(image: &str) -> Result<(), Fail> {
    validate_sdk_runtime_reference(image)?;

    let process_resource_tests = Command::new("node")
        .args(["--test", "scripts/sdk-runtime-exec.test.mjs"])
        .env("PRISMPM_TEST_SDK_IMAGE", image)
        .status()?;
    if !process_resource_tests.success() {
        return Err("SDK docker-exec process resource tests failed".into());
    }

    let infrastructure_tests = Command::new("docker")
        .args([
            "run",
            "--rm",
            "--user",
            "1000:1000",
            "--network",
            "none",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--workdir",
            "/opt/prismpm/share/conformance-root",
            "--entrypoint",
            "node",
            image,
            "--test",
            "scripts/sdk-candidate.test.mjs",
            "scripts/sdk-runtime-stack.test.mjs",
            "sdk/platform-lock.test.mjs",
        ])
        .status()?;
    if !infrastructure_tests.success() {
        return Err("SDK candidate transport or platform-lock negative tests failed".into());
    }

    let baseline = docker_sdk_command(image, &[])?;
    if !baseline.status.success()
        || !String::from_utf8_lossy(&baseline.stdout)
            .contains("\"schema\":\"prismpm/completion-result/1\"")
    {
        return Err(format!(
            "released SDK failed its immutable inventory baseline: status={} stdout={} stderr={}",
            baseline.status,
            String::from_utf8_lossy(&baseline.stdout).trim(),
            String::from_utf8_lossy(&baseline.stderr).trim()
        )
        .into());
    }

    let override_attempt = docker_sdk_command(
        image,
        &[
            "--env",
            "PRISMPM_SDK_INVENTORY=/tmp/attacker-inventory.json",
        ],
    )?;
    if !override_attempt.status.success() || override_attempt.stdout != baseline.stdout {
        return Err(format!(
            "caller-controlled inventory environment changed released SDK behavior: status={} stdout={} stderr={}",
            override_attempt.status,
            String::from_utf8_lossy(&override_attempt.stdout).trim(),
            String::from_utf8_lossy(&override_attempt.stderr).trim()
        )
        .into());
    }

    let planted = tempfile::tempdir()?;
    let planted_command = planted.path().join("undeclared-sdk-command");
    std::fs::write(&planted_command, b"#!/bin/sh\nexit 0\n")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&planted_command, std::fs::Permissions::from_mode(0o755))?;
    }
    let injected = mutated_sdk_command(
        image,
        Some("PATH=/planted:/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin"),
        planted.path(),
        "/planted",
    )?;
    assert_sdk_inventory_rejection(&injected, "an undeclared executable on PATH")?;

    let tampered = tempfile::NamedTempFile::new()?;
    std::fs::write(tampered.path(), b"#!/bin/sh\nexit 0\n")?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(tampered.path(), std::fs::Permissions::from_mode(0o755))?;
    }
    let changed = mutated_sdk_command(image, None, tampered.path(), "/usr/local/bin/just")?;
    assert_sdk_inventory_rejection(&changed, "a changed declared executable")?;

    println!(
        "SDK runtime boundary: immutable inventory accepted the exact image and rejected environment override, PATH injection, and executable tampering"
    );
    Ok(())
}

fn run_vv(root: &Path) -> Result<(), Fail> {
    // Evidence is a result of this run, never an input to it.  Removing a
    // prior ignored record makes the gate repeatable and prevents a stale
    // success marker from changing the outcome of negative release tests.
    match std::fs::remove_file(root.join("target/vv-evidence.json")) {
        Ok(()) => {}
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
        Err(error) => return Err(format!("cannot invalidate prior vv evidence: {error}").into()),
    }
    require_clean_worktree(root)?;
    let driver = gate_driver::GateDriver::capture(root)?;

    println!("VV gate 1/15: formatting");
    for invocation in formatting::commands(root)? {
        command(root, invocation.program, &invocation.arguments)?;
    }

    println!("VV gate 2/15: model, diagnostics, standards, and generated documentation");
    codegen::check_model(root, false)?;

    println!("VV gate 3/15: SPEC/register/scenario/test links");
    spec_links::validate(root)?;

    println!("VV gate 4/15: source, error, unsafe, dependency, and generated-file audits");
    command_quiet_stdout(
        root,
        "cargo",
        &["metadata", "--locked", "--offline", "--format-version", "1"],
    )?;
    audit_all(root)?;
    command(root, "bash", &["scripts/bootstrap-verify.sh"])?;
    check_sdk_runtime_boundary()?;
    // The shipped SDK correctly rejects a synthetic current native inventory.
    // Exercise real OCI update transport separately in the source bootstrap
    // environment, without weakening that runtime check or replacing xtask.
    driver.run_cargo(
        root,
        &[
            "build",
            "-p",
            "prismpm",
            "--bin",
            "prismpm",
            "--locked",
            "--offline",
        ],
    )?;
    let update_cli = driver.prismpm_binary();
    command(
        root,
        "node",
        &["sdk/metadata-materialization.integration.mjs"],
    )?;
    command(
        root,
        "node",
        &[
            "sdk/platform-lock.integration.mjs",
            update_cli
                .to_str()
                .ok_or("SDK update CLI path is not UTF-8")?,
        ],
    )?;

    println!("VV gate 5/15: Clippy with warnings denied");
    driver.run_cargo(
        root,
        &[
            "clippy",
            "--workspace",
            "--all-targets",
            "--all-features",
            "--locked",
            "--offline",
            "--",
            "-D",
            "warnings",
        ],
    )?;

    println!("VV gate 6/15: workspace unit and property tests");
    driver.run_cargo(
        root,
        &[
            "test",
            "--workspace",
            "--all-features",
            "--locked",
            "--offline",
        ],
    )?;

    // Separate original standalone pairs are not implied by registered DK
    // execution or by including their source files in an SDK inventory.
    verify_standalone_browser_owners(root)?;

    println!("VV gate 7/15: feature, conformance, and negative fixtures");
    check_fixtures(root, false)?;
    command(
        root,
        "cargo",
        &[
            "run",
            "--locked",
            "--offline",
            "--manifest-path",
            "tests/holo-codec-oracle/Cargo.toml",
            "--target-dir",
            "target/holo-codec-oracle",
        ],
    )?;

    println!("VV gate 8/15: generated Lean build, replay, axiom audit, and source audit");
    verify_examples(root, false)?;
    audit::audit_no_handwritten_lean(root)?;

    println!("VV gate 9/15: LexLean format/lock and Prism check/build/verify");
    for operation in [["fmt", "--check"], ["lock", "--check"]] {
        command(
            root,
            "cargo",
            &[
                "run",
                "--locked",
                "--offline",
                "--target-dir",
                "target/vendor-lexlean",
                "--manifest-path",
                "vendor/lexlean/Cargo.toml",
                "--",
                "--project",
                "lexlean.toml",
                operation[0],
                operation[1],
            ],
        )?;
    }
    let controller = prismpm::Controller::load(root)?;
    controller.check(prismpm::controller::CheckRequest { config_path: None })?;
    let _ = build_once(root)?;
    let _ = verify_once(root)?;

    println!("VV gate 10/15: Holo schema and reviewed golden bytes");
    check_golden(root, false)?;

    println!("VV gate 11/15: named export, coverage, Rust compilation, and execution evidence");
    check_verified_evidence(root)?;

    println!("VV gate 12/15: two-absolute-directory reproducibility");
    check_reproducibility(root)?;

    println!("VV gate 13/15: authoritative upstream corpora, registry, and runtime conformance");
    let upstream = prismpm::upstream_conformance::verify(root)?;
    println!(
        "upstream conformance: JSON Schema +{}/-{}, Unicode {}, OCI Runtime +{}/-{}, OCI Distribution {}/{}",
        upstream.json_schema.positive,
        upstream.json_schema.negative,
        upstream.unicode.positive,
        upstream.oci_runtime.positive,
        upstream.oci_runtime.negative,
        upstream.oci_distribution.passed,
        upstream.oci_distribution.failed
    );

    println!("VV gate 14/15: dependency policy");
    command(
        root,
        "cargo",
        &["deny", "--frozen", "--all-features", "check"],
    )?;

    println!("VV gate 15/15: verified stdlib package, crate archives, and downstream public API");
    package_api_check(root)?;

    require_clean_worktree(root)?;

    let commit = Command::new("git")
        .args(["rev-parse", "HEAD"])
        .current_dir(root)
        .output()?;
    if !commit.status.success() {
        return Err("cannot identify vv source commit".into());
    }
    let commit = String::from_utf8(commit.stdout)?.trim().to_owned();
    let evidence = serde_json::json!({
        "commit": commit,
        "gates": (1_u8..=15).collect::<Vec<_>>(),
        "schema": "prismpm/vv-evidence/1",
        "status": "passed"
    });
    std::fs::create_dir_all(root.join("target"))?;
    std::fs::write(
        root.join("target/vv-evidence.json"),
        prismpm::holo::canonical::encode_value(&evidence)?,
    )?;
    println!("All 15 VV gates PASSED for commit {commit}.");
    Ok(())
}

fn verify_examples(root: &Path, _write: bool) -> Result<(), Fail> {
    let controller = prismpm::Controller::load(root)?;
    let check_res = controller.check(prismpm::controller::CheckRequest { config_path: None })?;
    println!(
        "verify-examples: checked model document {}",
        check_res.model_id
    );
    let verify_res = verify_once(root)?;
    println!(
        "verify-examples: verified attestation {}",
        verify_res.attestation_id
    );

    let mut outputs: Vec<(&str, ApplicationOutputs)> = Vec::new();
    for example in &EXAMPLES {
        let name = example.name;
        let application_root = root.join(example.project);
        let application = prismpm::Controller::load(&application_root)?;
        let check = application.check(prismpm::controller::CheckRequest { config_path: None })?;
        let first = application.build(prismpm::controller::BuildRequest { config_path: None })?;
        let second = application.build(prismpm::controller::BuildRequest { config_path: None })?;
        if first.build_id != second.build_id {
            return Err(format!("{name} build identity changed between consecutive builds").into());
        }
        let first_verify =
            application.verify(prismpm::controller::VerifyRequest { config_path: None })?;
        let second_verify =
            application.verify(prismpm::controller::VerifyRequest { config_path: None })?;
        if first_verify.attestation_id != second_verify.attestation_id {
            return Err(
                format!("{name} verification identity changed between consecutive runs").into(),
            );
        }
        let verified_root = application_root.join(&first_verify.verified_root);
        let acceptance: serde_json::Value = serde_json::from_slice(&std::fs::read(
            verified_root.join("application-acceptance.json"),
        )?)?;
        let build_root = verified_root
            .parent()
            .and_then(Path::parent)
            .ok_or("verified root has no build root")?
            .join("build")
            .join(&first_verify.build_id);
        check_command_line(example, &build_root, &acceptance)?;
        let observed = application_outputs(&build_root, &acceptance)?;
        if let Some(reference) = example.same_outputs_as {
            let (_, expected) = outputs
                .iter()
                .find(|(other, _)| *other == reference)
                .ok_or_else(|| format!("verify-examples: {name} names no earlier {reference}"))?;
            if let Some(path) = first_difference(expected, &observed) {
                return Err(format!(
                    "verify-examples: {name} differs from {reference} in {path} (provenance masked)"
                )
                .into());
            }
        }
        outputs.push((name, observed));
        println!(
            "verify-examples: {name} model {} reproduced build {} and verified attestation {}{}",
            check.model_id,
            first.build_id,
            first_verify.attestation_id,
            if example.command_line.is_some() {
                " with its command line"
            } else {
                ""
            }
        );
    }
    Ok(())
}

/// A project that `verify-examples` checks, builds twice and verifies twice.
struct Example {
    name: &'static str,
    project: &'static str,
    /// The command line the verified build must publish and accept, or `None`
    /// when the project's model declares no command line.
    command_line: Option<CommandLine>,
    /// An earlier example whose generated application outputs and acceptance
    /// result this one must equal, provenance masked.
    same_outputs_as: Option<&'static str>,
}

/// The generated browser files and the acceptance result of one verified
/// build, keyed by path, with provenance masked: `provenance.json` and the
/// acceptance fields that identify the source, the build, the LexLean
/// attestation and the holo archives (which hash the source manifest).
type ApplicationOutputs = std::collections::BTreeMap<String, Vec<u8>>;

const PROVENANCE_ACCEPTANCE_FIELDS: [&str; 4] =
    ["build_id", "holo", "lexlean_attestation_id", "source_id"];

fn application_outputs(
    build_root: &Path,
    acceptance: &serde_json::Value,
) -> Result<ApplicationOutputs, Fail> {
    let mut outputs = ApplicationOutputs::new();
    for entry in std::fs::read_dir(build_root.join("view/browser"))? {
        let entry = entry?;
        let name = entry.file_name().to_string_lossy().into_owned();
        if name != "provenance.json" && entry.file_type()?.is_file() {
            outputs.insert(format!("view/browser/{name}"), std::fs::read(entry.path())?);
        }
    }
    let mut masked = acceptance.clone();
    let fields = masked
        .as_object_mut()
        .ok_or("application acceptance is not an object")?;
    for field in PROVENANCE_ACCEPTANCE_FIELDS {
        fields.remove(field);
    }
    outputs.insert(
        "application-acceptance.json".to_owned(),
        serde_json::to_vec(&masked)?,
    );
    Ok(outputs)
}

/// The first path whose bytes differ, or that only one side has.
fn first_difference(
    expected: &ApplicationOutputs,
    observed: &ApplicationOutputs,
) -> Option<String> {
    expected
        .keys()
        .chain(observed.keys())
        .find(|path| expected.get(*path) != observed.get(*path))
        .cloned()
}

/// A modeled text/3 command line and the acceptance partition its
/// verification must report.
struct CommandLine {
    program: &'static str,
    vectors: u64,
    within_request_maximum: u64,
    oversized_vectors: u64,
    examples: u64,
}

/// The static programs every text/3 build publishes (SPEC, text/3 profile).
const COMMAND_LINE_TARGETS: [&str; 2] = ["aarch64-unknown-linux-musl", "x86_64-unknown-linux-musl"];

/// Every project `verify-examples` builds and verifies. The text/3 project
/// makes V&V produce a generated command line and accept it over vectors
/// within and beyond its request maximum. Calculator is built in both LexLean
/// languages; the 1.2 copy is `lexlean migrate --to 1.2` of the 1.1 example.
const EXAMPLES: [Example; 4] = [
    Example {
        name: "Calculator",
        project: "examples/Calculator",
        command_line: None,
        same_outputs_as: None,
    },
    Example {
        name: "Calculator (language 1.2)",
        project: "tests/fixtures/controller/ct-02-calculator-language-1-2/project",
        command_line: None,
        same_outputs_as: Some("Calculator"),
    },
    Example {
        name: "Text Request",
        project: "tests/fixtures/holo/ho-11-text-application/project",
        command_line: None,
        same_outputs_as: None,
    },
    Example {
        name: "Text Check",
        project: "tests/fixtures/holo/ho-17-text-cli/project",
        command_line: Some(CommandLine {
            program: "prism-text-check",
            vectors: 6,
            within_request_maximum: 4,
            oversized_vectors: 2,
            examples: 2,
        }),
        same_outputs_as: None,
    },
];

/// Require the verified build of `example` to publish and accept exactly the
/// command line it expects, and no command line when it expects none.
fn check_command_line(
    example: &Example,
    build_root: &Path,
    acceptance: &serde_json::Value,
) -> Result<(), Fail> {
    let name = example.name;
    let evidence = acceptance.get("command_line");
    let Some(expected) = &example.command_line else {
        if evidence.is_some() || build_root.join("cli").exists() {
            return Err(format!(
                "verify-examples: {name} publishes a command line that its expectation does not declare"
            )
            .into());
        }
        return Ok(());
    };
    if expected.within_request_maximum == 0 || expected.oversized_vectors == 0 {
        return Err(format!(
            "verify-examples: {name} must exercise vectors within and beyond its request maximum"
        )
        .into());
    }
    let evidence = evidence
        .ok_or_else(|| format!("verify-examples: {name} verification accepted no command line"))?;
    for (field, value) in [
        ("schema", serde_json::json!("prismpm/text-cli-acceptance/1")),
        ("status", serde_json::json!("verified")),
        ("vectors", serde_json::json!(expected.vectors)),
        (
            "within_request_maximum",
            serde_json::json!(expected.within_request_maximum),
        ),
        (
            "oversized_vectors",
            serde_json::json!(expected.oversized_vectors),
        ),
        ("examples", serde_json::json!(expected.examples)),
    ] {
        let actual = evidence.get(field).unwrap_or(&serde_json::Value::Null);
        if *actual != value {
            return Err(format!(
                "verify-examples: {name} command-line {field} is {actual}, expected {value}"
            )
            .into());
        }
    }
    let programs = evidence
        .get("programs")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| format!("verify-examples: {name} command line lists no programs"))?;
    if programs.len() != COMMAND_LINE_TARGETS.len() {
        return Err(format!(
            "verify-examples: {name} command line lists {} programs, expected {}",
            programs.len(),
            COMMAND_LINE_TARGETS.len()
        )
        .into());
    }
    for target in COMMAND_LINE_TARGETS {
        let path = format!("cli/bin/{target}/{}", expected.program);
        let row = programs
            .iter()
            .find(|row| row.get("path").and_then(serde_json::Value::as_str) == Some(&path))
            .ok_or_else(|| format!("verify-examples: {name} command line does not list {path}"))?;
        let bytes = std::fs::read(build_root.join(&path))
            .map_err(|error| format!("verify-examples: {name} build lacks {path}: {error}"))?;
        let digest = format!("{:x}", sha2::Sha256::digest(&bytes));
        if row.get("sha256").and_then(serde_json::Value::as_str) != Some(&digest)
            || row.get("target").and_then(serde_json::Value::as_str) != Some(target)
        {
            return Err(format!(
                "verify-examples: {name} accepted {path} under another digest or target than it built"
            )
            .into());
        }
    }
    if !build_root.join("cli/sbom.spdx.json").is_file() {
        return Err(format!("verify-examples: {name} build lacks cli/sbom.spdx.json").into());
    }
    Ok(())
}

fn tree_files(root: &Path) -> Result<Vec<(String, Vec<u8>)>, Fail> {
    let mut files = Vec::new();
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry?;
        if entry.file_type().is_symlink() {
            return Err(format!("golden input contains symlink {}", entry.path().display()).into());
        }
        if entry.file_type().is_file() {
            files.push((
                entry
                    .path()
                    .strip_prefix(root)?
                    .to_string_lossy()
                    .replace('\\', "/"),
                std::fs::read(entry.path())?,
            ));
        }
    }
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    Ok(files)
}

fn golden_verification_files(mut files: Vec<(String, Vec<u8>)>) -> Vec<(String, Vec<u8>)> {
    // Reviewed goldens retain artifact descriptors, not regenerated native
    // payloads. The actual verification and OCI closures retain all three.
    files.retain(|(relative, _)| {
        !matches!(
            relative.as_str(),
            "generated.rs" | "kernel.ir" | "validator"
        )
    });
    files
}

fn golden_files(root: &Path, review_reason: &str) -> Result<Vec<(String, Vec<u8>)>, Fail> {
    let build_res = build_once(root)?;
    let verify_res = verify_once(root)?;
    if verify_res.build_id != build_res.build_id {
        return Err("golden build and verification IDs differ".into());
    }
    let build_root = root.join(".prism/build").join(&build_res.build_id);
    let verified_root = root
        .join(".prism/verified")
        .join(&verify_res.attestation_id);
    let mut files = Vec::new();
    for (relative, bytes) in tree_files(&root.join("stdlib/src"))? {
        if relative.ends_with(".lex.tex") {
            files.push((format!("source/{relative}"), bytes));
        }
    }
    for (relative, bytes) in tree_files(&build_root)? {
        files.push((format!("build/{relative}"), bytes));
    }
    for (relative, bytes) in golden_verification_files(tree_files(&verified_root)?) {
        files.push((format!("verified/{relative}"), bytes));
    }
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));

    let model: serde_json::Value =
        serde_json::from_slice(&std::fs::read(build_root.join("model.prism.json"))?)?;
    let compiler_semantics_id = model
        .pointer("/provenance/compiler_semantics_id")
        .and_then(serde_json::Value::as_str)
        .ok_or("golden model-document compiler semantics ID is absent")?;
    let rows = files
        .iter()
        .map(|(path, bytes)| {
            serde_json::json!({
                "byte_length": bytes.len(),
                "path": path,
                "sha256": format!("{:x}", sha2::Sha256::digest(bytes))
            })
        })
        .collect::<Vec<_>>();
    let sources = rows
        .iter()
        .filter(|row| {
            row.get("path")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|path| path.starts_with("source/"))
        })
        .cloned()
        .collect::<Vec<_>>();
    let source_hashes = sources
        .iter()
        .filter_map(|row| {
            Some((
                row.get("path")?.as_str()?.to_owned(),
                row.get("sha256")?.as_str()?.to_owned(),
            ))
        })
        .collect::<std::collections::BTreeMap<_, _>>();
    let generated_lean = rows
        .iter()
        .filter(|row| {
            row.get("path")
                .and_then(serde_json::Value::as_str)
                .is_some_and(|path| path.starts_with("build/") && path.ends_with(".lean"))
        })
        .map(|row| {
            let path = row
                .get("path")
                .and_then(serde_json::Value::as_str)
                .expect("filtered golden path is a string");
            let logical = path
                .strip_prefix("build/lexlean/build/modules/PrismPM/")
                .and_then(|path| path.strip_suffix(".lean"))
                .ok_or_else(|| format!("unexpected generated Lean golden path {path}"))?;
            let source_path = format!("source/{logical}.lex.tex");
            let source_sha256 = source_hashes.get(&source_path).ok_or_else(|| {
                format!("generated Lean golden {path} has no source {source_path}")
            })?;
            Ok(serde_json::json!({
                "byte_length": row.get("byte_length"),
                "path": path,
                "sha256": row.get("sha256"),
                "source_path": source_path,
                "source_sha256": source_sha256
            }))
        })
        .collect::<Result<Vec<_>, Fail>>()?;
    let manifest = serde_json::json!({
        "attestation_id": verify_res.attestation_id,
        "build_id": build_res.build_id,
        "comparison_profile": repo_conformance::golden::PROFILE,
        "compiler_semantics_id": compiler_semantics_id,
        "files": rows,
        "generated_lean": generated_lean,
        "review_reason": review_reason,
        "schema": "prismpm/golden-manifest/2",
        "sources": sources
    });
    files.push((
        "golden-manifest.json".to_owned(),
        prismpm::holo::canonical::encode_value(&manifest)?,
    ));
    files.sort_by(|a, b| a.0.as_bytes().cmp(b.0.as_bytes()));
    repo_conformance::golden::current_caller(&files, &std::fs::read(std::env::current_exe()?)?)?;
    Ok(files)
}

fn check_golden(root: &Path, write: bool) -> Result<(), Fail> {
    use repo_conformance::golden::{self, platform::Platform};
    let platform = Platform::current()?;
    let destination = root.join(platform.directory());
    let review_reason = if write {
        std::env::var("PRISMPM_GOLDEN_REASON")
            .map_err(|_| "golden rewrite requires nonempty PRISMPM_GOLDEN_REASON")?
    } else {
        let value: serde_json::Value = serde_json::from_slice(
            &std::fs::read(destination.join("golden-manifest.json")).map_err(|error| {
                format!("golden manifest is absent: {error}; use just golden-write with a review reason")
            })?,
        )?;
        value
            .get("review_reason")
            .and_then(serde_json::Value::as_str)
            .filter(|reason| !reason.trim().is_empty())
            .ok_or("golden review reason is absent")?
            .to_owned()
    };
    if review_reason.trim().is_empty() {
        return Err("golden review reason may not be empty".into());
    }
    let expected =
        golden_preflight::generate(root, platform, || golden_files(root, &review_reason))?;
    if write {
        let expected = if platform == Platform::DevelopmentAmd64 {
            golden::native_records(&expected, &expected, platform)?;
            expected
        } else {
            let base = golden::read(&root.join(Platform::DevelopmentAmd64.directory()))?;
            golden::native_records(&base, &expected, platform)?
        };
        let parent = destination
            .parent()
            .ok_or("golden destination has no parent")?;
        std::fs::create_dir_all(parent)?;
        let staging = tempfile::Builder::new()
            .prefix("stdlib-golden-")
            .tempdir_in(parent)?;
        for (relative, bytes) in &expected {
            let path = staging.path().join(relative);
            if let Some(directory) = path.parent() {
                std::fs::create_dir_all(directory)?;
            }
            std::fs::write(path, bytes)?;
        }
        if destination.exists() {
            std::fs::remove_dir_all(&destination)?;
        }
        std::fs::rename(staging.keep(), &destination)?;
        println!(
            "check-golden: wrote {} reviewed files for build {}",
            expected.len(),
            build_once(root)?.build_id
        );
        return Ok(());
    }
    let observed = golden::read_platform(root, platform)?;
    golden::native_records(&observed, &expected, platform)?;
    golden::compare(&observed, &expected)?;
    println!(
        "check-golden: {} files match reviewed build {} ({platform:?})",
        observed.len(),
        build_once(root)?.build_id
    );
    Ok(())
}

fn check_verified_evidence(root: &Path) -> Result<(), Fail> {
    let verified = verify_once(root)?;
    let repeated = prismpm::Controller::load(root)?
        .verify(prismpm::controller::VerifyRequest { config_path: None })?;
    if repeated.attestation_id != verified.attestation_id || repeated.build_id != verified.build_id
    {
        return Err("repeated fixed-seed verification produced a different identity".into());
    }
    let directory = root.join(".prism/verified").join(&verified.attestation_id);
    let manifest: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join("manifest.json"))?)?;
    if manifest.get("schema").and_then(serde_json::Value::as_str)
        != Some("prismpm/verification-manifest/2")
        || manifest
            .pointer("/execution/status")
            .and_then(serde_json::Value::as_str)
            != Some("passed")
        || manifest
            .pointer("/execution/no_allocation")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
        || manifest
            .pointer("/execution/no_panic")
            .and_then(serde_json::Value::as_bool)
            != Some(true)
    {
        return Err("verification manifest does not contain passing execution evidence".into());
    }
    for artifact in [
        "coverage",
        "executable",
        "generated_rust",
        "kernel_ir",
        "lexlean_attestation",
        "model",
        "execution_corpus",
        "execution_evidence",
        "roots",
    ] {
        if manifest
            .pointer(&format!("/artifacts/{artifact}/sha256"))
            .is_none()
        {
            return Err(format!("verification manifest lacks artifact {artifact}").into());
        }
    }
    let coverage: serde_json::Value =
        serde_json::from_slice(&std::fs::read(directory.join("coverage.json"))?)?;
    for rejected in ["opaque_nodes", "external_calls", "unsupported_types"] {
        if !coverage
            .get(rejected)
            .and_then(serde_json::Value::as_array)
            .is_some_and(Vec::is_empty)
        {
            return Err(format!("verification coverage contains {rejected}").into());
        }
    }
    println!(
        "check-verified-evidence: named closure and execution evidence are complete for {}",
        verified.attestation_id
    );
    Ok(())
}

fn verify_packaged_blake3_corpus(packaged: &Path) -> Result<(), Fail> {
    let evidence = prismpm::upstream_conformance::verify_blake3_corpus(
        &packaged.join("standards/corpora/blake3-1.5.5"),
    )?;
    if evidence.corpus_sha256
        != "sha256:f8ffc0176af3fed9ce66b92f60c424d96f413fa044d7b341fc63b896428037c9"
        || (
            evidence.positive,
            evidence.negative,
            evidence.planted_rejections,
        ) != (35, 0, 5)
    {
        return Err("packaged BLAKE3 corpus qualification differs".into());
    }
    Ok(())
}

fn package_api_check(root: &Path) -> Result<(), Fail> {
    stdlib::check_acceptance(root)?;
    let selection = Command::new("cargo")
        .args(["package", "--package", "prismpm", "--list", "--allow-dirty"])
        .current_dir(root)
        .env("CARGO_NET_OFFLINE", "true")
        .output()?;
    if !selection.status.success() {
        return Err(format!(
            "cargo package selection failed: {}",
            String::from_utf8_lossy(&selection.stderr)
        )
        .into());
    }
    let temp = tempfile::tempdir()?;
    let packaged = temp
        .path()
        .join(format!("prismpm-{}", env!("CARGO_PKG_VERSION")));
    std::fs::create_dir(&packaged)?;
    let crate_root = root.join("crates/prismpm");
    for relative in String::from_utf8(selection.stdout)?.lines() {
        if matches!(
            relative,
            ".cargo_vcs_info.json" | "Cargo.lock" | "Cargo.toml" | "Cargo.toml.orig"
        ) {
            continue;
        }
        let source = crate_root.join(relative);
        let destination = packaged.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::copy(&source, &destination).map_err(|error| {
            format!(
                "copying selected package file {}: {error}",
                source.display()
            )
        })?;
    }
    std::fs::write(
        packaged.join("Cargo.toml"),
        standalone_package_manifest(
            &std::fs::read_to_string(crate_root.join("Cargo.toml"))?,
            &std::fs::read_to_string(root.join("Cargo.toml"))?,
        )?,
    )?;
    for required in [
        "CHANGELOG.md",
        "CONFORMANCE.md",
        "ERRORS.md",
        "LICENSE-APACHE",
        "LICENSE-MIT",
        "README.md",
        "SPEC.md",
        "language/prism.arch/lexicon.toml",
        "model/dependencies.toml",
        "model/stdlib-exports.toml",
        "model/browser-diagnostics.toml",
        "model/browser-adapter-diagnostics.toml",
        "model/browser-view-diagnostics.toml",
        "model/browser-effect-diagnostics.json",
        "model/browser-presentation-diagnostics.json",
        "sdk/browser/identity.mjs",
        "sdk/browser/store.mjs",
        "sdk/browser/peer.mjs",
        "sdk/browser/journal.mjs",
        "sdk/browser/commands.mjs",
        "sdk/browser/queries.mjs",
        "sdk/sdk-index-extensions.json",
        "sdk/browser/view-host.mjs",
        "sdk/browser/view-dom.mjs",
        "sdk/browser/view-error.mjs",
        "sdk/browser/effects.mjs",
        "sdk/browser/effects-wire.mjs",
        "sdk/browser/effects-module.mjs",
        "sdk/browser/presentation-wire.mjs",
        "sdk/browser/presentation-dom.mjs",
        "tests/browser_stdlib_api.rs",
        "model/stdlib-package.toml",
        "schemas/model-document.schema.json",
        "sdk/asyncapi-runtime/package.json",
        "sdk/asyncapi-runtime/package-lock.json",
        "sdk/asyncapi-runtime/launcher.mjs",
        "sdk/asyncapi-runtime/launcher.sh",
        "sdk/asyncapi-runtime/launcher.test.mjs",
        "sdk/oracles/kubernetes-validator.mjs",
        "adapters/ingress-nginx-kind-v1.15.1.yaml",
        "src/prod_alloc_counter.rs.inc",
        "standards.lock",
        "stdlib/src/Foundation/Holo.lex.tex",
        "stdlib/src/Foundation/Browser/V1/WorkspaceCommand.lex.tex",
        "stdlib/src/Foundation/Browser/V1/WorkspaceCommandCorpus.lex.tex",
        "stdlib/src/Foundation/Browser/V1/WorkspaceQuery.lex.tex",
        "stdlib/src/Foundation/Browser/V1/WorkspaceQueryCorpus.lex.tex",
        "stdlib/src/Foundation/View/Workspace/V1/Interaction.lex.tex",
        "stdlib/src/Foundation/View/Workspace/V1/Corpus.lex.tex",
        "stdlib/LICENSE-APACHE",
        "stdlib/LICENSE-MIT",
        "vendor/lean4-prod/lean.tar",
    ] {
        if !packaged.join(required).is_file() {
            return Err(format!("packaged crate omits {required}").into());
        }
    }
    verify_packaged_blake3_corpus(&packaged)?;
    for entry in walkdir::WalkDir::new(&packaged) {
        let entry = entry?;
        let relative = entry.path().strip_prefix(&packaged)?.to_string_lossy();
        if relative.ends_with("lakefile.lean")
            || (relative.ends_with(".lean") && !relative.contains("tests/golden/stdlib/"))
            || relative.contains("/.lake/")
            || relative.contains("/.prism/")
            || relative.contains("/.lexlean/")
        {
            return Err(format!("packaged crate contains forbidden path {relative}").into());
        }
    }

    let downstream = temp.path().join("downstream");
    std::fs::create_dir(&downstream)?;
    let cargo_toml = format!(
        "[package]\nname = \"prismpm-downstream\"\nversion = \"0.0.0\"\nedition = \"2021\"\n\n[dependencies]\nprismpm = {{ path = {:?} }}\n\n[patch.crates-io]\nlexlean = {{ path = {:?} }}\nprod-codegen = {{ path = {:?} }}\nprod-ir = {{ path = {:?} }}\nprism-stdlib = {{ path = {:?} }}\n",
        packaged,
        root.join("vendor/lexlean"),
        root.join("vendor/lean4-prod/rust/prod-codegen"),
        root.join("vendor/lean4-prod/rust/prod-ir"),
        root.join("stdlib/generated/package"),
    );
    std::fs::write(downstream.join("Cargo.toml"), cargo_toml)?;
    std::fs::create_dir(downstream.join("src"))?;
    std::fs::write(
        downstream.join("src/main.rs"),
        "use prismpm::{controller::CheckRequest, Controller};\nfn main() { let _ = Controller::load(\".\"); let _ = CheckRequest { config_path: None }; }\n",
    )?;
    command(&downstream, "cargo", &["check", "--offline"])?;
    let package_files = tree_files(&packaged)?;
    let mut package_hasher = sha2::Sha256::new();
    for (path, bytes) in package_files {
        package_hasher.update((path.len() as u64).to_be_bytes());
        package_hasher.update(path.as_bytes());
        package_hasher.update((bytes.len() as u64).to_be_bytes());
        package_hasher.update(bytes);
    }
    println!(
        "package-api: Cargo-selected package assets and downstream public API compile (tree sha256 {:x})",
        package_hasher.finalize()
    );
    command(
        root,
        "sh",
        &["scripts/package-release-crates.sh", "--check"],
    )?;
    Ok(())
}

// Resolve the same workspace inheritance used by the real package instead of
// keeping a second dependency list that can silently drift from Cargo.toml.
fn standalone_package_manifest(source: &str, workspace: &str) -> Result<String, Fail> {
    let mut manifest: toml::Value = toml::from_str(source)?;
    let workspace: toml::Value = toml::from_str(workspace)?;
    let workspace = workspace
        .get("workspace")
        .ok_or("package check requires a workspace manifest")?;
    let package = manifest
        .get_mut("package")
        .and_then(toml::Value::as_table_mut)
        .ok_or("package manifest lacks its package table")?;
    for (name, value) in package {
        if value.get("workspace").and_then(toml::Value::as_bool) == Some(true) {
            *value = workspace
                .get("package")
                .and_then(|fields| fields.get(name))
                .ok_or_else(|| format!("workspace package field {name} is absent"))?
                .clone();
        }
    }
    fn dependencies(table: &mut toml::Value, workspace: &toml::Value) -> Result<(), Fail> {
        for section in ["dependencies", "dev-dependencies", "build-dependencies"] {
            let Some(entries) = table.get_mut(section).and_then(toml::Value::as_table_mut) else {
                continue;
            };
            for (name, value) in entries {
                if value.get("workspace").and_then(toml::Value::as_bool) == Some(true) {
                    let overrides = value
                        .as_table()
                        .ok_or("invalid inherited dependency")?
                        .clone();
                    *value = workspace
                        .get("dependencies")
                        .and_then(|entries| entries.get(name))
                        .ok_or_else(|| format!("workspace dependency {name} is absent"))?
                        .clone();
                    if let Some(version) = value.as_str() {
                        *value = toml::Value::Table(toml::map::Map::from_iter([(
                            "version".into(),
                            toml::Value::String(version.into()),
                        )]));
                    }
                    let resolved = value.as_table_mut().ok_or("invalid workspace dependency")?;
                    for (key, item) in overrides {
                        if key == "workspace" {
                            continue;
                        }
                        if key == "features" {
                            if let Some(features) =
                                resolved.get_mut(&key).and_then(toml::Value::as_array_mut)
                            {
                                for feature in
                                    item.as_array().ok_or("invalid dependency features")?
                                {
                                    if !features.contains(feature) {
                                        features.push(feature.clone());
                                    }
                                }
                                continue;
                            }
                        }
                        resolved.insert(key, item);
                    }
                }
                if let Some(dependency) = value.as_table_mut() {
                    let external_location =
                        dependency.remove("path").is_some() | dependency.remove("git").is_some();
                    for selector in ["branch", "tag", "rev"] {
                        dependency.remove(selector);
                    }
                    if external_location && !dependency.contains_key("version") {
                        return Err(
                            format!("packaged dependency {name} lacks a registry version").into(),
                        );
                    }
                }
            }
        }
        Ok(())
    }
    dependencies(&mut manifest, workspace)?;
    if let Some(targets) = manifest
        .get_mut("target")
        .and_then(toml::Value::as_table_mut)
    {
        for (_, target) in targets.iter_mut() {
            dependencies(target, workspace)?;
        }
    }
    if manifest
        .get("lints")
        .and_then(|lints| lints.get("workspace"))
        .and_then(toml::Value::as_bool)
        == Some(true)
    {
        manifest["lints"] = workspace
            .get("lints")
            .ok_or("workspace lints are absent")?
            .clone();
    }
    Ok(toml::to_string(&manifest)?)
}

fn check_reproducibility(root: &Path) -> Result<(), Fail> {
    let temp1 = tempfile::tempdir()?;
    let temp2 = tempfile::tempdir()?;

    copy_dir_recursive(&root.join("stdlib"), &temp1.path().join("stdlib"))?;
    copy_dir_recursive(&root.join("language"), &temp1.path().join("language"))?;
    copy_dir_recursive(&root.join("schemas"), &temp1.path().join("schemas"))?;
    for file in [
        "lake-manifest.json",
        "lakefile.toml",
        "lean-toolchain",
        "lexlean.lock",
        "lexlean.toml",
        "prismpm.toml",
    ] {
        std::fs::copy(root.join(file), temp1.path().join(file))?;
    }
    std::fs::create_dir_all(temp1.path().join("vendor/lean4-prod"))?;
    std::fs::copy(
        root.join("vendor/lean4-prod/lean.tar"),
        temp1.path().join("vendor/lean4-prod/lean.tar"),
    )?;

    copy_dir_recursive(&root.join("stdlib"), &temp2.path().join("stdlib"))?;
    copy_dir_recursive(&root.join("language"), &temp2.path().join("language"))?;
    copy_dir_recursive(&root.join("schemas"), &temp2.path().join("schemas"))?;
    for file in [
        "lake-manifest.json",
        "lakefile.toml",
        "lean-toolchain",
        "lexlean.lock",
        "lexlean.toml",
        "prismpm.toml",
    ] {
        std::fs::copy(root.join(file), temp2.path().join(file))?;
    }
    std::fs::create_dir_all(temp2.path().join("vendor/lean4-prod"))?;
    std::fs::copy(
        root.join("vendor/lean4-prod/lean.tar"),
        temp2.path().join("vendor/lean4-prod/lean.tar"),
    )?;

    let c1 = prismpm::Controller::load(temp1.path())?;
    let c2 = prismpm::Controller::load(temp2.path())?;

    let b1 = c1.build(prismpm::controller::BuildRequest { config_path: None })?;
    let b2 = c2.build(prismpm::controller::BuildRequest { config_path: None })?;

    if b1.build_id != b2.build_id {
        return Err(format!(
            "check-reproducibility: build IDs differ across directories: {} vs {}",
            b1.build_id, b2.build_id
        )
        .into());
    }
    let files1 = tree_files(&temp1.path().join(".prism/build").join(&b1.build_id))?;
    let files2 = tree_files(&temp2.path().join(".prism/build").join(&b2.build_id))?;
    if files1 != files2 {
        return Err("check-reproducibility: platform-independent artifact trees differ".into());
    }
    for (_, bytes) in &files1 {
        let text = String::from_utf8_lossy(bytes);
        if text.contains(temp1.path().to_string_lossy().as_ref())
            || text.contains(temp2.path().to_string_lossy().as_ref())
        {
            return Err("check-reproducibility: artifact embeds an absolute checkout path".into());
        }
    }

    let v1 = c1.verify(prismpm::controller::VerifyRequest { config_path: None })?;
    let v2 = c2.verify(prismpm::controller::VerifyRequest { config_path: None })?;
    if v1.attestation_id != v2.attestation_id {
        return Err(format!(
            "check-reproducibility: verification IDs differ across directories: {} vs {}",
            v1.attestation_id, v2.attestation_id
        )
        .into());
    }
    let verified1 = tree_files(
        &temp1
            .path()
            .join(".prism/verified")
            .join(&v1.attestation_id),
    )?;
    let verified2 = tree_files(
        &temp2
            .path()
            .join(".prism/verified")
            .join(&v2.attestation_id),
    )?;
    if verified1 != verified2 {
        return Err("check-reproducibility: platform-independent verification trees differ".into());
    }

    println!(
        "check-reproducibility: {} build and {} verification artifacts are byte-identical across distinct roots: {} / {}",
        files1.len(), verified1.len(), b1.build_id, v1.attestation_id
    );
    Ok(())
}

fn check_fixtures(root: &Path, write: bool) -> Result<(), Fail> {
    let fixtures = repo_conformance::fixtures::discover(root);
    if fixtures.is_empty() {
        return Err(
            "check-fixtures: no fixture directories discovered; the fixture gate is unarmed".into(),
        );
    }
    for fixture in &fixtures {
        if write {
            repo_conformance::fixtures::write(fixture)?;
        } else {
            repo_conformance::fixtures::check(fixture)?;
        }
    }
    println!("check-fixtures: {} fixtures checked", fixtures.len());
    Ok(())
}

fn release_artifacts(root: &Path) -> Result<(), Fail> {
    release_check(root)?;
    let first = tempfile::tempdir()?;
    let second = tempfile::tempdir()?;
    assemble_release(root, first.path())?;
    assemble_release(root, second.path())?;
    let expected = tree_files(first.path())?;
    if expected != tree_files(second.path())? {
        return Err("release artifacts do not reproduce byte-for-byte".into());
    }

    let release_dir = root.join("release");
    if release_dir.exists() {
        std::fs::remove_dir_all(&release_dir)?;
    }
    std::fs::create_dir(&release_dir)?;
    for (relative, bytes) in &expected {
        let destination = release_dir.join(relative);
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)?;
        }
        std::fs::write(destination, bytes)?;
    }
    println!(
        "release-artifacts: {} reproducible files staged under release/",
        expected.len()
    );
    Ok(())
}

fn assemble_release(root: &Path, destination: &Path) -> Result<(), Fail> {
    let head = String::from_utf8(
        Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(root)
            .output()?
            .stdout,
    )?
    .trim()
    .to_owned();
    let archive = Command::new("git")
        .args(["archive", "--format=tar", "--prefix=PrismPM-0.4.0/", "HEAD"])
        .current_dir(root)
        .output()?;
    if !archive.status.success() {
        return Err(format!(
            "git archive failed: {}",
            String::from_utf8_lossy(&archive.stderr)
        )
        .into());
    }
    let source_name = "PrismPM-0.4.0-source.tar";
    std::fs::write(destination.join(source_name), archive.stdout)?;

    let metadata = Command::new("cargo")
        .args(["metadata", "--locked", "--offline", "--format-version", "1"])
        .current_dir(root)
        .output()?;
    if !metadata.status.success() {
        return Err(format!(
            "cargo metadata for SBOM failed: {}",
            String::from_utf8_lossy(&metadata.stderr)
        )
        .into());
    }
    let metadata: serde_json::Value = serde_json::from_slice(&metadata.stdout)?;
    let mut components = metadata
        .get("packages")
        .and_then(serde_json::Value::as_array)
        .ok_or("cargo metadata package array is absent")?
        .iter()
        .map(|package| {
            serde_json::json!({
                "license": package.get("license").cloned().unwrap_or(serde_json::Value::Null),
                "name": package.get("name").cloned().unwrap_or(serde_json::Value::Null),
                "source": package.get("source").cloned().unwrap_or(serde_json::Value::Null),
                "version": package.get("version").cloned().unwrap_or(serde_json::Value::Null)
            })
        })
        .collect::<Vec<_>>();
    components.sort_by(|left, right| {
        left.get("name")
            .and_then(serde_json::Value::as_str)
            .unwrap_or("")
            .cmp(
                right
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
            )
            .then_with(|| {
                left.get("version")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .cmp(
                        right
                            .get("version")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or(""),
                    )
            })
            .then_with(|| {
                left.get("source")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .cmp(
                        right
                            .get("source")
                            .and_then(serde_json::Value::as_str)
                            .unwrap_or(""),
                    )
            })
    });
    let sbom = serde_json::json!({
        "components": components,
        "source_commit": head,
        "spec": "prismpm/sbom/1",
        "version": "0.4.0"
    });
    let mut sbom_bytes = prismpm::holo::canonical::encode_value(&sbom)?;
    sbom_bytes.push(b'\n');
    let sbom_name = "PrismPM-0.4.0-sbom.json";
    std::fs::write(destination.join(sbom_name), &sbom_bytes)?;

    let artifact_rows = [
        (
            source_name,
            format!(
                "{:x}",
                sha2::Sha256::digest(std::fs::read(destination.join(source_name))?)
            ),
        ),
        (
            sbom_name,
            format!("{:x}", sha2::Sha256::digest(&sbom_bytes)),
        ),
    ];
    let manifest = serde_json::json!({
        "artifacts": artifact_rows.iter().map(|(path, sha256)| serde_json::json!({"path": path, "sha256": sha256})).collect::<Vec<_>>(),
        "commit": head,
        "schema": "prismpm/release-manifest/1",
        "version": "0.4.0"
    });
    let mut manifest_bytes = prismpm::holo::canonical::encode_value(&manifest)?;
    manifest_bytes.push(b'\n');
    let manifest_name = "RELEASE.json";
    std::fs::write(destination.join(manifest_name), &manifest_bytes)?;

    let mut checksums = artifact_rows
        .iter()
        .map(|(path, sha256)| format!("{sha256}  {path}\n"))
        .collect::<String>();
    checksums.push_str(&format!(
        "{:x}  {manifest_name}\n",
        sha2::Sha256::digest(&manifest_bytes)
    ));
    std::fs::write(destination.join("SHA256SUMS"), checksums)?;
    Ok(())
}

fn release_check(root: &Path) -> Result<(), Fail> {
    let (_, hidden_tests) = repo_conformance::workspace_test_names_with_flags(root);
    let hidden_vec: Vec<String> = hidden_tests.into_iter().collect();
    let unmet = repo_model::release::check(root, &hidden_vec);
    if let Err(issues) = unmet {
        return Err(format!(
            "release-check refused: unmet criteria:\n  {}",
            issues.join("\n  ")
        )
        .into());
    }
    println!("release-check: all release criteria hold");
    Ok(())
}

fn copy_dir_recursive(from: &Path, to: &Path) -> Result<(), std::io::Error> {
    source_copy::copy_tree(from, to)
}

#[cfg(test)]
mod verify_examples_tests {
    use super::{check_command_line, CommandLine, Example, COMMAND_LINE_TARGETS, EXAMPLES};
    use sha2::Digest;

    fn text_check() -> &'static Example {
        EXAMPLES
            .iter()
            .find(|example| example.command_line.is_some())
            .expect("verify-examples builds a text/3 command line")
    }

    #[test]
    fn inventory_builds_a_text3_command_line_on_both_sides_of_its_request_maximum() {
        let example = text_check();
        let expected = example.command_line.as_ref().unwrap();
        assert!(expected.within_request_maximum > 0 && expected.oversized_vectors > 0);
        assert_eq!(
            expected.within_request_maximum + expected.oversized_vectors,
            expected.vectors
        );
        let source = std::fs::read_to_string(
            repo_model::repo_root()
                .join(example.project)
                .join("src/TextRequest.lex.tex"),
        )
        .expect("the text/3 example source exists");
        assert!(source.contains("profile := \"prismpm/text-application/3\""));
        assert!(source.contains("cli := (record Foundation.View.Text.V3.Model::TextCli"));
        assert!(source.contains(&format!("cargoName := \"{}\"", expected.program)));
    }

    #[test]
    fn every_example_expectation_matches_its_model_source() {
        // An example declares a command line exactly when its model does, and
        // the expected partition is the one its vectors and maximum produce.
        for example in &EXAMPLES {
            let project = repo_model::repo_root().join(example.project);
            let mut sources = String::new();
            for entry in walkdir::WalkDir::new(project.join("src")) {
                let entry = entry.unwrap();
                if entry.file_type().is_file()
                    && !entry.path().starts_with(project.join("src/Foundation"))
                {
                    sources.push_str(&std::fs::read_to_string(entry.path()).unwrap());
                }
            }
            let models_cli = sources.contains("cli := (record");
            assert_eq!(
                models_cli,
                example.command_line.is_some(),
                "{}: the command-line expectation must match the model",
                example.name
            );
            let Some(expected) = &example.command_line else {
                continue;
            };
            let maximum: usize = sources
                .split("requestMaximum := (")
                .nth(1)
                .and_then(|rest| rest.split(' ').next())
                .and_then(|value| value.parse().ok())
                .expect("the text/3 example models its request maximum");
            let requests = sources
                .split("AcceptanceVector {request := 0x")
                .skip(1)
                .map(|rest| rest.split(',').next().unwrap().len() / 2)
                .collect::<Vec<_>>();
            let within = requests.iter().filter(|length| **length <= maximum).count() as u64;
            assert_eq!(requests.len() as u64, expected.vectors, "{}", example.name);
            assert_eq!(within, expected.within_request_maximum, "{}", example.name);
            assert_eq!(
                requests.len() as u64 - within,
                expected.oversized_vectors,
                "{}",
                example.name
            );
            assert_eq!(
                sources.matches("TextCliExample {name := ").count() as u64,
                expected.examples,
                "{}",
                example.name
            );
        }
    }

    fn built(expected: &CommandLine) -> (tempfile::TempDir, serde_json::Value) {
        let build = tempfile::tempdir().unwrap();
        let mut programs = Vec::new();
        for target in COMMAND_LINE_TARGETS {
            let path = format!("cli/bin/{target}/{}", expected.program);
            let file = build.path().join(&path);
            std::fs::create_dir_all(file.parent().unwrap()).unwrap();
            std::fs::write(&file, target.as_bytes()).unwrap();
            programs.push(serde_json::json!({
                "path": path,
                "sha256": format!("{:x}", sha2::Sha256::digest(target.as_bytes())),
                "target": target,
            }));
        }
        std::fs::write(build.path().join("cli/sbom.spdx.json"), b"{}").unwrap();
        let acceptance = serde_json::json!({
            "command_line": {
                "examples": expected.examples,
                "executed_target": "x86_64-unknown-linux-musl",
                "oversized_vectors": expected.oversized_vectors,
                "programs": programs,
                "schema": "prismpm/text-cli-acceptance/1",
                "status": "verified",
                "transports": ["stdin", "file", "stdin-dash"],
                "vectors": expected.vectors,
                "within_request_maximum": expected.within_request_maximum,
            }
        });
        (build, acceptance)
    }

    #[test]
    fn command_line_evidence_must_match_the_expectation() {
        let example = text_check();
        let expected = example.command_line.as_ref().unwrap();
        let (build, acceptance) = built(expected);
        check_command_line(example, build.path(), &acceptance).unwrap();

        // Removing the expectation rejects the command line the build publishes.
        let unexpected = Example {
            name: example.name,
            project: example.project,
            command_line: None,
            same_outputs_as: None,
        };
        assert!(check_command_line(&unexpected, build.path(), &acceptance).is_err());
        assert!(check_command_line(&unexpected, build.path(), &serde_json::json!({})).is_err());

        // An expected command line must be accepted, with the exact partition.
        assert!(check_command_line(example, build.path(), &serde_json::json!({})).is_err());
        for (field, value) in [
            (
                "within_request_maximum",
                serde_json::json!(expected.vectors),
            ),
            ("oversized_vectors", serde_json::json!(0)),
            ("examples", serde_json::json!(0)),
            ("status", serde_json::json!("skipped")),
        ] {
            let mut changed = acceptance.clone();
            changed["command_line"][field] = value;
            assert!(
                check_command_line(example, build.path(), &changed).is_err(),
                "{field}"
            );
        }

        // An expectation that never crosses the request maximum is refused.
        let one_sided = Example {
            name: example.name,
            project: example.project,
            command_line: Some(CommandLine {
                program: expected.program,
                vectors: expected.vectors,
                within_request_maximum: expected.vectors,
                oversized_vectors: 0,
                examples: expected.examples,
            }),
            same_outputs_as: None,
        };
        assert!(check_command_line(&one_sided, build.path(), &acceptance).is_err());

        // The accepted programs must be the built bytes, and the SBOM present.
        let program = build.path().join(format!(
            "cli/bin/{}/{}",
            COMMAND_LINE_TARGETS[1], expected.program
        ));
        std::fs::write(&program, b"substituted").unwrap();
        assert!(check_command_line(example, build.path(), &acceptance).is_err());
        std::fs::write(&program, COMMAND_LINE_TARGETS[1].as_bytes()).unwrap();
        check_command_line(example, build.path(), &acceptance).unwrap();
        std::fs::remove_file(build.path().join("cli/sbom.spdx.json")).unwrap();
        assert!(check_command_line(example, build.path(), &acceptance).is_err());
    }

    #[test]
    fn examples_without_a_command_line_must_not_build_one() {
        let example = &EXAMPLES[0];
        assert!(example.command_line.is_none());
        let build = tempfile::tempdir().unwrap();
        check_command_line(example, build.path(), &serde_json::json!({})).unwrap();
        std::fs::create_dir(build.path().join("cli")).unwrap();
        assert!(check_command_line(example, build.path(), &serde_json::json!({})).is_err());
    }
}

#[cfg(test)]
mod golden_tests {
    #[test]
    fn cached_gate_failure_keeps_structured_diagnostics_after_boxing() {
        let error = prismpm::PrismError::new("PP5001", "LexLean verification failed")
            .with_note("original child diagnostic must survive the gate boundary");
        let cache = std::sync::OnceLock::<Result<(), prismpm::PrismError>>::new();
        for attempt in 0..2 {
            let failure = cache
                .get_or_init(|| {
                    assert_eq!(attempt, 0, "cached failure is not recomputed");
                    Err(error.clone())
                })
                .as_ref()
                .map_err(super::diagnostic_failure)
                .unwrap_err();
            assert_eq!(
                serde_json::from_str::<prismpm::PrismError>(&failure.to_string()).unwrap(),
                error
            );
        }
    }

    #[test]
    fn native_payload_exclusions_preserve_exact_evidence_and_executable_descriptor() {
        let executable = b"native payload";
        let manifest = prismpm::holo::canonical::encode_value(&serde_json::json!({
            "artifacts": {"executable": {
                "byte_length": executable.len(),
                "sha256": prismpm::holo::canonical::content_id(executable)
            }}
        }))
        .unwrap();
        let mut evidence = [
            "coverage.json",
            "execution-corpus.toml",
            "execution.json",
            "lexlean-attestation.json",
            "roots.json",
            "stdlib-exports.toml",
            "nested/validator",
        ]
        .into_iter()
        .map(|path| (path.to_owned(), path.as_bytes().to_vec()))
        .collect::<Vec<_>>();
        evidence.push(("manifest.json".to_owned(), manifest));
        let mut files = evidence.clone();
        for path in ["generated.rs", "kernel.ir", "validator"] {
            files.push((path.to_owned(), executable.to_vec()));
        }
        assert_eq!(super::golden_verification_files(files), evidence);
    }
}

#[cfg(test)]
mod command_tests {
    #[test]
    fn sdk_runtime_reference_rejects_malformed_digest_before_execution() {
        let digest = "a".repeat(64);
        for reference in [
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}"),
            format!("127.0.0.1:5000/sdk@sha256:{digest}"),
        ] {
            super::validate_sdk_runtime_reference(&reference).unwrap();
        }
        for reference in [
            String::new(),
            "ghcr.io/uor-foundation/prismpm-sdk:latest".to_owned(),
            "ghcr.io/uor-foundation/prismpm-sdk@sha256:".to_owned(),
            format!(
                "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                "a".repeat(63)
            ),
            format!(
                "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                "a".repeat(65)
            ),
            format!(
                "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                "A".repeat(64)
            ),
            format!(
                "ghcr.io/uor-foundation/prismpm-sdk@sha256:{}",
                "g".repeat(64)
            ),
            format!("ghcr.io/uor-foundation/prismpm-sdk:tag@sha256:{digest}"),
            format!("https://ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}"),
            format!("ghcr.io/../prismpm-sdk@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}\n"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}?secret=x"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}#fragment"),
            format!("@sha256:{digest}"),
        ] {
            assert!(
                super::validate_sdk_runtime_reference(&reference).is_err(),
                "malformed SDK runtime reference must fail before Docker execution"
            );
            let error = super::check_sdk_runtime_boundary_for_image(&reference)
                .expect_err("the actual runtime boundary must reject the same malformed input");
            assert_eq!(
                error.to_string(),
                "SDK runtime boundary requires a valid immutable OCI SDK reference",
                "the actual entry path must refuse before invoking Docker"
            );
        }
    }

    #[test]
    fn node_gate_does_not_inherit_cargo_loader_state() {
        super::command(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")),
            "node",
            &["--input-type=module", "-e", "import assert from 'node:assert/strict'; import {run} from '../tests/browser-view/compile.mjs'; assert.equal(process.env.LD_LIBRARY_PATH, undefined); assert.equal(process.env.CARGO_NET_OFFLINE, 'true'); process.env.RUSTFLAGS='-C opt-level=0'; assert.throws(()=>run('cargo',['--version'],process.cwd()),/inherited compiler override refused: RUSTFLAGS/);"],
        )
        .unwrap();
    }
}

#[cfg(test)]
mod package_tests {
    #[test]
    fn cargo_source_archive_contains_complete_executable_blake3_corpus() {
        let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .unwrap();
        let stage = tempfile::tempdir().unwrap();
        // Source-archive qualification only. Dependency resolution and package
        // builds remain owned by package-api and full release verification.
        let selected = std::process::Command::new("cargo")
            .args([
                "package",
                "--package",
                "prismpm",
                "--allow-dirty",
                "--offline",
                "--no-verify",
                "--exclude-lockfile",
                "--target-dir",
            ])
            .arg(stage.path())
            .current_dir(root)
            .env("CARGO_NET_OFFLINE", "true")
            .output()
            .unwrap();
        assert!(
            selected.status.success(),
            "{}",
            String::from_utf8_lossy(&selected.stderr)
        );
        let extracted = tempfile::tempdir().unwrap();
        let package = format!("prismpm-{}", env!("CARGO_PKG_VERSION"));
        let unpacked = std::process::Command::new("tar")
            .args(["--extract", "--gzip", "--file"])
            .arg(
                stage
                    .path()
                    .join("package")
                    .join(format!("{package}.crate")),
            )
            .arg("--directory")
            .arg(extracted.path())
            .arg("--")
            .arg(format!("{package}/standards/corpora/blake3-1.5.5"))
            .arg(format!("{package}/sdk/sdk-index-extensions.json"))
            .output()
            .unwrap();
        assert!(
            unpacked.status.success(),
            "{}",
            String::from_utf8_lossy(&unpacked.stderr)
        );
        let packaged = extracted.path().join(package);
        assert_eq!(
            std::fs::read(packaged.join("sdk/sdk-index-extensions.json")).unwrap(),
            std::fs::read(root.join("sdk/sdk-index-extensions.json")).unwrap(),
            "actual Cargo archive must retain the exact runtime admission corpus"
        );
        super::verify_packaged_blake3_corpus(&packaged).unwrap();
        std::fs::remove_file(packaged.join("standards/corpora/blake3-1.5.5/LICENSE_CC0")).unwrap();
        assert!(super::verify_packaged_blake3_corpus(&packaged).is_err());
    }

    #[test]
    fn package_manifest_follows_workspace_dependencies_and_rejects_unpublishable_paths() {
        let source = r#"
[package]
name = "consumer"
version.workspace = true
[dependencies]
new_runtime_dependency.workspace = true
compiler = { workspace = true, features = ["extra"] }
archive = { version = "=1.2.3", git = "https://example.invalid/archive", rev = "012345" }
[target.'cfg(unix)'.dependencies]
compiler.workspace = true
[lints]
workspace = true
"#;
        let workspace = r#"
[workspace.package]
version = "1.2.3"
[workspace.dependencies]
new_runtime_dependency = "=4.5.6"
compiler = { path = "vendor/compiler", version = "0.3.0", features = ["base"] }
[workspace.lints.rust]
unsafe_code = "deny"
"#;
        let resolved = super::standalone_package_manifest(source, workspace).unwrap();
        let manifest: toml::Value = toml::from_str(&resolved).unwrap();
        assert_eq!(manifest["package"]["version"].as_str(), Some("1.2.3"));
        assert_eq!(
            manifest["dependencies"]["new_runtime_dependency"]["version"].as_str(),
            Some("=4.5.6")
        );
        assert_eq!(
            manifest["dependencies"]["compiler"]["features"]
                .as_array()
                .unwrap()
                .len(),
            2
        );
        assert!(manifest["dependencies"]["compiler"].get("path").is_none());
        assert!(manifest["dependencies"]["archive"].get("git").is_none());
        assert!(manifest["dependencies"]["archive"].get("rev").is_none());
        assert_eq!(
            manifest["dependencies"]["archive"]["version"].as_str(),
            Some("=1.2.3")
        );
        assert!(manifest["target"]["cfg(unix)"]["dependencies"]["compiler"]
            .get("path")
            .is_none());
        assert_eq!(
            manifest["lints"]["rust"]["unsafe_code"].as_str(),
            Some("deny")
        );
        assert!(super::standalone_package_manifest(
            source,
            &workspace.replace("version = \"0.3.0\", ", "")
        )
        .is_err());
    }
}
