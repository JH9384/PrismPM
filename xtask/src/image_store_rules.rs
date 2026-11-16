//! `cargo xtask check-image-store-rules [--write]`: the local image store's
//! decision table (#349) is the output of one LexLean model.
//!
//! `bindings/src/Foundation/Images/V1/Store.lex.tex` decides every case of
//! `prism.images.remove` and `prune`. Lean proves there, by `decide`, that no
//! case deletes an image a running container references, that no case deletes
//! a referenced image without `force`, and that `prune` never deletes a
//! referenced image or, without `all`, a tagged one. `cargo xtask
//! bindings-package` exports the model's writer as a Rust package, which is
//! kept here as `image_store_rules/model.rs`. This task runs that writer and
//! compares what it prints with `sdk/npm/prism-code/src/image-store-rules.json`,
//! the table `src/image-store.mjs` reads. It replaces the file with `--write`.
//! No rule is written by hand in JavaScript or Rust.

#[allow(
    missing_docs,
    dead_code,
    unused_imports,
    unused_variables,
    unused_mut,
    unreachable_patterns,
    non_snake_case,
    non_camel_case_types,
    clippy::all,
    clippy::pedantic,
    clippy::nursery
)]
#[rustfmt::skip]
#[path = "image_store_rules/model.rs"]
mod model;

use crate::Fail;
use std::path::Path;

/// The table `prism-code` reads, relative to the repository root.
pub(crate) const RULES: &str = "sdk/npm/prism-code/src/image-store-rules.json";

/// The decision table as the model writes it.
pub(crate) fn rendered() -> Result<String, Fail> {
    model::run()
        .map(|text| text.text().to_owned())
        .map_err(|_| "the image store rules writer overflowed".into())
}

pub(crate) fn check(root: &Path, write: bool) -> Result<(), Fail> {
    let expected = rendered()?;
    let path = root.join(RULES);
    let committed = std::fs::read_to_string(&path).unwrap_or_default();
    if committed == expected {
        return Ok(());
    }
    if write {
        std::fs::write(&path, expected)?;
        println!("wrote {RULES}");
        return Ok(());
    }
    Err(format!("{RULES} drifted from the image store model; run `cargo xtask check-image-store-rules --write`").into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_committed_table_is_the_models_output() {
        let root = Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join(RULES)).unwrap(),
            rendered().unwrap()
        );
    }
}
