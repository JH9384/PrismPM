//! Execution of exact, imported upstream standards conformance assets.

mod blake3_corpus;

/// Execute the complete pinned BLAKE3 vector corpus and its mutation controls.
/// This finite adapter qualification is not cryptographic proof or storage acceptance.
pub fn verify_blake3_corpus(corpus: &std::path::Path) -> Result<CorpusEvidence, crate::PrismError> {
    blake3_corpus::verify(corpus)
}

/// Validate complete Hologram and actual portable-browser execution evidence.
///
/// This is the same fail-closed PP5301 check used by application verification;
/// validating a document alone does not authenticate or execute its producer.
pub fn validate_hologram_oracle_report(
    report: &serde_json::Value,
    application: &crate::holo::model_document::Application,
    identities: &serde_json::Value,
) -> Result<(), crate::error::PrismError> {
    crate::verification::validate_hologram_oracle_report(report, application, identities)
}

use crate::error::PrismError;
use base64::Engine;
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::{BTreeSet, HashMap};
use std::fs;
use std::io::Read;
use std::path::Path;
use std::process::{Command, ExitStatus, Stdio};
use std::sync::Arc;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};
use unicode_normalization::UnicodeNormalization;

const DISTRIBUTION_TREE: &str = "c3b22a1cef1975004c948e04005f02c013c02f9698c04da07998e9e13e875acc";
const RUNTIME_TREE: &str = "9bf0da1272040438e13ce349a39a1dd036c3432f82e2cec5b17d2aa7db316e8a";
const JSON_SCHEMA_TREE: &str = "8f63dc2d12ed947bfa4ae4cabab2d5926ecc06d86d054b6a3a4f3454446b5551";
const UNICODE_TREE: &str = "1885ce2b3409b4f2b4a569c378d243f4a75e22fc10d59a69a69a1cacc16dda9e";
const CLOUDEVENTS_TREE: &str = "38480c5a48f73d20b8aa0db8366e22ae4ab34c245a370a11b8862cfbdeb5c6d1";
const ASYNCAPI_TREE: &str = "6bec0a3910568ff84f28b8fd9c2f63e3fcde7986bebf3e24b1f4649c150d735b";
const ASYNCAPI_RUNTIME_LOCK: &str =
    "5bd20ce206d3b3b76a7034951c9e19e15291c54eec0a1424139b465c980f1205";
const ASYNCAPI_ADEO_REQUEST: &str =
    "96c749416552ef404fbfb1f4f894339cb104ffdb06e8694c5045d5aaa79cd020";
const ASYNCAPI_ADEO_RESPONSE: &str =
    "7d2452e4b2db5e7deeab404b071323843f3c9fb7149957f68eeb927970cf0547";
const INTOTO_TREE: &str = "6cbad548e30d2e227d1cea0ee23bb09c06c506c27094ccd8f55137d0bef17371";
const CLOUDEVENTS_FIXTURES_TREE: &str =
    "48aa53d280e5e78275acfff62ae0173ac06fc86af86c379cad693e05e74a7803";
const OCI_IMAGE_TREE: &str = "6c00d78efd45b6a3acc798497851b21585867042cbdc63dbe0c105825b8dac91";
const SPDX_MODEL_TREE: &str = "8db53aa63cfc7565f79e057a4da362d4144c546d56320a51b838befe8371b17d";
const SPDX_SCHEMA_TREE: &str = "e611189a0028aa1ac4bbd2ee3f06c664a39c7351c65e942b3f2b53e4ab1e3212";
const SPDX_FIXTURES_TREE: &str = "2fa271a49fd04807437003e3a2e8d7d39c3b635b4815a72d1ec2f5f216adaaea";
const OTEL_FIXTURES_TREE: &str = "90cdf6a86d9f2f7c9b60f66c9be7c296b394dfef57ac5e28d78965565252f223";
const OPENID_CONFORMANCE_TREE: &str =
    "a35012f67dccd4296ab0e380eb86a0e053dbbf6bf52522aca3ed961c83812197";
const ZOT_IMAGE: &str = "ghcr.io/project-zot/zot@sha256:cd2aea942f428630bcb4190542be6abd35e14177aab84fc7ccad0dca8ecb363d";
const DISTRIBUTION_REFERENCE_IMAGE: &str = "docker.io/library/registry@sha256:a3d8aaa63ed8681a604f1dea0aa03f100d5895b6a58ace528858a7b332415373";

/// Canonical summary emitted only after all upstream positive, negative, and
/// planted-failure probes have executed successfully.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct UpstreamConformanceEvidence {
    /// Stable evidence contract identifier.
    pub schema: &'static str,
    /// Exact SDK image whose packaged oracle binaries/corpora were executed.
    pub sdk_image: String,
    /// Official JSON Schema Test Suite result.
    pub json_schema: CorpusEvidence,
    /// Official Unicode normalization corpus result.
    pub unicode: CorpusEvidence,
    /// Official CloudEvents SDK tests and direct JSON validation.
    pub cloudevents: CorpusEvidence,
    /// Official AsyncAPI published and embedded examples plus declared mutations.
    pub asyncapi: AsyncApiEvidence,
    /// Exact in-toto generated protobuf shape validation.
    pub in_toto: InTotoEvidence,
    /// Official OCI Image schemas/tests plus independent OCI client graph probes.
    pub oci_image: CorpusEvidence,
    /// Official SPDX 3 model/schema validation.
    pub spdx: CorpusEvidence,
    /// Unmodified Collector signal-ingestion result.
    pub opentelemetry: TelemetryEvidence,
    /// Exact official OpenID condition tests for signature, time, and discovery.
    pub openid: CorpusEvidence,
    /// Official OCI Runtime schemas and engine-probe result.
    pub oci_runtime: RuntimeEvidence,
    /// Official OCI Distribution suite result.
    pub oci_distribution: DistributionEvidence,
}

/// Outcome counts for a finite upstream data corpus.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct CorpusEvidence {
    /// Verified digest of the exact imported tree.
    pub corpus_sha256: String,
    /// Upstream cases expected to pass.
    pub positive: u64,
    /// Upstream cases expected to fail.
    pub negative: u64,
    /// Deliberately wrong expectations or data rejected by the harness.
    pub planted_rejections: u64,
    /// Exact pinned implementation executing the upstream corpus.
    pub runner: &'static str,
}

/// AsyncAPI's complete published positive corpus and explicit negative probes.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct AsyncApiEvidence {
    /// Verified digest of the exact pinned AsyncAPI specification repository.
    pub corpus_sha256: String,
    /// Complete documents under the upstream `examples/` directory.
    pub published_documents: u64,
    /// Examples extracted and validated by the unmodified upstream harness.
    pub embedded_examples: u64,
    /// Negative fixtures published by upstream (none at this revision).
    pub upstream_negative_fixtures: u64,
    /// Declared malformed document mutations rejected by the official parser.
    pub negative_mutations: u64,
    /// Wrong-version mutation rejected rather than silently normalized.
    pub planted_rejections: u64,
    /// Exact dynamic parser used for complete documents and mutations.
    pub parser: &'static str,
    /// Exact unmodified upstream harness used for embedded examples.
    pub upstream_runner: &'static str,
}

/// Narrow evidence for the official in-toto Statement 1.0 protobuf surface.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct InTotoEvidence {
    /// Verified digest of the exact pinned in-toto Attestation source tree.
    pub corpus_sha256: String,
    /// Structurally valid JSON instances accepted by the generated protobuf.
    pub positive: u64,
    /// Wrong protobuf wire shapes rejected.
    pub negative: u64,
    /// Unknown-field mutation rejected under strict decoding.
    pub planted_rejections: u64,
    /// Exact upstream schema implementation used by the thin wrapper.
    pub runner: &'static str,
    /// Explicit boundary published in the upstream proto source.
    pub semantic_validation: &'static str,
}

/// OCI Runtime schema fixtures plus unmodified-engine result.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct RuntimeEvidence {
    /// Verified digest of the exact imported tree.
    pub corpus_sha256: String,
    /// Upstream good fixtures accepted.
    pub positive: u64,
    /// Upstream bad fixtures rejected.
    pub negative: u64,
    /// Deliberately inverted fixture classification rejected.
    pub planted_rejections: u64,
    /// Valid engine invocations accepted.
    pub engine_positive: u64,
    /// Invalid engine invocations rejected.
    pub engine_negative: u64,
    /// Docker Engine version that delegated the unmodified OCI invocation.
    pub engine_version: String,
    /// Docker's selected OCI runtime name.
    pub runtime_name: String,
}

/// OCI Distribution official suite result against its isolated subject.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DistributionEvidence {
    /// Verified digest of the exact upstream suite source tree.
    pub corpus_sha256: String,
    /// Immutable registry implementation under test.
    pub subject_images: Vec<&'static str>,
    /// Executed official specifications that passed.
    pub passed: u64,
    /// Executed official specifications that failed.
    pub failed: u64,
    /// Officially disabled specifications reported by the suite.
    pub upstream_skipped: u64,
    /// Raw upstream JUnit reports retained for audit of conditional executions.
    pub raw_reports: Vec<DistributionRawReport>,
    /// Deliberately unavailable subject rejected by the official suite.
    pub planted_rejections: u64,
}

/// One byte-preserved report from an unmodified upstream Distribution run.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct DistributionRawReport {
    /// Repository-relative path of the retained JUnit bytes.
    pub path: String,
    /// Digest of those exact JUnit bytes.
    pub sha256: String,
    /// Immutable registry subject used by this run.
    pub subject_image: &'static str,
    /// Explicit branch/configuration selected for this run.
    pub configuration: &'static str,
    /// Official specs represented in the report, excluding the HTML reporter.
    pub official_total: u64,
    /// Specs executed and passed in this raw run.
    pub passed: u64,
    /// Specs conditionally skipped or excluded by the official harness in this raw run.
    pub skipped: u64,
}

/// Evidence that an unmodified OpenTelemetry Collector received all modeled
/// signal families and rejected malformed OTLP input.
#[derive(Debug, Clone, Serialize)]
#[serde(deny_unknown_fields)]
pub struct TelemetryEvidence {
    /// Verified digest of the committed Collector configuration and OTLP data.
    pub corpus_sha256: String,
    /// Distinct accepted OTLP signal families.
    pub accepted_signals: Vec<&'static str>,
    /// Malformed OTLP requests rejected by the Collector.
    pub negative: u64,
    /// Missing-signal/output mutations rejected by the harness.
    pub planted_rejections: u64,
    /// Exact unmodified Collector executable identity.
    pub runner: &'static str,
}

fn fail(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5404", message)
}

fn unavailable(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5403", message)
}

fn locked_oracle_image(
    root: &Path,
    name: &str,
    compiled_reference: &'static str,
) -> Result<&'static str, PrismError> {
    let bytes = fs::read(root.join("tools.lock"))
        .map_err(|error| unavailable(format!("read tools.lock: {error}")))?;
    let text = std::str::from_utf8(&bytes)
        .map_err(|error| fail(format!("tools.lock is not UTF-8: {error}")))?;
    let lock = toml::from_str::<toml::Value>(text)
        .map_err(|error| fail(format!("parse tools.lock: {error}")))?;
    let locked = lock
        .get("oracle-images")
        .and_then(|table| table.get(name))
        .and_then(toml::Value::as_str)
        .ok_or_else(|| fail(format!("tools.lock has no oracle-images.{name}")))?;
    if locked != compiled_reference {
        return Err(fail(format!(
            "compiled oracle image {compiled_reference} differs from tools.lock oracle-images.{name}={locked}"
        )));
    }
    Ok(compiled_reference)
}

