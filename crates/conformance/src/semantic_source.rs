//! One reader for the semantic payload of a LexLean source module.
//!
//! The SDK sources are language-1.2 notation, which no longer carries a
//! `\semanticdata{...}` line. LexLean reads a notation module back to its data
//! form (`lexlean::identity_bytes`, the form its own identities hash); a module
//! already written as data is returned as it is. Every audit and conformance
//! case that inspects declaration structure reads through this one function.

use std::path::Path;

/// The semantic module payload of the `.lex.tex` file at `path`: the JSON
/// value of its data form, whichever surface (notation or data) it is written in.
///
/// # Errors
/// The file is unreadable, is not UTF-8, or has no semantic payload line.
pub fn module_payload(path: &Path) -> Result<serde_json::Value, String> {
    let name = path.to_string_lossy();
    let bytes = std::fs::read(path).map_err(|error| format!("{name}: {error}"))?;
    module_payload_from_bytes(&name, &bytes)
}

/// The semantic module payload of source `bytes` named `name`.
///
/// # Errors
/// The bytes are not UTF-8, or have no semantic payload line.
pub fn module_payload_from_bytes(name: &str, bytes: &[u8]) -> Result<serde_json::Value, String> {
    let data = lexlean::identity_bytes(name, bytes);
    let text = std::str::from_utf8(&data).map_err(|error| format!("{name}: {error}"))?;
    let payload = text
        .lines()
        .find_map(|line| {
            line.strip_prefix("\\semanticdata{")
                .and_then(|value| value.strip_suffix('}'))
        })
        .ok_or_else(|| format!("{name} has no semantic module payload"))?;
    serde_json::from_str(payload).map_err(|error| format!("{name}: {error}"))
}
