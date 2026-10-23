//! Assembly of the typed facet sections from collected catalog and entity rows.

use super::{
    bool_field, catalog_id, constructor, index, indexed, nat, take_raw, Buckets, FacetRecords,
    Table,
};
use crate::error::PrismError;
use crate::holo::model_document::{
    ActivityRecord, ArchitectureModel, AssetRecord, CatalogRecord, ComponentRecord, ControlRecord,
    EdgeRecord, MeasureRecord, MeasurementRecord, QualityModel, RequirementRecord, RiskRecord,
    SecurityModel, SubcharacteristicRecord, ViewRecord, ViewpointRecord,
};
use std::collections::BTreeMap;

pub(super) fn assemble(
    table: &Table,
    mut catalogs: BTreeMap<String, Vec<CatalogRecord>>,
    mut entities: Buckets<'_>,
) -> Result<FacetRecords, PrismError> {
    for rows in catalogs.values_mut() {
        rows.sort_by(|a, b| a.id.as_bytes().cmp(b.id.as_bytes()));
        for (index, row) in rows.iter_mut().enumerate() {
            row.index = index as u64;
        }
    }
    for rows in entities.values_mut() {
        index(rows)?;
    }
    let take_catalog = |map: &mut BTreeMap<String, Vec<CatalogRecord>>, name: &str| {
        map.remove(name).unwrap_or_default()
    };
    let component_rows = take_raw(&mut entities, "components");
    let components = component_rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ComponentRecord {
                id: row.id,
                index: index as u64,
                kind_id: catalog_id(table, "Foundation.Arch", constructor(&row.fields, "kind")?)?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let edge_rows = take_raw(&mut entities, "edges");
    let edges = edge_rows
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(EdgeRecord {
                id: row.id,
                index: index as u64,
                from_index: nat(&row.fields, "fromIndex")?,
                to_index: nat(&row.fields, "toIndex")?,
                kind_id: catalog_id(table, "Foundation.Arch", constructor(&row.fields, "kind")?)?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let stakeholders = indexed(take_raw(&mut entities, "stakeholders"));
    let concerns = indexed(take_raw(&mut entities, "concerns"));
    let viewpoints = take_raw(&mut entities, "viewpoints")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ViewpointRecord {
                id: row.id,
                index: index as u64,
                stakeholder_index: nat(&row.fields, "stakeholderIndex")?,
                concern_index: nat(&row.fields, "concernIndex")?,
                model_kind_index: nat(&row.fields, "modelKindIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let views = take_raw(&mut entities, "views")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ViewRecord {
                id: row.id,
                index: index as u64,
                viewpoint_index: nat(&row.fields, "viewpointIndex")?,
                model_kind_index: nat(&row.fields, "modelKindIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let assets = take_raw(&mut entities, "assets")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(AssetRecord {
                id: row.id,
                index: index as u64,
                component_index: nat(&row.fields, "componentIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let threats = indexed(take_raw(&mut entities, "threats"));
    let risks = take_raw(&mut entities, "risks")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(RiskRecord {
                id: row.id,
                index: index as u64,
                asset_index: nat(&row.fields, "assetIndex")?,
                threat_index: nat(&row.fields, "threatIndex")?,
                likelihood_id: catalog_id(
                    table,
                    "Foundation.Sec",
                    constructor(&row.fields, "likelihood")?,
                )?,
                impact_id: catalog_id(
                    table,
                    "Foundation.Sec",
                    constructor(&row.fields, "impact")?,
                )?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let controls = take_raw(&mut entities, "controls")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ControlRecord {
                id: row.id,
                index: index as u64,
                risk_index: nat(&row.fields, "riskIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let activities = take_raw(&mut entities, "activities")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(ActivityRecord {
                id: row.id,
                index: index as u64,
                control_index: nat(&row.fields, "controlIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let measurements = take_raw(&mut entities, "measurements")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(MeasurementRecord {
                id: row.id,
                index: index as u64,
                control_index: nat(&row.fields, "controlIndex")?,
                passed: bool_field(&row.fields, "passed")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let characteristics = indexed(take_raw(&mut entities, "characteristics"));
    let subcharacteristics = take_raw(&mut entities, "subcharacteristics")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(SubcharacteristicRecord {
                id: row.id,
                index: index as u64,
                characteristic_index: nat(&row.fields, "characteristicIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let requirements = take_raw(&mut entities, "requirements")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(RequirementRecord {
                id: row.id,
                index: index as u64,
                subcharacteristic_index: nat(&row.fields, "subcharacteristicIndex")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    let measures = take_raw(&mut entities, "measures")
        .into_iter()
        .enumerate()
        .map(|(index, row)| {
            Ok(MeasureRecord {
                id: row.id,
                index: index as u64,
                requirement_index: nat(&row.fields, "requirementIndex")?,
                threshold: nat(&row.fields, "threshold")?,
            })
        })
        .collect::<Result<Vec<_>, PrismError>>()?;
    if !entities.is_empty() {
        return Err(PrismError::new("PP9001", "unconsumed entity projection"));
    }
    let records = FacetRecords {
        architecture: ArchitectureModel {
            component_kinds: take_catalog(&mut catalogs, "component_kinds"),
            edge_kinds: take_catalog(&mut catalogs, "edge_kinds"),
            model_kinds: take_catalog(&mut catalogs, "model_kinds"),
            components,
            edges,
            stakeholders,
            concerns,
            viewpoints,
            views,
        },
        security: SecurityModel {
            likelihoods: take_catalog(&mut catalogs, "likelihoods"),
            impacts: take_catalog(&mut catalogs, "impacts"),
            assets,
            threats,
            risks,
            controls,
            activities,
            measurements,
        },
        quality: QualityModel {
            characteristics,
            subcharacteristics,
            requirements,
            measures,
        },
    };
    if !catalogs.is_empty() {
        return Err(PrismError::new("PP9001", "unconsumed catalog projection"));
    }
    Ok(records)
}
