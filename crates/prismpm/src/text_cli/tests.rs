//! Generation, structure and execution tests of the text command line.
//!
//! The execution tests compile the generated program against a small core
//! library that stands in for the generated application crate, then drive the
//! real binary for every modeled outcome and every registered failure.

use super::{binary_path, generate, help, surface, validate_static_elf, TARGETS};
use crate::holo::model_document::TextApplicationModel;
use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;

const CORE: &str = "pub fn dispatch(request: Vec<u8>) -> Vec<u8> {\n    match request.first() {\n        Some(b'a') => b\"accepted\\n\".to_vec(),\n        Some(b'r') => b\"rejected\\n\".to_vec(),\n        Some(b'z') => b\"zz\\n\".to_vec(),\n        _ => b\"error: bad request\\n\".to_vec(),\n    }\n}\n";

fn model() -> TextApplicationModel {
    serde_json::from_value(json!({
        "profile": "prismpm/text-application/3",
        "name": "Echo Check",
        "cargo_name": "echo-check",
        "cargo_version": "0.1.0",
        "cargo_description": "Echo check",
        "cargo_repository": "https://example.invalid/echo",
        "cargo_homepage": "https://example.invalid/echo",
        "library_roots": ["Echo.Core.dispatch"],
        "acceptance_vectors": [
            {"request": [97], "response": b"accepted\n".to_vec()},
            {"request": [114], "response": b"rejected\n".to_vec()},
            {"request": [120], "response": b"error: bad request\n".to_vec()}
        ],
        "entry_root": "Echo.Core.dispatch",
        "core_contract": "prismpm/hologram-guest/1",
        "request_maximum": 16,
        "response_maximum": 64,
        "guest_allocation_maximum": 1024,
        "core_memory_pages": 64,
        "core_stack_bytes": 131072,
        "capabilities_empty": true,
        "fat_archive": false,
        "primary_layer": 0,
        "view_layer": 1,
        "view": {
            "title": "t", "heading": "h", "input_label": "i", "submit_label": "s",
            "output_label": "o", "input_error": "e", "response_error": "r"
        },
        "cli": {
            "command": "check",
            "description": "Checks one request.\n",
            "usage_code": 64,
            "io_code": 74,
            "outcomes": [
                {"name": "accepted", "prefix": "accepted", "exit_code": 0},
                {"name": "rejected", "prefix": "rejected", "exit_code": 1},
                {"name": "error", "prefix": "error:", "exit_code": 2}
            ],
            "sections": [{"title": "REFERENCE", "body": "See the specification.\n"}],
            "examples": [{"name": "good", "text": "a\n"}]
        }
    }))
    .expect("fixture deserializes")
}

fn file<'a>(package: &'a prod_codegen::GeneratedPackage, path: &str) -> &'a str {
    let file = package
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("generated package lacks {path}"));
    std::str::from_utf8(&file.bytes).unwrap()
}

struct Built {
    _directory: tempfile::TempDir,
    program: PathBuf,
    package: PathBuf,
    target: PathBuf,
}

fn cargo(arguments: &[&str], directory: &Path, target: &Path) -> Output {
    Command::new("cargo")
        .args(arguments)
        .current_dir(directory)
        .env("CARGO_TARGET_DIR", target)
        .output()
        .expect("cargo runs")
}

/// The fixture with prism-code's map: `InputLimit` has its own code, 3.
fn limited() -> TextApplicationModel {
    let mut value = serde_json::to_value(model()).unwrap();
    value["cli"]["limit_code"] = json!(3);
    serde_json::from_value(value).expect("a text/3 model with a limit code deserializes")
}

fn built() -> &'static Built {
    static BUILT: OnceLock<Built> = OnceLock::new();
    BUILT.get_or_init(|| build(&model()))
}

fn built_limited() -> &'static Built {
    static BUILT: OnceLock<Built> = OnceLock::new();
    BUILT.get_or_init(|| build(&limited()))
}

