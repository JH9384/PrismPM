//! Refuse stale shared sources before expensive native golden generation.

use crate::Fail;
use repo_conformance::golden::{self, platform::Platform};
use std::path::Path;

// This is an early refusal, not golden acceptance. The caller still performs
// complete generation, native-record validation and exact comparison/write.
pub(crate) fn generate<T>(
    root: &Path,
    platform: Platform,
    generate: impl FnOnce() -> Result<T, Fail>,
) -> Result<T, Fail> {
    if platform != Platform::DevelopmentAmd64 {
        let shared = root.join(Platform::DevelopmentAmd64.directory());
        let manifest = shared.join("golden-manifest.json");
        if !std::fs::symlink_metadata(&manifest)?.is_file() {
            return Err("shared golden manifest is not a regular file".into());
        }
        let mut current = golden::read(&root.join("stdlib/src"))?;
        current.retain(|(path, _)| path.ends_with(".lex.tex"));
        let reviewed = golden::read(&shared.join("source"))?;
        if current.is_empty()
            || !current
                .iter()
                .map(|row| &row.0)
                .eq(reviewed.iter().map(|row| &row.0))
        {
            return Err("committed shared golden source path set is stale; regenerate in the normative development container".into());
        }
        for ((path, current), (_, reviewed)) in current.iter().zip(&reviewed) {
            if current != reviewed {
                return Err(format!("committed shared golden source bytes are stale: {path}; regenerate in the normative development container").into());
            }
        }
        let value: serde_json::Value = serde_json::from_slice(&std::fs::read(&manifest)?)?;
        let sources = current
            .iter()
            .map(|(path, bytes)| {
                serde_json::json!({
                    "path": format!("source/{path}"),
                    "byte_length": bytes.len(),
                    "sha256": prismpm::holo::canonical::content_id(bytes)
                })
            })
            .collect::<Vec<_>>();
        if value.get("sources") != Some(&serde_json::json!(sources)) {
            return Err("committed shared golden source descriptors are stale; regenerate in the normative development container".into());
        }
    }
    generate()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;
    use std::fs;

    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        for directory in ["stdlib/src", "tests/golden/stdlib/source"] {
            fs::create_dir_all(root.path().join(directory)).unwrap();
            fs::write(
                root.path().join(directory).join("Model.lex.tex"),
                b"source bytes",
            )
            .unwrap();
        }
        // A preflight cannot confer manifest validity; the original complete
        // generator/comparator must still reject this synthetic document.
        fs::write(
            root.path().join("tests/golden/stdlib/golden-manifest.json"),
            serde_json::to_vec(&serde_json::json!({"sources":[{
                "path":"source/Model.lex.tex", "byte_length":12,
                "sha256":prismpm::holo::canonical::content_id(b"source bytes")
            }]}))
            .unwrap(),
        )
        .unwrap();
        root
    }

    #[test]
    fn current_native_sources_reach_the_original_generator_without_accepting_it() {
        let root = fixture();
        fs::write(
            root.path().join("stdlib/src/README.md"),
            b"not modeled source",
        )
        .unwrap();
        for platform in [Platform::SdkAmd64, Platform::SdkArm64] {
            let called = Cell::new(false);
            let result = generate::<()>(root.path(), platform, || {
                called.set(true);
                Err("original complete generator failure".into())
            });
            assert!(called.get());
            assert_eq!(
                result.unwrap_err().to_string(),
                "original complete generator failure"
            );
        }
        assert!(!root.path().join(".prism").exists());
    }

    #[test]
    fn stale_native_sources_refuse_before_any_generation() {
        for defect in [
            "missing",
            "extra",
            "rename",
            "changed",
            "empty",
            "extra-reviewed",
        ] {
            let root = fixture();
            let current = root.path().join("stdlib/src/Model.lex.tex");
            match defect {
                "missing" => fs::remove_file(current).unwrap(),
                "extra" => fs::write(
                    root.path().join("stdlib/src/Extra.lex.tex"),
                    b"source bytes",
                )
                .unwrap(),
                "rename" => {
                    fs::rename(current, root.path().join("stdlib/src/Renamed.lex.tex")).unwrap()
                }
                "changed" => fs::write(current, b"alteredbytes").unwrap(),
                "empty" => {
                    fs::remove_file(current).unwrap();
                    fs::remove_file(root.path().join("tests/golden/stdlib/source/Model.lex.tex"))
                        .unwrap();
                }
                "extra-reviewed" => fs::write(
                    root.path()
                        .join("tests/golden/stdlib/source/unexpected.txt"),
                    b"extra",
                )
                .unwrap(),
                _ => unreachable!(),
            }
            for platform in [Platform::SdkAmd64, Platform::SdkArm64] {
                let called = Cell::new(false);
                let result = generate(root.path(), platform, || {
                    called.set(true);
                    Ok(())
                });
                assert!(!called.get(), "{defect}: stale inputs reached generation");
                assert!(
                    result
                        .unwrap_err()
                        .to_string()
                        .contains("committed shared golden source"),
                    "{defect}"
                );
            }
        }
    }

    #[test]
    fn normative_development_can_regenerate_a_missing_shared_baseline() {
        let root = tempfile::tempdir().unwrap();
        let called = Cell::new(false);
        generate(root.path(), Platform::DevelopmentAmd64, || {
            called.set(true);
            Ok(())
        })
        .unwrap();
        assert!(called.get());
    }

    #[test]
    fn stale_manifest_source_descriptors_cannot_reach_generation() {
        for defect in [
            "both-copies",
            "missing-descriptors",
            "changed-length",
            "missing-manifest",
        ] {
            let root = fixture();
            let manifest = root.path().join("tests/golden/stdlib/golden-manifest.json");
            match defect {
                "both-copies" => {
                    for path in [
                        "stdlib/src/Model.lex.tex",
                        "tests/golden/stdlib/source/Model.lex.tex",
                    ] {
                        fs::write(root.path().join(path), b"alteredbytes").unwrap();
                    }
                }
                "missing-descriptors" => fs::write(&manifest, b"{}").unwrap(),
                "changed-length" => {
                    let mut value: serde_json::Value =
                        serde_json::from_slice(&fs::read(&manifest).unwrap()).unwrap();
                    value["sources"][0]["byte_length"] = serde_json::json!(13);
                    fs::write(&manifest, serde_json::to_vec(&value).unwrap()).unwrap();
                }
                "missing-manifest" => fs::remove_file(&manifest).unwrap(),
                _ => unreachable!(),
            }
            let called = Cell::new(false);
            assert!(
                generate(root.path(), Platform::SdkAmd64, || {
                    called.set(true);
                    Ok(())
                })
                .is_err(),
                "{defect}"
            );
            assert!(!called.get());
        }
    }

    #[cfg(unix)]
    #[test]
    fn native_preflight_refuses_manifest_and_source_aliases() {
        use std::os::unix::fs::symlink;
        for relative in [
            "stdlib/src/Model.lex.tex",
            "tests/golden/stdlib/source/Model.lex.tex",
            "tests/golden/stdlib/golden-manifest.json",
        ] {
            let root = fixture();
            let path = root.path().join(relative);
            fs::write(root.path().join("alias-target"), fs::read(&path).unwrap()).unwrap();
            fs::remove_file(&path).unwrap();
            symlink(root.path().join("alias-target"), path).unwrap();
            let called = Cell::new(false);
            assert!(generate(root.path(), Platform::SdkAmd64, || {
                called.set(true);
                Ok(())
            })
            .is_err());
            assert!(!called.get());
        }
    }
}
