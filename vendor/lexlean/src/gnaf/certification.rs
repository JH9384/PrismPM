//! GNAF certification over requests (SPEC.md §17.18).
//!
//! The normative model is the LexLean module `compiler/src/Certification`,
//! which Lean elaborates and whose soundness theorems the certification
//! library proves. This module is the host side of that definition: the
//! closed JSON form `lexlean/gnaf-certificate/1`, a content-addressed
//! identity, a step-for-step transcription of the checker, and the emission
//! of certificates and verdicts as LexLean terms, so the kernel confirms
//! every committed certificate's verdict against the model.
//!
//! A certificate offers one premise for each system of the request's
//! universe and a route that turns the premises into a claim. The checker
//! evaluates only what a premise names, so a lower bound over a universe
//! containing a system whose cost is unknown can be certified without
//! evaluating it fully; what a premise establishes holds at the request's
//! fuel and at every larger one (stability of the evaluator).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value as Json};

use super::{
    argmin, beyond_capacity as request_capacity, dominates, expand, frontier, on_evaluation_stack,
    realize, status_on, system_charge, validate, Carrier, ClaimClass, Objective, Rejection,
    Request, Scope, Status, MODEL as GNAF,
};
use crate::artifact::content_id::{FramedHasher, Sha256Digest};
use crate::calculus::{term, Expr, Value};
use crate::code;
use crate::diagnostic::Diagnostic;
use crate::error::LexLeanError;

/// The schema tag of a certificate.
pub const CERTIFICATE_SPEC: &str = "lexlean/gnaf-certificate/1";

/// The schema tag of a certificate fixture.
pub const FIXTURE_SPEC: &str = "lexlean/gnaf-certificate-fixture/1";

/// The verifier a certificate names: the checker of the `Certification`
/// module, versioned.
pub const VERIFIER: &str = "lexlean/gnaf-certification/1";

/// The module defining the checker.
pub const MODEL: &str = "Certification";

/// The most premises a certificate carries: one per system of the largest
/// universe the host evaluates.
pub const MAX_PREMISES: u64 = 65_536;

/// The most positions a premise or route lists.
pub const MAX_POSITIONS: u64 = 1024;

/// The largest number a certificate states (a bound, a slope, an offset).
pub const MAX_NUMBER: u64 = 1 << 32;

/// A transformation schema of the closed list (§17.18).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Schema {
    /// A dispatch to one plan from both branches runs that plan.
    Collapse,
    /// A dispatch whose domain is entirely below its threshold runs its
    /// small plan.
    SpecializeSmall,
    /// A dispatch whose domain is entirely at or above its threshold runs its
    /// large plan.
    SpecializeLarge,
}

impl Schema {
    const fn constructor(self) -> &'static str {
        match self {
            Self::Collapse => "collapse",
            Self::SpecializeSmall => "specializeSmall",
            Self::SpecializeLarge => "specializeLarge",
        }
    }
}

/// What a certificate offers for one system of the universe.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Premise {
    /// The system disagrees with the reference on the domain argument at
    /// this position.
    Excluded { position: u64 },
    /// The system agrees on the domain arguments at these positions
    /// (strictly increasing); their steps and its preparation bound its cost
    /// from below.
    PaysAtLeast { positions: Vec<u64> },
    /// The system's whole status is decided at the request's fuel.
    Measured,
    /// A schema rewrites the system to a strictly cheaper member.
    Reduced { schema: Schema },
}

/// The bridge from a representation metric (size) to the execution
/// objective: the cost of an admitted system is at least `slope * size +
/// offset` (UOR-GNAF §10.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Bridge {
    pub slope: u64,
    pub offset: u64,
}

/// How premises become a claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Route {
    /// A bound every system respects, and the systems that attain it.
    LowerBound { bound: u64, attainers: Vec<u64> },
    /// The Pareto frontier: its members, and a reason every other system is
    /// not on it.
    FrontierCover { members: Vec<u64> },
    /// Proof-complete reduction: every system is measured, excluded, or
    /// reduced by a schema, and the answer is the order's over the measured.
    Reduction,
    /// A representation-minimal system and the bridge from its size to the
    /// execution objective.
    Representation {
        normal: u64,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        bridge: Option<Bridge>,
    },
    /// A GNAF-normal system. Never an optimality route.
    Normality { system: u64 },
}

/// A certificate.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Certificate {
    pub spec: String,
    pub verifier: String,
    /// The request's `SystemUniverseId`: the universe the certificate is for.
    pub universe: Sha256Digest,
    pub objective: Objective,
    pub claim: ClaimClass,
    pub scope: Scope,
    pub route: Route,
    pub premises: Vec<Premise>,
}

/// What a premise establishes about one system.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Fact {
    Inadmissible,
    Admitted { cost: u64, size: u64 },
    AtLeast { cost: u64, size: u64 },
    Reduces { target: u64 },
    Unresolved,
    Unproven,
}

/// Why a certificate is refused outright.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Refusal {
    VerifierMismatch,
    RequestRejected { rejection: Rejection },
    UniverseMismatch,
    ObjectiveMismatch,
    ClaimMismatch,
    ScopeMismatch,
    RouteIncompatible,
    MissingPremise { position: u64 },
    ExtraPremise { count: u64 },
}

/// The first obligation a certificate leaves open.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Obligation {
    UnresolvedMember { position: u64 },
    MemberUnproven { position: u64 },
    MemberBelowBound { position: u64 },
    AttainerOmitted { position: u64 },
    AttainerUnmeasured { position: u64 },
    AttainerInadmissible { position: u64 },
    AttainerAboveBound { position: u64 },
    AttainersMalformed,
    BoundUnattained,
    FrontierMemberUnmeasured { position: u64 },
    FrontierMemberDominated { position: u64 },
    FrontierMemberOmitted { position: u64 },
    ReductionIncomplete { position: u64 },
    NoAdmittedMember,
    BridgeMissing,
    BridgeViolated { position: u64 },
    BridgeUnproved { position: u64 },
    NormalOutOfRange,
    NormalNotMinimal { position: u64 },
    NormalUnmeasured,
    OptimalityUnproved,
    SystemNotNormal,
}

