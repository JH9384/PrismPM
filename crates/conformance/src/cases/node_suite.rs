//! Complete owning Node execution. File wrappers are not registered tests.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::path::{Component, Path, PathBuf};
use std::process::Command;

const REPORTER: &[u8] = include_bytes!("../../../../scripts/owning-node-reporter.mjs");
const FILE_PREFIX: &str = "# prismpm-owning-file ";

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PhaseSummary {
    scope: String,
    phases: Vec<PhaseTiming>,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct PhaseTiming {
    phase: String,
    calls: u64,
    failures: u64,
    elapsed_ms: u64,
}

// Diagnostic parsing is fail-closed but non-authoritative. Never forward child
// prose, paths or additional fields, and never change a passing/failing owner.
fn phase_summary(stdout: &[u8]) -> Option<PhaseSummary> {
    const PREFIX: &str = "# prismpm-compiler-phase-summary ";
    let text = std::str::from_utf8(stdout).ok()?;
    let mut rows = text.lines().filter_map(|line| line.strip_prefix(PREFIX));
    let line = rows.next()?;
    if line.len() > 4096 || rows.next().is_some() {
        return None;
    }
    let summary: PhaseSummary = serde_json::from_str(line).ok()?;
    if summary.scope != "compiler-phase-diagnostic-not-acceptance"
        || summary.phases.is_empty()
        || summary.phases.len() > 12
    {
        return None;
    }
    let mut previous = None;
    for row in &summary.phases {
        if !matches!(
            row.phase.as_str(),
            "archive-extraction"
                | "artifact-cleanup"
                | "exporter-construction"
                | "generated-module-build"
                | "kernel-export"
                | "lake-update"
                | "lexlean-verification"
                | "native-code-generation"
                | "rust-compilation"
                | "toolchain-check"
                | "unclassified-execution"
                | "wasm-code-generation"
        ) || row.calls == 0
            || row.calls > 1_000_000
            || row.failures > row.calls
            || row.elapsed_ms > row.calls * 600_000
            || previous.is_some_and(|value: &str| value >= row.phase.as_str())
        {
            return None;
        }
        previous = Some(row.phase.as_str());
    }
    Some(summary)
}

fn write_diagnostic(writer: &mut impl std::io::Write, prefix: &str, record: &serde_json::Value) {
    // Formatting JSON directly into stderr performs many tiny writes. Build
    // each bounded line first so the transport receives one complete record.
    // A short write is completed by write_all; failure remains diagnostic loss.
    let line = format!("{prefix}{record}\n");
    if line.len() <= 4096 {
        let _ = writer.write_all(line.as_bytes());
    }
}

fn failure_diagnostics(id: &str, reason: &str, stdout: &[u8], stderr: &[u8]) -> Vec<u8> {
    use std::io::Write;
    let mut bytes = Vec::new();
    writeln!(bytes, "\n{id}: owning Node execution failed; diagnostic excerpt only (stdout {} bytes, stderr {} bytes)", stdout.len(), stderr.len()).unwrap();
    bytes.extend_from_slice(b"assertion: ");
    bytes.extend_from_slice(&reason.as_bytes()[..reason.len().min(4096)]);
    bytes.push(b'\n');
    for (name, stream) in [("stdout", stdout), ("stderr", stderr)] {
        writeln!(bytes, "{name}:").unwrap();
        if stream.len() <= 65536 {
            bytes.extend_from_slice(stream);
        } else {
            bytes.extend_from_slice(&stream[..32768]);
            bytes.extend_from_slice(b"\n[diagnostic excerpt truncated; no acceptance inferred]\n");
            bytes.extend_from_slice(&stream[stream.len() - 32768..]);
        }
        bytes.push(b'\n');
    }
    bytes
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct FileCompletion {
    file: String,
    success: bool,
    tests: u64,
    passed: u64,
    failed: u64,
    cancelled: u64,
    skipped: u64,
    todo: u64,
    #[serde(rename = "topLevel")]
    top_level: u64,
    suites: u64,
}

fn selected_files(root: &Path, files: &[&str]) -> Vec<PathBuf> {
    assert!(root.is_absolute(), "absolute owning test root");
    assert!(
        !files.is_empty() && files.len() <= 64,
        "bounded selected file set"
    );
    assert_eq!(
        files.iter().collect::<BTreeSet<_>>().len(),
        files.len(),
        "duplicate selected test file"
    );
    files
        .iter()
        .map(|file| {
            assert!(
                file.split('/').all(|part| !part.is_empty()
                    && part != "."
                    && part != ".."
                    && part
                        .bytes()
                        .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))),
                "closed relative selected test file"
            );
            let selected = root.join(file);
            let mut current = PathBuf::new();
            for part in selected.components() {
                assert!(
                    matches!(part, Component::RootDir | Component::Normal(_)),
                    "closed selected test path"
                );
                current.push(part.as_os_str());
                let metadata = std::fs::symlink_metadata(&current)
                    .expect("every selected test file and parent must exist");
                assert!(
                    !metadata.file_type().is_symlink(),
                    "selected test path alias"
                );
                assert!(
                    if current == selected {
                        metadata.is_file()
                    } else {
                        metadata.is_dir()
                    },
                    "selected regular test file and directory parents"
                );
            }
            selected
        })
        .collect()
}

