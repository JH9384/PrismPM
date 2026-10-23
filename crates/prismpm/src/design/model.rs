//! Typed design-view records and their projection from linked declarations.
//!
//! The records are the `Foundation.Arch` design primitives: a `DesignView`
//! plus the OPM and UML elements that belong to it, and the `SystemProcess`
//! and `SystemState` declarations of the system model. Every cross-reference
//! is the qualified `<module>::<declaration>` identifier of the declaration it
//! names, the same identifier the model document gives to components, edges
//! and viewpoints.

use crate::error::PrismError;
use serde_json::Value;
use std::collections::BTreeMap;

/// The only module whose design primitives are projected.
const OWNER: &str = "Foundation.Arch";

/// A refusal of the design-view contract.
pub(super) fn refuse(message: impl Into<String>) -> PrismError {
    PrismError::new("PP2012", message)
}

/// The notation and diagram a view is drawn in.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum Diagram {
    OpmObjectProcess,
    UmlComponent,
    UmlSequence,
    UmlStateMachine,
}

/// OPM thing kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum ThingKind {
    Object,
    Process,
}

/// OPM link kind, in the order OPL sentences are emitted.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum LinkKind {
    Agent,
    Instrument,
    Consumption,
    Result,
    Effect,
    Invocation,
    Aggregation,
    Exhibition,
    Generalization,
    Classification,
}

/// UML message kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(super) enum MessageKind {
    Synchronous,
    Asynchronous,
    Reply,
}

/// One `DesignView`.
#[derive(Debug, Clone)]
pub(super) struct View {
    pub(super) id: String,
    pub(super) title: String,
    pub(super) viewpoint: String,
    pub(super) diagram: Diagram,
}

/// A `SystemProcess` or `SystemState`: a name owned by one component.
#[derive(Debug, Clone)]
pub(super) struct Owned {
    pub(super) id: String,
    pub(super) owner: String,
}

/// Which element of which view a record is, for refusal messages.
#[derive(Debug, Clone)]
pub(super) struct Origin {
    pub(super) record: String,
    pub(super) view: String,
}

#[derive(Debug, Clone)]
pub(super) struct OpmThing {
    pub(super) at: Origin,
    pub(super) kind: ThingKind,
    pub(super) subject: String,
}

#[derive(Debug, Clone)]
pub(super) struct OpmState {
    pub(super) at: Origin,
    pub(super) thing: String,
    pub(super) state: String,
}

#[derive(Debug, Clone)]
pub(super) struct OpmLink {
    pub(super) at: Origin,
    pub(super) kind: LinkKind,
    pub(super) source: String,
    pub(super) target: String,
}

#[derive(Debug, Clone)]
pub(super) struct OpmZoom {
    pub(super) at: Origin,
    pub(super) process: String,
    pub(super) subprocess: String,
    pub(super) order: u64,
}

#[derive(Debug, Clone)]
pub(super) struct UmlComponent {
    pub(super) at: Origin,
    pub(super) component: String,
}

#[derive(Debug, Clone)]
pub(super) struct UmlConnector {
    pub(super) at: Origin,
    pub(super) edge: String,
}

#[derive(Debug, Clone)]
pub(super) struct UmlLifeline {
    pub(super) at: Origin,
    pub(super) component: String,
    pub(super) order: u64,
}

#[derive(Debug, Clone)]
pub(super) struct UmlMessage {
    pub(super) at: Origin,
    pub(super) kind: MessageKind,
    pub(super) order: u64,
    pub(super) source: String,
    pub(super) target: String,
    pub(super) process: String,
}

#[derive(Debug, Clone)]
pub(super) struct UmlState {
    pub(super) at: Origin,
    pub(super) state: String,
    pub(super) initial: bool,
}

#[derive(Debug, Clone)]
pub(super) struct UmlTransition {
    pub(super) at: Origin,
    pub(super) order: u64,
    pub(super) source: String,
    pub(super) target: String,
    pub(super) trigger: String,
}

/// Every design primitive declared by the model, unchecked.
#[derive(Debug, Clone, Default)]
pub(super) struct Design {
    pub(super) views: BTreeMap<String, View>,
    pub(super) processes: BTreeMap<String, Owned>,
    pub(super) states: BTreeMap<String, Owned>,
    pub(super) opm_things: Vec<OpmThing>,
    pub(super) opm_states: Vec<OpmState>,
    pub(super) opm_links: Vec<OpmLink>,
    pub(super) opm_zooms: Vec<OpmZoom>,
    pub(super) uml_components: Vec<UmlComponent>,
    pub(super) uml_connectors: Vec<UmlConnector>,
    pub(super) uml_lifelines: Vec<UmlLifeline>,
    pub(super) uml_messages: Vec<UmlMessage>,
    pub(super) uml_states: Vec<UmlState>,
    pub(super) uml_transitions: Vec<UmlTransition>,
}

