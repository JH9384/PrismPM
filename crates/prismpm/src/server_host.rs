//! Generated host adapter of a server application.
//!
//! Two Cargo packages are rendered only from the application's closed host
//! effect declaration, its exchange bounds and its core. The API package,
//! `{cargo_name}-host-api`, holds the wire primitives, every effect type with
//! its codec, the closed request sum and the `Host` trait. The binding is a crate
//! of the consumer's own workspace that depends on it and implements the trait,
//! so the driver package, `{cargo_name}-host`, can depend on both without a
//! cycle. The driver package holds the replay loop, the scripted host and the
//! program; a small fixed template owns the loop and the codec primitives.
//! Nothing here is handwritten per application, and an effect that is not
//! declared has no constructor, no decoder arm and no host method. Process I/O
//! is the raw adapter fragment of `crate::binary_cli`.

use crate::binary_cli::INPUT_ADAPTER;
use crate::error::PrismError;
use crate::holo::server_application::{
    camel, snake, validate, FrameKind, HostEffect, HostField, HostKind, ServerApplication,
};
use prod_codegen::{GeneratedPackage, PackageFile};
use std::fmt::Write as _;

pub mod acceptance;
#[cfg(test)]
mod exercise_tests;
#[cfg(test)]
pub(crate) mod serving_tests;
#[cfg(test)]
pub(crate) mod tests;
#[cfg(test)]
mod verify_tests;
pub mod workspace;

const WIRE: &str = include_str!("server_host/wire.rs.in");
const FAILURE: &str = include_str!("server_host/failure.rs.in");
const EXCHANGE: &str = include_str!("server_host/exchange.rs.in");
const MAIN: &str = include_str!("server_host/main.rs.in");
const TESTS: &str = include_str!("server_host/acceptance_tests.rs.in");
const REFUSAL: &str = include_str!("server_host/refusal.rs.in");
const SERVE: &str = include_str!("server_host/serve.rs.in");
const SERVING_TESTS: &str = include_str!("server_host/serving_tests.rs.in");

/// Name of the generated program and package: the core's Cargo name plus `-host`.
#[must_use]
pub fn program_name(application: &ServerApplication) -> String {
    format!("{}-host", application.cargo_name)
}

/// Rust identifier of the generated library crate.
#[must_use]
pub fn library_name(application: &ServerApplication) -> String {
    program_name(application).replace('-', "_")
}

/// Name of the generated API package, which a binding crate depends on.
#[must_use]
pub fn api_name(application: &ServerApplication) -> String {
    format!("{}-api", program_name(application))
}

/// Rust identifier of the generated API crate.
#[must_use]
pub fn api_library_name(application: &ServerApplication) -> String {
    api_name(application).replace('-', "_")
}

/// Rust identifier of the production core crate: the exported package name.
fn core(application: &ServerApplication) -> &str {
    &application.core.package
}

fn rust_type(kind: HostKind) -> &'static str {
    match kind {
        HostKind::U32 => "u32",
        HostKind::U64 => "u64",
        HostKind::Flag => "bool",
        HostKind::Bytes => "Vec<u8>",
        HostKind::Text => "String",
    }
}

fn read(kind: HostKind) -> &'static str {
    match kind {
        HostKind::U32 => "reader.u32()?",
        HostKind::U64 => "reader.u64()?",
        HostKind::Flag => "reader.flag()?",
        HostKind::Bytes => "reader.chunk()?.to_vec()",
        HostKind::Text => "reader.text()?",
    }
}

fn write(kind: HostKind, value: &str) -> String {
    match kind {
        HostKind::U32 => format!("wire::put_u32(&mut out, {value});"),
        HostKind::U64 => format!("wire::put_u64(&mut out, {value});"),
        HostKind::Flag => format!("wire::put_flag(&mut out, {value});"),
        HostKind::Bytes => format!("wire::put_chunk(&mut out, &{value})?;"),
        HostKind::Text => format!("wire::put_chunk(&mut out, {value}.as_bytes())?;"),
    }
}

fn literal(value: &str) -> String {
    format!("{value:?}")
}

fn bytes(value: &[u8]) -> String {
    let mut text = String::from("&[");
    for (index, byte) in value.iter().enumerate() {
        if index > 0 {
            text.push_str(", ");
        }
        let _ = write!(text, "{byte}");
    }
    text.push(']');
    text
}

fn record(text: &mut String, name: &str, fields: &[HostField], decode: &str, encode: &str) {
    let _ = writeln!(text, "    #[derive(Debug, Clone, PartialEq, Eq)]");
    let _ = writeln!(text, "    pub struct {name} {{");
    for field in fields {
        let _ = writeln!(
            text,
            "        pub {}: {},",
            field.name,
            rust_type(field.kind)
        );
    }
    let _ = writeln!(text, "    }}\n");
    let _ = writeln!(text, "    impl {name} {{");
    let _ = writeln!(
        text,
        "        pub fn {decode}(payload: &[u8]) -> Result<{name}, Refusal> {{"
    );
    let mutable = if fields.is_empty() { "" } else { "mut " };
    let _ = writeln!(
        text,
        "            let {mutable}reader = Reader::new(payload);"
    );
    let _ = writeln!(text, "            let value = {name} {{");
    for field in fields {
        let _ = writeln!(
            text,
            "                {}: {},",
            field.name,
            read(field.kind)
        );
    }
    let _ = writeln!(text, "            }};");
    let _ = writeln!(text, "            reader.finish()?;");
    let _ = writeln!(text, "            Ok(value)\n        }}\n");
    let _ = writeln!(
        text,
        "        pub fn {encode}(&self) -> Result<Vec<u8>, Refusal> {{"
    );
    let _ = writeln!(text, "            let {mutable}out = Vec::new();");
    for field in fields {
        let _ = writeln!(
            text,
            "            {}",
            write(field.kind, &format!("self.{}", field.name))
        );
    }
    let _ = writeln!(text, "            Ok(out)\n        }}\n    }}\n");
}

