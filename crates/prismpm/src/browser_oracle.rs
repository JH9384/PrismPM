//! Integrity boundary for the fixed, SDK-owned portable browser toolchain.

use crate::error::PrismError;
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Path, PathBuf};

const DRIVER: &str = "/opt/prismpm/oracles/node_modules/playwright";
const CORE: &str = "/opt/prismpm/oracles/node_modules/playwright-core";
const BROWSER: &str = "/ms-playwright/chromium_headless_shell-cft-157.0.8099.0";
// Source-bootstrap pins independently derived from integrity-locked npm
// packages and the complete immutable official x64 Chrome for Testing archive
// declared in sdk/browser-engine/authority.json (including upstream notices).
// Released SDKs bind their actual native trees in their signed inventory.
const DRIVER_SHA: &str = "bf3497a2d26912da443d74ef55c0d8155e00a781e3e6c966368d8bd2c8380b5c";
const CORE_SHA: &str = "8d81de4103b7e342d0f997526d84fb334bf92b562f1035bc66da8b77a0b02ab7";
const BROWSER_X64_SHA: &str = "18c79a8a6f785debf08393ce22f57cf5923d996c431c5c55610e5a20109905b7";

fn invalid(message: impl Into<String>) -> PrismError {
    PrismError::new("PP5301", message)
}

// Exact sdk/generate-inventory.mjs treeDigest domain and traversal order:
// sorted directory entries, u64be(path length), UTF-8 path, u64be(file length),
// file bytes. Stream bounded files; reject links, special and writable entries.
fn tree_digest(root: &Path) -> Result<String, PrismError> {
    let metadata = std::fs::symlink_metadata(root).map_err(|error| invalid(error.to_string()))?;
    if !metadata.is_dir()
        || metadata.file_type().is_symlink()
        || root
            .canonicalize()
            .map_err(|error| invalid(error.to_string()))?
            != root
    {
        return Err(invalid(
            "portable oracle artifact root is not a canonical directory",
        ));
    }
    let mut digest = Sha256::new();
    let mut total = 0_u64;
    for (index, entry) in walkdir::WalkDir::new(root)
        .sort_by_file_name()
        .max_open(16)
        .into_iter()
        .enumerate()
    {
        if index >= 20_000 {
            return Err(invalid("portable oracle artifact has too many entries"));
        }
        let entry = entry.map_err(|error| invalid(error.to_string()))?;
        let metadata =
            std::fs::symlink_metadata(entry.path()).map_err(|error| invalid(error.to_string()))?;
        if metadata.file_type().is_symlink() || !(metadata.is_dir() || metadata.is_file()) {
            return Err(invalid(
                "portable oracle artifact contains a symlink or special file",
            ));
        }
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            if metadata.permissions().mode() & 0o022 != 0 {
                return Err(invalid("portable oracle artifact is group/other writable"));
            }
        }
        if metadata.is_dir() {
            continue;
        }
        total = total
            .checked_add(metadata.len())
            .ok_or_else(|| invalid("portable oracle artifact size overflow"))?;
        if metadata.len() > 512 * 1024 * 1024 || total > 1024 * 1024 * 1024 {
            return Err(invalid(
                "portable oracle artifact exceeds bounded tool-tree size",
            ));
        }
        let relative = entry
            .path()
            .strip_prefix(root)
            .map_err(|error| invalid(error.to_string()))?
            .to_str()
            .ok_or_else(|| invalid("portable oracle artifact path is not UTF-8"))?;
        digest.update((relative.len() as u64).to_be_bytes());
        digest.update(relative.as_bytes());
        digest.update(metadata.len().to_be_bytes());
        let mut file = std::fs::File::open(entry.path())
            .map_err(|error| invalid(error.to_string()))?
            .take(metadata.len() + 1);
        let mut read = 0_u64;
        let mut buffer = [0_u8; 65_536];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|error| invalid(error.to_string()))?;
            if count == 0 {
                break;
            }
            read += count as u64;
            digest.update(&buffer[..count]);
        }
        if read != metadata.len() {
            return Err(invalid("portable oracle artifact changed while hashing"));
        }
    }
    Ok(format!("{:x}", digest.finalize()))
}

fn verify_tree(root: &Path, expected: &str) -> Result<(), PrismError> {
    if tree_digest(root)? != expected {
        return Err(invalid(format!(
            "portable oracle artifact {} changed",
            root.display()
        )));
    }
    Ok(())
}

fn expected_digest(
    inventory: Option<&Value>,
    id: &str,
    bootstrap: &str,
) -> Result<String, PrismError> {
    let Some(inventory) = inventory else {
        return Ok(bootstrap.to_owned());
    };
    let rows = inventory["artifacts"]
        .as_array()
        .ok_or_else(|| invalid("SDK oracle artifact inventory is missing"))?;
    let mut matching = rows.iter().filter(|row| row["id"] == id);
    let row = matching
        .next()
        .ok_or_else(|| invalid(format!("SDK oracle artifact {id} is absent")))?;
    let version = match id {
        "playwright-driver" | "playwright-core" => "1.62.1",
        "playwright-headless-shell" => "157.0.8099.0",
        _ => return Err(invalid("unknown portable oracle artifact")),
    };
    if matching.next().is_some() || row["kind"] != "oracle" || row["version"] != version {
        return Err(invalid(format!(
            "SDK oracle artifact {id} is ambiguous or mismatched"
        )));
    }
    let digest = row["digest"]
        .as_str()
        .and_then(|value| value.strip_prefix("sha256:"))
        .filter(|value| {
            value.len() == 64
                && value
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
        })
        .ok_or_else(|| invalid(format!("SDK oracle artifact {id} digest is malformed")))?;
    Ok(digest.to_owned())
}