/// The strongest status an incomplete certificate establishes. None of them
/// is an optimality claim.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Established {
    NotCertified,
    CorrectOnly { system: u64, steps: u64, size: u64 },
    LocallyNormalized { system: u64 },
    RepresentationMinimal { system: u64, size: u64 },
}

/// A certified result, as positions in the universe's expansion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Certified {
    /// These systems attain the least cost over the grammar universe; others
    /// may too.
    Optimum { members: Vec<u64>, steps: u64 },
    /// Exactly these systems attain the least cost.
    Argmin { members: Vec<u64>, steps: u64 },
    /// Exactly these systems are the Pareto frontier.
    Frontier { members: Vec<u64> },
}

/// The verdict a certificate earns for a request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case", deny_unknown_fields)]
pub enum Verdict {
    Refused {
        refusal: Refusal,
    },
    Certified {
        result: Certified,
    },
    Incomplete {
        obligation: Obligation,
        established: Established,
    },
}

/// A committed certificate with the request it is for, its identity, and the
/// verdict the model gives it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct CertificateFixture {
    pub spec: String,
    pub name: String,
    /// The name of the GNAF fixture whose request this certificate is for.
    pub request: String,
    pub certificate: Certificate,
    /// [`certificate_id`] of the certificate.
    pub id: Sha256Digest,
    pub expected: Verdict,
}

fn malformed(reason: &str) -> LexLeanError {
    LexLeanError::from_diagnostic(Diagnostic::new(
        code!("LLB6007"),
        format!("GNAF certificate: {reason}"),
    ))
}

fn beyond_capacity(reason: &str) -> LexLeanError {
    request_capacity(&format!("certificate: {reason}"))
}

fn canonical_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, LexLeanError> {
    let text = serde_json::to_string(value).map_err(|error| malformed(&error.to_string()))?;
    crate::artifact::canonical_json::Json::parse(text.as_bytes())
        .map(|json| json.to_file_bytes())
        .map_err(|error| malformed(&format!("not canonical JSON: {error}")))
}

/// The identity of a certificate: the framed SHA-256
/// `lexlean-gnaf-certificate-v1` of its canonical JSON.
///
/// # Errors
///
/// `LLB6007` for a number canonical JSON cannot represent.
pub fn certificate_id(certificate: &Certificate) -> Result<Sha256Digest, LexLeanError> {
    let mut hasher = FramedHasher::new("lexlean-gnaf-certificate-v1");
    hasher.frame("certificate", &canonical_bytes(certificate)?);
    Ok(hasher.finish())
}

/// The numbers a certificate states fit the host's integers, and its lists
/// are no longer than the host evaluates.
fn check_capacity(certificate: &Certificate) -> Result<(), LexLeanError> {
    let number = |name: &str, value: u64| {
        if value > MAX_NUMBER {
            Err(beyond_capacity(&format!(
                "{name} {value} exceeds the host's {MAX_NUMBER}"
            )))
        } else {
            Ok(())
        }
    };
    let positions = |name: &str, list: &[u64]| {
        if list.len() as u64 > MAX_POSITIONS {
            return Err(beyond_capacity(&format!(
                "{name} lists {} positions, beyond the host's {MAX_POSITIONS}",
                list.len()
            )));
        }
        list.iter().try_for_each(|value| number(name, *value))
    };
    if certificate.premises.len() as u64 > MAX_PREMISES {
        return Err(beyond_capacity(&format!(
            "{} premises exceed the host's {MAX_PREMISES}",
            certificate.premises.len()
        )));
    }
    for premise in &certificate.premises {
        match premise {
            Premise::Excluded { position } => number("a position", *position)?,
            Premise::PaysAtLeast { positions: list } => positions("a premise", list)?,
            Premise::Measured | Premise::Reduced { .. } => {}
        }
    }
    match &certificate.route {
        Route::LowerBound { bound, attainers } => {
            number("a bound", *bound)?;
            positions("the attainers", attainers)
        }
        Route::FrontierCover { members } => positions("the members", members),
        Route::Reduction => Ok(()),
        Route::Representation { normal, bridge } => {
            number("a position", *normal)?;
            if let Some(bridge) = bridge {
                number("a slope", bridge.slope)?;
                number("an offset", bridge.offset)?;
            }
            Ok(())
        }
        Route::Normality { system } => number("a position", *system),
    }
}

/// Read a certificate.
///
/// # Errors
///
/// `LLB6007` for a document that is not a closed
/// `lexlean/gnaf-certificate/1`; `LLS8002` for a certificate beyond the
/// host's capacity.
pub fn load(bytes: &[u8]) -> Result<Certificate, LexLeanError> {
    let certificate: Certificate =
        serde_json::from_slice(bytes).map_err(|error| malformed(&format!("malformed: {error}")))?;
    if certificate.spec != CERTIFICATE_SPEC {
        return Err(malformed(&format!(
            "spec `{}`, expected `{CERTIFICATE_SPEC}`",
            certificate.spec
        )));
    }
    check_capacity(&certificate)?;
    Ok(certificate)
}

/// Read a certificate fixture and check that it states its certificate's
/// identity.
///
/// # Errors
///
/// As [`load`]; `LLB6007` for a stated identity that is not the
/// certificate's.
pub fn load_fixture(bytes: &[u8]) -> Result<CertificateFixture, LexLeanError> {
    let fixture: CertificateFixture = serde_json::from_slice(bytes)
        .map_err(|error| malformed(&format!("malformed fixture: {error}")))?;
    if fixture.spec != FIXTURE_SPEC {
        return Err(malformed(&format!(
            "fixture spec `{}`, expected `{FIXTURE_SPEC}`",
            fixture.spec
        )));
    }
    if fixture.certificate.spec != CERTIFICATE_SPEC {
        return Err(malformed(&format!(
            "spec `{}`, expected `{CERTIFICATE_SPEC}`",
            fixture.certificate.spec
        )));
    }
    check_capacity(&fixture.certificate)?;
    let identity = certificate_id(&fixture.certificate)?;
    if fixture.id != identity {
        return Err(malformed(&format!(
            "the stated identity {} is not {identity}, the identity of the certificate",
            fixture.id
        )));
    }
    Ok(fixture)
}

// --- the checker ----------------------------------------------------------------

