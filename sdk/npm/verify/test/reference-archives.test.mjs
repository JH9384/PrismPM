// The reference archives (#278): Calculator and Payment Approval, judged alike.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { verify, inspect, ASSURANCE } from '../src/index.mjs';
import { here, REFERENCE_ARCHIVES, archive, assertVerdict } from './helpers.mjs';

const plain = (value) => JSON.parse(JSON.stringify(value));
const golden = (name) => JSON.parse(readFileSync(here(`fixtures/${name}.inspect.json`), 'utf8'));

test('there are two reference archives', () => {
  assert.deepEqual(Object.keys(REFERENCE_ARCHIVES).sort(), ['Calculator', 'PaymentApproval']);
});

for (const name of Object.keys(REFERENCE_ARCHIVES)) {
  test(`${name} inspects to the golden prism-code prints, with the core-wasm world and a conforming guest`, () => {
    const inspection = inspect(archive(name));
    assert.deepEqual(plain(inspection), golden(name));
    assert.equal(inspection.model.name, name);
    assert.equal(inspection.world.contract, 'hologram:guest/core-wasm@1');
    assert.equal(inspection.world.conforms, true);
    assert.equal(inspection.world.capability_set.empty, true);
    assert.deepEqual(inspection.verification, { footer: true, labels: true, cross_references: true });
  });
}

test('both reference archives verify to the same level, for the same reasons', async () => {
  const verdicts = await Promise.all(Object.keys(REFERENCE_ARCHIVES).map((name) => verify(archive(name))));
  for (const verdict of verdicts) assertVerdict(verdict);
  const [first, ...rest] = verdicts;
  for (const other of rest) {
    assert.equal(other.level, first.level);
    assert.deepEqual(other.passed, first.passed);
    assert.deepEqual(other.reasons.map((r) => [r.check, r.withholds]), first.reasons.map((r) => [r.check, r.withholds]));
  }
  for (const name of Object.keys(REFERENCE_ARCHIVES)) {
    const verdict = await verify(archive(name), { name: 'p0', minimum: 'P0' });
    assert.equal(verdict.passed, true, name);
    assert.deepEqual(verdict.policy, { name: 'p0', minimum: 'P0' });
    assert.ok(ASSURANCE.LEVELS.includes(verdict.level));
  }
});
