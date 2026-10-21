//! Verified Lean to LCNF to Rust export and execution chain.
//!
//! Validator probe intervals are allocation-free; separately registered public
//! package APIs may allocate their owned outputs and have consumer API checks.

use crate::config::ProjectConfig;
use crate::controller::{BuildRequest, BuildResult, Controller, VerifyRequest, VerifyResult};
use crate::error::PrismError;
use crate::holo::canonical::{content_id, decode_canonical, encode_value};
use fs4::fs_std::FileExt;
use lexlean::{Engine, Selection, VerifyRequest as LexVerifyRequest};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::fs::{File, OpenOptions};
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

const CHILD_OUTPUT_LIMIT: usize = 16_777_216;
const CHILD_TIMEOUT_SECONDS: &str = "300";
const GENERATED_NATIVE_BUILD_TIMEOUT_SECONDS: &str = "600";
const ROOTS_SOURCE: &str = include_str!("../model/runtime-roots.toml");
const STDLIB_EXPORTS_SOURCE: &str = include_str!("../model/stdlib-exports.toml");
const EXECUTION_CORPUS_SOURCE: &str = include_str!("../model/execution-corpus.toml");
const ALLOCATION_COUNTER_SOURCE: &str = include_str!("prod_alloc_counter.rs.inc");
const HOLOGRAM_ORACLE_SOURCE: &[u8] = include_bytes!("../vendor/hologram-live.tar");
const HOLOGRAM_ORACLE_SOURCE_SHA256: &str =
    "caf5c34ef2b21d58c1aa12acf81cb13ace1adaffb3c69a641f54f490ed61cf66";
const HOLOGRAM_ORACLE_CARGO: &[u8] = include_bytes!("embedded/hologram-oracle.Cargo.toml");
const HOLOGRAM_ORACLE_LOCK: &[u8] = include_bytes!("embedded/hologram-oracle.Cargo.lock");
const HOLOGRAM_ORACLE_MAIN: &[u8] = include_bytes!("embedded/hologram-oracle.main.rs");
const HOLOGRAM_ORACLE_BROWSER: &[u8] = include_bytes!("embedded/hologram-oracle.browser.mjs");
const ELAN_PROXY_SHA256: &str = "840179e70803ef373c2ec53342d6a45ea7d022533e4145489fc1278b4f716385";
const RUSTUP_PROXY_SHA256: &str =
    "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c";
