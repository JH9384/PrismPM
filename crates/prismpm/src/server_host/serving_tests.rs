//! HO-36 to HO-38: the generated listener and its RFC 9112 framing.
//!
//! The execution tests build the generated host adapter of a served application
//! around a small stand-in core, start the real program with `serve` on a
//! loopback port and speak to it over TCP. The stand-in core echoes the request
//! frame it is given, so a test sees exactly what the adapter handed to the core;
//! the binding counts the requests it is asked to count and returns a fixed
//! state key, so a test sees which requests reached the host and which did not.
//! The generated suite of the package is run as well, and each test here that
//! shares a name with a generated test requires it to have passed.

use super::tests::{build_with, cargo, code, field, model_value, run, stderr, Built};
use super::{acceptance, generate, help, program_name};
use crate::holo::server_application::{validate, ServerApplication};
use serde_json::{json, Value};
use std::io::Write;
use std::sync::OnceLock;

/// The stand-in core of a served application that requests no effect: the plain
/// frame function. It answers a few targets itself and echoes everything else:
/// the method, the target, the host's sections, every field in the order it
/// arrived, and the body, as `text/plain`.
const CORE: &str = r#"
struct Reader<'a> { bytes: &'a [u8], at: usize }

impl<'a> Reader<'a> {
    fn word(&mut self) -> usize {
        let word = u32::from_be_bytes(self.bytes[self.at..self.at + 4].try_into().unwrap());
        self.at += 4;
        word as usize
    }
    fn quad(&mut self) -> u64 {
        let quad = u64::from_be_bytes(self.bytes[self.at..self.at + 8].try_into().unwrap());
        self.at += 8;
        quad
    }
    fn chunk(&mut self) -> &'a [u8] {
        let length = self.word();
        let chunk = &self.bytes[self.at..self.at + length];
        self.at += length;
        chunk
    }
}

fn response(status: u32, fields: &[(&str, &str)], notifications: u32, body: &[u8]) -> Vec<u8> {
    let mut out = status.to_be_bytes().to_vec();
    out.extend_from_slice(&(fields.len() as u32).to_be_bytes());
    for (name, value) in fields {
        for part in [name, value] {
            out.extend_from_slice(&(part.len() as u32).to_be_bytes());
            out.extend_from_slice(part.as_bytes());
        }
    }
    out.extend_from_slice(&notifications.to_be_bytes());
    out.extend_from_slice(&(body.len() as u32).to_be_bytes());
    out.extend_from_slice(body);
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

pub fn dispatch(frame: Vec<u8>) -> Vec<u8> {
    let mut reader = Reader { bytes: &frame, at: 0 };
    let method = reader.chunk();
    let target = reader.chunk();
    let count = reader.word();
    let mut fields = Vec::new();
    for _ in 0..count {
        let name = reader.chunk();
        let value = reader.chunk();
        fields.push((name, value));
    }
    let body = reader.chunk();
    let calls = reader.quad();
    let key = reader.chunk();
    let hosts = reader.word();
    let mut allowed = Vec::new();
    for _ in 0..hosts {
        allowed.push(String::from_utf8_lossy(reader.chunk()).into_owned());
    }
    assert_eq!(reader.at, frame.len());
    match target {
        b"/events" => response(
            200,
            &[("Content-Type", "text/event-stream"), ("Cache-Control", "no-store"), ("X-Order", "second")],
            0,
            b"id: 1\r\nevent: message\ndata: {}\n\n",
        ),
        b"/malformed" => vec![0, 0, 0, 1],
        b"/notify" => response(200, &[], 1, b""),
        b"/framing" => response(200, &[("Content-Length", "1")], 0, b"x"),
        b"/crash" => Vec::new(),
        _ => {
            let mut text = format!(
                "method={}\ntarget={}\ncalls={calls}\nkey={}\nhosts={}\n",
                String::from_utf8_lossy(method),
                String::from_utf8_lossy(target),
                hex(key),
                allowed.join(","),
            );
            for (name, value) in fields {
                text.push_str(&format!(
                    "field={}:{}\n",
                    String::from_utf8_lossy(name),
                    String::from_utf8_lossy(value)
                ));
            }
            text.push_str(&format!("body={}\n", String::from_utf8_lossy(body)));
            response(200, &[("Content-Type", "text/plain; charset=utf-8")], 0, text.as_bytes())
        }
    }
}
"#;

/// The consumer's binding: the tool call counter counts the requests it is told
/// are counted, the secret reference of the state key is a fixed key, and the
/// per-request calls are recorded in a file of the serving process (HO-43).
const BINDING: &str = r#"
use echo_core_host_api::protocol::{secret_statekey, tool_calls, Host, HostError};

#[derive(Default)]
pub struct Native {
    pub calls: u64,
}

impl Host for Native {
    fn tool_calls(
        &mut self,
        request: tool_calls::Request,
    ) -> Result<tool_calls::Completed, HostError<tool_calls::Failure>> {
        if request.counted {
            self.calls += 1;
        }
        Ok(tool_calls::Completed { calls: self.calls })
    }

    fn secret_statekey(
        &mut self,
        _request: secret_statekey::Request,
    ) -> Result<secret_statekey::Completed, HostError<secret_statekey::Failure>> {
        Ok(secret_statekey::Completed { key: b"k3y".to_vec() })
    }

    fn request_begin(&mut self, id: u64, request: &[u8]) {
        record(&format!("begin {id} {}", String::from_utf8_lossy(request)));
    }

    fn request_end(&mut self, id: u64, request: &[u8], response: &[u8]) {
        let response = String::from_utf8_lossy(response);
        record(&format!(
            "end {id} {} -> {}",
            String::from_utf8_lossy(request),
            response.lines().next().unwrap_or_default()
        ));
    }
}

/// Append one line to this process's record of the per-request calls.
fn record(line: &str) {
    use std::io::Write;
    let path = std::env::temp_dir().join(format!("prism-hooks-{}.log", std::process::id()));
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        let _ = writeln!(file, "{line}");
    }
}
"#;