fn regular_tree(root: &Path) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    fn visit(
        root: &Path,
        directory: &Path,
        rows: &mut Vec<(String, Vec<u8>)>,
    ) -> Result<(), PrismError> {
        let mut entries = fs::read_dir(directory)
            .map_err(|error| unavailable(format!("read {}: {error}", directory.display())))?
            .collect::<Result<Vec<_>, _>>()
            .map_err(|error| unavailable(format!("read {}: {error}", directory.display())))?;
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let path = entry.path();
            let metadata = fs::symlink_metadata(&path)
                .map_err(|error| unavailable(format!("inspect {}: {error}", path.display())))?;
            if metadata.file_type().is_symlink() {
                return Err(fail(format!(
                    "upstream corpus contains a symlink: {}",
                    path.display()
                )));
            }
            if metadata.is_dir() {
                visit(root, &path, rows)?;
            } else if metadata.is_file() {
                let relative = path
                    .strip_prefix(root)
                    .map_err(|error| unavailable(format!("corpus path: {error}")))?
                    .to_string_lossy()
                    .replace('\\', "/");
                let bytes = fs::read(&path)
                    .map_err(|error| unavailable(format!("read {}: {error}", path.display())))?;
                rows.push((relative, bytes));
            } else {
                return Err(fail(format!(
                    "upstream corpus contains a non-regular entry: {}",
                    path.display()
                )));
            }
        }
        Ok(())
    }
    let mut rows = Vec::new();
    visit(root, root, &mut rows)?;
    Ok(rows)
}

fn verify_tree(root: &Path, expected: &str) -> Result<String, PrismError> {
    let mut digest = Sha256::new();
    for (path, bytes) in regular_tree(root)? {
        let path = path.as_bytes();
        digest.update((path.len() as u64).to_be_bytes());
        digest.update(path);
        digest.update((bytes.len() as u64).to_be_bytes());
        digest.update(bytes);
    }
    let observed = format!("{:x}", digest.finalize());
    if observed != expected {
        return Err(fail(format!(
            "upstream corpus {} changed: expected {expected}, observed {observed}",
            root.display()
        )));
    }
    Ok(format!("sha256:{observed}"))
}

#[derive(Clone)]
struct CorpusRetriever(Arc<HashMap<String, Value>>);

impl jsonschema::Retrieve for CorpusRetriever {
    fn retrieve(
        &self,
        uri: &jsonschema::Uri<String>,
    ) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
        self.0
            .get(uri.as_str())
            .cloned()
            .ok_or_else(|| format!("unregistered offline JSON Schema resource: {uri}").into())
    }
}

fn json_schema_suite_rust(root: &Path) -> Result<CorpusEvidence, PrismError> {
    let corpus = root.join("standards/corpora/json-schema-2020-12");
    let digest = verify_tree(&corpus, JSON_SCHEMA_TREE)?;
    let mut remote = HashMap::new();
    for (path, bytes) in regular_tree(&corpus.join("remotes"))? {
        let value = serde_json::from_slice(&bytes)
            .map_err(|error| fail(format!("JSON Schema remote {path}: {error}")))?;
        remote.insert(format!("http://localhost:1234/draft2020-12/{path}"), value);
    }
    let retriever = CorpusRetriever(Arc::new(remote));
    let rows = regular_tree(&corpus.join("tests"))?;
    if rows.len() != 46 {
        return Err(fail(format!(
            "mandatory JSON Schema 2020-12 corpus has {} files, expected 46",
            rows.len()
        )));
    }
    let mut positive = 0_u64;
    let mut negative = 0_u64;
    let mut planted = false;
    for (path, bytes) in rows {
        let groups: Value = serde_json::from_slice(&bytes)
            .map_err(|error| fail(format!("JSON Schema corpus {path}: {error}")))?;
        for group in groups
            .as_array()
            .ok_or_else(|| fail(format!("JSON Schema corpus {path} is not an array")))?
        {
            let validator = jsonschema::options()
                .with_draft(jsonschema::Draft::Draft202012)
                .with_retriever(retriever.clone())
                .build(&group["schema"])
                .map_err(|error| fail(format!("compile {path}: {error}")))?;
            for test in group["tests"]
                .as_array()
                .ok_or_else(|| fail(format!("JSON Schema tests absent in {path}")))?
            {
                let expected = test["valid"]
                    .as_bool()
                    .ok_or_else(|| fail(format!("JSON Schema expectation absent in {path}")))?;
                let observed = validator.is_valid(&test["data"]);
                if observed != expected {
                    return Err(fail(format!(
                        "JSON Schema upstream case disagreed in {path}: {}",
                        test["description"].as_str().unwrap_or("unnamed")
                    )));
                }
                if expected {
                    positive += 1
                } else {
                    negative += 1
                }
                if !planted {
                    planted = observed != !expected
                }
            }
        }
    }
    if positive == 0 || negative == 0 || !planted {
        return Err(fail("JSON Schema outcome/planted coverage is incomplete"));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive,
        negative,
        planted_rejections: 1,
        runner: "jsonschema/0.50.1",
    })
}

fn codepoints(field: &str) -> Result<String, PrismError> {
    field
        .split_ascii_whitespace()
        .map(|value| {
            let scalar = u32::from_str_radix(value, 16)
                .map_err(|error| fail(format!("Unicode scalar {value}: {error}")))?;
            char::from_u32(scalar)
                .ok_or_else(|| fail(format!("Unicode corpus contains non-scalar U+{scalar:04X}")))
        })
        .collect()
}

fn unicode_suite(root: &Path) -> Result<CorpusEvidence, PrismError> {
    let corpus = root.join("standards/corpora/unicode-17.0.0");
    let digest = verify_tree(&corpus, UNICODE_TREE)?;
    if unicode_normalization::UNICODE_VERSION != (17, 0, 0) {
        return Err(fail(format!(
            "unicode-normalization data is {:?}, expected (17, 0, 0)",
            unicode_normalization::UNICODE_VERSION
        )));
    }
    let text = fs::read_to_string(corpus.join("NormalizationTest.txt"))
        .map_err(|error| unavailable(format!("read Unicode corpus: {error}")))?;
    let mut rows = 0_u64;
    let mut planted = false;
    for line in text.lines() {
        let content = line.split('#').next().unwrap_or_default().trim();
        if content.is_empty() || content.starts_with('@') {
            continue;
        }
        let fields = content.split(';').map(str::trim).collect::<Vec<_>>();
        if fields.len() < 5 {
            return Err(fail("malformed Unicode normalization row"));
        }
        let c = fields[..5]
            .iter()
            .map(|field| codepoints(field))
            .collect::<Result<Vec<_>, _>>()?;
        let nfc = |value: &str| value.nfc().collect::<String>();
        let nfd = |value: &str| value.nfd().collect::<String>();
        let nfkc = |value: &str| value.nfkc().collect::<String>();
        let nfkd = |value: &str| value.nfkd().collect::<String>();
        let valid = nfc(&c[0]) == c[1]
            && nfc(&c[1]) == c[1]
            && nfc(&c[2]) == c[1]
            && nfc(&c[3]) == c[3]
            && nfc(&c[4]) == c[3]
            && nfd(&c[0]) == c[2]
            && nfd(&c[1]) == c[2]
            && nfd(&c[2]) == c[2]
            && nfd(&c[3]) == c[4]
            && nfd(&c[4]) == c[4]
            && c.iter()
                .all(|value| nfkc(value) == c[3] && nfkd(value) == c[4]);
        if !valid {
            return Err(fail(format!(
                "Unicode normalization row {} failed",
                rows + 1
            )));
        }
        if !planted {
            let mut changed = c[1].clone();
            changed.push('\u{0}');
            planted = nfc(&c[0]) != changed;
        }
        rows += 1;
    }
    if rows == 0 || !planted || char::from_u32(0xd800).is_some() {
        return Err(fail(
            "Unicode corpus or scalar-boundary planted probe was not enforced",
        ));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive: rows,
        negative: 1,
        planted_rejections: 2,
        runner: "unicode-normalization/0.1.25+ucd-17.0.0",
    })
}

