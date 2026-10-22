//! Independent ordered-index and exact-fuel witnesses for existing wrappers.
use publication_context_linkage_core_probe::*;

fn ids(values: &[&str]) -> PublicationIds {
    PublicationIds {
        chunks: vec![PublicationIdsChunk {
            entries: values.iter().map(|value| (*value).to_owned()).collect(),
        }],
    }
}

fn service(values: &[&str]) -> PublicationService {
    PublicationService {
        id: "service".into(),
        components: ids(values),
    }
}

pub fn verify() {
    let records = PublicationRecords {
        chunks: vec![PublicationRecordsChunk {
            entries: (0..8)
                .map(|index| PublicationRecord {
                    id: format!("c{index}"),
                    digest: vec![index as u8; 32],
                })
                .collect(),
        }],
    };
    let mut checks = 0;
    for repeat in 0..2 {
        for fuel in 0..=4 {
            for values in [
                vec![],
                vec!["c0"],
                vec!["c0", "c2", "c7"],
                vec!["c7", "c0", "c2"],
                vec!["c2", "c2"],
            ] {
                let expected = (fuel >= values.len() as u64).then(|| {
                    values
                        .iter()
                        .map(|value| value[1..].parse::<u64>().unwrap())
                        .collect::<Vec<_>>()
                });
                assert_eq!(
                    publicationLinkageCollectRows(&ids(&values).chunks[0].entries, &records, fuel)
                        .unwrap(),
                    expected,
                    "ordered rows/fuel {repeat}/{fuel}"
                );
                checks += 1;
            }
            let chunks = vec![
                ids(&["c0", "c2"]).chunks.remove(0),
                ids(&["c7"]).chunks.remove(0),
            ];
            assert_eq!(
                publicationLinkageCollectIdChunks(&chunks, &records, fuel).unwrap(),
                (fuel >= 2).then(|| vec![0, 2, 7])
            );
            checks += 1;
            let services = vec![service(&["c0", "c2"]), service(&["c7"])];
            assert_eq!(
                publicationLinkageCollectServiceRows(&services, &records, fuel).unwrap(),
                (fuel >= 2).then(|| vec![0, 2, 7])
            );
            checks += 1;
            let chunks = vec![
                PublicationServicesChunk { entries: services },
                PublicationServicesChunk { entries: vec![] },
            ];
            assert_eq!(
                publicationLinkageCollectServiceChunks(&chunks, &records, fuel).unwrap(),
                (fuel >= 2).then(|| vec![0, 2, 7])
            );
            checks += 1;
            for missing in [
                vec!["absent", "c0"],
                vec!["c0", "absent", "c7"],
                vec!["c0", "absent"],
            ] {
                assert_eq!(
                    publicationLinkageCollectRows(&ids(&missing).chunks[0].entries, &records, fuel)
                        .unwrap(),
                    None
                );
                assert_eq!(
                    publicationLinkageCollectIdChunks(&ids(&missing).chunks, &records, fuel)
                        .unwrap(),
                    None
                );
                assert_eq!(
                    publicationLinkageCollectServiceRows(&[service(&missing)], &records, fuel)
                        .unwrap(),
                    None
                );
                assert_eq!(
                    publicationLinkageCollectServiceChunks(
                        &[PublicationServicesChunk {
                            entries: vec![service(&missing)]
                        }],
                        &records,
                        fuel
                    )
                    .unwrap(),
                    None
                );
                checks += 4;
            }
            assert_eq!(
                publicationLinkageCollectIdChunks(&[], &records, fuel).unwrap(),
                Some(vec![])
            );
            assert_eq!(
                publicationLinkageCollectServiceRows(&[], &records, fuel).unwrap(),
                Some(vec![])
            );
            assert_eq!(
                publicationLinkageCollectServiceChunks(&[], &records, fuel).unwrap(),
                Some(vec![])
            );
            checks += 3;
        }
        let over = PublicationIdsChunk {
            entries: vec!["c0".into(); 257],
        };
        assert_eq!(
            publicationLinkageCollectIdChunks(&[over], &records, 1).unwrap(),
            None
        );
        checks += 1;
        let exact = PublicationServicesChunk {
            entries: vec![service(&["c0"]); 256],
        };
        assert_eq!(
            publicationLinkageCollectServiceChunks(&[exact], &records, 1).unwrap(),
            Some(vec![0; 256])
        );
        checks += 1;
        let over = PublicationServicesChunk {
            entries: vec![service(&["c0"]); 257],
        };
        assert_eq!(
            publicationLinkageCollectServiceChunks(&[over], &records, 1).unwrap(),
            None
        );
        checks += 1;
        for fuel in [255, 256, 257] {
            let exact = vec!["c0".into(); 256];
            assert_eq!(
                publicationLinkageCollectRows(&exact, &records, fuel).unwrap(),
                (fuel >= 256).then(|| vec![0; 256])
            );
            checks += 1;
            let exact = vec![
                PublicationIdsChunk {
                    entries: vec!["c0".into()]
                };
                256
            ];
            assert_eq!(
                publicationLinkageCollectIdChunks(&exact, &records, fuel).unwrap(),
                (fuel >= 256).then(|| vec![0; 256])
            );
            checks += 1;
            let exact = vec![service(&["c0"]); 256];
            assert_eq!(
                publicationLinkageCollectServiceRows(&exact, &records, fuel).unwrap(),
                (fuel >= 256).then(|| vec![0; 256])
            );
            checks += 1;
            let exact = vec![
                PublicationServicesChunk {
                    entries: vec![service(&["c0"])]
                };
                256
            ];
            assert_eq!(
                publicationLinkageCollectServiceChunks(&exact, &records, fuel).unwrap(),
                (fuel >= 256).then(|| vec![0; 256])
            );
            checks += 1;
        }
    }
    assert_eq!(checks, 260);
    println!("PASS 260 independent collector order, duplicates, missing-member and fuel witnesses");
}
