//! SDK inventory validation and locked consumer-input installation.

use crate::contracts::CanonicalDocument;
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
pub use crate::supply_chain::{
    validate_sdk_security_disposition, GraphBinding, LauncherBinding, LockBinding,
    PlatformInventoryBinding, RuntimeBinding, SdkAdvisoryPolicy, SdkSecurityDisposition,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::collections::{BTreeMap, BTreeSet};
use std::io::{Cursor, Read};
use std::path::PathBuf;
use std::path::{Component, Path};

mod executable_file;
mod executable_inventory;
pub(crate) use executable_file::ExecutableFile;

pub(crate) const STDLIB_SOURCES: &[u8] = include_bytes!("../sdk/stdlib-sources.tar");
const RELEASED_INVENTORY: &str = "/opt/prismpm/share/inventory.json";
const SDK_INVENTORY_MAX_BYTES: usize = 8 * 1024 * 1024;
const SDK_INDEX_MAX_BYTES: usize = 1024 * 1024;
// Two exact inventory documents can double when JSON-string escaped, and
// their artifact rows also appear separately. Allow the bounded index and
// envelope too; the per-document limits are still enforced independently.
const SDK_CAPTURE_MAX_BYTES: usize = 64 * 1024 * 1024;

pub(crate) fn exporter_seed_manifest_bytes() -> Result<Vec<u8>, PrismError> {
    read_metadata(
        Path::new("/opt/prismpm/share/exporter-seed/manifest.json"),
        SDK_INVENTORY_MAX_BYTES,
        "PP5008",
    )
}

// Apply wire limits before allocation as well as during reading. Metadata is
// never executable: aliases, hard links and replacements cannot supply it.
fn read_metadata(
    path: &Path,
    limit: usize,
    limit_code: &'static str,
) -> Result<Vec<u8>, PrismError> {
    let invalid = || PrismError::new("PP5401", "SDK metadata must be an unchanged regular file");
    let oversized = || {
        PrismError::new(
            limit_code,
            format!("SDK metadata exceeds its {limit} byte limit"),
        )
    };
    let before = std::fs::symlink_metadata(path).map_err(|_| invalid())?;
    if !before.is_file() {
        return Err(invalid());
    }
    if before.len() > limit as u64 {
        return Err(oversized());
    }
    let mut options = std::fs::OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
        if before.nlink() != 1 {
            return Err(invalid());
        }
        options.custom_flags(
            (rustix::fs::OFlags::NOFOLLOW | rustix::fs::OFlags::NONBLOCK).bits() as i32,
        );
    }
    let same = |after: &std::fs::Metadata| {
        let common = after.is_file()
            && after.len() == before.len()
            && after.modified().ok() == before.modified().ok();
        #[cfg(unix)]
        {
            use std::os::unix::fs::MetadataExt;
            common
                && after.dev() == before.dev()
                && after.ino() == before.ino()
                && after.nlink() == 1
                && after.mode() == before.mode()
                && after.ctime() == before.ctime()
                && after.ctime_nsec() == before.ctime_nsec()
        }
        #[cfg(not(unix))]
        {
            common
        }
    };
    let mut file = options.open(path).map_err(|_| invalid())?;
    if !same(&file.metadata().map_err(|_| invalid())?) {
        return Err(invalid());
    }
    let mut bytes = Vec::new();
    (&mut file)
        .take(limit as u64 + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| invalid())?;
    if bytes.len() > limit {
        return Err(oversized());
    }
    if bytes.len() as u64 != before.len()
        || !same(&file.metadata().map_err(|_| invalid())?)
        || !same(&std::fs::symlink_metadata(path).map_err(|_| invalid())?)
    {
        return Err(invalid());
    }
    Ok(bytes)
}

fn select_inventory_path(
    released: &Path,
    installed_marker: &Path,
    configured: Option<PathBuf>,
) -> Option<PathBuf> {
    // The fixed installed SDK wins even when its inventory is missing or
    // malformed: deleting it must not turn a released image into bootstrap.
    if installed_marker.exists() || released.exists() {
        return Some(released.to_owned());
    }
    configured
}

pub(crate) fn inventory_path() -> Option<PathBuf> {
    select_inventory_path(
        Path::new(RELEASED_INVENTORY),
        Path::new("/etc/profile.d/prismpm-sdk.sh"),
        std::env::var_os("PRISMPM_SDK_INVENTORY").map(PathBuf::from),
    )
}

fn executable_digest(selected: &Path, resolved: &Path) -> std::io::Result<String> {
    let mut file = ExecutableFile::open(resolved)?;
    let digest = file.sha256()?;
    file.verify_reference(selected)?;
    Ok(digest)
}

fn executable_inventory() -> Result<serde_json::Value, PrismError> {
    let path =
        std::env::var_os("PATH").ok_or_else(|| PrismError::new("PP5401", "SDK PATH is absent"))?;
    executable_inventory::inventory(&path)
}

/// Verify that the current executable search path is exactly the signed SDK inventory.
///
/// Source-bootstrap environments have no inventory file and are verified by the
/// repository's independently pinned native gate. A released image discovers its
/// fixed inventory even if a caller removes or overrides the convenience variable.
pub fn verify_environment() -> Result<Option<serde_json::Value>, PrismError> {
    let Some(path) = inventory_path() else {
        return Ok(None);
    };
    let bytes = read_metadata(&path, SDK_INVENTORY_MAX_BYTES, "PP5401")?;
    let value: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|error| PrismError::new("PP5401", format!("SDK inventory: {error}")))?;
    let mut canonical = encode_value(&value)?;
    canonical.push(b'\n');
    if canonical != bytes {
        return Err(PrismError::new("PP5401", "SDK inventory is not canonical"));
    }
    let observed = executable_inventory()?;
    if observed["commands"] != value["commands"]
        || value["schema"] != "prismpm/sdk-inventory/1"
        || value["artifacts"].as_array().is_none_or(|rows| {
            rows.is_empty()
                || rows.windows(2).any(|pair| {
                    pair[0]["id"].as_str().is_none_or(|left| {
                        pair[1]["id"]
                            .as_str()
                            .is_none_or(|right| left.as_bytes() >= right.as_bytes())
                    })
                })
                || rows.iter().any(|row| {
                    row.as_object().is_none_or(|object| {
                        object
                            .keys()
                            .map(String::as_str)
                            .ne(["digest", "id", "kind", "version"])
                    }) || row["digest"].as_str().is_none_or(|digest| {
                        digest.len() != 71
                            || !digest.starts_with("sha256:")
                            || !digest[7..]
                                .bytes()
                                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
                    }) || row["id"].as_str().is_none_or(str::is_empty)
                        || row["kind"].as_str().is_none_or(str::is_empty)
                        || row["version"].as_str().is_none_or(str::is_empty)
                })
        })
    {
        return Err(PrismError::new(
            "PP5401",
            "SDK inventory or PATH contains missing, changed, shadowed, undeclared, or noncanonical content",
        ));
    }
    Ok(Some(json!({
        "inventory_sha256":format!("{:x}",Sha256::digest(&bytes)),
        "schema":"prismpm/sdk-verification/1",
        "verified":true
    })))
}

/// Resolve one command from the already verified SDK PATH.
///
/// Released images always carry the fixed inventory file; source bootstrap
/// environments are governed by the independently pinned repository gate.
pub fn executable(command: &str) -> Result<PathBuf, PrismError> {
    let [selected] = executables([command])?;
    Ok(selected)
}

fn validate_command(command: &str) -> Result<(), PrismError> {
    if command.is_empty()
        || command.len() > 128
        || !command
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.'))
    {
        return Err(PrismError::new("PP5401", "SDK command name is malformed"));
    }
    Ok(())
}

// Resolve adjacent lookups using one fresh inventory before their first child.
// Nothing is retained across calls; each selected command is still freshly
// hashed and checked against the signed inventory by resolve_executable.
pub(crate) fn executables<const N: usize>(commands: [&str; N]) -> Result<[PathBuf; N], PrismError> {
    for command in commands {
        validate_command(command)?;
    }
    let inventory_path = inventory_path();
    let inventory = verify_environment()?;
    let mut selected = std::array::from_fn(|_| PathBuf::new());
    for (command, result) in commands.into_iter().zip(&mut selected) {
        *result = resolve_executable(command, inventory_path.as_deref(), inventory.is_some())?;
    }
    // A batch closes with another complete fresh byte inventory before its
    // caller can spawn any child. Never substitute cached hashes or metadata
    // for this closing verification, or retain a barrier across execution.
    if N > 1 && inventory.is_some() {
        verify_environment()?;
    }
    Ok(selected)
}

fn resolve_executable(
    command: &str,
    inventory_path: Option<&Path>,
    verified: bool,
) -> Result<PathBuf, PrismError> {
    let candidate = std::env::split_paths(&std::env::var_os("PATH").unwrap_or_default())
        .map(|directory| directory.join(command))
        .find(|path| path.is_file())
        .ok_or_else(|| PrismError::new("PP5401", format!("SDK command {command} is absent")))?;
    let resolved = candidate
        .canonicalize()
        .map_err(|error| PrismError::new("PP5401", format!("SDK command {command}: {error}")))?;
    if verified {
        let bytes = read_metadata(
            inventory_path.ok_or_else(|| PrismError::new("PP5401", "SDK inventory is absent"))?,
            SDK_INVENTORY_MAX_BYTES,
            "PP5401",
        )?;
        let value: serde_json::Value = serde_json::from_slice(&bytes)
            .map_err(|error| PrismError::new("PP5401", error.to_string()))?;
        let expected = value["commands"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|row| row["command"] == command)
            .ok_or_else(|| {
                PrismError::new("PP5401", format!("SDK command {command} is undeclared"))
            })?;
        let observed_sha = executable_digest(&candidate, &resolved)
            .map_err(|error| PrismError::new("PP5401", error.to_string()))?;
        if expected["executable"] != resolved.to_string_lossy().as_ref()
            || expected["sha256"] != observed_sha
        {
            return Err(PrismError::new(
                "PP5401",
                format!("SDK command {command} disagrees with its signed inventory"),
            ));
        }
    }
    // Preserve the selected command path for multi-call binaries and shims
    // (notably rustup's cargo/rustc links). Executing the canonical target
    // changes argv[0] semantics and can invoke the wrong applet. The target
    // digest and canonical identity were verified above.
    Ok(candidate)
}

