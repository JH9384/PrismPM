//! Traced configuration for fresh generated-module compilation.

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