const KEY: &[u8] = b"k3y";
const HOSTS: [&str; 2] = ["127.0.0.1", "localhost"];

fn put(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_be_bytes());
    out.extend_from_slice(bytes);
}

/// The request frame the adapter hands the core.
fn request_frame(
    method: &str,
    target: &str,
    fields: &[(&str, &str)],
    body: &[u8],
    calls: u64,
) -> Vec<u8> {
    let mut out = Vec::new();
    put(&mut out, method.as_bytes());
    put(&mut out, target.as_bytes());
    out.extend_from_slice(&(fields.len() as u32).to_be_bytes());
    for (name, value) in fields {
        put(&mut out, name.as_bytes());
        put(&mut out, value.as_bytes());
    }
    put(&mut out, body);
    out.extend_from_slice(&calls.to_be_bytes());
    put(&mut out, KEY);
    out.extend_from_slice(&(HOSTS.len() as u32).to_be_bytes());
    for host in HOSTS {
        put(&mut out, host.as_bytes());
    }
    out
}

fn response_frame(status: u32, fields: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut out = status.to_be_bytes().to_vec();
    out.extend_from_slice(&(fields.len() as u32).to_be_bytes());
    for (name, value) in fields {
        put(&mut out, name.as_bytes());
        put(&mut out, value.as_bytes());
    }
    out.extend_from_slice(&0u32.to_be_bytes());
    put(&mut out, body);
    out
}

/// The text the stand-in core answers an echoed request with.
fn echo(method: &str, target: &str, fields: &[(&str, &str)], body: &str, calls: u64) -> String {
    let mut text = format!(
        "method={method}\ntarget={target}\ncalls={calls}\nkey=6b3379\nhosts={}\n",
        HOSTS.join(",")
    );
    for (name, value) in fields {
        text.push_str(&format!("field={name}:{value}\n"));
    }
    text.push_str(&format!("body={body}\n"));
    text
}

fn http(status: &str, fields: &[(&str, &str)], body: &[u8]) -> Vec<u8> {
    let mut out = format!("HTTP/1.1 {status}\r\n").into_bytes();
    for (name, value) in fields {
        out.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
    }
    out.extend_from_slice(
        format!(
            "Content-Length: {}\r\nConnection: close\r\n\r\n",
            body.len()
        )
        .as_bytes(),
    );
    out.extend_from_slice(body);
    out
}

const MEDIA: [(&str, &str); 2] = [
    ("Accept", "application/json, text/event-stream"),
    ("Content-Type", "application/json"),
];

/// A request that passes every check, counted when `counted`: the raw message
/// with `fields` between the Host and the media fields the model requires.
fn post(target: &str, extra: &[(&str, &str)], framing: &str, body: &[u8]) -> Vec<u8> {
    let mut out = format!("POST {target} HTTP/1.1\r\nHost: 127.0.0.1:8080\r\n").into_bytes();
    for (name, value) in MEDIA.iter().chain(extra) {
        out.extend_from_slice(format!("{name}: {value}\r\n").as_bytes());
    }
    out.extend_from_slice(framing.as_bytes());
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(body);
    out
}

/// An HTTP request, the request frame it becomes, the response frame of the core
/// and the HTTP response, in that order.
type Exchange = (Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>);

