//! The full input lock, `prismpm/sdk-lock/3` (docs/proposals/264-input-lock.md).
//!
//! A `/3` lock is a `/2` SDK lock plus one closed `inputs` object. Every SDK
//! reader receives the `/2` projection, so the SDK rules stay in one place.
//! Builds recompute `inputs` and refuse a committed lock that disagrees,
//! unless the caller explicitly asked to update it.

use crate::contracts::CanonicalDocument;
use crate::error::PrismError;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::Write;
use std::path::{Component, Path, PathBuf};

pub(crate) const SDK_LOCK_V1: &str = "prismpm/sdk-lock/1";
pub(crate) const SDK_LOCK_V2: &str = "prismpm/sdk-lock/2";
pub(crate) const SDK_LOCK_V3: &str = "prismpm/sdk-lock/3";

/// The Rust toolchain inside the SDK image (`tools.lock` `[rust]`).
const RUSTC_VERSION: &str = "1.97.1";
/// The wasm-bindgen CLI inside the SDK image (`tools.lock` `[sdk-tools]`).
const WASM_BINDGEN_VERSION: &str = "0.2.122";
/// The only guest contract today, and the digests of its committed WIT world
/// (`sdk/npm/spec/worlds/core-wasm.wit`). A test recomputes both.
const CORE_WASM_CONTRACT: &str = "hologram:guest/core-wasm@1";
const CORE_WASM_WORLD_BLAKE3: &str =
    "0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8";
const CORE_WASM_WORLD_SHA256: &str =
    "a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369";

const SPEC_DOMAIN: &[u8] = b"prismpm/spec-inputs/1\n";
const SPEC_MAX_FILES: usize = 4096;
const SPEC_MAX_BYTES: u64 = 512 * 1024 * 1024;
const SPEC_TREES: [&str; 3] = ["examples", "intent", "types"];

/// Everything a build knows that the input lock pins.
pub(crate) struct InputSources<'a> {
    pub(crate) root: &'a Path,
    pub(crate) lexlean_project: &'a str,
    pub(crate) model_bytes: &'a [u8],
    pub(crate) core_contract: Option<&'a str>,
    pub(crate) application_generator_sha256: String,
    pub(crate) library_generator_sha256: String,
}

/// The `/2` SDK lock inside a `/3` lock: drop `inputs`, rename the schema.
pub(crate) fn sdk_projection(lock: &Value) -> Value {
    let mut value = lock.clone();
    if let Some(object) = value.as_object_mut() {
        object.remove("inputs");
        object.insert("schema".to_owned(), Value::String(SDK_LOCK_V2.to_owned()));
    }
    value
}

/// Recompute the `inputs` object from the project and the prepared model.
pub(crate) fn compute(sources: &InputSources<'_>) -> Result<Value, PrismError> {
    let (basis, files) = spec_files(sources.root, sources.lexlean_project)?;
    Ok(json!({
        "generation": {
            "application_generator_sha256": sources.application_generator_sha256,
            "library_generator_sha256": sources.library_generator_sha256
        },
        "model": digest_set(sources.model_bytes),
        "spec": {"basis": basis, "blake3": spec_digest(&files)},
        "toolchain": toolchain(),
        "world": world(sources.core_contract)?
    }))
}

/// Check the committed lock against the build's inputs, or rewrite them.
///
/// `compute` runs only when a lock pins inputs or `update` is set, so an
/// absent, `/1` or `/2` lock keeps its exact pre-`/3` behavior.
pub(crate) fn enforce(
    root: &Path,
    update: bool,
    compute: impl FnOnce() -> Result<Value, PrismError>,
) -> Result<(), PrismError> {
    let committed = crate::sdk::committed_lock(root)?;
    match reconcile(committed.as_ref().map(|(lock, _)| lock), update, compute)? {
        Some(lock) => {
            let original = committed
                .as_ref()
                .map(|(_, bytes)| bytes.as_slice())
                .expect("only a committed lock is rewritten");
            write_lock(root, original, &lock)
        }
        None => Ok(()),
    }
}

