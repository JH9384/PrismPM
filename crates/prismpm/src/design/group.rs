//! Grouping of design-view elements by the view they belong to.

use super::model::{
    refuse, Design, Diagram, OpmLink, OpmState, OpmThing, OpmZoom, Origin, UmlComponent,
    UmlConnector, UmlLifeline, UmlMessage, UmlState, UmlTransition,
};
use crate::error::PrismError;
use std::collections::BTreeMap;

/// The elements of one view, by kind.
#[derive(Default)]
pub(super) struct Group<'a> {
    pub(super) things: Vec<&'a OpmThing>,
    pub(super) states: Vec<&'a OpmState>,
    pub(super) links: Vec<&'a OpmLink>,
    pub(super) zooms: Vec<&'a OpmZoom>,
    pub(super) components: Vec<&'a UmlComponent>,
    pub(super) connectors: Vec<&'a UmlConnector>,
    pub(super) lifelines: Vec<&'a UmlLifeline>,
    pub(super) messages: Vec<&'a UmlMessage>,
    pub(super) machine_states: Vec<&'a UmlState>,
    pub(super) transitions: Vec<&'a UmlTransition>,
}

impl Group<'_> {
    /// The first element that belongs to a different diagram kind.
    pub(super) fn foreign(&self, diagram: Diagram) -> Option<&Origin> {
        let rows: [(Diagram, Vec<&Origin>); 10] = [
            (
                Diagram::OpmObjectProcess,
                self.things.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::OpmObjectProcess,
                self.states.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::OpmObjectProcess,
                self.links.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::OpmObjectProcess,
                self.zooms.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlComponent,
                self.components.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlComponent,
                self.connectors.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlSequence,
                self.lifelines.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlSequence,
                self.messages.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlStateMachine,
                self.machine_states.iter().map(|row| &row.at).collect(),
            ),
            (
                Diagram::UmlStateMachine,
                self.transitions.iter().map(|row| &row.at).collect(),
            ),
        ];
        rows.into_iter()
            .filter(|(kind, _)| *kind != diagram)
            .find_map(|(_, origins)| origins.first().copied())
    }
}

pub(super) fn groups(design: &Design) -> Result<BTreeMap<&str, Group<'_>>, PrismError> {
    let mut out: BTreeMap<&str, Group<'_>> = BTreeMap::new();
    macro_rules! gather {
        ($rows:expr, $field:ident) => {
            for row in &$rows {
                if !design.views.contains_key(&row.at.view) {
                    return Err(refuse(format!(
                        "{} names unknown design view {}",
                        row.at.record, row.at.view
                    )));
                }
                out.entry(row.at.view.as_str())
                    .or_default()
                    .$field
                    .push(row);
            }
        };
    }
    gather!(design.opm_things, things);
    gather!(design.opm_states, states);
    gather!(design.opm_links, links);
    gather!(design.opm_zooms, zooms);
    gather!(design.uml_components, components);
    gather!(design.uml_connectors, connectors);
    gather!(design.uml_lifelines, lifelines);
    gather!(design.uml_messages, messages);
    gather!(design.uml_states, machine_states);
    gather!(design.uml_transitions, transitions);
    Ok(out)
}