/// The four exchanges of the acceptance: a counted call with a body, an event
/// stream the core decides, a chunked body that is not counted, and repeated
/// fields that must not be merged.
fn exchanges() -> Vec<Exchange> {
    let first = [
        ("Host", "127.0.0.1:8080"),
        ("Accept", MEDIA[0].1),
        ("Content-Type", MEDIA[1].1),
        ("Origin", "http://localhost:3000"),
        ("Mcp-Method", "tools/call"),
        ("Content-Length", "7"),
    ];
    let head = [
        ("Origin", "http://localhost:3000"),
        ("Mcp-Method", "tools/call"),
    ];
    let second = [("Host", "localhost"), ("Accept", "text/event-stream")];
    let third = [
        ("Host", "127.0.0.1:8080"),
        ("Accept", MEDIA[0].1),
        ("Content-Type", MEDIA[1].1),
        ("Mcp-Method", "initialize"),
        ("Transfer-Encoding", "chunked"),
    ];
    let fourth = [
        ("Host", "127.0.0.1"),
        ("X-A", "1"),
        ("X-B", "2"),
        ("x-a", "3, 4"),
        ("X-Empty", ""),
    ];
    let plain = &[("Content-Type", "text/plain; charset=utf-8")];
    vec![
        (
            post("/mcp", &head, "Content-Length: 7\r\n", b"{\"a\":1}"),
            request_frame("POST", "/mcp", &first, b"{\"a\":1}", 1),
            response_frame(200, plain, echo("POST", "/mcp", &first, "{\"a\":1}", 1).as_bytes()),
            http(
                "200 OK",
                plain,
                echo("POST", "/mcp", &first, "{\"a\":1}", 1).as_bytes(),
            ),
        ),
        (
            b"GET /events HTTP/1.1\r\nHost: localhost\r\nAccept: text/event-stream\r\n\r\n".to_vec(),
            request_frame("GET", "/events", &second, b"", 0),
            response_frame(
                200,
                &[("Content-Type", "text/event-stream"), ("Cache-Control", "no-store"), ("X-Order", "second")],
                b"id: 1\r\nevent: message\ndata: {}\n\n",
            ),
            http(
                "200 OK",
                &[("Content-Type", "text/event-stream"), ("Cache-Control", "no-store"), ("X-Order", "second")],
                b"id: 1\r\nevent: message\ndata: {}\n\n",
            ),
        ),
        (
            post(
                "/mcp",
                &[("Mcp-Method", "initialize")],
                "Transfer-Encoding: chunked\r\n",
                b"2;note=x\r\nab\r\n3\r\ncde\r\n0\r\n\r\n",
            ),
            request_frame("POST", "/mcp", &third, b"abcde", 0),
            response_frame(200, plain, echo("POST", "/mcp", &third, "abcde", 0).as_bytes()),
            http(
                "200 OK",
                plain,
                echo("POST", "/mcp", &third, "abcde", 0).as_bytes(),
            ),
        ),
        (
            b"GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nX-A: 1\r\nX-B:   2  \r\nx-a: 3, 4\r\nX-Empty:\r\n\r\n".to_vec(),
            request_frame("GET", "/echo", &fourth, b"", 0),
            response_frame(200, plain, echo("GET", "/echo", &fourth, "", 0).as_bytes()),
            http(
                "200 OK",
                plain,
                echo("GET", "/echo", &fourth, "", 0).as_bytes(),
            ),
        ),
    ]
}

fn effects() -> Value {
    json!([
        {
            "name": "tool.calls",
            "request": [field("peer", "text"), field("counted", "flag")],
            "result": [field("calls", "u64")],
            "failures": [],
            "request_maximum": 32,
            "result_maximum": 16
        },
        {
            "name": "secret.statekey",
            "request": [],
            "result": [field("key", "bytes")],
            "failures": [],
            "request_maximum": 8,
            "result_maximum": 40
        }
    ])
}

/// The serving record of the fixture: every bound is small and distinct, so a
/// test sits on a bound and one step past it without a large message.
pub(crate) fn serving_value() -> Value {
    let all = exchanges();
    json!({
        "address": "127.0.0.1",
        "port": 0,
        "connection_maximum": 4,
        "read_timeout_millis": 1500,
        "root_stack_bytes": 1_048_576,
        "request_line_maximum": 64,
        "header_count_maximum": 12,
        "header_bytes_maximum": 512,
        "body_maximum": 128,
        "origins": [
            {"scheme": "http", "host": "localhost", "port": 0},
            {"scheme": "http", "host": "127.0.0.1", "port": 0},
            {"scheme": "https", "host": "app.example", "port": 8443}
        ],
        "accept": ["application/json", "text/event-stream"],
        "content_types": ["application/json"],
        "enforced_methods": ["POST"],
        "counted_field": "Mcp-Method",
        "counted_value": "tools/call",
        "frame": [
            {"name": "tool_calls", "kind": "u64", "effect": "tool.calls", "field": "calls", "values": []},
            {"name": "request_state_key", "kind": "bytes", "effect": "secret.statekey", "field": "key", "values": []},
            {"name": "allowed_hosts", "kind": "text-list", "effect": "", "field": "", "values": HOSTS}
        ],
        "vectors": all
            .iter()
            .enumerate()
            .map(|(index, (request, _, _, response))| json!({
                "vector": index,
                "request": request,
                "response": response
            }))
            .collect::<Vec<_>>()
    })
}

/// The declaration of a served application: no effect the core may request, two
/// effects that fill the request frame, and the four exchanges.
pub(crate) fn served_value() -> Value {
    let mut value = model_value();
    value["host"]["effect_budget"] = json!(0);
    value["host"]["effects"] = effects();
    value["host"]["transcripts"] = json!([]);
    value["request_maximum"] = json!(1024);
    value["response_maximum"] = json!(1024);
    value["acceptance_vectors"] = json!(exchanges()
        .iter()
        .map(|(_, request, response, _)| json!({"request": request, "response": response}))
        .collect::<Vec<_>>());
    value["serving"] = json!([serving_value()]);
    value
}