fn command_output(
    program: &str,
    arguments: &[String],
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrismError> {
    let mut child = Command::new(program)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| unavailable(format!("start {program}: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| unavailable("missing stdout"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| unavailable("missing stderr"))?;
    const OUTPUT_LIMIT: u64 = 16 * 1024 * 1024;
    let out = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stdout
            .take(OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let err = std::thread::spawn(move || {
        let mut bytes = Vec::new();
        stderr
            .take(OUTPUT_LIMIT + 1)
            .read_to_end(&mut bytes)
            .map(|_| bytes)
    });
    let deadline = Instant::now() + timeout;
    let status = loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| unavailable(format!("wait {program}: {error}")))?
        {
            break status;
        }
        if Instant::now() >= deadline {
            let _ = child.kill();
            let _ = child.wait();
            return Err(unavailable(format!(
                "{program} exceeded its finite timeout"
            )));
        }
        std::thread::sleep(Duration::from_millis(25));
    };
    let stdout = out
        .join()
        .map_err(|_| unavailable("stdout reader panicked"))?
        .map_err(|error| unavailable(format!("read stdout: {error}")))?;
    let stderr = err
        .join()
        .map_err(|_| unavailable("stderr reader panicked"))?
        .map_err(|error| unavailable(format!("read stderr: {error}")))?;
    if stdout.len() as u64 > OUTPUT_LIMIT || stderr.len() as u64 > OUTPUT_LIMIT {
        return Err(unavailable(format!(
            "{program} exceeded its finite output bound"
        )));
    }
    Ok((status, stdout, stderr))
}

fn docker(
    arguments: &[&str],
    timeout: Duration,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrismError> {
    command_output(
        "docker",
        &arguments
            .iter()
            .map(|value| (*value).to_owned())
            .collect::<Vec<_>>(),
        timeout,
    )
}

fn sdk_image() -> Result<String, PrismError> {
    let image = std::env::var("PRISMPM_TEST_SDK_IMAGE")
        .map_err(|_| unavailable("PRISMPM_TEST_SDK_IMAGE is required by upstream conformance"))?;
    validate_sdk_image(&image)?;
    Ok(image)
}

fn validate_sdk_image(image: &str) -> Result<(), PrismError> {
    crate::oci::validate_reference(image, true).map_err(|_| {
        unavailable("upstream conformance requires a valid immutable OCI SDK reference")
    })?;
    Ok(())
}

fn go_test_passes(output: &[u8]) -> u64 {
    String::from_utf8_lossy(output)
        .lines()
        .filter(|line| line.starts_with("--- PASS:"))
        .count() as u64
}

fn cloudevents_suite(root: &Path, image: &str) -> Result<CorpusEvidence, PrismError> {
    let source = root.join("standards/oracles/cloudevents-sdk-go-2.16.2");
    let digest = verify_tree(&source, CLOUDEVENTS_TREE)?;
    verify_tree(
        &root.join("standards/corpora/cloudevents-1.0.2"),
        CLOUDEVENTS_FIXTURES_TREE,
    )?;
    let (tests, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--entrypoint",
            "/usr/local/bin/cloudevents-sdk-conformance",
            image,
            "-test.v",
        ],
        Duration::from_secs(60),
    )?;
    let passes = go_test_passes(&stdout);
    if !tests.success()
        || passes != 45
        || String::from_utf8_lossy(&stdout).contains("--- SKIP:")
        || String::from_utf8_lossy(&stdout).contains("--- FAIL:")
    {
        return Err(fail(format!(
            "official CloudEvents SDK tests disagreed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    let fixture =
        |name: &str| format!("/opt/prismpm/share/standards/corpora/cloudevents-1.0.2/{name}");
    let valid = fixture("valid.json");
    let invalid = fixture("invalid-missing-id.json");
    let planted = fixture("planted-wrong-version.json");
    let run = |input: &str| {
        docker(
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--entrypoint",
                "/usr/local/bin/cloudevents-validator",
                image,
                input,
            ],
            Duration::from_secs(20),
        )
    };
    let (accepted, _, _) = run(&valid)?;
    let (rejected, _, _) = run(&invalid)?;
    let (planted_rejected, _, _) = run(&planted)?;
    if !accepted.success() || rejected.success() || planted_rejected.success() {
        return Err(fail(
            "official CloudEvents SDK did not preserve positive, negative, and planted outcomes",
        ));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive: passes + 1,
        negative: 1,
        planted_rejections: 1,
        runner: "cloudevents/sdk-go/v2.16.2",
    })
}

fn verify_asyncapi_adeo_mirrors(root: &Path) -> Result<(), PrismError> {
    let mirrors = regular_tree(&root.join("standards/oracles/asyncapi-website-20a31a03"))?;
    if mirrors.len() != 2 {
        return Err(fail(format!(
            "AsyncAPI ADEO reference projection changed: expected 2 files, observed {}",
            mirrors.len()
        )));
    }
    for (path, bytes) in &mirrors {
        let expected = match path.as_str() {
            "CostingRequestPayload.avsc" => ASYNCAPI_ADEO_REQUEST,
            "CostingResponsePayload.avsc" => ASYNCAPI_ADEO_RESPONSE,
            _ => return Err(fail(format!("unregistered AsyncAPI ADEO mirror {path}"))),
        };
        let observed = format!("{:x}", Sha256::digest(bytes));
        if observed != expected {
            return Err(fail(format!(
                "AsyncAPI ADEO mirror {path} changed: expected {expected}, observed {observed}"
            )));
        }
    }
    Ok(())
}

fn asyncapi_runtime_probe(root: &Path) -> Result<String, PrismError> {
    let files = regular_tree(&root.join("sdk/asyncapi-runtime"))?;
    let mut script = String::from("set -eu\n");
    for name in [
        "package.json",
        "package-lock.json",
        "launcher.mjs",
        "launcher.sh",
        "launcher.test.mjs",
    ] {
        let bytes = files
            .iter()
            .find(|(path, _)| path == name)
            .map(|(_, bytes)| bytes)
            .ok_or_else(|| fail(format!("AsyncAPI runtime source {name} is absent")))?;
        let digest = format!("{:x}", Sha256::digest(bytes));
        if (name == "package-lock.json" && digest != ASYNCAPI_RUNTIME_LOCK)
            || (name == "package.json"
                && digest != "89f3a5feea766b7d899f5224452bfd0f725aa00c17f241da2cf0818081437d93")
        {
            return Err(fail("AsyncAPI owned runtime dependency identity differs"));
        }
        script.push_str(&format!(
            "printf '%s  %s\\n' '{digest}' '/opt/prismpm/asyncapi-official/scripts/{name}' | /usr/bin/sha256sum --check --strict >/dev/null\n"
        ));
        if name == "launcher.sh" {
            script.push_str(&format!(
                "test \"$(readlink -f /usr/local/bin/asyncapi-official)\" = '/opt/prismpm/asyncapi-official/scripts/launcher.sh'\nprintf '%s  %s\\n' '{digest}' '/usr/local/bin/asyncapi-official' | /usr/bin/sha256sum --check --strict >/dev/null\n"
            ));
        }
    }
    script.push_str("exec /usr/local/bin/asyncapi-official --check\n");
    Ok(script)
}

fn validate_asyncapi_runtime_report(bytes: &[u8]) -> Result<(), PrismError> {
    let canonical = bytes
        .strip_suffix(b"\n")
        .ok_or_else(|| fail("AsyncAPI runtime report must end with one newline"))?;
    let report = crate::holo::canonical::decode_value(canonical, "AsyncAPI runtime report")
        .map_err(|error| fail(format!("AsyncAPI runtime report: {error}")))?;
    if report
        != serde_json::json!({"parser":"@asyncapi/parser/3.6.0","runtimeLock":ASYNCAPI_RUNTIME_LOCK})
    {
        return Err(fail(
            "AsyncAPI runtime parser or owned dependency lock differs",
        ));
    }
    Ok(())
}

fn validate_asyncapi_runtime_tests(bytes: &[u8]) -> Result<(), PrismError> {
    const GROUPS: [&str; 5] = [
        "the owned runtime runs all 89 unchanged upstream examples with parser 3.6.0",
        "the owning launcher rejects changed source, lock, parser, missing modules and shadow resolution",
        "fixed inventory binding rejects absent, duplicate, changed, extra-field or noncanonical runtime rows",
        "runtime byte framing matches inventory and allows only in-tree executable aliases",
        "the shell entry rejects ambient preloads before any Node code can execute",
    ];
    let text =
        std::str::from_utf8(bytes).map_err(|_| fail("AsyncAPI runtime TAP output is not UTF-8"))?;
    let mut version = 0;
    let mut plan = 0;
    let mut groups = [0; 5];
    let mut summaries = std::collections::BTreeMap::new();
    for line in text.lines() {
        if line == "TAP version 13" {
            version += 1;
        }
        if line.starts_with("1..") {
            if line != "1..5" {
                return Err(fail("AsyncAPI runtime TAP plan differs"));
            }
            plan += 1;
        }
        if line.starts_with("ok ") {
            let index = GROUPS
                .iter()
                .enumerate()
                .position(|(index, name)| line == format!("ok {} - {name}", index + 1))
                .ok_or_else(|| fail("AsyncAPI runtime TAP group differs or was skipped"))?;
            groups[index] += 1;
        }
        if line.starts_with("not ok ") || line.starts_with("Bail out!") {
            return Err(fail("AsyncAPI runtime TAP reports a failure"));
        }
        for key in [
            "tests",
            "suites",
            "pass",
            "fail",
            "cancelled",
            "skipped",
            "todo",
        ] {
            if let Some(raw) = line.strip_prefix(&format!("# {key} ")) {
                let count = raw
                    .parse::<u64>()
                    .map_err(|_| fail("AsyncAPI runtime TAP summary is malformed"))?;
                if count.to_string() != raw || summaries.insert(key, count).is_some() {
                    return Err(fail(
                        "AsyncAPI runtime TAP summary is duplicate or noncanonical",
                    ));
                }
            }
        }
    }
    if version != 1
        || plan != 1
        || groups != [1; 5]
        || summaries
            != std::collections::BTreeMap::from([
                ("tests", 5),
                ("suites", 0),
                ("pass", 5),
                ("fail", 0),
                ("cancelled", 0),
                ("skipped", 0),
                ("todo", 0),
            ])
    {
        return Err(fail(
            "AsyncAPI runtime TAP lacks the complete five passing regression groups",
        ));
    }
    Ok(())
}

fn asyncapi_suite(root: &Path, image: &str) -> Result<AsyncApiEvidence, PrismError> {
    let corpus = root.join("standards/oracles/asyncapi-spec-b3fac5bb");
    let digest = verify_tree(&corpus, ASYNCAPI_TREE)?;
    verify_asyncapi_adeo_mirrors(root)?;
    let probe = asyncapi_runtime_probe(root)?;
    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--user",
            "1000:1000",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--entrypoint",
            "/bin/sh",
            image,
            "-c",
            &probe,
        ],
        Duration::from_secs(30),
    )?;
    if !status.success() {
        return Err(fail(format!(
            "AsyncAPI runtime source/inventory binding failed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    validate_asyncapi_runtime_report(&stdout)?;
    // The runtime regression executes the real upstream examples, then proves
    // that changed source, locks, installed JS, modules and shadows fail. It
    // uses disposable copies; the exact image's runtime remains read-only.
    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--user",
            "1000:1000",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--entrypoint",
            "/usr/local/bin/node",
            image,
            "--test",
            "--test-reporter=tap",
            "--test-timeout=180000",
            "/opt/prismpm/asyncapi-official/scripts/launcher.test.mjs",
        ],
        Duration::from_secs(200),
    )?;
    if !status.success() {
        return Err(fail(format!(
            "AsyncAPI runtime mutation suite failed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    validate_asyncapi_runtime_tests(&stdout)?;
    let mut documents = regular_tree(&corpus)?
        .into_iter()
        .map(|(path, _)| path)
        .filter(|path| {
            path.starts_with("examples/")
                && (path.ends_with(".yaml") || path.ends_with(".yml"))
                && !path.starts_with("examples/social-media/common/")
        })
        .collect::<Vec<_>>();
    documents.sort();
    if documents.len() != 24 {
        return Err(fail(format!(
            "AsyncAPI official document corpus changed: expected 24, observed {}",
            documents.len()
        )));
    }
    for relative in &documents {
        let input =
            format!("/opt/prismpm/share/standards/oracles/asyncapi-spec-b3fac5bb/{relative}");
        let workdir = input
            .rsplit_once('/')
            .map(|(directory, _)| directory)
            .ok_or_else(|| fail("AsyncAPI fixture path has no source directory"))?;
        let (status, stdout, stderr) = docker(
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--workdir",
                workdir,
                "--entrypoint",
                "/usr/local/bin/asyncapi-parser",
                image,
                &input,
            ],
            Duration::from_secs(30),
        )?;
        if !status.success() {
            return Err(fail(format!(
                "official AsyncAPI document {relative} failed: stdout={} stderr={}",
                String::from_utf8_lossy(&stdout),
                String::from_utf8_lossy(&stderr)
            )));
        }
    }

    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--env",
            "HOME=/tmp",
            "--entrypoint",
            "/usr/local/bin/asyncapi-official",
            image,
        ],
        Duration::from_secs(120),
    )?;
    let output = String::from_utf8_lossy(&stdout);
    let embedded = output
        .lines()
        .filter(|line| line.ends_with(" is valid."))
        .count() as u64;
    if !status.success()
        || embedded != 89
        || !output.contains("Number of examples extracted: 89")
        || output.contains("Validation failed")
        || output.contains("Error in ")
    {
        return Err(fail(format!(
            "unmodified AsyncAPI embedded-example harness disagreed: stdout={} stderr={}",
            output,
            String::from_utf8_lossy(&stderr)
        )));
    }

    let mutation = r#"set -eu
printf '%s' '{"asyncapi":"3.1.0","channels":{},"info":{"title":"missing version"}}' >/tmp/invalid.json
if asyncapi-parser /tmp/invalid.json; then exit 41; fi
printf '%s' '{"asyncapi":"9.9.9","channels":{},"info":{"title":"wrong version","version":"1"}}' >/tmp/planted.json
if asyncapi-parser /tmp/planted.json; then exit 42; fi
"#;
    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--entrypoint",
            "/bin/sh",
            image,
            "-c",
            mutation,
        ],
        Duration::from_secs(30),
    )?;
    if !status.success() {
        return Err(fail(format!(
            "AsyncAPI negative mutations were not rejected: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }

    Ok(AsyncApiEvidence {
        corpus_sha256: digest,
        published_documents: documents.len() as u64,
        embedded_examples: embedded,
        upstream_negative_fixtures: 0,
        negative_mutations: 1,
        planted_rejections: 1,
        parser: "@asyncapi/parser/3.6.3",
        upstream_runner: "asyncapi/spec@b3fac5bb/scripts/validation+@asyncapi/parser/3.6.0+Prism-owned-runtime-lock/sha256:5bd20ce206d3b3b76a7034951c9e19e15291c54eec0a1424139b465c980f1205",
    })
}

fn intoto_suite(root: &Path, image: &str) -> Result<InTotoEvidence, PrismError> {
    let corpus = root.join("standards/oracles/in-toto-attestation-ee16c68a");
    let digest = verify_tree(&corpus, INTOTO_TREE)?;
    let probes = r#"set -eu
printf '%s' '{"_type":"https://in-toto.io/Statement/v1","subject":[{"name":"artifact","digest":{"sha256":"00"}}],"predicateType":"https://example.test/predicate","predicate":{}}' >/tmp/valid.json
intoto-statement-validator /tmp/valid.json
printf '%s' '{"_type":"https://in-toto.io/Statement/v1","subject":"not-an-array","predicateType":"https://example.test/predicate"}' >/tmp/invalid.json
if intoto-statement-validator /tmp/invalid.json; then exit 41; fi
printf '%s' '{"_type":"https://in-toto.io/Statement/v1","subject":[],"predicateType":"https://example.test/predicate","unknown":true}' >/tmp/planted.json
if intoto-statement-validator /tmp/planted.json; then exit 42; fi
"#;
    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--entrypoint",
            "/bin/sh",
            image,
            "-c",
            probes,
        ],
        Duration::from_secs(30),
    )?;
    if !status.success() {
        return Err(fail(format!(
            "official in-toto protobuf probes disagreed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    Ok(InTotoEvidence {
        corpus_sha256: digest,
        positive: 1,
        negative: 1,
        planted_rejections: 1,
        runner: "in-toto/attestation@ee16c68a generated Go protobuf+protojson/1.28.1",
        semantic_validation: "consumer-policy-required-by-upstream",
    })
}

fn oci_image_graph_probe() -> &'static str {
    r#"
set -eu
work=$(mktemp -d)
cd "$work"
printf '%s' 'prismpm-oci-payload' > payload.txt
oras push --oci-layout layout:v1 \
  --artifact-type application/vnd.prismpm.payload \
  payload.txt:text/plain >/dev/null
subject=$(oras resolve --oci-layout layout:v1)
oras manifest fetch --oci-layout layout:v1 > manifest.json
grep -Fq '"mediaType":"application/vnd.oci.image.manifest.v1+json"' manifest.json
grep -Fq '"artifactType":"application/vnd.prismpm.payload"' manifest.json
oras attach --oci-layout \
  --artifact-type application/vnd.prismpm.evidence \
  layout:v1 payload.txt:text/plain >/dev/null
oras discover --oci-layout --format json layout:v1 > referrers.json
grep -Fq '"artifactType": "application/vnd.prismpm.evidence"' referrers.json
grep -Fq '"digest": "' referrers.json
oras manifest index create --oci-layout layout:multi v1 >/dev/null
oras manifest fetch --oci-layout layout:multi > index.json
grep -Fq '"mediaType":"application/vnd.oci.image.index.v1+json"' index.json
grep -Fq "$subject" index.json
if oras discover --oci-layout --artifact-type application/vnd.prismpm.absent \
  --format json layout:v1 | grep -Fq 'application/vnd.prismpm.absent'; then
  exit 41
fi
# ORAS stores immutable blobs; change only this disposable corruption fixture.
chmod u+w -- "layout/blobs/sha256/${subject#sha256:}"
printf '%s' corrupt > "layout/blobs/sha256/${subject#sha256:}"
if oras manifest fetch --oci-layout layout:v1 >/dev/null 2>&1; then
  exit 42
fi
printf '%s\n' OCI_GRAPH_OK
"#
}

fn oci_image_suite(root: &Path, image: &str) -> Result<CorpusEvidence, PrismError> {
    let corpus = root.join("standards/oracles/oci-image-1.1.1");
    let digest = verify_tree(&corpus, OCI_IMAGE_TREE)?;
    let (status, stdout, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--workdir",
            "/opt/prismpm/share/standards/oracles/oci-image-1.1.1/schema",
            "--entrypoint",
            "/usr/local/bin/oci-image-schema-conformance",
            image,
            "-test.v",
        ],
        Duration::from_secs(60),
    )?;
    let passes = go_test_passes(&stdout);
    if !status.success()
        || passes != 14
        || String::from_utf8_lossy(&stdout).contains("--- SKIP:")
        || String::from_utf8_lossy(&stdout).contains("--- FAIL:")
    {
        return Err(fail(format!(
            "official OCI Image tests disagreed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    let (graph, graph_stdout, graph_stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,noexec,nosuid,nodev",
            "--entrypoint",
            "/bin/sh",
            image,
            "-ec",
            oci_image_graph_probe(),
        ],
        Duration::from_secs(60),
    )?;
    if !graph.success() || !String::from_utf8_lossy(&graph_stdout).contains("OCI_GRAPH_OK") {
        return Err(fail(format!(
            "independent ORAS OCI graph probe disagreed: stdout={} stderr={}",
            String::from_utf8_lossy(&graph_stdout),
            String::from_utf8_lossy(&graph_stderr)
        )));
    }
    let (missing, _, _) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--entrypoint",
            "/usr/local/bin/oras",
            image,
            "manifest",
            "fetch",
            "--oci-layout",
            "/opt/prismpm/share/standards/oracles/oci-image-1.1.1:absent",
        ],
        Duration::from_secs(20),
    )?;
    if missing.success() {
        return Err(fail("ORAS accepted a planted absent OCI descriptor"));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive: passes + 5,
        negative: 2,
        planted_rejections: 2,
        runner: "opencontainers/image-spec/1.1.1+oras/1.3.0",
    })
}

fn spdx_suite(root: &Path, image: &str) -> Result<CorpusEvidence, PrismError> {
    let model = root.join("standards/oracles/spdx-3.0.1-model");
    let digest = verify_tree(&model, SPDX_MODEL_TREE)?;
    verify_tree(
        &root.join("standards/oracles/spdx-json-schema-3.0.1"),
        SPDX_SCHEMA_TREE,
    )?;
    verify_tree(
        &root.join("standards/corpora/spdx-3.0.1"),
        SPDX_FIXTURES_TREE,
    )?;
    let schema =
        "/opt/prismpm/share/standards/oracles/spdx-json-schema-3.0.1/spdx-json-schema.json";
    let valid = "/opt/prismpm/share/standards/corpora/spdx-3.0.1/valid-core-software.json";
    let invalid = "/opt/prismpm/share/standards/corpora/spdx-3.0.1/invalid-unknown-element.json";
    let run = |input: &str| {
        docker(
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--entrypoint",
                "/usr/local/bin/spdx-validator",
                image,
                schema,
                input,
            ],
            Duration::from_secs(30),
        )
    };
    let (accepted, _, _) = run(valid)?;
    let (rejected, _, _) = run(invalid)?;
    if !accepted.success() || rejected.success() {
        return Err(fail(
            "official SPDX 3.0.1 schema did not preserve positive/negative outcomes",
        ));
    }
    let projection = crate::system::spdx(&serde_json::json!({
        "components":[{"id":"upstream-conformance-component","version":"1.0.0"}],
        "product":{"id":"upstream-conformance-system"}
    }));
    let projection = base64::engine::general_purpose::STANDARD.encode(
        serde_json::to_vec(&projection)
            .map_err(|error| unavailable(format!("encode SPDX projection: {error}")))?,
    );
    let (projected, _, projected_stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--env",
            &format!("PRISMPM_SPDX_DOCUMENT_BASE64={projection}"),
            "--entrypoint",
            "/usr/local/bin/spdx-validator",
            image,
            schema,
            "-",
        ],
        Duration::from_secs(30),
    )?;
    if !projected.success() {
        return Err(fail(format!(
            "actual generated system SPDX projection failed official 3.0.1 schema: {}",
            String::from_utf8_lossy(&projected_stderr)
        )));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive: 2,
        negative: 1,
        planted_rejections: 1,
        runner: "spdx/3.0.1-schema+ajv/8.20.0",
    })
}

fn openid_suite(root: &Path, image: &str) -> Result<CorpusEvidence, PrismError> {
    let corpus = root.join("standards/oracles/openid-conformance-suite-3e09b13b");
    let digest = verify_tree(&corpus, OPENID_CONFORMANCE_TREE)?;
    let run = |selection: Option<&str>| {
        let mut arguments = vec![
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--tmpfs",
            "/tmp:rw,exec,nosuid,nodev,size=1g",
            "--entrypoint",
            "/usr/local/bin/openid-conformance",
            image,
        ];
        if let Some(selection) = selection {
            arguments.push(selection);
        }
        docker(&arguments, Duration::from_secs(120))
    };
    let (status, stdout, stderr) = run(None)?;
    if !status.success()
        || !String::from_utf8_lossy(&stdout)
            .contains("{\"errors\":0,\"failures\":0,\"officialTests\":29,\"skipped\":0}")
    {
        return Err(fail(format!(
            "official OpenID condition tests disagreed: stdout={} stderr={}",
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }
    let (planted, _, _) = run(Some("PlantedAbsentOpenIdCondition_UnitTest"))?;
    if planted.success() {
        return Err(fail(
            "OpenID conformance harness accepted a planted absent official condition",
        ));
    }
    Ok(CorpusEvidence {
        corpus_sha256: digest,
        positive: 11,
        negative: 18,
        planted_rejections: 1,
        runner: "openid/conformance-suite@3e09b13b896f",
    })
}

fn runtime_suite(root: &Path, image: &str) -> Result<RuntimeEvidence, PrismError> {
    let corpus = root.join("standards/oracles/oci-runtime-1.3.0");
    let digest = verify_tree(&corpus, RUNTIME_TREE)?;
    let mut positive = 0_u64;
    let mut negative = 0_u64;
    let mut planted_rejected = false;
    for kind in ["config", "features", "state"] {
        for expectation in ["good", "bad"] {
            let directory = corpus.join("test").join(kind).join(expectation);
            for (relative, _) in regular_tree(&directory)? {
                let schema = format!(
                    "/opt/prismpm/share/standards/oracles/oci-runtime-1.3.0/{kind}-schema.json"
                );
                let input = format!(
                    "/opt/prismpm/share/standards/oracles/oci-runtime-1.3.0/test/{kind}/{expectation}/{relative}"
                );
                let (status, _, stderr) = docker(
                    &[
                        "run",
                        "--rm",
                        "--network",
                        "none",
                        "--read-only",
                        "--tmpfs",
                        "/tmp:rw,noexec,nosuid,nodev",
                        "--entrypoint",
                        "/usr/local/bin/oci-runtime-validate",
                        image,
                        &schema,
                        &input,
                    ],
                    Duration::from_secs(30),
                )?;
                let expected = expectation == "good";
                if status.success() != expected {
                    return Err(fail(format!(
                        "OCI Runtime {kind}/{expectation}/{relative} disagreed: {}",
                        String::from_utf8_lossy(&stderr)
                    )));
                }
                if expected {
                    positive += 1
                } else {
                    negative += 1
                }
                if expected && !planted_rejected {
                    planted_rejected = status.success();
                }
            }
        }
    }
    if positive == 0 || negative == 0 || !planted_rejected {
        return Err(fail(
            "OCI Runtime corpus did not exercise both outcomes and a planted inversion",
        ));
    }
    let (version_status, version_stdout, _) = docker(
        &["version", "--format", "{{.Server.Version}}"],
        Duration::from_secs(10),
    )?;
    let (runtime_status, runtime_stdout, _) = docker(
        &["info", "--format", "{{.DefaultRuntime}}"],
        Duration::from_secs(10),
    )?;
    let engine_version = String::from_utf8_lossy(&version_stdout).trim().to_owned();
    let runtime_name = String::from_utf8_lossy(&runtime_stdout).trim().to_owned();
    if !version_status.success()
        || !runtime_status.success()
        || engine_version.is_empty()
        || runtime_name != "runc"
    {
        return Err(unavailable(
            "OCI runtime identity is absent or the engine default is not runc",
        ));
    }
    let (engine_good, _, _) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--entrypoint",
            "/usr/bin/true",
            image,
        ],
        Duration::from_secs(30),
    )?;
    let (engine_bad, _, _) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--entrypoint",
            "/prismpm-planted-absent",
            image,
        ],
        Duration::from_secs(30),
    )?;
    if !engine_good.success() || engine_bad.success() {
        return Err(fail(
            "unmodified container engine did not preserve positive/negative runtime outcomes",
        ));
    }
    Ok(RuntimeEvidence {
        corpus_sha256: digest,
        positive,
        negative,
        planted_rejections: 1,
        engine_positive: 1,
        engine_negative: 1,
        engine_version,
        runtime_name,
    })
}

