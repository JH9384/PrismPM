//! The session guest `hologram:guest/core-wasm@2` (issue #629,
//! docs/proposals/629-session-world.md).
//!
//! The package is composed like the server host adapter: the model's code as
//! `prod_codegen::generate_module` renders it, unchanged, and a fixed runtime
//! template (`session_guest/runtime.rs.in`) whose only inputs are the declared
//! bounds and the entry's name. No application behavior is written here.

use prod_codegen::{GeneratedPackage, PackageFile};
use prod_ir::{Module, Type};
use sha2::{Digest, Sha256};

use crate::error::PrismError;

/// The guest contract this module generates.
pub const SESSION_CONTRACT: &str = "hologram:guest/core-wasm@2";
/// The schema of the package's `generation-manifest.json`.
pub const TARGET_SCHEMA: &str = "prismpm/core-wasm-session-target/1";
/// The most responses one step may return.
pub const RESPONSE_COUNT_LIMIT: u32 = 65_535;

const RUNTIME_TEMPLATE: &str = include_str!("session_guest/runtime.rs.in");
const PAGE: u64 = 65_536;

/// The declared bounds of a session guest and the model root that takes its steps.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionGuestSpec {
    /// The Cargo name of the generated guest package.
    pub crate_name: String,
    /// The model's `Bytes -> Bytes` session root, as named in the IR.
    pub entry: String,
    /// The largest request `holo_alloc` reserves.
    pub request_maximum: u32,
    /// The largest state an answer may carry.
    pub state_maximum: u32,
    /// The largest single response.
    pub response_maximum: u32,
    /// The most responses one step may return.
    pub response_count_maximum: u32,
    /// The exact memory maximum, in 64 KiB pages.
    pub maximum_pages: u32,
    /// The LLVM linear-memory stack, in bytes.
    pub stack_bytes: u32,
    /// The SHA-256 of the IR the package is generated from.
    pub input_ir_sha256: String,
}

impl SessionGuestSpec {
    /// The largest turn the shim builds: the state length, the state and the request.
    pub fn turn_maximum(&self) -> u64 {
        4 + u64::from(self.state_maximum) + u64::from(self.request_maximum)
    }

    /// The largest answer the entry may return: the state, the count and every response with its length.
    pub fn answer_maximum(&self) -> u64 {
        8 + u64::from(self.state_maximum)
            + u64::from(self.response_count_maximum) * (4 + u64::from(self.response_maximum))
    }

    /// Why the bounds cannot be generated, or `None`. The profile validator
    /// reports the same problems; the generator refuses them again so that no
    /// caller can bypass the validator.
    pub fn bounds_problem(&self) -> Option<String> {
        let memory = u64::from(self.maximum_pages) * PAGE;
        if self.maximum_pages == 0 || self.maximum_pages > 32_767 {
            return Some(format!(
                "core memory pages {} are outside 1..=32767",
                self.maximum_pages
            ));
        }
        if self.stack_bytes == 0
            || !self.stack_bytes.is_multiple_of(16)
            || u64::from(self.stack_bytes) >= memory
        {
            return Some(format!(
                "core stack bytes {} must be positive, a multiple of 16 and below the memory maximum",
                self.stack_bytes
            ));
        }
        if self.request_maximum == 0 || self.response_maximum == 0 {
            return Some("request and response maxima must be positive".to_owned());
        }
        if self.response_count_maximum == 0 || self.response_count_maximum > RESPONSE_COUNT_LIMIT {
            return Some(format!(
                "response count maximum {} is outside 1..={RESPONSE_COUNT_LIMIT}",
                self.response_count_maximum
            ));
        }
        let (turn, answer) = (self.turn_maximum(), self.answer_maximum());
        if turn > u64::from(u32::MAX) || answer > u64::from(u32::MAX) {
            return Some(format!(
                "a turn of {turn} or an answer of {answer} bytes does not fit a 32-bit length"
            ));
        }
        // The resident state, the responses, the request and the turn are live at once.
        let resident = u64::from(self.state_maximum) * 2
            + u64::from(self.request_maximum) * 2
            + answer
            + 4
            + u64::from(self.stack_bytes);
        if resident > memory {
            return Some(format!(
                "a step needs at least {resident} bytes of memory, more than the {memory} the pages declare"
            ));
        }
        None
    }
}