pub(crate) fn served_model() -> ServerApplication {
    serde_json::from_value(served_value()).expect("the served fixture deserializes")
}

fn changed(edit: impl FnOnce(&mut Value)) -> ServerApplication {
    let mut value = served_value();
    edit(&mut value["serving"][0]);
    serde_json::from_value(value).expect("the changed fixture deserializes")
}

fn refused(application: &ServerApplication) -> String {
    let error = validate(application).expect_err("the declaration is refused");
    assert_eq!(error.code, "PP2024", "{}", error.message);
    error.message
}

pub(super) fn built() -> &'static Built {
    static BUILT: OnceLock<Built> = OnceLock::new();
    BUILT.get_or_init(|| build_with(&served_model(), CORE, BINDING))
}

/// What `cargo test` of the generated workspace printed, run once.
fn generated() -> &'static str {
    static OUTPUT: OnceLock<String> = OnceLock::new();
    OUTPUT.get_or_init(|| {
        let built = built();
        let output = cargo(
            &["test", "--offline", "--workspace"],
            &built.package,
            &built.target,
        );
        let text = String::from_utf8_lossy(&output.stdout).into_owned();
        assert!(output.status.success(), "{text}\n{}", stderr(&output));
        text
    })
}

fn generated_passed(name: &str) {
    assert!(
        generated().contains(&format!("test {name} ... ok")),
        "the generated test {name} did not pass:\n{}",
        generated()
    );
}

/// A running `serve` program, stopped when it goes out of scope.
type Server = acceptance::Server;

fn server() -> Server {
    Server::start(&built().program).expect("the program serves")
}

fn text(response: &[u8]) -> String {
    String::from_utf8_lossy(response).into_owned()
}

fn status(response: &[u8]) -> String {
    text(response).lines().next().unwrap_or_default().to_owned()
}

fn body(response: &[u8]) -> String {
    let at = response
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .map_or(response.len(), |at| at + 4);
    text(&response[at..])
}

/// The number the host has counted so far, by asking with a counted request.
fn counted_calls(server: &Server) -> u64 {
    let response = server
        .exchange(&post(
            "/mcp",
            &[("Mcp-Method", "tools/call")],
            "Content-Length: 0\r\n",
            b"",
        ))
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK", "{}", text(&response));
    body(&response)
        .lines()
        .find_map(|line| line.strip_prefix("calls="))
        .expect("the echo has the counter")
        .parse()
        .expect("a number")
}

/// The raw message of a request with the field lines `lines` after the request line.
fn raw(line: &str, lines: &[String], body: &[u8]) -> Vec<u8> {
    let mut out = format!("{line}\r\n").into_bytes();
    for field in lines {
        out.extend_from_slice(format!("{field}\r\n").as_bytes());
    }
    out.extend_from_slice(b"\r\n");
    out.extend_from_slice(body);
    out
}

fn counted(extra: &[String]) -> Vec<String> {
    let mut lines = vec![
        "Host: 127.0.0.1".to_owned(),
        format!("Accept: {}", MEDIA[0].1),
        format!("Content-Type: {}", MEDIA[1].1),
        "Mcp-Method: tools/call".to_owned(),
    ];
    lines.extend(extra.iter().cloned());
    lines
}

#[test]
fn the_served_fixture_is_a_valid_declaration() {
    let application = served_model();
    validate(&application).unwrap();
    assert_eq!(application.core_effects().count(), 0);
    assert_eq!(application.frame_effects().len(), 2);
    assert!(!application.performs_effects());
    super::generate(&application).unwrap();
}

#[test]
fn the_listener_binds_loopback_only_and_refuses_any_other_address() {
    for address in [
        "0.0.0.0",
        "localhost",
        "::1",
        "::",
        "127.0.0.2",
        "127.0.0.1 ",
        "192.168.1.10",
        "10.0.0.1",
        "169.254.169.254",
        "",
    ] {
        let application = changed(|serving| serving["address"] = json!(address));
        assert!(
            refused(&application).contains("127.0.0.1 only"),
            "{address:?}"
        );
        // A declaration that is refused generates nothing.
        assert_eq!(generate(&application).unwrap_err().code, "PP2024");
    }
    generated_passed("the_listener_binds_loopback_only_and_refuses_any_other_address");
    let server = server();
    assert_eq!(server.address.ip().to_string(), "127.0.0.1");
    assert_ne!(server.address.port(), 0);
    let response = server
        .exchange(b"GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK");
    assert!(help(&served_model()).contains("listens on 127.0.0.1:0"));
}

