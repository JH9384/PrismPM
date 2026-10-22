//! Actual isolated Git identity for the conditional component fixture only.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

const CONFIGURATION: [&str; 7] = [
    "lake-manifest.json",
    "lakefile.toml",
    "lean-toolchain",
    "lexlean.lock",
    "lexlean.toml",
    "prismpm.toml",
    "source-fixture.json",
];
const URI: &str = "urn:prismpm:fixture:publication-context-linkage";

pub(in crate::oci) struct MeasuredFixtureSource {
    root: PathBuf,
    files: BTreeMap<String, Vec<u8>>,
    revision: String,
}

fn files(root: &Path) -> BTreeMap<String, Vec<u8>> {
    let mut paths = CONFIGURATION
        .iter()
        .map(|path| root.join(path))
        .collect::<Vec<_>>();
    for entry in walkdir::WalkDir::new(root.join("src")).follow_links(false) {
        let entry = entry.unwrap();
        assert!(
            !entry.file_type().is_symlink(),
            "fixture source cannot be an alias"
        );
        if entry.file_type().is_file() {
            paths.push(entry.path().to_owned());
        } else {
            assert!(entry.file_type().is_dir());
        }
    }
    let mut bytes = 0_u64;
    paths
        .into_iter()
        .map(|path| {
            let metadata = std::fs::symlink_metadata(&path).unwrap();
            assert!(metadata.is_file() && !metadata.file_type().is_symlink());
            #[cfg(unix)]
            {
                use std::os::unix::fs::MetadataExt;
                assert_eq!(metadata.nlink(), 1, "fixture source is singly linked");
            }
            bytes = bytes.checked_add(metadata.len()).unwrap();
            assert!(bytes <= 67_108_864, "complete fixture source/config bound");
            let body = std::fs::read(&path).unwrap();
            assert_eq!(body.len() as u64, metadata.len());
            (
                path.strip_prefix(root)
                    .unwrap()
                    .to_str()
                    .unwrap()
                    .to_owned(),
                body,
            )
        })
        .collect()
}

fn git(root: &Path, arguments: &[&str]) -> Vec<u8> {
    let result = Command::new("/usr/bin/git")
        .current_dir(root)
        .env_clear()
        .env("PATH", "/usr/bin:/bin")
        .env("GIT_CONFIG_NOSYSTEM", "1")
        .env("GIT_CONFIG_GLOBAL", "/dev/null")
        .env("GIT_CONFIG_SYSTEM", "/dev/null")
        .env("GIT_CONFIG_COUNT", "0")
        .env("GIT_TERMINAL_PROMPT", "0")
        .env("GIT_AUTHOR_NAME", "PrismPM conditional fixture")
        .env("GIT_AUTHOR_EMAIL", "fixture@example.invalid")
        .env("GIT_COMMITTER_NAME", "PrismPM conditional fixture")
        .env("GIT_COMMITTER_EMAIL", "fixture@example.invalid")
        .env("GIT_AUTHOR_DATE", "2000-01-01T00:00:00+0000")
        .env("GIT_COMMITTER_DATE", "2000-01-01T00:00:00+0000")
        .args([
            "-c",
            "core.hooksPath=/dev/null",
            "-c",
            "commit.gpgSign=false",
            "-c",
            "core.autocrlf=false",
            "-c",
            "core.safecrlf=true",
        ])
        .args(arguments)
        .output()
        .unwrap();
    assert!(
        result.status.success(),
        "actual fixture Git operation: {}",
        String::from_utf8_lossy(&result.stderr)
    );
    result.stdout
}

impl MeasuredFixtureSource {
    pub(in crate::oci) fn commit(root: &Path) -> Self {
        assert!(
            !root.join(".git").exists(),
            "never commit an existing repository"
        );
        std::fs::write(
            root.join("source-fixture.json"),
            crate::holo::canonical::encode_value(&serde_json::json!({
                "schema":"prismpm/conditional-source-fixture/1", "uri":URI,
                "scope":"source-linkage-only", "producer_authorized":false
            }))
            .unwrap(),
        )
        .unwrap();
        let files = files(root);
        git(
            root,
            &[
                "init",
                "--quiet",
                "--object-format=sha1",
                "--initial-branch=fixture",
                "--template=",
            ],
        );
        let mut add = vec!["add", "--force", "--"];
        add.extend(files.keys().map(String::as_str));
        git(root, &add);
        git(
            root,
            &[
                "commit",
                "--quiet",
                "--no-gpg-sign",
                "-m",
                "test: capture exact conditional source fixture",
            ],
        );
        let revision = String::from_utf8(git(root, &["rev-parse", "--verify", "HEAD^{commit}"]))
            .unwrap()
            .trim()
            .to_owned();
        assert_eq!(revision.len(), 40);
        assert!(revision
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte)));
        let value = Self {
            root: root.to_owned(),
            files,
            revision,
        };
        value.assert_unchanged(root);
        value
    }

    pub(in crate::oci) fn assert_unchanged(&self, root: &Path) {
        assert_eq!(root, self.root, "exact committed fixture root");
        assert_eq!(
            files(root),
            self.files,
            "complete committed source/config bytes"
        );
        assert_eq!(
            String::from_utf8(git(root, &["rev-parse", "--verify", "HEAD^{commit}"]))
                .unwrap()
                .trim(),
            self.revision
        );
        let tracked = git(root, &["ls-files", "-z"]);
        let names = tracked
            .split(|byte| *byte == 0)
            .filter(|name| !name.is_empty())
            .map(|name| std::str::from_utf8(name).unwrap())
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            self.files.keys().map(String::as_str).collect::<Vec<_>>()
        );
        for (path, bytes) in &self.files {
            assert_eq!(
                git(root, &["cat-file", "blob", &format!("HEAD:{path}")]),
                *bytes,
                "actual committed source blob {path}"
            );
        }
    }

    pub(in crate::oci) fn identity(&self) -> (String, String) {
        (URI.to_owned(), self.revision.clone())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn project() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        std::fs::create_dir(root.path().join("src")).unwrap();
        std::fs::write(root.path().join("src/input.txt"), b"exact fixture source\n").unwrap();
        for name in CONFIGURATION
            .into_iter()
            .filter(|name| *name != "source-fixture.json")
        {
            std::fs::write(
                root.path().join(name),
                format!("fixture configuration {name}\n"),
            )
            .unwrap();
        }
        root
    }

    #[test]
    fn real_fixture_git_commit_is_reproducible_and_rejects_changed_source_inventory() {
        let first = project();
        let second = project();
        let one = MeasuredFixtureSource::commit(first.path());
        let two = MeasuredFixtureSource::commit(second.path());
        assert_eq!(one.identity(), two.identity());
        assert_eq!(one.identity().0, URI);
        for mutation in ["changed", "extra", "missing"] {
            let path = first.path().join("src/input.txt");
            let extra = first.path().join("src/extra.txt");
            match mutation {
                "changed" => std::fs::write(&path, b"changed").unwrap(),
                "extra" => std::fs::write(&extra, b"extra").unwrap(),
                "missing" => std::fs::remove_file(&path).unwrap(),
                _ => unreachable!(),
            }
            assert!(
                std::panic::catch_unwind(|| one.assert_unchanged(first.path())).is_err(),
                "{mutation}"
            );
            if extra.exists() {
                std::fs::remove_file(extra).unwrap();
            }
            std::fs::write(path, b"exact fixture source\n").unwrap();
            one.assert_unchanged(first.path());
        }
    }
}
