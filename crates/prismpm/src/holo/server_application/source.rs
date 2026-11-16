//! Bounded typed projection of the server declaration; no application
//! execution and no effect admission.

use super::{invalid, ServerApplication, MAXIMUM_CORPUS_BYTES, MODULE};
use crate::error::PrismError;
use crate::holo::application::Definitions;
use serde_json::{json, Map, Value};
use std::collections::BTreeSet;

type Row = (&'static str, &'static str, &'static str);

const APPLICATION: &[Row] = &[
    ("profile", "profile", "String"),
    ("name", "name", "String"),
    ("cargoName", "cargo_name", "String"),
    ("cargoVersion", "cargo_version", "String"),
    ("cargoDescription", "cargo_description", "String"),
    ("cargoRepository", "cargo_repository", "String"),
    ("cargoHomepage", "cargo_homepage", "String"),
    ("core", "core", "ServerCore"),
    (
        "acceptanceVectors",
        "acceptance_vectors",
        "ListAcceptanceVector",
    ),
    ("requestMaximum", "request_maximum", "UInt32"),
    ("responseMaximum", "response_maximum", "UInt32"),
    ("bindings", "bindings", "ListServerBinding"),
    ("serving", "serving", "ListServerServing"),
    (
        "verifyBuildTimeoutSeconds",
        "verify_build_timeout_seconds",
        "UInt32",
    ),
    ("host", "host", "HostProtocol"),
];

fn fields(kind: &str) -> Option<&'static [Row]> {
    Some(match kind {
        "ServerApplication" => APPLICATION,
        "ServerCore" => &[
            ("root", "root", "String"),
            ("package", "package", "String"),
            ("version", "version", "String"),
        ],
        "ServerBinding" => &[
            ("path", "path", "String"),
            ("crateName", "crate_name", "String"),
            ("host", "host", "String"),
        ],
        "ServerServing" => &[
            ("address", "address", "String"),
            ("port", "port", "UInt32"),
            ("connectionMaximum", "connection_maximum", "UInt32"),
            ("readTimeoutMillis", "read_timeout_millis", "UInt32"),
            ("rootStackBytes", "root_stack_bytes", "UInt32"),
            ("requestLineMaximum", "request_line_maximum", "UInt32"),
            ("headerCountMaximum", "header_count_maximum", "UInt32"),
            ("headerBytesMaximum", "header_bytes_maximum", "UInt32"),
            ("bodyMaximum", "body_maximum", "UInt32"),
            ("origins", "origins", "ListServingOrigin"),
            ("accept", "accept", "ListString"),
            ("contentTypes", "content_types", "ListString"),
            ("enforcedMethods", "enforced_methods", "ListString"),
            ("countedField", "counted_field", "String"),
            ("countedValue", "counted_value", "String"),
            ("frame", "frame", "ListFrameSection"),
            ("vectors", "vectors", "ListServedVector"),
        ],
        "ServingOrigin" => &[
            ("scheme", "scheme", "String"),
            ("host", "host", "String"),
            ("port", "port", "UInt32"),
        ],
        "FrameSection" => &[
            ("name", "name", "String"),
            ("kind", "kind", "FrameKind"),
            ("effect", "effect", "String"),
            ("field", "field", "String"),
            ("values", "values", "ListString"),
        ],
        "ServedVector" => &[
            ("vector", "vector", "UInt32"),
            ("request", "request", "Bytes"),
            ("response", "response", "Bytes"),
        ],
        "AcceptanceVector" => &[
            ("request", "request", "Bytes"),
            ("response", "response", "Bytes"),
        ],
        "HostProtocol" => &[
            ("protocol", "protocol", "String"),
            ("description", "description", "String"),
            ("usageCode", "usage_code", "UInt8"),
            ("ioCode", "io_code", "UInt8"),
            ("faultCode", "fault_code", "UInt8"),
            ("effectBudget", "effect_budget", "UInt32"),
            ("effects", "effects", "ListHostEffect"),
            ("transcripts", "transcripts", "ListHostTranscript"),
        ],
        "HostEffect" => &[
            ("name", "name", "String"),
            ("request", "request", "ListHostField"),
            ("result", "result", "ListHostField"),
            ("failures", "failures", "ListString"),
            ("requestMaximum", "request_maximum", "UInt32"),
            ("resultMaximum", "result_maximum", "UInt32"),
        ],
        "HostField" => &[("name", "name", "String"), ("kind", "kind", "HostKind")],
        "HostTranscript" => &[
            ("vector", "vector", "UInt32"),
            ("steps", "steps", "ListHostStep"),
        ],
        "HostStep" => &[
            ("effect", "effect", "String"),
            ("request", "request", "Bytes"),
            ("outcome", "outcome", "Bytes"),
        ],
        _ => return None,
    })
}

