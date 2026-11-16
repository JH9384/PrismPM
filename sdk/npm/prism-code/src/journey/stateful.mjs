/**
 * The stateful Prism spec (`prism/spec/2`): an app that keeps state between
 * the steps of a session. One spec renders to one LexLean model
 * (render-stateful.mjs), whose theorems Lean proves over every reachable
 * state and whose acceptance vectors the guest replays.
 *
 * The state is a few named values, each a bounded number or a choice, with a
 * start value. An action is a word and its inputs, as a spec/1 request is a
 * line of fields. Each action has ordered rules: the first whose conditions
 * hold and whose changes keep every number within its bounds decides the
 * answer and changes the state; when none does, the action answers its
 * `otherwise` and changes nothing. A malformed step is `invalid`.
 *
 * Properties are what Lean proves:
 *   - a state property (`always` or `never` with `when` over the state) holds
 *     in every reachable state: Lean proves it at the start and kept by every
 *     action, assuming every state property and the bounds;
 *   - an action property (`never` or `always`, an `action`, `when` over the
 *     state and its inputs, `then` an answer) holds in every state where the
 *     state properties and bounds hold, so in every reachable one.
 *
 * Examples are acceptance sessions: steps and the answer each step gives.
 *
 * This module is pure. Its top level reads nothing from spec.mjs, which
 * imports it, so either may be loaded first.
 */
import { INVALID, MAX_DIGITS, NAT_MAX, SpecError, checkText, nameFromPurpose, parseNumber, titleFromName } from './spec.mjs';

export const STATEFUL_SCHEMA = 'prism/spec/2';
/** A session is one request of at most this many bytes: its steps separated by `;`. */
export const SESSION_BYTES = 1024;

const WORD = /^[a-z][a-z0-9-]{0,31}$/;
const NAME = /^[a-z][a-z0-9-]{0,62}$/;
const OPS = ['<', '<=', '>', '>=', '=', '!='];
const CHANGE_OPS = ['set', 'add', 'subtract'];

/** Every rule a stateful spec can be refused by, beyond the rules it shares with prism/spec/1 (spec.mjs REFUSALS). */
export const STATEFUL_REFUSALS = Object.freeze([
  'action.duplicate', 'action.name', 'actions.none', 'actions.too-many',
  'change.bound', 'change.duplicate', 'change.op', 'change.operand', 'change.unknown-field',
  'example.answer', 'example.disagrees', 'example.step',
  'input.clash', 'inputs.too-many',
  'property.action', 'properties.too-many',
  'state.bound', 'state.none', 'state.start', 'state.too-many',
]);

/** The members each level of a stateful spec may hold; spec-file.mjs refuses anything else. */
export const STATEFUL_MEMBERS = Object.freeze({
  spec: ['schema', 'name', 'title', 'purpose', 'actors', 'limits', 'state', 'outcomes', 'meanings', 'actions', 'properties', 'examples'],
  value: ['name', 'kind', 'values', 'min', 'max', 'start', 'means'],
  input: ['name', 'kind', 'values', 'min', 'max', 'means'],
  action: ['name', 'means', 'inputs', 'rules', 'otherwise', 'otherwiseWhy'],
  rule: ['id', 'when', 'then', 'change', 'says', 'why'],
  property: ['id', 'kind', 'action', 'when', 'then', 'says', 'why'],
  condition: ['field', 'op', 'value'],
  change: ['field', 'op', 'value'],
  operand: ['field'],
  example: ['steps', 'answers'],
});

const refuse = (message, where, rule) => {
  throw new SpecError(message, where, rule);
};
const prose = (text, where) => (text === undefined || text === null || text === '' ? '' : checkText(text, where));
const withWhy = (item, why, where) => (prose(why, where) ? { ...item, why } : item);
const isWholeNumber = (n) => Number.isSafeInteger(n) && n >= 0 && n <= Number(NAT_MAX);