#[test]
fn a_malformed_request_line_is_a_400_before_the_core_is_called() {
    generated_passed("a_malformed_request_line_is_a_400_before_the_core_is_called");
    let server = server();
    for bad in [
        &b"GET /\r\n\r\n"[..],
        b"GET  /echo HTTP/1.1\r\n\r\n",
        b"get\x01 /echo HTTP/1.1\r\n\r\n",
        b"GET /echo HTTP/1.1\n\n",
        b"\r\n\r\n",
        b"GARBAGE\r\n\r\n",
    ] {
        let response = server.exchange(bad).unwrap();
        assert_eq!(
            status(&response),
            "HTTP/1.1 400 Bad Request",
            "{:?}",
            text(bad)
        );
        assert_eq!(body(&response), "RequestLineMalformed\n");
    }
    for (bad, line, name) in [
        (
            &b"GET /echo HTTP/2.0\r\nHost: x\r\n\r\n"[..],
            "HTTP/1.1 505 HTTP Version Not Supported",
            "VersionUnsupported",
        ),
        (
            &b"GET /echo HTTP/1.0\r\nHost: x\r\n\r\n"[..],
            "HTTP/1.1 505 HTTP Version Not Supported",
            "VersionUnsupported",
        ),
    ] {
        let response = server.exchange(bad).unwrap();
        assert_eq!(status(&response), line);
        assert_eq!(body(&response), format!("{name}\n"));
    }
    let long = format!("GET /{} HTTP/1.1\r\nHost: x\r\n\r\n", "a".repeat(64));
    let response = server.exchange(long.as_bytes()).unwrap();
    assert_eq!(status(&response), "HTTP/1.1 414 URI Too Long");
    // A request without Host, and a field line that is no field line, are 400 as well.
    let response = server.exchange(b"GET /echo HTTP/1.1\r\n\r\n").unwrap();
    assert_eq!(body(&response), "HostInvalid\n");
    let response = server
        .exchange(b"GET /echo HTTP/1.1\r\nHost: x\r\nBroken\r\n\r\n")
        .unwrap();
    assert_eq!(body(&response), "FieldMalformed\n");
    // No refused request, counted or not, was the host's to count.
    assert_eq!(counted_calls(&server), 1);
    assert_eq!(counted_calls(&server), 2);
}

#[test]
fn an_oversized_header_section_is_a_431() {
    generated_passed("an_oversized_header_section_is_a_431");
    let server = server();
    // The request is counted, so a host that is asked at all moves the counter.
    let lines = counted(&["X-Pad: ".to_owned() + &"a".repeat(512)]);
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
        .unwrap();
    assert_eq!(
        status(&response),
        "HTTP/1.1 431 Request Header Fields Too Large"
    );
    assert_eq!(body(&response), "HeaderBytesExceeded\n");
    // On the bound: the field lines weigh exactly 512 bytes with their line endings.
    let base = counted(&[]);
    let weight: usize = base.iter().map(|line| line.len() + 2).sum();
    let exact = counted(&["X-Pad: ".to_owned() + &"a".repeat(512 - weight - 9)]);
    assert_eq!(exact.iter().map(|line| line.len() + 2).sum::<usize>(), 512);
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &exact, b""))
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK");
    let over = counted(&["X-Pad: ".to_owned() + &"a".repeat(512 - weight - 8)]);
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &over, b""))
        .unwrap();
    assert_eq!(
        status(&response),
        "HTTP/1.1 431 Request Header Fields Too Large"
    );
    // Only the request on the bound reached the host.
    assert_eq!(counted_calls(&server), 2);
}

#[test]
fn too_many_header_fields_are_a_431() {
    generated_passed("too_many_header_fields_are_a_431");
    let server = server();
    let numbered = |count: usize| {
        (0..count)
            .map(|index| format!("X: {index}"))
            .collect::<Vec<_>>()
    };
    // Twelve fields are allowed: four are the base, eight more reach the bound.
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &counted(&numbered(8)), b""))
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK", "{}", text(&response));
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &counted(&numbered(9)), b""))
        .unwrap();
    assert_eq!(
        status(&response),
        "HTTP/1.1 431 Request Header Fields Too Large"
    );
    assert_eq!(body(&response), "HeaderCountExceeded\n");
    assert_eq!(counted_calls(&server), 2);
}

#[test]
fn an_oversized_body_is_a_413_by_content_length_and_by_chunks() {
    generated_passed("an_oversized_body_is_a_413_by_content_length_and_by_chunks");
    let server = server();
    let by_length = |length: usize, sent: usize| {
        let lines = counted(&[format!("Content-Length: {length}")]);
        raw("POST /mcp HTTP/1.1", &lines, &vec![b'x'; sent])
    };
    let response = server.exchange(&by_length(128, 128)).unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK");
    assert!(body(&response).contains(&format!("body={}\n", "x".repeat(128))));
    // The answer comes from the field, whether or not the client sends what it announced.
    for sent in [0, 129, 4000] {
        let response = server.exchange(&by_length(129, sent)).unwrap();
        assert_eq!(
            status(&response),
            "HTTP/1.1 413 Content Too Large",
            "{sent}"
        );
        assert_eq!(body(&response), "BodyTooLarge\n");
    }
    let by_chunks = |sizes: &[usize]| {
        let lines = counted(&["Transfer-Encoding: chunked".to_owned()]);
        let mut body = Vec::new();
        for size in sizes {
            body.extend_from_slice(format!("{size:x}\r\n").as_bytes());
            body.extend_from_slice(&vec![b'y'; *size]);
            body.extend_from_slice(b"\r\n");
        }
        body.extend_from_slice(b"0\r\n\r\n");
        raw("POST /mcp HTTP/1.1", &lines, &body)
    };
    assert_eq!(
        status(&server.exchange(&by_chunks(&[64, 64])).unwrap()),
        "HTTP/1.1 200 OK"
    );
    for sizes in [&[129][..], &[128, 1], &[1, 128], &[64, 65]] {
        let response = server.exchange(&by_chunks(sizes)).unwrap();
        assert_eq!(
            status(&response),
            "HTTP/1.1 413 Content Too Large",
            "{sizes:?}"
        );
    }
    // Only the two requests within the bound reached the host.
    assert_eq!(counted_calls(&server), 3);
}

