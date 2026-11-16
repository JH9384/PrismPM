//! Generation, structure and execution tests of the host adapter.
//!
//! The execution tests compile the generated package against a small core
//! crate that stands in for the generated application crate, run the generated
//! acceptance suite, and drive the real program for every vector and every
//! registered failure. A second, rogue core requests an effect the declaration
//! does not contain: the program must refuse it.

use super::{
    acceptance, api_library_name, api_name, generate, help, library_name, program_name, workspace,
};
use crate::holo::server_application::wire::{
    encode_fields, encode_outcome, Outcome, Value as Wire,
};
use crate::holo::server_application::{validate, HostEffect, HostKind, ServerApplication};
use serde_json::{json, Value};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::OnceLock;

const USAGE: i32 = 64;
const IO: i32 = 74;
const FAULT: i32 = 70;

/// A pure root following the turn protocol: `a` performs nothing, `g` reads
/// one key, `t` reads, asks the time and logs.
const CORE: &str = r#"
fn word(turn: &[u8], at: &mut usize) -> u32 {
    let value = u32::from_be_bytes([turn[*at], turn[*at + 1], turn[*at + 2], turn[*at + 3]]);
    *at += 4;
    value
}

fn done(response: &[u8]) -> Vec<u8> {
    let mut out = vec![0, 0, 0, 0];
    out.extend_from_slice(response);
    out
}

fn perform(tag: u32, payload: &[u8]) -> Vec<u8> {
    let mut out = vec![0, 0, 0, 1];
    out.extend_from_slice(&tag.to_be_bytes());
    out.extend_from_slice(payload);
    out
}

