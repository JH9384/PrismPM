// Independent expected bytes; not an application transition implementation.
import assert from 'node:assert/strict';
import {corpus} from '../browser-session/corpus.mjs';
import {decodeRequest, encodeSuccess, expandState} from '../browser-session/wire.mjs';
import {decodeEffectWire as decode, encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';

export function projectExpected(row) {
    if (decode(row.response)[1] === 2) return row;
    const operation = decodeRequest(row.request);
    return {...row, response: operation[0] === 0 ? encode([1, 3])
      : operation[0] === 8 ? encode([1, 2, 3]) : encodeSuccess(operation[1])};
}

export function projectionCorpus() {
  const baseline = corpus(); assert.equal(baseline.length, 895);
  const rows = baseline.map(projectExpected);
  for (let tag = 0; tag <= 8; tag++) {
    const row = baseline.find(row => decode(row.response)[1] === 0 && decodeRequest(row.request)[0] === tag);
    assert.ok(row, 'every declared operation has an accepted baseline vector');
    const changed = new Uint8Array(row.request.length + 1); changed.set(row.request);
    rows.push({id: 'ProjectionTrailingOperation' + tag, request: changed, response: encode([1, 2, 8])});
  }
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}

export function observedExpected(bytes) {
  const state = expandState(decode(bytes)[2]);
  const [binding, limits, , durable, volatile] = state;
  const pending = durable[4][0] === 0 ? [0] : [1, [durable[4][1][0][1], durable[4][1][1],
    limits[5], durable[4][1][2]]];
  return encode([1, 5, [binding, durable[0], durable[3][0], durable[3][1], durable[3][2],
    volatile[5], durable[1], volatile[0], volatile[1], limits[5], pending]]);
}

export function observationCorpus() {
  const rows = [];
  for (const row of corpus()) {
    const reply = decode(row.response);
    if (reply[1] === 0 && Array.isArray(reply[2])) rows.push({id: 'Observe' + row.id,
      request: row.response, response: observedExpected(row.response)});
  }
  assert.ok(rows.length > 10);
  const sample = rows[0].request, trailing = new Uint8Array(sample.length + 1); trailing.set(sample);
  rows.push({id: 'ObservationTrailing', request: trailing, response: encode([1, 2, 8])});
  for (const [id, input] of [['Version', [2, 0, decode(sample)[2]]], ['Status', [1, 1, decode(sample)[2]]],
    ['Arity', [1, 0]]]) rows.push({id: 'ObservationWrong' + id, request: encode(input), response: encode([1, 2, 3])});
  // The unchanged bounded array reader rejects count4 at its maximum3
  // before the exact-arity comparison, preserving its ValueLimit error.
  rows.push({id: 'ObservationOversizedArity', request: encode([1, 0, decode(sample)[2], 0]), response: encode([1, 2, 6])});
  for (const [id, mutate] of [['Principal', s => {s[3][3][0] = new Uint8Array(31);}],
    ['Instance', s => {s[3][0] = new Uint8Array(31);}], ['Phase', s => {s[4][5] = 2;}]]) {
    const state = expandState(decode(sample)[2]); mutate(state);
    rows.push({id: 'ObservationInvalid' + id, request: encodeSuccess(state), response: encode([1, 1, 3])});
  }
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