/** A number or choice, as a state value (`state: true`, with a start) or as an action's input. */
function checkValue(f, where, { state }) {
  const out = { name: f.name, kind: f.kind };
  if (!WORD.test(f.name ?? '')) refuse(`Name \`${f.name}\` must be a lower-case word.`, where, 'field.name');
  if (f.kind === 'choice') {
    if (!Array.isArray(f.values) || f.values.length < 2) refuse(`\`${f.name}\` needs at least two choices.`, where, 'choice.too-few');
    if (f.values.length > 32) refuse(`\`${f.name}\` has more than 32 choices.`, where, 'choice.too-many');
    if (new Set(f.values).size !== f.values.length) refuse(`\`${f.name}\` repeats a choice.`, where, 'choice.duplicate');
    for (const v of f.values) if (!WORD.test(v)) refuse(`Choice \`${v}\` must be a lower-case word without spaces.`, where, 'choice.word');
    out.values = [...f.values];
    if (f.min !== undefined || f.max !== undefined) refuse(`\`${f.name}\` is a choice; it has no min or max.`, where, 'number.bound');
    if (state) {
      const start = f.start ?? f.values[0];
      if (!f.values.includes(start)) refuse(`\`${f.name}\` starts at \`${start}\`, which is not one of its choices.`, where, 'state.start');
      out.start = start;
    }
  } else if (f.kind === 'number') {
    if (f.values !== undefined) refuse(`\`${f.name}\` is a number; it has no choices.`, where, 'field.kind');
    for (const b of ['min', 'max']) if (f[b] !== undefined && !isWholeNumber(f[b])) refuse(`\`${b}\` of \`${f.name}\` must be a whole number of at most ${MAX_DIGITS} digits.`, where, 'number.bound');
    if (state && f.max === undefined) refuse(`State \`${f.name}\` needs a \`max\`: state is bounded, so Lean can prove every action keeps it in bounds.`, where, 'state.bound');
    if (f.min !== undefined && f.max !== undefined && f.min > f.max) refuse(`\`${f.name}\` has min above max.`, where, 'number.bound-order');
    if (f.min !== undefined) out.min = f.min;
    if (f.max !== undefined) out.max = f.max;
    if (state) {
      const start = f.start ?? f.min ?? 0;
      if (!isWholeNumber(start) || start < (f.min ?? 0) || start > f.max) refuse(`\`${f.name}\` starts at ${JSON.stringify(start)}, outside ${f.min ?? 0}..${f.max}.`, where, 'state.start');
      out.start = start;
    }
  } else refuse(`\`${f.name}\` must be a \`number\` or a \`choice\`.`, where, 'field.kind');
  if (!state && f.start !== undefined) refuse(`Input \`${f.name}\` has no start; only state does.`, where, 'state.start');
  const means = prose(f.means, `${where}.means`);
  if (means) out.means = means;
  return out;
}

/** Conditions over `fields` (the state, and an action's inputs where it has them). Empty is allowed where `empty`. */
function checkConditions(conds, fields, where, { empty = false } = {}) {
  if (conds === undefined && empty) return [];
  if (!Array.isArray(conds) || (conds.length === 0 && !empty)) refuse(`Each ${where} needs at least one condition.`, where, 'condition.none');
  return conds.map((c) => {
    const f = fields.find((x) => x.name === c.field);
    if (!f) refuse(`\`${c.field}\` is neither a state value nor an input here; these are ${fields.map((x) => x.name).join(', ')}.`, where, 'condition.unknown-field');
    if (f.kind === 'choice') {
      if (!['is', 'is not'].includes(c.op) || !f.values.includes(c.value)) refuse(`\`${c.field} ${c.op} ${JSON.stringify(c.value)}\` does not name a choice of ${c.field}.`, where, 'choice.value');
      return { field: c.field, op: c.op, value: c.value };
    }
    if (!OPS.includes(c.op)) refuse(`\`${c.op}\` is not a comparison of numbers.`, where, 'condition.comparison');
    if (typeof c.value === 'number') {
      if (!isWholeNumber(c.value)) refuse('Compare numbers with whole numbers.', where, 'condition.number');
      return { field: c.field, op: c.op, value: c.value };
    }
    if (!(c.value && fields.some((x) => x.name === c.value.field && x.kind === 'number'))) refuse(`\`${JSON.stringify(c.value)}\` is not a whole number or a number here.`, where, 'condition.operand');
    return { field: c.field, op: c.op, value: { field: c.value.field } };
  });
}