fn chunk(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

pub fn dispatch(turn: Vec<u8>) -> Vec<u8> {
    let mut at = 0;
    let length = word(&turn, &mut at) as usize;
    let request = turn[at..at + length].to_vec();
    at += length;
    let count = word(&turn, &mut at) as usize;
    let mut outcomes: Vec<Vec<u8>> = Vec::new();
    for _ in 0..count {
        let _tag = word(&turn, &mut at);
        let length = word(&turn, &mut at) as usize;
        outcomes.push(turn[at..at + length].to_vec());
        at += length;
    }
    let get = |key: &[u8], limit: u32| {
        let mut payload = Vec::new();
        chunk(&mut payload, key);
        payload.extend_from_slice(&limit.to_be_bytes());
        payload
    };
    match request.first() {
        Some(b'a') => done(b"plain"),
        Some(b'g') => match outcomes.first() {
            None => perform(0, &get(&request[1..], 7)),
            Some(outcome) => match outcome[3] {
                0 => {
                    let mut out = b"found:".to_vec();
                    let value_length = u32::from_be_bytes([outcome[13], outcome[14], outcome[15], outcome[16]]) as usize;
                    out.extend_from_slice(&outcome[17..17 + value_length]);
                    done(&out)
                }
                _ if outcome[7] == 0 => done(b"denied"),
                _ => done(b"unavailable"),
            },
        },
        Some(b't') => match outcomes.len() {
            0 => perform(0, &get(b"t", 1)),
            1 => perform(1, &[]),
            2 => {
                let mut payload = Vec::new();
                chunk(&mut payload, b"t");
                perform(2, &payload)
            }
            _ => {
                let millis = u64::from_be_bytes([
                    outcomes[1][4], outcomes[1][5], outcomes[1][6], outcomes[1][7],
                    outcomes[1][8], outcomes[1][9], outcomes[1][10], outcomes[1][11],
                ]);
                done(format!("time:{millis}").as_bytes())
            }
        },
        _ => done(b"unknown"),
    }
}
"#;

/// What the LexLean `rust-std` package runtime exports, as far as the adapter
/// uses it, around a hand-written step function: `run` takes the turn as
/// `Bytes` and returns the step as a list of numbers or fails with `Overflow`.
/// An empty step stands for `Overflow`, a step of `256` for an element that is
/// not one octet.
pub(super) const PRELUDE: &str = r#"
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Overflow;

#[derive(Clone)]
pub struct Bytes(std::rc::Rc<[u8]>);
impl Bytes {
    pub fn lit(octets: &[u8]) -> Bytes { Bytes(std::rc::Rc::from(octets)) }
    pub fn octets(&self) -> &[u8] { &self.0 }
}

#[derive(Clone)]
pub struct List<T>(std::rc::Rc<Vec<T>>, usize);
impl<T: Clone> List<T> {
    pub fn uncons(&self) -> Option<(T, List<T>)> {
        self.0.get(self.1).map(|head| (head.clone(), List(self.0.clone(), self.1 + 1)))
    }
}

pub fn run(turn: Bytes) -> Result<List<u64>, Overflow> {
    let step = dispatch(turn.octets().to_vec());
    if step.is_empty() {
        return Err(Overflow);
    }
    let mut numbers: Vec<u64> = step.iter().map(|byte| u64::from(*byte)).collect();
    if step[0] == 255 {
        numbers[0] = 256;
    }
    Ok(List(std::rc::Rc::new(numbers), 0))
}
"#;

/// A root that misbehaves by request: `r` requests an effect the declaration
/// does not contain, `o` overflows, `w` returns an element that is no octet.
const ROGUE: &str = r#"
pub fn dispatch(turn: Vec<u8>) -> Vec<u8> {
    match turn.get(4) {
        Some(b'o') => Vec::new(),
        Some(b'w') => vec![255, 0, 0, 0],
        _ => {
            let mut out = vec![0, 0, 0, 1];
            out.extend_from_slice(&9u32.to_be_bytes());
            out
        }
    }
}
"#;

pub(super) fn field(name: &str, kind: &str) -> Value {
    json!({"name": name, "kind": kind})
}

fn effects() -> Value {
    json!([
        {
            "name": "store.get",
            "request": [field("key", "bytes"), field("limit", "u32")],
            "result": [field("found", "flag"), field("version", "u64"), field("value", "text")],
            "failures": ["denied", "unavailable"],
            "request_maximum": 64,
            "result_maximum": 64
        },
        {
            "name": "clock.now",
            "request": [],
            "result": [field("millis", "u64")],
            "failures": [],
            "request_maximum": 16,
            "result_maximum": 16
        },
        {
            "name": "log.write",
            "request": [field("line", "text")],
            "result": [],
            "failures": ["full"],
            "request_maximum": 64,
            "result_maximum": 8
        }
    ])
}

fn declared() -> Vec<HostEffect> {
    serde_json::from_value(effects()).expect("effects deserialize")
}

fn request(name: &str, values: &[Wire]) -> Vec<u8> {
    let effects = declared();
    let effect = effects
        .iter()
        .find(|candidate| candidate.name == name)
        .unwrap();
    encode_fields(&effect.request, values).expect("request encodes")
}

fn outcome(name: &str, outcome: &Outcome) -> Vec<u8> {
    let effects = declared();
    let effect = effects
        .iter()
        .find(|candidate| candidate.name == name)
        .unwrap();
    encode_outcome(effect, outcome).expect("outcome encodes")
}

fn step(effect: &str, request_bytes: Vec<u8>, outcome_bytes: Vec<u8>) -> Value {
    json!({"effect": effect, "request": request_bytes, "outcome": outcome_bytes})
}

fn key_request(key: &[u8], limit: u32) -> Vec<u8> {
    request("store.get", &[Wire::Bytes(key.to_vec()), Wire::U32(limit)])
}

fn found(version: u64, value: &str) -> Vec<u8> {
    outcome(
        "store.get",
        &Outcome::Completed(vec![
            Wire::Flag(true),
            Wire::U64(version),
            Wire::Text(value.to_owned()),
        ]),
    )
}

pub(super) fn model_value() -> Value {
    json!({
        "profile": "prismpm/server-application/1",
        "name": "Echo Host",
        "cargo_name": "echo-core",
        "cargo_version": "0.1.0",
        "cargo_description": "Echo host",
        "cargo_repository": "https://example.invalid/echo",
        "cargo_homepage": "https://example.invalid/echo",
        "acceptance_vectors": [
            {"request": b"a".to_vec(), "response": b"plain".to_vec()},
            {"request": b"gk".to_vec(), "response": b"found:v".to_vec()},
            {"request": b"gx".to_vec(), "response": b"denied".to_vec()},
            {"request": b"gy".to_vec(), "response": b"unavailable".to_vec()},
            {"request": b"t".to_vec(), "response": b"time:42".to_vec()}
        ],
        "core": {"root": "Echo.Host.run", "package": "echo_core", "version": "0.1.0"},
        "bindings": [{"path": "bindings/echo-binding", "crate_name": "echo-binding", "host": "echo_binding::Native"}],
        "request_maximum": 16,
        "response_maximum": 64,
        "serving": [],
        "verify_build_timeout_seconds": 1800,
        "host": {
            "protocol": "prismpm/host-effects/1",
            "description": "Replays a scripted host for one exchange.\n",
            "usage_code": USAGE,
            "io_code": IO,
            "fault_code": FAULT,
            "effect_budget": 4,
            "effects": effects(),
            "transcripts": [
                {"vector": 1, "steps": [step("store.get", key_request(b"k", 7), found(3, "v"))]},
                {"vector": 2, "steps": [step(
                    "store.get",
                    key_request(b"x", 7),
                    outcome("store.get", &Outcome::Failed(0)),
                )]},
                {"vector": 3, "steps": [step(
                    "store.get",
                    key_request(b"y", 7),
                    outcome("store.get", &Outcome::Failed(1)),
                )]},
                {"vector": 4, "steps": [
                    step(
                        "store.get",
                        key_request(b"t", 1),
                        outcome("store.get", &Outcome::Completed(vec![
                            Wire::Flag(false), Wire::U64(0), Wire::Text(String::new()),
                        ])),
                    ),
                    step(
                        "clock.now",
                        request("clock.now", &[]),
                        outcome("clock.now", &Outcome::Completed(vec![Wire::U64(42)])),
                    ),
                    step(
                        "log.write",
                        request("log.write", &[Wire::Text("t".to_owned())]),
                        outcome("log.write", &Outcome::Completed(vec![])),
                    )
                ]}
            ]
        }
    })
}

pub(crate) fn model() -> ServerApplication {
    serde_json::from_value(model_value()).expect("fixture deserializes")
}

fn file<'a>(package: &'a prod_codegen::GeneratedPackage, path: &str) -> &'a str {
    let file = package
        .files
        .iter()
        .find(|file| file.path == path)
        .unwrap_or_else(|| panic!("generated package lacks {path}"));
    std::str::from_utf8(&file.bytes).unwrap()
}

