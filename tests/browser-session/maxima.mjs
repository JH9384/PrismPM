// Actual maximum payloads for the private source kernel. Virtual sizing only
// chooses boundaries; each yielded vector contains real complete byte frames.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {encodeWire as encodeView} from '../../sdk/browser/presentation-wire.mjs';
import {initial, command, plan, begin, completion, continued, settle, effect, bytes, presentation, request, success, rejected, malformed, MAXIMUM} from './corpus.mjs';
import {compactState, compactOperation} from './wire.mjs';
import {measure, reservation, sizedBytes} from './budget.mjs';

const initialize = s => [0, s[0], s[1], s[2], s[3][0], s[4][0], s[3][2], s[3][3], s[4][3], s[4][4]];
const boundary = measureAt => {
  let low = 0, high = MAXIMUM;
  while (low < high) {const mid = Math.ceil((low + high) / 2); if (measureAt(mid) <= MAXIMUM) low = mid; else high = mid - 1;}
  return low;
};
const row = (id, op, result) => ({id, request: request(op), response: success(result)});
const stateSize = s => measure([1, 0, compactState(s)]);

export function* maximumVectors() {
  for (const [name, parts] of [['Application', ['application']], ['Evidence', ['evidence']], ['Mixed', ['application', 'evidence', 'selector']]]) {
    const state = initial(); state[1][0] = state[1][1] = state[1][3] = MAXIMUM;
    const assign = (total, real) => {
      for (const [index, part] of parts.entries()) {
        const length = Math.floor(total / parts.length) + (index < total % parts.length ? 1 : 0), value = real ? bytes(length, 41 + index) : sizedBytes(length);
        if (part === 'application') state[3][2] = value; else if (part === 'selector') state[4][3] = value; else state[3][3][3] = value;
      }
    };
    const size = boundary(n => {assign(n, false); return stateSize(state);});
    assign(size, true); assert.equal(stateSize(state), MAXIMUM);
    yield row(name + 'ExactMaximumReply', initialize(state), state);
    assign(size + 1, true); assert.equal(stateSize(state), MAXIMUM + 1);
    yield {id: name + 'OneOverReply', request: request(initialize(state)), response: rejected(19)};
  }
  {
    const state = initial(); state[1][4] = MAXIMUM;
    const view = decode(state[4][4]); view[6][1][1][4] = MAXIMUM; state[4][4] = encodeView(view);
    const selected = command(state);
    const inputSize = n => {selected[3] = sizedBytes(measure([1, 0, 1, [[2, sizedBytes(n)]]]));
      return measure([1, compactOperation([1, state, selected, bytes(0), presentation(1)])]);};
    const length = boundary(inputSize); selected[3] = encodeView([1, 0, 1, [[2, 'x'.repeat(length)]]]);
    const after = structuredClone(state); after[4][2] = 1; after[4][3] = bytes(0); after[4][4] = presentation(1);
    const vector = row('ExactMaximumOrdinaryIntentFrame', [1, state, selected, after[4][3], after[4][4]], after);
    assert.equal(vector.request.length, MAXIMUM); yield vector;
  }
  {
    // Two genuinely different large presentations coexist in one complete
    // ReadOnly frame; neither a scalar-only maximum nor a repeated alias.
    const state = initial(), selected = command(state), base0 = decode(presentation()), base1 = decode(presentation(1));
    const viewSize = n => presentation().length + 4 + measure(sizedBytes(n));
    const inputSize = n => {state[1][6] = viewSize(n); state[4][4] = sizedBytes(viewSize(n));
      return measure([1, compactOperation([1, state, selected, bytes(0), sizedBytes(viewSize(n))])]);};
    const length = boundary(inputSize), remainder = MAXIMUM - inputSize(length); assert.ok(remainder <= 1);
    base0[6].push([0, [4, 'x'.repeat(length)]]); base1[6].push([0, [4, 'y'.repeat(length)]]);
    state[4][4] = encodeView(base0); const nextView = encodeView(base1), selector = bytes(remainder);
    assert.equal(state[4][4].length, state[1][6]); assert.equal(nextView.length, state[1][6]);
    const after = structuredClone(state); after[4][2] = 1; after[4][3] = selector; after[4][4] = nextView;
    const vector = row('ExactMaximumDistinctPresentations', [1, state, selected, selector, nextView], after);
    assert.equal(vector.request.length, MAXIMUM); yield vector;
  }
  {
    const state = initial(); state[1][2] = MAXIMUM; state[1][5] = 1;
    const selected = command(state), prepared = plan(state, selected, [0], effect(state), bytes(33554433, 51)), active = begin(state, selected, prepared);
    assert.equal(reservation(active).fits, true);
    yield row('SharedContinuationBeyondOldHalfFrame', [2, state, selected, prepared, active[4][4]], active);
    const terminal = settle(active); yield row('SharedLargeContinuationTerminal', [3, active, completion(active), terminal[3][2], terminal[4][3], terminal[4][4]], terminal);
    const unknown = structuredClone(active); unknown[4][2]++; unknown[4][4] = presentation(unknown[4][2], 2); unknown[4][5] = 2;
    yield row('SharedLargeContinuationUnknown', [5, active, completion(active, [9]), unknown[4][4]], unknown);
    const closed = structuredClone(unknown); closed[4][2]++; closed[4][4] = presentation(closed[4][2], 3); closed[4][5] = 3;
    yield row('SharedLargeContinuationClose', [6, unknown, closed[4][4]], closed);
  }
  {
    const state = initial(); state[1][5] = 2;
    const selected = command(state), firstObjects = Array.from({length: 16}, (_, i) => bytes(1048576, i + 1)), nextObjects = Array.from({length: 16}, (_, i) => bytes(1048576, i + 65));
    const firstDigest = 'sha256:' + 'a'.repeat(64), nextDigest = 'sha256:' + 'b'.repeat(64);
    const prepared = plan(state, selected, [0], effect(state, 'store', [7, ['head', [0], firstDigest, firstObjects]])), active = begin(state, selected, prepared);
    assert.equal(reservation(active).fits, true); yield row('MaximumCommitBegin', [2, state, selected, prepared, active[4][4]], active);
    const terminal = completion(active, [7, firstDigest]), nextPlan = plan(active, selected, [1, [prepared[4], terminal]], effect(active, 'store', [7, ['head', [1, firstDigest], nextDigest, nextObjects]]));
    const next = continued(active, nextPlan); assert.equal(reservation(next).fits, true);
    yield row('MaximumDistinctCommitContinuation', [4, active, terminal, next[3][2], nextPlan, next[4][4]], next);
    const final = settle(next); yield row('MaximumCommitTerminal', [3, next, completion(next, [7, nextDigest]), final[3][2], final[4][3], final[4][4]], final);
  }
  {
    // Exact mixed multi-step envelope: large old/new continuations, maximum
    // real Random result, distinct replacement state/view and full-width
    // counters. No repeated context payload is charged or silently omitted.
    const state = initial({operation: 0xffffffff - 2, revision: 0xffffffff - 4, application: bytes(1)});
    state[4][3] = bytes(1); state[1][0] = state[1][1] = 1; state[1][5] = 2;
    state[1][6] = state[4][4].length;
    const manifest = decode(state[2]); manifest[3] = [['random', [1]]]; state[2] = encode(manifest);
    const selected = command(state), req = effect(state, 'random', [1, 65536]);
    const size = boundary(n => {state[1][2] = Math.max(1, n); const prepared = plan(state, selected, [0], req, sizedBytes(n));
      return reservation(begin(state, selected, prepared)).maximum;});
    state[1][2] = size;
    const prepared = plan(state, selected, [0], req, bytes(size, 61)), active = begin(state, selected, prepared);
    assert.equal(reservation(active).fits, true);
    yield row('AggregateContinuationBegin', [2, state, selected, prepared, active[4][4]], active);
    const terminal = completion(active, [1, bytes(65536, 62)]), nextPlan = plan(active, selected, [1, [prepared[4], terminal]], effect(active, 'random', [1, 65536]), bytes(size, 63));
    const next = continued(active, nextPlan, bytes(1, 64));
    const vector = row('AggregateMaximumDistinctContinuation', [4, active, terminal, next[3][2], nextPlan, next[4][4]], next);
    assert.ok(vector.request.length >= MAXIMUM - 1); yield vector;
    const final = settle(next, bytes(1, 65), bytes(1, 66));
    yield row('AggregateMaximumRandomTerminal', [3, next, completion(next, [1, bytes(65536, 67)]), final[3][2], final[4][3], final[4][4]], final);
  }
}

