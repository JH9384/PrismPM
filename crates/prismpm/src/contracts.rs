//! Closed canonical machine-contract validation.

use crate::error::PrismError;
use crate::holo::canonical::{content_id, decode_value, encode_value};
use serde_json::Value;
use std::collections::BTreeSet;

struct Contract {
    id: &'static str,
    maximum_bytes: usize,
    maximum_items: usize,
    schema: &'static [u8],
}

const CONTRACTS: [Contract; 58] = [
    Contract {
        id: "prismpm/sdk-lock-migration/1",
        maximum_bytes: 201_326_592,
        maximum_items: 262_144,
        schema: include_bytes!("../schemas/sdk-lock-migration.schema.json"),
    },
    Contract {
        id: "prismpm/model-document/4",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/model-document-v4.schema.json"),
    },
    Contract {
        id: "prismpm/browser-publication-integrity/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/browser-publication-integrity.schema.json"),
    },
    Contract {
        id: "prismpm/library-build-binding/1",
        maximum_bytes: 4_194_304,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/library-build-binding.schema.json"),
    },
    Contract {
        id: "prismpm/library-acceptance/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/library-acceptance.schema.json"),
    },
    Contract {
        id: "prismpm/library-verification-manifest/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/library-verification-manifest.schema.json"),
    },
    Contract {
        id: "prismpm/library-verification-manifest/2",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/library-verification-manifest-v2.schema.json"),
    },
    Contract {
        id: "prismpm/model-document/3",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/model-document-v3.schema.json"),
    },
    Contract {
        id: "prismpm/browser-export/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/browser-export.schema.json"),
    },
    Contract {
        id: "prismpm/workspace-view-labels/1",
        maximum_bytes: 8_192,
        // Each of the 39 closed properties contributes a key and a scalar.
        maximum_items: 78,
        schema: include_bytes!("../schemas/workspace-view-labels.schema.json"),
    },
    Contract {
        id: "prismpm/verification-closure/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/verification-closure.schema.json"),
    },
    Contract {
        id: "prismpm/release-validation/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/release-validation.schema.json"),
    },
    Contract {
        id: "prismpm/sdk-lock-update/2",
        maximum_bytes: 201_326_592,
        maximum_items: 262_144,
        schema: include_bytes!("../schemas/sdk-lock-update-v2.schema.json"),
    },
    Contract {
        id: "prismpm/sdk-lock/2",
        maximum_bytes: 67_108_864,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/sdk-lock-v2.schema.json"),
    },
    Contract {
        id: "prismpm/model-document/2",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/model-document-v2.schema.json"),
    },
    Contract {
        id: "prismpm/authority-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/authority-result.schema.json"),
    },
    Contract {
        id: "prismpm/authority-binding/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/authority-binding.schema.json"),
    },
    Contract {
        id: "prismpm/bootstrap-evidence/2",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/bootstrap-evidence-v2.schema.json"),
    },
    Contract {
        id: "prismpm/bootstrap-evidence/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/bootstrap-evidence.schema.json"),
    },
    Contract {
        id: "prismpm/backup-snapshot/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/backup-snapshot.schema.json"),
    },
    Contract {
        id: "prismpm/capability-coverage/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/capability-coverage.schema.json"),
    },
    Contract {
        id: "prismpm/calculator-baseline/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/calculator-baseline.schema.json"),
    },
    Contract {
        id: "prismpm/conformance-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/conformance-result.schema.json"),
    },
    Contract {
        id: "prismpm/check-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/check-result.schema.json"),
    },
    Contract {
        id: "prismpm/clean-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/clean-result.schema.json"),
    },
    Contract {
        id: "prismpm/completion-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/completion-result.schema.json"),
    },
    Contract {
        id: "prismpm/deployment-evidence/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/deployment-evidence.schema.json"),
    },
    Contract {
        id: "prismpm/deployment-plan/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/deployment-plan.schema.json"),
    },
    Contract {
        id: "prismpm/deployment-state/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/deployment-state.schema.json"),
    },
    Contract {
        id: "prismpm/ecosystem-release/2",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/ecosystem-release.schema.json"),
    },
    Contract {
        id: "prismpm/platform-equivalence/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/platform-equivalence.schema.json"),
    },
    Contract {
        id: "prismpm/evidence-signature-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/evidence-signature-result.schema.json"),
    },
    Contract {
        id: "prismpm/evidence-signature/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/evidence-signature.schema.json"),
    },
    Contract {
        id: "prismpm/fetch-result/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/fetch-result.schema.json"),
    },
    Contract {
        id: "prismpm/inspect-result/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/inspect-result.schema.json"),
    },
    Contract {
        id: "prismpm/product-release-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/product-release-result.schema.json"),
    },
    Contract {
        id: "prismpm/product-release/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/product-release.schema.json"),
    },
    Contract {
        id: "prismpm/production-acceptance/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/production-acceptance.schema.json"),
    },
    Contract {
        id: "prismpm/promotion-policy/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/promotion-policy.schema.json"),
    },
    Contract {
        id: "prismpm/promotion-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/promotion-result.schema.json"),
    },
    Contract {
        id: "prismpm/pull-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/pull-result.schema.json"),
    },
    Contract {
        id: "prismpm/push-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/push-result.schema.json"),
    },
    Contract {
        id: "prismpm/oracle-validation-attestation/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/oracle-validation-attestation.schema.json"),
    },
    Contract {
        id: "prismpm/sdk-lock/1",
        maximum_bytes: 4_194_304,
        maximum_items: 8_192,
        schema: include_bytes!("../schemas/sdk-lock.schema.json"),
    },
    Contract {
        id: "prismpm/restore-result/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/restore-result.schema.json"),
    },
    Contract {
        id: "prismpm/run-result/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/run-result.schema.json"),
    },
    Contract {
        id: "prismpm/sdk-lock-update/1",
        maximum_bytes: 4_194_304,
        maximum_items: 8_192,
        schema: include_bytes!("../schemas/sdk-lock-update.schema.json"),
    },
    Contract {
        id: "prismpm/signature-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/signature-result.schema.json"),
    },
    Contract {
        id: "prismpm/signature-closure-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/signature-closure-result.schema.json"),
    },
    Contract {
        id: "prismpm/standards-lock/1",
        maximum_bytes: 8_388_608,
        maximum_items: 16_384,
        schema: include_bytes!("../schemas/standards-lock.schema.json"),
    },
    Contract {
        id: "prismpm/system-model/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/system-model.schema.json"),
    },
    Contract {
        id: "prismpm/system-model/2",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/system-model-v2.schema.json"),
    },
    Contract {
        id: "prismpm/browser-system-release/1",
        maximum_bytes: 16_777_216,
        maximum_items: 65_536,
        schema: include_bytes!("../schemas/browser-system-release.schema.json"),
    },
    Contract {
        id: "prismpm/template-result/1",
        maximum_bytes: 4_194_304,
        maximum_items: 8_192,
        schema: include_bytes!("../schemas/template-result.schema.json"),
    },
    Contract {
        id: "prismpm/validation-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/validation-result.schema.json"),
    },
    Contract {
        id: "uor/template-contract/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/template-contract.schema.json"),
    },
    Contract {
        id: "uor/template-lock/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/template-lock.schema.json"),
    },
    Contract {
        id: "prismpm/verify-result/1",
        maximum_bytes: 1_048_576,
        maximum_items: 4_096,
        schema: include_bytes!("../schemas/verify-result.schema.json"),
    },
];

