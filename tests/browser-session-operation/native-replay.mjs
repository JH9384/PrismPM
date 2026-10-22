// Exact observed browser transcripts, not cached native verdicts. The batching
// limits only flush work; every larger legal frame keeps the binary path.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, fstatSync, lstatSync, mkdtempSync, openSync, readSync,
  realpathSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';

const roles = ['predecessor', 'session', 'observation', 'partition', 'descriptor'];
const frameMaximum = 67108864, batchBytes = 4194304, batchRows = 4096;
const identity = stat => Object.fromEntries(['dev', 'ino', 'uid', 'nlink', 'mode', 'size', 'mtimeNs', 'ctimeNs']
  .map(key => [key, String(stat[key])]));

function capture(path, maximum, retain) {
  assert.equal(realpathSync(path), path, 'unaliased native transcript');
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd, {bigint: true});
    assert.ok(before.isFile() && before.uid === BigInt(process.getuid()) && before.nlink === 1n
      && (before.mode & 0o022n) === 0n && before.size <= BigInt(maximum), 'bounded owned native transcript');
    const digest = createHash('sha256'), chunks = [], buffer = Buffer.alloc(Math.max(1, Math.min(262144, Number(before.size))));
    let length = 0;
    for (;;) {
      const count = readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      length += count; assert.ok(length <= maximum, 'bounded native transcript read');
      const bytes = buffer.subarray(0, count); digest.update(bytes);
      if (retain) chunks.push(Buffer.from(bytes));
    }
    assert.equal(BigInt(length), before.size, 'complete native transcript');
    for (const after of [fstatSync(fd, {bigint: true}), lstatSync(path, {bigint: true})])
      assert.deepEqual(identity(after), identity(before), 'native transcript changed during capture');
    return {path, maximum, identity: identity(before), bytes: length, sha256: digest.digest('hex'),
      raw: retain ? Buffer.concat(chunks) : null};
  } finally {closeSync(fd);}
}
function verify(record) {
  const observed = capture(record.path, record.maximum, false);
  assert.deepEqual(observed.identity, record.identity, 'immutable native transcript identity');
  assert.equal(observed.sha256, record.sha256, 'immutable native transcript bytes');
}

export function createNativeTranscriptReplay(build) {
  const directory = mkdtempSync(join(build.work, 'observed-native-replay-'));
  let pending = [], pendingBytes = 0, next = 0, completed = 0, closed = false;
  const batches = [], observations = [];
  function live() {assert.equal(closed, false, 'native transcript replay already closed');}
  function flush() {
    if (!pending.length) return;
    assert.equal(pending[0].index, completed, 'complete globally ordered native transcript');
    const text = pending.map(row => row.index + '\t' + row.entry + '\t'
      + row.request.toString('hex') + '\t' + row.response.toString('hex') + '\n').join('');
    const path = join(directory, 'batch-' + batches.length + '.tsv');
    writeFileSync(path, text, {flag: 'wx', mode: 0o600});
    const record = capture(path, 9437184, false);
    assert.equal(record.sha256, createHash('sha256').update(text).digest('hex'));
    const expected = pending.map(row => 'PASS transcript ' + row.index + ' ' + row.entry + '\n').join('')
      + 'PASS ' + pending.length + ' operation transcript vectors twice\n';
    for (const standard of [true, false]) {
      verify(record);
      try {assert.equal(build.runNative(standard, ['transcript', path]), expected, 'exact native transcript count and order');}
      finally {verify(record);}
    }
    batches.push(Object.freeze({first: pending[0].index, count: pending.length, path,
      sha256: record.sha256, bytes: record.bytes}));
    completed += pending.length; pending = []; pendingBytes = 0;
  }
  return Object.freeze({
    observe(entry, inputPath, outputPath, requestLength, responseLength) {
      live(); assert.ok(roles.includes(entry), 'closed native transcript entry');
      for (const value of [requestLength, responseLength])
        assert.ok(Number.isSafeInteger(value) && value >= 0 && value <= frameMaximum);
      assert.ok(Number.isSafeInteger(next + 1));
      const small = requestLength + responseLength <= batchBytes;
      const request = capture(inputPath, requestLength, small), response = capture(outputPath, responseLength, small);
      assert.equal(request.bytes, requestLength); assert.equal(response.bytes, responseLength);
      if (pendingBytes + request.bytes + response.bytes > batchBytes || pending.length === batchRows) flush();
      const index = next++;
      if (small) {
        pending.push({index, entry, request: request.raw, response: response.raw});
        pendingBytes += request.bytes + response.bytes;
      } else {
        flush(); assert.equal(index, completed, 'large frame preserves globally ordered replay');
        for (const standard of [true, false]) {
          verify(request); verify(response);
          try {assert.equal(build.runNative(standard, [entry, inputPath, outputPath]), 'PASS binary operation component twice\n');}
          finally {verify(request); verify(response);}
        }
        completed++;
      }
      const row = Object.freeze({entry, request: request.sha256, response: response.sha256,
        requestBytes: request.bytes, responseBytes: response.bytes});
      observations.push(row); return row;
    },
    finish(actual) {
      live(); flush();
      assert.equal(completed, next, 'every observed invocation actually replayed');
      assert.deepEqual(actual.map(({entry, request, response, requestBytes, responseBytes}) =>
        ({entry, request, response, requestBytes, responseBytes})), observations,
      'exact complete observed native transcript order');
      closed = true;
      return Object.freeze({calls: completed, batches: Object.freeze([...batches])});
    },
  });
}
