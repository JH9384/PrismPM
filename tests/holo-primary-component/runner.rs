//! File/hex adaptation only. Every codec and Session operation is generated.
use holo_primary_component_core_probe::*;
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

fn generated(operation: &str, values: &[Vec<u8>]) -> Result<Option<Vec<u8>>, Box<dyn Error>> {
    let val = |index: usize| values[index].clone();
    macro_rules! call {
        ($expression:expr) => {
            $expression.map_err(|error| format!("generated operation: {error:?}"))?
        };
    }
    let output = match (operation, values.len()) {
        ("session", 1) => Some(call!(sourceSessionWireBytes(val(0)))),
        ("capabilities", 0) => Some(emptyCapabilities()),
        ("blob", 2) => contentBlob(val(0), val(1)),
        ("manifest", 2) => primaryAppManifest(val(0), val(1)),
        ("body", 7) => call!(primaryArchiveBody(
            val(0),
            val(1),
            val(2),
            val(3),
            val(4),
            val(5),
            val(6)
        )),
        ("frame", 2) => call!(primaryFrameArchive(val(0), val(1))),
        ("body-bytes", 1) => call!(primaryArchiveBodyBytes(val(0))),
        ("footer", 1) => call!(primaryArchiveFooter(val(0))),
        ("valid-manifest", 1) => Some(vec![u8::from(primaryValidAppManifest(&val(0)))]),
        ("valid-body", 1) => Some(vec![u8::from(call!(primaryValidArchiveBody(&val(0))))]),
        ("valid-frame", 1) => Some(vec![u8::from(call!(primaryValidArchiveFrame(&val(0))))]),
        ("reference", 2) | ("section", 2) | ("extension", 2) => {
            let index: u64 = std::str::from_utf8(&values[1])?.parse()?;
            match operation {
                "reference" => call!(primaryManifestReference(val(0), index)),
                "section" => call!(primaryArchiveSection(val(0), index)),
                _ => call!(primaryArchiveExtension(val(0), index)),
            }
        }
        _ => return Err("unknown operation or wrong arity".into()),
    };
    Ok(output)
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() < 2 {
        return Err("closed operation and inputs required".into());
    }
    if ["session-corpus", "codec-corpus"].contains(&args[0].as_str()) && args.len() == 2 {
        let mut count = 0;
        for line in fs::read_to_string(&args[1])?.lines() {
            let fields = line.split('\t').collect::<Vec<_>>();
            let (operation, values, expected) = if args[0] == "session-corpus" {
                if fields.len() != 3 {
                    return Err("closed session corpus".into());
                }
                ("session", vec![unhex(fields[1])?], Some(unhex(fields[2])?))
            } else {
                if fields.len() < 3 {
                    return Err("closed codec corpus".into());
                }
                (
                    fields[1],
                    fields[3..]
                        .iter()
                        .map(|field| unhex(field))
                        .collect::<Result<Vec<_>, _>>()?,
                    if fields[2] == "-" {
                        None
                    } else {
                        Some(unhex(fields[2])?)
                    },
                )
            };
            for _ in 0..2 {
                assert_eq!(generated(operation, &values)?, expected, "{}", fields[0]);
            }
            println!("PASS {}", fields[0]);
            count += 1;
        }
        println!("PASS {count} {} vectors twice", args[0]);
        return Ok(());
    }
    let values = args[2..]
        .iter()
        .map(fs::read)
        .collect::<Result<Vec<_>, _>>()?;
    match generated(&args[0], &values)? {
        Some(bytes) => {
            fs::write(&args[1], bytes)?;
            println!("SOME");
        }
        None => println!("NONE"),
    }
    Ok(())
}
