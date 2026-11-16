//! Module boundary gate: `cargo xtask check-modules`.
//!
//! `model/modules.toml` holds the nine-module dependency table, the owner of
//! every file and the migration baseline. `docs/proposals/440-nine-modules.md`
//! specifies the scan and the six rules. The scan is textual on purpose: it
//! blanks comments and literals, then reads paths and imports from what is left.

use crate::Fail;
use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;
use std::process::Command;

const MANIFEST: &str = "model/modules.toml";
const SPEC: &str = "prismpm/modules/1";
const RUST_SOURCE: &str = "crates/prismpm/src";
const JS_SOURCE_ROOTS: [&str; 6] = [
    "sdk/npm/prism-code/src",
    "sdk/npm/prism-code/bin",
    "sdk/npm/spec",
    "sdk/npm/verify",
    "sdk/npm/conformance",
    "sdk/npm/create-prism-code",
];
const JS_PACKAGES: [&str; 5] = [
    "sdk/npm/prism-code",
    "sdk/npm/spec",
    "sdk/npm/verify",
    "sdk/npm/conformance",
    "sdk/npm/create-prism-code",
];
const BASE_REF: &str = "refs/remotes/origin/main";

struct Pending {
    from: String,
    to: String,
}

struct Manifest {
    text: String,
    modules: BTreeMap<String, BTreeSet<String>>,
    owners: BTreeMap<String, String>,
    pending: Vec<Pending>,
    legacy_cycle: BTreeSet<String>,
}

impl Manifest {
    /// The line of the first occurrence of `needle`, for a failure message.
    fn line_of(&self, needle: &str) -> usize {
        self.text
            .find(needle)
            .map_or(1, |at| self.text[..at].matches('\n').count() + 1)
    }

    /// The longest owner entry that matches `file`: itself, or a parent directory.
    fn owner_entry(&self, file: &str) -> Option<&str> {
        if let Some((entry, _)) = self.owners.get_key_value(file) {
            return Some(entry);
        }
        let mut end = file.len();
        while let Some(slash) = file[..end].rfind('/') {
            if let Some((entry, _)) = self.owners.get_key_value(&file[..=slash]) {
                return Some(entry);
            }
            end = slash;
        }
        None
    }

    fn owner(&self, file: &str) -> Option<&str> {
        self.owner_entry(file)
            .map(|entry| self.owners[entry].as_str())
    }
}

fn string_field(table: &toml::Table, key: &str, context: &str) -> Result<String, Fail> {
    match table.get(key).and_then(toml::Value::as_str) {
        Some(value) if !value.is_empty() => Ok(value.to_owned()),
        _ => Err(format!("{MANIFEST}: {context} needs a non-empty string `{key}`").into()),
    }
}

fn string_list(table: &toml::Table, key: &str, context: &str) -> Result<Vec<String>, Fail> {
    let values = table
        .get(key)
        .and_then(toml::Value::as_array)
        .ok_or_else(|| format!("{MANIFEST}: {context} needs a string list `{key}`"))?;
    values
        .iter()
        .map(|value| {
            value
                .as_str()
                .map(str::to_owned)
                .ok_or_else(|| format!("{MANIFEST}: {context} `{key}` holds a non-string").into())
        })
        .collect()
}

fn exact_keys(table: &toml::Table, keys: &[&str], context: &str) -> Result<(), Fail> {
    for key in table.keys() {
        if !keys.contains(&key.as_str()) {
            return Err(format!("{MANIFEST}: {context} has unknown key `{key}`").into());
        }
    }
    Ok(())
}

fn rows<'a>(table: &'a toml::Table, key: &str) -> Result<Vec<&'a toml::Table>, Fail> {
    let Some(value) = table.get(key) else {
        return Ok(Vec::new());
    };
    value
        .as_array()
        .ok_or_else(|| Fail::from(format!("{MANIFEST}: `{key}` must be an array of tables")))?
        .iter()
        .map(|row| {
            row.as_table()
                .ok_or_else(|| format!("{MANIFEST}: `{key}` holds a non-table").into())
        })
        .collect()
}

fn parse_manifest(text: &str) -> Result<Manifest, Fail> {
    let table: toml::Table =
        toml::from_str(text).map_err(|error| format!("{MANIFEST}: {error}"))?;
    exact_keys(
        &table,
        &["spec", "module", "owner", "pending", "legacy_cycle"],
        "the file",
    )?;
    if table.get("spec").and_then(toml::Value::as_str) != Some(SPEC) {
        return Err(format!("{MANIFEST}: `spec` must be \"{SPEC}\"").into());
    }
    let mut modules = BTreeMap::new();
    for row in rows(&table, "module")? {
        exact_keys(row, &["name", "may_depend_on"], "a [[module]]")?;
        let name = string_field(row, "name", "a [[module]]")?;
        let allowed = string_list(row, "may_depend_on", "a [[module]]")?;
        if modules
            .insert(name.clone(), allowed.into_iter().collect())
            .is_some()
        {
            return Err(format!("{MANIFEST}: module `{name}` appears twice").into());
        }
    }
    let mut owners = BTreeMap::new();
    for row in rows(&table, "owner")? {
        exact_keys(row, &["path", "module"], "an [[owner]]")?;
        let path = string_field(row, "path", "an [[owner]]")?;
        let module = string_field(row, "module", "an [[owner]]")?;
        if !modules.contains_key(&module) {
            return Err(format!("{MANIFEST}: owner `{path}` names unknown `{module}`").into());
        }
        if owners.insert(path.clone(), module).is_some() {
            return Err(format!("{MANIFEST}: owner `{path}` appears twice").into());
        }
    }
    let mut pending = Vec::new();
    let mut seen = BTreeSet::new();
    for row in rows(&table, "pending")? {
        exact_keys(row, &["from", "to", "cut"], "a [[pending]]")?;
        let from = string_field(row, "from", "a [[pending]]")?;
        let to = string_field(row, "to", "a [[pending]]")?;
        string_field(row, "cut", "a [[pending]]")?;
        if !seen.insert((from.clone(), to.clone())) {
            return Err(format!("{MANIFEST}: pending `{from}` to `{to}` appears twice").into());
        }
        pending.push(Pending { from, to });
    }
    let legacy_cycle = match table.get("legacy_cycle") {
        None => BTreeSet::new(),
        Some(value) => {
            let row = value
                .as_table()
                .ok_or_else(|| format!("{MANIFEST}: `legacy_cycle` must be a table"))?;
            exact_keys(row, &["members"], "[legacy_cycle]")?;
            string_list(row, "members", "[legacy_cycle]")?
                .into_iter()
                .collect()
        }
    };
    Ok(Manifest {
        text: text.replace("\r\n", "\n"),
        modules,
        owners,
        pending,
        legacy_cycle,
    })
}

#[derive(Clone)]
struct Edge {
    from: String,
    to: String,
    line: usize,
    symbol: String,
}

#[derive(Default)]
struct Scan {
    production: BTreeSet<String>,
    test: BTreeSet<String>,
    edges: Vec<Edge>,
    test_edges: Vec<Edge>,
    unresolved: Vec<Edge>,
    legacy: BTreeMap<String, BTreeMap<String, Edge>>,
}

fn is_ident_start(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphabetic()
}

fn is_ident(byte: u8) -> bool {
    byte == b'_' || byte.is_ascii_alphanumeric()
}

fn skip_space(text: &[u8], mut at: usize) -> usize {
    while text.get(at).is_some_and(u8::is_ascii_whitespace) {
        at += 1;
    }
    at
}

fn word_at(text: &[u8], at: usize) -> (&str, usize) {
    let mut end = at;
    while text.get(end).is_some_and(|byte| is_ident(*byte)) {
        end += 1;
    }
    (std::str::from_utf8(&text[at..end]).unwrap_or(""), end)
}