fn contract(id: &str) -> Result<&'static Contract, PrismError> {
    CONTRACTS
        .iter()
        .find(|contract| contract.id == id)
        .ok_or_else(|| PrismError::new("PP1101", format!("unsupported contract {id}")))
}

fn strictly_ordered(rows: &[Value], key: impl Fn(&Value) -> Option<String>) -> bool {
    let keys = rows.iter().map(key).collect::<Option<Vec<_>>>();
    keys.is_some_and(|keys| {
        keys.windows(2)
            .all(|pair| pair[0].as_bytes() < pair[1].as_bytes())
    })
}

fn validate_semantic_order(id: &str, value: &Value) -> Result<(), PrismError> {
    if id == "prismpm/browser-system-release/1" {
        let rows = value["files"]
            .as_array()
            .expect("schema-validated browser system rows");
        if !strictly_ordered(rows, |row| row["path"].as_str().map(str::to_owned))
            || rows.iter().any(|row| {
                row["path"]
                    .as_str()
                    .unwrap()
                    .split('/')
                    .any(|part| part.is_empty() || part == "." || part == "..")
            })
        {
            return Err(PrismError::new(
                "PP1101",
                "browser system artifact paths must be confined, unique, and ordered",
            ));
        }
        return Ok(());
    }
    if matches!(
        id,
        "prismpm/library-build-binding/1" | "prismpm/library-acceptance/1"
    ) {
        let invalid =
            || PrismError::new("PP4004", "native-library evidence roots are inconsistent");
        let roots = |rows: &Value| -> Result<Vec<String>, PrismError> {
            let rows = rows.as_array().ok_or_else(invalid)?;
            let names = rows
                .iter()
                .map(|row| row.as_str().map(str::to_owned).ok_or_else(invalid))
                .collect::<Result<Vec<_>, _>>()?;
            if names.is_empty()
                || names.len() > 1024
                || names
                    .iter()
                    .any(|name| !crate::holo::library::qualified(name))
                || names.windows(2).any(|rows| rows[0] >= rows[1])
            {
                return Err(invalid());
            }
            Ok(names)
        };
        let exports = roots(&value["export_roots"])?;
        let acceptance = if id == "prismpm/library-build-binding/1" {
            roots(&value["acceptance_roots"])?
        } else {
            let first = roots(&value["executions"][0]["roots"])?;
            if first != roots(&value["executions"][1]["roots"])? {
                return Err(invalid());
            }
            first
        };
        if acceptance
            .iter()
            .any(|root| exports.binary_search(root).is_err())
        {
            return Err(invalid());
        }
        return Ok(());
    }
    if matches!(
        id,
        "prismpm/library-verification-manifest/1" | "prismpm/library-verification-manifest/2"
    ) {
        if id == "prismpm/library-verification-manifest/2" {
            crate::exporter::validate_owner_record(
                &value["exporter_owner"],
                value["model_sha256"]
                    .as_str()
                    .expect("schema-validated model hash"),
                "library",
            )
            .map_err(|error| PrismError::new("PP4004", error.message))?;
            if value["exporter_owner"]["phases"][1]["artifacts"] != value["artifacts"] {
                return Err(PrismError::new(
                    "PP4004",
                    "library owner products differ from the complete artifact bindings",
                ));
            }
            let processes =
                crate::release_verification::process_records(&value["processes"], false)
                    .map_err(|error| PrismError::new("PP4004", error.message))?;
            let replay = value["exporter_owner"]["phases"][1]["processes"]
                .as_array()
                .expect("validated owner replay");
            if processes
                .windows(replay.len())
                .filter(|rows| *rows == replay.as_slice())
                .count()
                != 1
                || processes
                    .get(1)
                    .is_none_or(|row| row["tool"] != "lake-version")
                || value["exporter_owner"]["phases"]
                    .as_array()
                    .expect("validated phases")
                    .iter()
                    .any(|phase| {
                        phase["processes"][0]["executable_sha256"]
                            != processes[1]["executable_sha256"]
                    })
            {
                return Err(PrismError::new(
                    "PP4004",
                    "library owner differs from original replay or native preflight",
                ));
            }
        }
        let mut prior = None;
        for row in value["artifacts"]
            .as_array()
            .expect("schema-validated artifact array")
        {
            let path = row["path"]
                .as_str()
                .expect("schema-validated artifact path");
            if path.split('/').any(|part| matches!(part, "" | "." | ".."))
                || prior.is_some_and(|previous| previous >= path)
            {
                return Err(PrismError::new(
                    "PP4004",
                    "native-library artifact paths are not confined and strictly ordered",
                ));
            }
            prior = Some(path);
        }
        return Ok(());
    }
    if id == "prismpm/workspace-view-labels/1" {
        // JSON Schema maxLength counts Unicode scalars; the host contract
        // instead bounds the encoded UTF-8 bytes of every label value.
        for label in value.as_object().expect("schema-validated labels").values() {
            let label = label.as_str().expect("schema-validated label string");
            if !(1..=256).contains(&label.len()) {
                return Err(PrismError::new(
                    "PP7601",
                    "workspace View label exceeds its 1..256 UTF-8 byte bound",
                ));
            }
        }
    }
    if matches!(
        id,
        "prismpm/model-document/2" | "prismpm/model-document/3" | "prismpm/model-document/4"
    ) {
        let document = serde_json::from_value(value.clone()).map_err(|error| {
            PrismError::new(
                if id == "prismpm/model-document/4" {
                    "PP2010"
                } else if id == "prismpm/model-document/2" {
                    "PP2009"
                } else {
                    "PP4004"
                },
                format!("model document shape: {error}"),
            )
        })?;
        return crate::holo::validate::validate(&document);
    }
    let arrays: Vec<(&str, &str)> = match id {
        "prismpm/browser-export/1" | "prismpm/browser-publication-integrity/1" => {
            vec![("files", "path")]
        }
        "prismpm/capability-coverage/1" => {
            vec![("diagnostics", "code"), ("features", "feature_id")]
        }
        "prismpm/platform-equivalence/1" => vec![
            ("files", "path"),
            ("modeled_platform_artifacts", "artifact_id"),
        ],
        "prismpm/standards-lock/1" => vec![("authorities", "id"), ("oracles", "id")],
        "prismpm/sdk-lock/1" => vec![("inventory", "id")],
        "prismpm/sdk-lock/2" => vec![("platforms", "platform")],
        "prismpm/system-model/1" => vec![
            ("acceptance", "id"),
            ("alerts", "id"),
            ("architecture", "id"),
            ("artifacts", "id"),
            ("backups", "id"),
            ("calls", "id"),
            ("capabilities", "id"),
            ("components", "id"),
            ("controls", "id"),
            ("drifts", "id"),
            ("events", "id"),
            ("flows", "id"),
            ("identity_requirements", "id"),
            ("interfaces", "id"),
            ("migrations", "id"),
            ("parameters", "id"),
            ("persistence", "id"),
            ("retirements", "id"),
            ("rollbacks", "id"),
            ("rollouts", "id"),
            ("schemas", "id"),
            ("secret_references", "id"),
            ("slis", "id"),
            ("slos", "id"),
            ("targets", "id"),
            ("topology", "id"),
        ],
        "prismpm/deployment-plan/1" => vec![("changes", "id")],
        "prismpm/deployment-evidence/1" => vec![("checks", "id")],
        "prismpm/ecosystem-release/2" => vec![
            ("actions", "path"),
            ("artifacts", "name"),
            ("evidence", "path"),
            ("packages", "name"),
            ("repositories", "name"),
        ],
        "uor/template-contract/1" => vec![
            ("project_content_paths", ""),
            ("required_paths", ""),
            ("universal_policy_paths", ""),
        ],
        "uor/template-lock/1" => vec![("policy_files", "path")],
        _ => Vec::new(),
    };
    for (field, key) in arrays {
        let rows = value[field]
            .as_array()
            .ok_or_else(|| PrismError::new("PP1101", format!("{id}.{field} is absent")))?;
        if !rows.is_empty()
            && !strictly_ordered(rows, |row| {
                if key.is_empty() {
                    row.as_str().map(str::to_owned)
                } else {
                    row[key].as_str().map(str::to_owned)
                }
            })
        {
            return Err(PrismError::new(
                "PP1101",
                format!("{id}.{field} identities are duplicate or noncanonical"),
            ));
        }
    }
    if id == "prismpm/sdk-lock/2" {
        crate::sdk::validate_platform_lock(value)?;
    }
    if id == "prismpm/sdk-lock-migration/1" {
        CanonicalDocument::from_value("prismpm/sdk-lock/1", value["patch"][0]["value"].clone())?;
        CanonicalDocument::from_value("prismpm/sdk-lock/2", value["patch"][1]["value"].clone())?;
    }
    if id == "prismpm/sdk-lock-update/2" {
        crate::sdk::validate_platform_lock(&value["proposed_lock"])?;
        let changes = value["changes"]
            .as_array()
            .expect("schema-validated changes");
        if !strictly_ordered(changes, |row| row["path"].as_str().map(str::to_owned))
            || changes.iter().any(|row| {
                row["from"] == row["to"]
                    || row["to"]
                        != value["proposed_lock"][row["path"]
                            .as_str()
                            .unwrap_or_default()
                            .trim_start_matches('/')]
            })
        {
            return Err(PrismError::new(
                "PP5401",
                "SDK update changes do not exactly describe the proposed fields",
            ));
        }
    }
    if id == "prismpm/product-release/1" {
        let rows = value["artifacts"]
            .as_array()
            .expect("schema-validated array");
        if !strictly_ordered(rows, |row| {
            Some(format!(
                "{}\0{}",
                row["digest"].as_str()?,
                row["annotations"]["org.opencontainers.image.title"]
                    .as_str()
                    .unwrap_or_default()
            ))
        }) {
            return Err(PrismError::new(
                "PP1101",
                "product release artifact identities are duplicate or noncanonical",
            ));
        }
        let external = value["external_artifacts"]
            .as_array()
            .expect("schema-validated array");
        if !strictly_ordered(external, |row| row["reference"].as_str().map(str::to_owned)) {
            return Err(PrismError::new(
                "PP1101",
                "external OCI artifact references are duplicate or noncanonical",
            ));
        }
        for row in external {
            let digest = row["digest"].as_str().expect("schema-validated digest");
            let reference = row["reference"]
                .as_str()
                .expect("schema-validated reference");
            if !reference.ends_with(digest) {
                return Err(PrismError::new(
                    "PP1101",
                    "external OCI artifact reference does not bind its descriptor digest",
                ));
            }
        }
    }
    if id == "prismpm/calculator-baseline/1" {
        let ordered = [
            ("/repositories", "repository"),
            ("/historical/packages", "name"),
            ("/historical/pages/assets", "path"),
            ("/remediation/publications", "name"),
        ];
        for (pointer, key) in ordered {
            let rows = value
                .pointer(pointer)
                .and_then(Value::as_array)
                .expect("schema-validated array");
            if !strictly_ordered(rows, |row| row[key].as_str().map(str::to_owned)) {
                return Err(PrismError::new(
                    "PP1101",
                    format!("calculator baseline {pointer} is duplicate or noncanonical"),
                ));
            }
        }
        let verification_runs = value
            .pointer("/verification_runs")
            .and_then(Value::as_array)
            .expect("schema-validated array");
        if !strictly_ordered(verification_runs, |row| {
            Some(format!(
                "{}\0{:02}",
                row["repository"].as_str()?,
                row["repeat"].as_u64()?
            ))
        }) {
            return Err(PrismError::new(
                "PP1101",
                "calculator baseline verification runs are duplicate or noncanonical",
            ));
        }
        if let Some(rows) = value
            .pointer("/remediation/current_closure/pages/assets")
            .and_then(Value::as_array)
        {
            if !strictly_ordered(rows, |row| row["path"].as_str().map(str::to_owned)) {
                return Err(PrismError::new(
                    "PP1101",
                    "calculator baseline current Pages assets are duplicate or noncanonical",
                ));
            }
        }
    }
    if id == "prismpm/production-acceptance/1" {
        crate::acceptance::verify_transcript(value)?;
        let rows = value["cases"].as_array().expect("schema-validated array");
        if !strictly_ordered(rows, |row| match row["kind"].as_str()? {
            "feature" => Some(format!("0/{}", row["feature_id"].as_str()?)),
            "diagnostic" => Some(format!("1/{}", row["diagnostic"].as_str()?)),
            _ => None,
        }) {
            return Err(PrismError::new(
                "PP1101",
                "production acceptance cases are duplicate or noncanonical",
            ));
        }
    }
    if id == "prismpm/conformance-result/1" {
        crate::acceptance::verify_result_counts(value)?;
    }
    if id == "prismpm/ecosystem-release/2" {
        let platforms = value
            .pointer("/sdk/platform_manifests")
            .and_then(Value::as_array)
            .expect("schema-validated array");
        if !strictly_ordered(platforms, |row| {
            row["architecture"].as_str().map(str::to_owned)
        }) {
            return Err(PrismError::new(
                "PP1101",
                "ecosystem SDK platforms are duplicate or noncanonical",
            ));
        }
        let sdk_digest = value
            .pointer("/sdk/index_digest")
            .and_then(Value::as_str)
            .expect("schema-validated digest");
        let sdk_reference = value
            .pointer("/sdk/reference")
            .and_then(Value::as_str)
            .expect("schema-validated reference");
        if !sdk_reference.ends_with(sdk_digest)
            || value["actions"]
                .as_array()
                .expect("schema-validated array")
                .iter()
                .any(|action| action["sdk_digest"].as_str() != Some(sdk_digest))
        {
            return Err(PrismError::new(
                "PP1101",
                "ecosystem SDK consumers do not bind the one SDK index digest",
            ));
        }
        let archives = value
            .pointer("/sdk/native_archives")
            .and_then(Value::as_array)
            .expect("schema-validated array");
        if !strictly_ordered(archives, |row| row["name"].as_str().map(str::to_owned)) {
            return Err(PrismError::new(
                "PP1101",
                "ecosystem native archives are duplicate or noncanonical",
            ));
        }
        let pages = value
            .pointer("/calculator/pages/assets")
            .and_then(Value::as_array)
            .expect("schema-validated array");
        if !strictly_ordered(pages, |row| row["name"].as_str().map(str::to_owned)) {
            return Err(PrismError::new(
                "PP1101",
                "ecosystem Pages assets are duplicate or noncanonical",
            ));
        }
        let releases = value
            .pointer("/calculator/system_releases")
            .and_then(Value::as_array)
            .expect("schema-validated array");
        if releases.len() != 2
            || releases[0]["label"].as_str() != Some("A")
            || releases[1]["label"].as_str() != Some("B")
        {
            return Err(PrismError::new(
                "PP1101",
                "ecosystem Calculator releases must be exactly A then B",
            ));
        }
        for release in releases {
            let digest = release["product_digest"]
                .as_str()
                .expect("schema-validated digest");
            let reference = release["reference"]
                .as_str()
                .expect("schema-validated reference");
            if !reference.ends_with(digest) {
                return Err(PrismError::new(
                    "PP1101",
                    "ecosystem Calculator release reference does not bind its product digest",
                ));
            }
            let referrers = release["referrers"]
                .as_array()
                .expect("schema-validated array");
            if !strictly_ordered(referrers, |row| row.as_str().map(str::to_owned)) {
                return Err(PrismError::new(
                    "PP1101",
                    "ecosystem Calculator referrers are duplicate or noncanonical",
                ));
            }
        }
        let repositories = value["repositories"]
            .as_array()
            .expect("schema-validated array")
            .iter()
            .filter_map(|row| row["name"].as_str())
            .collect::<BTreeSet<_>>();
        for required in [
            "LexLean",
            "PrismPM",
            "calculator-example",
            "lean4-prod",
            "template",
        ] {
            if !repositories.contains(required) {
                return Err(PrismError::new(
                    "PP1101",
                    format!("ecosystem manifest omits required repository {required}"),
                ));
            }
        }
        let packages = value["packages"]
            .as_array()
            .expect("schema-validated array")
            .iter()
            .filter_map(|row| row["name"].as_str())
            .collect::<BTreeSet<_>>();
        for required in ["prism-calculator", "prism-stdlib", "prismpm"] {
            if !packages.contains(required) {
                return Err(PrismError::new(
                    "PP1101",
                    format!("ecosystem manifest omits required package {required}"),
                ));
            }
        }
        let evidence_kinds = value["evidence"]
            .as_array()
            .expect("schema-validated array")
            .iter()
            .filter_map(|row| row["kind"].as_str())
            .collect::<BTreeSet<_>>();
        for required in [
            "acceptance",
            "backup-restore",
            "conformance",
            "deployment",
            "drift",
            "falsification",
            "migration",
            "provenance",
            "recovery",
            "rollback",
            "sbom",
            "signature",
            "slo",
            "verification",
        ] {
            if !evidence_kinds.contains(required) {
                return Err(PrismError::new(
                    "PP1101",
                    format!("ecosystem manifest omits required {required} evidence"),
                ));
            }
        }
    }
    if matches!(
        id,
        "prismpm/browser-export/1" | "prismpm/browser-publication-integrity/1"
    ) {
        let reference = value["reference"]
            .as_str()
            .expect("schema-validated reference");
        let digest = crate::oci::validate_reference(reference, true)?;
        let tree_digest = format!("sha256:{}", content_id(&encode_value(&value["files"])?));
        if value["release_digest"] != digest || value["tree_digest"] != tree_digest {
            return Err(PrismError::new(
                "PP1101",
                "browser export receipt identities disagree",
            ));
        }
    }
    if id == "prismpm/browser-publication-integrity/1" {
        crate::oci::validate_browser_publication_receipt(value)?;
    }
    Ok(())
}