/// `Certification.claimShape`.
const fn claim_shape(claim: &ClaimClass) -> u64 {
    match claim {
        ClaimClass::GlobalOptimal => 1,
        ClaimClass::ArgminComplete => 2,
        ClaimClass::ParetoOptimal => 3,
        ClaimClass::FrontierComplete => 4,
        ClaimClass::Exact
        | ClaimClass::NormalForm
        | ClaimClass::Canonical
        | ClaimClass::RepresentationMinimal
        | ClaimClass::ComparisonTheorem
        | ClaimClass::ProfileDefinedComparison { .. }
        | ClaimClass::InputTotal
        | ClaimClass::PointwiseEnvelopeComplete
        | ClaimClass::QueryFamilyAnswerComplete
        | ClaimClass::UseCaseGlobalOptimal
        | ClaimClass::WorkloadArgminComplete
        | ClaimClass::WorkloadParetoOptimal
        | ClaimClass::WorkloadFrontierComplete
        | ClaimClass::FamilyOptimal
        | ClaimClass::CompetitiveBound
        | ClaimClass::CompetitiveOptimal
        | ClaimClass::AsymptoticBound
        | ClaimClass::AsymptoticOptimal
        | ClaimClass::UseCaseClassComplete
        | ClaimClass::UseCaseClassAnswerComplete
        | ClaimClass::MaintainedUseCaseClass
        | ClaimClass::RestrictedUniverseOptimal
        | ClaimClass::RevisionPreserved
        | ClaimClass::BestKnown
        | ClaimClass::MeasuredBestAmongTested
        | ClaimClass::HeuristicSelected
        | ClaimClass::InstanceOptimal { .. } => 0,
    }
}

/// `Certification.exprIsolated`: neither a call of the entry nor an
/// application of a closure.
fn expr_isolated(expr: &Expr) -> bool {
    let all = |exprs: &[Expr]| exprs.iter().all(expr_isolated);
    match expr {
        Expr::Value { .. } | Expr::Var { .. } => true,
        Expr::Let { bound, body, .. } => expr_isolated(bound) && expr_isolated(body),
        Expr::Cond {
            condition,
            then_branch,
            else_branch,
        } => expr_isolated(condition) && expr_isolated(then_branch) && expr_isolated(else_branch),
        Expr::Match {
            scrutinee, arms, ..
        } => expr_isolated(scrutinee) && arms.iter().all(|arm| expr_isolated(&arm.body)),
        Expr::Build { operands, .. } | Expr::Prim { operands, .. } => all(operands),
        Expr::Call { function, operands } => *function != 0 && all(operands),
        Expr::Closure { captures, .. } => all(captures),
        Expr::Apply { .. } => false,
        Expr::First { value } | Expr::Second { value } | Expr::Field { value, .. } => {
            expr_isolated(value)
        }
    }
}

fn list_length(value: &Value) -> Option<u64> {
    match value {
        Value::List { items } => Some(items.len() as u64),
        _ => None,
    }
}

/// The system a schema rewrites a selector to (`Certification.rewrite`).
fn rewrite(schema: Schema, selector: super::Selector) -> Option<super::Selector> {
    use super::Selector::{Dispatch, Fixed};
    match (schema, selector) {
        (_, Fixed { .. }) => None,
        (Schema::Collapse, Dispatch { small, large, .. }) => {
            (small == large).then_some(Fixed { plan: small })
        }
        (Schema::SpecializeSmall, Dispatch { small, .. }) => Some(Fixed { plan: small }),
        (Schema::SpecializeLarge, Dispatch { large, .. }) => Some(Fixed { plan: large }),
    }
}

/// `Certification.eligible`.
fn eligible(request: &Request, selector: super::Selector, schema: Schema) -> bool {
    let Carrier::Grammar { plans, .. } = &request.carrier else {
        return false;
    };
    if !plans.iter().all(|plan| expr_isolated(&plan.function.body)) {
        return false;
    }
    match selector {
        super::Selector::Fixed { .. } => false,
        super::Selector::Dispatch {
            threshold,
            small,
            large,
        } => match schema {
            Schema::Collapse => {
                small == large
                    && request
                        .domain
                        .iter()
                        .all(|value| list_length(value).is_some())
            }
            Schema::SpecializeSmall => request
                .domain
                .iter()
                .all(|value| list_length(value).is_some_and(|length| length < threshold)),
            Schema::SpecializeLarge => request
                .domain
                .iter()
                .all(|value| list_length(value).is_some_and(|length| threshold <= length)),
        },
    }
}

fn static_size(request: &Request, selector: super::Selector) -> u64 {
    realize(&request.carrier, selector).map_or(0, |system| super::program_size(&system))
}

fn static_charge(request: &Request, selector: super::Selector) -> Result<u64, LexLeanError> {
    let Some(system) = realize(&request.carrier, selector) else {
        return Ok(0);
    };
    system_charge(request, &system)
        .and_then(|charge| charge.checked_mul(request.domain.len() as u64))
        .ok_or_else(|| beyond_capacity("a system's preparation exceeds the evaluator's integers"))
}

/// `Certification.improves`.
fn improves(
    request: &Request,
    selector: super::Selector,
    schema: Schema,
) -> Result<bool, LexLeanError> {
    let Some(target) = rewrite(schema, selector) else {
        return Ok(false);
    };
    Ok(eligible(request, selector, schema)
        && static_size(request, target) <= static_size(request, selector)
        && static_charge(request, target)? <= static_charge(request, selector)?)
}

/// `Certification.argumentStatus`: a system's status on one argument alone.
fn argument_status(
    request: &Request,
    selector: super::Selector,
    argument: &Value,
) -> Result<Status, LexLeanError> {
    let system = realize(&request.carrier, selector).ok_or_else(|| {
        malformed("a selector outside the request's grammar has no system to observe")
    })?;
    status_on(
        &system,
        &request.reference,
        request.machine.fuel,
        std::slice::from_ref(argument),
    )
}

