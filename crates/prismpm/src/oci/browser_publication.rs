//! HTTPS observation of a captured OCI browser closure; never authorization.

use super::*;
use std::io::Read;
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const MAXIMUM_FILE: usize = 64 * 1024 * 1024;
const DEADLINE: Duration = Duration::from_secs(35);

fn failure(message: impl Into<String>) -> PrismError {
    PrismError::new("PP7201", message)
}

fn target(url: &str) -> Result<(), PrismError> {
    let valid = || {
        if url.len() > 2048 {
            return None;
        }
        let tail = url.strip_prefix("https://")?;
        let (host, path) = tail.split_once('/')?;
        if host.len() > 253 {
            return None;
        }
        let labels = host.split('.').collect::<Vec<_>>();
        if labels.len() < 2 {
            return None;
        }
        // A closed canonical grammar avoids URL parser normalization, ports,
        // credentials, IDNA, IP spellings and percent-encoded path aliases.
        if !labels.iter().all(|label| {
            !label.is_empty()
                && label.len() <= 63
                && label.as_bytes()[0].is_ascii_alphanumeric()
                && label.as_bytes()[label.len() - 1].is_ascii_alphanumeric()
                && label
                    .bytes()
                    .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        }) || !labels.last()?.bytes().all(|byte| byte.is_ascii_lowercase())
        {
            return None;
        }
        if !path.is_empty() {
            let segments = path.strip_suffix('/')?;
            if segments.is_empty()
                || !segments.split('/').all(|segment| {
                    !segment.is_empty()
                        && segment
                            .bytes()
                            .all(|byte| byte.is_ascii_alphanumeric() || b"_-".contains(&byte))
                })
            {
                return None;
            }
        }
        Some(())
    };
    valid().ok_or_else(|| {
        PrismError::new(
            "PP8001",
            "browser target must be a canonical HTTPS DNS origin and slash-terminated safe subpath",
        )
    })
}

pub(super) fn validate_receipt(value: &Value) -> Result<(), PrismError> {
    target(value["url"].as_str().expect("schema-validated target"))?;
    let names = value["files"]
        .as_array()
        .expect("schema-validated files")
        .iter()
        .map(|row| row["path"].as_str().expect("schema-validated file path"))
        .collect::<BTreeSet<_>>();
    let stems = names
        .iter()
        .filter_map(|name| name.strip_suffix("_bg.wasm"))
        .collect::<Vec<_>>();
    if stems.len() != 1
        || stems[0].is_empty()
        || !stems[0]
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
    {
        return Err(PrismError::new(
            "PP1101",
            "browser publication receipt has no unique portable Wasm stem",
        ));
    }
    let shim = format!("{}.js", stems[0]);
    let wasm = format!("{}_bg.wasm", stems[0]);
    if names
        != BTreeSet::from([
            "app.css",
            "app.js",
            "index.html",
            "provenance.json",
            shim.as_str(),
            wasm.as_str(),
        ])
    {
        return Err(PrismError::new(
            "PP1101",
            "browser publication receipt differs from its exact six-file profile",
        ));
    }
    Ok(())
}

struct Transport {
    deadline: Duration,
    #[cfg(test)]
    fixture_ca: Option<PathBuf>,
    #[cfg(test)]
    fixture_route: Option<String>,
}

impl Transport {
    fn production() -> Self {
        Self {
            deadline: DEADLINE,
            #[cfg(test)]
            fixture_ca: None,
            #[cfg(test)]
            fixture_route: None,
        }
    }

    fn command(&self, url: &str, size: usize) -> Command {
        let mut command = Command::new("/usr/bin/curl");
        command.env_clear().args([
            "--disable",
            "--silent",
            "--globoff",
            "--path-as-is",
            "--proto",
            "=https",
            "--proto-redir",
            "=https",
            "--tlsv1.2",
            "--max-redirs",
            "0",
            "--max-time",
            "30",
            "--connect-timeout",
            "10",
            "--proxy",
            "",
            "--noproxy",
            "*",
            "--http1.1",
            "--header",
            "Accept-Encoding: identity",
            "--header",
            "Cache-Control: no-cache",
            "--user-agent",
            "PrismPM-browser-publication/0.4.0",
            "--max-filesize",
            &size.max(1).to_string(),
            "--output",
            "-",
            "--write-out",
            "\n%{http_code}",
        ]);
        #[cfg(test)]
        if let Some(ca) = &self.fixture_ca {
            command.arg("--cacert").arg(ca);
        }
        #[cfg(test)]
        if let Some(route) = &self.fixture_route {
            command.arg("--connect-to").arg(route);
        }
        command.arg("--url").arg(url);
        command
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        command
    }

