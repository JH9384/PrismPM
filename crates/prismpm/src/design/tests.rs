use super::check::System;
use super::model::{project, Design};
use super::{render_definitions, render_design};
use crate::error::PrismError;
use crate::holo::model_document::{ComponentRecord, EdgeRecord, ViewpointRecord};
use crate::holo::ModelDocument;
use serde_json::{json, Value};
use std::collections::BTreeMap;

type Definition = (String, String, Value);

fn text(field: &str, value: &str) -> Value {
    json!({"field": field, "value": {"kind": "string", "value": value}})
}

fn nat(field: &str, value: u64) -> Value {
    json!({"field": field, "value": {"kind": "nat", "value": value.to_string()}})
}

fn flag(field: &str, value: bool) -> Value {
    json!({"field": field, "value": {"kind": "bool", "value": value}})
}

fn choice(field: &str, value: &str) -> Value {
    json!({"field": field, "value": {"kind": "constructor", "constructor": {"name": value}}})
}

fn define(name: &str, type_name: &str, fields: Vec<Value>) -> Definition {
    (
        "App".to_owned(),
        name.to_owned(),
        json!({
            "result": {"member": {"name": type_name, "module": "Foundation.Arch"}},
            "body": {"kind": "record", "fields": fields},
        }),
    )
}

fn process(name: &str, owner: &str) -> Definition {
    define(name, "SystemProcess", vec![text("owner", owner)])
}

fn state(name: &str, owner: &str) -> Definition {
    define(name, "SystemState", vec![text("owner", owner)])
}

fn view(name: &str, title: &str, diagram: &str) -> Definition {
    define(
        name,
        "DesignView",
        vec![
            text("title", title),
            text("viewpoint", "App::viewpointDesign"),
            choice("diagram", &format!("DesignDiagram.{diagram}")),
        ],
    )
}

fn thing(name: &str, view: &str, kind: &str, subject: &str) -> Definition {
    define(
        name,
        "OpmThing",
        vec![
            text("view", view),
            choice("kind", &format!("OpmThingKind.{kind}")),
            text("subject", subject),
        ],
    )
}

fn link(name: &str, view: &str, kind: &str, source: &str, target: &str) -> Definition {
    define(
        name,
        "OpmLink",
        vec![
            text("view", view),
            choice("kind", &format!("OpmLinkKind.{kind}")),
            text("source", source),
            text("target", target),
        ],
    )
}

fn message(
    name: &str,
    view: &str,
    order: u64,
    kind: &str,
    ends: [&str; 2],
    via: &str,
) -> Definition {
    define(
        name,
        "UmlMessage",
        vec![
            text("view", view),
            choice("kind", &format!("UmlMessageKind.{kind}")),
            nat("order", order),
            text("source", ends[0]),
            text("target", ends[1]),
            text("process", via),
        ],
    )
}

fn lifeline(name: &str, view: &str, component: &str, order: u64) -> Definition {
    define(
        name,
        "UmlLifeline",
        vec![
            text("view", view),
            text("component", component),
            nat("order", order),
        ],
    )
}

fn machine_state(name: &str, view: &str, member: &str, initial: bool) -> Definition {
    define(
        name,
        "UmlState",
        vec![
            text("view", view),
            text("state", member),
            flag("initial", initial),
        ],
    )
}

fn transition(name: &str, view: &str, order: u64, ends: [&str; 2], trigger: &str) -> Definition {
    define(
        name,
        "UmlTransition",
        vec![
            text("view", view),
            nat("order", order),
            text("source", ends[0]),
            text("target", ends[1]),
            text("trigger", trigger),
        ],
    )
}

/// The system model every specimen is checked against: a source feeds a
/// checker, which emits to a reporter.
fn system() -> System {
    let ids = |names: &[&str]| names.iter().map(|name| (*name).to_owned()).collect();
    System {
        components: ids(&["App::checker", "App::reporter", "App::source"]),
        edges: BTreeMap::from([
            (
                "App::emits".to_owned(),
                ("App::checker".to_owned(), "App::reporter".to_owned()),
            ),
            (
                "App::feeds".to_owned(),
                ("App::source".to_owned(), "App::checker".to_owned()),
            ),
        ]),
        viewpoints: ids(&["App::viewpointDesign"]),
    }
}

fn system_declarations() -> Vec<Definition> {
    vec![
        process("check", "App::checker"),
        process("parse", "App::checker"),
        process("publish", "App::reporter"),
        state("done", "App::checker"),
        state("pending", "App::checker"),
    ]
}