fn api_file<'a>(package: &'a prod_codegen::GeneratedPackage, path: &str) -> &'a str {
    file(package, &format!("{}/{path}", api_name(&model())))
}

fn host_file<'a>(package: &'a prod_codegen::GeneratedPackage, path: &str) -> &'a str {
    file(package, &format!("{}/{path}", program_name(&model())))
}

pub(super) struct Built {
    _directory: tempfile::TempDir,
    pub(super) program: PathBuf,
    pub(super) package: PathBuf,
    pub(super) target: PathBuf,
}

pub(super) fn cargo(arguments: &[&str], directory: &Path, target: &Path) -> Output {
    Command::new("cargo")
        .args(arguments)
        .current_dir(directory)
        .env("CARGO_TARGET_DIR", target)
        .output()
        .expect("cargo runs")
}

/// The consumer's side of the binding: a workspace crate that depends on the
/// generated API package and implements its `Host` trait. It answers exactly
/// as the transcripts record, so a vector replayed through it gives the
/// modeled response; the key `z` is a host that cannot run the effect at all.
const BINDING: &str = r#"
use echo_core_host_api::protocol::{clock_now, log_write, store_get, Host, HostError};

#[derive(Default)]
pub struct Native {
    pub lines: Vec<String>,
}

impl Host for Native {
    fn store_get(
        &mut self,
        request: store_get::Request,
    ) -> Result<store_get::Completed, HostError<store_get::Failure>> {
        match request.key.as_slice() {
            b"k" => Ok(store_get::Completed { found: true, version: 3, value: "v".to_owned() }),
            b"x" => Err(HostError::Failed(store_get::Failure::Denied)),
            b"y" => Err(HostError::Failed(store_get::Failure::Unavailable)),
            b"z" => Err(HostError::Fault),
            _ => Ok(store_get::Completed { found: false, version: 0, value: String::new() }),
        }
    }

    fn clock_now(
        &mut self,
        _request: clock_now::Request,
    ) -> Result<clock_now::Completed, HostError<clock_now::Failure>> {
        Ok(clock_now::Completed { millis: 42 })
    }

    fn log_write(
        &mut self,
        request: log_write::Request,
    ) -> Result<log_write::Completed, HostError<log_write::Failure>> {
        self.lines.push(request.line);
        Ok(log_write::Completed {})
    }
}
"#;

pub(super) fn write_binding(workspace: &Path, application: &ServerApplication, source: &str) {
    for binding in &application.bindings {
        let directory = workspace.join(&binding.path);
        std::fs::create_dir_all(directory.join("src")).unwrap();
        std::fs::write(
            directory.join("Cargo.toml"),
            format!(
                "[package]\nname = \"{}\"\nversion = \"0.1.0\"\nedition = \"2021\"\n\n[dependencies]\n{api} = {{ path = \"{up}{api}\" }}\n",
                binding.crate_name,
                api = api_name(application),
                up = "../".repeat(binding.path.split('/').count()),
            ),
        )
        .unwrap();
        std::fs::write(directory.join("src/lib.rs"), source).unwrap();
    }
}

