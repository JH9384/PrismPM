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

// The session world (issue #629, docs/proposals/629-session-world.md): a new contract, a new file, a new row; @1 is untouched.
const SESSION = spec.CORE_WASM_SESSION.CONTRACT;
const LOWER = { u32: 'i32', u64: 'i64' };
const witOf = (row) => readFileSync(here(`../${row.file}`), 'utf8').replaceAll('\r\n', '\n');
const declaredExports = (text) =>
  [...text.matchAll(/^\s*export ([a-z-]+): func\(([^)]*)\) -> (u32|u64);$/gm)].map(([, name, params, result]) => ({
    name: name.replaceAll('-', '_'),
    kind: 'func',
    params: params.split(',').map((p) => LOWER[p.split(':')[1].trim()]),
    results: [LOWER[result]],
  }));

test('the session world has its own row, file, package and digests, all distinct from @1', () => {
  const row = spec.WORLDS[SESSION];
  assert.ok(row, `${SESSION} has no row`);
  assert.equal(row.file, spec.CORE_WASM_SESSION.WORLD);
  assert.notEqual(row.file, world.file);
  assert.equal(row.package, 'hologram:guest@2.0.0');
  const text = witOf(row);
  const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
  assert.equal(row.digest.sha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(row.digest.blake3, blake3Hex(bytes));
  assert.notEqual(row.digest.sha256, world.digest.sha256);
  assert.match(text, /^package hologram:guest@2\.0\.0;$/m);
  assert.match(text, /^world core-wasm \{$/m);
});

test('the session world exports holo_alloc, holo_step and memory, imports nothing, and has no holo_run', () => {
  const row = spec.WORLDS[SESSION];
  const text = witOf(row);
  assert.deepEqual(row.exports.filter((e) => e.kind === 'func'), declaredExports(text));
  assert.deepEqual(row.exports.map((e) => e.name), [...spec.CORE_WASM_SESSION.EXPORTS]);
  assert.deepEqual(row.imports, []);
  assert.doesNotMatch(text, /^\s*import /m);
  // A @1 reader must refuse a @2 guest by its exports, never run a step as a stateless request.
  assert.ok(!row.exports.some((e) => e.name === spec.CORE_WASM.ENTRY));
  assert.ok(!world.exports.some((e) => e.name === spec.CORE_WASM_SESSION.ENTRY));
});

test('the @1 row is unchanged by the session world', () => {
  assert.deepEqual(world.digest, {
    blake3: '0774a8ecbfa945a427712ee7d7ad406195b2d07492ceae15cca0067276c9ced8',
    sha256: 'a566c87a359cadf98f652747f1b3574aa307ff5f652a190c6d99c350db9cf369',
  });
  assert.equal(spec.FORMAT_REVISIONS['2026-10-23'].coreWasmContract, spec.CORE_WASM.CONTRACT);
});
