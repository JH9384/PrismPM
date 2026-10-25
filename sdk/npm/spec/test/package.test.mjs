// The package holds data only, depends on nothing, and its generated entry point matches its files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { discover, pascal } from '../scripts/discover.mjs';
import { render } from '../scripts/build.mjs';
import { spec } from './spec.mjs';
import { here, readJson } from './reference.mjs';

function assertData(value, path) {
  assert.notEqual(typeof value, 'function', `${path} is a function`);
  if (value !== null && typeof value === 'object') {
    assert.ok(Object.isFrozen(value), `${path} is not frozen`);
    for (const [key, inner] of Object.entries(value)) assertData(inner, `${path}.${key}`);
  }
}

test('the entry point exports frozen data only', () => {
  for (const [name, value] of Object.entries(spec)) assertData(value, name);
});

test('constants.mjs imports nothing, and the generated index.mjs only re-exports it', () => {
  const constants = readFileSync(here('../constants.mjs'), 'utf8');
  assert.doesNotMatch(constants, /^\s*import\b|\bimport\(|\brequire\(/m);
  const index = readFileSync(here('../index.mjs'), 'utf8');
  assert.doesNotMatch(index, /^\s*import\b|\bimport\(|\brequire\(/m);
  assert.deepEqual([...index.matchAll(/^export \* from '([^']+)';$/gm)].map((m) => m[1]), ['./constants.mjs']);
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
  const declared = [];
  for (const file of ['constants.d.ts', 'index.d.ts']) {
    const types = readFileSync(here(`../${file}`), 'utf8');
    declared.push(
      ...[...types.matchAll(/^export declare const ([A-Z_]+)/gm)].map((m) => m[1]),
      ...[...types.matchAll(/^export \{ ([A-Z_]+) \} from/gm)].map((m) => m[1]),
    );
  }
  assert.deepEqual(declared.sort(), Object.keys(spec).sort());
});

test('FORMAT_REVISION is a date and every revision is listed', () => {
  assert.match(spec.FORMAT_REVISION, /^\d{4}-\d{2}-\d{2}$/);
  assert.ok(spec.FORMAT_REVISION in spec.FORMAT_REVISIONS);
  for (const revision of Object.keys(spec.FORMAT_REVISIONS)) assert.match(revision, /^\d{4}-\d{2}-\d{2}$/);
  assert.match(readFileSync(here('../types/holo.d.ts'), 'utf8'), new RegExp(`FormatRevision = '${spec.FORMAT_REVISION}'`));
});

test('the generated files are what the build would write today', () => {
  for (const [rel, text] of render()) {
    assert.equal(readFileSync(here(`../${rel}`), 'utf8').replace(/\r\n/g, '\n'), text, `${rel} is stale; run npm run build`);
  }
});

test('the generated types name every holo and document schema, and a union for each document family', () => {
  const found = discover();
  const documents = readFileSync(here('../types/documents.d.ts'), 'utf8');
  for (const s of [...found.holo.map((h) => `Holo${pascal(h.path.split('/').pop().replace('.schema.json', ''))}`), ...found.documents.map((d) => d.type)]) {
    assert.match(documents, new RegExp(`^export type ${s} =`, 'm'), s);
  }
  const index = readFileSync(here('../index.d.ts'), 'utf8');
  for (const family of found.families) assert.ok(index.includes(`export type ${family.type} = ${family.members.join(' | ')};`), family.type);
});