/** The changes of a rule: each state value at most once, each read from the state before the step. */
function checkChanges(changes, state, fields, where) {
  if (changes === undefined) return [];
  if (!Array.isArray(changes)) refuse('`change` is a list of changes to the state.', where, 'change.op');
  const seen = new Set();
  return changes.map((c) => {
    const f = state.find((x) => x.name === c.field);
    if (!f) refuse(`\`${c.field}\` is not a state value; only state changes.`, where, 'change.unknown-field');
    if (seen.has(c.field)) refuse(`\`${c.field}\` changes twice in one rule.`, where, 'change.duplicate');
    seen.add(c.field);
    if (!CHANGE_OPS.includes(c.op)) refuse(`A change is \`set\`, \`add\` or \`subtract\`; got \`${c.op}\`.`, where, 'change.op');
    if (f.kind === 'choice') {
      if (c.op !== 'set') refuse(`\`${c.field}\` is a choice; it can only be \`set\`.`, where, 'change.op');
      if (!f.values.includes(c.value)) refuse(`\`${JSON.stringify(c.value)}\` is not a choice of ${c.field}.`, where, 'choice.value');
      return { field: c.field, op: 'set', value: c.value };
    }
    if (typeof c.value === 'number') {
      if (!isWholeNumber(c.value)) refuse('Change numbers by whole numbers.', where, 'condition.number');
      if (c.op === 'set' && (c.value < (f.min ?? 0) || c.value > f.max)) refuse(`Setting \`${c.field}\` to ${c.value} leaves ${f.min ?? 0}..${f.max}.`, where, 'change.bound');
      return { field: c.field, op: c.op, value: c.value };
    }
    if (!(c.value && fields.some((x) => x.name === c.value.field && x.kind === 'number'))) refuse(`\`${JSON.stringify(c.value)}\` is not a whole number or a number here.`, where, 'change.operand');
    return { field: c.field, op: c.op, value: { field: c.value.field } };
  });
}

