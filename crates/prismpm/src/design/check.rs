//! Checking design views against the system model.
//!
//! A view is a 42010 view: it conforms to a registered viewpoint and every
//! element names a declaration of the system model. Components and edges come
//! from the model document; processes and states are the `SystemProcess` and
//! `SystemState` declarations, each owned by a component. A name the system
//! model does not have, or a structure the notation does not allow, is
//! refused with `PP2012`.

use super::group::{groups, Group};
use super::model::{refuse, Design, Diagram, LinkKind, MessageKind, Origin, ThingKind, View};
use crate::error::PrismError;
use std::collections::{BTreeMap, BTreeSet};

/// The components, edges and viewpoints of the model document.
#[derive(Debug, Clone, Default)]
pub(super) struct System {
    pub(super) components: BTreeSet<String>,
    /// Edge identifier to its `(from, to)` component identifiers.
    pub(super) edges: BTreeMap<String, (String, String)>,
    pub(super) viewpoints: BTreeSet<String>,
}

impl System {
    fn flows(&self, from: &str, to: &str) -> bool {
        self.edges.values().any(|(a, b)| a == from && b == to)
    }

    fn connected(&self, left: &str, right: &str) -> bool {
        self.flows(left, right) || self.flows(right, left)
    }
}

/// What a check needs to name a refusal.
struct Ctx<'a> {
    design: &'a Design,
    system: &'a System,
    view: &'a View,
}

impl Ctx<'_> {
    fn unknown(&self, at: &Origin, what: &str, name: &str) -> PrismError {
        refuse(format!(
            "design view {}: {} names unknown {what} {name}",
            self.view.id, at.record
        ))
    }

    fn invalid(&self, at: &Origin, reason: impl std::fmt::Display) -> PrismError {
        refuse(format!(
            "design view {}: {} {reason}",
            self.view.id, at.record
        ))
    }

    fn component(&self, at: &Origin, name: &str) -> Result<(), PrismError> {
        if self.system.components.contains(name) {
            Ok(())
        } else {
            Err(self.unknown(at, "component", name))
        }
    }

    fn process_owner(&self, at: &Origin, name: &str) -> Result<&str, PrismError> {
        self.design
            .processes
            .get(name)
            .map(|process| process.owner.as_str())
            .ok_or_else(|| self.unknown(at, "process", name))
    }

    fn state_owner(&self, at: &Origin, name: &str) -> Result<&str, PrismError> {
        self.design
            .states
            .get(name)
            .map(|state| state.owner.as_str())
            .ok_or_else(|| self.unknown(at, "state", name))
    }

    fn once<K: Ord>(
        &self,
        seen: &mut BTreeSet<K>,
        key: K,
        at: &Origin,
        what: &str,
    ) -> Result<(), PrismError> {
        if seen.insert(key) {
            Ok(())
        } else {
            Err(self.invalid(at, format_args!("repeats {what}")))
        }
    }
}

fn opm_things<'a>(
    ctx: &Ctx<'_>,
    group: &Group<'a>,
) -> Result<BTreeMap<&'a str, ThingKind>, PrismError> {
    let mut things = BTreeMap::new();
    for thing in &group.things {
        match thing.kind {
            ThingKind::Object => ctx.component(&thing.at, &thing.subject)?,
            ThingKind::Process => {
                ctx.process_owner(&thing.at, &thing.subject)?;
            }
        }
        if things.insert(thing.subject.as_str(), thing.kind).is_some() {
            return Err(ctx.invalid(&thing.at, format_args!("repeats thing {}", thing.subject)));
        }
    }
    Ok(things)
}

fn procedural(kind: LinkKind) -> bool {
    matches!(
        kind,
        LinkKind::Agent
            | LinkKind::Instrument
            | LinkKind::Consumption
            | LinkKind::Result
            | LinkKind::Effect
    )
}

