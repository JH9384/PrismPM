use browser_signed_context_core_probe::signedContextWireBytes;
use std::{error::Error, fs};

fn unhex(text: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    if text.len() % 2 != 0 {
        return Err("odd hex".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|index| u8::from_str_radix(&text[index..index + 2], 16).map_err(Into::into))
        .collect()
}
fn main() -> Result<(), Box<dyn Error>> {
    let arguments = std::env::args().skip(1).collect::<Vec<_>>();
    if arguments.len() < 2 || !["signed-context"].contains(&arguments[0].as_str()) {
        return Err("closed entry and corpus or binary input/expected".into());
    }
    let call = signedContextWireBytes;
    if arguments.len() == 3 {
        let input = fs::read(&arguments[1])?;
        let expected = fs::read(&arguments[2])?;
        for _ in 0..2 {
            assert!(
                call(input.clone()).map_err(|error| format!("{error:?}"))? == expected,
                "binary native output mismatch"
            );
        }
        println!("PASS binary signed context twice");
        return Ok(());
    }
    if arguments.len() != 2 {
        return Err("closed argument count".into());
    }
    let mut count = 0;
    for line in fs::read_to_string(&arguments[1])?.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err("closed corpus".into());
        }
        let input = unhex(fields[1])?;
        let expected = unhex(fields[2])?;
        for _ in 0..2 {
            assert!(
                call(input.clone()).map_err(|error| format!("{error:?}"))? == expected,
                "{} native output mismatch",
                fields[0]
            );
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} signed context vectors twice");
    Ok(())
}