/// One validated canonical contract value and its exact content identity.
#[derive(Debug, Clone)]
pub struct CanonicalDocument {
    id: &'static str,
    bytes: Vec<u8>,
    value: Value,
}

impl CanonicalDocument {
    /// Validate exact canonical bytes against a registered closed schema.
    pub fn parse(id: &'static str, bytes: &[u8]) -> Result<Self, PrismError> {
        let contract = contract(id)?;
        if bytes.len() > contract.maximum_bytes {
            return Err(PrismError::new(
                "PP7601",
                format!("{id} exceeds its {} byte limit", contract.maximum_bytes),
            ));
        }
        let value = decode_value(bytes, id)?;
        fn item_count(value: &Value) -> usize {
            match value {
                Value::Array(values) => values.iter().fold(values.len(), |sum, value| {
                    sum.saturating_add(item_count(value))
                }),
                Value::Object(values) => values.values().fold(values.len(), |sum, value| {
                    sum.saturating_add(item_count(value))
                }),
                _ => 1,
            }
        }
        if item_count(&value) > contract.maximum_items {
            return Err(PrismError::new(
                "PP7601",
                format!("{id} exceeds its {} item limit", contract.maximum_items),
            ));
        }
        // Only these registered closed envelopes use a different discriminator.
        // Their schemas still reject an invented Prism `schema` property.
        let discriminator = match id {
            "prismpm/oracle-validation-attestation/1" => None,
            "prismpm/workspace-view-labels/1" => Some("spec"),
            _ => Some("schema"),
        };
        if discriminator.is_some_and(|key| value.get(key).and_then(Value::as_str) != Some(id)) {
            return Err(PrismError::new(
                "PP1101",
                format!("value does not declare {id}"),
            ));
        }
        let schema: Value = serde_json::from_slice(contract.schema).map_err(|error| {
            PrismError::new("PP9001", format!("registered schema {id}: {error}"))
        })?;
        let validator = jsonschema::validator_for(&schema).map_err(|error| {
            PrismError::new("PP9001", format!("compile registered schema {id}: {error}"))
        })?;
        let errors = validator
            .iter_errors(&value)
            .take(32)
            .map(|error| error.to_string())
            .collect::<Vec<_>>();
        if !errors.is_empty() {
            return Err(PrismError::new(
                "PP1101",
                format!("{id} validation failed: {}", errors.join("; ")),
            ));
        }
        validate_semantic_order(id, &value)?;
        Ok(Self {
            id,
            bytes: bytes.to_vec(),
            value,
        })
    }

