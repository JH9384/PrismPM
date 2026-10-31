/**
 * The checks of one `prism/proof/v1` statement against the holo it travels
 * in (issue #266, table "How the statement is checked offline" in
 * docs/proposals/266-proof-predicate.md), and of one `prism/replay/v1`
 * statement (issue #284, docs/proposals/284-histories-replay.md). Each failure
 * is a verdict reason: a proof failure withholds P2, a replay failure P3.
 *
 * Pure: the caller has already decoded the statement and verified its DSSE
 * signature, and hands in the outcome as `envelope`. `verify` joins these
 * reasons when a format revision admits the attestation section (#267's wire
 * model change); until then no holo it reads carries a statement.
 */
import { validate } from './vendor/json-schema.mjs';
import { PREDICATE_SCHEMAS } from './vendor/predicates.mjs';
import * as assurance from './vendor/assurance-levels.mjs';

const { ASSURANCE } = assurance;

export const STATEMENT_TYPE = 'https://in-toto.io/Statement/v1';
export const PROOF_PREDICATE_TYPE = ASSURANCE.PREDICATES.proof;
export const PROOF_SCHEMA = 'predicates/proof-v1.schema.json';

/** The seven components of the named TCB (docs/proposals/266-proof-predicate.md, "The named TCB"). */
export const TCB_COMPONENTS = Object.freeze(['lean4-kernel', 'leanchecker', 'lexlean', 'lean4-prod', 'rustc', 'wasm-bindgen-cli', 'sdk-image']);

/** The diagnostic of each proof check. `proof.level` is a shape failure since #269 and reports as `proof.statement`. */
export const PROOF_CODES = Object.freeze({
  'proof.envelope': 'PP5501',
  'proof.statement': 'PP5502',
  'proof.subject': 'PP5503',
  'proof.model': 'PP5504',
  'proof.verifier': 'PP5505',
  'proof.verdict': 'PP5506',
  'proof.tcb': 'PP5507',
});

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function reason(check, message) {
  return { check, code: PROOF_CODES[check], withholds: 'P2', message };
}

/** Observed axioms within a theorem's declared policy: none, a subset of allow, or exactly the set. */
function withinPolicy({ policy, observed }) {
  const allowed = new Set(policy.axioms);
  if (policy.kind === 'none') return observed.length === 0;
  if (policy.kind === 'allow') return observed.every((a) => allowed.has(a));
  return observed.length === allowed.size && observed.every((a) => allowed.has(a));
}

/**
 * Check one proof statement. Returns the reasons, in check order; an empty
 * list means the statement supports P2.
 *
 * @param {object} statement the decoded in-toto Statement
 * @param {{ guest: { sha256: string, blake3: string } | null, model: { sha256: string, blake3: string } | null, provenance: object | null, lock?: { sdkImage?: string, lean?: string } }} holo
 *   the digests of the guest and model blobs, the `prismpm/model-provenance/1` extension, and the pins of a `prismpm.lock` when one is present
 * @param {{ verified: boolean, message?: string }} envelope the outcome of the DSSE signature check against the trust root
 */
export function checkProofStatement(statement, holo, envelope) {
  const reasons = [];
  if (!envelope?.verified) reasons.push(reason('proof.envelope', envelope?.message ?? 'The proof statement signature does not verify against the trust root.'));

  const shape = [];
  if (!isObject(statement)) shape.push('the statement is not an object');
  else {
    if (statement._type !== STATEMENT_TYPE) shape.push(`_type is ${JSON.stringify(statement._type)}`);
    if (statement.predicateType !== PROOF_PREDICATE_TYPE) shape.push(`predicateType is ${JSON.stringify(statement.predicateType)}`);
    if (!Array.isArray(statement.subject) || statement.subject.length !== 1 || !isObject(statement.subject[0]?.digest)) shape.push('the statement must have exactly one subject with a digest set');
    const errors = validate(PREDICATE_SCHEMAS[PROOF_SCHEMA], statement.predicate);
    if (errors.length > 0) shape.push(...errors.slice(0, 3).map((e) => `predicate${e.path} ${e.message}`));
  }
  if (shape.length > 0) {
    // Nothing further can be compared in a statement of the wrong shape.
    reasons.push(reason('proof.statement', `The proof statement has the wrong shape: ${shape.join('; ')}.`));
    return reasons;
  }
  const { subject, predicate } = statement;

  const digest = subject[0].digest;
  if (!holo.guest || digest.blake3 !== holo.guest.blake3 || digest.sha256 !== holo.guest.sha256) {
    reasons.push(reason('proof.subject', `The proof statement is about ${subject[0].name} with blake3 ${digest.blake3}, which is not this holo's guest${holo.guest ? ` (blake3 ${holo.guest.blake3})` : ''}.`));
  }

  const model = [];
  const document = predicate.model.document;
  if (!holo.model || document.sha256 !== holo.model.sha256 || document.blake3 !== holo.model.blake3) model.push('the model document digests are not those of the model blob');
  const provenance = holo.provenance ?? {};
  const pairs = [
    ['document.sha256', document.sha256, 'model_id'],
    ['sourceId', predicate.model.sourceId, 'source_id'],
    ['semanticId', predicate.model.semanticId, 'semantic_id'],
    ['snapshotId', predicate.model.snapshotId, 'snapshot_id'],
    ['compilerSemanticsId', predicate.model.compilerSemanticsId, 'compiler_semantics_id'],
    ['leanManifestSha256', predicate.model.leanManifestSha256, 'lean_manifest_sha256'],
  ];
  for (const [field, value, member] of pairs) {
    if (value !== provenance[member]) model.push(`model.${field} is not the extension's ${member}`);
  }
  if (model.length > 0) reasons.push(reason('proof.model', `The proof is about another model: ${model.join('; ')}.`));

  const verifier = [];
  if (holo.lock?.sdkImage !== undefined && predicate.verifier.sdkImage !== holo.lock.sdkImage) verifier.push(`verifier.sdkImage is ${predicate.verifier.sdkImage}, the lock pins ${holo.lock.sdkImage}`);
  if (holo.lock?.lean !== undefined && predicate.verifier.lean.version !== holo.lock.lean) verifier.push(`verifier.lean.version is ${predicate.verifier.lean.version}, the lock pins ${holo.lock.lean}`);
  if (verifier.length > 0) reasons.push(reason('proof.verifier', `The proof was checked with other pins: ${verifier.join('; ')}.`));

  const verdict = [];
  if (predicate.verificationResult !== 'PASSED') verdict.push(`verificationResult is ${predicate.verificationResult}`);
  for (const theorem of predicate.theorems) {
    if (theorem.verdict !== 'PASSED') verdict.push(`${theorem.name} is ${theorem.verdict}`);
    else if (!withinPolicy(theorem.axioms)) verdict.push(`${theorem.name} uses axioms outside its policy`);
  }
  if (verdict.length > 0) reasons.push(reason('proof.verdict', `The proof did not pass: ${verdict.join('; ')}.`));

  const named = new Set(predicate.tcb.map((entry) => entry.component));
  const missing = TCB_COMPONENTS.filter((component) => !named.has(component));
  if (missing.length > 0) reasons.push(reason('proof.tcb', `The named TCB lacks ${missing.join(', ')}.`));

  return reasons;
}