fn module(text: &mut String, effect: &HostEffect) {
    let _ = writeln!(text, "pub mod {} {{", snake(&effect.name));
    let _ = writeln!(text, "    #[allow(unused_imports)]");
    let _ = writeln!(text, "    use crate::wire::{{self, Reader, Refusal}};\n");
    record(text, "Request", &effect.request, "decode", "encode");
    // The completed result shares the record shape but is encoded inside an
    // outcome, so it exposes the same fallible encoder under a distinct name.
    record(text, "Completed", &effect.result, "decode", "encode");
    let _ = writeln!(text, "    #[derive(Debug, Clone, Copy, PartialEq, Eq)]");
    let _ = writeln!(text, "    pub enum Failure {{");
    for failure in &effect.failures {
        let _ = writeln!(text, "        {},", camel(failure));
    }
    let _ = writeln!(text, "    }}\n");
    let _ = writeln!(text, "    impl Failure {{");
    let _ = writeln!(
        text,
        "        /// Declared failure names; a failure's wire index is its position."
    );
    let _ = writeln!(
        text,
        "        pub const NAMES: &'static [&'static str] = &["
    );
    for failure in &effect.failures {
        let _ = writeln!(text, "            {},", literal(failure));
    }
    let _ = writeln!(text, "        ];\n");
    let _ = writeln!(text, "        pub fn index(self) -> u32 {{");
    if effect.failures.is_empty() {
        let _ = writeln!(text, "            match self {{}}");
    } else {
        let _ = writeln!(text, "            match self {{");
        for (index, failure) in effect.failures.iter().enumerate() {
            let _ = writeln!(
                text,
                "                Failure::{} => {index},",
                camel(failure)
            );
        }
        let _ = writeln!(text, "            }}");
    }
    let _ = writeln!(text, "        }}\n");
    let _ = writeln!(
        text,
        "        pub fn from_index(index: u32) -> Option<Failure> {{"
    );
    let _ = writeln!(text, "            match index {{");
    for (index, failure) in effect.failures.iter().enumerate() {
        let _ = writeln!(
            text,
            "                {index} => Some(Failure::{}),",
            camel(failure)
        );
    }
    let _ = writeln!(
        text,
        "                _ => None,\n            }}\n        }}\n    }}\n"
    );
    let _ = writeln!(text, "    pub type Outcome = Result<Completed, Failure>;\n");
    let _ = writeln!(
        text,
        "    pub fn decode_outcome(bytes: &[u8]) -> Result<Outcome, Refusal> {{"
    );
    let _ = writeln!(text, "        let mut reader = Reader::new(bytes);");
    let _ = writeln!(text, "        let outcome = match reader.u32()? {{");
    let _ = writeln!(text, "            0 => Ok(Completed {{");
    for field in &effect.result {
        let _ = writeln!(
            text,
            "                {}: {},",
            field.name,
            read(field.kind)
        );
    }
    let _ = writeln!(text, "            }}),");
    let _ = writeln!(
        text,
        "            1 => Err(Failure::from_index(reader.u32()?).ok_or(Refusal::Failure)?),"
    );
    let _ = writeln!(text, "            _ => return Err(Refusal::Status),");
    let _ = writeln!(text, "        }};");
    let _ = writeln!(text, "        reader.finish()?;");
    let _ = writeln!(text, "        Ok(outcome)\n    }}\n");
    let _ = writeln!(
        text,
        "    pub fn encode_outcome(outcome: &Outcome) -> Result<Vec<u8>, Refusal> {{"
    );
    let _ = writeln!(text, "        let mut out = Vec::new();");
    let _ = writeln!(text, "        match outcome {{");
    let binding = if effect.result.is_empty() {
        "_"
    } else {
        "value"
    };
    let _ = writeln!(text, "            Ok({binding}) => {{");
    let _ = writeln!(text, "                wire::put_u32(&mut out, 0);");
    for field in &effect.result {
        let _ = writeln!(
            text,
            "                {}",
            write(field.kind, &format!("value.{}", field.name))
        );
    }
    let _ = writeln!(text, "            }}");
    let _ = writeln!(text, "            Err(failure) => {{");
    let _ = writeln!(text, "                wire::put_u32(&mut out, 1);");
    let _ = writeln!(
        text,
        "                wire::put_u32(&mut out, failure.index());"
    );
    let _ = writeln!(text, "            }}");
    let _ = writeln!(text, "        }}");
    let _ = writeln!(text, "        Ok(out)\n    }}\n}}\n");
}

