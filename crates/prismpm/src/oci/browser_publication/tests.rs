use super::*;
use std::io::BufRead;

const BASE: &str = "https://portal.test/foundry-web/";

struct Server {
    directory: tempfile::TempDir,
    child: std::process::Child,
    route: String,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

impl Server {
    fn new(routes: Value) -> Self {
        let directory = tempfile::tempdir().unwrap();
        let mut certificate = Command::new("/usr/bin/openssl");
        certificate
            .args([
                "req",
                "-x509",
                "-newkey",
                "rsa:2048",
                "-nodes",
                "-days",
                "1",
                "-subj",
                "/CN=portal.test",
                "-addext",
                "subjectAltName=DNS:portal.test",
                "-keyout",
                "key.pem",
                "-out",
                "cert.pem",
            ])
            .current_dir(directory.path())
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        assert!(collect(certificate, 1, Duration::from_secs(10))
            .unwrap()
            .is_empty());
        std::fs::write(
            directory.path().join("routes.json"),
            serde_json::to_vec(&routes).unwrap(),
        )
        .unwrap();
        let mut child = Command::new("node").args(["--input-type=module", "-e", r#"
import https from 'node:https';
import fs from 'node:fs';
const routes = JSON.parse(fs.readFileSync('routes.json'));
const server = https.createServer({key: fs.readFileSync('key.pem'), cert: fs.readFileSync('cert.pem')}, (req, res) => {
  fs.appendFileSync('requests.log', req.url + '\n');
  const route = routes[req.url] ?? {status: 404, body: ''};
  if (route.stall) return;
  if (route.disconnect) { req.socket.destroy(); return; }
  const headers = route.location ? {location: route.location} : {};
  res.writeHead(route.status ?? 200, headers);
  if (route.chunks) {
    for (let i = 0; i < route.chunks; i++) res.write('x'.repeat(1024));
    res.end();
  } else res.end(Buffer.from(route.body ?? '', 'base64'));
});
server.listen(0, '127.0.0.1', () => process.stdout.write(String(server.address().port) + '\n'));
"#]).current_dir(directory.path()).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::inherit()).spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let line = std::thread::scope(|scope| {
            let (sender, receiver) = std::sync::mpsc::sync_channel(1);
            scope.spawn(move || {
                let mut line = String::new();
                let result = std::io::BufReader::new(stdout.take(16))
                    .read_line(&mut line)
                    .map(|_| line);
                let _ = sender.send(result);
            });
            match receiver.recv_timeout(Duration::from_secs(10)) {
                Ok(Ok(line)) => line,
                other => {
                    let _ = child.kill();
                    let _ = child.wait();
                    panic!("bounded loopback TLS fixture startup failed: {other:?}");
                }
            }
        });
        let port: u16 = line.trim().parse().expect("loopback TLS fixture port");
        Self {
            directory,
            child,
            route: format!("portal.test:443:127.0.0.1:{port}"),
        }
    }

    fn transport(&self) -> Transport {
        Transport {
            deadline: Duration::from_secs(5),
            fixture_ca: Some(self.directory.path().join("cert.pem")),
            fixture_route: Some(self.route.clone()),
        }
    }