fn opm_view() -> Vec<Definition> {
    let v = "App::opmCheck";
    vec![
        view("opmCheck", "Check pipeline", "opmObjectProcess"),
        thing("tSource", v, "object", "App::source"),
        thing("tChecker", v, "object", "App::checker"),
        thing("tReporter", v, "object", "App::reporter"),
        thing("tCheck", v, "process", "App::check"),
        thing("tParse", v, "process", "App::parse"),
        thing("tPublish", v, "process", "App::publish"),
        define(
            "sPending",
            "OpmState",
            vec![
                text("view", v),
                text("thing", "App::checker"),
                text("state", "App::pending"),
            ],
        ),
        define(
            "sDone",
            "OpmState",
            vec![
                text("view", v),
                text("thing", "App::checker"),
                text("state", "App::done"),
            ],
        ),
        link("lInvokes", v, "invocation", "App::check", "App::publish"),
        link("lYields", v, "result", "App::check", "App::reporter"),
        link("lConsumes", v, "consumption", "App::source", "App::check"),
        define(
            "zParse",
            "OpmZoom",
            vec![
                text("view", v),
                text("process", "App::check"),
                text("subprocess", "App::parse"),
                nat("order", 0),
            ],
        ),
    ]
}

fn uml_component_view() -> Vec<Definition> {
    let v = "App::umlComponents";
    let component = |name: &str, member: &str| {
        define(
            name,
            "UmlComponent",
            vec![text("view", v), text("component", member)],
        )
    };
    let connector = |name: &str, edge: &str| {
        define(
            name,
            "UmlConnector",
            vec![text("view", v), text("edge", edge)],
        )
    };
    vec![
        view("umlComponents", "Components", "umlComponent"),
        component("cSource", "App::source"),
        component("cChecker", "App::checker"),
        component("cReporter", "App::reporter"),
        connector("kFeeds", "App::feeds"),
        connector("kEmits", "App::emits"),
    ]
}

fn uml_sequence_view() -> Vec<Definition> {
    let v = "App::umlSequence";
    vec![
        view("umlSequence", "Sequence", "umlSequence"),
        lifeline("pSource", v, "App::source", 0),
        lifeline("pChecker", v, "App::checker", 1),
        lifeline("pReporter", v, "App::reporter", 2),
        message(
            "m2",
            v,
            2,
            "reply",
            ["App::reporter", "App::checker"],
            "App::publish",
        ),
        message(
            "m0",
            v,
            0,
            "synchronous",
            ["App::source", "App::checker"],
            "App::check",
        ),
        message(
            "m1",
            v,
            1,
            "synchronous",
            ["App::checker", "App::reporter"],
            "App::publish",
        ),
    ]
}

fn uml_state_view() -> Vec<Definition> {
    let v = "App::umlStates";
    vec![
        view("umlStates", "States", "umlStateMachine"),
        machine_state("qPending", v, "App::pending", true),
        machine_state("qDone", v, "App::done", false),
        transition("tFinish", v, 0, ["App::pending", "App::done"], "App::check"),
    ]
}

fn model() -> Vec<Definition> {
    [
        system_declarations(),
        opm_view(),
        uml_component_view(),
        uml_sequence_view(),
        uml_state_view(),
    ]
    .concat()
}

fn design(definitions: &[Definition]) -> Result<Design, PrismError> {
    project(
        definitions
            .iter()
            .map(|(module, name, value)| (module.as_str(), name.as_str(), value)),
    )
}

fn render(definitions: &[Definition]) -> Result<BTreeMap<String, String>, PrismError> {
    let design = design(definitions)?;
    Ok(render_design(&design, &system())?
        .into_iter()
        .map(|(path, bytes)| (path, String::from_utf8(bytes).unwrap()))
        .collect())
}

fn refusal(definitions: &[Definition]) -> String {
    let error = render(definitions).expect_err("the planted defect must be refused");
    assert_eq!(error.code, "PP2012", "{}", error.message);
    error.message
}

#[test]
fn opm_view_renders_opl_text() {
    let rendered = render(&model()).unwrap();
    assert_eq!(
        rendered["design/App.opmCheck.opl"],
        "View: App::opmCheck\n\
         Title: Check pipeline\n\
         Viewpoint: App::viewpointDesign\n\
         Notation: ISO/PAS 19450:2015 OPM, Prism OPL profile\n\
         \n\
         checker is an object.\n\
         checker can be done or pending.\n\
         reporter is an object.\n\
         source is an object.\n\
         check is a process.\n\
         parse is a process.\n\
         publish is a process.\n\
         check consumes source.\n\
         check yields reporter.\n\
         check invokes publish.\n\
         check zooms into parse, in that sequence.\n"
    );
}

