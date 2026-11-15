// The draft form of prism/spec/1 (#666): a model writes what the user said, which is a title,
// fields, rules and the default answer, and Prism derives the rest, the same way every time.
// The recorded drafts under fixtures/specs are what models wrote on 2026-11-13.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { kappa } from '../src/blake3.mjs';
import { REFUSALS, SpecError, counterexample, respond, validateSpec } from '../src/journey/spec.mjs';
import { SPEC_FILE_REFUSALS, canonicalJson, readSpecFile } from '../src/journey/spec-file.mjs';
import { DERIVED_MEMBERS, EXAMPLES_WANTED, GUARANTEES_WANTED, PROPOSED, checkSpec, completeSpec, isDraft, isProposed, nameFrom, purposeFrom, repairMessage } from '../src/journey/complete.mjs';
import { DRAFT_JSON_SCHEMA, SPEC_JSON_SCHEMA } from '../src/journey/spec-schema.mjs';
import { SPEC_SEAL_MARK, renderModel } from '../src/journey/render.mjs';
import { summary } from '../src/journey/session.mjs';
import { readSession, writeApp } from '../src/journey/project.mjs';
import { createServer } from '../src/journey/mcp.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));

const SPECS = new URL('./fixtures/specs/', import.meta.url);
const fixture = (name) => JSON.parse(readFileSync(new URL(name, SPECS), 'utf8'));
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-complete-'));
const copy = (v) => JSON.parse(JSON.stringify(v));
const bytesOf = (input) => canonicalJson(completeSpec(input).spec);
const refusedWith = (input, rule) =>
  assert.throws(() => completeSpec(input), (error) => {
    assert.ok(error instanceof SpecError, String(error));
    assert.equal(error.rule, rule, error.message);
    return true;
  });

/** The shipping example, as a model writes it: what the user said and nothing else. */
const DRAFT = Object.freeze(fixture('shipping.draft.json'));
/** What Qwen3 30B wrote for the shipping sentence: `invalid` listed, two guarantees about weights that cannot be asked, one its rules break. */
const RECORDED = Object.freeze(fixture('shipping-qwen.recorded.json'));
const FULL = Object.freeze(fixture('payment-approval.spec.json'));

const when = (field, op, value) => ({ field, op, value });

// ---------------------------------------------------------------------------
// The draft form
// ---------------------------------------------------------------------------

test('a draft is a prism/spec/1 spec that leaves out something Prism derives; a whole spec is not one', () => {
  assert.deepEqual([...DERIVED_MEMBERS], ['purpose', 'outcomes', 'properties', 'examples']);
  assert.equal(isDraft(DRAFT), true);
  assert.equal(isDraft(FULL), false);
  assert.equal(isDraft(completeSpec(DRAFT).spec), false, 'a completed draft is whole');
  for (const key of DERIVED_MEMBERS) {
    const { [key]: dropped, ...rest } = FULL;
    assert.equal(isDraft(rest), true, `without ${key}`);
  }
  assert.equal(isDraft(fixture('../stateful/dinner-seats.spec.json')), false, 'prism/spec/2 has no draft form');
  // A draft is not a full spec to the strict reader, and completing it gives one that is.
  assert.throws(() => readSpecFile(DRAFT), SpecError);
  assert.equal(readSpecFile(completeSpec(DRAFT).spec).spec.schema, 'prism/spec/1');
});

test('the same draft gives the same bytes, whatever order its keys are in', () => {
  const first = bytesOf(DRAFT);
  assert.equal(bytesOf(copy(DRAFT)), first);
  assert.equal(bytesOf(JSON.stringify(DRAFT)), first, 'as JSON text');
  assert.equal(bytesOf(JSON.stringify(DRAFT, null, 2)), first, 'pretty-printed');
  const reordered = Object.fromEntries(Object.entries(DRAFT).reverse());
  reordered.fields = DRAFT.fields.map((f) => Object.fromEntries(Object.entries(f).reverse()));
  reordered.rules = DRAFT.rules.map((r) => ({ then: r.then, when: r.when.map((c) => ({ value: c.value, op: c.op, field: c.field })) }));
  assert.equal(bytesOf(reordered), first);
  assert.notEqual(bytesOf({ ...DRAFT, otherwise: 'express' }), first, 'one changed answer changes the bytes');
});

test('a whole spec passes through unchanged, and completing a completed spec changes nothing', () => {
  const done = completeSpec(FULL);
  assert.deepEqual([done.draft, done.proposed, done.notes], [false, [], []]);
  assert.equal(canonicalJson(done.spec), readSpecFile(FULL).text, 'the bytes validateSpec gives today');
  const completed = completeSpec(DRAFT).spec;
  const again = completeSpec(completed);
  assert.deepEqual([again.draft, again.notes], [false, []]);
  assert.equal(canonicalJson(again.spec), canonicalJson(completed));
});

test('a guarantee the user struck does not come back', () => {
  const completed = completeSpec(DRAFT).spec;
  assert.equal(completed.properties.length, 2);
  const struck = { ...completed, properties: [] };
  const again = completeSpec(struck);
  assert.deepEqual(again.spec.properties, []);
  assert.deepEqual(again.proposed, []);
  const one = completeSpec({ ...completed, properties: completed.properties.slice(1) });
  assert.equal(one.spec.properties.length, 1);
});

