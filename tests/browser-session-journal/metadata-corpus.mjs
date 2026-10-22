// Independent finite metadata expectations, not an implementation or authority.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';

export const reference = value => new Uint8Array(32).fill(value);
export const payload = (value, length = 8) => [reference(value), length,
  Array.from({length: Math.ceil(length / 1048576)}, (_, index) => reference(value + index + 1))];
export const binding = [Array.from({length: 6}, (_, index) => reference(index + 1)), reference(7), reference(8),
  Uint8Array.of(4, ...new Uint8Array(64).fill(9)), 'session-journal', 'private-journal', 'head', 'staging', 1024, reference(10)];
const none = () => [0], some = value => [1, value];
export const ready = [payload(20), 4, 0, 0, none()];
export const genesisEnvelope = payload(30, 512);
export const initial = [binding, genesisEnvelope[0], 0, genesisEnvelope[0], 0, ready, none()];
const success = value => [1, 0, value], failure = code => [1, 1, code], malformed = code => [1, 2, code];
const changed = (value, index, replacement) => {const next = structuredClone(value); next[index] = replacement; return next;};
const position = (value, phase, nextCommand, pending = none(), epoch = 4) => [payload(value), epoch, phase, nextCommand, pending];
export const record = (state, kind, after, {operation = payload(40), receipt = none(), frontier = none(), recovery = none()} = {}) =>
  [state[0], state[1], state[2] + 1, state[3], kind, state[5], operation, after, receipt, frontier, recovery];
const committed = (state, row, envelope, anchor, retained = state[4] + 1) =>
  [state[0], state[1], row[2], envelope[0], retained, row[7], anchor];

export function metadataExamples() {
  const step = [0, 1, 512], busy = position(21, 1, 1, some(step)), begin = record(initial, 2, busy), envelope = payload(31, 512);
  const anchor = [envelope, busy, step, none()], pending = committed(initial, begin, envelope, some(anchor));
  const receipt = payload(50), nextStep = [0, 2, 512], continuedPosition = position(22, 1, 1, some(nextStep));
  const continued = record(pending, 4, continuedPosition, {receipt: some(receipt)}), continuedEnvelope = payload(32, 512);
  const continuedState = committed(pending, continued, continuedEnvelope, some([continuedEnvelope, continuedPosition, nextStep, none()]));
  const unknownPosition = position(23, 2, 1, some(step)), unknown = record(pending, 5, unknownPosition, {receipt: some(receipt)});
  const unknownState = committed(pending, unknown, payload(33, 512), some([envelope, busy, step, some(receipt)]));
  const closed = record(unknownState, 6, position(24, 3, 1, some(step))), closedState = committed(unknownState, closed, payload(34, 512), unknownState[6]);
  return {step, busy, begin, envelope, anchor, pending, receipt, continued, continuedEnvelope, continuedState,
    unknown, unknownState, closed, closedState};
}