/// Blank comments and literal contents, keeping every byte offset and newline.
fn blank_rust(raw: &[u8]) -> Vec<u8> {
    fn blank(out: &mut [u8], from: usize, to: usize) {
        for byte in &mut out[from..to] {
            if *byte != b'\n' {
                *byte = b' ';
            }
        }
    }
    let mut out = raw.to_vec();
    let mut at = 0;
    while at < raw.len() {
        let byte = raw[at];
        if raw[at..].starts_with(b"//") {
            let end = raw[at..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map_or(raw.len(), |offset| at + offset);
            blank(&mut out, at, end);
            at = end;
        } else if raw[at..].starts_with(b"/*") {
            let mut depth = 1;
            let mut end = at + 2;
            while end < raw.len() && depth > 0 {
                if raw[end..].starts_with(b"/*") {
                    depth += 1;
                    end += 2;
                } else if raw[end..].starts_with(b"*/") {
                    depth -= 1;
                    end += 2;
                } else {
                    end += 1;
                }
            }
            blank(&mut out, at, end);
            at = end;
        } else if byte == b'"' {
            let mut end = at + 1;
            while end < raw.len() && raw[end] != b'"' {
                end += if raw[end] == b'\\' { 2 } else { 1 };
            }
            let end = end.min(raw.len());
            blank(&mut out, at + 1, end);
            at = end + 1;
        } else if byte == b'\'' {
            let (start, width) = match raw.get(at + 1) {
                Some(b'\\') => (at + 1, None),
                Some(next) if *next < 0x80 => (at + 1, Some(1)),
                Some(next) if *next >= 0xf0 => (at + 1, Some(4)),
                Some(next) if *next >= 0xe0 => (at + 1, Some(3)),
                _ => (at + 1, Some(2)),
            };
            let end = match width {
                None => {
                    let mut end = start + 2;
                    while end < raw.len() && raw[end] != b'\'' {
                        end += 1;
                    }
                    Some(end)
                }
                Some(width) => (raw.get(start + width) == Some(&b'\'')).then_some(start + width),
            };
            if let Some(end) = end {
                blank(&mut out, start, end.min(raw.len()));
                at = end + 1;
            } else {
                at += 1;
            }
        } else if is_ident_start(byte) && (at == 0 || !is_ident(raw[at - 1])) {
            let (word, end) = word_at(raw, at);
            let mut quote = end;
            while raw.get(quote) == Some(&b'#') {
                quote += 1;
            }
            if matches!(word, "r" | "br" | "cr") && raw.get(quote) == Some(&b'"') {
                let hashes = quote - end;
                let mut close = quote + 1;
                loop {
                    match raw.get(close) {
                        None => break,
                        Some(b'"')
                            if raw.len() >= close + 1 + hashes
                                && raw[close + 1..close + 1 + hashes]
                                    .iter()
                                    .all(|byte| *byte == b'#') =>
                        {
                            break
                        }
                        _ => close += 1,
                    }
                }
                let close = close.min(raw.len());
                blank(&mut out, quote + 1, close);
                at = close + 1 + hashes;
            } else {
                at = end;
            }
        } else {
            at += 1;
        }
    }
    out
}

/// The end of the item that follows a `#[cfg(test)]`, whose attribute ends at `at`.
fn item_end(text: &[u8], mut at: usize) -> usize {
    loop {
        at = skip_space(text, at);
        if !text[at..].starts_with(b"#") {
            break;
        }
        let mut depth = 0usize;
        while at < text.len() {
            match text[at] {
                b'[' => depth += 1,
                b']' => {
                    depth -= 1;
                    if depth == 0 {
                        at += 1;
                        break;
                    }
                }
                _ => {}
            }
            at += 1;
        }
    }
    let mut lead = at;
    let (mut first, end) = word_at(text, lead);
    if first == "pub" {
        lead = skip_space(text, end);
        if text.get(lead) == Some(&b'(') {
            while lead < text.len() && text[lead] != b')' {
                lead += 1;
            }
            lead = skip_space(text, lead + 1);
        }
        first = word_at(text, lead).0;
    }
    let is_item = matches!(
        first,
        "async"
            | "const"
            | "enum"
            | "extern"
            | "fn"
            | "for"
            | "if"
            | "impl"
            | "let"
            | "loop"
            | "macro_rules"
            | "match"
            | "mod"
            | "static"
            | "struct"
            | "thread_local"
            | "trait"
            | "type"
            | "union"
            | "unsafe"
            | "use"
            | "while"
    );
    let mut depth = 0i32;
    let mut pos = at;
    while pos < text.len() {
        match text[pos] {
            b'(' | b'[' | b'{' => depth += 1,
            b')' | b']' => {
                depth -= 1;
                if depth < 0 {
                    return pos;
                }
            }
            b'}' => {
                depth -= 1;
                if depth < 0 {
                    return pos;
                }
                if depth == 0 && is_item {
                    let next = skip_space(text, pos + 1);
                    if word_at(text, next).0 != "else" {
                        return pos + 1;
                    }
                }
            }
            b';' if depth == 0 => return pos + 1,
            b',' if depth == 0 && !is_item => return pos + 1,
            _ => {}
        }
        pos += 1;
    }
    text.len()
}

/// Whether a `cfg` predicate limits an item to test builds.
fn predicate_is_test(predicate: &str) -> bool {
    if predicate == "test" {
        return true;
    }
    let Some(inner) = predicate
        .strip_prefix("all(")
        .and_then(|rest| rest.strip_suffix(')'))
    else {
        return false;
    };
    let mut depth = 0;
    let mut start = 0;
    for (at, byte) in inner.bytes().enumerate() {
        match byte {
            b'(' => depth += 1,
            b')' => depth -= 1,
            b',' if depth == 0 => {
                if predicate_is_test(&inner[start..at]) {
                    return true;
                }
                start = at + 1;
            }
            _ => {}
        }
    }
    predicate_is_test(&inner[start..])
}

/// The byte ranges of a blanked file that only test builds compile.
fn test_ranges(text: &[u8]) -> Vec<(usize, usize)> {
    let mut ranges = Vec::new();
    let mut at = 0;
    while at < text.len() {
        if text[at] != b'#' {
            at += 1;
            continue;
        }
        let start = at;
        let mut pos = skip_space(text, at + 1);
        let inner = text.get(pos) == Some(&b'!');
        if inner {
            pos = skip_space(text, pos + 1);
        }
        if text.get(pos) != Some(&b'[') {
            at += 1;
            continue;
        }
        pos = skip_space(text, pos + 1);
        let (word, end) = word_at(text, pos);
        pos = skip_space(text, end);
        if word != "cfg" || text.get(pos) != Some(&b'(') {
            at += 1;
            continue;
        }
        let open = pos + 1;
        let mut depth = 1;
        pos = open;
        while pos < text.len() && depth > 0 {
            match text[pos] {
                b'(' => depth += 1,
                b')' => depth -= 1,
                _ => {}
            }
            pos += 1;
        }
        let predicate: String = text[open..pos - 1]
            .iter()
            .filter(|byte| !byte.is_ascii_whitespace())
            .map(|byte| *byte as char)
            .collect();
        let close = skip_space(text, pos);
        at = close + 1;
        if !predicate_is_test(&predicate) {
            continue;
        }
        if inner {
            return vec![(0, text.len())];
        }
        let end = item_end(text, at);
        ranges.push((start, end));
        at = end;
    }
    ranges
}

/// Expand one use tree at `at` into `out`, and return where the tree ends.
fn use_tree(
    text: &[u8],
    mut at: usize,
    mut prefix: Vec<String>,
    out: &mut Vec<Vec<String>>,
) -> usize {
    loop {
        at = skip_space(text, at);
        match text.get(at) {
            Some(b'{') => {
                at += 1;
                loop {
                    at = skip_space(text, at);
                    match text.get(at) {
                        None => return at,
                        Some(b'}') => return at + 1,
                        Some(b',') => at += 1,
                        Some(_) => {
                            let end = use_tree(text, at, prefix.clone(), out);
                            at = if end == at { at + 1 } else { end };
                        }
                    }
                }
            }
            Some(byte) if is_ident_start(*byte) => {
                let (word, end) = word_at(text, at);
                if word != "self" || prefix.is_empty() {
                    prefix.push(word.to_owned());
                }
                at = skip_space(text, end);
                if text[at..].starts_with(b"::") {
                    at += 2;
                    continue;
                }
                if word_at(text, at).0 == "as" {
                    at = skip_space(text, at + 2);
                    at = word_at(text, at).1;
                }
                out.push(prefix);
                return at;
            }
            Some(b'*') => {
                out.push(prefix);
                return at + 1;
            }
            _ => {
                out.push(prefix);
                return at;
            }
        }
    }
}

/// Resolve a `crate::`, `super::` or `self::` path against the current module.
fn absolute(path: &[String], current: &[String]) -> Vec<String> {
    let mut base = current.to_vec();
    let mut rest = path;
    match path.first().map(String::as_str) {
        Some("crate") => {
            base.clear();
            rest = &path[1..];
        }
        Some("self") => rest = &path[1..],
        _ => {}
    }
    while rest.first().map(String::as_str) == Some("super") {
        base.pop();
        rest = &rest[1..];
    }
    base.extend_from_slice(rest);
    base
}

struct ModDecl {
    name: String,
    inline: Vec<String>,
    path_attr: Option<String>,
    test: bool,
}

struct NamedPath {
    absolute: Vec<String>,
    symbol: String,
    line: usize,
    test: bool,
}

struct RustFile {
    path: String,
    module: Vec<String>,
    test: bool,
    paths: Vec<NamedPath>,
    uses: Vec<Vec<String>>,
}

/// Read the `mod` declarations, inline modules and module-relative paths of a file.
fn analyze_rust(raw: &[u8], module: &[String]) -> (Vec<ModDecl>, Vec<NamedPath>, Vec<Vec<String>>) {
    let text = blank_rust(raw);
    let tests = test_ranges(&text);
    let in_test = |at: usize| tests.iter().any(|(from, to)| (*from..*to).contains(&at));
    let newlines: Vec<usize> = text
        .iter()
        .enumerate()
        .filter(|(_, byte)| **byte == b'\n')
        .map(|(at, _)| at)
        .collect();
    let mut decls = Vec::new();
    let mut paths = Vec::new();
    let mut uses = Vec::new();
    let mut inline: Vec<(String, usize)> = Vec::new();
    let mut depth = 0usize;
    let mut path_attr: Option<String> = None;
    let mut at = 0;
    while at < text.len() {
        let byte = text[at];
        if is_ident_start(byte) && (at == 0 || !is_ident(text[at - 1])) {
            let (word, end) = word_at(&text, at);
            match word {
                "mod" => {
                    let name_at = skip_space(&text, end);
                    let (name, name_end) = word_at(&text, name_at);
                    let next = skip_space(&text, name_end);
                    match text.get(next) {
                        Some(b';') => decls.push(ModDecl {
                            name: name.to_owned(),
                            inline: inline.iter().map(|(name, _)| name.clone()).collect(),
                            path_attr: path_attr.take(),
                            test: in_test(at),
                        }),
                        Some(b'{') => {
                            inline.push((name.to_owned(), depth));
                            depth += 1;
                            path_attr = None;
                        }
                        _ => {}
                    }
                    at = next + 1;
                    continue;
                }
                "crate" | "super" | "self" if text[skip_space(&text, end)..].starts_with(b"::") => {
                    let mut found = Vec::new();
                    let tree_end = use_tree(&text, at, Vec::new(), &mut found);
                    let mut current = module.to_vec();
                    current.extend(inline.iter().map(|(name, _)| name.clone()));
                    let line = newlines.partition_point(|newline| *newline < at) + 1;
                    for path in found {
                        paths.push(NamedPath {
                            absolute: absolute(&path, &current),
                            symbol: path.join("::"),
                            line,
                            test: in_test(at),
                        });
                    }
                    at = tree_end;
                    continue;
                }
                "use" if module.is_empty() => {
                    let mut found = Vec::new();
                    at = use_tree(&text, end, Vec::new(), &mut found);
                    uses.extend(found);
                    continue;
                }
                _ => {
                    at = end;
                    continue;
                }
            }
        }
        match byte {
            b'{' => {
                depth += 1;
                path_attr = None;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                path_attr = None;
                if inline.last().is_some_and(|(_, open)| *open == depth) {
                    inline.pop();
                }
            }
            b';' => path_attr = None,
            b'#' => {
                let mut pos = skip_space(&text, at + 1);
                if text.get(pos) == Some(&b'[') {
                    pos = skip_space(&text, pos + 1);
                    let (word, end) = word_at(&text, pos);
                    pos = skip_space(&text, end);
                    if word == "path" && text.get(pos) == Some(&b'=') {
                        pos = skip_space(&text, pos + 1);
                        if text.get(pos) == Some(&b'"') {
                            if let Some(length) =
                                text[pos + 1..].iter().position(|byte| *byte == b'"')
                            {
                                path_attr = Some(
                                    String::from_utf8_lossy(&raw[pos + 1..pos + 1 + length])
                                        .into_owned(),
                                );
                            }
                        }
                    }
                }
            }
            _ => {}
        }
        at += 1;
    }
    (decls, paths, uses)
}

fn normalize(path: &str) -> String {
    let mut parts: Vec<&str> = Vec::new();
    for part in path.split('/') {
        match part {
            "" | "." => {}
            ".." => {
                parts.pop();
            }
            other => parts.push(other),
        }
    }
    parts.join("/")
}

fn is_test_file_name(path: &str) -> bool {
    let name = path.rsplit('/').next().unwrap_or(path);
    name == "tests.rs" || name.ends_with("_tests.rs")
}

/// The directory a `mod x;` in `file` looks in, under any inline modules.
fn child_directory(file: &str, loaded_by_path: bool, inline: &[String]) -> String {
    let (directory, name) = file.rsplit_once('/').unwrap_or(("", file));
    let mut out = directory.to_owned();
    if !loaded_by_path && !matches!(name, "lib.rs" | "main.rs" | "mod.rs") {
        out = format!("{out}/{}", name.trim_end_matches(".rs"));
    }
    for part in inline {
        out = format!("{out}/{part}");
    }
    out
}

fn walk_rust(
    root: &Path,
    file: &str,
    loaded_by_path: bool,
    module: Vec<String>,
    test: bool,
    files: &mut Vec<RustFile>,
) -> Result<(), Fail> {
    let raw = std::fs::read(root.join(file)).map_err(|error| format!("{file}: {error}"))?;
    let (decls, paths, uses) = analyze_rust(&raw, &module);
    files.push(RustFile {
        path: file.to_owned(),
        module: module.clone(),
        test,
        paths,
        uses,
    });
    for decl in decls {
        let directory = child_directory(file, loaded_by_path, &decl.inline);
        let child = if let Some(path) = &decl.path_attr {
            let base = file.rsplit_once('/').map_or("", |(base, _)| base);
            normalize(&format!("{base}/{path}"))
        } else {
            let flat = format!("{directory}/{}.rs", decl.name);
            let nested = format!("{directory}/{}/mod.rs", decl.name);
            if root.join(&flat).is_file() {
                flat
            } else if root.join(&nested).is_file() {
                nested
            } else {
                return Err(format!("{file}: `mod {}` has no file", decl.name).into());
            }
        };
        let mut child_module = module.clone();
        child_module.extend(decl.inline.iter().cloned());
        child_module.push(decl.name.clone());
        let child_test = test || decl.test || is_test_file_name(&child);
        walk_rust(
            root,
            &child,
            decl.path_attr.is_some(),
            child_module,
            child_test,
            files,
        )?;
    }
    Ok(())
}

fn scan_rust(root: &Path, scan: &mut Scan) -> Result<(), Fail> {
    let mut files = Vec::new();
    walk_rust(
        root,
        &format!("{RUST_SOURCE}/lib.rs"),
        false,
        Vec::new(),
        false,
        &mut files,
    )?;
    if root.join(RUST_SOURCE).join("main.rs").is_file() {
        walk_rust(
            root,
            &format!("{RUST_SOURCE}/main.rs"),
            false,
            Vec::new(),
            false,
            &mut files,
        )?;
    }
    let by_module: BTreeMap<String, String> = files
        .iter()
        .filter(|file| !file.module.is_empty())
        .map(|file| (file.module.join("::"), file.path.clone()))
        .collect();
    let top: BTreeSet<&str> = files
        .iter()
        .filter_map(|file| file.module.first().map(String::as_str))
        .collect();
    // A crate-root path names a re-export, and follows it to the module it names.
    let exports: BTreeMap<&str, &Vec<String>> = files
        .iter()
        .filter(|file| file.module.is_empty())
        .flat_map(|file| &file.uses)
        .filter_map(|path| path.last().map(|name| (name.as_str(), path)))
        .collect();
    for file in &files {
        if file.test {
            scan.test.insert(file.path.clone());
        } else {
            scan.production.insert(file.path.clone());
        }
        for path in &file.paths {
            let mut target = path.absolute.clone();
            if let Some(head) = target.first() {
                if !top.contains(head.as_str()) {
                    if let Some(export) = exports.get(head.as_str()) {
                        target.splice(0..1, export.iter().cloned());
                    }
                }
            }
            let test = file.test || path.test;
            if let (false, Some(me), Some(head)) = (test, file.module.first(), target.first()) {
                if head != me && top.contains(head.as_str()) {
                    scan.legacy
                        .entry(me.clone())
                        .or_default()
                        .entry(head.clone())
                        .or_insert_with(|| Edge {
                            from: file.path.clone(),
                            to: head.clone(),
                            line: path.line,
                            symbol: path.symbol.clone(),
                        });
                }
            }
            let resolved = (1..=target.len())
                .rev()
                .find_map(|length| by_module.get(&target[..length].join("::")));
            let Some(resolved) = resolved else {
                continue;
            };
            if *resolved == file.path {
                continue;
            }
            let edge = Edge {
                from: file.path.clone(),
                to: resolved.clone(),
                line: path.line,
                symbol: path.symbol.clone(),
            };
            if test {
                scan.test_edges.push(edge);
            } else {
                scan.edges.push(edge);
            }
        }
    }
    Ok(())
}

#[derive(Clone, PartialEq)]
enum JsToken {
    Word(String),
    Text(String),
    Template(Option<String>),
    Mark(u8),
}

/// Whether a `/` after `last` starts a regular expression rather than a division.
fn regex_may_follow(last: Option<&JsToken>) -> bool {
    match last {
        None => true,
        Some(JsToken::Mark(mark)) => !matches!(mark, b')' | b']' | b'}'),
        Some(JsToken::Word(word)) => matches!(
            word.as_str(),
            "await"
                | "case"
                | "delete"
                | "do"
                | "else"
                | "in"
                | "instanceof"
                | "new"
                | "of"
                | "return"
                | "throw"
                | "typeof"
                | "void"
                | "yield"
        ),
        _ => false,
    }
}

/// The end of a regular expression at `at`, unless a newline shows it is none.
fn regex_end(bytes: &[u8], at: usize) -> Option<usize> {
    let mut pos = at + 1;
    let mut class = false;
    while let Some(byte) = bytes.get(pos) {
        match byte {
            b'\n' => return None,
            b'\\' => pos += 1,
            b'[' => class = true,
            b']' => class = false,
            b'/' if !class => return Some(pos + 1),
            _ => {}
        }
        pos += 1;
    }
    None
}

/// Tokens of a JavaScript file with comments gone and literals held apart.
fn js_tokens(text: &str) -> Vec<(JsToken, usize)> {
    /// Read template text from `at`: its body, where it stops, and whether at `${`.
    fn template(bytes: &[u8], mut at: usize) -> (String, usize, bool) {
        let start = at;
        while let Some(byte) = bytes.get(at) {
            match byte {
                b'\\' => at += 2,
                b'`' => {
                    let body = String::from_utf8_lossy(&bytes[start..at]).into_owned();
                    return (body, at + 1, false);
                }
                b'$' if bytes.get(at + 1) == Some(&b'{') => {
                    let body = String::from_utf8_lossy(&bytes[start..at]).into_owned();
                    return (body, at + 2, true);
                }
                _ => at += 1,
            }
        }
        (String::new(), bytes.len(), false)
    }
    let bytes = text.as_bytes();
    let newlines: Vec<usize> = bytes
        .iter()
        .enumerate()
        .filter(|(_, byte)| **byte == b'\n')
        .map(|(at, _)| at)
        .collect();
    let mut tokens: Vec<(JsToken, usize)> = Vec::new();
    let mut at = 0;
    let mut depth = 0usize;
    let mut open_templates: Vec<usize> = Vec::new();
    if text.starts_with("#!") {
        at = text.find('\n').unwrap_or(text.len());
    }
    while let Some(&byte) = bytes.get(at) {
        let line = newlines.partition_point(|newline| *newline < at) + 1;
        match byte {
            b'/' if bytes.get(at + 1) == Some(&b'/') => {
                at = bytes[at..]
                    .iter()
                    .position(|byte| *byte == b'\n')
                    .map_or(bytes.len(), |offset| at + offset);
            }
            b'/' if bytes.get(at + 1) == Some(&b'*') => {
                at = text[at + 2..]
                    .find("*/")
                    .map_or(bytes.len(), |offset| at + 2 + offset + 2);
            }
            b'/' => {
                let last = tokens.last().map(|(token, _)| token);
                let end = regex_may_follow(last)
                    .then(|| regex_end(bytes, at))
                    .flatten();
                if let Some(end) = end {
                    tokens.push((JsToken::Template(None), line));
                    at = end;
                } else {
                    tokens.push((JsToken::Mark(b'/'), line));
                    at += 1;
                }
            }
            b'\'' | b'"' => {
                let mut end = at + 1;
                while let Some(next) = bytes.get(end) {
                    if *next == byte || *next == b'\n' {
                        break;
                    }
                    end += if *next == b'\\' { 2 } else { 1 };
                }
                let end = end.min(bytes.len());
                let body = String::from_utf8_lossy(&bytes[at + 1..end]).into_owned();
                tokens.push((JsToken::Text(body), line));
                at = if bytes.get(end) == Some(&byte) {
                    end + 1
                } else {
                    end
                };
            }
            b'`' => {
                let (body, end, open) = template(bytes, at + 1);
                if open {
                    tokens.push((JsToken::Template(None), line));
                    open_templates.push(depth);
                } else {
                    tokens.push((JsToken::Template(Some(body)), line));
                }
                at = end;
            }
            b'{' => {
                depth += 1;
                tokens.push((JsToken::Mark(b'{'), line));
                at += 1;
            }
            b'}' if open_templates.last() == Some(&depth) => {
                open_templates.pop();
                let (_, end, open) = template(bytes, at + 1);
                if open {
                    open_templates.push(depth);
                }
                tokens.push((JsToken::Mark(b')'), line));
                at = end;
            }
            b'}' => {
                depth = depth.saturating_sub(1);
                tokens.push((JsToken::Mark(b'}'), line));
                at += 1;
            }
            _ if byte == b'$' || byte >= 0x80 || is_ident(byte) => {
                let mut end = at;
                while bytes
                    .get(end)
                    .is_some_and(|byte| *byte == b'$' || *byte >= 0x80 || is_ident(*byte))
                {
                    end += 1;
                }
                tokens.push((JsToken::Word(text[at..end].to_owned()), line));
                at = end;
            }
            _ if byte.is_ascii_whitespace() => at += 1,
            _ => {
                tokens.push((JsToken::Mark(byte), line));
                at += 1;
            }
        }
    }
    tokens
}

/// The specifier of an import or export clause that starts at token `start`.
fn from_clause(tokens: &[(JsToken, usize)], start: usize) -> Option<String> {
    let mut depth = 0;
    for at in start..tokens.len() {
        match &tokens[at].0 {
            JsToken::Mark(b'{') => depth += 1,
            JsToken::Mark(b'}') => depth -= 1,
            JsToken::Mark(b'*' | b',') => {}
            JsToken::Word(word) if depth == 0 && word == "from" => {
                return match tokens.get(at + 1) {
                    Some((JsToken::Text(specifier), _)) => Some(specifier.clone()),
                    _ => None,
                };
            }
            JsToken::Word(_) => {}
            JsToken::Text(_) if depth > 0 => {}
            _ => return None,
        }
    }
    None
}

/// Every import with a literal specifier: static, re-export and `import()`.
fn js_specifiers(text: &str) -> Vec<(String, usize)> {
    let tokens = js_tokens(text);
    let mut out = Vec::new();
    for at in 0..tokens.len() {
        let JsToken::Word(word) = &tokens[at].0 else {
            continue;
        };
        if !matches!(word.as_str(), "import" | "export")
            || (at > 0 && tokens[at - 1].0 == JsToken::Mark(b'.'))
        {
            continue;
        }
        let line = tokens[at].1;
        let next = tokens.get(at + 1).map(|(token, _)| token);
        let found = match (word.as_str(), next) {
            ("import", Some(JsToken::Text(specifier))) => Some(specifier.clone()),
            ("import", Some(JsToken::Mark(b'('))) => {
                let closed = matches!(
                    tokens.get(at + 3).map(|(token, _)| token),
                    Some(JsToken::Mark(b')' | b','))
                );
                match tokens.get(at + 2).map(|(token, _)| token) {
                    Some(JsToken::Text(specifier)) if closed => Some(specifier.clone()),
                    Some(JsToken::Template(Some(specifier))) if closed => Some(specifier.clone()),
                    _ => None,
                }
            }
            ("import", Some(JsToken::Mark(b'.'))) => None,
            ("import", Some(_)) => from_clause(&tokens, at + 1),
            ("export", Some(JsToken::Mark(b'*' | b'{'))) => from_clause(&tokens, at + 1),
            _ => None,
        };
        if let Some(specifier) = found {
            out.push((specifier, line));
        }
    }
    out
}

fn export_targets(value: &serde_json::Value, out: &mut Vec<String>) {
    match value {
        serde_json::Value::String(target) => out.push(target.clone()),
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                if key != "types" {
                    export_targets(nested, out);
                }
            }
        }
        _ => {}
    }
}

