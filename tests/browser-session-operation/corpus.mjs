// Independent expected frames/descriptors; never imported by SDK runtime.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {corpus} from '../browser-session/corpus.mjs';
import {projectExpected, observedExpected} from '../browser-session-journal/projection-corpus.mjs';
import {decodeEffectWire as decode, encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';

const digest = bytes => new Uint8Array(createHash('sha256').update(bytes).digest());
export function describeExpected(bytes) {
  if (bytes === null) return null;
  const chunks = [];
  for (let at = 0; at < bytes.length; at += 1048576) chunks.push(digest(bytes.subarray(at, at + 1048576)));
  const descriptor = encode([digest(bytes), bytes.length, chunks]);
  return {descriptor, marker: digest(descriptor)};
}
export function captureExpected(row) {
  const projected = projectExpected(row).response, projection = decode(projected), reply = decode(row.response);
  if (![0, 3].includes(projection[1]) || reply[1] !== 0) return {error: 'source-refused'};
  const before = projection[1] === 3 ? null : projected, after = row.response;
  const frames = {operation: row.request, before, after,
    beforeObservation: before === null ? null : observedExpected(before), afterObservation: observedExpected(after)};
  return {frames, descriptions: Object.fromEntries(Object.entries(frames).map(([key, bytes]) => [key, describeExpected(bytes)]))};
}
export function operationCorpus() {
  const rows = corpus().map(row => ({...row, expected: captureExpected(row)}));
  assert.equal(rows.length, 895);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