const TIMEOUT_SHA256: &str = "5ef0eaaaa4220593add7716aad74da927ca3bb10605e964330de64fecc3ef15e";
// Node 22.23.2 x64 binary from the Dockerfile's checksum-verified tarball.
const NODE_SHA256: &str = "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327";

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct RuntimeRoots {
    spec: String,
    lean_module: String,
    ir_module: String,
    roots: Vec<String>,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct StdlibExports {
    spec: String,
    lean_module: String,
    ir_module: String,
    export: Vec<StdlibExport>,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(deny_unknown_fields)]
struct StdlibExport {
    lean_name: String,
    rust_name: String,
    rust_signature: String,
}

fn package_export_roots(source: &str, runtime: &RuntimeRoots) -> Result<Vec<String>, PrismError> {
    let register: StdlibExports = toml::from_str(source)
        .map_err(|error| PrismError::new("PP9001", format!("stdlib exports: {error}")))?;
    // Bind every ABI field to this SDK's embedded, source-reviewed register.
    // A syntactically valid replacement signature is not an admitted export.
    let admitted: StdlibExports = toml::from_str(STDLIB_EXPORTS_SOURCE)
        .map_err(|error| PrismError::new("PP9001", format!("embedded stdlib exports: {error}")))?;
    let names = register
        .export
        .iter()
        .map(|row| row.lean_name.clone())
        .collect::<Vec<_>>();
    let symbols = register
        .export
        .iter()
        .map(|row| row.rust_name.as_str())
        .collect::<BTreeSet<_>>();
    if register != admitted
        || register.spec != "prismpm/stdlib-exports/1"
        || register.lean_module != runtime.lean_module
        || register.ir_module != runtime.ir_module
        || names.len() != 66
        || names.windows(2).any(|pair| pair[0] >= pair[1])
        || symbols.len() != names.len()
        || [
            "publicationLinkageWireBytes",
            "publicationContextFieldsPreimage",
            "publicationWireBytes",
        ]
        .iter()
        .any(|symbol| !symbols.contains(symbol))
        || register.export.iter().any(|row| {
            let production_export = match row.rust_name.as_str() {
                "publicationLinkageWireBytes" => Some((
                    "PrismPM.Production.PublicationAdmission.LinkageV1Wire.publicationLinkageWireBytes",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                )),
                "publicationWireBytes" => Some((
                    "PrismPM.Production.PublicationAdmission.V1Wire.publicationWireBytes",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                )),
                "publicationContextFieldsPreimage" => Some((
                    "PrismPM.Production.PublicationAdmission.V1Wire.publicationContextFieldsPreimage",
                    "fn(&PublicationDeclaration, Vec<u8>, &PublicationSubject, Vec<u8>, Vec<u8>, String) -> Result<Result<Vec<u8>, CborError>, ComputeError>",
                )),
                _ => None,
            };
            production_export.map_or_else(
                || !row.lean_name.starts_with("PrismPM.Foundation."),
                |(name, signature)| row.lean_name != name || row.rust_signature != signature,
            )
                || row.lean_name.rsplit('.').next() != Some(row.rust_name.as_str())
                || row.rust_name.is_empty()
                || !row
                    .rust_name
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric())
                || !row.rust_signature.starts_with("fn(")
                || !row.rust_signature.contains(") -> ")
        })
    {
        return Err(PrismError::new(
            "PP9001",
            "stdlib package export register is not canonical",
        ));
    }
    Ok(names)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecutionCorpus {
    spec: String,
    strategy: String,
    seed: String,
    case_count: u64,
    value_domain: String,
    exhaustive: ExhaustiveCorpus,
    property: PropertyCorpus,
    control_coverage: ControlCoverageCorpus,
    oracle: Vec<ExecutionOracle>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ControlCoverageCorpus {
    case_count: u64,
    positive: u64,
    negative: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExhaustiveCorpus {
    max_length: usize,
    value_max: u64,
    all_below_bound: u64,
    case_count: u64,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PropertyCorpus {
    case_count: usize,
    max_length: usize,
    all_below_bound: u64,
    generated_value_modulus: u64,
    shrink_result: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ExecutionOracle {
    function: String,
    theorem: String,
    runtime_root: bool,
}

fn execution_corpus(roots: &RuntimeRoots) -> Result<(ExecutionCorpus, String), PrismError> {
    let corpus: ExecutionCorpus = toml::from_str(EXECUTION_CORPUS_SOURCE)
        .map_err(|error| PrismError::new("PP9001", format!("execution corpus: {error}")))?;
    let corpus_sha256 = format!("{:x}", Sha256::digest(EXECUTION_CORPUS_SOURCE.as_bytes()));
    let width = corpus
        .exhaustive
        .value_max
        .checked_add(1)
        .ok_or_else(|| PrismError::new("PP9001", "execution corpus value range overflows"))?;
    let mut list_count = 0_u64;
    let mut width_power = 1_u64;
    for length in 0..=corpus.exhaustive.max_length {
        list_count = list_count
            .checked_add(width_power)
            .ok_or_else(|| PrismError::new("PP9001", "execution corpus size overflows"))?;
        if length != corpus.exhaustive.max_length {
            width_power = width_power
                .checked_mul(width)
                .ok_or_else(|| PrismError::new("PP9001", "execution corpus size overflows"))?;
        }
    }
    let exhaustive_cases = list_count;
    let property_cases = u64::try_from(corpus.property.case_count)
        .map_err(|_| PrismError::new("PP9001", "execution property count overflows"))?;
    let expected_cases = exhaustive_cases
        .checked_add(property_cases)
        .ok_or_else(|| PrismError::new("PP9001", "execution corpus size overflows"))?;
    let functions = corpus
        .oracle
        .iter()
        .map(|oracle| oracle.function.as_str())
        .collect::<Vec<_>>();
    let runtime_functions = corpus
        .oracle
        .iter()
        .filter(|oracle| oracle.runtime_root)
        .map(|oracle| oracle.function.as_str())
        .collect::<BTreeSet<_>>();
    let roots_set = roots
        .roots
        .iter()
        .map(String::as_str)
        .collect::<BTreeSet<_>>();
    if corpus.spec != "prismpm/execution-corpus/1"
        || corpus.strategy != "exhaustive-v1+lcg-v1"
        || corpus.seed != "5eedcafef00dbeef"
        || corpus.value_domain != "u64"
        || corpus.exhaustive.max_length != 3
        || corpus.exhaustive.value_max != 3
        || corpus.exhaustive.all_below_bound != 4
        || corpus.exhaustive.case_count != exhaustive_cases
        || corpus.property.case_count != 512
        || corpus.property.max_length != 16
        || corpus.property.all_below_bound != 10
        || corpus.property.generated_value_modulus != 20
        || corpus.property.shrink_result != "not-applicable-passed"
        || corpus.case_count != expected_cases
        || corpus.control_coverage.case_count != 54
        || corpus.control_coverage.positive != 6
        || corpus.control_coverage.negative != 48
        || corpus
            .control_coverage
            .positive
            .checked_add(corpus.control_coverage.negative)
            != Some(corpus.control_coverage.case_count)
        || corpus.oracle.is_empty()
        || functions.windows(2).any(|pair| pair[0] >= pair[1])
        || runtime_functions != roots_set
        || corpus.oracle.iter().any(|oracle| {
            let allowed = |name: &str| {
                name.starts_with("PrismPM.Foundation.Holo.")
                    || name.starts_with("PrismPM.Production.ControlCoverage.")
                    || name.starts_with("PrismPM.Production.ControlCoverageCorpus.")
                    || name.starts_with("PrismPM.Production.System.")
                    || name.starts_with("PrismPM.Production.SystemValidation.")
                    || name.starts_with("PrismPM.Production.SystemValidationCorpus.")
                    || name.starts_with("PrismPM.Production.Validation.")
            };
            !allowed(&oracle.function) || !allowed(&oracle.theorem)
        })
    {
        return Err(PrismError::new(
            "PP9001",
            "execution corpus model is not canonical or internally consistent",
        ));
    }
    Ok((corpus, corpus_sha256))
}

#[derive(Debug, Serialize)]
pub(crate) struct ProcessRecord {
    pub(crate) tool: String,
    pub(crate) argv: Vec<String>,
    pub(crate) executable_sha256: String,
    pub(crate) exit_code: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exporter: Option<crate::exporter::ExporterExecution>,
}

pub(crate) fn executable(name: &str) -> Result<PathBuf, PrismError> {
    // A released SDK has a generated, signed inventory of the exact final
    // runtime filesystem for its architecture.  It is the authority for
    // executables in that environment; the constants below remain the
    // independent pins for the source-bootstrap devcontainer and native CLI.
    if crate::sdk::inventory_path().is_some() {
        return crate::sdk::executable(name);
    }
    let path =
        std::env::var_os("PATH").ok_or_else(|| PrismError::new("PP5008", "PATH is unavailable"))?;
    for directory in std::env::split_paths(&path) {
        let candidate = directory.join(name);
        if candidate.is_file() {
            let resolved = candidate.canonicalize().map_err(|error| {
                PrismError::new("PP5008", format!("{}: {error}", candidate.display()))
            })?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let mode = std::fs::metadata(&resolved)
                    .map_err(|error| {
                        PrismError::new("PP5008", format!("{}: {error}", resolved.display()))
                    })?
                    .permissions()
                    .mode();
                if mode & 0o111 == 0 {
                    return Err(PrismError::new(
                        "PP5008",
                        format!("required executable {name} is not executable"),
                    ));
                }
            }
            let expected = match name {
                "lake" | "lean" => Some(ELAN_PROXY_SHA256),
                "rustc" | "rustfmt" => Some(RUSTUP_PROXY_SHA256),
                "timeout" => Some(TIMEOUT_SHA256),
                "node" => Some(NODE_SHA256),
                _ => None,
            };
            if let Some(expected) = expected {
                let observed = format!(
                    "{:x}",
                    Sha256::digest(std::fs::read(&resolved).map_err(|error| {
                        PrismError::new("PP5008", format!("{}: {error}", resolved.display()))
                    })?)
                );
                if observed != expected {
                    return Err(PrismError::new(
                        "PP5008",
                        format!("required executable {name} has an unpinned digest"),
                    ));
                }
            }
            return Ok(candidate);
        }
    }
    Err(PrismError::new(
        "PP5008",
        format!("required executable {name} is unavailable"),
    ))
}

// Coalesce only adjacent pre-child selections. Bootstrap keeps every original
// pinned launcher check; SDK commands retain fresh selected-executable hashes.
pub(crate) fn executables<const N: usize>(names: [&str; N]) -> Result<[PathBuf; N], PrismError> {
    if crate::sdk::inventory_path().is_some() {
        return crate::sdk::executables(names);
    }
    let mut paths = std::array::from_fn(|_| PathBuf::new());
    for (name, path) in names.into_iter().zip(&mut paths) {
        *path = executable(name)?;
    }
    Ok(paths)
}

pub(crate) struct Toolchain {
    lake: PathBuf,
    rustfmt: PathBuf,
    rustc: PathBuf,
    pub(crate) records: Vec<ProcessRecord>,
}

pub(crate) fn preflight_toolchain(
    cwd: &Path,
    replacements: &[(&Path, &str)],
) -> Result<Toolchain, PrismError> {
    let sdk_environment = crate::sdk::inventory_path().is_some();
    let lean_host = match std::env::consts::ARCH {
        "x86_64" => "x86_64-unknown-linux-gnu",
        "aarch64" => "aarch64-unknown-linux-gnu",
        architecture => {
            return Err(PrismError::new(
                "PP5008",
                format!("unsupported verification architecture {architecture}"),
            ))
        }
    };
    let [lake, lean, rustfmt, rustc, timeout] =
        executables(["lake", "lean", "rustfmt", "rustc", "timeout"])?;
    let no_env = BTreeMap::new();
    let lean_version = format!(
        "Lean (version 4.32.1, {lean_host}, commit f054605aea4b840552cca2e725580bffd1e1b704, Release)\n"
    );
    let specifications = [
        (
            "lean-version",
            lean.as_path(),
            vec!["--version".to_owned()],
            lean_version.as_str(),
        ),
        (
            "lake-version",
            lake.as_path(),
            vec!["--version".to_owned()],
            "Lake version 5.0.0-src+f054605 (Lean version 4.32.1)\n",
        ),
        (
            "rustfmt-version",
            rustfmt.as_path(),
            vec!["--version".to_owned()],
            "rustfmt 1.9.0-stable (8bab26f4f6 2026-07-14)\n",
        ),
    ];
    let mut records = Vec::new();
    for (name, program, args, expected) in specifications {
        let record = run_process(name, program, &args, cwd, &no_env, replacements, "PP5008")?;
        if record.stdout != expected || !record.stderr.is_empty() {
            return Err(PrismError::new(
                "PP5008",
                format!("{name} did not report the pinned version"),
            ));
        }
        records.push(record);
    }
    let rustc_record = run_process(
        "rustc-version",
        &rustc,
        &["--version".to_owned(), "--verbose".to_owned()],
        cwd,
        &no_env,
        replacements,
        "PP5008",
    )?;
    let rustc_host = format!("host: {lean_host}");
    for exact in [
        "commit-hash: 8bab26f4f68e0e26f0bb7960be334d5b520ea452",
        rustc_host.as_str(),
        "release: 1.97.1",
    ] {
        if !rustc_record.stdout.lines().any(|line| line == exact) {
            return Err(PrismError::new(
                "PP5008",
                "rustc-version did not report the pinned version",
            ));
        }
    }
    if !rustc_record.stderr.is_empty() {
        return Err(PrismError::new(
            "PP5008",
            "rustc-version wrote unexpected diagnostics",
        ));
    }
    records.push(rustc_record);
    let timeout_record = run_process(
        "timeout-version",
        &timeout,
        &["--version".to_owned()],
        cwd,
        &no_env,
        replacements,
        "PP5008",
    )?;
    let timeout_version = if sdk_environment { "9.4" } else { "9.1" };
    if !timeout_record
        .stdout
        .starts_with(&format!("timeout (GNU coreutils) {timeout_version}\n"))
        || !timeout_record.stderr.is_empty()
    {
        return Err(PrismError::new(
            "PP5008",
            "timeout-version did not report the pinned version",
        ));
    }
    records.push(timeout_record);
    Ok(Toolchain {
        lake,
        rustfmt,
        rustc,
        records,
    })
}

fn normalized(value: &str, replacements: &[(&Path, &str)]) -> String {
    let mut out = value.to_owned();
    for (path, token) in replacements {
        out = out.replace(&path.to_string_lossy().replace('\\', "/"), token);
        out = out.replace(path.to_string_lossy().as_ref(), token);
    }
    out
}

fn stable_success_output(tool: &str, value: String) -> String {
    let had_final_newline = value.ends_with('\n');
    let mut value = value
        .lines()
        .map(|line| {
            if let Some((prefix, duration)) = line.rsplit_once(" in ") {
                if duration
                    .strip_suffix('s')
                    .is_some_and(|seconds| seconds.parse::<f64>().is_ok())
                {
                    return format!("{prefix} in <DURATION>");
                }
            }
            line.to_owned()
        })
        .collect::<Vec<_>>()
        .join("\n");
    if had_final_newline {
        value.push('\n');
    }
    if tool == "hologram-oracle-build" {
        return String::new();
    }
    if tool == "hologram-oracle" {
        return value
            .lines()
            .find(|line| line.starts_with('{'))
            .map_or_else(String::new, |line| format!("{line}\n"));
    }
    if !matches!(
        tool,
        "lake-build-generated"
            | "lean4-prod-build"
            | "prod-export"
            | "application-lean"
            | "application-exporter"
            | "application-export"
    ) {
        return value;
    }
    let mut lines = value
        .lines()
        .map(|line| {
            let mut line = line.to_owned();
            for prefix in ["✔ [", "⚠ ["] {
                if line.starts_with(prefix) {
                    if let Some((_, message)) = line.split_once("] ") {
                        line = format!("{} {message}", &prefix[..prefix.len() - 2]);
                    }
                    break;
                }
            }
            if line.contains("Built ") {
                if let Some((prefix, suffix)) = line.rsplit_once(" (") {
                    if suffix.ends_with(')') {
                        return format!("{prefix} (<DURATION>)");
                    }
                }
            }
            line
        })
        .collect::<Vec<_>>();
    lines.sort();
    if lines.is_empty() {
        String::new()
    } else {
        format!("{}\n", lines.join("\n"))
    }
}

fn hologram_oracle_environment(root: &Path) -> BTreeMap<String, String> {
    // run_process clears the ambient Cargo policy. Bound this independent
    // cold compiler explicitly; debug symbols and incremental state do not
    // participate in the unchanged upstream oracle's execution or assertions.
    BTreeMap::from([
        ("CARGO_NET_OFFLINE".to_owned(), "true".to_owned()),
        ("CARGO_BUILD_JOBS".to_owned(), "2".to_owned()),
        ("CARGO_PROFILE_DEV_DEBUG".to_owned(), "0".to_owned()),
        ("CARGO_INCREMENTAL".to_owned(), "0".to_owned()),
        (
            "CARGO_TARGET_DIR".to_owned(),
            root.join("target/hologram-oracle")
                .to_string_lossy()
                .into_owned(),
        ),
    ])
}

static HOLOGRAM_ORACLE_MUTEX: std::sync::Mutex<()> = std::sync::Mutex::new(());
const HOLOGRAM_ORACLE_BUILD_TIMEOUT_SECONDS: &str = "900";
const HOLOGRAM_ORACLE_RUN_TIMEOUT_SECONDS: &str = "600";

fn run_hologram_oracle(
    controller: &Controller,
    build_root: &Path,
    holo_path: &Path,
    model_path: &Path,
    wasm_path: &Path,
) -> Result<[ProcessRecord; 3], PrismError> {
    let _lock = HOLOGRAM_ORACLE_MUTEX
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let document: crate::holo::model_document::ModelDocument = serde_json::from_slice(
        &std::fs::read(model_path).map_err(|error| PrismError::new("PP5301", error.to_string()))?,
    )
    .map_err(|error| PrismError::new("PP5301", error.to_string()))?;
    let application = document
        .application
        .as_ref()
        .ok_or_else(|| PrismError::new("PP5301", "oracle has no application"))?;
    validate_portable_target_bounds(
        application.request_maximum(),
        application.response_maximum(),
    )?;
    crate::holo::browser_application::require_runtime(application)?;
    if format!("{:x}", Sha256::digest(HOLOGRAM_ORACLE_SOURCE)) != HOLOGRAM_ORACLE_SOURCE_SHA256 {
        return Err(PrismError::new(
            "PP5301",
            "pinned Hologram Live oracle source checksum changed",
        ));
    }
    let work = tempfile::Builder::new()
        .prefix("prismpm-hologram-oracle-")
        .tempdir()
        .map_err(|error| PrismError::new("PP5301", format!("Hologram oracle: {error}")))?;
    let upstream = work.path().join("hologram-live");
    let harness = work.path().join("harness");
    std::fs::create_dir(&upstream)
        .and_then(|()| std::fs::create_dir(&harness))
        .map_err(|error| PrismError::new("PP5301", format!("Hologram oracle: {error}")))?;
    tar::Archive::new(std::io::Cursor::new(HOLOGRAM_ORACLE_SOURCE))
        .unpack(&upstream)
        .map_err(|error| PrismError::new("PP5301", format!("Hologram oracle source: {error}")))?;
    write(&harness.join("Cargo.toml"), HOLOGRAM_ORACLE_CARGO)?;
    write(&harness.join("Cargo.lock"), HOLOGRAM_ORACLE_LOCK)?;
    write(&harness.join("src/main.rs"), HOLOGRAM_ORACLE_MAIN)?;
    write(&harness.join("browser.mjs"), HOLOGRAM_ORACLE_BROWSER)?;

    let [cargo, node] = executables(["cargo", "node"])?;
    let node = node
        .canonicalize()
        .map_err(|error| PrismError::new("PP5301", format!("browser Node executable: {error}")))?;
    let browser = crate::browser_oracle::verified_browser()?;
    let replacements = [
        (controller.root.as_path(), "$PROJECT"),
        (build_root, "$BUILD"),
        (work.path(), "$ORACLE_WORK"),
    ];
    let env = hologram_oracle_environment(&controller.root);
    let node_version = run_process(
        "hologram-browser-node-version",
        &node,
        &["--version".to_owned()],
        &harness,
        &env,
        &replacements,
        "PP5301",
    )?;
    if node_version.stdout != "v22.23.2\n" || !node_version.stderr.is_empty() {
        return Err(PrismError::new(
            "PP5301",
            "portable browser requires pinned Node v22.23.2",
        ));
    }
    let build = run_process_limited(
        "hologram-oracle-build",
        &cargo,
        &[
            "build".to_owned(),
            "--manifest-path".to_owned(),
            harness.join("Cargo.toml").to_string_lossy().into_owned(),
            "--locked".to_owned(),
            "--offline".to_owned(),
        ],
        &harness,
        &env,
        &replacements,
        "PP5301",
        HOLOGRAM_ORACLE_BUILD_TIMEOUT_SECONDS,
        CHILD_OUTPUT_LIMIT,
    )?;
    let run = run_process_limited(
        "hologram-oracle",
        &cargo,
        &[
            "run".to_owned(),
            "--manifest-path".to_owned(),
            harness.join("Cargo.toml").to_string_lossy().into_owned(),
            "--locked".to_owned(),
            "--offline".to_owned(),
            "--".to_owned(),
            holo_path.to_string_lossy().into_owned(),
            model_path.to_string_lossy().into_owned(),
            wasm_path.to_string_lossy().into_owned(),
            harness.join("browser.mjs").to_string_lossy().into_owned(),
            node.to_string_lossy().into_owned(),
            browser.to_string_lossy().into_owned(),
        ],
        &harness,
        &env,
        &replacements,
        "PP5301",
        HOLOGRAM_ORACLE_RUN_TIMEOUT_SECONDS,
        CHILD_OUTPUT_LIMIT,
    )?;
    let report: Value = serde_json::from_str(run.stdout.trim())
        .map_err(|error| PrismError::new("PP5301", format!("Hologram oracle report: {error}")))?;
    let identities: Value = serde_json::from_slice(
        &std::fs::read(build_root.join("application/holo-identities.json"))
            .map_err(|error| PrismError::new("PP5301", error.to_string()))?,
    )
    .map_err(|error| PrismError::new("PP5301", error.to_string()))?;
    validate_hologram_oracle_report(&report, application, &identities)?;
    Ok([node_version, build, run])
}

// These are the pinned hologram-view-surface transport limits, not a new model
// range. The embedded harness asserts equality against the upstream constants
// and rechecks them before invoking any guest or allocating boundary probes.
fn validate_portable_target_bounds(
    request_maximum: u32,
    response_maximum: u32,
) -> Result<(), PrismError> {
    if request_maximum > 64 * 1024 || response_maximum > 1024 * 1024 {
        return Err(PrismError::new("PP5301", "application bounds exceed pinned portable View transport limits (request: 65536 bytes; response: 1048576 bytes)"));
    }
    Ok(())
}

pub(crate) fn validate_hologram_oracle_report(
    report: &Value,
    application: &crate::holo::model_document::Application,
    identities: &Value,
) -> Result<(), PrismError> {
    use crate::holo::model_document::Application;
    validate_portable_target_bounds(
        application.request_maximum(),
        application.response_maximum(),
    )?;
    let invalid = || {
        PrismError::new(
            "PP5301",
            "pinned Hologram oracle did not return complete portable browser acceptance",
        )
    };
    let keys = [
        "application_kappa",
        "archive_fingerprint",
        "archive_kappa",
        "direct_vectors",
        "footer_verified",
        "guest_allocation_boundary",
        "intent_vectors",
        "portable_browser",
        "resident_vectors",
        "schema",
        "view_attached",
        "view_detached",
    ];
    if report
        .as_object()
        .is_none_or(|object| object.keys().map(String::as_str).ne(keys))
    {
        return Err(invalid());
    }
    for (field, prefix) in [
        ("application_kappa", "blake3:"),
        ("archive_kappa", "blake3:"),
        ("archive_fingerprint", ""),
    ] {
        if report[field] != identities[field] {
            return Err(invalid());
        }
        let digest = report[field]
            .as_str()
            .and_then(|value| value.strip_prefix(prefix))
            .ok_or_else(invalid)?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        {
            return Err(invalid());
        }
    }
    let vectors = application.acceptance_vectors();
    let intents = vectors
        .iter()
        .filter(|vector| {
            std::str::from_utf8(&vector.request).is_ok()
                && std::str::from_utf8(&vector.response).is_ok()
        })
        .count();
    if report["schema"] != "prismpm/hologram-oracle/2"
        || report["footer_verified"] != true
        || report["guest_allocation_boundary"] != "verified"
        || report["view_attached"] != 1
        || report["view_detached"] != 1
        || report["direct_vectors"] != vectors.len()
        || report["resident_vectors"] != vectors.len()
        || report["intent_vectors"] != intents
    {
        return Err(invalid());
    }
    let mut indexes = Vec::new();
    for (index, vector) in vectors.iter().enumerate() {
        let Ok(request) = std::str::from_utf8(&vector.request) else {
            continue;
        };
        let applicable = match application {
            Application::Browser(_) => {
                return crate::holo::browser_application::require_runtime(application)
            }
            Application::Text(value) => vector.request.len() <= value.request_maximum as usize,
            Application::Legacy(value) => {
                let fields = request.split('\t').collect::<Vec<_>>();
                fields.len() == 4
                    && fields[0] == "1"
                    && value
                        .view
                        .operations
                        .iter()
                        .any(|operation| operation.request_name == fields[1])
                    && fields[2..].iter().all(|field| {
                        field
                            .parse::<i64>()
                            .is_ok_and(|value| value.to_string() == *field)
                    })
            }
        };
        if applicable {
            indexes.push(index);
        }
    }
    if indexes.is_empty() {
        return Err(invalid());
    }
    let mut names = vec![
        "attachment-assets",
        "modeled-vectors",
        "input-validation-recovery",
        "transport-failure-recovery",
        "pre-init-privacy",
        "delayed-init",
        "intent-boundaries",
    ];
    let profile = match application {
        Application::Browser(_) => {
            return crate::holo::browser_application::require_runtime(application)
        }
        Application::Text(_) => {
            names.extend(["text-response-bounds", "text-safe-rendering"]);
            "utf8-text"
        }
        Application::Legacy(_) => "legacy-numeric",
    };
    names.push("detached-session");
    let cases = names
        .into_iter()
        .map(|name| json!({"name":name,"status":"passed","attempts":1}))
        .collect::<Vec<_>>();
    let expected = json!({"schema":"prismpm/portable-browser-oracle/1", "profile":profile,
        "engine":"chromium", "browser_version":"157.0.8099.0", "playwright":"1.62.1",
        "cases":cases, "vector_indexes":indexes, "skipped":0, "retries":0, "status":"passed"});
    if report["portable_browser"] != expected {
        return Err(invalid());
    }
    Ok(())
}

#[cfg(test)]
mod portable_oracle_tests {
    use super::*;

    #[test]
    fn browser_oracle_cannot_verify_without_execution_or_runtime() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let mut document: crate::holo::model_document::ModelDocument = serde_json::from_slice(
            &std::fs::read(root.join("tests/golden/stdlib/build/model.prism.json")).unwrap(),
        )
        .unwrap();
        let declaration =
            std::fs::read(root.join("tests/data/browser-application-declaration.json")).unwrap();
        let work = tempfile::tempdir().unwrap();
        let controller = Controller::load(work.path()).unwrap();
        let model_path = work.path().join("model.prism.json");
        for label in [
            "Ready",
            "Runtime unavailable",
            "Verified production service",
        ] {
            let mut browser: crate::holo::browser_application::BrowserApplication =
                serde_json::from_slice(&declaration).unwrap();
            browser.view.labels[0].text = label.to_owned();
            crate::holo::browser_application::validate(&browser).unwrap();
            document.application = Some(crate::holo::model_document::Application::Browser(
                Box::new(browser),
            ));
            std::fs::write(&model_path, serde_json::to_vec(&document).unwrap()).unwrap();
            let result = run_hologram_oracle(
                &controller,
                work.path(),
                &work.path().join("not-produced.holo"),
                &model_path,
                &work.path().join("not-produced.wasm"),
            );
            assert_eq!(
                result
                    .expect_err("an unexecuted browser oracle cannot return verified processes")
                    .code,
                "PP2011",
                "display text cannot authorize runtime or oracle acceptance: {label}"
            );
        }
    }

    #[test]
    fn oracle_compile_policy_survives_environment_isolation() {
        const CHILD: &str = "PRISMPM_ORACLE_BUILD_POLICY_TEST";
        let hostile = BTreeMap::from([
            ("CARGO_BUILD_JOBS", "999"),
            ("CARGO_PROFILE_DEV_DEBUG", "2"),
            ("CARGO_INCREMENTAL", "1"),
            ("CARGO_NET_OFFLINE", "false"),
            ("CARGO_TARGET_DIR", "/nonexistent/ambient-oracle-target"),
        ]);
        if std::env::var_os(CHILD).is_some() {
            for (key, value) in &hostile {
                assert_eq!(std::env::var(key).unwrap(), *value);
            }
            assert_eq!(CHILD_TIMEOUT_SECONDS, "300");
            let root = tempfile::tempdir().unwrap();
            let policy = hologram_oracle_environment(root.path());
            let expected = json!({
                "CARGO_BUILD_JOBS": "2",
                "CARGO_PROFILE_DEV_DEBUG": "0",
                "CARGO_INCREMENTAL": "0",
                "CARGO_NET_OFFLINE": "true",
                "CARGO_TARGET_DIR": root.path().join("target/hologram-oracle"),
            });
            assert_eq!(serde_json::to_value(&policy).unwrap(), expected);
            let script = "const keys=['CARGO_BUILD_JOBS','CARGO_PROFILE_DEV_DEBUG','CARGO_INCREMENTAL','CARGO_NET_OFFLINE','CARGO_TARGET_DIR'];process.stdout.write(JSON.stringify(Object.fromEntries(keys.map(key=>[key,process.env[key]]))));";
            let observed = run_process(
                "oracle-compile-policy-observer",
                &executable("node").unwrap(),
                &["-e".to_owned(), script.to_owned()],
                root.path(),
                &policy,
                &[],
                "PP5301",
            )
            .unwrap();
            assert_eq!(
                serde_json::from_str::<Value>(&observed.stdout).unwrap(),
                expected
            );
            assert!(observed.stderr.is_empty());
            return;
        }
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "verification::portable_oracle_tests::oracle_compile_policy_survives_environment_isolation",
                "--nocapture",
            ])
            .envs(hostile)
            .env(CHILD, "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains("running 1 test\n"), "{stdout}");
        assert_eq!(
            stdout.matches("test verification::portable_oracle_tests::oracle_compile_policy_survives_environment_isolation ... ok").count(),
            1,
            "{stdout}"
        );
        assert!(
            stdout.contains("test result: ok. 1 passed; 0 failed; 0 ignored; 0 measured;"),
            "{stdout}"
        );
    }

    #[cfg(unix)]
    #[test]
    fn shadowed_node_cannot_reach_browser_harness() {
        use std::os::unix::fs::PermissionsExt;
        if std::env::var_os("PRISMPM_NODE_SHADOW_TEST").is_some() {
            let error = executable("node").unwrap_err();
            assert!(error.code == "PP5008" || error.code == "PP5401");
            return;
        }
        let shadow = tempfile::tempdir().unwrap();
        let node = shadow.path().join("node");
        std::fs::write(&node, b"#!/bin/sh\nexit 0\n").unwrap();
        std::fs::set_permissions(&node, std::fs::Permissions::from_mode(0o755)).unwrap();
        let path = std::env::var_os("PATH").unwrap();
        let selected = std::env::join_paths(
            std::iter::once(shadow.path().to_owned()).chain(std::env::split_paths(&path)),
        )
        .unwrap();
        let output = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "verification::portable_oracle_tests::shadowed_node_cannot_reach_browser_harness",
                "--nocapture",
            ])
            .env("PATH", selected)
            .env("PRISMPM_NODE_SHADOW_TEST", "1")
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
    }

    #[test]
    fn portable_transport_bounds_fail_before_any_boundary_allocation() {
        assert!(validate_portable_target_bounds(64 * 1024, 1024 * 1024).is_ok());
        for (request, response) in [
            (65537, 1048576),
            (65536, 1048577),
            (u32::MAX, 1),
            (1, u32::MAX),
        ] {
            let error = validate_portable_target_bounds(request, response).unwrap_err();
            assert_eq!(error.code, "PP5301");
            assert!(error.message.contains("transport limits"));
        }
    }
}

fn pipe<R: Read>(mut reader: R, limit: usize) -> std::io::Result<Vec<u8>> {
    let mut saved = Vec::new();
    let mut buffer = [0_u8; 8192];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        if saved.len() <= limit {
            let remaining = limit.saturating_add(1).saturating_sub(saved.len());
            saved.extend_from_slice(&buffer[..count.min(remaining)]);
        }
    }
    Ok(saved)
}

// Keep both ends of a failed child's progress without enlarging the process
// output allowance, retaining decoded source graphs, or changing its deadline.
fn failure_excerpt(output: &str) -> String {
    const END_BYTES: usize = 2048;
    if output.len() <= 2 * END_BYTES {
        return output.to_owned();
    }
    let mut prefix = END_BYTES;
    while !output.is_char_boundary(prefix) {
        prefix -= 1;
    }
    let mut suffix = output.len() - END_BYTES;
    while !output.is_char_boundary(suffix) {
        suffix += 1;
    }
    format!(
        "{}\n[{} bytes omitted]\n{}",
        &output[..prefix],
        suffix - prefix,
        &output[suffix..]
    )
}

#[derive(Clone, Copy)]
pub(crate) enum NativeCompilation {
    Library,
    Application,
}

