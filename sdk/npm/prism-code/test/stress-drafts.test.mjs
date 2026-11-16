// Stress, classes B, C and E: the drafts models really write, and the ones a generator can vary.
// The properties: a slip with one meaning is read and named in `notes`; any other is refused by a
// registered rule, in words that say what to fix; and the same draft always gives the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FIXTURES, SHIPPING_DRAFT } from './support/journey-client.mjs';
import { checkSpec, completeSpec, repairMessage } from '../src/journey/complete.mjs';
import { REFUSALS } from '../src/journey/spec.mjs';
import { SPEC_FILE_REFUSALS, canonicalJson } from '../src/journey/spec-file.mjs';
import { writeApp } from '../src/journey/project.mjs';
import { SPEC_SEAL_MARK } from '../src/journey/render.mjs';
import { kappa } from '../src/blake3.mjs';

const when = (field, op, value) => ({ field, op, value });
const NUMBER = { name: 'weight', kind: 'number', min: 0, max: 50 };
const OTHER = { name: 'limit', kind: 'number', min: 0, max: 50 };
const CHOICE = { name: 'destination', kind: 'choice', values: ['domestic', 'worldwide'] };
const draft = (rules, more = {}) => ({ title: 'Shipping', fields: [NUMBER, OTHER, CHOICE], rules, otherwise: 'standard', ...more });
const rule = (...conditions) => ({ when: conditions, then: 'express' });

