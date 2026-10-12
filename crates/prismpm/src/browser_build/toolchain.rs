//! Fixed selectors, authenticated launchers and actual compiler identities.

use super::{json_bytes, PrismError};
use crate::library_build::sha256;
use crate::verification::{executables, preflight_toolchain, run_process, ProcessRecord};
use serde_json::json;
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

pub(super) const RUST_TOOLCHAIN_FILE: &[u8] =
    b"[toolchain]\nchannel = \"1.97.1\"\nprofile = \"minimal\"\n";

pub(super) struct Tools {
    pub(super) cargo: PathBuf,
    pub(super) environment: BTreeMap<String, String>,
    pub(super) records: Vec<ProcessRecord>,
    pub(super) binding: Vec<u8>,
}

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP5008", message)
}

fn selectors(environment: &BTreeMap<String, String>) -> Result<(), PrismError> {
    let host = match std::env::consts::ARCH {
        "x86_64" => "x86_64-unknown-linux-gnu",
        "aarch64" => "aarch64-unknown-linux-gnu",
        _ => return Err(invalid("browser compiler architecture is unsupported")),
    };
    for (name, bare, qualified) in [
        ("RUSTUP_TOOLCHAIN", "1.97.1", format!("1.97.1-{host}")),
        (
            "ELAN_TOOLCHAIN",
            "leanprover/lean4:v4.32.1",
            "leanprover--lean4---v4.32.1".to_owned(),
        ),
    ] {
        if environment
            .get(name)
            .is_some_and(|value| value != bare && value != &qualified)
        {
            return Err(invalid(
                "browser compiler refuses a non-pinned ambient toolchain selector",
            ));
        }
    }
    Ok(())
}

pub(super) fn resolve(project: &Path) -> Result<Tools, PrismError> {
    let mut selected = BTreeMap::new();
    for name in ["RUSTUP_TOOLCHAIN", "ELAN_TOOLCHAIN"] {
        match std::env::var(name) {
            Ok(value) => {
                selected.insert(name.into(), value);
            }
            Err(std::env::VarError::NotPresent) => {}
            Err(_) => return Err(invalid("browser compiler toolchain selector is not UTF-8")),
        }
    }
    selectors(&selected)?;
    let standard = preflight_toolchain(project, &[(project, "$PROJECT")])?;
    let [rustc, cargo] = executables(["rustc", "cargo"])?;
    // Native Cargo must be the same pinned rustup executable as rustc; a
    // version-spoofing PATH script is insufficient. SDK inventory binds both.
    if crate::sdk::inventory_path().is_none()
        && std::fs::read(&cargo).map(|b| sha256(&b)).ok()
            != std::fs::read(&rustc).map(|b| sha256(&b)).ok()
    {
        return Err(invalid(
            "browser Cargo launcher does not match the pinned rustup executable",
        ));
    }
    let mut environment = BTreeMap::from([
        ("RUSTUP_TOOLCHAIN".into(), "1.97.1".into()),
        ("ELAN_TOOLCHAIN".into(), "leanprover/lean4:v4.32.1".into()),
    ]);
    let sysroot = run_process(
        "browser-rust-sysroot",
        &rustc,
        &["--print".into(), "sysroot".into()],
        project,
        &environment,
        &[(project, "$PROJECT")],
        "PP5008",
    )?;
    if !sysroot.stderr.is_empty() || sysroot.stdout.lines().count() != 1 {
        return Err(invalid("browser Rust sysroot query is malformed"));
    }
    let sysroot = PathBuf::from(sysroot.stdout.trim());
    if !sysroot.is_absolute() || sysroot.canonicalize().ok().as_ref() != Some(&sysroot) {
        return Err(invalid("browser Rust sysroot is not canonical"));
    }
    let actual_rustc = sysroot.join("bin/rustc");
    let actual_cargo = sysroot.join("bin/cargo");
    for path in [&actual_rustc, &actual_cargo] {
        if !std::fs::symlink_metadata(path).is_ok_and(|m| m.file_type().is_file()) {
            return Err(invalid(
                "browser actual compiler is not a regular executable",
            ));
        }
    }
    environment.insert("RUSTC".into(), actual_rustc.to_string_lossy().into_owned());
    let mut records = standard.records;
    for (name, program, version, commit) in [
        (
            "browser-actual-rustc",
            &actual_rustc,
            "1.97.1",
            "8bab26f4f68e0e26f0bb7960be334d5b520ea452",
        ),
        (
            "browser-actual-cargo",
            &actual_cargo,
            "1.97.1",
            "c980f4866141969fab6254a680546a277789d6f0",
        ),
    ] {
        let record = run_process(
            name,
            program,
            &["--version".into(), "--verbose".into()],
            project,
            &environment,
            &[(project, "$PROJECT"), (&sysroot, "$RUST_SYSROOT")],
            "PP5008",
        )?;
        if !record.stderr.is_empty()
            || !record
                .stdout
                .lines()
                .any(|line| line == format!("release: {version}"))
            || !record
                .stdout
                .lines()
                .any(|line| line == format!("commit-hash: {commit}"))
        {
            return Err(invalid(
                "browser actual compiler does not report the pinned release and commit",
            ));
        }
        records.push(record);
    }
    let binding = json_bytes(&json!({"rust":"1.97.1", "lean":"leanprover/lean4:v4.32.1",
        "tools":records.iter().map(|row| json!({"tool":row.tool,"executable_sha256":row.executable_sha256,"version":row.stdout})).collect::<Vec<_>>()}))?;
    Ok(Tools {
        cargo: actual_cargo,
        environment,
        records,
        binding,
    })
}

#[cfg(test)]
pub(super) fn assert_selector_rejection() {
    for (key, value) in [
        ("RUSTUP_TOOLCHAIN", "stable"),
        ("RUSTUP_TOOLCHAIN", "1.96.0"),
        ("ELAN_TOOLCHAIN", "leanprover/lean4:v4.31.0"),
    ] {
        assert_eq!(
            selectors(&BTreeMap::from([(key.into(), value.into())]))
                .unwrap_err()
                .code,
            "PP5008"
        );
    }
    selectors(&BTreeMap::new()).unwrap();
}
