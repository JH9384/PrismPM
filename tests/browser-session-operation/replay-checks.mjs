// These negatives execute the actual generated runner, not a success stub.
import assert from 'node:assert/strict';
import {copyFileSync, mkdtempSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createNativeTranscriptReplay} from './native-replay.mjs';

export function verifyNativeTranscriptReplay(build, vectors) {
  const work = mkdtempSync(join(build.work, 'transcript-checks-'));
  const requestPath = join(work, 'request.bin'), responsePath = join(work, 'response.bin');
  function append(owner, entry, row) {
    writeFileSync(requestPath, row.request); writeFileSync(responsePath, row.response);
    return owner.observe(entry, requestPath, responsePath, row.request.length, row.response.length);
  }
  const rows = Object.keys(vectors).map(entry => ({entry, ...vectors[entry][0]}));
  rows.push(rows[1]); // Deliberately repeated bytes are separate real observations.
  const owner = createNativeTranscriptReplay(build), observed = rows.map(row => append(owner, row.entry, row));
  // Modify the original transient spool: the queued captured bytes, not later
  // caller file contents, must determine the actual native replay.
  writeFileSync(requestPath, 'not the captured request'); writeFileSync(responsePath, 'not the captured response');
  const result = owner.finish(observed);
  assert.equal(result.calls, 6); assert.equal(result.batches.length, 1);
  assert.throws(() => owner.finish(observed), /already closed/);
  assert.throws(() => append(owner, rows[0].entry, rows[0]), /already closed/);

  const canonical = readFileSync(result.batches[0].path, 'utf8'), lines = canonical.trimEnd().split('\n');
  const modified = join(work, 'modified.tsv'), refusals = [];
  const replaceField = (index, value) => {const fields = lines[0].split('\t'); fields[index] = value; return fields.join('\t') + '\n';};
  const malformed = [
    ['empty', '', /nonempty transcript/],
    ['missing-field', lines[0].split('\t').slice(0, 3).join('\t') + '\n', /closed transcript fields/],
    ['extra-field', lines[0] + '\textra\n', /closed transcript fields/],
    ['missing-newline', lines[0], /canonical bounded transcript/],
    ['carriage-return', lines[0] + '\r\n', /canonical transcript hex/],
    ['unknown-entry', replaceField(1, 'unknown'), /closed transcript entry/],
    ['leading-zero-index', replaceField(0, '00'), /canonical ordered transcript index/],
    ['negative-index', replaceField(0, '-1'), /ParseIntError/],
    ['unsafe-index', replaceField(0, '9007199254740992'), /canonical ordered transcript index/],
    ['uppercase-hex', replaceField(2, 'AA'), /canonical transcript hex/],
    ['odd-hex', replaceField(2, 'a'), /canonical transcript hex/],
    ['nonascii-hex', replaceField(2, 'é'), /canonical transcript hex/],
    ['duplicate-index', lines[0] + '\n' + lines[0] + '\n', /canonical ordered transcript index/],
    ['reordered', lines[1] + '\n' + lines[0] + '\n', /canonical ordered transcript index/],
    ['missing-index', lines[0] + '\n' + lines[2] + '\n', /canonical ordered transcript index/],
    ['changed-response', replaceField(3, '00'), /native output mismatch/],
    ['changed-role', replaceField(1, 'observation'), /native output mismatch/],
  ];
  for (const [id, text, expected] of malformed) {
    writeFileSync(modified, text);
    for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['transcript', modified]), expected, id);
    refusals.push(id);
  }
  for (const mutation of ['bytes', 'identity', 'reported-order']) {
    let exercised = false;
    const wrapped = {work: build.work, runNative(standard, arguments_) {
      if (arguments_[0] !== 'transcript') return build.runNative(standard, arguments_);
      exercised = true;
      const path = arguments_[1], saved = path + '.saved';
      if (mutation === 'bytes') writeFileSync(path, readFileSync(path, 'utf8') + '\n');
      if (mutation === 'identity') {renameSync(path, saved); copyFileSync(saved, path);}
      // The replacement remains visible through the post-execution guard;
      // its original is retained for diagnosis.
      const output = build.runNative(standard, arguments_);
      return mutation === 'reported-order' ? output.split('\n').reverse().join('\n') : output;
    }};
    const replay = createNativeTranscriptReplay(wrapped), actual = rows.slice(0, 2).map(row => append(replay, row.entry, row));
    assert.throws(() => replay.finish(actual), mutation === 'reported-order'
      ? /exact native transcript count and order/ : /immutable native transcript identity/);
    assert.equal(exercised, true); refusals.push(mutation);
  }
  for (const mutation of ['drop', 'reorder']) {
    const replay = createNativeTranscriptReplay(build), actual = rows.slice(0, 2).map(row => append(replay, row.entry, row));
    assert.throws(() => replay.finish(mutation === 'drop' ? actual.slice(1) : actual.toReversed()),
      /exact complete observed native transcript order/);
    refusals.push(mutation);
  }
  const rowBound = createNativeTranscriptReplay(build), repeated = [];
  for (let index = 0; index < 4097; index++) repeated.push(append(rowBound, 'partition', vectors.partition[0]));
  const countFlush = rowBound.finish(repeated);
  assert.deepEqual(countFlush.batches.map(row => row.count), [4096, 1]);
  const byteBound = createNativeTranscriptReplay(build), largeRows = [];
  const middle = vectors.partition.find(row => row.request.length === 1048576);
  for (let index = 0; index < 5; index++) largeRows.push(append(byteBound, 'partition', middle));
  const large = vectors.partition.find(row => row.request.length === 67108864);
  largeRows.push(append(byteBound, 'partition', large));
  largeRows.push(append(byteBound, 'partition', vectors.partition[0]));
  const byteFlush = byteBound.finish(largeRows);
  assert.deepEqual(byteFlush.batches.map(row => [row.first, row.count]), [[0, 3], [3, 2], [6, 1]]);
  assert.equal(byteFlush.calls, 7, '64 MiB frame is binary fallback, not refused');
  unlinkSync(modified);
  return {mixedRows: result.calls, refusals, rowFlush: countFlush.batches.map(row => row.count),
    byteFlush: byteFlush.batches.map(row => [row.first, row.count]), maximumBinaryBytes: large.request.length};
}