struct Projector<'a> {
    definitions: &'a Definitions<'a>,
    fuel: usize,
    bytes: usize,
}

impl<'a> Projector<'a> {
    fn step(&mut self) -> Result<(), PrismError> {
        self.fuel = self
            .fuel
            .checked_sub(1)
            .ok_or_else(|| invalid("server source metadata exceeds its traversal budget"))?;
        Ok(())
    }

    fn resolve(
        &mut self,
        mut owner: &'a str,
        mut value: &'a Value,
    ) -> Result<(&'a str, &'a Value), PrismError> {
        let mut visited = BTreeSet::new();
        loop {
            self.step()?;
            if value["kind"] != "call" {
                return Ok((owner, value));
            }
            if !value["arguments"].as_array().is_some_and(Vec::is_empty) {
                return Err(invalid("server metadata calls must be closed"));
            }
            let reference = &value["function"];
            let name = reference["name"]
                .as_str()
                .ok_or_else(|| invalid("invalid server metadata alias"))?;
            owner = match reference.get("module") {
                None => owner,
                Some(v) => v
                    .as_str()
                    .ok_or_else(|| invalid("invalid server metadata alias owner"))?,
            };
            if !visited.insert((owner, name)) {
                return Err(invalid("cyclic server metadata alias"));
            }
            let declaration = self
                .definitions
                .get(&(owner.to_owned(), name.to_owned()))
                .ok_or_else(|| invalid("unknown server metadata alias"))?;
            if !declaration["parameters"]
                .as_array()
                .is_some_and(Vec::is_empty)
            {
                return Err(invalid("server metadata alias has parameters"));
            }
            value = declaration
                .get("body")
                .ok_or_else(|| invalid("server metadata alias has no body"))?;
        }
    }

    fn list(
        &mut self,
        owner: &'a str,
        value: &'a Value,
        element: &str,
    ) -> Result<Value, PrismError> {
        let maximum = match element {
            "String" => 1024,
            "ServerBinding" | "ServerServing" => 2,
            "ServingOrigin" => super::serving::MAXIMUM_ORIGINS + 1,
            "FrameSection" => super::serving::MAXIMUM_SECTIONS + 1,
            "HostEffect" => super::MAXIMUM_EFFECTS + 1,
            "HostField" => super::MAXIMUM_FIELDS + 1,
            "HostStep" => super::MAXIMUM_BUDGET as usize + 1,
            _ => super::MAXIMUM_VECTORS + 1,
        };
        let mut result = Vec::new();
        let mut current = value;
        let mut module = owner;
        loop {
            (module, current) = self.resolve(module, current)?;
            if current["kind"] == "nil" {
                if current.get("element") != Some(&source_type(element)) {
                    return Err(invalid(
                        "server metadata list has a substituted element type",
                    ));
                }
                return Ok(Value::Array(result));
            }
            if current["kind"] != "cons" || result.len() == maximum {
                return Err(invalid("server metadata list is malformed or oversized"));
            }
            result.push(
                self.value(
                    module,
                    current
                        .get("head")
                        .ok_or_else(|| invalid("server metadata list has no head"))?,
                    element,
                )?,
            );
            current = current
                .get("tail")
                .ok_or_else(|| invalid("server metadata list has no tail"))?;
        }
    }

    fn integer(value: &Value, kind: &str) -> Result<Value, PrismError> {
        let representation = if kind == "UInt32" { "uint32" } else { "uint8" };
        if value["representation"] != representation {
            return Err(invalid("server metadata integer has the wrong type"));
        }
        let text = value["value"]
            .as_str()
            .ok_or_else(|| invalid("invalid server metadata integer"))?;
        let number: u32 = text
            .parse()
            .map_err(|_| invalid("server metadata integer is out of range"))?;
        if number.to_string() != text || kind == "UInt8" && number > 255 {
            return Err(invalid("noncanonical server metadata integer"));
        }
        Ok(json!(number))
    }

    fn octets(&mut self, value: &Value) -> Result<Value, PrismError> {
        let hex = value["hex"]
            .as_str()
            .ok_or_else(|| invalid("invalid server vector bytes"))?;
        self.bytes = self.bytes.saturating_add(hex.len() / 2);
        if hex.len() % 2 != 0
            || self.bytes > MAXIMUM_CORPUS_BYTES
            || !hex
                .bytes()
                .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
        {
            return Err(invalid("server vector bytes are noncanonical or oversized"));
        }
        Ok(Value::Array(
            hex.as_bytes()
                .chunks_exact(2)
                .map(|pair| {
                    json!(
                        u8::from_str_radix(std::str::from_utf8(pair).expect("ASCII hex"), 16)
                            .expect("checked hex")
                    )
                })
                .collect(),
        ))
    }

