// Independent ordered replay fixtures, including odd splits and error precedence.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';
import {initial, payload, reference, record} from '../browser-session-journal/metadata-corpus.mjs';
import {encodeMetadataReplay} from '../browser-session-journal/metadata-maxima.mjs';

const unique = value => {const out = payload(12); new DataView(out[0].buffer).setUint32(0, value); return out;};
function sequence(count) {
  let state = structuredClone(initial); const entries = [];
  for (let index = 0; index < count; index++) {
    const after = [unique(10000 + index), 4, 0, 0, [0]], operation = unique(20000 + index);
    const row = record(state, 1, after, {operation}), envelope = unique(30000 + index);
    entries.push([row, envelope]);
    state = [state[0], state[1], row[2], envelope[0], state[4] + 1, after, [0]];
  }
  return {entries, state};
}
export function metadataTraversalCorpus() {
  const rows = [];
  for (const count of [0, 1, 2, 3, 5, 7, 15, 17, 31, 33, 63, 65, 127, 129, 255, 257, 511, 513, 1023]) {
    const fixture = sequence(count);
    rows.push({id: 'MetadataTraversalCount' + count, request: encodeMetadataReplay(initial, fixture.entries), response: encode([1, 0, fixture.state])});
  }
  const fixture = sequence(5);
  for (const index of [0, 2, 4]) for (const [name, change, error] of [
    ['Sequence', row => {row[2]++;}, 8], ['Predecessor', row => {row[3] = reference(190);}, 9],
    ['Before', row => {row[5][0] = unique(90000);}, 10],
  ]) {
    // Clone records separately: structuredClone of the complete graph preserves
    // before/previous-after aliases and would alter both sides of this adversary.
    const entries = fixture.entries.map(entry => structuredClone(entry)); change(entries[index][0]);
    rows.push({id: 'MetadataTraversal' + name + index, request: encodeMetadataReplay(initial, entries), response: encode([1, 1, error])});
  }
  for (const earlyDomainFailure of [false, true]) {
    const entries = fixture.entries.map(entry => structuredClone(entry)); if (earlyDomainFailure) entries[0][0][2]++;
    const full = encodeMetadataReplay(initial, entries), label = earlyDomainFailure ? 'BeforeDomainFailure' : '';
    rows.push({id: 'MetadataTraversalTruncatedFinal' + label, request: full.slice(0, -1), response: encode([1, 2, 2])});
    const trailing = new Uint8Array(full.length + 1); trailing.set(full);
    rows.push({id: 'MetadataTraversalTrailing' + label, request: trailing, response: encode([1, 2, 8])});
    entries[4][1] = 0;
    rows.push({id: 'MetadataTraversalMalformedFinal' + label, request: encodeMetadataReplay(initial, entries), response: encode([1, 2, 3])});
  }
  assert.equal(rows.length, 34); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