export function metadataCorpus() {
  const rows = [], ids = new Set();
  const add = (id, input, output, area) => {assert.ok(!ids.has(id), id); ids.add(id); rows.push({id, request: encode(input), response: encode(output), area});};
  const append = (id, state, value, envelope, expected, area = 'transition') => add(id, [1, 1, state, value, envelope], success(expected), area);
  const reject = (id, state, value, code, area = 'refusal', envelope = payload(80, 512)) => add(id, [1, 1, state, value, envelope], failure(code), area);
  const x = metadataExamples();
  add('MetadataGenesis', [1, 0, binding, payload(40), ready, genesisEnvelope], success(initial), 'genesis');
  add('MetadataStatePredicate', [1, 3, initial], success(true), 'state');
  add('MetadataRecordPredicate', [1, 4, x.begin], success(true), 'record');
  add('MetadataPositionPredicate', [1, 5, ready], success(true), 'position');
  const read = record(initial, 1, position(25, 0, 0)), readEnvelope = payload(35, 512);
  append('MetadataReadOnly', initial, read, readEnvelope, committed(initial, read, readEnvelope, none()));
  append('MetadataPrepared', initial, x.begin, x.envelope, x.pending);
  append('MetadataContinuedPrepared', x.pending, x.continued, x.continuedEnvelope, x.continuedState);
  const settled = record(x.pending, 3, position(26, 0, 1), {receipt: some(x.receipt)}), settledEnvelope = payload(36, 512);
  append('MetadataSettled', x.pending, settled, settledEnvelope, committed(x.pending, settled, settledEnvelope, none()));
  append('MetadataUnknown', x.pending, x.unknown, payload(33, 512), x.unknownState, 'uncertainty');
  append('MetadataCloseUnknown', x.unknownState, x.closed, payload(34, 512), x.closedState, 'uncertainty');
  const closeReady = record(initial, 6, position(27, 3, 0)), closeReadyEnvelope = payload(37, 512), closedReady = committed(initial, closeReady, closeReadyEnvelope, none());
  append('MetadataCloseReady', initial, closeReady, closeReadyEnvelope, closedReady);
  const closeBusy = record(x.pending, 6, position(28, 3, 1, some(x.step))), closeBusyEnvelope = payload(38, 512);
  append('MetadataCloseBusy', x.pending, closeBusy, closeBusyEnvelope, committed(x.pending, closeBusy, closeBusyEnvelope, x.pending[6]), 'uncertainty');
  const rebound = record(initial, 7, position(29, 0, 0)), reboundEnvelope = payload(39, 512);
  append('MetadataRebound', initial, rebound, reboundEnvelope, committed(initial, rebound, reboundEnvelope, none()));
  const recoveredReady = record(closedReady, 8, position(60, 0, 0, none(), 5)), recoveredEnvelope = payload(61, 512);
  append('MetadataRecoveryReady', closedReady, recoveredReady, recoveredEnvelope, committed(closedReady, recoveredReady, recoveredEnvelope, none()), 'recovery');
  const recoveryPlan = [x.envelope, reference(70), x.busy, payload(71), position(72, 0, 1), payload(73), x.receipt];
  for (const [name, state] of [['Unknown', x.unknownState], ['Closed', x.closedState]]) {
    const recovered = record(state, 9, position(74, 0, 1, none(), 5), {receipt: some(x.receipt), recovery: some(recoveryPlan)}), envelope = payload(75, 512);
    append('MetadataRecoveryTerminal' + name, state, recovered, envelope, committed(state, recovered, envelope, none()), 'recovery');
    reject('MetadataRecoveryPlanRequired' + name, state, changed(recovered, 10, none()), 15, 'recovery');
    for (const [part, value] of [[0, payload(76, 512)], [2, changed(x.busy, 0, payload(77))],
      [4, position(72, 0, 1, none(), 5)], [6, payload(78)]])
      reject('MetadataRecoveryLinkMismatch' + name + part, state, changed(recovered, 10, some(changed(recoveryPlan, part, value))), 15, 'recovery');
  }
  reject('MetadataRecoveryPlanForbiddenOnPrepared', initial, changed(x.begin, 10, some(recoveryPlan)), 15, 'recovery');
  for (const [name, state] of [['Ready', initial], ['Busy', x.pending], ['Unknown', x.unknownState], ['ClosedPending', x.closedState]]) {
    const checkpoint = record(state, 10, state[5], {frontier: some(payload(62))}), envelope = payload(63, 512), after = committed(state, checkpoint, envelope, state[6], 0);
    append('MetadataCheckpoint' + name, state, checkpoint, envelope, after, 'checkpoint');
    assert.deepEqual(after[6], state[6], 'oracle expectation retains the complete original anchor');
    if (name === 'Busy') {
      const terminal = record(after, 3, position(64, 0, 1), {receipt: some(x.receipt)}), terminalEnvelope = payload(65, 512);
      append('MetadataSettleAfterPendingCheckpoint', after, terminal, terminalEnvelope, committed(after, terminal, terminalEnvelope, none()), 'checkpoint');
    }
  }
  add('MetadataReplayEmpty', [1, 2, initial, []], success(initial), 'replay');
  add('MetadataReplayPreparedContinue', [1, 2, initial, [[x.begin, x.envelope], [x.continued, x.continuedEnvelope]]], success(x.continuedState), 'replay');
  add('MetadataReplayUnknownClose', [1, 2, initial, [[x.begin, x.envelope], [x.unknown, payload(33, 512)], [x.closed, payload(34, 512)]]], success(x.closedState), 'replay');
  add('MetadataReplayMissingPrepared', [1, 2, initial, [[x.continued, x.continuedEnvelope]]], failure(8), 'replay');
  add('MetadataReplayDuplicatePrepared', [1, 2, initial, [[x.begin, x.envelope], [x.begin, x.envelope]]], failure(8), 'replay');
  for (let index = 0; index < 6; index++) {
    const source = changed(binding[0], index, reference(90));
    reject('MetadataChangedSourceBinding' + index, initial, changed(x.begin, 0, changed(binding, 0, source)), 6, 'binding');
  }
  for (const [index, value] of [[1, reference(91)], [2, reference(92)], [3, Uint8Array.of(4, ...new Uint8Array(64).fill(93))],
    [4, 'other-context'], [5, 'other-namespace'], [6, 'other-head'], [7, 'other-staging'], [8, 1023], [9, reference(94)]])
    reject('MetadataChangedBinding' + index, initial, changed(x.begin, 0, changed(binding, index, value)), 6, 'binding');
  for (const [name, value] of [['RecordsLow', changed(binding, 8, 1)], ['RecordsHigh', changed(binding, 8, 1025)],
    ['HeadAlias', changed(binding, 7, binding[6])], ['KeyPrefix', changed(binding, 3, new Uint8Array(65))],
    ['OriginWidth', changed(binding, 2, new Uint8Array(31))], ['InvalidName', changed(binding, 5, '../unsafe')],
    ['InvalidContext', changed(binding, 4, 'invalid context')]])
    add('MetadataBinding' + name, [1, 0, value, payload(40), ready, genesisEnvelope], failure(0), 'binding');
  reject('MetadataGenesisMismatch', initial, changed(x.begin, 1, reference(100)), 7, 'ordering');
  reject('MetadataSequenceGap', initial, changed(x.begin, 2, 2), 8, 'ordering');
  reject('MetadataPredecessorMismatch', initial, changed(x.begin, 3, reference(100)), 9, 'ordering');
  reject('MetadataBeforePayloadMismatch', initial, changed(x.begin, 5, changed(ready, 0, payload(101))), 10, 'context');
  reject('MetadataBeforeEpochMismatch', initial, changed(x.begin, 5, changed(ready, 1, 5)), 10, 'context');
  reject('MetadataOrdinaryEpochAdvance', initial, changed(x.begin, 7, changed(x.busy, 1, 5)), 12, 'authority');
  reject('MetadataRecoveryEpochRollback', closedReady, changed(recoveredReady, 7, changed(recoveredReady[7], 1, 3)), 12, 'authority');
  reject('MetadataPreparedReceiptForbidden', initial, changed(x.begin, 8, some(x.receipt)), 11, 'receipt');
  reject('MetadataSettleReceiptRequired', x.pending, changed(settled, 8, none()), 11, 'receipt');
  reject('MetadataContinueReceiptRequired', x.pending, changed(x.continued, 8, none()), 11, 'receipt');
  reject('MetadataUnknownReceiptRequired', x.pending, changed(x.unknown, 8, none()), 11, 'receipt');
  reject('MetadataNonCheckpointFrontier', initial, changed(x.begin, 9, some(payload(102))), 16, 'checkpoint');
  const checkpoint = record(x.pending, 10, x.pending[5], {frontier: some(payload(62))});
  reject('MetadataCheckpointFrontierRequired', x.pending, changed(checkpoint, 9, none()), 16, 'checkpoint');
  reject('MetadataCheckpointCannotChangePayload', x.pending, changed(checkpoint, 7, changed(x.busy, 0, payload(103))), 11, 'checkpoint');
  reject('MetadataCheckpointCannotResolvePending', x.pending, changed(checkpoint, 7, position(103, 0, 1)), 11, 'checkpoint');
  reject('MetadataBeginWhileBusy', x.pending, record(x.pending, 2, position(103, 1, 2, some([1, 1, 512]))), 11, 'uncertainty');
  reject('MetadataUnknownCannotSettle', x.unknownState, record(x.unknownState, 3, position(104, 0, 1), {receipt: some(x.receipt)}), 11, 'uncertainty');
  reject('MetadataClosedCannotSettle', x.closedState, record(x.closedState, 3, position(104, 0, 1), {receipt: some(x.receipt)}), 11, 'uncertainty');
  reject('MetadataRebindBusy', x.pending, record(x.pending, 7, position(104, 0, 1)), 11, 'uncertainty');
  reject('MetadataRecoveryReadyCannotClearPending', x.closedState, record(x.closedState, 8, position(104, 0, 1)), 11, 'recovery');
  reject('MetadataContinueWrongStep', x.pending, changed(x.continued, 7, position(105, 1, 1, some([0, 3, 512]))), 11, 'step');
  reject('MetadataContinueChangedMaximum', x.pending, changed(x.continued, 7, position(105, 1, 1, some([0, 2, 511]))), 11, 'step');
  for (const [name, value] of [['ReadyPending', changed(ready, 4, some([0, 1, 512]))], ['BusyEmpty', changed(ready, 2, 1)],
    ['UnknownEmpty', changed(ready, 2, 2)], ['Phase', changed(ready, 2, 4)], ['StepZero', position(20, 1, 1, some([0, 0, 512]))],
    ['StepOver', position(20, 1, 1, some([0, 513, 512]))], ['MaximumOver', position(20, 1, 1, some([0, 1, 513]))],
    ['CommandBinding', position(20, 1, 2, some([0, 1, 512]))]])
    add('MetadataPosition' + name, [1, 5, value], success(false), 'position');
  add('MetadataMissingAnchor', [1, 3, changed(x.pending, 6, none())], success(false), 'anchor');
  add('MetadataReadyWithAnchor', [1, 3, changed(initial, 6, x.pending[6])], success(false), 'anchor');
  add('MetadataBusyObservedReceipt', [1, 3, changed(x.pending, 6, some(changed(x.anchor, 3, some(x.receipt))))], success(false), 'anchor');
  add('MetadataUnknownMissingReceipt', [1, 3, changed(x.unknownState, 6, some(x.anchor))], success(false), 'anchor');
  const full = [binding, initial[1], 1024, reference(106), 1024, ready, none()], fullRead = record(full, 1, position(107, 0, 0));
  reject('MetadataSegmentExhausted', full, fullRead, 13, 'capacity');
  const oneLeft = changed(full, 4, 1023), lastBegin = record(oneLeft, 2, x.busy);
  reject('MetadataReserveTerminalSlot', oneLeft, lastBegin, 13, 'capacity');
  const fullCheckpoint = record(full, 10, full[5], {frontier: some(payload(108))}), fullEnvelope = payload(109, 512);
  append('MetadataCheckpointFullSegment', full, fullCheckpoint, fullEnvelope, committed(full, fullCheckpoint, fullEnvelope, none(), 0), 'capacity');
  const near = [binding, initial[1], 0xfffffffc, reference(110), 0, ready, none()];
  reject('MetadataReserveFourOrdinals', near, record(near, 2, x.busy), 14, 'counter');
  const boundary = changed(near, 2, 0xfffffffb), boundaryBegin = record(boundary, 2, x.busy), boundaryEnvelope = payload(111, 512);
  append('MetadataFourOrdinalBoundary', boundary, boundaryBegin, boundaryEnvelope, committed(boundary, boundaryBegin, boundaryEnvelope, some([boundaryEnvelope, x.busy, x.step, none()])), 'counter');
  const exhausted = changed(near, 2, 0xffffffff), validRecord = changed(record(near, 1, position(112, 0, 0)), 2, 0xffffffff);
  reject('MetadataCounterExhausted', exhausted, validRecord, 14, 'counter');
  reject('MetadataEnvelopeOneOver', initial, x.begin, 17, 'envelope', payload(113, 65537));
  const exactEnvelope = payload(114, 65536);
  append('MetadataEnvelopeExact', initial, x.begin, exactEnvelope, committed(initial, x.begin, exactEnvelope, some([exactEnvelope, x.busy, x.step, none()])), 'envelope');
  const canonical = encode([1, 3, initial]);
  for (const [name, raw, code] of [['Empty', [], 2], ['Trailing', [...canonical, 0], 8], ['Nonminimal', [0x83, 0x18, 1, ...canonical.slice(2)], 5],
    ['Indefinite', [0x9f, ...canonical.slice(1), 0xff], 4], ['OversizedOuter', [0x87], 6], ['UnknownOperation', [0x82, 1, 6], 3]])
    rows.push({id: 'MetadataWire' + name, request: Uint8Array.from(raw), response: encode(malformed(code)), area: 'wire'});
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
