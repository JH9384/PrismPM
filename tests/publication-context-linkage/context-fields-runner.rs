use publication_context_linkage_core_probe::{
    publicationContextFieldsPreimage, publicationContextFieldsWireBytes, publicationWireBytes,
    readPublicationContextFields, PublicationWireInput,
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
    if args.len() != 1 {
        return Err("one complete six-field corpus".into());
    }
    let mut count = 0;
    for line in fs::read_to_string(&args[0])?.lines() {
        let columns = line.split('\t').collect::<Vec<_>>();
        if columns.len() != 5 {
            return Err("closed six-field corpus".into());
        }
        let input = unhex(columns[1])?;
        let expected = unhex(columns[2])?;
        for _ in 0..2 {
            let actual = publicationContextFieldsWireBytes(input.clone())
                .map_err(|e| format!("{}: {e:?}", columns[0]))?;
            assert_eq!(actual, expected, "{} six-field bytes", columns[0]);
            if columns[3] != "-" {
                let admission = publicationWireBytes(unhex(columns[3])?)
                    .map_err(|e| format!("{}: {e:?}", columns[0]))?;
                assert_eq!(admission, expected, "{} unchanged opcode four", columns[0]);
                let decoded = readPublicationContextFields(
                    &PublicationWireInput {
                        bytes: input.clone(),
                    },
                    3,
                )
                .map_err(|e| format!("{e:?}"))?
                .map_err(|e| format!("{e:?}"))?;
                assert_eq!(decoded.cursor as usize, input.len());
                let fields = decoded.value;
                let typed = publicationContextFieldsPreimage(
                    &fields.declaration,
                    fields.declarationIdentity,
                    &fields.subject,
                    fields.instance,
                    fields.publisherRevision,
                    fields.publisherRef,
                )
                .map_err(|e| format!("{e:?}"))?
                .map_err(|e| format!("{e:?}"))?;
                assert_eq!(typed, unhex(columns[4])?, "{} typed preimage", columns[0]);
            }
        }
        println!("PASS {}", columns[0]);
        count += 1;
    }
    println!("PASS {count} complete six-field vectors twice");
    Ok(())
}