#[test]
fn a_forbidden_origin_is_a_403_before_the_core_is_called() {
    generated_passed("a_forbidden_origin_is_a_403_before_the_core_is_called");
    let server = server();
    for allowed in [
        "http://localhost",
        "http://localhost:3000",
        "HTTP://LOCALHOST:9",
        "http://127.0.0.1:8080",
        "https://app.example:8443",
    ] {
        let lines = counted(&[format!("Origin: {allowed}")]);
        let response = server
            .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
            .unwrap();
        assert_eq!(status(&response), "HTTP/1.1 200 OK", "{allowed}");
    }
    for forbidden in [
        "http://evil.example",
        "https://app.example",
        "https://app.example:8444",
        "http://localhost.evil.example",
        "http://localhost@evil.example",
        "http://localhost:3000/path",
        "null",
        "file://",
        "",
    ] {
        let lines = counted(&[format!("Origin: {forbidden}")]);
        let response = server
            .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
            .unwrap();
        assert_eq!(status(&response), "HTTP/1.1 403 Forbidden", "{forbidden:?}");
        assert_eq!(body(&response), "OriginForbidden\n");
    }
    let lines = counted(&[
        "Origin: http://localhost".to_owned(),
        "Origin: http://localhost".to_owned(),
    ]);
    let response = server
        .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 403 Forbidden");
    // The five requests that were allowed reached the host; none of the ten refused did.
    assert_eq!(counted_calls(&server), 6);
}

#[test]
fn accept_and_content_type_are_required_from_the_model() {
    generated_passed("accept_and_content_type_are_required_from_the_model");
    let server = server();
    let send = |accept: Option<&str>, content: Option<&str>| {
        let mut lines = vec![
            "Host: 127.0.0.1".to_owned(),
            "Mcp-Method: tools/call".to_owned(),
        ];
        lines.extend(accept.map(|value| format!("Accept: {value}")));
        lines.extend(content.map(|value| format!("Content-Type: {value}")));
        status(
            &server
                .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
                .unwrap(),
        )
    };
    let both = Some("application/json, text/event-stream");
    assert_eq!(send(both, Some("application/json")), "HTTP/1.1 200 OK");
    assert_eq!(
        send(both, Some("Application/JSON; charset=utf-8")),
        "HTTP/1.1 200 OK"
    );
    assert_eq!(
        send(
            Some("text/event-stream;q=0.5, application/json"),
            Some("application/json")
        ),
        "HTTP/1.1 200 OK"
    );
    for accept in [
        None,
        Some("*/*"),
        Some("application/json"),
        Some("text/event-stream"),
        Some("application/json, text/event-stream;q=0"),
    ] {
        assert_eq!(
            send(accept, Some("application/json")),
            "HTTP/1.1 406 Not Acceptable",
            "{accept:?}"
        );
    }
    for content in [
        None,
        Some("text/plain"),
        Some("application/jsonx"),
        Some(""),
    ] {
        assert_eq!(
            send(both, content),
            "HTTP/1.1 415 Unsupported Media Type",
            "{content:?}"
        );
    }
    // The requirement is on the model's methods: a GET is neither judged nor refused for it.
    let response = server
        .exchange(b"GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nMcp-Method: tools/call\r\n\r\n")
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK");
    assert_eq!(counted_calls(&server), 5);
}

#[test]
fn fields_reach_the_core_in_received_order_without_merging() {
    generated_passed("fields_reach_the_core_in_received_order_without_merging");
    let server = server();
    let response = server
        .exchange(b"GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\nX-Dup: first\r\nx-mixed-CASE:   padded value \t\r\nX-Dup: second\r\nX-Empty:\r\nX-Dup: third, with a comma\r\n\r\n")
        .unwrap();
    let lines = body(&response)
        .lines()
        .filter_map(|line| line.strip_prefix("field="))
        .map(str::to_owned)
        .collect::<Vec<_>>();
    assert_eq!(
        lines,
        [
            "Host:127.0.0.1",
            "X-Dup:first",
            "x-mixed-CASE:padded value",
            "X-Dup:second",
            "X-Empty:",
            "X-Dup:third, with a comma"
        ]
    );
}