pub(super) fn members(application: &ServerApplication) -> String {
    let mut members = vec![
        application.core.package.clone(),
        api_name(application),
        program_name(application),
    ];
    members.extend(
        application
            .bindings
            .iter()
            .map(|binding| binding.path.clone()),
    );
    format!(
        "[workspace]\nresolver = \"2\"\nmembers = [{}]\n",
        members
            .iter()
            .map(|member| format!("{member:?}"))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

/// Write the generated packages, the stand-in core and the test binding into one
/// workspace, as a consumer would hold them, and build the program.
fn build(application: &ServerApplication, core_source: &str) -> Built {
    build_with(application, core_source, BINDING)
}

/// As `build`, with the source of the binding crate given.
pub(super) fn build_with(
    application: &ServerApplication,
    core_source: &str,
    binding: &str,
) -> Built {
    let directory = tempfile::tempdir().unwrap();
    let workspace = directory.path().join("workspace");
    let core = workspace.join(&application.core.package);
    std::fs::create_dir_all(core.join("src")).unwrap();
    std::fs::write(
        core.join("Cargo.toml"),
        format!(
            "[package]\nname = \"{}\"\nversion = \"{}\"\nedition = \"2021\"\n",
            application.core.package, application.core.version
        ),
    )
    .unwrap();
    std::fs::write(core.join("src/lib.rs"), format!("{PRELUDE}{core_source}")).unwrap();
    std::fs::write(
        workspace.join("Cargo.toml"),
        format!("{}\n[profile.dev]\ndebug = 0\n", members(application)),
    )
    .unwrap();
    let generated = generate(application).unwrap();
    for item in &generated.files {
        let path = workspace.join(&item.path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        let bytes = item.bytes.clone();
        std::fs::write(path, bytes).unwrap();
    }
    write_binding(&workspace, application, binding);
    let target = directory.path().join("target");
    let output = cargo(&["build", "--offline"], &workspace, &target);
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    Built {
        program: target.join("debug").join(program_name(application)),
        package: workspace,
        target,
        _directory: directory,
    }
}

pub(super) fn built() -> &'static Built {
    static BUILT: OnceLock<Built> = OnceLock::new();
    BUILT.get_or_init(|| build(&model(), CORE))
}

fn rogue() -> &'static Built {
    static BUILT: OnceLock<Built> = OnceLock::new();
    BUILT.get_or_init(|| build(&model(), ROGUE))
}

pub(super) fn run(program: &Path, arguments: &[&str], stdin: &[u8]) -> Output {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("program starts");
    let _ = child.stdin.take().unwrap().write_all(stdin);
    child.wait_with_output().unwrap()
}

pub(super) fn code(output: &Output) -> i32 {
    output.status.code().expect("exit code")
}

pub(super) fn stderr(output: &Output) -> String {
    String::from_utf8_lossy(&output.stderr).into_owned()
}

fn script_file(directory: &Path, name: &str, bytes: &[u8]) -> PathBuf {
    let path = directory.join(name);
    std::fs::write(&path, bytes).unwrap();
    path
}

#[test]
fn the_fixture_is_a_valid_declaration() {
    validate(&model()).unwrap();
}

#[test]
fn generated_package_has_the_closed_file_set() {
    let package = generate(&model()).unwrap();
    let mut paths = package
        .files
        .iter()
        .map(|file| file.path.as_str())
        .collect::<Vec<_>>();
    paths.sort_unstable();
    assert_eq!(
        paths,
        [
            "echo-core-host-api/Cargo.toml",
            "echo-core-host-api/src/lib.rs",
            "echo-core-host-api/src/protocol.rs",
            "echo-core-host-api/src/wire.rs",
            "echo-core-host/Cargo.toml",
            "echo-core-host/src/acceptance.rs",
            "echo-core-host/src/exchange.rs",
            "echo-core-host/src/failure.rs",
            "echo-core-host/src/lib.rs",
            "echo-core-host/src/main.rs",
            "echo-core-host/src/perform.rs",
            "echo-core-host/src/script.rs",
            "echo-core-host/src/surface.rs",
            "echo-core-host/tests/acceptance.rs",
        ]
    );
    let api = api_file(&package, "Cargo.toml");
    assert!(api.contains("name = \"echo-core-host-api\""));
    assert!(!api.contains("echo_core") && !api.contains("[[bin]]"));
    assert_eq!(api_library_name(&model()), "echo_core_host_api");
    assert_eq!(
        api_file(&package, "src/lib.rs").matches("pub mod ").count(),
        2
    );
    let manifest = host_file(&package, "Cargo.toml");
    assert!(manifest.contains("name = \"echo-core-host\""));
    assert!(manifest.contains("echo_core = { path = \"../echo_core\" }"));
    assert!(manifest.contains("echo-core-host-api = { path = \"../echo-core-host-api\" }"));
    assert!(manifest.contains("echo-binding = { path = \"../bindings/echo-binding\" }"));
    assert!(!manifest.contains("[profile"));
    assert_eq!(library_name(&model()), "echo_core_host");
    assert!(host_file(&package, "src/exchange.rs")
        .contains("echo_core::run(echo_core::Bytes::lit(&input))"));
    let library = host_file(&package, "src/lib.rs");
    assert!(library.contains("pub use echo_core_host_api::{protocol, wire};"));
    // The driver package owns no effect type: it reaches them only through the API package.
    assert!(!paths
        .iter()
        .any(|path| path.starts_with("echo-core-host/") && path.ends_with("protocol.rs")));
    let main = host_file(&package, "src/main.rs");
    assert!(main.contains("use echo_core_host::"));
    assert!(main.contains("<echo_binding::Native as Default>::default()"));
    assert!(main.contains("Invocation::Run"));
    assert!(!main.contains('@') && !main.contains("//@"));
    assert!(host_file(&package, "src/surface.rs")
        .find("BINDINGS")
        .is_none());
    assert!(
        host_file(&package, "tests/acceptance.rs").contains("linked::<echo_binding::Native>();")
    );
}

#[test]
fn the_request_sum_and_host_trait_contain_exactly_the_declared_effects() {
    let package = generate(&model()).unwrap();
    let protocol = api_file(&package, "src/protocol.rs");
    let (_, sum) = protocol.split_once("pub enum Request {").unwrap();
    let (sum, _) = sum.split_once('}').unwrap();
    let variants = sum
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .collect::<Vec<_>>();
    assert_eq!(
        variants,
        [
            "StoreGet(store_get::Request),",
            "ClockNow(clock_now::Request),",
            "LogWrite(log_write::Request),"
        ]
    );
    let (_, host) = protocol.split_once("pub trait Host {").unwrap();
    let (host, _) = host.split_once("\n}\n").unwrap();
    assert_eq!(host.matches("fn ").count(), 3);
    for method in ["fn store_get(", "fn clock_now(", "fn log_write("] {
        assert!(host.contains(method), "{method}");
    }
    assert!(protocol.contains("pub const EFFECTS: &[&str] = &[\n    \"store.get\",\n    \"clock.now\",\n    \"log.write\",\n];"));
}

#[test]
fn an_application_without_effects_renders_the_plain_frame_function() {
    let mut value = model_value();
    value["host"]["effect_budget"] = json!(0);
    value["host"]["effects"] = json!([]);
    value["host"]["transcripts"] = json!([]);
    value["bindings"] = json!([]);
    let plain: ServerApplication = serde_json::from_value(value).unwrap();
    validate(&plain).unwrap();
    let package = generate(&plain).unwrap();
    let protocol = api_file(&package, "src/protocol.rs");
    assert!(protocol.contains("pub enum Request {\n}"));
    assert!(protocol.contains("pub const EFFECTS: &[&str] = &[\n];"));
    assert!(host_file(&package, "src/surface.rs").contains("pub const EFFECT_BUDGET: usize = 0;"));
    // No effect, no binding: the program has no `run` command and links nothing.
    let main = host_file(&package, "src/main.rs");
    assert!(!main.contains("Invocation::Run") && !main.contains("Default>::default"));
    assert!(!host_file(&package, "Cargo.toml").contains("binding"));
    assert!(!host_file(&package, "tests/acceptance.rs").contains("linked"));
    assert!(!help(&plain).contains("run [FILE]"));
}

#[test]
fn help_is_derived_only_from_the_declaration() {
    let text = help(&model());
    assert!(text.starts_with("Echo Host 0.1.0\n\nReplays a scripted host for one exchange.\n"));
    assert!(text.contains("echo-core-host exchange SCRIPT [FILE]"));
    assert!(text.contains("at most 16 of them"));
    assert!(text.contains("  0  store.get  request at most 64 bytes, outcome at most 64 bytes"));
    assert!(text.contains(" 64  usage"));
    assert!(text.contains(" 70  fault"));
    assert!(text.contains(" 74  io"));
}

#[test]
fn the_generated_suite_and_program_tests_pass_against_the_core() {
    let built = built();
    let output = cargo(
        &["test", "--offline", "--workspace"],
        &built.package,
        &built.target,
    );
    let text = String::from_utf8_lossy(&output.stdout).into_owned();
    assert!(output.status.success(), "{text}\n{}", stderr(&output));
    for name in [
        "every_vector_replays_its_transcript_to_its_response",
        "every_declared_effect_is_performed_by_some_vector",
        "undeclared_effects_cannot_be_decoded_or_scripted",
        "a_root_cannot_step_outside_the_protocol",
        "the_effect_budget_bounds_every_exchange",
        "the_scripted_host_refuses_a_script_that_does_not_match",
        "the_declared_binding_implements_the_host_trait",
    ] {
        assert!(text.contains(&format!("{name} ... ok")), "{name}\n{text}");
    }
}

#[test]
fn the_program_accepts_every_vector_over_a_file_and_standard_input() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let record = acceptance::execute(&model(), &built.program, work.path(), false).unwrap();
    assert_eq!(record["schema"], acceptance::SCHEMA);
    assert_eq!(record["status"], "verified");
    assert_eq!(record["vectors"], 5);
    assert_eq!(record["steps"], 6);
    assert_eq!(record["binding"], Value::Null);
    assert_eq!(record["transports"], json!(["file", "stdin"]));
    assert_eq!(
        record["effects"],
        json!([
            {"name": "store.get", "role": "core", "served": 0, "steps": 4},
            {"name": "clock.now", "role": "core", "served": 0, "steps": 1},
            {"name": "log.write", "role": "core", "served": 0, "steps": 1}
        ])
    );
    assert_eq!(record["program_sha256"].as_str().unwrap().len(), 64);
}