/// The files a bare specifier reaches in a scanned package, or none if external.
fn resolve_package(
    specifier: &str,
    packages: &BTreeMap<String, (String, serde_json::Value)>,
) -> Option<Vec<String>> {
    let (name, (directory, manifest)) = packages.iter().find(|(name, _)| {
        specifier == name.as_str() || specifier.starts_with(&format!("{name}/"))
    })?;
    let subpath = format!(".{}", &specifier[name.len()..]);
    let mut targets = Vec::new();
    match manifest.get("exports") {
        Some(serde_json::Value::Object(map)) if map.keys().any(|key| key.starts_with('.')) => {
            if let Some(value) = map.get(&subpath) {
                export_targets(value, &mut targets);
            }
        }
        Some(value) if subpath == "." => export_targets(value, &mut targets),
        _ => {}
    }
    if targets.is_empty() {
        targets.push(subpath);
    }
    Some(
        targets
            .iter()
            .map(|target| normalize(&format!("{directory}/{target}")))
            .collect(),
    )
}

fn scan_javascript(root: &Path, scan: &mut Scan) -> Result<(), Fail> {
    let mut packages = BTreeMap::new();
    for directory in JS_PACKAGES {
        let path = root.join(directory).join("package.json");
        if path.is_file() {
            let manifest: serde_json::Value = serde_json::from_slice(&std::fs::read(&path)?)
                .map_err(|error| format!("{directory}/package.json: {error}"))?;
            if let Some(name) = manifest.get("name").and_then(serde_json::Value::as_str) {
                packages.insert(name.to_owned(), (directory.to_owned(), manifest.clone()));
            }
        }
    }
    let mut files = BTreeSet::new();
    for source in JS_SOURCE_ROOTS {
        let walk = walkdir::WalkDir::new(root.join(source))
            .into_iter()
            .filter_entry(|entry| {
                !matches!(entry.file_name().to_str(), Some("node_modules" | "test"))
            });
        for entry in walk.flatten() {
            let is_code = entry
                .path()
                .extension()
                .and_then(|extension| extension.to_str())
                .is_some_and(|extension| matches!(extension, "mjs" | "js" | "cjs"));
            if entry.file_type().is_file() && is_code {
                let relative = entry.path().strip_prefix(root)?;
                files.insert(
                    relative
                        .components()
                        .map(|part| part.as_os_str().to_string_lossy())
                        .collect::<Vec<_>>()
                        .join("/"),
                );
            }
        }
    }
    for file in &files {
        let bytes = std::fs::read(root.join(file)).map_err(|error| format!("{file}: {error}"))?;
        let text = String::from_utf8_lossy(&bytes);
        let directory = file.rsplit_once('/').map_or("", |(base, _)| base);
        for (specifier, line) in js_specifiers(&text) {
            let relative = specifier.starts_with("./") || specifier.starts_with("../");
            let targets = if relative {
                vec![normalize(&format!("{directory}/{specifier}"))]
            } else if let Some(targets) = resolve_package(&specifier, &packages) {
                targets
            } else {
                continue;
            };
            for target in targets {
                let edge = Edge {
                    from: file.clone(),
                    to: target.clone(),
                    line,
                    symbol: specifier.clone(),
                };
                if !root.join(&target).exists() {
                    scan.unresolved.push(edge);
                } else if files.contains(&target) && target != *file {
                    scan.edges.push(edge);
                }
            }
        }
    }
    scan.production.extend(files);
    Ok(())
}