/// The protocol module: the closed effect sum and everything typed by it.
fn protocol(application: &ServerApplication) -> String {
    let effects = &application.host.effects;
    let mut text = String::from(
        "// Generated from the closed host effect declaration. Do not edit.\n\nuse crate::wire::Refusal;\n\n",
    );
    let _ = writeln!(
        text,
        "/// Declared effect names; an effect's wire tag is its position."
    );
    let _ = writeln!(text, "pub const EFFECTS: &[&str] = &[");
    for effect in effects {
        let _ = writeln!(text, "    {},", literal(&effect.name));
    }
    let _ = writeln!(text, "];\n");
    let frame = application.frame_effects();
    let _ = writeln!(
        text,
        "/// Whether the core may request each effect, by tag. An effect that is not\n/// the core's only fills a section of the request frame.\npub const CORE: &[bool] = &["
    );
    for effect in effects {
        let _ = writeln!(text, "    {},", !frame.contains(effect.name.as_str()));
    }
    let _ = writeln!(text, "];\n");
    for (name, pick) in [("REQUEST_MAXIMA", 0usize), ("RESULT_MAXIMA", 1usize)] {
        let _ = writeln!(
            text,
            "/// Largest encoded {} of each effect, by tag.",
            if pick == 0 {
                "request payload"
            } else {
                "outcome"
            }
        );
        let _ = writeln!(text, "pub const {name}: &[usize] = &[");
        for effect in effects {
            let _ = writeln!(
                text,
                "    {},",
                if pick == 0 {
                    effect.request_maximum
                } else {
                    effect.result_maximum
                }
            );
        }
        let _ = writeln!(text, "];\n");
    }
    let _ = writeln!(
        text,
        "/// What a host does instead of completing a declared effect.\n#[derive(Debug, Clone, PartialEq, Eq)]\npub enum HostError<F> {{\n    /// The effect failed with one of its declared failures.\n    Failed(F),\n    /// The host could not run the effect at all.\n    Fault,\n}}\n"
    );
    for effect in effects {
        module(&mut text, effect);
    }
    let _ = writeln!(
        text,
        "/// The closed sum of effect requests. No other value can be encoded.\n#[derive(Debug, Clone, PartialEq, Eq)]\npub enum Request {{"
    );
    for effect in effects {
        let _ = writeln!(
            text,
            "    {}({}::Request),",
            camel(&effect.name),
            snake(&effect.name)
        );
    }
    let _ = writeln!(text, "}}\n");
    let _ = writeln!(text, "impl Request {{");
    let _ = writeln!(
        text,
        "    /// The wire tag: the position of the effect in the declaration."
    );
    let _ = writeln!(text, "    pub fn tag(&self) -> u32 {{");
    if effects.is_empty() {
        let _ = writeln!(text, "        match *self {{}}");
    } else {
        let _ = writeln!(text, "        match self {{");
        for (index, effect) in effects.iter().enumerate() {
            let _ = writeln!(
                text,
                "            Request::{}(_) => {index},",
                camel(&effect.name)
            );
        }
        let _ = writeln!(text, "        }}");
    }
    let _ = writeln!(text, "    }}\n");
    let _ = writeln!(text, "    /// The declared name of the effect.");
    let _ = writeln!(text, "    pub fn name(&self) -> &'static str {{");
    let _ = writeln!(text, "        EFFECTS[self.tag() as usize]");
    let _ = writeln!(text, "    }}\n");
    let _ = writeln!(
        text,
        "    /// Decode the payload of one effect; a tag that is not declared is refused."
    );
    let _ = writeln!(text, "    #[allow(unused_variables)]");
    let _ = writeln!(
        text,
        "    pub fn decode(tag: u32, payload: &[u8]) -> Result<Request, Refusal> {{"
    );
    let _ = writeln!(text, "        match tag {{");
    for (index, effect) in effects.iter().enumerate() {
        let _ = writeln!(
            text,
            "            {index} => {}::Request::decode(payload).map(Request::{}),",
            snake(&effect.name),
            camel(&effect.name)
        );
    }
    let _ = writeln!(
        text,
        "            _ => Err(Refusal::Undeclared),\n        }}\n    }}\n"
    );
    let _ = writeln!(
        text,
        "    /// The payload that decodes back to this request."
    );
    let _ = writeln!(
        text,
        "    pub fn encode(&self) -> Result<Vec<u8>, Refusal> {{"
    );
    if effects.is_empty() {
        let _ = writeln!(text, "        match *self {{}}");
    } else {
        let _ = writeln!(text, "        match self {{");
        for effect in effects {
            let _ = writeln!(
                text,
                "            Request::{}(request) => request.encode(),",
                camel(&effect.name)
            );
        }
        let _ = writeln!(text, "        }}");
    }
    let _ = writeln!(text, "    }}\n}}\n");
    let _ = writeln!(
        text,
        "/// Check that bytes are an outcome of the effect with this tag.\n#[allow(unused_variables)]\npub fn check_outcome(tag: u32, bytes: &[u8]) -> Result<(), Refusal> {{\n    match tag {{"
    );
    for (index, effect) in effects.iter().enumerate() {
        let _ = writeln!(
            text,
            "        {index} => {}::decode_outcome(bytes).map(|_| ()),",
            snake(&effect.name)
        );
    }
    let _ = writeln!(text, "        _ => Err(Refusal::Undeclared),\n    }}\n}}\n");
    let _ = writeln!(
        text,
        "/// The host binding: one method per declared effect, and two per-request methods\n/// the served driver calls, which do nothing unless a binding overrides them.\npub trait Host {{"
    );
    for effect in effects {
        let name = snake(&effect.name);
        let _ = writeln!(
            text,
            "    fn {name}(&mut self, request: {name}::Request) -> Result<{name}::Completed, HostError<{name}::Failure>>;"
        );
    }
    // Not effects: the core never asks for them, so the effect table, the codecs
    // and the vectors do not change. A binding that observes nothing keeps the
    // defaults, so it compiles unchanged.
    let _ = writeln!(
        text,
        "\n    /// Called once per served request, before the core runs, with the request's number\n    /// in this process and its body. Requests on other connections can begin and end\n    /// in between; the number pairs this call with its `request_end`.\n    fn request_begin(&mut self, id: u64, request: &[u8]) {{\n        let _ = (id, request);\n    }}\n\n    /// Called once per served request, after the answer is written, with the number\n    /// `request_begin` was given, the request body and the answer body. A request the\n    /// adapter refuses has an empty body.\n    fn request_end(&mut self, id: u64, request: &[u8], response: &[u8]) {{\n        let _ = (id, request, response);\n    }}"
    );
    let _ = writeln!(text, "}}\n");
    if effects.is_empty() {
        let _ = writeln!(
            text,
            "/// The host of an application that declares no effect.\n#[derive(Debug, Default, Clone, Copy)]\npub struct Unbound;\n\nimpl Host for Unbound {{}}\n"
        );
    }
    text
}

/// The perform module of the driver crate: the one place where a decoded effect
/// request reaches the host method that runs it.
fn perform(application: &ServerApplication) -> String {
    let effects = &application.host.effects;
    let mut text = String::from(
        "// Generated from the closed host effect declaration. Do not edit.\n\n#[allow(unused_imports)]\nuse crate::failure::Failure;\n#[allow(unused_imports)]\nuse crate::protocol::{self, Host, HostError, Request};\n\n",
    );
    let _ = writeln!(
        text,
        "/// Run a decoded effect through the host and encode its outcome.\n#[allow(unused_variables)]\npub fn perform<H: Host>(host: &mut H, request: Request) -> Result<Vec<u8>, Failure> {{\n    match request {{"
    );
    if effects.is_empty() {
        let _ = writeln!(text, "    }}");
    } else {
        for effect in effects {
            let name = snake(&effect.name);
            let _ = writeln!(
                text,
                "        Request::{}(request) => {{",
                camel(&effect.name)
            );
            let _ = writeln!(
                text,
                "            let outcome = match host.{name}(request) {{"
            );
            let _ = writeln!(text, "                Ok(done) => Ok(done),");
            let _ = writeln!(
                text,
                "                Err(HostError::Failed(failure)) => Err(failure),"
            );
            let _ = writeln!(
                text,
                "                Err(HostError::Fault) => return Err(Failure::HostFault),"
            );
            let _ = writeln!(text, "            }};");
            let _ = writeln!(
                text,
                "            protocol::{name}::encode_outcome(&outcome).map_err(|_| Failure::EffectResultLimit)"
            );
            let _ = writeln!(text, "        }}");
        }
        let _ = writeln!(text, "    }}");
    }
    let _ = writeln!(text, "}}");
    text
}

