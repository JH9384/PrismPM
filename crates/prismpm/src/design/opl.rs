//! Object-Process Language rendering of OPM views.
//!
//! The text is a Prism-defined OPL sentence profile over the covered ISO 19450
//! subset: one sentence per thing, per object state set, per link and per
//! zoomed process, in a fixed order, with no timestamps or other ambient data.

use super::group::Group;
use super::labels::{single_line, Labels};
use super::model::{LinkKind, ThingKind, View};
use std::collections::BTreeMap;

fn list(items: &[&str]) -> String {
    match items {
        [] => String::new(),
        [one] => (*one).to_owned(),
        [first, second] => format!("{first} and {second}"),
        [init @ .., last] => format!("{}, and {last}", init.join(", ")),
    }
}

fn alternatives(items: &[&str]) -> String {
    match items {
        [first, second] => format!("{first} or {second}"),
        _ => list(items),
    }
}

fn link_sentence(kind: LinkKind, source: &str, target: &str) -> String {
    match kind {
        LinkKind::Agent => format!("{source} handles {target}."),
        LinkKind::Instrument => format!("{target} requires {source}."),
        LinkKind::Consumption => format!("{target} consumes {source}."),
        LinkKind::Result => format!("{source} yields {target}."),
        LinkKind::Effect => format!("{target} affects {source}."),
        LinkKind::Invocation => format!("{source} invokes {target}."),
        LinkKind::Aggregation => format!("{source} consists of {target}."),
        LinkKind::Exhibition => format!("{source} exhibits {target}."),
        LinkKind::Generalization => format!("{target} is a {source}."),
        LinkKind::Classification => format!("{target} is an instance of {source}."),
    }
}

/// Render one OPM view as OPL text.
pub(super) fn render(view: &View, group: &Group<'_>) -> String {
    let labels = Labels::new(
        group
            .things
            .iter()
            .map(|thing| thing.subject.as_str())
            .chain(group.states.iter().map(|state| state.state.as_str())),
    );
    let mut out = format!(
        "View: {}\nTitle: {}\nViewpoint: {}\nNotation: ISO/PAS 19450:2015 OPM, Prism OPL profile\n\n",
        view.id,
        single_line(&view.title),
        view.viewpoint
    );
    let mut things: Vec<_> = group.things.iter().collect();
    things.sort_by(|a, b| (a.kind, &a.subject).cmp(&(b.kind, &b.subject)));
    for thing in &things {
        let label = labels.get(&thing.subject);
        match thing.kind {
            ThingKind::Object => {
                out.push_str(&format!("{label} is an object.\n"));
                let mut states: Vec<&str> = group
                    .states
                    .iter()
                    .filter(|state| state.thing == thing.subject)
                    .map(|state| state.state.as_str())
                    .collect();
                states.sort_unstable();
                if !states.is_empty() {
                    let names: Vec<&str> = states.iter().map(|state| labels.get(state)).collect();
                    out.push_str(&format!("{label} can be {}.\n", alternatives(&names)));
                }
            }
            ThingKind::Process => out.push_str(&format!("{label} is a process.\n")),
        }
    }
    let mut links: Vec<_> = group.links.iter().collect();
    links.sort_by(|a, b| (a.kind, &a.source, &a.target).cmp(&(b.kind, &b.source, &b.target)));
    for link in links {
        out.push_str(&link_sentence(
            link.kind,
            labels.get(&link.source),
            labels.get(&link.target),
        ));
        out.push('\n');
    }
    let mut zooms: BTreeMap<&str, Vec<(u64, &str)>> = BTreeMap::new();
    for zoom in &group.zooms {
        zooms
            .entry(zoom.process.as_str())
            .or_default()
            .push((zoom.order, zoom.subprocess.as_str()));
    }
    for (process, mut steps) in zooms {
        steps.sort_unstable();
        let names: Vec<&str> = steps.iter().map(|(_, name)| labels.get(name)).collect();
        out.push_str(&format!(
            "{} zooms into {}, in that sequence.\n",
            labels.get(process),
            list(&names)
        ));
    }
    out
}