fn valid_ident(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 128
        && value.bytes().enumerate().all(|(index, byte)| {
            byte.is_ascii_alphabetic() || byte == b'_' || (index > 0 && byte.is_ascii_digit())
        })
}

fn valid_crate(value: &str) -> bool {
    !value.is_empty()
        && value.len() <= 64
        && value.as_bytes()[0].is_ascii_lowercase()
        && value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-' || byte == b'_'
        })
}

fn refused(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5101", message)
}

fn sha256(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn file(path: &str, text: String) -> PackageFile {
    PackageFile {
        path: path.to_owned(),
        bytes: text.into_bytes(),
    }
}

/// A runtime module name that no type or definition of the model uses, so model
/// names cannot capture the shim's helpers.
fn runtime_module_name(module: &Module) -> String {
    let taken = |name: &str| {
        module
            .types
            .iter()
            .any(|ty| ty.name.rsplit('.').next() == Some(name))
            || module.definitions.iter().any(|def| def.name == name)
    };
    let mut name = "__prism_session_runtime".to_owned();
    let mut index = 1;
    while taken(&name) {
        name = format!("__prism_session_runtime_{index}");
        index += 1;
    }
    name
}

/// Render the runtime module of the shim from the bounds, the module name and
/// the call of the entry. Public to the crate so tests and the conformance
/// probe use the same bytes the generator emits.
pub(crate) fn render_runtime(
    spec: &SessionGuestSpec,
    runtime_module: &str,
    fallible: bool,
) -> String {
    let adapter = if fallible {
        ".unwrap_or_else(|_| trap())"
    } else {
        ""
    };
    let invoke = format!(
        "let answer: alloc::vec::Vec<u8> = crate::{}(turn){adapter};",
        rust_ident(&spec.entry)
    );
    RUNTIME_TEMPLATE
        .replace("@RUNTIME_MODULE@", runtime_module)
        .replace("@REQUEST_MAXIMUM@", &spec.request_maximum.to_string())
        .replace("@STATE_MAXIMUM@", &spec.state_maximum.to_string())
        .replace("@RESPONSE_MAXIMUM@", &spec.response_maximum.to_string())
        .replace(
            "@RESPONSE_COUNT_MAXIMUM@",
            &spec.response_count_maximum.to_string(),
        )
        .replace("@MAXIMUM_PAGES@", &spec.maximum_pages.to_string())
        .replace("@INVOKE_ENTRY@", &invoke)
}

/// The Rust identifier `prod_codegen` gives a model definition: the last
/// component of its dotted name. Entries are already plain identifiers.
fn rust_ident(name: &str) -> &str {
    name.rsplit('.').next().unwrap_or(name)
}

/// The crate root every Core-Wasm guest starts with, then the model's code.
pub(crate) const CRATE_HEADER: &str = "#![no_std]
#![allow(dead_code, non_snake_case, unused_parens, unused_variables)]
extern crate alloc;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ComputeError {
    AddOverflow,
    MulOverflow,
    ShiftExponentTooLarge,
    ShiftOverflow,
    PowExponentTooLarge,
    PowOverflow,
    OutputTooSmall,
}
";

/// Generate the source package of a session guest. The entry must be the
/// model's `Bytes -> Bytes` root; a checked failure in it traps at the step.
pub fn generate_session_guest_package(
    module: &Module,
    spec: &SessionGuestSpec,
) -> Result<GeneratedPackage, PrismError> {
    if !valid_crate(&spec.crate_name) || !valid_ident(&spec.entry) {
        return Err(refused("invalid session guest crate or entry name"));
    }
    if spec.input_ir_sha256.len() != 64
        || !spec
            .input_ir_sha256
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        return Err(refused(
            "the input IR digest is not 64 lowercase hex characters",
        ));
    }
    if let Some(problem) = spec.bounds_problem() {
        return Err(refused(format!("session guest bounds: {problem}")));
    }
    let definition = module
        .definitions
        .iter()
        .find(|definition| definition.name == spec.entry)
        .ok_or_else(|| {
            refused(format!(
                "the session entry {} is not in the module",
                spec.entry
            ))
        })?;
    if definition.params.len() != 1
        || definition.params[0].1 != Type::Bytes
        || definition.ret != Type::Bytes
    {
        return Err(refused(format!(
            "the session entry {} must be Bytes -> Bytes",
            spec.entry
        )));
    }
    let fallible = prod_codegen::byte_entry_is_fallible(module, &spec.entry)
        .map_err(|error| refused(error.to_string()))?;
    let generated =
        prod_codegen::generate_module(module).map_err(|error| refused(error.to_string()))?;
    let runtime = render_runtime(spec, &runtime_module_name(module), fallible);
    let source = format!("{CRATE_HEADER}\n{generated}\n\n{runtime}");

    let maximum_memory = u64::from(spec.maximum_pages) * PAGE;
    let cargo = format!(
        "[package]\nname = \"{}\"\nversion = \"0.1.0\"\nedition = \"2021\"\npublish = false\n\n[lib]\ncrate-type = [\"cdylib\"]\npath = \"src/lib.rs\"\n\n[profile.release]\npanic = \"abort\"\nopt-level = \"s\"\nlto = true\ncodegen-units = 1\nstrip = \"symbols\"\n",
        spec.crate_name
    );
    let lock = format!(
        "# This file is automatically @generated by Cargo.\n# It is not intended for manual editing.\nversion = 4\n\n[[package]]\nname = \"{}\"\nversion = \"0.1.0\"\n",
        spec.crate_name
    );
    let config = format!(
        "[build]\ntarget = \"wasm32-unknown-unknown\"\n\n[target.wasm32-unknown-unknown]\nrustflags = [\"-C\", \"link-arg=--export-memory\", \"-C\", \"link-arg=--max-memory={maximum_memory}\", \"-C\", \"link-arg=-zstack-size={}\"]\n",
        spec.stack_bytes
    );
    let mut files = vec![
        file(".cargo/config.toml", config),
        file("Cargo.lock", lock),
        file("Cargo.toml", cargo),
        file("src/lib.rs", source),
    ];
    let records = files
        .iter()
        .map(|item| {
            format!(
                "{{\"path\":\"{}\",\"sha256\":\"{}\"}}",
                item.path,
                sha256(&item.bytes)
            )
        })
        .collect::<Vec<_>>()
        .join(",");
    let manifest = format!(
        "{{\"contract\":\"{SESSION_CONTRACT}\",\"entry\":\"{}\",\"files\":[{records}],\"input_ir_sha256\":\"{}\",\"maximum_pages\":{},\"request_maximum\":{},\"response_count_maximum\":{},\"response_maximum\":{},\"schema\":\"{TARGET_SCHEMA}\",\"stack_bytes\":{},\"state_maximum\":{}}}\n",
        spec.entry,
        spec.input_ir_sha256,
        spec.maximum_pages,
        spec.request_maximum,
        spec.response_count_maximum,
        spec.response_maximum,
        spec.stack_bytes,
        spec.state_maximum,
    );
    files.push(file("generation-manifest.json", manifest));
    files.sort_by(|left, right| left.path.as_bytes().cmp(right.path.as_bytes()));
    Ok(GeneratedPackage { files })
}

#[cfg(test)]
mod tests;
