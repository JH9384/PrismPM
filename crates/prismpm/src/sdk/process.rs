//! Bounded child processes: executable selection against pinned digests, a
//! cleared environment, a timeout wrapper and an output limit.
//!
//! Replay and the SDK inventory check run processes too, so the helpers live
//! in `verify` and the export chain in `verification` (images) calls them
//! (docs/proposals/440-nine-modules.md, "process helpers from verification").

use crate::error::PrismError;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

pub(crate) const CHILD_OUTPUT_LIMIT: usize = 16_777_216;

pub(crate) const CHILD_TIMEOUT_SECONDS: &str = "300";

const ELAN_PROXY_SHA256: &str = "840179e70803ef373c2ec53342d6a45ea7d022533e4145489fc1278b4f716385";

const RUSTUP_PROXY_SHA256: &str =
    "20a06e644b0d9bd2fbdbfd52d42540bdde820ea7df86e92e533c073da0cdd43c";

const TIMEOUT_SHA256: &str = "5ef0eaaaa4220593add7716aad74da927ca3bb10605e964330de64fecc3ef15e";

// Node 22.23.2 x64 binary from the Dockerfile's checksum-verified tarball.
const NODE_SHA256: &str = "3517c2df0b2f8cd7f422b4b8450ef81c6889f08eb03e281d6de9079b15e6a327";

/// One bounded child process run and its normalized outcome.
///
/// `X` is the caller's own extension record. The `images` exporter attaches
/// its custody record here; verification callers attach none, so this module
/// names no type from the modules above it.
#[derive(Debug, Serialize)]
pub(crate) struct ProcessRecord<X = NoExtension> {
    pub(crate) tool: String,
    pub(crate) argv: Vec<String>,
    pub(crate) executable_sha256: String,
    pub(crate) exit_code: i32,
    pub(crate) stdout: String,
    pub(crate) stderr: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub(crate) exporter: Option<X>,
}

/// The extension of a process record that carries none.
#[derive(Debug, Serialize)]
pub(crate) enum NoExtension {}

pub(crate) fn executable(name: &str) -> Result<PathBuf, PrismError> {
    // A released SDK has a generated, signed inventory of the exact final
    // runtime filesystem for its architecture.  It is the authority for
    // executables in that environment; the constants below remain the
    // independent pins for the source-bootstrap devcontainer and native CLI.
    if super::inventory_path().is_some() {
        return super::executable(name);
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
    if super::inventory_path().is_some() {
        return super::executables(names);
    }
    let mut paths = std::array::from_fn(|_| PathBuf::new());
    for (name, path) in names.into_iter().zip(&mut paths) {
        *path = executable(name)?;
    }
    Ok(paths)
}

pub(crate) fn normalized(value: &str, replacements: &[(&Path, &str)]) -> String {
    let mut out = value.to_owned();
    for (path, token) in replacements {
        out = out.replace(&path.to_string_lossy().replace('\\', "/"), token);
        out = out.replace(path.to_string_lossy().as_ref(), token);
    }
    out
}

pub(crate) fn stable_success_output(tool: &str, value: String) -> String {
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

pub(crate) fn pipe<R: Read>(mut reader: R, limit: usize) -> std::io::Result<Vec<u8>> {
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
pub(crate) fn failure_excerpt(output: &str) -> String {
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

pub(crate) fn run_process<X>(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    extra_env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
) -> Result<ProcessRecord<X>, PrismError> {
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
pub(crate) fn run_process_limited<X>(
    tool: &str,
    program: &Path,
    args: &[String],
    cwd: &Path,
    extra_env: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
    failure_code: &'static str,
    timeout_seconds: &str,
    output_limit: usize,
) -> Result<ProcessRecord<X>, PrismError> {
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

/// Names the stage a build or verification is in, on stderr as
/// `prismpm: stage <name>`, when `PRISMPM_PROGRESS` is set (issue #585).
/// A caller that streams stderr, such as the guided journey, can then say
/// which stage is running. Without the variable it prints nothing, so no
/// output another tool reads changes.
pub(crate) fn progress(stage: &str) {
    if std::env::var_os("PRISMPM_PROGRESS").is_some() {
        use std::io::Write as _;
        let mut stderr = std::io::stderr().lock();
        let _ = writeln!(stderr, "prismpm: stage {stage}");
        let _ = stderr.flush();
    }
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn run_process_limited_allowed<X>(
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
) -> Result<ProcessRecord<X>, PrismError> {
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
    progress(tool);
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