/** The 40 drafts Qwen3 30B wrote on 2026-11-15 with only the MCP instructions as its prompt. */
const RECORDED = readFileSync(join(FIXTURES, 'qwen3-30b-drafts.recorded.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line)).map((row) => ({ id: row.id, draft: JSON.parse(row.draft) }));

/** Every registered refusal: what a spec says wrong, and what its JSON says wrong. */
const REGISTERED = [...REFUSALS, ...SPEC_FILE_REFUSALS];

/** Every refusal the tests in this file meet, by rule, to say at the end which rules were exercised. */
const met = new Map();

/** A refusal an agent can act on: a registered rule, and words that name what is wrong. */
function refusedWell(result, label) {
  assert.equal(result.ok, false, `${label} was accepted`);
  if (result.refusal) {
    assert.ok(REGISTERED.includes(result.refusal.rule), `${label}: ${result.refusal.rule} is not a registered refusal`);
    const message = result.refusal.message;
    assert.ok(message.length >= 20 && /[.?]$/.test(message), `${label}: the refusal says too little: ${message}`);
    assert.doesNotMatch(message, /undefined|\[object Object\]|NaN/, `${label}: ${message}`);
    met.set(result.refusal.rule, message);
    return result.refusal.rule;
  }
  // Checked, and a guarantee or an example is wrong: the repair message names it and the ways out.
  assert.ok(result.broken.length + result.examples.length > 0, `${label}: refused with nothing named`);
  const repair = repairMessage(result);
  assert.ok(repair && repair.length >= 60, `${label}: no repair message`);
  return 'broken';
}

test('recorded drafts: each is accepted with its readings named, or refused in words an agent can act on', () => {
  const outcome = {};
  for (const { id, draft: written } of RECORDED) {
    const result = checkSpec(written);
    if (result.ok) {
      outcome.accepted = (outcome.accepted ?? 0) + 1;
      // Whatever was read differently from how it was written is said.
      const rewritten = JSON.stringify(result.spec.rules.map((r) => r.when.map((c) => c.op))) !== JSON.stringify(written.rules.map((r) => r.when.map((c) => c.op)));
      if (rewritten) assert.ok(result.notes.some((n) => /^Read /.test(n)), `${id}: a comparison was read differently and no note says so`);
      continue;
    }
    const why = refusedWell(result, id);
    outcome[why] = (outcome[why] ?? 0) + 1;
  }
  // Measured on 2026-11-15: 0.9.1 accepted 10 of these 40; with the comparison word read, 33. A fall below that is a regression.
  assert.ok(outcome.accepted >= 33, `only ${outcome.accepted} of ${RECORDED.length} recorded drafts are accepted: ${JSON.stringify(outcome)}`);
  // What is still refused is refused for a reason no reading settles.
  const { accepted, ...refused } = outcome;
  assert.deepEqual(Object.keys(refused).sort(), ['broken', 'condition.comparison', 'outcomes.reserved', 'outcomes.too-few']);
});

test('every comparison word on every kind of field is read one way, or refused by the rule for that kind', () => {
  const read = (condition) => checkSpec(draft([rule(condition)]));
  // A choice: equality has one meaning, an ordering has none.
  for (const [op, as] of [['is', 'is'], ['is not', 'is not'], ['=', 'is'], ['==', 'is'], ['!=', 'is not']]) {
    const result = read(when('destination', op, 'worldwide'));
    assert.equal(result.ok, true, `${op}: ${result.refusal?.message}`);
    assert.equal(result.spec.rules[0].when[0].op, as);
    assert.equal(result.notes.some((n) => /^Read `destination/.test(n)), op !== as, `${op}: the note`);
  }
  for (const op of ['<', '<=', '>', '>=', 'equals', 'in', '', 'IS']) assert.equal(refusedWell(read(when('destination', op, 'worldwide')), `choice ${op}`), 'choice.comparison');
  assert.equal(refusedWell(read(when('destination', 'is', 'mars')), 'unknown choice'), 'choice.value');
  assert.equal(refusedWell(read(when('destination', '=', 'mars')), 'unknown choice, wrong word'), 'choice.comparison');
  // A number: against a whole number, a field, or a bare word that names a number field.
  for (const [op, as] of [['<', '<'], ['<=', '<='], ['>', '>'], ['>=', '>='], ['=', '='], ['!=', '!='], ['is', '='], ['==', '='], ['is not', '!=']]) {
    for (const value of [20, { field: 'limit' }, 'limit']) {
      const result = read(when('weight', op, value));
      assert.equal(result.ok, true, `${op} ${JSON.stringify(value)}: ${result.refusal?.message}`);
      assert.deepEqual(result.spec.rules[0].when[0], when('weight', as, typeof value === 'number' ? value : { field: 'limit' }));
    }
  }
  for (const op of ['equals', '=>', '=<', '<>', 'above', '']) assert.equal(refusedWell(read(when('weight', op, 20)), `number ${op}`), 'condition.comparison');
  // What a number cannot be compared with.
  for (const value of ['heavy', 'destination', '20', 20.5, -1, true, null, [20], { field: 'destination' }, { field: 'nothing' }]) {
    const result = read(when('weight', '>', value));
    assert.ok(['condition.operand', 'condition.number', 'condition.comparison', 'json.number'].includes(refusedWell(result, `weight > ${JSON.stringify(value)}`)));
  }
  assert.equal(refusedWell(read(when('height', '>', 20)), 'unknown field'), 'condition.unknown-field');
  assert.equal(refusedWell(checkSpec(draft([{ when: [], then: 'express' }])), 'no condition'), 'condition.none');
});

test('`invalid` is refused wherever a rule would answer it, and dropped where nothing does', () => {
  assert.equal(refusedWell(checkSpec(draft([rule(when('weight', '>', 20))], { otherwise: 'invalid' })), 'otherwise'), 'outcomes.reserved');
  assert.equal(refusedWell(checkSpec(draft([{ when: [when('weight', '>', 20)], then: 'invalid' }])), 'then'), 'outcomes.reserved');
  const listed = checkSpec(draft([rule(when('weight', '>', 20))], { outcomes: ['express', 'standard', 'invalid'] }));
  assert.equal(listed.ok, true, listed.refusal?.message);
  assert.deepEqual(listed.spec.outcomes, ['express', 'standard']);
  assert.ok(listed.notes.some((n) => /^Dropped `invalid`/.test(n)));
  assert.equal(refusedWell(checkSpec(draft([rule(when('weight', '>', 20))], { outcomes: ['express', 'standard', 'invalid'], properties: [{ kind: 'never', when: [when('weight', '>', 20)], then: 'invalid' }] })), 'guarantee'), 'outcomes.reserved');
});

test('answers, fields, rules and bounds at and past their limits', () => {
  const one = (more) => checkSpec(draft([rule(when('weight', '>', 20))], more));
  assert.equal(refusedWell(checkSpec(draft([{ when: [when('weight', '>', 20)], then: 'standard' }])), 'one answer'), 'outcomes.too-few');
  assert.equal(refusedWell(one({ rules: [] }), 'no rules'), 'rules.none');
  assert.equal(refusedWell(one({ otherwise: undefined }), 'no otherwise'), 'rules.otherwise');
  assert.equal(refusedWell(one({ fields: [] }), 'no fields'), 'fields.none');
  const fields = (n) => Array.from({ length: n }, (_, i) => ({ name: `f${String.fromCharCode(97 + i)}`, kind: 'number', max: 9 }));
  const using = (list) => ({ fields: list, rules: [{ when: list.map((f) => when(f.name, '>', 1)), then: 'express' }] });
  assert.equal(one(using(fields(8))).ok, true);
  assert.equal(refusedWell(one(using(fields(9))), '9 fields'), 'fields.too-many');
  const rules = (n) => Array.from({ length: n }, (_, i) => rule(when('weight', '=', i)));
  assert.equal(one({ rules: rules(24) }).ok, true);
  assert.equal(refusedWell(one({ rules: rules(25) }), '25 rules'), 'rules.too-many');
  const bounded = (bounds) => one({ fields: [{ name: 'weight', kind: 'number', ...bounds }, OTHER, CHOICE] });
  assert.equal(bounded({ min: 0, max: 0 }).ok, true);
  assert.equal(bounded({}).ok, true);
  assert.equal(refusedWell(bounded({ min: 30, max: 20 }), 'reversed bounds'), 'number.bound-order');
  for (const bad of [{ min: -1 }, { max: 1.5 }, { min: '0' }, { max: Number.MAX_SAFE_INTEGER + 2 }]) assert.match(refusedWell(bounded(bad), `bounds ${JSON.stringify(bad)}`), /^(number|json)\./);
  assert.equal(refusedWell(one({ fields: [NUMBER, NUMBER, CHOICE] }), 'duplicate field'), 'field.duplicate');
  assert.equal(refusedWell(one({ fields: [NUMBER, OTHER, { name: 'destination', kind: 'choice', values: ['domestic'] }] }), 'one choice'), 'choice.too-few');
  assert.equal(refusedWell(one({ fields: [NUMBER, OTHER, { name: 'destination', kind: 'choice', values: ['domestic', 'domestic'] }] }), 'duplicate choice'), 'choice.duplicate');
  assert.equal(refusedWell(one({ fields: [NUMBER, OTHER, { name: 'destination', kind: 'date' }] }), 'unknown kind'), 'field.kind');
  assert.equal(refusedWell(one({ fields: [{ name: 'Weight KG', kind: 'number' }, OTHER, CHOICE] }), 'field name'), 'field.name');
  assert.equal(refusedWell(one({ title: 'Shipping — method' }), 'a character text cannot carry'), 'text.character');
  assert.equal(refusedWell(one({ title: 'Shipping  method' }), 'a doubled space'), 'text.space');
  assert.equal(refusedWell(one({ title: 'x'.repeat(65) }), 'a long title'), 'text.length');
});

test('a guarantee or an example the rules break is named with the request that shows it and the ways out', () => {
  const wrong = checkSpec(draft([rule(when('destination', 'is', 'worldwide'))], { properties: [{ kind: 'never', when: [when('weight', '>', 20)], then: 'express' }] }));
  assert.equal(refusedWell(wrong, 'a false guarantee'), 'broken');
  const repair = repairMessage(wrong);
  assert.match(repair, /worldwide/);
  assert.match(repair, /Two ways|either|or /i);
  const example = checkSpec({ ...completeSpec(draft([rule(when('weight', '>', 20))])).spec, examples: [{ request: '5 5 domestic', response: 'express' }] });
  assert.equal(example.ok, false);
  assert.ok(example.examples.length === 1 || example.refusal, 'the wrong example is named');
});

// ---------------------------------------------------------------------------
// Class C: the same draft, the same bytes.
// ---------------------------------------------------------------------------

/** The same value with every object's keys in the opposite order. */
const reversed = (value) => (Array.isArray(value) ? value.map(reversed) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).reverse().map((k) => [k, reversed(value[k])])) : value);

/** What Prism writes for a draft: the stored spec.json, every model file, and the seal the model carries. */
function written(input) {
  const dir = mkdtempSync(join(tmpdir(), 'prism-stress-app-'));
  const session = { spec: completeSpec(input).spec, status: {}, axioms: {} };
  const { model } = writeApp(dir, session, { overwrite: true });
  const stored = readFileSync(join(dir, 'spec.json'));
  const files = Object.fromEntries(readdirSync(join(dir, 'src'), { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => [e.name, readFileSync(join(e.parentPath ?? e.path, e.name), 'utf8')]));
  return { stored: stored.toString('utf8'), files, address: kappa(new Uint8Array(stored)), seal: SPEC_SEAL_MARK.exec(model)?.[1] ?? null };
}

const ACCEPTED = [
  { id: 'shipping fixture', draft: SHIPPING_DRAFT },
  { id: 'shipping draft', draft: JSON.parse(readFileSync(new URL('./fixtures/specs/shipping.draft.json', import.meta.url), 'utf8')) },
  { id: 'payment approval', draft: JSON.parse(readFileSync(new URL('./fixtures/specs/payment-approval.spec.json', import.meta.url), 'utf8')) },
  ...RECORDED.filter((r) => checkSpec(r.draft).ok),
];

test('the same draft gives the same spec, model and seal: twice, reordered, and reformatted', () => {
  assert.ok(ACCEPTED.length >= 36);
  for (const { id, draft: input } of ACCEPTED) {
    const first = written(input);
    assert.match(first.seal, /^blake3:[0-9a-f]{64}$/, id);
    assert.equal(first.seal, first.address, `${id}: the model's seal is the address of the stored spec.json`);
    for (const [how, variant] of [
      ['again', input],
      ['a deep copy', structuredClone(input)],
      ['keys reversed', reversed(input)],
      ['as indented text', JSON.stringify(input, null, 4)],
      ['as compact text of the reversed keys', JSON.stringify(reversed(input))],
    ]) {
      const other = written(variant);
      assert.equal(other.stored, first.stored, `${id}, ${how}: spec.json`);
      assert.deepEqual(other.files, first.files, `${id}, ${how}: the model files`);
      assert.equal(other.seal, first.seal, `${id}, ${how}: the seal`);
    }
    assert.equal(canonicalJson(completeSpec(input).spec), canonicalJson(completeSpec(reversed(input)).spec), id);
  }
});

test('any change to what a draft says changes the seal', () => {
  const base = written(SHIPPING_DRAFT).seal;
  const changes = {
    'a threshold': (d) => (d.rules[1].when[0].value = 21),
    'a comparison': (d) => (d.rules[1].when[0].op = '>='),
    'an answer': (d) => (d.otherwise = 'economy'),
    'a bound': (d) => (d.fields[0].max = 51),
    'a choice': (d) => (d.fields[1].values[0] = 'local'),
    'the order of the rules': (d) => d.rules.reverse(),
    'the title': (d) => (d.title = 'Shipping Methods'),
  };
  const seen = new Set([base]);
  for (const [what, change] of Object.entries(changes)) {
    const changed = structuredClone(SHIPPING_DRAFT);
    change(changed);
    const seal = written(changed).seal;
    assert.ok(!seen.has(seal), `${what} did not change the seal`);
    seen.add(seal);
  }
});

test('the refusals these drafts meet are registered, and this is how many of the registered ones they reach', () => {
  for (const rule of met.keys()) assert.ok(REGISTERED.includes(rule));
  const unmet = REGISTERED.filter((rule) => !met.has(rule));
  // Not a requirement that every rule be reached from a draft: some belong to answers given as text, or to prism/spec/2.
  assert.ok(met.size >= 20, `only ${met.size} refusal rules were reached: ${[...met.keys()].sort().join(', ')}`);
  console.log(`# refusal rules reached from a draft: ${met.size} of ${REGISTERED.length}; not reached: ${unmet.join(', ')}`);
});
