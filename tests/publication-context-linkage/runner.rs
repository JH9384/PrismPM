use publication_context_linkage_core_probe::publicationLinkageWireBytes;
use std::{error::Error, fs};

mod bitset_witnesses;
mod collector_witnesses;
mod partition_witnesses;
mod payload_witnesses;

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
    if args.as_slice() == ["--semantic-witnesses"] {
        collector_witnesses::verify();
        bitset_witnesses::verify();
        partition_witnesses::verify();
        payload_witnesses::verify();
        println!("PASS four complete independent semantic witness groups");
        return Ok(());
    }
    if args.len() == 3 && args[0] == "--binary" {
        let input = fs::read(&args[1])?;
        let expected = fs::read(&args[2])?;
        for _ in 0..2 {
            let actual =
                publicationLinkageWireBytes(input.clone()).map_err(|error| format!("{error:?}"))?;
            assert!(actual == expected, "binary native output mismatch");
        }
        println!("PASS binary complete publication linkage vector twice");
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
            let actual = publicationLinkageWireBytes(input.clone())
                .map_err(|error| format!("{}: {error:?}", fields[0]))?;
            assert!(actual == expected, "{} native output mismatch", fields[0]);
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} complete publication linkage vectors twice");
    Ok(())
}