    /// Construct and validate canonical bytes from an in-memory value.
    pub fn from_value(id: &'static str, value: Value) -> Result<Self, PrismError> {
        let bytes = encode_value(&value)?;
        Self::parse(id, &bytes)
    }

    /// Contract identifier.
    #[must_use]
    pub fn schema(&self) -> &'static str {
        self.id
    }

    /// Exact canonical bytes without CLI framing.
    #[must_use]
    pub fn bytes(&self) -> &[u8] {
        &self.bytes
    }

    /// Validated JSON value.
    #[must_use]
    pub fn value(&self) -> &Value {
        &self.value
    }

    /// SHA-256 content identity with the standard digest prefix.
    #[must_use]
    pub fn digest(&self) -> String {
        format!("sha256:{}", content_id(&self.bytes))
    }
}

#[cfg(test)]
mod tests {
    use super::{CanonicalDocument, CONTRACTS};
    use serde_json::json;

    const LABELS_ID: &str = "prismpm/workspace-view-labels/1";

    fn workspace_labels() -> serde_json::Value {
        let mut labels = serde_json::Map::new();
        for key in [
            "action",
            "action0",
            "action1",
            "action2",
            "action3",
            "action4",
            "asOf",
            "author",
            "body",
            "close",
            "closed",
            "conflict",
            "contributor",
            "event",
            "inputError",
            "members",
            "message",
            "messages",
            "next",
            "none",
            "offset",
            "owner",
            "pending",
            "principal",
            "reader",
            "ready",
            "refresh",
            "rejected",
            "replay",
            "result",
            "role",
            "select",
            "submit",
            "title",
            "total",
            "unavailable",
            "unknown",
            "workspace",
        ] {
            labels.insert(key.to_owned(), json!("x"));
        }
        labels.insert("spec".to_owned(), json!(LABELS_ID));
        serde_json::Value::Object(labels)
    }

