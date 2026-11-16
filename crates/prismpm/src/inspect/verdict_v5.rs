//! The verdict's reading of a holo v5 (ADR-017): a raw UORC archive whose
//! ordered objects are [`ROLES_V5`]. It records the same internal checks as the
//! v4 reader, under the same ids, so a v5 holo and a v4 holo of the same
//! application reach the same level for the same reasons.
//!
//! - `archive.footer` is the UORC-SHA256-CHAIN-v1 seal over every byte.
//! - `blob.labels` is the manifest's κ and length of every object.
//! - `manifest.wire` is the manifest object: canonical `prism/holo/5`, its
//!   requirement and layers naming the objects in their roles.
//! - The documents, references, model and world checks are the v4 ones.

use super::{
    attestation, document_object, holoview_version, model_schema_finding, model_sha256_finding,
    wire, world_finding, Analysis, Finding, ModelProvenanceV1, NoVerdict, Row, ViewBinding,
    CHECK_ORDER, FORMAT_REVISION, HOLOVIEW_VERSION, KIND_APP_MANIFEST, KIND_CONTENT_BLOB,
    KIND_EXTENSION, KIND_METADATA, SOURCE_MANIFEST_VERSION,
};
use crate::holo::archive::{
    encode_json, layers_v5, ManifestV5, ObjectV5, CONTENT_OBJECTS, MANIFEST_SCHEMA_V5,
    PROVENANCE_SCHEMA_V5, ROLES_V5, ROLE_ATTESTATIONS,
};
use crate::holo::v5;
use serde_json::Value;
use std::collections::BTreeMap;

fn row(index: usize, role: &str, bytes: &[u8]) -> Row {
    let content = CONTENT_OBJECTS.contains(&index);
    let kind = match index {
        0 => KIND_APP_MANIFEST,
        1 => KIND_METADATA,
        _ if content => KIND_CONTENT_BLOB,
        _ => KIND_EXTENSION,
    };
    Row {
        index,
        kind,
        bytes: bytes.to_vec(),
        label: content.then(|| v5::kappa(bytes)),
        content: if content { bytes.to_vec() } else { Vec::new() },
        label_matches: content,
        name: (kind == KIND_EXTENSION).then(|| role.to_owned()),
        payload: bytes.to_vec(),
        problem: None,
    }
}

