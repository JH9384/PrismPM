//! Verification harness only; every branch invokes actual generated source.
use browser_semantic_presentation_core_probe::{
    fixtureDesignsBytes, fixtureLabelsBytes, fixturePredicatesBytes, fixturePresentationBytes,
    semanticWireBytes,
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
    if args.len() == 3 && args[0] == "--binary" {
        let input = fs::read(&args[1])?;
        let expected = fs::read(&args[2])?;
        for _ in 0..2 {
            let actual = semanticWireBytes(input.clone()).map_err(|error| format!("{error:?}"))?;
            assert!(actual == expected, "binary native output mismatch");
        }
        println!("PASS binary complete semantic vector twice");
        return Ok(());
    }
    if args.len() != 1 {
        return Err("one complete corpus".into());
    }
    let mut count = 0;
    for line in fs::read_to_string(&args[0])?.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 3 {
            return Err("closed corpus".into());
        }
        let input = unhex(fields[1])?;
        let expected = unhex(fields[2])?;
        for _ in 0..2 {
            let actual = if fields[0].starts_with("Predicate") {
                fixturePredicatesBytes(input.clone())
            } else if fields[0].starts_with("Fixture") {
                fixturePresentationBytes(input.clone())
            } else if fields[0].starts_with("Labels") {
                Ok(fixtureLabelsBytes(input.clone()))
            } else if fields[0].starts_with("Designs") {
                fixtureDesignsBytes(input.clone())
            } else {
                semanticWireBytes(input.clone())
            }
            .map_err(|error| format!("{}: {error:?}", fields[0]))?;
            assert!(actual == expected, "{} native output mismatch", fields[0]);
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} complete semantic vectors twice");
    Ok(())
}
