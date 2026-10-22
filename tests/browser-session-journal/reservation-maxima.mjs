// Preserve original payload/replay maxima while applying the new ordinal policy.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {metadataMaximumCorpus} from './metadata-maxima.mjs';
import {record, payload} from './metadata-corpus.mjs';
import {capacity, UINT32_MAX as U} from './reservation-oracle.mjs';

export function reservationMaximumCorpus() {
  const rows = metadataMaximumCorpus(), original = rows.find(row => row.id === 'MetadataMaximumRecoveryPlan');
  assert.ok(original);
  const unsafe = decode(original.request);
  assert.equal(unsafe[2][2], U - 1); assert.equal(capacity(unsafe[2]), 2);
  // The old metadata transition could spend the last ordinal on recovery and
  // leave Ready without capacity to Close. Its exact request must now refuse.
  original.response = encode([1, 1, 14]);
  const request = structuredClone(unsafe); request[2][2]--; request[3][2]--;
  const after = [request[2][0], request[2][1], U - 1, request[4][0],
    request[2][4] + 1, request[3][7], [0]];
  assert.equal(capacity(request[2]), U - request[2][2]);
  assert.equal(capacity(after), U - after[2]);
  rows.push({id: 'ReservationMaximumRecoveryWithFinalCloseReserve',
    request: encode(request), response: encode([1, 0, after]), facts: original.facts});
  const position = structuredClone(after[5]); position[0] = payload(184, 67108864); position[2] = 3;
  const close = record(after, 6, position, {operation: payload(185, 67108864)}), envelope = payload(186, 65536);
  const terminal = [after[0], after[1], U, envelope[0], after[4] + 1, position, [0]];
  assert.equal(capacity(terminal), 0);
  rows.push({id: 'ReservationMaximumRecoveryFinalCloseAtExhaustion',
    request: encode([1, 1, after, close, envelope]), response: encode([1, 0, terminal]),
    facts: {sequence: U, descriptorPayload: 67108864, finiteTerminal: true}});
  assert.equal(rows.length, 7); return rows;
}