/** Validate a whole stateful spec; return it normalized. Throws `SpecError` naming the first problem. */
export function validateStatefulSpec(input) {
  const raw = structuredClone(input ?? {});
  if (raw.schema !== STATEFUL_SCHEMA) refuse(`schema must be ${STATEFUL_SCHEMA}`, 'schema', 'spec.schema');
  const spec = { schema: STATEFUL_SCHEMA };
  spec.name = raw.name || nameFromPurpose(raw.purpose);
  if (!NAME.test(spec.name)) refuse('name must be lower case letters, digits and hyphens, starting with a letter', 'name', 'spec.name');
  spec.title = raw.title === undefined ? titleFromName(spec.name) : checkText(raw.title, 'title', { ascii: true, max: 64 });
  if (!spec.title) refuse('`title` is empty; leave it out to take it from the name.', 'title', 'text.length');
  if (raw.purpose === undefined || raw.purpose === null || raw.purpose === '') refuse('Say in one sentence what the app keeps and does.', 'purpose', 'spec.purpose');
  spec.purpose = checkText(raw.purpose, 'purpose', { ascii: true, max: 200 });
  const actors = (raw.actors ?? []).map((a, i) => checkText(a, `actors[${i}]`, { max: 64 }));
  if (actors.length) spec.actors = actors;
  if (raw.limits !== undefined && !Array.isArray(raw.limits)) refuse('`limits` is a list of what the app does not do.', 'limits', 'spec.limits');
  const limits = (raw.limits ?? []).filter((l, i) => prose(l, `limits[${i}]`));
  if (limits.length) spec.limits = limits;

  if (!Array.isArray(raw.state) || raw.state.length === 0) refuse('Name at least one state value the app keeps, such as `{"name": "count", "kind": "number", "max": 100}`.', 'state', 'state.none');
  if (raw.state.length > 8) refuse('An app keeps at most eight state values.', 'state', 'state.too-many');
  spec.state = raw.state.map((f, i) => checkValue(f, `state[${i}]`, { state: true }));
  if (new Set(spec.state.map((f) => f.name)).size !== spec.state.length) refuse('A state value is named twice.', 'state', 'field.duplicate');

  const outcomes = raw.outcomes ?? [];
  if (!Array.isArray(outcomes) || outcomes.length < 2) refuse('Name at least two answers.', 'outcomes', 'outcomes.too-few');
  if (new Set(outcomes).size !== outcomes.length) refuse('An answer is named twice.', 'outcomes', 'outcomes.duplicate');
  for (const o of outcomes) {
    if (!WORD.test(o)) refuse(`Answer \`${o}\` must be a lower-case word.`, 'outcomes', 'outcomes.word');
    if (o === INVALID) refuse('`invalid` is reserved for malformed steps; pick another word.', 'outcomes', 'outcomes.reserved');
  }
  spec.outcomes = [...outcomes];
  if (raw.meanings !== undefined) {
    if (typeof raw.meanings !== 'object' || raw.meanings === null || Array.isArray(raw.meanings)) refuse('`meanings` maps each answer to what it means.', 'outcomes', 'meanings.shape');
    for (const key of Object.keys(raw.meanings)) if (!outcomes.includes(key)) refuse(`\`meanings\` names \`${key}\`, which is not an answer.`, 'outcomes', 'meanings.unknown');
    const meanings = Object.fromEntries(outcomes.filter((o) => prose(raw.meanings[o], `meanings.${o}`)).map((o) => [o, raw.meanings[o]]));
    if (Object.keys(meanings).length) spec.meanings = meanings;
  }

  if (!Array.isArray(raw.actions) || raw.actions.length === 0) refuse('Name at least one action a user can take.', 'actions', 'actions.none');
  if (raw.actions.length > 8) refuse('An app has at most eight actions.', 'actions', 'actions.too-many');
  let ruleCount = 0;
  spec.actions = raw.actions.map((a, ai) => {
    const where = `actions[${ai}]`;
    if (!WORD.test(a.name ?? '')) refuse(`Action name \`${a.name}\` must be a lower-case word.`, where, 'action.name');
    const inputs = a.inputs ?? [];
    if (!Array.isArray(inputs) || inputs.length > 4) refuse(`Action \`${a.name}\` takes at most four inputs.`, where, 'inputs.too-many');
    const ins = inputs.map((f, i) => checkValue(f, `${where}.inputs[${i}]`, { state: false }));
    for (const f of ins) if (spec.state.some((s) => s.name === f.name)) refuse(`Input \`${f.name}\` of \`${a.name}\` has the name of a state value.`, where, 'input.clash');
    if (new Set(ins.map((f) => f.name)).size !== ins.length) refuse(`Action \`${a.name}\` names an input twice.`, where, 'field.duplicate');
    const fields = [...spec.state, ...ins];
    if (!Array.isArray(a.rules)) refuse(`Action \`${a.name}\` needs \`rules\`, possibly empty, and an \`otherwise\`.`, where, 'rules.format');
    if (a.rules.length > 12) refuse(`Action \`${a.name}\` has more than 12 rules.`, where, 'rules.too-many');
    const rules = a.rules.map((r, ri) => {
      const rw = `${where}.rules[${ri}]`;
      if (!outcomes.includes(r.then)) refuse(`Rule ${ri + 1} of \`${a.name}\` answers \`${r.then}\`, which is not an answer.`, rw, 'outcome.unknown');
      const when = checkConditions(r.when, fields, rw, { empty: true });
      const change = checkChanges(r.change, spec.state, fields, rw);
      ruleCount++;
      const id = r.id ?? `REQ-${String(ruleCount).padStart(3, '0')}`;
      if (typeof id !== 'string' || !/^[A-Z][A-Z0-9-]{0,31}$/.test(id)) refuse(`Rule id ${JSON.stringify(id)} must be upper-case letters, digits and hyphens, such as REQ-001.`, rw, 'rules.format');
      if (r.says !== undefined) checkText(r.says, `${rw}.says`);
      return withWhy({ id, when, then: r.then, change, says: r.says ?? describeStatefulRule(a.name, { when, then: r.then, change }) }, r.why, `${rw}.why`);
    });
    if (!outcomes.includes(a.otherwise)) refuse(`Say which answer \`${a.name}\` gives when no rule applies, as \`otherwise\`.`, where, 'rules.otherwise');
    const action = { name: a.name, inputs: ins, rules, otherwise: a.otherwise };
    const means = prose(a.means, `${where}.means`);
    if (means) action.means = means;
    const why = prose(a.otherwiseWhy, `${where}.otherwiseWhy`);
    if (why) action.otherwiseWhy = why;
    return action;
  });
  const actionNames = spec.actions.map((a) => a.name);
  if (new Set(actionNames).size !== actionNames.length) refuse('An action is named twice.', 'actions', 'action.duplicate');
  const ruleIds = spec.actions.flatMap((a) => a.rules.map((r) => r.id));
  if (new Set(ruleIds).size !== ruleIds.length) refuse('A rule id is used twice.', 'actions', 'rules.format');

  const props = raw.properties ?? [];
  if (!Array.isArray(props)) refuse('`properties` is a list.', 'properties', 'properties.format');
  if (props.length > 16) refuse('Keep to at most 16 properties.', 'properties', 'properties.too-many');
  spec.properties = props.map((p, i) => {
    const where = `properties[${i}]`;
    if (!['never', 'always'].includes(p.kind)) refuse('A property is `never` or `always`.', where, 'properties.kind');
    const id = p.id ?? `INV-${String(i + 1).padStart(3, '0')}`;
    if (typeof id !== 'string' || !/^[A-Z][A-Z0-9-]{0,31}$/.test(id)) refuse(`Property id ${JSON.stringify(id)} must be upper-case letters, digits and hyphens, such as INV-001.`, where, 'properties.format');
    let out;
    if (p.action === undefined) {
      if (p.then !== undefined) refuse('A property with `then` names the `action` that answers it.', where, 'property.action');
      out = { id, kind: p.kind, when: checkConditions(p.when, spec.state, where) };
    } else {
      const action = spec.actions.find((a) => a.name === p.action);
      if (!action) refuse(`\`${p.action}\` is not an action.`, where, 'property.action');
      if (!outcomes.includes(p.then)) refuse(`Property ${i + 1} names \`${p.then}\`, which is not an answer.`, where, 'outcome.unknown');
      const when = checkConditions(p.when, [...spec.state, ...action.inputs], where, { empty: true });
      out = { id, kind: p.kind, action: p.action, when, then: p.then };
    }
    if (p.says !== undefined) checkText(p.says, `${where}.says`);
    return withWhy({ ...out, says: p.says ?? describeStatefulProperty(out) }, p.why, `${where}.why`);
  });
  if (new Set(spec.properties.map((p) => p.id)).size !== spec.properties.length) refuse('A property id is used twice.', 'properties', 'properties.format');

  const examples = raw.examples ?? [];
  if (!Array.isArray(examples)) refuse('`examples` is a list of sessions.', 'examples', 'examples.format');
  spec.examples = examples.map((e, i) => {
    const where = `examples[${i}]`;
    if (!Array.isArray(e.steps) || e.steps.length === 0 || !Array.isArray(e.answers) || e.answers.length !== e.steps.length) refuse('An example is `steps` and as many `answers`, one per step.', where, 'examples.format');
    for (const s of e.steps) if (typeof s !== 'string' || s.includes(';')) refuse(`Step ${JSON.stringify(s)} must be one action and its inputs, separated by single spaces, without \`;\`.`, where, 'example.step');
    for (const a of e.answers) if (a !== INVALID && !outcomes.includes(a)) refuse(`Example ${i + 1} expects \`${a}\`, which is not an answer.`, where, 'example.answer');
    return { steps: [...e.steps], answers: [...e.answers] };
  });
  // An example is an acceptance session: it must be what the rules do, or the spec says two things.
  for (const [i, e] of spec.examples.entries()) {
    const got = runSession(spec, e.steps);
    const at = got.findIndex((g, j) => g.outcome !== e.answers[j]);
    if (at >= 0) {
      const g = got[at];
      refuse(`Example ${i + 1} expects step ${at + 1} (\`${e.steps[at]}\`) to answer ${e.answers[at]}, but it answers ${g.outcome}${g.rule ? `, decided by ${g.rule}` : g.outcome === INVALID ? ', because the step is malformed' : ', by otherwise'}. Fix the example, or change the rules.`, `examples[${i}]`, 'example.disagrees');
    }
  }
  return spec;
}

