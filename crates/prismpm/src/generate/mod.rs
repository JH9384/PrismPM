//! `prismpm generate` (#289): bindings and a typed client from a holo's WIT
//! world and model, written into the output directory the caller names.
//!
//! Every decision is the LexLean model `bindings/src/Foundation/Bindings/V1`:
//! `Source.lex.tex` reads the WIT world and the model document into the code
//! model, refusing what it cannot bind, and `Js`, `Python` and `Rust` write
//! the files. `cargo xtask bindings-package` exports the three roots of
//! `Generate.lex.tex` and vendors them here as `*_writer.rs`. This module only
//! gathers the model's input from the holo, runs it and writes its files.
//!
//! Beside the files the output holds `prism-generate.json`, the record
//! `prism-code generate` writes too: the language, the generator, the world
//! and the model the files came from, and the SHA-256 of each file. A run
//! whose record and files are already in place writes nothing.

use crate::error::PrismError;
use crate::holo::archive::parse_application;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};

#[allow(
    missing_docs,
    dead_code,
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_patterns,
    non_snake_case,
    non_camel_case_types,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
#[rustfmt::skip]
#[path = "js_writer.rs"]
mod js_writer;

#[allow(
    missing_docs,
    dead_code,
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_patterns,
    non_snake_case,
    non_camel_case_types,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
#[rustfmt::skip]
#[path = "python_writer.rs"]
mod python_writer;

#[allow(
    missing_docs,
    dead_code,
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_patterns,
    non_snake_case,
    non_camel_case_types,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
#[rustfmt::skip]
#[path = "rust_writer.rs"]
mod rust_writer;

/// The record beside the generated files.
pub const RECORD: &str = "prism-generate.json";
/// The record's schema, shared with `prism-code generate`.
pub const RECORD_SCHEMA: &str = "prismpm/generate-record/1";
/// The generator each file header names.
const GENERATOR: &str = "prismpm generate";

/// The WIT file of each world generate knows, vendored beside this module.
const WORLDS: &[(&str, &str)] = &[("worlds/core-wasm.wit", include_str!("core-wasm.wit"))];

/// The writers' own sources, so a change to any of them regenerates.
const SOURCES: &[(&str, &str)] = &[
    ("core-wasm.wit", include_str!("core-wasm.wit")),
    ("js_writer.rs", include_str!("js_writer.rs")),
    ("python_writer.rs", include_str!("python_writer.rs")),
    ("rust_writer.rs", include_str!("rust_writer.rs")),
];

/// The writers recurse to a depth bounded by their input, so each runs on a
/// thread whose stack fits any model.
const STACK: usize = 256 << 20;

/// A language `generate` writes.
#[derive(Clone, Copy, Debug, PartialEq, Eq, clap::ValueEnum)]
pub enum Language {
    /// An ES module with TypeScript declarations.
    Js,
    /// A Python package.
    Python,
    /// A Rust crate.
    Rust,
}

impl Language {
    /// The name `--lang` takes and the record keeps.
    #[must_use]
    pub const fn name(self) -> &'static str {
        match self {
            Self::Js => "js",
            Self::Python => "python",
            Self::Rust => "rust",
        }
    }
}

/// One operation of the model document's view.
struct Operation {
    request_name: String,
    label: String,
    discriminant: u64,
}

/// The model's input, gathered from the holo.
struct Source {
    generator: String,
    contract: String,
    package: String,
    world_name: String,
    world_file: String,
    world_blake3: String,
    world_sha256: String,
    world_exports: Vec<String>,
    world_imports: Vec<String>,
    conforms: bool,
    wit_text: String,
    wit_blake3: String,
    wit_sha256: String,
    application_name: Option<String>,
    cargo_name: Option<String>,
    description: Option<String>,
    schema: String,
    input_grammar: String,
    function_name: String,
    operation_type: String,
    error_type: String,
    model_blake3: String,
    model_sha256: String,
    operations: Vec<Operation>,
    overflow_error: Option<String>,
    division_error: Option<String>,
    input_error: Option<String>,
}

/// What the model wrote, or why it refused.
enum Written {
    Files(Vec<(String, String)>),
    Refused(String, String),
}

fn sha256_hex(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}

