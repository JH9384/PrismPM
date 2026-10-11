//! Closed input staging for the two-root reproducibility gate.
//!
//! Inputs are the gate's fixed source directories, not a concurrently mutable
//! filesystem API. Missing entries, traversal failures, aliases and special
//! files must fail the gate rather than produce two identically incomplete trees.

use std::io;
use std::path::Path;

pub(crate) fn copy_tree(from: &Path, to: &Path) -> io::Result<()> {
    if !std::fs::symlink_metadata(from)?.is_dir() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidInput,
            format!(
                "reproducibility input is not a directory: {}",
                from.display()
            ),
        ));
    }
    for entry in walkdir::WalkDir::new(from).follow_links(false) {
        let entry = entry.map_err(io::Error::other)?;
        let relative = entry.path().strip_prefix(from).map_err(io::Error::other)?;
        let target = to.join(relative);
        if entry.file_type().is_dir() {
            std::fs::create_dir_all(&target)?;
        } else if entry.file_type().is_file() {
            std::fs::copy(entry.path(), &target)?;
        } else {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                format!(
                    "reproducibility input is not a regular file or directory: {}",
                    entry.path().display()
                ),
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::copy_tree;
    use std::fs;

    #[test]
    fn complete_tree_retains_nested_bytes_empty_files_and_directories() {
        let temp = tempfile::tempdir().unwrap();
        let from = temp.path().join("input");
        let to = temp.path().join("output");
        fs::create_dir_all(from.join("nested/empty-directory")).unwrap();
        fs::write(from.join("nested/bytes"), [0, 255, 1, 0]).unwrap();
        fs::write(from.join("empty-file"), []).unwrap();
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(from.join("nested/bytes"), fs::Permissions::from_mode(0o751))
                .unwrap();
        }
        copy_tree(&from, &to).unwrap();
        assert_eq!(fs::read(to.join("nested/bytes")).unwrap(), [0, 255, 1, 0]);
        assert_eq!(fs::read(to.join("empty-file")).unwrap(), b"");
        assert!(to.join("nested/empty-directory").is_dir());
        assert_eq!(walkdir::WalkDir::new(&from).into_iter().count(), 5);
        assert_eq!(walkdir::WalkDir::new(&to).into_iter().count(), 5);
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            assert_eq!(
                fs::metadata(to.join("nested/bytes"))
                    .unwrap()
                    .permissions()
                    .mode()
                    & 0o7777,
                0o751
            );
        }
    }

    #[test]
    fn absent_and_wrong_type_roots_are_not_successful_empty_trees() {
        let temp = tempfile::tempdir().unwrap();
        let to = temp.path().join("output");
        assert_eq!(
            copy_tree(&temp.path().join("absent"), &to)
                .unwrap_err()
                .kind(),
            std::io::ErrorKind::NotFound
        );
        assert!(!to.exists());
        let file = temp.path().join("file");
        fs::write(&file, b"not a directory").unwrap();
        assert_eq!(
            copy_tree(&file, &to).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert!(!to.exists());
    }

    #[test]
    fn output_creation_and_file_copy_errors_are_propagated() {
        let temp = tempfile::tempdir().unwrap();
        let from = temp.path().join("input");
        fs::create_dir(&from).unwrap();
        fs::write(from.join("payload"), b"source").unwrap();
        let to = temp.path().join("output");
        fs::write(&to, b"blocked root").unwrap();
        assert!(copy_tree(&from, &to).is_err());
        assert_eq!(fs::read(&to).unwrap(), b"blocked root");
        let empty = temp.path().join("empty");
        fs::create_dir(&empty).unwrap();
        assert!(copy_tree(&empty, &to).is_err());
        assert_eq!(fs::read(&to).unwrap(), b"blocked root");
        fs::remove_file(&to).unwrap();
        fs::create_dir_all(to.join("payload")).unwrap();
        assert!(copy_tree(&from, &to).is_err());
        assert!(to.join("payload").is_dir());
    }

    #[cfg(unix)]
    #[test]
    fn live_dangling_file_and_directory_aliases_are_rejected() {
        use std::os::unix::fs::symlink;
        let temp = tempfile::tempdir().unwrap();
        let from = temp.path().join("input");
        let to = temp.path().join("output");
        fs::create_dir(&from).unwrap();
        let outside = temp.path().join("outside");
        fs::write(&outside, b"outside bytes").unwrap();
        let alias_root = temp.path().join("alias-root");
        symlink(&from, &alias_root).unwrap();
        assert!(copy_tree(&alias_root, &to).is_err());
        assert!(!to.exists());
        for target in [&outside, &temp.path().join("absent"), temp.path()] {
            symlink(target, from.join("alias")).unwrap();
            assert!(copy_tree(&from, &to).is_err());
            assert!(!to.join("alias").exists());
            fs::remove_file(from.join("alias")).unwrap();
        }
        assert_eq!(fs::read(&outside).unwrap(), b"outside bytes");
    }

    #[cfg(unix)]
    #[test]
    fn special_entries_are_rejected_without_opening_them() {
        let temp = tempfile::tempdir().unwrap();
        let from = temp.path().join("input");
        fs::create_dir(&from).unwrap();
        let _socket = std::os::unix::net::UnixListener::bind(from.join("socket")).unwrap();
        let to = temp.path().join("output");
        assert_eq!(
            copy_tree(&from, &to).unwrap_err().kind(),
            std::io::ErrorKind::InvalidInput
        );
        assert!(!to.join("socket").exists());
    }

    #[cfg(target_os = "linux")]
    #[test]
    fn unreadable_files_and_walk_errors_are_not_omitted() {
        use std::os::unix::fs::PermissionsExt;
        use std::os::unix::process::CommandExt;
        const CHILD: &str = "PRISMPM_REPRO_COPY_PERMISSION_CHILD";
        fn assert_denied(root: &std::path::Path) {
            assert_eq!(
                fs::read_dir(root.join("directory-input/blocked"))
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::PermissionDenied
            );
            assert_eq!(
                fs::File::open(root.join("file-input/required"))
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::PermissionDenied
            );
            let walk_error = copy_tree(
                &root.join("directory-input"),
                &root.join("outputs/directory"),
            )
            .unwrap_err();
            assert!(walk_error.to_string().contains("blocked"), "{walk_error}");
            let traversal = walk_error
                .get_ref()
                .unwrap()
                .downcast_ref::<walkdir::Error>()
                .unwrap();
            assert_eq!(
                traversal.io_error().unwrap().kind(),
                std::io::ErrorKind::PermissionDenied
            );
            assert_eq!(
                copy_tree(&root.join("file-input"), &root.join("outputs/file"))
                    .unwrap_err()
                    .kind(),
                std::io::ErrorKind::PermissionDenied
            );
        }
        if let Some(root) = std::env::var_os(CHILD) {
            assert_denied(std::path::Path::new(&root));
            return;
        }
        let temp = tempfile::tempdir().unwrap();
        fs::set_permissions(temp.path(), fs::Permissions::from_mode(0o755)).unwrap();
        let blocked_directory = temp.path().join("directory-input/blocked");
        fs::create_dir_all(&blocked_directory).unwrap();
        fs::write(blocked_directory.join("required"), b"must not disappear").unwrap();
        fs::create_dir(temp.path().join("file-input")).unwrap();
        let blocked_file = temp.path().join("file-input/required");
        fs::write(&blocked_file, b"must not disappear").unwrap();
        fs::create_dir(temp.path().join("outputs")).unwrap();
        fs::set_permissions(
            temp.path().join("outputs"),
            fs::Permissions::from_mode(0o777),
        )
        .unwrap();
        fs::set_permissions(&blocked_directory, fs::Permissions::from_mode(0o0)).unwrap();
        fs::set_permissions(&blocked_file, fs::Permissions::from_mode(0o0)).unwrap();
        let denied = fs::read_dir(&blocked_directory)
            .is_err_and(|e| e.kind() == std::io::ErrorKind::PermissionDenied)
            && fs::File::open(&blocked_file)
                .is_err_and(|e| e.kind() == std::io::ErrorKind::PermissionDenied);
        let output = if denied {
            // Nonroot, or root without DAC bypass: prove both real failures
            // under the actual owner identity; this is not a skipped branch.
            assert_denied(temp.path());
            None
        } else {
            // A privileged-root owner must exercise the same tests without
            // DAC bypass. Expose its actual test binary through traversable
            // private ancestors, not an alternate test implementation.
            let binary = temp.path().join("current-test-binary");
            fs::copy(std::env::current_exe().unwrap(), &binary).unwrap();
            fs::set_permissions(&binary, fs::Permissions::from_mode(0o755)).unwrap();
            Some(
                std::process::Command::new(binary)
                    .args([
                        "--exact",
                        "source_copy::tests::unreadable_files_and_walk_errors_are_not_omitted",
                        "--nocapture",
                    ])
                    .env(CHILD, temp.path())
                    .uid(65534)
                    .gid(65534)
                    .output(),
            )
        };
        fs::set_permissions(&blocked_directory, fs::Permissions::from_mode(0o755)).unwrap();
        fs::set_permissions(&blocked_file, fs::Permissions::from_mode(0o644)).unwrap();
        if let Some(output) = output {
            let output = output.unwrap();
            assert!(
                output.status.success(),
                "{}{}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(String::from_utf8_lossy(&output.stdout).contains("1 passed; 0 failed"));
        }
    }
}