#[test]
fn content_length_and_chunked_bodies_are_delimited_by_rfc_9112() {
    generated_passed("content_length_and_chunked_bodies_are_delimited_by_rfc_9112");
    let server = server();
    let ask = |framing: &[&str], bytes: &[u8]| {
        let mut lines = counted(&[]);
        lines.extend(framing.iter().map(|line| (*line).to_owned()));
        let response = server
            .exchange(&raw("POST /mcp HTTP/1.1", &lines, bytes))
            .unwrap();
        (status(&response), body(&response))
    };
    // The field decides the length, not the bytes that happen to follow.
    let (line, text) = ask(&["Content-Length: 3"], b"abcdef");
    assert_eq!(line, "HTTP/1.1 200 OK");
    assert!(text.contains("body=abc\n"), "{text}");
    let (_, text) = ask(
        &["Transfer-Encoding: chunked"],
        b"3;e=1\r\nabc\r\n2\r\nde\r\n0\r\nX-T: 1\r\n\r\n",
    );
    assert!(text.contains("body=abcde\n"), "{text}");
    assert!(!text.contains("X-T"), "trailers are read and not forwarded");
    let (_, text) = ask(&[], b"ignored");
    assert!(text.contains("body=\n"), "{text}");
    for (framing, bytes, name) in [
        (
            &["Content-Length: 3", "Transfer-Encoding: chunked"][..],
            &b"abc"[..],
            "FramingAmbiguous",
        ),
        (&["Content-Length: +3"], b"abc", "LengthInvalid"),
        (
            &["Content-Length: 3", "Content-Length: 3"],
            b"abc",
            "LengthInvalid",
        ),
        (
            &["Transfer-Encoding: gzip, chunked"],
            b"0\r\n\r\n",
            "TransferCodingUnsupported",
        ),
        (&["Transfer-Encoding: chunked"], b"zz\r\n", "ChunkMalformed"),
        (&["Expect: something-else"], b"", "ExpectationUnsupported"),
    ] {
        let (_, text) = ask(framing, bytes);
        assert_eq!(text, format!("{name}\n"), "{framing:?}");
    }
    assert_eq!(
        ask(&["Transfer-Encoding: gzip"], b"").0,
        "HTTP/1.1 501 Not Implemented"
    );
    assert_eq!(
        ask(&["Expect: something-else"], b"").0,
        "HTTP/1.1 417 Expectation Failed"
    );
    // A client that stops in the middle of a request is timed out, and answered.
    let mut stream = std::net::TcpStream::connect(server.address).unwrap();
    stream
        .write_all(b"POST /mcp HTTP/1.1\r\nHost: 127.0.0.1\r\nContent-Le")
        .unwrap();
    let mut response = Vec::new();
    std::io::Read::read_to_end(&mut stream, &mut response).unwrap();
    assert_eq!(status(&response), "HTTP/1.1 408 Request Timeout");
    // Of all these requests the host counted the two that were served in full.
    assert_eq!(counted_calls(&server), 4);
}

#[test]
fn host_provided_frame_sections_come_from_declared_effects() {
    generated_passed("host_provided_frame_sections_come_from_declared_effects");
    let server = server();
    // The counter is the host's: it moves for requests the model marks and for no other.
    let marked = |method: &str| {
        let lines = vec![
            "Host: 127.0.0.1".to_owned(),
            format!("Accept: {}", MEDIA[0].1),
            format!("Content-Type: {}", MEDIA[1].1),
            format!("Mcp-Method: {method}"),
        ];
        let response = server
            .exchange(&raw("POST /mcp HTTP/1.1", &lines, b""))
            .unwrap();
        let text = body(&response);
        let calls = text
            .lines()
            .find_map(|line| line.strip_prefix("calls="))
            .unwrap()
            .to_owned();
        (calls, text)
    };
    assert_eq!(marked("initialize").0, "0");
    assert_eq!(marked("tools/call").0, "1");
    assert_eq!(marked("tools/list").0, "1");
    assert_eq!(marked("TOOLS/CALL").0, "1", "the value is compared exactly");
    assert_eq!(marked("tools/callx").0, "1", "the value is compared whole");
    assert_eq!(marked("tools/call").0, "2");
    // The secret reference and the model's own list follow, in the declared order.
    let (_, text) = marked("initialize");
    assert!(
        text.contains("key=6b3379\nhosts=127.0.0.1,localhost\n"),
        "{text}"
    );
    // The effects of the frame are not the core's to request, and the program says so.
    let application = served_model();
    let package = generate(&application).unwrap();
    let protocol = package
        .files
        .iter()
        .find(|file| file.path.ends_with("host-api/src/protocol.rs"))
        .map(|file| String::from_utf8_lossy(&file.bytes).into_owned())
        .unwrap();
    let core = protocol
        .split_once("pub const CORE")
        .unwrap()
        .1
        .split_once("];")
        .unwrap()
        .0;
    assert_eq!(core.matches("false").count(), 2, "{core}");
    assert!(!core.contains("true"), "{core}");
    let text = help(&application);
    assert!(text.contains("tool.calls  request at most 32 bytes, outcome at most 16 bytes  (fills the request frame)"), "{text}");
    assert!(text.contains("secret.statekey"));
    // An effect the core is the only one to request cannot also be the frame's.
    let mut both: Value = served_value();
    both["host"]["effects"] = json!([effects()[0].clone(), effects()[1].clone(), {
        "name": "log.write",
        "request": [field("line", "text")],
        "result": [],
        "failures": [],
        "request_maximum": 64,
        "result_maximum": 8
    }]);
    both["host"]["effect_budget"] = json!(2);
    both["host"]["transcripts"] = json!([{"vector": 0, "steps": [{
        "effect": "tool.calls", "request": [0, 0, 0, 0, 0], "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
    }]}]);
    let both: ServerApplication = serde_json::from_value(both).unwrap();
    let error = validate(&both).unwrap_err();
    assert_eq!(error.code, "PP2013");
    assert!(
        error.message.contains("only fills the request frame"),
        "{}",
        error.message
    );
}

