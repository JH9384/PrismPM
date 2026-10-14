//! Bind imported publication types to the actual SDK-owned source archive.

use super::invalid;
use crate::error::PrismError;
use crate::holo::canonical::content_id;
use lexlean::{SemanticSnapshot, SnapshotSemanticModule};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};
use std::path::Component;

const MAX_ARCHIVE: usize = 67_108_864;
const MAX_MODULES: usize = 65_536;
pub(super) const LINKAGE: &str = "Production.PublicationAdmission.LinkageV1";
pub(super) const ADMISSION: &str = "Production.PublicationAdmission.V1";

pub(super) struct Source {
    pub(super) digest: String,
    pub(super) imports: Vec<String>,
    pub(super) semantic: SnapshotSemanticModule,
}

fn archive_rows(bytes: &[u8]) -> Result<BTreeMap<String, Vec<u8>>, PrismError> {
    if bytes.len() > MAX_ARCHIVE {
        return Err(invalid(
            "SDK source archive exceeds the private linkage bound",
        ));
    }
    let mut result = BTreeMap::new();
    let mut archive = tar::Archive::new(Cursor::new(bytes));
    let mut total = 0_usize;
    for entry in archive.entries().map_err(|e| invalid(e.to_string()))? {
        let mut entry = entry.map_err(|e| invalid(e.to_string()))?;
        let path = entry.path().map_err(|e| invalid(e.to_string()))?;
        if !entry.header().entry_type().is_file()
            || path
                .components()
                .any(|part| !matches!(part, Component::Normal(_)))
        {
            return Err(invalid(
                "SDK source archive contains a non-file or non-confined entry",
            ));
        }
        let path = path
            .to_str()
            .ok_or_else(|| invalid("SDK source path is not UTF-8"))?
            .to_owned();
        let length =
            usize::try_from(entry.size()).map_err(|_| invalid("SDK source size overflow"))?;
        total = total
            .checked_add(length)
            .filter(|n| *n <= MAX_ARCHIVE)
            .ok_or_else(|| invalid("SDK expanded source archive exceeds the bound"))?;
        let mut body = Vec::new();
        entry
            .read_to_end(&mut body)
            .map_err(|e| invalid(e.to_string()))?;
        if body.len() != length
            || result.len() == MAX_MODULES
            || result.insert(path, body).is_some()
        {
            return Err(invalid(
                "SDK source archive has a duplicate or excessive entry",
            ));
        }
    }
    Ok(result)
}

fn inventory_binds(lock: &Value, digest: &str) -> Result<(), PrismError> {
    let inventories: Vec<&Value> = match lock["schema"].as_str() {
        Some("prismpm/sdk-lock/1") => vec![&lock["inventory"]],
        Some("prismpm/sdk-lock/2") => lock["platforms"]
            .as_array()
            .ok_or_else(|| invalid("SDK platform inventory is absent"))?
            .iter()
            .map(|platform| &platform["inventory"])
            .collect(),
        _ => return Err(invalid("unsupported captured SDK lock")),
    };
    if inventories.is_empty() {
        return Err(invalid("SDK source inventory is absent"));
    }
    for inventory in inventories {
        let rows = inventory
            .as_array()
            .ok_or_else(|| invalid("SDK inventory is absent"))?;
        let matches = rows
            .iter()
            .filter(|row| row["id"] == "stdlib-sources")
            .collect::<Vec<_>>();
        if matches.len() != 1 || matches[0]["kind"] != "crate" || matches[0]["digest"] != digest {
            return Err(invalid(
                "captured SDK does not bind this exact source archive",
            ));
        }
    }
    Ok(())
}

