//! Generated command-line program for a text application.
//!
//! The program is rendered only from the application's modeled `TextCli`
//! surface, its request and response maximums and its entry root. The bounded,
//! symlink-safe request reader is the raw adapter fragment of
//! `crate::binary_cli`; no Rust here implements dispatch, parsing of requests
//! or formatting of reports.

use crate::binary_cli::INPUT_ADAPTER;
use crate::error::PrismError;
use crate::holo::model_document::TextApplicationModel;
use crate::holo::text_cli::{TextCli, EXAMPLES_COMMAND};
use crate::verification::{executable, run_process};
use prod_codegen::{GeneratedPackage, PackageFile};
use std::collections::BTreeMap;
use std::fmt::Write as _;
use std::path::Path;

pub(crate) mod acceptance;
mod elf;
pub(crate) mod sbom;
#[cfg(test)]
mod tests;

pub(crate) use elf::validate_static_elf;

/// Static release targets built for every text application with a command line.
pub(crate) const TARGETS: [&str; 2] = ["x86_64-unknown-linux-musl", "aarch64-unknown-linux-musl"];

const MAIN: &str = include_str!("text_cli/main.rs.in");

/// Published path of a built program.
pub(crate) fn binary_path(target: &str, application: &TextApplicationModel) -> String {
    format!("cli/bin/{target}/{}", application.cargo_name)
}

fn modeled(application: &TextApplicationModel) -> Result<&TextCli, PrismError> {
    application.cli.as_ref().ok_or_else(|| {
        PrismError::new(
            "PP2009",
            "command-line generation requires a text/3 application",
        )
    })
}

fn entry(application: &TextApplicationModel) -> Result<&str, PrismError> {
    application
        .entry_root
        .rsplit('.')
        .next()
        .filter(|name| !name.is_empty())
        .ok_or_else(|| PrismError::new("PP2001", "application entry root is malformed"))
}

fn paragraph(text: &str) -> &str {
    text.trim_end_matches('\n')
}

/// The complete `--help` text, derived only from model strings and bounds.
pub(crate) fn help(application: &TextApplicationModel, cli: &TextCli) -> String {
    let binary = &application.cargo_name;
    let mut text = format!(
        "{} {}\n\n{}\n\nUSAGE\n    {binary} {} [FILE]\n",
        application.name,
        application.cargo_version,
        paragraph(&cli.description),
        cli.command
    );
    if !cli.examples.is_empty() {
        let _ = writeln!(text, "    {binary} {EXAMPLES_COMMAND} [NAME]");
    }
    let _ = write!(
        text,
        "    {binary} --help\n    {binary} --version\n\nINPUT\n    FILE holds the request and is read as raw bytes, at most {} of them.\n    Without FILE, or when FILE is -, the request is read from standard input.\n    The report is written to standard output unchanged.\n",
        application.request_maximum
    );
    for section in &cli.sections {
        let _ = write!(text, "\n{}\n{}\n", section.title, paragraph(&section.body));
    }
    if !cli.examples.is_empty() {
        text.push_str("\nEXAMPLES\n");
        for example in &cli.examples {
            let _ = writeln!(text, "    {}", example.name);
        }
        let _ = writeln!(text, "    Print one with: {binary} {EXAMPLES_COMMAND} NAME");
    }
    text.push_str("\nEXIT CODES\n");
    let mut rows = cli
        .outcomes
        .iter()
        .map(|outcome| {
            (
                outcome.exit_code,
                outcome.name.as_str(),
                format!("report begins with {:?}", outcome.prefix),
            )
        })
        .collect::<Vec<_>>();
    rows.push((cli.usage_code, "usage", "invalid command line".to_owned()));
    rows.push((cli.io_code, "io", "input or output failure".to_owned()));
    if let Some(code) = cli.limit_code {
        rows.push((
            code,
            "limit",
            format!("request over {} bytes", application.request_maximum),
        ));
    }
    rows.sort();
    let width = rows.iter().map(|row| row.1.len()).max().unwrap_or(0);
    for (code, name, meaning) in rows {
        let _ = writeln!(text, "    {code:>3}  {name:<width$}  {meaning}");
    }
    if cli.limit_code.is_some() {
        text.push_str(
            "    A failed computation and an unclassified report exit with the code of error.\n",
        );
    } else {
        let _ = writeln!(
            text,
            "    A request over {} bytes, a failed computation and an unclassified report\n    exit with the code of error.",
            application.request_maximum
        );
    }
    text
}

fn literal(value: &str) -> String {
    format!("{value:?}")
}

/// Generated constants consumed by the fixed program template.
pub(crate) fn surface(
    application: &TextApplicationModel,
    cli: &TextCli,
) -> Result<String, PrismError> {
    let mut text =
        String::from("// Generated from the modeled text command-line surface. Do not edit.\n\n");
    let _ = writeln!(
        text,
        "pub const BINARY: &str = {};",
        literal(&application.cargo_name)
    );
    let _ = writeln!(text, "pub const COMMAND: &str = {};", literal(&cli.command));
    let _ = writeln!(
        text,
        "pub const VERSION: &str = {};",
        literal(&format!(
            "{} {}\n",
            application.cargo_name, application.cargo_version
        ))
    );
    let _ = writeln!(
        text,
        "pub const HELP: &str = {};",
        literal(&help(application, cli))
    );
    let _ = writeln!(
        text,
        "pub const REQUEST_MAXIMUM: usize = {};",
        application.request_maximum
    );
    let _ = writeln!(
        text,
        "pub const RESPONSE_MAXIMUM: usize = {};",
        application.response_maximum
    );
    let _ = writeln!(text, "pub const USAGE_CODE: u8 = {};", cli.usage_code);
    let _ = writeln!(text, "pub const IO_CODE: u8 = {};", cli.io_code);
    let _ = writeln!(text, "pub const FAULT_CODE: u8 = {};", cli.fault_code());
    let _ = writeln!(text, "pub const LIMIT_CODE: u8 = {};", cli.limit_code());
    text.push_str("pub const OUTCOMES: &[(&str, u8)] = &[\n");
    for outcome in &cli.outcomes {
        let _ = writeln!(
            text,
            "    ({}, {}),",
            literal(&outcome.prefix),
            outcome.exit_code
        );
    }
    text.push_str("];\npub const EXAMPLES: &[(&str, &str)] = &[\n");
    for example in &cli.examples {
        let _ = writeln!(
            text,
            "    ({}, {}),",
            literal(&example.name),
            literal(&example.text)
        );
    }
    text.push_str("];\n");
    Ok(text)
}