fn file_completions(stdout: &str, files: &[PathBuf], total: usize) {
    let rows = stdout
        .lines()
        .filter_map(|line| line.strip_prefix(FILE_PREFIX))
        .map(|line| {
            let row =
                serde_json::from_str::<FileCompletion>(line).expect("closed file completion JSON");
            assert_eq!(
                serde_json::to_string(&row).unwrap(),
                line,
                "exact file completion JSON"
            );
            row
        })
        .collect::<Vec<_>>();
    assert_eq!(
        rows.len(),
        files.len(),
        "complete selected test file summaries"
    );
    let mut observed = Vec::new();
    let mut tests = 0usize;
    for row in &rows {
        observed.push(PathBuf::from(&row.file));
        assert!(row.success, "successful selected test file");
        let count = |count: u64| {
            assert!(count <= 9_007_199_254_740_991, "safe file test count");
            usize::try_from(count).expect("platform file test count")
        };
        for value in [
            row.tests,
            row.passed,
            row.failed,
            row.cancelled,
            row.skipped,
            row.todo,
            row.top_level,
            row.suites,
        ] {
            count(value);
        }
        assert!(
            row.tests > 0 && row.top_level > 0 && row.top_level <= row.tests,
            "nonempty registered tests in every selected file"
        );
        assert_eq!(row.passed, row.tests, "complete selected file pass set");
        for outcome in [row.failed, row.cancelled, row.skipped, row.todo] {
            assert_eq!(outcome, 0, "unsuccessful selected file completion");
        }
        tests = tests
            .checked_add(count(row.tests))
            .expect("bounded total file test count");
        assert!(tests <= 9_007_199_254_740_991, "safe total file test count");
    }
    observed.sort();
    let mut expected = files.to_vec();
    expected.sort();
    assert_eq!(observed, expected, "exact selected file completions");
    assert_eq!(
        tests, total,
        "file completions match complete TAP test count"
    );
}