    #[test]
    fn workspace_labels_use_only_the_closed_spec_discriminator() {
        let labels = workspace_labels();
        assert_eq!(labels.as_object().unwrap().len(), 39);
        let parsed = CanonicalDocument::from_value(LABELS_ID, labels.clone()).unwrap();
        assert_eq!(parsed.schema(), LABELS_ID);
        assert_eq!(parsed.value(), &labels);
        for (field, value) in [
            ("spec", json!("prismpm/workspace-view-labels/2")),
            ("spec", json!(null)),
            ("schema", json!(LABELS_ID)),
            ("extra", json!("x")),
            ("title", json!(0)),
            ("title", json!("")),
        ] {
            let mut changed = labels.clone();
            changed[field] = value;
            assert!(
                CanonicalDocument::from_value(LABELS_ID, changed).is_err(),
                "{field}"
            );
        }
        for key in labels.as_object().unwrap().keys() {
            let mut changed = labels.clone();
            changed.as_object_mut().unwrap().remove(key);
            assert!(
                CanonicalDocument::from_value(LABELS_ID, changed).is_err(),
                "{key}"
            );
        }
        let mut wrong_discriminator = labels;
        wrong_discriminator.as_object_mut().unwrap().remove("spec");
        wrong_discriminator["schema"] = json!(LABELS_ID);
        assert!(CanonicalDocument::from_value(LABELS_ID, wrong_discriminator).is_err());
    }

    #[test]
    fn workspace_labels_enforce_utf8_byte_and_exact_document_bounds() {
        for value in ["a".repeat(256), "é".repeat(128), "😀".repeat(64)] {
            let mut labels = workspace_labels();
            labels["title"] = json!(value);
            CanonicalDocument::from_value(LABELS_ID, labels).unwrap();
        }
        for value in [
            "a".repeat(257),
            format!("{}a", "é".repeat(128)),
            format!("{}a", "😀".repeat(64)),
        ] {
            let mut labels = workspace_labels();
            labels["title"] = json!(value);
            assert!(CanonicalDocument::from_value(LABELS_ID, labels).is_err());
        }
        let mut labels = workspace_labels();
        let base_size = crate::holo::canonical::encode_value(&labels).unwrap().len();
        let mut remaining = 8_192 - base_size;
        for (key, value) in labels.as_object_mut().unwrap() {
            if key != "spec" {
                let extra = remaining.min(255);
                *value = json!("x".repeat(1 + extra));
                remaining -= extra;
            }
        }
        assert_eq!(remaining, 0);
        let bytes = crate::holo::canonical::encode_value(&labels).unwrap();
        assert_eq!(bytes.len(), 8_192);
        CanonicalDocument::parse(LABELS_ID, &bytes).unwrap();
        labels["workspace"] = json!("xx");
        let bytes = crate::holo::canonical::encode_value(&labels).unwrap();
        assert_eq!(bytes.len(), 8_193);
        assert_eq!(
            CanonicalDocument::parse(LABELS_ID, &bytes)
                .unwrap_err()
                .code
                .as_str(),
            "PP7601"
        );
    }