/// Render the Cargo package of the program: manifest, fixed template and surface.
pub(crate) fn generate(application: &TextApplicationModel) -> Result<GeneratedPackage, PrismError> {
    let cli = modeled(application)?;
    let core = application.cargo_name.replace('-', "_");
    let manifest = format!(
        "[package]\nname = \"{name}-cli\"\nversion = \"{version}\"\nedition = \"2021\"\npublish = false\n\n[[bin]]\nname = \"{name}\"\npath = \"src/main.rs\"\n\n[dependencies]\n{name} = {{ version = \"={version}\", default-features = false, features = [\"std\"] }}\n\n[profile.release]\nopt-level = 3\nlto = true\ncodegen-units = 1\nstrip = true\npanic = \"abort\"\n",
        name = application.cargo_name,
        version = application.cargo_version,
    );
    let source = MAIN
        .replace("@INPUT_ADAPTER@", INPUT_ADAPTER)
        .replace("@CORE@", &core)
        .replace("@ENTRY@", entry(application)?);
    Ok(GeneratedPackage {
        files: vec![
            PackageFile {
                path: "Cargo.toml".into(),
                bytes: manifest.into_bytes(),
            },
            PackageFile {
                path: "src/main.rs".into(),
                bytes: source.into_bytes(),
            },
            PackageFile {
                path: "src/surface.rs".into(),
                bytes: surface(application, cli)?.into_bytes(),
            },
        ],
    })
}

/// The generated package, its resolved lock and one static program per target.
pub(crate) struct BuiltCli {
    pub(crate) package: GeneratedPackage,
    pub(crate) lock: Vec<u8>,
    /// `(target, program bytes)` in `TARGETS` order.
    pub(crate) binaries: Vec<(&'static str, Vec<u8>)>,
}

fn linker_variable(target: &str) -> String {
    format!(
        "CARGO_TARGET_{}_LINKER",
        target.to_ascii_uppercase().replace('-', "_")
    )
}

/// Build the program for every registered musl target from the offline
/// registry named by `environment`. The self-contained `rust-lld` linker keeps
/// the result independent of the host C toolchain, and the locked, offline,
/// path-remapped release profile keeps it reproducible.
pub(crate) fn build(
    application: &TextApplicationModel,
    workspace: &Path,
    environment: &BTreeMap<String, String>,
    replacements: &[(&Path, &str)],
) -> Result<BuiltCli, PrismError> {
    let package = generate(application)?;
    let cargo = executable("cargo")?;
    let root = workspace.join("text-cli");
    crate::application_build::publish_package(&root, &package)?;
    run_process(
        "text-cli-lock",
        &cargo,
        &["generate-lockfile".to_owned(), "--offline".to_owned()],
        &root,
        environment,
        replacements,
        "PP4102",
    )?;
    let lock = std::fs::read(root.join("Cargo.lock"))
        .map_err(|error| PrismError::new("PP4102", format!("command-line lock: {error}")))?;
    let mut binaries = Vec::new();
    for target in TARGETS {
        let mut environment = environment.clone();
        environment.insert(linker_variable(target), "rust-lld".to_owned());
        run_process(
            "text-cli-build",
            &cargo,
            &[
                "build".to_owned(),
                "--release".to_owned(),
                "--locked".to_owned(),
                "--offline".to_owned(),
                "--target".to_owned(),
                target.to_owned(),
            ],
            &root,
            &environment,
            replacements,
            "PP4102",
        )?;
        let program = root
            .join("target")
            .join(target)
            .join("release")
            .join(&application.cargo_name);
        let bytes = std::fs::read(&program).map_err(|error| {
            PrismError::new("PP4102", format!("{}: {error}", program.display()))
        })?;
        validate_static_elf(&bytes, target)?;
        binaries.push((target, bytes));
    }
    Ok(BuiltCli {
        package,
        lock,
        binaries,
    })
}

/// Published artifacts of a built program, in no particular order.
pub(crate) fn artifacts(
    application: &TextApplicationModel,
    built: BuiltCli,
) -> Result<Vec<(String, Vec<u8>)>, PrismError> {
    let mut rows = vec![
        (sbom::SBOM_PATH.to_owned(), sbom::sbom(application, &built)?),
        ("cli/Cargo.lock".to_owned(), built.lock),
    ];
    rows.extend(
        built
            .package
            .files
            .into_iter()
            .map(|file| (format!("cli/package/{}", file.path), file.bytes)),
    );
    rows.extend(
        built
            .binaries
            .into_iter()
            .map(|(target, bytes)| (binary_path(target, application), bytes)),
    );
    Ok(rows)
}