    fn requests(&self) -> Vec<String> {
        std::fs::read_to_string(self.directory.path().join("requests.log"))
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect()
    }
}

fn body(bytes: &[u8]) -> Value {
    use base64::Engine;
    json!({"body":base64::engine::general_purpose::STANDARD.encode(bytes)})
}

fn server_for(route: Value) -> Server {
    Server::new(json!({"/foundry-web/":route}))
}

#[test]
fn target_grammar_rejects_aliases_credentials_and_cross_origin_spelling() {
    for url in [
        BASE,
        "https://uor.foundation/",
        "https://uor-foundation.github.io/foundry-web/",
    ] {
        target(url).unwrap();
    }
    for url in [
        "http://portal.test/foundry-web/",
        "https://portal.test",
        "https://portal.test/foundry-web",
        "https://portal.test:443/foundry-web/",
        "https://user@portal.test/",
        "https://portal.test./",
        "https://Portal.test/",
        "https://127.0.0.1/",
        "https://[::1]/",
        "https://localhost/",
        "https://portal.test//",
        "https://portal.test/a//b/",
        "https://portal.test/./",
        "https://portal.test/../",
        "https://portal.test/%2e%2e/",
        "https://portal.test/a%2fb/",
        "https://portal.test/a\\b/",
        "https://portal.test/?x=1",
        "https://portal.test/#a",
        "https://portal.test/\n",
        "https://portal.test/é/",
        "https://-portal.test/",
        "https://portal-.test/",
        "https://portal..test/",
        "https://portal.123/",
    ] {
        assert_eq!(target(url).unwrap_err().code, "PP8001", "{url}");
    }
    assert!(target(&format!("https://{}.test/", "a".repeat(64))).is_err());
    assert!(target(&format!("https://{}test/", "a.".repeat(100_000))).is_err());
    assert!(target(&format!("https://portal.test/{}/", "a".repeat(2048))).is_err());
}

#[test]
fn tls_transport_observes_exact_binary_and_empty_responses() {
    for bytes in [b"hello\n200\0\xff".as_slice(), b""] {
        let server = server_for(body(bytes));
        server.transport().fetch(BASE, bytes).unwrap();
        assert_eq!(server.requests(), ["/foundry-web/"]);
    }
}

#[test]
fn every_redirect_is_rejected_without_contacting_its_destination() {
    for location in [
        "https://outside.test/foundry-web/",
        "https://portal.test/other/",
        "https://portal.test/foundry-web/index.html",
        "../other/",
        "//outside.test/",
        "http://portal.test/foundry-web/",
        "/foundry-web/%2e%2e/other/",
    ] {
        for status in [301, 302, 303, 307, 308] {
            let server = server_for(json!({"status":status,"location":location}));
            assert_eq!(
                server.transport().fetch(BASE, b"").unwrap_err().code,
                "PP7201"
            );
            assert_eq!(
                server.requests(),
                ["/foundry-web/"],
                "redirect escaped: {location}"
            );
        }
    }
}

#[test]
fn changed_missing_oversized_chunked_and_non_success_responses_fail() {
    for route in [
        body(b"expecteD"),
        body(b"changed"),
        body(b""),
        json!({"status":404}),
        json!({"status":204}),
        json!({"status":500}),
        json!({"chunks":1024}),
        json!({"disconnect":true}),
    ] {
        let server = server_for(route);
        assert_eq!(
            server
                .transport()
                .fetch(BASE, b"expected")
                .unwrap_err()
                .code,
            "PP7201"
        );
    }
}

#[test]
fn stalled_response_is_killed_at_the_independent_deadline() {
    let server = server_for(json!({"stall":true}));
    let mut transport = server.transport();
    transport.deadline = Duration::from_millis(100);
    let start = Instant::now();
    assert_eq!(
        transport.fetch(BASE, b"expected").unwrap_err().code,
        "PP7201"
    );
    assert!(start.elapsed() < Duration::from_secs(2));
    assert_eq!(server.requests(), ["/foundry-web/"]);
}

#[test]
fn descendant_holding_stdout_cannot_extend_the_deadline() {
    let mut command = Command::new("/bin/sh");
    command
        .args(["-c", "sleep 30 & exit 0"])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    let start = Instant::now();
    let error = collect(command, 8, Duration::from_millis(100)).unwrap_err();
    assert_eq!(error.code, "PP7201");
    assert!(error.message.contains("wall deadline"));
    assert!(start.elapsed() < Duration::from_secs(2));
}

#[test]
fn untrusted_tls_and_ambient_transport_overrides_are_rejected() {
    const CHILD: &str = "PRISMPM_PUBLICATION_AMBIENT_PROBE";
    if let Ok(route) = std::env::var(CHILD) {
        let transport = Transport {
            fixture_route: Some(route.clone()),
            ..Transport::production()
        };
        assert_eq!(
            transport.fetch(BASE, b"expected").unwrap_err().code,
            "PP7201"
        );
        let accepted = Transport {
            fixture_ca: Some(std::env::var_os("CURL_CA_BUNDLE").unwrap().into()),
            fixture_route: Some(route),
            ..Transport::production()
        };
        accepted.fetch(BASE, b"expected").unwrap();
        return;
    }
    let server = server_for(body(b"expected"));
    std::fs::write(
        server.directory.path().join(".curlrc"),
        "insecure\nlocation\n",
    )
    .unwrap();
    let output = Command::new(std::env::current_exe().unwrap())
        .args(["--exact", "oci::browser_publication::tests::untrusted_tls_and_ambient_transport_overrides_are_rejected", "--nocapture"])
        .env(CHILD, &server.route)
        .env("CURL_HOME", server.directory.path())
        .env("CURL_CA_BUNDLE", server.directory.path().join("cert.pem"))
        .env("SSL_CERT_FILE", server.directory.path().join("cert.pem"))
        .env("SSL_CERT_DIR", server.directory.path())
        .env("HTTPS_PROXY", "http://127.0.0.1:1")
        .env("https_proxy", "http://127.0.0.1:1")
        .env("ALL_PROXY", "http://127.0.0.1:1")
        .env("OPENSSL_CONF", "/absent-prismpm-fixture-openssl.cnf")
        .env("LD_LIBRARY_PATH", "/absent-prismpm-fixture-libraries")
        .env("LD_PRELOAD", "/absent-prismpm-fixture-preload.so")
        .output().unwrap();
    assert!(
        output.status.success(),
        "{}\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed; 0 ignored"));
    assert_eq!(server.requests(), ["/foundry-web/"]);
}

