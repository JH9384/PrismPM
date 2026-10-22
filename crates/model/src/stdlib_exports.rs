//! Closed standard-library exports, preserving the original application API.

use crate::ModelError;
use serde::Deserialize;
use std::collections::BTreeSet;

/// Extra named package exports, distinct from allocation-free validator roots.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StdlibExports {
    /// Closed package-export register schema.
    pub spec: String,
    /// Generated Lean import module containing every named entry point.
    pub lean_module: String,
    /// Name of the single verified LCNF module.
    pub ir_module: String,
    /// Canonically ordered, explicitly registered package entry points.
    pub export: Vec<StdlibExport>,
}

/// One source declaration and its public Rust function type.
#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct StdlibExport {
    /// Fully qualified generated Lean declaration, never handwritten Lean.
    pub lean_name: String,
    /// Registered public Rust symbol.
    pub rust_name: String,
    /// Consumer-facing function type; this describes an ABI, not semantics.
    pub rust_signature: String,
}

impl StdlibExports {
    /// Reject missing, duplicated, substituted, or incompatible package exports.
    pub fn check(&self) -> Result<(), ModelError> {
        let invalid =
            || ModelError::Inconsistent("invalid standard-library package exports".to_owned());
        if self.spec != "prismpm/stdlib-exports/1"
            || self.lean_module != "PrismPM.Runtime"
            || self.ir_module != "PrismPM"
            || self.export.len() != 66
            || self
                .export
                .windows(2)
                .any(|rows| rows[0].lean_name >= rows[1].lean_name)
        {
            return Err(invalid());
        }
        let mut names = BTreeSet::new();
        for row in &self.export {
            // The complete export set is closed. Original signatures cannot be
            // waived by deleting or renaming a register row when adding APIs.
            let (module, signature) = match row.rust_name.as_str() {
                "beginNativeLease" => (
                    "Native.Application.V1.Lease",
                    "fn(&NativeLane, Vec<u8>, u64, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>",
                ),
                "cancelNativeLease" | "closeNativeLane" => (
                    "Native.Application.V1.Lease",
                    "fn(&NativeLane, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>",
                ),
                "completeNativeLease" | "retainUnknownNativeCleanup" | "retireCancelledNativeLease" => (
                    "Native.Application.V1.Lease",
                    "fn(&NativeLane, &NativeLeaseBinding, u64) -> Result<Result<NativeLane, NativeLeaseError>, ComputeError>",
                ),
                "nativeBindingEqual" => (
                    "Native.Application.V1.Lease",
                    "fn(&NativeLeaseBinding, &NativeLeaseBinding) -> bool",
                ),
                "nativeLaneValid" => (
                    "Native.Application.V1.Lease",
                    "fn(&NativeLane) -> Result<bool, ComputeError>",
                ),
                "openNativeLane" => (
                    "Native.Application.V1.Lease",
                    "fn(Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) -> Result<NativeLane, NativeLeaseError>",
                ),
                "reduceWorkspaceBytes" => (
                    "Browser.V1.Workspace",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "workspaceCommandBytes" => (
                    "Browser.V1.WorkspaceCommand",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "workspaceQueryBytes" => (
                    "Browser.V1.WorkspaceQuery",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "workspaceEnvelopeBytes" => (
                    "Browser.V1.WorkspaceEnvelope",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "workspaceJournalBytes" => (
                    "Browser.V1.WorkspaceJournal",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "workspaceInteractionBytes" | "workspacePresentationBytes" => (
                    "View.Workspace.V1.Interaction",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "publicationLinkageWireBytes" => (
                    "PublicationAdmission.LinkageV1Wire",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "publicationWireBytes" => (
                    "PublicationAdmission.V1Wire",
                    "fn(Vec<u8>) -> Result<Vec<u8>, ComputeError>",
                ),
                "publicationContextFieldsPreimage" => (
                    "PublicationAdmission.V1Wire",
                    "fn(&PublicationDeclaration, Vec<u8>, &PublicationSubject, Vec<u8>, Vec<u8>, String) -> Result<Result<Vec<u8>, CborError>, ComputeError>",
                ),
                "appendBytes" => ("Bytes", "fn(Vec<u8>, Vec<u8>) -> Vec<u8>"),
                "byteAt" => ("Bytes", "fn(Vec<u8>, u64) -> Option<u8>"),
                "byteLength" => ("Bytes", "fn(Vec<u8>) -> u64"),
                "compareBytes" => ("Bytes", "fn(Vec<u8>, Vec<u8>) -> core::cmp::Ordering"),
                "sliceBytes" => ("Bytes", "fn(Vec<u8>, u64, u64) -> Option<Vec<u8>>"),
                "formatInt64" => ("Codec", "fn(i64) -> String"),
                "parseInt64" => ("Codec", "fn(String) -> Option<i64>"),
                "portableTrue" => ("Core", "fn() -> bool"),
                "applicationSecurityEdition"
                | "architectureEdition"
                | "controlEdition"
                | "qualityEdition"
                | "riskEdition" => ("Holo.StandardsProfile", "fn(StandardsProfile) -> u64"),
                "contractName" => ("Holo.V1.CoreWasm", "fn() -> String"),
                "browserAppManifest" => ("Holo.V1.BrowserWire", "fn(Vec<u8>, Vec<u8>, Vec<u8>) -> Option<Vec<u8>>"),
                "browserArchiveBody" => ("Holo.V1.BrowserWire", "fn(Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "browserArchiveBodyBytes" | "browserArchiveFooter" => ("Holo.V1.BrowserWire", "fn(Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "browserArchiveExtension" | "browserArchiveSection" | "browserManifestReference" => ("Holo.V1.BrowserWire", "fn(Vec<u8>, u64) -> Result<Option<Vec<u8>>, ComputeError>"),
                "browserFrameArchive" => ("Holo.V1.BrowserWire", "fn(Vec<u8>, Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "browserValidAppManifest" => ("Holo.V1.BrowserWire", "fn(&[u8]) -> bool"),
                "browserValidArchiveBody" | "browserValidArchiveFrame" => ("Holo.V1.BrowserWire", "fn(&[u8]) -> Result<bool, ComputeError>"),
                "appManifest" => ("Holo.V1.Wire", "fn(Vec<u8>, Vec<u8>, Vec<u8>) -> Option<Vec<u8>>"),
                "archiveBody" => ("Holo.V1.Wire", "fn(Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>, Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "archiveBodyBytes" => ("Holo.V1.Wire", "fn(Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "archiveExtension" => ("Holo.V1.Wire", "fn(Vec<u8>, u64) -> Result<Option<Vec<u8>>, ComputeError>"),
                "archiveFooter" => ("Holo.V1.Wire", "fn(Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "archiveSection" => ("Holo.V1.Wire", "fn(Vec<u8>, u64) -> Result<Option<Vec<u8>>, ComputeError>"),
                "contentBlob" => ("Holo.V1.Wire", "fn(Vec<u8>, Vec<u8>) -> Option<Vec<u8>>"),
                "contentBlobBytes" => ("Holo.V1.Wire", "fn(Vec<u8>) -> Option<Vec<u8>>"),
                "contentBlobLabel" => ("Holo.V1.Wire", "fn(Vec<u8>) -> Option<Vec<u8>>"),
                "emptyCapabilities" => ("Holo.V1.Wire", "fn() -> Vec<u8>"),
                "frameArchive" => ("Holo.V1.Wire", "fn(Vec<u8>, Vec<u8>) -> Result<Option<Vec<u8>>, ComputeError>"),
                "manifestReference" => ("Holo.V1.Wire", "fn(Vec<u8>, u64) -> Result<Option<Vec<u8>>, ComputeError>"),
                "validAppManifest" => ("Holo.V1.Wire", "fn(&[u8]) -> bool"),
                "validArchiveBody" => ("Holo.V1.Wire", "fn(&[u8]) -> Result<bool, ComputeError>"),
                "validArchiveFrame" => ("Holo.V1.Wire", "fn(&[u8]) -> Result<bool, ComputeError>"),
                "checkedAddInt64"
                | "checkedDivideInt64"
                | "checkedMultiplyInt64"
                | "checkedSubtractInt64" => ("Integer", "fn(i64, i64) -> Option<i64>"),
                "checkedNegateInt64" => ("Integer", "fn(i64) -> Option<i64>"),
                "decode" => ("Utf8", "fn(Vec<u8>) -> Option<String>"),
                "encode" => ("Utf8", "fn(String) -> Vec<u8>"),
                _ => return Err(invalid()),
            };
            let namespace = match row.rust_name.as_str() {
                "publicationLinkageWireBytes"
                | "publicationWireBytes"
                | "publicationContextFieldsPreimage" => "Production",
                _ => "Foundation",
            };
            if row.lean_name != format!("PrismPM.{namespace}.{module}.{}", row.rust_name)
                || row.rust_signature != signature
                || !names.insert(&row.rust_name)
            {
                return Err(invalid());
            }
        }
        Ok(())
    }

    /// Canonical complete native export request; validator accounting is unchanged.
    pub fn union_with_runtime(&self, runtime_roots: &[String]) -> Result<Vec<String>, ModelError> {
        self.check()?;
        Ok(runtime_roots
            .iter()
            .cloned()
            .chain(self.export.iter().map(|row| row.lean_name.clone()))
            .collect::<BTreeSet<_>>()
            .into_iter()
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SOURCE: &str = include_str!("../../../model/stdlib-exports.toml");

    #[test]
    fn stdlib_exports_preserve_every_original_entry_point() {
        let exports: StdlibExports = toml::from_str(SOURCE).unwrap();
        exports.check().unwrap();
        for index in 0..exports.export.len() {
            let mut missing = exports.clone();
            missing.export.remove(index);
            assert!(
                missing.check().is_err(),
                "accepted omitted legacy export {index}"
            );
            let mut changed = exports.clone();
            changed.export[index].rust_signature.push(' ');
            assert!(changed.check().is_err(), "accepted changed ABI {index}");
        }
        for mutation in 0..5 {
            let mut changed = exports.clone();
            match mutation {
                0 => changed.export[0].rust_signature = "fn(&[u8], &[u8]) -> Vec<u8>".to_owned(),
                1 => {
                    changed.export[0].lean_name = "PrismPM.Foundation.Core.portableTrue".to_owned()
                }
                2 => changed.export[0].rust_name = "replacement".to_owned(),
                3 => changed.export[1] = changed.export[0].clone(),
                4 => changed.export.swap(0, 1),
                _ => unreachable!(),
            }
            assert!(changed.check().is_err(), "accepted mutation {mutation}");
        }
    }

    #[test]
    fn stdlib_exports_are_closed_and_separate_from_validator_roots() {
        let exports: StdlibExports = toml::from_str(SOURCE).unwrap();
        let runtime = vec!["PrismPM.Foundation.Holo.validateComponentIndexes".to_owned()];
        let union = exports.union_with_runtime(&runtime).unwrap();
        assert_eq!(union.len(), 67);
        assert_eq!(runtime.len(), 1);
        assert!(union.contains(&runtime[0]));
        let mut document: toml::Value = toml::from_str(SOURCE).unwrap();
        document
            .as_table_mut()
            .unwrap()
            .insert("unexpected".to_owned(), true.into());
        assert!(document.try_into::<StdlibExports>().is_err());
        let mut document: toml::Value = toml::from_str(SOURCE).unwrap();
        document["export"][0]
            .as_table_mut()
            .unwrap()
            .insert("unchecked".to_owned(), true.into());
        assert!(document.try_into::<StdlibExports>().is_err());
    }
}