fn build(application: &TextApplicationModel) -> Built {
    {
        let directory = tempfile::tempdir().unwrap();
        let core = directory.path().join("core");
        std::fs::create_dir_all(core.join("src")).unwrap();
        std::fs::write(
            core.join("Cargo.toml"),
            "[package]\nname = \"echo-check\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[features]\ndefault = [\"std\"]\nstd = []\n",
        )
        .unwrap();
        std::fs::write(core.join("src/lib.rs"), CORE).unwrap();
        let package = directory.path().join("cli");
        std::fs::create_dir_all(package.join("src")).unwrap();
        let generated = generate(application).unwrap();
        for item in &generated.files {
            let bytes = if item.path == "Cargo.toml" {
                let manifest = String::from_utf8(item.bytes.clone()).unwrap();
                let (head, _) = manifest.split_once("[dependencies]").unwrap();
                let (_, tail) = manifest.split_once("[profile.release]").unwrap();
                format!(
                    "{head}[dependencies]\necho-check = {{ path = \"../core\" }}\n\n[profile.release]{tail}"
                )
                .into_bytes()
            } else {
                item.bytes.clone()
            };
            std::fs::write(package.join(&item.path), bytes).unwrap();
        }
        let target = directory.path().join("target");
        let output = cargo(&["build", "--offline"], &package, &target);
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        Built {
            program: target.join("debug/echo-check"),
            package,
            target,
            _directory: directory,
        }
    }
}

fn run(arguments: &[&str], stdin: &[u8]) -> Output {
    run_program(&built().program, arguments, stdin)
}

fn run_program(program: &Path, arguments: &[&str], stdin: &[u8]) -> Output {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let mut pipe = child.stdin.take().unwrap();
    // The program may refuse before reading; a closed pipe is then expected.
    let _ = pipe.write_all(stdin);
    drop(pipe);
    child.wait_with_output().unwrap()
}

fn text(bytes: &[u8]) -> String {
    String::from_utf8(bytes.to_vec()).unwrap()
}

#[test]
fn surface_is_rendered_only_from_the_model() {
    let application = model();
    let package = generate(&application).unwrap();
    let surface = file(&package, "src/surface.rs");
    for expected in [
        "pub const BINARY: &str = \"echo-check\";",
        "pub const REQUEST_MAXIMUM: usize = 16;",
        "pub const RESPONSE_MAXIMUM: usize = 64;",
        "pub const USAGE_CODE: u8 = 64;",
        "pub const IO_CODE: u8 = 74;",
        "pub const FAULT_CODE: u8 = 2;",
        "(\"accepted\", 0),",
    ] {
        assert!(surface.contains(expected), "{expected}");
    }
    let main = file(&package, "src/main.rs");
    assert!(main.contains("echo_check::dispatch(request)"));
    assert!(!main.contains('@'), "an unresolved template placeholder");
    let manifest = file(&package, "Cargo.toml");
    assert!(manifest.contains("[[bin]]\nname = \"echo-check\""));
    assert!(manifest.contains("panic = \"abort\""));
    assert_eq!(
        binary_path(TARGETS[1], &application),
        "cli/bin/aarch64-unknown-linux-musl/echo-check"
    );
    assert_eq!(
        surface,
        super::surface(&application, application.cli.as_ref().unwrap()).unwrap()
    );
}

#[test]
fn help_states_purpose_usage_limits_examples_and_every_exit_code() {
    let application = model();
    let cli = application.cli.as_ref().unwrap();
    let text = help(&application, cli);
    for expected in [
        "Echo Check 0.1.0\n\nChecks one request.\n",
        "echo-check check [FILE]",
        "echo-check examples [NAME]",
        "at most 16 of them",
        "\nREFERENCE\nSee the specification.\n",
        "\nEXAMPLES\n    good\n",
        "  0  accepted",
        "  1  rejected",
        "  2  error",
        " 64  usage",
        " 74  io",
    ] {
        assert!(text.contains(expected), "{expected:?} in {text}");
    }
    assert_eq!(text, help(&application, &surface_cli(&application)));
    assert!(surface(&application, cli).unwrap().contains("EXIT CODES"));
}