/// The scripted host: replays recorded outcomes and refuses anything else.
fn script(application: &ServerApplication) -> String {
    let effects = &application.host.effects;
    let mut text = String::from(
        "// Generated from the closed host effect declaration. Do not edit.\n\nuse crate::failure::Failure;\nuse crate::protocol::{self, Host, HostError, Request};\nuse crate::surface;\nuse crate::wire::{put_chunk, put_u32, Reader};\n\n",
    );
    text.push_str(
        r#"/// One scripted effect: its tag, the exact request payload the entry must
/// produce and the outcome the host returns.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Step {
    pub tag: u32,
    pub request: Vec<u8>,
    pub outcome: Vec<u8>,
}

/// Decode a script: steps of `u32 tag, u32 request length, request, u32 outcome
/// length, outcome`, each checked against the declaration.
pub fn parse(bytes: &[u8]) -> Result<Vec<Step>, Failure> {
    let malformed = || Failure::ScriptMalformed;
    let mut reader = Reader::new(bytes);
    let mut steps = Vec::new();
    while !reader.is_empty() {
        if steps.len() >= surface::EFFECT_BUDGET {
            return Err(malformed());
        }
        let tag = reader.u32().map_err(|_| malformed())?;
        let request = reader.chunk().map_err(|_| malformed())?.to_vec();
        let outcome = reader.chunk().map_err(|_| malformed())?.to_vec();
        let index = usize::try_from(tag).map_err(|_| malformed())?;
        if index >= protocol::EFFECTS.len()
            || request.len() > protocol::REQUEST_MAXIMA[index]
            || outcome.len() > protocol::RESULT_MAXIMA[index]
        {
            return Err(malformed());
        }
        Request::decode(tag, &request).map_err(|_| malformed())?;
        protocol::check_outcome(tag, &outcome).map_err(|_| malformed())?;
        steps.push(Step { tag, request, outcome });
    }
    Ok(steps)
}

/// The script bytes of `steps`.
pub fn encode(steps: &[Step]) -> Result<Vec<u8>, Failure> {
    let mut out = Vec::new();
    for step in steps {
        put_u32(&mut out, step.tag);
        put_chunk(&mut out, &step.request).map_err(|_| Failure::ScriptMalformed)?;
        put_chunk(&mut out, &step.outcome).map_err(|_| Failure::ScriptMalformed)?;
    }
    Ok(out)
}

/// A host that performs no effect: it replays `steps` in order and records why
/// it refused when the entry asks for anything else.
#[derive(Debug)]
pub struct ScriptedHost {
    steps: Vec<Step>,
    next: usize,
    cause: Option<Failure>,
}

impl ScriptedHost {
    pub fn new(steps: Vec<Step>) -> Self {
        ScriptedHost { steps, next: 0, cause: None }
    }

    /// Why the host refused, if it did.
    pub fn cause(&self) -> Option<Failure> {
        self.cause
    }

    /// Steps not yet replayed.
    pub fn remaining(&self) -> usize {
        self.steps.len() - self.next
    }

    #[allow(dead_code)]
    fn refuse<E>(&mut self, failure: Failure) -> HostError<E> {
        self.cause = Some(failure);
        HostError::Fault
    }

    #[allow(dead_code)]
    fn advance<E>(&mut self, tag: u32, request: &[u8]) -> Result<Vec<u8>, HostError<E>> {
        let Some(step) = self.steps.get(self.next).cloned() else {
            return Err(self.refuse(Failure::ScriptExhausted));
        };
        if step.tag != tag || step.request != request {
            return Err(self.refuse(Failure::ScriptMismatch));
        }
        self.next += 1;
        Ok(step.outcome)
    }
}

/// Run one exchange against the generated core with a scripted host. Every
/// scripted step must be used.
pub fn run(steps: Vec<Step>, request: &[u8]) -> Result<Vec<u8>, Failure> {
    let mut host = ScriptedHost::new(steps);
    let response = match crate::exchange::exchange(&mut host, request) {
        Ok(response) => response,
        Err(Failure::HostFault) => return Err(host.cause().unwrap_or(Failure::HostFault)),
        Err(other) => return Err(other),
    };
    if host.remaining() != 0 {
        return Err(Failure::ScriptUnused);
    }
    Ok(response)
}

/// Decode `script` and run one exchange with it.
pub fn replay(script: &[u8], request: &[u8]) -> Result<Vec<u8>, Failure> {
    run(parse(script)?, request)
}

"#,
    );
    let _ = writeln!(text, "impl Host for ScriptedHost {{");
    for (index, effect) in effects.iter().enumerate() {
        let name = snake(&effect.name);
        let _ = writeln!(
            text,
            "    fn {name}(&mut self, request: protocol::{name}::Request) -> Result<protocol::{name}::Completed, HostError<protocol::{name}::Failure>> {{"
        );
        let _ = writeln!(
            text,
            "        let encoded = request\n            .encode()\n            .map_err(|_| self.refuse::<protocol::{name}::Failure>(Failure::ScriptMismatch))?;"
        );
        let _ = writeln!(
            text,
            "        let outcome = self.advance::<protocol::{name}::Failure>({index}, &encoded)?;"
        );
        let _ = writeln!(
            text,
            "        match protocol::{name}::decode_outcome(&outcome) {{"
        );
        let _ = writeln!(text, "            Ok(Ok(done)) => Ok(done),");
        let _ = writeln!(
            text,
            "            Ok(Err(failure)) => Err(HostError::Failed(failure)),"
        );
        let _ = writeln!(
            text,
            "            Err(_) => Err(self.refuse(Failure::ScriptMalformed)),"
        );
        let _ = writeln!(text, "        }}\n    }}");
    }
    let _ = writeln!(text, "}}");
    text
}