#[test]
fn uml_component_view_renders_plantuml() {
    let rendered = render(&model()).unwrap();
    assert_eq!(
        rendered["design/App.umlComponents.puml"],
        "@startuml\n\
         ' UML 2.5.1 component diagram\n\
         ' view: App::umlComponents\n\
         ' viewpoint: App::viewpointDesign\n\
         title Components\n\
         component \"checker\" as c0\n\
         component \"reporter\" as c1\n\
         component \"source\" as c2\n\
         c0 --> c1 : emits\n\
         c2 --> c0 : feeds\n\
         @enduml\n"
    );
}

#[test]
fn uml_sequence_view_renders_plantuml() {
    let rendered = render(&model()).unwrap();
    assert_eq!(
        rendered["design/App.umlSequence.puml"],
        "@startuml\n\
         ' UML 2.5.1 sequence diagram\n\
         ' view: App::umlSequence\n\
         ' viewpoint: App::viewpointDesign\n\
         title Sequence\n\
         participant \"source\" as p0\n\
         participant \"checker\" as p1\n\
         participant \"reporter\" as p2\n\
         p0 -> p1 : check\n\
         p1 -> p2 : publish\n\
         p2 --> p1 : publish\n\
         @enduml\n"
    );
}

#[test]
fn uml_state_machine_view_renders_plantuml() {
    let rendered = render(&model()).unwrap();
    assert_eq!(
        rendered["design/App.umlStates.puml"],
        "@startuml\n\
         ' UML 2.5.1 state machine diagram\n\
         ' view: App::umlStates\n\
         ' viewpoint: App::viewpointDesign\n\
         title States\n\
         state \"done\" as s0\n\
         state \"pending\" as s1\n\
         [*] --> s1\n\
         s1 --> s0 : check\n\
         @enduml\n"
    );
}

#[test]
fn rendering_is_independent_of_declaration_order() {
    let forward = render(&model()).unwrap();
    let mut reversed = model();
    reversed.reverse();
    assert_eq!(render(&reversed).unwrap(), forward);
    assert_eq!(forward.len(), 4);
}

#[test]
fn a_model_without_design_primitives_renders_nothing() {
    assert!(render(&[]).unwrap().is_empty());
    let foreign = (
        "App".to_owned(),
        "other".to_owned(),
        json!({"result": {"member": {"name": "DesignView", "module": "Other.Arch"}}}),
    );
    assert!(design(&[foreign]).unwrap().is_empty());
}

#[test]
fn planted_unknown_component_is_refused() {
    let mut planted = model();
    planted.push(thing("tGhost", "App::opmCheck", "object", "App::ghost"));
    assert_eq!(
        refusal(&planted),
        "design view App::opmCheck: App::tGhost names unknown component App::ghost"
    );
}

#[test]
fn unknown_names_are_refused_in_every_notation() {
    let mut planted = model();
    planted.push(thing("tGhost", "App::opmCheck", "process", "App::ghost"));
    assert!(refusal(&planted).contains("unknown process App::ghost"));

    let mut planted = model();
    planted.push(define(
        "sGhost",
        "OpmState",
        vec![
            text("view", "App::opmCheck"),
            text("thing", "App::source"),
            text("state", "App::ghost"),
        ],
    ));
    assert!(refusal(&planted).contains("unknown state App::ghost"));

    let mut planted = model();
    planted.push(define(
        "kGhost",
        "UmlConnector",
        vec![
            text("view", "App::umlComponents"),
            text("edge", "App::ghost"),
        ],
    ));
    assert!(refusal(&planted).contains("unknown edge App::ghost"));

    let mut planted = model();
    planted.push(lifeline("pGhost", "App::umlSequence", "App::ghost", 3));
    assert!(refusal(&planted).contains("unknown component App::ghost"));

    let mut planted = model();
    planted.push(machine_state(
        "qGhost",
        "App::umlStates",
        "App::ghost",
        false,
    ));
    assert!(refusal(&planted).contains("unknown state App::ghost"));

    let mut planted = model();
    planted.push(define(
        "vGhost",
        "DesignView",
        vec![
            text("title", "Ghost"),
            text("viewpoint", "App::ghostViewpoint"),
            choice("diagram", "DesignDiagram.umlComponent"),
        ],
    ));
    assert!(refusal(&planted).contains("unknown viewpoint App::ghostViewpoint"));

    let mut planted = model();
    planted.push(thing("tOrphan", "App::ghostView", "object", "App::source"));
    assert!(refusal(&planted).contains("unknown design view App::ghostView"));

    let mut planted = model();
    planted.push(process("lost", "App::ghost"));
    assert!(refusal(&planted).contains("system process App::lost names unknown component"));
}

