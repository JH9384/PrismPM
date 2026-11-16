//! HO-46: definitions of one application that share a last name component
//! (issue #644). Two modules each define `answer`; the entry calls both.

use prismpm::controller::VerifyRequest;
use std::path::Path;

const FIXTURE: &str = "tests/fixtures/holo/ho-46-qualified-definitions";
const ADMISSION: &str = "PrismQualifiedDefinitions.Kernel.Admission.answer";
const RANGE: &str = "PrismQualifiedDefinitions.Kernel.Range.answer";
const ENTRY: &str = "PrismQualifiedDefinitions.QualifiedDefinitions.dispatch";

/// The exporter's name for a definition its last component does not identify:
/// `__prod_q`, then the length and text of each component (SPEC §7).
fn qualified(name: &str) -> String {
    name.split('.')
        .fold("__prod_q".to_owned(), |mut out, part| {
            out.push_str(&format!("_{}_{part}", part.chars().count()));
            out
        })
}

fn names(module: &prod_ir::Module) -> Vec<&str> {
    module
        .definitions
        .iter()
        .map(|definition| definition.name.as_str())
        .collect()
}

fn calls<'a>(expression: &'a prod_ir::Expr, found: &mut Vec<&'a str>) {
    if let prod_ir::Expr::Call(name, _) = expression {
        found.push(name);
    }
    for child in expression.children() {
        calls(child, found);
    }
}

pub(super) fn verify(root: &Path) {
    crate::fixtures::check(&root.join(FIXTURE))
        .expect("the two-module source fixture matches its declared outcome");
    let project = tempfile::tempdir().unwrap();
    crate::fixtures::copy_dir_recursive(&root.join(FIXTURE).join("project"), project.path())
        .unwrap();
    let controller = prismpm::Controller::load(project.path()).unwrap();
    let verified = controller
        .verify(VerifyRequest { config_path: None })
        .expect("two modules that each define `answer` build and pass every acceptance vector");

    let build = project.path().join(".prism/build").join(&verified.build_id);
    let kernel = std::fs::read_to_string(build.join("cargo/kernel.ir")).unwrap();
    let (rest, module) = prod_ir::parser::parse_module(&kernel).expect("exported IR parses");
    assert!(rest.trim().is_empty());
    let defined = names(&module);
    let mut distinct = defined.clone();
    distinct.sort_unstable();
    distinct.dedup();
    assert_eq!(distinct.len(), defined.len(), "{defined:?}");
    for name in [ADMISSION, RANGE] {
        assert!(defined.contains(&qualified(name).as_str()), "{defined:?}");
    }
    // The root and every definition with a unique last component keep it.
    for name in ["dispatch", "appendBytes", "byteLength"] {
        assert!(defined.contains(&name), "{defined:?}");
    }
    assert!(!defined.contains(&"answer"), "{defined:?}");
    let entry = module.find_def("dispatch").expect("the entry is exported");
    let mut called = Vec::new();
    calls(&entry.body, &mut called);
    for name in [ADMISSION, RANGE] {
        assert!(called.contains(&qualified(name).as_str()), "{called:?}");
    }
    let library = std::fs::read_to_string(build.join("cargo/package/src/lib.rs")).unwrap();
    for name in [ADMISSION, RANGE] {
        assert_eq!(
            library
                .matches(&format!("pub fn {}(", qualified(name)))
                .count(),
            1
        );
    }

    // Both definitions requested as roots have one public name between them.
    let entry_path = project.path().join("src/QualifiedDefinitions.lex.tex");
    let source = std::fs::read_to_string(&entry_path).unwrap();
    let one = format!("libraryRoots := (cons \"{ENTRY}\" (nil String))");
    let three = format!(
        "libraryRoots := (cons \"{ADMISSION}\" (cons \"{RANGE}\" (cons \"{ENTRY}\" (nil String))))"
    );
    assert_eq!(source.matches(&one).count(), 1);
    std::fs::write(&entry_path, source.replace(&one, &three)).unwrap();
    let error = controller
        .verify(VerifyRequest { config_path: None })
        .expect_err("two requested roots that share a last component are refused");
    assert_eq!(error.code, "PP5004", "{error:?}");
    assert!(
        error.message.contains(&format!(
            "exportNames: {ADMISSION} and {RANGE} share the emitted name answer"
        )),
        "{error:?}"
    );
}
