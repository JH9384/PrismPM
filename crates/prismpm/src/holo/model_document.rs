//! Owned DTOs for the closed, versioned non-Holo canonical model documents.

use serde::{Deserialize, Serialize};

/// Top-level Prism model document. Its domain sections contain only canonical
/// arrays; verification evidence is deliberately kept outside this format.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelDocument {
    /// Schema discriminator.
    pub schema: String,
    /// Compiler and projection provenance.
    pub provenance: ProjectionProvenance,
    /// Exact, fixed standards profile identifiers.
    pub standards_profile: Vec<String>,
    /// Architecture records.
    pub architecture: ArchitectureModel,
    /// Security and risk records.
    pub security: SecurityModel,
    /// Product-quality records.
    pub quality: QualityModel,
    /// Closed portable application declaration, when this is an application model.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub application: Option<Application>,
    /// Explicit native-only library, never an application or a deployed system.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_library"
    )]
    pub library: Option<ModelLibrary>,
}

fn present_library<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<ModelLibrary>, D::Error> {
    ModelLibrary::deserialize(deserializer).map(Some)
}

/// Closed metadata for model-owned, typed native exports and finite acceptance roots.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ModelLibrary {
    /// Exact native-library profile identifier.
    pub profile: String,
    /// Display name; not a filesystem path.
    pub name: String,
    /// Generated Cargo package name.
    pub cargo_name: String,
    /// Exact stable generated package version.
    pub cargo_version: String,
    /// Generated package description.
    pub cargo_description: String,
    /// HTTPS source repository.
    pub cargo_repository: String,
    /// HTTPS project homepage.
    pub cargo_homepage: String,
    /// Sorted fully qualified executable definitions in the bound semantic graph.
    pub export_roots: Vec<String>,
    /// Sorted exported zero-argument Boolean definitions that must all return true.
    pub acceptance_roots: Vec<String>,
}

/// Closed application profiles. The legacy variant retains its original JSON shape.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum Application {
    /// Original numeric portable application declaration.
    Legacy(Box<ApplicationModel>),
    /// Explicit UTF-8 byte-request application declaration.
    Text(Box<TextApplicationModel>),
    /// Source-owned browser orchestration declaration; runtime remains unavailable.
    Browser(Box<super::browser_application::BrowserApplication>),
}

