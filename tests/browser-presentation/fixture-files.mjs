// Acceptance-fixture custody, not application behavior. Native consumers run
// before retirement; only their exact, no-longer-used binary inputs are removed.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, openSync, readSync, realpathSync,
  unlinkSync, writeSync} from 'node:fs';
import {join, resolve} from 'node:path';

const fields = ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink', 'size', 'mtimeNs', 'ctimeNs'];
const identity = stat => Object.fromEntries(fields.map(name => [name, stat[name].toString()]));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function ownFixtureFiles(root) {
  assert.equal(resolve(root), root, 'normalized fixture root');
  assert.equal(realpathSync(root), root, 'unaliased fixture root');
  const parent = lstatSync(root, {bigint: true});
  assert(parent.isDirectory() && parent.uid === BigInt(process.getuid())
    && (parent.mode & 0o022n) === 0n, 'private owned fixture root');
  const rows = new Map();
  let state = 'writing';
  function checkParent() {
    assert.equal(realpathSync(root), root, 'unaliased fixture root');
    const current = lstatSync(root, {bigint: true});
    assert(current.isDirectory(), 'fixture parent directory');
    for (const field of ['dev', 'ino', 'uid', 'gid', 'mode'])
      assert.equal(current[field], parent[field], 'immutable fixture parent ' + field);
  }
  function capture(path, held = null) {
    checkParent();
    const fd = held ?? openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const before = fstatSync(fd, {bigint: true});
      assert(before.isFile() && before.nlink === 1n && before.uid === parent.uid
        && before.size <= 67108865n && (before.mode & 0o022n) === 0n,
      'bounded single-link fixture file');
      const hash = createHash('sha256'), buffer = Buffer.alloc(65536);
      let bytes = 0;
      while (bytes < Number(before.size)) {
        const count = readSync(fd, buffer, 0, Math.min(buffer.length, Number(before.size) - bytes), bytes);
        assert(count > 0, 'fixture file shortened');
        hash.update(buffer.subarray(0, count)); bytes += count;
      }
      assert.equal(readSync(fd, buffer, 0, 1, bytes), 0, 'fixture file grew');
      for (const stat of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})])
        assert.deepEqual(identity(stat), identity(before), 'stable fixture descriptor and name');
      checkParent();
      return Object.freeze({...identity(before), sha256: hash.digest('hex')});
    } finally {if (held === null) closeSync(fd);}
  }
  function verify() {
    assert.equal(state, 'sealed', 'sealed unretired fixtures required');
    for (const [name, expected] of rows)
      assert.deepEqual(capture(join(root, name)), expected, 'immutable fixture ' + name);
  }
  return Object.freeze({
    write(name, bytes) {
      assert.equal(state, 'writing', 'fixture creation closed');
      assert.match(name, /^[A-Za-z][A-Za-z0-9]*\.(request|response)$/);
      assert(!rows.has(name) && rows.size < 128, 'exclusive bounded fixture inventory');
      assert(bytes instanceof Uint8Array && bytes.length <= 67108865, 'bounded fixture bytes');
      checkParent();
      const path = join(root, name);
      const fd = openSync(path, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const created = fstatSync(fd, {bigint: true});
        assert(created.isFile() && created.nlink === 1n && created.size === 0n, 'exclusive created fixture descriptor');
        let offset = 0;
        while (offset < bytes.length) {
          const count = writeSync(fd, bytes, offset, Math.min(65536, bytes.length - offset), offset);
          assert(count > 0, 'fixture write made progress'); offset += count;
        }
        // Capture from the original exclusive descriptor, never enroll a
        // replacement pathname even if it contains the same producer bytes.
        const captured = capture(path, fd);
        for (const key of ['dev', 'ino', 'uid', 'gid', 'mode', 'nlink'])
          assert.equal(captured[key], created[key].toString(), 'original created fixture ' + key);
        assert.equal(captured.size, String(bytes.length));
        assert.equal(captured.sha256, sha(bytes), 'fixture producer bytes');
        rows.set(name, captured);
      } finally {closeSync(fd);}
      return path;
    },
    seal() {assert.equal(state, 'writing'); assert(rows.size > 0); state = 'sealed'; verify();},
    verify,
    retire() {
      verify(); // Verify every file before removing any file.
      state = 'retiring'; // A partial failure cannot be retried or resealed.
      for (const [name, expected] of rows) {
        const path = join(root, name);
        assert.deepEqual(capture(path), expected, 'immutable fixture before exact unlink');
        checkParent(); unlinkSync(path); checkParent();
        assert.equal(lstatSync(path, {throwIfNoEntry: false}), undefined, 'fixture retirement observed');
      }
      state = 'retired';
      const files = Object.freeze([...rows].map(([name, evidence]) => Object.freeze({name, ...evidence})));
      return Object.freeze({state, files, bytes: files.reduce((sum, row) => sum + Number(row.size), 0)});
    },
    assertRetired() {
      assert.equal(state, 'retired', 'fixture retirement required before browser execution');
      checkParent();
      for (const name of rows.keys())
        assert.equal(lstatSync(join(root, name), {throwIfNoEntry: false}), undefined, 'retired fixture reappeared');
    },
  });
}

export async function consumeNativeFixtures(fixtures, consume) {
  fixtures.seal();
  const completed = [];
  for (const standard of [true, false]) {
    fixtures.verify();
    await consume(standard);
    fixtures.verify(); completed.push(standard);
  }
  assert.deepEqual(completed, [true, false], 'both complete native consumers precede fixture retirement');
  const retirement = fixtures.retire();
  fixtures.assertRetired();
  return retirement;
}