test('completion reads as strictly as spec.json is read', () => {
  refusedWith({ ...DRAFT, colour: 'red' }, 'json.member');
  refusedWith({ ...DRAFT, fields: [{ name: 'weight', kind: 'number', min: 0.5 }, DRAFT.fields[1]] }, 'json.number');
  refusedWith(`{"title":"A","title":"B"}`, 'json.duplicate');
  refusedWith({ ...DRAFT, fields: [{ name: 'weight', kind: 'number', min: -5, max: 40 }, DRAFT.fields[1]] }, 'number.bound');
  refusedWith({ ...DRAFT, rules: [{ when: [when('height', '>', 3)], then: 'freight' }] }, 'condition.unknown-field');
  refusedWith({ ...DRAFT, rules: [] }, 'rules.none');
  refusedWith({ title: 'T', fields: DRAFT.fields, rules: DRAFT.rules }, 'rules.otherwise');
});

test('a number field compared with a bare word that names a number field is read as that field, and named', () => {
  const draft = {
    title: 'Payment',
    fields: [{ name: 'amount', kind: 'number', max: 1000 }, { name: 'limit', kind: 'number', max: 1000 }],
    rules: [{ when: [when('amount', '<=', 'limit')], then: 'approved' }],
    otherwise: 'refused',
  };
  const checked = checkSpec(draft);
  assert.equal(checked.ok, true);
  assert.deepEqual(checked.spec.rules[0].when, [when('amount', '<=', { field: 'limit' })]);
  assert.deepEqual(checked.notes.filter((n) => /^Read/.test(n)), ['Read `amount <= "limit"` as a comparison with the field limit: a number is never compared with text.']);
  // The stored spec is the one with the field written out, and it is the same spec as the draft that wrote it so.
  const written = { ...draft, rules: [{ when: [when('amount', '<=', { field: 'limit' })], then: 'approved' }] };
  assert.equal(canonicalJson(checked.spec), canonicalJson(completeSpec(written).spec));
  assert.deepEqual(completeSpec(written).notes, []);
  // In a guarantee too; and the strict reader still refuses the bare word, saying how to write it.
  const stated = completeSpec({ ...written, properties: [{ kind: 'never', when: [when('amount', '>', 'limit')], then: 'approved' }] });
  assert.deepEqual(stated.spec.properties[0].when, [when('amount', '>', { field: 'limit' })]);
  assert.throws(() => readSpecFile({ ...completeSpec(written).spec, rules: draft.rules }), /to compare with the field `limit`, write the value as \{"field": "limit"\}\./);
  // A choice compared with a word is a choice, never a field.
  const choice = completeSpec({ title: 'Role', fields: [{ name: 'role', kind: 'choice', values: ['limit', 'other'] }, { name: 'limit', kind: 'number', max: 9 }], rules: [{ when: [when('role', 'is', 'limit')], then: 'yes' }], otherwise: 'no' });
  assert.deepEqual([choice.spec.rules[0].when, choice.notes], [[when('role', 'is', 'limit')], []]);
  // A word that names no number field keeps the plain refusal.
  assert.match(checkSpec({ ...draft, rules: [{ when: [when('amount', '<=', 'ceiling')], then: 'approved' }] }).refusal.message, /`"ceiling"` is not a number field\./);
});

test('equality on a choice is read as `is`, and `is` on a number as `=`, each named', () => {
  const fields = [{ name: 'weight', kind: 'number', max: 50 }, { name: 'limit', kind: 'number', max: 50 }, { name: 'destination', kind: 'choice', values: ['domestic', 'worldwide'] }];
  const written = { title: 'Shipping', fields, rules: [{ when: [when('destination', 'is', 'worldwide')], then: 'express' }, { when: [when('destination', 'is not', 'domestic'), when('weight', '=', 20), when('weight', '!=', { field: 'limit' })], then: 'express' }], otherwise: 'standard' };
  // What Qwen3 30B wrote on 2026-11-15: `==`, then `=`, on a choice.
  const draft = { ...written, rules: [{ when: [when('destination', '==', 'worldwide')], then: 'express' }, { when: [when('destination', '!=', 'domestic'), when('weight', 'is', 20), when('weight', 'is not', { field: 'limit' })], then: 'express' }] };
  const checked = checkSpec(draft);
  assert.equal(checked.ok, true);
  assert.equal(canonicalJson(checked.spec), canonicalJson(completeSpec(written).spec));
  assert.deepEqual(checked.notes.filter((n) => /^Read/.test(n)), [
    'Read `destination == worldwide` as `destination is worldwide`: a choice is compared with `is` or `is not`.',
    'Read `destination != domestic` as `destination is not domestic`: a choice is compared with `is` or `is not`.',
    'Read `weight is 20` as `weight = 20`: a number is compared with `=` or `!=`.',
    'Read `weight is not limit` as `weight != limit`: a number is compared with `=` or `!=`.',
  ]);
  assert.deepEqual(completeSpec(written).notes.filter((n) => /^Read/.test(n)), []);
  // With a bare word for the other field, both readings apply.
  const both = completeSpec({ ...written, rules: [{ when: [when('weight', 'is', 'limit')], then: 'express' }] });
  assert.deepEqual(both.spec.rules[0].when, [when('weight', '=', { field: 'limit' })]);
  // An ordering has no meaning on a choice, and a word that is not a choice is not guessed at.
  assert.equal(checkSpec({ ...written, rules: [{ when: [when('destination', '<', 'worldwide')], then: 'express' }] }).refusal.rule, 'choice.comparison');
  assert.equal(checkSpec({ ...written, rules: [{ when: [when('destination', '=', 'mars')], then: 'express' }] }).refusal.rule, 'choice.comparison');
  // The strict reader still refuses each, now saying which part is wrong.
  const whole = completeSpec(written).spec;
  assert.throws(() => readSpecFile({ ...whole, rules: [{ when: [when('destination', '=', 'worldwide')], then: 'express' }] }), /`destination` is a choice; compare it with "is" or "is not", not `=`\./);
  assert.throws(() => readSpecFile({ ...whole, rules: [{ when: [when('destination', 'is', 'mars')], then: 'express' }] }), /`mars` is not a choice of `destination`; the choices are domestic, worldwide\./);
  assert.throws(() => readSpecFile({ ...whole, rules: [{ when: [when('weight', 'is not', 20)], then: 'express' }] }), /`is not` is not a comparison for the number `weight`; use one of /);
});