#[test]
fn the_linked_binding_serves_every_vector_without_a_script() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let record = acceptance::execute(&model(), &built.program, work.path(), true).unwrap();
    assert_eq!(record["status"], "verified");
    assert_eq!(record["binding"], "echo-binding");
    assert_eq!(record["transports"], json!(["file", "stdin", "binding"]));
    // The binding refuses nothing the modeled vectors ask for, and the scripted
    // transports of the same record agree with it.
    assert_eq!(record["vectors"], 5);
    let request = script_file(work.path(), "binding.request", b"t");
    let output = run(&built.program, &["run", request.to_str().unwrap()], b"");
    assert_eq!(code(&output), 0, "{}", stderr(&output));
    assert_eq!(output.stdout, b"time:42");
    let output = run(&built.program, &["run"], b"gk");
    assert_eq!(output.stdout, b"found:v");
    // Without a binding there is nothing to ask for.
    let mut value = model_value();
    value["host"]["effect_budget"] = json!(0);
    value["host"]["effects"] = json!([]);
    value["host"]["transcripts"] = json!([]);
    value["bindings"] = json!([]);
    let plain: ServerApplication = serde_json::from_value(value).unwrap();
    assert_eq!(
        acceptance::execute(&plain, &built.program, work.path(), true)
            .unwrap_err()
            .code,
        "PP2013"
    );
}

