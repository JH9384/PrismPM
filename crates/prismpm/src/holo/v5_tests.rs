use super::*;

#[test]
fn kappa_is_the_sha256_label() {
    // FIPS 180-4 / NIST CAVP short-message vector for "abc".
    assert_eq!(
        kappa(b"abc"),
        "sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert!(is_kappa(&kappa(b"")));
    assert!(!is_kappa(
        "blake3:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    ));
    assert!(!is_kappa(
        "sha256:BA7816BF8F01CFEA414140DE5DAE2223B00361A396177A9CB410FF61F20015AD"
    ));
}

#[test]
fn objects_round_trip_in_order_including_empty_ones() {
    let objects: [&[u8]; 4] = [b"manifest", b"", b"\0asm", &[7u8; 300]];
    let archive = write_objects(&objects);
    assert!(archive.starts_with(b"UORC\x02\x01\x00\x00\x04"));
    assert_eq!(read_objects(&archive, APPLICATION_BUDGET).unwrap(), objects);
}

#[test]
fn seal_matches_the_uorc_chain_on_every_tail_length() {
    for length in [0usize, 1, 55, 63, 64, 65, 127, 128, 129] {
        let bytes = vec![0xA5u8; length];
        let archive = write_objects(&[bytes.as_slice()]);
        let (preimage, seal) = archive.split_at(archive.len() - SEAL);
        assert_eq!(chain(preimage), seal);
        assert_eq!(
            read_objects(&archive, APPLICATION_BUDGET).unwrap(),
            [&bytes[..]]
        );
    }
}

#[test]
fn any_flipped_bit_is_refused() {
    let archive = write_objects(&[b"guest".as_slice(), b"view".as_slice()]);
    for index in 0..archive.len() {
        let mut bad = archive.clone();
        bad[index] ^= 1;
        let error = read_objects(&bad, APPLICATION_BUDGET).unwrap_err();
        assert!(
            ["PP3001", "PP3004"].contains(&error.code.as_str()),
            "byte {index}: {error:?}"
        );
    }
}

#[test]
fn malformed_archives_are_typed_refusals() {
    let resealed = |mut preimage: Vec<u8>| {
        let seal = chain(&preimage);
        preimage.extend_from_slice(&seal);
        preimage
    };
    let good = write_objects(&[b"ab".as_slice()]);
    let preimage = good[..good.len() - SEAL].to_vec();

    // A conditional archive (scope 1) is not a holo.
    let mut conditional = preimage.clone();
    conditional[6] = 1;
    assert_eq!(
        read_objects(&resealed(conditional), APPLICATION_BUDGET)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // A trailing body byte the header does not declare.
    let mut trailing = preimage.clone();
    trailing.push(0);
    assert_eq!(
        read_objects(&resealed(trailing), APPLICATION_BUDGET)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // Zero objects.
    let empty = resealed(b"UORC\x02\x01\x00\x00\x00\x00".to_vec());
    assert_eq!(
        read_objects(&empty, APPLICATION_BUDGET)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // A non-shortest ULEB128 length.
    let long = resealed(b"UORC\x02\x01\x00\x00\x01\x82\x00\x02ab".to_vec());
    assert_eq!(
        read_objects(&long, APPLICATION_BUDGET)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // Over the object budget.
    let many = write_objects(&[b"x".as_slice(); 3]);
    let small = Budget {
        objects: 2,
        bytes: 1 << 20,
    };
    assert_eq!(
        read_objects(&many, small)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // Over the byte budget, refused before any object is returned.
    let tight = Budget {
        objects: 16,
        bytes: 1,
    };
    assert_eq!(
        read_objects(&good, tight)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3003"
    );

    // A v4 holo is not a v5 holo.
    assert_eq!(
        read_objects(b"HOLO\x04\0\0\0", APPLICATION_BUDGET)
            .unwrap_err()
            .code
            .as_str()
            .to_owned(),
        "PP3001"
    );
}

/// `tests/data/holo-v5-uorc-oracle.json` is what `uorc inspect --json` reports
/// for each committed holo v5 fixture; this reader must see the same archive.
#[test]
fn layout_and_seal_agree_with_the_uorc_cli() {
    let root = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../..");
    let oracle: serde_json::Value = serde_json::from_slice(
        &std::fs::read(root.join("tests/data/holo-v5-uorc-oracle.json")).unwrap(),
    )
    .unwrap();
    for archive in oracle["archives"].as_array().unwrap() {
        let path = archive["path"].as_str().unwrap();
        let bytes = std::fs::read(root.join(path)).unwrap();
        let (objects, sealed) = layout(&bytes, APPLICATION_BUDGET).unwrap();
        assert!(sealed && archive["integrity_ok"] == true, "{path}");
        assert_eq!(archive["archive_bytes"], bytes.len() as u64, "{path}");
        let lengths: Vec<u64> = objects.iter().map(|object| object.len() as u64).collect();
        assert_eq!(
            archive["object_lengths"],
            serde_json::json!(lengths),
            "{path}"
        );
        assert_eq!(
            archive["digest"],
            hex(&bytes[bytes.len() - SEAL..]),
            "{path}"
        );
    }
}
