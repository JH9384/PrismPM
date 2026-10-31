//! `check <path.holo>`: the typed verdict of issue #270, the Rust half.
//!
//! The verdict is `prism/verdict/1` (`docs/proposals/269-assurance-levels.md`):
//! the assurance level computed from the evidence in the holo, whether a
//! policy accepts it, and a reason for every check that did not pass. The
//! checks, their ids, their order and the levels they withhold are those of
//! `@prism-code/verify` (`sdk/npm/verify/src/index.mjs`, vendored into
//! `prism-code`), so `prismpm check`, `prism-code check`, `holo.verify()` and
//! `@prism-code/verify` cannot disagree on a holo they all read. The policy is
//! a verify-time input, a JSON file given with `--policy`, and is never read
//! from the holo.
//!
//! The archive is read through the modeled `Foundation.Holo.V1.Wire`
//! accessors, as `inspect` reads it. Unlike `holo::archive::parse_application`,
//! which refuses at the first problem, this reader records every finding: a
//! footer or a label that does not recompute is a reason, not an error,
//! because a damaged holo still has a verdict (P0). Only a file whose header or
//! section table cannot be read, or an intact archive whose layout no format
//! revision names, has no verdict.
//!
//! This reader admits the attestation section of #267. The statements it holds
//! are decoded and compared with the archive they travel in; their signatures
//! are not verified until the trust root of #272 reaches the Rust CLI, so a
//! present statement fails its `.envelope` check today and the level stays at
//! P0. A statement's own `verifiedLevels` is a claim and never an input.
//!
//! Experimental until the v0.6 freeze (STABILITY.md section 6).

use super::{
    blake3_hex, hex, holoview_version, prefix_identifier, read_interface, sha256_hex, world_purity,
    Export, Import, CORE_WASM_CONTRACT, CORE_WASM_WORLD_BLAKE3, CORE_WASM_WORLD_SHA256,
    HOLOVIEW_VERSION, IMPURE_EFFECTS, KIND_APP_MANIFEST, KIND_CONTENT_BLOB, KIND_EXTENSION,
    KIND_METADATA, MODEL_DOCUMENT_SCHEMAS, PROVENANCE_SCHEMA, REVISION_2026_10_23,
    SOURCE_MANIFEST_VERSION, WORLD_EXPORTS,
};
use crate::error::PrismError;
use crate::holo::attestation::{self, Attestation, ATTESTATION_EXTENSION};
use prism_stdlib as wire;
use serde::Deserialize;
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::fmt;
use std::path::Path;

/// The `schema` member of a verdict.
pub const VERDICT_SCHEMA: &str = "prism/verdict/1";
/// The name of the policy `check` applies when none is given.
pub const DEFAULT_POLICY: &str = "default";
/// The level the default policy requires.
pub const DEFAULT_MINIMUM: Level = Level::P2;
/// The environment variable that sets the minimum level when the policy names none.
pub const MINIMUM_LEVEL_ENV: &str = "PRISM_MINIMUM_LEVEL";
/// The format revision this reader knows. The attestation section (#267) is
/// admitted as a ninth row of this revision because the wire model this CLI
/// embeds admits it; `@prism-code/spec` dates the section's revision separately.
pub const FORMAT_REVISION: &str = REVISION_2026_10_23;
/// Exit code of `check` when the policy passes.
pub const EXIT_PASSED: u8 = 0;
/// Exit code of `check` when the policy fails.
pub const EXIT_FAILED: u8 = 1;
/// Exit code of `check` when no verdict was reached.
pub const EXIT_NO_VERDICT: u8 = 2;

/// The predicate type whose statement serves P1.
pub const PROVENANCE_PREDICATE: &str = "https://slsa.dev/provenance/v1";
/// The predicate type whose statement serves P2 (#266).
pub const PROOF_PREDICATE: &str = "https://uor.foundation/prism/proof/v1";
/// The predicate type whose statement serves P3 (#284).
pub const REPLAY_PREDICATE: &str = "https://uor.foundation/prism/replay/v1";

/// `check` could not judge the holo: the exit 2 diagnostic.
pub const NO_VERDICT: &str = "PP5603";
const PROOF_ENVELOPE: &str = "PP5501";
const PROOF_STATEMENT: &str = "PP5502";
const PROOF_SUBJECT: &str = "PP5503";
const PROOF_MODEL: &str = "PP5504";
const PROOF_VERDICT: &str = "PP5506";
const PROOF_TCB: &str = "PP5507";
const LEVEL_BELOW_MINIMUM: &str = "PP5601";
const WORLD_EXCEEDS_GRANT: &str = "PP5602";

/// The seven components of the named TCB (`docs/proposals/266-proof-predicate.md`).
const TCB_COMPONENTS: [&str; 7] = [
    "lean4-kernel",
    "leanchecker",
    "lexlean",
    "lean4-prod",
    "rustc",
    "wasm-bindgen-cli",
    "sdk-image",
];

/// The members a policy file may hold. Signer trust and attestation rules arrive with #285.
const POLICY_MEMBERS: [&str; 5] = ["name", "minimum", "digests", "world", "effects"];
/// The parts of a holo a policy can pin a digest of.
const DIGEST_TARGETS: [&str; 5] = ["archive", "capabilities", "guest", "view", "model"];
const CAPABILITY_KINDS: [&str; 3] = ["outbound-hosts", "key-value-stores", "variables"];

/// The application manifest: `Foundation.Holo.V1.Wire.validAppManifest`.
const MANIFEST_LENGTH: usize = 356;
const LABEL_LENGTH: usize = 71;
const LABEL_PREFIX: &[u8] = b"blake3:";
const MANIFEST_LABELS: [&str; 3] = ["capability-set", "guest", "view"];
const EIGHT_ROWS: [u8; 8] = [15, 8, 14, 14, 16, 16, 16, 16];
const NINE_ROWS: [u8; 9] = [15, 8, 14, 14, 16, 16, 16, 16, 14];

/// What the check trusts the signer for, printed with every verdict that
/// reaches P2 (`docs/proposals/266-proof-predicate.md`, "What `prism check` cannot know").
pub const LIMITS: [&str; 4] = [
    "That the kernel really accepted the proofs: the statement says so; only a replay shows it.",
    "That the shipped wasm computes what the Lean defines: no proof exists; the acceptance corpus is evidence.",
    "That the theorems mean what the author intended: reading the generated Lean is the only way.",
    "That the named SDK image was the one used: the signature binds the claim, not the execution.",
];

/// An assurance level, weakest first. Each level includes every requirement
/// of the levels below it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub enum Level {
    /// Nothing: the file is a holo that `check` could read.
    P0,
    /// The archive recomputes and a provenance statement verifies.
    P1,
    /// P1, and a proof statement passes every proof check.
    P2,
    /// P2, a replay statement verifies, and the world fits its capabilities.
    P3,
}

impl Level {
    /// Every level, in rank order.
    pub const ALL: [Level; 4] = [Level::P0, Level::P1, Level::P2, Level::P3];

    /// The level a policy or an environment variable names, if any.
    #[must_use]
    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|level| level.as_str() == text)
    }

    /// The spelling used in a verdict.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::P0 => "P0",
            Self::P1 => "P1",
            Self::P2 => "P2",
            Self::P3 => "P3",
        }
    }

    /// The level's index in [`Level::ALL`].
    #[must_use]
    pub fn rank(self) -> usize {
        self as usize
    }

    /// The short name printed beside the level.
    #[must_use]
    pub fn name(self) -> &'static str {
        match self {
            Self::P0 => "unverified",
            Self::P1 => "provenance",
            Self::P2 => "proof checked",
            Self::P3 => "proof, replay and world",
        }
    }
}

impl fmt::Display for Level {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter.write_str(self.as_str())
    }
}

/// One check that did not pass.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reason {
    /// The stable dotted check id, such as `proof.subject`.
    pub check: String,
    /// The registered diagnostic, when the check has one.
    pub code: Option<&'static str>,
    /// The lowest level this failure withholds; `None` for a policy rule.
    pub withholds: Option<Level>,
    /// One sentence for a person. Not part of the contract.
    pub message: String,
}

impl Reason {
    fn new(
        check: &str,
        code: Option<&'static str>,
        withholds: Option<Level>,
        message: String,
    ) -> Self {
        Self {
            check: check.to_owned(),
            code,
            withholds,
            message,
        }
    }

    fn value(&self) -> Value {
        let mut row = Map::new();
        row.insert("check".to_owned(), json!(self.check));
        if let Some(code) = self.code {
            row.insert("code".to_owned(), json!(code));
        }
        row.insert(
            "withholds".to_owned(),
            self.withholds
                .map_or(Value::Null, |level| json!(level.as_str())),
        );
        row.insert("message".to_owned(), json!(self.message));
        Value::Object(row)
    }
}

/// The verdict on one holo: a `prism/verdict/1` object.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Verdict {
    /// The archive fingerprint, `blake3:` and 64 hex, computed over the body.
    pub holo: String,
    /// The highest level no reason withholds.
    pub level: Level,
    /// `default`, or the policy file as given to `--policy`.
    pub policy_name: String,
    /// The lowest level the policy accepts.
    pub minimum: Level,
    /// The policy's answer.
    pub passed: bool,
    /// Every check that did not pass, in evaluation order.
    pub reasons: Vec<Reason>,
}

impl Verdict {
    /// The verdict as the JSON object `--json` prints.
    #[must_use]
    pub fn value(&self) -> Value {
        json!({
            "schema": VERDICT_SCHEMA,
            "holo": self.holo,
            "level": self.level.as_str(),
            "policy": { "name": self.policy_name, "minimum": self.minimum.as_str() },
            "passed": self.passed,
            "reasons": self.reasons.iter().map(Reason::value).collect::<Vec<_>>(),
        })
    }