pub(crate) fn run_native_compilation(
    phase: NativeCompilation,
    program: &Path,
    args: &[String],
    cwd: &Path,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
) -> Result<ProcessRecord, PrismError> {
    let tool = match phase {
        NativeCompilation::Library => "lake-build-generated",
        NativeCompilation::Application => "application-lean",
    };
    run_process_limited(
        tool,
        program,
        args,
        cwd,
        &BTreeMap::new(),
        replacements,
        failure_code,
        GENERATED_NATIVE_BUILD_TIMEOUT_SECONDS,
        CHILD_OUTPUT_LIMIT,
    )
}

pub(crate) fn run_process(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    extra_env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
) -> Result<ProcessRecord, PrismError> {
    run_process_limited(
        tool,
        program,
        args,
        cwd,
        extra_env,
        replacements,
        failure_code,
        CHILD_TIMEOUT_SECONDS,
        CHILD_OUTPUT_LIMIT,
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_process_limited(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    extra_env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
    timeout_seconds: &str,
    output_limit: usize,
) -> Result<ProcessRecord, PrismError> {
    run_process_limited_allowed(
        tool,
        program,
        args,
        cwd,
        extra_env,
        replacements,
        failure_code,
        timeout_seconds,
        output_limit,
        &[0],
    )
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_process_limited_allowed(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    extra_env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
    timeout_seconds: &str,
    output_limit: usize,
    allowed_exit_codes: &[i32],
) -> Result<ProcessRecord, PrismError> {
    if allowed_exit_codes.is_empty()
        || allowed_exit_codes
            .iter()
            .any(|code| !(0..=125).contains(code))
    {
        return Err(PrismError::new(
            "PP9001",
            "allowed process exit-code set is empty or malformed",
        ));
    }
    let timeout = executable("timeout")?;
    let program_bytes =
        std::fs::read(program).or_else(|_| program.canonicalize().and_then(std::fs::read));
    let executable_sha256 = format!(
        "{:x}",
        Sha256::digest(program_bytes.map_err(|error| {
            PrismError::new("PP5008", format!("{}: {error}", program.display()))
        })?)
    );
    let mut command = Command::new(timeout);
    command
        .arg("--signal=TERM")
        .arg("--kill-after=5")
        .arg(timeout_seconds)
        .arg(program)
        .args(args)
        .current_dir(cwd)
        .env_clear()
        .env("LC_ALL", "C")
        .env("LANG", "C")
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    for key in [
        "PATH",
        "ELAN_HOME",
        "ELAN_TOOLCHAIN",
        "RUSTUP_HOME",
        "RUSTUP_TOOLCHAIN",
        "CARGO_HOME",
        "HOME",
        "XDG_CACHE_HOME",
    ] {
        if let Some(value) = std::env::var_os(key) {
            command.env(key, value);
        }
    }
    for (key, value) in extra_env {
        command.env(key, value);
    }
    // This bounds Lake's runtime pool, not Lean CLI children: those require
    // the traced -j2 argument in lean_project's generated configuration.
    // No build, export, kernel check or deadline is removed or extended.
    command.env("LEAN_NUM_THREADS", "2");
    let mut child = command
        .spawn()
        .map_err(|error| PrismError::new("PP5008", format!("start {tool}: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| PrismError::new("PP9001", "child stdout pipe is missing"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| PrismError::new("PP9001", "child stderr pipe is missing"))?;
    let stdout_thread = std::thread::spawn(move || pipe(stdout, output_limit));
    let stderr_thread = std::thread::spawn(move || pipe(stderr, output_limit));
    let status = child
        .wait()
        .map_err(|error| PrismError::new(failure_code, format!("wait for {tool}: {error}")))?;
    let stdout = stdout_thread
        .join()
        .map_err(|_| PrismError::new("PP9001", "stdout reader terminated"))?
        .map_err(|error| PrismError::new(failure_code, format!("read stdout: {error}")))?;
    let stderr = stderr_thread
        .join()
        .map_err(|_| PrismError::new("PP9001", "stderr reader terminated"))?
        .map_err(|error| PrismError::new(failure_code, format!("read stderr: {error}")))?;
    if stdout.len() > output_limit || stderr.len() > output_limit {
        return Err(PrismError::new(
            "PP5007",
            format!("{tool} output limit exceeded"),
        ));
    }
    let exit_code = status.code().unwrap_or(128);
    let stdout = normalized(&String::from_utf8_lossy(&stdout), replacements);
    let stderr = normalized(&String::from_utf8_lossy(&stderr), replacements);
    if matches!(exit_code, 124 | 137) {
        let mut error = PrismError::new("PP5007", format!("{tool} timed out"));
        // The observed wrapper exit is evidence, not a claim that exit 137
        // identifies a timeout rather than an external resource kill.
        for message in [
            format!("observed process exit code: {exit_code}"),
            format!("stdout: {}", failure_excerpt(&stdout)),
            format!("stderr: {}", failure_excerpt(&stderr)),
            format!(
                "normalized child streams: stdout_bytes={}, stdout_sha256={:x}; stderr_bytes={}, stderr_sha256={:x}",
                stdout.len(),
                Sha256::digest(stdout.as_bytes()),
                stderr.len(),
                Sha256::digest(stderr.as_bytes())
            ),
        ] {
            error.notes.push(crate::error::PrismNote {
                message,
                span: None,
            });
        }
        return Err(error);
    }
    if !allowed_exit_codes.contains(&exit_code) {
        return Err(PrismError::new(
            failure_code,
            format!("{tool} exited {exit_code}: stdout={stdout:?}; stderr={stderr:?}"),
        ));
    }
    let stdout = stable_success_output(tool, stdout);
    let stderr = stable_success_output(tool, stderr);
    Ok(ProcessRecord {
        tool: tool.to_owned(),
        argv: args
            .iter()
            .map(|arg| normalized(arg, replacements))
            .collect(),
        executable_sha256,
        exit_code,
        stdout,
        stderr,
        exporter: None,
    })
}

fn write(path: &Path, bytes: &[u8]) -> Result<(), PrismError> {
    let parent = path
        .parent()
        .ok_or_else(|| PrismError::new("PP4002", "staged file has no parent"))?;
    std::fs::create_dir_all(parent)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", parent.display())))?;
    let mut file = File::create(path)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))?;
    file.write_all(bytes)
        .and_then(|()| file.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))
}

fn hash_file(path: &Path) -> Result<String, PrismError> {
    Ok(format!(
        "{:x}",
        Sha256::digest(std::fs::read(path).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", path.display()))
        })?)
    ))
}

fn harness(
    model: &crate::holo::model_document::ModelDocument,
    corpus: &ExecutionCorpus,
    corpus_sha256: &str,
) -> String {
    let indexes = model
        .architecture
        .components
        .iter()
        .map(|row| row.index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let endpoints = model
        .architecture
        .edges
        .iter()
        .flat_map(|row| [row.from_index, row.to_index])
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let risk_asset_links = model
        .security
        .risks
        .iter()
        .map(|row| row.asset_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let risk_threat_links = model
        .security
        .risks
        .iter()
        .map(|row| row.threat_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let control_links = model
        .security
        .controls
        .iter()
        .map(|row| row.risk_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let viewpoint_stakeholder_links = model
        .architecture
        .viewpoints
        .iter()
        .map(|row| row.stakeholder_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let viewpoint_concern_links = model
        .architecture
        .viewpoints
        .iter()
        .map(|row| row.concern_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let viewpoint_model_kind_links = model
        .architecture
        .viewpoints
        .iter()
        .map(|row| row.model_kind_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let quality_characteristic_links = model
        .quality
        .subcharacteristics
        .iter()
        .map(|row| row.characteristic_index)
        .map(|value| value.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let quality_subcharacteristic_links = model
        .quality
        .requirements
        .iter()
        .map(|row| row.subcharacteristic_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    let quality_requirement_links = model
        .quality
        .measures
        .iter()
        .map(|row| row.requirement_index.to_string())
        .collect::<Vec<_>>()
        .join(",");
    format!(
        r#"#![allow(dead_code, non_snake_case)]
extern crate alloc;
use prod_alloc_counter::{{activity, CountingAllocator}};
use std::sync::atomic::{{AtomicUsize, Ordering}};

#[global_allocator]
static GLOBAL: CountingAllocator = CountingAllocator;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputeError {{ AddOverflow, MulOverflow, ShiftExponentTooLarge, ShiftOverflow, PowExponentTooLarge, PowOverflow, OutputTooSmall }}
include!("generated.rs");

static BEFORE: AtomicUsize = AtomicUsize::new(0);
fn begin() {{ BEFORE.store(activity(), Ordering::SeqCst); }}
fn end() -> bool {{ activity() == BEFORE.load(Ordering::SeqCst) }}
fn fail(code: i32) -> ! {{ std::process::exit(code) }}
trait ProbeBool {{ fn is(self, expected: bool) -> bool; }}
impl ProbeBool for bool {{ fn is(self, expected: bool) -> bool {{ self == expected }} }}
impl ProbeBool for Result<bool, ComputeError> {{ fn is(self, expected: bool) -> bool {{ self == Ok(expected) }} }}
fn main() {{
    let component_indexes: &[u64] = &[{indexes}];
    let endpoints: &[u64] = &[{endpoints}];
    let risk_asset_links: &[u64] = &[{risk_asset_links}];
    let risk_threat_links: &[u64] = &[{risk_threat_links}];
    let control_links: &[u64] = &[{control_links}];
    let viewpoint_stakeholder_links: &[u64] = &[{viewpoint_stakeholder_links}];
    let viewpoint_concern_links: &[u64] = &[{viewpoint_concern_links}];
    let viewpoint_model_kind_links: &[u64] = &[{viewpoint_model_kind_links}];
    let quality_characteristic_links: &[u64] = &[{quality_characteristic_links}];
    let quality_subcharacteristic_links: &[u64] = &[{quality_subcharacteristic_links}];
    let quality_requirement_links: &[u64] = &[{quality_requirement_links}];
    begin(); let a = validateComponentIndexes(component_indexes); if !end() || a != Ok(true) {{ fail(10); }}
    begin(); let b = validateEdgeEndpoints({component_count}, endpoints); if !end() || !b {{ fail(11); }}
    begin(); let c1 = validateRiskLinks({asset_count}, risk_asset_links); if !end() || !c1 {{ fail(12); }}
    begin(); let c2 = validateRiskLinks({threat_count}, risk_threat_links); if !end() || !c2 {{ fail(12); }}
    begin(); let d = validateControlLinks({risk_count}, control_links); if !end() || !d {{ fail(13); }}
    begin(); let e1 = validateViewpointLinks({stakeholder_count}, viewpoint_stakeholder_links); if !end() || !e1 {{ fail(14); }}
    begin(); let e2 = validateViewpointLinks({concern_count}, viewpoint_concern_links); if !end() || !e2 {{ fail(14); }}
    begin(); let e3 = validateViewpointLinks({model_kind_count}, viewpoint_model_kind_links); if !end() || !e3 {{ fail(14); }}
    begin(); let f1 = validateQualityLinks({characteristic_count}, quality_characteristic_links); if !end() || !f1 {{ fail(15); }}
    begin(); let f2 = validateQualityLinks({subcharacteristic_count}, quality_subcharacteristic_links); if !end() || !f2 {{ fail(15); }}
    begin(); let f3 = validateQualityLinks({requirement_count}, quality_requirement_links); if !end() || !f3 {{ fail(15); }}
    begin(); let g = validateFlattenedBounds({component_count}, component_indexes); if !end() || !g {{ fail(16); }}
    let profile = StandardsProfile {{ architectureEdition: 2022, applicationSecurityEdition: 2011, controlEdition: 2017, riskEdition: 2022, qualityEdition: 2023 }};
    begin(); let p = validateExactStandardsProfile(profile); if !end() || !p {{ fail(17); }}
    let corpus_model = corpusValidModel();
    let corpus_manifest = corpusManifest();
    let coverage_policy = coverageValidPolicy();
    let coverage_submission = coverageValidSubmission();
    begin(); let value = validateControlCoverage(&coverage_policy, &coverage_submission); if !end() || !value.is(true) {{ fail(103); }}
    if !coverageCorpusPassed().is(true) {{ fail(104); }}
    begin(); let value = validateManifest(&corpus_model, &corpus_manifest); if !end() {{ fail(102); }} if !value.is(true) {{ fail(41); }}
    begin(); let value = validateModelClosure(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(42); }}
    begin(); let value = validateModelUniqueness(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(79); }}
    begin(); let value = validateModelReferentialIntegrity(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(80); }}
    begin(); let value = validateModelCompatibility(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(81); }}
    begin(); let value = validateModelCapabilitySatisfaction(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(82); }}
    begin(); let value = validateModelSecretFlow(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(83); }}
    begin(); let value = validateModelDeploymentOrder(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(84); }}
    begin(); let value = validateModelMigrationOrder(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(85); }}
    begin(); let value = validateModelRollbackSafety(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(86); }}
    begin(); let value = validateModelEvidenceClosure(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(87); }}
    begin(); let value = validateModelLicenseClosure(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(88); }}
    begin(); let value = validateModelReleaseCompleteness(&corpus_model, &corpus_manifest); if !end() || !value.is(true) {{ fail(89); }}
    {{ let invalid = corpusInvalidClosureModel(); begin(); let value = validateModelClosure(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(90); }} }}
    {{ let invalid = corpusInvalidUniquenessModel(); begin(); let value = validateModelUniqueness(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(91); }} }}
    {{ let invalid = corpusInvalidReferentialIntegrityModel(); begin(); let value = validateModelReferentialIntegrity(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(92); }} }}
    {{ let invalid = corpusInvalidCompatibilityModel(); begin(); let value = validateModelCompatibility(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(93); }} }}
    {{ let invalid = corpusInvalidCapabilitySatisfactionModel(); begin(); let value = validateModelCapabilitySatisfaction(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(94); }} }}
    {{ let invalid = corpusInvalidSecretFlowModel(); begin(); let value = validateModelSecretFlow(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(95); }} }}
    {{ let invalid = corpusInvalidDeploymentOrderModel(); begin(); let value = validateModelDeploymentOrder(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(96); }} }}
    {{ let invalid = corpusInvalidMigrationOrderModel(); begin(); let value = validateModelMigrationOrder(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(97); }} }}
    {{ let invalid = corpusInvalidRollbackSafetyModel(); begin(); let value = validateModelRollbackSafety(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(98); }} }}
    {{ let invalid = corpusInvalidEvidenceClosureModel(); begin(); let value = validateModelEvidenceClosure(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(99); }} }}
    {{ let invalid = corpusInvalidLicenseClosureModel(); begin(); let value = validateModelLicenseClosure(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(100); }} }}
    {{ let invalid = corpusInvalidReleaseCompletenessModel(); begin(); let value = validateModelReleaseCompleteness(&invalid, &corpus_manifest); if !end() || !value.is(false) {{ fail(101); }} }}
    let valid_relation: &[u64] = &[0, 1, 2];
    let empty_relation: &[u64] = &[];
    let invalid_bounds: &[u64] = &[0, 3];
    let invalid_order: &[u64] = &[0, 2];
    begin(); let value = validateClosure(3, valid_relation); if !end() || !value {{ fail(43); }}
    begin(); let value = validateClosure(3, invalid_bounds); if !end() || value {{ fail(44); }}
    begin(); let value = validateUniqueness(valid_relation); if !end() || value != Ok(true) {{ fail(45); }}
    begin(); let value = validateUniqueness(invalid_order); if !end() || value != Ok(false) {{ fail(46); }}
    begin(); let value = validateReferentialIntegrity(3, valid_relation); if !end() || !value {{ fail(47); }}
    begin(); let value = validateReferentialIntegrity(3, invalid_bounds); if !end() || value {{ fail(48); }}
    begin(); let value = validateCompatibility(3, valid_relation); if !end() || !value {{ fail(49); }}
    begin(); let value = validateCompatibility(3, invalid_bounds); if !end() || value {{ fail(50); }}
    begin(); let value = validateCapabilitySatisfaction(3, valid_relation); if !end() || !value {{ fail(51); }}
    begin(); let value = validateCapabilitySatisfaction(3, invalid_bounds); if !end() || value {{ fail(52); }}
    begin(); let value = validateSecretFlow(3, valid_relation); if !end() || !value {{ fail(53); }}
    begin(); let value = validateSecretFlow(3, invalid_bounds); if !end() || value {{ fail(54); }}
    begin(); let value = validateDeploymentOrder(valid_relation); if !end() || value != Ok(true) {{ fail(55); }}
    begin(); let value = validateDeploymentOrder(invalid_order); if !end() || value != Ok(false) {{ fail(56); }}
    begin(); let value = validateMigrationOrder(valid_relation); if !end() || value != Ok(true) {{ fail(57); }}
    begin(); let value = validateMigrationOrder(invalid_order); if !end() || value != Ok(false) {{ fail(58); }}
    begin(); let value = validateRollbackSafety(3, valid_relation); if !end() || !value {{ fail(59); }}
    begin(); let value = validateRollbackSafety(3, invalid_bounds); if !end() || value {{ fail(60); }}
    begin(); let value = validateEvidenceClosure(3, valid_relation); if !end() || !value {{ fail(61); }}
    begin(); let value = validateEvidenceClosure(3, invalid_bounds); if !end() || value {{ fail(62); }}
    begin(); let value = validateReleaseCompleteness(valid_relation); if !end() || value != Ok(true) {{ fail(63); }}
    begin(); let value = validateReleaseCompleteness(invalid_order); if !end() || value != Ok(false) {{ fail(64); }}
    begin(); let value = validateClosure(1, empty_relation); if !end() || value {{ fail(65); }}
    begin(); let value = validateUniqueness(empty_relation); if !end() || value != Ok(false) {{ fail(66); }}
    begin(); let value = validateReferentialIntegrity(1, empty_relation); if !end() || value {{ fail(67); }}
    begin(); let value = validateCompatibility(1, empty_relation); if !end() || value {{ fail(68); }}
    begin(); let value = validateCapabilitySatisfaction(1, empty_relation); if !end() || value {{ fail(69); }}
    begin(); let value = validateSecretFlow(1, empty_relation); if !end() || value {{ fail(70); }}
    begin(); let value = validateDeploymentOrder(empty_relation); if !end() || value != Ok(false) {{ fail(71); }}
    begin(); let value = validateMigrationOrder(empty_relation); if !end() || value != Ok(false) {{ fail(72); }}
    begin(); let value = validateRollbackSafety(1, empty_relation); if !end() || value {{ fail(73); }}
    begin(); let value = validateEvidenceClosure(1, empty_relation); if !end() || value {{ fail(74); }}
    begin(); let value = validateReleaseCompleteness(empty_relation); if !end() || value != Ok(false) {{ fail(75); }}
    let positive_relation: &[u64] = &[1, 2, 3];
    let zero_relation: &[u64] = &[1, 0, 3];
    begin(); let value = validateLicenseClosure(positive_relation); if !end() || !value {{ fail(76); }}
    begin(); let value = validateLicenseClosure(empty_relation); if !end() || value {{ fail(77); }}
    begin(); let value = validateLicenseClosure(zero_relation); if !end() || value {{ fail(78); }}
    begin(); let bad = validateEdgeEndpoints({component_count}, &[{component_count}]); if !end() || bad {{ fail(18); }}
    begin(); let overflow = allConsecutive(u64::MAX, &[u64::MAX]); if !end() || overflow != Err(ComputeError::AddOverflow) {{ fail(19); }}
    let mut canonical = [0u64; 3];
    begin(); let written = canonicalIndexes(0, 3, &mut canonical); if !end() || written != Ok(3) || canonical != [0, 1, 2] {{ fail(23); }}
    let mut too_small = [0u64; 0];
    begin(); let exhausted = canonicalIndexes(0, 1, &mut too_small); if !end() || exhausted != Err(ComputeError::OutputTooSmall) {{ fail(24); }}

    let mut corpus = 0u64;
    let mut values = [0u64; 16];
    for len in 0usize..={exhaustive_max_length} {{
        let total = {exhaustive_width}usize.pow(len as u32);
        for encoded in 0..total {{
            let mut cursor = encoded;
            for slot in values.iter_mut().take(len) {{ *slot = (cursor % {exhaustive_width}) as u64; cursor /= {exhaustive_width}; }}
            let slice = &values[..len];
            let expected_below = slice.iter().all(|value| *value < {exhaustive_bound});
            begin(); let observed = allBelow({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(20); }}
            begin(); let observed = validateEdgeEndpoints({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(25); }}
            begin(); let observed = validateRiskLinks({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(26); }}
            begin(); let observed = validateControlLinks({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(27); }}
            begin(); let observed = validateViewpointLinks({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(28); }}
            begin(); let observed = validateQualityLinks({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(29); }}
            begin(); let observed = validateFlattenedBounds({exhaustive_bound}, slice); if !end() || observed != expected_below {{ fail(30); }}
            let expected_consecutive = slice.iter().enumerate().all(|(index, value)| *value == index as u64);
            begin(); let observed = validateComponentIndexes(slice); if !end() || observed != Ok(expected_consecutive) {{ fail(21); }}
            let start = (encoded % 2) as u64;
            let mut output = [0u64; 16];
            begin(); let observed = canonicalIndexes(start, len as u64, &mut output[..len]); if !end() || observed != Ok(len) {{ fail(31); }}
            if output[..len].iter().enumerate().any(|(index, value)| *value != start + index as u64) {{ fail(32); }}
            let mut candidate = StandardsProfile {{ architectureEdition: 2022, applicationSecurityEdition: 2011, controlEdition: 2017, riskEdition: 2022, qualityEdition: 2023 }};
            if encoded != 0 {{ match encoded % 5 {{ 0 => candidate.architectureEdition = 0, 1 => candidate.applicationSecurityEdition = 0, 2 => candidate.controlEdition = 0, 3 => candidate.riskEdition = 0, _ => candidate.qualityEdition = 0 }} }}
            begin(); let observed = validateExactStandardsProfile(candidate); if !end() || observed != (encoded == 0) {{ fail(33); }}
            corpus += 1;
        }}
    }}
    let mut seed = 0x{seed}u64;
    for case in 0usize..{property_cases} {{
        seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
        let len = if case == {last_property_case} {{ {property_max_length}usize }} else {{ (seed as usize) % {property_length_width} }};
        for (index, slot) in values.iter_mut().take(len).enumerate() {{
            seed = seed.wrapping_mul(6364136223846793005).wrapping_add(1442695040888963407);
            *slot = if case == {last_property_case} && index == 0 {{ u64::MAX }} else {{ seed % {property_value_modulus} }};
        }}
        let slice = &values[..len];
        let expected = slice.iter().all(|value| *value < {property_bound});
        begin(); let observed = validateFlattenedBounds({property_bound}, slice); if !end() || observed != expected {{ fail(22); }}
        begin(); let observed = allBelow({property_bound}, slice); if !end() || observed != expected {{ fail(34); }}
        begin(); let observed = validateEdgeEndpoints({property_bound}, slice); if !end() || observed != expected {{ fail(35); }}
        begin(); let observed = validateRiskLinks({property_bound}, slice); if !end() || observed != expected {{ fail(36); }}
        begin(); let observed = validateControlLinks({property_bound}, slice); if !end() || observed != expected {{ fail(37); }}
        begin(); let observed = validateViewpointLinks({property_bound}, slice); if !end() || observed != expected {{ fail(38); }}
        begin(); let observed = validateQualityLinks({property_bound}, slice); if !end() || observed != expected {{ fail(39); }}
        let expected_consecutive = slice.iter().enumerate().all(|(index, value)| *value == index as u64);
        begin(); let observed = validateComponentIndexes(slice); if !end() || observed != Ok(expected_consecutive) {{ fail(40); }}
        corpus += 1;
    }}
    println!("{{{{\"bounds\":{{{{\"max_length\":{property_max_length},\"value_domain\":\"{value_domain}\"}}}},\"case_count\":{{}},\"control_coverage\":{{{{\"case_count\":{control_coverage_cases},\"negative\":{control_coverage_negative},\"positive\":{control_coverage_positive},\"status\":\"passed\"}}}},\"corpus_sha256\":\"{corpus_sha256}\",\"no_allocation\":true,\"no_panic\":true,\"schema\":\"prismpm/execution-evidence/2\",\"seed\":\"{seed}\",\"shrink_result\":\"{shrink_result}\",\"status\":\"passed\",\"strategy\":\"{strategy}\"}}}}", corpus);
}}
"#,
        indexes = indexes,
        endpoints = endpoints,
        risk_asset_links = risk_asset_links,
        risk_threat_links = risk_threat_links,
        control_links = control_links,
        viewpoint_stakeholder_links = viewpoint_stakeholder_links,
        viewpoint_concern_links = viewpoint_concern_links,
        viewpoint_model_kind_links = viewpoint_model_kind_links,
        quality_characteristic_links = quality_characteristic_links,
        quality_subcharacteristic_links = quality_subcharacteristic_links,
        quality_requirement_links = quality_requirement_links,
        component_count = model.architecture.components.len(),
        asset_count = model.security.assets.len(),
        threat_count = model.security.threats.len(),
        risk_count = model.security.risks.len(),
        stakeholder_count = model.architecture.stakeholders.len(),
        concern_count = model.architecture.concerns.len(),
        model_kind_count = model.architecture.model_kinds.len(),
        characteristic_count = model.quality.characteristics.len(),
        subcharacteristic_count = model.quality.subcharacteristics.len(),
        requirement_count = model.quality.requirements.len(),
        exhaustive_max_length = corpus.exhaustive.max_length,
        exhaustive_width = corpus.exhaustive.value_max + 1,
        exhaustive_bound = corpus.exhaustive.all_below_bound,
        seed = corpus.seed.as_str(),
        property_cases = corpus.property.case_count,
        property_length_width = corpus.property.max_length + 1,
        last_property_case = corpus.property.case_count - 1,
        property_value_modulus = corpus.property.generated_value_modulus,
        property_bound = corpus.property.all_below_bound,
        property_max_length = corpus.property.max_length,
        value_domain = corpus.value_domain.as_str(),
        corpus_sha256 = corpus_sha256,
        control_coverage_cases = corpus.control_coverage.case_count,
        control_coverage_positive = corpus.control_coverage.positive,
        control_coverage_negative = corpus.control_coverage.negative,
        strategy = corpus.strategy.as_str(),
        shrink_result = corpus.property.shrink_result.as_str(),
    )
}

