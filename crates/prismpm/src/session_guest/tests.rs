use super::*;

const IR: &str = "(module SessionFixture (def step ((turn Bytes)) Bytes turn))";
const DIGEST: &str = "0000000000000000000000000000000000000000000000000000000000000000";

fn module(ir: &str) -> Module {
    let (rest, module) = prod_ir::parser::parse_module(ir).expect("fixture IR parses");
    assert!(rest.trim().is_empty());
    module
}

fn spec() -> SessionGuestSpec {
    SessionGuestSpec {
        crate_name: "prism-session-fixture-core-wasm".to_owned(),
        entry: "step".to_owned(),
        request_maximum: 4096,
        state_maximum: 65_536,
        response_maximum: 1024,
        response_count_maximum: 16,
        maximum_pages: 64,
        stack_bytes: 65_536,
        input_ir_sha256: DIGEST.to_owned(),
    }
}

fn source_of(package: &GeneratedPackage) -> String {
    let file = package
        .files
        .iter()
        .find(|file| file.path == "src/lib.rs")
        .expect("the package has src/lib.rs");
    String::from_utf8(file.bytes.clone()).expect("UTF-8 source")
}

fn manifest_of(package: &GeneratedPackage) -> serde_json::Value {
    let file = package
        .files
        .iter()
        .find(|file| file.path == "generation-manifest.json")
        .expect("the package has a generation manifest");
    serde_json::from_slice(&file.bytes).expect("the manifest is JSON")
}

#[test]
fn the_package_is_a_function_of_the_bounds_and_the_ir() {
    let first = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let second = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    assert_eq!(first.files, second.files);
    let paths: Vec<_> = first.files.iter().map(|file| file.path.as_str()).collect();
    assert_eq!(
        paths,
        [
            ".cargo/config.toml",
            "Cargo.lock",
            "Cargo.toml",
            "generation-manifest.json",
            "src/lib.rs"
        ]
    );
    let mut wider = spec();
    wider.state_maximum += 1;
    let third = generate_session_guest_package(&module(IR), &wider).expect("generates");
    assert_ne!(source_of(&first), source_of(&third));
}

#[test]
fn the_manifest_names_the_contract_the_schema_and_every_bound() {
    let package = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let manifest = manifest_of(&package);
    assert_eq!(manifest["schema"], TARGET_SCHEMA);
    assert_eq!(manifest["contract"], SESSION_CONTRACT);
    assert_eq!(manifest["entry"], "step");
    assert_eq!(manifest["request_maximum"], 4096);
    assert_eq!(manifest["state_maximum"], 65_536);
    assert_eq!(manifest["response_maximum"], 1024);
    assert_eq!(manifest["response_count_maximum"], 16);
    assert_eq!(manifest["maximum_pages"], 64);
    assert_eq!(manifest["stack_bytes"], 65_536);
    let records = manifest["files"].as_array().expect("files");
    assert_eq!(records.len(), 4);
    for record in records {
        let path = record["path"].as_str().expect("path");
        let file = package
            .files
            .iter()
            .find(|file| file.path == path)
            .expect("listed file exists");
        assert_eq!(record["sha256"], sha256(&file.bytes));
    }
}

#[test]
fn the_shim_exports_the_session_world_and_never_holo_run() {
    let source =
        source_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    assert!(source.contains("pub extern \"C\" fn holo_alloc(size: i32) -> i32"));
    assert!(
        source.contains("pub extern \"C\" fn holo_step(request_ptr: i32, request_len: i32) -> i64")
    );
    assert!(!source.contains("holo_run"));
    assert!(source.contains("let answer: alloc::vec::Vec<u8> = crate::step(turn);"));
    for token in [
        "@RUNTIME_MODULE@",
        "@REQUEST_MAXIMUM@",
        "@STATE_MAXIMUM@",
        "@RESPONSE_MAXIMUM@",
        "@RESPONSE_COUNT_MAXIMUM@",
        "@MAXIMUM_PAGES@",
        "@INVOKE_ENTRY@",
    ] {
        assert!(
            !source.contains(token),
            "the template token {token} is replaced"
        );
    }
}

#[test]
fn the_shim_checks_every_declared_bound_of_the_answer_and_the_request() {
    let source =
        source_of(&generate_session_guest_package(&module(IR), &spec()).expect("generates"));
    for line in [
        "const REQUEST_MAXIMUM: u32 = 4096;",
        "const STATE_MAXIMUM: u32 = 65536;",
        "const RESPONSE_MAXIMUM: u32 = 1024;",
        "const RESPONSE_COUNT_MAXIMUM: u32 = 16;",
        "const MAXIMUM_PAGES: u32 = 64;",
        "if size > REQUEST_MAXIMUM { trap(); }",
        "if next_state_len > STATE_MAXIMUM { trap(); }",
        "if count > RESPONSE_COUNT_MAXIMUM { trap(); }",
        "if length > RESPONSE_MAXIMUM { trap(); }",
        "if cursor != answer.len() { trap(); }",
        "if request_ptr != REQUEST_AT.load(Ordering::Relaxed) || request_len > REQUEST_CAPACITY.load(Ordering::Relaxed) { trap(); }",
    ] {
        assert!(source.contains(line), "the shim lacks `{line}`");
    }
}

#[test]
fn the_runtime_module_never_collides_with_a_model_name() {
    let ir = "(module SessionFixture (def __prism_session_runtime ((turn Bytes)) Bytes turn) (def step ((turn Bytes)) Bytes turn))";
    let source =
        source_of(&generate_session_guest_package(&module(ir), &spec()).expect("generates"));
    assert!(source.contains("mod __prism_session_runtime_1 {"));
}