    /// 0 when the policy passed, 1 when it failed.
    #[must_use]
    pub fn exit_code(&self) -> u8 {
        if self.passed {
            EXIT_PASSED
        } else {
            EXIT_FAILED
        }
    }

    /// The verdict as text for a person, as `prism-code check` prints it. The
    /// message of a reason is never part of the contract.
    #[must_use]
    pub fn text(&self, path: Option<&str>) -> String {
        let mut lines = vec![format!(
            "{}  {} {}  policy {} requires {} or above",
            if self.passed { "PASSED" } else { "FAILED" },
            self.level,
            self.level.name(),
            self.policy_name,
            self.minimum
        )];
        if let Some(path) = path {
            lines.push(format!("holo    {path}"));
        }
        lines.push(format!("digest  {}", self.holo));
        if !self.reasons.is_empty() {
            lines.push(String::new());
            lines.push("Reasons:".to_owned());
            for reason in &self.reasons {
                let mut tags = Vec::new();
                if let Some(code) = reason.code {
                    tags.push(code.to_owned());
                }
                tags.push(title_of(&reason.check).to_owned());
                tags.push(match reason.withholds {
                    Some(level) => format!("withholds {level}"),
                    None => "policy rule".to_owned(),
                });
                lines.push(format!("  {} ({})", reason.check, tags.join(", ")));
                lines.push(format!("    {}", reason.message));
            }
        }
        if self.level >= Level::P2 {
            lines.push(String::new());
            lines.push("This check trusts the signer for what it cannot know:".to_owned());
            for limit in LIMITS {
                lines.push(format!("  {limit}"));
            }
        }
        lines.push(String::new());
        lines.join("\n")
    }
}

/// The human title of a check id: the error class of `prism-code` without its
/// `Error` suffix, such as `ProofMismatch` for `proof.subject`.
#[must_use]
pub fn title_of(check: &str) -> &'static str {
    if check.starts_with("proof.") {
        "ProofMismatch"
    } else if check == "world.capabilities" || check.starts_with("capabilities.") {
        "CapabilityDenied"
    } else if check == "world.contract" || check == "world.hash" {
        "WorldMismatch"
    } else if check == "replay.divergence" {
        "DeterminismViolation"
    } else if check.starts_with("replay.") {
        "Replay"
    } else {
        "Verification"
    }
}

/// No verdict was reached. `check` names what stopped it, as `prism-code`
/// spells it: `load.path`, `verify.kind`, `policy.unreadable`,
/// `policy.invalid`, `archive.magic`, `archive.version`, `archive.flags`,
/// `archive.table` or `format.revision`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NoVerdict {
    /// Which step could not be carried out.
    pub check: &'static str,
    /// Why, for a person.
    pub message: String,
}

impl NoVerdict {
    /// A step that could not be carried out, named as `prism-code` names it.
    pub fn new(check: &'static str, message: impl Into<String>) -> Self {
        Self {
            check,
            message: message.into(),
        }
    }

    /// The registered diagnostic `check` prints on stderr before exiting 2.
    #[must_use]
    pub fn diagnostic(&self) -> PrismError {
        PrismError::new(NO_VERDICT, self.to_string())
    }
}

impl fmt::Display for NoVerdict {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(formatter, "no verdict: {}: {}", self.check, self.message)
    }
}

/// A pinned world, in the shape of the lock's `inputs.world` (#278).
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct WorldPin {
    /// The guest contract the holo must declare.
    pub contract: Option<String>,
    /// BLAKE3 of the WIT file.
    pub blake3: Option<String>,
    /// SHA-256 of the WIT file.
    pub sha256: Option<String>,
}

/// The policy a holo is judged by. Every member is optional; the defaults are
/// the default policy, `P2` or above with nothing pinned.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Policy {
    /// The name the verdict reports; `default` when absent.
    pub name: Option<String>,
    /// The lowest level accepted; `P2` when absent.
    pub minimum: Option<Level>,
    /// Pinned digests by target (`archive`, `capabilities`, `guest`, `view`,
    /// `model`) and algorithm (`sha256`, `blake3`), lowercase hex.
    pub digests: BTreeMap<String, BTreeMap<String, String>>,
    /// `None` pins nothing; `Some(None)` says no world is expected.
    pub world: Option<Option<WorldPin>>,
    /// The impure effects the world may import; `Some(vec![])` is the pure-world policy.
    pub effects: Option<Vec<String>>,
    /// The granted capability set, one set of a `prism/capabilities/1` file.
    /// `None` grants nothing. A policy file never grants; `run` does (#282).
    pub capabilities: Option<Value>,
    /// The signer the caller trusts (`--key`, or a certificate identity and
    /// issuer, and `--trusted-root`). A policy file never names one: like
    /// `capabilities` it is the caller's. Without it no signature counts and a
    /// signed holo is P0 (#270).
    pub signer: Option<crate::attest::VerifyPolicy>,
}

fn hex64(text: &str) -> bool {
    text.len() == 64
        && text
            .bytes()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn invalid(message: impl Into<String>) -> NoVerdict {
    NoVerdict::new("policy.invalid", message)
}

impl Policy {
    /// The policy members of one JSON object, checked as `@prism-code/verify`
    /// checks them. The caller has already refused the members it does not admit.
    fn from_value(value: &Value) -> Result<Self, NoVerdict> {
        let object = value
            .as_object()
            .ok_or_else(|| invalid("the policy must be an object"))?;
        let mut policy = Self::default();
        if let Some(name) = object.get("name") {
            policy.name = Some(
                name.as_str()
                    .filter(|name| (1..=1024).contains(&name.chars().count()))
                    .ok_or_else(|| invalid("policy.name must be a string of 1 to 1024 characters"))?
                    .to_owned(),
            );
        }
        if let Some(minimum) = object.get("minimum") {
            policy.minimum = Some(minimum.as_str().and_then(Level::parse).ok_or_else(|| {
                invalid(format!(
                    "policy.minimum {minimum} is not one of {}",
                    Level::ALL.map(Level::as_str).join(", ")
                ))
            })?);
        }
        if let Some(digests) = object.get("digests") {
            let digests = digests
                .as_object()
                .ok_or_else(|| invalid("policy.digests must be an object"))?;
            for (target, set) in digests {
                if !DIGEST_TARGETS.contains(&target.as_str()) {
                    return Err(invalid(format!(
                        "policy.digests.{target} is not one of {}",
                        DIGEST_TARGETS.join(", ")
                    )));
                }
                let set = set
                    .as_object()
                    .filter(|set| !set.is_empty())
                    .ok_or_else(|| invalid(format!("policy.digests.{target} names no digest")))?;
                let mut pinned = BTreeMap::new();
                for (algorithm, digest) in set {
                    if algorithm != "sha256" && algorithm != "blake3" {
                        return Err(invalid(format!(
                            "policy.digests.{target}.{algorithm}: only sha256 and blake3 are known"
                        )));
                    }
                    let digest =
                        digest
                            .as_str()
                            .filter(|digest| hex64(digest))
                            .ok_or_else(|| {
                                invalid(format!(
                            "policy.digests.{target}.{algorithm} is not 64 lowercase hex characters"
                        ))
                            })?;
                    pinned.insert(algorithm.clone(), digest.to_owned());
                }
                policy.digests.insert(target.clone(), pinned);
            }
        }
        if let Some(world) = object.get("world") {
            policy.world = Some(world_pin(world)?);
        }
        if let Some(effects) = object.get("effects") {
            let effects = effects
                .as_array()
                .and_then(|effects| {
                    effects
                        .iter()
                        .map(|effect| {
                            effect
                                .as_str()
                                .filter(|effect| IMPURE_EFFECTS.contains(effect))
                                .map(str::to_owned)
                        })
                        .collect::<Option<Vec<_>>>()
                })
                .ok_or_else(|| {
                    invalid(format!(
                        "policy.effects must be an array of {}",
                        IMPURE_EFFECTS.join(", ")
                    ))
                })?;
            if effects.iter().collect::<BTreeSet<_>>().len() != effects.len() {
                return Err(invalid("policy.effects repeats an effect"));
            }
            policy.effects = Some(effects);
        }
        if let Some(capabilities) = object.get("capabilities").filter(|set| !set.is_null()) {
            if let Some(problem) = capability_set_problem(capabilities) {
                return Err(invalid(format!("policy.capabilities: {problem}")));
            }
            policy.capabilities = Some(capabilities.clone());
        }
        Ok(policy)
    }

    /// Fill the minimum from the environment when the policy names none:
    /// `PRISM_MINIMUM_LEVEL`, as `holo.verify()` reads it.
    pub fn with_environment(mut self, minimum: Option<&str>) -> Result<Self, NoVerdict> {
        if self.minimum.is_none() {
            if let Some(text) = minimum.filter(|text| !text.is_empty()) {
                self.minimum = Some(Level::parse(text).ok_or_else(|| {
                    invalid(format!(
                        "{MINIMUM_LEVEL_ENV} is {}; expected one of {}",
                        json!(text),
                        Level::ALL.map(Level::as_str).join(", ")
                    ))
                })?);
            }
        }
        Ok(self)
    }

    fn resolved_name(&self) -> &str {
        self.name.as_deref().unwrap_or(DEFAULT_POLICY)
    }

    fn resolved_minimum(&self) -> Level {
        self.minimum.unwrap_or(DEFAULT_MINIMUM)
    }
}

fn world_pin(value: &Value) -> Result<Option<WorldPin>, NoVerdict> {
    if value.is_null() {
        return Ok(None);
    }
    let object = value.as_object().ok_or_else(|| {
        invalid("policy.world must be an object, as in the inputs.world of the lock, or null")
    })?;
    for key in object.keys() {
        if !["contract", "blake3", "sha256"].contains(&key.as_str()) {
            return Err(invalid(format!(
                "policy.world.{key} is not one of contract, blake3, sha256"
            )));
        }
    }
    if object.is_empty() {
        return Err(invalid("policy.world names nothing"));
    }
    let mut pin = WorldPin::default();
    if let Some(contract) = object.get("contract") {
        pin.contract = Some(
            contract
                .as_str()
                .filter(|contract| !contract.is_empty())
                .ok_or_else(|| invalid("policy.world.contract must be a string"))?
                .to_owned(),
        );
    }
    for (algorithm, slot) in [("blake3", &mut pin.blake3), ("sha256", &mut pin.sha256)] {
        if let Some(digest) = object.get(algorithm) {
            *slot = Some(
                digest
                    .as_str()
                    .filter(|digest| hex64(digest))
                    .ok_or_else(|| {
                        invalid(format!(
                            "policy.world.{algorithm} is not 64 lowercase hex characters"
                        ))
                    })?
                    .to_owned(),
            );
        }
    }
    Ok(Some(pin))
}

/// The shape of one capability set (#279): an object of `allow-` and `deny-`
/// lists of strings. The entries' syntax is the runtime's to check.
fn capability_set_problem(set: &Value) -> Option<String> {
    let members = CAPABILITY_KINDS
        .iter()
        .flat_map(|kind| [format!("allow-{kind}"), format!("deny-{kind}")])
        .collect::<Vec<_>>();
    let Some(object) = set.as_object() else {
        return Some("a capability set is an object of allow- and deny- lists".to_owned());
    };
    for (member, entries) in object {
        if !members.contains(member) {
            return Some(format!(
                "a capability set has no member {member}; it has {}",
                members.join(", ")
            ));
        }
        if !entries
            .as_array()
            .is_some_and(|entries| entries.iter().all(Value::is_string))
        {
            return Some(format!("{member} must be an array of strings"));
        }
    }
    None
}

/// Read a policy file: one JSON object whose members are `name`, `minimum`,
/// `digests`, `world` and `effects`. Without a `name`, the policy is named by
/// the path as given. A Rego file (#285) is refused by its extension, naming
/// what is missing, rather than read as JSON: the Rust CLI evaluates no Rego
/// until the Rust half of #285.
pub fn read_policy(path: &Path) -> Result<Policy, NoVerdict> {
    let shown = path.display();
    if path
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("rego"))
    {
        return Err(invalid(format!(
            "the policy file {shown} is Rego, which prismpm check does not evaluate yet (#285);              give the JSON form with {}",
            POLICY_MEMBERS.join(", ")
        )));
    }
    let text = std::fs::read_to_string(path).map_err(|error| {
        NoVerdict::new(
            "policy.unreadable",
            format!("the policy file {shown} cannot be read: {error}"),
        )
    })?;
    let value: Value = serde_json::from_str(&text)
        .map_err(|error| invalid(format!("the policy file {shown} is not JSON: {error}")))?;
    let object = value
        .as_object()
        .ok_or_else(|| invalid(format!("the policy file {shown} must hold one JSON object")))?;
    let unknown = object
        .keys()
        .filter(|key| !POLICY_MEMBERS.contains(&key.as_str()))
        .cloned()
        .collect::<Vec<_>>();
    if !unknown.is_empty() {
        return Err(invalid(format!(
            "the policy file {shown} has unknown members {}; expected {}",
            unknown.join(", "),
            POLICY_MEMBERS.join(", ")
        )));
    }
    let mut policy = Policy::from_value(&value)?;
    if policy.name.is_none() {
        policy.name = Some(shown.to_string());
    }
    Ok(policy)
}

