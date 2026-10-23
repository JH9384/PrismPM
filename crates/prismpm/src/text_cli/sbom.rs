//! SPDX 3.0.1 bill of materials of a built text command line.
//!
//! The document names the program package, every locked dependency with its
//! registry checksum, and each published program and lock file with its
//! SHA-256 digest. It is derived only from the built bytes, so verification
//! regenerates it byte for byte.

use super::{binary_path, BuiltCli};
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use crate::holo::model_document::TextApplicationModel;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// Published path of the bill of materials.
pub(crate) const SBOM_PATH: &str = "cli/sbom.spdx.json";

fn digest(bytes: &[u8]) -> Value {
    json!([{
        "algorithm": "sha256",
        "hashValue": format!("{:x}", Sha256::digest(bytes)),
        "type": "Hash"
    }])
}

fn locked_packages(lock: &[u8]) -> Result<Vec<(String, String, Option<String>)>, PrismError> {
    let text = std::str::from_utf8(lock)
        .map_err(|error| PrismError::new("PP4102", format!("command-line lock: {error}")))?;
    let value: toml::Value = toml::from_str(text)
        .map_err(|error| PrismError::new("PP4102", format!("command-line lock: {error}")))?;
    let packages = value
        .get("package")
        .and_then(toml::Value::as_array)
        .ok_or_else(|| PrismError::new("PP4102", "command-line lock has no packages"))?;
    packages
        .iter()
        .map(|package| {
            let field = |name: &str| package.get(name).and_then(toml::Value::as_str);
            match (field("name"), field("version")) {
                (Some(name), Some(version)) => Ok((
                    name.to_owned(),
                    version.to_owned(),
                    field("checksum").map(str::to_owned),
                )),
                _ => Err(PrismError::new(
                    "PP4102",
                    "command-line lock package lacks a name or version",
                )),
            }
        })
        .collect()
}

/// Render the document for a built command line.
pub(crate) fn sbom(
    application: &TextApplicationModel,
    built: &BuiltCli,
) -> Result<Vec<u8>, PrismError> {
    let creation = json!({
        "comment": "Reproducible-build epoch; wall-clock observations are excluded from deterministic artifacts",
        "created": "1970-01-01T00:00:00Z",
        "createdBy": ["https://github.com/UOR-Foundation/PrismPM"],
        "specVersion": "3.0.1",
        "type": "CreationInfo"
    });
    let document = format!("urn:spdx:{}-cli:document", application.cargo_name);
    let root = format!("urn:spdx:{}-cli", application.cargo_name);
    let mut graph = Vec::new();
    let mut elements = vec![root.clone()];
    graph.push(json!({
        "creationInfo": creation,
        "name": format!("{}-cli", application.cargo_name),
        "software_packageVersion": application.cargo_version,
        "spdxId": root,
        "type": "software_Package"
    }));
    let mut relationship = |kind: &str, from: &str, to: &str| {
        graph.push(json!({
            "creationInfo": creation,
            "from": from,
            "relationshipType": kind,
            "spdxId": format!("{from}:{kind}:{to}"),
            "to": [to],
            "type": "Relationship"
        }));
    };
    relationship("describes", &document, &root);
    let mut files = Vec::new();
    for (target, bytes) in &built.binaries {
        files.push((
            binary_path(target, application),
            bytes.as_slice(),
            "executable",
        ));
    }
    files.push(("cli/Cargo.lock".to_owned(), built.lock.as_slice(), "source"));
    let mut nodes = Vec::new();
    for (path, bytes, purpose) in files {
        let id = format!("urn:spdx:file:{path}");
        nodes.push(json!({
            "creationInfo": creation,
            "name": path,
            "software_primaryPurpose": purpose,
            "spdxId": id,
            "type": "software_File",
            "verifiedUsing": digest(bytes)
        }));
        relationship("contains", &root, &id);
        elements.push(id);
    }
    let own = format!("{}-cli", application.cargo_name);
    for (name, version, checksum) in locked_packages(&built.lock)? {
        if name == own {
            continue;
        }
        let id = format!("urn:spdx:package:{name}:{version}");
        let mut package = json!({
            "creationInfo": creation,
            "name": name,
            "software_packageVersion": version,
            "spdxId": id,
            "type": "software_Package"
        });
        if let Some(checksum) = checksum {
            package["verifiedUsing"] = json!([{
                "algorithm": "sha256",
                "hashValue": checksum,
                "type": "Hash"
            }]);
        }
        nodes.push(package);
        relationship("dependsOn", &root, &id);
        elements.push(id);
    }
    graph.extend(nodes);
    graph.push(json!({
        "creationInfo": creation,
        "element": elements,
        "name": own,
        "profileConformance": ["core", "software"],
        "rootElement": [root],
        "spdxId": document,
        "type": "SpdxDocument"
    }));
    graph.sort_by(|left, right| left["spdxId"].as_str().cmp(&right["spdxId"].as_str()));
    encode_value(&json!({
        "@context": "https://spdx.org/rdf/3.0.1/spdx-context.jsonld",
        "@graph": graph
    }))
}