/// Decide what a build does with the committed lock. `Some` is the lock to write.
fn reconcile(
    committed: Option<&CanonicalDocument>,
    update: bool,
    compute: impl FnOnce() -> Result<Value, PrismError>,
) -> Result<Option<CanonicalDocument>, PrismError> {
    let Some(lock) = committed else {
        return if update {
            Err(PrismError::new(
                "PP5401",
                "prismpm build --update pins inputs into an SDK lock, but prismpm.lock is absent",
            ))
        } else {
            Ok(None)
        };
    };
    match lock.schema() {
        SDK_LOCK_V1 if update => Err(PrismError::new(
            "PP5401",
            "prismpm.lock is a legacy prismpm/sdk-lock/1; run `prismpm lock migrate` to reach /2 before `prismpm build --update`",
        )),
        SDK_LOCK_V2 if update => with_inputs(lock.value(), compute()?).map(Some),
        SDK_LOCK_V3 => {
            let current = compute()?;
            let changed = changed_fields(&lock.value()["inputs"], &current);
            if changed.is_empty() {
                Ok(None)
            } else if update {
                with_inputs(lock.value(), current).map(Some)
            } else {
                Err(PrismError::new(
                    "PP5401",
                    format!(
                        "prismpm.lock is stale: {} changed; run `prismpm build --update` and commit prismpm.lock",
                        changed.join(", ")
                    ),
                ))
            }
        }
        _ => Ok(None),
    }
}

/// The `inputs.<field>` names whose values differ, in field order.
fn changed_fields(locked: &Value, current: &Value) -> Vec<String> {
    let mut names = BTreeSet::new();
    for value in [locked, current] {
        if let Some(object) = value.as_object() {
            names.extend(object.keys().cloned());
        }
    }
    names
        .into_iter()
        .filter(|name| locked.get(name) != current.get(name))
        .map(|name| format!("inputs.{name}"))
        .collect()
}

/// A `/3` lock with every SDK field of `lock` and the given `inputs`.
fn with_inputs(lock: &Value, inputs: Value) -> Result<CanonicalDocument, PrismError> {
    let mut value = lock.clone();
    let object = value
        .as_object_mut()
        .ok_or_else(|| PrismError::new("PP5401", "prismpm.lock is not a JSON object"))?;
    object.insert("inputs".to_owned(), inputs);
    object.insert("schema".to_owned(), Value::String(SDK_LOCK_V3.to_owned()));
    CanonicalDocument::from_value(SDK_LOCK_V3, value)
}

/// Replace `prismpm.lock` atomically, never over bytes this build did not read.
fn write_lock(root: &Path, original: &[u8], lock: &CanonicalDocument) -> Result<(), PrismError> {
    let failed = |error: std::io::Error| {
        PrismError::new("PP5401", format!("cannot update prismpm.lock: {error}"))
    };
    let path = root.join("prismpm.lock");
    let permissions = std::fs::metadata(&path).map_err(failed)?.permissions();
    let mut staged = tempfile::Builder::new()
        .prefix(".prismpm.lock.")
        .tempfile_in(root)
        .map_err(failed)?;
    staged.write_all(lock.bytes()).map_err(failed)?;
    staged.as_file().sync_all().map_err(failed)?;
    std::fs::set_permissions(staged.path(), permissions).map_err(failed)?;
    if std::fs::read(&path).map_err(failed)? != original {
        return Err(PrismError::new(
            "PP5401",
            "prismpm.lock changed while the build was running; rerun the build",
        ));
    }
    staged.persist(&path).map_err(|error| failed(error.error))?;
    Ok(())
}

fn digest_set(bytes: &[u8]) -> Value {
    json!({
        "blake3": blake3::hash(bytes).to_hex().to_string(),
        "sha256": format!("{:x}", Sha256::digest(bytes))
    })
}

fn toolchain() -> Value {
    json!({
        "lean": format!("v{}", lexlean::LEAN_VERSION),
        "lexlean": lexlean::COMPILER_VERSION,
        "prismpm": env!("CARGO_PKG_VERSION"),
        "rustc": RUSTC_VERSION,
        "wasm_bindgen": WASM_BINDGEN_VERSION
    })
}

