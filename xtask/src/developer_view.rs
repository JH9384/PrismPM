//! Developer view gate: `cargo xtask check-developer-view [--write]` (#347).
//!
//! The developer view of #346 is declared once, as the LexLean model
//! `bindings/src/Foundation/Views/V1/Developer.lex.tex`: its glossary, the
//! words of the surface and the deprecated aliases. The model's certified
//! export is vendored as [`model`]. This gate reads the `prism-code` surface
//! that `sdk/npm/prism-code/developer-surface.json` records (a test of that
//! package keeps the file equal to its help and client), runs the model over
//! it, and fails on every refusal. The model also renders the glossary page,
//! `docs/developer-glossary.md`, which `--write` replaces.

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
mod model;

use crate::Fail;
use model::{Adt0, Adt1, Adt2, Adt3, List, Str};
use serde_json::Value;
use std::path::Path;

const SURFACE: &str = "sdk/npm/prism-code/developer-surface.json";
const SURFACE_SCHEMA: &str = "prism-code/developer-surface/1";
const GLOSSARY: &str = "docs/developer-glossary.md";

/// The model recurses to a depth bounded by the surface, so it runs on a
/// thread with room for any surface.
const STACK: usize = 256 << 20;

fn text(value: &Value, field: &str) -> Result<String, Fail> {
    value[field]
        .as_str()
        .map(str::to_owned)
        .ok_or_else(|| format!("{SURFACE}: an entry has no text {field}").into())
}

fn list<T: Clone>(items: Vec<T>) -> List<T> {
    items
        .into_iter()
        .rev()
        .fold(List::nil(), |tail, item| List::cons(item, tail))
}

fn texts(mut items: List<Str>) -> Vec<String> {
    let mut out = Vec::new();
    while let Some((head, rest)) = items.uncons() {
        out.push(head.text().to_owned());
        items = rest;
    }
    out
}

/// The refusals of the model and the glossary page it renders.
fn judge(surface: &Value) -> Result<(Vec<String>, String), Fail> {
    if surface["schema"] != SURFACE_SCHEMA {
        return Err(format!("{SURFACE} is not {SURFACE_SCHEMA}").into());
    }
    let entries = |field: &str| -> Result<&Vec<Value>, Fail> {
        surface[field]
            .as_array()
            .ok_or_else(|| format!("{SURFACE} has no {field} list").into())
    };
    let mut names = Vec::new();
    for entry in entries("names")? {
        let [kind, place, name] = ["kind", "place", "name"].map(|field| text(entry, field));
        names.push((kind?, place?, name?));
    }
    let mut aliases = Vec::new();
    for entry in entries("aliases")? {
        let [kind, name, target, removal] =
            ["kind", "name", "target", "removal"].map(|field| text(entry, field));
        aliases.push((kind?, name?, target?, removal?));
    }
    let worker = std::thread::Builder::new()
        .stack_size(STACK)
        .spawn(move || {
            let input = Adt0::C0(
                list(
                    names
                        .iter()
                        .map(|(kind, place, name)| {
                            Adt1::C0(Str::lit(kind), Str::lit(place), Str::lit(name))
                        })
                        .collect(),
                ),
                list(
                    aliases
                        .iter()
                        .map(|(kind, name, target, removal)| {
                            Adt2::C0(
                                Str::lit(kind),
                                Str::lit(name),
                                Str::lit(target),
                                Str::lit(removal),
                            )
                        })
                        .collect(),
                ),
            );
            match model::run(input) {
                Ok(Adt3::C0(refusals, glossary)) => {
                    Ok((texts(refusals), glossary.text().to_owned()))
                }
                Err(_) => Err("the developer view model overflowed".to_owned()),
            }
        })?;
    let judged = worker
        .join()
        .unwrap_or_else(|panic| std::panic::resume_unwind(panic))?;
    Ok(judged)
}

