//! The checked control set as an OSCAL 1.1.0 component definition.
//!
//! The emitter is total over a checked model and reads no clock: every UUID is
//! derived by SHA-256 from identifiers and content, and the last-modified time
//! is the model's own statement, so one model produces one byte sequence.

use super::{Control, Declared};
use crate::error::PrismError;
use crate::holo::canonical::encode_value;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

/// The build artifact path of the document.
pub(super) const ARTIFACT: &str = "oscal/component-definition.json";

const OSCAL_VERSION: &str = "1.1.0";
/// The namespace of the properties PrismPM adds.
const NAMESPACE: &str = "https://schemas.uor.foundation/prismpm/oscal";
/// What a reader may and may not conclude from this document (SPEC §10.1).
const SCOPE: &str = "Emitted by PrismPM from a checked threat model. It states the controls and evidence the model declares. It does not establish that a control is implemented or that its evidence is true.";

/// A version-5 shaped UUID derived from `kind` and `seed`.
fn uuid(kind: &str, seed: &str) -> String {
    let mut hasher = Sha256::new();
    for part in ["prismpm/oscal-uuid/1", kind, seed] {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part.as_bytes());
    }
    let digest = hasher.finalize();
    let mut bytes = [0_u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x50;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    let hex: String = bytes.iter().map(|byte| format!("{byte:02x}")).collect();
    format!(
        "{}-{}-{}-{}-{}",
        &hex[..8],
        &hex[8..12],
        &hex[12..16],
        &hex[16..20],
        &hex[20..]
    )
}

/// An OSCAL token: a qualified identifier is not one, because of its colons.
fn token(id: &str) -> String {
    id.replace("::", ".")
}

fn property(name: &str, class: Option<&str>, value: &str) -> Value {
    let mut row = json!({"name": name, "ns": NAMESPACE, "value": value});
    if let Some(class) = class {
        row["class"] = json!(class);
    }
    row
}

fn requirement(declared: &Declared, id: &str, control: &Control) -> Value {
    let mut props: Vec<Value> = control
        .evidence
        .iter()
        .map(|row| property("evidence", Some(&row.kind), &row.reference))
        .collect();
    for (threat, controls) in &declared.mappings {
        if controls.iter().any(|name| name == id) {
            let row = &declared.threats[threat];
            props.push(property("threat", Some(&row.category), &row.described.name));
        }
    }
    json!({
        "uuid": uuid("implemented-requirement", id),
        "control-id": token(id),
        "description": control.described.text,
        "props": props,
        "remarks": control.described.name,
    })
}

/// Accepted risks are stated beside the controls, so that a reader cannot take
/// them for mitigated threats.
fn remarks(declared: &Declared) -> Option<String> {
    if declared.accepted.is_empty() {
        return None;
    }
    let mut out = String::from("Accepted risks:\n");
    for (id, rationale) in &declared.accepted {
        let row = &declared.threats[id];
        out.push_str(&format!(
            "\n- {} ({}): {rationale}",
            row.described.name, row.category
        ));
    }
    Some(out)
}

/// Encode the component definition of a checked model.
pub(super) fn component_definition(declared: &Declared) -> Result<Vec<u8>, PrismError> {
    let set = &declared.control_sets[0];
    let source = uuid("control-source", &set.id);
    let mut component = json!({
        "uuid": uuid("component", &set.id),
        "type": "software",
        "title": set.title,
        "description": set.text,
    });
    let assets: Vec<Value> = declared
        .assets
        .values()
        .map(|row| property("asset", None, &row.name))
        .collect();
    if !assets.is_empty() {
        component["props"] = json!(assets);
    }
    if let Some(remarks) = remarks(declared) {
        component["remarks"] = json!(remarks);
    }
    let mut definition = json!({
        "metadata": {
            "title": set.title,
            "last-modified": set.last_modified,
            "version": set.version,
            "oscal-version": OSCAL_VERSION,
            "remarks": SCOPE,
        },
    });
    if !declared.controls.is_empty() {
        let requirements: Vec<Value> = declared
            .controls
            .iter()
            .map(|(id, control)| requirement(declared, id, control))
            .collect();
        component["control-implementations"] = json!([{
            "uuid": uuid("control-implementation", &set.id),
            "source": format!("#{source}"),
            "description": set.text,
            "implemented-requirements": requirements,
        }]);
        definition["back-matter"] = json!({"resources": [{
            "uuid": source,
            "title": set.title,
            "description": "The controls of this document are declared by the model that emitted it, not by a published catalog.",
        }]});
    }
    definition["components"] = json!([component]);
    // The document identity follows its content; every other UUID follows the
    // identity of what it names.
    let body = encode_value(&definition)?;
    definition["uuid"] = json!(uuid(
        "component-definition",
        &format!("{:x}", Sha256::digest(&body))
    ));
    encode_value(&json!({"component-definition": definition}))
}
