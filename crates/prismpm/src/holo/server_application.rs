//! Source projection and validation of the closed server application
//! declaration and its host effect protocol.
//!
//! Declaration acceptance is not execution: the generated host package and its
//! acceptance run (`crate::server_host`) are separate obligations.

mod model;
pub mod serving;
mod source;
pub mod wire;

pub use model::{
    FrameKind, FrameSection, HostEffect, HostField, HostKind, HostProtocol, HostStep,
    HostTranscript, ServedVector, ServerApplication, ServerBinding, ServerCore, ServerServing,
    ServingOrigin,
};

use crate::error::PrismError;
use lexlean::SemanticSnapshot;
use std::collections::BTreeSet;

pub(super) use source::project;

/// Exact source namespace owning this declaration.
pub const MODULE: &str = "Foundation.Server.V1.Model";
/// Explicit server application profile, never a portable-profile alias.
pub const PROFILE: &str = "prismpm/server-application/1";
/// Versioned effect protocol between the core and its host.
pub const PROTOCOL: &str = "prismpm/host-effects/1";

/// Most effects a server application may declare.
pub const MAXIMUM_EFFECTS: usize = 64;
/// Most fields in one request or result record.
pub const MAXIMUM_FIELDS: usize = 32;
/// Most failures one effect may declare.
pub const MAXIMUM_FAILURES: usize = 32;
/// Most effects one exchange may perform.
pub const MAXIMUM_BUDGET: u32 = 256;
/// Largest encoded request or outcome of one effect.
pub const MAXIMUM_EFFECT_BYTES: u32 = 16 * 1024 * 1024;
/// Largest request or response of one exchange.
pub const MAXIMUM_EXCHANGE_BYTES: u32 = 64 * 1024 * 1024;
/// Largest exit status a program may declare; larger ones are shell-reserved.
pub const MAXIMUM_EXIT_CODE: u8 = 125;
/// Most acceptance vectors.
pub const MAXIMUM_VECTORS: usize = 256;
/// Most seconds the verification may give the build of the consumer's workspace.
pub const MAXIMUM_BUILD_TIMEOUT_SECONDS: u32 = 7200;
/// Most bytes of vectors and transcripts together.
pub const MAXIMUM_CORPUS_BYTES: usize = 256 * 1024;

const KEYWORDS: &[&str] = &[
    "as", "break", "const", "continue", "crate", "else", "enum", "extern", "false", "fn", "for",
    "if", "impl", "in", "let", "loop", "match", "mod", "move", "mut", "pub", "ref", "return",
    "self", "static", "struct", "super", "trait", "true", "type", "unsafe", "use", "where",
    "while", "async", "await", "dyn", "abstract", "become", "box", "do", "final", "macro",
    "override", "priv", "typeof", "unsized", "virtual", "yield", "try", "gen",
];

/// Module spellings the generated package keeps for itself or for paths it names.
const RESERVED: &[&str] = &["failure", "std", "core", "alloc"];

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2013", message)
}

fn segment(value: &str, lead: fn(u8) -> bool) -> bool {
    !value.is_empty() && value.as_bytes()[0].is_ascii_lowercase() && value.bytes().all(lead)
}

/// Dotted lowercase effect name: `store`, `store.get`, `verify.start`.
pub fn effect_name(value: &str) -> bool {
    value.len() <= 64
        && value.split('.').all(|part| {
            segment(part, |byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit()
            })
        })
        && !KEYWORDS.contains(&snake(value).as_str())
        && !RESERVED.contains(&snake(value).as_str())
}

/// Field name: lowercase letters, digits and inner underscores.
pub fn field_name(value: &str) -> bool {
    value.len() <= 32
        && segment(value, |byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
        })
        && !value.ends_with('_')
        && !value.contains("__")
        && !KEYWORDS.contains(&value)
}

/// Failure name: hyphen-separated lowercase words.
pub fn failure_name(value: &str) -> bool {
    value.len() <= 32
        && value.split('-').all(|part| {
            segment(part, |byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit()
            })
        })
        && camel(value) != "Self"
}

/// Rust method and module spelling of an effect name.
pub fn snake(name: &str) -> String {
    name.replace('.', "_")
}