    fn fetch(&self, url: &str, expected: &[u8]) -> Result<(), PrismError> {
        if expected.len() > MAXIMUM_FILE {
            return Err(failure("browser artifact exceeds 64 MiB publication limit"));
        }
        let bytes = collect(
            self.command(url, expected.len()),
            expected.len() + 5,
            self.deadline,
        )?;
        // No redirect is followed, including same-origin redirects. Requiring
        // exact status framing also rejects missing/truncated or oversized bodies.
        if bytes.len() != expected.len() + 4
            || !bytes.ends_with(b"\n200")
            || &bytes[..bytes.len().saturating_sub(4)] != expected
        {
            return Err(failure(format!(
                "browser HTTP status or artifact bytes differ at {url}"
            )));
        }
        Ok(())
    }
}

fn collect(mut command: Command, maximum: usize, timeout: Duration) -> Result<Vec<u8>, PrismError> {
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        command.process_group(0);
    }
    let deadline = Instant::now() + timeout;
    let mut child = command
        .spawn()
        .map_err(|error| failure(format!("start browser HTTPS transport: {error}")))?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| failure("browser transport stdout is absent"))?;
    std::thread::scope(|scope| {
        let (sender, receiver) = std::sync::mpsc::sync_channel(1);
        scope.spawn(move || {
            let mut bytes = Vec::new();
            let result = stdout
                .take(maximum as u64)
                .read_to_end(&mut bytes)
                .map(|_| bytes);
            let _ = sender.send(result);
        });
        let result = (|| {
            let remaining = deadline.saturating_duration_since(Instant::now());
            let bytes = receiver
                .recv_timeout(remaining)
                .map_err(|_| failure("browser HTTPS transport exceeded its wall deadline"))?
                .map_err(|error| failure(format!("read browser HTTPS response: {error}")))?;
            if bytes.len() == maximum {
                return Err(failure(
                    "browser HTTPS response exceeds its exact byte budget",
                ));
            }
            loop {
                if let Some(status) = child
                    .try_wait()
                    .map_err(|error| failure(format!("wait browser HTTPS transport: {error}")))?
                {
                    return if status.success() {
                        Ok(bytes)
                    } else {
                        Err(failure(
                            "browser HTTPS transport or TLS verification failed",
                        ))
                    };
                }
                if Instant::now() >= deadline {
                    return Err(failure(
                        "browser HTTPS transport exceeded its wall deadline",
                    ));
                }
                std::thread::sleep(Duration::from_millis(5));
            }
        })();
        // Kill before joining a blocked reader; neither a slow response nor a
        // child that closes stdout and remains alive can outlive this boundary.
        if result.is_err() {
            #[cfg(unix)]
            if let Ok(pid) = i32::try_from(child.id()) {
                if let Some(group) = rustix::process::Pid::from_raw(pid) {
                    let _ =
                        rustix::process::kill_process_group(group, rustix::process::Signal::KILL);
                }
            }
            let _ = child.kill();
        }
        let _ = child.wait();
        result
    })
}

pub(super) fn verify(root: &Path, reference: &str, url: &str) -> Result<Value, PrismError> {
    verify_with(root, reference, url, &Transport::production())
}

fn verify_with(
    root: &Path,
    reference: &str,
    url: &str,
    transport: &Transport,
) -> Result<Value, PrismError> {
    target(url)?;
    let capture = browser_export::capture(root, reference)?;
    let files = browser_export::browser_files(&capture.build_files)?;
    verify_capture(&capture, reference, url, &files, transport)
}

fn verify_capture(
    capture: &VerifiedReleaseCapture,
    reference: &str,
    url: &str,
    files: &BTreeMap<String, &[u8]>,
    transport: &Transport,
) -> Result<Value, PrismError> {
    if files.values().any(|bytes| bytes.len() > MAXIMUM_FILE) {
        return Err(failure("browser artifact exceeds 64 MiB publication limit"));
    }
    let rows = files
        .iter()
        .map(|(path, bytes)| json!({"path":path,"digest":sha(bytes),"size":bytes.len()}))
        .collect::<Vec<_>>();
    let result = json!({
        "schema":"prismpm/browser-publication-integrity/1",
        "scope":"browser-byte-integrity-only", "reference":reference,
        "release_digest":capture.state.root.digest,
        "model_digest":sha(&capture.build_files["model.prism.json"]),
        "build_digest":sha(&capture.build_manifest),
        "tree_digest":sha(&encode_value(&json!(rows))?),
        "url":url, "files":rows, "requests":7, "redirects":0
    });
    CanonicalDocument::from_value("prismpm/browser-publication-integrity/1", result.clone())?;
    transport.fetch(
        url,
        files
            .get("index.html")
            .ok_or_else(|| failure("browser index absent"))?,
    )?;
    for (name, bytes) in files {
        transport.fetch(&format!("{url}{name}"), bytes)?;
    }
    Ok(result)
}

#[cfg(test)]
mod tests;
