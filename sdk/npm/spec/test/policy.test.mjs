// The policy file's data (issue #285): the shipped policies, reachable by name, and the rule that no document in this
// package can carry a policy. The schema's fixtures are checked with every other schema's in schemas.test.mjs.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { spec } from './spec.mjs';
import { validate } from './json-schema.mjs';
import { here, readJson, schema } from './reference.mjs';

const { POLICY, ASSURANCE } = spec;

test('POLICY names the schema of the input document, and the schema fixes that name', () => {
  assert.equal(POLICY.INPUT, 'prism/policy-input/1');
  const input = schema(POLICY.INPUT_SCHEMA);
  assert.equal(input.properties.schema.const, POLICY.INPUT);
  assert.equal(input.$id, `https://schemas.uor.foundation/${POLICY.INPUT}`);
});

test('every shipped policy is a file reachable through the exports map, in the package a policy must declare', () => {
  const pkg = readJson('../package.json');
  assert.ok(pkg.files.includes('policies'));
  const names = Object.keys(POLICY.SHIPPED);
  assert.deepEqual(names, ['default', 'pure-only', 'provenance-only']);
  assert.equal(names[0], ASSURANCE.DEFAULT_POLICY);
  assert.deepEqual(readdirSync(here('../policies/')).sort(), Object.values(POLICY.SHIPPED).map((p) => p.replace('policies/', '')).sort());
  for (const path of Object.values(POLICY.SHIPPED)) {
    const url = import.meta.resolve(`${pkg.name}/${path}`);
    assert.ok(existsSync(fileURLToPath(url)), path);
    assert.match(readFileSync(fileURLToPath(url), 'utf8'), new RegExp(`^package ${POLICY.PACKAGE.replace('.', '\\.')}$`, 'm'), path);
  }
});

test('the default policy states the default minimum the assurance constants name', () => {
  const source = readFileSync(here(`../${POLICY.SHIPPED.default}`), 'utf8');
  assert.match(source, new RegExp(`^minimum := "${ASSURANCE.DEFAULT_MINIMUM}"$`, 'm'));
});

test('a policy input cannot carry a policy, and neither can a holo section the spec describes', () => {
  const input = schema(POLICY.INPUT_SCHEMA);
  const instance = readJson('fixtures/policy/policy-input-v1/calculator-p0.json');
  assert.deepEqual(validate(input, instance), []);
  assert.ok(validate(input, { ...instance, policy: { minimum: 'P0' } }).length > 0);
  for (const revision of Object.values(spec.FORMAT_REVISIONS)) {
    assert.ok(!revision.extensions.some((name) => /policy/i.test(name)), 'no format revision has a policy extension');
  }
});