/// Rust type-name spelling of an effect or failure name.
pub fn camel(name: &str) -> String {
    name.split(['.', '-'])
        .map(|part| {
            let mut characters = part.chars();
            characters.next().map_or_else(String::new, |first| {
                first.to_ascii_uppercase().to_string() + characters.as_str()
            })
        })
        .collect()
}

fn block(value: &str, maximum: usize) -> bool {
    !value.trim().is_empty()
        && value.len() <= maximum
        && value
            .chars()
            .all(|character| character == '\n' || !character.is_control())
}

fn record(fields: &[HostField]) -> bool {
    let mut names = BTreeSet::new();
    fields.len() <= MAXIMUM_FIELDS
        && fields
            .iter()
            .all(|field| field_name(&field.name) && names.insert(field.name.as_str()))
}

fn effect(effect: &HostEffect) -> Result<(), PrismError> {
    if !effect_name(&effect.name) {
        return Err(invalid(
            "host effect names are dotted lowercase words that are not Rust keywords",
        ));
    }
    if !record(&effect.request) || !record(&effect.result) {
        return Err(invalid(
            "host effect requests and results need at most 32 uniquely named fields",
        ));
    }
    let mut failures = BTreeSet::new();
    if effect.failures.len() > MAXIMUM_FAILURES
        || effect
            .failures
            .iter()
            .any(|name| !failure_name(name) || !failures.insert(name.as_str()))
    {
        return Err(invalid(
            "host effect failures need at most 32 unique hyphenated lowercase names",
        ));
    }
    let completed = 4 + HostEffect::minimum_size(&effect.result);
    let smallest_outcome = if effect.failures.is_empty() {
        completed
    } else {
        completed.min(8)
    };
    if effect.request_maximum == 0
        || effect.request_maximum > MAXIMUM_EFFECT_BYTES
        || effect.result_maximum > MAXIMUM_EFFECT_BYTES
        || u64::from(effect.request_maximum) < HostEffect::minimum_size(&effect.request)
        || u64::from(effect.result_maximum) < smallest_outcome
        || (!effect.failures.is_empty() && effect.result_maximum < 8)
    {
        return Err(invalid(
            "host effect byte bounds must admit at least the smallest request and outcome",
        ));
    }
    Ok(())
}

/// Validate the closed declaration independently of source loading.
pub fn validate(value: &ServerApplication) -> Result<(), PrismError> {
    // Share established package syntax without sharing application profile semantics.
    let package = super::model_document::ModelLibrary {
        profile: "prismpm/native-library/1".into(),
        name: value.name.clone(),
        cargo_name: value.cargo_name.clone(),
        cargo_version: value.cargo_version.clone(),
        cargo_description: value.cargo_description.clone(),
        cargo_repository: value.cargo_repository.clone(),
        cargo_homepage: value.cargo_homepage.clone(),
        export_roots: vec![value.core.root.clone()],
        acceptance_roots: vec![value.core.root.clone()],
    };
    super::library::validate(&package)
        .map_err(|_| invalid("server application package or root syntax is invalid"))?;
    core(value)?;
    bindings(value)?;
    let host = &value.host;
    if value.profile != PROFILE
        || host.protocol != PROTOCOL
        || value.request_maximum == 0
        || value.request_maximum > MAXIMUM_EXCHANGE_BYTES
        || value.response_maximum == 0
        || value.response_maximum > MAXIMUM_EXCHANGE_BYTES
    {
        return Err(invalid(
            "server application profile, protocol or exchange bounds are invalid",
        ));
    }
    if value.verify_build_timeout_seconds == 0
        || value.verify_build_timeout_seconds > MAXIMUM_BUILD_TIMEOUT_SECONDS
    {
        return Err(invalid(
            "server application verification build bound must be from 1 to 7200 seconds",
        ));
    }
    if !block(&host.description, 4096) {
        return Err(invalid(
            "server application description must be bounded text without control characters",
        ));
    }
    let codes = BTreeSet::from([host.usage_code, host.io_code, host.fault_code]);
    if codes.len() != 3
        || codes
            .iter()
            .any(|code| *code == 0 || *code > MAXIMUM_EXIT_CODE)
    {
        return Err(invalid(
            "server application usage, I/O and fault exit codes must be distinct and within 1 to 125",
        ));
    }
    if host.effects.len() > MAXIMUM_EFFECTS {
        return Err(invalid("server application declares too many host effects"));
    }
    if value.performs_effects() != (host.effect_budget != 0) || host.effect_budget > MAXIMUM_BUDGET
    {
        return Err(invalid(
            "the effect budget is zero exactly when the core may request no effect, and at most 256",
        ));
    }
    let mut names = BTreeSet::new();
    let mut spellings = BTreeSet::new();
    for declared in &host.effects {
        effect(declared)?;
        if !names.insert(declared.name.as_str()) || !spellings.insert(camel(&declared.name)) {
            return Err(invalid("host effect names must be unique"));
        }
    }
    if value.turn_maximum() > u64::from(u32::MAX) || value.script_maximum() > u64::from(u32::MAX) {
        return Err(invalid(
            "the largest turn and replay script of the effect budget must fit 32-bit lengths",
        ));
    }
    exchanges(value)?;
    serving::validate(value)?;
    transcripts(value)
}

