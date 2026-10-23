//! PlantUML source rendering of UML component, sequence and state machine
//! views. The source is a pure function of the checked view: aliases are
//! assigned in sorted or declared order, and nothing ambient is embedded.

use super::check::System;
use super::group::Group;
use super::labels::{single_line, Labels};
use super::model::{Diagram, MessageKind, View};
use std::collections::BTreeMap;

fn header(view: &View, kind: &str) -> String {
    format!(
        "@startuml\n' UML 2.5.1 {kind} diagram\n' view: {}\n' viewpoint: {}\ntitle {}\n",
        view.id,
        view.viewpoint,
        single_line(&view.title)
    )
}

fn aliases<'a>(
    prefix: &str,
    names: impl IntoIterator<Item = &'a str>,
) -> BTreeMap<&'a str, String> {
    let mut names: Vec<&str> = names.into_iter().collect();
    names.sort_unstable();
    names.dedup();
    names
        .into_iter()
        .enumerate()
        .map(|(index, name)| (name, format!("{prefix}{index}")))
        .collect()
}

fn component(view: &View, group: &Group<'_>, system: &System) -> String {
    let names = || group.components.iter().map(|row| row.component.as_str());
    let labels = Labels::new(names());
    let alias = aliases("c", names());
    let mut out = header(view, "component");
    for (name, id) in &alias {
        out.push_str(&format!("component \"{}\" as {id}\n", labels.get(name)));
    }
    let mut edges: Vec<&str> = group
        .connectors
        .iter()
        .map(|row| row.edge.as_str())
        .collect();
    edges.sort_unstable();
    let edge_labels = Labels::new(edges.iter().copied());
    for edge in edges {
        if let Some((from, to)) = system.edges.get(edge) {
            if let (Some(from), Some(to)) = (alias.get(from.as_str()), alias.get(to.as_str())) {
                out.push_str(&format!("{from} --> {to} : {}\n", edge_labels.get(edge)));
            }
        }
    }
    out.push_str("@enduml\n");
    out
}

fn sequence(view: &View, group: &Group<'_>) -> String {
    let labels = Labels::new(group.lifelines.iter().map(|row| row.component.as_str()));
    let processes = Labels::new(group.messages.iter().map(|row| row.process.as_str()));
    let mut lifelines: Vec<_> = group.lifelines.iter().collect();
    lifelines.sort_by(|a, b| (a.order, &a.component).cmp(&(b.order, &b.component)));
    let alias: BTreeMap<&str, String> = lifelines
        .iter()
        .enumerate()
        .map(|(index, row)| (row.component.as_str(), format!("p{index}")))
        .collect();
    let mut out = header(view, "sequence");
    for row in &lifelines {
        out.push_str(&format!(
            "participant \"{}\" as {}\n",
            labels.get(&row.component),
            alias[row.component.as_str()]
        ));
    }
    let mut messages: Vec<_> = group.messages.iter().collect();
    messages.sort_by(|a, b| (a.order, &a.process).cmp(&(b.order, &b.process)));
    for row in messages {
        let arrow = match row.kind {
            MessageKind::Synchronous => "->",
            MessageKind::Asynchronous => "->>",
            MessageKind::Reply => "-->",
        };
        out.push_str(&format!(
            "{} {arrow} {} : {}\n",
            alias[row.source.as_str()],
            alias[row.target.as_str()],
            processes.get(&row.process)
        ));
    }
    out.push_str("@enduml\n");
    out
}

fn state_machine(view: &View, group: &Group<'_>) -> String {
    let names = || group.machine_states.iter().map(|row| row.state.as_str());
    let labels = Labels::new(names());
    let alias = aliases("s", names());
    let triggers = Labels::new(group.transitions.iter().map(|row| row.trigger.as_str()));
    let mut out = header(view, "state machine");
    for (name, id) in &alias {
        out.push_str(&format!("state \"{}\" as {id}\n", labels.get(name)));
    }
    let mut initial: Vec<&str> = group
        .machine_states
        .iter()
        .filter(|row| row.initial)
        .map(|row| row.state.as_str())
        .collect();
    initial.sort_unstable();
    for state in initial {
        out.push_str(&format!("[*] --> {}\n", alias[state]));
    }
    let mut transitions: Vec<_> = group.transitions.iter().collect();
    transitions.sort_by(|a, b| (a.order, &a.trigger).cmp(&(b.order, &b.trigger)));
    for row in transitions {
        out.push_str(&format!(
            "{} --> {} : {}\n",
            alias[row.source.as_str()],
            alias[row.target.as_str()],
            triggers.get(&row.trigger)
        ));
    }
    out.push_str("@enduml\n");
    out
}

/// Render one UML view as PlantUML source; None for a non-UML view.
pub(super) fn render(view: &View, group: &Group<'_>, system: &System) -> Option<String> {
    match view.diagram {
        Diagram::OpmObjectProcess => None,
        Diagram::UmlComponent => Some(component(view, group, system)),
        Diagram::UmlSequence => Some(sequence(view, group)),
        Diagram::UmlStateMachine => Some(state_machine(view, group)),
    }
}
