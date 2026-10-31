// The replay statement checks (issue #284, src/statements.mjs) against the reference archive and the spec's
// calculator statement: a statement that holds supports P3, and a changed model cannot reach it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { checkReplayStatement, REPLAY_CODES } from '../src/statements.mjs';
import { levelOf } from '../src/level.mjs';
import { here, ADR_015 } from './helpers.mjs';

const STATEMENT = JSON.parse(readFileSync(here('../../spec/test/fixtures/attestation/statement/calculator-replay.json'), 'utf8'));
const SIGNED = { verified: true };
const HOLO = Object.freeze({ guest: ADR_015.guest, model: ADR_015.model });
const CHANGED = Object.freeze({ guest: { sha256: 'a'.repeat(64), blake3: 'b'.repeat(64) }, model: { sha256: 'c'.repeat(64), blake3: 'd'.repeat(64) } });

const statement = (edit = () => {}) => {
  const copy = structuredClone(STATEMENT);
  edit(copy);
  return copy;
};
const checks = (reasons) => reasons.map((r) => r.check);

test('the calculator statement supports P3 for the reference archive: every lower level assumed, it leaves no reason', () => {
  const reasons = checkReplayStatement(STATEMENT, HOLO, SIGNED);
  assert.deepEqual(reasons, []);
  assert.equal(levelOf(reasons), 'P3');
});

test('a changed model cannot reach P3: the statement of the old build fails replay.subject and replay.model', () => {
  const reasons = checkReplayStatement(STATEMENT, CHANGED, SIGNED);
  assert.deepEqual(checks(reasons), ['replay.subject', 'replay.model']);
  assert.deepEqual(reasons.map((r) => r.code), ['PP5704', 'PP5705']);
  assert.ok(reasons.every((r) => r.withholds === 'P3'));
  assert.equal(levelOf(reasons), 'P2');
});

test('a statement that records a divergence fails replay.divergence with PP5701, even for its own build', () => {
  const diverged = statement((s) => {
    s.predicate.histories[0].divergences = 7;
    s.predicate.divergenceCount = 7;
  });
  const reasons = checkReplayStatement(diverged, HOLO, SIGNED);
  assert.deepEqual(checks(reasons), ['replay.divergence']);
  assert.equal(reasons[0].code, 'PP5701');
  assert.equal(reasons[0].withholds, 'P3');
  assert.match(reasons[0].message, /7 divergences/);
  assert.equal(levelOf(reasons), 'P2');
});

test('a count that disagrees with its histories is a shape failure, so zero cannot be claimed over a divergence', () => {
  const lying = statement((s) => {
    s.predicate.histories[0].divergences = 7;
    s.predicate.divergenceCount = 0;
  });
  assert.deepEqual(checks(checkReplayStatement(lying, HOLO, SIGNED)), ['replay.statement']);
});

test('a statement of the wrong shape fails replay.statement and nothing after it', () => {
  const cases = [
    (s) => (s.predicateType = 'https://uor.foundation/prism/proof/v1'),
    (s) => (s._type = 'https://in-toto.io/Statement/v0.1'),
    (s) => s.subject.push(s.subject[0]),
    (s) => (s.predicate.histories = []),
    (s) => delete s.predicate.runtime,
    (s) => delete s.predicate.histories[0].digest.sha256,
    (s) => (s.predicate.level = 'P3'),
  ];
  for (const edit of cases) {
    const reasons = checkReplayStatement(statement(edit), { guest: null, model: null }, SIGNED);
    assert.deepEqual(checks(reasons), ['replay.statement'], edit.toString());
    assert.equal(reasons[0].code, 'PP5703');
  }
  assert.deepEqual(checks(checkReplayStatement(null, HOLO, SIGNED)), ['replay.statement']);
});

test('an unsigned statement fails replay.envelope, and the message is the caller\'s', () => {
  assert.deepEqual(checkReplayStatement(STATEMENT, HOLO, { verified: false, message: 'The signature is not valid.' }), [
    { check: 'replay.envelope', code: 'PP5702', withholds: 'P3', message: 'The signature is not valid.' },
  ]);
  assert.deepEqual(checks(checkReplayStatement(STATEMENT, HOLO, undefined)), ['replay.envelope']);
});

test('one digest of a pair is enough to fail, and each check has its own diagnostic', () => {
  const guest = { ...ADR_015.guest, sha256: '0'.repeat(64) };
  assert.deepEqual(checks(checkReplayStatement(STATEMENT, { ...HOLO, guest }, SIGNED)), ['replay.subject']);
  const model = { ...ADR_015.model, blake3: '0'.repeat(64) };
  assert.deepEqual(checks(checkReplayStatement(STATEMENT, { ...HOLO, model }, SIGNED)), ['replay.model']);
  assert.deepEqual(Object.values(REPLAY_CODES), ['PP5701', 'PP5702', 'PP5703', 'PP5704', 'PP5705']);
});

test('levelOf is the highest level no reason withholds', () => {
  assert.equal(levelOf([]), 'P3');
  assert.equal(levelOf([{ withholds: 'P3' }]), 'P2');
  assert.equal(levelOf([{ withholds: 'P3' }, { withholds: 'P1' }, { withholds: null }]), 'P0');
});