const OP_WORDS = { '<': 'is below', '<=': 'is at most', '>': 'is above', '>=': 'is at least', '=': 'equals', '!=': 'differs from', is: 'is', 'is not': 'is not' };
const describeCondition = (c) => `${c.field} ${OP_WORDS[c.op]} ${typeof c.value === 'object' ? c.value.field : c.value}`;
export const describeStatefulConditions = (conds) => (conds.length ? conds.map(describeCondition).join(' and ') : 'always');
const describeChange = (c) => {
  const v = typeof c.value === 'object' ? c.value.field : c.value;
  return c.op === 'set' ? `${c.field} becomes ${v}` : c.op === 'add' ? `${c.field} grows by ${v}` : `${c.field} shrinks by ${v}`;
};
export const describeStatefulRule = (action, r) =>
  `${r.when.length ? `When ${describeStatefulConditions(r.when)}, ` : ''}${action} answers ${r.then}${r.change.length ? ` and ${r.change.map(describeChange).join(', ')}` : ''}.`;
export const describeStatefulProperty = (p) =>
  p.action
    ? `${p.action} ${p.kind === 'never' ? 'never' : 'always'} answers ${p.then}${p.when.length ? ` when ${describeStatefulConditions(p.when)}` : ''}.`
    : p.kind === 'always'
      ? `In every reachable state, ${describeStatefulConditions(p.when)}.`
      : `No reachable state has ${describeStatefulConditions(p.when)}.`;

