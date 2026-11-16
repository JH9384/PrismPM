//! Shared helpers of the server application contract tests: the declaration
//! fixtures, the schema, the Lean notation of a declaration and its projection
//! from a source-owned model through the pinned lexlean compiler.
#![allow(dead_code)]

use lexlean::{CheckRequest, Engine, LockRequest, Selection};
use prismpm::holo::model_document::ModelDocument;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub const MODEL: &str = "Foundation.Server.V1.Model";

pub fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .unwrap()
        .to_path_buf()
}

pub fn field(name: &str, kind: &str) -> Value {
    json!({"name": name, "kind": kind})
}

pub fn declaration() -> Value {
    json!({
        "profile": "prismpm/server-application/1",
        "name": "Server Probe",
        "cargo_name": "server-probe",
        "cargo_version": "0.1.0",
        "cargo_description": "A modeled host effect conformance fixture.",
        "cargo_repository": "https://example.invalid/probe",
        "cargo_homepage": "https://example.invalid/probe",
        "acceptance_vectors": [
            {"request": [97], "response": [98]},
            {"request": [99], "response": [100]}
        ],
        "core": {"root": "ServerProbe.ServerProbe.dispatch", "package": "server_probe_core", "version": "0.1.0"},
        "bindings": [{"path": "bindings/server-probe-binding", "crate_name": "server-probe-binding", "host": "server_probe_binding::Native"}],
        "serving": [],
        "verify_build_timeout_seconds": 1800,
        "request_maximum": 8,
        "response_maximum": 8,
        "host": {
            "protocol": "prismpm/host-effects/1",
            "description": "Probe.\n",
            "usage_code": 64,
            "io_code": 74,
            "fault_code": 70,
            "effect_budget": 2,
            "effects": [
                {
                    "name": "store.get",
                    "request": [field("key", "bytes"), field("limit", "u32")],
                    "result": [field("found", "flag"), field("note", "text")],
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
                }
            ],
            "transcripts": [
                {"vector": 0, "steps": [
                    {
                        "effect": "store.get",
                        "request": [0, 0, 0, 1, 107, 0, 0, 0, 7],
                        "outcome": [0, 0, 0, 0, 1, 0, 0, 0, 0]
                    },
                    {
                        "effect": "clock.now",
                        "request": [],
                        "outcome": [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 42]
                    }
                ]},
                {"vector": 1, "steps": [{
                    "effect": "store.get",
                    "request": [0, 0, 0, 0, 0, 0, 0, 1],
                    "outcome": [0, 0, 0, 1, 0, 0, 0, 1]
                }]}
            ]
        }
    })
}

pub fn fixture() -> Value {
    let mut value: Value = serde_json::from_slice(
        &std::fs::read(root().join("tests/data/text-model-document.json")).unwrap(),
    )
    .unwrap();
    value["schema"] = json!("prismpm/model-document/7");
    value["application"] = declaration();
    value
}

pub fn typed(value: Value) -> ModelDocument {
    serde_json::from_value(value).unwrap()
}

pub fn schema() -> jsonschema::Validator {
    let schema: Value = serde_json::from_slice(include_bytes!(
        "../../schemas/model-document-v7.schema.json"
    ))
    .unwrap();
    jsonschema::validator_for(&schema).unwrap()
}

pub fn rejected(value: Value) -> bool {
    match serde_json::from_value::<ModelDocument>(value) {
        Ok(doc) => prismpm::holo::validate::validate(&doc).is_err(),
        Err(_) => true,
    }
}

pub fn list(name: &str, rows: Vec<String>) -> String {
    rows.into_iter()
        .rev()
        .fold(format!("(nil {name})"), |tail, head| {
            format!("(cons {head} {tail})")
        })
}

pub fn record(name: &str, fields: Vec<(&str, String)>) -> String {
    let fields = fields
        .into_iter()
        .map(|(name, value)| format!("{name} := {value}"))
        .collect::<Vec<_>>()
        .join(", ");
    format!("(record {MODEL}::{name} {{{fields}}})")
}

pub fn text(value: &Value) -> String {
    serde_json::to_string(value.as_str().unwrap()).unwrap()
}

pub fn texts(values: &Value) -> String {
    list(
        "String",
        values.as_array().unwrap().iter().map(text).collect(),
    )
}