#[test]
fn a_binding_that_cannot_run_an_effect_exits_with_the_fault_code() {
    let built = built();
    let output = run(&built.program, &["run"], b"gz");
    assert_eq!(code(&output), FAULT);
    assert!(output.stdout.is_empty());
    assert!(stderr(&output).contains("HostFault"), "{}", stderr(&output));
    let output = run(&built.program, &["run", "a", "b"], b"");
    assert_eq!(code(&output), USAGE);
    assert!(stderr(&output).contains("ExtraArgument"));
    let output = run(&built.program, &["run", "/nonexistent/request"], b"");
    assert_eq!(code(&output), IO);
    assert!(stderr(&output).contains("InputMissing"));
}

/// A workspace with the generated members listed and the test binding written,
/// without building anything.
pub(super) fn scratch(application: &ServerApplication) -> tempfile::TempDir {
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("Cargo.toml"), members(application)).unwrap();
    for generated in [
        application.core.package.clone(),
        api_name(application),
        program_name(application),
    ] {
        std::fs::create_dir_all(directory.path().join(generated)).unwrap();
    }
    write_binding(directory.path(), application, BINDING);
    directory
}

fn binding_manifest(directory: &tempfile::TempDir) -> PathBuf {
    directory.path().join("bindings/echo-binding/Cargo.toml")
}

