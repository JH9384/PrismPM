use browser_pkce_core_probe::pkceWireBytes;
use std::{error::Error, fs};

fn bytes(text: &str) -> Result<Vec<u8>, Box<dyn Error>> {
    if text.len() % 2 != 0
        || !text
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
    {
        return Err("canonical hex required".into());
    }
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).map_err(Into::into))
        .collect()
}

fn main() -> Result<(), Box<dyn Error>> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    if args.len() != 1 || fs::metadata(&args[0])?.len() > 32_000_000 {
        return Err("one bounded corpus required".into());
    }
    let corpus = fs::read_to_string(&args[0])?;
    if corpus.is_empty() || !corpus.ends_with('\n') {
        return Err("nonempty complete corpus required".into());
    }
    let mut count = 0;
    for line in corpus.split_terminator('\n') {
        let fields = line.split('\t').collect::<Vec<_>>();
        if fields.len() != 3 || fields[0].is_empty() {
            return Err("closed corpus row".into());
        }
        let input = bytes(fields[1])?;
        let expected = bytes(fields[2])?;
        for _ in 0..2 {
            assert_eq!(
                pkceWireBytes(input.clone()).map_err(|e| format!("{e:?}"))?,
                expected,
                "{} native output mismatch",
                fields[0]
            );
        }
        println!("PASS {}", fields[0]);
        count += 1;
    }
    println!("PASS {count} PKCE vectors twice");
    Ok(())
}
