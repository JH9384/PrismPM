// Independent canonical-wire expectations, never deployed recovery decisions.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {initial, begin, settle, bytes, presentation, success, rejected, malformed,
  corpus as sessionCorpus} from '../browser-session/corpus.mjs';
import {compactState, expandState} from '../browser-session/wire.mjs';

export const MAXIMUM = 67108864;
export function joinBytes(...values) {
  const output = new Uint8Array(values.reduce((sum, value) => sum + value.length, 0));
  let at = 0; for (const value of values) {output.set(value, at); at += value.length;} return output;
}
export function expectedLayout(state) {
  // Measure independent actual canonical encodings, not the source size fold.
  const frame = success(state), oldTail = joinBytes(encode(state[3][3]), encode(state[3][4]), encode(state[4]));
  assert.deepEqual(frame.slice(frame.length - oldTail.length), oldTail);
  return [frame.length - oldTail.length, state[1], state[3][3][0], state[3][3][1], state[3][3][2], state[4][0]];
}
export const expectedLayoutReply = state => encode([1, 6, expectedLayout(state)]);
export const replacements = state => [structuredClone(state[3][3]), bytes(32, 23), bytes(3, 24), presentation()];
export const tailRequest = (layout, values) => encode([1, [1, layout, ...values]]);
export const oldRecoveryRequest = (state, values) => encode([1, [1, compactState(state), ...values]]);
export function rebound(state, values) {
  const output = structuredClone(state); output[3][3] = values[0];
  output[4] = [values[1], 0, 0, values[2], values[3], 0]; return output;
}
export const expectedTail = values => joinBytes(encode(values[0]), encode([0]),
  encode([values[1], 0, 0, values[2], values[3], 0]));
export const expectedTailReply = (layout, values) => encode([1, 7, [layout[0], expectedTail(values)]]);

