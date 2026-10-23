// Assurance levels are totally ordered, a verdict's level is the highest one no reason withholds,
// and the verdict schema rejects unknown levels and self-contradicting verdicts.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { ASSURANCE as FROM_MODULE } from '../assurance-levels.mjs';
import { ASSURANCE, PROOF_PREDICATE_TYPE, REPLAY_PREDICATE_TYPE } from '../index.mjs';
import { validate } from './json-schema.mjs';
import { here, readJson, schema } from './reference.mjs';

const verdictSchema = schema(ASSURANCE.VERDICT_SCHEMA);
const { LEVELS, RANK } = ASSURANCE;
const fixtures = readdirSync(here('fixtures/verdict/'))
  .filter((name) => name.endsWith('.json'))
  .sort()
  .map((name) => [name, readJson(`fixtures/verdict/${name}`)]);
const copy = (value) => JSON.parse(JSON.stringify(value));
const accepts = (value, why) => assert.deepEqual(validate(verdictSchema, value), [], `rejected ${why}`);
const rejects = (value, why) => assert.notDeepEqual(validate(verdictSchema, value), [], `accepted ${why}`);

test('index.mjs re-exports the module constant itself', () => {
  assert.equal(ASSURANCE, FROM_MODULE);
});

test('levels are ordered P0 < P1 < P2 < P3 and the rank is the index', () => {
  assert.deepEqual(LEVELS, ['P0', 'P1', 'P2', 'P3']);
  assert.deepEqual(Object.keys(RANK), LEVELS);
  LEVELS.forEach((level, i) => assert.equal(RANK[level], i, level));
  assert.deepEqual(['P3', 'P0', 'P2', 'P1'].sort((a, b) => RANK[a] - RANK[b]), LEVELS);
});

test('every level is named and each piece of evidence is added by exactly one level', () => {
  assert.deepEqual(Object.keys(ASSURANCE.NAMES), LEVELS);
  assert.deepEqual(Object.keys(ASSURANCE.ADDS), LEVELS);
  assert.deepEqual(ASSURANCE.ADDS.P0, [], 'P0 requires nothing');
  const evidence = LEVELS.flatMap((level) => ASSURANCE.ADDS[level]);
  assert.equal(new Set(evidence).size, evidence.length);
  for (const kind of Object.keys(ASSURANCE.PREDICATES)) assert.ok(evidence.includes(kind), kind);
  assert.equal(ASSURANCE.PREDICATES.proof, PROOF_PREDICATE_TYPE);
  assert.equal(ASSURANCE.PREDICATES.replay, REPLAY_PREDICATE_TYPE);
});

test('the default policy is P2 or above, and the exit codes are 0, 1 and 2', () => {
  assert.equal(ASSURANCE.DEFAULT_MINIMUM, 'P2');
  assert.deepEqual(ASSURANCE.EXIT, { PASSED: 0, FAILED: 1, NO_VERDICT: 2 });
});

test('the verdict schema names its document and its level set is LEVELS', () => {
  assert.equal(verdictSchema.properties.schema.const, ASSURANCE.VERDICT);
  assert.deepEqual(verdictSchema.$defs.level.enum, LEVELS);
  assert.deepEqual(verdictSchema.$defs.reason.properties.withholds.enum, [...LEVELS.slice(1), null]);
});

test('the Verdict type and the schema name the same members', () => {
  const types = readFileSync(here('../assurance-levels.d.ts'), 'utf8').replace(/\r\n/g, '\n');
  const members = (name) => {
    const body = new RegExp(`export interface ${name} \\{([\\s\\S]*?)\\n\\}`).exec(types)[1];
    return [...body.matchAll(/^ {2}([a-z]+)\??:/gm)].map((m) => m[1]).sort();
  };
  assert.deepEqual(members('Verdict'), Object.keys(verdictSchema.properties).sort());
  assert.deepEqual(members('VerdictReason'), Object.keys(verdictSchema.$defs.reason.properties).sort());
  assert.ok(types.includes(`AssuranceLevel = ${LEVELS.map((l) => `'${l}'`).join(' | ')};`));
});

test('every verdict fixture validates and obeys the level rule', () => {
  assert.ok(fixtures.length >= 4);
  for (const [name, verdict] of fixtures) {
    accepts(verdict, name);
    const withheld = verdict.reasons.map((r) => r.withholds).filter(Boolean).map((l) => RANK[l]);
    const computed = LEVELS[Math.min(LEVELS.length, ...withheld) - 1];
    assert.equal(verdict.level, computed, `${name}: the level is the highest one no reason withholds`);
    if (verdict.passed) assert.ok(RANK[verdict.level] >= RANK[verdict.policy.minimum], `${name} passed below its minimum`);
  }
});

test('a failing policy still reports the level the evidence reached', () => {
  const failed = readJson('fixtures/verdict/calculator-p2-world-failed.json');
  assert.equal(failed.passed, false);
  assert.equal(failed.level, 'P2');
});

test('an unknown level fails', () => {
  const base = readJson('fixtures/verdict/calculator-p2-passed.json');
  rejects({ ...base, level: 'P4' }, 'level P4');
  rejects({ ...base, level: 'p2' }, 'a lowercase level');
  rejects({ ...base, level: 2 }, 'a numeric level');
  rejects({ ...base, policy: { name: 'default', minimum: 'L2' } }, 'a SLSA level as the minimum');
  const reason = copy(base);
  reason.reasons[0].withholds = 'P0';
  rejects(reason, 'a reason that withholds P0');
});

test('a self-contradicting verdict fails', () => {
  const base = readJson('fixtures/verdict/calculator-p2-passed.json');
  rejects({ ...base, level: 'P1' }, 'P1 with no reason withholding P2');
  rejects({ ...base, level: 'P3' }, 'P3 with a reason withholding P3');
  rejects({ ...base, reasons: [] }, 'P2 with no reason withholding P3');
  rejects({ ...base, level: 'P0', passed: false, reasons: [] }, 'P0 with no reason at all');
  rejects({ ...base, policy: { name: 'strict', minimum: 'P3' } }, 'a pass below the policy minimum');
  accepts({ ...base, policy: { name: 'strict', minimum: 'P3' }, passed: false }, 'a fail below the policy minimum');
  accepts({ ...base, level: 'P3', reasons: [] }, 'P3 with no reasons');
  accepts({ ...base, level: 'P3', passed: false, reasons: [{ check: 'policy.signer', withholds: null, message: 'x' }] }, 'P3 failing on policy alone');
});

test('the verdict is closed: unknown members and malformed reasons fail', () => {
  const base = readJson('fixtures/verdict/calculator-p2-passed.json');
  rejects({ ...base, verdict: 'pass' }, 'an extra member');
  rejects({ ...base, schema: 'prism/verdict/2' }, 'another schema name');
  rejects({ ...base, holo: 'sha256:00' }, 'a non-blake3 holo');
  const { passed: _passed, ...missing } = base;
  rejects(missing, 'no passed member');
  const bad = copy(base);
  bad.reasons[0].check = 'ProofMismatch';
  rejects(bad, 'a check name that is not a dotted id');
  bad.reasons[0] = { check: 'proof.subject', code: '5503', withholds: 'P3', message: 'x' };
  rejects(bad, 'a code without the PP prefix');
});