/// `Certification.sameObservations` and `Certification.strictlyCheaper`
/// together: wherever the system is admitted on an argument of the request's
/// domain, its rewriting is admitted on it as well (`keeps`), and at strictly
/// fewer steps (`cheaper`). Any two systems of the universe can be compared;
/// a schema's rewriting is the case `preserves` asks about.
///
/// # Errors
///
/// `LLS8002` beyond the host's integers, `LLV7010` and `LLI9001` as `check`.
pub fn observations(
    request: &Request,
    selector: super::Selector,
    target: super::Selector,
) -> Result<(bool, bool), LexLeanError> {
    on_evaluation_stack(request, |request| {
        observations_inner(request, selector, target)
    })?
}

fn observations_inner(
    request: &Request,
    selector: super::Selector,
    target: super::Selector,
) -> Result<(bool, bool), LexLeanError> {
    let (mut keeps, mut cheaper) = (true, true);
    for argument in &request.domain {
        if let Status::Admitted { steps, .. } = argument_status(request, selector, argument)? {
            match argument_status(request, target, argument)? {
                Status::Admitted { steps: after, .. } => cheaper &= after < steps,
                Status::Inadmissible | Status::Unresolved => {
                    keeps = false;
                    cheaper = false;
                }
            }
        }
    }
    Ok((keeps, cheaper))
}

/// `Certification.preserves`: the schema improves the system and its
/// rewriting keeps the system's observations over the request's domain at
/// strictly lower cost.
///
/// # Errors
///
/// `LLS8002` beyond the host's integers, `LLV7010` and `LLI9001` as `check`.
pub fn preserves(
    request: &Request,
    selector: super::Selector,
    schema: Schema,
) -> Result<bool, LexLeanError> {
    on_evaluation_stack(request, |request| {
        preserves_inner(request, selector, schema)
    })?
}

fn preserves_inner(
    request: &Request,
    selector: super::Selector,
    schema: Schema,
) -> Result<bool, LexLeanError> {
    let Some(target) = rewrite(schema, selector) else {
        return Ok(false);
    };
    if !improves(request, selector, schema)? {
        return Ok(false);
    }
    let (keeps, cheaper) = observations_inner(request, selector, target)?;
    Ok(keeps && cheaper)
}

/// `Certification.certificateReductionsPreserve`: every `reduced` premise of
/// the certificate states a preserving application of its schema.
///
/// # Errors
///
/// As [`preserves`].
pub fn reductions_preserve(
    request: &Request,
    certificate: &Certificate,
) -> Result<bool, LexLeanError> {
    check_capacity(certificate)?;
    on_evaluation_stack(request, |request| {
        reductions_preserve_inner(request, certificate)
    })?
}

fn reductions_preserve_inner(
    request: &Request,
    certificate: &Certificate,
) -> Result<bool, LexLeanError> {
    if !matches!(request.carrier, Carrier::Grammar { .. }) {
        return Ok(false);
    }
    for (selector, premise) in expand(&request.carrier)
        .into_iter()
        .zip(&certificate.premises)
    {
        if let Premise::Reduced { schema } = premise {
            if !preserves_inner(request, selector, *schema)? {
                return Ok(false);
            }
        }
    }
    Ok(true)
}

/// `Certification.isNormal`.
///
/// # Errors
///
/// `LLS8002` beyond the host's integers.
pub fn is_normal(request: &Request, selector: super::Selector) -> Result<bool, LexLeanError> {
    for schema in [
        Schema::Collapse,
        Schema::SpecializeSmall,
        Schema::SpecializeLarge,
    ] {
        if improves(request, selector, schema)? {
            return Ok(false);
        }
    }
    Ok(true)
}

/// `Certification.pickFrom`.
fn pick_from(values: &[Value], positions: &[u64]) -> Vec<Value> {
    let mut picked = Vec::new();
    let mut wanted = positions.iter();
    let mut next = wanted.next();
    for (index, value) in values.iter().enumerate() {
        let Some(position) = next else { break };
        if *position == index as u64 {
            picked.push(value.clone());
            next = wanted.next();
        }
    }
    picked
}

/// `Certification.ascending`.
fn ascending(positions: &[u64]) -> bool {
    let mut lower = 0u64;
    for position in positions {
        if *position < lower {
            return false;
        }
        lower = position.saturating_add(1);
    }
    true
}

/// `Certification.premiseFact`.
fn premise_fact(
    request: &Request,
    selectors: &[super::Selector],
    selector: super::Selector,
    premise: &Premise,
) -> Result<Fact, LexLeanError> {
    let Some(system) = realize(&request.carrier, selector) else {
        return Ok(Fact::Unproven);
    };
    let fuel = request.machine.fuel;
    let overflow = || beyond_capacity("a system's cost exceeds the evaluator's integers");
    Ok(match premise {
        Premise::Excluded { position } => {
            let Some(argument) = usize::try_from(*position)
                .ok()
                .and_then(|index| request.domain.get(index))
            else {
                return Ok(Fact::Unproven);
            };
            match status_on(
                &system,
                &request.reference,
                fuel,
                std::slice::from_ref(argument),
            )? {
                Status::Inadmissible => Fact::Inadmissible,
                Status::Admitted { .. } | Status::Unresolved => Fact::Unproven,
            }
        }
        Premise::PaysAtLeast { positions } => {
            let picked = pick_from(&request.domain, positions);
            if picked.len() != positions.len() || !ascending(positions) {
                return Ok(Fact::Unproven);
            }
            match status_on(&system, &request.reference, fuel, &picked)? {
                Status::Admitted { steps, .. } => Fact::AtLeast {
                    cost: steps
                        .checked_add(static_charge(request, selector)?)
                        .ok_or_else(overflow)?,
                    size: static_size(request, selector),
                },
                Status::Inadmissible | Status::Unresolved => Fact::Unproven,
            }
        }
        Premise::Measured => match super::status_of(request, selector)? {
            Status::Admitted { steps, size } => Fact::Admitted { cost: steps, size },
            Status::Inadmissible => Fact::Inadmissible,
            Status::Unresolved => Fact::Unresolved,
        },
        Premise::Reduced { schema } => {
            let Some(target) = rewrite(*schema, selector) else {
                return Ok(Fact::Unproven);
            };
            let Some(position) = selectors.iter().position(|member| *member == target) else {
                return Ok(Fact::Unproven);
            };
            if improves(request, selector, *schema)? {
                Fact::Reduces {
                    target: position as u64,
                }
            } else {
                Fact::Unproven
            }
        }
    })
}