fn world(core_contract: Option<&str>) -> Result<Value, PrismError> {
    match core_contract {
        None => Ok(Value::Null),
        Some(CORE_WASM_CONTRACT) => Ok(json!({
            "blake3": CORE_WASM_WORLD_BLAKE3,
            "contract": CORE_WASM_CONTRACT,
            "sha256": CORE_WASM_WORLD_SHA256
        })),
        Some(other) => Err(PrismError::new(
            "PP5401",
            format!("no pinned WIT world for guest contract {other}"),
        )),
    }
}

/// BLAKE3 over the domain, then each file as (u32 path length, path, u64
/// content length, content) in bytewise path order.
fn spec_digest(files: &BTreeMap<String, Vec<u8>>) -> String {
    let mut hasher = blake3::Hasher::new();
    hasher.update(SPEC_DOMAIN);
    for (path, bytes) in files {
        let length = u32::try_from(path.len()).expect("spec paths are bounded");
        hasher.update(&length.to_be_bytes());
        hasher.update(path.as_bytes());
        hasher.update(&(bytes.len() as u64).to_be_bytes());
        hasher.update(bytes);
    }
    hasher.finalize().to_hex().to_string()
}

/// The authored file set and its basis: `prism.toml` with its trees when it
/// exists, else the model's own sources outside SDK-installed roots.
fn spec_files(
    root: &Path,
    lexlean_project: &str,
) -> Result<(&'static str, BTreeMap<String, Vec<u8>>), PrismError> {
    let mut files = SpecFiles::default();
    if exists(&root.join("prism.toml"))? {
        files.add(root, "prism.toml")?;
        for tree in SPEC_TREES {
            if exists(&root.join(tree))? {
                files.walk(root, tree, |_| true)?;
            }
        }
        return Ok(("prism-toml", files.files));
    }
    if exists(&root.join("prismpm.toml"))? {
        files.add(root, "prismpm.toml")?;
    }
    let project = normalize(lexlean_project)?;
    let project_bytes = files.add(root, &project)?;
    let text = std::str::from_utf8(&project_bytes)
        .map_err(|_| invalid(format!("{project} is not UTF-8")))?;
    let config: toml::Value = text
        .parse()
        .map_err(|error| invalid(format!("{project}: {error}")))?;
    let base = Path::new(&project)
        .parent()
        .map(Path::to_path_buf)
        .unwrap_or_default();
    let relative = |entry: &str| -> Result<String, PrismError> {
        normalize(&base.join(entry).to_string_lossy().replace('\\', "/"))
    };
    if let Some(lockfile) = config.get("lockfile").and_then(toml::Value::as_str) {
        let lockfile = relative(lockfile)?;
        if exists(&root.join(&lockfile))? {
            files.add(root, &lockfile)?;
        }
    }
    let roots = config
        .get("source_roots")
        .and_then(toml::Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(toml::Value::as_str);
    for source_root in roots {
        let source_root = relative(source_root)?;
        if source_root.starts_with('.') || !exists(&root.join(&source_root))? {
            continue;
        }
        files.walk(root, &source_root, |path| path.ends_with(".lex.tex"))?;
    }
    Ok(("model-sources", files.files))
}

#[derive(Default)]
struct SpecFiles {
    files: BTreeMap<String, Vec<u8>>,
    bytes: u64,
}

impl SpecFiles {
    /// Read one regular, non-symlink file at a normalized relative path.
    fn add(&mut self, root: &Path, relative: &str) -> Result<Vec<u8>, PrismError> {
        let path = root.join(relative);
        let metadata = std::fs::symlink_metadata(&path)
            .map_err(|error| invalid(format!("{relative}: {error}")))?;
        if !metadata.is_file() {
            return Err(invalid(format!(
                "{relative} must be a regular file, not a symlink or another node"
            )));
        }
        self.bytes = self.bytes.saturating_add(metadata.len());
        if self.files.len() >= SPEC_MAX_FILES || self.bytes > SPEC_MAX_BYTES {
            return Err(PrismError::new(
                "PP7601",
                format!("spec inputs exceed {SPEC_MAX_FILES} files or {SPEC_MAX_BYTES} bytes"),
            ));
        }
        let bytes =
            std::fs::read(&path).map_err(|error| invalid(format!("{relative}: {error}")))?;
        self.files.insert(relative.to_owned(), bytes.clone());
        Ok(bytes)
    }

    /// Add every selected regular file below a directory; refuse symlinks.
    fn walk(
        &mut self,
        root: &Path,
        directory: &str,
        select: impl Fn(&str) -> bool + Copy,
    ) -> Result<(), PrismError> {
        let metadata = std::fs::symlink_metadata(root.join(directory))
            .map_err(|error| invalid(format!("{directory}: {error}")))?;
        if !metadata.is_dir() {
            return Err(invalid(format!(
                "{directory} must be a directory, not a symlink or another node"
            )));
        }
        let mut entries = std::fs::read_dir(root.join(directory))
            .map_err(|error| invalid(format!("{directory}: {error}")))?
            .map(|entry| entry.map(|entry| entry.path()))
            .collect::<Result<Vec<PathBuf>, _>>()
            .map_err(|error| invalid(format!("{directory}: {error}")))?;
        entries.sort();
        for entry in entries {
            let name = entry
                .file_name()
                .and_then(|name| name.to_str())
                .ok_or_else(|| invalid(format!("{directory} holds a non-UTF-8 name")))?;
            let relative = format!("{directory}/{name}");
            let kind = std::fs::symlink_metadata(&entry)
                .map_err(|error| invalid(format!("{relative}: {error}")))?
                .file_type();
            if kind.is_dir() {
                self.walk(root, &relative, select)?;
            } else if kind.is_file() {
                if select(&relative) {
                    self.add(root, &relative)?;
                }
            } else {
                return Err(invalid(format!(
                    "{relative} must be a regular file or directory, not a symlink or another node"
                )));
            }
        }
        Ok(())
    }
}

fn exists(path: &Path) -> Result<bool, PrismError> {
    match std::fs::symlink_metadata(path) {
        Ok(_) => Ok(true),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(invalid(format!("{}: {error}", path.display()))),
    }
}

/// A project-relative path with `/` separators that cannot escape the root.
fn normalize(path: &str) -> Result<String, PrismError> {
    let mut parts = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(part) => parts.push(
                part.to_str()
                    .ok_or_else(|| invalid(format!("{path} is not UTF-8")))?
                    .to_owned(),
            ),
            Component::CurDir => {}
            _ => return Err(invalid(format!("{path} escapes the project root"))),
        }
    }
    if parts.is_empty() {
        return Err(invalid(format!("{path} names no file")));
    }
    Ok(parts.join("/"))
}

