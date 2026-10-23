//! Display labels shared by the renderers.

use std::collections::{BTreeMap, BTreeSet};

/// Display labels for qualified identifiers: the declaration name after the
/// last `::`, kept qualified for every identifier whose short name another
/// identifier of the same set also uses.
pub(super) struct Labels(BTreeMap<String, String>);

fn short(name: &str) -> &str {
    name.rsplit_once("::").map_or(name, |(_, tail)| tail)
}

/// Replace every control character and the characters that would end a quoted
/// diagram string, so that user text stays on one line.
pub(super) fn single_line(text: &str) -> String {
    text.chars()
        .map(|c| if c.is_control() { ' ' } else { c })
        .map(|c| if c == '"' { '\'' } else { c })
        .collect()
}

impl Labels {
    pub(super) fn new<'a>(names: impl IntoIterator<Item = &'a str>) -> Self {
        let names: BTreeSet<&str> = names.into_iter().collect();
        let mut counts: BTreeMap<&str, usize> = BTreeMap::new();
        for name in &names {
            *counts.entry(short(name)).or_default() += 1;
        }
        Self(
            names
                .into_iter()
                .map(|name| {
                    let unique = counts.get(short(name)) == Some(&1);
                    let label = if unique { short(name) } else { name };
                    (name.to_owned(), single_line(label))
                })
                .collect(),
        )
    }

    /// The label of an identifier, or the identifier itself when unlabelled.
    pub(super) fn get<'a>(&'a self, name: &'a str) -> &'a str {
        self.0.get(name).map_or(name, String::as_str)
    }
}