fn parse_source(bytes: &[u8], expected: &str) -> Result<Source, PrismError> {
    let text = std::str::from_utf8(bytes).map_err(|_| invalid("SDK model is not UTF-8"))?;
    let header = format!("\\begin{{lexlean}}{{{expected}}}");
    if text.lines().next() != Some(header.as_str()) {
        return Err(invalid(
            "SDK source module name differs from its archive member",
        ));
    }
    let mut imports = Vec::new();
    for line in text.lines() {
        if let Some(module) = line
            .strip_prefix("\\importmodule{")
            .and_then(|s| s.strip_suffix('}'))
        {
            if module.is_empty() || imports.iter().any(|previous| previous == module) {
                return Err(invalid("SDK source imports are empty or duplicated"));
            }
            imports.push(module.to_owned());
        }
    }
    let marker = "\\semanticdata{";
    let positions = text
        .match_indices(marker)
        .map(|(position, _)| position)
        .collect::<Vec<_>>();
    if positions.len() != 1 {
        return Err(invalid("SDK model has absent or ambiguous semantic data"));
    }
    let tail = &text[positions[0] + marker.len()..];
    let (body, _) = tail
        .split_once("\\end{semanticmodule}")
        .ok_or_else(|| invalid("SDK semantic module is unterminated"))?;
    let body = body
        .trim_end()
        .strip_suffix('}')
        .ok_or_else(|| invalid("SDK semantic data is unterminated"))?;
    // LexLean source permits JSON layout inside the macro. The captured source
    // hash binds those bytes; the independently compared typed AST binds meaning.
    let semantic =
        serde_json::from_str::<SnapshotSemanticModule>(body).map_err(|e| invalid(e.to_string()))?;
    Ok(Source {
        digest: content_id(bytes),
        imports,
        semantic,
    })
}

/// This production entry has no caller archive/path/digest parameter.
pub(super) fn capture(
    snapshot: &SemanticSnapshot,
    sdk_lock: &Value,
    system_module: &str,
) -> Result<BTreeMap<String, Source>, PrismError> {
    capture_bytes(
        snapshot,
        sdk_lock,
        system_module,
        crate::sdk::STDLIB_SOURCES,
    )
}

fn capture_bytes(
    snapshot: &SemanticSnapshot,
    sdk_lock: &Value,
    system_module: &str,
    bytes: &[u8],
) -> Result<BTreeMap<String, Source>, PrismError> {
    inventory_binds(sdk_lock, &format!("sha256:{}", content_id(bytes)))?;
    captured_modules(snapshot, system_module, bytes)
}

// A fixture can measure new source without claiming that an older SDK image
// contains it. This type and constructor do not exist in production builds.
#[cfg(test)]
pub(super) struct FixtureSourceBinding {
    snapshot: String,
    system_module: String,
    modules: BTreeSet<String>,
    pub(super) archive: String,
}

#[cfg(test)]
impl FixtureSourceBinding {
    pub(super) fn capture(
        snapshot: &SemanticSnapshot,
        system_module: &str,
    ) -> Result<Self, PrismError> {
        let sources = captured_modules(snapshot, system_module, crate::sdk::STDLIB_SOURCES)?;
        Ok(Self {
            snapshot: content_id(&crate::holo::canonical::encode_value(
                &serde_json::to_value(snapshot).map_err(|e| invalid(e.to_string()))?,
            )?),
            system_module: system_module.to_owned(),
            modules: sources.into_keys().collect(),
            archive: content_id(crate::sdk::STDLIB_SOURCES),
        })
    }

    pub(super) fn modules(
        &self,
        snapshot: &SemanticSnapshot,
        system_module: &str,
    ) -> Result<BTreeSet<String>, PrismError> {
        if self.system_module != system_module
            || self.archive != content_id(crate::sdk::STDLIB_SOURCES)
            || self.snapshot
                != content_id(&crate::holo::canonical::encode_value(
                    &serde_json::to_value(snapshot).map_err(|e| invalid(e.to_string()))?,
                )?)
        {
            return Err(invalid(
                "measured conditional fixture source binding changed",
            ));
        }
        Ok(self.modules.clone())
    }
}