fn cleanup_distribution(containers: &[&str], network: &str, volumes: &[&str]) {
    for container in containers {
        let _ = docker(
            &["container", "rm", "--force", container],
            Duration::from_secs(10),
        );
    }
    let _ = docker(&["network", "rm", network], Duration::from_secs(10));
    for volume in volumes {
        let _ = docker(
            &["volume", "rm", "--force", volume],
            Duration::from_secs(10),
        );
    }
}

fn xml_attribute(tag: &str, name: &str) -> Option<String> {
    let marker = format!("{name}=\"");
    let start = tag.find(&marker)? + marker.len();
    let end = tag[start..].find('"')? + start;
    Some(tag[start..end].to_owned())
}

struct DistributionJUnit {
    all: BTreeSet<String>,
    passed: BTreeSet<String>,
}

fn junit_cases(bytes: &[u8]) -> Result<DistributionJUnit, PrismError> {
    let text = std::str::from_utf8(bytes)
        .map_err(|error| fail(format!("OCI Distribution JUnit is not UTF-8: {error}")))?;
    let mut all = BTreeSet::new();
    let mut passed = BTreeSet::new();
    let mut occurrences = std::collections::BTreeMap::new();
    for segment in text.split("<testcase ").skip(1) {
        let end = segment
            .find('>')
            .ok_or_else(|| fail("OCI Distribution JUnit testcase tag is incomplete"))?;
        let header = &segment[..end];
        let name = xml_attribute(header, "name")
            .ok_or_else(|| fail("OCI Distribution JUnit testcase has no name"))?;
        if name == "html custom reporter" {
            continue;
        }
        let class = xml_attribute(header, "classname").unwrap_or_default();
        let body_end = if header.trim_end().ends_with('/') {
            end
        } else {
            segment
                .find("</testcase>")
                .ok_or_else(|| fail("OCI Distribution JUnit testcase body is incomplete"))?
        };
        let body = &segment[end..body_end];
        // The upstream Ginkgo report is the authoritative inventory. Some
        // setup nodes intentionally repeat a description, and focused runs
        // omit source traces for filtered nodes, so bind each JUnit class/name
        // occurrence in report order instead of deriving identity from logs.
        let occurrence = occurrences
            .entry(format!("{class}::{name}"))
            .or_insert(0_u64);
        *occurrence += 1;
        let identity = format!("{class}::{name}::{occurrence}");
        if !all.insert(identity.clone()) {
            return Err(fail(format!(
                "OCI Distribution JUnit contains duplicate spec identity: {identity}"
            )));
        }
        if !body.contains("<skipped") && !body.contains("<failure") && !body.contains("<error") {
            passed.insert(identity);
        }
    }
    if all.is_empty() {
        return Err(fail("OCI Distribution JUnit contained no testcases"));
    }
    Ok(DistributionJUnit { all, passed })
}