impl Application {
    /// Human-facing application name.
    pub fn name(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.name,
            Self::Text(value) => &value.name,
            Self::Browser(value) => &value.name,
        }
    }

    /// Generated registry package name.
    pub fn cargo_name(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.cargo_name,
            Self::Text(value) => &value.cargo_name,
            Self::Browser(value) => &value.cargo_name,
        }
    }

    /// Generated registry package version.
    pub fn cargo_version(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.cargo_version,
            Self::Text(value) => &value.cargo_version,
            Self::Browser(value) => &value.cargo_version,
        }
    }

    /// Generated package description.
    pub fn cargo_description(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.cargo_description,
            Self::Text(value) => &value.cargo_description,
            Self::Browser(value) => &value.cargo_description,
        }
    }

    /// Canonical package source repository URL.
    pub fn cargo_repository(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.cargo_repository,
            Self::Text(value) => &value.cargo_repository,
            Self::Browser(value) => &value.cargo_repository,
        }
    }

    /// Canonical package homepage URL.
    pub fn cargo_homepage(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.cargo_homepage,
            Self::Text(value) => &value.cargo_homepage,
            Self::Browser(value) => &value.cargo_homepage,
        }
    }

    /// Fully qualified generated library roots in bytewise order.
    pub fn library_roots(&self) -> &Vec<String> {
        match self {
            Self::Legacy(value) => &value.library_roots,
            Self::Text(value) => &value.library_roots,
            Self::Browser(value) => &value.library_roots,
        }
    }

    /// Application-owned byte-level acceptance corpus.
    pub fn acceptance_vectors(&self) -> &Vec<ApplicationAcceptanceVector> {
        match self {
            Self::Legacy(value) => &value.acceptance_vectors,
            Self::Text(value) => &value.acceptance_vectors,
            Self::Browser(value) => &value.acceptance_vectors,
        }
    }

    /// Fully qualified generated byte request dispatcher.
    pub fn entry_root(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.entry_root,
            Self::Text(value) => &value.entry_root,
            Self::Browser(value) => &value.entry_root,
        }
    }

    /// Hologram guest contract.
    pub fn core_contract(&self) -> &String {
        match self {
            Self::Legacy(value) => &value.core_contract,
            Self::Text(value) => &value.core_contract,
            Self::Browser(value) => &value.core_contract,
        }
    }

    /// Maximum UTF-8 request byte length.
    pub fn request_maximum(&self) -> u32 {
        match self {
            Self::Legacy(value) => value.request_maximum,
            Self::Text(value) => value.request_maximum,
            Self::Browser(value) => value.request_maximum,
        }
    }

    /// Maximum UTF-8 response byte length.
    pub fn response_maximum(&self) -> u32 {
        match self {
            Self::Legacy(value) => value.response_maximum,
            Self::Text(value) => value.response_maximum,
            Self::Browser(value) => value.response_maximum,
        }
    }

    /// Guest input allocation cap.
    pub fn guest_allocation_maximum(&self) -> u32 {
        match self {
            Self::Legacy(value) => value.guest_allocation_maximum,
            Self::Text(value) => value.guest_allocation_maximum,
            Self::Browser(value) => value.guest_allocation_maximum,
        }
    }

    /// Whether the capability request is canonically empty.
    pub fn capabilities_empty(&self) -> bool {
        match self {
            Self::Legacy(value) => value.capabilities_empty,
            Self::Text(value) => value.capabilities_empty,
            Self::Browser(value) => value.capabilities_empty,
        }
    }

    /// Whether the application requests a composed fat archive.
    pub fn fat_archive(&self) -> bool {
        match self {
            Self::Legacy(value) => value.fat_archive,
            Self::Text(value) => value.fat_archive,
            Self::Browser(value) => value.fat_archive,
        }
    }

    /// Zero-based primary layer.
    pub fn primary_layer(&self) -> u8 {
        match self {
            Self::Legacy(value) => value.primary_layer,
            Self::Text(value) => value.primary_layer,
            Self::Browser(value) => value.primary_layer,
        }
    }

    /// Zero-based View layer.
    pub fn view_layer(&self) -> u8 {
        match self {
            Self::Legacy(value) => value.view_layer,
            Self::Text(value) => value.view_layer,
            Self::Browser(value) => value.view_layer,
        }
    }

    /// Core-Wasm guest memory bound; legacy profiles retain 32 pages.
    pub fn core_memory_pages(&self) -> u32 {
        match self {
            Self::Text(value) if value.has_resource_bounds() => {
                value.core_memory_pages.unwrap_or(32)
            }
            _ => 32,
        }
    }

    /// Explicit Core-Wasm linear-memory stack bound, present for text/2 and text/3.
    pub fn core_stack_bytes(&self) -> Option<u32> {
        match self {
            Self::Text(value) if value.has_resource_bounds() => value.core_stack_bytes,
            _ => None,
        }
    }

    /// Modeled guided workbench, present only when a text/3 application declares one.
    pub fn workbench(&self) -> Option<super::workbench::WorkbenchApplication> {
        match self {
            Self::Text(value) => value.workbench_application(),
            _ => None,
        }
    }

    /// Modeled command-line surface, present only for text/3.
    pub fn cli(&self) -> Option<&super::text_cli::TextCli> {
        match self {
            Self::Text(value) => value.cli.as_ref(),
            _ => None,
        }
    }
}

fn present_resource_bound<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<u32>, D::Error> {
    u32::deserialize(deserializer).map(Some)
}