#[test]
fn structural_violations_are_refused() {
    let cases: Vec<(Definition, &str)> = vec![
        (
            link(
                "bad",
                "App::opmCheck",
                "consumption",
                "App::check",
                "App::source",
            ),
            "links App::check to App::source in a way Consumption does not allow",
        ),
        (
            link("bad", "App::opmCheck", "agent", "App::source", "App::ghost"),
            "unknown thing of the view App::ghost",
        ),
        (
            lifeline("dup", "App::umlSequence", "App::source", 9),
            "repeats a lifeline",
        ),
        (
            message(
                "bad",
                "App::umlSequence",
                7,
                "synchronous",
                ["App::reporter", "App::source"],
                "App::check",
            ),
            "sends process App::check owned by App::checker to App::source",
        ),
        (
            message(
                "bad",
                "App::umlSequence",
                7,
                "synchronous",
                ["App::reporter", "App::checker"],
                "App::check",
            ),
            "sends from App::reporter to App::checker without an edge between them",
        ),
        (
            message(
                "bad",
                "App::umlSequence",
                0,
                "synchronous",
                ["App::source", "App::checker"],
                "App::check",
            ),
            "repeats a message position",
        ),
        (
            transition(
                "bad",
                "App::umlStates",
                5,
                ["App::pending", "App::done"],
                "App::publish",
            ),
            "triggers on process App::publish owned by App::reporter",
        ),
        (
            machine_state("second", "App::umlStates", "App::done", true),
            "repeats a state",
        ),
        (
            thing("foreign", "App::umlStates", "object", "App::source"),
            "is not an element of a UmlStateMachine view",
        ),
        (
            define(
                "badZoom",
                "OpmZoom",
                vec![
                    text("view", "App::opmCheck"),
                    text("process", "App::check"),
                    text("subprocess", "App::check"),
                    nat("order", 1),
                ],
            ),
            "zooms a process into itself",
        ),
        (
            define(
                "foreignState",
                "OpmState",
                vec![
                    text("view", "App::opmCheck"),
                    text("thing", "App::reporter"),
                    text("state", "App::done"),
                ],
            ),
            "attaches state App::done owned by App::checker to App::reporter",
        ),
    ];
    for (definition, expected) in cases {
        let mut planted = model();
        planted.push(definition);
        let message = refusal(&planted);
        assert!(message.contains(expected), "{message} lacks {expected}");
    }
}

#[test]
fn cross_component_links_follow_system_edges() {
    let mut planted = model();
    planted.retain(|row| row.1 != "lConsumes");
    planted.push(link(
        "lReads",
        "App::opmCheck",
        "instrument",
        "App::source",
        "App::publish",
    ));
    assert!(refusal(&planted).contains("without an edge between App::source and App::reporter"));
    let mut edgeless = system();
    edgeless.edges.clear();
    let design = design(&model()).unwrap();
    let error = render_design(&design, &edgeless).unwrap_err();
    assert_eq!(error.code, "PP2012");
}

#[test]
fn malformed_primitives_are_refused() {
    let nonliteral = (
        "App".to_owned(),
        "bad".to_owned(),
        json!({
            "result": {"member": {"name": "SystemProcess", "module": "Foundation.Arch"}},
            "body": {"kind": "call"},
        }),
    );
    assert_eq!(design(&[nonliteral]).unwrap_err().code, "PP2012");
    let wrong_kind = define("bad", "SystemProcess", vec![nat("owner", 1)]);
    assert_eq!(design(&[wrong_kind]).unwrap_err().code, "PP2012");
    let wrong_choice = define(
        "bad",
        "DesignView",
        vec![
            text("title", "t"),
            text("viewpoint", "v"),
            choice("diagram", "DesignDiagram.pie"),
        ],
    );
    assert_eq!(design(&[wrong_choice]).unwrap_err().code, "PP2012");
}