    fn kind(value: &Value, owner: &str) -> Result<Value, PrismError> {
        if value["kind"] != "constructor"
            || value["constructor"]["module"] != MODULE
            || !value["arguments"].as_array().is_none_or(Vec::is_empty)
        {
            return Err(invalid("kind is not a source-owned constructor"));
        }
        let constructor = value["constructor"]["name"]
            .as_str()
            .and_then(|name| name.strip_prefix(owner))
            .and_then(|name| name.strip_prefix('.'));
        let name = match (owner, constructor) {
            ("HostKind", Some("U32")) | ("FrameKind", Some("U32")) => "u32",
            ("HostKind", Some("U64")) | ("FrameKind", Some("U64")) => "u64",
            ("HostKind", Some("Flag")) => "flag",
            ("HostKind", Some("Bytes")) | ("FrameKind", Some("Bytes")) => "bytes",
            ("HostKind", Some("Text")) | ("FrameKind", Some("Text")) => "text",
            ("FrameKind", Some("TextList")) => "text-list",
            _ => return Err(invalid("unknown kind constructor")),
        };
        Ok(json!(name))
    }

    fn record(
        &mut self,
        owner: &'a str,
        value: &'a Value,
        kind: &str,
    ) -> Result<Value, PrismError> {
        let expected = fields(kind).ok_or_else(|| invalid("unknown server metadata type"))?;
        if value["kind"] != "record" || value["type"] != json!({"module":MODULE,"name":kind}) {
            return Err(invalid("server metadata record type is not source-owned"));
        }
        let rows = value["fields"]
            .as_array()
            .ok_or_else(|| invalid("server metadata record fields are absent"))?;
        if rows.len() != expected.len() {
            return Err(invalid("server metadata record is not closed"));
        }
        let mut seen = BTreeSet::new();
        let mut result = Map::new();
        for row in rows {
            let field = row["field"]
                .as_str()
                .ok_or_else(|| invalid("server metadata field is malformed"))?;
            let (_, output, ty) = expected
                .iter()
                .find(|row| row.0 == field)
                .ok_or_else(|| invalid("unknown server metadata field"))?;
            if !seen.insert(field) {
                return Err(invalid("duplicate server metadata field"));
            }
            result.insert(
                (*output).to_owned(),
                self.value(
                    owner,
                    row.get("value")
                        .ok_or_else(|| invalid("server metadata field has no value"))?,
                    ty,
                )?,
            );
        }
        Ok(Value::Object(result))
    }

    fn value(&mut self, owner: &'a str, value: &'a Value, kind: &str) -> Result<Value, PrismError> {
        let (owner, value) = self.resolve(owner, value)?;
        if let Some(element) = kind.strip_prefix("List") {
            return self.list(owner, value, element);
        }
        match kind {
            "String" if value["kind"] == "string" => {
                let text = value["value"]
                    .as_str()
                    .ok_or_else(|| invalid("invalid server metadata string"))?;
                if text.len() > 4096 {
                    return Err(invalid("server metadata string exceeds its bound"));
                }
                Ok(Value::String(text.to_owned()))
            }
            "UInt32" | "UInt8" if value["kind"] == "integer" => Self::integer(value, kind),
            "Bytes" if value["kind"] == "bytes" => self.octets(value),
            "HostKind" | "FrameKind" => Self::kind(value, kind),
            _ => self.record(owner, value, kind),
        }
    }
}

fn source_type(kind: &str) -> Value {
    match kind {
        "String" => json!({"kind":"string"}),
        _ => json!({"kind":"named","member":{"module":MODULE,"name":kind},"arguments":[]}),
    }
}

pub(in crate::holo) fn project<'a>(
    definitions: &'a Definitions<'a>,
    owner: &'a str,
    declaration: &'a Value,
) -> Result<ServerApplication, PrismError> {
    if declaration.get("result") != Some(&source_type("ServerApplication"))
        || !declaration["parameters"]
            .as_array()
            .is_some_and(Vec::is_empty)
    {
        return Err(invalid(
            "server application result type must be the exact closed source-owned declaration",
        ));
    }
    let value = Projector {
        definitions,
        fuel: 262_144,
        bytes: 0,
    }
    .value(
        owner,
        declaration
            .get("body")
            .ok_or_else(|| invalid("server application definition has no body"))?,
        "ServerApplication",
    )?;
    serde_json::from_value(value)
        .map_err(|_| invalid("server application projection is not a closed declaration"))
}