fn captured_modules(
    snapshot: &SemanticSnapshot,
    system_module: &str,
    bytes: &[u8],
) -> Result<BTreeMap<String, Source>, PrismError> {
    let rows = archive_rows(bytes)?;
    // Producer declarations import the source types, not necessarily the SDK's
    // encoder entry. The latter has its own generated-component source closure.
    if !matches!(
        system_module,
        "Production.System" | "Production.BrowserSystem"
    ) {
        return Err(invalid(
            "publication system type is not a supported SDK-owned profile",
        ));
    }
    let mut pending = vec![LINKAGE.to_owned(), system_module.to_owned()];
    let mut sources = BTreeMap::new();
    while let Some(name) = pending.pop() {
        if sources.contains_key(&name) {
            continue;
        }
        let path = format!("stdlib/{}.lex.tex", name.replace('.', "/"));
        let source = parse_source(
            rows.get(&path)
                .ok_or_else(|| invalid(format!("SDK source module {name} is absent")))?,
            &name,
        )?;
        let modules = snapshot
            .modules()
            .iter()
            .filter(|module| module.name() == name)
            .collect::<Vec<_>>();
        if modules.len() != 1 {
            return Err(invalid(
                "SDK source module is absent or ambiguous in the proved snapshot",
            ));
        }
        let module = modules[0];
        let actual_imports = module.imports().iter().cloned().collect::<BTreeSet<_>>();
        let expected_imports = source.imports.iter().cloned().collect::<BTreeSet<_>>();
        if module.source().sha256().to_string() != source.digest
            || module.semantic() != Some(&source.semantic)
            || actual_imports != expected_imports
            || actual_imports.len() != module.imports().len()
        {
            return Err(invalid(
                "proved SDK source bytes, semantic declarations or imports were substituted",
            ));
        }
        let expected = source
            .semantic
            .declarations
            .iter()
            .map(|declaration| {
                Ok((
                    declaration.name().to_owned(),
                    serde_json::to_value(declaration).map_err(|e| invalid(e.to_string()))?,
                ))
            })
            .collect::<Result<BTreeMap<_, _>, PrismError>>()?;
        if module.declarations().len() != expected.len()
            || module.declarations().iter().any(|declaration| {
                expected.get(declaration.logical_id()) != Some(declaration.linked_ir())
            })
        {
            return Err(invalid(
                "snapshot declaration views differ from the SDK source semantics",
            ));
        }
        pending.extend(source.imports.iter().cloned());
        sources.insert(name, source);
    }
    Ok(sources)
}

#[cfg(test)]
mod tests {
    use super::*;
    use lexlean::{CheckRequest, Engine, LockRequest, Selection};
    use serde_json::json;

    fn embedded_snapshot() -> SemanticSnapshot {
        embedded_snapshot_with_publication(false)
    }

    fn embedded_snapshot_with_publication(publication: bool) -> SemanticSnapshot {
        let root = tempfile::tempdir().unwrap();
        let rows = archive_rows(crate::sdk::STDLIB_SOURCES).unwrap();
        assert!(rows.contains_key("stdlib/Production/PublicationAdmission/LinkageV1.lex.tex"));
        assert!(!rows.contains_key("stdlib/src/Production/PublicationAdmission/LinkageV1.lex.tex"));
        for (path, bytes) in rows {
            let Some(path) = path.strip_prefix("stdlib/") else {
                continue;
            };
            if !path.ends_with(".lex.tex") {
                continue;
            }
            let destination = root.path().join("src").join(path);
            std::fs::create_dir_all(destination.parent().unwrap()).unwrap();
            std::fs::write(destination, bytes).unwrap();
        }
        let entrypoints = if publication {
            for (path, bytes) in [
                (
                    "Publication",
                    include_bytes!(
                        "../../../../../tests/publication-context-linkage/src/Publication.lex.tex"
                    )
                    .as_slice(),
                ),
                (
                    "Release",
                    include_bytes!("../../../../../tests/browser-system/Release.lex.tex")
                        .as_slice(),
                ),
                (
                    "Calculator",
                    include_bytes!("../../../../../examples/Calculator/src/Calculator.lex.tex")
                        .as_slice(),
                ),
            ] {
                std::fs::write(root.path().join(format!("src/{path}.lex.tex")), bytes).unwrap();
            }
            "entrypoints = [\"src/Publication.lex.tex\"]"
        } else {
            "entrypoints = [\"src/Production/BrowserSystem.lex.tex\", \"src/Production/PublicationAdmission/LinkageV1.lex.tex\"]"
        };
        let config = include_str!(
            "../../../../../tests/fixtures/library/native-library/project/lexlean.toml"
        )
        .replace(
            "name = \"library-probe\"",
            "name = \"publication-linkage-source-pin\"",
        )
        .replace(
            "module_prefix = \"LibraryProbe\"",
            "module_prefix = \"PrismPM\"",
        )
        .replace("entrypoints = [\"src/Probe.lex.tex\"]", entrypoints);
        std::fs::write(root.path().join("lexlean.toml"), config).unwrap();
        std::fs::write(
            root.path().join("lakefile.toml"),
            "name = \"publication_linkage_source_pin\"\nversion = \"0.1.0\"\n",
        )
        .unwrap();
        std::fs::write(
            root.path().join("lean-toolchain"),
            include_bytes!("../../../../../lean-toolchain"),
        )
        .unwrap();
        let config = camino::Utf8PathBuf::from_path_buf(root.path().join("lexlean.toml")).unwrap();
        let engine = Engine::load(&config).unwrap();
        engine
            .lock(LockRequest {
                check_only: false,
                allow_network: false,
            })
            .unwrap();
        engine
            .check(CheckRequest {
                selection: Selection::Entrypoints,
            })
            .unwrap();
        engine
            .snapshot(CheckRequest {
                selection: Selection::Entrypoints,
            })
            .unwrap()
    }

