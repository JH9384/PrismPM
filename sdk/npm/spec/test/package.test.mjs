// The package holds data only, depends on nothing, and its generated types are current.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import * as spec from '../index.mjs';
import { generate, OUTPUT } from '../scripts/generate-types.mjs';
import { here, readJson } from './reference.mjs';

function assertData(value, path) {
  assert.notEqual(typeof value, 'function', `${path} is a function`);
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value), `${path} is not frozen`);
    for (const [key, inner] of Object.entries(value)) assertData(inner, `${path}.${key}`);
  }
}

test('index.mjs exports frozen data only', () => {
  for (const [name, value] of Object.entries(spec)) assertData(value, name);
});

test('index.mjs imports nothing', () => {
  const source = readFileSync(here('../index.mjs'), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b|\bimport\(|\brequire\(/m);
});

test('package.json declares no dependencies of any kind', () => {
  const pkg = readJson('../package.json');
  for (const field of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies', 'bundleDependencies']) {
    assert.equal(pkg[field], undefined, field);
  }
  assert.equal(pkg.name, '@prism-code/spec');
  assert.equal(pkg.private, false);
});

test('every constant the types declare is exported, and nothing more', () => {
  const declared = [...readFileSync(here('../index.d.ts'), 'utf8').matchAll(/^export declare const ([A-Z_]+)/gm)].map((m) => m[1]);
  assert.deepEqual(declared.sort(), Object.keys(spec).sort());
});

test('FORMAT_REVISION is a date and every revision is listed', () => {
  assert.match(spec.FORMAT_REVISION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(spec.FORMAT_REVISION in spec.FORMAT_REVISIONS);
  for (const revision of Object.keys(spec.FORMAT_REVISIONS)) assert.match(revision, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(readFileSync(here('../types/holo.d.ts'), 'utf8'), new RegExp(`FormatRevision = '${spec.FORMAT_REVISION}'`));
});

test(`${OUTPUT} is generated from the current schemas`, () => {
  const current = readFileSync(here(`../${OUTPUT}`), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(current, generate(), `${OUTPUT} is stale; run node scripts/generate-types.mjs`);
});
