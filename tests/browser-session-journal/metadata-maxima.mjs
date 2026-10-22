// Maximum metadata descriptor/replay fixtures. Referenced 64-MiB payload bytes
// are executed separately by the complete journal owner, not invented here.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';
import {binding, payload, reference, record} from './metadata-corpus.mjs';

const unique = (ordinal, length = 512) => {
  const value = payload(0, length);
  new DataView(value[0].buffer).setUint32(0, ordinal);
  value[2].forEach((chunk, index) => {new DataView(chunk.buffer).setUint32(0, ordinal); new DataView(chunk.buffer).setUint32(4, index + 1);});
  return value;
};
const none = () => [0], some = value => [1, value], maximumPayload = () => payload(180, 67108864);
const maximumBinding = () => {
  const value = structuredClone(binding);
  for (const index of [4, 5, 6, 7]) value[index] = String.fromCharCode(97 + index).repeat(128);
  return value;
};
function commit(state, row, envelope, anchor, retained = state[4] + 1) {
  return [state[0], state[1], row[2], envelope[0], retained, row[7], anchor];
}
export function encodeMetadataReplay(state, entries) {
  // The unchanged effect codec owns each bounded record, not this distinct
  // journal's 1024-entry outer replay list. Encode only that canonical header.
  assert.ok(Array.isArray(entries) && entries.length <= 1025);
  const count = entries.length, header = count < 24 ? Uint8Array.of(0x80 + count)
    : count <= 255 ? Uint8Array.of(0x98, count) : Uint8Array.of(0x99, count >>> 8, count & 255);
  const parts = [Uint8Array.of(0x84, 1, 2), encode(state), header, ...entries.map(encode)];
  const size = parts.reduce((sum, part) => sum + part.length, 0); assert.ok(size <= 67108864);
  const output = new Uint8Array(size); let at = 0;
  for (const part of parts) {output.set(part, at); at += part.length;}
  return output;
}
const vector = (id, input, output, facts) => ({id, request: input[1] === 2 ? encodeMetadataReplay(input[2], input[3]) : encode(input), response: encode(output), facts});

export function maximumReplayFixture() {
  const selected = maximumBinding(), genesis = unique(10000, 65536), position = [maximumPayload(), 0xffffffff, 0, 0xffffffff, none()];
  // This is a typed already-checkpointed state, not billions of fabricated records.
  const initial = [selected, genesis[0], 2048, genesis[0], 0, position, none()];
  let state = initial; const entries = [];
  for (let index = 0; index < 1024; index++) {
    const after = [maximumPayload(), 0xffffffff, 0, 0xffffffff, none()], operation = maximumPayload();
    const row = record(state, 1, after, {operation}), envelope = unique(10001 + index, 65536);
    entries.push([row, envelope]); state = commit(state, row, envelope, none());
  }
  assert.equal(state[4], 1024); assert.equal(entries.length, 1024);
  return {initial, state, entries};
}

export function maximumStepCheckpointFixture() {
  const selected = maximumBinding(); selected[8] = 2;
  const genesis = unique(20000, 65536), ready = [maximumPayload(), 4, 0, 0, none()];
  const initial = [selected, genesis[0], 0, genesis[0], 0, ready, none()];
  const entries = []; let state = initial, currentStep;
  function append(kind, position, {receipt = none(), frontier = none()} = {}) {
    const row = record(state, kind, position, {operation: maximumPayload(), receipt, frontier});
    const envelope = unique(20001 + entries.length, 65536);
    const anchor = kind === 2 || kind === 4 ? some([envelope, position, position[4][1], none()]) : kind === 3 ? none() : state[6];
    entries.push([row, envelope]); state = commit(state, row, envelope, anchor, kind === 10 ? 0 : state[4] + 1);
  }
  for (let step = 1; step <= 512; step++) {
    if (step > 1) append(10, state[5], {frontier: some(maximumPayload())});
    const position = [maximumPayload(), 4, 1, 1, some([0, step, 512])];
    append(step === 1 ? 2 : 4, position, {receipt: step === 1 ? none() : some(maximumPayload())});
    currentStep = state;
    assert.equal(state[4], 1); assert.equal(state[6][1][2][1], step);
  }
  append(3, [maximumPayload(), 4, 0, 1, none()], {receipt: some(maximumPayload())});
  assert.equal(entries.length, 1024); assert.equal(state[4], 2); assert.deepEqual(state[6], none());
  return {initial, state, entries, currentStep};
}

export function metadataMaximumCorpus() {
  const replay = maximumReplayFixture(), steps = maximumStepCheckpointFixture();
  const rows = [
    vector('MetadataMaximum1024Replay', [1, 2, replay.initial, replay.entries], [1, 0, replay.state],
      {records: 1024, descriptorPayload: 67108864, descriptorChunks: 64, envelope: 65536, names: 128}),
    vector('MetadataMaximum512StepsWithPendingCheckpoints', [1, 2, steps.initial, steps.entries], [1, 0, steps.state],
      {steps: 512, checkpoints: 511, records: 1024, maximumRetained: 2}),
    vector('MetadataReplay1025Refused', [1, 2, replay.initial, [...replay.entries, replay.entries[0]]], [1, 2, 6], {records: 1025}),
  ];
  const tooFar = [maximumPayload(), 4, 1, 1, some([0, 513, 512])], row = record(steps.currentStep, 4, tooFar, {receipt: some(maximumPayload())});
  rows.push(vector('MetadataStep513Refused', [1, 1, steps.currentStep, row, unique(30000)], [1, 1, 5], {step: 513}));
  const selected = maximumBinding(), original = [maximumPayload(), 0xfffffffe, 1, 0xffffffff, some([0xfffffffe, 512, 512])];
  const prepared = unique(30001, 65536), receipt = maximumPayload(), closed = [maximumPayload(), 0xfffffffe, 3, 0xffffffff, original[4]];
  const state = [selected, reference(190), 0xfffffffe, reference(191), 1, closed, some([prepared, original, original[4][1], some(receipt)])];
  const settled = [maximumPayload(), 0xfffffffe, 0, 0xffffffff, none()], after = [maximumPayload(), 0xffffffff, 0, 0xffffffff, none()];
  const plan = [prepared, reference(192), original, maximumPayload(), settled, maximumPayload(), receipt];
  const terminal = record(state, 9, after, {operation: maximumPayload(), receipt: some(receipt), recovery: some(plan)}), envelope = unique(30002, 65536);
  rows.push(vector('MetadataMaximumRecoveryPlan', [1, 1, state, terminal, envelope], [1, 0, commit(state, terminal, envelope, none())],
    {sequence: 0xffffffff, nextCommand: 0xffffffff, epoch: 0xffffffff, step: 512, descriptorPayload: 67108864}));
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const row of rows) assert.ok(row.request.length <= 67108864, 'full bounded metadata frame');
  return rows;
}