fn surface_cli(application: &TextApplicationModel) -> crate::holo::text_cli::TextCli {
    application.cli.clone().unwrap()
}

#[test]
fn elf_validation_accepts_only_static_programs_of_the_target() {
    let program = std::fs::read(std::env::current_exe().unwrap()).unwrap();
    // The test harness is a dynamic host executable, never a static musl program.
    assert!(validate_static_elf(&program, TARGETS[0]).is_err());
    assert!(validate_static_elf(b"not an elf", TARGETS[0]).is_err());
    assert!(validate_static_elf(&[], TARGETS[1]).is_err());
    assert!(validate_static_elf(&program, "x86_64-unknown-linux-gnu").is_err());
}

#[test]
fn generated_program_passes_its_own_unit_tests() {
    let built = built();
    let output = cargo(&["test", "--offline"], &built.package, &built.target);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
}

#[test]
fn reports_are_published_unchanged_with_the_modeled_exit_code() {
    let dash = run(&["check", "-"], b"a");
    assert_eq!(dash.status.code(), Some(0), "{}", text(&dash.stderr));
    assert_eq!(dash.stdout, b"accepted\n");
    assert!(dash.stderr.is_empty());
    let stdin = run(&["check"], b"r");
    assert_eq!(stdin.status.code(), Some(1));
    assert_eq!(stdin.stdout, b"rejected\n");
    let error = run(&["check"], b"x");
    assert_eq!(error.status.code(), Some(2));
    assert_eq!(error.stdout, b"error: bad request\n");
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("request");
    std::fs::write(&path, b"a").unwrap();
    let file = run(&["check", path.to_str().unwrap()], b"");
    assert_eq!(file.status.code(), Some(0));
    assert_eq!(file.stdout, b"accepted\n");
    let at_limit = run(&["check"], &[b'a'; 16]);
    assert_eq!(at_limit.status.code(), Some(0));
    assert_eq!(at_limit.stdout, b"accepted\n");
}

#[test]
fn unclassified_report_is_a_typed_fault_without_output() {
    let output = run(&["check"], b"z");
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(text(&output.stderr), "echo-check: ReportUnclassified\n");
}

#[test]
fn help_version_and_examples_come_from_the_model() {
    let application = model();
    let cli = application.cli.as_ref().unwrap();
    let help_output = run(&["--help"], b"");
    assert_eq!(help_output.status.code(), Some(0));
    assert_eq!(text(&help_output.stdout), help(&application, cli));
    let version = run(&["--version"], b"");
    assert_eq!(text(&version.stdout), "echo-check 0.1.0\n");
    let listing = run(&["examples"], b"");
    assert_eq!(text(&listing.stdout), "good\n");
    let one = run(&["examples", "good"], b"");
    assert_eq!(one.stdout, b"a\n");
    assert_eq!(one.status.code(), Some(0));
}

#[test]
fn oversized_input_is_refused_before_dispatch() {
    let output = run(&["check"], &[b'a'; 17]);
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert_eq!(text(&output.stderr), "echo-check: InputLimit\n");
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("big");
    std::fs::write(&path, vec![b'a'; 4096]).unwrap();
    let path = path.to_str().unwrap();
    let file = run(&["check", path], b"");
    assert_eq!(file.status.code(), Some(2));
    assert!(file.stdout.is_empty());
    assert_eq!(
        text(&file.stderr),
        format!("echo-check: InputLimit: {path}\n")
    );
}

