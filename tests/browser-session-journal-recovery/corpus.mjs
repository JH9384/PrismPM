// Independent expected bytes for a private source component, not recovery logic.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {initial, begin, completion, settle, bytes, presentation, request as sessionRequest,
  rejected, malformed, success, corpus as sessionCorpus} from '../browser-session/corpus.mjs';
import {compactState} from '../browser-session/wire.mjs';

export const contextRequest = success;
export const contextSuccess = state => {
  const compact = compactState(state);
  return encode([1, 4, [...compact.slice(0, 4), [state[4][0], state[4][1], state[4][3]]]]);
};
export const recoveryRequest = (state, authority, execution, selector, view) =>
  encode([1, [1, compactState(state), authority, execution, selector, view]]);
const phase = (state, value) => {
  const output = structuredClone(state); output[4][2]++;
  output[4][4] = presentation(output[4][2], value); output[4][5] = value; return output;
};
export function recoveryCorpus() {
  const rows = [], contexts = [], ready = initial(), pending = begin(ready),
    unknown = phase(pending, 2), closed = phase(pending, 3), closedUnknown = phase(unknown, 3),
    quiescentClosed = phase(ready, 3), terminal = settle(pending);
  const authority = structuredClone(ready[3][3]); authority[2]++;
  authority[3] = bytes(5, 22);
  const execution = bytes(32, 23), selector = bytes(3, 24), view = presentation();
  const rebound = (state, admitted = authority, next = execution, selection = selector, shown = view) => {
    const output = structuredClone(state); output[3][3] = structuredClone(admitted);
    output[4] = [next, 0, 0, selection, shown, 0]; return output;
  };
  const request = (state, admitted = authority, next = execution, selection = selector, shown = view) =>
    recoveryRequest(state, admitted, next, selection, shown);
  const add = (id, state, admitted = authority) => rows.push({id,
    request: request(state, admitted), response: success(rebound(state, admitted))});
  const no = (id, state, code, admitted = authority, next = execution, selection = selector, shown = view) =>
    rows.push({id, request: request(state, admitted, next, selection, shown), response: rejected(code)});
  for (const [name, state] of [['Ready', ready], ['ClosedQuiescent', quiescentClosed], ['Settled', terminal]]) {
    add(name + 'NewEpoch', state); add(name + 'SameEpoch', state, state[3][3]);
  }
  const counters = initial({sequence: 0xffffffff, operation: 0xffffffff, revision: 0xffffffff, phase: 3});
  counters[3][3][2] = 0xffffffff;
  add('MaximumCountersResetOnlyVolatile', counters, counters[3][3]);
  for (const [name, state] of [['Prepared', pending], ['Unknown', unknown], ['ClosedPending', closed], ['ClosedUnknown', closedUnknown]]) {
    no(name + 'CannotRecoverWithoutTerminal', state, 8);
    contexts.push({id: name + 'Context', request: contextRequest(state), response: contextSuccess(state)});
  }
  assert.deepEqual(contextSuccess(pending), contextSuccess(unknown));
  assert.deepEqual(contextSuccess(pending), contextSuccess(closed));
  assert.deepEqual(contextSuccess(pending), contextSuccess(closedUnknown));
  for (const [name, state] of [['Ready', ready], ['ClosedQuiescent', quiescentClosed], ['Settled', terminal]])
    contexts.push({id: name + 'Context', request: contextRequest(state), response: contextSuccess(state)});
  for (const [name, change] of [
    ['Principal', x => {x[0] = bytes(32, 25);}], ['Scope', x => {x[1] = bytes(32, 25);}],
    ['EpochRollback', x => {x[2] = ready[3][3][2] - 1;}], ['PrincipalLength', x => {x[0] = bytes(31);}],
    ['ScopeLength', x => {x[1] = bytes(33);}], ['EvidenceOver', x => {x[3] = bytes(ready[1][3] + 1);}],
  ]) {const value = structuredClone(authority); change(value); no(name, quiescentClosed, 4, value);}
  for (const [name, value] of [['SameExecution', ready[4][0]], ['ShortExecution', bytes(31)], ['LongExecution', bytes(33)]])
    no(name, quiescentClosed, 17, authority, value);
  no('SelectorOver', quiescentClosed, 0, authority, execution, bytes(ready[1][1] + 1));
  no('ViewRevision', quiescentClosed, 5, authority, execution, selector, presentation(1));
  no('ViewPhase', quiescentClosed, 5, authority, execution, selector, presentation(0, 3));
  const smallView = structuredClone(quiescentClosed); smallView[1][6] = smallView[4][4].length;
  const wide = decode(view); wide[6].push([0, [4, 'longer presentation']]);
  no('PresentationOver', smallView, 5, authority, execution, selector, encode(wide));
  const malformedState = structuredClone(quiescentClosed); malformedState[3][0] = bytes(31);
  no('InvalidPredecessor', malformedState, 3);
  contexts.push({id: 'InvalidContextPredecessor', request: contextRequest(malformedState), response: rejected(3)});
  for (let index = 0; index < ready[0].length; index++) {
    const state = structuredClone(ready);
    if (index < 2) {const manifest = decode(state[2]); manifest[index] = bytes(32, 26); state[2] = encode(manifest);}
    state[0][index] = bytes(32, 26);
    contexts.push({id: 'ContextBindsClosure' + index, request: contextRequest(state), response: contextSuccess(state)});
    assert.notDeepEqual(contextSuccess(state), contextSuccess(ready));
  }
  for (const [name, change] of [
    ['Limits', x => {x[1][0]++;}], ['Instance', x => {x[3][0] = bytes(32, 27);}],
    ['Command', x => {x[3][1]++;}], ['Application', x => {x[3][2] = bytes(3, 27);}],
    ['Authority', x => {x[3][3][2]++;}], ['Evidence', x => {x[3][3][3] = bytes(4, 27);}],
    ['Execution', x => {x[4][0] = bytes(32, 27);}], ['NextEffect', x => {x[4][1]++;}],
    ['Selector', x => {x[4][3] = bytes(2, 27);}],
  ]) {const state = structuredClone(ready); change(state);
    contexts.push({id: 'ContextBinds' + name, request: contextRequest(state), response: contextSuccess(state)});
    assert.notDeepEqual(contextSuccess(state), contextSuccess(ready));
  }
  for (let index = 1; index < ready[1].length; index++) {
    const state = structuredClone(ready); state[1][index]++;
    contexts.push({id: 'ContextBindsLimit' + index, request: contextRequest(state), response: contextSuccess(state)});
    assert.notDeepEqual(contextSuccess(state), contextSuccess(ready));
  }
  for (const [name, change] of [
    ['Sequence', x => {x[3][1]++; x[3][4][1][0][1]++;}],
    ['Step', x => {x[3][4][1][1]++;}],
    ['Continuation', x => {x[3][4][1][3] = bytes(5, 28);}],
    ['Request', x => {const value = decode(x[3][4][1][2]); value[5][1]++; x[3][4][1][2] = encode(value);}],
    ['Intent', x => {const value = decode(x[3][4][1][0][3]); value[3][0][1] = 'changed'; x[3][4][1][0][3] = encode(value);}],
    ['Authority', x => {x[3][3][2]++; x[3][4][1][0][2] = structuredClone(x[3][3]);}],
    ['Execution', x => {x[4][0] = bytes(32, 28); x[3][4][1][0][0] = x[4][0];
      const value = decode(x[3][4][1][2]); value[2] = x[4][0]; x[3][4][1][2] = encode(value);}],
    ['Counter', x => {x[4][1]++; const value = decode(x[3][4][1][2]); value[3]++; x[3][4][1][2] = encode(value);}],
  ]) {
    const state = structuredClone(pending); change(state);
    contexts.push({id: 'ContextBindsPending' + name, request: contextRequest(state), response: contextSuccess(state)});
    assert.notDeepEqual(contextSuccess(state), contextSuccess(pending));
  }
  const changedManifest = structuredClone(ready), manifest = decode(changedManifest[2]);
  manifest[3].push(['zzextra', [1]]); changedManifest[2] = encode(manifest);
  contexts.push({id: 'ContextBindsManifest', request: contextRequest(changedManifest), response: contextSuccess(changedManifest)});
  assert.notDeepEqual(contextSuccess(changedManifest), contextSuccess(ready));
  const alternateView = structuredClone(ready), alternate = decode(alternateView[4][4]);
  alternate[6].push([0, [4, 'presentation is intentionally excluded']]); alternateView[4][4] = encode(alternate);
  contexts.push({id: 'ContextExcludesOnlyPresentation', request: contextRequest(alternateView), response: contextSuccess(alternateView)});
  assert.deepEqual(contextSuccess(alternateView), contextSuccess(ready));
  const oldTerminal = sessionCorpus().filter(row => ['ClosedLateCompletion', 'UnknownLateCompletion'].includes(row.id));
  assert.equal(oldTerminal.length, 2, 'unchanged DK26 refuses late completions');
  const composition = [{id: 'TerminalThenQuiescentRecovery',
    prepared: success(pending), current: success(closed),
    settleRequest: sessionRequest([3, pending, completion(pending), terminal[3][2], terminal[4][3], terminal[4][4]]),
    settleResponse: success(terminal), recoveryRequest: request(terminal),
    recoveryResponse: success(rebound(terminal))}];
  // These are independently expected source frames, not authenticated receipts.
  // The real journal must verify descriptor-plan linkage and external witnesses.
  for (const group of [rows, contexts]) {
    const original = group.slice();
    for (const row of original.slice(0, 7)) {
      const trailing = new Uint8Array(row.request.length + 1); trailing.set(row.request);
      group.push({id: row.id + 'Trailing', request: trailing, response: malformed(8)});
    }
    assert.equal(new Set(group.map(row => row.id)).size, group.length);
  }
  for (const [group, example] of [[rows, rows[0]], [contexts, contexts[0]]]) {
    for (let length = 0; length < example.request.length; length++)
      group.push({id: 'Truncated' + length, request: example.request.slice(0, length), response: malformed(2)});
    const value = decode(example.request), wrongVersion = structuredClone(value); wrongVersion[0] = 2;
    group.push({id: 'WrongVersion', request: encode(wrongVersion), response: malformed(3)});
    group.push({id: 'NoncanonicalTop', request: Uint8Array.of(0x98, value.length, ...example.request.slice(1)), response: malformed(5)});
    group.push({id: 'IndefiniteTop', request: Uint8Array.of(0x9f, ...example.request.slice(1)), response: malformed(4)});
    assert.equal(new Set(group.map(row => row.id)).size, group.length);
  }
  return {recovery: rows, context: contexts, composition, unchangedLateCompletion: oldTerminal};
}