fn open(obligation: Obligation) -> Option<Obligation> {
    Some(obligation)
}

/// `Certification.lowerPosition`.
fn lower_position(
    strict: bool,
    bound: u64,
    attainer: bool,
    fact: Fact,
    position: u64,
) -> Option<Obligation> {
    match fact {
        Fact::Inadmissible => attainer.then_some(Obligation::AttainerInadmissible { position }),
        Fact::Admitted { cost, .. } => {
            if attainer {
                if cost == bound {
                    None
                } else if cost < bound {
                    open(Obligation::MemberBelowBound { position })
                } else {
                    open(Obligation::AttainerAboveBound { position })
                }
            } else if cost < bound {
                open(Obligation::MemberBelowBound { position })
            } else if strict && cost == bound {
                open(Obligation::AttainerOmitted { position })
            } else {
                None
            }
        }
        Fact::AtLeast { cost, .. } => {
            if attainer {
                open(Obligation::AttainerUnmeasured { position })
            } else if (strict && bound < cost) || (!strict && bound <= cost) {
                None
            } else {
                open(Obligation::MemberUnproven { position })
            }
        }
        Fact::Reduces { .. } => attainer.then_some(Obligation::AttainerUnmeasured { position }),
        Fact::Unresolved => open(Obligation::UnresolvedMember { position }),
        Fact::Unproven => open(Obligation::MemberUnproven { position }),
    }
}

fn not_certified() -> Established {
    Established::NotCertified
}

fn incomplete(obligation: Obligation, established: Established) -> Verdict {
    Verdict::Incomplete {
        obligation,
        established,
    }
}

/// `Certification.establishedFrom`.
fn established_from(facts: &[Fact], attainers: &[u64]) -> Established {
    let Some(head) = attainers.first() else {
        return not_certified();
    };
    match usize::try_from(*head)
        .ok()
        .and_then(|index| facts.get(index))
    {
        Some(Fact::Admitted { cost, size }) => Established::CorrectOnly {
            system: *head,
            steps: *cost,
            size: *size,
        },
        Some(
            Fact::Inadmissible
            | Fact::AtLeast { .. }
            | Fact::Reduces { .. }
            | Fact::Unresolved
            | Fact::Unproven,
        )
        | None => not_certified(),
    }
}

/// `Certification.lowerVerdict`.
fn lower_verdict(strict: bool, bound: u64, attainers: &[u64], facts: &[Fact]) -> Verdict {
    if !ascending(attainers)
        || !attainers
            .iter()
            .all(|position| *position < facts.len() as u64)
    {
        return incomplete(Obligation::AttainersMalformed, not_certified());
    }
    for (index, fact) in facts.iter().enumerate() {
        let position = index as u64;
        if let Some(obligation) = lower_position(
            strict,
            bound,
            attainers.contains(&position),
            *fact,
            position,
        ) {
            return incomplete(obligation, established_from(facts, attainers));
        }
    }
    if attainers.is_empty() {
        return incomplete(Obligation::BoundUnattained, not_certified());
    }
    Verdict::Certified {
        result: if strict {
            Certified::Argmin {
                members: attainers.to_vec(),
                steps: bound,
            }
        } else {
            Certified::Optimum {
                members: attainers.to_vec(),
                steps: bound,
            }
        },
    }
}

/// `Gnaf.factRows`.
fn fact_rows(facts: &[Fact]) -> Vec<(u64, Vec<u64>)> {
    facts
        .iter()
        .enumerate()
        .filter_map(|(index, fact)| match fact {
            Fact::Admitted { cost, size } => Some((index as u64, vec![*cost, *size])),
            Fact::Inadmissible
            | Fact::AtLeast { .. }
            | Fact::Reduces { .. }
            | Fact::Unresolved
            | Fact::Unproven => None,
        })
        .collect()
}

fn dominated_in(cost: &[u64], rows: &[(u64, Vec<u64>)]) -> bool {
    rows.iter().any(|(_, row)| dominates(row, cost))
}

/// `Certification.frontierPosition`.
fn frontier_position(
    member: bool,
    member_rows: &[(u64, Vec<u64>)],
    fact: Fact,
    position: u64,
) -> Option<Obligation> {
    if member {
        match fact {
            Fact::Admitted { cost, size } => dominated_in(&[cost, size], member_rows)
                .then_some(Obligation::FrontierMemberDominated { position }),
            Fact::Unresolved => open(Obligation::UnresolvedMember { position }),
            Fact::Unproven => open(Obligation::MemberUnproven { position }),
            Fact::Inadmissible | Fact::AtLeast { .. } | Fact::Reduces { .. } => {
                open(Obligation::FrontierMemberUnmeasured { position })
            }
        }
    } else {
        match fact {
            Fact::Inadmissible | Fact::Reduces { .. } => None,
            Fact::Admitted { cost, size } => (!dominated_in(&[cost, size], member_rows))
                .then_some(Obligation::FrontierMemberOmitted { position }),
            Fact::AtLeast { cost, size } => (!dominated_in(&[cost, size], member_rows))
                .then_some(Obligation::MemberUnproven { position }),
            Fact::Unresolved => open(Obligation::UnresolvedMember { position }),
            Fact::Unproven => open(Obligation::MemberUnproven { position }),
        }
    }
}

/// `Certification.frontierVerdict`.
fn frontier_verdict(members: &[u64], facts: &[Fact]) -> Verdict {
    let member_rows: Vec<(u64, Vec<u64>)> = fact_rows(facts)
        .into_iter()
        .filter(|(position, _)| members.contains(position))
        .collect();
    if !ascending(members)
        || !members
            .iter()
            .all(|position| *position < facts.len() as u64)
    {
        return incomplete(Obligation::AttainersMalformed, not_certified());
    }
    for (index, fact) in facts.iter().enumerate() {
        let position = index as u64;
        if let Some(obligation) =
            frontier_position(members.contains(&position), &member_rows, *fact, position)
        {
            return incomplete(obligation, not_certified());
        }
    }
    if members.is_empty() {
        return incomplete(Obligation::NoAdmittedMember, not_certified());
    }
    Verdict::Certified {
        result: Certified::Frontier {
            members: members.to_vec(),
        },
    }
}