#[test]
fn unreadable_missing_and_non_regular_input_exit_with_the_io_code() {
    let directory = tempfile::tempdir().unwrap();
    let missing = directory.path().join("missing");
    let missing = missing.to_str().unwrap();
    let output = run(&["check", missing], b"");
    assert_eq!(output.status.code(), Some(74));
    assert!(output.stdout.is_empty());
    assert_eq!(
        text(&output.stderr),
        format!("echo-check: InputMissing: {missing}\n")
    );
    let folder = directory.path().to_str().unwrap();
    let output = run(&["check", folder], b"");
    assert_eq!(output.status.code(), Some(74));
    assert_eq!(
        text(&output.stderr),
        format!("echo-check: InputType: {folder}\n")
    );
    let target = directory.path().join("target");
    std::fs::write(&target, b"a").unwrap();
    let link = directory.path().join("link");
    std::os::unix::fs::symlink(&target, &link).unwrap();
    let link = link.to_str().unwrap();
    let output = run(&["check", link], b"");
    assert_eq!(output.status.code(), Some(74));
    assert!(output.stdout.is_empty());
    assert!(
        text(&output.stderr).starts_with("echo-check: Input"),
        "{}",
        text(&output.stderr)
    );
}

#[test]
fn permission_denied_is_input_open() {
    use std::os::unix::fs::PermissionsExt;
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("locked");
    std::fs::write(&path, b"a").unwrap();
    std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o000)).unwrap();
    if std::fs::File::open(&path).is_ok() {
        // A superuser reads any file, so the permission cannot be denied here.
        return;
    }
    let path = path.to_str().unwrap();
    let output = run(&["check", path], b"");
    assert_eq!(output.status.code(), Some(74));
    assert_eq!(
        text(&output.stderr),
        format!("echo-check: InputOpen: {path}\n")
    );
}

#[test]
fn invalid_command_lines_exit_with_the_usage_code() {
    for (arguments, failure) in [
        (vec!["--bogus"], "UnknownFlag: --bogus"),
        (vec!["check", "-x"], "UnknownFlag: -x"),
        (vec!["check", "a", "b"], "ExtraArgument: b"),
        (vec![], "MissingCommand"),
        (vec!["bogus"], "UnknownCommand: bogus"),
        (vec!["examples", "nope"], "UnknownExample: nope"),
    ] {
        let output = run(&arguments, b"a");
        assert_eq!(output.status.code(), Some(64), "{arguments:?}");
        assert!(output.stdout.is_empty(), "{arguments:?}");
        assert_eq!(
            text(&output.stderr),
            format!("echo-check: {failure}\nTry 'echo-check --help'.\n"),
            "{arguments:?}"
        );
    }
}

#[test]
fn closed_or_full_standard_output_exits_with_the_io_code() {
    let (reader, writer) = std::io::pipe().unwrap();
    drop(reader);
    let output = Command::new(&built().program)
        .arg("check")
        .stdin(Stdio::piped())
        .stdout(writer)
        .stderr(Stdio::piped())
        .spawn()
        .and_then(|mut child| {
            child.stdin.take().unwrap().write_all(b"a")?;
            child.wait_with_output()
        })
        .unwrap();
    assert_eq!(output.status.code(), Some(74), "{}", text(&output.stderr));
    assert_eq!(text(&output.stderr), "echo-check: OutputWrite\n");
    let full = std::fs::OpenOptions::new()
        .write(true)
        .open("/dev/full")
        .unwrap();
    let output = Command::new(&built().program)
        .arg("--help")
        .stdout(full)
        .stderr(Stdio::piped())
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(74));
    assert_eq!(text(&output.stderr), "echo-check: OutputWrite\n");
}

