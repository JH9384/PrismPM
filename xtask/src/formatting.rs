//! Closed authored Rust coverage for the first V&V gate.

use std::collections::BTreeSet;
use std::path::Path;
use std::process::Command;

type Failure = Box<dyn std::error::Error>;

const COMPILERS: &[&str] = &[
    "vendor/lean4-prod/rust/Cargo.toml",
    "vendor/lexlean/Cargo.toml",
];
const HARNESSES: &[(&str, &str)] = &[
    (
        "tests/browser-workspace/Cargo.toml",
        "tests/browser-workspace/src/main.rs",
    ),
    (
        "tests/browser-envelope/driver/Cargo.toml",
        "tests/browser-envelope/driver/src/main.rs",
    ),
    (
        "tests/browser-journal/driver/Cargo.toml",
        "tests/browser-journal/driver/src/main.rs",
    ),
    (
        "tests/browser-command/driver/Cargo.toml",
        "tests/browser-command/driver/src/main.rs",
    ),
    (
        "tests/browser-query/driver/Cargo.toml",
        "tests/browser-query/driver/src/main.rs",
    ),
    (
        "tests/browser-view/driver/Cargo.toml",
        "tests/browser-view/driver/src/main.rs",
    ),
    (
        "tests/browser-effects/driver/Cargo.toml",
        "tests/browser-effects/driver/src/main.rs",
    ),
    (
        "tests/browser-presentation/driver/Cargo.toml",
        "tests/browser-presentation/driver/src/main.rs",
    ),
    (
        "tests/browser-custody/driver/Cargo.toml",
        "tests/browser-custody/driver/src/main.rs",
    ),
    (
        "tests/browser-operation-journal/driver/Cargo.toml",
        "tests/browser-operation-journal/driver/src/main.rs",
    ),
    (
        "tests/publication-admission/driver/Cargo.toml",
        "tests/publication-admission/driver/src/main.rs",
    ),
    (
        "tests/browser-budget/driver/Cargo.toml",
        "tests/browser-budget/driver/src/main.rs",
    ),
    (
        "tests/holo-codec-oracle/Cargo.toml",
        "tests/holo-codec-oracle/src/main.rs",
    ),
    (
        "tests/holo-browser-codec/Cargo.toml",
        "tests/holo-browser-wire-generated.rs",
    ),
];
const SOURCES: &[&str] = &[
    "tests/browser-workspace/runner.rs",
    "tests/support/browser_application.rs",
    "tests/browser-envelope/runner.rs",
    "tests/browser-journal/runner.rs",
    "tests/browser-command/runner.rs",
    "tests/browser-query/runner.rs",
    "tests/browser-view/runner.rs",
    "tests/browser-effects/runner.rs",
    "tests/browser-presentation/runner.rs",
    "tests/browser-custody/runner.rs",
    "tests/browser-operation-journal/runner.rs",
    "tests/publication-admission/runner.rs",
    "tests/browser-budget/runner.rs",
    "tests/hologram-oracle/src/main.rs",
    "tests/hologram-oracle/tests/browser_surface.rs",
    "tests/holo-codec-oracle/tests/ancient_mint_freeze.rs",
];
// The workspace integration target includes this authored module. Its name
// describes the code it tests, not code generated into this file.
const WORKSPACE_SOURCES: &[&str] = &["tests/holo-wire-generated.rs"];
// This oracle's dependencies are privately extracted for execution. Format
// its authored source directly without resolving that absent dependency tree.
const SOURCE_ONLY_MANIFESTS: &[&str] = &["tests/hologram-oracle/Cargo.toml"];

pub(crate) struct Invocation {
    pub(crate) program: &'static str,
    pub(crate) arguments: Vec<&'static str>,
}

fn inventory() -> Vec<&'static str> {
    HARNESSES
        .iter()
        .flat_map(|(manifest, source)| [*manifest, *source])
        .chain(SOURCES.iter().copied())
        .chain(WORKSPACE_SOURCES.iter().copied())
        .chain(SOURCE_ONLY_MANIFESTS.iter().copied())
        .collect()
}

fn authored_test_inputs(root: &Path) -> Result<Vec<String>, Failure> {
    let output = Command::new("git")
        .args([
            "ls-files",
            "--cached",
            "--others",
            "--exclude-standard",
            "-z",
            "--",
            "tests",
        ])
        .current_dir(root)
        .output()?;
    if !output.status.success() {
        return Err("cannot enumerate authored formatting inputs".into());
    }
    Ok(String::from_utf8(output.stdout)?
        .split('\0')
        .filter(|path| path.ends_with(".rs") || path.ends_with("/Cargo.toml"))
        .map(str::to_owned)
        .collect())
}

fn validate_inventory(actual: &[String], expected: &[&str]) -> Result<(), Failure> {
    let selected = expected.iter().copied().collect::<BTreeSet<_>>();
    if selected.len() != expected.len() {
        return Err("duplicate authored formatting input".into());
    }
    let observed = actual.iter().map(String::as_str).collect::<BTreeSet<_>>();
    if observed.len() != actual.len() {
        return Err("duplicate discovered formatting input".into());
    }
    if observed != selected {
        return Err(format!(
            "authored formatting inventory mismatch: unselected={:?}, absent={:?}",
            observed.difference(&selected).collect::<Vec<_>>(),
            selected.difference(&observed).collect::<Vec<_>>()
        )
        .into());
    }
    Ok(())
}