/// A capability-free UTF-8 byte-request application, independent of domain semantics.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextApplicationModel {
    /// Exact immutable text profile identifier.
    pub profile: String,
    /// Human-facing application name.
    pub name: String,
    /// Generated registry package name.
    pub cargo_name: String,
    /// Generated registry package version.
    pub cargo_version: String,
    /// Generated package description.
    pub cargo_description: String,
    /// Canonical package source repository URL.
    pub cargo_repository: String,
    /// Canonical package homepage URL.
    pub cargo_homepage: String,
    /// Fully qualified generated library roots in bytewise order.
    pub library_roots: Vec<String>,
    /// Application-owned byte-level acceptance corpus.
    pub acceptance_vectors: Vec<ApplicationAcceptanceVector>,
    /// Fully qualified generated byte request dispatcher.
    pub entry_root: String,
    /// Hologram guest contract.
    pub core_contract: String,
    /// Maximum UTF-8 request byte length.
    pub request_maximum: u32,
    /// Maximum UTF-8 response byte length.
    pub response_maximum: u32,
    /// Guest input allocation cap.
    pub guest_allocation_maximum: u32,
    /// Explicit Core-Wasm guest memory pages, required by text/2 and text/3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_resource_bound"
    )]
    pub core_memory_pages: Option<u32>,
    /// Explicit Core-Wasm linear-memory stack bytes, required by text/2 and text/3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_resource_bound"
    )]
    pub core_stack_bytes: Option<u32>,
    /// Whether the capability request is canonically empty.
    pub capabilities_empty: bool,
    /// Whether the application requests a composed fat archive.
    pub fat_archive: bool,
    /// Zero-based primary layer.
    pub primary_layer: u8,
    /// Zero-based View layer.
    pub view_layer: u8,
    /// Text presentation metadata; byte bounds are owned by the application.
    pub view: TextView,
    /// Modeled command-line surface, required only by text/3.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_cli"
    )]
    pub cli: Option<super::text_cli::TextCli>,
    /// Optional modeled guided workbench, admitted only by text/3. When absent
    /// the text/3 browser page is the unchanged Text/1 six-file page.
    #[serde(
        default,
        skip_serializing_if = "Option::is_none",
        deserialize_with = "present_workbench"
    )]
    pub workbench: Option<super::workbench::WorkbenchView>,
}

impl TextApplicationModel {
    /// The guided workbench application, present only when text/3 declares one.
    /// It is a derived view of this record, never a second application value.
    pub fn workbench_application(&self) -> Option<super::workbench::WorkbenchApplication> {
        let view = self.workbench.clone()?;
        Some(super::workbench::WorkbenchApplication {
            profile: self.profile.clone(),
            name: self.name.clone(),
            cargo_name: self.cargo_name.clone(),
            cargo_version: self.cargo_version.clone(),
            cargo_description: self.cargo_description.clone(),
            cargo_repository: self.cargo_repository.clone(),
            cargo_homepage: self.cargo_homepage.clone(),
            library_roots: self.library_roots.clone(),
            acceptance_vectors: self.acceptance_vectors.clone(),
            entry_root: self.entry_root.clone(),
            core_contract: self.core_contract.clone(),
            request_maximum: self.request_maximum,
            response_maximum: self.response_maximum,
            guest_allocation_maximum: self.guest_allocation_maximum,
            core_memory_pages: self.core_memory_pages?,
            core_stack_bytes: self.core_stack_bytes?,
            capabilities_empty: self.capabilities_empty,
            fat_archive: self.fat_archive,
            primary_layer: self.primary_layer,
            view_layer: self.view_layer,
            view,
        })
    }

    /// Whether the profile carries explicit Core-Wasm resource bounds.
    pub fn has_resource_bounds(&self) -> bool {
        matches!(
            self.profile.as_str(),
            "prismpm/text-application/2" | "prismpm/text-application/3"
        )
    }
}

fn present_workbench<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<super::workbench::WorkbenchView>, D::Error> {
    super::workbench::WorkbenchView::deserialize(deserializer).map(Some)
}

fn present_cli<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Option<super::text_cli::TextCli>, D::Error> {
    super::text_cli::TextCli::deserialize(deserializer).map(Some)
}

/// Closed presentation metadata for the UTF-8 text-request View.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct TextView {
    /// Document title.
    pub title: String,
    /// Visible level-one heading.
    pub heading: String,
    /// Request field label.
    pub input_label: String,
    /// Submit-control label.
    pub submit_label: String,
    /// Response region label.
    pub output_label: String,
    /// Invalid or oversized input message.
    pub input_error: String,
    /// Invalid, oversized, or failed response message.
    pub response_error: String,
}