#[test]
fn the_cargo_configuration_bounds_memory_and_the_stack() {
    let package = generate_session_guest_package(&module(IR), &spec()).expect("generates");
    let config = package
        .files
        .iter()
        .find(|file| file.path == ".cargo/config.toml")
        .expect("config");
    let config = String::from_utf8(config.bytes.clone()).expect("UTF-8");
    assert!(config.contains("link-arg=--max-memory=4194304"));
    assert!(config.contains("link-arg=-zstack-size=65536"));
    // The world has exactly three exports, so the stack bounds are linked, not exported.
    assert!(!config.contains("--export=__stack"));
}

#[test]
fn an_entry_that_is_missing_or_not_bytes_to_bytes_is_refused() {
    let mut missing = spec();
    missing.entry = "absent".to_owned();
    let error = generate_session_guest_package(&module(IR), &missing).expect_err("refused");
    assert_eq!(error.code, "PP5101");
    let typed = "(module SessionFixture (def step ((n Nat)) Nat n))";
    let error = generate_session_guest_package(&module(typed), &spec()).expect_err("refused");
    assert_eq!(error.code, "PP5101");
    assert!(error.message.contains("Bytes -> Bytes"));
}

#[test]
fn a_malformed_name_or_digest_is_refused() {
    for edit in [
        |s: &mut SessionGuestSpec| s.crate_name = "Upper".to_owned(),
        |s: &mut SessionGuestSpec| s.entry = "9step".to_owned(),
        |s: &mut SessionGuestSpec| s.input_ir_sha256 = "A".repeat(64),
        |s: &mut SessionGuestSpec| s.input_ir_sha256 = "0".repeat(63),
    ] {
        let mut bad = spec();
        edit(&mut bad);
        let error = generate_session_guest_package(&module(IR), &bad).expect_err("refused");
        assert_eq!(error.code, "PP5101");
    }
}

#[test]
fn every_bound_that_cannot_be_generated_is_refused_by_name() {
    type Edit = fn(&mut SessionGuestSpec);
    let cases: [(Edit, &str); 10] = [
        (|s| s.maximum_pages = 0, "pages"),
        (|s| s.maximum_pages = 32_768, "pages"),
        (|s| s.stack_bytes = 8, "stack"),
        (|s| s.stack_bytes = 64 * 65_536, "stack"),
        (|s| s.request_maximum = 0, "positive"),
        (|s| s.response_maximum = 0, "positive"),
        (|s| s.response_count_maximum = 0, "response count"),
        (
            |s| s.response_count_maximum = RESPONSE_COUNT_LIMIT + 1,
            "response count",
        ),
        (
            |s| {
                s.state_maximum = u32::MAX;
                s.maximum_pages = 32_767;
            },
            "32-bit",
        ),
        // Two copies of a 2 MiB state alone fill the 4 MiB the 64 pages declare.
        (|s| s.state_maximum = 2 * 1024 * 1024, "memory"),
    ];
    for (edit, word) in cases {
        let mut bad = spec();
        edit(&mut bad);
        let problem = bad.bounds_problem().expect("the bound is refused");
        assert!(problem.contains(word), "`{problem}` does not name {word}");
        let error = generate_session_guest_package(&module(IR), &bad).expect_err("refused");
        assert_eq!(error.code, "PP5101");
    }
    assert_eq!(spec().bounds_problem(), None);
}

#[test]
fn the_turn_and_answer_maxima_follow_the_frames() {
    let s = spec();
    assert_eq!(s.turn_maximum(), 4 + 65_536 + 4096);
    assert_eq!(s.answer_maximum(), 8 + 65_536 + 16 * (4 + 1024));
}

/// The runtime tests of prism-code run the real shim: the session ABI probe under
/// sdk/npm/prism-code/test/fixtures/session-probe is this template around a test
/// entry. Its committed source must be exactly what the generator renders.
#[test]
fn the_session_probe_is_the_generated_shim_around_its_test_entry() {
    let probe = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../sdk/npm/prism-code/test/fixtures/session-probe");
    let read = |path: &str| {
        std::fs::read_to_string(probe.join(path))
            .expect("the probe file is committed")
            .replace("\r\n", "\n")
    };
    let bounds = SessionGuestSpec {
        crate_name: "prism-session-probe-core-wasm".to_owned(),
        entry: "step".to_owned(),
        request_maximum: 64,
        state_maximum: 256,
        response_maximum: 256,
        response_count_maximum: 4,
        maximum_pages: 2,
        stack_bytes: 16_384,
        input_ir_sha256: DIGEST.to_owned(),
    };
    assert_eq!(bounds.bounds_problem(), None);
    let expected = format!(
        "{CRATE_HEADER}\n{}\n\n{}",
        read("entry.rs"),
        render_runtime(&bounds, "__prism_session_runtime", false)
    );
    assert_eq!(
        read("src/lib.rs"),
        expected,
        "regenerate the probe from the template"
    );
    let generated = generate_session_guest_package(&module(IR), &bounds).expect("generates");
    for path in [".cargo/config.toml", "Cargo.toml"] {
        let file = generated
            .files
            .iter()
            .find(|file| file.path == path)
            .expect("generated");
        let mine = String::from_utf8(file.bytes.clone()).expect("UTF-8");
        assert_eq!(
            read(path),
            mine,
            "{path} of the probe differs from the generator's"
        );
    }
}