fn exact_array(value: &Value, key: &str) -> Result<Vec<String>, PrismError> {
    value
        .get(key)
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP5004", format!("coverage field {key} is missing")))?
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| PrismError::new("PP5004", "coverage array is malformed"))
        })
        .collect()
}

fn validate_lexlean_declarations(
    value: &Value,
    snapshot: &Value,
    corpus: &ExecutionCorpus,
) -> Result<(), PrismError> {
    let declarations = value
        .get("declarations")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP4004", "LexLean declaration audit is absent"))?;
    let modules = snapshot
        .get("modules")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP4004", "LexLean snapshot modules are absent"))?;
    let mut expected = BTreeMap::new();
    for module in modules {
        let lean_module = module
            .get("lean_module")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "snapshot Lean module is absent"))?;
        let module_declarations = module
            .get("declarations")
            .and_then(Value::as_array)
            .ok_or_else(|| PrismError::new("PP4004", "snapshot declarations are absent"))?;
        for declaration in module_declarations {
            let lean_name = declaration
                .get("lean_name")
                .and_then(Value::as_str)
                .ok_or_else(|| PrismError::new("PP4004", "snapshot declaration name is absent"))?;
            let full_name = format!("{lean_module}.{lean_name}");
            if full_name.starts_with("PrismPM.")
                && expected.insert(full_name.clone(), declaration).is_some()
            {
                return Err(PrismError::new(
                    "PP4004",
                    format!("duplicate snapshot declaration {full_name}"),
                ));
            }
        }
    }
    if expected.is_empty() {
        return Err(PrismError::new(
            "PP5003",
            "LexLean snapshot contains no Prism declarations",
        ));
    }
    let mut audited = BTreeSet::new();
    for declaration in declarations {
        let name = declaration
            .get("name")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "LexLean declaration name is absent"))?;
        if name.starts_with("PrismPM.") {
            let snapshot_declaration = expected.get(name).ok_or_else(|| {
                PrismError::new(
                    "PP5003",
                    format!("axiom audit names undeclared Prism declaration {name}"),
                )
            })?;
            if !audited.insert(name.to_owned()) {
                return Err(PrismError::new(
                    "PP5003",
                    format!("duplicate axiom audit for Prism declaration {name}"),
                ));
            }
            let observed = declaration
                .get("observed")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    PrismError::new("PP4004", format!("axiom audit is absent for {name}"))
                })?;
            if observed.iter().any(|axiom| axiom.as_str().is_none()) {
                return Err(PrismError::new(
                    "PP4004",
                    format!("axiom audit is malformed for {name}"),
                ));
            }
            if declaration.get("result").and_then(Value::as_str) != Some("ok") {
                return Err(PrismError::new(
                    "PP5003",
                    format!("Prism declaration {name} failed its axiom policy audit"),
                ));
            }
            if declaration.get("policy") != snapshot_declaration.get("axiom_policy") {
                return Err(PrismError::new(
                    "PP5003",
                    format!("Prism declaration {name} audit policy differs from its snapshot"),
                ));
            }
            if snapshot_declaration.get("kind").and_then(Value::as_str) == Some("theorem")
                && !observed.is_empty()
            {
                return Err(PrismError::new(
                    "PP5003",
                    format!("Prism theorem {name} has a nonempty axiom audit"),
                ));
            }
            let observed_names = observed
                .iter()
                .map(|axiom| axiom.as_str().expect("validated axiom name"))
                .collect::<Vec<_>>();
            let policy_kind = declaration
                .pointer("/policy/kind")
                .and_then(Value::as_str)
                .ok_or_else(|| {
                    PrismError::new("PP4004", format!("axiom policy kind is absent for {name}"))
                })?;
            let policy_names = declaration
                .pointer("/policy/axioms")
                .and_then(Value::as_array)
                .ok_or_else(|| {
                    PrismError::new(
                        "PP4004",
                        format!("axiom policy names are absent for {name}"),
                    )
                })?
                .iter()
                .map(|axiom| {
                    axiom.as_str().ok_or_else(|| {
                        PrismError::new("PP4004", format!("axiom policy is malformed for {name}"))
                    })
                })
                .collect::<Result<Vec<_>, _>>()?;
            let permitted = match policy_kind {
                "none" => policy_names.is_empty() && observed_names.is_empty(),
                "exact" => observed_names == policy_names,
                "allow" => observed_names
                    .iter()
                    .all(|axiom| policy_names.contains(axiom)),
                _ => false,
            };
            if !permitted {
                return Err(PrismError::new(
                    "PP5003",
                    format!("Prism declaration {name} has an unapproved axiom audit"),
                ));
            }
        }
    }
    if audited.len() != expected.len() {
        let missing = expected
            .keys()
            .find(|name| !audited.contains(*name))
            .expect("unequal declaration sets have a missing member");
        return Err(PrismError::new(
            "PP5003",
            format!("Prism declaration {missing} has no axiom audit"),
        ));
    }
    for oracle in &corpus.oracle {
        let audit = declarations.iter().find(|declaration| {
            declaration.get("name").and_then(Value::as_str) == Some(oracle.theorem.as_str())
        });
        if !audit.is_some_and(|declaration| {
            declaration
                .get("observed")
                .and_then(Value::as_array)
                .is_some_and(Vec::is_empty)
                && declaration.pointer("/policy/kind").and_then(Value::as_str) == Some("none")
        }) {
            return Err(PrismError::new(
                "PP5003",
                format!(
                    "execution oracle theorem {} has no exact empty axiom audit",
                    oracle.theorem
                ),
            ));
        }
    }
    Ok(())
}

fn validate_control_coverage_corpus(
    snapshot: &Value,
    corpus: &ExecutionCorpus,
) -> Result<(), PrismError> {
    let invalid = || {
        PrismError::new("PP5006", "control coverage execution counts do not match the exact modeled cases and expectations")
    };
    let declarations = snapshot
        .get("modules")
        .and_then(Value::as_array)
        .and_then(|modules| {
            modules
                .iter()
                .find(|module| module["name"] == "Production.ControlCoverageCorpus")
        })
        .and_then(|module| module.pointer("/semantic/declarations"))
        .and_then(Value::as_array)
        .ok_or_else(invalid)?;
    let mut cases = BTreeMap::new();
    for row in declarations {
        let Some(name) = row["name"]
            .as_str()
            .filter(|name| name.starts_with("coverageCase"))
        else {
            continue;
        };
        if row["kind"] != "definition" {
            continue;
        }
        if row["body"]["kind"] != "call"
            || row["body"]["function"]
                != json!({"module":"Production.ControlCoverage", "name":"validateControlCoverage"})
            || row["body"]["arguments"].as_array().map(Vec::len) != Some(2)
        {
            return Err(invalid());
        }
        let theorem = declarations
            .iter()
            .find(|row| row["kind"] == "theorem" && row["name"] == format!("{name}Expected"))
            .ok_or_else(invalid)?;
        let expected = theorem["statement"]["right"]["value"]
            .as_bool()
            .ok_or_else(invalid)?;
        if theorem["statement"]
            != json!({"kind":"eq", "left":{"kind":"call","function":{"name":name},"arguments":[]},"right":{"kind":"bool","value":expected}})
            || cases.insert(name, expected).is_some()
        {
            return Err(invalid());
        }
    }
    let counts = &corpus.control_coverage;
    if cases.len() as u64 != counts.case_count
        || cases.values().filter(|expected| **expected).count() as u64 != counts.positive
        || cases.values().filter(|expected| !**expected).count() as u64 != counts.negative
    {
        return Err(invalid());
    }
    let aggregate = declarations
        .iter()
        .find(|row| row["kind"] == "definition" && row["name"] == "coverageCorpusPassed")
        .ok_or_else(invalid)?;
    let mut body = &aggregate["body"];
    let mut executed = BTreeSet::new();
    while body["kind"] == "and" {
        let mut check = &body["left"];
        let expected = check["kind"] != "not";
        if !expected {
            check = &check["value"];
        }
        let name = check["function"]["name"].as_str().ok_or_else(invalid)?;
        if check != &json!({"kind":"call", "function":{"name":name},"arguments":[]})
            || cases.get(name) != Some(&expected)
            || !executed.insert(name)
        {
            return Err(invalid());
        }
        body = &body["right"];
    }
    if body != &json!({"kind":"bool", "value":true}) || executed.len() != cases.len() {
        return Err(invalid());
    }
    Ok(())
}

pub(crate) fn validate_coverage(value: &Value, roots: &[String]) -> Result<(), PrismError> {
    let object = value
        .as_object()
        .ok_or_else(|| PrismError::new("PP5004", "coverage is not an object"))?;
    if object.keys().map(String::as_str).collect::<Vec<_>>()
        != [
            "erased_proof_dependencies",
            "external_calls",
            "included_definitions",
            "opaque_nodes",
            "requested_roots",
            "unsupported_types",
        ]
    {
        return Err(PrismError::new(
            "PP5004",
            "named export coverage has the wrong fields",
        ));
    }
    let included = exact_array(value, "included_definitions")?;
    let included_set = included.iter().collect::<std::collections::BTreeSet<_>>();
    if exact_array(value, "requested_roots")? != roots
        || included.len() != included_set.len()
        || included.windows(2).any(|pair| pair[0] >= pair[1])
        || roots
            .iter()
            .any(|root| included.binary_search(root).is_err())
        || !exact_array(value, "erased_proof_dependencies")?.is_empty()
        || !exact_array(value, "opaque_nodes")?.is_empty()
        || !exact_array(value, "external_calls")?.is_empty()
        || !exact_array(value, "unsupported_types")?.is_empty()
    {
        return Err(PrismError::new(
            "PP5004",
            "named export coverage is unacceptable",
        ));
    }
    Ok(())
}

pub(crate) fn parse_kernel(text: &str) -> Result<prod_ir::Module, PrismError> {
    let (remaining, module) = prod_ir::parser::parse_module(text)
        .map_err(|_| PrismError::new("PP5004", "kernel.ir is malformed"))?;
    if !remaining.trim().is_empty() {
        return Err(PrismError::new("PP5004", "kernel.ir has trailing syntax"));
    }
    Ok(module)
}