fn strongly_connected(graph: &BTreeMap<String, BTreeSet<String>>) -> Vec<BTreeSet<String>> {
    struct State<'a> {
        graph: &'a BTreeMap<String, BTreeSet<String>>,
        index: BTreeMap<&'a str, usize>,
        low: BTreeMap<&'a str, usize>,
        stack: Vec<&'a str>,
        out: Vec<BTreeSet<String>>,
    }
    fn visit<'a>(state: &mut State<'a>, node: &'a str) {
        let order = state.index.len();
        state.index.insert(node, order);
        state.low.insert(node, order);
        state.stack.push(node);
        let graph = state.graph;
        if let Some(next) = graph.get(node) {
            for target in next {
                let target = target.as_str();
                if !state.index.contains_key(target) {
                    visit(state, target);
                    let low = state.low[node].min(state.low[target]);
                    state.low.insert(node, low);
                } else if state.stack.contains(&target) {
                    let low = state.low[node].min(state.index[target]);
                    state.low.insert(node, low);
                }
            }
        }
        if state.low[node] == state.index[node] {
            let mut component = BTreeSet::new();
            while let Some(top) = state.stack.pop() {
                component.insert(top.to_owned());
                if top == node {
                    break;
                }
            }
            state.out.push(component);
        }
    }
    let mut state = State {
        graph,
        index: BTreeMap::new(),
        low: BTreeMap::new(),
        stack: Vec::new(),
        out: Vec::new(),
    };
    for node in graph.keys() {
        if !state.index.contains_key(node.as_str()) {
            visit(&mut state, node);
        }
    }
    state.out
}