/// The shared host: one binding behind a lock, which every connection thread
/// uses for the effects it performs. Rendered with one method per declared effect,
/// and the two per-request methods forwarded to the binding.
fn shared(application: &ServerApplication) -> String {
    let effects = &application.host.effects;
    let mut text = String::from(
        "// Generated from the closed host effect declaration. Do not edit.\n\n#[allow(unused_imports)]\nuse crate::protocol::{self, Host, HostError};\nuse std::sync::{Arc, Mutex};\n\n/// One host shared by the threads that serve connections. Each effect takes the lock\n/// for its own duration only, and a poisoned lock is a host fault.\npub struct Shared<H>(pub Arc<Mutex<H>>);\n\nimpl<H> Clone for Shared<H> {\n    fn clone(&self) -> Self {\n        Shared(self.0.clone())\n    }\n}\n\n",
    );
    let _ = writeln!(text, "impl<H: Host> Host for Shared<H> {{");
    for effect in effects {
        let name = snake(&effect.name);
        let _ = writeln!(
            text,
            "    fn {name}(&mut self, request: protocol::{name}::Request) -> Result<protocol::{name}::Completed, HostError<protocol::{name}::Failure>> {{\n        match self.0.lock() {{\n            Ok(mut host) => host.{name}(request),\n            Err(_) => Err(HostError::Fault),\n        }}\n    }}"
        );
    }
    // Shared must forward the per-request calls, or the shared host would keep
    // the defaults and see nothing. A poisoned lock already makes every effect a
    // fault; these calls only observe, so they are skipped then.
    let _ = writeln!(
        text,
        "\n    fn request_begin(&mut self, id: u64, request: &[u8]) {{\n        if let Ok(mut host) = self.0.lock() {{\n            host.request_begin(id, request);\n        }}\n    }}\n\n    fn request_end(&mut self, id: u64, request: &[u8], response: &[u8]) {{\n        if let Ok(mut host) = self.0.lock() {{\n            host.request_end(id, request, response);\n        }}\n    }}"
    );
    let _ = writeln!(text, "}}");
    text
}

/// The sections the host adds to the request frame, rendered in the declared
/// order: one call per effect that supplies a section, then each section's
/// encoding. Model-owned sections are encoded here, at generation.
fn frame(application: &ServerApplication) -> String {
    let mut text = String::from(
        "// Generated from the serving declaration. Do not edit.\n\n#[allow(unused_imports)]\nuse crate::protocol::{self, Host};\nuse crate::refusal::ServingRefusal;\n#[allow(unused_imports)]\nuse crate::wire::{put_chunk, put_u32, put_u64};\n\n/// What the listener knows of the exchange when it asks the host for a section.\npub struct Context<'a> {\n    pub peer: &'a str,\n    pub counted: bool,\n}\n\n#[allow(dead_code)]\nfn unavailable<E>(_: E) -> ServingRefusal {\n    ServingRefusal::FrameUnavailable\n}\n\n",
    );
    let serving = application
        .serving
        .first()
        .expect("the frame module is rendered for a served application");
    let _ = writeln!(
        text,
        "/// The tail of the request frame. A declared effect that fails, or answers with more\n/// than its declared maximum, is `FrameUnavailable`.\n#[allow(unused_variables, unused_mut)]\npub fn sections<H: Host>(host: &mut H, context: &Context<'_>) -> Result<Vec<u8>, ServingRefusal> {{"
    );
    let mut called: Vec<&str> = Vec::new();
    for section in &serving.frame {
        if section.effect.is_empty() || called.contains(&section.effect.as_str()) {
            continue;
        }
        called.push(&section.effect);
        let effect = application
            .host
            .effects
            .iter()
            .find(|effect| effect.name == section.effect)
            .expect("validated frame effect");
        let name = snake(&effect.name);
        let mut request = String::new();
        for field in &effect.request {
            let value = match field.name.as_str() {
                "peer" => "context.peer.to_owned()",
                _ => "context.counted",
            };
            let _ = write!(request, "{}: {value}, ", field.name);
        }
        let _ = writeln!(
            text,
            "    let {name} = host\n        .{name}(protocol::{name}::Request {{ {request}}})\n        .map_err(unavailable)?;"
        );
    }
    let _ = writeln!(text, "    let mut out = Vec::new();");
    for section in &serving.frame {
        if section.effect.is_empty() {
            let mut encoded = Vec::new();
            match section.kind {
                FrameKind::U32 => encoded.extend_from_slice(
                    &section.values[0].parse::<u32>().unwrap_or(0).to_be_bytes(),
                ),
                FrameKind::U64 => encoded.extend_from_slice(
                    &section.values[0].parse::<u64>().unwrap_or(0).to_be_bytes(),
                ),
                FrameKind::Text => {
                    encoded.extend_from_slice(&(section.values[0].len() as u32).to_be_bytes());
                    encoded.extend_from_slice(section.values[0].as_bytes());
                }
                FrameKind::TextList => {
                    encoded.extend_from_slice(&(section.values.len() as u32).to_be_bytes());
                    for value in &section.values {
                        encoded.extend_from_slice(&(value.len() as u32).to_be_bytes());
                        encoded.extend_from_slice(value.as_bytes());
                    }
                }
                FrameKind::Bytes => {}
            }
            let _ = writeln!(
                text,
                "    // {}\n    out.extend_from_slice({});",
                section.name,
                bytes(&encoded)
            );
            continue;
        }
        let name = snake(&section.effect);
        let tag = application
            .host
            .effects
            .iter()
            .position(|effect| effect.name == section.effect)
            .expect("validated frame effect");
        let _ = writeln!(text, "    // {}", section.name);
        match section.kind {
            FrameKind::U32 => {
                let _ = writeln!(text, "    put_u32(&mut out, {name}.{});", section.field);
            }
            FrameKind::U64 => {
                let _ = writeln!(text, "    put_u64(&mut out, {name}.{});", section.field);
            }
            FrameKind::Bytes | FrameKind::Text => {
                let value = if section.kind == FrameKind::Bytes {
                    format!("&{name}.{}", section.field)
                } else {
                    format!("{name}.{}.as_bytes()", section.field)
                };
                let length = format!("{name}.{}.len()", section.field);
                let _ = writeln!(
                    text,
                    "    if {length} > protocol::RESULT_MAXIMA[{tag}] {{\n        return Err(ServingRefusal::FrameUnavailable);\n    }}\n    put_chunk(&mut out, {value}).map_err(unavailable)?;"
                );
            }
            FrameKind::TextList => {}
        }
    }
    let _ = writeln!(text, "    Ok(out)\n}}");
    text
}