    #[test]
    fn workspace_labels_reject_noncanonical_bytes_but_preserve_display_bom() {
        let mut labels = workspace_labels();
        labels["title"] = json!("\u{feff}<script>literal text</script>");
        let parsed = CanonicalDocument::from_value(LABELS_ID, labels.clone()).unwrap();
        assert_eq!(parsed.value()["title"], labels["title"]);
        let canonical = parsed.bytes();
        let mut leading_bom = b"\xef\xbb\xbf".to_vec();
        leading_bom.extend_from_slice(canonical);
        let mut newline = canonical.to_vec();
        newline.push(b'\n');
        let mut duplicate = b"{\"action\":\"x\",".to_vec();
        duplicate.extend_from_slice(&canonical[1..]);
        let pretty = serde_json::to_vec_pretty(&labels).unwrap();
        for bytes in [leading_bom, newline, duplicate, pretty] {
            assert!(CanonicalDocument::parse(LABELS_ID, &bytes).is_err());
        }
    }

    fn runtime_contract_limits() -> std::collections::BTreeMap<String, (usize, usize)> {
        CONTRACTS
            .iter()
            .map(|contract| {
                (
                    contract.id.to_owned(),
                    (contract.maximum_bytes, contract.maximum_items),
                )
            })
            .collect()
    }

    fn modeled_contract_limits(
        model: &toml::Value,
    ) -> std::collections::BTreeMap<String, (usize, usize)> {
        model["contract"]
            .as_array()
            .unwrap()
            .iter()
            .map(|row| {
                (
                    row["schema"].as_str().unwrap().to_owned(),
                    (
                        usize::try_from(row["maximum_bytes"].as_integer().unwrap()).unwrap(),
                        usize::try_from(row["maximum_items"].as_integer().unwrap()).unwrap(),
                    ),
                )
            })
            .collect()
    }

    #[test]
    fn runtime_contract_parity_detects_independent_bound_drift() {
        let model: toml::Value = toml::from_str(include_str!("../model/contracts.toml")).unwrap();
        let runtime = runtime_contract_limits();
        assert_eq!(runtime, modeled_contract_limits(&model));
        for (field, replacement) in [("maximum_bytes", 8_193), ("maximum_items", 79)] {
            let mut changed = model.clone();
            let labels = changed["contract"]
                .as_array_mut()
                .unwrap()
                .iter_mut()
                .find(|row| row["schema"].as_str() == Some(LABELS_ID))
                .unwrap();
            labels[field] = toml::Value::Integer(replacement);
            assert_ne!(runtime, modeled_contract_limits(&changed), "{field}");
        }
    }

    #[test]
    fn browser_export_receipt_binds_exact_identity_and_order_without_authority_claims() {
        let files = [
            "app.css",
            "app.js",
            "core.js",
            "core_bg.wasm",
            "index.html",
            "provenance.json",
        ]
        .map(|path| json!({"path":path,"digest":format!("sha256:{}","1".repeat(64)),"size":1}));
        let files = json!(files);
        let digest = format!("sha256:{}", "2".repeat(64));
        let id = "prismpm/browser-export/1";
        let receipt = json!({
            "schema":id,
            "reference":format!("example.test/product@{digest}"),
            "release_digest":digest,
            "model_digest":format!("sha256:{}","3".repeat(64)),
            "build_digest":format!("sha256:{}","4".repeat(64)),
            "tree_digest":format!("sha256:{}",crate::holo::canonical::content_id(&crate::holo::canonical::encode_value(&files).unwrap())),
            "output":"site",
            "files":files,
        });
        CanonicalDocument::from_value(id, receipt.clone()).unwrap();
        for (field, replacement) in [
            ("reference", json!("example.test/product:main")),
            (
                "release_digest",
                json!(format!("sha256:{}", "5".repeat(64))),
            ),
            ("tree_digest", json!(format!("sha256:{}", "6".repeat(64)))),
            ("output", json!("../site")),
            ("output", json!("site/child")),
            ("output", json!(".prism")),
            ("output", json!("")),
            ("authorized", json!(true)),
            ("accepted", json!(true)),
        ] {
            let mut changed = receipt.clone();
            changed[field] = replacement;
            assert!(
                CanonicalDocument::from_value(id, changed).is_err(),
                "accepted changed {field}"
            );
        }
        for field in receipt.as_object().unwrap().keys() {
            let mut changed = receipt.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(
                CanonicalDocument::from_value(id, changed).is_err(),
                "accepted missing {field}"
            );
        }
        for mutation in 0..4 {
            let mut changed = receipt.clone();
            let files = changed["files"].as_array_mut().unwrap();
            match mutation {
                0 => {
                    files.swap(0, 1);
                }
                1 => {
                    files[1]["path"] = files[0]["path"].clone();
                }
                2 => {
                    files.remove(0);
                }
                3 => {
                    files[0]["path"] = json!("../app.css");
                }
                _ => unreachable!(),
            }
            changed["tree_digest"] = json!(format!(
                "sha256:{}",
                crate::holo::canonical::content_id(
                    &crate::holo::canonical::encode_value(&changed["files"]).unwrap()
                )
            ));
            assert!(
                CanonicalDocument::from_value(id, changed).is_err(),
                "accepted file mutation {mutation}"
            );
        }
    }

    #[test]
    fn oracle_attestation_preserves_the_closed_external_envelope() {
        // Schema boundary only; this fixture does not assert an oracle ran.
        let value = json!({
            "_type":"https://in-toto.io/Statement/v1",
            "predicateType":"https://schemas.uor.foundation/prismpm/oracle-validation/v1",
            "subject":[{"name":"projected-artifact","digest":{"sha256":"1".repeat(64)}}],
            "predicate":{
                "authority_ids":["TEST"],"covered":["schema"],"uncovered":["operation"],
                "edition":"1","normalized_result":"valid","oracle":"test",
                "oracle_digest":format!("sha256:{}","2".repeat(64)),"runner_image":null
            }
        });
        let id = "prismpm/oracle-validation-attestation/1";
        CanonicalDocument::from_value(id, value.clone()).unwrap();
        for (field, replacement) in [
            ("schema", json!(id)),
            ("_type", json!("Statement/v2")),
            ("predicateType", json!("unrelated")),
            ("subject", json!([])),
        ] {
            let mut changed = value.clone();
            changed[field] = replacement;
            assert!(CanonicalDocument::from_value(id, changed).is_err());
        }
    }

    #[test]
    fn release_validation_rejects_placeholder_and_open_oracle_records() {
        let id = "prismpm/release-validation/1";
        let digest = format!("sha256:{}", "1".repeat(64));
        let value = json!({"schema":id,"build_digest":digest,"subject":digest,
            "verification_digest":digest,"result":"passed","oracle_results":[]});
        CanonicalDocument::from_value(id, value.clone()).unwrap();
        for field in ["schema", "subject", "verification_digest", "build_digest"] {
            let mut changed = value.clone();
            changed.as_object_mut().unwrap().remove(field);
            assert!(CanonicalDocument::from_value(id, changed).is_err());
        }
        for records in [json!([{}]), json!([{"verified":true}])] {
            let mut changed = value.clone();
            changed["oracle_results"] = records;
            assert!(CanonicalDocument::from_value(id, changed).is_err());
        }
    }