/// Every top-level Rust module in a cycle, with one production edge inside it.
fn legacy_members(scan: &Scan) -> BTreeMap<String, Edge> {
    let graph: BTreeMap<String, BTreeSet<String>> = scan
        .legacy
        .iter()
        .map(|(from, targets)| (from.clone(), targets.keys().cloned().collect()))
        .collect();
    let mut members = BTreeMap::new();
    for component in strongly_connected(&graph) {
        if component.len() < 2 {
            continue;
        }
        for member in &component {
            let witness = scan.legacy[member]
                .iter()
                .find(|(target, _)| component.contains(*target))
                .map(|(_, edge)| edge.clone())
                .expect("a cycle member has an edge inside its cycle");
            members.insert(member.clone(), witness);
        }
    }
    members
}

/// Rules 1 to 5, in order. Each failure names the file, line, symbol and rule.
fn check_rules(manifest: &Manifest, scan: &Scan) -> Vec<String> {
    let mut failures = Vec::new();

    // Rule 1: the table has no cycle, and names only modules it declares.
    let mut table = manifest.modules.clone();
    for (name, allowed) in &manifest.modules {
        for target in allowed {
            if !manifest.modules.contains_key(target) {
                failures.push(format!(
                    "{MANIFEST}:{}: {name}: rule 1: `{target}` is not a declared module",
                    manifest.line_of(&format!("name = \"{name}\""))
                ));
                table.get_mut(name).expect("declared").remove(target);
            }
        }
        if allowed.contains(name) {
            failures.push(format!(
                "{MANIFEST}:{}: {name}: rule 1: the module table has a cycle: {name}",
                manifest.line_of(&format!("name = \"{name}\""))
            ));
        }
    }
    for component in strongly_connected(&table) {
        if component.len() > 1 {
            let names: Vec<&str> = component.iter().map(String::as_str).collect();
            failures.push(format!(
                "{MANIFEST}:{}: {}: rule 1: the module table has a cycle: {}",
                manifest.line_of(&format!("name = \"{}\"", names[0])),
                names[0],
                names.join(", ")
            ));
        }
    }

    // Rule 2: every scanned file has one owner, and every owner entry matches a file.
    let mut matched = BTreeSet::new();
    for file in &scan.production {
        match manifest.owner_entry(file) {
            Some(entry) => {
                matched.insert(entry.to_owned());
            }
            None => failures.push(format!(
                "{file}:1: {file}: rule 2: no owner; add to {MANIFEST}:\n  [[owner]]\n  path = \"{file}\"\n  module = \"<one of the nine>\""
            )),
        }
    }
    for file in &scan.test {
        if let Some(entry) = manifest.owner_entry(file) {
            matched.insert(entry.to_owned());
        }
    }
    for entry in manifest.owners.keys() {
        if !matched.contains(entry) {
            failures.push(format!(
                "{MANIFEST}:{}: {entry}: rule 2: this owner entry matches no file",
                manifest.line_of(&format!("path = \"{entry}\""))
            ));
        }
    }
    // Rules 3 and 4: a forbidden edge must be listed, and a listed edge must occur.
    let listed: BTreeSet<(&str, &str)> = manifest
        .pending
        .iter()
        .map(|entry| (entry.from.as_str(), entry.to.as_str()))
        .collect();
    let mut occurring = BTreeSet::new();
    for edge in &scan.edges {
        let (Some(from), Some(to)) = (manifest.owner(&edge.from), manifest.owner(&edge.to)) else {
            continue;
        };
        if from == to
            || manifest
                .modules
                .get(from)
                .is_some_and(|allowed| allowed.contains(to))
        {
            continue;
        }
        if listed.contains(&(edge.from.as_str(), edge.to.as_str())) {
            occurring.insert((edge.from.as_str(), edge.to.as_str()));
        } else {
            failures.push(format!(
                "{}:{}: {}: rule 3: `{from}` may not depend on `{to}` ({})",
                edge.from, edge.line, edge.symbol, edge.to
            ));
        }
    }
    for entry in &manifest.pending {
        if !occurring.contains(&(entry.from.as_str(), entry.to.as_str())) {
            failures.push(format!(
                "{MANIFEST}:{}: {} to {}: rule 4: this forbidden edge no longer occurs; delete the entry",
                manifest.line_of(&format!("from = \"{}\"\nto = \"{}\"", entry.from, entry.to)),
                entry.from,
                entry.to
            ));
        }
    }

    // Rule 5: the old cycle stays within its list, and a member that left comes off.
    let members = legacy_members(scan);
    for (member, edge) in &members {
        if !manifest.legacy_cycle.contains(member) {
            failures.push(format!(
                "{}:{}: {}: rule 5: `{member}` joins a cycle of top-level modules and is not in legacy_cycle.members",
                edge.from, edge.line, edge.symbol
            ));
        }
    }
    for member in &manifest.legacy_cycle {
        if !members.contains_key(member) {
            failures.push(format!(
                "{MANIFEST}:{}: {member}: rule 5: `{member}` has left the cycle; remove it from legacy_cycle.members",
                manifest.line_of("[legacy_cycle]")
            ));
        }
    }
    failures
}

