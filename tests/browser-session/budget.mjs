// Independent structural-size oracle: constructs bounded virtual CBOR trees,
// never allocates their hypothetical payloads and never grants an effect.
import assert from 'node:assert/strict';
import {decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {compactState} from './wire.mjs';

const MAX = 67108864, U32 = 0xffffffff, encoder = new TextEncoder();
export const sizedBytes = length => ({byteLengthForSizing: length});
const blob = sizedBytes;
const head = n => n < 24 ? 1 : n < 256 ? 2 : n < 65536 ? 3 : 5;
export function measure(value) {
  if (typeof value === 'number') {assert.ok(Number.isInteger(value) && value >= 0 && value <= U32); return head(value);}
  if (typeof value === 'boolean') return 1;
  if (Array.isArray(value)) return head(value.length) + value.reduce((sum, item) => sum + measure(item), 0);
  if (typeof value === 'string') {const length = encoder.encode(value).length; return head(length) + length;}
  const length = value instanceof Uint8Array ? value.length : value.byteLengthForSizing;
  assert.ok(Number.isInteger(length) && length >= 0 && length <= MAX + 1);
  return head(length) + length;
}
const digest = 'sha256:' + 'f'.repeat(64), bytes32 = blob(32);
const primitive = (resource, effect) => [bytes32, bytes32, bytes32, U32, resource, effect];
function grantRequest([resource, adapter]) {
  let effect;
  switch (adapter[0]) {
    case 0: {const guest = adapter[1]; effect = [0, [guest[0], guest[1], guest[2], blob(guest[3])]]; break;}
    case 1: effect = [1, 65536]; break;
    case 2: effect = [2, blob(1048576)]; break;
    case 3: effect = [3, blob(1048576)]; break;
    case 4: effect = [4, [blob(1048576), blob(64)]]; break;
    case 5: effect = [7, ['h'.repeat(128), [1, digest], digest, Array.from({length: 16}, () => blob(adapter[1][1]))]]; break;
    default: throw Error('unknown adapter');
  }
  return measure(primitive(resource, effect));
}
const resultCandidates = adapter => {
  switch (adapter[0]) {
    case 0: return [[0, blob(adapter[1][4])]];
    case 1: return [[1, blob(65536)]];
    case 2: return [[2, digest]];
    case 3: return [[3, blob(64)]];
    case 4: return [[4, true]];
    case 5: return [[5, [1, blob(adapter[1][1])]], [6, [1, [digest, blob(adapter[1][1])]]], [7, digest]];
    default: throw Error('unknown adapter');
  }
};
const maximumResult = candidates => Math.max(...candidates.concat([[8, [12]], [9]]).map(measure));
function selectedResult(request, grants) {
  const adapter = grants.find(grant => grant[0] === request[4])?.[1]; assert.ok(adapter);
  switch (request[5][0]) {
    case 0: return maximumResult([[0, blob(adapter[1][4])]]);
    case 1: return maximumResult([[1, blob(request[5][1])]]);
    case 2: case 7: return maximumResult([[2, digest]]);
    case 3: return maximumResult([[3, blob(64)]]);
    case 4: return maximumResult([[4, true]]);
    case 5: return maximumResult([[5, [1, blob(adapter[1][1])]]]);
    case 6: return maximumResult([[6, [1, [digest, blob(adapter[1][1])]]]]);
    default: throw Error('unknown effect');
  }
}
export function reservation(state) {
  const compact = compactState(state), limits = state[1], grants = decode(state[2])[3], pending = state[3][4][1];
  assert.ok(pending);
  const requestMaximum = Math.max(0, ...grants.map(grantRequest));
  const resultMaximum = maximumResult(grants.flatMap(grant => resultCandidates(grant[1])));
  const selectedMaximum = selectedResult(decode(pending[2]), grants), step = pending[1];
  const application = blob(limits[0]), selector = blob(limits[1]), view = blob(limits[6]);
  const shape = (app, sel, p, nextEffect = U32, revision = U32) => [compact[0], compact[1], compact[2],
    [compact[3][0], compact[3][1], app, compact[3][3], p],
    [compact[4][0], nextEffect, revision, sel, view, compact[4][5]]];
  const terminal = shape(application, selector, [0]);
  const unknown = shape(compact[3][2], compact[4][3], compact[3][4]);
  const next = shape(application, compact[4][3], [1, [compact[3][4][1][0], limits[5], blob(requestMaximum), blob(limits[2])]]);
  const complete = (step, result) => [[0], [0], [0], step, [0], [[0], blob(result)]];
  const nextPlan = [[0], [0], [1, [[0], [0]]], blob(requestMaximum), blob(limits[2])];
  const observations = (current, terminal, uncertain, step, result) => [
    measure([1, 0, current]), measure([1, 0, terminal]), measure([1, 0, uncertain]),
    measure([1, [3, current, complete(step, result), application, selector, view]]),
    measure([1, [5, current, complete(step, measure([9])), view]]),
    measure([1, [6, current, view]]), measure([1, [6, terminal, view]]), measure([1, [6, uncertain, view]]),
  ];
  const frames = observations(compact, terminal, unknown, step, selectedMaximum);
  if (step < limits[5]) {
    frames.push(measure([1, [4, compact, complete(step, selectedMaximum), application, nextPlan, view]]));
    frames.push(...observations(next, terminal, next, limits[5], resultMaximum));
    frames.push(measure([1, [4, next, complete(limits[5], resultMaximum), application, nextPlan, view]]));
  }
  return {fits: frames.every(size => size <= MAX), maximum: Math.max(...frames), frames,
    requestMaximum, resultMaximum, selectedMaximum};
}