// ---------------------------------------------------------------------------
// Evaluation: the same semantics the rendered model has.
// ---------------------------------------------------------------------------

/** The start state: field name to a choice word or a BigInt. */
export const initialState = (spec) => Object.fromEntries(spec.state.map((f) => [f.name, f.kind === 'choice' ? f.start : BigInt(f.start)]));

const operand = (env, value) => (typeof value === 'object' ? env[value.field] : BigInt(value));

export function holdsIn(cond, env) {
  const left = env[cond.field];
  switch (cond.op) {
    case 'is': return left === cond.value;
    case 'is not': return left !== cond.value;
    case '<': return left < operand(env, cond.value);
    case '<=': return left <= operand(env, cond.value);
    case '>': return left > operand(env, cond.value);
    case '>=': return left >= operand(env, cond.value);
    case '=': return left === operand(env, cond.value);
    case '!=': return left !== operand(env, cond.value);
    default: throw new Error(`unknown op ${cond.op}`);
  }
}

/** Whether a change keeps its state value within bounds, read in `env` (the state before the step and the inputs). */
export function changeFits(spec, change, env) {
  const f = spec.state.find((x) => x.name === change.field);
  if (f.kind === 'choice') return true;
  const v = operand(env, change.value);
  const old = env[change.field];
  const min = BigInt(f.min ?? 0);
  const max = BigInt(f.max);
  if (change.op === 'set') return v >= min && v <= max;
  if (change.op === 'add') return old + v <= max;
  return v + min <= old;
}

