// Independent protocol vectors, not deployed application or authority logic.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {encodeWire as encodeView} from '../../sdk/browser/presentation-wire.mjs';
import {manifest as effectManifest} from '../browser-effects/corpus.mjs';
import {compactOperation, compactState, encodeRequest, encodeSuccess} from './wire.mjs';
import {reservation} from './budget.mjs';

export const MAXIMUM = 67108864;
export const bytes = (size, value = 1) => new Uint8Array(size).fill(value);
export const binding = [effectManifest[0], effectManifest[1], bytes(32, 4), bytes(32, 5), bytes(32, 6), bytes(32, 7)];
export const limits = [4096, 4096, 4096, 4096, 4096, 3, 4096];
export const authority = [bytes(32, 8), bytes(32, 9), 7, bytes(4, 10)];
export const presentation = (revision = 0, phase = 0, secret = false) => encodeView([1, revision, phase, 0, 0, 0, [
 [0, [2, 0]], [1, [5, 1, phase === 0, false, 32, '', 0]],
 [1, [8, 2, 1, phase === 0, true, [2]]], [1, [8, 3, 2, phase === 0, false, []]],
 ...secret ? [[1, [10, 4, phase === 0, false, 32, 0]], [1, [8, 5, 3, phase === 0, false, [5]]]] : [],
]]);
export function initial(options = {}) {
 const revision = options.revision ?? 0, phase = options.phase ?? 0;
 return [structuredClone(binding), [...limits], encode(effectManifest),
  [bytes(32, 11), options.sequence ?? 0, options.application ?? bytes(3, 12), structuredClone(authority), [0]],
  [options.execution ?? bytes(32, 3), options.operation ?? 0, revision, bytes(2, 13), presentation(revision, phase, options.secret), phase]];
}
export const command = (state, action = 1, values = [[2, 'value']]) => [state[4][0], state[3][1], state[3][3], encodeView([1, state[4][2], action, values])];
export const effect = (state, resource = 'random', operation = [1, 3]) => encode([state[0][0], state[0][1], state[4][0], state[4][1], resource, operation]);
export const plan = (state, selected = command(state), predecessor = [0], request = effect(state), continuation = bytes(4, 14)) =>
 [selected, structuredClone(state), predecessor, request, continuation];
export const begin = (state, selected = command(state), selectedPlan = plan(state, selected)) => {
 const output = structuredClone(state); output[3][1]++; output[3][4] = [1, [selected, 1, selectedPlan[3], selectedPlan[4]]];
 output[4][1]++; output[4][2]++; output[4][4] = presentation(output[4][2], 1); output[4][5] = 1; return output;
};
export const completion = (state, result = [1, bytes(3, 15)]) => {
 const pending = state[3][4][1];
 return [state[0], state[3][0], pending[0], pending[1], pending[3], encode([decode(pending[2]), result])];
};
export const settle = (state, application = bytes(5, 16), selector = bytes(2, 17)) => {
 const output = structuredClone(state); output[3][2] = application; output[3][4] = [0];
 output[4][2]++; output[4][3] = selector; output[4][4] = presentation(output[4][2], 0); output[4][5] = 0; return output;
};
export const continued = (state, nextPlan, application = bytes(5, 16)) => {
 const output = structuredClone(state); output[3][2] = application;
 output[3][4] = [1, [nextPlan[0], state[3][4][1][1] + 1, nextPlan[3], nextPlan[4]]];
 output[4][1]++; output[4][2]++; output[4][4] = presentation(output[4][2], 1); return output;
};
const phase = (state, value) => {const output = structuredClone(state); output[4][2]++; output[4][4] = presentation(output[4][2], value); output[4][5] = value; return output;};
export const request = encodeRequest;
export const success = encodeSuccess;
export const rejected = error => encode([1, 1, error]);
export const malformed = error => encode([1, 2, error]);
const init = state => [0, state[0], state[1], state[2], state[3][0], state[4][0], state[3][2], state[3][3], state[4][3], state[4][4]];