#[test]
fn bill_of_materials_binds_every_program_to_its_digest() {
    use sha2::{Digest, Sha256};
    let application = model();
    let lock = "version = 4\n\n[[package]]\nname = \"echo-check\"\nversion = \"0.1.0\"\n\n[[package]]\nname = \"echo-check-cli\"\nversion = \"0.1.0\"\ndependencies = [\"echo-check\"]\n\n[[package]]\nname = \"other\"\nversion = \"1.2.3\"\nsource = \"registry+https://github.com/rust-lang/crates.io-index\"\nchecksum = \"abcd\"\n";
    let built = super::BuiltCli {
        package: generate(&application).unwrap(),
        lock: lock.as_bytes().to_vec(),
        binaries: vec![(TARGETS[0], vec![1, 2, 3]), (TARGETS[1], vec![4, 5])],
    };
    let bytes = super::sbom::sbom(&application, &built).unwrap();
    assert_eq!(bytes, super::sbom::sbom(&application, &built).unwrap());
    let document: serde_json::Value = serde_json::from_slice(&bytes).unwrap();
    let graph = document["@graph"].as_array().unwrap();
    for (target, program) in [(TARGETS[0], vec![1u8, 2, 3]), (TARGETS[1], vec![4u8, 5])] {
        let id = format!("urn:spdx:file:{}", binary_path(target, &application));
        let node = graph.iter().find(|node| node["spdxId"] == id).unwrap();
        assert_eq!(node["type"], "software_File");
        assert_eq!(
            node["verifiedUsing"][0]["hashValue"],
            format!("{:x}", Sha256::digest(&program))
        );
    }
    let dependency = graph
        .iter()
        .find(|node| node["spdxId"] == "urn:spdx:package:other:1.2.3")
        .unwrap();
    assert_eq!(dependency["verifiedUsing"][0]["hashValue"], "abcd");
    let root = graph
        .iter()
        .find(|node| node["type"] == "SpdxDocument")
        .unwrap();
    assert_eq!(root["rootElement"][0], "urn:spdx:echo-check-cli");
    assert!(graph
        .iter()
        .all(|node| node["spdxId"] != "urn:spdx:package:echo-check-cli:0.1.0"));
}

/// Cargo environment that resolves the generated core crate from a directory
/// source and remaps every owned path, as the application build does.
fn offline_environment(
    workspace: &Path,
    vendor: &Path,
) -> std::collections::BTreeMap<String, String> {
    let home = workspace.join("cargo-home");
    std::fs::create_dir_all(&home).unwrap();
    std::fs::write(
        home.join("config.toml"),
        format!(
            "[source.crates-io]\nreplace-with = \"vendored\"\n\n[source.vendored]\ndirectory = {:?}\n",
            vendor.to_string_lossy()
        ),
    )
    .unwrap();
    std::collections::BTreeMap::from([
        ("CARGO_HOME".to_owned(), home.to_string_lossy().into_owned()),
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
        (
            "RUSTFLAGS".to_owned(),
            format!(
                "--remap-path-prefix={}=$APPLICATION_WORK --remap-path-prefix={}=$CARGO_REGISTRY_SRC",
                workspace.display(),
                vendor.display()
            ),
        ),
    ])
}

fn build_in_fresh_workspace(
    application: &TextApplicationModel,
) -> (tempfile::TempDir, super::BuiltCli) {
    let directory = tempfile::tempdir().unwrap();
    let vendor = directory.path().join("vendor");
    let core = vendor.join("echo-check");
    std::fs::create_dir_all(core.join("src")).unwrap();
    std::fs::write(
        core.join("Cargo.toml"),
        "[package]\nname = \"echo-check\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[features]\ndefault = [\"std\"]\nstd = []\n",
    )
    .unwrap();
    std::fs::write(core.join("src/lib.rs"), CORE).unwrap();
    std::fs::write(
        core.join(".cargo-checksum.json"),
        "{\"files\":{},\"package\":null}",
    )
    .unwrap();
    let workspace = directory.path().join("work");
    std::fs::create_dir_all(&workspace).unwrap();
    let environment = offline_environment(&workspace, &vendor);
    let built = super::build(application, &workspace, &environment, &[]).unwrap();
    (directory, built)
}