/// Judge the holo at `holo` by the policy file at `policy`, or the default
/// policy, with `minimum` the value of `PRISM_MINIMUM_LEVEL` if set.
pub fn check_path(
    holo: &Path,
    policy: Option<&Path>,
    minimum: Option<&str>,
) -> Result<Verdict, NoVerdict> {
    check_path_with(holo, policy, minimum, None)
}

/// [`check_path`] with the signer the caller trusts (#270): the statements of
/// the attestation section count only when their signatures verify against it.
pub fn check_path_with(
    holo: &Path,
    policy: Option<&Path>,
    minimum: Option<&str>,
    signer: Option<crate::attest::VerifyPolicy>,
) -> Result<Verdict, NoVerdict> {
    let mut policy = match policy {
        Some(path) => read_policy(path)?,
        None => Policy::default(),
    }
    .with_environment(minimum)?;
    policy.signer = signer;
    let shown = holo.display();
    let metadata = std::fs::metadata(holo)
        .map_err(|_| NoVerdict::new("load.path", format!("{shown} does not exist")))?;
    if metadata.is_dir() {
        return Err(NoVerdict::new(
            "verify.kind",
            format!("{shown} is a directory; check reads a .holo archive, and a closure has no footer or section table"),
        ));
    }
    let bytes = std::fs::read(holo)
        .map_err(|error| NoVerdict::new("load.path", format!("{shown} cannot be read: {error}")))?;
    verify(&bytes, &policy)
}

// ---------------------------------------------------------------- the archive