pub fn octets(value: &Value) -> String {
    let bytes = value
        .as_array()
        .unwrap()
        .iter()
        .map(|byte| format!("{:02x}", byte.as_u64().unwrap()))
        .collect::<String>();
    format!("0x{bytes}")
}

pub fn fields(values: &Value) -> String {
    list(
        &format!("{MODEL}::HostField"),
        values
            .as_array()
            .unwrap()
            .iter()
            .map(|field| {
                let kind = match field["kind"].as_str().unwrap() {
                    "u32" => "U32",
                    "u64" => "U64",
                    "flag" => "Flag",
                    "bytes" => "Bytes",
                    _ => "Text",
                };
                record(
                    "HostField",
                    vec![
                        ("name", text(&field["name"])),
                        ("kind", format!("(ctor {MODEL}::HostKind.{kind})")),
                    ],
                )
            })
            .collect(),
    )
}

pub fn number(value: &Value, kind: &str) -> String {
    format!("({} : {kind})", value.as_u64().unwrap())
}

pub fn notation(application: &Value) -> String {
    let host = &application["host"];
    let effects = list(
        &format!("{MODEL}::HostEffect"),
        host["effects"]
            .as_array()
            .unwrap()
            .iter()
            .map(|effect| {
                record(
                    "HostEffect",
                    vec![
                        ("name", text(&effect["name"])),
                        ("request", fields(&effect["request"])),
                        ("result", fields(&effect["result"])),
                        ("failures", texts(&effect["failures"])),
                        (
                            "requestMaximum",
                            number(&effect["request_maximum"], "UInt32"),
                        ),
                        ("resultMaximum", number(&effect["result_maximum"], "UInt32")),
                    ],
                )
            })
            .collect(),
    );
    let transcripts = list(
        &format!("{MODEL}::HostTranscript"),
        host["transcripts"]
            .as_array()
            .unwrap()
            .iter()
            .map(|transcript| {
                record(
                    "HostTranscript",
                    vec![
                        ("vector", number(&transcript["vector"], "UInt32")),
                        (
                            "steps",
                            list(
                                &format!("{MODEL}::HostStep"),
                                transcript["steps"]
                                    .as_array()
                                    .unwrap()
                                    .iter()
                                    .map(|step| {
                                        record(
                                            "HostStep",
                                            vec![
                                                ("effect", text(&step["effect"])),
                                                ("request", octets(&step["request"])),
                                                ("outcome", octets(&step["outcome"])),
                                            ],
                                        )
                                    })
                                    .collect(),
                            ),
                        ),
                    ],
                )
            })
            .collect(),
    );
    let protocol = record(
        "HostProtocol",
        vec![
            ("protocol", text(&host["protocol"])),
            ("description", text(&host["description"])),
            ("usageCode", number(&host["usage_code"], "UInt8")),
            ("ioCode", number(&host["io_code"], "UInt8")),
            ("faultCode", number(&host["fault_code"], "UInt8")),
            ("effectBudget", number(&host["effect_budget"], "UInt32")),
            ("effects", effects),
            ("transcripts", transcripts),
        ],
    );
    let vectors = list(
        &format!("{MODEL}::AcceptanceVector"),
        application["acceptance_vectors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|vector| {
                record(
                    "AcceptanceVector",
                    vec![
                        ("request", octets(&vector["request"])),
                        ("response", octets(&vector["response"])),
                    ],
                )
            })
            .collect(),
    );
    let core = record(
        "ServerCore",
        vec![
            ("root", text(&application["core"]["root"])),
            ("package", text(&application["core"]["package"])),
            ("version", text(&application["core"]["version"])),
        ],
    );
    let bindings = list(
        &format!("{MODEL}::ServerBinding"),
        application["bindings"]
            .as_array()
            .unwrap()
            .iter()
            .map(|binding| {
                record(
                    "ServerBinding",
                    vec![
                        ("path", text(&binding["path"])),
                        ("crateName", text(&binding["crate_name"])),
                        ("host", text(&binding["host"])),
                    ],
                )
            })
            .collect(),
    );
    let serving = serving(&application["serving"]);
    record(
        "ServerApplication",
        vec![
            ("profile", text(&application["profile"])),
            ("name", text(&application["name"])),
            ("cargoName", text(&application["cargo_name"])),
            ("cargoVersion", text(&application["cargo_version"])),
            ("cargoDescription", text(&application["cargo_description"])),
            ("cargoRepository", text(&application["cargo_repository"])),
            ("cargoHomepage", text(&application["cargo_homepage"])),
            ("core", core),
            ("acceptanceVectors", vectors),
            (
                "requestMaximum",
                number(&application["request_maximum"], "UInt32"),
            ),
            (
                "responseMaximum",
                number(&application["response_maximum"], "UInt32"),
            ),
            ("bindings", bindings),
            ("serving", serving),
            (
                "verifyBuildTimeoutSeconds",
                number(&application["verify_build_timeout_seconds"], "UInt32"),
            ),
            ("host", protocol),
        ],
    )
}

