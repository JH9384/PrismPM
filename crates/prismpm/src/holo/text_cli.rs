//! Closed command-line surface of a text application (text/3).
//!
//! The surface is source-owned data: the command name, the help text, the
//! named example scripts and the exit-code map. Nothing here executes the
//! application; `crate::text_cli` renders these records into the generated
//! program and `crate::verification` replays the same classification.

use super::application::{field, optional_unsigned, record, string, unsigned, Definitions};
use super::model_document::TextApplicationModel;
use crate::error::PrismError;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::{BTreeMap, BTreeSet};

/// Largest exit status a program may declare. 126 and above are reserved by
/// shells and signal conventions.
pub const MAXIMUM_EXIT_CODE: u8 = 125;
/// Name that every exit-code map must declare; adapter faults exit with it.
pub const FAULT_OUTCOME: &str = "error";
/// Reserved subcommand that prints the named examples.
pub const EXAMPLES_COMMAND: &str = "examples";

const MAXIMUM_OUTCOMES: usize = 16;
const MAXIMUM_SECTIONS: usize = 32;
const MAXIMUM_EXAMPLES: usize = 64;
const MAXIMUM_PREFIX_BYTES: usize = 256;
const MAXIMUM_TEXT_BYTES: usize = 16 * 1024;
const MAXIMUM_SURFACE_BYTES: usize = 256 * 1024;

/// One report class and the exit status the program returns for it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextCliOutcome {
    /// Stable lowercase name shown in the exit-code table.
    pub name: String,
    /// Bytes that begin every report of this class.
    pub prefix: String,
    /// Exit status for this class.
    pub exit_code: u8,
}

/// A titled block of help text.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextCliSection {
    /// Single-line heading.
    pub title: String,
    /// Block text, printed unchanged.
    pub body: String,
}

/// A named request script printed by the `examples` subcommand.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextCliExample {
    /// Stable lowercase name used as the subcommand argument.
    pub name: String,
    /// Request bytes, printed unchanged.
    pub text: String,
}

/// The complete modeled command-line surface.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextCli {
    /// Subcommand that reads a request and prints the report.
    pub command: String,
    /// Purpose paragraph printed first by `--help`.
    pub description: String,
    /// Exit status for every usage failure.
    pub usage_code: u8,
    /// Exit status for every input or output failure.
    pub io_code: u8,
    /// Exit status for a request refused because it exceeds the request
    /// maximum (`InputLimit`). Absent, the refusal exits with the code of the
    /// `error` outcome.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub limit_code: Option<u8>,
    /// Report classes in declaration order.
    pub outcomes: Vec<TextCliOutcome>,
    /// Help sections in declaration order.
    pub sections: Vec<TextCliSection>,
    /// Named example scripts in declaration order.
    pub examples: Vec<TextCliExample>,
}

impl TextCli {
    /// The class whose prefix begins the report, if any. Validation makes the
    /// prefixes prefix-free, so at most one class can match.
    pub fn classify(&self, report: &[u8]) -> Option<&TextCliOutcome> {
        self.outcomes
            .iter()
            .find(|outcome| report.starts_with(outcome.prefix.as_bytes()))
    }

    /// Exit status for adapter faults and unclassified reports.
    pub fn fault_code(&self) -> u8 {
        self.outcomes
            .iter()
            .find(|outcome| outcome.name == FAULT_OUTCOME)
            .map_or(self.usage_code, |outcome| outcome.exit_code)
    }

    /// Exit status for a request over the request maximum: the declared
    /// `limit_code`, or the fault code when none is declared.
    pub fn limit_code(&self) -> u8 {
        self.limit_code.unwrap_or_else(|| self.fault_code())
    }
}

fn invalid(message: &str) -> PrismError {
    PrismError::new("PP2009", message)
}

fn token(value: &str) -> bool {
    (1..=32).contains(&value.len())
        && value.as_bytes()[0].is_ascii_lowercase()
        && value
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
        && !value.ends_with('-')
}

fn block(value: &str) -> bool {
    !value.trim().is_empty()
        && value.len() <= MAXIMUM_TEXT_BYTES
        && value
            .chars()
            .all(|character| character == '\n' || !character.is_control())
}

fn line(value: &str) -> bool {
    block(value) && !value.contains('\n')
}

fn exit_code(fields: &BTreeMap<&str, (&str, &Value)>, name: &str) -> Result<u8, PrismError> {
    u8::try_from(unsigned(fields, name, "uint8")?)
        .map_err(|_| PrismError::new("PP2001", format!("application field {name} exceeds UInt8")))
}

fn rows<T>(
    definitions: &Definitions<'_>,
    fields: &BTreeMap<&str, (&str, &Value)>,
    name: &str,
    build: impl Fn(&BTreeMap<&str, (&str, &Value)>) -> Result<T, PrismError>,
) -> Result<Vec<T>, PrismError> {
    let (module, mut value) = field(fields, name)?;
    let mut result = Vec::new();
    loop {
        match value.get("kind").and_then(Value::as_str) {
            Some("nil") => return Ok(result),
            Some("cons") => {
                let head = value
                    .get("head")
                    .ok_or_else(|| PrismError::new("PP2001", "command-line list has no head"))?;
                result.push(build(&record(definitions, module, head)?)?);
                value = value
                    .get("tail")
                    .ok_or_else(|| PrismError::new("PP2001", "command-line list has no tail"))?;
            }
            _ => {
                return Err(PrismError::new(
                    "PP2001",
                    format!("application field {name} is not a closed list"),
                ))
            }
        }
    }
}

