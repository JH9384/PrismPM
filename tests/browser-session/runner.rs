use browser_session_core_probe::{
    fixtureSourceDispatchBytes, fixtureSourceSizeBytes, sourceSessionWireBytes,
};
use std::{error::Error, fs};

fn unhex(text: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    if text.len() % 2 != 0 {
        return Err("odd hex".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).map_err(Into::into))
        .collect()
}
fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() == 3 && ["--binary", "--size-binary"].contains(&args[0].as_str()) {
        let input = fs::read(&args[1])?;
        let expected = fs::read(&args[2])?;
        for _ in 0..2 {
            let actual = (if args[0] == "--size-binary" {
                fixtureSourceSizeBytes
            } else {
                sourceSessionWireBytes
            })(input.clone())
            .map_err(|error| format!("{error:?}"))?;
            assert!(actual == expected, "binary native output mismatch");
        }
        println!("PASS binary complete session vector twice");
        return Ok(());
    }
    let fixture = args.len() == 2 && args[0] == "--fixture";
    let size = args.len() == 2 && args[0] == "--size";
    if args.len() != 1 && !fixture && !size {
        return Err("one complete corpus".into());
    }
    let mut count = 0;
    for line in fs::read_to_string(&args[usize::from(fixture || size)])?.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err("closed corpus".into());
        }
        let input = unhex(fields[1])?;
        let expected = unhex(fields[2])?;
        for _ in 0..2 {
            let actual = (if fixture {
                fixtureSourceDispatchBytes
            } else if size {
                fixtureSourceSizeBytes
            } else {
                sourceSessionWireBytes
            })(input.clone())
            .map_err(|error| format!("{}: {error:?}", fields[0]))?;
            assert!(actual == expected, "{} native output mismatch", fields[0]);
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} complete session vectors twice");
    Ok(())
}