test('every rule completion refuses by is a registered refusal, and it is pure', () => {
  const source = readFileSync(new URL('../src/journey/complete.mjs', import.meta.url), 'utf8');
  const named = [...source.matchAll(/refuse\(.*, '([a-z]+\.[a-z-]+)'\);/g)].map((m) => m[1]);
  assert.ok(named.length >= 4);
  for (const rule of named) assert.ok(REFUSALS.includes(rule) || SPEC_FILE_REFUSALS.includes(rule), rule);
  assert.doesNotMatch(source, /\bDate\b|Math\.random|node:fs|node:child_process|process\.|fetch\(/, 'no clock, no randomness, no I/O');
});

// ---------------------------------------------------------------------------
// What is derived
// ---------------------------------------------------------------------------

test('outcomes are the answers the rules and otherwise give, in first-appearance order', () => {
  assert.deepEqual(completeSpec(DRAFT).spec.outcomes, ['freight', 'express', 'standard']);
  const given = completeSpec({ ...DRAFT, outcomes: ['standard', 'express', 'freight'] });
  assert.deepEqual(given.spec.outcomes, ['standard', 'express', 'freight'], 'stated outcomes are kept');
  refusedWith({ ...DRAFT, otherwise: 'invalid' }, 'outcomes.reserved');
  refusedWith({ ...DRAFT, rules: [{ when: [when('weight', '>', 30)], then: 'invalid' }] }, 'outcomes.reserved');
  refusedWith({ ...DRAFT, rules: [{ when: [when('weight', '>', 30)], then: 'standard' }] }, 'outcomes.too-few');
});

test('the purpose and the name follow one explicit rule', () => {
  const { spec } = completeSpec(DRAFT);
  assert.equal(spec.purpose, 'Decides freight, express or standard from weight and destination.');
  assert.equal(spec.name, 'shipping-tier');
  assert.equal(spec.title, 'Shipping Tier');
  assert.equal(purposeFrom(['yes', 'no'], ['age']), 'Decides yes or no from age.');
  const many = Array.from({ length: 30 }, (_, i) => `answer-number-${i}`);
  assert.equal(purposeFrom(many, ['a', 'b']), 'Decides one of 30 answers from 2 fields.');
  assert.ok(purposeFrom(many, ['a', 'b']).length <= 200);
  assert.equal(nameFrom('Loan check', 'ignored'), 'loan-check', 'from the title, as the session reads `Title: sentence`');
  assert.equal(nameFrom(undefined, 'Decide whether a payment request is approved'), 'payment-request-approved', 'else from the purpose');
  // A stated purpose and name are kept.
  const stated = completeSpec({ ...DRAFT, purpose: 'Pick the shipping tier.', name: 'tiers' }).spec;
  assert.deepEqual([stated.purpose, stated.name], ['Pick the shipping tier.', 'tiers']);
});

test('examples are the first request each rule decides and one for otherwise, at most six', () => {
  const { spec } = completeSpec(DRAFT);
  assert.deepEqual(spec.examples, [
    { request: '31 domestic', response: 'freight' },
    { request: '0 worldwide', response: 'express' },
    { request: '11 domestic', response: 'express' },
    { request: '0 domestic', response: 'standard' },
  ]);
  for (const e of spec.examples) assert.equal(respond(spec, new TextEncoder().encode(e.request)), e.response);
  const eight = {
    title: 'Bands',
    fields: [{ name: 'n', kind: 'number', min: 0, max: 100 }],
    rules: Array.from({ length: 8 }, (_, i) => ({ when: [when('n', '=', i * 10)], then: `band-${i}` })),
    otherwise: 'none',
  };
  const many = completeSpec(eight).spec.examples;
  assert.equal(many.length, EXAMPLES_WANTED);
  assert.deepEqual(many.at(-1), { request: '1', response: 'none' }, 'otherwise keeps its example');
  const kept = completeSpec({ ...DRAFT, examples: [{ request: '5 europe', response: 'standard' }] }).spec.examples;
  assert.deepEqual(kept, [{ request: '5 europe', response: 'standard' }], 'stated examples are kept');
});

test('guarantees are proposed from the rules in a fixed order, checked, marked, and capped at three', () => {
  const { spec, proposed } = completeSpec(DRAFT);
  assert.deepEqual(proposed, ['INV-001', 'INV-002']);
  assert.deepEqual(spec.properties.map((p) => [p.kind, p.then, p.when, p.why]), [
    ['always', 'freight', [when('weight', '>', 30)], `${PROPOSED} from REQ-001: no earlier rule overrides it.`],
    ['never', 'standard', [when('destination', 'is', 'worldwide')], `${PROPOSED} from the rules: no request with destination worldwide is answered standard.`],
  ]);
  for (const p of spec.properties) {
    assert.equal(isProposed(p), true);
    assert.equal(counterexample(spec, p).request, null, p.says);
  }
  // REQ-002 (worldwide is express) and REQ-003 (over 10 is express) are overridden by REQ-001 for a heavy parcel.
  assert.ok(!spec.properties.some((p) => p.kind === 'always' && p.then === 'express'));

  const wide = {
    title: 'Access',
    fields: [{ name: 'role', kind: 'choice', values: ['guest', 'member', 'admin'] }, { name: 'area', kind: 'choice', values: ['lobby', 'vault'] }],
    rules: [
      { when: [when('role', 'is', 'admin')], then: 'open' },
      { when: [when('area', 'is', 'lobby')], then: 'open' },
      { when: [when('role', 'is', 'member')], then: 'ask' },
    ],
    otherwise: 'closed',
  };
  const done = completeSpec(wide);
  assert.equal(done.spec.properties.length, GUARANTEES_WANTED, 'never more than three in all');
  // REQ-002 and REQ-003 are overridden by REQ-001 for an admin; then each choice, in order, with each answer it never gets.
  assert.deepEqual(done.spec.properties.map((p) => `${p.kind} ${p.then} when ${p.when.map((c) => `${c.field} ${c.op} ${c.value}`).join(' and ')}`), [
    'always open when role is admin',
    'never ask when role is guest',
    'never closed when role is member',
  ]);
  assert.equal(done.spec.properties[0].why, `${PROPOSED} from REQ-001: no earlier rule overrides it.`);
  assert.ok(done.spec.properties.slice(1).every((p) => p.kind === 'never'), 'rules first, then what a choice never gets');
  for (const p of done.spec.properties) assert.equal(counterexample(done.spec, p).request, null, p.says);
});

test('a proposal never comes from a rule an earlier rule overrides, even one that gives the same answer', () => {
  const draft = {
    title: 'Fee',
    fields: [{ name: 'age', kind: 'number', min: 0, max: 120 }],
    rules: [
      { when: [when('age', '<', 5)], then: 'free' },
      { when: [when('age', '<', 12)], then: 'free' },
      { when: [when('age', '>=', 65)], then: 'reduced' },
    ],
    otherwise: 'full',
  };
  const { spec } = completeSpec(draft);
  assert.deepEqual(spec.properties.map((p) => p.when), [[when('age', '<', 5)], [when('age', '>=', 65)]]);
});

test('a stated guarantee is kept first, and proposals fill up to three without repeating it', () => {
  const stated = { kind: 'always', when: [when('weight', '>', 30)], then: 'freight' };
  const { spec, proposed } = completeSpec({ ...DRAFT, properties: [stated] });
  assert.equal(spec.properties.length, 2);
  assert.equal(isProposed(spec.properties[0]), false);
  assert.deepEqual(proposed, ['INV-002']);
  assert.equal(new Set(spec.properties.map((p) => JSON.stringify([p.kind, p.when, p.then]))).size, 2, 'the rule it restates is not proposed again');
});

test('a spec that already has three guarantees gets none, and a refused draft gets none', () => {
  const three = [1, 2, 3].map((n) => ({ kind: 'never', when: [when('weight', '=', n)], then: 'freight' }));
  const full = completeSpec({ ...DRAFT, properties: three });
  assert.deepEqual([full.proposed, full.spec.properties.length], [[], 3]);
  const broken = completeSpec({ ...DRAFT, properties: [{ kind: 'always', when: [when('weight', '=', 0)], then: 'freight' }] });
  assert.deepEqual([broken.proposed, broken.spec.properties.length, broken.spec.examples], [[], 1, []]);
  const wrong = completeSpec({ ...DRAFT, examples: [{ request: '31 domestic', response: 'standard' }] });
  assert.deepEqual([wrong.proposed, wrong.spec.properties], [[], []]);
});

test('nothing is proposed when the requests are more than Prism tries, and the note says so', () => {
  const fields = Array.from({ length: 8 }, (_, i) => ({ name: `f${i}`, kind: 'number', max: 1000 }));
  const rules = fields.map((f, i) => ({ when: [when(f.name, '>', 100 * (i + 1))], then: 'high' }));
  const done = completeSpec({ title: 'Wide', fields, rules, otherwise: 'low' });
  assert.deepEqual(done.proposed, []);
  assert.match(done.notes.join(' '), /No guarantee is proposed/);
  assert.ok(done.spec.examples.length >= 1, 'examples are still facts about the rules');
});

// ---------------------------------------------------------------------------
// Clean-ups, the recorded drafts and the repair message
// ---------------------------------------------------------------------------

test('recorded draft: an unused `invalid` and guarantees about requests that cannot happen are dropped and named', () => {
  const checked = checkSpec(RECORDED);
  assert.deepEqual(checked.spec.outcomes, ['standard', 'express', 'premium']);
  assert.equal(checked.notes.filter((n) => /Dropped `invalid` from the answers/.test(n)).length, 1);
  assert.deepEqual(checked.notes.filter((n) => /no request meets its conditions/.test(n)).map((n) => /"([^"]+)"/.exec(n)[1]), ['never standard when weight is below 0', 'never standard when weight is above 100']);
  assert.equal(checked.spec.properties.length, 1);
  // An `invalid` a rule answers is not dropped: it is refused, in the checker's words.
  const used = copy(RECORDED);
  used.rules[0].then = 'invalid';
  const refused = checkSpec(used);
  assert.deepEqual([refused.ok, refused.refusal.rule], [false, 'outcomes.reserved']);
  assert.match(repairMessage(refused), /^Prism checked the spec and refused it:\n- `invalid` is reserved for malformed requests; pick another word\. \(at outcomes\)\nFix exactly that\./);
});

test('recorded draft: the guarantee its rules break is named as written, beside the deciding rule and the request', () => {
  const checked = checkSpec(RECORDED);
  assert.equal(checked.ok, false);
  assert.deepEqual(checked.proposed, [], 'a refused draft gets no proposals');
  assert.equal(checked.broken.length, 1);
  assert.deepEqual(checked.broken[0], {
    id: 'INV-001',
    guarantee: { kind: 'always', when: [when('weight', '=', 0)], then: 'standard' },
    request: '0 worldwide',
    answer: 'express',
    ruleId: 'REQ-002',
    rule: { when: [when('destination', 'is', 'worldwide')], then: 'express' },
  });
  const message = repairMessage(checked);
  assert.ok(message.includes('The guarantee {"kind":"always","when":[{"field":"weight","op":"=","value":0}],"then":"standard"} is false: the request `0 worldwide` answers express, by the rule {"when":[{"field":"destination","op":"is","value":"worldwide"}],"then":"express"}.'), message);
  assert.match(message, /delete that guarantee from "properties", or change the rules so that request gets the answer the guarantee names/);
  assert.match(message, /Then write the whole spec again with nothing else changed\.$/);
});

test('recorded draft: either way out is accepted, and what is accepted is stored as it is', () => {
  const deleted = copy(RECORDED);
  deleted.properties.pop();
  const narrowed = copy(RECORDED);
  narrowed.properties[2] = { kind: 'always', when: [when('weight', '=', 0), when('destination', 'is', 'domestic')], then: 'standard' };
  for (const mended of [deleted, narrowed]) {
    const checked = checkSpec(mended);
    assert.equal(checked.ok, true);
    assert.equal(repairMessage(checked), null);
    assert.ok(!checked.spec.outcomes.includes('invalid'));
    assert.equal(checked.spec.rules.length, 4);
    const again = checkSpec(checked.spec);
    assert.deepEqual([again.ok, again.notes, again.draft], [true, [], false]);
    assert.equal(canonicalJson(again.spec), canonicalJson(checked.spec));
  }
});

test('a guarantee is called empty only when trying every request settles it', () => {
  // Three number fields compared in a chain can need three values inside one gap, which the edges may not hold.
  const chain = {
    title: 'Order',
    fields: ['a', 'b', 'c'].map((name) => ({ name, kind: 'number', max: 1000 })),
    rules: [{ when: [when('a', '>', 500)], then: 'high' }],
    otherwise: 'low',
    properties: [{ kind: 'never', when: [when('a', '>', { field: 'b' }), when('b', '>', { field: 'c' }), when('c', '>', 500)], then: 'low' }],
  };
  const done = completeSpec(chain);
  assert.ok(done.spec.properties.some((p) => !isProposed(p)), 'kept: Lean decides it');
  assert.ok(!done.notes.some((n) => /no request meets/.test(n)));
});

test('a broken guarantee decided by otherwise, a wrong example and a malformed one each get their own words', () => {
  const byOtherwise = checkSpec({ ...DRAFT, properties: [{ kind: 'never', when: [when('weight', '=', 0)], then: 'standard' }] });
  assert.equal(byOtherwise.broken[0].rule, null);
  assert.match(repairMessage(byOtherwise), /the request `0 domestic` answers standard, because no rule matches and `otherwise` is standard\./);
  const wrong = checkSpec({ ...DRAFT, examples: [{ request: '31 domestic', response: 'standard' }, { request: 'heavy', response: 'freight' }] });
  assert.equal(wrong.ok, false);
  assert.deepEqual(wrong.examples.map((e) => [e.answer, e.malformed]), [['freight', false], ['invalid', true]]);
  const message = repairMessage(wrong);
  assert.match(message, /The example \{"request":"31 domestic","response":"standard"\} is wrong: the rules answer freight\./);
  assert.match(message, /it is not a request/);
  assert.match(message, /delete it from "examples" or give it the answer the rules give/);
  assert.equal(repairMessage(checkSpec(DRAFT)), null);
  const refused = checkSpec({ ...DRAFT, rules: [{ when: [when('height', '>', 3)], then: 'freight' }] });
  assert.match(repairMessage(refused), /- `height` is not a field\. \(at rule\)/);
});

test('a rule no request reaches keeps its treatment: it stays, and a note names it', () => {
  const dead = { ...DRAFT, rules: [...DRAFT.rules, { when: [when('weight', '>', 50)], then: 'freight' }] };
  const checked = checkSpec(dead);
  assert.equal(checked.ok, true);
  assert.equal(checked.spec.rules.length, 4);
  assert.match(checked.notes.join(' '), /REQ-004 never decides anything/);
  assert.ok(!checked.spec.properties.some((p) => p.why.includes('REQ-004')), 'and no guarantee is proposed from it');
});

test('a stateful spec has no draft form and is checked as it is', () => {
  const stateful = fixture('../stateful/dinner-seats.spec.json');
  const done = completeSpec(stateful);
  assert.deepEqual([done.draft, done.proposed, done.notes], [false, [], []]);
  assert.equal(canonicalJson(done.spec), readSpecFile(stateful).text);
  assert.equal(checkSpec(stateful).ok, true);
});

// ---------------------------------------------------------------------------
// The seal
// ---------------------------------------------------------------------------

/** Write the app of a completed spec and return the stored spec.json, its address, and the seal the model carries. */
function sealed(input) {
  const dir = scratch();
  const session = { spec: completeSpec(input).spec, status: {}, axioms: {} };
  const { model } = writeApp(dir, session, { overwrite: true });
  const stored = readFileSync(join(dir, 'spec.json'));
  return { stored: stored.toString('utf8'), address: kappa(new Uint8Array(stored)), seal: SPEC_SEAL_MARK.exec(model)?.[1] ?? null, status: session.status };
}

test('the address of the stored spec.json is the seal of the model, with and without drops', () => {
  const plain = sealed(DRAFT);
  assert.match(plain.seal, /^blake3:[0-9a-f]{64}$/);
  assert.equal(plain.address, plain.seal);
  assert.equal(plain.status.specAddress, plain.seal);
  assert.equal(plain.stored, canonicalJson(completeSpec(DRAFT).spec), 'what is stored is the completed spec');
  assert.equal(readSpecFile(plain.stored).specAddress, plain.seal, 'and reading it back gives the same address');

  const mended = copy(RECORDED);
  mended.properties.pop();
  assert.equal(completeSpec(mended).notes.length, 3, 'three things were dropped');
  const dropped = sealed(mended);
  assert.equal(dropped.address, dropped.seal);
  assert.ok(!dropped.stored.includes('"invalid"'), 'the stored spec is the one after the drops');

  const dead = sealed({ ...DRAFT, rules: [...DRAFT.rules, { when: [when('weight', '>', 50)], then: 'freight' }] });
  assert.equal(dead.address, dead.seal, 'a rule no request reaches is kept, and the seal names the spec that keeps it');
  assert.equal(JSON.parse(dead.stored).rules.length, 4);
});

test('reordering the keys of a draft does not change the seal, and changing one answer does', () => {
  const base = sealed(DRAFT).seal;
  assert.equal(sealed(Object.fromEntries(Object.entries(DRAFT).reverse())).seal, base);
  const changed = copy(DRAFT);
  changed.rules[2].then = 'freight';
  assert.notEqual(sealed(changed).seal, base);
  const { spec } = completeSpec(DRAFT);
  assert.ok(renderModel(spec, { specAddress: readSpecFile(spec).specAddress }).includes(`[prism/spec/1 ${base}]`));
});

// ---------------------------------------------------------------------------
// The schemas
// ---------------------------------------------------------------------------

/** The part of JSON Schema these two schemas use. Returns the first violation as a path and a reason, or null. */
function violation(schema, value, path = '$') {
  if (schema.const !== undefined) return value === schema.const ? null : `${path}: not ${JSON.stringify(schema.const)}`;
  if (schema.enum) return schema.enum.includes(value) ? null : `${path}: not one of ${schema.enum.join(', ')}`;
  if (schema.anyOf) return schema.anyOf.some((s) => violation(s, value, path) === null) ? null : `${path}: matches no alternative`;
  const type = Array.isArray(value) ? 'array' : value === null ? 'null' : Number.isInteger(value) ? 'integer' : typeof value;
  if (schema.type && schema.type !== type) return `${path}: ${type}, not ${schema.type}`;
  if (type === 'integer' && schema.minimum !== undefined && value < schema.minimum) return `${path}: below ${schema.minimum}`;
  if (type === 'string') {
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return `${path}: does not match ${schema.pattern}`;
    if (schema.minLength !== undefined && value.length < schema.minLength) return `${path}: too short`;
    if (schema.maxLength !== undefined && value.length > schema.maxLength) return `${path}: too long`;
  }
  if (type === 'array') {
    if (schema.minItems !== undefined && value.length < schema.minItems) return `${path}: fewer than ${schema.minItems} items`;
    if (schema.maxItems !== undefined && value.length > schema.maxItems) return `${path}: more than ${schema.maxItems} items`;
    for (const [i, item] of value.entries()) {
      const v = schema.items ? violation(schema.items, item, `${path}[${i}]`) : null;
      if (v) return v;
    }
  }
  if (type === 'object') {
    for (const key of schema.required ?? []) if (!(key in value)) return `${path}: ${key} is required`;
    for (const [key, item] of Object.entries(value)) {
      const sub = schema.properties?.[key] ?? (typeof schema.additionalProperties === 'object' ? schema.additionalProperties : null);
      if (!sub) {
        if (schema.additionalProperties === false) return `${path}.${key}: not a member`;
        continue;
      }
      const v = violation(sub, item, `${path}.${key}`);
      if (v) return v;
    }
  }
  return null;
}

test('the schemas use only what the test validator reads', () => {
  const known = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'const', 'anyOf', 'minItems', 'maxItems', 'minimum', 'pattern', 'minLength', 'maxLength']);
  const walk = (schema) => {
    for (const [key, value] of Object.entries(schema)) {
      assert.ok(known.has(key), `keyword ${key}`);
      if (key === 'properties') Object.values(value).forEach(walk);
      else if (key === 'items' || (key === 'additionalProperties' && typeof value === 'object')) walk(value);
      else if (key === 'anyOf') value.forEach(walk);
    }
  };
  walk(DRAFT_JSON_SCHEMA);
  walk(SPEC_JSON_SCHEMA);
});