fn opm(ctx: &Ctx<'_>, group: &Group<'_>) -> Result<(), PrismError> {
    let things = opm_things(ctx, group)?;
    let mut attached = BTreeSet::new();
    for state in &group.states {
        match things.get(state.thing.as_str()) {
            Some(ThingKind::Object) => {}
            Some(ThingKind::Process) => {
                return Err(ctx.invalid(
                    &state.at,
                    format_args!("attaches a state to process {}", state.thing),
                ))
            }
            None => return Err(ctx.unknown(&state.at, "object of the view", &state.thing)),
        }
        let owner = ctx.state_owner(&state.at, &state.state)?;
        if owner != state.thing {
            return Err(ctx.invalid(
                &state.at,
                format_args!(
                    "attaches state {} owned by {owner} to {}",
                    state.state, state.thing
                ),
            ));
        }
        ctx.once(
            &mut attached,
            (&state.thing, &state.state),
            &state.at,
            "an object state",
        )?;
    }
    let mut links = BTreeSet::new();
    for link in &group.links {
        let endpoint = |name: &str| {
            things
                .get(name)
                .copied()
                .ok_or_else(|| ctx.unknown(&link.at, "thing of the view", name))
        };
        let (source, target) = (endpoint(&link.source)?, endpoint(&link.target)?);
        let shaped = match link.kind {
            LinkKind::Agent | LinkKind::Instrument | LinkKind::Consumption | LinkKind::Effect => {
                source == ThingKind::Object && target == ThingKind::Process
            }
            LinkKind::Result => source == ThingKind::Process && target == ThingKind::Object,
            LinkKind::Invocation => source == ThingKind::Process && target == ThingKind::Process,
            LinkKind::Aggregation | LinkKind::Generalization | LinkKind::Classification => {
                source == target && link.source != link.target
            }
            LinkKind::Exhibition => link.source != link.target,
        };
        if !shaped {
            return Err(ctx.invalid(
                &link.at,
                format_args!(
                    "links {} to {} in a way {:?} does not allow",
                    link.source, link.target, link.kind
                ),
            ));
        }
        ctx.once(
            &mut links,
            (link.kind, &link.source, &link.target),
            &link.at,
            "a link",
        )?;
        link_backed(ctx, link, source)?;
    }
    zooms(ctx, group, &things)
}

/// A link that crosses components must follow an edge of the system model.
fn link_backed(
    ctx: &Ctx<'_>,
    link: &super::model::OpmLink,
    source: ThingKind,
) -> Result<(), PrismError> {
    if procedural(link.kind) {
        let (object, process) = if source == ThingKind::Object {
            (&link.source, &link.target)
        } else {
            (&link.target, &link.source)
        };
        let owner = ctx.process_owner(&link.at, process)?;
        if owner != object.as_str() && !ctx.system.connected(object, owner) {
            return Err(ctx.invalid(
                &link.at,
                format_args!("links {object} to process {process} without an edge between {object} and {owner}"),
            ));
        }
    } else if link.kind == LinkKind::Invocation {
        let from = ctx.process_owner(&link.at, &link.source)?;
        let to = ctx.process_owner(&link.at, &link.target)?;
        if from != to && !ctx.system.flows(from, to) {
            return Err(ctx.invalid(
                &link.at,
                format_args!("invokes across components without an edge from {from} to {to}"),
            ));
        }
    }
    Ok(())
}

fn zooms(
    ctx: &Ctx<'_>,
    group: &Group<'_>,
    things: &BTreeMap<&str, ThingKind>,
) -> Result<(), PrismError> {
    let mut orders = BTreeSet::new();
    let mut parents: BTreeMap<&str, &str> = BTreeMap::new();
    for zoom in &group.zooms {
        for name in [&zoom.process, &zoom.subprocess] {
            if things.get(name.as_str()) != Some(&ThingKind::Process) {
                return Err(ctx.unknown(&zoom.at, "process of the view", name));
            }
        }
        if zoom.process == zoom.subprocess {
            return Err(ctx.invalid(&zoom.at, "zooms a process into itself"));
        }
        ctx.once(
            &mut orders,
            (&zoom.process, zoom.order),
            &zoom.at,
            "a zoom position",
        )?;
        if parents
            .insert(zoom.subprocess.as_str(), zoom.process.as_str())
            .is_some()
        {
            return Err(ctx.invalid(
                &zoom.at,
                format_args!("zooms {} under a second process", zoom.subprocess),
            ));
        }
    }
    Ok(())
}

fn uml_component(ctx: &Ctx<'_>, group: &Group<'_>) -> Result<(), PrismError> {
    let mut shown = BTreeSet::new();
    for row in &group.components {
        ctx.component(&row.at, &row.component)?;
        ctx.once(&mut shown, row.component.as_str(), &row.at, "a component")?;
    }
    let mut drawn = BTreeSet::new();
    for row in &group.connectors {
        let (from, to) = ctx
            .system
            .edges
            .get(&row.edge)
            .ok_or_else(|| ctx.unknown(&row.at, "edge", &row.edge))?;
        for end in [from, to] {
            if !shown.contains(end.as_str()) {
                return Err(ctx.invalid(
                    &row.at,
                    format_args!(
                        "draws edge {} to {end}, which the view does not show",
                        row.edge
                    ),
                ));
            }
        }
        ctx.once(&mut drawn, row.edge.as_str(), &row.at, "a connector")?;
    }
    Ok(())
}

