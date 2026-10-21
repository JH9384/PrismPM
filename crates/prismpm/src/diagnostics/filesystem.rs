//! Real public filesystem and immutable-artifact diagnostic boundaries.

use crate::controller::{BuildRequest, CleanRequest, Controller};
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::io::{Cursor, Read};
use std::path::Path;

const SOURCES: &[u8] = include_bytes!("../../sdk/stdlib-sources.tar");

#[derive(Clone, Copy, Deserialize, Serialize)]
#[serde(rename_all = "kebab-case")]
enum Operation {
    ArtifactIntegrity,
    ConfinedOutput,
    ImmutableLock,
}

#[derive(Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Fixture {
    operation: Operation,
    source_archive_sha256: String,
    malformed: bool,
}

pub(super) fn specimens(code: &str) -> (Value, Value) {
    let operation = match code {
        "PP4001" => Operation::ArtifactIntegrity,
        "PP8001" => Operation::ConfinedOutput,
        "PP1101" => Operation::ImmutableLock,
        _ => unreachable!("closed filesystem diagnostic register"),
    };
    let mut valid = json!(Fixture {
        operation,
        source_archive_sha256: format!("{:x}", Sha256::digest(SOURCES)),
        malformed: false,
    });
    let control = valid.clone();
    valid["malformed"] = Value::Bool(true);
    (control, valid)
}

fn io_error(error: std::io::Error) -> PrismError {
    PrismError::new("PP9001", format!("diagnostic fixture setup: {error}"))
}

fn write(root: &Path, path: &str, bytes: &[u8]) -> Result<(), PrismError> {
    let path = root.join(path);
    std::fs::create_dir_all(path.parent().expect("fixture path parent")).map_err(io_error)?;
    std::fs::write(path, bytes).map_err(io_error)
}

fn config(output: &str) -> String {
    format!(
        "spec = \"prismpm/project/1\"\nproject = \"Diagnostic artifact\"\nlexlean_project = \"lexlean.toml\"\nbuild_root = {output:?}\n[limits]\nmax_holo_bytes = 16777216\nmax_entities = 100000\nmax_diagnostics = 256\n"
    )
}

fn source_project(root: &Path) -> Result<(), PrismError> {
    let mut archive = tar::Archive::new(Cursor::new(SOURCES));
    for row in archive.entries().map_err(io_error)? {
        let mut row = row.map_err(io_error)?;
        let path = row.path().map_err(io_error)?.to_string_lossy().into_owned();
        if path.starts_with("language/")
            || [
                "stdlib/Foundation/Arch.lex.tex",
                "stdlib/Foundation/Qual.lex.tex",
                "stdlib/Foundation/Sec.lex.tex",
            ]
            .contains(&path.as_str())
        {
            if !row.header().entry_type().is_file()
                || path.split('/').any(|part| matches!(part, "" | "." | ".."))
            {
                return Err(PrismError::new(
                    "PP9001",
                    "invalid embedded diagnostic source",
                ));
            }
            let mut bytes = Vec::new();
            row.read_to_end(&mut bytes).map_err(io_error)?;
            write(root, &path, &bytes)?;
        }
    }
    write(root, "prismpm.toml", config(".prism").as_bytes())?;
    write(
        root,
        "src/Main.lex.tex",
        br"\begin{lexlean}{Main}
\useglossary{lexlean.std.bool@1.2.0}
\useglossary{prism.arch@1.0.0}
\useglossary{prism.qual@1.0.0}
\useglossary{prism.sec@1.0.0}
\importmodule{Foundation.Arch}
\importmodule{Foundation.Qual}
\importmodule{Foundation.Sec}
\title{Boolean}
\begin{theorem}{artifact-control}
\noaxioms
\(\lexeme{lexlean.std.bool::true} = \lexeme{lexlean.std.bool::true}\).
\begin{proof}
Close the goal by reflexivity.
\end{proof}
\end{theorem}
\end{lexlean}
",
    )?;
    write(root, "lean-toolchain", b"leanprover/lean4:v4.32.1\n")?;
    write(
        root,
        "lakefile.toml",
        b"name = \"Diagnostic\"\nversion = \"0.1.0\"\n",
    )?;
    write(root, "lake-manifest.json", b"{\"version\":\"1.2.0\",\"packagesDir\":\".lake/packages\",\"packages\":[],\"name\":\"Diagnostic\",\"lakeDir\":\".lake\",\"fixedToolchain\":false}\n")?;
    write(
        root,
        "lexlean.toml",
        br#"spec = "lexlean/project/1"
name = "diagnostic-artifact"
language = "1.2"
module_prefix = "Diagnostic"
source_roots = ["src", "stdlib"]
entrypoints = ["src/Main.lex.tex"]
build_root = ".lexlean"
lockfile = "lexlean.lock"
lean_workspace = "."
lean_toolchain = "leanprover/lean4:v4.32.1"
[[lexicon_source]]
package = "lexlean.std.bool"
kind = "builtin"
[[lexicon_source]]
package = "lexlean.std.nat"
kind = "builtin"
[[lexicon_source]]
package = "prism.arch"
kind = "path"
path = "language/prism.arch"
[[lexicon_source]]
package = "prism.qual"
kind = "path"
path = "language/prism.qual"
[[lexicon_source]]
package = "prism.sec"
kind = "path"
path = "language/prism.sec"
[limits]
max_file_bytes = 4194304
max_total_source_bytes = 67108864
max_primitive_atoms = 2000000
max_token_lattice_edges = 4000000
max_parse_states = 4000000
max_ir_nodes = 2000000
max_scope_depth = 1024
max_import_depth = 128
max_diagnostics = 256
max_child_output_bytes = 16777216
child_timeout_ms = 300000
"#,
    )?;
    let path = camino::Utf8PathBuf::from_path_buf(root.join("lexlean.toml"))
        .map_err(|_| PrismError::new("PP9001", "diagnostic fixture is not UTF-8"))?;
    lexlean::Engine::load(&path)
        .and_then(|engine| {
            engine.lock(lexlean::LockRequest {
                check_only: false,
                allow_network: false,
            })
        })
        .map_err(|error| PrismError::new("PP9001", format!("diagnostic source lock: {error}")))?;
    Ok(())
}

