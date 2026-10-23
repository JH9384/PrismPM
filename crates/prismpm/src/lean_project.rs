//! Traced configuration for fresh generated-module compilation.

use crate::error::PrismError;
use std::path::Path;

/// Write the LexLean runtime modules (language 1.2, SPEC 17.12) that the
/// generated Lean texts import into a fresh compilation workspace.
///
/// A generated module imports `LexLeanRuntime.*` instead of splicing the
/// runtime, and the LexLean build manifest attests only the project's own
/// modules. Lean cannot resolve the import unless the runtime modules, closed
/// under their own imports, are compiled beside the generated modules, as
/// LexLean's own verification does. Returns the staged module names in
/// dependency order; they are lakefile roots but are not project modules.
pub(crate) fn stage_runtime<'a>(
    workspace: &Path,
    generated: impl IntoIterator<Item = &'a [u8]>,
) -> Result<Vec<String>, PrismError> {
    let texts = generated
        .into_iter()
        .map(|bytes| {
            std::str::from_utf8(bytes)
                .map_err(|error| PrismError::new("PP4004", format!("generated Lean: {error}")))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let imported = lexlean::backend::runtime::imported_by(texts)
        .map_err(|diagnostic| PrismError::new("PP4004", diagnostic.message))?;
    let mut names = Vec::with_capacity(imported.len());
    for module in imported {
        let path = workspace.join(format!("{}.lean", module.name.replace('.', "/")));
        let directory = path
            .parent()
            .ok_or_else(|| PrismError::new("PP9001", "runtime module path has no parent"))?;
        std::fs::create_dir_all(directory).map_err(|error| {
            PrismError::new("PP4002", format!("{}: {error}", directory.display()))
        })?;
        std::fs::write(&path, module.text.as_bytes())
            .map_err(|error| PrismError::new("PP4002", format!("{}: {error}", path.display())))?;
        names.push(module.name.clone());
    }
    Ok(names)
}

/// The lakefile roots of a workspace: the staged runtime modules, then the
/// project's generated modules.
pub(crate) fn roots(runtime: &[String], modules: &[String]) -> Vec<String> {
    runtime.iter().chain(modules).cloned().collect()
}

pub(crate) fn configuration(name: &str, modules: &[String]) -> String {
    format!(
        "name = {}\nversion = \"0.1.0\"\n\n[[lean_lib]]\nname = \"PrismGenerated\"\nroots = [{}]\nmoreLeanArgs = [\"-j2\"]\n",
        serde_json::to_string(name).expect("fixed package name serializes"),
        modules.iter().map(|module| serde_json::to_string(module).expect("module serializes"))
            .collect::<Vec<_>>().join(", "),
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::verification::{executable, run_process};
    use std::collections::BTreeMap;

    #[test]
    fn staged_runtime_closes_over_the_imports_of_generated_modules() {
        let work = tempfile::tempdir().unwrap();
        let generated = b"module\npublic import Init\npublic import LexLeanRuntime.Reasoning\n";
        let names = stage_runtime(work.path(), [generated.as_slice()]).unwrap();
        assert_eq!(
            names,
            [
                "LexLeanRuntime.Portable",
                "LexLeanRuntime.Collections",
                "LexLeanRuntime.Reasoning"
            ]
        );
        for name in &names {
            let path = work.path().join(format!("{}.lean", name.replace('.', "/")));
            assert!(path.is_file(), "{name} was not staged at {path:?}");
        }
        assert!(!work.path().join("LexLeanRuntime/Laws.lean").exists());
        let none =
            stage_runtime(work.path(), [b"module\npublic import Init\n".as_slice()]).unwrap();
        assert!(none.is_empty());
        let modules = ["PrismPM.A".to_owned()];
        assert_eq!(
            roots(&names, &modules).last().map(String::as_str),
            Some("PrismPM.A")
        );
    }

    #[test]
    fn actual_generated_module_uses_traced_compiler_thread_argument() {
        let work = tempfile::tempdir().unwrap();
        let module = "PrismPM.Foundation.Holo.V1.Identity".to_owned();
        let source = work.path().join("PrismPM/Foundation/Holo/V1/Identity.lean");
        std::fs::create_dir_all(source.parent().unwrap()).unwrap();
        // Original LexLean-generated golden bytes, never handwritten Lean.
        let repository = std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .ancestors()
            .nth(2)
            .unwrap();
        let generated = std::fs::read(repository.join("tests/golden/stdlib/build/lexlean/build/modules/PrismPM/Foundation/Holo/V1/Identity.lean")).unwrap();
        std::fs::write(&source, generated).unwrap();
        std::fs::write(
            work.path().join("lean-toolchain"),
            "leanprover/lean4:v4.32.1\n",
        )
        .unwrap();
        let configuration = configuration("prismpm_thread_policy", &[module]);
        let path = work.path().join("lakefile.toml");
        std::fs::write(&path, &configuration).unwrap();
        let lake = executable("lake").unwrap();
        let arguments = ["--verbose", "build", "PrismGenerated"].map(str::to_owned);
        let run = || {
            run_process(
                "generated-thread-policy",
                &lake,
                &arguments,
                work.path(),
                &BTreeMap::new(),
                &[],
                "PP5001",
            )
        };
        let record = run().unwrap();
        assert!(
            format!("{}{}", record.stdout, record.stderr).contains(" -j2 "),
            "actual compiler command must include the limit: {record:?}"
        );
        assert!(work
            .path()
            .join(".lake/build/lib/lean/PrismPM/Foundation/Holo/V1/Identity.olean")
            .is_file());
        // A traced change must invalidate the previous build and reach Lean;
        // untraced weakLeanArgs or a cached success cannot pass this adversary.
        std::fs::write(
            path,
            configuration.replace("-j2", "--unsupported-lean-thread-policy"),
        )
        .unwrap();
        let error = run().unwrap_err();
        assert_eq!(error.code, "PP5001");
        assert!(
            error.message.contains("unsupported-lean-thread-policy"),
            "{error:?}"
        );
    }
}