#[test]
fn static_programs_for_both_targets_are_reproducible_and_runnable() {
    let application = model();
    let (_first_directory, first) = build_in_fresh_workspace(&application);
    let (_second_directory, second) = build_in_fresh_workspace(&application);
    assert_eq!(first.lock, second.lock);
    assert_eq!(first.binaries.len(), TARGETS.len());
    for ((target, left), (other, right)) in first.binaries.iter().zip(&second.binaries) {
        assert_eq!(target, other);
        assert_eq!(left, right, "{target} differs between workspaces");
        validate_static_elf(left, target).unwrap();
    }
    assert_eq!(
        super::sbom::sbom(&application, &first).unwrap(),
        super::sbom::sbom(&application, &second).unwrap()
    );
    // The x86_64 program is executable on the x86_64 hosts that run this suite.
    if std::env::consts::ARCH == "x86_64" {
        use std::os::unix::fs::PermissionsExt;
        let directory = tempfile::tempdir().unwrap();
        let program = directory.path().join("echo-check");
        std::fs::write(&program, &first.binaries[0].1).unwrap();
        std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
        let output = Command::new(&program)
            .arg("check")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .and_then(|mut child| {
                child.stdin.take().unwrap().write_all(b"a")?;
                child.wait_with_output()
            })
            .unwrap();
        assert_eq!(output.status.code(), Some(0));
        assert_eq!(output.stdout, b"accepted\n");
    }
}

const GUEST: &str = r#"#![no_std]
use core::ptr::addr_of_mut;
#[panic_handler]
fn panic(_: &core::panic::PanicInfo) -> ! { core::arch::wasm32::unreachable() }
static mut HEAP: [u8; 65536] = [0; 65536];
static mut TOP: usize = 0;
#[no_mangle]
pub extern "C" fn holo_alloc(len: usize) -> usize {
    unsafe {
        let at = addr_of_mut!(HEAP) as usize + TOP;
        TOP += len;
        at
    }
}
#[no_mangle]
pub extern "C" fn holo_run(at: usize, len: usize) -> i64 {
    let first = if len == 0 { 0 } else { unsafe { *(at as *const u8) } };
    let report: &[u8] = match first {
        b'a' => b"accepted\n",
        b'r' => b"rejected\n",
        _ => b"error: bad request\n",
    };
    let out = holo_alloc(report.len());
    unsafe { core::ptr::copy_nonoverlapping(report.as_ptr(), out as *mut u8, report.len()) };
    ((out as i64) << 32) | report.len() as i64
}
"#;

#[test]
fn acceptance_runs_every_vector_through_core_wasm_and_the_program() {
    use std::os::unix::fs::PermissionsExt;
    let mut application = model();
    application
        .acceptance_vectors
        .push(crate::holo::model_document::ApplicationAcceptanceVector {
            request: vec![b'a'; 17],
            response: b"accepted\n".to_vec(),
        });
    let directory = tempfile::tempdir().unwrap();
    let source = directory.path().join("guest.rs");
    std::fs::write(&source, GUEST).unwrap();
    let wasm = directory.path().join("guest.wasm");
    let output = Command::new("rustc")
        .args([
            "--edition=2021",
            "--target=wasm32-unknown-unknown",
            "--crate-type=cdylib",
            "-C",
            "opt-level=2",
            "-C",
            "panic=abort",
            "-o",
        ])
        .arg(&wasm)
        .arg(&source)
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", text(&output.stderr));
    let (_workspace, built) = build_in_fresh_workspace(&application);
    let host = super::acceptance::host_target(std::env::consts::ARCH).unwrap();
    let (_, bytes) = built
        .binaries
        .iter()
        .find(|(target, _)| *target == host)
        .unwrap();
    let program = directory.path().join("echo-check");
    std::fs::write(&program, bytes).unwrap();
    std::fs::set_permissions(&program, std::fs::Permissions::from_mode(0o755)).unwrap();
    let node = crate::verification::executable("node").unwrap();
    let record =
        super::acceptance::execute(&application, &wasm, &program, directory.path(), &node, &[])
            .unwrap();
    super::acceptance::check_report(&application, &record.stdout).unwrap();
    assert!(
        super::acceptance::check_report(&application, "{}").is_err(),
        "a report that omits the modeled corpus must be rejected"
    );
    let digests = built
        .binaries
        .iter()
        .map(|(target, bytes)| {
            use sha2::{Digest, Sha256};
            (
                binary_path(target, &application),
                format!("{:x}", Sha256::digest(bytes)),
            )
        })
        .collect();
    let evidence =
        super::acceptance::evidence(&application, std::env::consts::ARCH, &digests).unwrap();
    assert_eq!(evidence["vectors"], 4);
    assert_eq!(evidence["oversized_vectors"], 1);
    assert_eq!(evidence["within_request_maximum"], 3);
    assert_eq!(evidence["executed_target"], host);
    // A program whose behavior differs from the guest is not accepted.
    std::fs::write(
        directory.path().join("guest-wrong.rs"),
        GUEST.replace("b\"accepted\\n\"", "b\"accepted!\\n\""),
    )
    .unwrap();
    let wrong = directory.path().join("guest-wrong.wasm");
    let output = Command::new("rustc")
        .args([
            "--edition=2021",
            "--target=wasm32-unknown-unknown",
            "--crate-type=cdylib",
            "-C",
            "panic=abort",
            "-o",
        ])
        .arg(&wrong)
        .arg(directory.path().join("guest-wrong.rs"))
        .output()
        .unwrap();
    assert!(output.status.success(), "{}", text(&output.stderr));
    let error =
        super::acceptance::execute(&application, &wrong, &program, directory.path(), &node, &[])
            .unwrap_err();
    assert_eq!(error.code, "PP6003");
}