/// `Certification.reductionVerdict`.
fn reduction_verdict(shape: u64, facts: &[Fact]) -> Verdict {
    for (index, fact) in facts.iter().enumerate() {
        let position = index as u64;
        let obligation = match fact {
            Fact::Inadmissible | Fact::Admitted { .. } | Fact::Reduces { .. } => None,
            Fact::Unresolved => open(Obligation::UnresolvedMember { position }),
            Fact::AtLeast { .. } | Fact::Unproven => {
                open(Obligation::ReductionIncomplete { position })
            }
        };
        if let Some(obligation) = obligation {
            return incomplete(obligation, not_certified());
        }
    }
    let rows = fact_rows(facts);
    if shape < 3 {
        let scalar: Vec<(u64, u64)> = rows.iter().map(|(id, cost)| (*id, cost[0])).collect();
        match argmin(&scalar) {
            None => incomplete(Obligation::NoAdmittedMember, not_certified()),
            Some((members, steps)) => lower_verdict(shape == 2, steps, &members, facts),
        }
    } else if rows.is_empty() {
        incomplete(Obligation::NoAdmittedMember, not_certified())
    } else {
        frontier_verdict(&frontier(&rows), facts)
    }
}

/// `Certification.bridgePosition`.
fn bridge_position(bridge: Bridge, fact: Fact, size: u64, position: u64) -> Option<Obligation> {
    let limit = bridge
        .slope
        .saturating_mul(size)
        .saturating_add(bridge.offset);
    match fact {
        Fact::Inadmissible => None,
        Fact::Admitted { cost, .. } => {
            (cost < limit).then_some(Obligation::BridgeViolated { position })
        }
        Fact::AtLeast { cost, .. } => {
            (cost < limit).then_some(Obligation::BridgeUnproved { position })
        }
        Fact::Reduces { .. } | Fact::Unproven => open(Obligation::BridgeUnproved { position }),
        Fact::Unresolved => open(Obligation::UnresolvedMember { position }),
    }
}

/// `Certification.representationVerdict`.
fn representation_verdict(
    normal: u64,
    bridge: Option<Bridge>,
    facts: &[Fact],
    sizes: &[u64],
) -> Verdict {
    let Some(normal_size) = usize::try_from(normal)
        .ok()
        .and_then(|index| sizes.get(index))
        .copied()
    else {
        return incomplete(Obligation::NormalOutOfRange, not_certified());
    };
    if let Some(smaller) = sizes.iter().position(|size| *size < normal_size) {
        return incomplete(
            Obligation::NormalNotMinimal {
                position: smaller as u64,
            },
            not_certified(),
        );
    }
    let Some(bridge) = bridge else {
        return incomplete(
            Obligation::BridgeMissing,
            Established::RepresentationMinimal {
                system: normal,
                size: normal_size,
            },
        );
    };
    for (index, fact) in facts.iter().enumerate() {
        let obligation = match sizes.get(index) {
            Some(size) => bridge_position(bridge, *fact, *size, index as u64),
            None => open(Obligation::BridgeUnproved {
                position: index as u64,
            }),
        };
        if let Some(obligation) = obligation {
            return incomplete(obligation, not_certified());
        }
    }
    let limit = bridge
        .slope
        .saturating_mul(normal_size)
        .saturating_add(bridge.offset);
    match usize::try_from(normal)
        .ok()
        .and_then(|index| facts.get(index))
    {
        Some(Fact::Admitted { cost, size }) => {
            if *cost == limit {
                Verdict::Certified {
                    result: Certified::Optimum {
                        members: vec![normal],
                        steps: *cost,
                    },
                }
            } else {
                incomplete(
                    Obligation::BoundUnattained,
                    Established::CorrectOnly {
                        system: normal,
                        steps: *cost,
                        size: *size,
                    },
                )
            }
        }
        _ => incomplete(Obligation::NormalUnmeasured, not_certified()),
    }
}

/// `Certification.normalityVerdict`.
fn normality_verdict(
    request: &Request,
    selectors: &[super::Selector],
    normal: u64,
    facts: &[Fact],
) -> Result<Verdict, LexLeanError> {
    let index = usize::try_from(normal).ok();
    Ok(match index.and_then(|index| facts.get(index)) {
        Some(Fact::Admitted { cost, size }) => match index.and_then(|index| selectors.get(index)) {
            None => incomplete(Obligation::NormalOutOfRange, not_certified()),
            Some(selector) => {
                if is_normal(request, *selector)? {
                    incomplete(
                        Obligation::OptimalityUnproved,
                        Established::LocallyNormalized { system: normal },
                    )
                } else {
                    incomplete(
                        Obligation::SystemNotNormal,
                        Established::CorrectOnly {
                            system: normal,
                            steps: *cost,
                            size: *size,
                        },
                    )
                }
            }
        },
        _ => incomplete(Obligation::NormalUnmeasured, not_certified()),
    })
}

fn refused(refusal: Refusal) -> Verdict {
    Verdict::Refused { refusal }
}

/// The rejection `Gnaf.validate` gives a carrier that is not a grammar.
const fn non_grammar_rejection(carrier: &Carrier) -> Option<Rejection> {
    match carrier {
        Carrier::Grammar { .. } => None,
        Carrier::InternalPlans => Some(Rejection::InternalPlanUniverse),
        Carrier::OptimizerOutput => Some(Rejection::OptimizerDefinedUniverse),
        Carrier::Discovered { .. } => Some(Rejection::DiscoveredUniverse),
        Carrier::Cached => Some(Rejection::CachedUniverse),
    }
}