#[test]
fn production_command_has_no_redirect_authentication_or_trust_bypass() {
    let transport = Transport::production();
    let command = transport.command(BASE, 123);
    assert_eq!(command.get_program(), "/usr/bin/curl");
    let args = command
        .get_args()
        .map(|arg| arg.to_str().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(args[0], "--disable");
    for forbidden in [
        "--location",
        "-L",
        "--insecure",
        "-k",
        "--cacert",
        "--capath",
        "--connect-to",
        "--user",
        "--cookie",
        "--netrc",
    ] {
        assert!(!args.contains(&forbidden), "{forbidden}");
    }
    assert!(args.windows(2).any(|pair| pair == ["--max-redirs", "0"]));
    assert!(args.windows(2).any(|pair| pair == ["--proto", "=https"]));
    assert_eq!(command.get_envs().count(), 0);
    assert_eq!(transport.deadline, Duration::from_secs(35));
}

#[test]
fn receipt_contract_rejects_inconsistent_identities_profiles_and_targets() {
    let digest = format!("sha256:{}", "a".repeat(64));
    let files = [
        "app.css",
        "app.js",
        "core.js",
        "core_bg.wasm",
        "index.html",
        "provenance.json",
    ]
    .map(|path| json!({"path":path,"digest":digest,"size":1}));
    let value = json!({
        "schema":"prismpm/browser-publication-integrity/1", "scope":"browser-byte-integrity-only",
        "reference":format!("example.test/application@{digest}"), "release_digest":digest,
        "model_digest":digest, "build_digest":digest,
        "tree_digest":sha(&encode_value(&json!(files)).unwrap()), "url":BASE,
        "requests":7, "redirects":0, "files":files,
    });
    let schema = "prismpm/browser-publication-integrity/1";
    CanonicalDocument::from_value(schema, value.clone()).unwrap();
    for (field, replacement) in [
        (
            "release_digest",
            json!(format!("sha256:{}", "b".repeat(64))),
        ),
        ("tree_digest", json!(format!("sha256:{}", "b".repeat(64)))),
        ("url", json!("https://portal..test/foundry-web/")),
        ("url", json!("https://portal.test//")),
        ("url", json!("https://portal.test/foundry-web")),
        ("accepted", json!(true)),
        ("scope", json!("deployment-accepted")),
        ("requests", json!(6)),
        ("redirects", json!(1)),
    ] {
        let mut changed = value.clone();
        changed[field] = replacement;
        assert!(
            CanonicalDocument::from_value(schema, changed).is_err(),
            "{field}"
        );
    }
    for mutation in 0..6 {
        let mut changed = value.clone();
        match mutation {
            0 => {
                changed["files"].as_array_mut().unwrap().swap(0, 1);
            }
            1 => {
                changed["files"][0]["path"] = json!("aaa.css");
            }
            2 => {
                changed["files"][2]["path"] = json!("different.js");
            }
            3 => {
                changed["files"][0]["digest"] = json!(format!("sha256:{}", "b".repeat(64)));
            }
            4 => {
                changed["files"][1] = changed["files"][0].clone();
            }
            5 => {
                changed["files"][0]["size"] = json!(67108865_u64);
            }
            _ => unreachable!(),
        }
        if mutation != 3 {
            changed["tree_digest"] = json!(sha(&encode_value(&changed["files"]).unwrap()));
        }
        assert!(
            CanonicalDocument::from_value(schema, changed).is_err(),
            "mutation {mutation}"
        );
    }
}

#[test]
fn invalid_local_release_is_refused_before_any_https_request() {
    let server = server_for(body(b"unused"));
    let root = tempfile::tempdir().unwrap();
    let reference = format!("example.test/product@sha256:{}", "a".repeat(64));
    assert!(verify_with(root.path(), &reference, BASE, &server.transport()).is_err());
    assert!(server.requests().is_empty());
    assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 0);
}