pub fn source(application: &Value, owner: &str) -> String {
    format!(
        "\\begin{{lexlean}}{{ServerProbe}}\n\\useglossary{{lexlean.std.bool@1.2.0}}\n\\useglossary{{lexlean.std.nat@1.2.0}}\n\\useglossary{{prism.arch@1.0.0}}\n\\importmodule{{Foundation.Bytes}}\n\\importmodule{{{owner}}}\n\\title{{Server application model}}\n\\begin{{semanticmodule}}\ndefinition{{\n  name: application,\n  parameters: [],\n  result: {owner}::ServerApplication,\n  body: {}\n}}\n\ndefinition{{\n  name: dispatch,\n  parameters: [value : Bytes],\n  result: Bytes,\n  body: 0x62,\n  axioms: []\n}}\n\\end{{semanticmodule}}\n\\end{{lexlean}}\n",
        notation(application).replace(MODEL, owner)
    )
}

#[allow(clippy::result_large_err)]
pub fn project(source: &str, owner: &str) -> Result<ModelDocument, prismpm::PrismError> {
    let temp = tempfile::tempdir().unwrap();
    let repo = root();
    let project = repo.join("tests/fixtures/holo/ho-11-text-application/project");
    for name in [
        "lexlean.toml",
        "lexlean.lock",
        "lean-toolchain",
        "lakefile.toml",
        "lake-manifest.json",
    ] {
        let text = std::fs::read_to_string(project.join(name))
            .unwrap()
            .replace("PrismTextRequest", "ServerProbe")
            .replace("TextRequest.lex.tex", "ServerProbe.lex.tex");
        std::fs::write(temp.path().join(name), text).unwrap();
    }
    let bytes = temp.path().join("src/Foundation/Bytes.lex.tex");
    std::fs::create_dir_all(bytes.parent().unwrap()).unwrap();
    std::fs::copy(repo.join("stdlib/src/Foundation/Bytes.lex.tex"), bytes).unwrap();
    let model = std::fs::read_to_string(repo.join("stdlib/src/Foundation/Server/V1/Model.lex.tex"))
        .unwrap()
        .replace(MODEL, owner);
    let path = temp
        .path()
        .join("src")
        .join(owner.replace('.', "/") + ".lex.tex");
    std::fs::create_dir_all(path.parent().unwrap()).unwrap();
    std::fs::write(path, model).unwrap();
    std::fs::write(temp.path().join("src/ServerProbe.lex.tex"), source).unwrap();
    let language = repo.join("language/prism.arch");
    for entry in walkdir::WalkDir::new(&language) {
        let entry = entry.unwrap();
        let destination = temp
            .path()
            .join("language/prism.arch")
            .join(entry.path().strip_prefix(&language).unwrap());
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(destination).unwrap();
        } else {
            std::fs::copy(entry.path(), destination).unwrap();
        }
    }
    let manifest = camino::Utf8PathBuf::from_path_buf(temp.path().join("lexlean.toml")).unwrap();
    Engine::load(&manifest)
        .unwrap()
        .lock(LockRequest {
            check_only: false,
            allow_network: false,
        })
        .unwrap();
    let snapshot = Engine::load(&manifest)
        .unwrap()
        .snapshot(CheckRequest {
            selection: Selection::Entrypoints,
        })
        .unwrap();
    prismpm::holo::application::project_application(&snapshot).map(Option::unwrap)
}