fn text_of(value: &Value) -> String {
    value.as_str().unwrap_or_default().to_owned()
}

fn optional_text(value: &Value) -> Option<String> {
    value.as_str().map(str::to_owned)
}

fn texts(value: &Value) -> Vec<String> {
    value
        .as_array()
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

/// The model's input: the inspection's world row, the vendored WIT text with
/// its digests, and the model document's members.
fn source(holo: &[u8], generator: &str) -> Result<Source, PrismError> {
    let inspection = crate::inspect::inspect(holo)?;
    let parsed = parse_application(holo)?;
    let model = parsed
        .blobs
        .get(&parsed.identities.model_content_kappa)
        .ok_or_else(|| PrismError::new("PP3003", "the holo carries no model document"))?;
    let document: Value = serde_json::from_slice(model)
        .map_err(|error| PrismError::new("PP3003", format!("the model document: {error}")))?;
    let world = &inspection["world"];
    let file = text_of(&world["file"]);
    let wit = WORLDS
        .iter()
        .find(|(name, _)| *name == file)
        .map(|(_, text)| text.replace("\r\n", "\n"))
        .unwrap_or_default();
    let application = &document["application"];
    if !application.is_object() {
        return Err(PrismError::new(
            "PP3003",
            "the model document has no application",
        ));
    }
    let view = &application["view"];
    let operations = view["operations"]
        .as_array()
        .map(|rows| {
            rows.iter()
                .map(|row| Operation {
                    request_name: text_of(&row["request_name"]),
                    label: text_of(&row["label"]),
                    discriminant: row["discriminant"].as_u64().unwrap_or_default(),
                })
                .collect()
        })
        .unwrap_or_default();
    Ok(Source {
        generator: generator.to_owned(),
        contract: text_of(&world["contract"]),
        package: text_of(&world["package"]),
        world_name: text_of(&world["name"]),
        world_file: file,
        world_blake3: text_of(&world["digest"]["blake3"]),
        world_sha256: text_of(&world["digest"]["sha256"]),
        world_exports: texts(&world["exports"]),
        world_imports: texts(&world["imports"]),
        conforms: world["conforms"].as_bool() == Some(true),
        wit_blake3: if wit.is_empty() {
            String::new()
        } else {
            blake3::hash(wit.as_bytes()).to_hex().to_string()
        },
        wit_sha256: if wit.is_empty() {
            String::new()
        } else {
            sha256_hex(wit.as_bytes())
        },
        wit_text: wit,
        application_name: optional_text(&application["name"]),
        cargo_name: optional_text(&application["cargo_name"]),
        description: optional_text(&application["cargo_description"]),
        schema: text_of(&document["schema"]),
        input_grammar: text_of(&application["input_grammar"]),
        function_name: text_of(&application["function_name"]),
        operation_type: text_of(&application["operation_type"]),
        error_type: text_of(&application["error_type"]),
        model_blake3: blake3::hash(model).to_hex().to_string(),
        model_sha256: sha256_hex(model),
        operations,
        overflow_error: optional_text(&view["overflow_error"]),
        division_error: optional_text(&view["division_error"]),
        input_error: optional_text(&view["input_error"]),
    })
}

macro_rules! writer {
    ($package:ident) => {{
        use $package::{List, Str};
        fn text(value: &str) -> Str {
            Str::lit(value)
        }
        fn list<T: Clone, U>(items: &[U], each: impl Fn(&U) -> T) -> List<T> {
            items
                .iter()
                .rev()
                .fold(List::nil(), |tail, item| List::cons(each(item), tail))
        }
        move |source: Source| -> Option<Written> {
            let input = $package::Adt0::C0(
                text(&source.generator),
                text(&source.contract),
                text(&source.package),
                text(&source.world_name),
                text(&source.world_file),
                text(&source.world_blake3),
                text(&source.world_sha256),
                list(&source.world_exports, |name| text(name)),
                list(&source.world_imports, |name| text(name)),
                source.conforms,
                text(&source.wit_text),
                text(&source.wit_blake3),
                text(&source.wit_sha256),
                source.application_name.as_deref().map(text),
                source.cargo_name.as_deref().map(text),
                source.description.as_deref().map(text),
                text(&source.schema),
                text(&source.input_grammar),
                text(&source.function_name),
                text(&source.operation_type),
                text(&source.error_type),
                text(&source.model_blake3),
                text(&source.model_sha256),
                list(&source.operations, |operation| {
                    $package::Adt1::C0(
                        text(&operation.request_name),
                        text(&operation.label),
                        operation.discriminant,
                    )
                }),
                source.overflow_error.as_deref().map(text),
                source.division_error.as_deref().map(text),
                source.input_error.as_deref().map(text),
            );
            match $package::run(input).ok()? {
                $package::Adt2::C1(code, message) => Some(Written::Refused(
                    code.text().to_owned(),
                    message.text().to_owned(),
                )),
                $package::Adt2::C0(files) => {
                    let mut written = Vec::new();
                    let mut rest = files;
                    while let Some(($package::Adt3::C0(path, body), tail)) = rest.uncons() {
                        written.push((path.text().to_owned(), body.text().to_owned()));
                        rest = tail;
                    }
                    Some(Written::Files(written))
                }
            }
        }
    }};
}

/// Run the model for `language` on a thread with room for its recursion.
fn write_files(language: Language, source: Source) -> Result<Written, PrismError> {
    let worker = std::thread::Builder::new()
        .name("prism-generate".into())
        .stack_size(STACK)
        .spawn(move || match language {
            Language::Js => writer!(js_writer)(source),
            Language::Python => writer!(python_writer)(source),
            Language::Rust => writer!(rust_writer)(source),
        })
        .map_err(|error| PrismError::new("PP9001", format!("the bindings writer: {error}")))?;
    worker
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))
        .ok_or_else(|| PrismError::new("PP9001", "the bindings writer overflowed"))
}

