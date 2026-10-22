// Independent complete-frame sizing, followed by actual allocated byte vectors.
import assert from 'node:assert/strict';
import {decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {encodeWire as encodeView} from '../../sdk/browser/presentation-wire.mjs';
import {initial, bytes, presentation, success, malformed, MAXIMUM} from '../browser-session/corpus.mjs';
import {compactState, expandState} from '../browser-session/wire.mjs';
import {maximumVectors, effectResultMaxima} from '../browser-session/maxima.mjs';
import {measure, sizedBytes} from '../browser-session/budget.mjs';
import {contextSuccess, recoveryRequest} from './corpus.mjs';
import {metadataMaximumCorpus} from '../browser-session-journal/metadata-maxima.mjs';

const boundary = measureAt => {
  let low = 0, high = MAXIMUM;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (measureAt(middle) <= MAXIMUM) low = middle; else high = middle - 1;
  }
  return low;
};
export function* recoveryMaximumCorpus() {
  // Replay the unchanged Session owners' actual aggregate/effect maxima first.
  // Every successful state is also sent through the new context root, including
  // 64-MiB replies and retained pending/Unknown/Closed continuations.
  for (const vector of (function* () {yield* maximumVectors(); yield* effectResultMaxima();})()) {
    yield {entry: 'session', ...vector};
    const reply = decode(vector.response);
    if (reply[1] === 0) {
      const state = expandState(reply[2]);
      yield {entry: 'context', id: 'Context' + vector.id, request: vector.response, response: contextSuccess(state)};
    }
  }
  for (const [name, fields] of [
    ['Application', ['application']], ['OldEvidence', ['oldEvidence']], ['OldSelector', ['oldSelector']],
    ['NewEvidence', ['newEvidence']], ['NewSelector', ['newSelector']],
    ['Mixed', ['application', 'oldEvidence', 'oldSelector', 'newEvidence', 'newSelector']],
  ]) {
    const state = initial({phase: 3}); state[1][0] = state[1][1] = state[1][3] = MAXIMUM;
    const admitted = structuredClone(state[3][3]); admitted[2]++;
    const execution = bytes(32, 91), view = presentation(); let selector = bytes(3, 92);
    const assign = (total, real) => {
      for (const [index, field] of fields.entries()) {
        const length = Math.floor(total / fields.length) + (index < total % fields.length ? 1 : 0);
        const value = real ? bytes(length, 93 + index) : sizedBytes(length);
        if (field === 'application') state[3][2] = value;
        else if (field === 'oldEvidence') state[3][3][3] = value;
        else if (field === 'oldSelector') state[4][3] = value;
        else if (field === 'newEvidence') admitted[3] = value;
        else selector = value;
      }
    };
    const size = boundary(length => {
      assign(length, false); return measure([1, [1, compactState(state), admitted, execution, selector, view]]);
    });
    assign(size, true);
    const request = recoveryRequest(state, admitted, execution, selector, view);
    assert.equal(request.length, MAXIMUM, 'actual aggregate recovery request');
    const after = structuredClone(state); after[3][3] = admitted; after[4] = [execution, 0, 0, selector, view, 0];
    yield {entry: 'recovery', id: name + 'ExactMaximumRecovery', request, response: success(after)};
  }
  {
    // Both full presentations coexist; they are distinct, not repeated aliases.
    const state = initial({phase: 3}), admitted = structuredClone(state[3][3]), execution = bytes(32, 111);
    const beforeView = decode(state[4][4]), afterView = decode(presentation());
    const viewSize = length => presentation().length + 4 + measure(sizedBytes(length));
    const size = boundary(length => {
      state[1][6] = viewSize(length); state[4][4] = sizedBytes(viewSize(length));
      return measure([1, [1, compactState(state), admitted, execution, bytes(0), sizedBytes(viewSize(length))]]);
    });
    state[1][6] = viewSize(size); state[4][4] = sizedBytes(viewSize(size));
    const residue = MAXIMUM - measure([1, [1, compactState(state), admitted, execution, bytes(0), sizedBytes(viewSize(size))]]);
    assert.ok(residue <= 1);
    beforeView[6].push([0, [4, 'x'.repeat(size)]]); afterView[6].push([0, [4, 'y'.repeat(size)]]);
    state[4][4] = encodeView(beforeView); const view = encodeView(afterView), selector = bytes(residue);
    assert.equal(state[4][4].length, state[1][6]); assert.equal(view.length, state[1][6]);
    const request = recoveryRequest(state, admitted, execution, selector, view);
    assert.equal(request.length, MAXIMUM);
    const after = structuredClone(state); after[4] = [execution, 0, 0, selector, view, 0];
    yield {entry: 'recovery', id: 'DistinctPresentationsExactMaximumRecovery', request, response: success(after)};
  }
  for (const vector of metadataMaximumCorpus()) yield {entry: 'metadata', ...vector};
  for (const entry of ['context', 'recovery', 'session', 'metadata'])
    yield {entry, id: entry + 'InputOneOver', request: bytes(MAXIMUM + 1, 0), response: malformed(6), nativeOnly: true};
}