/// Rust spelling of a list of string literals.
fn literals(values: &[String]) -> String {
    format!(
        "&[{}]",
        values
            .iter()
            .map(|value| literal(value))
            .collect::<Vec<_>>()
            .join(", ")
    )
}

/// The serving constants of the generated surface.
fn serving_surface(application: &ServerApplication) -> String {
    let Some(serving) = application.serving.first() else {
        return String::new();
    };
    let octets = serving
        .address
        .split('.')
        .map(|part| part.parse::<u8>().unwrap_or(0).to_string())
        .collect::<Vec<_>>()
        .join(", ");
    let origins = serving
        .origins
        .iter()
        .map(|origin| {
            format!(
                "({}, {}, {})",
                literal(&origin.scheme),
                literal(&origin.host),
                origin.port
            )
        })
        .collect::<Vec<_>>()
        .join(", ");
    let mut text = String::new();
    let _ = writeln!(text, "\n// The serving declaration.");
    let _ = writeln!(text, "pub const ADDRESS: [u8; 4] = [{octets}];");
    let _ = writeln!(text, "pub const PORT: u16 = {};", serving.port);
    let _ = writeln!(
        text,
        "pub const CONNECTION_MAXIMUM: usize = {};",
        serving.connection_maximum
    );
    let _ = writeln!(
        text,
        "pub const READ_TIMEOUT_MILLIS: u32 = {};",
        serving.read_timeout_millis
    );
    let _ = writeln!(
        text,
        "pub const ROOT_STACK_BYTES: usize = {};",
        serving.root_stack_bytes
    );
    let _ = writeln!(
        text,
        "pub const REQUEST_LINE_MAXIMUM: usize = {};",
        serving.request_line_maximum
    );
    let _ = writeln!(
        text,
        "pub const HEADER_COUNT_MAXIMUM: usize = {};",
        serving.header_count_maximum
    );
    let _ = writeln!(
        text,
        "pub const HEADER_BYTES_MAXIMUM: usize = {};",
        serving.header_bytes_maximum
    );
    let _ = writeln!(
        text,
        "pub const BODY_MAXIMUM: usize = {};",
        serving.body_maximum
    );
    let _ = writeln!(
        text,
        "pub const ORIGINS: &[(&str, &str, u16)] = &[{origins}];"
    );
    let _ = writeln!(
        text,
        "pub const ACCEPT: &[&str] = {};",
        literals(&serving.accept)
    );
    let _ = writeln!(
        text,
        "pub const CONTENT_TYPES: &[&str] = {};",
        literals(&serving.content_types)
    );
    let _ = writeln!(
        text,
        "pub const ENFORCED_METHODS: &[&str] = {};",
        literals(&serving.enforced_methods)
    );
    let _ = writeln!(
        text,
        "pub const COUNTED_FIELD: &str = {};",
        literal(&serving.counted_field)
    );
    let _ = writeln!(
        text,
        "pub const COUNTED_VALUE: &str = {};",
        literal(&serving.counted_value)
    );
    text
}

/// The raw HTTP exchanges of the acceptance.
fn served_corpus(application: &ServerApplication) -> String {
    let Some(serving) = application.serving.first() else {
        return String::new();
    };
    let mut text = String::from(
        "\n/// An HTTP exchange of the acceptance: the request bytes a client sends, the\n/// frame vector the core is given and answers, and the response bytes expected.\npub struct Served {\n    pub vector: usize,\n    pub request: &'static [u8],\n    pub response: &'static [u8],\n}\n\npub const SERVED: &[Served] = &[\n",
    );
    for vector in &serving.vectors {
        let _ = writeln!(
            text,
            "    Served {{ vector: {}, request: {}, response: {} }},",
            vector.vector,
            bytes(&vector.request),
            bytes(&vector.response)
        );
    }
    text.push_str("];\n");
    text
}

fn paragraph(text: &str) -> &str {
    text.trim_end_matches('\n')
}