function applyChange(change, env) {
  if (change.op === 'set') return typeof change.value === 'object' ? env[change.value.field] : typeof change.value === 'number' ? BigInt(change.value) : change.value;
  const v = operand(env, change.value);
  return change.op === 'add' ? env[change.field] + v : env[change.field] - v;
}

/** One action on a state: `{ state, outcome, rule }`, the rule null for otherwise. */
export function act(spec, state, action, inputs) {
  const env = { ...state, ...inputs };
  for (const rule of action.rules) {
    if (rule.when.every((c) => holdsIn(c, env)) && rule.change.every((c) => changeFits(spec, c, env))) {
      const next = { ...state };
      for (const c of rule.change) next[c.field] = applyChange(c, env);
      return { state: next, outcome: rule.then, rule: rule.id };
    }
  }
  return { state, outcome: action.otherwise, rule: null };
}

/** One step's text, decoded as the model reads it: `{ action, inputs }`, or null when malformed. */
export function decodeStep(spec, text) {
  const parts = text.split(' ');
  const action = spec.actions.find((a) => a.name === parts[0]);
  if (!action || parts.length !== action.inputs.length + 1) return null;
  const inputs = {};
  for (const [i, f] of action.inputs.entries()) {
    const part = parts[i + 1];
    if (f.kind === 'choice') {
      if (!f.values.includes(part)) return null;
      inputs[f.name] = part;
    } else {
      const n = parseNumber(part);
      if (n === null || (f.min !== undefined && n < BigInt(f.min)) || (f.max !== undefined && n > BigInt(f.max))) return null;
      inputs[f.name] = n;
    }
  }
  return { action, inputs };
}

export const encodeStep = (action, inputs) => [action.name, ...action.inputs.map((f) => String(inputs[f.name]))].join(' ');

/** Each step of a session from the start, `{ outcome, rule, state }`; a malformed step answers invalid and every later step does too. */
export function runSession(spec, steps) {
  let state = initialState(spec);
  let broken = false;
  return steps.map((text) => {
    const decoded = broken ? null : decodeStep(spec, text);
    if (!decoded) {
      broken = true;
      return { outcome: INVALID, rule: null, state };
    }
    const r = act(spec, state, decoded.action, decoded.inputs);
    state = r.state;
    return r;
  });
}

/** The answer text of a state after a step: the outcome, then each state value as `name=value`. */
export const answerText = (spec, outcome, state) => [outcome, ...spec.state.map((f) => `${f.name}=${state[f.name]}`)].join(' ');

export function sessionLimits(spec) {
  const valueWidth = (f) => (f.kind === 'choice' ? Math.max(...f.values.map((v) => v.length)) : String(f.max).length);
  const responseMaximum = Math.max(64, Math.max(...spec.outcomes.map((o) => o.length), INVALID.length) + spec.state.reduce((n, f) => n + 2 + f.name.length + valueWidth(f), 0));
  return { requestMaximum: SESSION_BYTES, responseMaximum, guestAllocationMaximum: SESSION_BYTES * 2 };
}

/** The whole dispatch over bytes: what the guest answers to a session, its steps separated by `;`. */
export function respondSession(spec, bytes) {
  if (bytes.length === 0 || bytes.length > SESSION_BYTES) return INVALID;
  let text;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return INVALID;
  }
  let state = initialState(spec);
  let last = null;
  for (const step of text.split(';')) {
    const decoded = decodeStep(spec, step);
    if (!decoded) return INVALID;
    const r = act(spec, state, decoded.action, decoded.inputs);
    state = r.state;
    last = r.outcome;
  }
  return answerText(spec, last, state);
}