fn invalid(message: String) -> PrismError {
    PrismError::new("PP5401", format!("input lock: {message}"))
}

/// A well-formed `inputs` value for tests in this crate.
#[cfg(test)]
pub(crate) fn sample_inputs() -> Value {
    json!({
        "generation": {
            "application_generator_sha256": "1".repeat(64),
            "library_generator_sha256": "2".repeat(64)
        },
        "model": digest_set(b"model"),
        "spec": {"basis": "model-sources", "blake3": spec_digest(&BTreeMap::new())},
        "toolchain": toolchain(),
        "world": world(Some(CORE_WASM_CONTRACT)).unwrap()
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn manifest_dir() -> PathBuf {
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
    }

    fn write(root: &Path, relative: &str, bytes: &[u8]) {
        let path = root.join(relative);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, bytes).unwrap();
    }

    fn calculator_like(root: &Path) {
        write(root, "prismpm.toml", b"spec = \"prismpm/project/1\"\n");
        write(
            root,
            "lexlean.toml",
            b"source_roots = [\".prism/sdk/inputs/stdlib\", \"src\"]\nlockfile = \"lexlean.lock\"\n",
        );
        write(root, "lexlean.lock", b"spec = \"lexlean/lock/2\"\n");
        write(root, "src/Calculator.lex.tex", b"model");
        write(root, "src/nested/More.lex.tex", b"more");
        write(root, "src/lib.rs", b"// not a model source");
        write(root, ".prism/sdk/inputs/stdlib/Std.lex.tex", b"sdk");
    }

    /// A `/2` lock value accepted by the platform rules, built like `sdk::tests`.
    fn platform_lock() -> Value {
        let digest = |value: &[u8]| format!("sha256:{:x}", Sha256::digest(value));
        let mut manifests = Vec::new();
        let mut platforms = Vec::new();
        for architecture in ["amd64", "arm64"] {
            let manifest = digest(format!("{architecture}/manifest").as_bytes());
            let inventory = json!([{"id":"prismpm","kind":"binary","version":"0.3.0",
                "digest":digest(format!("{architecture}/binary").as_bytes())}]);
            let document = serde_json::to_string(
                &json!({"schema":"prismpm/sdk-inventory/1","artifacts":inventory}),
            )
            .unwrap();
            manifests.push(json!({"mediaType":"application/vnd.oci.image.manifest.v1+json",
                "digest":manifest,"size":100,"platform":{"os":"linux","architecture":architecture}}));
            platforms.push(json!({"platform":format!("linux/{architecture}"),"manifest_digest":manifest,
                "inventory_digest":digest(document.as_bytes()),"inventory_document":document,"inventory":inventory}));
        }
        let index = serde_json::to_string(&json!({"schemaVersion":2,
            "mediaType":"application/vnd.oci.image.index.v1+json","manifests":manifests}))
        .unwrap();
        json!({"schema":SDK_LOCK_V2,"sdk_version":"0.3.0",
            "sdk_image":format!("example.invalid/test-sdk@{}", digest(index.as_bytes())),
            "sdk_index":index,"standards_lock":digest(b"standards"),"platforms":platforms})
    }

    #[test]
    fn spec_digest_matches_the_reference_vectors_and_ignores_insertion_order() {
        assert_eq!(
            spec_digest(&BTreeMap::new()),
            "38270f9a684133fd4a9e08731bd9d24b9e90cc92eb757b6fb548ca33589a361b"
        );
        let mut files = BTreeMap::new();
        files.insert("b.lex.tex".to_owned(), b"B".to_vec());
        files.insert("a/prismpm.toml".to_owned(), b"A\n".to_vec());
        assert_eq!(
            spec_digest(&files),
            "fc0cc56804659d03cdf3e6a74ab4053a7037a24b4f8c24ab02c050b0c9bad798"
        );
        files.insert("b.lex.tex".to_owned(), b"C".to_vec());
        assert_ne!(
            spec_digest(&files),
            "fc0cc56804659d03cdf3e6a74ab4053a7037a24b4f8c24ab02c050b0c9bad798"
        );
    }

    #[test]
    fn toolchain_pins_equal_tools_lock_and_the_vendored_compiler() {
        let text = std::fs::read_to_string(manifest_dir().join("../../tools.lock")).unwrap();
        let tools: toml::Value = text.parse().unwrap();
        let pinned = toolchain();
        assert_eq!(pinned["rustc"], tools["rust"]["version"].as_str().unwrap());
        assert_eq!(
            pinned["wasm_bindgen"],
            tools["sdk-tools"]["wasm_bindgen_cli"].as_str().unwrap()
        );
        assert_eq!(pinned["lean"], tools["lean"]["version"].as_str().unwrap());
        assert_eq!(
            lexlean::LEAN_TOOLCHAIN,
            format!("leanprover/lean4:{}", pinned["lean"].as_str().unwrap())
        );
        assert_eq!(pinned["lexlean"], "0.3.0");
    }

    #[test]
    fn world_digests_equal_the_committed_wit_file() {
        let path = manifest_dir().join("../../sdk/npm/spec/worlds/core-wasm.wit");
        let text = std::fs::read_to_string(path).unwrap().replace("\r\n", "\n");
        let pinned = world(Some(CORE_WASM_CONTRACT)).unwrap();
        let actual = digest_set(text.as_bytes());
        assert_eq!(pinned["blake3"], actual["blake3"]);
        assert_eq!(pinned["sha256"], actual["sha256"]);
        assert_eq!(world(None).unwrap(), Value::Null);
        assert_eq!(
            world(Some("hologram:guest/core-wasm@2")).unwrap_err().code,
            "PP5401"
        );
    }

    #[test]
    fn model_sources_cover_project_files_and_local_model_sources_only() {
        let root = tempfile::tempdir().unwrap();
        calculator_like(root.path());
        let (basis, files) = spec_files(root.path(), "lexlean.toml").unwrap();
        assert_eq!(basis, "model-sources");
        assert_eq!(
            files.keys().map(String::as_str).collect::<Vec<_>>(),
            [
                "lexlean.lock",
                "lexlean.toml",
                "prismpm.toml",
                "src/Calculator.lex.tex",
                "src/nested/More.lex.tex"
            ]
        );
        let before = spec_digest(&files);
        write(root.path(), "src/lib.rs", b"// edits outside the model");
        write(
            root.path(),
            ".prism/sdk/inputs/stdlib/Std.lex.tex",
            b"new sdk",
        );
        assert_eq!(
            spec_digest(&spec_files(root.path(), "lexlean.toml").unwrap().1),
            before
        );
        write(root.path(), "src/Calculator.lex.tex", b"edited model");
        assert_ne!(
            spec_digest(&spec_files(root.path(), "lexlean.toml").unwrap().1),
            before
        );
    }

    #[test]
    fn prism_toml_switches_the_basis_to_the_authored_trees() {
        let root = tempfile::tempdir().unwrap();
        calculator_like(root.path());
        write(root.path(), "prism.toml", b"name = \"calculator\"\n");
        write(root.path(), "examples/add.json", b"{}");
        write(root.path(), "intent/README.md", b"intent");
        let (basis, files) = spec_files(root.path(), "lexlean.toml").unwrap();
        assert_eq!(basis, "prism-toml");
        assert_eq!(
            files.keys().map(String::as_str).collect::<Vec<_>>(),
            ["examples/add.json", "intent/README.md", "prism.toml"]
        );
    }

    #[test]
    fn configured_paths_cannot_escape_the_project() {
        for path in ["../outside", "/etc/passwd", "", "."] {
            assert_eq!(normalize(path).unwrap_err().code, "PP5401", "{path}");
        }
        assert_eq!(normalize("./src/../src").unwrap_err().code, "PP5401");
        assert_eq!(normalize("./src/a.lex.tex").unwrap(), "src/a.lex.tex");
    }

    #[cfg(unix)]
    #[test]
    fn a_symlink_in_the_spec_set_is_refused() {
        let root = tempfile::tempdir().unwrap();
        calculator_like(root.path());
        std::os::unix::fs::symlink(
            root.path().join("src/Calculator.lex.tex"),
            root.path().join("src/Alias.lex.tex"),
        )
        .unwrap();
        assert_eq!(
            spec_files(root.path(), "lexlean.toml").unwrap_err().code,
            "PP5401"
        );
    }

    #[test]
    fn staleness_names_exactly_the_changed_fields() {
        let locked = sample_inputs();
        assert!(changed_fields(&locked, &locked).is_empty());
        let mut current = locked.clone();
        current["model"] = digest_set(b"edited model");
        current["spec"]["blake3"] = json!("f".repeat(64));
        assert_eq!(
            changed_fields(&locked, &current),
            ["inputs.model", "inputs.spec"]
        );
    }

    #[test]
    fn a_v3_lock_projects_to_the_exact_v2_lock() {
        let v2 = CanonicalDocument::from_value(SDK_LOCK_V2, platform_lock()).unwrap();
        let v3 = with_inputs(v2.value(), sample_inputs()).unwrap();
        assert_eq!(v3.schema(), SDK_LOCK_V3);
        let projected = crate::sdk::parse_lock(v3.bytes()).unwrap();
        assert_eq!(projected.schema(), SDK_LOCK_V2);
        assert_eq!(projected.bytes(), v2.bytes());
        assert_eq!(projected.digest(), v2.digest());
        let full = crate::sdk::parse_full_lock(v3.bytes()).unwrap();
        assert_eq!(full.bytes(), v3.bytes());
        let mut broken = v3.value().clone();
        broken["sdk_image"] = json!(format!(
            "example.invalid/test-sdk@sha256:{}",
            "0".repeat(64)
        ));
        assert!(CanonicalDocument::from_value(SDK_LOCK_V3, broken.clone()).is_err());
        assert!(
            crate::sdk::parse_lock(&crate::holo::canonical::encode_value(&broken).unwrap())
                .is_err()
        );
    }

    #[test]
    fn reconcile_keeps_old_locks_unchanged_and_refuses_stale_inputs() {
        let never = || -> Result<Value, PrismError> { panic!("inputs must not be computed") };
        assert!(reconcile(None, false, never).unwrap().is_none());
        assert_eq!(reconcile(None, true, never).unwrap_err().code, "PP5401");
        let v2 = CanonicalDocument::from_value(SDK_LOCK_V2, platform_lock()).unwrap();
        assert!(reconcile(Some(&v2), false, never).unwrap().is_none());
        let upgraded = reconcile(Some(&v2), true, || Ok(sample_inputs()))
            .unwrap()
            .unwrap();
        assert_eq!(upgraded.schema(), SDK_LOCK_V3);
        assert_eq!(upgraded.value()["inputs"], sample_inputs());
        assert!(reconcile(Some(&upgraded), false, || Ok(sample_inputs()))
            .unwrap()
            .is_none());
        let mut edited = sample_inputs();
        edited["model"] = digest_set(b"edited model");
        let error = reconcile(Some(&upgraded), false, || Ok(edited.clone())).unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(
            error.message.contains("inputs.model changed"),
            "{}",
            error.message
        );
        let refreshed = reconcile(Some(&upgraded), true, || Ok(edited.clone()))
            .unwrap()
            .unwrap();
        assert_eq!(refreshed.value()["inputs"], edited);
        assert_eq!(
            sdk_projection(refreshed.value()),
            sdk_projection(upgraded.value())
        );
    }

    #[test]
    fn a_legacy_lock_builds_unchanged_but_cannot_be_updated() {
        let never = || -> Result<Value, PrismError> { panic!("inputs must not be computed") };
        let digest = format!("sha256:{}", "a".repeat(64));
        let legacy = CanonicalDocument::from_value(
            SDK_LOCK_V1,
            json!({"schema":SDK_LOCK_V1,"sdk_version":"0.3.0",
                "sdk_image":format!("example.invalid/test-sdk@{digest}"),
                "standards_lock":format!("sha256:{}", "b".repeat(64)),
                "inventory":[{"id":"sdk-manifest","kind":"image","version":"0.3.0","digest":digest}]}),
        )
        .unwrap();
        assert!(reconcile(Some(&legacy), false, never).unwrap().is_none());
        let error = reconcile(Some(&legacy), true, never).unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(error.message.contains("lock migrate"));
    }

    #[test]
    fn update_writes_atomically_and_refuses_a_concurrent_edit() {
        let root = tempfile::tempdir().unwrap();
        let v2 = CanonicalDocument::from_value(SDK_LOCK_V2, platform_lock()).unwrap();
        let path = root.path().join("prismpm.lock");
        std::fs::write(&path, v2.bytes()).unwrap();
        let v3 = with_inputs(v2.value(), sample_inputs()).unwrap();
        write_lock(root.path(), v2.bytes(), &v3).unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), v3.bytes());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        let error = write_lock(root.path(), v2.bytes(), &v3).unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert_eq!(std::fs::read(&path).unwrap(), v3.bytes());
        assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
    }
}