pub(super) fn analyze(bytes: &[u8]) -> Result<Analysis, NoVerdict> {
    let (objects, sealed) = v5::layout(bytes, v5::APPLICATION_BUDGET).map_err(|error| {
        let check = if error.code.as_str() == "PP3001" {
            "archive.magic"
        } else {
            "archive.table"
        };
        NoVerdict::new(check, error.message)
    })?;
    let roles_of = |index: usize| ROLES_V5.get(index).copied().unwrap_or(ROLE_ATTESTATIONS);
    let rows = objects
        .iter()
        .enumerate()
        .map(|(index, bytes)| row(index, roles_of(index), bytes))
        .collect::<Vec<_>>();
    let layout_known = rows.len() == ROLES_V5.len() || rows.len() == ROLES_V5.len() + 1;
    let at = |index: usize| layout_known.then(|| &rows[index]);

    let mut findings = Vec::new();
    let mut add =
        |id: &'static str, ok: bool, detail: String| findings.push(Finding { id, ok, detail });
    let seal = super::hex(&bytes[bytes.len() - v5::SEAL..]);
    add(
        "archive.footer",
        sealed,
        if sealed {
            format!("the seal is the UORC-SHA256-CHAIN-v1 of the archive, {seal}")
        } else {
            format!("the seal {seal} is not the UORC-SHA256-CHAIN-v1 of the archive: the archive was altered")
        },
    );

    // manifest.wire and blob.labels: the manifest object names every object.
    let kappa = |index: usize| {
        at(index)
            .map(|row| v5::kappa(&row.bytes))
            .unwrap_or_default()
    };
    let manifest = at(0)
        .ok_or_else(|| "the archive does not hold the objects of a holo".to_owned())
        .and_then(|row| {
            serde_json::from_slice::<ManifestV5>(&row.bytes)
                .map_err(|error| {
                    format!(
                        "the holo manifest does not have the {MANIFEST_SCHEMA_V5} shape: {error}"
                    )
                })
                .map(|manifest| (row, manifest))
        })
        .and_then(|(row, manifest)| {
            let mut problems = Vec::new();
            if manifest.schema != MANIFEST_SCHEMA_V5 {
                problems.push(format!("the manifest names schema {}", manifest.schema));
            }
            if manifest.name.is_empty() {
                problems.push("the manifest names no application".to_owned());
            }
            if manifest
                .basis
                .as_deref()
                .is_some_and(|basis| !v5::is_kappa(basis))
            {
                problems.push("the manifest basis is not a κ-label".to_owned());
            }
            if !v5::is_kappa(&manifest.requires) {
                problems.push("the manifest requires no κ-label".to_owned());
            }
            // The shape of the layers here; whether their κ name the objects is blob.labels.
            let named = |index: usize| {
                manifest
                    .layers
                    .get(index)
                    .map(|layer| layer.kappa.clone())
                    .unwrap_or_default()
            };
            if manifest.layers != layers_v5(&named(0), &named(1))
                || !manifest
                    .layers
                    .iter()
                    .all(|layer| v5::is_kappa(&layer.kappa))
            {
                problems.push(
                    "the manifest layers are not the wasm and view layers of a holo".to_owned(),
                );
            }
            if encode_json(&manifest).ok().as_deref() != Some(&row.bytes[..]) {
                problems.push("the manifest is not canonical JSON".to_owned());
            }
            if problems.is_empty() {
                Ok(manifest)
            } else {
                Err(problems.join("; "))
            }
        });
    add(
        "manifest.wire",
        manifest.is_ok(),
        match &manifest {
            Ok(_) => format!("the holo manifest is canonical {MANIFEST_SCHEMA_V5}"),
            Err(problem) => problem.clone(),
        },
    );
    if let Ok(manifest) = &manifest {
        // The provenance names the manifest, so the manifest lists every
        // object but the provenance.
        let expected = [1, 3, 4, 5, 6]
            .into_iter()
            .map(|index| ObjectV5 {
                role: ROLES_V5[index].to_owned(),
                kappa: kappa(index),
                length: rows[index].bytes.len() as u64,
            })
            .collect::<Vec<_>>();
        let ok = manifest.objects == expected
            && manifest.requires == kappa(3)
            && manifest.layers == layers_v5(&kappa(4), &kappa(5));
        add(
            "blob.labels",
            ok,
            if ok {
                format!(
                    "all {} objects match the κ the manifest gives them",
                    expected.len()
                )
            } else {
                "the manifest's κ-labels and lengths are not those of the objects in their roles"
                    .to_owned()
            },
        );
    }

    // metadata.schema: the source manifest.
    let source_manifest = document_object("the source manifest", at(1)).and_then(|value| {
        if value.get("version").and_then(Value::as_u64).is_some() {
            Ok(value)
        } else {
            Err("the source manifest does not have the source-manifest shape: version is not an unsigned integer".to_owned())
        }
    });
    add(
        "metadata.schema",
        source_manifest.is_ok(),
        match &source_manifest {
            Ok(value) => format!(
                "the source manifest matches its shape, version {}",
                value["version"]
            ),
            Err(problem) => problem.clone(),
        },
    );

    // provenance.schema: the model provenance object.
    let provenance = document_object("the model provenance", at(2)).and_then(|value| {
        if value.get("schema").and_then(Value::as_str) != Some(PROVENANCE_SCHEMA_V5) {
            return Err(format!(
                "the model provenance names schema {}, which no known format revision packs into a holo",
                value.get("schema").cloned().unwrap_or(Value::Null)
            ));
        }
        let canonical = crate::holo::canonical::encode_value(&value).ok();
        if canonical.as_deref() != at(2).map(|row| &row.bytes[..]) {
            return Err("the model provenance is not canonical JSON".to_owned());
        }
        serde_json::from_value::<ModelProvenanceV1>(value).map_err(|error| {
            format!("the model provenance does not have the {PROVENANCE_SCHEMA_V5} shape: {error}")
        })
    });
    add(
        "provenance.schema",
        provenance.is_ok(),
        match &provenance {
            Ok(_) => format!("the model provenance matches {PROVENANCE_SCHEMA_V5}"),
            Err(problem) => problem.clone(),
        },
    );

    // model.schema: the model object.
    let model_row = at(6);
    if let (Ok(_), Some(row)) = (&provenance, model_row) {
        let (ok, detail) = model_schema_finding(row);
        add("model.schema", ok, detail);
    }

    // references: the provenance names the objects in their roles.
    let mut roles = BTreeMap::new();
    let contract = provenance
        .as_ref()
        .ok()
        .map(|provenance| provenance.core_wasm_contract.clone());
    if let Ok(provenance) = &provenance {
        let mut problems = Vec::new();
        let named = [
            ("guest", &provenance.guest_content_kappa, kappa(4)),
            ("model", &provenance.model_content_kappa, kappa(6)),
            ("application", &provenance.application_kappa, kappa(0)),
        ];
        for (role, recorded, actual) in named {
            if *recorded != actual {
                problems.push(format!(
                    "the provenance {role} {recorded} is not the {role} object {actual}"
                ));
            }
        }
        if let ViewBinding::Present {
            view_content_kappa, ..
        } = &provenance.view_binding
        {
            if *view_content_kappa != kappa(5) {
                problems.push(format!(
                    "the provenance view {view_content_kappa} is not the view object {}",
                    kappa(5)
                ));
            }
        }
        add(
            "references",
            problems.is_empty(),
            if problems.is_empty() {
                "the manifest and the provenance name the same objects".to_owned()
            } else {
                problems.join("; ")
            },
        );
    }
    if layout_known {
        for (index, role) in [(3, "capabilities"), (4, "guest"), (5, "view"), (6, "model")] {
            roles.insert(role, kappa(index));
        }
    }

    // model.sha256 and world.contract, as in v4.
    if let (Ok(provenance), Some(row)) = (&provenance, model_row) {
        let (ok, detail) = model_sha256_finding(provenance, row, &source_manifest);
        add("model.sha256", ok, detail);
    }
    if let Some((ok, detail)) = world_finding(contract.as_deref(), at(4)) {
        add("world.contract", ok, detail);
    }

    // format.revision: the roles, the contract, the source manifest and the view.
    let mut differences = Vec::new();
    if !layout_known {
        differences.push(format!(
            "the archive holds {} objects, expected {} or {} when signed",
            rows.len(),
            ROLES_V5.len(),
            ROLES_V5.len() + 1
        ));
    }
    let expected_contract = wire::contractName();
    if let Some(contract) = contract
        .as_deref()
        .filter(|contract| *contract != expected_contract)
    {
        differences.push(format!(
            "the guest contract is {contract}, expected {expected_contract}"
        ));
    }
    if let Ok(manifest) = &source_manifest {
        if manifest.get("version").and_then(Value::as_u64) != Some(SOURCE_MANIFEST_VERSION) {
            differences.push(format!(
                "the source manifest version is {}, expected {SOURCE_MANIFEST_VERSION}",
                manifest["version"]
            ));
        }
    }
    if at(5).is_some_and(|view| holoview_version(&view.bytes) != Some(HOLOVIEW_VERSION)) {
        differences.push(format!(
            "the view is not a HOLOVIEW version {HOLOVIEW_VERSION} bundle"
        ));
    }
    add(
        "format.revision",
        differences.is_empty(),
        if differences.is_empty() {
            format!("holo v5, format revision {FORMAT_REVISION}")
        } else {
            format!(
                "the archive matches no format revision this reader knows (holo v5): {}",
                differences.join("; ")
            )
        },
    );
    findings.sort_by_key(|finding| CHECK_ORDER.iter().position(|id| *id == finding.id));

    // The attestation object: decoded, not verified.
    let blob_map = rows
        .iter()
        .filter_map(|row| Some((row.label.clone()?, row.content.clone())))
        .collect::<BTreeMap<_, _>>();
    let attestations = match rows.get(ROLES_V5.len()) {
        Some(row) if layout_known => {
            attestation::decode_section(&row.bytes, &blob_map).map_err(|error| error.message)
        }
        _ => Ok(Vec::new()),
    };

    Ok(Analysis {
        fingerprint: v5::kappa(bytes),
        footer_matches: sealed,
        layout_known,
        newest_differences: differences,
        findings,
        rows,
        roles,
        contract,
        provenance: provenance.ok(),
        attestations,
    })
}