    #[test]
    fn bootstrap_evidence_contract_accepts_the_gate_record() {
        let value = json!({
            "bootstrap": {
                "archive_digest": format!("sha256:{}", "a".repeat(64)),
                "binary_digest": format!("sha256:{}", "b".repeat(64)),
                "source_commit": "f378fd3a8dc5711cb4b22cec9ee2f874353628c3",
                "version": "0.2.0"
            },
            "compatibility_projection": {
                "current_result_digest": format!("sha256:{}", "c".repeat(64)),
                "prior_result_digest": format!("sha256:{}", "d".repeat(64)),
                "shared_identity": {
                    "entity_count": 1,
                    "semantic_id": "e".repeat(64),
                    "snapshot_id": "f".repeat(64)
                }
            },
            "production_model": {
                "entity_count": 18,
                "result_digest": format!("sha256:{}", "1".repeat(64)),
                "semantic_id": "2".repeat(64),
                "snapshot_id": "3".repeat(64)
            },
            "schema": "prismpm/bootstrap-evidence/1",
            "source_manifest": {
                "digest": format!("sha256:{}", "4".repeat(64)),
                "file_count": 200
            },
            "status": "passed"
        });
        CanonicalDocument::from_value("prismpm/bootstrap-evidence/1", value)
            .expect("bootstrap gate must emit the registered canonical contract");
    }

