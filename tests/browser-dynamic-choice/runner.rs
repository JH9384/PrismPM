//! Test observer only: exact input bytes invoke generated roots twice.
use browser_dynamic_choice_core_probe::{
    fixtureCatalogueBytes, fixtureDesignsBytes, fixtureIntentBytes, fixtureLabelsBytes,
    fixturePresentationBytes, fixtureSizeBytes, semanticWireBytes, viewWireBytes,
};
use std::{error::Error, fs};

fn invoke(role: &str, input: Vec<u8>) -> Result<Vec<u8>, Box<dyn Error>> {
    let result = match role {
        "wire" => viewWireBytes(input),
        "semantic" => semanticWireBytes(input),
        "fixture" => fixturePresentationBytes(input),
        "labels" => Ok(fixtureLabelsBytes(input)),
        "designs" => fixtureDesignsBytes(input),
        "intent" => fixtureIntentBytes(input),
        "catalogue" => fixtureCatalogueBytes(input),
        "size" => fixtureSizeBytes(input),
        _ => return Err("unknown generated role".into()),
    };
    result.map_err(|error| format!("{error:?}").into())
}

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
    if let [mode, role, input, output] = args.as_slice() {
        if mode != "--binary" {
            return Err("closed binary mode".into());
        }
        let (input, expected) = (fs::read(input)?, fs::read(output)?);
        for _ in 0..2 {
            assert!(
                invoke(role, input.clone())? == expected,
                "binary native output mismatch"
            );
        }
        println!("PASS binary dynamic choice vector twice");
        return Ok(());
    }
    if args.len() != 1 {
        return Err("one complete corpus".into());
    }
    let mut count = 0;
    for line in fs::read_to_string(&args[0])?.lines() {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 4 {
            return Err("closed corpus row".into());
        }
        let (input, expected) = (unhex(fields[2])?, unhex(fields[3])?);
        for _ in 0..2 {
            assert!(
                invoke(fields[1], input.clone())? == expected,
                "{} native output mismatch",
                fields[0]
            );
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} complete dynamic choice vectors twice");
    Ok(())
}