export const REPLAY_PREDICATE_TYPE = ASSURANCE.PREDICATES.replay;
export const REPLAY_SCHEMA = 'predicates/replay-v1.schema.json';

/** The diagnostic of each replay check. `replay.divergence` is the one a `DeterminismViolationError` carries. */
export const REPLAY_CODES = Object.freeze({
  'replay.divergence': 'PP5701',
  'replay.envelope': 'PP5702',
  'replay.statement': 'PP5703',
  'replay.subject': 'PP5704',
  'replay.model': 'PP5705',
});

function replayReason(check, message) {
  return { check, code: REPLAY_CODES[check], withholds: 'P3', message };
}

const sameDigests = (a, b) => Boolean(a && b) && a.sha256 === b.sha256 && a.blake3 === b.blake3;

/**
 * Check one replay statement against a build. Returns the reasons, in check
 * order; an empty list means the statement supports P3. It is why a changed
 * model cannot reach P3: a statement from before the change names another
 * guest and another model, and a statement from after it records divergences.
 *
 * @param {object} statement the decoded in-toto Statement
 * @param {{ guest: { sha256: string, blake3: string } | null, model: { sha256: string, blake3: string } | null }} holo the digests of the guest and model blobs
 * @param {{ verified: boolean, message?: string }} envelope the outcome of the DSSE signature check against the trust root
 */
export function checkReplayStatement(statement, holo, envelope) {
  const reasons = [];
  if (!envelope?.verified) reasons.push(replayReason('replay.envelope', envelope?.message ?? 'The replay statement signature does not verify against the trust root.'));

  const shape = [];
  if (!isObject(statement)) shape.push('the statement is not an object');
  else {
    if (statement._type !== STATEMENT_TYPE) shape.push(`_type is ${JSON.stringify(statement._type)}`);
    if (statement.predicateType !== REPLAY_PREDICATE_TYPE) shape.push(`predicateType is ${JSON.stringify(statement.predicateType)}`);
    if (!Array.isArray(statement.subject) || statement.subject.length !== 1 || !isObject(statement.subject[0]?.digest)) shape.push('the statement must have exactly one subject with a digest set');
    const errors = validate(PREDICATE_SCHEMAS[REPLAY_SCHEMA], statement.predicate);
    if (errors.length > 0) shape.push(...errors.slice(0, 3).map((e) => `predicate${e.path} ${e.message}`));
    else {
      const sum = statement.predicate.histories.reduce((total, history) => total + history.divergences, 0);
      if (sum !== statement.predicate.divergenceCount) shape.push(`divergenceCount is ${statement.predicate.divergenceCount}, its histories sum to ${sum}`);
    }
  }
  if (shape.length > 0) {
    // Nothing further can be compared in a statement of the wrong shape.
    reasons.push(replayReason('replay.statement', `The replay statement has the wrong shape: ${shape.join('; ')}.`));
    return reasons;
  }
  const { subject, predicate } = statement;

  if (!sameDigests(subject[0].digest, holo.guest)) {
    reasons.push(replayReason('replay.subject', `The replay statement is about ${subject[0].name} with blake3 ${subject[0].digest.blake3}, which is not this holo's guest${holo.guest ? ` (blake3 ${holo.guest.blake3})` : ''}.`));
  }
  if (!sameDigests(predicate.model, holo.model)) {
    reasons.push(replayReason('replay.model', `The replay statement is about the model with blake3 ${predicate.model.blake3}, which is not this holo's model${holo.model ? ` (blake3 ${holo.model.blake3})` : ''}.`));
  }
  if (predicate.divergenceCount > 0) {
    reasons.push(replayReason('replay.divergence', `The replay recorded ${predicate.divergenceCount} divergences from its histories.`));
  }
  return reasons;
}
