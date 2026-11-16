// Preserve original bootstrap outputs; this does not replay or accept a proof.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {canonical as bootstrapCanonical} from './bootstrap-evidence.mjs';

export const bootstrapNames = Object.freeze(['bootstrap-prior-capture.json', 'bootstrap-current-capture.json',
  'bootstrap-source-manifest.json', 'bootstrap-evidence.json']);
export const canonical = value => JSON.stringify(value, (_, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
export function readOriginal(path, maximum = 64 * 1024 * 1024) {
  path = resolve(path); assert.equal(realpathSync(dirname(path)), dirname(path), 'original parent cannot be aliased');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum), 'bounded unaliased original required');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert(count > 0, 'original shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'original grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})]) {
      assert(after.isFile());
      for (const key of ['dev', 'ino', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs']) assert.equal(after[key], before[key], 'original changed');
    }
    return bytes;
  } finally { closeSync(fd); }
}
const descriptor = (path, bytes) => ({path, byte_length: bytes.length, sha256: hash(bytes)});
export function validateBootstrapBytes(files) {
  assert.deepEqual([...files.keys()], [...bootstrapNames]);
  const values = new Map([...files].map(([name, bytes]) => {
    assert(Buffer.isBuffer(bytes) && bytes.length <= 64 * 1024 * 1024);
    const value = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes));
    assert.equal(bytes.toString(), bootstrapCanonical(value), 'original canonical bootstrap bytes required');
    return [name, value];
  }));
  const evidence = values.get('bootstrap-evidence.json'), manifest = values.get('bootstrap-source-manifest.json');
  assert.equal(evidence.schema, 'prismpm/bootstrap-evidence/2'); assert.equal(evidence.status, 'passed');
  assert.equal(evidence.source_manifest.digest, 'sha256:' + hash(files.get('bootstrap-source-manifest.json')));
  assert(Array.isArray(manifest.files) && manifest.files.length > 0);
  assert.equal(evidence.source_manifest.file_count, manifest.files.length);
  for (const [kind, name] of [['prior', 'bootstrap-prior-capture.json'], ['current', 'bootstrap-current-capture.json']]) {
    assert.equal(evidence.compatibility_projection[kind].capture_digest, 'sha256:' + hash(files.get(name)));
  }
}
export function captureBootstrap(source, output, run) {
  assert.equal(run, 1);
  const files = new Map(bootstrapNames.map(name => [name, readOriginal(join(source, 'target', name))]));
  validateBootstrapBytes(files);
  return {run, files: [...files].map(([name, bytes]) => {
    const path = `run-${run}-${name}`;
    writeFileSync(join(output, path), bytes, {flag: 'wx', mode: 0o444});
    return descriptor(path, bytes);
  })};
}
export function validateBootstrapRetention(bytes, files, revision) {
  assert.match(revision, /^[a-f0-9]{40}$/); assert(Buffer.isBuffer(bytes) && bytes.length <= 65536);
  const value = JSON.parse(bytes); assert.equal(bytes.toString(), canonical(value));
  assert.deepEqual(Object.keys(value).sort(), ['runs', 'schema', 'source_revision']);
  assert.equal(value.schema, 'prismpm/bootstrap-retention/1'); assert.equal(value.source_revision, revision);
  assert(Array.isArray(value.runs) && value.runs.length === 1);
  assert.deepEqual([...files.keys()].sort(), bootstrapNames.map(name => `run-1-${name}`).sort());
  for (const run of [1]) {
    const original = new Map(bootstrapNames.map(name => [name, files.get(`run-${run}-${name}`)]));
    validateBootstrapBytes(original);
    assert.deepEqual(value.runs[run - 1], {run, files: [...original].map(([name, raw]) => descriptor(`run-${run}-${name}`, raw))});
  }
  return value;
}