/// Crate name of the package form that LexLean exports: `[a-z][a-z0-9_]{0,63}`.
fn package_name(value: &str) -> bool {
    value.len() <= 64
        && segment(value, |byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'_'
        })
        && !KEYWORDS.contains(&value)
}

/// Three canonical decimals, each within 64 bits.
fn triple(value: &str) -> bool {
    let parts = value.split('.').collect::<Vec<_>>();
    parts.len() == 3
        && parts.iter().all(|part| {
            part.parse::<u64>()
                .is_ok_and(|number| number.to_string() == *part)
        })
}

fn core(value: &ServerApplication) -> Result<(), PrismError> {
    let core = &value.core;
    let host_name = format!("{}_host", value.cargo_name.replace('-', "_"));
    if !package_name(&core.package)
        || !triple(&core.version)
        || core.package == host_name
        || core.package == format!("{host_name}_api")
        || ["std", "core", "alloc"].contains(&core.package.as_str())
    {
        return Err(invalid(
            "the core package needs a snake-case crate name other than the host's and a version of three canonical decimals",
        ));
    }
    Ok(())
}

fn rust_path(value: &str) -> bool {
    let parts = value.split("::").collect::<Vec<_>>();
    value.len() <= 256
        && parts.len() >= 2
        && parts.iter().all(|part| {
            !part.is_empty()
                && !part.as_bytes()[0].is_ascii_digit()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || byte == b'_')
                && !KEYWORDS.contains(part)
        })
}

/// Directories of the generated packages inside the consumer's workspace.
fn generated_directories(value: &ServerApplication) -> [String; 2] {
    let host = format!("{}-host", value.cargo_name);
    [format!("{host}-api"), host]
}

/// A workspace-relative directory: `/`-separated normal components, none empty,
/// `.`, `..` or hidden, and none of the build output or generated directories.
fn workspace_path(value: &str, reserved: &[String]) -> bool {
    let parts = value.split('/').collect::<Vec<_>>();
    value.len() <= 128
        && parts.len() <= 8
        && parts.iter().all(|part| {
            !part.is_empty()
                && part
                    .bytes()
                    .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'-' | b'.'))
                && !part.starts_with('.')
        })
        && !["target", "node_modules"].contains(&parts[0])
        && !reserved.iter().any(|name| name == parts[0])
}

fn bindings(value: &ServerApplication) -> Result<(), PrismError> {
    if value.bindings.len() != usize::from(!value.host.effects.is_empty()) {
        return Err(invalid(
            "exactly one host binding crate is declared when effects are declared, and none otherwise",
        ));
    }
    let host_name = format!("{}_host", value.cargo_name.replace('-', "_"));
    let reserved = generated_directories(value);
    for binding in &value.bindings {
        let name = binding.crate_name.replace('-', "_");
        if binding.crate_name.len() > 64
            || !binding
                .crate_name
                .as_bytes()
                .first()
                .is_some_and(u8::is_ascii_lowercase)
            || !binding.crate_name.bytes().all(|byte| {
                byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'-' | b'_')
            })
            || !rust_path(&binding.host)
            || binding.host.split("::").next() != Some(name.as_str())
            || name == host_name
            || name == format!("{host_name}_api")
            || name == value.core.package
            || ["std", "core", "alloc"].contains(&name.as_str())
        {
            return Err(invalid(
                "the host binding needs a crate name other than the core's and the generated host's, and the Rust path of its host type, which starts with that crate",
            ));
        }
        if !workspace_path(&binding.path, &reserved) {
            return Err(invalid(
                "the host binding path is a directory inside the workspace: normal components, no empty, dot or hidden component, and not a generated or build directory",
            ));
        }
    }
    Ok(())
}

