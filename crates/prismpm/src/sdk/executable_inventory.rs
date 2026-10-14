//! Fresh PATH inventory, hashing canonical aliases under one held descriptor.

use super::{ExecutableFile, PrismError};
use serde_json::{json, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::OsStr;
use std::path::{Path, PathBuf};

struct Alias {
    command: String,
    selected: PathBuf,
}

fn collect(path: &OsStr) -> Result<BTreeMap<PathBuf, Vec<Alias>>, PrismError> {
    let mut seen = BTreeSet::new();
    let mut groups = BTreeMap::<PathBuf, Vec<Alias>>::new();
    for directory in std::env::split_paths(path) {
        let mut entries = match std::fs::read_dir(&directory) {
            Ok(entries) => entries.collect::<Result<Vec<_>, _>>().map_err(invalid)?,
            Err(_) => continue,
        };
        entries.sort_by_key(std::fs::DirEntry::file_name);
        for entry in entries {
            let command = entry.file_name().into_string().map_err(|_| {
                PrismError::new("PP5401", "SDK PATH contains a non-UTF-8 command name")
            })?;
            if seen.contains(&command) {
                continue;
            }
            let resolved = match entry.path().canonicalize() {
                Ok(path) => path,
                Err(_) => continue,
            };
            let metadata = match std::fs::metadata(&resolved) {
                Ok(metadata) if metadata.is_file() => metadata,
                _ => continue,
            };
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                if metadata.permissions().mode() & 0o111 == 0 {
                    continue;
                }
            }
            groups.entry(resolved).or_default().push(Alias {
                command: command.clone(),
                selected: entry.path(),
            });
            seen.insert(command);
        }
    }
    Ok(groups)
}

fn invalid(error: std::io::Error) -> PrismError {
    PrismError::new("PP5401", error.to_string())
}

fn checked_rows(
    resolved: &Path,
    aliases: &[Alias],
    file: &ExecutableFile,
    digest: &str,
) -> Result<Vec<Value>, PrismError> {
    let mut rows = Vec::with_capacity(aliases.len());
    for alias in aliases {
        // Every selected alias must still refer to this exact held regular file.
        file.verify_reference(&alias.selected).map_err(invalid)?;
        rows.push(json!({
            "command": alias.command,
            "executable": resolved.to_string_lossy(),
            "sha256": digest,
        }));
    }
    Ok(rows)
}

pub(super) fn inventory(path: &OsStr) -> Result<Value, PrismError> {
    let groups = collect(path)?;
    let mut commands = Vec::new();
    for (resolved, aliases) in groups {
        // No cache or descriptor survives this iteration, inventory invocation,
        // or any child execution. Distinct canonical paths never share a hash.
        let mut file = ExecutableFile::open(&resolved).map_err(invalid)?;
        for alias in &aliases {
            file.verify_reference(&alias.selected).map_err(invalid)?;
        }
        let digest = file.sha256().map_err(invalid)?;
        commands.extend(checked_rows(&resolved, &aliases, &file, &digest)?);
    }
    commands.sort_by(|left, right| left["command"].as_str().cmp(&right["command"].as_str()));
    Ok(json!({"commands":commands,"schema":"prismpm/sdk-inventory/1"}))
}

#[cfg(test)]
mod tests {
    use super::*;
    use sha2::{Digest, Sha256};