fn check_inner(request: &Request, certificate: &Certificate) -> Result<Verdict, LexLeanError> {
    if certificate.verifier != VERIFIER {
        return Ok(refused(Refusal::VerifierMismatch));
    }
    if let Some(rejection) = validate(request) {
        return Ok(refused(Refusal::RequestRejected { rejection }));
    }
    // `validate` refused every carrier but a grammar above; the model's total
    // match over carriers names the same rejections, and no request reaches it.
    if let Some(rejection) = non_grammar_rejection(&request.carrier) {
        return Ok(refused(Refusal::RequestRejected { rejection }));
    }
    if certificate.universe != request.universe {
        return Ok(refused(Refusal::UniverseMismatch));
    }
    if certificate.objective != request.objective {
        return Ok(refused(Refusal::ObjectiveMismatch));
    }
    let shape = claim_shape(&certificate.claim);
    if shape == 0 || shape != claim_shape(&request.claim) {
        return Ok(refused(Refusal::ClaimMismatch));
    }
    if certificate.scope != request.scope {
        return Ok(refused(Refusal::ScopeMismatch));
    }
    let selectors = expand(&request.carrier);
    let count = selectors.len() as u64;
    let given = certificate.premises.len() as u64;
    if given < count {
        return Ok(refused(Refusal::MissingPremise { position: given }));
    }
    if count < given {
        return Ok(refused(Refusal::ExtraPremise { count }));
    }
    let mut facts = Vec::with_capacity(selectors.len());
    for (selector, premise) in selectors.iter().zip(&certificate.premises) {
        facts.push(premise_fact(request, &selectors, *selector, premise)?);
    }
    let incompatible = || refused(Refusal::RouteIncompatible);
    Ok(match &certificate.route {
        Route::LowerBound { bound, attainers } => {
            if shape < 3 {
                lower_verdict(shape == 2, *bound, attainers, &facts)
            } else {
                incompatible()
            }
        }
        Route::FrontierCover { members } => {
            if 3 <= shape {
                frontier_verdict(members, &facts)
            } else {
                incompatible()
            }
        }
        Route::Reduction => reduction_verdict(shape, &facts),
        Route::Representation { normal, bridge } => {
            if shape == 1 {
                let sizes: Vec<u64> = selectors
                    .iter()
                    .map(|selector| static_size(request, *selector))
                    .collect();
                representation_verdict(*normal, *bridge, &facts, &sizes)
            } else {
                incompatible()
            }
        }
        Route::Normality { system } => normality_verdict(request, &selectors, *system, &facts)?,
    })
}

/// `Certification.check`: the verdict a certificate earns for a request.
///
/// # Errors
///
/// `LLS8002` for a request or certificate beyond the host's capacities or a
/// cost beyond its integers, `LLV7010` when the platform cannot provide the
/// evaluation thread, `LLI9001` when the evaluation fails internally.
pub fn check(request: &Request, certificate: &Certificate) -> Result<Verdict, LexLeanError> {
    check_capacity(certificate)?;
    on_evaluation_stack(request, |request| check_inner(request, certificate))?
}

/// What one domain argument says about a system (the library's `Trial`):
/// it returns the reference's value in these steps, returns another outcome
/// or value, or the evaluation runs out of fuel before anything is known.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Trial {
    Agrees { steps: u64 },
    Disagrees,
    Unknown,
}

/// The trial of `selector` on each domain argument, in order, and the
/// preparation and size a premise about it adds: the evidence an author of a
/// certificate reads before offering a premise.
///
/// # Errors
///
/// As [`check`].
pub fn trials(
    request: &Request,
    selector: super::Selector,
) -> Result<(Vec<Trial>, u64, u64), LexLeanError> {
    on_evaluation_stack(request, |request| {
        let Some(system) = realize(&request.carrier, selector) else {
            return Ok((Vec::new(), 0, 0));
        };
        let fuel = request.machine.fuel;
        let mut out = Vec::new();
        for argument in &request.domain {
            let one = std::slice::from_ref(argument);
            out.push(match status_on(&system, &request.reference, fuel, one)? {
                Status::Admitted { steps, .. } => Trial::Agrees { steps },
                Status::Inadmissible => Trial::Disagrees,
                Status::Unresolved => Trial::Unknown,
            });
        }
        Ok((
            out,
            static_charge(request, selector)?,
            static_size(request, selector),
        ))
    })?
}

/// The first schema that improves `selector` on this request, if any: the
/// evidence an author of a certificate reads before offering a reduction.
///
/// # Errors
///
/// `LLS8002` beyond the host's integers.
pub fn improving_schema(
    request: &Request,
    selector: super::Selector,
) -> Result<Option<Schema>, LexLeanError> {
    for schema in [
        Schema::Collapse,
        Schema::SpecializeSmall,
        Schema::SpecializeLarge,
    ] {
        if improves(request, selector, schema)? {
            return Ok(Some(schema));
        }
    }
    Ok(None)
}

// --- LexLean terms -------------------------------------------------------------

fn model(name: &str, arguments: Vec<Json>) -> Json {
    json!({"kind": "constructor", "constructor": term::member(MODEL, name), "arguments": arguments})
}

fn gnaf(name: &str, arguments: Vec<Json>) -> Json {
    json!({"kind": "constructor", "constructor": term::member(GNAF, name), "arguments": arguments})
}

fn ids(members: &[u64]) -> Json {
    term::list(
        &json!({"kind": "nat"}),
        members.iter().map(|member| term::nat(*member)).collect(),
    )
}

fn premise_term(premise: &Premise) -> Json {
    match premise {
        Premise::Excluded { position } => model("Premise.excluded", vec![term::nat(*position)]),
        Premise::PaysAtLeast { positions } => model("Premise.paysAtLeast", vec![ids(positions)]),
        Premise::Measured => model("Premise.measured", Vec::new()),
        Premise::Reduced { schema } => model(
            "Premise.reduced",
            vec![model(
                &format!("Schema.{}", schema.constructor()),
                Vec::new(),
            )],
        ),
    }
}

fn route_term(route: &Route) -> Json {
    match route {
        Route::LowerBound { bound, attainers } => {
            model("Route.lowerBound", vec![term::nat(*bound), ids(attainers)])
        }
        Route::FrontierCover { members } => model("Route.frontierCover", vec![ids(members)]),
        Route::Reduction => model("Route.reduction", Vec::new()),
        Route::Representation { normal, bridge } => {
            let bridge_type = term::named(MODEL, "Bridge");
            let bridge = match bridge {
                None => json!({"kind": "constructor", "constructor": {"name": "Option.none"},
                               "arguments": [], "type_arguments": [bridge_type]}),
                Some(bridge) => json!({"kind": "constructor",
                "constructor": {"name": "Option.some"},
                "type_arguments": [bridge_type],
                "arguments": [json!({"kind": "record", "type": term::member(MODEL, "Bridge"),
                    "fields": [
                        {"field": "slope", "value": term::nat(bridge.slope)},
                        {"field": "offset", "value": term::nat(bridge.offset)},
                    ]})]}),
            };
            model("Route.representation", vec![term::nat(*normal), bridge])
        }
        Route::Normality { system } => model("Route.normality", vec![term::nat(*system)]),
    }
}

