//! Closed source-owned declaration of a server application and its host effects.

use super::super::model_document::ApplicationAcceptanceVector;
use serde::{Deserialize, Serialize};

/// Server application profile: a native LexLean production core that
/// requests a closed, typed set of host effects. Nothing here grants an effect.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerApplication {
    /// Exact profile discriminator.
    pub profile: String,
    /// Human-readable package name.
    pub name: String,
    /// Generated Cargo package name of the application core.
    pub cargo_name: String,
    /// Exact stable Cargo version.
    pub cargo_version: String,
    /// Bounded package description.
    pub cargo_description: String,
    /// HTTPS source repository metadata.
    pub cargo_repository: String,
    /// HTTPS homepage metadata, not a runtime network permission.
    pub cargo_homepage: String,
    /// The LexLean production package that is the pure entry of the application.
    pub core: ServerCore,
    /// Finite exchange vectors: one request in, one response out.
    pub acceptance_vectors: Vec<ApplicationAcceptanceVector>,
    /// Maximum request bytes of one exchange.
    pub request_maximum: u32,
    /// Maximum response bytes of one exchange.
    pub response_maximum: u32,
    /// The host binding crate: empty exactly when no effect is declared, else one.
    pub bindings: Vec<ServerBinding>,
    /// How the application is served over loopback HTTP: empty when it is not
    /// served, else one record.
    pub serving: Vec<ServerServing>,
    /// Seconds that the build of the consumer's workspace may take when the
    /// application is verified, from 1 to 7200.
    pub verify_build_timeout_seconds: u32,
    /// The host effect protocol of the core.
    pub host: HostProtocol,
}

/// The core of a server application: a LexLean production root exported as a
/// certified `rust-std` package whose `run` takes the turn as `Bytes` and
/// returns the step as `List<u64>` or fails with `Overflow`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerCore {
    /// Fully qualified Lean name of the production root.
    pub root: String,
    /// Lowercase snake-case crate name of the exported package.
    pub package: String,
    /// Exported package version: three canonical decimals.
    pub version: String,
}

/// The binding crate that implements the generated host trait: a member of the
/// consumer's own Cargo workspace, named by its path, never discovered.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerBinding {
    /// Directory of the crate, relative to the workspace root, `/`-separated,
    /// with no `.` or `..` component.
    pub path: String,
    /// Package name in the crate's own manifest.
    pub crate_name: String,
    /// Rust path of the type in that crate that implements the host trait and
    /// `Default`; its first segment is the crate's library name.
    pub host: String,
}

/// The closed host effect protocol and the process surface of its program.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostProtocol {
    /// Exact versioned protocol discriminator.
    pub protocol: String,
    /// Purpose paragraph printed first by `--help`.
    pub description: String,
    /// Exit status of every usage failure.
    pub usage_code: u8,
    /// Exit status of every input or output failure.
    pub io_code: u8,
    /// Exit status of every fault: limits, refusals, host and script failures.
    pub fault_code: u8,
    /// Most effects one exchange may perform; zero exactly when no effect is declared.
    pub effect_budget: u32,
    /// The closed sum of effects; an effect's wire tag is its position.
    pub effects: Vec<HostEffect>,
    /// Effect scripts of acceptance vectors, by vector index.
    pub transcripts: Vec<HostTranscript>,
}

/// The loopback HTTP/1.1 surface of a served application. Every bound the
/// generated listener acts on is a field here, never a constant of the generator.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServerServing {
    /// Listener address: exactly `127.0.0.1`.
    pub address: String,
    /// Listener port, 0 to 65535; 0 lets the system choose one.
    pub port: u32,
    /// Most connections served at the same time; the next is refused with 503.
    pub connection_maximum: u32,
    /// Milliseconds a request may take to arrive in full.
    pub read_timeout_millis: u32,
    /// Stack bytes of the thread that serves one connection and runs the core.
    pub root_stack_bytes: u32,
    /// Most bytes of the request line.
    pub request_line_maximum: u32,
    /// Most field lines of a request, trailers included.
    pub header_count_maximum: u32,
    /// Most bytes of the field lines of a request, trailers included.
    pub header_bytes_maximum: u32,
    /// Most bytes of the decoded request body.
    pub body_maximum: u32,
    /// The `Origin` values a request may carry; a request without one is not judged.
    pub origins: Vec<ServingOrigin>,
    /// Media types the `Accept` fields of a checked request must list.
    pub accept: Vec<String>,
    /// Media types of which the `Content-Type` of a checked request is one.
    pub content_types: Vec<String>,
    /// Request methods the `Accept` and `Content-Type` requirements apply to.
    pub enforced_methods: Vec<String>,
    /// Name of the request field whose exact value marks a counted request, or empty.
    pub counted_field: String,
    /// The value of that field that marks a counted request, or empty.
    pub counted_value: String,
    /// The host-provided sections that follow the body in the request frame, in order.
    pub frame: Vec<FrameSection>,
    /// Raw HTTP exchanges of the acceptance over a socket.
    pub vectors: Vec<ServedVector>,
}

/// One allowed `Origin`: scheme, host and port (0 for any port).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServingOrigin {
    /// `http` or `https`.
    pub scheme: String,
    /// Lowercase host name or bracketed IPv6 literal.
    pub host: String,
    /// Port, 1 to 65535, or 0 for any port.
    pub port: u32,
}

/// Value kinds of a frame section.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum FrameKind {
    /// Unsigned 32-bit big-endian integer.
    U32,
    /// Unsigned 64-bit big-endian integer.
    U64,
    /// Opaque bytes with a 32-bit length prefix.
    Bytes,
    /// UTF-8 text with a 32-bit length prefix.
    Text,
    /// A 32-bit count, then each text with a 32-bit length prefix.
    TextList,
}