/// What the record says the files came from.
struct Identity {
    contract: String,
    world_blake3: String,
    world_sha256: String,
    model_blake3: String,
    model_sha256: String,
}

/// The bindings of `holo` for `language`, as the model writes them with
/// `generator` in each file header: `[path, text]` pairs, or the model's
/// refusal as a `PP3201` error naming its code.
fn bindings(
    holo: &[u8],
    language: Language,
    generator: &str,
) -> Result<(Identity, Vec<(String, String)>), PrismError> {
    let input = source(holo, generator)?;
    let identity = Identity {
        contract: input.contract.clone(),
        world_blake3: input.world_blake3.clone(),
        world_sha256: input.world_sha256.clone(),
        model_blake3: input.model_blake3.clone(),
        model_sha256: input.model_sha256.clone(),
    };
    match write_files(language, input)? {
        Written::Refused(code, message) => Err(PrismError::new(
            "PP3201",
            format!("generate cannot bind this holo ({code}): {message}"),
        )),
        Written::Files(files) => Ok((identity, files)),
    }
}

/// The generator's identity: SHA-256 over the writers' own sources.
fn generator_digest() -> String {
    let mut all = String::new();
    for (name, text) in SOURCES {
        let text = text.replace("\r\n", "\n");
        all.push_str(&format!("{name}\n{}\n{text}", text.len()));
    }
    sha256_hex(all.as_bytes())
}

/// Sorted keys, two-space indent, LF, one trailing newline.
fn record_text(record: &Value) -> Result<String, PrismError> {
    let text = serde_json::to_string_pretty(&sorted(record))
        .map_err(|error| PrismError::new("PP9001", format!("the generate record: {error}")))?;
    Ok(format!("{text}\n"))
}

fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let mut out = Map::new();
            for key in keys {
                out.insert(key.clone(), sorted(&map[key]));
            }
            Value::Object(out)
        }
        other => other.clone(),
    }
}

fn current(path: &Path) -> Option<String> {
    std::fs::read_to_string(path)
        .ok()
        .map(|text| text.replace("\r\n", "\n"))
}

fn write_error(path: &Path, error: &std::io::Error) -> PrismError {
    PrismError::new(
        "PP3202",
        format!("{} cannot be written: {error}", path.display()),
    )
}

/// What one `generate` did.
#[derive(Debug)]
pub struct Generated {
    /// `written` or `unchanged`.
    pub status: &'static str,
    /// The output directory.
    pub out: PathBuf,
    /// The files written, empty when nothing changed.
    pub files: Vec<String>,
    /// The record beside the files.
    pub record: Value,
}