fn git(root: &Path, args: &[&str]) -> Option<String> {
    let output = Command::new("git")
        .args(args)
        .current_dir(root)
        .output()
        .ok()?;
    output
        .status
        .success()
        .then(|| String::from_utf8_lossy(&output.stdout).into_owned())
}

/// Rule 6: the baseline may not grow past what the merge base holds.
fn check_baseline(
    root: &Path,
    manifest: &Manifest,
    notes: &mut Vec<String>,
) -> Result<Vec<String>, Fail> {
    let reference = format!("{BASE_REF}^{{commit}}");
    if git(root, &["rev-parse", "--verify", "--quiet", &reference]).is_none() {
        notes.push(format!("rule 6 not run: this checkout has no {BASE_REF}"));
        return Ok(Vec::new());
    }
    let base = git(root, &["merge-base", "HEAD", BASE_REF])
        .ok_or_else(|| format!("{MANIFEST}: rule 6 finds no merge base of HEAD and {BASE_REF}"))?;
    let base = base.trim();
    let Some(text) = git(root, &["show", &format!("{base}:{MANIFEST}")]) else {
        notes.push(format!(
            "rule 6: merge base {base} has no {MANIFEST}, so this tree sets the baseline"
        ));
        return Ok(Vec::new());
    };
    let held = parse_manifest(&text)?;
    let mut failures = Vec::new();
    if manifest.pending.len() > held.pending.len() {
        failures.push(format!(
            "{MANIFEST}:{}: [[pending]]: rule 6: {} entries, and merge base {base} holds {}; cut an edge instead of listing one",
            manifest.line_of("[[pending]]"),
            manifest.pending.len(),
            held.pending.len()
        ));
    }
    if manifest.legacy_cycle.len() > held.legacy_cycle.len() {
        failures.push(format!(
            "{MANIFEST}:{}: legacy_cycle.members: rule 6: {} members, and merge base {base} holds {}; the list only shrinks",
            manifest.line_of("[legacy_cycle]"),
            manifest.legacy_cycle.len(),
            held.legacy_cycle.len()
        ));
    }
    notes.push(format!(
        "rule 6: merge base {base} holds {} pending and {} cycle members",
        held.pending.len(),
        held.legacy_cycle.len()
    ));
    Ok(failures)
}

fn run_scan(root: &Path) -> Result<Scan, Fail> {
    let mut scan = Scan::default();
    scan_rust(root, &mut scan)?;
    scan_javascript(root, &mut scan)?;
    Ok(scan)
}

/// Unit tests that cross the table: reported during migration, never failing.
fn test_report(manifest: &Manifest, scan: &Scan) -> BTreeSet<String> {
    scan.test_edges
        .iter()
        .filter(
            |edge| match (manifest.owner(&edge.from), manifest.owner(&edge.to)) {
                (Some(from), Some(to)) => {
                    from != to
                        && !manifest
                            .modules
                            .get(from)
                            .is_some_and(|allowed| allowed.contains(to))
                }
                _ => false,
            },
        )
        .map(|edge| format!("{} to {}", edge.from, edge.to))
        .collect()
}

