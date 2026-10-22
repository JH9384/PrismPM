import assert from 'node:assert/strict';
import {decodeRetentionWire as decode} from '../../sdk/browser/session-retention-wire.mjs';

// Expected from the explicit fixture operations: open/snapshot validate once;
// commit invokes transition admission, then validates only an admitted result.
export const storageJourneyInventory = Object.freeze([
  ['a transaction must report strict durability', 15, 3, 0],
  ['real durable root closure survives', 6, 1, 0],
  ['competing real transactions', 8, 2, 0],
  ['shared and staging roots', 13, 6, 2],
  ['actual transaction abort', 9, 3, 0],
  ['missing closure, invalid input, close', 7, 2, 1],
  ['two actual tabs', 9, 2, 0],
  ['acknowledged root and bytes', 6, 1, 0],
  ['publication cannot acknowledge', 5, 1, 0],
  ['quota failure aborts', 9, 2, 0],
  ['read refuses changed stored payload', 5, 1, 0],
].map(row => Object.freeze(row)));

export function validateStorageObservations(calls) {
  assert.equal(calls.length, 92, 'complete observed storage call inventory');
  for (const row of calls) {
    assert.deepEqual(Object.keys(row).sort(), ['journey', 'memory', 'request', 'response']);
    assert.ok(Number.isInteger(row.journey) && row.journey >= 0 && row.journey < storageJourneyInventory.length);
    assert.match(row.request, /^(?:[a-f0-9]{2})+$/); assert.match(row.response, /^(?:[a-f0-9]{2})+$/);
    assert.ok(Number.isInteger(row.memory) && row.memory > 0 && row.memory <= 1073741824);
  }
  for (const [index, [, count, transitions, failures]] of storageJourneyInventory.entries()) {
    const rows = calls.filter(row => row.journey === index);
    assert.equal(rows.length, count, 'complete per-journey observation inventory ' + index);
    const observed = {transitions: 0, failures: 0, validations: 0};
    for (const row of rows) {
      const input = decode(Buffer.from(row.request, 'hex')), output = decode(Buffer.from(row.response, 'hex'));
      assert.equal(input[0], 1); assert.equal(output[0], 1);
      if (input[1] === 0) {
        assert.equal(input.length, 6); observed.transitions++;
        if (output[1] === 1) observed.failures++;
        else assert.equal(output[1], 0);
      } else {
        assert.equal(input[1], 1); assert.equal(input.length, 3);
        assert.deepEqual(output, [1, 0, true]); observed.validations++;
      }
    }
    assert.deepEqual(observed, {transitions, failures, validations: count - transitions},
      'complete generated operation inventory ' + index);
  }
}