/// A host-provided section of the request frame. It comes either from a result
/// field of a declared host effect (`effect` and `field`) or from model data
/// (`values`), never both.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FrameSection {
    /// Lowercase snake-case name of the section.
    pub name: String,
    /// Encoding of the section.
    pub kind: FrameKind,
    /// Declared host effect whose result supplies the section, or empty.
    pub effect: String,
    /// Result field of that effect, or empty.
    pub field: String,
    /// Model-owned values: one for a scalar or text, any number for a list.
    pub values: Vec<String>,
}

/// A raw HTTP exchange of the acceptance: the request bytes a client sends, the
/// response bytes the program must return, and the frame vector the core must be
/// given and answer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ServedVector {
    /// Index into `acceptance_vectors`: the frame the adapter must give the core.
    pub vector: u32,
    /// The HTTP request bytes.
    pub request: Vec<u8>,
    /// The HTTP response bytes.
    pub response: Vec<u8>,
}

/// Value kinds of effect requests and results.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum HostKind {
    /// Unsigned 32-bit big-endian integer.
    U32,
    /// Unsigned 64-bit big-endian integer.
    U64,
    /// One byte, zero or one.
    Flag,
    /// Opaque bytes with a 32-bit length prefix.
    Bytes,
    /// UTF-8 text with a 32-bit length prefix.
    Text,
}

/// A named, typed field of an effect request or result.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostField {
    /// Lowercase snake-case field name.
    pub name: String,
    /// Value kind.
    pub kind: HostKind,
}

/// One declared effect: typed request, typed result, closed failures and bounds.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostEffect {
    /// Unique dotted lowercase name, for example `store.get`.
    pub name: String,
    /// Request fields in wire order.
    pub request: Vec<HostField>,
    /// Result fields in wire order.
    pub result: Vec<HostField>,
    /// Closed failure names; a failure's wire index is its position.
    pub failures: Vec<String>,
    /// Largest encoded request payload in bytes.
    pub request_maximum: u32,
    /// Largest encoded outcome (status word, then result or failure) in bytes.
    pub result_maximum: u32,
}

/// The effects the core must request for one acceptance vector, in order.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostTranscript {
    /// Index into `acceptance_vectors`.
    pub vector: u32,
    /// The requested effects and the host's outcome for each.
    pub steps: Vec<HostStep>,
}

/// One scripted effect: the expected encoded request and the encoded outcome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct HostStep {
    /// Declared effect name.
    pub effect: String,
    /// Encoded request payload the root must produce.
    pub request: Vec<u8>,
    /// Encoded outcome the host returns.
    pub outcome: Vec<u8>,
}

impl HostEffect {
    /// Smallest encoded size of a record of `fields`.
    pub fn minimum_size(fields: &[HostField]) -> u64 {
        fields
            .iter()
            .map(|field| match field.kind {
                HostKind::U32 | HostKind::Bytes | HostKind::Text => 4,
                HostKind::U64 => 8,
                HostKind::Flag => 1,
            })
            .sum()
    }
}

impl ServerApplication {
    /// Effects the host performs to fill a section of the request frame. The core
    /// cannot request them, and they do not make the application speak the turn
    /// protocol.
    pub fn frame_effects(&self) -> std::collections::BTreeSet<&str> {
        self.serving
            .iter()
            .flat_map(|serving| &serving.frame)
            .filter(|section| !section.effect.is_empty())
            .map(|section| section.effect.as_str())
            .collect()
    }

    /// Effects the core may request, in declaration order.
    pub fn core_effects(&self) -> impl Iterator<Item = &HostEffect> {
        let frame = self.frame_effects();
        self.host
            .effects
            .iter()
            .filter(move |effect| !frame.contains(effect.name.as_str()))
    }

    /// Whether the core speaks the turn and step protocol: it may request an effect.
    pub fn performs_effects(&self) -> bool {
        self.core_effects().next().is_some()
    }

    /// Longest step the entry may return: the done or perform word, a tag, and
    /// the larger of the response and any effect request the core may make.
    pub fn step_maximum(&self) -> u64 {
        let request = self
            .core_effects()
            .map(|effect| u64::from(effect.request_maximum))
            .max()
            .unwrap_or(0);
        8 + u64::from(self.response_maximum).max(request)
    }

    /// Largest input the core can be given: the request alone without
    /// effects, otherwise the largest turn.
    pub fn input_maximum(&self) -> u64 {
        if self.performs_effects() {
            self.turn_maximum()
        } else {
            u64::from(self.request_maximum)
        }
    }

    /// Largest turn the core can be given: the request, the effect count
    /// and the most results the budget allows. Meaningful only with core effects.
    pub fn turn_maximum(&self) -> u64 {
        let result = self
            .core_effects()
            .map(|effect| u64::from(effect.result_maximum))
            .max()
            .unwrap_or(0);
        u64::from(self.request_maximum) + 8 + u64::from(self.host.effect_budget) * (8 + result)
    }

    /// Largest replay script of the effect budget: per step, the effect tag, two
    /// lengths, the request and the outcome. Meaningful only with core effects.
    pub fn script_maximum(&self) -> u64 {
        let step = self
            .core_effects()
            .map(|effect| 12 + u64::from(effect.request_maximum) + u64::from(effect.result_maximum))
            .max()
            .unwrap_or(0);
        u64::from(self.host.effect_budget) * step
    }
}