    fn conditional_lock() -> Value {
        // This is a measured fixture binding only, never an installed SDK claim.
        json!({"schema":"prismpm/sdk-lock/1","inventory":[{
            "id":"stdlib-sources","kind":"crate",
            "digest":format!("sha256:{}",content_id(crate::sdk::STDLIB_SOURCES))
        }]})
    }

    #[test]
    fn actual_embedded_source_archive_binds_actual_compiler_snapshot() {
        let snapshot = embedded_snapshot();
        let sources = capture(&snapshot, &conditional_lock(), "Production.BrowserSystem").unwrap();
        assert!(sources.contains_key(LINKAGE));
        assert!(sources.contains_key(ADMISSION));
        assert!(sources.contains_key("Production.BrowserSystem"));
        assert!(sources.contains_key("Production.Core"));
    }

    #[test]
    fn measured_fixture_binding_cannot_relabel_the_installed_sdk_or_change_snapshot() {
        let snapshot = embedded_snapshot();
        let binding = FixtureSourceBinding::capture(&snapshot, "Production.BrowserSystem").unwrap();
        assert!(binding
            .modules(&snapshot, "Production.BrowserSystem")
            .unwrap()
            .contains(LINKAGE));
        let mut old_lock = conditional_lock();
        old_lock["inventory"][0]["digest"] = json!(format!("sha256:{}", "a".repeat(64)));
        let original = old_lock.clone();
        assert!(capture(&snapshot, &old_lock, "Production.BrowserSystem").is_err());
        assert_eq!(
            old_lock, original,
            "measuring fixture source cannot alter the SDK inventory"
        );
        assert!(binding.modules(&snapshot, "Production.System").is_err());
        let mut changed = serde_json::to_value(&snapshot).unwrap();
        changed["modules"][0]["source"]["sha256"] = json!("b".repeat(64));
        assert!(binding
            .modules(
                &serde_json::from_value(changed).unwrap(),
                "Production.BrowserSystem"
            )
            .is_err());
        assert_eq!(binding.archive, content_id(crate::sdk::STDLIB_SOURCES));
    }

