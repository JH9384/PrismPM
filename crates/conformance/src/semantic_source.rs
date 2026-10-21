//! One reader for the semantic payload of a LexLean source module.
//!
//! The SDK sources are language-1.2 notation, which no longer carries a
//! `\semanticdata{...}` line. LexLean reads a notation module back to its data
//! form (`lexlean::sdk::read_module`); a module already written as data is
//! returned as it is, and `write` puts a changed module back in the surface the
//! source uses. Every audit and conformance
//! case that inspects declaration structure reads through this one function.

use std::path::Path;

/// The semantic module payload of the `.lex.tex` file at `path`: the JSON
/// value of its data form, whichever surface (notation or data) it is written in.
///
/// # Errors
/// The file is unreadable, not UTF-8, or holds no well-formed semantic module.
pub fn module_payload(path: &Path) -> Result<serde_json::Value, String> {
    let name = path.to_string_lossy();
    let bytes = std::fs::read(path).map_err(|error| format!("{name}: {error}"))?;
    module_payload_from_bytes(&name, &bytes)
}

/// The semantic module payload of source `bytes` named `name`.
///
/// # Errors
/// The bytes are not UTF-8 or hold no well-formed semantic module.
pub fn module_payload_from_bytes(name: &str, bytes: &[u8]) -> Result<serde_json::Value, String> {
    let text = std::str::from_utf8(bytes).map_err(|error| format!("{name}: {error}"))?;
    lexlean::sdk::read_module(text).map_err(|error| format!("{name}: {}", error.message))
}

/// The module of `source` as JSON, whichever surface it is written in.
///
/// # Panics
/// `source` holds no well-formed semantic module.
#[must_use]
pub fn read(source: &str) -> serde_json::Value {
    lexlean::sdk::read_module(source).expect("source holds a well-formed semantic module")
}

/// `source` with its module replaced by `value`, written in the surface the
/// module already uses (notation stays notation, data stays data).
///
/// # Panics
/// `value` is not a semantic module of the kind `source` holds.
#[must_use]
pub fn write(source: &str, value: &serde_json::Value) -> String {
    lexlean::sdk::write_module(source, value).expect("value is a semantic module of its kind")
}