#[test]
fn the_workspace_holds_the_declared_binding_or_the_declaration_is_refused() {
    let application = model();
    workspace::verify(&application, scratch(&application).path()).unwrap();
    let refused = |directory: &tempfile::TempDir| {
        let error = workspace::verify(&application, directory.path()).unwrap_err();
        assert_eq!(error.code, "PP2013");
        error.message
    };

    // The generated packages and the binding are listed exactly.
    for omitted in [
        "echo_core",
        "echo-core-host-api",
        "echo-core-host",
        "bindings/echo-binding",
    ] {
        let directory = scratch(&application);
        let manifest = std::fs::read_to_string(directory.path().join("Cargo.toml")).unwrap();
        let listed = manifest.replace(&format!("{omitted:?}"), "\"elsewhere\"");
        std::fs::write(directory.path().join("Cargo.toml"), listed).unwrap();
        assert!(refused(&directory).contains(omitted));
    }
    let directory = scratch(&application);
    std::fs::write(
        directory.path().join("Cargo.toml"),
        "[workspace]\nmembers = [\"echo_core\", \"echo-core-host-api\", \"echo-core-host\", \"bindings/*\"]\n",
    )
    .unwrap();
    assert!(refused(&directory).contains("bindings/echo-binding"));

    // The crate at the path is the declared one.
    let directory = scratch(&application);
    let manifest = std::fs::read_to_string(binding_manifest(&directory)).unwrap();
    std::fs::write(
        binding_manifest(&directory),
        manifest.replace("name = \"echo-binding\"", "name = \"other-binding\""),
    )
    .unwrap();
    assert!(refused(&directory).contains("is not named echo-binding"));
    let directory = scratch(&application);
    std::fs::write(
        binding_manifest(&directory),
        manifest.replace(
            "[dependencies]",
            "[lib]\nname = \"other\"\n\n[dependencies]",
        ),
    )
    .unwrap();
    assert!(refused(&directory).contains("library"));
    let directory = scratch(&application);
    std::fs::remove_file(binding_manifest(&directory)).unwrap();
    refused(&directory);

    // It depends on the generated API package, and on nothing but crates.io and the workspace.
    let directory = scratch(&application);
    std::fs::write(
        binding_manifest(&directory),
        "[package]\nname = \"echo-binding\"\nversion = \"0.1.0\"\n\n[dependencies]\nserde = \"1\"\n",
    )
    .unwrap();
    assert!(refused(&directory).contains("does not depend on the generated echo-core-host-api"));
    for foreign in [
        "other = { git = \"https://example.invalid/other\" }",
        "other = { version = \"1\", registry = \"private\" }",
        "other = { path = \"../../../outside\" }",
    ] {
        let directory = scratch(&application);
        let mut changed = manifest.clone();
        changed.push_str(foreign);
        changed.push('\n');
        std::fs::write(binding_manifest(&directory), changed).unwrap();
        refused(&directory);
    }
    let directory = scratch(&application);
    let mut changed = manifest.clone();
    changed.push_str("serde = { version = \"1\", features = [\"derive\"] }\nsibling = { path = \"../sibling\" }\n");
    std::fs::create_dir_all(directory.path().join("bindings/sibling")).unwrap();
    std::fs::write(binding_manifest(&directory), changed).unwrap();
    workspace::verify(&application, directory.path()).unwrap();
}

#[cfg(unix)]
#[test]
fn a_binding_directory_cannot_resolve_outside_the_workspace() {
    let application = model();
    let outside = scratch(&application);
    let directory = tempfile::tempdir().unwrap();
    std::fs::write(directory.path().join("Cargo.toml"), members(&application)).unwrap();
    std::fs::create_dir_all(directory.path().join("bindings")).unwrap();
    std::os::unix::fs::symlink(
        outside.path().join("bindings/echo-binding"),
        directory.path().join("bindings/echo-binding"),
    )
    .unwrap();
    let error = workspace::verify(&application, directory.path()).unwrap_err();
    assert_eq!(error.code, "PP2013");
    assert!(
        error.message.contains("outside the workspace"),
        "{}",
        error.message
    );
}

#[test]
fn acceptance_refuses_a_response_that_differs_from_the_model() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let mut value = model_value();
    value["acceptance_vectors"][0]["response"] = json!(b"other".to_vec());
    let changed: ServerApplication = serde_json::from_value(value).unwrap();
    assert_eq!(
        acceptance::execute(&changed, &built.program, work.path(), false)
            .unwrap_err()
            .code,
        "PP6003"
    );
}

#[test]
fn the_program_prints_help_and_version_from_the_declaration() {
    let built = built();
    let output = run(&built.program, &["--help"], b"");
    assert_eq!(code(&output), 0);
    assert_eq!(String::from_utf8(output.stdout).unwrap(), help(&model()));
    let output = run(&built.program, &["--version"], b"");
    assert_eq!(code(&output), 0);
    assert_eq!(
        String::from_utf8(output.stdout).unwrap(),
        "echo-core-host 0.1.0\n"
    );
}