    #[test]
    fn actual_embedded_source_rejects_changed_snapshot_views_and_lock_inventory() {
        let snapshot = embedded_snapshot();
        let original = serde_json::to_value(&snapshot).unwrap();
        for defect in ["source", "semantic", "declaration", "imports"] {
            let mut altered = original.clone();
            let module = altered["modules"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|module| module["name"] == LINKAGE)
                .unwrap();
            match defect {
                "source" => module["source"]["sha256"] = json!("0".repeat(64)),
                "semantic" => {
                    module["semantic"]["declarations"][0]["name"] = json!("ChangedMember")
                }
                "declaration" => {
                    module["declarations"][0]["linked_ir"]["name"] = json!("ChangedMember")
                }
                "imports" => module["imports"]
                    .as_array_mut()
                    .unwrap()
                    .push(json!("Foreign.Module")),
                _ => unreachable!(),
            }
            let altered: SemanticSnapshot = serde_json::from_value(altered).unwrap();
            assert!(
                capture(&altered, &conditional_lock(), "Production.BrowserSystem").is_err(),
                "{defect}"
            );
        }
        for defect in ["missing", "duplicate", "digest", "kind"] {
            let mut lock = conditional_lock();
            match defect {
                "missing" => lock["inventory"] = json!([]),
                "duplicate" => {
                    let row = lock["inventory"][0].clone();
                    lock["inventory"].as_array_mut().unwrap().push(row);
                }
                "digest" => {
                    lock["inventory"][0]["digest"] = json!(format!("sha256:{}", "0".repeat(64)))
                }
                "kind" => lock["inventory"][0]["kind"] = json!("oracle"),
                _ => unreachable!(),
            }
            assert!(
                capture(&snapshot, &lock, "Production.BrowserSystem").is_err(),
                "{defect}"
            );
        }
    }

    #[test]
    fn actual_publication_source_projects_its_unique_closed_typed_value() {
        let snapshot = embedded_snapshot_with_publication(true);
        capture(&snapshot, &conditional_lock(), "Production.BrowserSystem").unwrap();
        let projection = super::super::source::project(&snapshot).unwrap();
        assert_eq!(projection.member.module, "Publication");
        assert_eq!(projection.member.name, "publicationClosure");
        let selected = projection.value.field("system").unwrap().member().unwrap();
        assert_eq!(selected.module, "Release");
        assert_eq!(selected.name, "systemModelB");
        assert_eq!(
            projection.value.field("target").unwrap().text().unwrap(),
            "pages"
        );
        let requirements =
            super::super::rows(projection.value.field("requirements").unwrap(), 64, 4096).unwrap();
        assert_eq!(requirements.len(), 3);
        for requirement in requirements {
            let member = requirement.field("member").unwrap().member().unwrap();
            let super::super::source::Literal::Variant(_, _, fields) =
                requirement.field("requirement").unwrap()
            else {
                panic!("actual typed requirement variant required");
            };
            assert_eq!(fields, &[projection.closed_member(&member).unwrap()]);
        }
    }

    #[test]
    fn changed_retained_source_cannot_omit_duplicate_alias_or_retype_the_closure() {
        let original = serde_json::to_value(embedded_snapshot_with_publication(true)).unwrap();
        for defect in [
            "missing",
            "duplicate",
            "foreign-type",
            "alias-cycle",
            "unknown-alias",
            "missing-field",
            "duplicate-field",
        ] {
            let mut changed = original.clone();
            let module = changed["modules"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|module| module["name"] == "Publication")
                .unwrap();
            let declarations = module["declarations"].as_array_mut().unwrap();
            let index = declarations
                .iter()
                .position(|declaration| declaration["logical_id"] == "publicationClosure")
                .unwrap();
            match defect {
                "missing" => {
                    declarations.remove(index);
                }
                "duplicate" => {
                    let mut duplicate = declarations[index].clone();
                    duplicate["logical_id"] = json!("secondClosure");
                    duplicate["linked_ir"]["name"] = json!("secondClosure");
                    declarations.push(duplicate);
                }
                "foreign-type" => {
                    declarations[index]["linked_ir"]["result"]["member"]["module"] =
                        json!("Foreign")
                }
                "alias-cycle" | "unknown-alias" => {
                    declarations[index]["linked_ir"]["body"] = json!({
                        "kind":"call", "function":{"name":if defect == "alias-cycle" { "publicationClosure" } else { "absentClosure" }}, "arguments":[]
                    })
                }
                "missing-field" => {
                    declarations[index]["linked_ir"]["body"]["fields"]
                        .as_array_mut()
                        .unwrap()
                        .pop();
                }
                "duplicate-field" => {
                    let fields = declarations[index]["linked_ir"]["body"]["fields"]
                        .as_array_mut()
                        .unwrap();
                    fields[1] = fields[0].clone();
                }
                _ => unreachable!(),
            }
            let changed: SemanticSnapshot = serde_json::from_value(changed).unwrap();
            assert!(super::super::source::project(&changed).is_err(), "{defect}");
        }
    }
}