// ---------------------------------------------------------------------------
// Search: reachable states, for counterexamples before Lean is asked.
// ---------------------------------------------------------------------------

/** Candidate inputs of an action: every choice, and every number on an edge of a comparison, a change or a bound. */
function inputCandidates(spec, action) {
  const constants = new Set([0n, 1n, 2n]);
  const add = (n) => {
    for (const d of [-1n, 0n, 1n]) if (BigInt(n) + d >= 0n && BigInt(n) + d <= NAT_MAX) constants.add(BigInt(n) + d);
  };
  for (const f of [...spec.state, ...action.inputs]) {
    if (f.min !== undefined) add(f.min);
    if (f.max !== undefined) add(f.max);
  }
  for (const r of action.rules) for (const c of [...r.when, ...r.change]) if (typeof c.value === 'number') add(c.value);
  for (const p of spec.properties) for (const c of p.when) if (typeof c.value === 'number') add(c.value);
  const sorted = [...constants].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  const lists = action.inputs.map((f) => (f.kind === 'choice' ? f.values : sorted.filter((n) => (f.min === undefined || n >= BigInt(f.min)) && (f.max === undefined || n <= BigInt(f.max)))));
  const out = [];
  const walk = (i, acc) => {
    if (out.length >= 64) return;
    if (i === lists.length) return void out.push({ ...acc });
    for (const v of lists[i]) walk(i + 1, { ...acc, [action.inputs[i].name]: v });
  };
  walk(0, {});
  return out;
}

const stateKey = (spec, state) => spec.state.map((f) => String(state[f.name])).join(' ');

/**
 * Reachable states, breadth first from the start, each with the shortest
 * session found to reach it, up to `limit` states.
 */
export function reachableStates(spec, limit = 4000) {
  const start = initialState(spec);
  const seen = new Map([[stateKey(spec, start), { state: start, steps: [] }]]);
  const queue = [seen.get(stateKey(spec, start))];
  const moves = spec.actions.map((a) => ({ action: a, inputs: inputCandidates(spec, a) }));
  while (queue.length && seen.size < limit) {
    const { state, steps } = queue.shift();
    for (const { action, inputs: list } of moves) {
      for (const inputs of list) {
        const r = act(spec, state, action, inputs);
        const key = stateKey(spec, r.state);
        if (seen.has(key)) continue;
        const entry = { state: r.state, steps: [...steps, encodeStep(action, inputs)] };
        seen.set(key, entry);
        queue.push(entry);
        if (seen.size >= limit) break;
      }
    }
  }
  return [...seen.values()];
}

/**
 * A session that breaks the property, or null when none of the reachable
 * states sampled does. `{ steps, outcome?, checked }`.
 */
export function statefulCounterexample(spec, property) {
  const states = reachableStates(spec);
  let checked = 0;
  for (const { state, steps } of states) {
    if (!property.action) {
      checked++;
      const all = property.when.every((c) => holdsIn(c, state));
      if (property.kind === 'always' ? !all : all) return { steps, checked, state: stateKey(spec, state) };
      continue;
    }
    const action = spec.actions.find((a) => a.name === property.action);
    for (const inputs of inputCandidates(spec, action)) {
      checked++;
      if (!property.when.every((c) => holdsIn(c, { ...state, ...inputs }))) continue;
      const r = act(spec, state, action, inputs);
      const broken = property.kind === 'never' ? r.outcome === property.then : r.outcome !== property.then;
      if (broken) return { steps: [...steps, encodeStep(action, inputs)], outcome: r.outcome, rule: r.rule, checked };
    }
  }
  return { steps: null, checked };
}

export { inputCandidates };