test('the draft schema is compact, closed, and holds number bounds to whole numbers that are not negative', () => {
  const size = new TextEncoder().encode(JSON.stringify(DRAFT_JSON_SCHEMA)).length;
  assert.ok(size <= 8192, `${size} bytes`);
  assert.ok(new TextEncoder().encode(JSON.stringify(SPEC_JSON_SCHEMA)).length <= 8192);
  assert.deepEqual(DRAFT_JSON_SCHEMA.required, ['title', 'fields', 'rules', 'otherwise']);
  assert.deepEqual(Object.keys(DRAFT_JSON_SCHEMA.properties), ['title', 'fields', 'rules', 'otherwise', 'properties']);
  const closed = (schema) => {
    if (schema.type === 'object') assert.equal(schema.additionalProperties, false);
    Object.values(schema.properties ?? {}).forEach(closed);
    if (schema.items) closed(schema.items);
    (schema.anyOf ?? []).forEach(closed);
  };
  closed(DRAFT_JSON_SCHEMA);
  assert.equal(violation(DRAFT_JSON_SCHEMA, DRAFT), null);
  const bound = (min) => ({ ...DRAFT, fields: [{ name: 'weight', kind: 'number', min, max: 100 }, DRAFT.fields[1]] });
  assert.match(violation(DRAFT_JSON_SCHEMA, bound(-5)), /\$\.fields\[0\]\.min: below 0/);
  assert.match(violation(DRAFT_JSON_SCHEMA, bound(0.5)), /\$\.fields\[0\]\.min/);
  assert.match(violation(DRAFT_JSON_SCHEMA, { ...DRAFT, outcomes: ['a', 'b'] }), /\$\.outcomes: not a member/);
  assert.match(violation(DRAFT_JSON_SCHEMA, { ...DRAFT, rules: [{ ...DRAFT.rules[0], because: 'x' }] }), /\$\.rules\[0\]\.because: not a member/);
  const { otherwise, ...without } = DRAFT;
  assert.match(violation(DRAFT_JSON_SCHEMA, without), /otherwise is required/);
  // Whatever satisfies the draft schema and names its own fields and choices is a draft Prism completes.
  assert.equal(checkSpec(DRAFT).ok, true);
});