export function corpus() {
  const layout = [], tail = [], parity = [], composition = [];
  const positive = (id, state, values = replacements(state)) => {
    const shape = expectedLayout(state), after = rebound(state, values);
    layout.push({id, request: success(state), response: expectedLayoutReply(state)});
    tail.push({id, request: tailRequest(shape, values), response: expectedTailReply(shape, values)});
    parity.push({id, request: oldRecoveryRequest(state, values), response: success(after)});
    composition.push({id, state: success(state), values, response: success(after)});
  };
  for (const phase of [0, 3]) for (const sequence of [0, 23, 24, 255, 256, 65535, 65536, 0xffffffff]) {
    // Ready revision UINT32_MAX is already invalid in the unchanged kernel;
    // preserve maximal durable/effect counters with its last legal revision.
    const state = initial({phase, sequence, revision: phase === 0 && sequence === 0xffffffff ? sequence - 1 : sequence, operation: sequence});
    const values = replacements(state); values[0][2] = 0xffffffff;
    positive('Phase' + phase + 'Counter' + sequence, state, values);
  }
  positive('Settled', settle(begin(initial())));
  const baseline = initial(), shape = expectedLayout(baseline), valid = replacements(baseline);
  for (const size of [0, 23, 24, 255, 256, 1024]) {
    const state = initial({application: bytes(size, 41)}); state[3][3][3] = bytes(size, 42);
    positive('CanonicalLength' + size, state);
  }
  for (const row of sessionCorpus()) {
    const reply = decode(row.response);
    if (reply[1] !== 0 || !Array.isArray(reply[2])) continue;
    const state = expandState(reply[2]), quiet = [0, 3].includes(state[4][5]) && state[3][4][0] === 0;
    layout.push({id: 'Original' + row.id, request: row.response,
      response: quiet ? expectedLayoutReply(state) : rejected(8)});
  }
  const reject = (id, values, error, selectedLayout = shape) => tail.push({id,
    request: tailRequest(selectedLayout, values), response: rejected(error)});
  for (const [id, change] of [
    ['Principal', v => {v[0][0] = bytes(32, 25);}], ['Scope', v => {v[0][1] = bytes(32, 25);}],
    ['EpochRollback', v => {v[0][2]--;}], ['PrincipalShort', v => {v[0][0] = bytes(31);}],
    ['ScopeLong', v => {v[0][1] = bytes(33);}], ['EvidenceOver', v => {v[0][3] = bytes(baseline[1][3] + 1);}],
  ]) {const value = structuredClone(valid); change(value); reject(id, value, 4);
    parity.push({id, request: oldRecoveryRequest(baseline, value), response: rejected(4)});}
  for (const [id, execution] of [['SameExecution', baseline[4][0]], ['ShortExecution', bytes(31)], ['LongExecution', bytes(33)]]) {
    const value = structuredClone(valid); value[1] = execution; reject(id, value, 17);
    parity.push({id, request: oldRecoveryRequest(baseline, value), response: rejected(17)});
  }
  for (const [id, change, error] of [
    ['SelectorOver', v => {v[2] = bytes(baseline[1][1] + 1);}, 0],
    ['ViewRevision', v => {v[3] = presentation(1);}, 5],
    ['ViewPhase', v => {v[3] = presentation(0, 3);}, 5],
  ]) {const value = structuredClone(valid); change(value); reject(id, value, error);
    parity.push({id, request: oldRecoveryRequest(baseline, value), response: rejected(error)});}
  const tight = initial(); tight[1][6] = tight[4][4].length;
  const overflowing = structuredClone(shape); overflowing[0] = MAXIMUM - expectedTail(valid).length + 1;
  tail.push({id: 'FinalStateOneOver', request: tailRequest(overflowing, valid), response: malformed(6)});
  const wide = decode(valid[3]); wide[6].push([0, [4, 'longer presentation']]);
  const values = structuredClone(valid); values[3] = encode(wide);
  reject('PresentationOver', values, 5, expectedLayout(tight));
  for (const [id, change] of [
    ['ZeroPrefix', v => {v[0] = 0;}], ['PrefixOver', v => {v[0] = MAXIMUM + 1;}],
    ['ZeroLimit', v => {v[1][0] = 0;}], ['LimitOver', v => {v[1][0] = MAXIMUM + 1;}],
    ['ZeroSteps', v => {v[1][5] = 0;}], ['StepsOver', v => {v[1][5] = 513;}],
    ['PrincipalShort', v => {v[2] = bytes(31);}], ['ScopeShort', v => {v[3] = bytes(31);}],
    ['ExecutionShort', v => {v[5] = bytes(31);}],
  ]) {const changed = structuredClone(shape); change(changed); reject('Layout' + id, valid, 3, changed);}
  for (const index of [2, 3, 5]) {
    const changed = structuredClone(shape); changed[index] = bytes(33);
    tail.push({id: 'LayoutFieldLong' + index, request: tailRequest(changed, valid), response: malformed(6)});
  }
  const invalid = initial(); invalid[3][0] = bytes(31);
  layout.push({id: 'InvalidState', request: success(invalid), response: rejected(3)});
  const exhaustedReady = initial({revision: 0xffffffff});
  layout.push({id: 'ReadyRevisionExhausted', request: success(exhaustedReady), response: rejected(3)});
  parity.push({id: 'ReadyRevisionExhausted', request: oldRecoveryRequest(exhaustedReady, valid), response: rejected(3)});
  const pending = begin(initial()), unknown = structuredClone(pending), closed = structuredClone(pending);
  unknown[4][5] = 2; unknown[4][4] = presentation(unknown[4][2], 2);
  closed[4][5] = 3; closed[4][4] = presentation(closed[4][2], 3);
  for (const [id, state] of [['Pending', pending], ['Unknown', unknown], ['ClosedPending', closed]])
    layout.push({id, request: success(state), response: rejected(8)});
  for (const group of [layout, tail]) {
    const sample = group[0];
    group.push({id: 'Trailing', request: joinBytes(sample.request, bytes(1)), response: malformed(8)});
    for (let size = 0; size < sample.request.length; size++)
      group.push({id: 'Truncated' + size, request: sample.request.slice(0, size), response: malformed(2)});
    const value = decode(sample.request); value[0] = 2;
    group.push({id: 'Version', request: encode(value), response: malformed(3)});
    group.push({id: 'NoncanonicalArray', request: joinBytes(Uint8Array.of(0x98, decode(sample.request).length), sample.request.slice(1)), response: malformed(5)});
    group.push({id: 'IndefiniteArray', request: joinBytes(Uint8Array.of(0x9f), sample.request.slice(1)), response: malformed(4)});
    for (const bad of [0, true, 'not-an-array', bytes(0)])
      group.push({id: 'OuterType' + typeof bad, request: encode(bad), response: malformed(3)});
    const short = decode(sample.request).slice(0, -1);
    group.push({id: 'OuterShort', request: encode(short), response: malformed(3)});
    const long = [...decode(sample.request), 0];
    group.push({id: 'OuterLong', request: encode(long), response: malformed(6)});
    const typed = decode(sample.request); typed[0] = true;
    group.push({id: 'VersionType', request: encode(typed), response: malformed(3)});
    assert.equal(new Set(group.map(row => row.id)).size, group.length);
  }
  for (const [id, path] of [['Tag', [1, 0]], ['Prefix', [1, 1, 0]], ['Epoch', [1, 1, 4]],
    ['AuthorityEpoch', [1, 2, 2]], ['Limit', [1, 1, 1, 0]], ['StepLimit', [1, 1, 1, 5]]]) {
    for (const [suffix, value, error] of [['Type', true, 3], ['Overflow', Uint8Array.of(0xde, 0xad, 0xfe, 0xed, 0xf1, 0xe2, 0xd3, 0xc4), 4]]) {
      const changed = decode(tail[0].request); let target = changed;
      for (const key of path.slice(0, -1)) target = target[key]; target[path.at(-1)] = value;
      let request = encode(changed);
      if (suffix === 'Overflow') {
        const marker = encode(value), offset = Buffer.from(request).indexOf(marker);
        assert.ok(offset >= 0); assert.equal(Buffer.from(request).lastIndexOf(marker), offset);
        request = joinBytes(request.subarray(0, offset), Uint8Array.of(0x1b, 0, 0, 0, 1, 0, 0, 0, 0),
          request.subarray(offset + marker.length));
      }
      tail.push({id: id + suffix, request, response: malformed(error)});
    }
  }
  return {layout, tail, parity, composition};
}