fn tree(root: &Path) -> Result<BTreeMap<String, String>, PrismError> {
    let mut rows = BTreeMap::new();
    if !root.exists() {
        return Ok(rows);
    }
    for entry in walkdir::WalkDir::new(root) {
        let entry = entry.map_err(|error| PrismError::new("PP5401", error.to_string()))?;
        if entry.file_type().is_symlink() {
            return Err(PrismError::new(
                "PP5401",
                "SDK source tree contains a symlink",
            ));
        }
        if !entry.file_type().is_file() {
            continue;
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|_| PrismError::new("PP5401", "SDK source path escaped"))?
            .to_string_lossy()
            .replace('\\', "/");
        rows.insert(
            relative,
            format!(
                "{:x}",
                Sha256::digest(
                    std::fs::read(entry.path())
                        .map_err(|error| PrismError::new("PP5401", error.to_string()))?
                )
            ),
        );
    }
    Ok(rows)
}

fn extract(destination: &Path) -> Result<(), PrismError> {
    let mut archive = tar::Archive::new(Cursor::new(STDLIB_SOURCES));
    for entry in archive
        .entries()
        .map_err(|error| PrismError::new("PP5401", format!("SDK archive: {error}")))?
    {
        let mut entry =
            entry.map_err(|error| PrismError::new("PP5401", format!("SDK archive: {error}")))?;
        let path = entry
            .path()
            .map_err(|error| PrismError::new("PP5401", format!("SDK archive path: {error}")))?;
        if path
            .components()
            .any(|part| !matches!(part, Component::Normal(_)))
            || !(entry.header().entry_type().is_file() || entry.header().entry_type().is_dir())
        {
            return Err(PrismError::new("PP5401", "SDK archive entry is unsafe"));
        }
        entry
            .unpack_in(destination)
            .map_err(|error| PrismError::new("PP5401", format!("SDK archive: {error}")))?;
    }
    Ok(())
}

/// Install exact embedded model sources under ignored, content-checked SDK state.
pub fn install_project_inputs(root: &Path) -> Result<serde_json::Value, PrismError> {
    let parent = root.join(".prism/sdk");
    std::fs::create_dir_all(&parent)
        .map_err(|error| PrismError::new("PP5401", error.to_string()))?;
    let expected_temp = tempfile::Builder::new()
        .prefix("stdlib-expected-")
        .tempdir_in(&parent)
        .map_err(|error| PrismError::new("PP5401", error.to_string()))?;
    extract(expected_temp.path())?;
    let expected = tree(expected_temp.path())?;
    let destination = parent.join("inputs");
    if destination.exists() {
        if tree(&destination)? != expected {
            return Err(PrismError::new(
                "PP5401",
                "installed SDK standard-library sources are stale or modified",
            ));
        }
    } else {
        std::fs::rename(expected_temp.path(), &destination)
            .map_err(|error| PrismError::new("PP5401", format!("SDK publish: {error}")))?;
    }
    let files = expected
        .into_iter()
        .map(|(path, sha256)| json!({"path":path,"sha256":sha256}))
        .collect::<Vec<_>>();
    let manifest = json!({
        "archive_sha256":format!("{:x}",Sha256::digest(STDLIB_SOURCES)),
        "files":files,
        "schema":"prismpm/sdk-inputs/1"
    });
    let bytes = encode_value(&manifest)?;
    let path = parent.join("stdlib-manifest.json");
    if path.exists() {
        if std::fs::read(&path).map_err(|error| PrismError::new("PP5401", error.to_string()))?
            != bytes
        {
            return Err(PrismError::new("PP5401", "SDK input manifest changed"));
        }
    } else {
        std::fs::write(&path, bytes)
            .map_err(|error| PrismError::new("PP5401", error.to_string()))?;
    }
    Ok(manifest)
}

/// Acquire project package-manager inputs during the explicit online fetch phase.
///
/// Subsequent Prism commands never perform this operation implicitly. Both
/// package managers are invoked without a shell and only when their committed
/// lock and project manifest are present.
pub fn fetch_project_dependencies(root: &Path) -> Result<Vec<serde_json::Value>, PrismError> {
    let mut records = Vec::new();
    if root.join("Cargo.toml").is_file() && root.join("Cargo.lock").is_file() {
        let cargo = executable("cargo")?;
        let record = crate::verification::run_process(
            "cargo-fetch",
            &cargo,
            &["fetch".to_owned(), "--locked".to_owned()],
            root,
            &BTreeMap::new(),
            &[(root, "$PROJECT")],
            "PP5402",
        )?;
        records.push(
            serde_json::to_value(record)
                .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
        );
    }
    if root.join("package.json").is_file() && root.join("package-lock.json").is_file() {
        let npm = executable("npm")?;
        let record = crate::verification::run_process(
            "npm-ci",
            &npm,
            &[
                "ci".to_owned(),
                "--ignore-scripts".to_owned(),
                "--no-audit".to_owned(),
                "--no-fund".to_owned(),
            ],
            root,
            &BTreeMap::new(),
            &[(root, "$PROJECT")],
            "PP5402",
        )?;
        records.push(
            serde_json::to_value(record)
                .map_err(|error| PrismError::new("PP9001", error.to_string()))?,
        );
    }
    Ok(records)
}

/// Parse either supported exact-major SDK lock; never coerce the legacy format.
pub fn parse_lock(bytes: &[u8]) -> Result<CanonicalDocument, PrismError> {
    if bytes.len() > SDK_CAPTURE_MAX_BYTES {
        return Err(PrismError::new(
            "PP7601",
            "SDK lock exceeds its 67108864 byte limit",
        ));
    }
    let value: serde_json::Value = serde_json::from_slice(bytes)
        .map_err(|error| PrismError::new("PP5401", format!("SDK lock JSON: {error}")))?;
    let schema = match value["schema"].as_str() {
        Some("prismpm/sdk-lock/1") => "prismpm/sdk-lock/1",
        Some("prismpm/sdk-lock/2") => "prismpm/sdk-lock/2",
        _ => return Err(PrismError::new("PP5401", "unsupported SDK lock schema")),
    };
    CanonicalDocument::parse(schema, bytes)
}

fn oci_field_casing(value: &serde_json::Value, names: &[&str]) -> bool {
    value.as_object().is_some_and(|object| {
        object.keys().all(|key| {
            let folded = key.to_uppercase().to_lowercase();
            names
                .iter()
                .all(|name| folded != name.to_uppercase().to_lowercase() || key == name)
        })
    })
}

fn bounded_positive_integer(token: &str, maximum: usize) -> Option<usize> {
    let (mantissa, exponent) = token.split_once(['e', 'E']).unwrap_or((token, "0"));
    let exponent_digits = exponent
        .trim_start_matches(['+', '-'])
        .trim_start_matches('0');
    if exponent_digits.len() > 7 {
        return None;
    }
    let exponent = exponent.parse::<i64>().ok()?;
    let (whole, fraction) = mantissa.split_once('.').unwrap_or((mantissa, ""));
    if whole.is_empty()
        || !whole
            .bytes()
            .chain(fraction.bytes())
            .all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let coefficient = format!("{whole}{fraction}");
    let digits = coefficient.trim_start_matches('0');
    let significant = digits.trim_end_matches('0');
    if significant.is_empty() {
        return None;
    }
    let scale = exponent - fraction.len() as i64 + (digits.len() - significant.len()) as i64;
    let maximum = maximum.to_string();
    if scale < 0 || significant.len() as i64 + scale > maximum.len() as i64 {
        return None;
    }
    let exact = format!("{significant}{}", "0".repeat(scale as usize));
    if exact.len() == maximum.len() && exact > maximum {
        return None;
    }
    exact.parse().ok()
}

