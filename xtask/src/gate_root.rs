//! Refuse a gate executable whose embedded model root names another worktree.

use std::path::{Path, PathBuf};

fn canonical_directory(path: &Path) -> Result<PathBuf, String> {
    let resolved = path
        .canonicalize()
        .map_err(|error| format!("gate directory {}: {error}", path.display()))?;
    if !resolved.is_dir() {
        return Err(format!("gate directory required: {}", path.display()));
    }
    Ok(resolved)
}

pub(crate) fn checked_root(
    model_root: &Path,
    executable_root: &Path,
    invocation: &Path,
) -> Result<PathBuf, String> {
    let model_root = canonical_directory(model_root)?;
    let executable_root = canonical_directory(executable_root)?;
    if model_root != executable_root {
        return Err("gate/model worktree mismatch; rebuild in an isolated Cargo target".into());
    }
    let invocation = canonical_directory(invocation)?;
    for directory in invocation.ancestors() {
        let manifest = directory.join("Cargo.toml");
        let text = match std::fs::read_to_string(&manifest) {
            Ok(text) => text,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(error) => return Err(format!("gate manifest {}: {error}", manifest.display())),
        };
        let document: toml::Value = toml::from_str(&text)
            .map_err(|error| format!("gate manifest {}: {error}", manifest.display()))?;
        let Some(workspace) = document.get("workspace") else {
            continue;
        };
        if !workspace.is_table() {
            return Err(format!("invalid gate workspace: {}", manifest.display()));
        }
        // A nested worktree can be inside the old root's target directory.
        // Containment is insufficient: the nearest workspace must be identical.
        if directory != model_root {
            return Err(format!(
                "gate invocation worktree mismatch: invoked in {}, compiled for {}; rebuild in an isolated Cargo target",
                directory.display(), model_root.display()
            ));
        }
        return Ok(model_root);
    }
    Err("gate invocation must be inside its compiled Cargo workspace".into())
}

#[cfg(test)]
mod tests {
    use super::checked_root;
    use std::path::{Path, PathBuf};

    fn workspace(parent: &Path, name: &str) -> PathBuf {
        let root = parent.join(name);
        std::fs::create_dir_all(&root).expect("fixture directory");
        std::fs::write(root.join("Cargo.toml"), "[workspace]\nmembers = []\n")
            .expect("fixture workspace");
        root
    }

    #[test]
    fn same_workspace_and_member_invocations_are_admitted() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = workspace(temporary.path(), "repo");
        let member = root.join("crates/member");
        std::fs::create_dir_all(&member).expect("member directory");
        std::fs::write(member.join("Cargo.toml"), "[package]\nname = 'member'\n")
            .expect("member manifest");
        for invocation in [&root, &member] {
            assert_eq!(
                checked_root(&root, &root, invocation),
                Ok(root.canonicalize().expect("physical workspace"))
            );
        }
    }

    #[test]
    fn cached_model_and_executable_from_different_roots_are_refused() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let first = workspace(temporary.path(), "first");
        let second = workspace(temporary.path(), "second");
        for invocation in [&first, &second] {
            assert!(checked_root(&first, &second, invocation)
                .expect_err("mixed embedded roots must fail")
                .contains("gate/model worktree mismatch"));
        }
    }

    #[test]
    fn other_and_nested_worktrees_are_refused_before_the_gate_runs() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = workspace(temporary.path(), "repo");
        for other in [
            workspace(temporary.path(), "other"),
            workspace(&root, "target/nested-worktree"),
        ] {
            assert!(checked_root(&root, &root, &other)
                .expect_err("different nearest workspace must fail")
                .contains("gate invocation worktree mismatch"));
        }
    }

    #[test]
    fn malformed_nearest_manifest_cannot_fall_back_to_an_ancestor() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = workspace(temporary.path(), "repo");
        let nested = workspace(&root, "target/nested-worktree");
        for text in ["[workspace", "workspace = false"] {
            std::fs::write(nested.join("Cargo.toml"), text).expect("bad manifest");
            assert!(checked_root(&root, &root, &nested).is_err());
        }
    }

    #[test]
    fn missing_workspace_or_directory_cannot_select_the_compiled_root() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = workspace(temporary.path(), "repo");
        assert!(checked_root(&root, &root, temporary.path()).is_err());
        assert!(checked_root(&root, &root, &root.join("missing")).is_err());
        assert!(checked_root(&root, &root, &root.join("Cargo.toml")).is_err());
        assert!(checked_root(&root.join("missing"), &root, &root).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn aliases_resolve_to_one_physical_worktree_not_a_different_tree() {
        let temporary = tempfile::tempdir().expect("temporary directory");
        let root = workspace(temporary.path(), "repo");
        let alias = temporary.path().join("alias");
        std::os::unix::fs::symlink(&root, &alias).expect("worktree alias");
        assert_eq!(
            checked_root(&alias, &root, &alias),
            Ok(root.canonicalize().expect("physical workspace"))
        );
    }
}