/// Run `cargo xtask check-modules`.
pub fn validate(root: &Path) -> Result<(), Fail> {
    let text = std::fs::read_to_string(root.join(MANIFEST))
        .map_err(|error| format!("{MANIFEST}: {error}"))?;
    let manifest = parse_manifest(&text)?;
    let scan = run_scan(root)?;
    let mut notes = Vec::new();
    let mut failures = check_rules(&manifest, &scan);
    failures.extend(check_baseline(root, &manifest, &mut notes)?);
    for note in &notes {
        println!("check-modules: {note}");
    }
    let report = test_report(&manifest, &scan);
    println!(
        "check-modules: report: unit tests under src/ cross the table at {} file edges",
        report.len()
    );
    for line in &report {
        println!("check-modules: report: {line}");
    }
    // A page's import can name a path its server provides: no file, and no edge.
    for edge in &scan.unresolved {
        println!(
            "check-modules: report: {}:{}: {} names no file, so it is not an edge",
            edge.from, edge.line, edge.symbol
        );
    }
    if !failures.is_empty() {
        for failure in &failures {
            eprintln!("{failure}");
        }
        return Err(format!("check-modules: {} failures", failures.len()).into());
    }
    println!(
        "check-modules: {} modules, {} files, {} edges, {} pending, {} in the old cycle",
        manifest.modules.len(),
        scan.production.len(),
        scan.edges.len(),
        manifest.pending.len(),
        manifest.legacy_cycle.len()
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    const LIB: &str = "crates/prismpm/src/lib.rs";
    const ALPHA: &str = "crates/prismpm/src/alpha.rs";
    const BETA: &str = "crates/prismpm/src/beta.rs";
    const KEEP: &str = "crates/prismpm/src/beta/keep.rs";
    const LOW_JS: &str = "sdk/npm/prism-code/src/low.mjs";
    const HIGH_JS: &str = "sdk/npm/prism-code/src/high.mjs";
    const VERIFY_JS: &str = "sdk/npm/verify/src/index.mjs";

    const TABLE: &str = r#"spec = "prismpm/modules/1"

[[module]]
name = "low"
may_depend_on = []

[[module]]
name = "high"
may_depend_on = ["low"]

[[owner]]
path = "crates/prismpm/src/alpha.rs"
module = "high"

[[owner]]
path = "crates/prismpm/src/beta.rs"
module = "low"

[[owner]]
path = "crates/prismpm/src/beta/"
module = "low"

[[owner]]
path = "crates/prismpm/src/lib.rs"
module = "high"

[[owner]]
path = "sdk/npm/prism-code/src/high.mjs"
module = "high"

[[owner]]
path = "sdk/npm/prism-code/src/low.mjs"
module = "low"

[[owner]]
path = "sdk/npm/verify/"
module = "low"
"#;

    /// A small passing tree: `alpha` (high) uses `beta` (low), in Rust and JavaScript.
    fn fixture() -> tempfile::TempDir {
        let root = tempfile::tempdir().unwrap();
        for (path, text) in [
            (MANIFEST, TABLE),
            (LIB, "pub mod alpha;\npub mod beta;\n"),
            (ALPHA, "use crate::beta::Thing;\n"),
            (BETA, "mod keep;\npub struct Thing;\n"),
            (KEEP, ""),
            (
                HIGH_JS,
                "import { low } from './low.mjs';\nimport { v } from '@prism-code/verify';\n",
            ),
            (LOW_JS, "export const low = 1;\n"),
            (
                "sdk/npm/verify/package.json",
                r#"{"name":"@prism-code/verify","exports":{".":"./src/index.mjs"}}"#,
            ),
            (VERIFY_JS, "export const v = 1;\n"),
        ] {
            write(root.path(), path, text);
        }
        root
    }

    fn write(root: &Path, path: &str, text: &str) {
        let path = root.join(path);
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, text).unwrap();
    }

    fn append(root: &Path, path: &str, text: &str) {
        let path = root.join(path);
        let mut existing = std::fs::read_to_string(&path).unwrap();
        existing.push_str(text);
        std::fs::write(path, existing).unwrap();
    }

    fn failures(root: &Path) -> Vec<String> {
        let manifest =
            parse_manifest(&std::fs::read_to_string(root.join(MANIFEST)).unwrap()).unwrap();
        check_rules(&manifest, &run_scan(root).unwrap())
    }

    fn assert_rule(found: &[String], location: &str, rule: u32) {
        let wanted = format!("rule {rule}:");
        assert!(
            found
                .iter()
                .any(|failure| failure.contains(location) && failure.contains(&wanted)),
            "no {wanted} at {location} in {found:#?}"
        );
    }

    fn assert_passes(root: &Path) {
        assert_eq!(failures(root), Vec::<String>::new());
    }

    fn pending(from: &str, to: &str) -> String {
        format!("\n[[pending]]\nfrom = \"{from}\"\nto = \"{to}\"\ncut = \"a cut\"\n")
    }

    fn legacy(members: &[&str]) -> String {
        format!("\n[legacy_cycle]\nmembers = {members:?}\n")
    }

    /// Give `beta` the owner of `alpha`, so a cycle between them breaks only rule 5.
    fn same_owner(root: &Path) {
        let table = std::fs::read_to_string(root.join(MANIFEST)).unwrap();
        let table = table.replace(
            "path = \"crates/prismpm/src/beta.rs\"\nmodule = \"low\"",
            "path = \"crates/prismpm/src/beta.rs\"\nmodule = \"high\"",
        );
        write(root, MANIFEST, &table);
    }

    #[test]
    fn the_fixture_passes() {
        assert_passes(fixture().path());
    }

    #[test]
    fn the_current_tree_passes() {
        assert_passes(Path::new(env!("CARGO_MANIFEST_DIR")).parent().unwrap());
    }

    #[test]
    fn rule_1_refuses_a_cycle_in_the_table() {
        let root = fixture();
        let table = TABLE.replace("may_depend_on = []", "may_depend_on = [\"high\"]");
        write(root.path(), MANIFEST, &table);
        assert_rule(&failures(root.path()), MANIFEST, 1);
    }

    #[test]
    fn rule_1_refuses_an_undeclared_module_in_the_table() {
        let root = fixture();
        let table = TABLE.replace("may_depend_on = []", "may_depend_on = [\"nowhere\"]");
        write(root.path(), MANIFEST, &table);
        assert_rule(&failures(root.path()), MANIFEST, 1);
    }

    #[test]
    fn rule_2_refuses_a_file_with_no_owner() {
        let root = fixture();
        write(root.path(), "sdk/npm/prism-code/src/new.mjs", "");
        let found = failures(root.path());
        assert_rule(&found, "sdk/npm/prism-code/src/new.mjs", 2);
        assert!(found[0].contains("[[owner]]"), "{found:#?}");
    }

    #[test]
    fn rule_2_refuses_an_owner_entry_that_matches_no_file() {
        let root = fixture();
        append(
            root.path(),
            MANIFEST,
            "\n[[owner]]\npath = \"crates/prismpm/src/gone.rs\"\nmodule = \"low\"\n",
        );
        assert_rule(&failures(root.path()), "crates/prismpm/src/gone.rs", 2);
    }

    #[test]
    fn the_longest_owner_entry_wins() {
        let root = fixture();
        write(root.path(), KEEP, "use crate::alpha::Up;\n");
        assert_rule(&failures(root.path()), KEEP, 3);
        append(
            root.path(),
            MANIFEST,
            "\n[[owner]]\npath = \"crates/prismpm/src/beta/keep.rs\"\nmodule = \"high\"\n",
        );
        let found = failures(root.path());
        assert!(
            !found.iter().any(|failure| failure.contains("rule 3:")),
            "{found:#?}"
        );
    }

    #[test]
    fn rule_3_refuses_a_forbidden_rust_dependency() {
        let root = fixture();
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        let found = failures(root.path());
        let wanted = format!("{BETA}:3: crate::alpha::Up: rule 3:");
        assert!(
            found.iter().any(|failure| failure.starts_with(&wanted)),
            "{found:#?}"
        );
    }

    #[test]
    fn rule_3_sees_inside_nested_use_groups() {
        let root = fixture();
        append(
            root.path(),
            BETA,
            "use crate::{alpha::{Up, deep::{self}}};\n",
        );
        assert_rule(&failures(root.path()), BETA, 3);
    }

    #[test]
    fn rule_3_follows_super_super() {
        let root = fixture();
        write(root.path(), KEEP, "use super::super::alpha::Up;\n");
        assert_rule(&failures(root.path()), KEEP, 3);
    }

    #[test]
    fn super_in_an_inline_module_stays_in_its_file() {
        let root = fixture();
        append(root.path(), BETA, "mod inner {\n    use super::Thing;\n}\n");
        assert_passes(root.path());
    }

    #[test]
    fn a_crate_root_path_follows_its_re_export() {
        let root = fixture();
        append(root.path(), LIB, "pub use alpha::Up;\n");
        append(root.path(), BETA, "use crate::Up;\n");
        assert_rule(&failures(root.path()), BETA, 3);
    }

    #[test]
    fn comments_and_literals_are_not_edges() {
        let root = fixture();
        append(
            root.path(),
            BETA,
            concat!(
                "// use crate::alpha::Up;\n",
                "/* crate::alpha::Up /* nested */ crate::alpha::Up */\n",
                "/// crate::alpha::Up\n",
                "pub const A: &str = \"crate::alpha::Up\";\n",
                "pub const B: &str = r#\"crate::alpha::\"Up\"#;\n",
                "pub const C: char = '\"';\n",
                "pub const D: u8 = b'{';\n",
                "pub fn e<'a>(x: &'a str) -> &'a str { x }\n",
            ),
        );
        assert_passes(root.path());
    }

    #[test]
    fn test_code_is_not_a_production_edge() {
        let root = fixture();
        append(
            root.path(),
            BETA,
            concat!(
                "#[cfg(test)]\nuse crate::alpha::Up;\n",
                "#[cfg(all(test, unix))]\nfn a() { crate::alpha::up(); }\n",
                "#[cfg(test)]\nmod inline { use crate::alpha::Up; }\n",
                "#[cfg(test)]\nmod beta_tests;\n",
                "mod tests;\n",
                "pub struct Field {\n    #[cfg(test)]\n    a: crate::alpha::Up,\n    b: u8,\n}\n",
            ),
        );
        for file in ["beta_tests.rs", "tests.rs"] {
            write(
                root.path(),
                &format!("crates/prismpm/src/beta/{file}"),
                "use crate::alpha::Up;\n",
            );
        }
        assert_passes(root.path());
    }

    #[test]
    fn unit_tests_that_cross_the_table_are_reported() {
        let root = fixture();
        append(root.path(), BETA, "#[cfg(test)]\nuse crate::alpha::Up;\n");
        let manifest = parse_manifest(TABLE).unwrap();
        let report = test_report(&manifest, &run_scan(root.path()).unwrap());
        assert_eq!(report.len(), 1, "{report:#?}");
    }

    #[test]
    fn production_cfg_forms_are_edges() {
        for form in ["not(test)", "any(test, unix)", "unix"] {
            let root = fixture();
            append(
                root.path(),
                BETA,
                &format!("#[cfg({form})]\nuse crate::alpha::Up;\n"),
            );
            assert_rule(&failures(root.path()), BETA, 3);
        }
    }

    #[test]
    fn code_after_a_test_item_still_counts() {
        let root = fixture();
        append(
            root.path(),
            BETA,
            "#[cfg(test)]\nfn a<T, U>() -> [u8; 2] { [0; 2] }\nuse crate::alpha::Up;\n",
        );
        assert_rule(&failures(root.path()), BETA, 3);
    }

    #[test]
    fn rule_3_refuses_every_form_of_javascript_import() {
        for line in [
            "import { high } from './high.mjs';",
            "import './high.mjs';",
            "import * as all from './high.mjs';",
            "import fallback, { high } from './high.mjs';",
            "export { high } from './high.mjs';",
            "export * from './high.mjs';",
            "export * as all from './high.mjs';",
            "const page = await import('./high.mjs');",
            "const page = await import(`./high.mjs`);",
        ] {
            let root = fixture();
            write(root.path(), LOW_JS, line);
            write(root.path(), HIGH_JS, "export const high = 1;\n");
            assert_rule(&failures(root.path()), LOW_JS, 3);
        }
    }

    #[test]
    fn javascript_that_is_not_an_import_is_not_an_edge() {
        for line in [
            "const page = await import(name);",
            "const page = await import(`./${name}.mjs`);",
            "const page = await import('./' + name);",
            "// import './high.mjs';",
            "/* export * from './high.mjs'; */",
            "const text = \"import './high.mjs'\";",
            "const text = `import './high.mjs'`;",
            "const text = `${`import './high.mjs'`}`;",
            "const pattern = /'/; const text = `import './high.mjs'`;",
            "const meta = import.meta.url;",
            "export const high = 1;",
            "const other = { import: './high.mjs' };",
            "object.import('./high.mjs');",
            "import { external } from 'some-package';",
            "import { file } from 'node:fs';",
        ] {
            let root = fixture();
            write(root.path(), LOW_JS, line);
            write(root.path(), HIGH_JS, "export const high = 1;\n");
            assert_eq!(failures(root.path()), Vec::<String>::new(), "{line}");
        }
    }

    #[test]
    fn a_bare_import_of_a_scanned_package_is_an_edge() {
        let root = fixture();
        write(root.path(), VERIFY_JS, "import 'prism-code';\n");
        write(
            root.path(),
            "sdk/npm/prism-code/package.json",
            r#"{"name":"prism-code","exports":{".":{"types":"./t.d.ts","import":"./src/high.mjs"}}}"#,
        );
        assert_rule(&failures(root.path()), VERIFY_JS, 3);
    }

    #[test]
    fn test_directories_are_not_scanned() {
        let root = fixture();
        write(
            root.path(),
            "sdk/npm/verify/test/up.test.mjs",
            "import '../../prism-code/src/high.mjs';\n",
        );
        assert_passes(root.path());
    }

    #[test]
    fn a_pending_entry_excuses_its_edge() {
        let root = fixture();
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        append(root.path(), MANIFEST, &pending(BETA, ALPHA));
        append(root.path(), MANIFEST, &legacy(&["alpha", "beta"]));
        assert_passes(root.path());
    }

    #[test]
    fn rule_4_refuses_a_pending_entry_that_no_longer_occurs() {
        let root = fixture();
        append(root.path(), MANIFEST, &pending(BETA, ALPHA));
        assert_rule(&failures(root.path()), BETA, 4);
    }

    #[test]
    fn rule_5_refuses_a_new_cycle() {
        let root = fixture();
        same_owner(root.path());
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        let found = failures(root.path());
        assert_rule(&found, ALPHA, 5);
        assert_rule(&found, BETA, 5);
    }

    #[test]
    fn rule_5_accepts_the_listed_cycle_and_refuses_a_member_that_left() {
        let root = fixture();
        same_owner(root.path());
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        append(root.path(), MANIFEST, &legacy(&["alpha", "beta"]));
        assert_passes(root.path());
        write(root.path(), BETA, "mod keep;\n");
        assert_rule(&failures(root.path()), MANIFEST, 5);
    }

    fn run_git(root: &Path, args: &[&str]) {
        let output = Command::new("git")
            .args(["-c", "user.name=gate", "-c", "user.email=gate@localhost"])
            .args(["-c", "commit.gpgsign=false"])
            .args(args)
            .current_dir(root)
            .output()
            .unwrap();
        assert!(output.status.success(), "git {args:?}: {output:?}");
    }

    /// Commit the tree and name that commit `origin/main`.
    fn publish(root: &Path) {
        run_git(root, &["init", "--quiet"]);
        run_git(root, &["add", "-A"]);
        run_git(root, &["commit", "--quiet", "-m", "base"]);
        run_git(root, &["update-ref", BASE_REF, "HEAD"]);
    }

    fn baseline(root: &Path) -> (Vec<String>, Vec<String>) {
        let text = std::fs::read_to_string(root.join(MANIFEST)).unwrap();
        let mut notes = Vec::new();
        let found = check_baseline(root, &parse_manifest(&text).unwrap(), &mut notes).unwrap();
        (found, notes)
    }

    #[test]
    fn rule_6_refuses_a_grown_pending_list() {
        let root = fixture();
        publish(root.path());
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        append(root.path(), MANIFEST, &pending(BETA, ALPHA));
        append(root.path(), MANIFEST, &legacy(&["alpha", "beta"]));
        // Rules 3 and 4 accept the listed edge, so only the baseline can refuse it.
        assert_passes(root.path());
        assert_rule(&baseline(root.path()).0, "[[pending]]", 6);
    }

    #[test]
    fn rule_6_refuses_a_grown_cycle_list() {
        let root = fixture();
        same_owner(root.path());
        publish(root.path());
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        append(root.path(), MANIFEST, &legacy(&["alpha", "beta"]));
        // Rule 5 accepts a member once it is listed, so only the baseline can refuse it.
        assert_passes(root.path());
        assert_rule(&baseline(root.path()).0, "legacy_cycle.members", 6);
    }

    #[test]
    fn rule_6_accepts_a_move_that_keeps_the_count() {
        let root = fixture();
        append(root.path(), BETA, "use crate::alpha::Up;\n");
        append(root.path(), MANIFEST, &pending(BETA, ALPHA));
        append(root.path(), MANIFEST, &legacy(&["alpha", "beta"]));
        publish(root.path());
        let text = std::fs::read_to_string(root.path().join(MANIFEST)).unwrap();
        write(
            root.path(),
            MANIFEST,
            &text.replace("cut = \"a cut\"", "cut = \"another\""),
        );
        let (found, notes) = baseline(root.path());
        assert_eq!(found, Vec::<String>::new());
        assert!(
            notes[0].contains("holds 1 pending and 2 cycle"),
            "{notes:#?}"
        );
    }

    #[test]
    fn rule_6_says_when_it_could_not_run() {
        let root = fixture();
        let (found, notes) = baseline(root.path());
        assert_eq!(found, Vec::<String>::new());
        assert!(notes[0].starts_with("rule 6 not run"), "{notes:#?}");
    }

    #[test]
    fn a_base_with_no_manifest_sets_the_baseline() {
        let root = fixture();
        std::fs::rename(root.path().join(MANIFEST), root.path().join("held.toml")).unwrap();
        publish(root.path());
        std::fs::rename(root.path().join("held.toml"), root.path().join(MANIFEST)).unwrap();
        let (found, notes) = baseline(root.path());
        assert_eq!(found, Vec::<String>::new());
        assert!(notes[0].contains("sets the baseline"), "{notes:#?}");
    }

    #[test]
    fn the_manifest_refuses_what_it_does_not_know() {
        for bad in [
            "spec = \"prismpm/modules/2\"\n",
            "spec = \"prismpm/modules/1\"\nextra = 1\n",
            "spec = \"prismpm/modules/1\"\n[[module]]\nname = \"a\"\n",
            "spec = \"prismpm/modules/1\"\n[[owner]]\npath = \"a\"\nmodule = \"none\"\n",
            "spec = \"prismpm/modules/1\"\n[[pending]]\nfrom = \"a\"\nto = \"b\"\n",
        ] {
            assert!(parse_manifest(bad).is_err(), "{bad}");
        }
    }
}