pub(super) fn verify(root: &Path, id: &str, files: &[&str], minimum_tests: usize, timeout: &str) {
    // Validate all selected paths before dispatch. The installed SDK separately
    // binds immutable source bytes; this preflight is not a filesystem race lock.
    let selected = selected_files(root, files);
    let encoded = REPORTER
        .iter()
        .map(|byte| format!("%{byte:02X}"))
        .collect::<String>();
    let reporter = format!("--test-reporter=data:text/javascript,{encoded}");
    // Measure this actual child execution, not time spent waiting for the
    // compiler scheduler. Timing is diagnostic only, never acceptance.
    let started = std::time::Instant::now();
    let output = Command::new("node")
        .env_remove("LD_LIBRARY_PATH")
        .env_remove("NODE_TEST_CONTEXT")
        .args(["--test", &reporter, "--test-timeout", timeout])
        .args(files)
        .current_dir(root)
        .output()
        .expect("execute complete owning Node suite in the devcontainer");
    let elapsed_ms = started.elapsed().as_millis();
    let validation = std::panic::catch_unwind(|| {
        let stdout = std::str::from_utf8(&output.stdout).expect("UTF-8 TAP output");
        assert!(
            output.status.success(),
            "{id}: {stdout}\n{}",
            String::from_utf8_lossy(&output.stderr)
        );
        let count = |name: &str| {
            let prefix = format!("# {name} ");
            let values = stdout
                .lines()
                .filter_map(|line| line.strip_prefix(&prefix))
                .map(|value| value.parse::<usize>().expect("numeric TAP summary"))
                .collect::<Vec<_>>();
            assert_eq!(values.len(), 1, "{id}: missing or duplicate {name} summary");
            values[0]
        };
        assert!(
            count("tests") >= minimum_tests,
            "{id}: incomplete test suite"
        );
        assert_eq!(count("tests"), count("pass"), "{id}: incomplete pass set");
        for outcome in ["fail", "cancelled", "skipped", "todo"] {
            assert_eq!(
                count(outcome),
                0,
                "{id}: {outcome} tests cannot satisfy acceptance"
            );
        }
        let tests = count("tests");
        file_completions(stdout, &selected, tests);
        tests
    });
    let tests = match validation {
        Ok(tests) => tests,
        Err(failure) => {
            // Direct Write bypasses libtest's per-test print capture. ci-observe
            // retains process AND transcript failures before another long test
            // can be cancelled ahead of libtest's final failure report.
            use std::io::Write;
            let mut stderr = std::io::stderr().lock();
            let reason = failure
                .downcast_ref::<String>()
                .map(String::as_str)
                .or_else(|| failure.downcast_ref::<&str>().copied())
                .unwrap_or("non-string assertion payload");
            // A closed diagnostic pipe must not replace the owning failure.
            let _ = stderr.write_all(&failure_diagnostics(
                id,
                reason,
                &output.stdout,
                &output.stderr,
            ));
            let _ = stderr.flush();
            std::panic::resume_unwind(failure);
        }
    };
    // Direct Write also bypasses libtest capture for successful owners. Keep
    // only closed numeric summary fields and the owning identifier: never
    // echo child diagnostics, private paths, environment or arbitrary stdout.
    use std::io::Write;
    let diagnostic = serde_json::json!({
        "scope": "node-owner-diagnostic-not-acceptance", "owner": id,
        "elapsed_ms": elapsed_ms, "files": files.len(), "tests": tests
    });
    let mut stderr = std::io::stderr().lock();
    if let Some(phases) = phase_summary(&output.stdout) {
        let record = serde_json::json!({"scope":phases.scope,"owner":id,"phases":phases.phases});
        write_diagnostic(&mut stderr, "# prismpm-compiler-phase-diagnostic ", &record);
    }
    // A broken diagnostic pipe cannot replace a successful owning result.
    write_diagnostic(&mut stderr, "# prismpm-node-owner-diagnostic ", &diagnostic);
    let _ = stderr.flush();
}

#[cfg(test)]
mod tests {
    use super::{file_completions, selected_files, verify, FileCompletion, FILE_PREFIX};