pub(crate) fn commands(root: &Path) -> Result<Vec<Invocation>, Failure> {
    validate_inventory(&authored_test_inputs(root)?, &inventory())?;
    // Generated stdlib bytes belong to regeneration, never rustfmt. Only
    // pinned compiler workspaces use --all; authored harnesses do not traverse
    // their generated path dependencies.
    let mut commands = vec![Invocation {
        program: "cargo",
        arguments: vec!["fmt", "--", "--check"],
    }];
    for manifest in COMPILERS {
        commands.push(Invocation {
            program: "cargo",
            arguments: vec!["fmt", "--manifest-path", manifest, "--all", "--", "--check"],
        });
    }
    for (manifest, _) in HARNESSES {
        commands.push(Invocation {
            program: "cargo",
            arguments: vec!["fmt", "--manifest-path", manifest, "--", "--check"],
        });
    }
    let mut arguments = vec!["--edition", "2021", "--check"];
    arguments.extend_from_slice(SOURCES);
    commands.push(Invocation {
        program: "rustfmt",
        arguments,
    });
    Ok(commands)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;
    use std::sync::atomic::{AtomicU64, Ordering};

    fn root() -> PathBuf {
        option_env!("CARGO_MANIFEST_DIR").map_or_else(
            || std::env::current_dir().unwrap(),
            |path| Path::new(path).parent().unwrap().to_owned(),
        )
    }

    #[test]
    fn every_authored_test_manifest_and_rust_file_is_selected() {
        validate_inventory(&authored_test_inputs(&root()).unwrap(), &inventory()).unwrap();
    }

    #[test]
    fn missing_duplicate_and_stale_entries_fail_closed() {
        let actual = authored_test_inputs(&root()).unwrap();
        let expected = inventory();
        for omitted in &expected {
            let missing = expected
                .iter()
                .copied()
                .filter(|path| path != omitted)
                .collect::<Vec<_>>();
            assert!(
                validate_inventory(&actual, &missing).is_err(),
                "missing {omitted}"
            );
        }
        let mut duplicate = expected.clone();
        duplicate.push(expected[0]);
        assert!(validate_inventory(&actual, &duplicate)
            .unwrap_err()
            .to_string()
            .contains("duplicate"));
        let mut duplicate = actual.clone();
        duplicate.push(actual[0].clone());
        assert!(validate_inventory(&duplicate, &expected)
            .unwrap_err()
            .to_string()
            .contains("duplicate discovered"));
        let mut absent = expected.clone();
        absent.push("tests/browser-stale/runner.rs");
        assert!(validate_inventory(&actual, &absent)
            .unwrap_err()
            .to_string()
            .contains("absent"));
    }

    #[test]
    fn untracked_authored_file_is_not_silently_omitted() {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let directory = std::env::temp_dir().join(format!(
            "prismpm-formatting-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&directory).unwrap();
        struct Owned(PathBuf);
        impl Drop for Owned {
            fn drop(&mut self) {
                std::fs::remove_dir_all(&self.0).unwrap();
            }
        }
        let owned = Owned(directory);
        assert!(Command::new("git")
            .args(["init", "--quiet"])
            .current_dir(&owned.0)
            .status()
            .unwrap()
            .success());
        std::fs::create_dir_all(owned.0.join("tests/browser-new")).unwrap();
        std::fs::write(
            owned.0.join("tests/browser-new/runner.rs"),
            "fn main() {}\n",
        )
        .unwrap();
        let actual = authored_test_inputs(&owned.0).unwrap();
        assert_eq!(actual, ["tests/browser-new/runner.rs"]);
        assert!(validate_inventory(&actual, &[])
            .unwrap_err()
            .to_string()
            .contains("unselected"));
    }

    #[test]
    fn commands_preserve_compiler_and_generated_source_boundaries() {
        let plan = commands(&root()).unwrap();
        assert_eq!(plan[0].arguments, ["fmt", "--", "--check"]);
        let all = plan
            .iter()
            .filter(|item| item.arguments.contains(&"--all"))
            .collect::<Vec<_>>();
        assert_eq!(all.len(), COMPILERS.len());
        for item in all {
            assert!(COMPILERS.contains(&item.arguments[2]));
        }
        assert!(plan.iter().all(|item| item
            .arguments
            .iter()
            .all(|argument| !argument.contains("stdlib/generated"))));
    }

    #[test]
    fn actual_nonmutating_authored_formatting_gate() {
        let root = root();
        for invocation in commands(&root).unwrap() {
            let result = Command::new(invocation.program)
                .args(&invocation.arguments)
                .current_dir(&root)
                .output()
                .unwrap();
            assert!(
                result.status.success(),
                "{} {:?}\n{}\n{}",
                invocation.program,
                invocation.arguments,
                String::from_utf8_lossy(&result.stdout),
                String::from_utf8_lossy(&result.stderr)
            );
        }
    }
}