export function maximumGrantVector() {
 const state = initial(), manifest = decode(state[2]);
 manifest[3] = Array.from({length: 63}, (_, index) => ['g' + String(index).padStart(2, '0') + 'x'.repeat([0, 20, 21, 124, 125][index % 5]), [1]]);
 manifest[3].push(['random', [1]]); state[2] = encode(manifest);
 const selected = command(state), prepared = plan(state, selected), active = begin(state, selected, prepared);
 return {id: 'Maximum64GrantsLinearFold', request: request([2, state, selected, prepared, active[4][4]]), response: success(active)};
}

export function corpus() {
 const rows = [], add = (id, operation, state) => rows.push({id, request: request(operation), response: success(state)});
 const no = (id, operation, code) => rows.push({id, request: request(operation), response: rejected(code)});
 const wire = (id, input, code) => rows.push({id, request: input, response: malformed(code)});
 const ready = initial(), selected = command(ready), selectedPlan = plan(ready, selected), pending = begin(ready, selected, selectedPlan);
 const result = completion(pending), settled = settle(pending), unknown = phase(pending, 2), closed = phase(pending, 3);
 add('Initialize', init(ready), ready);
 const read = structuredClone(ready); read[4][2]++; read[4][3] = bytes(3, 18); read[4][4] = presentation(1);
 add('ReadOnlyPreservesDurable', [1, ready, selected, read[4][3], read[4][4]], read);
 add('BeginExact', [2, ready, selected, selectedPlan, pending[4][4]], pending);
 add('ContextSharesBeginAdmission', [8, ready, ready, selected, selectedPlan, pending[4][4]], ready);
 add('SettleExact', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], settled);
 const nextPlan = plan(pending, pending[3][4][1][0], [1, [pending[3][4][1][3], result]]), next = continued(pending, nextPlan);
 add('ContinueExact', [4, pending, result, next[3][2], nextPlan, next[4][4]], next);
 add('UnknownRetainsPending', [5, pending, completion(pending, [9]), unknown[4][4]], unknown);
 add('CloseRetainsPending', [6, pending, closed[4][4]], closed);
 const closedUnknown = phase(unknown, 3);
 add('CloseRetainsUnknown', [6, unknown, closedUnknown[4][4]], closedUnknown);
 const rebound = structuredClone(settled); rebound[4] = [bytes(32, 19), 0, 0, bytes(2, 20), presentation(), 0];
 add('QuiescentRebindPreservesDurable', [7, settled, rebound[4][0], rebound[4][3], rebound[4][4]], rebound);
 for (const [name, state, code] of [['Pending', pending, 8], ['Unknown', unknown, 9], ['Closed', closed, 10]]) {
  no(name + 'RejectsOrdinary', [1, state, selected, bytes(0), presentation(state[4][2] + 1)], code);
  no(name + 'RejectsRebind', [7, state, bytes(32, 20), bytes(0), presentation()], 8);
 }
 no('ClosedLateCompletion', [3, closed, result, bytes(0), bytes(0), presentation(3)], 10);
 no('UnknownLateCompletion', [3, unknown, result, bytes(0), bytes(0), presentation(3)], 9);
 no('UnknownCannotSettle', [3, pending, completion(pending, [9]), bytes(0), bytes(0), presentation(2)], 9);
 no('TerminalCannotBecomeUnknown', [5, pending, result, presentation(2, 2)], 15);
 no('DuplicateClose', [6, closed, presentation(3, 3)], 10);
 for (const [name, mutate, code] of [
  ['CommandExecution', x => {x[0] = bytes(32, 21);}, 17], ['CommandSequence', x => {x[1]++;}, 13],
  ['Principal', x => {x[2][0] = bytes(32, 21);}, 4], ['Scope', x => {x[2][1] = bytes(32, 21);}, 4],
  ['Epoch', x => {x[2][2]++;}, 4], ['AuthorityEvidence', x => {x[2][3] = bytes(4, 21);}, 4],
  ['StaleIntent', x => {x[3] = encodeView([1, 1, 1, [[2, 'value']]]);}, 6],
  ['InvisibleAction', x => {x[3] = encodeView([1, 0, 4, []]);}, 6],
  ['WrongField', x => {x[3] = encodeView([1, 0, 1, [[3, 'value']]]);}, 6],
  ['MissingField', x => {x[3] = encodeView([1, 0, 1, []]);}, 6],
 ]) {const changed = structuredClone(selected); mutate(changed); no(name, [1, ready, changed, read[4][3], read[4][4]], code);}
 for (let field = 0; field < binding.length; field++) {
  const changed = structuredClone(selectedPlan); changed[1][0][field] = bytes(32, 25);
  no('PlanBeforeBinding' + field, [2, ready, selected, changed, pending[4][4]], 18);
  no('ContextBeforeBinding' + field, [8, ready, changed[1], selected, selectedPlan, pending[4][4]], 18);
 }
 for (const [name, mutate] of [
  ['Instance', x => {x[3][0] = bytes(32, 26);}], ['Application', x => {x[3][2] = bytes(3, 26);}],
  ['Counter', x => {x[3][1]++;}], ['Authority', x => {x[3][3][2]++;}],
  ['Selector', x => {x[4][3] = bytes(2, 26);}], ['Presentation', x => {x[4][4] = presentation(1);}],
  ['Execution', x => {x[4][0] = bytes(32, 26);}], ['EffectCounter', x => {x[4][1]++;}],
 ]) {const changed = structuredClone(selectedPlan); mutate(changed[1]); no('Before' + name, [2, ready, selected, changed, pending[4][4]], 18);}
 for (const [name, mutate] of [
  ['Binding', x => {x[0][2] = bytes(32, 27);}], ['Instance', x => {x[1] = bytes(32, 27);}],
  ['Command', x => {x[2][1]++;}], ['Principal', x => {x[2][2][0] = bytes(32, 27);}],
  ['Step', x => {x[3]++;}], ['Continuation', x => {x[4] = bytes(4, 27);}],
  ['Request', x => {const raw = decode(x[5]); raw[0][3]++; x[5] = encode(raw);}],
  ['Result', x => {const raw = decode(x[5]); raw[1] = [1, bytes(2)]; x[5] = encode(raw);}],
 ]) {const changed = structuredClone(result); mutate(changed); no('Completion' + name, [3, pending, changed, settled[3][2], settled[4][3], settled[4][4]], 15);}
 for (const [name, mutate] of [['Continuation', x => {x[2][1][0] = bytes(4, 28);}], ['Completion', x => {x[2][1][1][3]++;}],
  ['Command', x => {x[0][1]++;}], ['Before', x => {x[1][3][0] = bytes(32, 28);}]]) {
  const changed = structuredClone(nextPlan); mutate(changed);
  no('Continue' + name, [4, pending, result, next[3][2], changed, next[4][4]], name === 'Command' ? 14 : name === 'Before' ? 18 : 15);
 }
 const aba = structuredClone(rebound); aba[4] = [ready[4][0], 0, 0, bytes(2), presentation(), 0];
 add('RebindChangedExecutionNotFreshness', [7, rebound, aba[4][0], aba[4][3], aba[4][4]], aba);
 const abaCommand = command(aba), abaPlan = plan(aba, abaCommand), abaPending = begin(aba, abaCommand, abaPlan), abaSettled = settle(abaPending);
 assert.deepEqual(decode(abaPending[3][4][1][2]), decode(pending[3][4][1][2]), 'actual ABA primitive tuple repeats');
 no('ABAEarlierCommandEnvelopeRejected', [3, abaPending, result, abaSettled[3][2], abaSettled[4][3], abaSettled[4][4]], 15);
 add('ABACurrentCommandEnvelopeAccepted', [3, abaPending, completion(abaPending), abaSettled[3][2], abaSettled[4][3], abaSettled[4][4]], abaSettled);
 for (const [name, options, error] of [
  ['CommandOverflow', {sequence: 0xffffffff}, 11],
  ['EffectReservationOverflow', {operation: 0xffffffff - limits[5] + 1}, 11],
  ['RevisionReservationOverflow', {revision: 0xffffffff - limits[5] - 1}, 12],
 ]) {const state = initial(options), cmd = command(state), prepared = plan(state, cmd), view = presentation(state[4][2] + 1, 1);
  no(name, [2, state, cmd, prepared, view], error);
  no(name + 'Context', [8, state, state, cmd, prepared, view], 18);
 }
 const edge = initial({operation: 0xffffffff - limits[5], revision: 0xffffffff - limits[5] - 2});
 const edgeCommand = command(edge), edgePlan = plan(edge, edgeCommand), edgePending = begin(edge, edgeCommand, edgePlan);
 add('ExactCommandReservation', [2, edge, edgeCommand, edgePlan, edgePending[4][4]], edgePending);
 let state = edgePending;
 for (let step = 2; step <= limits[5]; step++) {const output = completion(state), nextPlan = plan(state, state[3][4][1][0], [1, [state[3][4][1][3], output]]), after = continued(state, nextPlan);
  add('ReservedContinuation' + step, [4, state, output, after[3][2], nextPlan, after[4][4]], after); state = after;}
 const atLimit = state, over = plan(atLimit, atLimit[3][4][1][0], [1, [atLimit[3][4][1][3], completion(atLimit)]]);
 no('MaximumStepsOneOver', [4, atLimit, completion(atLimit), bytes(0), over, presentation(atLimit[4][2] + 1, 1)], 16);
 const uncertainEdge = phase(atLimit, 2), closedEdge = phase(uncertainEdge, 3);
 add('ReservedUnknownAtEdge', [5, atLimit, completion(atLimit, [9]), uncertainEdge[4][4]], uncertainEdge);
 assert.equal(closedEdge[4][2], 0xffffffff);
 add('ReservedCloseAtEdge', [6, uncertainEdge, closedEdge[4][4]], closedEdge);
 for (const [name, mutate, code] of [
  ['ZeroLimit', x => {x[1][0] = 0;}, 0], ['OverLimit', x => {x[1][2] = MAXIMUM + 1;}, 0],
  ['ZeroSteps', x => {x[1][5] = 0;}, 0], ['StepsOneOver', x => {x[1][5] = 513;}, 0],
  ['BadBinding', x => {x[0][2] = bytes(31);}, 1], ['BadManifest', x => {x[0][0] = bytes(32, 30);}, 2],
  ['BadInstance', x => {x[3][0] = bytes(31);}, 3], ['BadAuthorityShape', x => {x[3][3][0] = bytes(31);}, 3],
  ['ApplicationOverBudget', x => {x[1][0] = 2;}, 3], ['SelectorOverBudget', x => {x[1][1] = 1;}, 3],
  ['EvidenceOverBudget', x => {x[1][3] = 1;}, 3],
 ]) {const changed = initial(); mutate(changed); no(name, init(changed), code);}
 no('ReadOnlyRevisionReserve', [1, initial({revision: 0xfffffffe}), command(initial({revision: 0xfffffffe})), bytes(0), presentation(0xffffffff)], 12);
 no('SameExecutionNotRebind', [7, ready, ready[4][0], bytes(0), presentation()], 17);
 no('WrongOutputPhase', [2, ready, selected, selectedPlan, presentation(1, 0)], 5);
 const oversizedSelector = bytes(limits[1] + 1);
 no('ReadOnlySelectorOver', [1, ready, selected, oversizedSelector, presentation(1)], 0);
 const malformedState = structuredClone(ready); malformedState[3][4] = pending[3][4];
 no('PendingInReadyState', [6, malformedState, presentation(1, 3)], 3);
 const unreachable = structuredClone(pending); unreachable[4][2] = 0xffffffff; unreachable[4][4] = presentation(0xffffffff, 1);
 no('PendingWithoutTerminalCapacity', [6, unreachable, presentation(0xffffffff, 3)], 3);
 const secretState = initial({secret: true}), secretCommand = command(secretState, 3, [[5, 'ephemeral']]);
 no('ExactSelectedSecretRefused', [1, secretState, secretCommand, bytes(0), presentation(1)], 7);
 const nonsecret = command(secretState, 2, []), secretRead = structuredClone(secretState);
 secretRead[4][2] = 1; secretRead[4][3] = bytes(0); secretRead[4][4] = presentation(1, 0, true);
 add('UnrelatedSecretDoesNotBlockOrdinary', [1, secretState, nonsecret, bytes(0), secretRead[4][4]], secretRead);
 const payload = bytes(3, 7), signature = bytes(64, 8), digest = 'sha256:' + 'a'.repeat(64);
 const operations = [
  ['Guest', 'guest', [0, [bytes(32, 4), 'Fixture.echoBytes', 'fixture/1', payload]], [0, payload]],
  ['Random', 'random', [1, 3], [1, payload]], ['Digest', 'digest', [2, payload], [2, digest]],
  ['Sign', 'sign', [3, payload], [3, signature]], ['Verify', 'verify', [4, [payload, signature]], [4, true]],
  ['Object', 'store', [5, digest], [5, [1, payload]]], ['Head', 'store', [6, 'head'], [6, [1, [digest, payload]]]],
  ['Commit', 'store', [7, ['head', [0], digest, [payload]]], [7, digest]],
 ];
 const allowedFailures = [[10, 11, 12], [0, 2], [0, 2], [0, 1, 2], [0, 2], [0, 2, 5, 7, 8, 9], [0, 2, 5, 7, 8, 9], [0, 2, 3, 4, 5, 6, 7, 8]];
 for (const [index, [name, resource, operation, output]] of operations.entries()) {
  const owned = plan(ready, selected, [0], effect(ready, resource, operation)), active = begin(ready, selected, owned), terminal = settle(active);
  add(name + 'SourceAdmission', [2, ready, selected, owned, active[4][4]], active);
  add(name + 'Terminal', [3, active, completion(active, output), terminal[3][2], terminal[4][3], terminal[4][4]], terminal);
  for (const [other, , , wrong] of operations) if (other !== name) no(name + 'Rejects' + other + 'Result', [3, active, completion(active, wrong), terminal[3][2], terminal[4][3], terminal[4][4]], 15);
  for (let failure = 0; failure < 13; failure++) {
   const operation = [3, active, completion(active, [8, [failure]]), terminal[3][2], terminal[4][3], terminal[4][4]];
   if (allowedFailures[index].includes(failure)) add(name + 'Failure' + failure, operation, terminal);
   else no(name + 'Failure' + failure, operation, 15);
  }
 }
 const maximumSteps = initial(); maximumSteps[1][5] = 512;
 const maximumCommand = command(maximumSteps), firstPlan = plan(maximumSteps, maximumCommand);
 let maximumState = begin(maximumSteps, maximumCommand, firstPlan);
 add('MaximumStepsBegin', [2, maximumSteps, maximumCommand, firstPlan, maximumState[4][4]], maximumState);
 for (let step = 2; step <= 512; step++) {
  const finished = completion(maximumState), following = plan(maximumState, maximumCommand, [1, [maximumState[3][4][1][3], finished]]), after = continued(maximumState, following);
  add('MaximumStep' + step, [4, maximumState, finished, after[3][2], following, after[4][4]], after); maximumState = after;
 }
 const maximumTerminal = settle(maximumState);
 add('MaximumStepsSettle', [3, maximumState, completion(maximumState), maximumTerminal[3][2], maximumTerminal[4][3], maximumTerminal[4][4]], maximumTerminal);
 rows.push(maximumGrantVector());
 for (const [name, mutate] of [
  ['Application', x => {x[0] = bytes(32, 43);}], ['Manifest', x => {x[1] = bytes(32, 43);}],
  ['Execution', x => {x[2] = bytes(32, 43);}], ['Operation', x => {x[3]++;}],
  ['Resource', x => {x[4] = 'unknown';}], ['OperationResource', x => {x[5] = [2, bytes(3)];}],
 ]) {const changed = structuredClone(selectedPlan), value = decode(changed[3]); mutate(value); changed[3] = encode(value);
  no('RequestAdmission' + name, [2, ready, selected, changed, pending[4][4]], 14);}
 const guestPlan = plan(ready, selected, [0], effect(ready, 'guest', operations[0][2]));
 for (const [name, mutate] of [['Artifact', x => {x[0] = bytes(32, 44);}], ['Entry', x => {x[1] = 'Fixture.otherBytes';}], ['Protocol', x => {x[2] = 'other/1';}]]) {
  const changed = structuredClone(guestPlan), value = decode(changed[3]); mutate(value[5][1]); changed[3] = encode(value);
  no('GuestAdmission' + name, [2, ready, selected, changed, pending[4][4]], 14);
 }
 for (const [steps, field] of [[1, 0], [1, 1], [1, 6], [3, 0], [3, 1], [3, 2], [3, 6]]) {
  const state = initial(); state[1][5] = steps; let low = state[1][field], high = MAXIMUM;
  while (low < high) {const value = Math.ceil((low + high) / 2); state[1][field] = value;
   if (reservation(begin(state, command(state))).fits) low = value; else high = value - 1;}
  state[1][field] = low;
  const cmd = command(state), prepared = plan(state, cmd), active = begin(state, cmd, prepared);
  assert.ok(reservation(active).maximum >= MAXIMUM - 1);
  add('FrameReservationEdge' + steps + '-' + field, [2, state, cmd, prepared, active[4][4]], active);
  state[1][field]++;
  const nextCommand = command(state), rejectedPlan = plan(state, nextCommand);
  assert.equal(reservation(begin(state, nextCommand, rejectedPlan)).fits, false);
  no('FrameReservationOneOver' + steps + '-' + field, [2, state, nextCommand, rejectedPlan, active[4][4]], 19);
 }
 {
  // Unlike the global-budget cases above, the current-state Settle envelope
  // uniquely controls this boundary. Its state/command/evidence/request/result
  // contributions must each be counted before the effect is admitted.
  const state=initial(); state[1][5]=1; state[1][1]=state[4][3].length;
  state[1][6]=Math.max(...[0,1,2,3].map(phase=>presentation(1,phase).length));
  let low=state[1][0],high=MAXIMUM;
  while(low<high){const middle=Math.ceil((low+high)/2);state[1][0]=middle;
   if(reservation(begin(state,command(state))).fits)low=middle;else high=middle-1;}
  state[1][0]=low;
  for(const extra of [0,1]) {
   state[1][0]=low+extra;
   const selected=command(state),prepared=plan(state,selected),active=begin(state,selected,prepared),bounds=reservation(active);
   assert.equal(bounds.frames[3],MAXIMUM+extra);
   assert.ok(bounds.frames.every((size,index)=>index===3||size<MAXIMUM-100));
   if(extra)no('FrameReservationCurrentOneOver',[2,state,selected,prepared,active[4][4]],19);
   else add('FrameReservationCurrentEdge',[2,state,selected,prepared,active[4][4]],active);
  }
 }
 const overView = initial(); overView[1][6] = overView[4][4].length - 1;
 no('InitializationPresentationBudget', init(overView), 3);
 {
  const state=initial(); state[1][6]=state[4][4].length;
  const cmd=command(state), prepared=plan(state,cmd), active=begin(state,cmd,prepared), completed=completion(active);
  const wide=(revision,phase)=>{const value=decode(presentation(revision,phase));value[6].push([0,[4,'budget']]);return encodeView(value);};
  no('ReadOnlyPresentationBudget',[1,state,cmd,bytes(0),wide(1,0)],5);
  no('BeginPresentationBudget',[2,state,cmd,prepared,wide(1,1)],5);
  no('ContextPresentationBudget',[8,state,state,cmd,prepared,wide(1,1)],18);
  no('RebindPresentationBudget',[7,state,bytes(32,30),bytes(0),wide(0,0)],5);
  no('SettlePresentationBudget',[3,active,completed,bytes(0),bytes(0),wide(2,0)],5);
  const continuation=plan(active,cmd,[1,[prepared[4],completed]]);
  no('ContinuePresentationBudget',[4,active,completed,bytes(0),continuation,wide(2,1)],5);
  no('UnknownPresentationBudget',[5,active,completion(active,[9]),wide(2,2)],5);
  no('ClosePresentationBudget',[6,active,wide(2,3)],5);
 }
 // Every contextual reference position has one fixed predecessor. Inline
 // equal values are rejected; unequal values still reach the typed guards.
 const references = [
  ['CommandAuthority', [2, ready, selected, selectedPlan, pending[4][4]], [2, 2], ready[3][3]],
  ['PlanCommand', [2, ready, selected, selectedPlan, pending[4][4]], [3, 0], compactOperation([2, ready, selected, selectedPlan, pending[4][4]])[2]],
  ['PlanBefore', [2, ready, selected, selectedPlan, pending[4][4]], [3, 1], compactState(ready)],
  ['ContextBefore', [8, ready, ready, selected, selectedPlan, pending[4][4]], [2], compactState(ready)],
  ['PendingAuthority', [6, pending, closed[4][4]], [1, 3, 4, 1, 0, 2], pending[3][3]],
  ['CompletionBinding', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 0], pending[0]],
  ['CompletionInstance', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 1], pending[3][0]],
  ['CompletionCommand', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 2], compactState(pending)[3][4][1][0]],
  ['CompletionContinuation', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 4], pending[3][4][1][3]],
  ['CompletionRequest', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 5, 0], pending[3][4][1][2]],
  ['PredecessorContinuation', [4, pending, result, next[3][2], nextPlan, next[4][4]], [4, 2, 1, 0], pending[3][4][1][3]],
  ['PredecessorCompletion', [4, pending, result, next[3][2], nextPlan, next[4][4]], [4, 2, 1, 1], compactOperation([3, pending, result, settled[3][2], settled[4][3], settled[4][4]])[2]],
 ];
 for (const [name, operation, path, equal] of references) {
  for (const [suffix, replacement, code] of [['ExplicitEqual', [1, equal], 5], ['ForeignIndex', [2], 3], ['ForwardIndex', [0xffffffff], 3], ['ReferenceTrailing', [0, 0], 3]]) {
   const value = compactOperation(operation); let at = value; for (const key of path.slice(0, -1)) at = at[key]; at[path.at(-1)] = replacement;
   wire(name + suffix, encode([1, value]), code);
  }
 }
 const absent = compactOperation([3, pending, result, settled[3][2], settled[4][3], settled[4][4]]);
 absent[1] = compactState(ready); wire('AbsentPendingCommandReference', encode([1, absent]), 3);
 absent[2][2] = [1, compactState(pending)[3][4][1][0]];
 wire('AbsentPendingContinuationReference', encode([1, absent]), 3);
 absent[2][4] = [1, pending[3][4][1][3]]; wire('AbsentPendingRequestReference', encode([1, absent]), 3);
 const embedded = [
  ['Manifest', init(ready), [3]], ['Presentation', init(ready), [9]],
  ['Intent', [2, ready, selected, selectedPlan, pending[4][4]], [2, 3]],
  ['Request', [2, ready, selected, selectedPlan, pending[4][4]], [3, 3]],
  ['Result', [3, pending, result, settled[3][2], settled[4][3], settled[4][4]], [2, 5, 1]],
 ];
 for (const [name, operation, path] of embedded) for (const [suffix, mutation, code] of [
  ['Trailing', value => Uint8Array.from([...value, 0]), 8], ['WrongType', () => Uint8Array.of(0), 3],
 ]) {const value = compactOperation(operation); let at = value; for (const key of path.slice(0, -1)) at = at[key];
  at[path.at(-1)] = mutation(at[path.at(-1)]); wire('Embedded' + name + suffix, encode([1, value]), code);}
 wire('WrongVersion', encode([2, init(ready)]), 3); wire('WrongOperation', request([9]), 3);
 wire('WrongTop', Uint8Array.of(0), 3); wire('UnsupportedHead', Uint8Array.of(0x9f), 4);
 wire('Trailing', Uint8Array.from([...request(init(ready)), 0]), 8);
 wire('NoncanonicalTop', Uint8Array.from([0x98, 2, ...request(init(ready)).slice(1)]), 5);
 const minimal = request([6, ready, presentation(1, 3)]);
 for (const at of [0, 1, 2, 3, 4, 20, minimal.length - 1]) wire('Truncated' + at, minimal.slice(0, at), 2);
 assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
 return rows;
}

export function wrapperCorpus() {
 const state = initial(), selected = command(state), active = begin(state, selected);
 const rows = [{id: 'SourceOwnedEffectAndView', request: encode([1, state, selected]), response: success(active)}];
 const navigation = command(state, 2, []), navigated = structuredClone(state);
 navigated[4][2]++; navigated[4][3] = bytes(3, 18); navigated[4][4] = presentation(1);
 rows.push({id: 'SourceOwnedReadOnly', request: encode([1, state, navigation]), response: success(navigated)});
 for (let field = 0; field < 4; field++) {
  const changed = initial(); changed[3][3][field] = field === 2 ? 8 : bytes(field === 3 ? 4 : 32, 31);
  rows.push({id: 'SourcePolicyRejects' + field, request: encode([1, changed, command(changed)]), response: rejected(4)});
 }
 const invisible = command(state, 4, []);
 rows.push({id: 'SourcePolicyRejectsUnmodeledAction', request: encode([1, state, invisible]), response: rejected(6)});
 return rows;
}