    #[test]
    fn complete_diagnostics_are_formatted_before_the_transport_write() {
        #[derive(Default)]
        struct Transport {
            writes: Vec<Vec<u8>>,
            maximum: Option<usize>,
        }
        impl std::io::Write for Transport {
            fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
                let count = self.maximum.unwrap_or(bytes.len()).min(bytes.len());
                self.writes.push(bytes[..count].to_vec());
                Ok(count)
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        let record = serde_json::json!({"owner":"DK-16",
            "scope":"compiler-phase-diagnostic-not-acceptance",
            "phases":[{"calls":3,"elapsed_ms":123456,"failures":0,"phase":"rust-compilation"}]});
        let prefix = "# prismpm-compiler-phase-diagnostic ";
        let expected = format!("{prefix}{record}\n").into_bytes();
        let mut transport = Transport::default();
        super::write_diagnostic(&mut transport, prefix, &record);
        assert_eq!(transport.writes, std::slice::from_ref(&expected));
        let mut short = Transport {
            maximum: Some(7),
            ..Transport::default()
        };
        super::write_diagnostic(&mut short, prefix, &record);
        assert_eq!(short.writes.concat(), expected);
    }

    #[test]
    fn unavailable_or_oversized_diagnostics_do_not_become_acceptance_failures() {
        struct Unavailable;
        impl std::io::Write for Unavailable {
            fn write(&mut self, _: &[u8]) -> std::io::Result<usize> {
                Err(std::io::ErrorKind::BrokenPipe.into())
            }
            fn flush(&mut self) -> std::io::Result<()> {
                Ok(())
            }
        }
        super::write_diagnostic(
            &mut Unavailable,
            "# diagnostic ",
            &serde_json::json!({"tests":1}),
        );
        let mut captured = Vec::new();
        super::write_diagnostic(
            &mut captured,
            "# diagnostic ",
            &serde_json::json!("x".repeat(4096)),
        );
        assert!(
            captured.is_empty(),
            "oversized diagnostic is omitted, never truncated"
        );
        super::write_diagnostic(
            &mut captured,
            "# diagnostic ",
            &serde_json::json!("😀".repeat(1024)),
        );
        assert!(captured.is_empty(), "the bound counts UTF-8 bytes");
    }

    #[test]
    fn complete_json_records_survive_competing_stdout_and_stderr_writers() {
        use std::io::{Read, Seek, SeekFrom, Write};
        const CHILD: &str = "PRISMPM_DIAGNOSTIC_TRANSPORT_CHILD";
        if std::env::var_os(CHILD).is_some() {
            // Finish libtest's unterminated progress prefix before the fixture.
            std::io::stdout().lock().write_all(b"\n").unwrap();
            std::thread::scope(|scope| {
                for owner in ["DK-16", "DK-23"] {
                    scope.spawn(move || {
                        for index in 0..128 {
                            let phases = [
                                "archive-extraction", "artifact-cleanup", "exporter-construction",
                                "generated-module-build", "kernel-export", "lake-update",
                                "lexlean-verification", "native-code-generation", "rust-compilation",
                                "toolchain-check", "unclassified-execution", "wasm-code-generation",
                            ].map(|phase| serde_json::json!({"phase":phase,"calls":100,
                                "failures":0,"elapsed_ms":123456}));
                            let record = serde_json::json!({"owner":owner,"index":index,
                                "scope":"compiler-phase-diagnostic-not-acceptance","phases":phases});
                            super::write_diagnostic(
                                &mut std::io::stderr().lock(),
                                "# prismpm-compiler-phase-diagnostic ",
                                &record,
                            );
                        }
                    });
                }
                scope.spawn(|| {
                    for index in 0..256 {
                        let line = format!("competing stdout {index}\n");
                        std::io::stdout().lock().write_all(line.as_bytes()).unwrap();
                    }
                });
            });
            return;
        }
        let mut combined = tempfile::tempfile().unwrap();
        let status = std::process::Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "cases::node_suite::tests::complete_json_records_survive_competing_stdout_and_stderr_writers",
                "--test-threads=1",
            ])
            .env(CHILD, "1")
            // Both descriptors share one open-file offset. This exercises
            // genuinely combined transport, not separately captured pipes.
            .stdout(combined.try_clone().unwrap())
            .stderr(combined.try_clone().unwrap())
            .status()
            .unwrap();
        assert!(status.success());
        combined.seek(SeekFrom::Start(0)).unwrap();
        let mut transcript = String::new();
        combined.read_to_string(&mut transcript).unwrap();
        let mut seen = std::collections::BTreeSet::new();
        for line in transcript
            .lines()
            .filter(|line| line.starts_with("# prismpm-compiler-phase-diagnostic "))
        {
            assert!(line.len() < 4096);
            let json = line
                .strip_prefix("# prismpm-compiler-phase-diagnostic ")
                .unwrap();
            let value: serde_json::Value = serde_json::from_str(json).unwrap();
            assert_eq!(value["phases"].as_array().unwrap().len(), 12);
            assert!(seen.insert((
                value["owner"].as_str().unwrap().to_owned(),
                value["index"].as_u64().unwrap()
            )));
        }
        assert_eq!(seen.len(), 256);
        assert_eq!(transcript.matches("competing stdout ").count(), 256);
    }
    use std::path::PathBuf;

    #[test]
    fn compiler_phase_diagnostics_are_closed_bounded_and_not_acceptance() {
        let record = serde_json::json!({"scope":"compiler-phase-diagnostic-not-acceptance",
            "phases":[{"phase":"kernel-export","calls":2,"failures":1,"elapsed_ms":123}]});
        let encode =
            |value: &serde_json::Value| format!("# prismpm-compiler-phase-summary {value}\n");
        assert!(super::phase_summary(encode(&record).as_bytes()).is_some());
        for invalid in [
            serde_json::json!({"scope":"acceptance","phases":record["phases"]}),
            serde_json::json!({"scope":record["scope"],"phases":[],"secret":"credential"}),
            serde_json::json!({"scope":record["scope"],"phases":[]}),
        ] {
            assert!(super::phase_summary(encode(&invalid).as_bytes()).is_none());
        }
        for (field, value) in [
            ("phase", serde_json::json!("/private/path")),
            ("calls", serde_json::json!(0)),
            ("calls", serde_json::json!(1_000_001)),
            ("failures", serde_json::json!(3)),
            ("elapsed_ms", serde_json::json!(1_200_001)),
            ("elapsed_ms", serde_json::json!(-1)),
            ("elapsed_ms", serde_json::json!(0.5)),
            ("extra", serde_json::json!("secret")),
        ] {
            let mut invalid = record.clone();
            invalid["phases"][0][field] = value;
            assert!(super::phase_summary(encode(&invalid).as_bytes()).is_none());
        }
        let mut duplicate = record.clone();
        duplicate["phases"]
            .as_array_mut()
            .unwrap()
            .push(record["phases"][0].clone());
        assert!(super::phase_summary(encode(&duplicate).as_bytes()).is_none());
        assert!(super::phase_summary(encode(&record).repeat(2).as_bytes()).is_none());
        assert!(super::phase_summary(b"# prismpm-compiler-phase-summary malformed\n").is_none());
    }

    #[test]
    fn failure_excerpts_are_bounded_and_preserve_both_stream_ends() {
        let small = super::failure_diagnostics(
            "DK-09",
            "missing summary",
            b"actual failure",
            b"actual error",
        );
        let text = std::str::from_utf8(&small).unwrap();
        assert!(
            text.contains("DK-09")
                && text.contains("actual failure")
                && text.contains("actual error")
                && text.contains("assertion: missing summary")
        );
        let mut large = vec![b'x'; 1024 * 1024];
        large[..5].copy_from_slice(b"FIRST");
        let end = large.len();
        large[end - 4..].copy_from_slice(b"LAST");
        let bounded = super::failure_diagnostics("DK-09", &"r".repeat(1024 * 1024), &large, &large);
        assert!(bounded.len() < 137000);
        let text = std::str::from_utf8(&bounded).unwrap();
        assert_eq!(text.matches("FIRST").count(), 2);
        assert_eq!(text.matches("LAST").count(), 2);
        assert_eq!(text.matches("truncated; no acceptance inferred").count(), 2);
        assert!(text.contains("1048576 bytes"));
    }

    #[test]
    fn diagnostics_precede_libtest_summary() {
        use std::io::{BufRead, Read, Write};
        use std::process::{Command, Stdio};
        const CHILD: &str = "PRISMPM_NODE_DIAGNOSTICS_CHILD";
        if let Some(mode) = std::env::var_os(CHILD) {
            let temporary = tempfile::tempdir().unwrap();
            std::fs::write(
                temporary.path().join("one.mjs"),
                "import{test}from'node:test';test('one',()=>{});",
            )
            .unwrap();
            if mode == "success" {
                verify(
                    temporary.path(),
                    "diagnostic-probe",
                    &["one.mjs"],
                    1,
                    "10000",
                );
            } else {
                assert_eq!(mode, "failure");
                let failure = std::panic::catch_unwind(|| {
                    verify(
                        temporary.path(),
                        "diagnostic-probe",
                        &["one.mjs"],
                        2,
                        "10000",
                    )
                })
                .unwrap_err();
                assert!(failure
                    .downcast_ref::<String>()
                    .unwrap()
                    .contains("incomplete test suite"));
            }
            std::io::stderr()
                .write_all(b"PRISMPM_DIAGNOSTICS_READY\n")
                .unwrap();
            // Parent observes diagnostics while this test is still running.
            std::io::stdin().read_exact(&mut [0u8; 1]).unwrap();
            return;
        }
        for mode in ["failure", "success"] {
            let mut child = Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "cases::node_suite::tests::diagnostics_precede_libtest_summary",
                    "--test-threads=1",
                ])
                .env(CHILD, mode)
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .stderr(Stdio::piped())
                .spawn()
                .unwrap();
            let stderr = child.stderr.take().unwrap();
            let (sender, receiver) = std::sync::mpsc::channel();
            let reader = std::thread::spawn(move || {
                let mut observed = String::new();
                for line in std::io::BufReader::new(stderr).lines() {
                    let line = line.unwrap();
                    observed.push_str(&line);
                    observed.push('\n');
                    if line == "PRISMPM_DIAGNOSTICS_READY" {
                        sender.send(observed).unwrap();
                        break;
                    }
                }
            });
            let observed = receiver.recv_timeout(std::time::Duration::from_secs(30));
            if observed.is_err() {
                let _ = child.kill();
                let _ = child.wait();
            }
            let observed = observed.expect("immediate diagnostics before child test completion");
            assert!(child.try_wait().unwrap().is_none());
            child.stdin.take().unwrap().write_all(b"x").unwrap();
            let output = child.wait_with_output().unwrap();
            reader.join().unwrap();
            assert!(
                output.status.success(),
                "{}",
                String::from_utf8_lossy(&output.stdout)
            );
            if mode == "failure" {
                assert!(observed.contains("assertion: diagnostic-probe: incomplete test suite"));
                assert!(observed.contains("# pass 1"));
            } else {
                let prefix = "# prismpm-node-owner-diagnostic ";
                let rows = observed
                    .lines()
                    .filter_map(|line| line.strip_prefix(prefix))
                    .collect::<Vec<_>>();
                assert_eq!(
                    rows.len(),
                    1,
                    "one direct completion diagnostic before libtest summary"
                );
                let record: serde_json::Value = serde_json::from_str(rows[0]).unwrap();
                assert_eq!(record["scope"], "node-owner-diagnostic-not-acceptance");
                assert_eq!(record["owner"], "diagnostic-probe");
                assert_eq!(record["files"], 1);
                assert_eq!(record["tests"], 1);
                assert!(record["elapsed_ms"].as_u64().unwrap() < 10000);
                assert_eq!(record.as_object().unwrap().len(), 5);
                assert!(
                    !observed.contains("# pass 1"),
                    "success diagnostics do not dump child output"
                );
            }
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed"));
        }
    }

    #[test]
    fn selected_paths_reject_aliases_nonregular_and_omitted_files_before_execution() {
        for defect in [
            "missing",
            "file-alias",
            "parent-alias",
            "root-alias",
            "directory",
            "fifo",
        ] {
            let temporary = tempfile::tempdir().unwrap();
            let root = temporary.path().join("root");
            std::fs::create_dir_all(root.join("cases")).unwrap();
            let marker = root.join("executed");
            std::fs::write(root.join("first.mjs"), format!(
                "import{{writeFileSync}}from'node:fs';import{{test}}from'node:test';writeFileSync({},'ran');test('first',()=>{{}});",
                serde_json::to_string(&marker).unwrap())).unwrap();
            let selected = root.join("cases/second.mjs");
            std::fs::write(
                &selected,
                "import{test}from'node:test';test('second',()=>{});",
            )
            .unwrap();
            let mut selected_root = root.clone();
            match defect {
                "missing" => std::fs::remove_file(&selected).unwrap(),
                "file-alias" => {
                    std::fs::remove_file(&selected).unwrap();
                    std::os::unix::fs::symlink("../first.mjs", &selected).unwrap();
                }
                "parent-alias" => {
                    std::fs::rename(root.join("cases"), root.join("actual")).unwrap();
                    std::os::unix::fs::symlink("actual", root.join("cases")).unwrap();
                }
                "root-alias" => {
                    selected_root = temporary.path().join("alias");
                    std::os::unix::fs::symlink("root", &selected_root).unwrap();
                }
                "directory" => {
                    std::fs::remove_file(&selected).unwrap();
                    std::fs::create_dir(&selected).unwrap();
                }
                "fifo" => {
                    std::fs::remove_file(&selected).unwrap();
                    assert!(std::process::Command::new("mkfifo")
                        .arg(&selected)
                        .status()
                        .unwrap()
                        .success());
                }
                _ => unreachable!(),
            }
            assert!(
                std::panic::catch_unwind(|| {
                    verify(
                        &selected_root,
                        "test",
                        &["first.mjs", "cases/second.mjs"],
                        1,
                        "5000",
                    );
                })
                .is_err(),
                "{defect}"
            );
            assert!(
                !marker.exists(),
                "{defect} dispatched code before complete preflight"
            );
        }
    }

    #[test]
    fn selected_file_inventory_is_closed_and_unique() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("first.mjs"), "").unwrap();
        for files in [
            vec![],
            vec!["first.mjs", "first.mjs"],
            vec!["/first.mjs"],
            vec!["../first.mjs"],
            vec!["./first.mjs"],
            vec!["a//b.mjs"],
            vec!["*.mjs"],
            vec!["first?.mjs"],
            vec!["[first].mjs"],
            vec!["first\\file.mjs"],
            vec!["first.mjs"; 65],
        ] {
            assert!(std::panic::catch_unwind(|| selected_files(root.path(), &files)).is_err());
        }
    }

    #[test]
    fn file_rows_are_closed_unique_nonempty_and_reconciled() {
        let row = FileCompletion {
            file: "/exact.mjs".to_owned(),
            success: true,
            tests: 3,
            passed: 3,
            failed: 0,
            cancelled: 0,
            skipped: 0,
            todo: 0,
            top_level: 3,
            suites: 0,
        };
        let raw = serde_json::to_string(&row).unwrap();
        let encoded = format!("{FILE_PREFIX}{raw}\n");
        let files = [PathBuf::from("/exact.mjs")];
        file_completions(&encoded, &files, 3);
        for changed in [
            String::new(),
            encoded.repeat(2),
            encoded.replace("/exact.mjs", "/other.mjs"),
            encoded.replace("\"success\":true", "\"success\":false"),
            encoded.replace("\"tests\":3", "\"tests\":0"),
            encoded.replace("\"tests\":3", "\"tests\":\"3\""),
            encoded.replace("\"tests\":3", "\"tests\":3,\"tests\":3"),
            encoded.replace("\"passed\":3", "\"passed\":2"),
            encoded.replace("\"failed\":0", "\"failed\":1"),
            encoded.replace("\"cancelled\":0", "\"cancelled\":1"),
            encoded.replace("\"skipped\":0", "\"skipped\":1"),
            encoded.replace("\"todo\":0", "\"todo\":1"),
            encoded.replace("\"topLevel\":3", "\"topLevel\":0"),
            encoded.replace("\"topLevel\":3", "\"topLevel\":4"),
            encoded.replace("\"suites\":0", "\"suites\":-1"),
            encoded.replace("\"suites\":0", "\"suites\":9007199254740992"),
            encoded.replace("\"suites\":0", "\"suites\":0,\"extra\":true"),
        ] {
            assert!(std::panic::catch_unwind(|| file_completions(&changed, &files, 3)).is_err());
        }
        assert!(std::panic::catch_unwind(|| file_completions(&encoded, &files, 4)).is_err());
    }

    #[test]
    fn invented_stdout_completion_does_not_become_a_registered_test() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("test.mjs"),
            "console.log('# prismpm-owning-file '+JSON.stringify({file:import.meta.filename,tests:1,passed:1}));").unwrap();
        assert!(
            std::panic::catch_unwind(|| verify(root.path(), "test", &["test.mjs"], 1, "5000"))
                .is_err()
        );
    }
}