fn validate_execution(
    value: &Value,
    corpus: &ExecutionCorpus,
    corpus_sha256: &str,
) -> Result<(), PrismError> {
    let object = value
        .as_object()
        .ok_or_else(|| PrismError::new("PP5006", "execution evidence is not an object"))?;
    let keys = object.keys().map(String::as_str).collect::<Vec<_>>();
    let bounds_keys = value
        .get("bounds")
        .and_then(Value::as_object)
        .map(|bounds| bounds.keys().map(String::as_str).collect::<Vec<_>>());
    if keys
        != [
            "bounds",
            "case_count",
            "control_coverage",
            "corpus_sha256",
            "no_allocation",
            "no_panic",
            "schema",
            "seed",
            "shrink_result",
            "status",
            "strategy",
        ]
        || bounds_keys.as_deref() != Some(&["max_length", "value_domain"])
        || value.get("schema").and_then(Value::as_str) != Some("prismpm/execution-evidence/2")
        || value.get("status").and_then(Value::as_str) != Some("passed")
        || value.get("no_allocation").and_then(Value::as_bool) != Some(true)
        || value.get("no_panic").and_then(Value::as_bool) != Some(true)
        || value.get("case_count").and_then(Value::as_u64) != Some(corpus.case_count)
        || value.get("control_coverage")
            != Some(&serde_json::json!({
                "case_count": corpus.control_coverage.case_count,
                "negative": corpus.control_coverage.negative,
                "positive": corpus.control_coverage.positive,
                "status": "passed"
            }))
        || value.get("corpus_sha256").and_then(Value::as_str) != Some(corpus_sha256)
        || value.get("seed").and_then(Value::as_str) != Some(corpus.seed.as_str())
        || value.get("strategy").and_then(Value::as_str) != Some(corpus.strategy.as_str())
        || value.get("shrink_result").and_then(Value::as_str)
            != Some(corpus.property.shrink_result.as_str())
        || value.pointer("/bounds/max_length").and_then(Value::as_u64)
            != u64::try_from(corpus.property.max_length).ok()
        || value
            .pointer("/bounds/value_domain")
            .and_then(Value::as_str)
            != Some(corpus.value_domain.as_str())
    {
        return Err(PrismError::new(
            "PP5006",
            "execution evidence is incomplete or noncanonical",
        ));
    }
    Ok(())
}

/// Recheck retained native records using the same authoritative registers and
/// predicates as execution. This performs no subprocess or filesystem access.
pub(crate) fn validate_release_native_evidence(
    manifest: &Value,
    execution: &Value,
    coverage: &Value,
    lexlean_attestation: &Value,
    snapshot: &Value,
) -> Result<(), PrismError> {
    let roots: RuntimeRoots = toml::from_str(ROOTS_SOURCE)
        .map_err(|error| PrismError::new("PP9001", format!("runtime roots: {error}")))?;
    let (corpus, corpus_sha256) = execution_corpus(&roots)?;
    let package_roots = package_export_roots(STDLIB_EXPORTS_SOURCE, &roots)?;
    let export_roots = roots
        .roots
        .iter()
        .chain(&package_roots)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    if manifest["runtime_roots"] != json!(roots.roots)
        || manifest["package_export_roots"] != json!(package_roots)
        || manifest["export_roots"] != json!(export_roots)
        || manifest["execution"] != *execution
    {
        return Err(PrismError::new(
            "PP5006",
            "retained native roots or execution differ",
        ));
    }
    validate_execution(execution, &corpus, &corpus_sha256)?;
    validate_coverage(coverage, &export_roots)?;
    validate_lexlean_declarations(lexlean_attestation, snapshot, &corpus)?;
    validate_control_coverage_corpus(snapshot, &corpus)
}

pub(crate) fn publish(
    output_root: &Path,
    attestation_id: &str,
    files: &[(String, Vec<u8>)],
) -> Result<(), PrismError> {
    std::fs::create_dir_all(output_root).map_err(|error| {
        PrismError::new("PP4002", format!("{}: {error}", output_root.display()))
    })?;
    let lock_path = output_root.join(".prismpm.lock");
    let lock = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&lock_path)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", lock_path.display())))?;
    lock.lock_exclusive()
        .map_err(|error| PrismError::new("PP4002", format!("verification lock: {error}")))?;
    let parent = output_root.join("verified");
    std::fs::create_dir_all(&parent)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", parent.display())))?;
    let destination = parent.join(attestation_id);
    if destination.exists() {
        let expected_paths = files
            .iter()
            .map(|(relative, _)| relative.as_str())
            .collect::<std::collections::BTreeSet<_>>();
        let mut expected_directories = std::collections::BTreeSet::new();
        for relative in &expected_paths {
            let mut parent = Path::new(relative).parent();
            while let Some(path) = parent.filter(|path| !path.as_os_str().is_empty()) {
                expected_directories.insert(path.to_string_lossy().replace('\\', "/"));
                parent = path.parent();
            }
        }
        let mut observed_paths = std::collections::BTreeSet::new();
        let mut observed_directories = std::collections::BTreeSet::new();
        for entry in walkdir::WalkDir::new(&destination).min_depth(1) {
            let entry = entry.map_err(|error| {
                PrismError::new("PP4002", format!("verified artifact walk: {error}"))
            })?;
            if entry.file_type().is_symlink() {
                return Err(PrismError::new(
                    "PP4001",
                    "verified artifact contains a symlink",
                ));
            }
            if entry.file_type().is_file() {
                let relative = entry
                    .path()
                    .strip_prefix(&destination)
                    .map_err(|_| PrismError::new("PP9001", "verified artifact path escaped"))?
                    .to_string_lossy()
                    .replace('\\', "/");
                observed_paths.insert(relative);
            } else if entry.file_type().is_dir() {
                observed_directories.insert(
                    entry
                        .path()
                        .strip_prefix(&destination)
                        .map_err(|_| PrismError::new("PP9001", "verified directory path escaped"))?
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            } else {
                return Err(PrismError::new(
                    "PP4001",
                    "verified artifact contains a non-file entry",
                ));
            }
        }
        if observed_paths
            .iter()
            .map(String::as_str)
            .collect::<std::collections::BTreeSet<_>>()
            != expected_paths
            || observed_directories != expected_directories
        {
            return Err(PrismError::new(
                "PP4001",
                "verified artifact set differs from its manifest",
            ));
        }
        for (relative, expected) in files {
            let path = destination.join(relative);
            if !std::fs::symlink_metadata(&path)
                .map(|metadata| metadata.file_type().is_file())
                .unwrap_or(false)
            {
                return Err(PrismError::new(
                    "PP4001",
                    "verified artifact is not a regular file",
                ));
            }
            let observed = std::fs::read(path)
                .map_err(|_| PrismError::new("PP4002", "verified artifact is missing"))?;
            if &observed != expected {
                return Err(PrismError::new("PP4001", "verified artifact was modified"));
            }
        }
        return Ok(());
    }
    let staging_parent = output_root.join(".verify-staging");
    std::fs::create_dir_all(&staging_parent)
        .map_err(|error| PrismError::new("PP4002", format!("staging: {error}")))?;
    let staging = tempfile::Builder::new()
        .prefix("verify-")
        .tempdir_in(staging_parent)
        .map_err(|error| PrismError::new("PP4002", format!("staging: {error}")))?;
    for (relative, bytes) in files {
        write(&staging.path().join(relative), bytes)?;
    }
    File::open(staging.path())
        .and_then(|file| file.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("verification fsync: {error}")))?;
    std::fs::rename(staging.path(), &destination)
        .map_err(|error| PrismError::new("PP4002", format!("verification publish: {error}")))?;
    File::open(parent)
        .and_then(|file| file.sync_all())
        .map_err(|error| PrismError::new("PP4002", format!("verified fsync: {error}")))?;
    drop(lock);
    Ok(())
}

pub(crate) fn verify_application_build_closure(
    build_root: &Path,
    manifest: &Value,
) -> Result<(), PrismError> {
    let rows = manifest
        .get("files")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP4004", "application build file manifest is absent"))?;
    let mut expected = BTreeMap::new();
    for row in rows {
        let path = row
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "application artifact path is absent"))?;
        if path == "manifest.json"
            || Path::new(path).is_absolute()
            || Path::new(path)
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
        {
            return Err(PrismError::new(
                "PP4004",
                format!("application artifact path is invalid: {path}"),
            ));
        }
        let length = row
            .get("byte_length")
            .and_then(Value::as_u64)
            .ok_or_else(|| PrismError::new("PP4004", "application artifact size is absent"))?;
        let digest = row
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "application artifact hash is absent"))?;
        if digest.len() != 64
            || !digest
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            || expected
                .insert(path.to_owned(), (length, digest.to_owned()))
                .is_some()
        {
            return Err(PrismError::new(
                "PP4004",
                "application artifact row is invalid or duplicated",
            ));
        }
    }
    let mut observed = BTreeSet::new();
    for entry in walkdir::WalkDir::new(build_root).min_depth(1) {
        let entry = entry.map_err(|error| {
            PrismError::new("PP4002", format!("application artifact walk: {error}"))
        })?;
        if entry.file_type().is_symlink()
            || (!entry.file_type().is_file() && !entry.file_type().is_dir())
        {
            return Err(PrismError::new(
                "PP4001",
                "application artifact closure contains a symlink or special file",
            ));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry
            .path()
            .strip_prefix(build_root)
            .map_err(|_| PrismError::new("PP9001", "application artifact path escaped"))?
            .to_string_lossy()
            .replace('\\', "/");
        if path == "manifest.json" {
            continue;
        }
        let (length, digest) = expected.get(&path).ok_or_else(|| {
            PrismError::new("PP4001", format!("undeclared application artifact: {path}"))
        })?;
        let bytes = std::fs::read(entry.path()).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", entry.path().display()))
        })?;
        if bytes.len() as u64 != *length || format!("{:x}", Sha256::digest(&bytes)) != *digest {
            return Err(PrismError::new(
                "PP4001",
                format!("application artifact does not match its manifest: {path}"),
            ));
        }
        observed.insert(path);
    }
    if observed.len() != expected.len() || expected.keys().any(|path| !observed.contains(path)) {
        return Err(PrismError::new(
            "PP4001",
            "application artifact closure is incomplete",
        ));
    }
    Ok(())
}

fn verify_regenerated_artifacts(
    build_root: &Path,
    expected: &BTreeSet<String>,
    artifacts: &[(String, Vec<u8>)],
) -> Result<(), PrismError> {
    let actual = artifacts
        .iter()
        .map(|(path, _)| path.clone())
        .collect::<BTreeSet<_>>();
    if &actual != expected || actual.len() != artifacts.len() {
        return Err(PrismError::new(
            "PP5004",
            "application regeneration artifact closure differs",
        ));
    }
    for (path, bytes) in artifacts {
        if std::fs::read(build_root.join(path))
            .map_err(|error| PrismError::new("PP4002", error.to_string()))?
            != *bytes
        {
            return Err(PrismError::new(
                "PP5004",
                format!("application regeneration differs: {path}"),
            ));
        }
    }
    Ok(())
}

fn copy_application_package(build_root: &Path, destination: &Path) -> Result<(), PrismError> {
    let source = build_root.join("cargo/package");
    for entry in walkdir::WalkDir::new(&source).min_depth(1) {
        let entry = entry
            .map_err(|error| PrismError::new("PP4002", format!("generated package: {error}")))?;
        let relative = entry
            .path()
            .strip_prefix(&source)
            .map_err(|_| PrismError::new("PP9001", "generated package path escaped"))?;
        let target = destination.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target).map_err(|error| {
                PrismError::new("PP4002", format!("{}: {error}", target.display()))
            })?;
        } else if entry.file_type().is_file() && !entry.file_type().is_symlink() {
            write(
                &target,
                &std::fs::read(entry.path()).map_err(|error| {
                    PrismError::new("PP4002", format!("{}: {error}", entry.path().display()))
                })?,
            )?;
        } else {
            return Err(PrismError::new(
                "PP4001",
                "generated package contains a symlink or special file",
            ));
        }
    }
    Ok(())
}

fn application_harness(
    application: &crate::holo::model_document::Application,
    module: &prod_ir::Module,
) -> Result<String, PrismError> {
    let crate_name = application.cargo_name().replace('-', "_");
    let entry = application
        .entry_root()
        .rsplit('.')
        .next()
        .ok_or_else(|| PrismError::new("PP2001", "application entry root is malformed"))?;
    let fallible = prod_codegen::byte_entry_is_fallible(module, entry)
        .map_err(|error| PrismError::new("PP4102", format!("application entry effect: {error}")))?;
    let vectors = application
        .acceptance_vectors()
        .iter()
        .enumerate()
        .map(|(index, vector)| {
            let expected = if fallible {
                format!("Ok(vec!{:?})", vector.response)
            } else {
                format!("vec!{:?}", vector.response)
            };
            format!(
                "    assert_eq!({crate_name}::{entry}(vec!{:?}), {expected}, \"acceptance vector {index}\");\n",
                vector.request
            )
        })
        .collect::<String>();
    Ok(format!("fn main() {{\n{vectors}}}\n"))
}