/// The Lean notation of the `serving` list: no record, or the one.
pub fn serving(rows: &Value) -> String {
    list(
        &format!("{MODEL}::ServerServing"),
        rows.as_array()
            .unwrap()
            .iter()
            .map(|row| {
                let origins = list(
                    &format!("{MODEL}::ServingOrigin"),
                    row["origins"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|origin| {
                            record(
                                "ServingOrigin",
                                vec![
                                    ("scheme", text(&origin["scheme"])),
                                    ("host", text(&origin["host"])),
                                    ("port", number(&origin["port"], "UInt32")),
                                ],
                            )
                        })
                        .collect(),
                );
                let frame = list(
                    &format!("{MODEL}::FrameSection"),
                    row["frame"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|section| {
                            let kind = match section["kind"].as_str().unwrap() {
                                "u32" => "U32",
                                "u64" => "U64",
                                "bytes" => "Bytes",
                                "text" => "Text",
                                _ => "TextList",
                            };
                            record(
                                "FrameSection",
                                vec![
                                    ("name", text(&section["name"])),
                                    ("kind", format!("(ctor {MODEL}::FrameKind.{kind})")),
                                    ("effect", text(&section["effect"])),
                                    ("field", text(&section["field"])),
                                    ("values", texts(&section["values"])),
                                ],
                            )
                        })
                        .collect(),
                );
                let vectors = list(
                    &format!("{MODEL}::ServedVector"),
                    row["vectors"]
                        .as_array()
                        .unwrap()
                        .iter()
                        .map(|vector| {
                            record(
                                "ServedVector",
                                vec![
                                    ("vector", number(&vector["vector"], "UInt32")),
                                    ("request", octets(&vector["request"])),
                                    ("response", octets(&vector["response"])),
                                ],
                            )
                        })
                        .collect(),
                );
                let count = |name: &str| number(&row[name], "UInt32");
                record(
                    "ServerServing",
                    vec![
                        ("address", text(&row["address"])),
                        ("port", count("port")),
                        ("connectionMaximum", count("connection_maximum")),
                        ("readTimeoutMillis", count("read_timeout_millis")),
                        ("rootStackBytes", count("root_stack_bytes")),
                        ("requestLineMaximum", count("request_line_maximum")),
                        ("headerCountMaximum", count("header_count_maximum")),
                        ("headerBytesMaximum", count("header_bytes_maximum")),
                        ("bodyMaximum", count("body_maximum")),
                        ("origins", origins),
                        ("accept", texts(&row["accept"])),
                        ("contentTypes", texts(&row["content_types"])),
                        ("enforcedMethods", texts(&row["enforced_methods"])),
                        ("countedField", text(&row["counted_field"])),
                        ("countedValue", text(&row["counted_value"])),
                        ("frame", frame),
                        ("vectors", vectors),
                    ],
                )
            })
            .collect(),
    )
}

fn octet_array(text: &str) -> Value {
    json!(text.as_bytes())
}

/// A served declaration: the probe declaration with one more effect that only fills
/// the request frame, and the serving record that says how it is served.
pub fn served_declaration() -> Value {
    let mut value = declaration();
    value["request_maximum"] = json!(8192);
    value["host"]["effects"]
        .as_array_mut()
        .unwrap()
        .push(json!({
            "name": "tool.calls",
            "request": [field("counted", "flag")],
            "result": [field("calls", "u64")],
            "failures": [],
            "request_maximum": 8,
            "result_maximum": 16
        }));
    value["serving"] = json!([{
        "address": "127.0.0.1",
        "port": 8080,
        "connection_maximum": 16,
        "read_timeout_millis": 5000,
        "root_stack_bytes": 8_388_608,
        "request_line_maximum": 256,
        "header_count_maximum": 32,
        "header_bytes_maximum": 4096,
        "body_maximum": 256,
        "origins": [
            {"scheme": "http", "host": "localhost", "port": 0},
            {"scheme": "https", "host": "[::1]", "port": 8443}
        ],
        "accept": ["application/json", "text/event-stream"],
        "content_types": ["application/json"],
        "enforced_methods": ["POST"],
        "counted_field": "Mcp-Method",
        "counted_value": "tools/call",
        "frame": [
            {"name": "tool_calls", "kind": "u64", "effect": "tool.calls", "field": "calls", "values": []},
            {"name": "allowed_hosts", "kind": "text-list", "effect": "", "field": "", "values": ["localhost"]}
        ],
        "vectors": [{
            "vector": 0,
            "request": octet_array("GET /health HTTP/1.1\r\nHost: localhost\r\n\r\n"),
            "response": octet_array("HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\nb")
        }]
    }]);
    value
}

pub fn served_fixture() -> Value {
    let mut value = fixture();
    value["application"] = served_declaration();
    value
}