    #[test]
    fn bootstrap_v2_binds_separate_identities_and_preserves_legacy_contract() {
        let identity = |digit: char| {
            json!({
                "capture_digest": format!("sha256:{}", digit.to_string().repeat(64)),
                "compiler_semantics_id": digit.to_string().repeat(64),
                "emitter_semantics_id": "e".repeat(64),
                "entity_count": 1,
                "lock_digest": format!("sha256:{}", "f".repeat(64)),
                "model_id": digit.to_string().repeat(64),
                "result_digest": format!("sha256:{}", digit.to_string().repeat(64)),
                "semantic_id": digit.to_string().repeat(64),
                "snapshot_id": digit.to_string().repeat(64),
                "source_id": digit.to_string().repeat(64)
            })
        };
        let value = json!({
            "bootstrap": {
                "archive_digest": "sha256:f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c",
                "binary_digest": format!("sha256:{}", "b".repeat(64)),
                "source_commit": "f378fd3a8dc5711cb4b22cec9ee2f874353628c3",
                "version": "0.2.0"
            },
            "compatibility_projection": {
                "current": identity('a'), "prior": identity('b'),
                "shared_content_digest": format!("sha256:{}", "c".repeat(64)),
                "shared_model_digest": format!("sha256:{}", "d".repeat(64))
            },
            "production_model": {
                "schema": "prismpm/check-result/1", "entity_count": 18,
                "model_id": "1".repeat(64), "result_digest": format!("sha256:{}", "1".repeat(64)),
                "semantic_id": "2".repeat(64), "snapshot_id": "3".repeat(64)
            },
            "schema": "prismpm/bootstrap-evidence/2",
            "source_manifest": {"digest": format!("sha256:{}", "4".repeat(64)), "file_count": 200},
            "status": "passed"
        });
        CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", value.clone()).unwrap();
        for pointer in [
            "/compatibility_projection/current/lock_digest",
            "/compatibility_projection/prior/compiler_semantics_id",
            "/compatibility_projection/shared_content_digest",
            "/compatibility_projection/shared_model_digest",
        ] {
            let mut changed = value.clone();
            *changed.pointer_mut(pointer).unwrap() = serde_json::Value::Null;
            assert!(
                CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", changed).is_err()
            );
        }
        let mut changed = value.clone();
        changed["compatibility_projection"]["shared_identity"] = json!({});
        assert!(CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", changed).is_err());
        let mut changed = value.clone();
        changed["schema"] = json!("prismpm/bootstrap-evidence/1");
        assert!(CanonicalDocument::from_value("prismpm/bootstrap-evidence/1", changed).is_err());
        let mut changed = value;
        changed["bootstrap"]["source_commit"] = json!("0".repeat(40));
        assert!(CanonicalDocument::from_value("prismpm/bootstrap-evidence/2", changed).is_err());
    }

    #[test]
    fn contracts_reject_unknown_fields_and_noncanonical_bytes() {
        let value = json!({
            "build_digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
            "evidence_path": ".prism/evidence/x.json",
            "model_digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
            "product_digest": "sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
            "reference": "example.invalid/product:build",
            "release_digest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "schema": "prismpm/product-release-result/1"
        });
        let document = CanonicalDocument::from_value("prismpm/product-release-result/1", value)
            .expect("valid closed result");
        assert!(document.digest().starts_with("sha256:"));
        let mut noncanonical = document.bytes().to_vec();
        noncanonical.push(b'\n');
        assert!(
            CanonicalDocument::parse("prismpm/product-release-result/1", &noncanonical).is_err()
        );
        let mut changed = document.value().clone();
        changed["unexpected"] = json!(true);
        assert!(
            CanonicalDocument::from_value("prismpm/product-release-result/1", changed).is_err()
        );
    }

    #[test]
    fn every_registered_schema_compiles_without_external_resolution() {
        for contract in CONTRACTS {
            let schema: serde_json::Value = serde_json::from_slice(contract.schema).unwrap();
            jsonschema::validator_for(&schema)
                .unwrap_or_else(|error| panic!("{} does not compile: {error}", contract.id));
        }
    }

    #[test]
    fn runtime_contracts_are_exactly_the_modeled_contracts() {
        let modeled: toml::Value = toml::from_str(include_str!("../model/contracts.toml")).unwrap();
        let row_count = modeled["contract"].as_array().unwrap().len();
        let modeled = modeled_contract_limits(&modeled);
        let runtime = runtime_contract_limits();
        assert_eq!(modeled.len(), row_count, "duplicate modeled contract");
        assert_eq!(runtime.len(), CONTRACTS.len(), "duplicate runtime contract");
        assert_eq!(runtime, modeled, "runtime and modeled contracts diverged");
    }

    #[test]
    fn duplicate_object_members_are_rejected_before_schema_validation() {
        let bytes = b"{\"build_digest\":\"sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\",\"evidence_path\":\"x\",\"model_digest\":\"sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb\",\"product_digest\":\"sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc\",\"reference\":\"example.invalid/x\",\"release_digest\":\"sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd\",\"schema\":\"prismpm/product-release-result/1\",\"schema\":\"prismpm/product-release-result/1\"}";
        assert!(CanonicalDocument::parse("prismpm/product-release-result/1", bytes).is_err());
    }

    #[test]
    fn external_oci_reference_must_bind_the_declared_descriptor() {
        let release = json!({
            "artifacts": [{
                "annotations": {},
                "digest": "sha256:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
                "media_type": "application/octet-stream",
                "role": "application",
                "size": 1
            }],
            "external_artifacts": [{
                "digest": "sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "license_expression": "Apache-2.0",
                "media_type": "application/vnd.docker.distribution.manifest.list.v2+json",
                "reference": "registry.example/product@sha256:bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
                "role": "runtime-image"
            }],
            "model_digest": "sha256:dddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
            "product": "fixture",
            "release": "1",
            "schema": "prismpm/product-release/1",
            "sdk_digest": "sha256:eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
            "sdk_lock": "sha256:abababababababababababababababababababababababababababababababab",
            "standards_lock": "sha256:ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
            "status": "development"
        });
        CanonicalDocument::from_value("prismpm/product-release/1", release.clone())
            .expect("an exact Docker Distribution external descriptor is representable");
        let mut mismatched = release;
        mismatched["external_artifacts"][0]["reference"] = serde_json::Value::String(
            "registry.example/product@sha256:cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc"
                .to_owned(),
        );
        let error = CanonicalDocument::from_value("prismpm/product-release/1", mismatched)
            .expect_err("a reference to a different digest must fail");
        assert_eq!(error.code.as_str(), "PP1101");
    }

    #[test]
    fn ecosystem_release_closes_over_every_required_public_boundary() {
        let digest = |byte: char| format!("sha256:{}", byte.to_string().repeat(64));
        let artifact = |name: &str, byte: char| {
            json!({
                "digest": digest(byte),
                "media_type": "application/octet-stream",
                "name": name,
                "public_url": format!("https://example.invalid/{name}"),
                "size": 1
            })
        };
        let repositories = [
            "LexLean",
            "PrismPM",
            "calculator-example",
            "lean4-prod",
            "template",
        ]
        .into_iter()
        .map(|name| {
            json!({
                "commit": "0123456789abcdef0123456789abcdef01234567",
                "name": name,
                "source_archive": artifact(&format!("{name}-source"), '1'),
                "tag": "v0.3.0",
                "url": format!("https://github.com/example/{name}")
            })
        })
        .collect::<Vec<_>>();
        let evidence = [
            "acceptance",
            "backup-restore",
            "conformance",
            "deployment",
            "drift",
            "falsification",
            "migration",
            "provenance",
            "recovery",
            "rollback",
            "sbom",
            "signature",
            "slo",
            "verification",
        ]
        .into_iter()
        .enumerate()
        .map(|(index, kind)| {
            json!({
                "ci_run": null,
                "digest": digest(char::from_digit((index % 8 + 1) as u32, 10).unwrap()),
                "kind": kind,
                "path": format!("evidence/{index:02}-{kind}.json"),
                "subject_digest": digest('a')
            })
        })
        .collect::<Vec<_>>();
        let sdk_digest = digest('b');
        let release_a = digest('a');
        let release_b = digest('c');
        let value = json!({
            "actions": [{
                "path": ".github/actions/prismpm/action.yml",
                "repository": "UOR-Foundation/PrismPM",
                "revision": "0123456789abcdef0123456789abcdef01234567",
                "sdk_digest": sdk_digest
            }],
            "artifacts": [artifact("ecosystem-release", 'd')],
            "calculator": {
                "application_baseline_digest": digest('e'),
                "coverage_digest": digest('f'),
                "pages": {
                    "assets": (0..6).map(|index| artifact(&format!("asset-{index}"), '1')).collect::<Vec<_>>(),
                    "commit": "0123456789abcdef0123456789abcdef01234567",
                    "url": "https://example.invalid/calculator/"
                },
                "system_releases": [{
                    "deployment_evidence": digest('2'),
                    "label": "A",
                    "product_digest": release_a,
                    "reference": format!("ghcr.io/example/calculator-a@{release_a}"),
                    "referrers": [digest('1'), digest('2')]
                }, {
                    "deployment_evidence": digest('3'),
                    "label": "B",
                    "product_digest": release_b,
                    "reference": format!("ghcr.io/example/calculator-b@{release_b}"),
                    "referrers": [digest('3'), digest('4')]
                }]
            },
            "evidence": evidence,
            "packages": [{
                "checksum": "1111111111111111111111111111111111111111111111111111111111111111",
                "name": "prism-calculator",
                "registry": "https://crates.io/crates/prism-calculator",
                "version": "0.1.0"
            }, {
                "checksum": "2222222222222222222222222222222222222222222222222222222222222222",
                "name": "prism-stdlib",
                "registry": "https://crates.io/crates/prism-stdlib",
                "version": "0.2.0"
            }, {
                "checksum": "3333333333333333333333333333333333333333333333333333333333333333",
                "name": "prismpm",
                "registry": "https://crates.io/crates/prismpm",
                "version": "0.3.0"
            }],
            "repositories": repositories,
            "schema": "prismpm/ecosystem-release/2",
            "sdk": {
                "index_digest": sdk_digest,
                "inventory_digest": digest('6'),
                "native_archives": [artifact("aarch64", '7'), artifact("x86_64", '8')],
                "platform_manifests": [{"architecture": "amd64", "digest": digest('7'), "os": "linux"}, {"architecture": "arm64", "digest": digest('8'), "os": "linux"}],
                "reference": format!("ghcr.io/example/prismpm-sdk@{sdk_digest}"),
                "version": "0.3.0"
            },
            "standards_lock_digest": digest('9'),
            "status": "accepted",
            "template": {
                "contract_digest": digest('4'),
                "instantiation_evidence": digest('5'),
                "repository_commit": "0123456789abcdef0123456789abcdef01234567"
            },
            "version": "2"
        });
        let document = CanonicalDocument::from_value("prismpm/ecosystem-release/2", value)
            .expect("complete ecosystem release");
        let mut reordered = document.value().clone();
        reordered["calculator"]["system_releases"]
            .as_array_mut()
            .unwrap()
            .reverse();
        assert!(CanonicalDocument::from_value("prismpm/ecosystem-release/2", reordered).is_err());
        let mut omitted = document.value().clone();
        omitted["repositories"].as_array_mut().unwrap().remove(0);
        assert!(CanonicalDocument::from_value("prismpm/ecosystem-release/2", omitted).is_err());
    }
}