impl Design {
    /// True when the model declares no design primitive at all.
    pub(super) fn is_empty(&self) -> bool {
        self.views.is_empty()
            && self.processes.is_empty()
            && self.states.is_empty()
            && self.opm_things.is_empty()
            && self.opm_states.is_empty()
            && self.opm_links.is_empty()
            && self.opm_zooms.is_empty()
            && self.uml_components.is_empty()
            && self.uml_connectors.is_empty()
            && self.uml_lifelines.is_empty()
            && self.uml_messages.is_empty()
            && self.uml_states.is_empty()
            && self.uml_transitions.is_empty()
    }
}

/// The literal fields of one record definition.
struct Fields<'a> {
    id: &'a str,
    map: BTreeMap<&'a str, &'a Value>,
}

impl<'a> Fields<'a> {
    fn of(id: &'a str, linked: &'a Value) -> Result<Self, PrismError> {
        let body = linked
            .get("body")
            .filter(|body| body.get("kind").and_then(Value::as_str) == Some("record"))
            .ok_or_else(|| refuse(format!("{id}: design primitive is not a record literal")))?;
        let mut map = BTreeMap::new();
        for row in body
            .get("fields")
            .and_then(Value::as_array)
            .ok_or_else(|| refuse(format!("{id}: design primitive has no field list")))?
        {
            let name = row.get("field").and_then(Value::as_str);
            let value = row.get("value");
            match (name, value) {
                (Some(name), Some(value)) if map.insert(name, value).is_none() => {}
                _ => return Err(refuse(format!("{id}: design primitive field is malformed"))),
            }
        }
        Ok(Self { id, map })
    }

    fn value(&self, name: &str, kind: &str) -> Result<&'a Value, PrismError> {
        self.map
            .get(name)
            .copied()
            .filter(|value| value.get("kind").and_then(Value::as_str) == Some(kind))
            .ok_or_else(|| {
                refuse(format!(
                    "{}: field {name} is absent or not a literal {kind}",
                    self.id
                ))
            })
    }

    fn text(&self, name: &str) -> Result<String, PrismError> {
        self.value(name, "string")?
            .get("value")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| refuse(format!("{}: field {name} is malformed", self.id)))
    }

    fn nat(&self, name: &str) -> Result<u64, PrismError> {
        let text = self
            .value(name, "nat")?
            .get("value")
            .and_then(Value::as_str)
            .ok_or_else(|| refuse(format!("{}: field {name} is malformed", self.id)))?;
        if text != "0" && text.starts_with('0') {
            return Err(refuse(format!("{}: field {name} is noncanonical", self.id)));
        }
        text.parse()
            .map_err(|_| refuse(format!("{}: field {name} exceeds u64", self.id)))
    }

    fn flag(&self, name: &str) -> Result<bool, PrismError> {
        self.value(name, "bool")?
            .get("value")
            .and_then(Value::as_bool)
            .ok_or_else(|| refuse(format!("{}: field {name} is malformed", self.id)))
    }

    fn choice(&self, name: &str, owner: &str) -> Result<&'a str, PrismError> {
        self.value(name, "constructor")?
            .pointer("/constructor/name")
            .and_then(Value::as_str)
            .and_then(|value| value.strip_prefix(owner))
            .and_then(|value| value.strip_prefix('.'))
            .ok_or_else(|| refuse(format!("{}: field {name} is not a {owner}", self.id)))
    }

    fn origin(&self) -> Result<Origin, PrismError> {
        Ok(Origin {
            record: self.id.to_owned(),
            view: self.text("view")?,
        })
    }
}

fn diagram(fields: &Fields<'_>) -> Result<Diagram, PrismError> {
    match fields.choice("diagram", "DesignDiagram")? {
        "opmObjectProcess" => Ok(Diagram::OpmObjectProcess),
        "umlComponent" => Ok(Diagram::UmlComponent),
        "umlSequence" => Ok(Diagram::UmlSequence),
        "umlStateMachine" => Ok(Diagram::UmlStateMachine),
        other => Err(refuse(format!("{}: unknown diagram {other}", fields.id))),
    }
}

fn thing_kind(fields: &Fields<'_>) -> Result<ThingKind, PrismError> {
    match fields.choice("kind", "OpmThingKind")? {
        "object" => Ok(ThingKind::Object),
        "process" => Ok(ThingKind::Process),
        other => Err(refuse(format!("{}: unknown thing kind {other}", fields.id))),
    }
}

fn link_kind(fields: &Fields<'_>) -> Result<LinkKind, PrismError> {
    Ok(match fields.choice("kind", "OpmLinkKind")? {
        "agent" => LinkKind::Agent,
        "instrument" => LinkKind::Instrument,
        "consumption" => LinkKind::Consumption,
        "result" => LinkKind::Result,
        "effect" => LinkKind::Effect,
        "invocation" => LinkKind::Invocation,
        "aggregation" => LinkKind::Aggregation,
        "exhibition" => LinkKind::Exhibition,
        "generalization" => LinkKind::Generalization,
        "classification" => LinkKind::Classification,
        other => return Err(refuse(format!("{}: unknown link kind {other}", fields.id))),
    })
}