#[allow(clippy::too_many_arguments)]
fn run_application(
    controller: &Controller,
    config: &ProjectConfig,
    build: BuildResult,
    model: crate::holo::model_document::ModelDocument,
    model_bytes: Vec<u8>,
    build_manifest: Value,
    build_root: &Path,
    lex_attestation: Vec<u8>,
    lex_attestation_id: String,
    mut processes: Vec<ProcessRecord>,
    mut exporter_owner: crate::exporter::VerifyExporterOwner,
) -> Result<VerifyResult, PrismError> {
    let application = model.application.as_ref().ok_or_else(|| {
        PrismError::new(
            "PP9001",
            "application verification received a non-application model",
        )
    })?;
    verify_application_build_closure(build_root, &build_manifest)?;
    let harness = {
        // Derive the entry effect from the captured, manifest-bound IR, using
        // the same analysis as the actual generated Rust signature.
        let kernel = std::fs::read_to_string(build_root.join("cargo/kernel.ir"))
            .map_err(|error| PrismError::new("PP5004", format!("application kernel: {error}")))?;
        application_harness(application, &parse_kernel(&kernel)?)?
    };
    let holo_path = build_root.join(format!("{}.holo", application.name()));
    let holo = std::fs::read(&holo_path)
        .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", holo_path.display())))?;
    crate::holo::archive::validate_application(&holo)?;
    let wasm_path = build_root.join(format!(
        "core-wasm/{}_core_wasm.wasm",
        application.cargo_name().replace('-', "_")
    ));
    crate::application_build::validate_application_core_resources(
        application,
        &std::fs::read(&wasm_path).map_err(|error| PrismError::new("PP5103", error.to_string()))?,
        &std::fs::read(build_root.join("application/target-profile.json"))
            .map_err(|error| PrismError::new("PP5103", error.to_string()))?,
        &std::fs::read(build_root.join("core-wasm/package/generation-manifest.json"))
            .map_err(|error| PrismError::new("PP5103", error.to_string()))?,
    )?;
    processes.extend(run_hologram_oracle(
        controller,
        build_root,
        &holo_path,
        &build_root.join("model.prism.json"),
        &wasm_path,
    )?);
    let wasm_tools = executable("wasm-tools")?;
    let no_env = BTreeMap::new();
    let replacements = [
        (controller.root.as_path(), "$PROJECT"),
        (build_root, "$BUILD"),
    ];
    processes.push(run_process(
        "core-wasm-validate",
        &wasm_tools,
        &[
            "validate".to_owned(),
            wasm_path.to_string_lossy().into_owned(),
        ],
        build_root,
        &no_env,
        &replacements,
        "PP5101",
    )?);
    let printed = run_process(
        "core-wasm-inspect",
        &wasm_tools,
        &["print".to_owned(), wasm_path.to_string_lossy().into_owned()],
        build_root,
        &no_env,
        &replacements,
        "PP5101",
    )?;
    if printed.stdout.contains("(import ")
        || !printed.stdout.contains("(export \"memory\"")
        || !printed.stdout.contains("(export \"holo_alloc\"")
        || !printed.stdout.contains("(export \"holo_run\"")
    {
        return Err(PrismError::new(
            "PP5103",
            "Core-Wasm imports or exports disagree with the closed guest ABI",
        ));
    }
    processes.push(printed);

    let work = tempfile::Builder::new()
        .prefix("prismpm-application-verify-")
        .tempdir()
        .map_err(|error| PrismError::new("PP4002", format!("application verification: {error}")))?;
    let package_root = work.path().join("package");
    std::fs::create_dir(&package_root)
        .map_err(|error| PrismError::new("PP4002", format!("package staging: {error}")))?;
    copy_application_package(build_root, &package_root)?;
    let crate_path = build_root.join(format!(
        "cargo/{}-{}.crate",
        application.cargo_name(),
        application.cargo_version()
    ));
    let crate_bytes = std::fs::read(&crate_path)
        .map_err(|error| PrismError::new("PP4102", format!("generated crate: {error}")))?;
    let cargo_home =
        crate::application_build::application_cargo_home(work.path(), application, &crate_bytes)?;
    let mut cargo_env = BTreeMap::new();
    cargo_env.insert(
        "CARGO_HOME".to_owned(),
        cargo_home.to_string_lossy().into_owned(),
    );
    cargo_env.insert("CARGO_NET_OFFLINE".to_owned(), "true".to_owned());
    let cargo = executable("cargo")?;
    let app_replacements = [
        (controller.root.as_path(), "$PROJECT"),
        (build_root, "$BUILD"),
        (work.path(), "$VERIFY_WORK"),
    ];
    for (tool, args) in [
        (
            "application-package-test",
            vec!["test", "--locked", "--offline"],
        ),
        (
            "application-package-no-std",
            vec!["check", "--locked", "--offline", "--no-default-features"],
        ),
    ] {
        processes.push(run_process(
            tool,
            &cargo,
            &args.into_iter().map(str::to_owned).collect::<Vec<_>>(),
            &package_root,
            &cargo_env,
            &app_replacements,
            "PP4102",
        )?);
    }

    let consumer = work.path().join("consumer");
    std::fs::create_dir(&consumer)
        .map_err(|error| PrismError::new("PP4002", format!("consumer staging: {error}")))?;
    write(
        &consumer.join("Cargo.toml"),
        format!(
            "[package]\nname = \"prismpm-application-consumer\"\nversion = \"0.0.0\"\nedition = \"2021\"\npublish = false\n\n[dependencies]\n{} = {{ version = \"={}\", default-features = false, features = [\"std\"] }}\n",
            application.cargo_name(), application.cargo_version()
        )
        .as_bytes(),
    )?;
    write(&consumer.join("src/main.rs"), harness.as_bytes())?;
    processes.push(run_process(
        "application-consumer-lock",
        &cargo,
        &["generate-lockfile".to_owned(), "--offline".to_owned()],
        &consumer,
        &cargo_env,
        &app_replacements,
        "PP4103",
    )?);
    let execution = run_process(
        "application-generated-rust-corpus",
        &cargo,
        &[
            "run".to_owned(),
            "--locked".to_owned(),
            "--offline".to_owned(),
        ],
        &consumer,
        &cargo_env,
        &app_replacements,
        "PP6003",
    )?;
    processes.push(execution);

    let browser = build_root.join("view/browser");
    let expected_browser = [
        "app.css",
        "app.js",
        "index.html",
        &format!("{}.js", application.cargo_name().replace('-', "_")),
        &format!("{}_bg.wasm", application.cargo_name().replace('-', "_")),
        "provenance.json",
    ];
    let observed_browser = std::fs::read_dir(&browser)
        .map_err(|error| PrismError::new("PP5203", format!("browser output: {error}")))?
        .map(|entry| {
            entry
                .map_err(|error| PrismError::new("PP5203", error.to_string()))
                .and_then(|entry| {
                    if entry
                        .file_type()
                        .map_err(|error| PrismError::new("PP5203", error.to_string()))?
                        .is_file()
                    {
                        Ok(entry.file_name().to_string_lossy().into_owned())
                    } else {
                        Err(PrismError::new(
                            "PP5203",
                            "browser output contains a non-file",
                        ))
                    }
                })
        })
        .collect::<Result<BTreeSet<_>, _>>()?;
    if observed_browser != expected_browser.into_iter().map(str::to_owned).collect() {
        return Err(PrismError::new(
            "PP5203",
            "browser production file closure is not exact",
        ));
    }

    // A distinct generation from the attested application Lean closure. Its
    // truthful acquisition records describe this regeneration, not the earlier
    // controller build. Every generated artifact byte and path must agree.
    let application_lex = build_root.join("application/lexlean-build");
    let application_manifest =
        std::fs::read(build_root.join("application/lexlean-build-manifest.json"))
            .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
    let mut replay = crate::application_build::generate_owned(
        &controller.root,
        &model,
        &model_bytes,
        &application_lex,
        &application_manifest,
        &mut exporter_owner,
        crate::exporter::Phase::Replay,
    )?;
    let expected_artifacts = build_manifest["files"]
        .as_array()
        .ok_or_else(|| PrismError::new("PP4004", "application artifact closure is absent"))?
        .iter()
        .filter_map(|row| row["path"].as_str())
        .map(str::to_owned)
        .collect::<BTreeSet<_>>();
    // Retain only separately attested inputs, not any generated product files.
    // Recompute containing-system projections just as the original build did.
    for path in &expected_artifacts {
        if path.starts_with("lexlean/")
            || path.starts_with("application/lexlean-build/")
            || matches!(
                path.as_str(),
                "model.prism.json"
                    | "application/lexlean-snapshot.json"
                    | "application/lexlean-build-manifest.json"
            )
        {
            replay.artifacts.push((
                path.clone(),
                std::fs::read(build_root.join(path))
                    .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
            ));
        }
    }
    if expected_artifacts.contains("system.prism.json") {
        let bytes = std::fs::read(build_root.join("system.prism.json"))
            .map_err(|error| PrismError::new("PP4002", error.to_string()))?;
        let system = crate::system::parse(&bytes)?;
        replay
            .artifacts
            .push(("system.prism.json".to_owned(), bytes));
        for projection in crate::system::projections(&system, &replay.artifacts)? {
            replay.artifacts.push((projection.path, projection.bytes));
        }
    }
    verify_regenerated_artifacts(build_root, &expected_artifacts, &replay.artifacts)?;
    processes.extend(replay.exporter_processes);

    let identities: Value = serde_json::from_slice(
        &std::fs::read(build_root.join("application/holo-identities.json"))
            .map_err(|error| PrismError::new("PP3014", format!("Holo identities: {error}")))?,
    )
    .map_err(|error| PrismError::new("PP3014", format!("Holo identities: {error}")))?;
    let process_value = serde_json::to_value(&processes)
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    let acceptance = json!({
        "application": application.name(),
        "artifact_closure": "verified",
        "browser_projection": "verified",
        "build_id": build.build_id,
        "cargo_package": {"name":application.cargo_name(),"sha256":format!("{:x}",Sha256::digest(&crate_bytes)),"version":application.cargo_version()},
        "core_wasm": {"sha256":hash_file(&wasm_path)?,"status":"verified"},
        "holo": identities,
        "hologram_oracle": "verified",
        "lexlean_attestation_id": lex_attestation_id,
        "modeled_vectors": application.acceptance_vectors().len(),
        "regeneration": "byte-identical",
        "schema": "prismpm/application-acceptance/1",
        "source_id": build.source_id,
        "status": "verified"
    });
    let acceptance_bytes = encode_value(&acceptance)?;
    let manifest = json!({
        "acceptance_sha256": format!("{:x}", Sha256::digest(&acceptance_bytes)),
        "build_id": build.build_id,
        "exporter_owner": exporter_owner.finish()?,
        "lexlean_attestation_sha256": format!("{:x}", Sha256::digest(&lex_attestation)),
        "model_sha256": format!("{:x}", Sha256::digest(&model_bytes)),
        "processes": process_value,
        "schema": "prismpm/application-verification-manifest/2"
    });
    let manifest_bytes = encode_value(&manifest)?;
    let attestation_id = content_id(&manifest_bytes);
    let files = vec![
        ("application-acceptance.json".to_owned(), acceptance_bytes),
        ("lexlean-attestation.json".to_owned(), lex_attestation),
        ("manifest.json".to_owned(), manifest_bytes),
    ];
    let output_root = config.output_root(&controller.root)?;
    publish(&output_root, &attestation_id, &files)?;
    Ok(VerifyResult {
        schema: "prismpm/verify-result/1".to_owned(),
        attestation_id: attestation_id.clone(),
        build_id: build.build_id,
        verified_root: format!("{}/verified/{attestation_id}", config.build_root),
    })
}