/// The complete `--help` text, derived only from model strings and bounds.
#[must_use]
pub fn help(application: &ServerApplication) -> String {
    let binary = program_name(application);
    let host = &application.host;
    let run = if application.bindings.is_empty() {
        String::new()
    } else {
        format!("    {binary} run [FILE]\n")
    };
    let serve = if application.serving.is_empty() {
        String::new()
    } else {
        format!("    {binary} serve\n")
    };
    let mut text = format!(
        "{} {}\n\n{}\n\nUSAGE\n    {binary} exchange SCRIPT [FILE]\n{run}{serve}    {binary} --help\n    {binary} --version\n\nINPUT\n    FILE holds the request and is read as raw bytes, at most {} of them.\n    Without FILE, or when FILE is -, the request is read from standard input.\n    The response is written to standard output unchanged, at most {} bytes.\n    SCRIPT holds the host's outcomes, at most {} bytes. Each step is a 32-bit\n    big-endian effect tag, then the length and bytes of the encoded request the\n    entry must produce, then the length and bytes of the encoded outcome. The\n    program replays one step for every effect the entry requests, at most {}.\n",
        application.name,
        application.cargo_version,
        paragraph(&host.description),
        application.request_maximum,
        application.response_maximum,
        application.script_maximum(),
        host.effect_budget,
    );
    if let Some(binding) = application.bindings.first() {
        let _ = write!(
            text,
            "\nRUN\n    `run` reads the request as `exchange` does and performs each effect the entry\n    requests through the host binding {} ({}), with no script.\n",
            binding.crate_name, binding.host
        );
    }
    if let Some(serving) = application.serving.first() {
        let _ = write!(
            text,
            "\nSERVE\n    `serve` listens on {}:{} and answers one HTTP/1.1 request per connection\n    through the core. The first line on standard output says where it listens\n    (port 0: the system chooses). It runs until it is stopped.\n    At most {} connections, each served within {} ms; a request line of at most\n    {} bytes, at most {} field lines in at most {} bytes and a body of at most\n    {} bytes. Refusals made before the core is called are 400, 403, 406, 408,\n    413, 414, 415, 417, 431, 501, 503 and 505.\n",
            serving.address,
            serving.port,
            serving.connection_maximum,
            serving.read_timeout_millis,
            serving.request_line_maximum,
            serving.header_count_maximum,
            serving.header_bytes_maximum,
            serving.body_maximum,
        );
    }
    if !host.effects.is_empty() {
        text.push_str("\nEFFECTS\n");
        for (index, effect) in host.effects.iter().enumerate() {
            let role = if application.frame_effects().contains(effect.name.as_str()) {
                "  (fills the request frame)"
            } else {
                ""
            };
            let _ = writeln!(
                text,
                "    {index:>3}  {}  request at most {} bytes, outcome at most {} bytes{role}",
                effect.name, effect.request_maximum, effect.result_maximum
            );
        }
    }
    let rows = [
        (host.usage_code, "usage", "invalid command line"),
        (host.io_code, "io", "input or output failure"),
        (
            host.fault_code,
            "fault",
            "a limit, an undeclared or malformed effect, or a host or script failure",
        ),
    ];
    let mut rows = rows.to_vec();
    rows.sort_by_key(|row| row.0);
    text.push_str("\nEXIT CODES\n");
    for (code, name, meaning) in rows {
        let _ = writeln!(text, "    {code:>3}  {name:<5}  {meaning}");
    }
    text
}

/// Generated constants consumed by the fixed template.
fn surface(application: &ServerApplication) -> String {
    let host = &application.host;
    let mut text =
        String::from("// Generated from the closed host effect declaration. Do not edit.\n\n");
    let _ = writeln!(
        text,
        "pub const PROTOCOL: &str = {};",
        literal(&host.protocol)
    );
    let _ = writeln!(
        text,
        "pub const BINARY: &str = {};",
        literal(&program_name(application))
    );
    let _ = writeln!(
        text,
        "pub const VERSION: &str = {};",
        literal(&format!(
            "{} {}\n",
            program_name(application),
            application.cargo_version
        ))
    );
    let _ = writeln!(
        text,
        "pub const HELP: &str = {};",
        literal(&help(application))
    );
    let _ = writeln!(
        text,
        "pub const REQUEST_MAXIMUM: usize = {};",
        application.request_maximum
    );
    let _ = writeln!(
        text,
        "pub const RESPONSE_MAXIMUM: usize = {};",
        application.response_maximum
    );
    let _ = writeln!(
        text,
        "pub const EFFECT_BUDGET: usize = {};",
        host.effect_budget
    );
    let _ = writeln!(
        text,
        "pub const STEP_MAXIMUM: usize = {};",
        application.step_maximum()
    );
    let _ = writeln!(
        text,
        "pub const SCRIPT_MAXIMUM: usize = {};",
        application.script_maximum()
    );
    let _ = writeln!(text, "pub const USAGE_CODE: u8 = {};", host.usage_code);
    let _ = writeln!(text, "pub const IO_CODE: u8 = {};", host.io_code);
    let _ = writeln!(text, "pub const FAULT_CODE: u8 = {};", host.fault_code);
    text.push_str(&serving_surface(application));
    text
}

/// The acceptance corpus: exchange vectors and the effects each one performs.
fn corpus(application: &ServerApplication) -> String {
    let mut text = String::from(
        "// Generated from the acceptance vectors and transcripts. Do not edit.\n\nuse crate::script::Step;\n\n/// A request and the response the entry must produce for it.\npub struct Vector {\n    pub request: &'static [u8],\n    pub response: &'static [u8],\n}\n\n/// One recorded effect of a transcript.\npub struct Recorded {\n    pub tag: u32,\n    pub request: &'static [u8],\n    pub outcome: &'static [u8],\n}\n\n/// The effects the entry must request for one vector, in order.\npub struct Transcript {\n    pub vector: usize,\n    pub steps: &'static [Recorded],\n}\n\n",
    );
    text.push_str("pub const VECTORS: &[Vector] = &[\n");
    for vector in &application.acceptance_vectors {
        let _ = writeln!(
            text,
            "    Vector {{ request: {}, response: {} }},",
            bytes(&vector.request),
            bytes(&vector.response)
        );
    }
    text.push_str("];\n\npub const TRANSCRIPTS: &[Transcript] = &[\n");
    for transcript in &application.host.transcripts {
        let _ = writeln!(
            text,
            "    Transcript {{ vector: {}, steps: &[",
            transcript.vector
        );
        for step in &transcript.steps {
            let tag = application
                .host
                .effects
                .iter()
                .position(|effect| effect.name == step.effect)
                .unwrap_or(usize::MAX);
            let _ = writeln!(
                text,
                "        Recorded {{ tag: {tag}, request: {}, outcome: {} }},",
                bytes(&step.request),
                bytes(&step.outcome)
            );
        }
        text.push_str("    ] },\n");
    }
    text.push_str(
        "];\n\n/// The script of a vector: its transcript, or nothing when the entry performs no effect.\npub fn steps(vector: usize) -> Vec<Step> {\n    TRANSCRIPTS\n        .iter()\n        .filter(|transcript| transcript.vector == vector)\n        .flat_map(|transcript| transcript.steps)\n        .map(|step| Step {\n            tag: step.tag,\n            request: step.request.to_vec(),\n            outcome: step.outcome.to_vec(),\n        })\n        .collect()\n}\n",
    );
    text.push_str(&served_corpus(application));
    text
}

const API_LIBRARY: &str = "// Generated host API of a server application. Do not edit.\n#![forbid(unsafe_code)]\n\npub mod protocol;\npub mod wire;\n";