#[test]
fn colliding_artifact_paths_are_refused() {
    let mut planted = model();
    planted.push(view("opm_Check", "Second", "umlComponent"));
    planted.push((
        "App".to_owned(),
        "opm-Check".to_owned(),
        planted.last().unwrap().2.clone(),
    ));
    planted.push((
        "App".to_owned(),
        "opm Check".to_owned(),
        planted.last().unwrap().2.clone(),
    ));
    assert!(refusal(&planted).contains("already used artifact path"));
}

#[test]
fn colliding_short_names_stay_qualified() {
    let mut planted = model();
    planted.push((
        "Other".to_owned(),
        "check".to_owned(),
        process("check", "App::checker").2,
    ));
    planted.push(thing("tOther", "App::opmCheck", "process", "Other::check"));
    let rendered = render_design(&design(&planted).unwrap(), &system()).unwrap();
    let text = String::from_utf8(
        rendered
            .into_iter()
            .find(|(path, _)| path == "design/App.opmCheck.opl")
            .unwrap()
            .1,
    )
    .unwrap();
    assert!(text.contains("App::check is a process.\n"), "{text}");
    assert!(text.contains("Other::check is a process.\n"), "{text}");
}

fn document() -> ModelDocument {
    let mut document: ModelDocument = serde_json::from_slice(include_bytes!(
        "../../../../tests/data/text-model-document.json"
    ))
    .unwrap();
    let architecture = &mut document.architecture;
    architecture.components = ["App::checker", "App::reporter", "App::source"]
        .iter()
        .enumerate()
        .map(|(index, id)| ComponentRecord {
            id: (*id).to_owned(),
            index: index as u64,
            kind_id: "prism.arch@1.0.0::ComponentKind.service".to_owned(),
            name: String::new(),
            text: String::new(),
        })
        .collect();
    architecture.edges = vec![
        EdgeRecord {
            id: "App::emits".to_owned(),
            index: 0,
            from_index: 0,
            to_index: 1,
            kind_id: "prism.arch@1.0.0::EdgeKind.dataFlow".to_owned(),
        },
        EdgeRecord {
            id: "App::feeds".to_owned(),
            index: 1,
            from_index: 2,
            to_index: 0,
            kind_id: "prism.arch@1.0.0::EdgeKind.dataFlow".to_owned(),
        },
    ];
    architecture.viewpoints = vec![ViewpointRecord {
        id: "App::viewpointDesign".to_owned(),
        index: 0,
        stakeholder_index: 0,
        concern_index: 0,
        model_kind_index: 0,
    }];
    document
}

#[test]
fn the_system_model_is_read_from_the_model_document() {
    let document = document();
    let read = System::of(&document).unwrap();
    let expected = system();
    assert_eq!(read.components, expected.components);
    assert_eq!(read.edges, expected.edges);
    assert_eq!(read.viewpoints, expected.viewpoints);
    let definitions = model();
    let rendered = render_definitions(
        definitions
            .iter()
            .map(|(module, name, value)| (module.as_str(), name.as_str(), value)),
        &document,
    )
    .unwrap();
    assert_eq!(
        rendered
            .iter()
            .map(|(path, _)| path.as_str())
            .collect::<Vec<_>>(),
        [
            "design/App.opmCheck.opl",
            "design/App.umlComponents.puml",
            "design/App.umlSequence.puml",
            "design/App.umlStates.puml",
        ]
    );
    let mut dangling = document.clone();
    dangling.architecture.edges[0].to_index = 99;
    assert_eq!(System::of(&dangling).unwrap_err().code, "PP2012");
}

#[test]
fn planted_unknown_component_is_refused_against_the_document() {
    let mut planted = model();
    planted.push(thing("tGhost", "App::opmCheck", "object", "App::ghost"));
    let error = render_definitions(
        planted
            .iter()
            .map(|(module, name, value)| (module.as_str(), name.as_str(), value)),
        &document(),
    )
    .unwrap_err();
    assert_eq!(error.code, "PP2012");
    assert!(error.message.contains("unknown component App::ghost"));
}

#[test]
fn the_diagnostic_probe_runs_the_real_check() {
    super::probe(&json!({"component": "Probe::component"})).unwrap();
    let error = super::probe(&json!({"component": "Probe::unknown"})).unwrap_err();
    assert_eq!(error.code, "PP2012");
    assert_eq!(super::probe(&json!({})).unwrap_err().code, "PP2012");
}