#[test]
fn without_a_limit_code_input_limit_keeps_the_error_code() {
    let application = model();
    let cli = application.cli.as_ref().unwrap();
    let surface = surface(&application, cli).unwrap();
    assert!(surface.contains("pub const FAULT_CODE: u8 = 2;"));
    assert!(
        surface.contains("pub const LIMIT_CODE: u8 = 2;"),
        "{surface}"
    );
    let text = help(&application, cli);
    assert!(!text.contains(" limit "), "{text}");
    assert!(text.ends_with(
        "    A request over 16 bytes, a failed computation and an unclassified report\n    exit with the code of error.\n"
    ));
    assert!(serde_json::to_value(cli)
        .unwrap()
        .get("limit_code")
        .is_none());
}

#[test]
fn a_declared_limit_code_is_rendered_into_the_surface_and_the_help() {
    let application = limited();
    let cli = application.cli.as_ref().unwrap();
    let surface = surface(&application, cli).unwrap();
    assert!(surface.contains("pub const FAULT_CODE: u8 = 2;"));
    assert!(
        surface.contains("pub const LIMIT_CODE: u8 = 3;"),
        "{surface}"
    );
    let text = help(&application, cli);
    for expected in [
        "  2  error     report begins with",
        "  3  limit     request over 16 bytes",
        " 64  usage",
        "    A failed computation and an unclassified report exit with the code of error.\n",
    ] {
        assert!(text.contains(expected), "{expected:?} in {text}");
    }
    assert!(!text.contains("A request over 16 bytes"), "{text}");
}

#[test]
fn oversized_input_exits_with_the_declared_limit_code() {
    let program = &built_limited().program;
    let output = run_program(program, &["check"], &[b'a'; 17]);
    assert_eq!(output.status.code(), Some(3), "{}", text(&output.stderr));
    assert!(output.stdout.is_empty());
    assert_eq!(text(&output.stderr), "echo-check: InputLimit\n");
    // Every other fault keeps the code of error; reports keep their own codes.
    let unclassified = run_program(program, &["check"], b"z");
    assert_eq!(unclassified.status.code(), Some(2));
    let error = run_program(program, &["check"], b"x");
    assert_eq!(error.status.code(), Some(2));
    assert_eq!(error.stdout, b"error: bad request\n");
    let help_output = run_program(program, &["--help"], b"");
    let application = limited();
    assert_eq!(
        text(&help_output.stdout),
        help(&application, application.cli.as_ref().unwrap())
    );
    let unit = cargo(
        &["test", "--offline"],
        &built_limited().package,
        &built_limited().target,
    );
    assert!(
        unit.status.success(),
        "{}",
        String::from_utf8_lossy(&unit.stderr)
    );
}
