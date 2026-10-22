// Test-input capture: digest and bytes come from one bounded stable descriptor.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync} from 'node:fs';
import {resolve} from 'node:path';

const fields = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
const record = stat => Object.fromEntries(fields.map(key => [key, stat[key].toString()]));
export function captureFile(path, maximum = 268435456) {
  assert.equal(resolve(path), path, 'normalized custody path');
  assert.equal(realpathSync(path), path, 'unaliased custody ancestry');
  assert(Number.isSafeInteger(maximum) && maximum >= 0 && maximum <= 268435456, 'bounded custody limit');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert(before.isFile() && before.nlink === 1n && before.size <= BigInt(maximum), 'bounded single-link custody file');
    const bytes = Buffer.alloc(Number(before.size)), hash = createHash('sha256');
    let offset = 0;
    while (offset < bytes.length) {
      const count = readSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), null);
      assert(count > 0, 'custody file shortened');
      hash.update(bytes.subarray(offset, offset + count)); offset += count;
    }
    assert.equal(readSync(fd, Buffer.alloc(1), 0, 1, null), 0, 'custody file grew');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})])
      assert.deepEqual(record(after), record(before), 'stable custody descriptor and name');
    assert.equal(realpathSync(path), path, 'custody ancestry changed');
    return {bytes, evidence: Object.freeze({...record(before), sha256: hash.digest('hex')})};
  } finally {closeSync(fd);}
}

export function capturedFile(path, expected, maximum) {
  const capture = captureFile(path, maximum);
  assert.deepEqual(capture.evidence, expected, 'immutable captured file custody');
  return capture.bytes;
}
