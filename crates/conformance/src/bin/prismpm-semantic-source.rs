//! Internal tool that gives the Node evidence scripts one reader and writer
//! for the semantic module of a LexLean source, whichever surface it uses.
//!
//! * `read`: source text on stdin, the module as JSON on stdout.
//! * `write`: a JSON object `{"source": text, "value": module}` on stdin, the
//!   source with its module replaced (same surface) on stdout.
//! * `to-notation`: data-form source text on stdin, language-1.2 notation on
//!   stdout.

use std::io::{Read, Write};
use std::process::ExitCode;

fn run(command: &str, input: &str) -> Result<String, String> {
    match command {
        "read" => {
            let module = lexlean::sdk::read_module(input).map_err(|error| error.to_string())?;
            serde_json::to_string(&module).map_err(|error| error.to_string())
        }
        "write" => {
            let request: serde_json::Value =
                serde_json::from_str(input).map_err(|error| error.to_string())?;
            let source = request["source"]
                .as_str()
                .ok_or("write: `source` must be a string")?;
            lexlean::sdk::write_module(source, &request["value"]).map_err(|error| error.to_string())
        }
        "to-notation" => lexlean::sdk::to_notation(input).map_err(|error| error.to_string()),
        other => Err(format!(
            "unknown command `{other}`; expected read, write, or to-notation"
        )),
    }
}

fn main() -> ExitCode {
    let Some(command) = std::env::args().nth(1) else {
        eprintln!("usage: prismpm-semantic-source read|write|to-notation < input");
        return ExitCode::from(2);
    };
    let mut input = String::new();
    if let Err(error) = std::io::stdin().read_to_string(&mut input) {
        eprintln!("prismpm-semantic-source: stdin: {error}");
        return ExitCode::FAILURE;
    }
    match run(&command, &input) {
        Ok(output) => match std::io::stdout().write_all(output.as_bytes()) {
            Ok(()) => ExitCode::SUCCESS,
            Err(error) => {
                eprintln!("prismpm-semantic-source: stdout: {error}");
                ExitCode::FAILURE
            }
        },
        Err(message) => {
            eprintln!("prismpm-semantic-source: {message}");
            ExitCode::FAILURE
        }
    }
}