fn exchanges(value: &ServerApplication) -> Result<(), PrismError> {
    let mut requests = BTreeSet::new();
    let mut total = 0usize;
    if value.acceptance_vectors.is_empty()
        || value.acceptance_vectors.len() > MAXIMUM_VECTORS
        || value.acceptance_vectors.iter().any(|vector| {
            total = total
                .saturating_add(vector.request.len())
                .saturating_add(vector.response.len());
            vector.request.len() > value.request_maximum as usize
                || vector.response.len() > value.response_maximum as usize
                || total > MAXIMUM_CORPUS_BYTES
                || !requests.insert(&vector.request)
        })
    {
        return Err(invalid(
            "server application requires bounded unique exchange vectors within its request and response maximums",
        ));
    }
    Ok(())
}

fn transcripts(value: &ServerApplication) -> Result<(), PrismError> {
    let host = &value.host;
    let frame = value.frame_effects();
    let mut vectors = BTreeSet::new();
    let mut exercised = BTreeSet::new();
    let mut total: usize = value
        .acceptance_vectors
        .iter()
        .map(|vector| vector.request.len() + vector.response.len())
        .sum();
    for transcript in &host.transcripts {
        if !vectors.insert(transcript.vector)
            || usize::try_from(transcript.vector)
                .map_or(true, |index| index >= value.acceptance_vectors.len())
            || transcript.steps.is_empty()
            || transcript.steps.len() > host.effect_budget as usize
        {
            return Err(invalid(
                "each transcript needs a distinct existing vector and between one step and the effect budget",
            ));
        }
        for step in &transcript.steps {
            total = total.saturating_add(step.request.len() + step.outcome.len());
            let declared = host
                .effects
                .iter()
                .find(|declared| declared.name == step.effect)
                .ok_or_else(|| invalid("a transcript step names an undeclared host effect"))?;
            if frame.contains(declared.name.as_str()) {
                return Err(invalid(
                    "a transcript step names an effect that only fills the request frame, which the core cannot request",
                ));
            }
            if step.request.len() > declared.request_maximum as usize
                || step.outcome.len() > declared.result_maximum as usize
                || wire::decode_fields(&declared.request, &step.request).is_err()
                || wire::decode_outcome(declared, &step.outcome).is_err()
                || total > MAXIMUM_CORPUS_BYTES
            {
                return Err(invalid(
                    "a transcript step is not a request and outcome of its declared effect within its bounds",
                ));
            }
            exercised.insert(declared.name.as_str());
        }
    }
    if value
        .core_effects()
        .any(|declared| !exercised.contains(declared.name.as_str()))
    {
        return Err(invalid(
            "every host effect the core may request must be requested by a step of some acceptance transcript",
        ));
    }
    Ok(())
}

/// Resolve the core root against the exact typed source snapshot, before any build.
pub fn validate_roots(
    value: &ServerApplication,
    snapshot: &SemanticSnapshot,
) -> Result<(), PrismError> {
    validate(value)?;
    let mut found = false;
    for module in snapshot.modules() {
        for declaration in module.declarations() {
            let name = format!("{}.{}", module.lean_module(), declaration.lean_name());
            if name == value.core.root && declaration.kind() != "definition" {
                return Err(PrismError::new(
                    "PP2001",
                    format!("server application root {name} is not executable"),
                ));
            }
            found |= name == value.core.root && declaration.kind() == "definition";
        }
    }
    if !found {
        return Err(PrismError::new(
            "PP2001",
            "server application core root is not defined",
        ));
    }
    Ok(())
}