// Decode only understood SDK fields, without interpreting opaque OCI extensions
// as Rust strings or binary64 numbers. The original bytes remain the digest and
// lock authority. Walk all members for duplicates/depth, then validate complete
// JSON syntax independently, without serde's global raw-value/number features.
fn decode_sdk_index(bytes: &[u8]) -> Option<serde_json::Value> {
    #[derive(Clone, Copy)]
    enum Focus {
        Index,
        Children,
        Child,
        Platform,
        Schema,
        Size,
        Scalar,
        Other,
    }
    fn white(bytes: &[u8], at: &mut usize) {
        while bytes.get(*at).is_some_and(u8::is_ascii_whitespace) {
            *at += 1;
        }
    }
    fn string<'a>(bytes: &'a [u8], at: &mut usize) -> Option<&'a [u8]> {
        let start = *at;
        if *bytes.get(*at)? != b'"' {
            return None;
        }
        *at += 1;
        loop {
            match *bytes.get(*at)? {
                b'"' => {
                    *at += 1;
                    return bytes.get(start..*at);
                }
                b'\\' => *at += 2,
                _ => *at += 1,
            }
        }
    }
    // JSON object keys compare decoded UTF-16 units, including opaque unpaired
    // surrogates. Do not collapse distinct invalid-scalar keys lossily, or reject
    // a valid ignored extension merely because Rust String cannot represent it.
    fn key_units(raw: &[u8]) -> Option<Vec<u16>> {
        let text = std::str::from_utf8(raw.get(1..raw.len().checked_sub(1)?)?).ok()?;
        let mut chars = text.chars();
        let mut units = Vec::new();
        while let Some(ch) = chars.next() {
            if ch != '\\' {
                units.extend_from_slice(ch.encode_utf16(&mut [0; 2]));
                continue;
            }
            units.push(match chars.next()? {
                '"' => b'"' as u16,
                '\\' => b'\\' as u16,
                '/' => b'/' as u16,
                'b' => 8,
                'f' => 12,
                'n' => 10,
                'r' => 13,
                't' => 9,
                'u' => {
                    let mut code = 0;
                    for _ in 0..4 {
                        code = code * 16 + chars.next()?.to_digit(16)? as u16;
                    }
                    code
                }
                _ => return None,
            });
        }
        Some(units)
    }
    fn names(focus: Focus) -> &'static [&'static str] {
        match focus {
            Focus::Index => &[
                "schemaVersion",
                "mediaType",
                "manifests",
                "annotations",
                "subject",
                "artifactType",
            ],
            Focus::Child => &[
                "mediaType",
                "digest",
                "size",
                "urls",
                "data",
                "annotations",
                "platform",
                "artifactType",
            ],
            Focus::Platform => &["architecture", "os", "os.version", "os.features", "variant"],
            _ => &[],
        }
    }
    fn member(focus: Focus, key: Option<&str>) -> Option<Focus> {
        match (focus, key?) {
            (Focus::Index, "schemaVersion") => Some(Focus::Schema),
            (Focus::Index, "manifests") => Some(Focus::Children),
            (Focus::Index | Focus::Child, "mediaType")
            | (Focus::Child, "digest")
            | (Focus::Platform, "architecture" | "os" | "variant") => Some(Focus::Scalar),
            (Focus::Child, "size") => Some(Focus::Size),
            (Focus::Child, "platform") => Some(Focus::Platform),
            // These fields are forbidden even when their value is null.
            (Focus::Child, "urls" | "data") | (Focus::Platform, "os.version" | "os.features") => {
                Some(Focus::Other)
            }
            _ => None,
        }
    }
    fn value(
        bytes: &[u8],
        at: &mut usize,
        focus: Focus,
        depth: usize,
    ) -> Option<serde_json::Value> {
        if depth > 64 {
            return None;
        }
        white(bytes, at);
        let start = *at;
        let first = *bytes.get(*at)?;
        if matches!(focus, Focus::Schema | Focus::Size) {
            while bytes
                .get(*at)
                .is_some_and(|byte| !b",]} \t\r\n".contains(byte))
            {
                *at += 1;
            }
            let maximum = if matches!(focus, Focus::Schema) {
                2
            } else {
                SDK_INDEX_MAX_BYTES
            };
            let integer = bounded_positive_integer(
                std::str::from_utf8(bytes.get(start..*at)?).ok()?,
                maximum,
            )?;
            return (!matches!(focus, Focus::Schema) || integer == 2)
                .then(|| serde_json::Value::from(integer));
        }
        match first {
            b'"' => {
                let raw = string(bytes, at)?;
                return if matches!(focus, Focus::Scalar) {
                    serde_json::from_slice(raw).ok()
                } else {
                    Some(serde_json::Value::Null)
                };
            }
            b'{' | b'[' => {
                *at += 1;
                let mut keys = BTreeSet::new();
                let mut object = serde_json::Map::new();
                let mut array = Vec::new();
                let end = if first == b'{' { b'}' } else { b']' };
                white(bytes, at);
                if bytes.get(*at) == Some(&end) {
                    *at += 1;
                } else {
                    loop {
                        white(bytes, at);
                        let (key, child) = if first == b'{' {
                            let units = key_units(string(bytes, at)?)?;
                            white(bytes, at);
                            if *bytes.get(*at)? != b':' {
                                return None;
                            }
                            *at += 1;
                            let key = String::from_utf16(&units).ok();
                            if !keys.insert(units) {
                                return None;
                            }
                            if let Some(key) = &key {
                                let folded = key.to_uppercase().to_lowercase();
                                if names(focus).iter().any(|name| {
                                    folded == name.to_uppercase().to_lowercase() && key != name
                                }) {
                                    return None;
                                }
                            }
                            let selected = member(focus, key.as_deref());
                            (
                                key.filter(|_| selected.is_some()),
                                selected.unwrap_or(Focus::Other),
                            )
                        } else if matches!(focus, Focus::Children) {
                            (None, Focus::Child)
                        } else {
                            (None, Focus::Other)
                        };
                        let decoded = value(bytes, at, child, depth + 1)?;
                        if let Some(key) = key {
                            object.insert(key, decoded);
                        } else if first == b'[' && matches!(focus, Focus::Children) {
                            array.push(decoded);
                        }
                        white(bytes, at);
                        match *bytes.get(*at)? {
                            byte if byte == end => {
                                *at += 1;
                                break;
                            }
                            b',' => *at += 1,
                            _ => return None,
                        }
                    }
                }
                return Some(
                    if first == b'{'
                        && matches!(focus, Focus::Index | Focus::Child | Focus::Platform)
                    {
                        serde_json::Value::Object(object)
                    } else if first == b'[' && matches!(focus, Focus::Children) {
                        serde_json::Value::Array(array)
                    } else {
                        serde_json::Value::Null
                    },
                );
            }
            _ => {
                while bytes
                    .get(*at)
                    .is_some_and(|byte| !b",]} \t\r\n".contains(byte))
                {
                    *at += 1;
                }
                if *at == start {
                    return None;
                }
            }
        }
        if matches!(focus, Focus::Scalar) {
            serde_json::from_slice(bytes.get(start..*at)?).ok()
        } else {
            Some(serde_json::Value::Null)
        }
    }
    let mut at = 0;
    std::str::from_utf8(bytes).ok()?;
    let decoded = value(bytes, &mut at, Focus::Index, 0)?;
    white(bytes, &mut at);
    if at != bytes.len() {
        return None;
    }
    serde_json::from_slice::<serde::de::IgnoredAny>(bytes).ok()?;
    Some(decoded)
}

pub(crate) fn validate_platform_lock(value: &serde_json::Value) -> Result<(), PrismError> {
    let fail = || {
        PrismError::new(
            "PP5401",
            "SDK platform inventory or index binding is invalid",
        )
    };
    let bytes = value["sdk_index"].as_str().ok_or_else(fail)?.as_bytes();
    if bytes.len() > SDK_INDEX_MAX_BYTES {
        return Err(fail());
    }
    let index_digest = format!("sha256:{:x}", Sha256::digest(bytes));
    if value["sdk_image"]
        .as_str()
        .and_then(|image| image.rsplit_once('@'))
        .map(|(_, digest)| digest)
        != Some(index_digest.as_str())
    {
        return Err(fail());
    }
    let index = decode_sdk_index(bytes).ok_or_else(fail)?;
    let manifests = index["manifests"].as_array().ok_or_else(fail)?;
    let platforms = value["platforms"].as_array().ok_or_else(fail)?;
    if !oci_field_casing(
        &index,
        &[
            "schemaVersion",
            "mediaType",
            "manifests",
            "annotations",
            "subject",
            "artifactType",
        ],
    ) || index["schemaVersion"].as_f64() != Some(2.0)
        || index["mediaType"] != "application/vnd.oci.image.index.v1+json"
        || manifests.len() != 2
        || platforms.len() != 2
    {
        return Err(fail());
    }
    let mut expected_identities = None;
    let mut digests = BTreeSet::new();
    for (row, architecture) in platforms.iter().zip(["amd64", "arm64"]) {
        if row["platform"] != format!("linux/{architecture}")
            || !digests.insert(row["manifest_digest"].as_str().ok_or_else(fail)?)
        {
            return Err(fail());
        }
        let matching = manifests
            .iter()
            .filter(|manifest| {
                manifest["platform"]["os"] == "linux"
                    && manifest["platform"]["architecture"] == architecture
            })
            .collect::<Vec<_>>();
        if matching.len() != 1 {
            return Err(fail());
        }
        let manifest = matching[0];
        let platform = &manifest["platform"];
        if !oci_field_casing(
            manifest,
            &[
                "mediaType",
                "digest",
                "size",
                "urls",
                "data",
                "annotations",
                "platform",
                "artifactType",
            ],
        ) || !oci_field_casing(
            platform,
            &["architecture", "os", "os.version", "os.features", "variant"],
        ) || manifest.get("urls").is_some()
            || manifest.get("data").is_some()
            || platform.get("os.version").is_some()
            || platform.get("os.features").is_some()
            || manifest["digest"] != row["manifest_digest"]
            || manifest["mediaType"] != "application/vnd.oci.image.manifest.v1+json"
            || !manifest["size"].is_number()
            || !(platform.get("variant").is_none()
                || (architecture == "arm64" && platform["variant"] == "v8"))
        {
            return Err(fail());
        }
        let inventory = row["inventory"].as_array().ok_or_else(fail)?;
        let document = row["inventory_document"].as_str().ok_or_else(fail)?;
        if document.len() > SDK_INVENTORY_MAX_BYTES
            || row["inventory_digest"]
                != format!("sha256:{:x}", Sha256::digest(document.as_bytes()))
        {
            return Err(fail());
        }
        let decoded: serde_json::Value = serde_json::from_str(document).map_err(|_| fail())?;
        let canonical = encode_value(&decoded)?;
        if document.as_bytes() != canonical
            && document.as_bytes().strip_suffix(b"\n") != Some(canonical.as_slice())
        {
            return Err(fail());
        }
        if decoded.as_object().is_none_or(|object| {
            object
                .keys()
                .map(String::as_str)
                .ne(["artifacts", "commands", "schema"])
        }) || decoded["schema"] != "prismpm/sdk-inventory/1"
            || decoded["artifacts"] != row["inventory"]
        {
            return Err(fail());
        }
        let commands = decoded["commands"].as_array().ok_or_else(fail)?;
        let mut previous_command = "";
        if commands.is_empty() {
            return Err(fail());
        }
        for command in commands {
            let name = command["command"].as_str().ok_or_else(fail)?;
            let hash = command["sha256"].as_str().ok_or_else(fail)?;
            if command.as_object().is_none_or(|object| {
                object
                    .keys()
                    .map(String::as_str)
                    .ne(["command", "executable", "sha256"])
            }) || name <= previous_command
                || command["executable"]
                    .as_str()
                    .is_none_or(|path| !path.starts_with('/'))
                || hash.len() != 64
                || !hash
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
            {
                return Err(fail());
            }
            previous_command = name;
        }
        let identities = inventory
            .iter()
            .map(|item| {
                Some((
                    item["id"].as_str()?.to_owned(),
                    item["kind"].as_str()?.to_owned(),
                    item["version"].as_str()?.to_owned(),
                ))
            })
            .collect::<Option<Vec<_>>>()
            .ok_or_else(fail)?;
        if identities.iter().any(|row| row.0 == "sdk-manifest")
            || identities.windows(2).any(|pair| pair[0].0 >= pair[1].0)
            || expected_identities
                .as_ref()
                .is_some_and(|expected| expected != &identities)
        {
            return Err(fail());
        }
        expected_identities = Some(identities);
    }
    Ok(())
}