struct DistributionRun<'a> {
    label: &'static str,
    subject_image: &'static str,
    root_url: &'static str,
    namespace: &'a str,
    report_volume: &'a str,
    report_directory: &'static str,
    environment: &'a [(&'static str, &'a str)],
    focus: Option<&'static str>,
}

fn distribution_report_initializer() -> &'static str {
    r#"set -eu
test "$(id -u):$(id -g)" = 0:0
test ! -L /reports
test "$(stat -c '%u:%g:%a' /reports)" = 0:0:755
test -z "$(find /reports -mindepth 1 -maxdepth 1 -print -quit)"
set -- /reports/zot-manifest-first-auto /reports/zot-blobs-first-auto /reports/reference-manual-crossmount /reports/reference-automatic-disabled /reports/pull-external-setup /reports/discovery-external-setup
mkdir --mode=0700 -- "$@"
chown -- 1000:1000 "$@"
"#
}

fn initialize_distribution_reports(
    image: &str,
    volume: &str,
    script: &str,
) -> Result<(ExitStatus, Vec<u8>, Vec<u8>), PrismError> {
    docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--user",
            "0:0",
            "--cap-drop",
            "ALL",
            "--cap-add",
            "CHOWN",
            "--security-opt",
            "no-new-privileges",
            "--volume",
            &format!("{volume}:/reports"),
            "--entrypoint",
            "/bin/sh",
            image,
            "-ec",
            script,
        ],
        Duration::from_secs(30),
    )
}

fn run_distribution_official(
    root: &Path,
    network: &str,
    image: &str,
    run: &DistributionRun<'_>,
) -> Result<(DistributionRawReport, DistributionJUnit), PrismError> {
    let report_mount = format!("{}:/reports", run.report_volume);
    let report_dir = format!("/reports/{}", run.report_directory);
    let mut arguments = vec![
        "run".to_owned(),
        "--rm".to_owned(),
        "--read-only".to_owned(),
        "--user".to_owned(),
        "1000:1000".to_owned(),
        "--cap-drop".to_owned(),
        "ALL".to_owned(),
        "--security-opt".to_owned(),
        "no-new-privileges".to_owned(),
        "--tmpfs".to_owned(),
        "/tmp:rw,nosuid,nodev".to_owned(),
        "--network".to_owned(),
        network.to_owned(),
        "--volume".to_owned(),
        report_mount,
        "--entrypoint".to_owned(),
        "/usr/local/bin/oci-distribution-conformance".to_owned(),
    ];
    for (name, value) in [
        ("OCI_ROOT_URL", run.root_url),
        ("OCI_NAMESPACE", run.namespace),
        (
            "OCI_CROSSMOUNT_NAMESPACE",
            &format!("{}-crossmount", run.namespace),
        ),
        ("OCI_TEST_PULL", "1"),
        ("OCI_TEST_PUSH", "1"),
        ("OCI_TEST_CONTENT_DISCOVERY", "1"),
        ("OCI_TEST_CONTENT_MANAGEMENT", "1"),
        ("OCI_HIDE_SKIPPED_WORKFLOWS", "0"),
        ("OCI_DEBUG", "0"),
        ("OCI_REPORT_DIR", &report_dir),
    ] {
        arguments.extend(["--env".to_owned(), format!("{name}={value}")]);
    }
    for (name, value) in run.environment {
        arguments.extend(["--env".to_owned(), format!("{name}={value}")]);
    }
    arguments.push(image.to_owned());
    if let Some(focus) = run.focus {
        arguments.push(format!("--ginkgo.focus={focus}"));
    }
    let references = arguments.iter().map(String::as_str).collect::<Vec<_>>();
    let (status, stdout, stderr) = docker(&references, Duration::from_secs(300))?;
    if !status.success() {
        return Err(fail(format!(
            "OCI Distribution upstream run {} disagreed:\n{}{}",
            run.label,
            String::from_utf8_lossy(&stdout),
            String::from_utf8_lossy(&stderr)
        )));
    }

    let report_path = format!("{report_dir}/junit.xml");
    let (status, bytes, stderr) = docker(
        &[
            "run",
            "--rm",
            "--network",
            "none",
            "--read-only",
            "--user",
            "1000:1000",
            "--cap-drop",
            "ALL",
            "--security-opt",
            "no-new-privileges",
            "--volume",
            &format!("{}:/reports:ro", run.report_volume),
            "--entrypoint",
            "/usr/bin/cat",
            image,
            &report_path,
        ],
        Duration::from_secs(30),
    )?;
    if !status.success() {
        return Err(unavailable(format!(
            "read OCI Distribution raw report {}: {}",
            run.label,
            String::from_utf8_lossy(&stderr)
        )));
    }
    let junit = junit_cases(&bytes)?;
    let relative = format!(
        "target/upstream-conformance/oci-distribution-{}.junit.xml",
        run.label
    );
    let destination = root.join(&relative);
    let parent = destination
        .parent()
        .ok_or_else(|| unavailable("raw Distribution report has no parent"))?;
    fs::create_dir_all(parent)
        .map_err(|error| unavailable(format!("create raw report directory: {error}")))?;
    let temporary = destination.with_extension("xml.tmp");
    fs::write(&temporary, &bytes)
        .map_err(|error| unavailable(format!("write raw Distribution report: {error}")))?;
    fs::rename(&temporary, &destination)
        .map_err(|error| unavailable(format!("publish raw Distribution report: {error}")))?;
    let digest = format!("sha256:{:x}", Sha256::digest(&bytes));
    let official_total = junit.all.len() as u64;
    let passed = junit.passed.len() as u64;
    Ok((
        DistributionRawReport {
            path: relative,
            sha256: digest,
            subject_image: run.subject_image,
            configuration: run.label,
            official_total,
            passed,
            skipped: official_total - passed,
        },
        junit,
    ))
}