test('every fixture spec satisfies the full schema, as written and as stored, and an unknown key is rejected', () => {
  const names = readdirSync(SPECS).filter((n) => n.endsWith('.json'));
  assert.ok(names.includes('payment-approval.spec.json') && names.length >= 3);
  for (const name of names) {
    const raw = fixture(name);
    const completed = completeSpec(name.endsWith('.recorded.json') ? { ...raw, properties: raw.properties.slice(0, 2) } : raw).spec;
    assert.equal(violation(SPEC_JSON_SCHEMA, JSON.parse(canonicalJson(completed))), null, `${name}, as stored`);
    if (!isDraft(raw) && !name.endsWith('.recorded.json')) assert.equal(violation(SPEC_JSON_SCHEMA, raw), null, `${name}, as written`);
    assert.equal(violation(SPEC_JSON_SCHEMA, JSON.parse(canonicalJson(validateSpec(completed)))), null);
  }
  assert.match(violation(SPEC_JSON_SCHEMA, { ...FULL, colour: 'red' }), /\$\.colour: not a member/);
  assert.match(violation(SPEC_JSON_SCHEMA, { ...FULL, fields: [{ ...FULL.fields[0], unit: 'kg' }, ...FULL.fields.slice(1)] }), /\$\.fields\[0\]\.unit: not a member/);
  assert.match(violation(SPEC_JSON_SCHEMA, { ...FULL, schema: 'prism/spec/2' }), /\$\.schema/);
  assert.match(violation(SPEC_JSON_SCHEMA, DRAFT), /purpose is required/, 'a draft is not a whole spec');
  // What the schema allows and the strict reader allows are the same members.
  for (const key of Object.keys(SPEC_JSON_SCHEMA.properties)) assert.doesNotThrow(() => readSpecFile({ ...FULL, [key]: completeSpec(FULL).spec[key] ?? (key === 'limits' ? ['x'] : key === 'meanings' ? {} : key === 'otherwiseWhy' ? 'y' : FULL[key]) }), key);
});

