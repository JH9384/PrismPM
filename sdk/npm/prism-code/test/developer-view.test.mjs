// The developer view of #346 on this package (#347): developer-surface.json is the
// surface `cargo xtask check-developer-view` checks against the glossary model, and
// these tests keep it equal to the CLI help and the client.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPrism } from '../src/index.mjs';
import { DELEGATED } from '../src/docker.mjs';
import { GROUPS, MODULE_ALIASES } from '../src/cli/index.mjs';
import { ALIASES, SURFACE_SCHEMA, aliasWarning, developerSurface, resolveAliases } from '../src/developer-view.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const file = fileURLToPath(new URL('../developer-surface.json', import.meta.url));

// Only node on the PATH, so no prism-<plugin> adds to the help.
const help = () => {
  const r = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', env: { PATH: dirname(process.execPath) } });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};

const surface = () => developerSurface({ usage: help(), client: createPrism(), delegated: Object.keys(DELEGATED), groups: Object.keys(GROUPS), moduleAliases: Object.keys(MODULE_ALIASES) });

test('developer-surface.json is the CLI help, the delegated verbs and the client, as the glossary check reads them', () => {
  const text = `${JSON.stringify(surface(), null, 2)}\n`;
  if (process.env.PRISM_CODE_UPDATE_GOLDEN) writeFileSync(file, text);
  assert.equal(readFileSync(file, 'utf8'), text, 'run PRISM_CODE_UPDATE_GOLDEN=1 node --test test/developer-view.test.mjs, then cargo xtask check-developer-view');
});

test('the surface names each verb, flag, namespace and method once, and keeps no renamed term', () => {
  const { schema, names, aliases } = surface();
  assert.equal(schema, SURFACE_SCHEMA);
  const places = names.map((entry) => `${entry.kind} ${entry.place}`);
  assert.deepEqual(places, [...new Set(places)]);
  for (const kind of ['verb', 'flag', 'namespace', 'method']) assert.ok(names.some((entry) => entry.kind === kind), kind);
  for (const alias of aliases) {
    assert.ok(names.some((entry) => entry.kind === alias.kind && entry.name === alias.target), `${alias.name} names ${alias.target}`);
    assert.ok(!names.some((entry) => entry.kind === alias.kind && entry.name === alias.name), `${alias.name} is gone from the help`);
  }
  // The members of errors and verify keep the model's names, so only the namespaces are listed.
  assert.ok(names.some((entry) => entry.place === 'prism.verify'));
  assert.ok(!names.some((entry) => entry.place.startsWith('prism.verify.') || entry.place.startsWith('prism.errors.')));
});

test('resolveAliases replaces each alias with its new term and warns once for each', () => {
  const warnings = [];
  const argv = resolveAliases(['history', 'a.holo', '--holo', 'x', '--holo=y', '--', '--holo'], (w) => warnings.push(w));
  assert.deepEqual(argv, ['record', 'a.holo', '--image', 'x', '--image=y', '--', '--holo']);
  assert.deepEqual(warnings, ALIASES.map(aliasWarning));
  assert.equal(aliasWarning(ALIASES[1]), 'prism-code: --holo is deprecated and is removed in prism-code 0.9.0; use --image');
});

test('a verb prism-code hands to prismpm or a plugin keeps its own flags', () => {
  const warnings = [];
  const argv = ['lock', 'update', '--holo', 'a.holo'];
  assert.deepEqual(resolveAliases(argv, (w) => warnings.push(w), (verb) => verb !== 'lock'), argv);
  assert.deepEqual(warnings, []);
});

test('without an alias there is no warning, and history is a verb only in the first place', () => {
  const warnings = [];
  const argv = ['record', 'history', '--image', 'a.holo'];
  assert.deepEqual(resolveAliases(argv, (w) => warnings.push(w)), argv);
  assert.deepEqual(warnings, []);
});
