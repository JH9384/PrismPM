// WORLDS (issue #278, docs/proposals/278-wit-world.md): the registry agrees with the WIT file, the lock and the reference guest.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { blake3Hex } from '../../prism-code/src/blake3.mjs';
import { spec } from './spec.mjs';
import { here, loadReference, readJson, wasmExports } from './reference.mjs';

const world = spec.WORLDS[spec.CORE_WASM.CONTRACT];
const ref = loadReference();
// The digests name the committed bytes; a Windows checkout may have rewritten LF to CRLF.
const witText = readFileSync(here(`../${world.file}`), 'utf8').replaceAll('\r\n', '\n');
const witBytes = new Uint8Array(Buffer.from(witText, 'utf8'));

test('every guest contract of a format revision has a world', () => {
  for (const revision of Object.values(spec.FORMAT_REVISIONS)) assert.ok(spec.WORLDS[revision.coreWasmContract], revision.coreWasmContract);
  for (const contract of Object.keys(spec.WORLDS)) assert.match(contract, /^[a-z]+:[a-z]+\/[a-z-]+@[1-9][0-9]*$/);
});

test('a world row is deeply frozen data', () => {
  const frozen = (value) => {
    assert.ok(Object.isFrozen(value));
    for (const child of Object.values(value)) if (child !== null && typeof child === 'object') frozen(child);
  };
  frozen(spec.WORLDS);
});

test('the registry digests are the digests of the WIT file', () => {
  assert.equal(world.digest.sha256, createHash('sha256').update(witBytes).digest('hex'));
  assert.equal(world.digest.blake3, blake3Hex(witBytes));
});

test('the registry digests equal inputs.world of the lock fixture', () => {
  const lock = readJson('fixtures/documents/sdk-lock-v3/calculator.json');
  assert.deepEqual(lock.inputs.world, { ...world.digest, contract: spec.CORE_WASM.CONTRACT });
});

test('the registry names the WIT package and world', () => {
  assert.match(witText, new RegExp(`^package ${world.package.replace(/[.@]/g, '\\$&')};$`, 'm'));
  assert.match(witText, new RegExp(`^world ${world.world} \\{$`, 'm'));
});

test('the registry exports are the exports the WIT file declares, lowered', () => {
  const LOWER = { u32: 'i32', u64: 'i64' };
  const declared = [...witText.matchAll(/^\s*export ([a-z-]+): func\(([^)]*)\) -> (u32|u64);$/gm)].map(([, name, params, result]) => ({
    name: name.replaceAll('-', '_'),
    kind: 'func',
    params: params.split(',').map((p) => LOWER[p.split(':')[1].trim()]),
    results: [LOWER[result]],
  }));
  assert.deepEqual(world.exports.filter((e) => e.kind === 'func'), declared);
  assert.deepEqual(world.exports.filter((e) => e.kind !== 'func'), [{ name: 'memory', kind: 'memory' }]);
  assert.equal(world.imports.length, 0);
  assert.doesNotMatch(witText, /^\s*import /m, 'the world must declare no imports');
});

test('the registry is what the reference guest has', () => {
  // wasmExports throws on an import section, so reaching here means the guest imports nothing.
  const actual = wasmExports(ref.guest);
  const byName = (a, b) => a.name.localeCompare(b.name);
  assert.deepEqual([...actual].sort(byName), [...world.exports].map((e) => ({ ...e })).sort(byName));
});

test('CORE_WASM agrees with the registry row', () => {
  assert.equal(spec.CORE_WASM.WORLD, world.file);
  assert.deepEqual([...spec.CORE_WASM.EXPORTS], world.exports.map((e) => e.name));
});

test('every import of every world names the capability kind it uses (#279, #283)', () => {
  // core-wasm@1 imports nothing. A world with imports must say which capability kind grants each one, or no set can.
  const KINDS = ['outbound-hosts', 'key-value-stores', 'variables'];
  for (const [contract, row] of Object.entries(spec.WORLDS)) {
    for (const entry of row.imports) assert.ok(KINDS.includes(entry.capability), `${contract} imports ${entry.module}.${entry.name} with no capability kind`);
  }
});