/// Project the `cli` field of a text/3 application record.
pub(super) fn project(
    definitions: &Definitions<'_>,
    fields: &BTreeMap<&str, (&str, &Value)>,
) -> Result<TextCli, PrismError> {
    let (module, value) = field(fields, "cli")?;
    let values = record(definitions, module, value)?;
    super::application::exact_fields(
        &values,
        &[
            "command",
            "description",
            "usageCode",
            "ioCode",
            "limitCode",
            "outcomes",
            "sections",
            "examples",
        ],
    )?;
    Ok(TextCli {
        command: string(&values, "command")?,
        description: string(&values, "description")?,
        usage_code: exit_code(&values, "usageCode")?,
        io_code: exit_code(&values, "ioCode")?,
        limit_code: optional_unsigned(definitions, &values, "limitCode", "uint8")?
            .map(|code| {
                u8::try_from(code).map_err(|_| {
                    PrismError::new("PP2001", "application field limitCode exceeds UInt8")
                })
            })
            .transpose()?,
        outcomes: rows(definitions, &values, "outcomes", |row| {
            super::application::exact_fields(row, &["name", "prefix", "exitCode"])?;
            Ok(TextCliOutcome {
                name: string(row, "name")?,
                prefix: string(row, "prefix")?,
                exit_code: exit_code(row, "exitCode")?,
            })
        })?,
        sections: rows(definitions, &values, "sections", |row| {
            super::application::exact_fields(row, &["title", "body"])?;
            Ok(TextCliSection {
                title: string(row, "title")?,
                body: string(row, "body")?,
            })
        })?,
        examples: rows(definitions, &values, "examples", |row| {
            super::application::exact_fields(row, &["name", "text"])?;
            Ok(TextCliExample {
                name: string(row, "name")?,
                text: string(row, "text")?,
            })
        })?,
    })
}

/// Whether a request is framed for the application's text/3 workbench.
pub(crate) fn workbench_frame(application: &TextApplicationModel, request: &[u8]) -> bool {
    application
        .workbench
        .as_ref()
        .is_some_and(|view| view.frames(request))
}

/// Validate the closed surface against its application: tokens, bounded text,
/// a closed and unambiguous exit-code map, and a classified response for
/// every acceptance vector.
pub fn validate(cli: &TextCli, application: &TextApplicationModel) -> Result<(), PrismError> {
    if !token(&cli.command) || cli.command == EXAMPLES_COMMAND {
        return Err(invalid(
            "text command-line subcommand must be a lowercase token other than examples",
        ));
    }
    if !block(&cli.description) {
        return Err(invalid(
            "text command-line description must be bounded text without control characters",
        ));
    }
    if cli.outcomes.is_empty()
        || cli.outcomes.len() > MAXIMUM_OUTCOMES
        || cli.sections.len() > MAXIMUM_SECTIONS
        || cli.examples.len() > MAXIMUM_EXAMPLES
    {
        return Err(invalid(
            "text command-line outcomes, sections or examples exceed their closed bounds",
        ));
    }
    let mut names = BTreeSet::new();
    let mut codes = BTreeSet::from([cli.usage_code]);
    if cli.usage_code == cli.io_code || !codes.insert(cli.io_code) {
        return Err(invalid(
            "text command-line usage and I/O exit codes must differ",
        ));
    }
    for outcome in &cli.outcomes {
        if !token(&outcome.name)
            || !names.insert(outcome.name.as_str())
            || outcome.prefix.is_empty()
            || outcome.prefix.len() > MAXIMUM_PREFIX_BYTES
            || outcome.prefix.contains('\0')
            || !codes.insert(outcome.exit_code)
        {
            return Err(invalid(
                "text command-line outcomes need unique tokens, nonempty prefixes and unique exit codes",
            ));
        }
    }
    if cli.limit_code.is_some_and(|code| !codes.insert(code)) {
        return Err(invalid(
            "a declared text command-line limit code must differ from every other exit code",
        ));
    }
    if !names.contains(FAULT_OUTCOME) {
        return Err(invalid(
            "text command-line exit-code map must declare the error outcome",
        ));
    }
    if codes.iter().any(|code| *code > MAXIMUM_EXIT_CODE) {
        return Err(invalid("text command-line exit codes must not exceed 125"));
    }
    for (index, outcome) in cli.outcomes.iter().enumerate() {
        if cli.outcomes.iter().enumerate().any(|(other, row)| {
            index != other && row.prefix.as_bytes().starts_with(outcome.prefix.as_bytes())
        }) {
            return Err(invalid(
                "text command-line outcome prefixes must not begin one another",
            ));
        }
    }
    let mut titles = BTreeSet::new();
    let mut total = cli.description.len();
    for section in &cli.sections {
        total += section.title.len() + section.body.len();
        if !line(&section.title) || !block(&section.body) || !titles.insert(&section.title) {
            return Err(invalid(
                "text command-line sections need unique single-line titles and bounded bodies",
            ));
        }
    }
    let mut examples = BTreeSet::new();
    for example in &cli.examples {
        total += example.name.len() + example.text.len();
        if !token(&example.name)
            || !examples.insert(&example.name)
            || example.text.is_empty()
            || example.text.len() > MAXIMUM_TEXT_BYTES
            || example.text.contains('\0')
        {
            return Err(invalid(
                "text command-line examples need unique tokens and bounded nonempty text",
            ));
        }
    }
    if total > MAXIMUM_SURFACE_BYTES {
        return Err(invalid("text command-line surface exceeds its byte budget"));
    }
    // A text/3 workbench binds its framed vectors to its JSON result protocol,
    // which the program refuses as `ReportUnclassified`; every other response
    // must begin with a declared outcome prefix.
    if application.acceptance_vectors.iter().any(|vector| {
        cli.classify(&vector.response).is_none() && !workbench_frame(application, &vector.request)
    }) {
        return Err(invalid(
            "every acceptance response must begin with a declared command-line outcome prefix",
        ));
    }
    Ok(())
}
