use browser_session_operation_core_probe::{
    operationDescriptorBytes, operationObservationBytes, operationPartitionBytes,
    operationPredecessorBytes, operationSessionBytes,
};
use std::{error::Error, fs, io::Read};

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
    if arguments.first().map(String::as_str) == Some("transcript") {
        if arguments.len() != 2 || fs::metadata(&arguments[1])?.len() > 9_437_184 {
            return Err("closed bounded transcript arguments".into());
        }
        let mut transcript = String::new();
        fs::File::open(&arguments[1])?
            .take(9_437_185)
            .read_to_string(&mut transcript)?;
        if transcript.len() > 9_437_184 || (!transcript.is_empty() && !transcript.ends_with('\n')) {
            return Err("canonical bounded transcript".into());
        }
        let mut previous = None;
        let mut count = 0;
        for line in transcript.split_terminator('\n') {
            let fields = line.split('\t').collect::<Vec<_>>();
            if fields.len() != 4 {
                return Err("closed transcript fields".into());
            }
            let index = fields[0].parse::<u64>()?;
            if index.to_string() != fields[0]
                || index > 9_007_199_254_740_991
                || previous.is_some_and(|value: u64| value.checked_add(1) != Some(index))
            {
                return Err("canonical ordered transcript index".into());
            }
            for field in &fields[2..] {
                if field.len() % 2 != 0
                    || !field
                        .bytes()
                        .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
                {
                    return Err("canonical transcript hex".into());
                }
            }
            let call = match fields[1] {
                "predecessor" => operationPredecessorBytes,
                "session" => operationSessionBytes,
                "observation" => operationObservationBytes,
                "partition" => operationPartitionBytes,
                "descriptor" => operationDescriptorBytes,
                _ => return Err("closed transcript entry".into()),
            };
            let input = unhex(fields[2])?;
            let expected = unhex(fields[3])?;
            for _ in 0..2 {
                assert!(
                    call(input.clone()).map_err(|error| format!("{error:?}"))? == expected,
                    "transcript {index} {} native output mismatch",
                    fields[1]
                );
            }
            println!("PASS transcript {index} {}", fields[1]);
            previous = Some(index);
            count += 1;
        }
        if count == 0 {
            return Err("nonempty transcript".into());
        }
        println!("PASS {count} operation transcript vectors twice");
        return Ok(());
    }
    if arguments.len() < 2
        || ![
            "predecessor",
            "session",
            "observation",
            "partition",
            "descriptor",
        ]
        .contains(&arguments[0].as_str())
    {
        return Err("closed entry and corpus or binary input/expected".into());
    }
    let call = match arguments[0].as_str() {
        "predecessor" => operationPredecessorBytes,
        "session" => operationSessionBytes,
        "observation" => operationObservationBytes,
        "partition" => operationPartitionBytes,
        "descriptor" => operationDescriptorBytes,
        _ => unreachable!(),
    };
    if arguments.len() == 3 {
        let input = fs::read(&arguments[1])?;
        let expected = fs::read(&arguments[2])?;
        for _ in 0..2 {
            assert!(
                call(input.clone()).map_err(|error| format!("{error:?}"))? == expected,
                "binary native output mismatch"
            );
        }
        println!("PASS binary operation component twice");
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
    println!("PASS {count} operation component vectors twice");
    Ok(())
}