pub(crate) fn verified_browser() -> Result<PathBuf, PrismError> {
    // The controller's inventory-aware Node resolution has already checked
    // SDK executables. These comparisons additionally bind the actual files.
    let inventory = crate::sdk::inventory_path()
        .map(|path| {
            let bytes = std::fs::read(path).map_err(|error| invalid(error.to_string()))?;
            serde_json::from_slice::<Value>(&bytes).map_err(|error| invalid(error.to_string()))
        })
        .transpose()?;
    if inventory.is_none() && std::env::consts::ARCH != "x86_64" {
        return Err(invalid("source-bootstrap browser pins require the x64 devcontainer; use the native pinned SDK on other architectures"));
    }
    for (id, root, bootstrap) in [
        ("playwright-driver", DRIVER, DRIVER_SHA),
        ("playwright-core", CORE, CORE_SHA),
        ("playwright-headless-shell", BROWSER, BROWSER_X64_SHA),
    ] {
        verify_tree(
            Path::new(root),
            &expected_digest(inventory.as_ref(), id, bootstrap)?,
        )?;
    }
    let relative = match std::env::consts::ARCH {
        "x86_64" => "chrome-headless-shell-linux64/chrome-headless-shell",
        "aarch64" => "chrome-headless-shell-linux-arm64/chrome-headless-shell",
        _ => return Err(invalid("unsupported portable browser architecture")),
    };
    let executable = Path::new(BROWSER).join(relative);
    if !executable.is_file() {
        return Err(invalid("verified browser executable is missing"));
    }
    Ok(executable)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fixed_installed_browser_passes_its_independent_authority() {
        crate::verification::executable("node").unwrap();
        assert!(verified_browser().unwrap().starts_with(BROWSER));
    }

    #[test]
    fn exact_driver_tree_rejects_an_actual_modified_javascript_file() {
        verify_tree(Path::new(DRIVER), DRIVER_SHA).unwrap();
        let copy = tempfile::tempdir().unwrap();
        for entry in walkdir::WalkDir::new(DRIVER).min_depth(1) {
            let entry = entry.unwrap();
            let target = copy.path().join(entry.path().strip_prefix(DRIVER).unwrap());
            if entry.file_type().is_dir() {
                std::fs::create_dir(&target).unwrap();
            } else {
                std::fs::copy(entry.path(), &target).unwrap();
            }
        }
        verify_tree(copy.path(), DRIVER_SHA).unwrap();
        std::fs::write(
            copy.path().join("index.js"),
            b"throw new Error('planted driver corruption');\n",
        )
        .unwrap();
        assert_eq!(
            verify_tree(copy.path(), DRIVER_SHA).unwrap_err().code,
            "PP5301"
        );
    }

    #[test]
    fn tree_domain_and_non_regular_rejection_match_the_sdk() {
        let root = tempfile::tempdir().unwrap();
        std::fs::write(root.path().join("a"), b"bc").unwrap();
        let expected =
            Sha256::digest([&1_u64.to_be_bytes()[..], b"a", &2_u64.to_be_bytes(), b"bc"].concat());
        assert_eq!(tree_digest(root.path()).unwrap(), format!("{expected:x}"));
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(root.path().join("a"), root.path().join("b")).unwrap();
            assert_eq!(tree_digest(root.path()).unwrap_err().code, "PP5301");
        }
    }

    #[test]
    fn oversized_or_writable_tool_files_fail_without_reading_the_payload() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("oversized");
        std::fs::File::create(&path)
            .unwrap()
            .set_len(512 * 1024 * 1024 + 1)
            .unwrap();
        assert!(tree_digest(root.path())
            .unwrap_err()
            .message
            .contains("bounded"));
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::File::create(&path).unwrap().set_len(0).unwrap();
            std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o666)).unwrap();
            assert!(tree_digest(root.path())
                .unwrap_err()
                .message
                .contains("writable"));
        }
    }

    #[test]
    fn signed_artifact_rows_cannot_be_missing_duplicated_or_substituted() {
        let row = serde_json::json!({"id":"playwright-core","kind":"oracle","version":"1.62.1","digest":format!("sha256:{CORE_SHA}")});
        assert_eq!(
            expected_digest(
                Some(&serde_json::json!({"artifacts":[row.clone()]})),
                "playwright-core",
                ""
            )
            .unwrap(),
            CORE_SHA
        );
        for rows in [
            serde_json::json!([]),
            serde_json::json!([row.clone(), row]),
            serde_json::json!([{"id":"playwright-core","kind":"oracle","version":"1.62.0","digest":format!("sha256:{CORE_SHA}")}]),
        ] {
            assert_eq!(
                expected_digest(
                    Some(&serde_json::json!({"artifacts":rows})),
                    "playwright-core",
                    ""
                )
                .unwrap_err()
                .code,
                "PP5301"
            );
        }
    }

    #[test]
    fn browser_version_is_distinct_from_unchanged_playwright_driver_version() {
        for version in ["1.62.1", "157.0.8099.0"] {
            let inventory = serde_json::json!({"artifacts":[{
                "id":"playwright-headless-shell","kind":"oracle","version":version,
                "digest":format!("sha256:{BROWSER_X64_SHA}")
            }]});
            let result = expected_digest(Some(&inventory), "playwright-headless-shell", "");
            if version == "157.0.8099.0" {
                assert_eq!(result.unwrap(), BROWSER_X64_SHA);
            } else {
                assert_eq!(result.unwrap_err().code, "PP5301");
            }
        }
    }
}