fn library(application: &ServerApplication) -> String {
    let served = !application.serving.is_empty();
    let modules = if served {
        "pub mod acceptance;\npub mod exchange;\npub mod failure;\npub mod frame;\npub mod perform;\npub mod refusal;\npub mod script;\npub mod serve;\npub mod shared;\npub mod surface;\n"
    } else {
        "pub mod acceptance;\npub mod exchange;\npub mod failure;\npub mod perform;\npub mod script;\npub mod surface;\n"
    };
    format!(
        "// Generated host adapter of a server application. Do not edit.\n#![forbid(unsafe_code)]\n\n{modules}\npub use failure::{{Failure, FailureClass}};\npub use {api}::{{protocol, wire}};\n",
        api = api_library_name(application),
    )
}

/// Render the two Cargo packages of the host adapter, as files relative to the
/// consumer's workspace root: the API package in `{cargo_name}-host-api/` and
/// the driver package, library and program, in `{cargo_name}-host/`.
///
/// Both are members of the consumer's workspace, which owns the release profile.
/// The driver depends on the API package and on the declared binding, at its
/// declared workspace path; the binding depends on the API package.
///
/// # Errors
/// Returns `PP2013` when the declaration is invalid.
pub fn generate(application: &ServerApplication) -> Result<GeneratedPackage, PrismError> {
    validate(application)?;
    let api = api_name(application);
    let name = program_name(application);
    let package = |name: &str, dependencies: &str, program: bool| {
        format!(
            "[package]\nname = \"{name}\"\nversion = \"{version}\"\nedition = \"2021\"\npublish = false\n\n[lib]\npath = \"src/lib.rs\"\n\n{program}[dependencies]\n{dependencies}",
            version = application.cargo_version,
            program = if program {
                format!("[[bin]]\nname = \"{name}\"\npath = \"src/main.rs\"\n\n")
            } else {
                String::new()
            },
        )
    };
    // The production package is laid out beside the generated ones, as a member of
    // the same workspace, under the name of its crate.
    let mut dependencies = format!(
        "{core} = {{ path = \"../{core}\" }}\n{api} = {{ path = \"../{api}\" }}\n",
        core = core(application),
    );
    for binding in &application.bindings {
        let _ = writeln!(
            dependencies,
            "{} = {{ path = \"../{}\" }}",
            binding.crate_name, binding.path
        );
    }
    let host = library_name(application);
    let exchange = EXCHANGE.replace("@CORE@", core(application));
    let main = MAIN
        .replace("@INPUT_ADAPTER@", INPUT_ADAPTER)
        .replace("@HOST@", &host)
        .replace(
            "@BINDING_HOST@",
            application
                .bindings
                .first()
                .map_or("", |binding| binding.host.as_str()),
        );
    let served = !application.serving.is_empty();
    let main = main.replace("@SERVE_HOST@", &serve_host(application));
    let main = section(&main, "BINDING", !application.bindings.is_empty());
    let main = section(&main, "SERVING", served);
    let tests = TESTS.replace("@HOST@", &host).replace(
        "@BINDING_HOST@",
        application
            .bindings
            .first()
            .map_or("", |binding| binding.host.as_str()),
    );
    let tests = section(&tests, "BINDING", !application.bindings.is_empty());
    let mut files = vec![
        (format!("{api}/Cargo.toml"), package(&api, "", false)),
        (format!("{api}/src/lib.rs"), API_LIBRARY.to_owned()),
        (format!("{api}/src/wire.rs"), WIRE.to_owned()),
        (format!("{api}/src/protocol.rs"), protocol(application)),
        (
            format!("{name}/Cargo.toml"),
            package(&name, &dependencies, true),
        ),
        (format!("{name}/src/lib.rs"), library(application)),
        (format!("{name}/src/failure.rs"), FAILURE.to_owned()),
        (format!("{name}/src/exchange.rs"), exchange),
        (format!("{name}/src/perform.rs"), perform(application)),
        (format!("{name}/src/surface.rs"), surface(application)),
        (format!("{name}/src/script.rs"), script(application)),
        (format!("{name}/src/acceptance.rs"), corpus(application)),
        (format!("{name}/src/main.rs"), main),
        (format!("{name}/tests/acceptance.rs"), tests),
    ];
    if served {
        let serving_tests = SERVING_TESTS.replace("@HOST@", &host).replace(
            "@BINDING_HOST@",
            &application.bindings.first().map_or_else(
                || format!("{host}::protocol::Unbound"),
                |binding| binding.host.clone(),
            ),
        );
        files.extend([
            (format!("{name}/src/frame.rs"), frame(application)),
            (format!("{name}/src/refusal.rs"), REFUSAL.to_owned()),
            (format!("{name}/src/serve.rs"), SERVE.to_owned()),
            (format!("{name}/src/shared.rs"), shared(application)),
            (format!("{name}/tests/serving.rs"), serving_tests),
        ]);
    }
    Ok(GeneratedPackage {
        files: files
            .into_iter()
            .map(|(path, text)| PackageFile {
                path,
                bytes: text.into_bytes(),
            })
            .collect(),
    })
}

/// Keep or drop the lines between `//@MARKER-BEGIN` and `//@MARKER-END`: the
/// `BINDING` lines exist only for an application whose effects are served by a
/// binding, the `SERVING` lines only for a served application. The marker lines
/// themselves never survive.
fn section(template: &str, marker: &str, keep: bool) -> String {
    let (begin, end) = (format!("//@{marker}-BEGIN"), format!("//@{marker}-END"));
    let mut inside = false;
    let mut out = String::new();
    for line in template.split_inclusive('\n') {
        let trimmed = line.trim();
        if trimmed == begin {
            inside = true;
        } else if trimmed == end {
            inside = false;
        } else if !(inside && !keep) {
            out.push_str(line);
        }
    }
    out
}

/// The expression that makes the host `serve` runs the core with: the declared
/// binding, or the host of an application that declares no effect.
fn serve_host(application: &ServerApplication) -> String {
    application.bindings.first().map_or_else(
        || format!("{}::protocol::Unbound", library_name(application)),
        |binding| format!("<{} as Default>::default()", binding.host),
    )
}
