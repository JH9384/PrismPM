/**
 * The policy evaluator of `prism check --policy` (issue #285,
 * docs/proposals/285-policy-file.md). The default policy and every user policy
 * pass through here; the default is a shipped file, not logic in `verify`.
 *
 * A policy is Rego (`rego.mjs`). It reads one input document,
 * `prism/policy-input/1`, and decides with two rules: `minimum`, the lowest
 * assurance level it accepts, and `deny`, a set of `{ rule, message }` objects.
 * The level comes from the evidence, and no policy can change it.
 *
 * A policy never lives in a holo. Nothing here reads an archive.
 */
import { parseRego, evaluateRego, RegoError } from './rego.mjs';
import { validate } from './vendor/json-schema.mjs';
import { POLICY_INPUT_JSON_SCHEMA, POLICY_SOURCES } from './vendor/policies.mjs';
import * as assurance from './vendor/assurance-levels.mjs';

const { ASSURANCE } = assurance;

/** The check id of a verdict reason. */
const CHECK = /^[a-z][a-z0-9-]*([.][a-z][a-z0-9-]*)+$/;
/** Check ids that mean something else already. A policy that used one would be mistaken for it. */
const TAKEN = /^policy\.(level|effects|invalid|unreadable|parse|evaluation|digests(\..*)?)$/;
/** A verdict holds at most 1024 reasons, and the evidence needs some of them. */
const MAX_DENIALS = 512;

const evaluationError = (message) => new RegoError('evaluation', message);

/** The source of each policy this package ships, by name. */
export const POLICIES = POLICY_SOURCES;

const memo = new Map();

/** A shipped policy, parsed once. */
export function shippedPolicy(name) {
  if (!memo.has(name)) memo.set(name, parseRego(POLICY_SOURCES[name]));
  return memo.get(name);
}

/** One denial as the verdict reason it adds, or null when it cites a reason the evidence already holds. */
function denial(entry, evidence) {
  if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) {
    throw evaluationError(`rule deny produced ${JSON.stringify(entry)}; each member is an object with rule and message`);
  }
  const keys = Object.keys(entry).sort().join(' ');
  if (keys !== 'message rule' || typeof entry.rule !== 'string' || typeof entry.message !== 'string' || entry.message === '') {
    throw evaluationError(`rule deny produced ${JSON.stringify(entry)}; each member has exactly a rule and a message, both strings`);
  }
  const { rule, message } = entry;
  if (!CHECK.test(rule)) throw evaluationError(`rule deny named ${JSON.stringify(rule)}; a rule is a dotted name such as policy.my-rule`);
  if (TAKEN.test(rule)) throw evaluationError(`rule deny named ${rule}, which already means something else in a verdict; choose another name`);
  if (rule.startsWith('policy.')) return { rule, message };
  // A policy may rest its denial on a reason the evidence holds. It cannot invent evidence, such as a proof failure.
  if (evidence.some((reason) => reason.check === rule)) return null;
  throw evaluationError(`rule deny named ${rule}, which is neither a policy.* name nor a reason the evidence holds`);
}

/**
 * Evaluate a parsed policy against an input document. Throws `RegoError` of
 * kind `evaluation` when the input is not a `prism/policy-input/1` document or
 * the policy does not produce a decision. Returns `{ minimum, denied, denials }`.
 * `denied` is whether any rule denied. `denials` are the reasons a denial adds to
 * the verdict, sorted so that a verdict never depends on evaluation order; a denial
 * that cites a reason the evidence already holds adds none.
 *
 * @param {object} program from `parseRego`
 * @param {object} input a `prism/policy-input/1` document
 */
export function decide(program, input) {
  const problems = validate(POLICY_INPUT_JSON_SCHEMA, input);
  if (problems.length > 0) {
    throw evaluationError(`the input is not a prism/policy-input/1 document: ${problems.slice(0, 3).map((p) => `${p.path} ${p.message}`).join('; ')}`);
  }
  const { minimum, deny } = evaluateRego(program, input);
  if (minimum === undefined) throw evaluationError('rule minimum has no value for this input; give it a value, or a default');
  if (!ASSURANCE.LEVELS.includes(minimum)) {
    throw evaluationError(`rule minimum is ${JSON.stringify(minimum)}; it must be one of ${ASSURANCE.LEVELS.join(', ')}`);
  }
  if (deny.length > MAX_DENIALS) throw evaluationError(`rule deny produced ${deny.length} members; at most ${MAX_DENIALS} are reported`);
  const denials = deny.map((entry) => denial(entry, input.verdict.reasons)).filter(Boolean);
  denials.sort((a, b) => (a.rule === b.rule ? (a.message < b.message ? -1 : 1) : a.rule < b.rule ? -1 : 1));
  return { minimum, denied: deny.length > 0, denials };
}