/// The application directory extension, the exact closed shape
/// `holo::archive` writes. Mirrored here rather than shared so that
/// `holo/archive.rs`, whose bytes the shared golden baseline hashes
/// (`scripts/native-golden.mjs`), stays untouched by the verdict reader.
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Directory {
    #[allow(dead_code)]
    schema_version: u16,
    #[allow(dead_code)]
    primary_layer: Option<u32>,
    requires_kappa: String,
    layers: Vec<DirectoryLayer>,
    #[allow(dead_code)]
    children: Vec<DirectoryChild>,
    blobs: Vec<DirectoryBlob>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectoryLayer {
    #[allow(dead_code)]
    position: u32,
    kind: String,
    content_kappa: String,
    #[allow(dead_code)]
    entry: String,
    contract: Option<String>,
    #[allow(dead_code)]
    architecture: Option<String>,
    #[allow(dead_code)]
    surface: Option<String>,
    #[allow(dead_code)]
    engine: Option<String>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectoryChild {
    position: u32,
    application_kappa: String,
    capabilities_kappa: String,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DirectoryBlob {
    kappa: String,
    byte_length: u64,
}

/// The `prismpm/model-provenance/1` extension, the exact closed shape
/// `holo::archive` writes, mirrored for the same reason as [`Directory`].
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ModelProvenanceV1 {
    schema: String,
    model_content_kappa: String,
    model_id: String,
    source_id: String,
    semantic_id: String,
    compiler_semantics_id: String,
    snapshot_id: String,
    stdlib_semantics_id: String,
    prism_stdlib_crate_sha256: String,
    lexlean_commit: String,
    lexlean_package_sha256: String,
    lean4_prod_commit: String,
    hologram_live_commit: String,
    uor_hologram_commit: String,
    target_profile_id: String,
    core_wasm_contract: String,
    lean_manifest_sha256: String,
    lcnf_manifest_sha256: String,
    generated_core_sha256: String,
    cargo_name: String,
    cargo_version: String,
    cargo_crate_sha256: String,
    guest_content_kappa: String,
    view_binding: ViewBinding,
    application_kappa: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(tag = "tag", rename_all = "lowercase", deny_unknown_fields)]
enum BrowserProjection {
    None,
    Present { sha256: String },
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(tag = "tag", rename_all = "lowercase", deny_unknown_fields)]
enum ViewBinding {
    None,
    Present {
        view_model_id: String,
        view_content_kappa: String,
        browser_projection: BrowserProjection,
    },
}

/// One row of the section table, decoded as far as its kind allows. Problems
/// are recorded, never thrown.
struct Row {
    index: usize,
    kind: u8,
    bytes: Vec<u8>,
    /// A content blob's label, when it starts with one.
    label: Option<String>,
    /// A content blob's bytes after the label.
    content: Vec<u8>,
    label_matches: bool,
    /// An extension row's name.
    name: Option<String>,
    /// The bytes after an extension name, or the whole section.
    payload: Vec<u8>,
    problem: Option<String>,
}

impl Row {
    fn content_digests(&self) -> (String, String) {
        (sha256_hex(&self.content), blake3_hex(&self.content))
    }
}

fn is_label(bytes: &[u8]) -> bool {
    bytes.len() == LABEL_LENGTH
        && bytes.starts_with(LABEL_PREFIX)
        && bytes[LABEL_PREFIX.len()..]
            .iter()
            .all(|byte| matches!(byte, b'0'..=b'9' | b'a'..=b'f'))
}

fn decode_row(index: usize, kind: u8, bytes: Vec<u8>) -> Row {
    let mut row = Row {
        index,
        kind,
        label: None,
        content: Vec::new(),
        label_matches: false,
        name: None,
        payload: Vec::new(),
        problem: None,
        bytes,
    };
    match kind {
        KIND_CONTENT_BLOB => {
            if row.bytes.len() < LABEL_LENGTH || !is_label(&row.bytes[..LABEL_LENGTH]) {
                row.problem = Some("the blob does not start with a blake3 label".to_owned());
            } else {
                let label = String::from_utf8_lossy(&row.bytes[..LABEL_LENGTH]).into_owned();
                row.content = row.bytes[LABEL_LENGTH..].to_vec();
                row.label_matches = label == format!("blake3:{}", blake3_hex(&row.content));
                row.label = Some(label);
            }
        }
        KIND_EXTENSION => {
            let length = (row.bytes.len() >= 2)
                .then(|| usize::from(u16::from_le_bytes([row.bytes[0], row.bytes[1]])));
            match length {
                Some(length) if 2 + length <= row.bytes.len() => {
                    match std::str::from_utf8(&row.bytes[2..2 + length]) {
                        Ok(name) => {
                            row.name = Some(name.to_owned());
                            row.payload = row.bytes[2 + length..].to_vec();
                        }
                        Err(_) => row.problem = Some("the extension name is not UTF-8".to_owned()),
                    }
                }
                _ => row.problem = Some("the extension name overruns the section".to_owned()),
            }
        }
        _ => row.payload = row.bytes.clone(),
    }
    row
}

/// One internal check. `id` is the check as `@prism-code/verify` names it;
/// the verdict reports it under the id `reported_as` gives.
struct Finding {
    id: &'static str,
    ok: bool,
    detail: String,
}

/// The order the internal checks are reported in.
const CHECK_ORDER: [&str; 11] = [
    "archive.footer",
    "blob.labels",
    "format.revision",
    "manifest.wire",
    "metadata.schema",
    "directory.schema",
    "provenance.schema",
    "model.schema",
    "references",
    "model.sha256",
    "world.contract",
];

/// The verdict check id each internal check reports under. `holo.integrity`
/// covers every fingerprint that must recompute or agree; `holo.documents`
/// covers the documents inside; `world.contract` is the guest not having the
/// interface its WIT world declares (#278). All withhold P1.
fn reported_as(id: &str) -> Option<&'static str> {
    match id {
        "archive.footer" | "blob.labels" | "references" | "model.sha256" => Some("holo.integrity"),
        "format.revision" | "manifest.wire" | "metadata.schema" | "directory.schema"
        | "provenance.schema" | "model.schema" => Some("holo.documents"),
        "world.contract" => Some("world.contract"),
        _ => None,
    }
}

/// Every check, and the facts the verdict needs, computed once.
struct Analysis {
    fingerprint: String,
    footer_matches: bool,
    layout_known: bool,
    newest_differences: Vec<String>,
    findings: Vec<Finding>,
    rows: Vec<Row>,
    /// `capabilities`, `guest`, `view` and `model` to the label each names.
    roles: BTreeMap<&'static str, String>,
    contract: Option<String>,
    provenance: Option<ModelProvenanceV1>,
    /// The statements of the attestation section, or why they cannot be read.
    attestations: Result<Vec<Attestation>, String>,
}

impl Analysis {
    fn blob(&self, label: &str) -> Option<&Row> {
        self.rows
            .iter()
            .find(|row| row.kind == KIND_CONTENT_BLOB && row.label.as_deref() == Some(label))
    }

    fn role(&self, role: &str) -> Option<&Row> {
        self.roles.get(role).and_then(|label| self.blob(label))
    }
}

fn sentence(detail: &str) -> String {
    let mut text = String::with_capacity(detail.len() + 1);
    let mut chars = detail.chars();
    if let Some(first) = chars.next() {
        text.extend(first.to_uppercase());
        text.push_str(chars.as_str());
    }
    if !text.ends_with('.') {
        text.push('.');
    }
    if text.chars().count() > 1024 {
        text = text.chars().take(1020).collect::<String>() + "...";
    }
    text
}

fn kinds_text(kinds: &[u8]) -> String {
    kinds
        .iter()
        .map(u8::to_string)
        .collect::<Vec<_>>()
        .join(",")
}

/// The header, the body and the section table of an archive.
type Structure = (Vec<u8>, Vec<u8>, Vec<Row>);

/// Read the structure of the archive, or say why there is no verdict.
fn structure(bytes: &[u8]) -> Result<Structure, NoVerdict> {
    if bytes.len() < 4 {
        return Err(NoVerdict::new(
            "archive.magic",
            format!(
                "the input is {} bytes, too short for the HOLO magic",
                bytes.len()
            ),
        ));
    }
    if &bytes[..4] != b"HOLO" {
        return Err(NoVerdict::new(
            "archive.magic",
            format!(
                "expected magic HOLO, found {}",
                json!(String::from_utf8_lossy(&bytes[..4]))
            ),
        ));
    }
    if bytes.len() < 42 {
        return Err(NoVerdict::new(
            "archive.version",
            format!(
                "the archive is {} bytes, shorter than its header and footer",
                bytes.len()
            ),
        ));
    }
    let version = u16::from_le_bytes([bytes[4], bytes[5]]);
    if version != 4 {
        return Err(NoVerdict::new(
            "archive.version",
            format!("expected physical version 4, found {version}"),
        ));
    }
    let flags = u16::from_le_bytes([bytes[6], bytes[7]]);
    if flags != 0 {
        return Err(NoVerdict::new(
            "archive.flags",
            format!("expected flags 0, found {flags}"),
        ));
    }
    let table = |what: &str| {
        NoVerdict::new(
            "archive.table",
            format!("the section table is not one the Holo/1 wire model admits: {what}"),
        )
    };
    let body = wire::archiveBodyBytes(bytes.to_vec())
        .map_err(|error| table(&format!("{error:?}")))?
        .ok_or_else(|| table("the rows are not eight contiguous Holo/1 rows, or nine with the attestation row last"))?;
    let footer = wire::archiveFooter(bytes.to_vec())
        .map_err(|error| table(&format!("{error:?}")))?
        .ok_or_else(|| table("the archive has no footer"))?;
    let count = wire::wireRowCount(body.clone()).map_err(|error| table(&format!("{error:?}")))?;
    let mut rows = Vec::new();
    for index in 0..count {
        let Ok([kind]) = <[u8; 1]>::try_from(wire::wireSectionKind(index).as_slice()) else {
            return Err(table(&format!("row {index} has no modeled kind")));
        };
        let section = wire::wireSectionBytesUnchecked(body.clone(), index)
            .map_err(|error| table(&format!("row {index}: {error:?}")))?;
        rows.push(decode_row(index as usize, kind, section));
    }
    Ok((body, footer, rows))
}

/// The JSON object of one document section, or the problem.
fn document_object(what: &str, row: Option<&Row>) -> Result<Value, String> {
    let row = row.ok_or_else(|| format!("{what} is missing"))?;
    if let Some(problem) = &row.problem {
        return Err(format!("{what}: {problem}"));
    }
    let value: Value = serde_json::from_slice(&row.payload)
        .map_err(|error| format!("{what} is not JSON: {error}"))?;
    if !value.is_object() {
        return Err(format!("{what} is not a JSON object"));
    }
    Ok(value)
}

/// The problems of a guest module against the `hologram:guest/core-wasm@1`
/// world, one clause each; empty when it conforms.
fn world_problems(guest: &[u8]) -> Vec<String> {
    if !guest.starts_with(b"\0asm") {
        return vec!["the guest is not a WebAssembly module".to_owned()];
    }
    let Some(interface) = read_interface(guest) else {
        return vec!["the guest module cannot be read".to_owned()];
    };
    let signature = |name: &str, signature: Option<&(Vec<String>, Vec<String>)>| match signature {
        Some((parameters, results)) => {
            format!(
                "{name}({}) -> {}",
                parameters.join(", "),
                results.join(", ")
            )
        }
        None => format!("{name}(?) -> ?"),
    };
    let mut problems = Vec::new();
    for Import { module, field } in &interface.imports {
        problems.push(format!(
            "the guest imports {module}.{field}, which the world does not list"
        ));
    }
    let mut have: BTreeMap<&str, &Export> = BTreeMap::new();
    for export in &interface.exports {
        have.insert(export.field.as_str(), export);
    }
    for (name, kind, parameters, results) in WORLD_EXPORTS {
        match have.get(name) {
            None => problems.push(format!("the guest lacks the export {name}")),
            Some(actual) if actual.kind != kind => problems.push(format!(
                "the guest exports {name} as a {}, the world declares a {kind}",
                actual.kind
            )),
            Some(actual) if kind == "func" => {
                let expected = (
                    parameters
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect::<Vec<_>>(),
                    results
                        .iter()
                        .map(|value| (*value).to_owned())
                        .collect::<Vec<_>>(),
                );
                if actual.signature.as_ref() != Some(&expected) {
                    problems.push(format!(
                        "the guest exports {}, the world declares {}",
                        signature(name, actual.signature.as_ref()),
                        signature(name, Some(&expected))
                    ));
                }
            }
            Some(_) => {}
        }
    }
    let declared = WORLD_EXPORTS.map(|(name, ..)| name);
    for export in &interface.exports {
        if !declared.contains(&export.field.as_str()) {
            problems.push(format!(
                "the guest exports {}, which the world does not declare",
                export.field
            ));
        }
    }
    if interface.exports.len() != have.len() {
        problems.push("the guest exports one name twice".to_owned());
    }
    problems
}

/// Every check on the archive and its documents, in verdict order.
fn analyze(bytes: &[u8]) -> Result<Analysis, NoVerdict> {
    let (body, footer, rows) = structure(bytes)?;
    let mut findings = Vec::new();
    let mut add =
        |id: &'static str, ok: bool, detail: String| findings.push(Finding { id, ok, detail });

    // P0: the footer and the labels.
    let stored = hex(&footer);
    let computed = blake3_hex(&body);
    let footer_matches = stored == computed;
    add(
        "archive.footer",
        footer_matches,
        if footer_matches {
            format!("the footer equals the BLAKE3 of the body, {computed}")
        } else {
            format!("the footer {stored} does not equal the BLAKE3 of the body, {computed}: the archive was altered")
        },
    );
    let blobs = rows
        .iter()
        .filter(|row| row.kind == KIND_CONTENT_BLOB)
        .collect::<Vec<_>>();
    let bad_blobs = blobs
        .iter()
        .filter(|row| row.problem.is_some() || !row.label_matches)
        .map(|row| match &row.problem {
            Some(problem) => format!("section {}: {problem}", row.index),
            None => format!(
                "section {} is labelled {} but its content hashes to blake3:{}",
                row.index,
                row.label.as_deref().unwrap_or_default(),
                blake3_hex(&row.content)
            ),
        })
        .collect::<Vec<_>>();
    add(
        "blob.labels",
        bad_blobs.is_empty(),
        if bad_blobs.is_empty() {
            format!(
                "all {} content blobs match their BLAKE3 labels",
                blobs.len()
            )
        } else {
            bad_blobs.join("; ")
        },
    );

    // P1: the documents.
    let directory_name = prefix_identifier(&wire::wireDirectoryPrefix());
    let provenance_name = prefix_identifier(&wire::wireProvenancePrefix());
    let extension = |name: &str| {
        rows.iter()
            .find(|row| row.kind == KIND_EXTENSION && row.name.as_deref() == Some(name))
    };
    let blob_by_label = |label: &str| {
        blobs
            .iter()
            .copied()
            .find(|row| row.label.as_deref() == Some(label))
    };

    // manifest.wire: Foundation.Holo.V1.Wire.validAppManifest.
    let manifests = rows
        .iter()
        .filter(|row| row.kind == KIND_APP_MANIFEST)
        .collect::<Vec<_>>();
    let mut manifest_labels: Option<[String; 3]> = None;
    {
        let prefix = wire::wireManifestPrefix();
        let suffix = wire::wireManifestSuffix();
        let mut problem = None;
        if manifests.len() != 1 {
            problem = Some(format!(
                "expected one application manifest, found {}",
                manifests.len()
            ));
        } else {
            let payload = &manifests[0].payload;
            if payload.len() != MANIFEST_LENGTH {
                problem = Some(format!(
                    "the application manifest is {} bytes, expected {MANIFEST_LENGTH}",
                    payload.len()
                ));
            } else if !payload.starts_with(&prefix) {
                problem =
                    Some("the application manifest prefix is not the Wire constant".to_owned());
            } else if !payload.ends_with(&suffix) {
                problem = Some(
                    "the application manifest layer suffix is not the Wire constant".to_owned(),
                );
            } else {
                let mut labels = Vec::new();
                for (index, role) in MANIFEST_LABELS.iter().enumerate() {
                    let at = prefix.len() + index * LABEL_LENGTH;
                    let label = &payload[at..at + LABEL_LENGTH];
                    if is_label(label) {
                        labels.push(String::from_utf8_lossy(label).into_owned());
                    } else {
                        problem = Some(format!(
                            "application manifest label {index} ({role}) is not a blake3 label"
                        ));
                        break;
                    }
                }
                if problem.is_none() {
                    manifest_labels = labels.try_into().ok();
                }
            }
        }
        add(
            "manifest.wire",
            problem.is_none(),
            problem.unwrap_or_else(|| {
                format!("the application manifest is the {MANIFEST_LENGTH}-byte Wire form with three blake3 labels")
            }),
        );
    }

    // metadata.schema: the source manifest.
    let metadata = rows
        .iter()
        .filter(|row| row.kind == KIND_METADATA)
        .collect::<Vec<_>>();
    let source_manifest = if metadata.len() > 1 {
        Err(format!(
            "the source manifest: the archive has {} metadata sections, expected one",
            metadata.len()
        ))
    } else {
        document_object("the source manifest", metadata.first().copied()).and_then(|value| {
            if value.get("version").and_then(Value::as_u64).is_some() {
                Ok(value)
            } else {
                Err("the source manifest does not have the source-manifest shape: version is not an unsigned integer".to_owned())
            }
        })
    };
    add(
        "metadata.schema",
        source_manifest.is_ok(),
        match &source_manifest {
            Ok(value) => format!(
                "the source manifest matches its shape, version {}",
                value["version"]
            ),
            Err(problem) => problem.clone(),
        },
    );

    // directory.schema: the application directory extension.
    let directory = document_object(
        "the application directory extension",
        extension(&directory_name),
    )
    .and_then(|value| {
        serde_json::from_value::<Directory>(value).map_err(|error| {
            format!("the application directory extension does not have the application-directory shape: {error}")
        })
    });
    add(
        "directory.schema",
        directory.is_ok(),
        match &directory {
            Ok(directory) => format!(
                "the application directory extension matches its shape, {} layers",
                directory.layers.len()
            ),
            Err(problem) => problem.clone(),
        },
    );

    // provenance.schema: the model provenance extension.
    let provenance = document_object(
        "the model provenance extension",
        extension(&provenance_name),
    )
    .and_then(|value| {
        if value.get("schema").and_then(Value::as_str) != Some(PROVENANCE_SCHEMA) {
            return Err(format!(
                "the model provenance extension names schema {}, which no known format revision packs into a holo",
                value.get("schema").cloned().unwrap_or(Value::Null)
            ));
        }
        serde_json::from_value::<ModelProvenanceV1>(value).map_err(|error| {
            format!("the model provenance extension does not have the {PROVENANCE_SCHEMA} shape: {error}")
        })
    });
    add(
        "provenance.schema",
        provenance.is_ok(),
        match &provenance {
            Ok(_) => format!("the model provenance extension matches {PROVENANCE_SCHEMA}"),
            Err(problem) => problem.clone(),
        },
    );

    // model.schema: the model document is the content blob the provenance names.
    let model_row = provenance
        .as_ref()
        .ok()
        .and_then(|provenance| blob_by_label(&provenance.model_content_kappa));
    match (&provenance, model_row) {
        (Err(_), _) => {}
        (Ok(provenance), None) => add(
            "model.schema",
            false,
            format!(
                "the provenance names model document {}, which is not a content blob of this archive",
                provenance.model_content_kappa
            ),
        ),
        (Ok(_), Some(row)) => {
            let decoded = serde_json::from_slice::<Value>(&row.content)
                .map_err(|error| format!("the model document is not JSON: {error}"))
                .and_then(|value| {
                    let schema = value.get("schema").and_then(Value::as_str);
                    if value.is_object() && schema.is_some_and(|schema| MODEL_DOCUMENT_SCHEMAS.contains(&schema)) {
                        Ok(value)
                    } else {
                        Err(format!(
                            "the model document names schema {}, which no known format revision packs into a holo",
                            value.get("schema").cloned().unwrap_or(Value::Null)
                        ))
                    }
                });
            add(
                "model.schema",
                decoded.is_ok(),
                match &decoded {
                    Ok(value) => format!("the model document matches {}", value["schema"]),
                    Err(problem) => problem.clone(),
                },
            );
        }
    }

    // references: the manifest, directory and provenance name the same blobs.
    let mut roles: BTreeMap<&'static str, String> = BTreeMap::new();
    let mut contract = None;
    if let (Ok(directory), Ok(provenance), Some(labels)) =
        (&directory, &provenance, &manifest_labels)
    {
        let mut problems = Vec::new();
        let wasm = directory.layers.iter().find(|layer| layer.kind == "wasm");
        let view = directory.layers.iter().find(|layer| layer.kind == "view");
        if wasm.is_none() {
            problems.push("the directory has no wasm layer".to_owned());
        }
        if view.is_none() {
            problems.push("the directory has no view layer".to_owned());
        }
        if let (Some(wasm), Some(view)) = (wasm, view) {
            contract = wasm.contract.clone();
            let expected = [
                &directory.requires_kappa,
                &wasm.content_kappa,
                &view.content_kappa,
            ];
            for (index, role) in MANIFEST_LABELS.iter().enumerate() {
                if labels[index] != *expected[index] {
                    problems.push(format!(
                        "the manifest {role} label {} differs from the directory's {}",
                        labels[index], expected[index]
                    ));
                }
            }
            if provenance.guest_content_kappa != wasm.content_kappa {
                problems.push(format!(
                    "the provenance guest {} differs from the wasm layer {}",
                    provenance.guest_content_kappa, wasm.content_kappa
                ));
            }
            if let ViewBinding::Present {
                view_content_kappa, ..
            } = &provenance.view_binding
            {
                if *view_content_kappa != view.content_kappa {
                    problems.push(format!(
                        "the provenance view {view_content_kappa} differs from the view layer {}",
                        view.content_kappa
                    ));
                }
            }
            roles.insert("capabilities", directory.requires_kappa.clone());
            roles.insert("guest", wasm.content_kappa.clone());
            roles.insert("view", view.content_kappa.clone());
            roles.insert("model", provenance.model_content_kappa.clone());
        }
        let mut listed = BTreeSet::new();
        for entry in &directory.blobs {
            listed.insert(entry.kappa.as_str());
            match blob_by_label(&entry.kappa) {
                None => problems.push(format!(
                    "the directory lists {}, which is not a content blob of this archive",
                    entry.kappa
                )),
                Some(row) if row.content.len() as u64 != entry.byte_length => {
                    problems.push(format!(
                        "{} is {} bytes; the directory says {}",
                        entry.kappa,
                        row.content.len(),
                        entry.byte_length
                    ))
                }
                Some(_) => {}
            }
        }
        for row in &blobs {
            if let Some(label) = &row.label {
                if !listed.contains(label.as_str()) {
                    problems.push(format!(
                        "content blob {label} is not listed in the directory"
                    ));
                }
            }
        }
        for (role, label) in &roles {
            if blob_by_label(label).is_none() {
                problems.push(format!(
                    "the {role} {label} is not a content blob of this archive"
                ));
            }
        }
        add(
            "references",
            problems.is_empty(),
            if problems.is_empty() {
                "the manifest, directory and provenance name the same blobs, and the directory lists every blob".to_owned()
            } else {
                problems.join("; ")
            },
        );
    }
    if contract.is_none() {
        contract = provenance
            .as_ref()
            .ok()
            .map(|provenance| provenance.core_wasm_contract.clone());
    }

    // model.sha256: the provenance records the model document's sha256 as model_id.
    if let (Ok(provenance), Some(row)) = (&provenance, model_row) {
        let actual = sha256_hex(&row.content);
        let mut problems = Vec::new();
        if provenance.model_id != actual {
            problems.push(format!(
                "the provenance model_id {} differs from the model document's sha256 {actual}",
                provenance.model_id
            ));
        }
        let listed = source_manifest
            .as_ref()
            .ok()
            .and_then(|manifest| manifest.get("files")?.as_array())
            .and_then(|files| {
                files
                    .iter()
                    .find(|file| file.get("kind").and_then(Value::as_str) == Some("model-document"))
            })
            .and_then(|file| file.get("sha256").and_then(Value::as_str));
        if let Some(listed) = listed {
            if listed != actual {
                problems.push(format!(
                    "the source manifest lists model-document sha256 {listed}, the blob hashes to {actual}"
                ));
            }
        }
        add(
            "model.sha256",
            problems.is_empty(),
            if problems.is_empty() {
                format!("the model document's sha256 {actual} equals the recorded model_id")
            } else {
                problems.join("; ")
            },
        );
    }

    // world.contract: the guest has the imports and exports of its contract's world.
    if let (Some(contract), Some(guest)) = (
        contract.as_deref(),
        roles.get("guest").and_then(|label| blob_by_label(label)),
    ) {
        if guest.problem.is_none() && guest.label_matches && contract == CORE_WASM_CONTRACT {
            let problems = world_problems(&guest.content);
            add(
                "world.contract",
                problems.is_empty(),
                if problems.is_empty() {
                    format!("the guest has exactly the imports and exports of the {contract} world")
                } else {
                    format!(
                        "the guest does not match the {contract} world: {}",
                        problems.join("; ")
                    )
                },
            );
        }
    }

    // format.revision: an archive carries no date; its identifiers name the revision.
    let kinds = rows.iter().map(|row| row.kind).collect::<Vec<_>>();
    let names = rows
        .iter()
        .filter(|row| row.kind == KIND_EXTENSION)
        .map(|row| row.name.clone().unwrap_or_default())
        .collect::<Vec<_>>();
    let eight = kinds == EIGHT_ROWS && names == [directory_name.clone(), provenance_name.clone()];
    let nine = kinds == NINE_ROWS
        && names
            == [
                directory_name.clone(),
                provenance_name.clone(),
                ATTESTATION_EXTENSION.to_owned(),
            ];
    let layout_known = eight || nine;
    let mut differences = Vec::new();
    if !(kinds == EIGHT_ROWS || kinds == NINE_ROWS) {
        differences.push(format!(
            "the section kinds are [{}], expected [{}] with an optional ninth row of kind 14",
            kinds_text(&kinds),
            kinds_text(&EIGHT_ROWS)
        ));
    }
    if !layout_known {
        differences.push(format!(
            "the extensions are {}, expected {}",
            json!(names),
            json!([directory_name, provenance_name, ATTESTATION_EXTENSION])
        ));
    }
    let expected_contract = wire::contractName();
    if let Some(contract) = contract.as_deref() {
        if contract != expected_contract {
            differences.push(format!(
                "the guest contract is {contract}, expected {expected_contract}"
            ));
        }
    }
    if let Ok(provenance) = &provenance {
        if provenance.core_wasm_contract != expected_contract {
            differences.push(format!(
                "the provenance contract is {}",
                provenance.core_wasm_contract
            ));
        }
    }
    if let Ok(manifest) = &source_manifest {
        if manifest.get("version").and_then(Value::as_u64) != Some(SOURCE_MANIFEST_VERSION) {
            differences.push(format!(
                "the source manifest version is {}, expected {SOURCE_MANIFEST_VERSION}",
                manifest["version"]
            ));
        }
    }
    if let Some(view) = roles.get("view").and_then(|label| blob_by_label(label)) {
        if holoview_version(&view.content) != Some(HOLOVIEW_VERSION) {
            differences.push(format!(
                "the view is not a HOLOVIEW version {HOLOVIEW_VERSION} bundle"
            ));
        }
    }
    let revision = differences.is_empty().then_some(FORMAT_REVISION);
    add(
        "format.revision",
        revision.is_some(),
        match revision {
            Some(revision) => format!("format revision {revision}"),
            None => format!(
                "the archive matches no format revision this reader knows (newest {FORMAT_REVISION}): {}",
                differences.join("; ")
            ),
        },
    );

    findings.sort_by_key(|finding| CHECK_ORDER.iter().position(|id| *id == finding.id));

    // The attestation section (#267): decoded, not verified.
    let blob_map = blobs
        .iter()
        .filter_map(|row| Some((row.label.clone()?, row.content.clone())))
        .collect::<BTreeMap<_, _>>();
    let attestations = match wire::archiveAttestation(bytes.to_vec()) {
        Ok(None) => Ok(Vec::new()),
        Ok(Some(payload)) => {
            attestation::decode_section(&payload, &blob_map).map_err(|error| error.message)
        }
        Err(error) => Err(format!("{error:?}")),
    };

    Ok(Analysis {
        fingerprint: format!("blake3:{computed}"),
        footer_matches,
        layout_known,
        newest_differences: differences,
        findings,
        rows,
        roles,
        contract,
        provenance: provenance.ok(),
        attestations,
    })
}

// ------------------------------------------------------------- the statements

/// The `prism/proof/v1` predicate, as `predicates/proof-v1.schema.json`
/// shapes it. Unknown members and missing members are shape failures. The
/// members no check compares are decoded for their shape only.
#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProofPredicate {
    verifier: ProofVerifier,
    policy: Value,
    model: ProofModel,
    theorems: Vec<ProofTheorem>,
    verification_result: String,
    verified_levels: Vec<String>,
    tcb: Vec<TcbEntry>,
    evidence: Value,
    time_verified: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProofVerifier {
    id: String,
    lean: Value,
    lexlean: Value,
    prismpm: Value,
    sdk_image: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ProofModel {
    document: DigestSet,
    source_id: String,
    semantic_id: String,
    snapshot_id: String,
    compiler_semantics_id: String,
    lean_manifest_sha256: String,
    modules: Vec<Value>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct DigestSet {
    blake3: String,
    sha256: String,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct ProofTheorem {
    name: String,
    module: String,
    verdict: String,
    axioms: TheoremAxioms,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TheoremAxioms {
    policy: AxiomPolicy,
    observed: Vec<String>,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AxiomPolicy {
    kind: String,
    axioms: Vec<String>,
}

#[allow(dead_code)]
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct TcbEntry {
    component: String,
    role: String,
    version: String,
    #[serde(default)]
    digest: Option<String>,
    trust: String,
}

/// Observed axioms within a theorem's declared policy: none, a subset of allow, or exactly the set.
fn within_policy(axioms: &TheoremAxioms) -> bool {
    let allowed = axioms.policy.axioms.iter().collect::<BTreeSet<_>>();
    match axioms.policy.kind.as_str() {
        "none" => axioms.observed.is_empty(),
        "allow" => axioms.observed.iter().all(|axiom| allowed.contains(axiom)),
        _ => {
            axioms.observed.len() == allowed.len()
                && axioms.observed.iter().all(|axiom| allowed.contains(axiom))
        }
    }
}

fn proof_reason(check: &str, code: &'static str, message: String) -> Reason {
    Reason::new(check, Some(code), Some(Level::P2), message)
}

/// The checks of one proof statement against the holo it travels in (#266,
/// "How the statement is checked offline"). Each failure withholds P2. The
/// envelope check fails unless the signature verified against the signer the
/// caller named (`--key` and the other signer flags); the verifier check needs the project lock, which a holo on its own has not.
fn proof_reasons(statement: &Value, analysis: &Analysis, envelope: &Envelope) -> Vec<Reason> {
    let mut reasons = Vec::new();
    if let Err(message) = envelope {
        reasons.push(proof_reason(
            "proof.envelope",
            PROOF_ENVELOPE,
            message.clone(),
        ));
    }
    let mut shape = Vec::new();
    if statement.get("_type").and_then(Value::as_str) != Some(attestation::STATEMENT_TYPE) {
        shape.push(format!(
            "_type is {}",
            statement.get("_type").cloned().unwrap_or(Value::Null)
        ));
    }
    if statement.get("predicateType").and_then(Value::as_str) != Some(PROOF_PREDICATE) {
        shape.push(format!(
            "predicateType is {}",
            statement
                .get("predicateType")
                .cloned()
                .unwrap_or(Value::Null)
        ));
    }
    let subject = statement
        .get("subject")
        .and_then(Value::as_array)
        .filter(|subjects| subjects.len() == 1)
        .and_then(|subjects| {
            subjects[0]
                .get("digest")
                .and_then(Value::as_object)
                .map(|_| &subjects[0])
        });
    if subject.is_none() {
        shape.push("the statement must have exactly one subject with a digest set".to_owned());
    }
    let predicate = match statement.get("predicate") {
        Some(predicate) => serde_json::from_value::<ProofPredicate>(predicate.clone())
            .map_err(|error| error.to_string()),
        None => Err("is missing".to_owned()),
    };
    let predicate = match predicate {
        Ok(predicate) => {
            if predicate.verified_levels != ["P2"] {
                shape.push(format!(
                    "predicate.verifiedLevels is {}, expected [\"P2\"]",
                    json!(predicate.verified_levels)
                ));
            }
            if !["PASSED", "FAILED"].contains(&predicate.verification_result.as_str()) {
                shape.push(format!(
                    "predicate.verificationResult is {}",
                    json!(predicate.verification_result)
                ));
            }
            if predicate.theorems.is_empty() {
                shape.push("predicate.theorems is empty".to_owned());
            }
            if predicate.tcb.is_empty() {
                shape.push("predicate.tcb is empty".to_owned());
            }
            if predicate.verifier.id != "https://uor.foundation/prism/verifier/lean4" {
                shape.push(format!(
                    "predicate.verifier.id is {}",
                    json!(predicate.verifier.id)
                ));
            }
            if predicate.tcb.iter().any(|entry| entry.trust != "trusted") {
                shape.push("predicate.tcb names a component whose trust is not trusted".to_owned());
            }
            if predicate.theorems.iter().any(|theorem| {
                !["PASSED", "FAILED"].contains(&theorem.verdict.as_str())
                    || !["none", "allow", "exact"].contains(&theorem.axioms.policy.kind.as_str())
            }) {
                shape.push("predicate.theorems has a verdict or an axiom policy kind outside its enumeration".to_owned());
            }
            Some(predicate)
        }
        Err(error) => {
            shape.push(format!("predicate {error}"));
            None
        }
    };
    let (Some(subject), Some(predicate), true) = (subject, predicate, shape.is_empty()) else {
        // Nothing further can be compared in a statement of the wrong shape.
        reasons.push(proof_reason(
            "proof.statement",
            PROOF_STATEMENT,
            format!(
                "The proof statement has the wrong shape: {}.",
                shape.join("; ")
            ),
        ));
        return reasons;
    };

    let digest = &subject["digest"];
    let subject_blake3 = digest
        .get("blake3")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let subject_sha256 = digest
        .get("sha256")
        .and_then(Value::as_str)
        .unwrap_or_default();
    let guest = analysis.role("guest").map(Row::content_digests);
    if guest
        .as_ref()
        .is_none_or(|(sha256, blake3)| subject_blake3 != blake3 || subject_sha256 != sha256)
    {
        reasons.push(proof_reason(
            "proof.subject",
            PROOF_SUBJECT,
            format!(
                "The proof statement is about {} with blake3 {subject_blake3}, which is not this holo's guest{}.",
                subject.get("name").and_then(Value::as_str).unwrap_or("an unnamed subject"),
                guest.map(|(_, blake3)| format!(" (blake3 {blake3})")).unwrap_or_default()
            ),
        ));
    }

    let mut model = Vec::new();
    let model_blob = analysis.role("model").map(Row::content_digests);
    if model_blob.as_ref().is_none_or(|(sha256, blake3)| {
        predicate.model.document.sha256 != *sha256 || predicate.model.document.blake3 != *blake3
    }) {
        model.push("the model document digests are not those of the model blob".to_owned());
    }
    let provenance = analysis.provenance.as_ref();
    let pairs: [(&str, &str, &str, Option<&str>); 6] = [
        (
            "document.sha256",
            &predicate.model.document.sha256,
            "model_id",
            provenance.map(|p| p.model_id.as_str()),
        ),
        (
            "sourceId",
            &predicate.model.source_id,
            "source_id",
            provenance.map(|p| p.source_id.as_str()),
        ),
        (
            "semanticId",
            &predicate.model.semantic_id,
            "semantic_id",
            provenance.map(|p| p.semantic_id.as_str()),
        ),
        (
            "snapshotId",
            &predicate.model.snapshot_id,
            "snapshot_id",
            provenance.map(|p| p.snapshot_id.as_str()),
        ),
        (
            "compilerSemanticsId",
            &predicate.model.compiler_semantics_id,
            "compiler_semantics_id",
            provenance.map(|p| p.compiler_semantics_id.as_str()),
        ),
        (
            "leanManifestSha256",
            &predicate.model.lean_manifest_sha256,
            "lean_manifest_sha256",
            provenance.map(|p| p.lean_manifest_sha256.as_str()),
        ),
    ];
    for (field, value, member, recorded) in pairs {
        if Some(value) != recorded {
            model.push(format!("model.{field} is not the extension's {member}"));
        }
    }
    if !model.is_empty() {
        reasons.push(proof_reason(
            "proof.model",
            PROOF_MODEL,
            format!("The proof is about another model: {}.", model.join("; ")),
        ));
    }

    let mut verdict = Vec::new();
    if predicate.verification_result != "PASSED" {
        verdict.push(format!(
            "verificationResult is {}",
            predicate.verification_result
        ));
    }
    for theorem in &predicate.theorems {
        if theorem.verdict != "PASSED" {
            verdict.push(format!("{} is {}", theorem.name, theorem.verdict));
        } else if !within_policy(&theorem.axioms) {
            verdict.push(format!("{} uses axioms outside its policy", theorem.name));
        }
    }
    if !verdict.is_empty() {
        reasons.push(proof_reason(
            "proof.verdict",
            PROOF_VERDICT,
            format!("The proof did not pass: {}.", verdict.join("; ")),
        ));
    }

    let named = predicate
        .tcb
        .iter()
        .map(|entry| entry.component.as_str())
        .collect::<BTreeSet<_>>();
    let missing = TCB_COMPONENTS
        .iter()
        .copied()
        .filter(|component| !named.contains(component))
        .collect::<Vec<_>>();
    if !missing.is_empty() {
        reasons.push(proof_reason(
            "proof.tcb",
            PROOF_TCB,
            format!("The named TCB lacks {}.", missing.join(", ")),
        ));
    }
    reasons
}

/// The reasons the statements of the attestation section add: an absent
/// statement withholds its level; a present one is checked as far as this CLI
/// can check it.
fn statement_reasons(
    analysis: &Analysis,
    signer: Option<&crate::attest::VerifyPolicy>,
    reasons: &mut Vec<Reason>,
) -> Result<(), NoVerdict> {
    let attestations = match &analysis.attestations {
        Ok(attestations) => attestations.as_slice(),
        Err(problem) => {
            reasons.push(Reason::new(
                "holo.documents",
                None,
                Some(Level::P1),
                sentence(&format!(
                    "the attestation section cannot be read: {problem}"
                )),
            ));
            &[]
        }
    };

    match chosen(attestations, PROVENANCE_PREDICATE, signer)? {
        None => reasons.push(Reason::new(
            "provenance.statement",
            None,
            Some(Level::P1),
            "The holo carries no provenance statement.".to_owned(),
        )),
        Some((attestation, envelope)) => {
            reasons.extend(provenance_reasons(attestation, &envelope, analysis));
        }
    }

    match chosen(attestations, PROOF_PREDICATE, signer)? {
        None => reasons.push(Reason::new(
            "proof.statement",
            None,
            Some(Level::P2),
            "The holo carries no proof statement.".to_owned(),
        )),
        Some((attestation, envelope)) => match attestation.statement() {
            Some(statement) => reasons.extend(proof_reasons(&statement, analysis, &envelope)),
            None => reasons.push(proof_reason(
                "proof.statement",
                PROOF_STATEMENT,
                "The proof statement has the wrong shape: the DSSE payload is not a JSON statement.".to_owned(),
            )),
        },
    }

    let replay = attestations
        .iter()
        .any(|attestation| attestation.predicate_type == REPLAY_PREDICATE);
    reasons.push(Reason::new(
        "replay.statement",
        None,
        Some(Level::P3),
        if replay {
            "The holo carries a replay statement, which no checker verifies before #284."
        } else {
            "The holo carries no replay statement."
        }
        .to_owned(),
    ));
    Ok(())
}

/// Why a signature counts for nothing when the caller named no signer.
const NO_SIGNER: &str = "The signature was not checked: name the signer with a key or a certificate identity and issuer (check --key, --certificate-identity and --certificate-oidc-issuer), and an unchecked signature is no evidence.";

/// Did a statement's signature verify? `Err` says why it counts for nothing.
type Envelope = Result<(), String>;

/// The outcome of one attestation's signature against the signer the caller
/// named. A signer policy that is itself unusable is no verdict, as in
/// `prism-code check`; every other refusal is an unverified envelope.
fn signature_outcome(
    attestation: &Attestation,
    signer: Option<&crate::attest::VerifyPolicy>,
) -> Result<Envelope, NoVerdict> {
    let bundle: Value = serde_json::from_slice(&attestation.line).unwrap_or(Value::Null);
    let signed = bundle["dsseEnvelope"]["signatures"]
        .as_array()
        .is_some_and(|signatures| {
            signatures
                .iter()
                .any(|signature| signature["sig"].as_str().is_some_and(|sig| !sig.is_empty()))
        });
    if !signed {
        return Ok(Err("The statement is an unsigned placeholder: its signature is empty, and no verifier accepts it.".to_owned()));
    }
    let Some(signer) = signer else {
        return Ok(Err(NO_SIGNER.to_owned()));
    };
    match crate::attest::verify_bundle(&bundle, signer) {
        Ok(_) => Ok(Ok(())),
        Err(error) if error.code == "PP1001" => {
            Err(NoVerdict::new("policy.invalid", error.message))
        }
        Err(error) => Ok(Err(format!(
            "The signature does not verify: {}",
            error.message
        ))),
    }
}

/// The attestation of a predicate type that counts: the first whose signature
/// verifies, else the first, so the verdict can say why it does not count.
fn chosen<'a>(
    attestations: &'a [Attestation],
    predicate: &str,
    signer: Option<&crate::attest::VerifyPolicy>,
) -> Result<Option<(&'a Attestation, Envelope)>, NoVerdict> {
    let mut best: Option<(&Attestation, Envelope)> = None;
    for attestation in attestations
        .iter()
        .filter(|attestation| attestation.predicate_type == predicate)
    {
        let envelope = signature_outcome(attestation, signer)?;
        let replace = match &best {
            None => true,
            Some((_, kept)) => kept.is_err() && envelope.is_ok(),
        };
        if replace {
            best = Some((attestation, envelope));
        }
    }
    Ok(best)
}

/// The checks of the provenance statement (#268): its signature, and that
/// every subject is a content blob of this holo with both digests equal. Both
/// withhold P1.
fn provenance_reasons(
    attestation: &Attestation,
    envelope: &Envelope,
    analysis: &Analysis,
) -> Vec<Reason> {
    let withheld =
        |check: &str, message: String| Reason::new(check, None, Some(Level::P1), message);
    let mut reasons = Vec::new();
    if let Err(message) = envelope {
        reasons.push(withheld("provenance.envelope", message.clone()));
    }
    let statement = attestation.statement();
    let subjects = statement
        .as_ref()
        .and_then(|statement| statement.get("subject"))
        .and_then(Value::as_array)
        .filter(|subjects| !subjects.is_empty());
    let mut shape = Vec::new();
    match &statement {
        None => shape.push("the statement is not an object".to_owned()),
        Some(statement) => {
            if statement.get("_type").and_then(Value::as_str) != Some(attestation::STATEMENT_TYPE) {
                shape.push(format!(
                    "_type is {}",
                    statement.get("_type").cloned().unwrap_or(Value::Null)
                ));
            }
            if subjects.is_none() {
                shape.push("the statement has no subject".to_owned());
            }
        }
    }
    let (true, Some(subjects)) = (shape.is_empty(), subjects) else {
        reasons.push(withheld(
            "provenance.subject",
            format!(
                "The provenance statement has the wrong shape: {}.",
                shape.join("; ")
            ),
        ));
        return reasons;
    };
    let blobs = analysis
        .rows
        .iter()
        .filter(|row| row.kind == KIND_CONTENT_BLOB && row.label.is_some())
        .map(Row::content_digests)
        .collect::<Vec<_>>();
    let unmatched = subjects
        .iter()
        .filter(|subject| {
            let digest = subject.get("digest").and_then(Value::as_object);
            let text = |name: &str| digest.and_then(|d| d.get(name)).and_then(Value::as_str);
            !blobs.iter().any(|(sha256, blake3)| {
                text("sha256") == Some(sha256) && text("blake3") == Some(blake3)
            })
        })
        .map(|subject| {
            subject
                .get("name")
                .and_then(Value::as_str)
                .unwrap_or("(unnamed)")
                .to_owned()
        })
        .collect::<Vec<_>>();
    if !unmatched.is_empty() {
        reasons.push(withheld(
            "provenance.subject",
            format!(
                "The provenance statement names {}, which this holo does not contain with those digests.",
                unmatched.join(", ")
            ),
        ));
    }
    reasons
}

// ------------------------------------------------------------------ the world

/// Is the world a contract names within the granted capability set, and which
/// impure effects does it import (#283)? `None` for a contract this reader has
/// no world for. The one registered world, `hologram:guest/core-wasm@1`,
/// imports nothing, so it is within every grant and pure.
struct WorldPolicy {
    within: bool,
    problems: Vec<String>,
    effects: Vec<String>,
}

fn world_policy(contract: Option<&str>, _capabilities: Option<&Value>) -> Option<WorldPolicy> {
    if contract != Some(CORE_WASM_CONTRACT) {
        return None;
    }
    let (_, effects) = world_purity(&[]);
    Some(WorldPolicy {
        within: true,
        problems: Vec::new(),
        effects: effects
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect(),
    })
}

/// The differences between a pinned world and the world the holo's contract
/// names; empty when they match. `None` pins "no world expected".
fn compare_world_pin(contract: &str, pin: Option<&WorldPin>) -> Vec<String> {
    let Some(pin) = pin else {
        return vec![format!(
            "the policy expects no world, the holo declares {contract}"
        )];
    };
    let mut problems = Vec::new();
    if let Some(pinned) = &pin.contract {
        if pinned != contract {
            problems.push(format!(
                "the policy pins contract {pinned}, the holo declares {contract}"
            ));
        }
    }
    let known = (contract == CORE_WASM_CONTRACT).then_some([
        ("blake3", CORE_WASM_WORLD_BLAKE3),
        ("sha256", CORE_WASM_WORLD_SHA256),
    ]);
    for (algorithm, pinned) in [("blake3", &pin.blake3), ("sha256", &pin.sha256)] {
        let Some(pinned) = pinned else { continue };
        match known {
            None => problems.push(format!(
                "the policy pins {algorithm} {pinned}, and this reader has no world for {contract}"
            )),
            Some(digests) => {
                let actual = digests
                    .iter()
                    .find(|(name, _)| *name == algorithm)
                    .map(|(_, digest)| *digest)
                    .unwrap_or_default();
                if actual != pinned {
                    problems.push(format!(
                        "the policy pins {algorithm} {pinned}, the world {contract} has {actual}"
                    ));
                }
            }
        }
    }
    problems
}

// ---------------------------------------------------------------- the verdict

/// Check a holo and return its verdict. The level is computed from the
/// evidence; the policy only decides `passed`. Every check runs, so the
/// reasons list every problem at once.
///
/// Returns [`NoVerdict`] when none can be reached: the bytes are not a holo
/// whose header and section table the wire model can read, an intact archive
/// has a layout no format revision names, or the policy is invalid.
pub fn verify(bytes: &[u8], policy: &Policy) -> Result<Verdict, NoVerdict> {
    let analysis = analyze(bytes)?;
    if !analysis.layout_known && analysis.footer_matches {
        return Err(NoVerdict::new(
            "format.revision",
            sentence(&format!(
                "the archive matches no format revision this reader knows (newest {FORMAT_REVISION}): {}",
                analysis.newest_differences.join("; ")
            )),
        ));
    }

    let mut reasons = Vec::new();
    for finding in &analysis.findings {
        if !finding.ok {
            if let Some(check) = reported_as(finding.id) {
                reasons.push(Reason::new(
                    check,
                    None,
                    Some(Level::P1),
                    sentence(&finding.detail),
                ));
            }
        }
    }
    statement_reasons(&analysis, policy.signer.as_ref(), &mut reasons)?;

    // world.capabilities (#283): the declared world's imports within the granted
    // set. It withholds P3, and the default policy requires it at every level.
    let world = world_policy(analysis.contract.as_deref(), policy.capabilities.as_ref());
    let outside_grant = world.as_ref().is_some_and(|world| !world.within);
    if let Some(world) = world.as_ref().filter(|world| !world.within) {
        reasons.push(Reason::new(
            "world.capabilities",
            Some(WORLD_EXCEEDS_GRANT),
            Some(Level::P3),
            sentence(&format!(
                "the world exceeds the granted capabilities: {}",
                world.problems.join("; ")
            )),
        ));
    }

    let lowest_withheld = reasons
        .iter()
        .filter_map(|reason| reason.withholds)
        .map(Level::rank)
        .min()
        .unwrap_or(Level::ALL.len());
    let level = Level::ALL[lowest_withheld - 1];
    let minimum = policy.resolved_minimum();

    let mut passed = !outside_grant;
    if level < minimum {
        passed = false;
        reasons.push(Reason::new(
            "policy.level",
            Some(LEVEL_BELOW_MINIMUM),
            None,
            format!("The level is {level}; the policy requires {minimum} or above."),
        ));
    }

    for (target, expected) in &policy.digests {
        let actual = if target == "archive" {
            Some((sha256_hex(bytes), blake3_hex(bytes)))
        } else {
            analysis.role(target).map(Row::content_digests)
        };
        let mismatches = match &actual {
            Some((sha256, blake3)) => expected
                .iter()
                .filter_map(|(algorithm, pinned)| {
                    let observed = if algorithm == "sha256" {
                        sha256
                    } else {
                        blake3
                    };
                    (observed != pinned)
                        .then(|| format!("its {algorithm} is {observed}, the policy pins {pinned}"))
                })
                .collect::<Vec<_>>(),
            None => vec!["it could not be located in this archive".to_owned()],
        };
        if !mismatches.is_empty() {
            passed = false;
            reasons.push(Reason::new(
                &format!("policy.digests.{target}"),
                None,
                None,
                sentence(&format!(
                    "the {target} does not match the policy: {}",
                    mismatches.join("; ")
                )),
            ));
        }
    }

    if let (Some(allowed), Some(world)) = (&policy.effects, &world) {
        let outside = world
            .effects
            .iter()
            .filter(|effect| !allowed.contains(effect))
            .cloned()
            .collect::<Vec<_>>();
        if !outside.is_empty() {
            passed = false;
            let allows = if allowed.is_empty() {
                "the policy allows a pure world only".to_owned()
            } else {
                format!("the policy allows {}", allowed.join(", "))
            };
            reasons.push(Reason::new(
                "policy.effects",
                None,
                None,
                sentence(&format!(
                    "the world imports {}, and {allows}",
                    outside.join(", ")
                )),
            ));
        }
    }

    if let Some(pin) = &policy.world {
        let mismatches = match analysis.contract.as_deref() {
            None => vec![
                "the holo declares no guest contract to compare with the pinned world".to_owned(),
            ],
            Some(contract) => compare_world_pin(contract, pin.as_ref()),
        };
        if !mismatches.is_empty() {
            passed = false;
            reasons.push(Reason::new(
                "world.hash",
                None,
                None,
                sentence(&format!(
                    "the world does not match the policy: {}",
                    mismatches.join("; ")
                )),
            ));
        }
    }

    Ok(Verdict {
        holo: analysis.fingerprint,
        level,
        policy_name: policy.resolved_name().to_owned(),
        minimum,
        passed,
        reasons,
    })
}

#[cfg(test)]
#[path = "verdict_tests.rs"]
mod tests;