    fn tool(path: &Path, bytes: &[u8]) {
        std::fs::write(path, bytes).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o700)).unwrap();
        }
    }

    fn rows(path: &Path) -> Vec<Value> {
        inventory(path.as_os_str()).unwrap()["commands"]
            .as_array()
            .unwrap()
            .clone()
    }

    #[test]
    fn fresh_inventory_matches_original_rows_and_rehashes_changed_bytes() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("tool");
        tool(&path, b"first");
        let first = rows(root.path());
        assert_eq!(first.len(), 1);
        assert_eq!(first[0]["command"], "tool");
        assert_eq!(first[0]["executable"], path.to_string_lossy().as_ref());
        assert_eq!(
            first[0]["sha256"],
            format!("{:x}", Sha256::digest(b"first"))
        );
        tool(&path, b"second");
        let second = rows(root.path());
        assert_eq!(
            second[0]["sha256"],
            format!("{:x}", Sha256::digest(b"second"))
        );
        assert_ne!(first, second);
    }

    #[test]
    fn distinct_canonical_files_with_equal_bytes_are_separate_groups() {
        let root = tempfile::tempdir().unwrap();
        for name in ["lake", "lean"] {
            tool(&root.path().join(name), b"same bytes");
        }
        assert_eq!(collect(root.path().as_os_str()).unwrap().len(), 2);
        let actual = rows(root.path());
        assert_eq!(actual.len(), 2);
        assert_eq!(actual[0]["sha256"], actual[1]["sha256"]);
        assert_ne!(actual[0]["executable"], actual[1]["executable"]);
    }

    #[test]
    fn first_eligible_path_command_wins_and_rows_remain_sorted() {
        let root = tempfile::tempdir().unwrap();
        let first = root.path().join("first");
        let second = root.path().join("second");
        std::fs::create_dir(&first).unwrap();
        std::fs::create_dir(&second).unwrap();
        tool(&first.join("zeta"), b"first");
        tool(&second.join("zeta"), b"shadowed");
        tool(&second.join("alpha"), b"alpha");
        let path =
            std::env::join_paths([root.path().join("absent"), first.clone(), second]).unwrap();
        let actual = inventory(&path).unwrap();
        assert_eq!(actual["commands"][0]["command"], "alpha");
        assert_eq!(actual["commands"][1]["command"], "zeta");
        assert_eq!(
            actual["commands"][1]["executable"],
            first.join("zeta").to_string_lossy().as_ref()
        );
    }

    #[cfg(unix)]
    #[test]
    fn aliases_share_only_the_canonical_group_and_preserve_all_command_rows() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let selected = root.path().join("bin");
        std::fs::create_dir(&selected).unwrap();
        let canonical = root.path().join("rustup");
        tool(&canonical, b"real multicalled executable bytes");
        for name in ["rustc", "cargo", "rustfmt"] {
            symlink(&canonical, selected.join(name)).unwrap();
        }
        let groups = collect(selected.as_os_str()).unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[&canonical].len(), 3);
        let actual = rows(&selected);
        assert_eq!(actual.len(), 3);
        assert_eq!(actual[0]["command"], "cargo");
        assert_eq!(actual[1]["command"], "rustc");
        assert_eq!(actual[2]["command"], "rustfmt");
        assert!(actual
            .iter()
            .all(|row| row["executable"] == canonical.to_string_lossy().as_ref()));
        assert!(actual.iter().all(|row| row["sha256"]
            == format!("{:x}", Sha256::digest(b"real multicalled executable bytes"))));
    }

    #[cfg(unix)]
    #[test]
    fn alias_retarget_and_held_file_replacement_refuse_after_real_hash() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let selected = root.path().join("bin");
        std::fs::create_dir(&selected).unwrap();
        let canonical = root.path().join("tool");
        let other = root.path().join("other");
        tool(&canonical, b"same");
        tool(&other, b"same");
        let alias = selected.join("cargo");
        symlink(&canonical, &alias).unwrap();
        let groups = collect(selected.as_os_str()).unwrap();
        let aliases = &groups[&canonical];
        let mut file = ExecutableFile::open(&canonical).unwrap();
        let digest = file.sha256().unwrap();
        std::fs::remove_file(&alias).unwrap();
        symlink(&other, &alias).unwrap();
        assert!(checked_rows(&canonical, aliases, &file, &digest).is_err());
        std::fs::remove_file(&alias).unwrap();
        symlink(&canonical, &alias).unwrap();
        std::fs::rename(&other, &canonical).unwrap();
        assert!(checked_rows(&canonical, aliases, &file, &digest).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn rewritten_or_non_regular_tool_refuses_and_unreadable_alias_is_not_admitted() {
        use std::os::unix::fs::symlink;
        let root = tempfile::tempdir().unwrap();
        let selected = root.path().join("bin");
        std::fs::create_dir(&selected).unwrap();
        let canonical = root.path().join("tool");
        tool(&canonical, b"same");
        symlink(&canonical, selected.join("cargo")).unwrap();
        symlink(root.path().join("missing"), selected.join("dangling")).unwrap();
        std::fs::create_dir(selected.join("directory")).unwrap();
        std::fs::write(selected.join("nonexecutable"), b"unused").unwrap();
        assert_eq!(rows(&selected).len(), 1);
        let groups = collect(selected.as_os_str()).unwrap();
        let mut file = ExecutableFile::open(&canonical).unwrap();
        let digest = file.sha256().unwrap();
        tool(&canonical, b"changed");
        assert!(checked_rows(&canonical, &groups[&canonical], &file, &digest).is_err());
        std::fs::remove_file(&canonical).unwrap();
        std::fs::create_dir(&canonical).unwrap();
        assert!(ExecutableFile::open(&canonical).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_command_name_is_a_diagnostic_not_an_omitted_row() {
        use std::os::unix::ffi::OsStringExt;
        let root = tempfile::tempdir().unwrap();
        tool(
            &root.path().join(std::ffi::OsString::from_vec(vec![0xff])),
            b"tool",
        );
        let error = inventory(root.path().as_os_str()).unwrap_err();
        assert_eq!(error.code, "PP5401");
    }
}