/// A closed, evaluated Prism application projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicationModel {
    /// Human-facing application name.
    pub name: String,
    /// Generated registry package name.
    pub cargo_name: String,
    /// Generated registry package version.
    pub cargo_version: String,
    /// Generated package description.
    pub cargo_description: String,
    /// Canonical source repository URL written to package metadata.
    pub cargo_repository: String,
    /// Canonical project homepage URL written to package metadata.
    pub cargo_homepage: String,
    /// Fully qualified generated library roots, in bytewise order.
    pub library_roots: Vec<String>,
    /// Generated Rust operation-enum name used by target adapters.
    pub operation_type: String,
    /// Generated Rust domain-error name used by target adapters.
    pub error_type: String,
    /// Generated Rust function name used by target adapters.
    pub function_name: String,
    /// Ordered application-owned request/response acceptance corpus.
    pub acceptance_vectors: Vec<ApplicationAcceptanceVector>,
    /// Fully qualified generated request dispatcher.
    pub entry_root: String,
    /// Hologram guest contract.
    pub core_contract: String,
    /// Maximum canonical request size.
    pub request_maximum: u32,
    /// Maximum canonical response size.
    pub response_maximum: u32,
    /// Guest input allocation cap.
    pub guest_allocation_maximum: u32,
    /// Whether the capability request is canonically empty.
    pub capabilities_empty: bool,
    /// Whether this application requests a composed fat archive.
    pub fat_archive: bool,
    /// Zero-based primary layer.
    pub primary_layer: u8,
    /// Zero-based View layer.
    pub view_layer: u8,
    /// Evaluated, transport-independent View.
    pub view: ApplicationView,
    /// Closed input-grammar constructor.
    pub input_grammar: String,
    /// Closed live-region mode constructor.
    pub live_mode: String,
    /// Closed layout style constructor.
    pub layout: String,
    /// Closed color style constructor.
    pub color: String,
    /// Closed typography style constructor.
    pub typography: String,
    /// Ordered closed actions.
    pub actions: Vec<String>,
    /// Ordered presentation targets.
    pub targets: Vec<String>,
}

/// One canonical byte-level application acceptance vector.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicationAcceptanceVector {
    /// Canonical or deliberately malformed request bytes.
    pub request: Vec<u8>,
    /// Exact modeled response bytes.
    pub response: Vec<u8>,
}

/// Evaluated View fields shared by Hologram and browser projections.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicationView {
    /// Document title.
    pub title: String,
    /// Visible level-one heading.
    pub heading: String,
    /// Left operand label.
    pub left_label: String,
    /// Right operand label.
    pub right_label: String,
    /// Operation selector label.
    pub operation_label: String,
    /// Submit-control label.
    pub submit_label: String,
    /// Invalid-input message.
    pub input_error: String,
    /// Division-by-zero message.
    pub division_error: String,
    /// Overflow message.
    pub overflow_error: String,
    /// Closed operation options in presentation order.
    pub operations: Vec<ApplicationViewOperation>,
    /// Discriminant selected when the View is initialized.
    pub initial_operation: u8,
    /// Whether results use a polite live region.
    pub live_polite: bool,
    /// Whether action completion preserves usable focus.
    pub retain_focus: bool,
    /// Whether Enter submits the form.
    pub submit_on_enter: bool,
    /// Whether the Hologram projection uses intent v1.
    pub hologram_intent: bool,
    /// Whether the Pages projection uses the generated browser adapter.
    pub pages_adapter: bool,
}

/// One operation option projected from the typed application View.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ApplicationViewOperation {
    /// Human-facing option label.
    pub label: String,
    /// Canonical request-protocol spelling.
    pub request_name: String,
    /// Generated Rust enum variant.
    pub rust_variant: String,
    /// Stable wire/API discriminant.
    pub discriminant: u8,
}

/// Provenance that determines projection bytes.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ProjectionProvenance {
    /// LexLean source identity.
    pub source_id: String,
    /// LexLean linked-semantic identity.
    pub semantic_id: String,
    /// LexLean compiler-semantics identity.
    pub compiler_semantics_id: String,
    /// SHA-256 identity of the semantic snapshot bytes.
    pub snapshot_id: String,
    /// Prism Holo emitter-semantics identity.
    pub emitter_semantics_id: String,
    /// Exact facet package closure.
    pub facet_packages: Vec<FacetPackage>,
}

/// One exact facet package used by the projection.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct FacetPackage {
    /// Package identifier.
    pub package: String,
    /// Semantic version.
    pub version: String,
    /// Canonical package tree digest.
    pub content_id: String,
}