/// Compare the actual running SDK inventory with its exact native lock entry.
/// The caller supplies the detected platform, never a lock-selected fallback.
pub fn validate_running_inventory(
    lock: &CanonicalDocument,
    platform: &str,
    inventory_bytes: &[u8],
) -> Result<(), PrismError> {
    let inventory: serde_json::Value = serde_json::from_slice(inventory_bytes)
        .map_err(|_| PrismError::new("PP5401", "SDK inventory is malformed"))?;
    if inventory["schema"] != "prismpm/sdk-inventory/1" || !inventory["artifacts"].is_array() {
        return Err(PrismError::new("PP5401", "SDK inventory is absent"));
    }
    let value = lock.value();
    if lock.schema() == "prismpm/sdk-lock/1" {
        let rows = value["inventory"]
            .as_array()
            .expect("validated SDK lock inventory");
        let artifacts = rows
            .iter()
            .filter(|row| row["id"] != "sdk-manifest")
            .cloned()
            .collect::<Vec<_>>();
        let digest = value["sdk_image"]
            .as_str()
            .and_then(|image| image.rsplit_once('@'))
            .map(|(_, digest)| digest)
            .expect("validated SDK reference");
        if serde_json::Value::Array(artifacts) != inventory["artifacts"]
            || !rows.iter().any(|row| {
                row["id"] == "sdk-manifest" && row["kind"] == "image" && row["digest"] == digest
            })
        {
            return Err(PrismError::new(
                "PP5401",
                "legacy SDK inventory disagrees with the running SDK",
            ));
        }
    } else {
        let row = value["platforms"]
            .as_array()
            .expect("validated SDK platforms")
            .iter()
            .find(|row| row["platform"] == platform)
            .ok_or_else(|| PrismError::new("PP5401", "running SDK platform is not locked"))?;
        if row["inventory"] != inventory["artifacts"]
            || row["inventory_digest"] != format!("sha256:{:x}", Sha256::digest(inventory_bytes))
        {
            return Err(PrismError::new(
                "PP5401",
                "SDK platform inventory disagrees with the running SDK",
            ));
        }
    }
    Ok(())
}