fn distribution_suite(root: &Path, image: &str) -> Result<DistributionEvidence, PrismError> {
    let corpus = root.join("standards/oracles/oci-distribution-1.1.1");
    let digest = verify_tree(&corpus, DISTRIBUTION_TREE)?;
    let reference_image = locked_oracle_image(
        root,
        "oci_distribution_reference",
        DISTRIBUTION_REFERENCE_IMAGE,
    )?;
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| unavailable(format!("system clock: {error}")))?
            .as_nanos()
    );
    let network = format!("prismpm-oci-conformance-{nonce}");
    let config_volume = format!("prismpm-oci-conformance-config-{nonce}");
    let report_volume = format!("prismpm-oci-conformance-reports-{nonce}");
    let zot_container = format!("prismpm-oci-conformance-zot-{nonce}");
    let reference_container = format!("prismpm-oci-conformance-reference-{nonce}");
    let temporary = tempfile::tempdir()
        .map_err(|error| unavailable(format!("distribution config scratch: {error}")))?;
    let config = temporary.path().join("config.json");
    fs::write(&config, b"{\"distSpecVersion\":\"1.1.1\",\"http\":{\"address\":\"0.0.0.0\",\"port\":5000},\"log\":{\"level\":\"warn\"},\"storage\":{\"rootDirectory\":\"/tmp/zot\"}}\n")
        .map_err(|error| unavailable(format!("write distribution config: {error}")))?;
    let result = (|| {
        for arguments in [
            vec!["network", "create", "--internal", network.as_str()],
            vec!["volume", "create", config_volume.as_str()],
            vec!["volume", "create", report_volume.as_str()],
        ] {
            let (status, _, stderr) = docker(&arguments, Duration::from_secs(10))?;
            if !status.success() {
                return Err(unavailable(format!(
                    "create isolated registry resource: {}",
                    String::from_utf8_lossy(&stderr)
                )));
            }
        }
        let mount = format!("{config_volume}:/config");
        let (status, _, stderr) = docker(
            &[
                "container",
                "create",
                "--name",
                &zot_container,
                "--network",
                &network,
                "--network-alias",
                "zot",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,nosuid,nodev",
                "--volume",
                &mount,
                ZOT_IMAGE,
                "serve",
                "/config/config.json",
            ],
            Duration::from_secs(30),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "create Zot subject: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let destination = format!("{zot_container}:/config/config.json");
        let (status, _, stderr) = docker(
            &[
                "container",
                "cp",
                config
                    .to_str()
                    .ok_or_else(|| unavailable("non-UTF-8 config path"))?,
                &destination,
            ],
            Duration::from_secs(10),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "seed Zot config: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let (status, _, stderr) = docker(
            &["container", "start", &zot_container],
            Duration::from_secs(10),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "start Zot subject: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let (status, _, stderr) = docker(
            &[
                "container",
                "create",
                "--name",
                &reference_container,
                "--network",
                &network,
                "--network-alias",
                "reference",
                "--read-only",
                "--tmpfs",
                "/var/lib/registry:rw,nosuid,nodev",
                reference_image,
            ],
            Duration::from_secs(30),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "create Distribution reference subject: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let (status, _, stderr) = docker(
            &["container", "start", &reference_container],
            Duration::from_secs(10),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "start Distribution reference subject: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        for alias in ["zot", "reference"] {
            let mut ready = false;
            for _ in 0..40 {
                let endpoint = format!("http://{alias}:5000/v2/");
                let (status, _, _) = docker(
                    &[
                        "run",
                        "--rm",
                        "--network",
                        &network,
                        "--entrypoint",
                        "/usr/bin/curl",
                        image,
                        "--fail",
                        "--silent",
                        &endpoint,
                    ],
                    Duration::from_secs(5),
                )?;
                if status.success() {
                    ready = true;
                    break;
                }
                std::thread::sleep(Duration::from_millis(250));
            }
            if !ready {
                return Err(unavailable(format!(
                    "isolated Distribution subject {alias} did not become ready"
                )));
            }
        }
        let (status, _, stderr) = initialize_distribution_reports(
            image,
            &report_volume,
            distribution_report_initializer(),
        )?;
        if !status.success() {
            return Err(unavailable(format!(
                "initialize Distribution report volume: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }

        let namespace_a = format!("prismpm/conformance-a-{nonce}");
        let namespace_b = format!("prismpm/conformance-b-{nonce}");
        let namespace_reference = format!("prismpm/reference-{nonce}");
        let namespace_reference_disabled = format!("prismpm/reference-disabled-{nonce}");
        let namespace_pull = format!("prismpm/pull-external-{nonce}");
        let namespace_discovery = format!("prismpm/discovery-external-{nonce}");
        let auto_manifest_first = [
            ("OCI_AUTOMATIC_CROSSMOUNT", "1"),
            ("OCI_DELETE_MANIFEST_BEFORE_BLOBS", "1"),
        ];
        let auto_blobs_first = [
            ("OCI_AUTOMATIC_CROSSMOUNT", "1"),
            ("OCI_DELETE_MANIFEST_BEFORE_BLOBS", "0"),
        ];
        let manual_crossmount = [
            ("OCI_AUTOMATIC_CROSSMOUNT", "0"),
            ("OCI_DELETE_MANIFEST_BEFORE_BLOBS", "0"),
        ];
        let pull_external_setup = [
            ("OCI_TAG_NAME", "tagtest0"),
            (
                "OCI_MANIFEST_DIGEST",
                "sha256:0000000000000000000000000000000000000000000000000000000000000000",
            ),
            (
                "OCI_BLOB_DIGEST",
                "sha256:1111111111111111111111111111111111111111111111111111111111111111",
            ),
        ];
        let discovery_external_setup = [("OCI_TAG_LIST", "test0,test1,test2,test3")];
        let runs = [
            DistributionRun {
                label: "zot-manifest-first-auto",
                subject_image: ZOT_IMAGE,
                root_url: "http://zot:5000",
                namespace: &namespace_a,
                report_volume: &report_volume,
                report_directory: "zot-manifest-first-auto",
                environment: &auto_manifest_first,
                focus: None,
            },
            DistributionRun {
                label: "zot-blobs-first-auto",
                subject_image: ZOT_IMAGE,
                root_url: "http://zot:5000",
                namespace: &namespace_b,
                report_volume: &report_volume,
                report_directory: "zot-blobs-first-auto",
                environment: &auto_blobs_first,
                focus: None,
            },
            DistributionRun {
                label: "reference-manual-crossmount",
                subject_image: reference_image,
                root_url: "http://reference:5000",
                namespace: &namespace_reference,
                report_volume: &report_volume,
                report_directory: "reference-manual-crossmount",
                environment: &manual_crossmount,
                focus: Some(
                    "POST request to mount another repository|Cross-mounting of nonexistent blob",
                ),
            },
            DistributionRun {
                label: "reference-automatic-disabled",
                subject_image: reference_image,
                root_url: "http://reference:5000",
                namespace: &namespace_reference_disabled,
                report_volume: &report_volume,
                report_directory: "reference-automatic-disabled",
                environment: &manual_crossmount,
                focus: Some(
                    "PATCH request with blob in body|PUT request to session URL|POST request to mount another repository|automatic content discovery disabled",
                ),
            },
            DistributionRun {
                label: "pull-external-setup",
                subject_image: ZOT_IMAGE,
                root_url: "http://zot:5000",
                namespace: &namespace_pull,
                report_volume: &report_volume,
                report_directory: "pull-external-setup",
                environment: &pull_external_setup,
                focus: Some("Get tag name from environment"),
            },
            DistributionRun {
                label: "discovery-external-setup",
                subject_image: ZOT_IMAGE,
                root_url: "http://zot:5000",
                namespace: &namespace_discovery,
                report_volume: &report_volume,
                report_directory: "discovery-external-setup",
                environment: &discovery_external_setup,
                focus: Some("Populate registry with test tags \\(no push\\)"),
            },
        ];
        let mut raw_reports = Vec::new();
        let mut inventory = BTreeSet::new();
        let mut passed = BTreeSet::new();
        for (index, run) in runs.iter().enumerate() {
            let (report, junit) = run_distribution_official(root, &network, image, run)?;
            if junit.all.len() != 79 {
                return Err(fail(format!(
                    "OCI Distribution run {} exposed {} specs, expected 79",
                    run.label,
                    junit.all.len()
                )));
            }
            if index < 2 {
                inventory.extend(junit.all);
            }
            passed.extend(junit.passed);
            raw_reports.push(report);
        }
        if inventory.len() != 79 {
            return Err(fail(format!(
                "OCI Distribution two teardown-order inventories contain {} official specs, expected 79",
                inventory.len()
            )));
        }
        let missing = inventory.difference(&passed).cloned().collect::<Vec<_>>();
        if !missing.is_empty() {
            return Err(fail(format!(
                "OCI Distribution official source specs were not executed successfully: {}",
                missing.join(", ")
            )));
        }
        let (planted, _, _) = docker(
            &[
                "run",
                "--rm",
                "--network",
                &network,
                "--read-only",
                "--user",
                "1000:1000",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--tmpfs",
                "/tmp:rw,nosuid,nodev",
                "--entrypoint",
                "/usr/local/bin/oci-distribution-conformance",
                "--env",
                "OCI_ROOT_URL=http://zot:1",
                "--env",
                "OCI_NAMESPACE=prismpm/planted",
                "--env",
                "OCI_CROSSMOUNT_NAMESPACE=prismpm/planted-cross",
                "--env",
                "OCI_TEST_PULL=1",
                "--env",
                "OCI_HIDE_SKIPPED_WORKFLOWS=1",
                "--env",
                "OCI_REPORT_DIR=none",
                image,
            ],
            Duration::from_secs(60),
        )?;
        if planted.success() {
            return Err(fail(
                "OCI Distribution planted unavailable subject was accepted",
            ));
        }
        Ok(DistributionEvidence {
            corpus_sha256: digest,
            subject_images: vec![ZOT_IMAGE, reference_image],
            passed: inventory.len() as u64,
            failed: 0,
            upstream_skipped: 0,
            planted_rejections: 1,
            raw_reports,
        })
    })();
    cleanup_distribution(
        &[&zot_container, &reference_container],
        &network,
        &[&config_volume, &report_volume],
    );
    result
}

fn telemetry_suite(root: &Path, image: &str) -> Result<TelemetryEvidence, PrismError> {
    let corpus = root.join("standards/corpora/opentelemetry-0.136.0");
    let digest = verify_tree(&corpus, OTEL_FIXTURES_TREE)?;
    let nonce = format!(
        "{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| unavailable(format!("system clock: {error}")))?
            .as_nanos()
    );
    let network = format!("prismpm-otel-conformance-{nonce}");
    let container = format!("prismpm-otel-conformance-collector-{nonce}");
    let result = (|| {
        let (created, _, stderr) = docker(
            &["network", "create", "--internal", &network],
            Duration::from_secs(10),
        )?;
        if !created.success() {
            return Err(unavailable(format!(
                "create isolated telemetry network: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let (started, _, stderr) = docker(
            &[
                "run",
                "--detach",
                "--name",
                &container,
                "--network",
                &network,
                "--network-alias",
                "collector",
                "--read-only",
                "--tmpfs",
                "/tmp:rw,noexec,nosuid,nodev",
                "--entrypoint",
                "/usr/local/bin/otelcol-contrib",
                image,
                "--config=/opt/prismpm/share/standards/corpora/opentelemetry-0.136.0/collector.yaml",
            ],
            Duration::from_secs(30),
        )?;
        if !started.success() {
            return Err(unavailable(format!(
                "start unmodified Collector: {}",
                String::from_utf8_lossy(&stderr)
            )));
        }
        let mut ready = false;
        for _ in 0..40 {
            let (status, _, _) = docker(
                &[
                    "run",
                    "--rm",
                    "--network",
                    &network,
                    "--entrypoint",
                    "/usr/bin/curl",
                    image,
                    "--silent",
                    "--output",
                    "/dev/null",
                    "http://collector:4318/",
                ],
                Duration::from_secs(5),
            )?;
            if status.success() {
                ready = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !ready {
            return Err(unavailable("unmodified Collector did not become ready"));
        }
        for (signal, fixture) in [
            ("traces", "traces.json"),
            ("metrics", "metrics.json"),
            ("logs", "logs.json"),
        ] {
            let data =
                format!("@/opt/prismpm/share/standards/corpora/opentelemetry-0.136.0/{fixture}");
            let endpoint = format!("http://collector:4318/v1/{signal}");
            let (status, _, stderr) = docker(
                &[
                    "run",
                    "--rm",
                    "--network",
                    &network,
                    "--entrypoint",
                    "/usr/bin/curl",
                    image,
                    "--fail-with-body",
                    "--silent",
                    "--show-error",
                    "--header",
                    "Content-Type: application/json",
                    "--data-binary",
                    &data,
                    &endpoint,
                ],
                Duration::from_secs(20),
            )?;
            if !status.success() {
                return Err(fail(format!(
                    "Collector rejected valid OTLP {signal}: {}",
                    String::from_utf8_lossy(&stderr)
                )));
            }
        }
        let invalid = "@/opt/prismpm/share/standards/corpora/opentelemetry-0.136.0/invalid.json";
        let (negative, _, _) = docker(
            &[
                "run",
                "--rm",
                "--network",
                &network,
                "--entrypoint",
                "/usr/bin/curl",
                image,
                "--fail-with-body",
                "--silent",
                "--header",
                "Content-Type: application/json",
                "--data-binary",
                invalid,
                "http://collector:4318/v1/traces",
            ],
            Duration::from_secs(20),
        )?;
        let (planted, _, _) = docker(
            &[
                "run",
                "--rm",
                "--network",
                &network,
                "--entrypoint",
                "/usr/bin/curl",
                image,
                "--fail-with-body",
                "--silent",
                "--header",
                "Content-Type: application/json",
                "--data-binary",
                "@/opt/prismpm/share/standards/corpora/opentelemetry-0.136.0/traces.json",
                "http://collector:4318/v1/planted-unknown-signal",
            ],
            Duration::from_secs(20),
        )?;
        if negative.success() || planted.success() {
            return Err(fail(
                "Collector accepted malformed or unknown-signal OTLP input",
            ));
        }
        let mut exported = false;
        for _ in 0..40 {
            let (status, stdout, stderr) = docker(&["logs", &container], Duration::from_secs(5))?;
            let logs = format!(
                "{}{}",
                String::from_utf8_lossy(&stdout),
                String::from_utf8_lossy(&stderr)
            );
            if status.success()
                && logs.contains("prismpm-conformance-trace")
                && logs.contains("prismpm.conformance.metric")
                && logs.contains("prismpm-conformance-log")
            {
                exported = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        if !exported {
            return Err(fail(
                "Collector did not export every declared trace, metric, and log fixture",
            ));
        }
        Ok(TelemetryEvidence {
            corpus_sha256: digest,
            accepted_signals: vec!["logs", "metrics", "traces"],
            negative: 1,
            planted_rejections: 1,
            runner: "otelcol-contrib/0.136.0",
        })
    })();
    let _ = docker(
        &["container", "rm", "--force", &container],
        Duration::from_secs(10),
    );
    let _ = docker(&["network", "rm", &network], Duration::from_secs(10));
    result
}

/// Run every required upstream corpus and runtime/registry subject probe and
/// atomically publish canonical evidence below `target/`.
pub fn verify(root: &Path) -> Result<UpstreamConformanceEvidence, PrismError> {
    let image = sdk_image()?;
    let evidence = UpstreamConformanceEvidence {
        schema: "prismpm/upstream-conformance-evidence/1",
        sdk_image: image.clone(),
        json_schema: json_schema_suite_rust(root)?,
        unicode: unicode_suite(root)?,
        cloudevents: cloudevents_suite(root, &image)?,
        asyncapi: asyncapi_suite(root, &image)?,
        in_toto: intoto_suite(root, &image)?,
        oci_image: oci_image_suite(root, &image)?,
        spdx: spdx_suite(root, &image)?,
        opentelemetry: telemetry_suite(root, &image)?,
        openid: openid_suite(root, &image)?,
        oci_runtime: runtime_suite(root, &image)?,
        oci_distribution: distribution_suite(root, &image)?,
    };
    let bytes = crate::holo::canonical::encode_value(
        &serde_json::to_value(&evidence)
            .map_err(|error| unavailable(format!("encode upstream evidence: {error}")))?,
    )?;
    let target = root.join("target");
    fs::create_dir_all(&target)
        .map_err(|error| unavailable(format!("create evidence directory: {error}")))?;
    let temporary = target.join("upstream-conformance.json.tmp");
    let final_path = target.join("upstream-conformance.json");
    fs::write(&temporary, bytes)
        .map_err(|error| unavailable(format!("write upstream evidence: {error}")))?;
    fs::rename(&temporary, &final_path)
        .map_err(|error| unavailable(format!("publish upstream evidence: {error}")))?;
    Ok(evidence)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sdk_oracle_reference_requires_complete_immutable_oci_identity() {
        let digest = "a".repeat(64);
        for reference in [
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/prismpm-sdk-candidate@sha256:{digest}"),
            format!("127.0.0.1:43567/prismpm-vv-sdk@sha256:{digest}"),
        ] {
            validate_sdk_image(&reference).unwrap();
        }
        for reference in [
            String::new(),
            "ghcr.io/uor-foundation/prismpm-sdk:latest".into(),
            "ghcr.io/uor-foundation/prismpm-sdk@sha256:".into(),
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
                "z".repeat(64)
            ),
            format!("ghcr.io/uor-foundation/prismpm-sdk:latest@sha256:{digest}"),
            format!("https://ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/../prismpm-sdk@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}\n"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}@sha256:{digest}"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}?other=1"),
            format!("ghcr.io/uor-foundation/prismpm-sdk@sha256:{digest}#fragment"),
            format!("@sha256:{digest}"),
        ] {
            let error = validate_sdk_image(&reference)
                .expect_err("malformed oracle reference must fail before Docker execution");
            assert_eq!(error.code.as_str(), "PP5403");
        }
    }

    struct ReportVolume(String);

    impl ReportVolume {
        fn create(label: &str) -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos();
            let volume = Self(format!(
                "prismpm-report-regression-{}-{nonce}-{label}",
                std::process::id()
            ));
            let (status, _, stderr) =
                docker(&["volume", "create", &volume.0], Duration::from_secs(10)).unwrap();
            assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
            volume
        }
    }

    impl Drop for ReportVolume {
        fn drop(&mut self) {
            let _ = docker(&["volume", "rm", &self.0], Duration::from_secs(10));
        }
    }

    fn write_distribution_report_probe(
        image: &str,
        volume: &ReportVolume,
    ) -> (ExitStatus, Vec<u8>, Vec<u8>) {
        docker(
            &[
                "run", "--rm", "--network", "none", "--read-only", "--user", "1000:1000",
                "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--volume",
                &format!("{}:/reports", volume.0), "--entrypoint", "/bin/sh", image, "-ec",
                r#"set -eu
test "$(id -u):$(id -g)" = 1000:1000
test "$(stat -c '%u:%g:%a' /reports)" = 0:0:755
test "$(find /reports -mindepth 1 -maxdepth 1 -type d | wc -l)" -eq 6
for directory in /reports/zot-manifest-first-auto /reports/zot-blobs-first-auto /reports/reference-manual-crossmount /reports/reference-automatic-disabled /reports/pull-external-setup /reports/discovery-external-setup; do
  printf '%s' actual-nonroot-write > "$directory/owner-write-probe"
  test "$(stat -c '%u:%g:%a' "$directory")" = 1000:1000:700
  test "$(cat "$directory/owner-write-probe")" = actual-nonroot-write
done
test ! -w /reports
test ! -w /usr/local/bin
printf '%s\n' DISTRIBUTION_NONROOT_REPORT_WRITE
"#,
            ],
            Duration::from_secs(30),
        ).unwrap()
    }

    #[test]
    fn distribution_report_volume_is_confined_and_owned_by_oracle_user() {
        let image = sdk_image().expect("exact SDK image required");
        let volume = ReportVolume::create("positive");
        let script = distribution_report_initializer();
        let (status, _, stderr) =
            initialize_distribution_reports(&image, &volume.0, script).unwrap();
        assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
        let (status, stdout, stderr) = write_distribution_report_probe(&image, &volume);
        assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
        assert_eq!(stdout, b"DISTRIBUTION_NONROOT_REPORT_WRITE\n");
        let (status, _, _) = initialize_distribution_reports(&image, &volume.0, script).unwrap();
        assert!(
            !status.success(),
            "nonempty report volume was reinitialized"
        );

        let without_ownership = script.replace("chown -- 1000:1000 \"$@\"\n", "");
        assert_ne!(without_ownership, script);
        let mutant = ReportVolume::create("missing-ownership");
        let (status, _, stderr) =
            initialize_distribution_reports(&image, &mutant.0, &without_ownership).unwrap();
        assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
        let (status, stdout, stderr) = write_distribution_report_probe(&image, &mutant);
        assert!(
            !status.success(),
            "nonroot writes succeeded without ownership"
        );
        assert!(!String::from_utf8_lossy(&stdout).contains("DISTRIBUTION_NONROOT_REPORT_WRITE"));
        assert!(String::from_utf8_lossy(&stderr).contains("Permission denied"));
    }

    fn run_openid_wrapper_source(
        image: &str,
        source: &str,
        selection: &str,
    ) -> (ExitStatus, Vec<u8>, Vec<u8>) {
        let encoded = base64::engine::general_purpose::STANDARD.encode(source);
        let script = format!(
            r#"set -eu
work=$(mktemp -d)
mkdir "$work/scratch"
printf '%s' '{encoded}' | base64 -d > "$work/wrapper.sh"
immutable() {{
  stat -c '%a:%u:%g' /opt/prismpm/share/standards/oracles/openid-conformance-suite-3e09b13b /opt/prismpm/openid-target
  sha256sum /opt/prismpm/share/standards/oracles/openid-conformance-suite-3e09b13b/pom.xml /usr/local/bin/openid-conformance
}}
before=$(immutable)
test -z "$(find "$work/scratch" -mindepth 1 -print -quit)"
set +e
TMPDIR="$work/scratch" /bin/sh "$work/wrapper.sh" "$1" > "$work/stdout" 2> "$work/stderr"
status=$?
set -e
cat "$work/stdout"
cat "$work/stderr" >&2
test "$before" = "$(immutable)"
if test -n "$(find "$work/scratch" -mindepth 1 -print -quit)"; then
  printf '%s\n' OPENID_SCRATCH_LEAK >&2
  exit 97
fi
exit "$status"
"#
        );
        docker(
            &[
                "run",
                "--rm",
                "--network",
                "none",
                "--read-only",
                "--user",
                "1000:1000",
                "--cap-drop",
                "ALL",
                "--security-opt",
                "no-new-privileges",
                "--tmpfs",
                "/tmp:rw,exec,nosuid,nodev,size=1g",
                "--entrypoint",
                "/bin/sh",
                image,
                "-ec",
                &script,
                "openid-wrapper-source-regression",
                selection,
            ],
            Duration::from_secs(120),
        )
        .expect("execute exact owned OpenID wrapper source in an immutable SDK")
    }

    #[test]
    fn openid_wrapper_scratch_is_writable_but_inputs_stay_immutable() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root");
        let source = fs::read_to_string(root.join("sdk/oracles/openid-conformance.sh"))
            .expect("owned OpenID wrapper");
        let image = sdk_image().expect("exact SDK image required");
        let (status, stdout, stderr) =
            run_openid_wrapper_source(&image, &source, "--official-selection");
        assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
        let marker = "{\"errors\":0,\"failures\":0,\"officialTests\":29,\"skipped\":0}";
        assert_eq!(String::from_utf8_lossy(&stdout).matches(marker).count(), 1);

        let (status, stdout, stderr) =
            run_openid_wrapper_source(&image, &source, "PlantedAbsentOpenIdCondition_UnitTest");
        assert!(!status.success());
        assert_ne!(status.code(), Some(97));
        assert!(!String::from_utf8_lossy(&stdout).contains(marker));
        assert!(!String::from_utf8_lossy(&stderr).contains("OPENID_SCRATCH_LEAK"));

        let start = source
            .find("/opt/prismpm/openid-maven/bin/mvn \\\n")
            .expect("the real Maven invocation");
        let end = start
            + source[start..]
                .find("    surefire:test\n")
                .expect("the complete official test invocation")
            + "    surefire:test\n".len();
        let mut omitted = source.clone();
        omitted.replace_range(start..end, ":\n");
        let (status, stdout, stderr) =
            run_openid_wrapper_source(&image, &omitted, "--official-selection");
        assert!(!status.success(), "wrapper accepted without running Maven");
        assert_ne!(status.code(), Some(97));
        assert!(!String::from_utf8_lossy(&stdout).contains(marker));
        assert!(!String::from_utf8_lossy(&stderr).contains("OPENID_SCRATCH_LEAK"));
    }

    #[test]
    fn oci_image_official_corpus_and_graph_probes_execute() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root");
        let evidence = oci_image_suite(root, &sdk_image().expect("exact SDK image required"))
            .expect("all 14 official tests and independent ORAS graph probes");
        assert_eq!(evidence.positive, 19);
        assert_eq!(evidence.negative, 2);
        assert_eq!(evidence.planted_rejections, 2);
        assert_eq!(
            evidence.runner,
            "opencontainers/image-spec/1.1.1+oras/1.3.0"
        );
    }

    #[test]
    fn oci_image_graph_corruption_executes_nonroot_and_cannot_be_omitted() {
        let image = sdk_image().expect("exact SDK image required");
        let run = |script: &str| {
            docker(
                &[
                    "run",
                    "--rm",
                    "--network",
                    "none",
                    "--read-only",
                    "--user",
                    "1000:1000",
                    "--cap-drop",
                    "ALL",
                    "--security-opt",
                    "no-new-privileges",
                    "--tmpfs",
                    "/tmp:rw,noexec,nosuid,nodev",
                    "--entrypoint",
                    "/bin/sh",
                    &image,
                    "-ec",
                    script,
                ],
                Duration::from_secs(60),
            )
            .expect("actual non-root ORAS graph execution")
        };
        let script = oci_image_graph_probe();
        let (status, stdout, stderr) = run(script);
        assert!(status.success(), "{}", String::from_utf8_lossy(&stderr));
        assert_eq!(stdout, b"OCI_GRAPH_OK\n");

        let permission = "chmod u+w -- \"layout/blobs/sha256/${subject#sha256:}\"\n";
        assert_eq!(script.matches(permission).count(), 1);
        let (status, stdout, stderr) = run(&script.replace(permission, ""));
        assert!(!status.success());
        assert_ne!(status.code(), Some(42));
        assert!(String::from_utf8_lossy(&stderr).contains("Permission denied"));
        assert!(!String::from_utf8_lossy(&stdout).contains("OCI_GRAPH_OK"));

        let corruption = "printf '%s' corrupt > \"layout/blobs/sha256/${subject#sha256:}\"\n";
        assert_eq!(script.matches(corruption).count(), 1);
        let (status, stdout, _) = run(&script.replace(corruption, ":\n"));
        assert_eq!(status.code(), Some(42));
        assert!(!String::from_utf8_lossy(&stdout).contains("OCI_GRAPH_OK"));
    }

    #[test]
    fn imported_unicode_corpus_executes_positive_negative_and_planted_cases() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root")
            .to_path_buf();
        let unicode = unicode_suite(&root).expect("official Unicode corpus");
        assert!(unicode.positive > 0 && unicode.negative > 0 && unicode.planted_rejections > 0);
    }

    #[test]
    fn imported_json_schema_corpus_executes_every_mandatory_case() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root");
        let evidence = json_schema_suite_rust(root).expect("official JSON Schema corpus");
        assert!(evidence.positive > 0 && evidence.negative > 0);
        assert_eq!(evidence.planted_rejections, 1);
    }

    #[test]
    fn imported_asyncapi_and_intoto_sources_are_exact_regular_trees() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root");
        assert!(verify_tree(
            &root.join("standards/oracles/asyncapi-spec-b3fac5bb"),
            ASYNCAPI_TREE
        )
        .is_ok());
        assert!(verify_asyncapi_adeo_mirrors(root).is_ok());
        let runtime = asyncapi_runtime_probe(root).expect("owned AsyncAPI runtime source closure");
        assert!(runtime.contains(ASYNCAPI_RUNTIME_LOCK));
        assert!(runtime.contains("readlink -f /usr/local/bin/asyncapi-official"));
        assert!(runtime.contains("exec /usr/local/bin/asyncapi-official --check"));
        assert!(verify_tree(
            &root.join("standards/oracles/in-toto-attestation-ee16c68a"),
            INTOTO_TREE
        )
        .is_ok());
    }

    #[test]
    fn asyncapi_owned_runtime_replays_complete_official_corpus() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .and_then(Path::parent)
            .expect("repository root");
        let evidence = asyncapi_suite(root, &sdk_image().expect("exact SDK image required"))
            .expect("complete AsyncAPI owning gate, including all five runtime regression groups");
        assert_eq!(evidence.published_documents, 24);
        assert_eq!(evidence.embedded_examples, 89);
        assert_eq!(evidence.negative_mutations, 1);
        assert_eq!(evidence.planted_rejections, 1);
        assert_eq!(evidence.upstream_negative_fixtures, 0);
        assert_eq!(evidence.parser, "@asyncapi/parser/3.6.3");
        assert!(evidence.upstream_runner.ends_with(ASYNCAPI_RUNTIME_LOCK));
    }

    #[test]
    fn asyncapi_runtime_report_rejects_other_parsers_locks_and_extra_claims() {
        let valid = serde_json::json!({"parser":"@asyncapi/parser/3.6.0","runtimeLock":ASYNCAPI_RUNTIME_LOCK});
        let encode = |value: &Value| format!("{value}\n").into_bytes();
        let bytes = encode(&valid);
        assert!(validate_asyncapi_runtime_report(&bytes).is_ok());
        assert!(validate_asyncapi_runtime_report(&bytes[..bytes.len() - 1]).is_err());
        assert!(
            validate_asyncapi_runtime_report(&[bytes.clone(), b"\n".to_vec()].concat()).is_err()
        );
        let duplicate = String::from_utf8(bytes)
            .unwrap()
            .replace("\"parser\":", "\"parser\":\"wrong\",\"parser\":");
        assert!(validate_asyncapi_runtime_report(duplicate.as_bytes()).is_err());
        for changed in [
            serde_json::json!({"parser":"@asyncapi/parser/3.6.3","runtimeLock":ASYNCAPI_RUNTIME_LOCK}),
            serde_json::json!({"parser":"@asyncapi/parser/3.6.0","runtimeLock":"historical-lock"}),
            serde_json::json!({"parser":"@asyncapi/parser/3.6.0","runtimeLock":ASYNCAPI_RUNTIME_LOCK,"accepted":true}),
            serde_json::json!({"passed":true}),
        ] {
            assert!(validate_asyncapi_runtime_report(&encode(&changed)).is_err());
        }
    }

    #[test]
    fn asyncapi_runtime_tap_requires_all_five_groups_without_skips_or_duplicate_summaries() {
        let valid = concat!(
            "TAP version 13\n",
            "ok 1 - the owned runtime runs all 89 unchanged upstream examples with parser 3.6.0\n",
            "ok 2 - the owning launcher rejects changed source, lock, parser, missing modules and shadow resolution\n",
            "ok 3 - fixed inventory binding rejects absent, duplicate, changed, extra-field or noncanonical runtime rows\n",
            "ok 4 - runtime byte framing matches inventory and allows only in-tree executable aliases\n",
            "ok 5 - the shell entry rejects ambient preloads before any Node code can execute\n",
            "1..5\n# tests 5\n# suites 0\n# pass 5\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n",
        );
        assert!(validate_asyncapi_runtime_tests(valid.as_bytes()).is_ok());
        // Actual Node execution exited zero despite skipping every registered group.
        assert!(validate_asyncapi_runtime_tests(include_bytes!(
            "upstream_conformance_fixtures/asyncapi-runtime-skipped.tap"
        ))
        .is_err());
        for invalid in [
            String::new(),
            valid.replace("# tests 5\n", ""),
            format!("{valid}# tests 5\n"),
            format!("{valid}1..5\n"),
            valid.replace("# pass 5", "# pass 4"),
            valid.replace("# skipped 0", "# skipped 1"),
            valid.replace("# cancelled 0", "# cancelled 1"),
            valid.replace("# todo 0", "# todo 1"),
            valid.replace("# fail 0", "# fail 1"),
            valid.replace("# tests 5", "# tests 05"),
            valid.replace("1..5", "1..0"),
            valid.replace("ok 1 -", "not ok 1 -"),
            valid.replace("parser 3.6.0\n", "parser 3.6.0 # SKIP\n"),
            valid[..valid.find("# cancelled").unwrap()].to_owned(),
        ] {
            assert!(
                validate_asyncapi_runtime_tests(invalid.as_bytes()).is_err(),
                "accepted {invalid:?}"
            );
        }
    }
}