// ---------------------------------------------------------------------------
// The journey
// ---------------------------------------------------------------------------

/**
 * A spec without the sentence each rule and guarantee says. The session keeps a spec as its answers
 * (session.mjs), so the sentence it stores is the answer line, where `validateSpec` writes a
 * description; that is how prism_spec has stored every spec, and it changes no answer and no proof.
 */
const unsaid = (spec) => ({ ...spec, rules: spec.rules.map(({ says, ...r }) => r), properties: spec.properties.map(({ says, ...p }) => p) });
const storedSpec = (root) => readFileSync(join(root, 'prism', 'spec.json'), 'utf8');

function mcp(cwd) {
  const sent = [];
  const server = createServer({ cwd, send: (m) => sent.push(m) });
  let id = 0;
  return {
    async tool(name, args = {}) {
      const n = ++id;
      await server.handle({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } });
      return sent.find((m) => m.id === n).result;
    },
  };
}

test('the review shows proposed guarantees first, as proposed', () => {
  const stated = { kind: 'never', when: [when('weight', '=', 0)], then: 'freight', why: 'an empty parcel is never freight' };
  const { spec } = completeSpec({ ...DRAFT, properties: [stated] });
  const lines = summary(spec).split('\n');
  assert.equal(lines[0], 'Shipping Tier: Decides freight, express or standard from weight and destination.');
  assert.equal(lines[1], 'INV-002, proposed by Prism from REQ-001: always freight when weight is above 30 (strike it if it is wrong; to be proved)');
  assert.match(lines[2], /^INV-003, proposed by Prism: never standard when destination is worldwide \(strike it if it is wrong; to be proved\)$/);
  assert.equal(lines[3], 'INV-001: never freight when weight equals 0, because an empty parcel is never freight (to be proved)');
});