// Conditional request/result-domain maxima, not execution of these effects.
export function* effectResultMaxima() {
 for(const family of ['Guest','Object','Head']) {
  const state=initial();state[1][5]=1;const manifest=decode(state[2]);
  const guest=manifest[3].find(row=>row[0]==='guest')[1][1];guest[3]=guest[4]=2097152;guest[5]=256;
  state[2]=encode(manifest);const selected=command(state),digest='sha256:'+'d'.repeat(64);
  const operation=family==='Guest'?[0,[guest[0],guest[1],guest[2],bytes(2097152,71)]]
   :family==='Object'?[5,digest]:[6,'head'];
  const prepared=plan(state,selected,[0],effect(state,family==='Guest'?'guest':'store',operation)),active=begin(state,selected,prepared);
  const length=family==='Guest'?2097152:1048576;
  const result=size=>family==='Guest'?[0,bytes(size,72)]:family==='Object'?[5,[1,bytes(size,73)]]:[6,[1,[digest,bytes(size,74)]]];
  assert.equal(reservation(active).fits,true);
  yield row('Maximum'+family+'Begin',[2,state,selected,prepared,active[4][4]],active);
  const after=settle(active);
  yield row('Maximum'+family+'Terminal',[3,active,completion(active,result(length)),after[3][2],after[4][3],after[4][4]],after);
  yield {id:'Maximum'+family+'ResultOneOver',request:request([3,active,completion(active,result(length+1)),after[3][2],after[4][3],after[4][4]]),response:malformed(6)};
 }
}