pub(super) fn validate(value: &Value) -> Result<(), PrismError> {
    let fixture: Fixture = serde_json::from_value(value.clone())
        .map_err(|error| PrismError::new("PP9001", format!("filesystem probe shape: {error}")))?;
    if fixture.source_archive_sha256 != format!("{:x}", Sha256::digest(SOURCES)) {
        return Err(PrismError::new(
            "PP9001",
            "filesystem probe source binding changed",
        ));
    }
    let temp = tempfile::tempdir().map_err(io_error)?;
    let root = temp.path().join("project");
    std::fs::create_dir(&root).map_err(io_error)?;
    match fixture.operation {
        Operation::ArtifactIntegrity => {
            source_project(&root)?;
            let controller = Controller::load(&root)?;
            let built = controller.build(BuildRequest { config_path: None })?;
            if fixture.malformed {
                let file = root.join(&built.model_path);
                let mut bytes = std::fs::read(&file).map_err(io_error)?;
                bytes.push(b'\n');
                std::fs::write(file, bytes).map_err(io_error)?;
            }
            controller
                .build(BuildRequest { config_path: None })
                .map(|_| ())
        }
        Operation::ConfinedOutput => {
            write(
                &root,
                "prismpm.toml",
                config(if fixture.malformed {
                    "../outside"
                } else {
                    ".prism"
                })
                .as_bytes(),
            )?;
            write(&root, ".prism/artifact", b"owned output")?;
            write(temp.path(), "outside/sentinel", b"must survive")?;
            let result = Controller::load(&root)?.clean(CleanRequest { config_path: None });
            if std::fs::read(temp.path().join("outside/sentinel")).map_err(io_error)?
                != b"must survive"
                || (fixture.malformed && !root.join(".prism/artifact").is_file())
                || (!fixture.malformed && root.join(".prism").exists())
            {
                return Err(PrismError::new(
                    "PP9001",
                    "clean diagnostic crossed its exact output boundary",
                ));
            }
            result.map(|_| ())
        }
        Operation::ImmutableLock => {
            crate::authority::resolve(&root, false)?;
            crate::authority::inspect(&root)?;
            if fixture.malformed {
                let path = root.join("standards.lock");
                let mut lock: Value = serde_json::from_slice(
                    &std::fs::read(&path).map_err(io_error)?,
                )
                .map_err(|error| PrismError::new("PP9001", format!("resolved lock: {error}")))?;
                lock["lock_id"] = Value::String(format!("sha256:{}", "0".repeat(64)));
                std::fs::write(path, encode_value(&lock)?).map_err(io_error)?;
            }
            crate::authority::resolve(&root, true).map(|_| ())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{specimens, validate};

    #[test]
    fn public_filesystem_probes_execute_real_positive_and_negative_boundaries() {
        for code in ["PP4001", "PP8001", "PP1101"] {
            let (valid, invalid) = specimens(code);
            validate(&valid).unwrap();
            let error = validate(&invalid).expect_err("real malformed artifact must fail");
            assert_eq!(error.code.as_str(), code);
            assert!(!error.message.contains("diagnostic trigger"));
        }
    }
}