fn message_kind(fields: &Fields<'_>) -> Result<MessageKind, PrismError> {
    Ok(match fields.choice("kind", "UmlMessageKind")? {
        "synchronous" => MessageKind::Synchronous,
        "asynchronous" => MessageKind::Asynchronous,
        "reply" => MessageKind::Reply,
        other => {
            return Err(refuse(format!(
                "{}: unknown message kind {other}",
                fields.id
            )))
        }
    })
}

/// The `(type name, qualifier)` a definition declares as its result.
fn result_type(linked: &Value) -> Option<(&str, Option<&str>)> {
    let member = linked.get("result")?.get("member")?;
    Some((
        member.get("name")?.as_str()?,
        member.get("module").and_then(Value::as_str),
    ))
}

/// Project the design primitives out of `(module, declaration, linked IR)`
/// definitions. A definition is a design primitive exactly when its result
/// type is a `Foundation.Arch` design type, either unqualified inside that
/// module or qualified with it; every other definition is ignored.
pub(super) fn project<'a>(
    definitions: impl IntoIterator<Item = (&'a str, &'a str, &'a Value)>,
) -> Result<Design, PrismError> {
    let mut design = Design::default();
    for (module, logical_id, linked) in definitions {
        let Some((type_name, qualifier)) = result_type(linked) else {
            continue;
        };
        if qualifier.unwrap_or(module) != OWNER {
            continue;
        }
        let id = format!("{module}::{logical_id}");
        let fields = || Fields::of(&id, linked);
        match type_name {
            "DesignView" => {
                let fields = fields()?;
                design.views.insert(
                    id.clone(),
                    View {
                        id: id.clone(),
                        title: fields.text("title")?,
                        viewpoint: fields.text("viewpoint")?,
                        diagram: diagram(&fields)?,
                    },
                );
            }
            "SystemProcess" => {
                let fields = fields()?;
                let owner = fields.text("owner")?;
                design.processes.insert(
                    id.clone(),
                    Owned {
                        id: id.clone(),
                        owner,
                    },
                );
            }
            "SystemState" => {
                let fields = fields()?;
                let owner = fields.text("owner")?;
                design.states.insert(
                    id.clone(),
                    Owned {
                        id: id.clone(),
                        owner,
                    },
                );
            }
            "OpmThing" => {
                let fields = fields()?;
                design.opm_things.push(OpmThing {
                    at: fields.origin()?,
                    kind: thing_kind(&fields)?,
                    subject: fields.text("subject")?,
                });
            }
            "OpmState" => {
                let fields = fields()?;
                design.opm_states.push(OpmState {
                    at: fields.origin()?,
                    thing: fields.text("thing")?,
                    state: fields.text("state")?,
                });
            }
            "OpmLink" => {
                let fields = fields()?;
                design.opm_links.push(OpmLink {
                    at: fields.origin()?,
                    kind: link_kind(&fields)?,
                    source: fields.text("source")?,
                    target: fields.text("target")?,
                });
            }
            "OpmZoom" => {
                let fields = fields()?;
                design.opm_zooms.push(OpmZoom {
                    at: fields.origin()?,
                    process: fields.text("process")?,
                    subprocess: fields.text("subprocess")?,
                    order: fields.nat("order")?,
                });
            }
            "UmlComponent" => {
                let fields = fields()?;
                design.uml_components.push(UmlComponent {
                    at: fields.origin()?,
                    component: fields.text("component")?,
                });
            }
            "UmlConnector" => {
                let fields = fields()?;
                design.uml_connectors.push(UmlConnector {
                    at: fields.origin()?,
                    edge: fields.text("edge")?,
                });
            }
            "UmlLifeline" => {
                let fields = fields()?;
                design.uml_lifelines.push(UmlLifeline {
                    at: fields.origin()?,
                    component: fields.text("component")?,
                    order: fields.nat("order")?,
                });
            }
            "UmlMessage" => {
                let fields = fields()?;
                design.uml_messages.push(UmlMessage {
                    at: fields.origin()?,
                    kind: message_kind(&fields)?,
                    order: fields.nat("order")?,
                    source: fields.text("source")?,
                    target: fields.text("target")?,
                    process: fields.text("process")?,
                });
            }
            "UmlState" => {
                let fields = fields()?;
                design.uml_states.push(UmlState {
                    at: fields.origin()?,
                    state: fields.text("state")?,
                    initial: fields.flag("initial")?,
                });
            }
            "UmlTransition" => {
                let fields = fields()?;
                design.uml_transitions.push(UmlTransition {
                    at: fields.origin()?,
                    order: fields.nat("order")?,
                    source: fields.text("source")?,
                    target: fields.text("target")?,
                    trigger: fields.text("trigger")?,
                });
            }
            _ => {}
        }
    }
    Ok(design)
}
