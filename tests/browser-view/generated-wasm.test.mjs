import assert from 'node:assert/strict';
import test from 'node:test';
import {chmodSync, linkSync, mkdirSync, mkdtempSync, readFileSync, rmSync,
  symlinkSync, truncateSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {captureGeneratedWasm, requireGeneratedWasm} from './generated-wasm.mjs';

// Valid custom section; payload changes retain a valid module, header and size.
const moduleBytes = Buffer.from([0, 97, 115, 109, 1, 0, 0, 0, 0, 3, 1, 120, 42]);
const changedModule = () => {const bytes = Buffer.from(moduleBytes); bytes[12] ^= 1; return bytes;};
function fixture(t, linked = false) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-artifact-test-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const generated = join(work, 'cargo'); mkdirSync(generated);
  const original = join(generated, 'probe.wasm'); writeFileSync(original, moduleBytes);
  if (linked) linkSync(original, join(generated, 'deps.wasm'));
  return {work, original};
}

test('capture retains original Cargo links but owns a distinct execution copy and immutable evidence', t => {
  const {work, original} = fixture(t, true), artifact = captureGeneratedWasm(work, original, 'execution');
  assert.equal(artifact.evidence.original.links, '2'); assert.equal(artifact.evidence.private.links, '1');
  assert.equal(artifact.run(bytes => WebAssembly.validate(bytes)), true);
  assert.equal(requireGeneratedWasm(artifact), artifact);
  assert.throws(() => requireGeneratedWasm({...artifact}), /actual captured/);
  assert.throws(() => {artifact.evidence.original.sha256 = '0'.repeat(64);}, TypeError);
  assert.throws(() => {artifact.bytes = Buffer.from(moduleBytes);}, TypeError);
  assert.throws(() => captureGeneratedWasm(work, original, 'execution'), /EEXIST/);
});

test('original, private output and exposed buffer substitution refuse before executing', t => {
  const {work, original} = fixture(t), artifact = captureGeneratedWasm(work, original, 'execution');
  for (const target of ['original', 'private', 'buffer']) {
    let called = false;
    const path = target === 'original' ? original : artifact.path;
    if (target !== 'buffer') chmodSync(path, 0o600);
    const changed = changedModule(); assert.equal(WebAssembly.validate(changed), true);
    if (target === 'buffer') artifact.bytes.set(changed);
    else writeFileSync(path, changed);
    assert.throws(() => artifact.run(() => {called = true;}),
      new RegExp('immutable ' + (target === 'buffer' ? 'execution Wasm buffer' : target + ' generated Wasm')));
    assert.equal(called, false, target + ' refused before any Wasm execution');
    if (target === 'buffer') artifact.bytes.set(moduleBytes);
    else writeFileSync(path, moduleBytes);
    artifact.verify();
  }
});

test('every execution verifies buffers afterward, including rejected asynchronous operations', async t => {
  const {work, original} = fixture(t), artifact = captureGeneratedWasm(work, original, 'execution');
  assert.throws(() => artifact.run(bytes => {bytes[12] ^= 1;}), /immutable execution/);
  artifact.bytes.set(moduleBytes);
  assert.throws(() => artifact.run(() => Promise.resolve()), /runAsync/);
  assert.equal(await artifact.runAsync(async bytes => WebAssembly.validate(bytes)), true);
  await assert.rejects(artifact.runAsync(async bytes => {
    await Promise.resolve(); bytes[12] ^= 1; throw new Error('execution failed');
  }), /immutable execution/);
  artifact.bytes.set(moduleBytes); artifact.verify();
});

test('new original/private aliases and changed original file identities refuse', t => {
  const {work, original} = fixture(t, true), artifact = captureGeneratedWasm(work, original, 'execution');
  for (const path of [original, artifact.path]) {
    const alias = join(work, 'alias'); linkSync(path, alias);
    assert.throws(() => artifact.verify(), /link count/); unlinkSync(alias); artifact.verify();
  }
  const copy = readFileSync(original); unlinkSync(original); writeFileSync(original, copy);
  linkSync(original, join(work, 'replacement-alias'));
  assert.throws(() => artifact.verify(), /immutable original/);
});

test('capture rejects symlinks, out-of-owner paths, invalid names, truncation and oversize before allocation', t => {
  const {work, original} = fixture(t), other = fixture(t);
  assert.throws(() => captureGeneratedWasm(work, other.original, 'execution'), /belongs to/);
  for (const name of ['../escape', 'UPPER', '', 'a'.repeat(97)])
    assert.throws(() => captureGeneratedWasm(work, original, name), /artifact name/);
  const alias = join(work, 'alias.wasm'); symlinkSync(original, alias);
  assert.throws(() => captureGeneratedWasm(work, alias, 'execution'), /unaliased/);
  for (const size of [0, 7, 67108865]) {
    truncateSync(original, size);
    assert.throws(() => captureGeneratedWasm(work, original, 'execution'), /bounded owned/);
  }
});

test('the existing full 64-MiB per-module artifact boundary is accepted exactly', t => {
  const {work, original} = fixture(t), bytes = Buffer.alloc(67108864);
  bytes.set(moduleBytes.subarray(0, 8)); bytes[8] = 0;
  let size = bytes.length - 13, at = 9;
  do {const part = size & 127; size >>>= 7; bytes[at++] = part | (size ? 128 : 0);} while (size);
  assert.equal(at, 13); assert.equal(WebAssembly.validate(bytes), true);
  writeFileSync(original, bytes);
  const artifact = captureGeneratedWasm(work, original, 'maximum');
  assert.equal(artifact.bytes.length, bytes.length); artifact.verify();
  truncateSync(original, bytes.length + 1);
  assert.throws(() => artifact.verify(), /bounded owned/);
});