/// Architecture section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct ArchitectureModel {
    /// Fixed component-kind catalog.
    pub component_kinds: Vec<CatalogRecord>,
    /// Fixed edge-kind catalog.
    pub edge_kinds: Vec<CatalogRecord>,
    /// Fixed model-kind catalog.
    pub model_kinds: Vec<CatalogRecord>,
    /// Components.
    pub components: Vec<ComponentRecord>,
    /// Edges.
    pub edges: Vec<EdgeRecord>,
    /// Stakeholders.
    pub stakeholders: Vec<IndexedRecord>,
    /// Concerns.
    pub concerns: Vec<IndexedRecord>,
    /// Viewpoints.
    pub viewpoints: Vec<ViewpointRecord>,
    /// Views.
    pub views: Vec<ViewRecord>,
}

/// Security and risk section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct SecurityModel {
    /// Likelihood catalog.
    pub likelihoods: Vec<CatalogRecord>,
    /// Impact catalog.
    pub impacts: Vec<CatalogRecord>,
    /// Assets.
    pub assets: Vec<AssetRecord>,
    /// Threats.
    pub threats: Vec<IndexedRecord>,
    /// Risks.
    pub risks: Vec<RiskRecord>,
    /// Application-security controls.
    pub controls: Vec<ControlRecord>,
    /// Security activities.
    pub activities: Vec<ActivityRecord>,
    /// Verification measurements.
    pub measurements: Vec<MeasurementRecord>,
}

/// Product-quality section.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(deny_unknown_fields)]
pub struct QualityModel {
    /// Product-quality characteristics.
    pub characteristics: Vec<IndexedRecord>,
    /// Product-quality subcharacteristics.
    pub subcharacteristics: Vec<SubcharacteristicRecord>,
    /// Quality requirements.
    pub requirements: Vec<RequirementRecord>,
    /// Measures.
    pub measures: Vec<MeasureRecord>,
}

/// A fixed catalog value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CatalogRecord {
    /// Qualified package-entry identifier.
    pub id: String,
    /// Canonical zero-based index.
    pub index: u64,
}

/// An entity carrying only identity and canonical index.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct IndexedRecord {
    /// Qualified `<module>::<component>` identifier.
    pub id: String,
    /// Canonical zero-based index.
    pub index: u64,
}

/// Architectural component.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ComponentRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Qualified component-kind catalog identifier.
    pub kind_id: String,
}

/// Architectural edge.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct EdgeRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Source component index.
    pub from_index: u64,
    /// Target component index.
    pub to_index: u64,
    /// Qualified edge-kind catalog identifier.
    pub kind_id: String,
}

/// Architecture viewpoint.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewpointRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Stakeholder index.
    pub stakeholder_index: u64,
    /// Concern index.
    pub concern_index: u64,
    /// Model-kind index.
    pub model_kind_index: u64,
}

/// Architecture view.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ViewRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Viewpoint index.
    pub viewpoint_index: u64,
    /// Model-kind index.
    pub model_kind_index: u64,
}

/// Security asset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AssetRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Owning component index.
    pub component_index: u64,
}

/// Risk.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RiskRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Asset index.
    pub asset_index: u64,
    /// Threat index.
    pub threat_index: u64,
    /// Qualified likelihood catalog ID.
    pub likelihood_id: String,
    /// Qualified impact catalog ID.
    pub impact_id: String,
}

/// Application-security control.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ControlRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Risk index.
    pub risk_index: u64,
}

/// Security activity.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct ActivityRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Control index.
    pub control_index: u64,
}

/// Verification measurement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasurementRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Control index.
    pub control_index: u64,
    /// Fixed observed Boolean for the reference model.
    pub passed: bool,
}

/// Product-quality subcharacteristic.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubcharacteristicRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Characteristic index.
    pub characteristic_index: u64,
}

/// Quality requirement.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct RequirementRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Subcharacteristic index.
    pub subcharacteristic_index: u64,
}

/// Quality measure.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MeasureRecord {
    /// Qualified entity identifier.
    pub id: String,
    /// Canonical index.
    pub index: u64,
    /// Requirement index.
    pub requirement_index: u64,
    /// Natural-number threshold.
    pub threshold: u64,
}
