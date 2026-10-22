//! Independent exact ownership-set oracle over the public partition operation.
use publication_context_linkage_core_probe::*;
use std::collections::BTreeSet;

fn name(index: usize) -> String {
    format!("c{index:05}")
}
fn records(count: usize) -> PublicationRecords {
    PublicationRecords {
        chunks: (0..count)
            .collect::<Vec<_>>()
            .chunks(256)
            .map(|indices| PublicationRecordsChunk {
                entries: indices
                    .iter()
                    .map(|index| PublicationRecord {
                        id: name(*index),
                        digest: vec![42; 32],
                    })
                    .collect(),
            })
            .collect(),
    }
}
fn services(groups: &[Vec<String>]) -> PublicationServices {
    PublicationServices {
        chunks: groups
            .chunks(256)
            .map(|groups| PublicationServicesChunk {
                entries: groups
                    .iter()
                    .enumerate()
                    .map(|(index, group)| PublicationService {
                        id: format!("service{index}"),
                        components: PublicationIds {
                            chunks: group
                                .chunks(256)
                                .map(|entries| PublicationIdsChunk {
                                    entries: entries.to_vec(),
                                })
                                .collect(),
                        },
                    })
                    .collect(),
            })
            .collect(),
    }
}
fn check(count: usize, groups: &[Vec<String>], checks: &mut usize) {
    let expected_ids = (0..count).map(name).collect::<BTreeSet<_>>();
    let actual_ids = groups.iter().flatten().cloned().collect::<Vec<_>>();
    let actual_set = actual_ids.iter().cloned().collect::<BTreeSet<_>>();
    let expected = actual_ids.len() == actual_set.len() && actual_set == expected_ids;
    assert_eq!(
        publicationLinkageServicesPartition(&services(groups), &records(count)).unwrap(),
        expected,
        "public exact partition count {count}, {} service groups",
        groups.len()
    );
    *checks += 1;
}
pub fn verify() {
    let mut checks = 0;
    for _ in 0..2 {
        for count in [
            0, 1, 63, 64, 65, 127, 128, 129, 191, 192, 193, 255, 256, 257, 512, 65535, 65536,
        ] {
            let ids = (0..count).map(name).collect::<Vec<_>>();
            check(count, &[ids.clone()], &mut checks);
            check(
                count,
                &[
                    ids.iter().step_by(2).cloned().collect(),
                    ids.iter().skip(1).step_by(2).cloned().collect(),
                ],
                &mut checks,
            );
            check(count, &[], &mut checks);
            let mut extra = ids.clone();
            extra.push("unknown".into());
            check(count, &[extra], &mut checks);
            if count > 0 {
                for position in [0, count / 2, count - 1] {
                    let mut missing = ids.clone();
                    missing.remove(position);
                    check(count, &[missing], &mut checks);
                    let mut unknown = ids.clone();
                    unknown[position] = "unknown".into();
                    check(count, &[unknown], &mut checks);
                    let mut extra = ids.clone();
                    extra.insert(position, ids[position].clone());
                    check(count, &[extra], &mut checks);
                    if count > 1 {
                        let mut duplicate = ids.clone();
                        duplicate[position] = ids[(position + 1) % count].clone();
                        check(count, &[duplicate], &mut checks);
                    }
                }
            }
            let indices = (0..count as u64).collect::<Vec<_>>();
            let fuel = (count as u64).div_ceil(256);
            for available in [fuel, fuel + 1] {
                assert!(
                    publicationLinkageBitBuckets(&indices, 0, count as u64, available).unwrap()
                );
                checks += 1;
            }
            if count > 0 {
                assert!(
                    !publicationLinkageBitBuckets(&indices, 0, count as u64, fuel - 1).unwrap()
                );
                checks += 1;
                for position in [0, count / 2, count - 1] {
                    let mut duplicate = indices.clone();
                    duplicate.insert(position, indices[position]);
                    assert!(
                        !publicationLinkageBitBuckets(&duplicate, 0, count as u64, fuel).unwrap()
                    );
                    checks += 1;
                }
            }
        }
    }
    println!(
        "PASS {checks} independent public exact partition and bounded duplicate/fuel witnesses"
    );
}