#[test]
fn source_free_release_binds_complete_observation_and_rejects_graph_mutation() {
    let _compiler = crate::test_compiler::acquire();
    let repository = Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap();
    let source = tempfile::tempdir().unwrap();
    let example = repository.join("examples/Calculator");
    for entry in walkdir::WalkDir::new(&example).min_depth(1) {
        let entry = entry.unwrap();
        let relative = entry.path().strip_prefix(&example).unwrap();
        if !relative.starts_with("src")
            && ![
                "lexlean.toml",
                "lexlean.lock",
                "prismpm.toml",
                "lakefile.toml",
                "lake-manifest.json",
                "lean-toolchain",
            ]
            .iter()
            .any(|name| relative == Path::new(name))
        {
            continue;
        }
        let destination = source.path().join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            assert!(entry.file_type().is_file());
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let controller = crate::Controller::load(source.path()).unwrap();
    let build = controller
        .build(crate::controller::BuildRequest { config_path: None })
        .unwrap();
    let verification = controller
        .verify(crate::controller::VerifyRequest { config_path: None })
        .unwrap();
    let receiver = tempfile::tempdir().unwrap();
    let (store, descriptor) = browser_export_fixture(
        receiver.path(),
        "example.test/application:fixture",
        source.path(),
        &build,
        &verification,
    );
    drop(store);
    drop(controller);
    source.close().unwrap();
    let reference = format!("example.test/application@{}", descriptor.digest);
    let capture = browser_export::capture(receiver.path(), &reference).unwrap();
    let files = browser_export::browser_files(&capture.build_files).unwrap();
    let mut routes = serde_json::Map::new();
    routes.insert("/foundry-web/".to_owned(), body(files["index.html"]));
    for (path, bytes) in &files {
        routes.insert(format!("/foundry-web/{path}"), body(bytes));
    }
    let server = Server::new(Value::Object(routes.clone()));
    let result = verify_with(receiver.path(), &reference, BASE, &server.transport()).unwrap();
    assert_eq!(result["release_digest"], descriptor.digest);
    assert_eq!(
        result["model_digest"],
        sha(&capture.build_files["model.prism.json"])
    );
    assert_eq!(result["build_digest"], sha(&capture.build_manifest));
    assert_eq!(result["url"], BASE);
    assert_eq!(result["scope"], "browser-byte-integrity-only");
    assert_eq!(server.requests().len(), 7);
    let exported = browser_export::export(receiver.path(), &reference, Path::new("site")).unwrap();
    assert_eq!(result["files"], exported["files"]);
    assert_eq!(result["tree_digest"], exported["tree_digest"]);
    for mutation in ["missing", "extra", "changed", "duplicate"] {
        let mut changed = result.clone();
        let rows = changed["files"].as_array_mut().unwrap();
        match mutation {
            "missing" => {
                rows.pop();
            }
            "extra" => {
                rows.push(rows[0].clone());
            }
            "changed" => {
                rows[0]["extra"] = json!(true);
            }
            "duplicate" => {
                rows[1] = rows[0].clone();
            }
            _ => unreachable!(),
        }
        assert!(
            CanonicalDocument::from_value("prismpm/browser-publication-integrity/1", changed)
                .is_err()
        );
    }
    // The root document and every build/browser edge are reverified, not an
    // unsigned receipt or previously exported directory supplied by the caller.
    let blob = receiver
        .path()
        .join(".prism/oci/blobs/sha256")
        .join(descriptor.digest.strip_prefix("sha256:").unwrap());
    let original = std::fs::read(&blob).unwrap();
    std::fs::write(&blob, b"{}").unwrap();
    let before = server.requests();
    assert_eq!(
        verify_with(receiver.path(), &reference, BASE, &server.transport())
            .unwrap_err()
            .code,
        "PP6101"
    );
    assert_eq!(server.requests(), before);
    std::fs::write(&blob, original).unwrap();
    routes.insert("/foundry-web/".to_owned(), body(b"wrong base index"));
    let wrong_index = Server::new(Value::Object(routes));
    assert_eq!(
        verify_with(receiver.path(), &reference, BASE, &wrong_index.transport())
            .unwrap_err()
            .code,
        "PP7201"
    );
    assert_eq!(wrong_index.requests(), ["/foundry-web/"]);
}