#[test]
fn invalid_command_lines_exit_with_the_usage_code() {
    let built = built();
    for (arguments, failure) in [
        (vec![], "MissingCommand"),
        (vec!["--bogus"], "UnknownFlag"),
        (vec!["bogus"], "UnknownCommand"),
        (vec!["exchange"], "MissingOperand"),
        (vec!["exchange", "a", "b", "c"], "ExtraArgument"),
    ] {
        let output = run(&built.program, &arguments, b"");
        assert_eq!(code(&output), USAGE, "{arguments:?}");
        assert!(
            stderr(&output).contains(failure),
            "{arguments:?}: {}",
            stderr(&output)
        );
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn unreadable_missing_and_non_regular_inputs_exit_with_the_io_code() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let script = script_file(work.path(), "empty.script", b"");
    let script = script.to_str().unwrap();
    let missing = work.path().join("missing");
    for (arguments, failure) in [
        (vec!["exchange", missing.to_str().unwrap()], "InputMissing"),
        (
            vec!["exchange", script, missing.to_str().unwrap()],
            "InputMissing",
        ),
        (vec!["exchange", work.path().to_str().unwrap()], "InputType"),
        (
            vec!["exchange", script, work.path().to_str().unwrap()],
            "InputType",
        ),
    ] {
        let output = run(&built.program, &arguments, b"a");
        assert_eq!(code(&output), IO, "{arguments:?}");
        assert!(
            stderr(&output).contains(failure),
            "{arguments:?}: {}",
            stderr(&output)
        );
    }
    #[cfg(unix)]
    {
        let link = work.path().join("link");
        std::os::unix::fs::symlink(script, &link).unwrap();
        let output = run(&built.program, &["exchange", link.to_str().unwrap()], b"a");
        assert_eq!(code(&output), IO);
        assert!(stderr(&output).contains("InputType"), "{}", stderr(&output));
    }
}

#[test]
fn oversized_requests_and_scripts_are_refused_before_dispatch() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let script = script_file(work.path(), "empty.script", b"");
    let output = run(
        &built.program,
        &["exchange", script.to_str().unwrap()],
        &[b'a'; 17],
    );
    assert_eq!(code(&output), FAULT);
    assert!(stderr(&output).contains("InputLimit"));
    let long = script_file(
        work.path(),
        "long.script",
        &vec![0u8; 4 * (12 + 64 + 64) + 1],
    );
    let output = run(&built.program, &["exchange", long.to_str().unwrap()], b"a");
    assert_eq!(code(&output), FAULT);
    assert!(stderr(&output).contains("ScriptMalformed"));
}

#[test]
fn script_failures_exit_with_the_fault_code_and_publish_nothing() {
    let built = built();
    let work = tempfile::tempdir().unwrap();
    let application = model();
    let complete = acceptance::script_bytes(&application, 1).unwrap();
    let nothing = script_file(work.path(), "nothing.script", b"");
    let mut flipped = complete.clone();
    let at = 4 + 4 + 4; // the key byte of the encoded request, past tag, length and key length
    flipped[at] ^= 0xff;
    let mismatched = script_file(work.path(), "mismatched.script", &flipped);
    let mut extra = complete.clone();
    extra.extend_from_slice(&complete);
    let unused = script_file(work.path(), "unused.script", &extra);
    let truncated = script_file(
        work.path(),
        "truncated.script",
        &complete[..complete.len() - 1],
    );
    let complete = script_file(work.path(), "complete.script", &complete);
    for (script, request, failure) in [
        (&nothing, &b"gk"[..], "ScriptExhausted"),
        (&mismatched, &b"gk"[..], "ScriptMismatch"),
        (&unused, &b"gk"[..], "ScriptUnused"),
        (&truncated, &b"gk"[..], "ScriptMalformed"),
        (&complete, &b"a"[..], "ScriptUnused"),
    ] {
        let output = run(
            &built.program,
            &["exchange", script.to_str().unwrap()],
            request,
        );
        assert_eq!(code(&output), FAULT, "{failure}");
        assert!(
            stderr(&output).contains(failure),
            "{failure}: {}",
            stderr(&output)
        );
        assert!(output.stdout.is_empty(), "{failure}");
    }
    let output = run(
        &built.program,
        &["exchange", complete.to_str().unwrap()],
        b"gk",
    );
    assert_eq!(code(&output), 0);
    assert_eq!(output.stdout, b"found:v");
}

#[test]
fn a_core_that_requests_an_undeclared_effect_is_refused_by_the_program() {
    let rogue = rogue();
    let work = tempfile::tempdir().unwrap();
    let script = script_file(work.path(), "empty.script", b"");
    for (request, failure) in [
        (&b"r"[..], "EffectUndeclared"),
        (&b"o"[..], "ComputeFailure"),
        (&b"w"[..], "StepMalformed"),
    ] {
        let output = run(
            &rogue.program,
            &["exchange", script.to_str().unwrap()],
            request,
        );
        assert_eq!(code(&output), FAULT, "{failure}");
        assert!(stderr(&output).contains(failure), "{}", stderr(&output));
        assert!(output.stdout.is_empty());
    }
}

#[test]
fn declared_kinds_are_the_only_wire_kinds() {
    // The fixture exercises every value kind the declaration admits.
    let effects = declared();
    let kinds = effects
        .iter()
        .flat_map(|effect| effect.request.iter().chain(&effect.result))
        .map(|field| field.kind)
        .collect::<Vec<_>>();
    for kind in [
        HostKind::U32,
        HostKind::U64,
        HostKind::Flag,
        HostKind::Bytes,
        HostKind::Text,
    ] {
        assert!(kinds.contains(&kind), "{kind:?}");
    }
}
