//! Independent exhaustive UInt64 word and repeated-index oracle.
use publication_context_linkage_core_probe::*;

fn empty() -> PublicationBitMarks {
    PublicationBitMarks {
        word0: 0,
        word1: 0,
        word2: 0,
        word3: 0,
    }
}

fn words(marks: PublicationBitMarks) -> [u64; 4] {
    [marks.word0, marks.word1, marks.word2, marks.word3]
}

pub fn verify() {
    let mut checks = 0;
    for _ in 0..2 {
        for offset in 0..256 {
            let actual = publicationLinkageBitMark(empty(), offset).unwrap();
            let mut expected = [0; 4];
            expected[(offset / 64) as usize] = 1_u64 << (offset % 64);
            assert_eq!(words(actual), expected);
            checks += 1;
            for following in 0..256 {
                let marked = publicationLinkageBitMark(empty(), offset).unwrap();
                let actual = publicationLinkageBitMark(marked, following);
                if following == offset {
                    assert!(actual.is_none());
                } else {
                    let mut pair = expected;
                    pair[(following / 64) as usize] |= 1_u64 << (following % 64);
                    assert_eq!(words(actual.unwrap()), pair);
                }
                checks += 1;
            }
        }
        for invalid in [256, 257, 65536, u64::MAX] {
            assert!(publicationLinkageBitMark(empty(), invalid).is_none());
            checks += 1;
        }
    }
    assert_eq!(checks, 131592);
    println!("PASS 131592 independent bit-mask and repeated-index witnesses");
}