pub(crate) fn run(
    controller: &Controller,
    request: VerifyRequest,
    release: Option<&str>,
) -> Result<VerifyResult, PrismError> {
    let mut exporter_owner = crate::exporter::VerifyExporterOwner::default();
    let build = controller.build_release_with_owner(
        BuildRequest {
            config_path: request.config_path.clone(),
        },
        release,
        Some(&mut exporter_owner),
    )?;
    controller.check_model_configuration(request.config_path.as_deref())?;
    let (config, _) = ProjectConfig::load(&controller.root, request.config_path.as_deref())?;
    let project_path = config.lexlean_path(&controller.root)?;
    let project_path = camino::Utf8PathBuf::from_path_buf(project_path)
        .map_err(|_| PrismError::new("PP1001", "LexLean path is not UTF-8"))?;
    let project_root = project_path
        .parent()
        .ok_or_else(|| PrismError::new("PP1001", "LexLean project path has no parent"))?;
    let preflight_replacements = [(controller.root.as_path(), "$PROJECT")];
    let toolchain = preflight_toolchain(project_root.as_std_path(), &preflight_replacements)?;
    let lex_engine = Engine::load(&project_path);
    controller.check_model_configuration(request.config_path.as_deref())?;
    let lex_engine = lex_engine.map_err(|error| {
        PrismError::from_lexlean(
            "PP5001",
            "LexLean verify load failed",
            error,
            config.limits.max_diagnostics,
        )
    })?;
    controller.check_model_configuration(request.config_path.as_deref())?;
    let lex_verified = lex_engine.verify(LexVerifyRequest {
        selection: Selection::Entrypoints,
    });
    controller.check_model_configuration(request.config_path.as_deref())?;
    let lex_verified = lex_verified.map_err(|error| {
        PrismError::from_lexlean(
            "PP5001",
            "LexLean verification failed",
            error,
            config.limits.max_diagnostics,
        )
    })?;
    // The independently published verification result owns its identities and
    // paths. Do not retain the loaded source engine during native compilation.
    drop(lex_engine);
    let lex_attestation_path = lex_verified.root.join("attestation.json");
    let lex_attestation = std::fs::read(lex_attestation_path.as_std_path())
        .map_err(|error| PrismError::new("PP4002", format!("LexLean attestation: {error}")))?;
    let lex_value: Value = serde_json::from_slice(&lex_attestation)
        .map_err(|error| PrismError::new("PP4004", format!("LexLean attestation: {error}")))?;
    let mut canonical_attestation = encode_value(&lex_value)
        .map_err(|error| PrismError::new("PP4004", format!("LexLean attestation: {error}")))?;
    canonical_attestation.push(b'\n');
    if canonical_attestation != lex_attestation {
        return Err(PrismError::new(
            "PP4004",
            "LexLean attestation is not canonical JSON",
        ));
    }
    if lex_value.get("status").and_then(Value::as_str) != Some("verified") {
        return Err(PrismError::new(
            "PP5002",
            "LexLean attestation is not verified",
        ));
    }
    let output_root = config.output_root(&controller.root)?;
    let build_root = output_root.join("build").join(&build.build_id);
    let model_bytes = std::fs::read(build_root.join("model.prism.json"))
        .map_err(|error| PrismError::new("PP4002", format!("model.prism.json: {error}")))?;
    let model = decode_canonical(&model_bytes)?;
    let lex_snapshot: Value = serde_json::from_slice(
        &std::fs::read(build_root.join("lexlean/snapshot.json"))
            .map_err(|error| PrismError::new("PP4002", format!("LexLean snapshot: {error}")))?,
    )
    .map_err(|error| PrismError::new("PP4004", format!("LexLean snapshot: {error}")))?;
    let build_manifest: Value = serde_json::from_slice(
        &std::fs::read(build_root.join("manifest.json"))
            .map_err(|error| PrismError::new("PP4002", format!("Prism manifest: {error}")))?,
    )
    .map_err(|error| PrismError::new("PP4004", format!("Prism manifest: {error}")))?;
    let lex_attestation_id = lex_verified.attestation_id.to_string();
    if lex_value.get("attestation_id").and_then(Value::as_str) != Some(lex_attestation_id.as_str())
        || lex_value.get("source_id").and_then(Value::as_str) != Some(build.source_id.as_str())
        || lex_value.get("semantic_id").and_then(Value::as_str) != Some(build.semantic_id.as_str())
        || lex_value
            .pointer("/lexlean/compiler_semantics")
            .and_then(Value::as_str)
            != Some(model.provenance.compiler_semantics_id.as_str())
        || lex_value.get("build_id").and_then(Value::as_str)
            != build_manifest
                .pointer("/inputs/lexlean_build_id")
                .and_then(Value::as_str)
    {
        return Err(PrismError::new(
            "PP4001",
            "LexLean attestation identities do not match the Prism build",
        ));
    }
    let roots: RuntimeRoots = toml::from_str(ROOTS_SOURCE)
        .map_err(|error| PrismError::new("PP9001", format!("runtime roots: {error}")))?;
    if roots.spec != "prismpm/runtime-roots/1"
        || roots.roots.is_empty()
        || roots.roots.windows(2).any(|rows| rows[0] >= rows[1])
    {
        return Err(PrismError::new("PP9001", "runtime roots are not canonical"));
    }
    let (corpus, corpus_sha256) = execution_corpus(&roots)?;
    let package_roots = package_export_roots(STDLIB_EXPORTS_SOURCE, &roots)?;
    let export_roots = roots
        .roots
        .iter()
        .chain(&package_roots)
        .cloned()
        .collect::<BTreeSet<_>>()
        .into_iter()
        .collect::<Vec<_>>();
    let package_exports_sha256 = format!("{:x}", Sha256::digest(STDLIB_EXPORTS_SOURCE.as_bytes()));
    if model.application.is_none() && model.library.is_none() {
        validate_lexlean_declarations(&lex_value, &lex_snapshot, &corpus)?;
        validate_control_coverage_corpus(&lex_snapshot, &corpus)?;
    }
    let lex_manifest = std::fs::read(build_root.join("lexlean/build/manifest.json"))
        .map_err(|error| PrismError::new("PP4002", format!("LexLean manifest: {error}")))?;
    let attested_manifest = lex_value
        .get("build_manifest")
        .and_then(|value| value.get("sha256"))
        .and_then(Value::as_str)
        .ok_or_else(|| PrismError::new("PP4004", "LexLean manifest hash is absent"))?;
    if format!("{:x}", Sha256::digest(&lex_manifest)) != attested_manifest {
        return Err(PrismError::new(
            "PP4001",
            "LexLean build manifest is not attested",
        ));
    }
    let lex_manifest_value: Value = serde_json::from_slice(&lex_manifest)
        .map_err(|error| PrismError::new("PP4004", format!("LexLean manifest: {error}")))?;
    let output_rows = lex_manifest_value
        .get("outputs")
        .and_then(Value::as_array)
        .ok_or_else(|| PrismError::new("PP4004", "LexLean manifest outputs are absent"))?;
    let mut attested_lean = BTreeMap::new();
    for row in output_rows {
        if row.get("kind").and_then(Value::as_str) != Some("lean") {
            continue;
        }
        let path = row
            .get("path")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "attested Lean path is absent"))?;
        let relative = Path::new(path);
        if relative.is_absolute()
            || relative
                .components()
                .any(|component| !matches!(component, std::path::Component::Normal(_)))
            || !path.starts_with("modules/")
            || !path.ends_with(".lean")
        {
            return Err(PrismError::new(
                "PP4004",
                format!("invalid attested Lean path {path}"),
            ));
        }
        let byte_length = row
            .get("byte_length")
            .and_then(Value::as_u64)
            .ok_or_else(|| PrismError::new("PP4004", "attested Lean size is absent"))?;
        let sha256 = row
            .get("sha256")
            .and_then(Value::as_str)
            .ok_or_else(|| PrismError::new("PP4004", "attested Lean hash is absent"))?;
        if sha256.len() != 64 || !sha256.bytes().all(|byte| byte.is_ascii_hexdigit()) {
            return Err(PrismError::new(
                "PP4004",
                format!("invalid attested Lean hash for {path}"),
            ));
        }
        if attested_lean
            .insert(path.to_owned(), (byte_length, sha256.to_owned()))
            .is_some()
        {
            return Err(PrismError::new(
                "PP4004",
                format!("duplicate attested Lean path {path}"),
            ));
        }
    }
    if attested_lean.is_empty() {
        return Err(PrismError::new(
            "PP4004",
            "LexLean manifest attests no generated Lean modules",
        ));
    }
    if model.library.is_some() {
        return crate::library_verification::run(
            crate::library_verification::LibraryVerification {
                repository_root: &controller.root,
                config: &config,
                build,
                model,
                model_bytes,
                build_manifest,
                build_root: &build_root,
                lex_attestation,
                lex_attestation_id,
                lex_snapshot,
                processes: toolchain.records,
                exporter_owner,
            },
        );
    }
    if model.application.is_some() {
        return run_application(
            controller,
            &config,
            build,
            model,
            model_bytes,
            build_manifest,
            &build_root,
            lex_attestation,
            lex_attestation_id,
            toolchain.records,
            exporter_owner,
        );
    }

    // All snapshot, declaration, coverage and generated-file admission checks
    // above are complete. The default native chain uses only the copied typed
    // identities, corpus, export roots and attested file rows. Release these
    // large decoded graphs before Lake starts its own compiler processes; keep
    // the exact original attestation bytes for the final published evidence.
    drop(lex_snapshot);
    drop(build_manifest);
    drop(lex_value);
    drop(canonical_attestation);
    drop(lex_manifest_value);
    drop(lex_manifest);
    drop(lex_verified);

    let staging_parent = output_root.join(".verify-work");
    std::fs::create_dir_all(&staging_parent)
        .map_err(|error| PrismError::new("PP4002", format!("verification work: {error}")))?;
    let mut work = crate::exporter::directory::Directory::temporary(
        "chain-",
        Some(&staging_parent),
        Default::default(),
    )?;
    let workspace_path = work.path().to_owned();
    let workspace = workspace_path.as_path();
    crate::exporter::verify_source(&controller.root)?;
    let lean_package = workspace.join("lean4-prod");
    let admitted =
        crate::exporter::acquire_for_owned(&controller.root, &lean_package, work.scope())?;
    work.protect_package(&lean_package, &admitted.snapshot)?;
    let exporter_acquisition = admitted.receipt;
    let replacements = [
        (workspace, "$STAGING"),
        (controller.root.as_path(), "$PROJECT"),
        (lean_package.as_path(), "$LEAN4_PROD"),
    ];
    let mut modules = Vec::new();
    let mut generated = Vec::new();
    for (path, (expected_size, expected_hash)) in &attested_lean {
        let source = build_root.join("lexlean/build").join(path);
        let metadata = std::fs::symlink_metadata(&source)
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", source.display())))?;
        if !metadata.file_type().is_file() || metadata.len() != *expected_size {
            return Err(PrismError::new(
                "PP4001",
                format!("attested generated Lean file {path} has the wrong type or size"),
            ));
        }
        let bytes = std::fs::read(&source)
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", source.display())))?;
        if format!("{:x}", Sha256::digest(&bytes)) != *expected_hash {
            return Err(PrismError::new(
                "PP4001",
                format!("attested generated Lean file {path} has changed"),
            ));
        }
        let relative = Path::new(path)
            .strip_prefix("modules")
            .map_err(|_| PrismError::new("PP9001", "generated module path escaped"))?;
        write(&workspace.join(relative), &bytes)?;
        generated.push(bytes);
        modules.push(
            relative
                .with_extension("")
                .to_string_lossy()
                .replace(['/', '\\'], "."),
        );
    }
    modules.sort();
    if modules.is_empty() {
        return Err(PrismError::new(
            "PP4002",
            "no generated Lean modules were staged",
        ));
    }
    let runtime =
        crate::lean_project::stage_runtime(workspace, generated.iter().map(Vec::as_slice))?;
    let lakefile = crate::lean_project::configuration(
        "prismpm_verify",
        &crate::lean_project::roots(&runtime, &modules),
    );
    write(&workspace.join("lakefile.toml"), lakefile.as_bytes())?;
    write(
        &workspace.join("lean-toolchain"),
        b"leanprover/lean4:v4.32.1\n",
    )?;

    let lake = toolchain.lake;
    let rustfmt = toolchain.rustfmt;
    let rustc = toolchain.rustc;
    let no_env = BTreeMap::new();
    let mut processes = toolchain.records;
    processes.push(run_native_compilation(
        NativeCompilation::Library,
        &lake,
        &["build".to_owned(), "PrismGenerated".to_owned()],
        workspace,
        &replacements,
        "PP5001",
    )?);
    for module in &modules {
        processes.push(run_process(
            "leanchecker",
            &lake,
            &["env".to_owned(), "leanchecker".to_owned(), module.clone()],
            workspace,
            &no_env,
            &replacements,
            "PP5002",
        )?);
    }
    crate::exporter::before_first_build(
        &controller.root,
        &lean_package,
        &exporter_acquisition,
        &admitted.snapshot,
    )?;
    processes.push(run_process(
        "lean4-prod-build",
        &lake,
        &["build".to_owned(), "prod-export".to_owned()],
        &lean_package,
        &no_env,
        &replacements,
        "PP5004",
    )?);
    let lean_path = workspace.join(".lake/build/lib/lean");
    let export_custody =
        crate::exporter::after_build(&lean_package, &exporter_acquisition, &admitted.snapshot)?;
    let mut export_env = BTreeMap::new();
    export_env.insert(
        "LEAN_PATH".to_owned(),
        lean_path.to_string_lossy().into_owned(),
    );
    let export_once =
        |name: &str, processes: &mut Vec<ProcessRecord>| -> Result<PathBuf, PrismError> {
            let out = workspace.join(name);
            let mut args = vec![
                "exe".to_owned(),
                "prod-export".to_owned(),
                "--module".to_owned(),
                roots.lean_module.clone(),
            ];
            for root in &export_roots {
                args.push("--root".to_owned());
                args.push(root.clone());
            }
            args.extend([
                "--ir-module".to_owned(),
                roots.ir_module.clone(),
                "--out".to_owned(),
                out.to_string_lossy().into_owned(),
            ]);
            processes.push(crate::exporter::run_export_with_custody(
                "prod-export",
                &lake,
                &args,
                &lean_package,
                &export_env,
                &replacements,
                "PP5004",
                &exporter_acquisition,
                &export_custody,
            )?);
            Ok(out)
        };
    let export_a = export_once("export-a", &mut processes)?;
    let export_b = export_once("export-b", &mut processes)?;
    for name in ["kernel.ir", "roots.json", "coverage.json"] {
        let left = std::fs::read(export_a.join(name))
            .map_err(|error| PrismError::new("PP5004", format!("{name}: {error}")))?;
        let right = std::fs::read(export_b.join(name))
            .map_err(|error| PrismError::new("PP5004", format!("{name}: {error}")))?;
        if left != right {
            return Err(PrismError::new(
                "PP5004",
                format!("{name} is not deterministic"),
            ));
        }
    }
    let coverage: Value = serde_json::from_slice(
        &std::fs::read(export_a.join("coverage.json"))
            .map_err(|error| PrismError::new("PP5004", format!("coverage: {error}")))?,
    )
    .map_err(|error| PrismError::new("PP5004", format!("coverage: {error}")))?;
    validate_coverage(&coverage, &export_roots)?;
    let kernel = std::fs::read_to_string(export_a.join("kernel.ir"))
        .map_err(|error| PrismError::new("PP5004", format!("kernel.ir: {error}")))?;
    let module = parse_kernel(&kernel)?;
    let generated_a = prod_codegen::generate_module(&module)
        .map_err(|error| PrismError::new("PP5005", error.to_string()))?;
    let generated_b = prod_codegen::generate_module(&module)
        .map_err(|error| PrismError::new("PP5005", error.to_string()))?;
    if generated_a != generated_b {
        return Err(PrismError::new(
            "PP5005",
            "Rust generation is not deterministic",
        ));
    }
    let generated_path = workspace.join("generated.rs");
    let harness_path = workspace.join("harness.rs");
    write(&generated_path, generated_a.as_bytes())?;
    write(
        &harness_path,
        harness(&model, &corpus, &corpus_sha256).as_bytes(),
    )?;
    processes.push(run_process(
        "rustfmt",
        &rustfmt,
        &[
            "--edition".to_owned(),
            "2021".to_owned(),
            generated_path.to_string_lossy().into_owned(),
            harness_path.to_string_lossy().into_owned(),
        ],
        workspace,
        &no_env,
        &replacements,
        "PP5005",
    )?);
    let executable_path = workspace.join("validator");
    let allocator_rlib = workspace.join("libprod_alloc_counter.rlib");
    let allocator_source = workspace.join("prod_alloc_counter.rs");
    write(&allocator_source, ALLOCATION_COUNTER_SOURCE.as_bytes())?;
    processes.push(run_process(
        "rustc-allocation-counter",
        &rustc,
        &[
            "--edition".to_owned(),
            "2021".to_owned(),
            "--crate-name".to_owned(),
            "prod_alloc_counter".to_owned(),
            "--crate-type".to_owned(),
            "lib".to_owned(),
            "-C".to_owned(),
            "codegen-units=1".to_owned(),
            "-C".to_owned(),
            "debuginfo=0".to_owned(),
            format!(
                "--remap-path-prefix={}=$STAGING",
                workspace.to_string_lossy()
            ),
            allocator_source.to_string_lossy().into_owned(),
            "-o".to_owned(),
            allocator_rlib.to_string_lossy().into_owned(),
        ],
        workspace,
        &no_env,
        &replacements,
        "PP5005",
    )?);
    processes.push(run_process(
        "rustc",
        &rustc,
        &[
            "--edition".to_owned(),
            "2021".to_owned(),
            "-C".to_owned(),
            "opt-level=3".to_owned(),
            "-C".to_owned(),
            "debug-assertions=yes".to_owned(),
            "-C".to_owned(),
            "codegen-units=1".to_owned(),
            "-C".to_owned(),
            "debuginfo=0".to_owned(),
            "-C".to_owned(),
            "strip=symbols".to_owned(),
            "-C".to_owned(),
            "link-arg=-Wl,--build-id=none".to_owned(),
            format!(
                "--remap-path-prefix={}=$STAGING",
                workspace.to_string_lossy()
            ),
            "--extern".to_owned(),
            format!("prod_alloc_counter={}", allocator_rlib.to_string_lossy()),
            harness_path.to_string_lossy().into_owned(),
            "-o".to_owned(),
            executable_path.to_string_lossy().into_owned(),
        ],
        workspace,
        &no_env,
        &replacements,
        "PP5005",
    )?);
    let first = run_process(
        "generated-validator",
        &executable_path,
        &[],
        workspace,
        &no_env,
        &replacements,
        "PP5006",
    )?;
    let second = run_process(
        "generated-validator",
        &executable_path,
        &[],
        workspace,
        &no_env,
        &replacements,
        "PP5006",
    )?;
    if first.stdout != second.stdout || first.stderr != second.stderr {
        return Err(PrismError::new(
            "PP5006",
            "execution evidence is not deterministic",
        ));
    }
    let execution: Value = serde_json::from_str(first.stdout.trim())
        .map_err(|error| PrismError::new("PP5006", format!("execution output: {error}")))?;
    validate_execution(&execution, &corpus, &corpus_sha256)?;
    let execution_bytes = encode_value(&execution)?;
    processes.push(first);
    processes.push(second);

    let artifact = |path: &Path| -> Result<Value, PrismError> {
        Ok(json!({
            "byte_length": std::fs::metadata(path).map_err(|error| PrismError::new("PP4002", error.to_string()))?.len(),
            "sha256": hash_file(path)?
        }))
    };
    let process_value = serde_json::to_value(&processes)
        .map_err(|error| PrismError::new("PP9001", error.to_string()))?;
    let manifest = json!({
        "artifacts": {
            "coverage": artifact(&export_a.join("coverage.json"))?,
            "executable": artifact(&executable_path)?,
            "execution_corpus": {"byte_length": EXECUTION_CORPUS_SOURCE.len(), "sha256": corpus_sha256},
            "execution_evidence": {"byte_length": execution_bytes.len(), "sha256": format!("{:x}", Sha256::digest(&execution_bytes))},
            "generated_rust": artifact(&generated_path)?,
            "model": {"byte_length": model_bytes.len(), "sha256": content_id(&model_bytes)},
            "kernel_ir": artifact(&export_a.join("kernel.ir"))?,
            "lexlean_attestation": {"byte_length": lex_attestation.len(), "sha256": format!("{:x}", Sha256::digest(&lex_attestation))},
            "roots": artifact(&export_a.join("roots.json"))?,
            "stdlib_exports": {"byte_length": STDLIB_EXPORTS_SOURCE.len(), "sha256": package_exports_sha256}
        },
        "build_id": build.build_id,
        "execution": execution,
        "lexlean_attestation_id": lex_attestation_id,
        "processes": process_value,
        "export_roots": export_roots,
        "package_export_roots": package_roots,
        "runtime_roots": roots.roots,
        "schema": "prismpm/verification-manifest/2"
    });
    let manifest_bytes = encode_value(&manifest)?;
    let attestation_id = content_id(&manifest_bytes);
    let files = vec![
        (
            "coverage.json".to_owned(),
            std::fs::read(export_a.join("coverage.json"))
                .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
        ),
        (
            "execution-corpus.toml".to_owned(),
            EXECUTION_CORPUS_SOURCE.as_bytes().to_vec(),
        ),
        ("execution.json".to_owned(), execution_bytes),
        (
            "generated.rs".to_owned(),
            std::fs::read(&generated_path)
                .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
        ),
        (
            "validator".to_owned(),
            std::fs::read(&executable_path)
                .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
        ),
        (
            "kernel.ir".to_owned(),
            std::fs::read(export_a.join("kernel.ir"))
                .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
        ),
        ("lexlean-attestation.json".to_owned(), lex_attestation),
        ("manifest.json".to_owned(), manifest_bytes),
        (
            "stdlib-exports.toml".to_owned(),
            STDLIB_EXPORTS_SOURCE.as_bytes().to_vec(),
        ),
        (
            "roots.json".to_owned(),
            std::fs::read(export_a.join("roots.json"))
                .map_err(|error| PrismError::new("PP4002", error.to_string()))?,
        ),
    ];
    work.protect_verified_package(&lean_package, &export_custody)?;
    work.close()?;
    publish(&output_root, &attestation_id, &files)?;
    Ok(VerifyResult {
        schema: "prismpm/verify-result/1".to_owned(),
        attestation_id: attestation_id.clone(),
        build_id: build.build_id,
        verified_root: format!("{}/verified/{attestation_id}", config.build_root),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn text_v2_resource_bounds_native_harness_tracks_entry_effect() {
        let checked_ir = r#"(module HarnessEffect
          (def checked ((count Nat)) Nat (add count 18446744073709551615))
          (def dispatch ((input Bytes)) Bytes
            (if (eq (call checked (length input)) 18446744073709551615)
              (bytes 65) input)))"#;
        let infallible_ir = r#"(module HarnessEffect
          (def unusedChecked ((count Nat)) Nat (add count 18446744073709551615))
          (def dispatch ((input Bytes)) Bytes input))"#;
        for (name, ir, request, response, expected_failure) in [
            ("checked-success", checked_ir, vec![], vec![65], None),
            (
                "checked-overflow",
                checked_ir,
                vec![1],
                vec![1],
                Some("Err(AddOverflow)"),
            ),
            (
                "checked-wrong-response",
                checked_ir,
                vec![],
                vec![66],
                Some("acceptance vector 0"),
            ),
            (
                "unrelated-checked-definition",
                infallible_ir,
                vec![7],
                vec![7],
                None,
            ),
        ] {
            let module = parse_kernel(ir).unwrap();
            let mut fixture: Value = serde_json::from_slice(include_bytes!(
                "../../../tests/data/text-model-document.json"
            ))
            .unwrap();
            fixture["application"]["cargo_name"] = json!("harness-effect");
            fixture["application"]["entry_root"] = json!("HarnessEffect.dispatch");
            fixture["application"]["acceptance_vectors"] =
                json!([{ "request": request, "response": response }]);
            // Package metadata comes from the shared fixture so this
            // network-free module carries no endpoint literal (VR-09).
            let repository = fixture["application"]["cargo_repository"]
                .as_str()
                .unwrap()
                .to_owned();
            let homepage = fixture["application"]["cargo_homepage"]
                .as_str()
                .unwrap()
                .to_owned();
            let fixture: crate::holo::model_document::ModelDocument =
                serde_json::from_value(fixture).unwrap();
            let application = fixture.application.as_ref().unwrap();
            let package = prod_codegen::generate_cargo_package(
                &module,
                &prod_codegen::CargoPackageSpec {
                    name: "harness-effect".to_owned(),
                    version: "0.1.0".to_owned(),
                    description: "Generated native entry-effect regression".to_owned(),
                    repository,
                    homepage,
                    readme: "Generated native entry-effect regression.\n".to_owned(),
                    license_mit: include_str!("../../../LICENSE-MIT").to_owned(),
                    license_apache: include_str!("../../../LICENSE-APACHE").to_owned(),
                    input_sha256: format!("{:x}", Sha256::digest(ir.as_bytes())),
                    dependencies: vec![],
                },
            )
            .unwrap();
            let library = &package
                .files
                .iter()
                .find(|file| file.path == "src/lib.rs")
                .unwrap()
                .bytes;
            let directory = tempfile::tempdir().unwrap();
            let root = directory.path();
            write(&root.join("lib.rs"), library).unwrap();
            let harness = application_harness(application, &module).unwrap();
            if name == "unrelated-checked-definition" {
                assert_eq!(harness, "fn main() {\n    assert_eq!(harness_effect::dispatch(vec![7]), vec![7], \"acceptance vector 0\");\n}\n");
            }
            write(&root.join("consumer.rs"), harness.as_bytes()).unwrap();
            let rustc = executable("rustc").unwrap();
            let no_env = BTreeMap::new();
            let replacements = [(root, "$HARNESS_TEST")];
            run_process(
                "native-harness-core",
                &rustc,
                &[
                    "--edition=2021".to_owned(),
                    "--crate-type=rlib".to_owned(),
                    "--crate-name=harness_effect".to_owned(),
                    "lib.rs".to_owned(),
                    "-o".to_owned(),
                    "libharness_effect.rlib".to_owned(),
                ],
                root,
                &no_env,
                &replacements,
                "PP6003",
            )
            .unwrap();
            run_process(
                "native-harness-consumer",
                &rustc,
                &[
                    "--edition=2021".to_owned(),
                    "consumer.rs".to_owned(),
                    "--extern=harness_effect=libharness_effect.rlib".to_owned(),
                    "-o".to_owned(),
                    "consumer".to_owned(),
                ],
                root,
                &no_env,
                &replacements,
                "PP6003",
            )
            .unwrap();
            let execution = run_process(
                "native-harness-corpus",
                &root.join("consumer"),
                &[],
                root,
                &no_env,
                &replacements,
                "PP6003",
            );
            if let Some(expected) = expected_failure {
                let error = execution.unwrap_err();
                assert_eq!(error.code, "PP6003");
                assert!(error.message.contains(expected), "{name}: {error:?}");
            } else {
                execution.unwrap();
            }
        }
    }

    #[test]
    fn application_regeneration_requires_every_identical_artifact() {
        let root = tempfile::tempdir().unwrap();
        let artifacts = vec![
            ("first".to_owned(), b"actual first".to_vec()),
            ("second".to_owned(), b"actual second".to_vec()),
        ];
        for (path, bytes) in &artifacts {
            std::fs::write(root.path().join(path), bytes).unwrap();
        }
        let paths = artifacts
            .iter()
            .map(|(path, _)| path.clone())
            .collect::<BTreeSet<_>>();
        verify_regenerated_artifacts(root.path(), &paths, &artifacts).unwrap();
        for mode in ["missing", "extra", "changed", "duplicate"] {
            let mut changed = artifacts.clone();
            match mode {
                "missing" => {
                    changed.pop();
                }
                "extra" => changed.push(("unbound".to_owned(), vec![1])),
                "changed" => changed[0].1.push(0),
                "duplicate" => changed.push(changed[0].clone()),
                _ => unreachable!(),
            }
            assert_eq!(
                verify_regenerated_artifacts(root.path(), &paths, &changed)
                    .unwrap_err()
                    .code,
                "PP5004",
                "{mode}"
            );
        }
    }

    #[test]
    fn package_exports_are_closed_and_do_not_change_runtime_accounting() {
        let (runtime, corpus, _) = corpus();
        let package = package_export_roots(STDLIB_EXPORTS_SOURCE, &runtime).unwrap();
        assert_eq!(package.len(), 66);
        let union = runtime
            .roots
            .iter()
            .chain(&package)
            .collect::<BTreeSet<_>>();
        assert_eq!(union.len(), runtime.roots.len() + package.len());
        assert_eq!(corpus.case_count, 597);
        assert_eq!(corpus.control_coverage.case_count, 54);
        for index in 0..package.len() {
            for field in ["rust_signature", "lean_name"] {
                let mut value: toml::Value = toml::from_str(STDLIB_EXPORTS_SOURCE).unwrap();
                let replacement = if field == "rust_signature" {
                    "fn(Vec<u8>) -> bool".to_owned()
                } else {
                    format!(
                        "PrismPM.Foundation.Other.{}",
                        value["export"][index]["rust_name"].as_str().unwrap()
                    )
                };
                assert_ne!(value["export"][index][field].as_str().unwrap(), replacement);
                value["export"][index][field] = replacement.into();
                assert_eq!(
                    package_export_roots(&toml::to_string(&value).unwrap(), &runtime)
                        .unwrap_err()
                        .code,
                    "PP9001",
                    "substituted {field} at export {index}"
                );
            }
        }
        for mutation in 0..11 {
            let mut value: toml::Value = toml::from_str(STDLIB_EXPORTS_SOURCE).unwrap();
            match mutation {
                0 => {
                    value["export"].as_array_mut().unwrap().pop();
                }
                1 => value["export"][1] = value["export"][0].clone(),
                2 => value["lean_module"] = "Other.Module".into(),
                3 => {
                    value
                        .as_table_mut()
                        .unwrap()
                        .insert("extra".into(), true.into());
                }
                4 => {
                    value["export"][0]
                        .as_table_mut()
                        .unwrap()
                        .insert("extra".into(), true.into());
                }
                5 => value["export"][0]["rust_name"] = "wrongSymbol".into(),
                6 => {
                    value["export"][54]["lean_name"] =
                        "PrismPM.Foundation.PublicationAdmission.LinkageV1Wire.publicationLinkageWireBytes".into();
                }
                7 => value["export"][55]["rust_signature"] = "fn() -> Vec<u8>".into(),
                8 => {
                    value["export"][56]["lean_name"] =
                        "PrismPM.Production.Other.publicationWireBytes".into();
                }
                9 => {
                    value["export"][56]["lean_name"] =
                        "PrismPM.Production.PublicationAdmission.V1Wire.unregistered".into();
                    value["export"][56]["rust_name"] = "unregistered".into();
                }
                10 => {
                    value["export"][56]["lean_name"] = "PrismPM.Foundation.Z.unregistered".into();
                    value["export"][56]["rust_name"] = "unregistered".into();
                    value["export"]
                        .as_array_mut()
                        .unwrap()
                        .sort_by_key(|row| row["lean_name"].as_str().unwrap().to_owned());
                }
                _ => unreachable!(),
            }
            assert_eq!(
                package_export_roots(&toml::to_string(&value).unwrap(), &runtime)
                    .unwrap_err()
                    .code,
                "PP9001",
                "mutation {mutation}"
            );
        }
    }

    fn corpus() -> (RuntimeRoots, ExecutionCorpus, String) {
        let roots: RuntimeRoots = toml::from_str(ROOTS_SOURCE).expect("runtime roots");
        let (corpus, sha256) = execution_corpus(&roots).expect("execution corpus");
        (roots, corpus, sha256)
    }

    fn limited_with_code(
        program: &str,
        args: &[&str],
        timeout: &str,
        output: usize,
        code: &'static str,
    ) -> PrismError {
        let program = executable(program).expect("test utility is installed");
        run_process_limited(
            "test-child",
            &program,
            &args
                .iter()
                .map(|value| (*value).to_owned())
                .collect::<Vec<_>>(),
            Path::new("/tmp"),
            &BTreeMap::new(),
            &[],
            code,
            timeout,
            output,
        )
        .expect_err("child must fail")
    }

    fn limited(program: &str, args: &[&str], timeout: &str, output: usize) -> PrismError {
        limited_with_code(program, args, timeout, output, "PP5001")
    }

    #[test]
    fn native_compile_deadline_is_owned_and_other_phase_budgets_stay_closed() {
        let node = executable("node").unwrap();
        let observe = r#"process.stdout.write(JSON.stringify(require('node:fs').readFileSync('/proc/'+process.ppid+'/cmdline','utf8').split('\0').slice(1,4)))"#;
        for phase in [NativeCompilation::Library, NativeCompilation::Application] {
            let record = run_native_compilation(
                phase,
                &node,
                &["-e".to_owned(), observe.to_owned()],
                Path::new("/tmp"),
                &[],
                "PP5001",
            )
            .unwrap();
            let actual: Value = serde_json::from_str(&record.stdout).unwrap();
            assert_eq!(actual, json!(["--signal=TERM", "--kill-after=5", "600"]));
        }
        for (tool, budget, expected) in [
            ("leanchecker", CHILD_TIMEOUT_SECONDS, "300"),
            (
                "hologram-oracle-build",
                HOLOGRAM_ORACLE_BUILD_TIMEOUT_SECONDS,
                "900",
            ),
            (
                "hologram-oracle",
                HOLOGRAM_ORACLE_RUN_TIMEOUT_SECONDS,
                "600",
            ),
        ] {
            let record = run_process_limited(
                "native-deadline-policy-observer",
                &node,
                &["-e".to_owned(), observe.to_owned()],
                Path::new("/tmp"),
                &BTreeMap::new(),
                &[],
                "PP5001",
                budget,
                CHILD_OUTPUT_LIMIT,
            )
            .unwrap();
            let actual: Value = serde_json::from_str(&record.stdout).unwrap();
            assert_eq!(
                actual,
                json!(["--signal=TERM", "--kill-after=5", expected]),
                "{tool}"
            );
        }
    }

    #[test]
    fn child_output_overflow_is_a_registered_failure() {
        let error = limited("head", &["-c", "64", "/dev/zero"], "5", 16);
        assert_eq!(error.code, "PP5007");
        assert_eq!(error.message, "test-child output limit exceeded");
    }

    #[test]
    fn lake_success_output_discards_parallel_job_numbers() {
        let left = "Build completed successfully (2 jobs).\n✔ [1/2] Built B (1.2s)\n✔ [2/2] Built A (500ms)\n";
        let right = "✔ [1/2] Built A (800ms)\nBuild completed successfully (2 jobs).\n✔ [2/2] Built B (900ms)\n";
        assert_eq!(
            stable_success_output("lake-build-generated", left.to_owned()),
            stable_success_output("lake-build-generated", right.to_owned())
        );
    }

    #[test]
    fn cargo_success_output_discards_elapsed_time_only() {
        let left = "    Finished `test` profile in 0.22s\nsubstantive output\n";
        let right = "    Finished `test` profile in 19.75s\nsubstantive output\n";
        assert_eq!(
            stable_success_output("application-package-test", left.to_owned()),
            stable_success_output("application-package-test", right.to_owned())
        );
        assert!(
            stable_success_output("application-package-test", left.to_owned())
                .contains("substantive output")
        );
    }

    #[test]
    fn child_timeout_terminates_the_process_tree() {
        let error = limited("sleep", &["2"], "0.05", 16);
        assert_eq!(error.code, "PP5007");
        assert_eq!(error.message, "test-child timed out");
        assert_eq!(error.notes[0].message, "observed process exit code: 124");
        assert_eq!(error.notes[1].message, "stdout: ");
        assert_eq!(error.notes[2].message, "stderr: ");
    }

    #[test]
    fn child_timeout_preserves_both_actual_progress_streams() {
        let error = limited(
            "sh",
            &["-c", "printf 'first stdout\\nlast stdout\\n'; printf 'first stderr\\nlast stderr\\n' >&2; sleep 2"],
            "1",
            128,
        );
        assert_eq!(error.code, "PP5007");
        assert_eq!(error.message, "test-child timed out");
        assert_eq!(error.notes.len(), 4);
        assert_eq!(
            error.notes[1].message,
            "stdout: first stdout\nlast stdout\n"
        );
        assert_eq!(
            error.notes[2].message,
            "stderr: first stderr\nlast stderr\n"
        );
        assert_eq!(
            error.notes[3].message,
            format!(
                "normalized child streams: stdout_bytes=25, stdout_sha256={:x}; stderr_bytes=25, stderr_sha256={:x}",
                Sha256::digest(b"first stdout\nlast stdout\n"),
                Sha256::digest(b"first stderr\nlast stderr\n")
            )
        );
        assert!(error.notes.iter().all(|note| note.span.is_none()));
    }

    #[test]
    fn failed_process_excerpts_are_bounded_at_utf8_boundaries() {
        for value in [
            String::new(),
            "x".repeat(4096),
            format!("start{}end", "é🙂".repeat(2000)),
        ] {
            let excerpt = failure_excerpt(&value);
            if value.len() <= 4096 {
                assert_eq!(excerpt, value);
            } else {
                assert!(excerpt.starts_with("start"));
                assert!(excerpt.ends_with("end"));
                assert!(excerpt.len() < 4160);
                assert!(excerpt.contains(" bytes omitted]\n"));
            }
        }
    }

    #[test]
    fn child_lean_thread_policy_cannot_be_overridden_by_extra_environment() {
        let root = tempfile::tempdir().unwrap();
        for environment in [
            BTreeMap::new(),
            BTreeMap::from([("LEAN_NUM_THREADS".to_owned(), "9999".to_owned())]),
        ] {
            let result = run_process_limited(
                "test-lean-thread-policy",
                &executable("printenv").unwrap(),
                &["LEAN_NUM_THREADS".to_owned()],
                root.path(),
                &environment,
                &[],
                "PP5001",
                "5",
                64,
            )
            .unwrap();
            assert_eq!(result.stdout, "2\n");
            assert_eq!(result.exit_code, 0);
        }
    }

    #[test]
    fn child_nonzero_exit_uses_the_stage_diagnostic() {
        let error = limited("false", &[], "5", 16);
        assert_eq!(error.code, "PP5001");
        assert!(error.message.contains("exited 1"));
    }

    #[test]
    fn every_external_verification_stage_preserves_its_registered_code() {
        for code in ["PP5001", "PP5002", "PP5004", "PP5005", "PP5006"] {
            let error = limited_with_code("false", &[], "5", 16, code);
            assert_eq!(error.code, code);
            assert!(error.message.contains("exited 1"));
        }
    }

    #[test]
    fn verification_toolchain_preflight_matches_pinned_bytes_and_versions() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
        let tools = preflight_toolchain(&root, &[]).expect("pinned devcontainer");
        assert_eq!(tools.records.len(), 5);
        assert_eq!(
            tools
                .records
                .iter()
                .map(|record| record.tool.as_str())
                .collect::<Vec<_>>(),
            [
                "lean-version",
                "lake-version",
                "rustfmt-version",
                "rustc-version",
                "timeout-version",
            ]
        );
    }

    #[test]
    fn semantic_axiom_mismatch_is_rejected_exactly() {
        let (_, corpus, _) = corpus();
        let snapshot = json!({
            "modules": [{
                "declarations": [{
                    "axiom_policy": {"axioms": [], "kind": "none"},
                    "kind": "theorem",
                    "lean_name": "canonicalIndexAssignmentUnique"
                }],
                "lean_module": "PrismPM.Foundation.Holo"
            }]
        });
        let error = validate_lexlean_declarations(
            &json!({
                "declarations": [{
                    "name": "PrismPM.Foundation.Holo.canonicalIndexAssignmentUnique",
                    "observed": ["propext"],
                    "policy": {"axioms": [], "kind": "none"},
                    "result": "ok"
                }]
            }),
            &snapshot,
            &corpus,
        )
        .unwrap_err();
        assert_eq!(error.code, "PP5003");
        assert!(error.message.contains("nonempty axiom audit"));

        let error = validate_lexlean_declarations(&json!({"declarations": []}), &snapshot, &corpus)
            .unwrap_err();
        assert_eq!(error.code, "PP5003");
        assert_eq!(
            error.message,
            "Prism declaration PrismPM.Foundation.Holo.canonicalIndexAssignmentUnique has no axiom audit"
        );
    }

    #[test]
    fn semantic_definition_may_use_its_exact_registered_axioms() {
        let (_, mut corpus, _) = corpus();
        corpus.oracle.clear();
        let snapshot = json!({
            "modules": [{
                "declarations": [{
                    "axiom_policy": {"axioms": ["propext"], "kind": "exact"},
                    "kind": "definition",
                    "lean_name": "compareBytes"
                }],
                "lean_module": "PrismPM.Foundation.Bytes"
            }]
        });
        validate_lexlean_declarations(
            &json!({
                "declarations": [{
                    "name": "PrismPM.Foundation.Bytes.compareBytes",
                    "observed": ["propext"],
                    "policy": {"axioms": ["propext"], "kind": "exact"},
                    "result": "ok"
                }]
            }),
            &snapshot,
            &corpus,
        )
        .expect("an exact, snapshot-bound definition policy is accepted");
    }

    #[test]
    fn named_export_coverage_rejects_each_gap_class() {
        let roots = vec!["PrismPM.Foundation.Holo.validateComponentIndexes".to_owned()];
        let valid = || {
            json!({
                "erased_proof_dependencies": [],
                "external_calls": [],
                "included_definitions": roots,
                "opaque_nodes": [],
                "requested_roots": roots,
                "unsupported_types": []
            })
        };
        validate_coverage(&valid(), &roots).expect("closed coverage");
        for field in [
            "erased_proof_dependencies",
            "external_calls",
            "opaque_nodes",
            "unsupported_types",
        ] {
            let mut value = valid();
            value[field] = json!(["planted-gap"]);
            let error = validate_coverage(&value, &roots).unwrap_err();
            assert_eq!(error.code, "PP5004");
            assert_eq!(error.message, "named export coverage is unacceptable");
        }
        let mut value = valid();
        value["requested_roots"] = json!([]);
        assert_eq!(
            validate_coverage(&value, &roots).unwrap_err().code,
            "PP5004"
        );
    }

    #[test]
    fn malformed_or_trailing_lcnf_is_rejected() {
        assert_eq!(parse_kernel("not lcnf").unwrap_err().code, "PP5004");
        let valid = "(module Test)";
        parse_kernel(valid).expect("minimal valid LCNF module");
        let error = parse_kernel(&format!("{valid}\ntrailing")).unwrap_err();
        assert_eq!(error.code, "PP5004");
        assert_eq!(error.message, "kernel.ir has trailing syntax");
    }

    #[test]
    fn malformed_execution_output_is_rejected() {
        let (_, corpus, sha256) = corpus();
        let error = validate_execution(&json!({"status": "passed"}), &corpus, &sha256).unwrap_err();
        assert_eq!(error.code, "PP5006");
    }

    #[test]
    fn execution_requires_exact_control_coverage_accounting() {
        let (_, corpus, sha256) = corpus();
        let valid = json!({
            "bounds": {"max_length": 16, "value_domain": "u64"},
            "case_count": 597,
            "control_coverage": {"case_count": 54, "positive": 6, "negative": 48, "status": "passed"},
            "corpus_sha256": sha256,
            "no_allocation": true,
            "no_panic": true,
            "schema": "prismpm/execution-evidence/2",
            "seed": "5eedcafef00dbeef",
            "shrink_result": "not-applicable-passed",
            "status": "passed",
            "strategy": "exhaustive-v1+lcg-v1"
        });
        validate_execution(&valid, &corpus, &sha256)
            .expect("both executed corpora are accounted for");
        let mut old_version = valid.clone();
        old_version["schema"] = json!("prismpm/execution-evidence/1");
        assert_eq!(
            validate_execution(&old_version, &corpus, &sha256)
                .unwrap_err()
                .code,
            "PP5006"
        );
        let mut missing = valid.clone();
        missing.as_object_mut().unwrap().remove("control_coverage");
        assert_eq!(
            validate_execution(&missing, &corpus, &sha256)
                .unwrap_err()
                .code,
            "PP5006"
        );
        for (field, replacement) in [
            ("case_count", json!(53)),
            ("positive", json!(7)),
            ("negative", json!(47)),
            ("status", json!("not-run")),
            ("unchecked", json!(true)),
        ] {
            let mut changed = valid.clone();
            changed["control_coverage"][field] = replacement;
            assert_eq!(
                validate_execution(&changed, &corpus, &sha256)
                    .unwrap_err()
                    .code,
                "PP5006",
                "{field}"
            );
        }
    }

    #[test]
    fn execution_corpus_is_typed_counted_and_root_complete() {
        let (roots, corpus, sha256) = corpus();
        assert_eq!(corpus.case_count, 597);
        assert_eq!(corpus.exhaustive.case_count, 85);
        assert_eq!(corpus.property.case_count, 512);
        assert_eq!(sha256.len(), 64);
        assert_eq!(
            corpus.oracle.iter().filter(|row| row.runtime_root).count(),
            roots.roots.len()
        );
    }

    #[test]
    fn execution_rejects_invented_or_short_circuited_control_case_counts() {
        let (_, corpus, _) = corpus();
        let mut declarations = Vec::new();
        let mut aggregate = json!({"kind":"bool","value":true});
        for index in (0..54).rev() {
            let name = format!("coverageCase{index}");
            let call = json!({"kind":"call","function":{"name":name},"arguments":[]});
            let expected = index < 6;
            aggregate = json!({"kind":"and","left":if expected {call.clone()} else {json!({"kind":"not","value":call.clone()})},"right":aggregate});
            declarations.push(json!({"kind":"definition","name":name,"body":{"kind":"call","function":{"module":"Production.ControlCoverage","name":"validateControlCoverage"},"arguments":[{},{}]}}));
            declarations.push(json!({"kind":"theorem","name":format!("{name}Expected"),"statement":{"kind":"eq","left":call,"right":{"kind":"bool","value":expected}}}));
        }
        declarations
            .push(json!({"kind":"definition","name":"coverageCorpusPassed","body":aggregate}));
        let valid = json!({"modules":[{"name":"Production.ControlCoverageCorpus","semantic":{"declarations":declarations}}]});
        validate_control_coverage_corpus(&valid, &corpus).unwrap();
        for mutation in 0..6 {
            let mut changed = valid.clone();
            let rows = changed["modules"][0]["semantic"]["declarations"]
                .as_array_mut()
                .unwrap();
            match mutation {
                0 => {
                    rows.remove(0);
                }
                1 => {
                    rows[0]["body"] = json!({"kind":"bool","value":true});
                }
                2 => {
                    rows[108]["body"]["kind"] = json!("or");
                }
                3 => {
                    rows[108]["body"]["right"] = json!({"kind":"bool","value":true});
                }
                4 => {
                    rows[2]["name"] = rows[0]["name"].clone();
                }
                5 => {
                    rows[1]["statement"]["right"]["value"] = json!(true);
                }
                _ => unreachable!(),
            }
            assert_eq!(
                validate_control_coverage_corpus(&changed, &corpus)
                    .unwrap_err()
                    .code,
                "PP5006",
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn failed_verification_publication_leaves_no_attestation_directory() {
        let temp = tempfile::tempdir().unwrap();
        let files = vec![
            ("conflict".to_owned(), b"file".to_vec()),
            ("conflict/child".to_owned(), b"child".to_vec()),
        ];
        let error = publish(temp.path(), "planted-partial-publication", &files).unwrap_err();
        assert_eq!(error.code, "PP4002");
        assert!(!temp
            .path()
            .join("verified/planted-partial-publication")
            .exists());
    }

    #[test]
    fn verification_reuse_rejects_an_unmanifested_directory() {
        let temp = tempfile::tempdir().unwrap();
        let files = vec![("manifest.json".to_owned(), b"manifest".to_vec())];
        publish(temp.path(), "existing", &files).expect("first publication");
        std::fs::create_dir(temp.path().join("verified/existing/extra")).unwrap();
        let error = publish(temp.path(), "existing", &files).unwrap_err();
        assert_eq!(error.code, "PP4001");
        assert_eq!(
            error.message,
            "verified artifact set differs from its manifest"
        );
    }
}