#[test]
fn the_core_response_is_serialized_as_returned() {
    generated_passed("the_core_response_is_serialized_as_returned");
    let server = server();
    // The core decides the status, the fields in their order, the content type and the body.
    // An event stream is bytes to the adapter, including the line endings inside it.
    let response = server
        .exchange(b"GET /events HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .unwrap();
    assert_eq!(
        response,
        http(
            "200 OK",
            &[
                ("Content-Type", "text/event-stream"),
                ("Cache-Control", "no-store"),
                ("X-Order", "second")
            ],
            b"id: 1\r\nevent: message\ndata: {}\n\n"
        )
    );
    // What is not a response is the adapter's 500, with its registered code.
    for (target, name) in [
        ("/malformed", "ResponseMalformed"),
        ("/notify", "ResponseMalformed"),
        ("/framing", "ResponseMalformed"),
        ("/crash", "CoreFailed"),
    ] {
        let response = server
            .exchange(format!("GET {target} HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n").as_bytes())
            .unwrap();
        assert_eq!(
            status(&response),
            "HTTP/1.1 500 Internal Server Error",
            "{target}"
        );
        assert_eq!(body(&response), format!("{name}\n"), "{target}");
    }
    // The adapter still serves after a core that failed.
    let response = server
        .exchange(b"GET /echo HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n")
        .unwrap();
    assert_eq!(status(&response), "HTTP/1.1 200 OK");
}

#[test]
fn every_served_vector_is_answered_over_a_real_socket() {
    generated_passed("every_served_vector_is_answered_over_a_real_socket");
    let application = served_model();
    let built = built();
    let work = tempfile::tempdir().unwrap();
    // The frame vectors replay through the program as slice 1 does, and the served
    // vectors cross a TCP connection on the loopback interface.
    let record = acceptance::execute(&application, &built.program, work.path(), false).unwrap();
    assert_eq!(record["status"], "verified");
    assert_eq!(record["vectors"], 4);
    assert_eq!(record["served"], 4);
    assert_eq!(record["transports"], json!(["file", "stdin", "socket"]));
    assert_eq!(
        acceptance::execute_served(&application, &built.program).unwrap(),
        4
    );
    // A modeled response that differs from the served bytes is a disagreement.
    let mut value = served_value();
    value["serving"][0]["vectors"][1]["response"] = json!(b"HTTP/1.1 200 OK\r\n\r\n".to_vec());
    let wrong: ServerApplication = serde_json::from_value(value).unwrap();
    assert_eq!(
        acceptance::execute_served(&wrong, &built.program)
            .unwrap_err()
            .code,
        "PP6003"
    );
    // Each frame the adapter builds is the frame vector the exchange names.
    for (index, (_, frame, _, _)) in exchanges().iter().enumerate() {
        assert_eq!(&application.acceptance_vectors[index].request, frame);
    }
    // The program that serves is the program that was verified.
    let output = run(&built.program, &["--help"], b"");
    assert_eq!(code(&output), 0);
    assert!(String::from_utf8_lossy(&output.stdout)
        .contains(&format!("{} serve", program_name(&application))));
}

#[test]
fn the_host_is_told_when_each_served_request_begins_and_ends() {
    let server = server();
    let log = std::env::temp_dir().join(format!("prism-hooks-{}.log", server.id()));
    let answered = server
        .exchange(&post("/mcp", &[], "Content-Length: 5\r\n", b"hello"))
        .unwrap();
    assert_eq!(status(&answered), "HTTP/1.1 200 OK", "{}", text(&answered));
    let refused = server
        .exchange(&post(
            "/mcp",
            &[("Origin", "http://evil.example")],
            "Content-Length: 5\r\n",
            b"hello",
        ))
        .unwrap();
    assert!(
        status(&refused).starts_with("HTTP/1.1 403"),
        "{}",
        text(&refused)
    );
    let refusal = body(&refused).lines().next().unwrap_or_default().to_owned();
    // This process answers only these two requests, numbered 0 and 1, and each end
    // carries the number its begin did.
    let expected = vec![
        "begin 0 hello".to_owned(),
        "end 0 hello -> method=POST".to_owned(),
        "begin 1 ".to_owned(),
        format!("end 1  -> {refusal}"),
    ];
    // request_end runs after the answer is written, so the record can trail the
    // response by a moment.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    let mut seen = Vec::new();
    while std::time::Instant::now() < deadline {
        seen = std::fs::read_to_string(&log)
            .unwrap_or_default()
            .lines()
            .map(str::to_owned)
            .collect();
        if seen.len() >= expected.len() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let _ = std::fs::remove_file(&log);
    assert_eq!(seen, expected);
}