test('prism_spec takes a draft, completes it, and stores the completed spec', async () => {
  const root = scratch();
  const s = mcp(root);
  const r = (await s.tool('prism_spec', { spec: copy(DRAFT) })).structuredContent;
  assert.equal(r.step, 'review');
  assert.deepEqual(r.proposed, ['INV-001', 'INV-002']);
  assert.match(r.summary, /INV-001, proposed by Prism from REQ-001/);
  assert.match(r.notes.join(' '), /Prism proposed from the rules, not something the user said/);
  assert.equal(r.repair, undefined);
  const stored = storedSpec(root);
  assert.deepEqual(unsaid(JSON.parse(stored)), unsaid(JSON.parse(canonicalJson(completeSpec(DRAFT).spec))), 'spec.json is the completed spec');
  assert.equal(readSpecFile(stored).text, stored, 'kept as canonical JSON, and whole: reading it changes nothing');
  assert.equal(isDraft(JSON.parse(stored)), false);
  // Approved and written, the model's seal is the address of that file.
  assert.equal((await s.tool('prism_answer', { answer: 'yes' })).structuredContent.step, 'ready');
  const read = (await s.tool('prism_spec')).structuredContent;
  assert.equal(canonicalJson(read.spec), stored);
  const session = readSession(join(root, 'prism'));
  const { model } = writeApp(join(root, 'prism'), session, { overwrite: true });
  assert.equal(storedSpec(root), stored, 'writing the app does not change spec.json');
  assert.equal(SPEC_SEAL_MARK.exec(model)[1], kappa(new TextEncoder().encode(stored)));
});

