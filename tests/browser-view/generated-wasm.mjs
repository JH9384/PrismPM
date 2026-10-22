// Test infrastructure: capture just-built artifacts before exposing execution bytes.
// Source/package and toolchain guards remain mandatory at the owning compiler.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, relative, resolve, sep} from 'node:path';

// Existing per-module admission in sdk/browser/effects-module.mjs also limits
// each artifact to EFFECT_FRAME_MAXIMUM. This is not an inferred request bound.
const maximum = 67108864;
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const owners = new WeakSet();

function directory(path) {
  assert.equal(resolve(path), path, 'normalized absolute artifact directory');
  assert.equal(realpathSync(path), path, 'unaliased artifact directory');
  const stat = lstatSync(path);
  assert.ok(stat.isDirectory() && stat.uid === process.getuid(), 'owned artifact directory');
}

function read(path, expectedLinks = null) {
  directory(dirname(path));
  assert.equal(realpathSync(path), path, 'unaliased generated Wasm file');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid())
      && before.size >= 8n && before.size <= BigInt(maximum), 'bounded owned regular generated Wasm');
    if (expectedLinks !== null) assert.equal(before.nlink, expectedLinks, 'generated Wasm link count');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert.ok(count > 0, 'generated Wasm shortened during capture'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'generated Wasm grew during capture');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) {
      assert.ok(after.isFile(), 'generated Wasm file replaced during capture');
      for (const key of ['dev', 'ino', 'uid', 'nlink', 'size', 'mode', 'mtimeNs', 'ctimeNs'])
        assert.equal(after[key], before[key], 'stable generated Wasm capture ' + key);
    }
    assert.deepEqual(bytes.subarray(0, 8), Buffer.from([0, 97, 115, 109, 1, 0, 0, 0]),
      'actual Core-Wasm header');
    return {bytes, identity: Object.freeze({device: before.dev.toString(), inode: before.ino.toString(),
      links: before.nlink.toString(), size: bytes.length, sha256: sha(bytes)})};
  } finally {closeSync(fd);}
}

export function captureGeneratedWasm(work, original, name) {
  directory(work);
  assert.equal(resolve(original), original, 'absolute original generated Wasm');
  const child = relative(work, original);
  assert.ok(child && child !== '..' && !child.startsWith('..' + sep) && !child.startsWith(sep),
    'original generated Wasm belongs to the private owner');
  assert.match(name, /^[a-z][a-z0-9-]{0,95}$/, 'closed private artifact name');
  const captured = read(original), path = join(work, name + '.wasm');
  assert.notEqual(path, original, 'separate execution artifact required');
  // Cargo normally retains a link into deps/. Capture its actual link count;
  // only the distinct execution copy must be singly linked.
  writeFileSync(path, captured.bytes, {flag: 'wx', mode: 0o400});
  const private_ = read(path, 1n);
  assert.equal(private_.identity.sha256, captured.identity.sha256);
  const bytes = Buffer.from(captured.bytes);
  const evidence = Object.freeze({original: Object.freeze({path: child, ...captured.identity}),
    private: Object.freeze({path: name + '.wasm', ...private_.identity})});
  function verify() {
    directory(work);
    assert.deepEqual(read(original, BigInt(captured.identity.links)).identity, captured.identity,
      'immutable original generated Wasm');
    assert.deepEqual(read(path, 1n).identity, private_.identity, 'immutable private generated Wasm');
    assert.equal(sha(bytes), captured.identity.sha256, 'immutable execution Wasm buffer');
  }
  const owner = Object.freeze({bytes, path, evidence, verify,
    run(operation) {
      assert.equal(typeof operation, 'function'); verify();
      try {
        const result = operation(bytes);
        assert.ok(!result || typeof result.then !== 'function', 'use runAsync for asynchronous artifact execution');
        return result;
      } finally {verify();}
    },
    async runAsync(operation) {
      assert.equal(typeof operation, 'function'); verify();
      try {return await operation(bytes);} finally {verify();}
    }});
  owners.add(owner); verify(); return owner;
}

export function requireGeneratedWasm(owner) {
  assert.ok(owners.has(owner), 'actual captured generated Wasm owner required');
  owner.verify(); return owner;
}
