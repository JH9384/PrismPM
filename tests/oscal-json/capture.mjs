// Test-input custody, not an application implementation or an oracle verdict.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  readdirSync, realpathSync} from 'node:fs';
import {join, resolve} from 'node:path';

export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const fields = ['dev', 'ino', 'mode', 'nlink', 'uid', 'gid', 'size', 'mtimeNs', 'ctimeNs'];
const identity = stat => Object.fromEntries(fields.map(key => [key, stat[key].toString()]));

export function captureFile(path, maximum = 268435456, links = 1n) {
  assert.equal(resolve(path), path, 'absolute normalized input');
  assert.equal(realpathSync(path), path, 'unaliased input');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert.ok(before.isFile() && before.size <= BigInt(maximum), 'bounded regular input');
    if (links !== null) assert.equal(before.nlink, links, 'input link count');
    const bytes = Buffer.alloc(Number(before.size));
    for (let offset = 0; offset < bytes.length;) {
      const count = readSync(fd, bytes, offset, bytes.length - offset, null);
      assert.ok(count > 0, 'input shortened'); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'input grew');
    const expected = identity(before);
    for (const stat of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})])
      assert.deepEqual(identity(stat), expected, 'stable opened input');
    assert.equal(realpathSync(path), path, 'unaliased captured input');
    const evidence = Object.freeze({...expected, sha256: sha(bytes)});
    return Object.freeze({bytes, evidence,
      verify() {
        const after = captureFile(path, maximum, links);
        assert.deepEqual(after.evidence, evidence, 'immutable captured input ' + path);
      }});
  } finally {closeSync(fd);}
}

export function captureTree(root) {
  const files = new Map(), directories = [];
  function visit(path, prefix) {
    assert.equal(realpathSync(path), path, 'unaliased input directory');
    const stat = lstatSync(path, {bigint: true});
    assert.ok(stat.isDirectory(), 'regular input directory');
    const names = readdirSync(path).sort();
    directories.push({path, identity: identity(stat), names});
    for (const name of names) {
      const child = join(path, name), relative = prefix ? prefix + '/' + name : name;
      const metadata = lstatSync(child);
      if (metadata.isDirectory()) visit(child, relative);
      else files.set(relative, captureFile(child));
    }
  }
  visit(root, '');
  function verify() {
    for (const expected of directories) {
      assert.equal(realpathSync(expected.path), expected.path, 'unaliased frozen directory');
      assert.deepEqual(identity(lstatSync(expected.path, {bigint: true})), expected.identity,
        'immutable input directory');
      assert.deepEqual(readdirSync(expected.path).sort(), expected.names, 'complete input inventory');
    }
    for (const capture of files.values()) capture.verify();
  }
  verify();
  return Object.freeze({files, verify});
}