test('prism_spec says how to repair a draft whose own guarantee the rules break, and proposes nothing for it', async () => {
  const s = mcp(scratch());
  const r = await s.tool('prism_spec', { spec: copy(RECORDED) });
  assert.equal(r.structuredContent.step, 'properties');
  assert.match(r.structuredContent.issue, /does not hold/);
  assert.match(r.structuredContent.repair, /The guarantee \{"kind":"always","when":\[\{"field":"weight","op":"=","value":0\}\],"then":"standard"\} is false/);
  assert.equal(r.structuredContent.proposed, undefined);
  assert.equal(r.structuredContent.notes.filter((n) => /^Dropped/.test(n)).length, 3);
  const mended = copy(RECORDED);
  mended.properties.pop();
  const ok = (await s.tool('prism_spec', { spec: mended })).structuredContent;
  assert.equal(ok.step, 'review');
  assert.ok(ok.proposed.length >= 1);
});

test('prism_spec takes a whole spec as written: nothing is proposed, so a struck guarantee stays struck', async () => {
  const root = scratch();
  const s = mcp(root);
  await s.tool('prism_spec', { spec: copy(DRAFT) });
  const stored = JSON.parse(readFileSync(join(root, 'prism', 'spec.json'), 'utf8'));
  const struck = { ...stored, properties: stored.properties.slice(1) };
  const r = (await s.tool('prism_spec', { spec: struck })).structuredContent;
  assert.equal(r.step, 'review');
  const after = JSON.parse(readFileSync(join(root, 'prism', 'spec.json'), 'utf8'));
  assert.equal(after.properties.length, 1);
  assert.equal(after.properties[0].then, 'standard');
  const whole = (await mcp(scratch()).tool('prism_spec', { spec: copy(FULL) })).structuredContent;
  assert.deepEqual([whole.step, whole.proposed], ['review', undefined]);
});

test('a draft written to prism/spec.json is completed when Prism reads it', async () => {
  const root = scratch();
  mkdirSync(join(root, 'prism'), { recursive: true });
  writeFileSync(join(root, 'prism', 'spec.json'), JSON.stringify(DRAFT, null, 2));
  const s = mcp(root);
  const start = (await s.tool('prism_start')).structuredContent;
  assert.equal(start.step, 'review');
  assert.match(start.note, /spec\.json held a draft; Prism completed it/);
  assert.deepEqual(start.proposed, ['INV-001', 'INV-002']);
  assert.deepEqual(unsaid(JSON.parse(storedSpec(root))), unsaid(JSON.parse(canonicalJson(completeSpec(DRAFT).spec))), 'spec.json now holds the completed spec');
  // Read again, it is a whole spec: nothing is completed twice.
  assert.equal((await mcp(root).tool('prism_start')).structuredContent.note, undefined);
  // A draft that is not a spec even so is refused in the checker's words, not for what a draft may leave out.
  const bad = scratch();
  mkdirSync(join(bad, 'prism'), { recursive: true });
  writeFileSync(join(bad, 'prism', 'spec.json'), JSON.stringify({ ...DRAFT, rules: [{ when: [when('height', '>', 3)], then: 'freight' }] }));
  assert.equal((await mcp(bad).tool('prism_start')).structuredContent.issue.rule, 'condition.unknown-field');
});
