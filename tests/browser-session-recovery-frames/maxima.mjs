// Complete real payloads; sizing selects boundaries but never supplies evidence.
import assert from 'node:assert/strict';
import {encodeWire as encodeView, decodePresentation} from '../../sdk/browser/presentation-wire.mjs';
import {decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {initial, bytes, presentation, success, malformed} from '../browser-session/corpus.mjs';
import {compactState} from '../browser-session/wire.mjs';
import {measure, sizedBytes} from '../browser-session/budget.mjs';
import {MAXIMUM, expectedLayout, expectedLayoutReply, tailRequest, expectedTailReply,
  replacements, rebound, joinBytes} from './corpus.mjs';

export function* maxima() {
  for (const parts of [['Application'], ['Evidence'], ['Selector'], ['Presentation'],
    ['Application', 'Evidence', 'Selector', 'Presentation']]) {
    const name = parts.join(''), state = initial({phase: 3}); state[1] = [MAXIMUM, MAXIMUM, MAXIMUM, MAXIMUM, MAXIMUM, 512, MAXIMUM];
    const baseView = decode(presentation(0, 3));
    const assign = (amount, real) => {
      for (const [index, part] of parts.entries()) {
        const size = Math.floor(amount / parts.length) + (index < amount % parts.length ? 1 : 0);
        const value = real ? bytes(size, 51 + index) : sizedBytes(size);
        if (part === 'Application') state[3][2] = value;
        else if (part === 'Evidence') state[3][3][3] = value;
        else if (part === 'Selector') state[4][3] = value;
        else {
          const view = structuredClone(baseView); view[6].push([0, [4, real ? 'x'.repeat(size) : sizedBytes(size)]]);
          state[4][4] = real ? encodeView(view) : sizedBytes(measure(view));
        }
      }
    };
    let low = 0, high = MAXIMUM;
    while (low < high) {const mid = Math.ceil((low + high) / 2); assign(mid, false);
      if (measure([1, 0, compactState(state)]) <= MAXIMUM) low = mid; else high = mid - 1;}
    assign(low, true); const original = success(state); assert.equal(original.length, MAXIMUM);
    const shape = expectedLayout(state), values = replacements(state);
    values[2] = state[4][3].slice();
    const shown = structuredClone(decodePresentation(state[4][4])); shown[2] = 0;
    for (const item of shown[6]) if (item[0] === 1) item[1][item[1][0] === 8 ? 3 : 2] = true;
    values[3] = encodeView(shown);
    const after = success(rebound(state, values)); assert.equal(after.length, MAXIMUM);
    const intent = tailRequest(shape, values); assert.ok(intent.length <= MAXIMUM);
    yield {id: name + 'ExactState', entry: 'layout', request: original, response: expectedLayoutReply(state)};
    yield {id: name + 'ExactTail', entry: 'tail', request: intent, response: expectedTailReply(shape, values)};
    yield {id: name + 'ExactFinalValidation', entry: 'layout', request: after, response: expectedLayoutReply(rebound(state, values))};
    yield {id: name + 'BrowserExactComposition', composition: {state: original, values, response: after}};
    // Old complete request cannot hold even one extra wrapper byte at this size.
    yield {id: name + 'InputOneOver', entry: 'layout', request: joinBytes(original, bytes(1)), response: malformed(6)};
    if (parts[0] === 'Application' && parts.length === 1) {
      const larger = structuredClone(values); larger[0][3] = bytes(larger[0][3].length + 1, 77);
      assert.equal(measure([1, 0, compactState(rebound(state, larger))]), MAXIMUM + 1);
      yield {id: 'FinalStateOneOver', entry: 'tail', request: tailRequest(shape, larger), response: malformed(6)};
    }
  }
}