/// Check the surface against the model, and the glossary page against what the
/// model renders; `write` replaces the page.
pub fn validate(root: &Path, write: bool) -> Result<(), Fail> {
    let surface: Value = serde_json::from_slice(&std::fs::read(root.join(SURFACE))?)?;
    let (refusals, glossary) = judge(&surface)?;
    let page = root.join(GLOSSARY);
    let current = std::fs::read_to_string(&page).ok();
    let drifted = current.as_deref() != Some(glossary.as_str());
    if drifted && write {
        std::fs::write(&page, &glossary)?;
    }
    let mut problems = refusals;
    if drifted && !write {
        problems.push(format!(
            "{GLOSSARY} is not the page the model renders; run `cargo xtask check-developer-view --write`"
        ));
    }
    if problems.is_empty() {
        println!(
            "developer view: {} names and {} aliases of the prism-code surface are in the glossary",
            surface["names"].as_array().map_or(0, Vec::len),
            surface["aliases"].as_array().map_or(0, Vec::len)
        );
        Ok(())
    } else {
        Err(format!("the developer view refuses:\n  {}", problems.join("\n  ")).into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn surface(names: Value, aliases: Value) -> Value {
        json!({ "schema": SURFACE_SCHEMA, "names": names, "aliases": aliases })
    }

    fn declared() -> Value {
        json!([
            { "kind": "verb", "name": "history", "target": "record", "removal": "0.9.0" },
            { "kind": "flag", "name": "holo", "target": "image", "removal": "0.9.0" }
        ])
    }

    fn base() -> Vec<Value> {
        vec![
            json!({ "kind": "verb", "place": "prism-code record", "name": "record" }),
            json!({ "kind": "flag", "place": "--image", "name": "image" }),
        ]
    }

    #[test]
    fn the_committed_surface_is_in_the_glossary_and_the_page_is_rendered() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        let committed: Value =
            serde_json::from_slice(&std::fs::read(root.join(SURFACE)).unwrap()).unwrap();
        let (refusals, glossary) = judge(&committed).unwrap();
        assert!(refusals.is_empty(), "{refusals:#?}");
        assert_eq!(
            std::fs::read_to_string(root.join(GLOSSARY))
                .unwrap()
                .replace("\r\n", "\n"),
            glossary
        );
    }

    #[test]
    fn a_name_outside_the_glossary_a_renamed_term_and_an_early_docker_verb_are_refused() {
        let mut names = base();
        names.push(
            json!({ "kind": "verb", "place": "prism-code frobnicate", "name": "frobnicate" }),
        );
        names.push(json!({ "kind": "flag", "place": "--holo-file", "name": "holo-file" }));
        names.push(json!({ "kind": "verb", "place": "prism-code ps", "name": "ps" }));
        names.push(
            json!({ "kind": "method", "place": "prism.containers.instance", "name": "instance" }),
        );
        let (refusals, _) = judge(&surface(Value::Array(names), declared())).unwrap();
        assert_eq!(
            refusals,
            [
                "prism-code frobnicate is not a word of the developer view; declare it in the glossary or rename it",
                "--holo-file uses the canonical term holo, which the developer view calls image",
                "prism-code ps takes a Docker word before Prism has its behaviour, which #350 builds",
                "prism.containers.instance is not a word of the developer view; declare it in the glossary or rename it",
                "prism.containers.instance uses the canonical term instance, which the developer view calls container",
            ]
        );
    }

    #[test]
    fn aliases_must_be_the_declared_ones_and_name_a_term_the_surface_has() {
        let aliases = json!([
            { "kind": "verb", "name": "history", "target": "record", "removal": "0.9.0" },
            { "kind": "flag", "name": "sdk-image", "target": "builder-image", "removal": "0.9.0" }
        ]);
        let (refusals, _) = judge(&surface(Value::Array(base()), aliases)).unwrap();
        assert_eq!(
            refusals,
            [
                "the flag alias sdk-image for builder-image (removed in 0.9.0) is not declared in the developer view",
                "the flag alias holo for image (removed in 0.9.0) is declared, and the surface does not keep it",
            ]
        );
        let (refusals, _) = judge(&surface(json!([]), declared())).unwrap();
        assert_eq!(
            refusals,
            [
                "the verb alias history for record (removed in 0.9.0) names a verb the surface does not have",
                "the flag alias holo for image (removed in 0.9.0) names a flag the surface does not have",
            ]
        );
    }

    #[test]
    fn a_surface_of_another_schema_is_refused() {
        let error = judge(&json!({ "schema": "x", "names": [], "aliases": [] })).unwrap_err();
        assert!(error.to_string().contains(SURFACE_SCHEMA), "{error}");
    }
}