fn uml_sequence(ctx: &Ctx<'_>, group: &Group<'_>) -> Result<(), PrismError> {
    let mut lifelines = BTreeSet::new();
    let mut positions = BTreeSet::new();
    for row in &group.lifelines {
        ctx.component(&row.at, &row.component)?;
        ctx.once(
            &mut lifelines,
            row.component.as_str(),
            &row.at,
            "a lifeline",
        )?;
        ctx.once(&mut positions, row.order, &row.at, "a lifeline position")?;
    }
    let mut orders = BTreeSet::new();
    for row in &group.messages {
        for end in [&row.source, &row.target] {
            if !lifelines.contains(end.as_str()) {
                return Err(ctx.unknown(&row.at, "lifeline of the view", end));
            }
        }
        let (caller, callee) = if row.kind == MessageKind::Reply {
            (&row.target, &row.source)
        } else {
            (&row.source, &row.target)
        };
        let owner = ctx.process_owner(&row.at, &row.process)?;
        if owner != callee.as_str() {
            return Err(ctx.invalid(
                &row.at,
                format_args!("sends process {} owned by {owner} to {callee}", row.process),
            ));
        }
        if caller != callee && !ctx.system.flows(caller, callee) {
            return Err(ctx.invalid(
                &row.at,
                format_args!("sends from {caller} to {callee} without an edge between them"),
            ));
        }
        ctx.once(&mut orders, row.order, &row.at, "a message position")?;
    }
    Ok(())
}

fn uml_state_machine(ctx: &Ctx<'_>, group: &Group<'_>) -> Result<(), PrismError> {
    let mut states = BTreeSet::new();
    let mut machine: Option<&str> = None;
    let mut initial = 0_usize;
    for row in &group.machine_states {
        let owner = ctx.state_owner(&row.at, &row.state)?;
        if *machine.get_or_insert(owner) != owner {
            return Err(ctx.invalid(
                &row.at,
                format_args!(
                    "mixes states of {owner} into the machine of {}",
                    machine.unwrap_or_default()
                ),
            ));
        }
        ctx.once(&mut states, row.state.as_str(), &row.at, "a state")?;
        initial += usize::from(row.initial);
        if initial > 1 {
            return Err(ctx.invalid(&row.at, "declares a second initial state"));
        }
    }
    let mut orders = BTreeSet::new();
    for row in &group.transitions {
        for end in [&row.source, &row.target] {
            if !states.contains(end.as_str()) {
                return Err(ctx.unknown(&row.at, "state of the view", end));
            }
        }
        let owner = ctx.process_owner(&row.at, &row.trigger)?;
        if Some(owner) != machine {
            return Err(ctx.invalid(
                &row.at,
                format_args!("triggers on process {} owned by {owner}", row.trigger),
            ));
        }
        ctx.once(&mut orders, row.order, &row.at, "a transition position")?;
    }
    Ok(())
}

/// Check every design view and primitive against the system model.
pub(super) fn check(design: &Design, system: &System) -> Result<(), PrismError> {
    for process in design.processes.values() {
        if !system.components.contains(&process.owner) {
            return Err(refuse(format!(
                "system process {} names unknown component {}",
                process.id, process.owner
            )));
        }
    }
    for state in design.states.values() {
        if !system.components.contains(&state.owner) {
            return Err(refuse(format!(
                "system state {} names unknown component {}",
                state.id, state.owner
            )));
        }
    }
    let mut groups = groups(design)?;
    for view in design.views.values() {
        if !system.viewpoints.contains(&view.viewpoint) {
            return Err(refuse(format!(
                "design view {} names unknown viewpoint {}",
                view.id, view.viewpoint
            )));
        }
        let group = groups.remove(view.id.as_str()).unwrap_or_default();
        let ctx = Ctx {
            design,
            system,
            view,
        };
        if let Some(origin) = group.foreign(view.diagram) {
            return Err(ctx.invalid(
                origin,
                format_args!("is not an element of a {:?} view", view.diagram),
            ));
        }
        match view.diagram {
            Diagram::OpmObjectProcess => opm(&ctx, &group)?,
            Diagram::UmlComponent => uml_component(&ctx, &group)?,
            Diagram::UmlSequence => uml_sequence(&ctx, &group)?,
            Diagram::UmlStateMachine => uml_state_machine(&ctx, &group)?,
        }
    }
    Ok(())
}