/// A certificate as a `Certification.Certificate` term.
#[must_use]
pub fn certificate_term(certificate: &Certificate) -> Json {
    let objective = match certificate.objective {
        Objective::Scalar => "Objective.scalar",
        Objective::Vector => "Objective.vector",
    };
    let scope = match certificate.scope {
        Scope::GrammarUniverse => "Scope.grammarUniverse",
        Scope::CalculusPrograms => "Scope.calculusPrograms",
        Scope::RustPrograms => "Scope.rustPrograms",
    };
    let claim = super::claim(&certificate.claim);
    let fields = vec![
        (
            "verifier",
            json!({"kind": "string", "value": certificate.verifier}),
        ),
        (
            "universe",
            json!({"kind": "string", "value": certificate.universe.to_hex()}),
        ),
        ("objective", gnaf(objective, Vec::new())),
        ("claim", claim),
        ("scope", gnaf(scope, Vec::new())),
        ("route", route_term(&certificate.route)),
        (
            "premises",
            term::list(
                &term::named(MODEL, "Premise"),
                certificate.premises.iter().map(premise_term).collect(),
            ),
        ),
    ];
    let fields: Vec<Json> = fields
        .into_iter()
        .map(|(field, value)| json!({"field": field, "value": value}))
        .collect();
    json!({"kind": "record", "type": term::member(MODEL, "Certificate"), "fields": fields})
}

fn refusal_term(refusal: &Refusal) -> Json {
    let simple = |name: &str| model(&format!("Refusal.{name}"), Vec::new());
    match refusal {
        Refusal::VerifierMismatch => simple("verifierMismatch"),
        Refusal::RequestRejected { rejection } => model(
            "Refusal.requestRejected",
            vec![super::rejection_term(rejection)],
        ),
        Refusal::UniverseMismatch => simple("universeMismatch"),
        Refusal::ObjectiveMismatch => simple("objectiveMismatch"),
        Refusal::ClaimMismatch => simple("claimMismatch"),
        Refusal::ScopeMismatch => simple("scopeMismatch"),
        Refusal::RouteIncompatible => simple("routeIncompatible"),
        Refusal::MissingPremise { position } => {
            model("Refusal.missingPremise", vec![term::nat(*position)])
        }
        Refusal::ExtraPremise { count } => model("Refusal.extraPremise", vec![term::nat(*count)]),
    }
}

fn obligation_term(obligation: &Obligation) -> Json {
    let simple = |name: &str| model(&format!("Obligation.{name}"), Vec::new());
    let at =
        |name: &str, position: u64| model(&format!("Obligation.{name}"), vec![term::nat(position)]);
    match obligation {
        Obligation::UnresolvedMember { position } => at("unresolvedMember", *position),
        Obligation::MemberUnproven { position } => at("memberUnproven", *position),
        Obligation::MemberBelowBound { position } => at("memberBelowBound", *position),
        Obligation::AttainerOmitted { position } => at("attainerOmitted", *position),
        Obligation::AttainerUnmeasured { position } => at("attainerUnmeasured", *position),
        Obligation::AttainerInadmissible { position } => at("attainerInadmissible", *position),
        Obligation::AttainerAboveBound { position } => at("attainerAboveBound", *position),
        Obligation::AttainersMalformed => simple("attainersMalformed"),
        Obligation::BoundUnattained => simple("boundUnattained"),
        Obligation::FrontierMemberUnmeasured { position } => {
            at("frontierMemberUnmeasured", *position)
        }
        Obligation::FrontierMemberDominated { position } => {
            at("frontierMemberDominated", *position)
        }
        Obligation::FrontierMemberOmitted { position } => at("frontierMemberOmitted", *position),
        Obligation::ReductionIncomplete { position } => at("reductionIncomplete", *position),
        Obligation::NoAdmittedMember => simple("noAdmittedMember"),
        Obligation::BridgeMissing => simple("bridgeMissing"),
        Obligation::BridgeViolated { position } => at("bridgeViolated", *position),
        Obligation::BridgeUnproved { position } => at("bridgeUnproved", *position),
        Obligation::NormalOutOfRange => simple("normalOutOfRange"),
        Obligation::NormalNotMinimal { position } => at("normalNotMinimal", *position),
        Obligation::NormalUnmeasured => simple("normalUnmeasured"),
        Obligation::OptimalityUnproved => simple("optimalityUnproved"),
        Obligation::SystemNotNormal => simple("systemNotNormal"),
    }
}

fn established_term(established: &Established) -> Json {
    match established {
        Established::NotCertified => model("Established.notCertified", Vec::new()),
        Established::CorrectOnly {
            system,
            steps,
            size,
        } => model(
            "Established.correctOnly",
            vec![term::nat(*system), term::nat(*steps), term::nat(*size)],
        ),
        Established::LocallyNormalized { system } => {
            model("Established.locallyNormalized", vec![term::nat(*system)])
        }
        Established::RepresentationMinimal { system, size } => model(
            "Established.representationMinimal",
            vec![term::nat(*system), term::nat(*size)],
        ),
    }
}

/// A verdict as a `Certification.Verdict` term.
#[must_use]
pub fn verdict_term(verdict: &Verdict) -> Json {
    match verdict {
        Verdict::Refused { refusal } => model("Verdict.refused", vec![refusal_term(refusal)]),
        Verdict::Certified { result } => model(
            "Verdict.certified",
            vec![match result {
                Certified::Optimum { members, steps } => {
                    model("Certified.optimum", vec![ids(members), term::nat(*steps)])
                }
                Certified::Argmin { members, steps } => {
                    model("Certified.argmin", vec![ids(members), term::nat(*steps)])
                }
                Certified::Frontier { members } => model("Certified.frontier", vec![ids(members)]),
            }],
        ),
        Verdict::Incomplete {
            obligation,
            established,
        } => model(
            "Verdict.incomplete",
            vec![obligation_term(obligation), established_term(established)],
        ),
    }
}