/// Generate the bindings of `holo` for `language` into `out`.
///
/// # Errors
///
/// `PP3201` when the model cannot bind the holo, `PP3202` when the output
/// cannot be written or holds a file generate did not write.
pub fn generate(holo: &[u8], language: Language, out: &Path) -> Result<Generated, PrismError> {
    generate_as(holo, language, out, GENERATOR)
}

fn generate_as(
    holo: &[u8],
    language: Language,
    out: &Path,
    generator: &str,
) -> Result<Generated, PrismError> {
    let (identity, files) = bindings(holo, language, generator)?;
    let names: std::collections::BTreeSet<&str> =
        files.iter().map(|(name, _)| name.as_str()).collect();
    if names.contains(RECORD) {
        return Err(PrismError::new(
            "PP3201",
            format!("the application's file name collides with {RECORD}"),
        ));
    }
    if names.len() != files.len() {
        return Err(PrismError::new(
            "PP3201",
            "two generated files share a name; rename the application",
        ));
    }
    let mut digests = Map::new();
    for (name, text) in &files {
        digests.insert(name.clone(), Value::String(sha256_hex(text.as_bytes())));
    }
    let record = json!({
        "schema": RECORD_SCHEMA,
        "language": language.name(),
        "generator": {
            "name": "prismpm",
            "version": env!("CARGO_PKG_VERSION"),
            "sha256": generator_digest(),
        },
        "world": {
            "contract": identity.contract,
            "blake3": identity.world_blake3,
            "sha256": identity.world_sha256,
        },
        "model": {"blake3": identity.model_blake3, "sha256": identity.model_sha256},
        "files": Value::Object(digests),
    });
    let text = record_text(&record)?;
    let record_path = out.join(RECORD);
    let previous: Option<Value> = current(&record_path)
        .and_then(|text| serde_json::from_str(&text).ok())
        .filter(|value: &Value| value["schema"] == RECORD_SCHEMA && value["files"].is_object());
    let texts: Vec<Option<String>> = files
        .iter()
        .map(|(name, _)| current(&out.join(name)))
        .collect();
    let intact = files
        .iter()
        .zip(&texts)
        .all(|((_, text), on_disk)| on_disk.as_deref() == Some(text.as_str()));
    if intact && current(&record_path).as_deref() == Some(text.as_str()) {
        return Ok(Generated {
            status: "unchanged",
            out: out.to_path_buf(),
            files: Vec::new(),
            record,
        });
    }
    let earlier = |name: &str| {
        previous
            .as_ref()
            .is_some_and(|value| value["files"].get(name).is_some())
    };
    for ((name, text), on_disk) in files.iter().zip(&texts) {
        if on_disk
            .as_deref()
            .is_some_and(|existing| existing != text && !earlier(name))
        {
            return Err(PrismError::new(
                "PP3202",
                format!(
                    "{} exists and was not written by generate; move it or choose another output directory",
                    out.join(name).display()
                ),
            ));
        }
    }
    std::fs::create_dir_all(out).map_err(|error| write_error(out, &error))?;
    let mut written = Vec::new();
    for ((name, text), on_disk) in files.iter().zip(&texts) {
        if on_disk.as_deref() == Some(text.as_str()) {
            continue;
        }
        let path = out.join(name);
        std::fs::write(&path, text).map_err(|error| write_error(&path, &error))?;
        written.push(name.clone());
    }
    // Files an earlier run wrote that this one no longer does.
    if let Some(Value::Object(earlier_files)) = previous.as_ref().map(|value| &value["files"]) {
        for name in earlier_files.keys() {
            if !names.contains(name.as_str())
                && name != RECORD
                && !name.contains('/')
                && !name.contains('\\')
            {
                let _ = std::fs::remove_file(out.join(name));
            }
        }
    }
    std::fs::write(&record_path, &text).map_err(|error| write_error(&record_path, &error))?;
    Ok(Generated {
        status: "written",
        out: out.to_path_buf(),
        files: written,
        record,
    })
}

#[cfg(test)]
#[path = "tests.rs"]
mod tests;