/// Load a lock for present execution, distinct from parsing a historical OCI
/// artifact. Both lock versions must select the actual native SDK inventory.
/// Only the repository's source bootstrap (no installed/configured SDK) lacks
/// that inventory; its independently pinned devcontainer gates remain required.
fn lock_is_present(root: &Path) -> Result<bool, PrismError> {
    match std::fs::symlink_metadata(root.join("prismpm.lock")) {
        Ok(metadata) if metadata.is_file() && !metadata.file_type().is_symlink() => Ok(true),
        Ok(_) => Err(PrismError::new(
            "PP5401",
            "prismpm.lock must be a regular file, not a symlink or other node",
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(false),
        Err(error) => Err(PrismError::new(
            "PP5401",
            format!("cannot inspect prismpm.lock: {error}"),
        )),
    }
}

pub(crate) fn check_existing_lock(root: &Path) -> Result<(), PrismError> {
    if lock_is_present(root)? {
        execution_lock(root)?;
    }
    Ok(())
}

/// Invocation-local authority snapshot, including cold source-bootstrap locks.
/// A later lock addition, removal or replacement must not silently reuse the
/// earlier verification package, even when neither phase can use an SDK seed.
pub(crate) fn exporter_lock_authority(root: &Path) -> Result<Option<String>, PrismError> {
    if lock_is_present(root)? {
        Ok(Some(execution_lock(root)?.digest()))
    } else {
        Ok(None)
    }
}

/// Seed authority comes from the consumer's platform lock, never a digest
/// recomputed from the installed inventory. Legacy/unlocked bootstrap is cold.
pub(crate) fn exporter_seed_inventory(root: &Path) -> Result<Option<String>, PrismError> {
    if !lock_is_present(root)? || inventory_path().as_deref() != Some(Path::new(RELEASED_INVENTORY))
    {
        return Ok(None);
    }
    let lock = execution_lock(root)?;
    if lock.schema() != "prismpm/sdk-lock/2" {
        return Ok(None);
    }
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        _ => {
            return Err(PrismError::new(
                "PP5401",
                "unsupported native exporter platform",
            ));
        }
    };
    let platform = format!("{}/{architecture}", std::env::consts::OS);
    let digest = lock.value()["platforms"]
        .as_array()
        .and_then(|rows| rows.iter().find(|row| row["platform"] == platform))
        .and_then(|row| row["inventory_digest"].as_str())
        .and_then(|digest| digest.strip_prefix("sha256:"))
        .ok_or_else(|| PrismError::new("PP5401", "native SDK inventory authority is missing"))?;
    Ok(Some(digest.to_owned()))
}

pub(crate) fn execution_lock(root: &Path) -> Result<CanonicalDocument, PrismError> {
    if !lock_is_present(root)? {
        return Err(PrismError::new("PP5401", "prismpm.lock is absent"));
    }
    let bytes = read_metadata(&root.join("prismpm.lock"), SDK_CAPTURE_MAX_BYTES, "PP7601")?;
    let lock = parse_lock(&bytes)?;
    if let Some(path) = inventory_path() {
        let architecture = match std::env::consts::ARCH {
            "x86_64" => "amd64",
            "aarch64" => "arm64",
            value => value,
        };
        let inventory = read_metadata(&path, SDK_INVENTORY_MAX_BYTES, "PP5401")?;
        validate_running_inventory(
            &lock,
            &format!("{}/{architecture}", std::env::consts::OS),
            &inventory,
        )?;
    }
    Ok(lock)
}

/// Verify and inspect the committed SDK lock without changing it.
pub fn inspect_lock(root: &Path) -> Result<serde_json::Value, PrismError> {
    let lock = execution_lock(root)?;
    Ok(lock.value().clone())
}

/// Produce an RFC 6902-style review object for an explicit SDK-lock update.
/// Project files are read-only; applying the patch remains a normal reviewed
/// source change. Platform updates read a bounded terminal metadata layer from
/// each immutable target manifest without pulling or executing target images.
pub fn propose_lock_update(
    root: &Path,
    sdk_image: &str,
    standards_lock: &str,
) -> Result<serde_json::Value, PrismError> {
    crate::oci::validate_reference(sdk_image, true)?;
    let standards = standards_lock
        .strip_prefix("sha256:")
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        })
        .ok_or_else(|| PrismError::new("PP5401", "standards-lock digest is malformed"))?;
    let current = inspect_lock(root)?;
    if current["schema"] == "prismpm/sdk-lock/2" {
        let proposed = capture_platform_update(sdk_image, standards_lock)?;
        return platform_update_proposal(&current, proposed.value());
    }
    let mut proposed = current.clone();
    proposed["sdk_image"] = serde_json::Value::String(sdk_image.to_owned());
    proposed["standards_lock"] = serde_json::Value::String(format!("sha256:{standards}"));
    let proposed = CanonicalDocument::from_value("prismpm/sdk-lock/1", proposed)?;
    let changes = ["sdk_image", "standards_lock"]
        .into_iter()
        .filter(|field| current[*field] != proposed.value()[*field])
        .map(|field| {
            json!({
                "from":current[field],
                "op":"replace",
                "path":format!("/{field}"),
                "to":proposed.value()[field]
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({
        "changes":changes,
        "compatibility_review":"required",
        "generated_output_diff":"required",
        "proposed_lock":proposed.value(),
        "schema":"prismpm/sdk-lock-update/1",
        "security_review":"required"
    }))
}

/// Capture an explicit legacy-to-platform migration without modifying a project.
/// The old lock is historical evidence only; it does not admit project execution.
pub fn propose_lock_migration(
    root: &Path,
    sdk_image: &str,
    standards_lock: &str,
) -> Result<serde_json::Value, PrismError> {
    verify_environment()?;
    crate::oci::validate_reference(sdk_image, true)?;
    if !standards_lock
        .strip_prefix("sha256:")
        .is_some_and(|digest| {
            digest.len() == 64
                && digest
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
    {
        return Err(PrismError::new(
            "PP5401",
            "standards-lock digest is malformed",
        ));
    }
    capture_migration(root, || capture_platform_update(sdk_image, standards_lock))
}

fn capture_migration(
    root: &Path,
    capture: impl FnOnce() -> Result<CanonicalDocument, PrismError>,
) -> Result<serde_json::Value, PrismError> {
    let current = historical_migration_lock(root)?;
    let proposed = capture()?;
    if historical_migration_lock(root)?.bytes() != current.bytes() {
        return Err(PrismError::new(
            "PP5401",
            "historical SDK lock changed during capture",
        ));
    }
    migration_proposal(current.value(), proposed.value())
}

fn historical_migration_lock(root: &Path) -> Result<CanonicalDocument, PrismError> {
    let bytes = read_metadata(&root.join("prismpm.lock"), SDK_CAPTURE_MAX_BYTES, "PP5401")?;
    let lock = parse_lock(&bytes)?;
    if lock.schema() != "prismpm/sdk-lock/1" {
        return Err(PrismError::new(
            "PP5401",
            "migration requires a legacy SDK lock; use lock update for v2",
        ));
    }
    Ok(lock)
}

fn migration_proposal(
    current: &serde_json::Value,
    proposed: &serde_json::Value,
) -> Result<serde_json::Value, PrismError> {
    let proposal = CanonicalDocument::from_value(
        "prismpm/sdk-lock-migration/1",
        json!({
            "schema":"prismpm/sdk-lock-migration/1",
            "patch":[{"op":"test","path":"","value":current},{"op":"replace","path":"","value":proposed}],
            "compatibility_review":"required", "generated_output_diff":"required", "security_review":"required"
        }),
    )?;
    Ok(proposal.value().clone())
}

fn capture_platform_update(
    sdk_image: &str,
    standards_lock: &str,
) -> Result<CanonicalDocument, PrismError> {
    let directory = tempfile::tempdir()
        .map_err(|error| PrismError::new("PP5401", format!("SDK update staging: {error}")))?;
    let helper = directory.path().join("metadata-cli.mjs");
    for (name, bytes) in [
        (
            "platform-lock.mjs",
            include_bytes!("../sdk/platform-lock.mjs").as_slice(),
        ),
        (
            "metadata-cli.mjs",
            include_bytes!("../sdk/metadata-cli.mjs").as_slice(),
        ),
        (
            "metadata-capture.mjs",
            include_bytes!("../sdk/metadata-capture.mjs").as_slice(),
        ),
        (
            "metadata-layer.mjs",
            include_bytes!("../sdk/metadata-layer.mjs").as_slice(),
        ),
        (
            "metadata-transport.mjs",
            include_bytes!("../sdk/metadata-transport.mjs").as_slice(),
        ),
        (
            "metadata-credentials.mjs",
            include_bytes!("../sdk/metadata-credentials.mjs").as_slice(),
        ),
        (
            "metadata-helper.mjs",
            include_bytes!("../sdk/metadata-helper.mjs").as_slice(),
        ),
        (
            "metadata-helper-supervisor.py",
            include_bytes!("../sdk/metadata-helper-supervisor.py").as_slice(),
        ),
    ] {
        std::fs::write(directory.path().join(name), bytes)
            .map_err(|error| PrismError::new("PP5401", format!("SDK update helper: {error}")))?;
    }
    let node = executable("node")?;
    // Node resolution verifies the installed SDK environment first. Pass its
    // exact command inventory, never helper names resolved from user config.
    let commands = match inventory_path() {
        Some(path) => read_metadata(&path, SDK_INVENTORY_MAX_BYTES, "PP5401")?,
        None => encode_value(&executable_inventory()?)?,
    };
    let command_inventory = directory.path().join("commands.json");
    std::fs::write(&command_inventory, commands)
        .map_err(|error| PrismError::new("PP5401", format!("SDK command inventory: {error}")))?;
    let mut environment = BTreeMap::new();
    for name in [
        "DOCKER_CONFIG",
        "DBUS_SESSION_BUS_ADDRESS",
        "DISPLAY",
        "XDG_RUNTIME_DIR",
        "GNUPGHOME",
        "PASSWORD_STORE_DIR",
        "GPG_TTY",
    ] {
        if let Some(value) = std::env::var_os(name) {
            environment.insert(name.to_owned(), value.to_string_lossy().into_owned());
        }
    }
    let result = crate::verification::run_process_limited(
        "sdk-platform-update",
        &node,
        &[
            helper.to_string_lossy().into_owned(),
            sdk_image.to_owned(),
            standards_lock.to_owned(),
            command_inventory.to_string_lossy().into_owned(),
        ],
        directory.path(),
        &environment,
        &[],
        "PP5401",
        "210s",
        SDK_CAPTURE_MAX_BYTES,
    )?;
    let proposed = parse_lock(result.stdout.as_bytes())?;
    if proposed.schema() != "prismpm/sdk-lock/2"
        || proposed.value()["sdk_image"] != sdk_image
        || proposed.value()["standards_lock"] != standards_lock
    {
        return Err(PrismError::new(
            "PP5401",
            "captured SDK lock differs from the requested immutable update",
        ));
    }
    Ok(proposed)
}

fn platform_update_proposal(
    current: &serde_json::Value,
    proposed: &serde_json::Value,
) -> Result<serde_json::Value, PrismError> {
    CanonicalDocument::from_value("prismpm/sdk-lock/2", current.clone())?;
    CanonicalDocument::from_value("prismpm/sdk-lock/2", proposed.clone())?;
    let changes = ["platforms", "sdk_image", "sdk_index", "standards_lock"]
        .into_iter()
        .filter(|field| current[*field] != proposed[*field])
        .map(|field| json!({"from":current[field], "op":"replace", "path":format!("/{field}"), "to":proposed[field]}))
        .collect::<Vec<_>>();
    let proposal = CanonicalDocument::from_value(
        "prismpm/sdk-lock-update/2",
        json!({
            "changes":changes, "compatibility_review":"required", "generated_output_diff":"required",
            "proposed_lock":proposed, "schema":"prismpm/sdk-lock-update/2", "security_review":"required"
        }),
    )?;
    Ok(proposal.value().clone())
}

// Isolate environment selection in a subprocess: tests must not mutate the
// process-wide SDK identity while other parallel tests are running. In an SDK,
// the real fixed inventory wins; source-devcontainer tests use explicit,
// clearly synthetic inventory bytes. Neither path bypasses runtime validation.
#[cfg(test)]
pub(crate) fn execution_binding_regression(
    test_name: &str,
    invoke: impl Fn(&Path) -> Result<(), PrismError>,
) {
    if let Some(root) = std::env::var_os("PRISMPM_EXECUTION_BINDING_TEST_ROOT") {
        let result = invoke(Path::new(&root));
        if std::env::var("PRISMPM_EXECUTION_BINDING_TEST_BAD").unwrap() == "true" {
            assert_eq!(result.unwrap_err().code, "PP5401");
        } else if let Err(error) = result {
            assert_ne!(
                error.code, "PP5401",
                "matching native inventory was rejected"
            );
        }
        return;
    }
    let root = tempfile::tempdir().unwrap();
    let actual = inventory_path().map(|path| std::fs::read(path).unwrap()).unwrap_or_else(|| {
        serde_json::to_vec(&json!({"schema":"prismpm/sdk-inventory/1", "commands":[{"command":"test","executable":"/synthetic/test","sha256":"c".repeat(64)}],
            "artifacts":[{"id":"synthetic-native-tool", "kind":"binary", "version":"test",
                "digest":format!("sha256:{}", "c".repeat(64))}]})).unwrap()
    });
    let inventory: serde_json::Value = serde_json::from_slice(&actual).unwrap();
    let inventory_path = root.path().join("inventory.json");
    std::fs::write(&inventory_path, &actual).unwrap();
    let standards = b"{\"authorities\":[]}";
    std::fs::write(root.path().join("standards.lock"), standards).unwrap();
    let standards_digest = format!("sha256:{:x}", Sha256::digest(standards));
    for schema in ["prismpm/sdk-lock/1", "prismpm/sdk-lock/2"] {
        let mut lock = if schema.ends_with("/1") {
            let image_digest = format!("sha256:{}", "a".repeat(64));
            let mut rows = inventory["artifacts"].as_array().unwrap().clone();
            rows.push(json!({"id":"sdk-manifest", "kind":"image", "version":"0.3.0", "digest":image_digest}));
            rows.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            json!({"schema":schema,"sdk_version":"0.3.0", "sdk_image":format!("example.invalid/test-sdk@{image_digest}"),
                "standards_lock":standards_digest, "inventory":rows})
        } else {
            let mut manifests = Vec::new();
            let mut platforms = Vec::new();
            for (architecture, digit) in [("amd64", "a"), ("arm64", "b")] {
                let manifest = format!("sha256:{}", digit.repeat(64));
                manifests.push(json!({"digest":manifest,"mediaType":"application/vnd.oci.image.manifest.v1+json",
                    "size":100,"platform":{"os":"linux","architecture":architecture}}));
                platforms.push(json!({"platform":format!("linux/{architecture}"),"manifest_digest":manifest,
                    "inventory_digest":format!("sha256:{:x}",Sha256::digest(&actual)),"inventory_document":String::from_utf8(actual.clone()).unwrap(),"inventory":inventory["artifacts"]}));
            }
            let index = serde_json::to_string(&json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":manifests})).unwrap();
            json!({"schema":schema,"sdk_version":"0.3.0", "sdk_image":format!("example.invalid/test-sdk@sha256:{:x}",Sha256::digest(index.as_bytes())),
                "sdk_index":index,"standards_lock":standards_digest,"platforms":platforms})
        };
        for bad in [false, true] {
            if bad {
                let replacement = json!(format!("sha256:{}", "f".repeat(64)));
                if schema.ends_with("/1") {
                    lock["inventory"]
                        .as_array_mut()
                        .unwrap()
                        .iter_mut()
                        .find(|row| row["id"] != "sdk-manifest")
                        .unwrap()["digest"] = replacement;
                } else {
                    for row in lock["platforms"].as_array_mut().unwrap() {
                        row["inventory"][0]["digest"] = replacement.clone();
                        let mut document: serde_json::Value =
                            serde_json::from_str(row["inventory_document"].as_str().unwrap())
                                .unwrap();
                        document["artifacts"] = row["inventory"].clone();
                        let bytes = serde_json::to_vec(&document).unwrap();
                        row["inventory_digest"] =
                            json!(format!("sha256:{:x}", Sha256::digest(&bytes)));
                        row["inventory_document"] = json!(String::from_utf8(bytes).unwrap());
                    }
                }
            }
            let document = CanonicalDocument::from_value(schema, lock.clone()).unwrap();
            std::fs::write(root.path().join("prismpm.lock"), document.bytes()).unwrap();
            let result = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", test_name, "--nocapture"])
                .env("PRISMPM_EXECUTION_BINDING_TEST_ROOT", root.path())
                .env("PRISMPM_EXECUTION_BINDING_TEST_BAD", bad.to_string())
                .env("PRISMPM_SDK_INVENTORY", &inventory_path)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{schema}, bad={bad}: {}{}",
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
}

#[cfg(test)]
mod tests {
    use serde_json::{json, Value};
    use sha2::{Digest, Sha256};

    #[test]
    fn metadata_reader_bounds_before_allocation_and_at_the_exact_limit() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("inventory.json");
        std::fs::write(&path, b"1234").unwrap();
        assert_eq!(super::read_metadata(&path, 4, "PP5401").unwrap(), b"1234");
        assert_eq!(
            super::read_metadata(&path, 3, "PP5401").unwrap_err().code,
            "PP5401"
        );
        std::fs::File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_len(8 * 1024 * 1024 * 1024)
            .unwrap();
        let error =
            super::read_metadata(&path, super::SDK_INVENTORY_MAX_BYTES, "PP5401").unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(error.message.contains("8388608 byte limit"));
    }

    #[test]
    fn execution_lock_rejects_sparse_oversized_input_before_parsing() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("prismpm.lock");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(8 * 1024 * 1024 * 1024)
            .unwrap();
        for error in [
            super::inspect_lock(root.path()).unwrap_err(),
            super::check_existing_lock(root.path()).unwrap_err(),
        ] {
            assert_eq!(error.code, "PP7601");
            assert!(error.message.contains("67108864 byte limit"));
        }
    }

    #[cfg(unix)]
    #[test]
    fn metadata_reader_refuses_aliases_hard_links_and_nonregular_nodes() {
        use std::os::unix::{fs::symlink, net::UnixListener};
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("original");
        std::fs::write(&original, b"{}").unwrap();
        let alias = root.path().join("alias");
        symlink(&original, &alias).unwrap();
        assert_eq!(
            super::read_metadata(&alias, 8, "PP5401").unwrap_err().code,
            "PP5401"
        );
        std::fs::hard_link(&original, root.path().join("hard-link")).unwrap();
        assert_eq!(
            super::read_metadata(&original, 8, "PP5401")
                .unwrap_err()
                .code,
            "PP5401"
        );
        let socket = root.path().join("socket");
        let _listener = UnixListener::bind(&socket).unwrap();
        for path in [root.path(), socket.as_path()] {
            assert_eq!(
                super::read_metadata(path, 8, "PP5401").unwrap_err().code,
                "PP5401"
            );
        }
    }

    #[cfg(unix)]
    #[test]
    fn sdk_digest_rejects_retargeted_selection_even_when_target_bytes_match() {
        let root = tempfile::tempdir().unwrap();
        let original = root.path().join("original");
        let replacement = root.path().join("replacement");
        let selected = root.path().join("selected");
        std::fs::write(&original, b"identical executable bytes").unwrap();
        std::fs::write(&replacement, b"identical executable bytes").unwrap();
        std::os::unix::fs::symlink(&original, &selected).unwrap();
        let resolved = selected.canonicalize().unwrap();
        let expected = format!("{:x}", Sha256::digest(b"identical executable bytes"));
        assert_eq!(
            super::executable_digest(&selected, &resolved).unwrap(),
            expected
        );
        std::fs::remove_file(&selected).unwrap();
        std::os::unix::fs::symlink(&replacement, &selected).unwrap();
        assert!(super::executable_digest(&selected, &resolved)
            .unwrap_err()
            .to_string()
            .contains("selection changed"));
        // A fresh selection may name the replacement; no global alias ban.
        assert_eq!(
            super::executable_digest(&selected, &selected.canonicalize().unwrap()).unwrap(),
            expected
        );
    }

    #[test]
    fn current_sdk_command_preserves_the_verified_selected_alias() {
        let verification = super::verify_environment().unwrap();
        let selected = super::executable("cargo").unwrap();
        let expected = std::env::split_paths(&std::env::var_os("PATH").unwrap())
            .map(|directory| directory.join("cargo"))
            .find(|path| path.is_file())
            .unwrap();
        assert_eq!(selected, expected);
        let canonical = selected.canonicalize().unwrap();
        let mut captured = super::ExecutableFile::open(&canonical).unwrap();
        assert_eq!(captured.sha256().unwrap().len(), 64);
        captured.verify_reference(&selected).unwrap();
        let output = std::process::Command::new(&selected)
            .arg("--version")
            .output()
            .unwrap();
        assert!(output.status.success());
        assert!(output.stdout.starts_with(b"cargo "));
        eprintln!(
            "SDK command alias: selected={}, canonical={}, installed={}",
            selected.display(),
            canonical.display(),
            verification.is_some()
        );
    }

    #[test]
    fn adjacent_sdk_selections_match_fresh_scalar_selections_before_any_child() {
        let commands = ["lake", "lean", "rustfmt", "rustc", "timeout"];
        let started = std::time::Instant::now();
        let scalar = commands.map(|name| super::executable(name).unwrap());
        let scalar_elapsed = started.elapsed();
        let started = std::time::Instant::now();
        let batch = super::executables(commands).unwrap();
        let batch_elapsed = started.elapsed();
        assert_eq!(batch, scalar);
        for (name, selected) in commands.into_iter().zip(batch) {
            let expected = std::env::split_paths(&std::env::var_os("PATH").unwrap())
                .map(|directory| directory.join(name))
                .find(|path| path.is_file())
                .unwrap();
            assert_eq!(selected, expected);
            let mut file = super::ExecutableFile::open(&selected.canonicalize().unwrap()).unwrap();
            assert_eq!(file.sha256().unwrap().len(), 64);
            file.verify_reference(&selected).unwrap();
        }
        eprintln!(
            "Fresh adjacent SDK selections: scalar_ms={}, batch_ms={}",
            scalar_elapsed.as_millis(),
            batch_elapsed.as_millis()
        );
    }

    #[test]
    fn adjacent_sdk_selections_refuse_malformed_names_and_missing_commands() {
        for malformed in ["", "../node", "cargo;true", "name with space"] {
            assert_eq!(
                super::executables(["cargo", malformed]).unwrap_err().code,
                "PP5401"
            );
        }
        let error = super::executables(["cargo", "prismpm-absent-sdk-command"]).unwrap_err();
        assert_eq!(error.code, "PP5401");
        assert!(error.message.contains("absent"));
    }

    #[cfg(unix)]
    #[test]
    fn execution_boundary_rejects_dangling_external_and_nonfile_locks() {
        use std::os::unix::fs::symlink;
        let project = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let lock = project.path().join("prismpm.lock");
        crate::Controller::load(project.path()).unwrap();
        for target in [
            external.path().join("missing"),
            external.path().join("outside"),
        ] {
            if target.file_name().unwrap() == "outside" {
                std::fs::write(&target, b"{}").unwrap();
            }
            symlink(target, &lock).unwrap();
            let error = crate::Controller::load(project.path()).unwrap_err();
            assert_eq!(error.code, "PP5401");
            assert!(error.message.contains("regular file"));
            let error = super::inspect_lock(project.path()).unwrap_err();
            assert_eq!(error.code, "PP5401");
            assert!(error.message.contains("regular file"));
            std::fs::remove_file(&lock).unwrap();
        }
        std::fs::create_dir(&lock).unwrap();
        assert_eq!(
            crate::Controller::load(project.path()).unwrap_err().code,
            "PP5401"
        );
        assert_eq!(
            super::inspect_lock(project.path()).unwrap_err().code,
            "PP5401"
        );
        // ENOTDIR is not an absent lock: only true NotFound permits bootstrap.
        assert_eq!(
            super::check_existing_lock(&external.path().join("outside"))
                .unwrap_err()
                .code,
            "PP5401"
        );
    }

    #[test]
    fn capture_output_bound_covers_both_escaped_documents_and_repeated_rows() {
        // Quotes/backslashes attain JSON string's worst doubling factor.
        // Artifact rows are contained in each bounded original document;
        // budget them once more, plus the escaped index and 1 MiB envelope.
        let document = "\\".repeat(super::SDK_INVENTORY_MAX_BYTES);
        let escaped = serde_json::to_string(&document).unwrap().len();
        let index = serde_json::to_string(&"\\".repeat(super::SDK_INDEX_MAX_BYTES))
            .unwrap()
            .len();
        let maximum = 2 * (escaped + document.len()) + index + 1024 * 1024;
        assert!(maximum < super::SDK_CAPTURE_MAX_BYTES);
        // A proposal repeats at most the old and new lock fields plus one
        // complete proposed lock. Three bounded lock budgets cover that shape.
        assert!(3 * maximum < 192 * 1024 * 1024);
    }

    #[test]
    fn execution_boundary_binds_both_lock_versions() {
        super::execution_binding_regression(
            "sdk::tests::execution_boundary_binds_both_lock_versions",
            |root| super::inspect_lock(root).map(|_| ()),
        );
    }

    #[test]
    fn installed_inventory_cannot_be_disabled_or_overridden_by_environment() {
        let root = tempfile::tempdir().unwrap();
        let installed = root.path().join("sdk");
        let inventory = installed.join("share/inventory.json");
        let override_path = root.path().join("different-inventory.json");
        assert_eq!(
            super::select_inventory_path(&inventory, &installed, None),
            None
        );
        assert_eq!(
            super::select_inventory_path(&inventory, &installed, Some(override_path.clone())),
            Some(override_path.clone())
        );
        std::fs::create_dir(&installed).unwrap();
        for configured in [None, Some(override_path)] {
            assert_eq!(
                super::select_inventory_path(&inventory, &installed, configured),
                Some(inventory.clone())
            );
            assert!(
                std::fs::read(&inventory).is_err(),
                "missing installed inventory must fail closed"
            );
        }
    }

    // Synthetic schema/proposal fixtures, not captured SDK provenance.
    fn platform_fixture(generation: &str) -> Value {
        let digest = |value: &str| format!("sha256:{:x}", Sha256::digest(value.as_bytes()));
        let mut manifests = Vec::new();
        let mut platforms = Vec::new();
        for architecture in ["amd64", "arm64"] {
            let manifest_digest = digest(&format!("{generation}/{architecture}/manifest"));
            let inventory = json!([{"id":"prismpm","kind":"binary","version":"0.3.0",
                "digest":digest(&format!("{generation}/{architecture}/binary"))}]);
            let document = serde_json::to_string(&json!({"schema":"prismpm/sdk-inventory/1", "artifacts":inventory,
                "commands":[{"command":"prismpm","executable":"/usr/local/bin/prismpm","sha256":"a".repeat(64)}]})).unwrap();
            manifests.push(json!({"mediaType":"application/vnd.oci.image.manifest.v1+json",
                "digest":manifest_digest,"size":100,"platform":{"os":"linux","architecture":architecture}}));
            platforms.push(
                json!({"platform":format!("linux/{architecture}"),"manifest_digest":manifest_digest,
                "inventory_digest":digest(&document),"inventory_document":document,"inventory":inventory}),
            );
        }
        let index = serde_json::to_string(&json!({"schemaVersion":2,"mediaType":"application/vnd.oci.image.index.v1+json","manifests":manifests})).unwrap();
        json!({"schema":"prismpm/sdk-lock/2","sdk_version":"0.3.0",
            "sdk_image":format!("example.invalid/test-sdk@{}",digest(&index)),"sdk_index":index,
            "standards_lock":digest(generation),"platforms":platforms})
    }

    #[test]
    fn platform_lock_rejects_rehashed_ambiguous_nested_indexes() {
        let baseline = platform_fixture("strict-index");
        let original: Value =
            serde_json::from_str(baseline["sdk_index"].as_str().unwrap()).unwrap();
        let admit = |raw: String| {
            let mut lock = baseline.clone();
            lock["sdk_image"] = json!(format!(
                "example.invalid/test-sdk@sha256:{:x}",
                Sha256::digest(raw.as_bytes())
            ));
            lock["sdk_index"] = json!(raw);
            let constructed =
                super::CanonicalDocument::from_value("prismpm/sdk-lock/2", lock.clone());
            let parsed = super::parse_lock(&super::encode_value(&lock)?);
            assert_eq!(
                constructed.is_ok(),
                parsed.is_ok(),
                "constructor and public runtime reader must agree"
            );
            if let (Ok(constructed), Ok(parsed)) = (&constructed, &parsed) {
                assert_eq!(constructed.bytes(), parsed.bytes());
            }
            if let (Err(constructed), Err(parsed)) = (&constructed, &parsed) {
                assert_eq!(constructed.code, parsed.code);
            }
            parsed
        };
        assert!(admit(serde_json::to_string_pretty(&original).unwrap() + "\n").is_ok());
        let raw = baseline["sdk_index"].as_str().unwrap();
        let extension_cases: Value =
            serde_json::from_str(include_str!("../sdk/sdk-index-extensions.json")).unwrap();
        for case in extension_cases.as_array().unwrap() {
            let member = case["member"].as_str().unwrap();
            let changed = match case["location"].as_str().unwrap() {
                "root" => format!("{{{member},{}", &raw[1..]),
                "descriptor" => raw.replacen(
                    "\"manifests\":[{",
                    &format!("\"manifests\":[{{{member},"),
                    1,
                ),
                "platform" => {
                    raw.replacen("\"platform\":{", &format!("\"platform\":{{{member},"), 1)
                }
                _ => panic!("unknown corpus location"),
            };
            assert_ne!(changed, raw);
            assert!(admit(raw.to_owned()).is_ok());
            assert_eq!(
                admit(changed).is_ok(),
                case["accepted"].as_bool().unwrap(),
                "{}",
                case["id"]
            );
        }
        for spelling in ["2.0", "2e0", "2000e-3", "2.0000000000000000000000"] {
            assert!(admit(
                raw.replace(
                    "\"schemaVersion\":2",
                    &format!("\"schemaVersion\":{spelling}")
                )
                .replace("\"size\":100", "\"size\":1e2")
            )
            .is_ok());
        }
        let nested = |depth| {
            format!(
                "{{\"extension\":{}0{},{}",
                "[".repeat(depth),
                "]".repeat(depth),
                &raw[1..]
            )
        };
        assert!(admit(nested(63)).is_ok());
        assert_eq!(admit(nested(64)).unwrap_err().code, "PP5401");
        for number in [
            "0",
            "-0",
            "-1",
            "0.5",
            "100.1",
            "1048577",
            "9007199254740993",
            "1e400",
            "100.000000000000000001",
            "1048576.00000000001",
            "99.999999999999999999",
            "1e-10000000",
            "1e10000000",
        ] {
            assert_eq!(
                admit(raw.replace("\"size\":100", &format!("\"size\":{number}")))
                    .unwrap_err()
                    .code,
                "PP5401"
            );
        }
        for number in [
            "2.0000000000000000001",
            "1.9999999999999999999",
            "2.0000000000000000001e0",
        ] {
            assert_eq!(
                admit(raw.replace(
                    "\"schemaVersion\":2",
                    &format!("\"schemaVersion\":{number}")
                ))
                .unwrap_err()
                .code,
                "PP5401"
            );
        }
        assert!(admit(format!("{{\"extension\":0.125,{}", &raw[1..])).is_ok());
        assert!(admit(format!(
            "{{\"extension\":{{\"size\":0.5,\"schemaVersion\":2.0000000000000000001}},{}",
            &raw[1..]
        ))
        .is_ok());
        assert!(admit(raw.replace("\"schemaVersion\":2", "\"schema\\u0056ersion\":2.0")).is_ok());
        assert_eq!(
            admit(raw.replace(
                "\"schemaVersion\":2",
                "\"schema\\u0056ersion\":2.0000000000000000001"
            ))
            .unwrap_err()
            .code,
            "PP5401"
        );
        // No serde feature may reinterpret reserved-looking ordinary objects.
        assert_eq!(
            serde_json::from_str::<Value>(r#"{"$serde_json::private::RawValue":"1"}"#).unwrap(),
            json!({"$serde_json::private::RawValue":"1"})
        );
        for duplicate in [
            format!("{{\"schemaVersion\":2,{}", &raw[1..]),
            format!("{{\"extension\":{{\"a\":1,\"\\u0061\":2}},{}", &raw[1..]),
            raw.replace(
                "\"architecture\":\"amd64\"",
                "\"architecture\":\"amd64\",\"architec\\u0074ure\":\"amd64\"",
            ),
        ] {
            assert!(admit(raw.to_owned()).is_ok());
            assert_eq!(admit(duplicate).unwrap_err().code, "PP5401");
        }
        for mutation in 0..10 {
            assert!(admit(raw.to_owned()).is_ok());
            let mut index = original.clone();
            match mutation {
                0 => index["SchemaVersion"] = json!(2),
                1 => index["Manifeſts"] = json!([]),
                2 => {
                    index["manifests"][0]["MediaType"] = index["manifests"][0]["mediaType"].clone()
                }
                3 => index["manifests"][0]["urls"] = json!([]),
                4 => index["manifests"][0]["data"] = Value::Null,
                5 => index["manifests"][0]["size"] = json!(super::SDK_INDEX_MAX_BYTES + 1),
                6 => index["manifests"][0]["platform"]["OS"] = json!("linux"),
                7 => index["manifests"][0]["platform"]["variant"] = Value::Null,
                8 => index["manifests"][0]["platform"]["os.version"] = Value::Null,
                _ => index["manifests"][1]["platform"]["os.features"] = json!([]),
            }
            assert_eq!(
                admit(serde_json::to_string(&index).unwrap())
                    .unwrap_err()
                    .code,
                "PP5401",
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn platform_update_proposal_describes_every_changed_field_without_adopting_it() {
        let current = platform_fixture("old");
        let proposed = platform_fixture("new");
        let before = current.clone();
        let proposal = super::platform_update_proposal(&current, &proposed).unwrap();
        assert_eq!(proposal["schema"], "prismpm/sdk-lock-update/2");
        assert_eq!(proposal["proposed_lock"], proposed);
        let mut applied = current.clone();
        for change in proposal["changes"].as_array().unwrap() {
            let field = change["path"].as_str().unwrap().strip_prefix('/').unwrap();
            assert_eq!(change["from"], applied[field]);
            applied[field] = change["to"].clone();
        }
        assert_eq!(proposal["changes"].as_array().unwrap().len(), 4);
        assert_eq!(applied, proposed);
        assert_eq!(current, before);
        for review in [
            "compatibility_review",
            "generated_output_diff",
            "security_review",
        ] {
            assert_eq!(proposal[review], "required");
        }
        let unchanged = super::platform_update_proposal(&current, &current).unwrap();
        assert_eq!(unchanged["changes"], json!([]));
    }

    fn legacy_migration_fixture() -> Value {
        json!({"schema":"prismpm/sdk-lock/1","sdk_version":"0.3.0",
            "sdk_image":format!("example.invalid/test-sdk@sha256:{}","a".repeat(64)),
            "standards_lock":format!("sha256:{}","b".repeat(64)),
            "inventory":[{"id":"sdk-manifest","kind":"image","version":"0.3.0","digest":format!("sha256:{}","a".repeat(64))}]})
    }

    #[test]
    fn migration_proposal_reconstructs_the_complete_target_after_testing_the_source() {
        let source = legacy_migration_fixture();
        let target = platform_fixture("migrated");
        let proposal = super::migration_proposal(&source, &target).unwrap();
        let patch = proposal["patch"].as_array().unwrap();
        assert_eq!(patch.len(), 2);
        assert_eq!(patch[0], json!({"op":"test","path":"","value":source}));
        assert_eq!(patch[1], json!({"op":"replace","path":"","value":target}));
        for row in target["platforms"].as_array().unwrap() {
            let admitted = super::CanonicalDocument::from_value(
                "prismpm/sdk-lock/2",
                patch[1]["value"].clone(),
            )
            .unwrap();
            super::validate_running_inventory(
                &admitted,
                row["platform"].as_str().unwrap(),
                row["inventory_document"].as_str().unwrap().as_bytes(),
            )
            .unwrap();
            let wrong = platform_fixture("other");
            assert!(super::validate_running_inventory(
                &admitted,
                row["platform"].as_str().unwrap(),
                wrong["platforms"][0]["inventory_document"]
                    .as_str()
                    .unwrap()
                    .as_bytes()
            )
            .is_err());
        }
    }

    #[test]
    fn migration_rechecks_actual_historical_file_after_target_capture() {
        // Only the capture result is synthetic: this tests the public path's
        // real pre/post file reads, not installed OCI acquisition qualification.
        for mutate in [false, true] {
            let root = tempfile::tempdir().unwrap();
            let path = root.path().join("prismpm.lock");
            let original = super::CanonicalDocument::from_value(
                "prismpm/sdk-lock/1",
                legacy_migration_fixture(),
            )
            .unwrap();
            std::fs::write(&path, original.bytes()).unwrap();
            let mut changed = legacy_migration_fixture();
            changed["standards_lock"] = json!(format!("sha256:{}", "c".repeat(64)));
            let changed =
                super::CanonicalDocument::from_value("prismpm/sdk-lock/1", changed).unwrap();
            let target = platform_fixture("captured");
            let result = super::capture_migration(root.path(), || {
                assert_eq!(std::fs::read(&path).unwrap(), original.bytes());
                if mutate {
                    std::fs::write(&path, changed.bytes()).unwrap();
                }
                super::CanonicalDocument::from_value("prismpm/sdk-lock/2", target.clone())
            });
            if mutate {
                let error = result.unwrap_err();
                assert_eq!(error.code, "PP5401");
                assert_eq!(error.message, "historical SDK lock changed during capture");
                assert_eq!(std::fs::read(&path).unwrap(), changed.bytes());
            } else {
                assert_eq!(result.unwrap()["patch"][1]["value"], target);
                assert_eq!(std::fs::read(&path).unwrap(), original.bytes());
            }
            assert_eq!(std::fs::read_dir(root.path()).unwrap().count(), 1);
        }
    }

    #[test]
    fn migration_proposal_rejects_incomplete_unreviewed_or_tampered_evidence() {
        let valid =
            super::migration_proposal(&legacy_migration_fixture(), &platform_fixture("migrated"))
                .unwrap();
        for mutation in 0..12 {
            let mut invalid = valid.clone();
            match mutation {
                0 => {
                    invalid["patch"].as_array_mut().unwrap().remove(0);
                }
                1 => invalid["patch"].as_array_mut().unwrap().reverse(),
                2 => invalid["patch"][0]["path"] = json!("/sdk_image"),
                3 => invalid["patch"][1]["value"]["platforms"]
                    .as_array_mut()
                    .unwrap()
                    .clear(),
                4 => invalid["patch"][1]["value"]["sdk_index"] = json!("substituted"),
                5 => {
                    invalid["patch"][1]["value"]["platforms"][1]["inventory_document"] = json!("{}")
                }
                6 => invalid["patch"][0]["value"]["extra"] = json!(true),
                7 => invalid["security_review"] = json!("passed"),
                8 => {
                    invalid["patch"][1]["value"]["platforms"][1]["platform"] = json!("linux/amd64")
                }
                9 => {
                    invalid["patch"][1]["value"]["platforms"][0]["manifest_digest"] =
                        json!(format!("sha256:{}", "0".repeat(64)))
                }
                10 => invalid["patch"][0]["value"] = invalid["patch"][1]["value"].clone(),
                _ => invalid["patch"][1]["value"]["inventory"] = json!([]),
            }
            assert!(
                super::CanonicalDocument::from_value("prismpm/sdk-lock-migration/1", invalid)
                    .is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn historical_migration_read_is_canonical_read_only_and_not_execution_admission() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("prismpm.lock");
        let source =
            super::CanonicalDocument::from_value("prismpm/sdk-lock/1", legacy_migration_fixture())
                .unwrap();
        std::fs::write(&path, source.bytes()).unwrap();
        assert_eq!(
            super::historical_migration_lock(root.path())
                .unwrap()
                .bytes(),
            source.bytes()
        );
        assert_eq!(std::fs::read(&path).unwrap(), source.bytes());
        let target = platform_fixture("other");
        assert!(super::validate_running_inventory(
            &source,
            "linux/amd64",
            target["platforms"][0]["inventory_document"]
                .as_str()
                .unwrap()
                .as_bytes()
        )
        .is_err());
        std::fs::write(&path, serde_json::to_string_pretty(source.value()).unwrap()).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::write(&path, b"not json").unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::write(
            &path,
            super::CanonicalDocument::from_value("prismpm/sdk-lock/2", target)
                .unwrap()
                .bytes(),
        )
        .unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::remove_file(&path).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::create_dir(&path).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn historical_migration_rejects_aliases_and_oversized_files() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("target");
        let path = root.path().join("prismpm.lock");
        let source =
            super::CanonicalDocument::from_value("prismpm/sdk-lock/1", legacy_migration_fixture())
                .unwrap();
        std::fs::write(&target, source.bytes()).unwrap();
        std::os::unix::fs::symlink(&target, &path).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::remove_file(&target).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::remove_file(&path).unwrap();
        std::fs::write(&target, source.bytes()).unwrap();
        std::fs::hard_link(&target, &path).unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
        std::fs::remove_file(&path).unwrap();
        std::fs::remove_file(&target).unwrap();
        std::fs::File::create(&path)
            .unwrap()
            .set_len(super::SDK_CAPTURE_MAX_BYTES as u64 + 1)
            .unwrap();
        assert!(super::historical_migration_lock(root.path()).is_err());
    }

    #[test]
    fn platform_update_rejects_partial_platforms_and_inconsistent_or_unreviewed_changes() {
        let current = platform_fixture("old");
        let proposed = platform_fixture("new");
        let mut missing = proposed.clone();
        missing["platforms"].as_array_mut().unwrap().pop();
        assert!(super::platform_update_proposal(&current, &missing).is_err());
        let valid = super::platform_update_proposal(&current, &proposed).unwrap();
        for mutation in 0..6 {
            let mut invalid = valid.clone();
            match mutation {
                0 => invalid["changes"][0]["to"] = current["platforms"].clone(),
                1 => invalid["changes"].as_array_mut().unwrap().reverse(),
                2 => invalid["security_review"] = json!("passed"),
                3 => invalid["changes"][0]["from"] = invalid["changes"][0]["to"].clone(),
                4 => invalid["changes"][0]["path"] = json!("/inventory"),
                _ => invalid["proposed_lock"]["sdk_index"] = json!("tampered index"),
            }
            assert!(
                super::CanonicalDocument::from_value("prismpm/sdk-lock-update/2", invalid).is_err(),
                "mutation {mutation}"
            );
        }
    }

    #[test]
    fn legacy_update_remains_a_read_only_v1_proposal() {
        let root = tempfile::tempdir().unwrap();
        let mut current = json!({"schema":"prismpm/sdk-lock/1","sdk_version":"0.3.0",
            "sdk_image":format!("example.invalid/test-sdk@sha256:{}","a".repeat(64)),
            "standards_lock":format!("sha256:{}","b".repeat(64)),
            "inventory":[{"id":"prismpm","kind":"binary","version":"0.3.0","digest":format!("sha256:{}","c".repeat(64))}]});
        // Installed SDK runs must exercise the same runtime binding as users;
        // the synthetic bootstrap inventory is deliberately not an SDK claim.
        if let Some(path) = super::inventory_path() {
            let installed: serde_json::Value =
                serde_json::from_slice(&std::fs::read(path).unwrap()).unwrap();
            let mut artifacts = installed["artifacts"].as_array().unwrap().clone();
            artifacts.push(json!({"id":"sdk-manifest","kind":"image","version":"0.3.0",
                "digest":format!("sha256:{}", "a".repeat(64))}));
            artifacts.sort_by(|left, right| left["id"].as_str().cmp(&right["id"].as_str()));
            current["inventory"] = json!(artifacts);
        }
        let bytes = serde_json::to_vec(&current).unwrap();
        std::fs::write(root.path().join("prismpm.lock"), &bytes).unwrap();
        let result = super::propose_lock_update(
            root.path(),
            &format!("example.invalid/test-sdk@sha256:{}", "d".repeat(64)),
            &format!("sha256:{}", "e".repeat(64)),
        )
        .unwrap();
        assert_eq!(result["schema"], "prismpm/sdk-lock-update/1");
        assert_eq!(result["changes"].as_array().unwrap().len(), 2);
        super::CanonicalDocument::from_value("prismpm/sdk-lock-update/1", result).unwrap();
        assert_eq!(
            std::fs::read(root.path().join("prismpm.lock")).unwrap(),
            bytes
        );
        assert!(super::propose_lock_update(
            root.path(),
            "example.invalid/test-sdk:mutable",
            &format!("sha256:{}", "e".repeat(64))
        )
        .is_err());
        assert!(super::propose_lock_update(
            root.path(),
            &format!("example.invalid/test-sdk@sha256:{}", "d".repeat(64)),
            "malformed"
        )
        .is_err());
    }

    #[test]
    fn installation_is_idempotent_and_detects_mutation() {
        let root = tempfile::tempdir().unwrap();
        let first = super::install_project_inputs(root.path()).unwrap();
        let second = super::install_project_inputs(root.path()).unwrap();
        assert_eq!(first, second);
        std::fs::write(
            root.path()
                .join(".prism/sdk/inputs/stdlib/Production/Core.lex.tex"),
            b"changed",
        )
        .unwrap();
        assert!(super::install_project_inputs(root.path()).is_err());
    }
}
