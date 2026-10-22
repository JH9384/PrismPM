// Independent source expectations. Only generated execution establishes parity.
import assert from 'node:assert/strict';
import {encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';
import {binding, initial, ready, payload, reference, record} from './metadata-corpus.mjs';
import {encodeMetadataReplay} from './metadata-maxima.mjs';
import {UINT32_MAX as U, capacity, invariant} from './reservation-oracle.mjs';

const none = () => [0], some = value => [1, value];
const clone = value => structuredClone(value);
export function stateAt({phase = 0, maximum = 2, retained = 0, sequence = U - 4096,
  step = 1, steps = 1, pending = phase === 1 || phase === 2} = {}) {
  const policy = clone(binding); policy[8] = maximum;
  const currentStep = [0, step, steps], prepared = [payload(21), 4, 1, 1, some(currentStep)];
  const position = pending ? [payload(22), 4, phase, 1, some(currentStep)] : [payload(20), 4, phase, 0, none()];
  if (phase === 1) position[0] = prepared[0];
  const anchor = pending ? some([payload(31, 512), prepared, currentStep,
    phase === 2 ? some(payload(50)) : none()]) : none();
  return [policy, initial[1], sequence, reference(60), retained, position, anchor];
}

export function candidate(state, kind, steps = 1) {
  let position = clone(state[5]), receipt = none(), frontier = none(), recovery = none();
  if (kind === 2) position = [payload(70), position[1], 1, position[3] + 1, some([position[3], 1, steps])];
  if (kind === 3) {position = [payload(71), position[1], 0, position[3], none()]; receipt = some(payload(50));}
  if (kind === 4) {position[4][1][1]++; position[0] = payload(72); receipt = some(payload(50));}
  if (kind === 5) {position[2] = 2; position[0] = payload(73); receipt = some(payload(50));}
  if (kind === 6) {position[2] = 3; position[0] = payload(74);}
  if (kind === 8 || kind === 9) position = [payload(75), position[1], 0, position[3], none()];
  if (kind === 9) {
    const anchor = state[6][1]; receipt = some(payload(50));
    recovery = some([anchor[0], reference(76), anchor[1], payload(77),
      [payload(78), anchor[1][1], 0, position[3], none()], payload(79), receipt[1]]);
  }
  if (kind === 10) frontier = some(payload(80));
  const row = record(state, kind, position, {receipt, frontier, recovery}), envelope = payload(81, 512);
  let anchor = clone(state[6]);
  if (kind === 2 || kind === 4) anchor = some([envelope, position, position[4][1], none()]);
  if (kind === 3 || kind === 9) anchor = none();
  if (kind === 5) anchor[1][3] = receipt;
  const next = [state[0], state[1], row[2], envelope[0], kind === 10 ? 0 : state[4] + 1, position, anchor];
  return {row, envelope, next};
}

export function resolutionTrace(steps, sequence, maximum = 2) {
  let state = stateAt({maximum, sequence}); const operations = [];
  const append = kind => {
    const entry = candidate(state, kind, steps);
    assert.ok(invariant(state) && invariant(entry.next), 'trace preserves required capacity');
    operations.push({state, kind, ...entry}); state = entry.next;
  };
  append(2);
  for (let step = 1; step < steps; step++) {
    if (state[4] + 2 > maximum) append(10);
    append(4);
  }
  for (const kind of [5, 6, 9, 6]) {
    if (state[4] + 1 > maximum) append(10);
    append(kind);
  }
  return {operations, state};
}

export function reservationCorpus() {
  const rows = [], ids = new Set();
  const add = (id, request, response) => {
    assert.ok(!ids.has(id), id); ids.add(id);
    rows.push({id, request: request instanceof Uint8Array ? request : encode(request), response: encode(response)});
  };
  add('ReservationGenesis', [1, 0, binding, payload(40), ready, payload(30, 512)], [1, 0, initial]);
  add('ReservationRetainedCapacity', [1, 6, stateAt({phase: 1, retained: 1})], [1, 0, 6]);
  add('ReservationFullCapacity', [1, 6, stateAt({phase: 1, retained: 1, steps: 512})], [1, 0, 1028]);
  let index = 0;
  for (const maximum of [2, 3, 4, 5, 1024]) {
    const retainedCounts = maximum === 1024 ? [0, 1, 511, 512, 1022, 1023, 1024]
      : Array.from({length: maximum + 1}, (_, i) => i);
    for (const retained of retainedCounts) for (const steps of [1, 2, 4, 512]) {
      for (const step of [...new Set([1, steps])]) for (const [phase, pending] of [[0, false], [1, true], [2, true], [3, true], [3, false]]) {
        const base = stateAt({maximum, retained, steps, step, phase, pending}), needed = capacity(base);
        for (const delta of [-1, 0, 1]) {
          const sequence = U - needed + delta;
          if (sequence > U) continue;
          const state = stateAt({maximum, retained, steps, step, phase, pending, sequence});
          add('ReservationCost' + index, [1, 6, state], [1, 0, needed]);
          add('ReservationBoundary' + index++, [1, 3, state], [1, 0, delta <= 0]);
        }
      }
    }
  }
  const invalid = [
    stateAt({phase: 1, steps: 513}), stateAt({phase: 1, step: 0}),
    stateAt({phase: 1, steps: 2, step: 3}), stateAt({maximum: 1}),
    stateAt({maximum: 1025}), stateAt({maximum: 2, retained: 3}),
    stateAt({phase: 0, pending: true}), stateAt({phase: 1, pending: false}),
  ];
  invalid.forEach((state, i) => add('ReservationInvalid' + i, [1, 6, state], [1, 1, 4]));
  for (let kind = 1; kind <= 10; kind++) {
    const phase = kind === 3 || kind === 4 || kind === 5 ? 1 : kind === 6 ? 2 : kind === 8 || kind === 9 ? 3 : 0;
    const pending = [3, 4, 5, 6, 9].includes(kind), sequence = U - ([2, 4].includes(kind) ? 4 : 1);
    const state = stateAt({maximum: 1024, retained: 0, phase, pending, steps: kind === 4 ? 2 : 1, sequence});
    const x = candidate(state, kind);
    add('ReservationKind' + kind + 'Exhausted', [1, 1, state, x.row, x.envelope], [1, 1, 14]);
  }
  for (const [name, steps, needed, maximum] of [['One', 1, 7, 2], ['Full', 512, 1029, 2], ['Wide', 512, 516, 1024]]) {
    const {operations, state} = resolutionTrace(steps, U - needed, maximum);
    assert.equal(operations.length, needed); assert.equal(state[2], U); assert.equal(capacity(state), 0);
    operations.forEach((entry, i) => add('Reservation' + name + 'Trace' + i,
      [1, 1, entry.state, entry.row, entry.envelope], [1, 0, entry.next]));
    for (let start = 0; start < operations.length; start += 1024) {
      const segment = operations.slice(start, start + 1024);
      add('Reservation' + name + 'Replay' + start, encodeMetadataReplay(segment[0].state,
        segment.map(({row, envelope}) => [row, envelope])), [1, 0, segment.at(-1).next]);
    }
    const before = stateAt({maximum, sequence: U - needed + 1}), x = candidate(before, 2, steps);
    add('Reservation' + name + 'BeginOneShort', [1, 1, before, x.row, x.envelope], [1, 1, 14]);
  }
  const state = stateAt({phase: 1, maximum: 2, sequence: U - 5, retained: 0}), x = candidate(state, 10);
  assert.ok(invariant(state) && !invariant(x.next));
  add('ReservationRedundantCheckpoint', [1, 1, state, x.row, x.envelope], [1, 1, 14]);
  add('ReservationUnsafeEmptyReplay', [1, 2, stateAt({phase: 1, sequence: U - 1}), []], [1, 1, 14]);
  add('ReservationTerminalEmptyReplay', [1, 2, stateAt({phase: 3, sequence: U}), []], [1, 0, stateAt({phase: 3, sequence: U})]);
  const unsafe = stateAt({phase: 1, maximum: 1024, sequence: U - 2}), settled = candidate(unsafe, 3);
  assert.ok(!invariant(unsafe) && invariant(settled.next));
  add('ReservationUnsafePredecessorCouldSettle', [1, 1, unsafe, settled.row, settled.envelope], [1, 1, 14]);
  const validQuery = encode([1, 6, initial]);
  add('ReservationTrailing', new Uint8Array([...validQuery, 0]), [1, 2, 8]);
  add('ReservationTruncated', validQuery.slice(0, -1), [1, 2, 2]);
  add('ReservationNoncanonicalVersion', new Uint8Array([0x83, 0x18, 1, ...validQuery.slice(2)]), [1, 2, 5]);
  for (const [name, request] of [['MissingState', [1, 6]], ['UnknownOperation', [1, 7, initial]], ['Version', [2, 6, initial]]])
    add('Reservation' + name, request, [1, 2, 3]);
  return rows;
}
