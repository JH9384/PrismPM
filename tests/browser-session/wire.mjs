// Independent finite framing oracle for the private source-owned Session codec.
// This is test infrastructure, not a dispatcher or an authority implementation.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';

const ref = (value, expected, pack = x => x) => expected !== undefined && isDeepStrictEqual(value, expected)
  ? [0] : [1, pack(value)];
const command = (value, authority) => [value[0], value[1], ref(value[2], authority), value[3]];
const pending = value => value[3][4][0] === 1 ? value[3][4][1] : undefined;
export const compactState = value => [value[0], value[1], value[2],
  [value[3][0], value[3][1], value[3][2], value[3][3], value[3][4][0] === 0 ? [0] : [1,
    [command(value[3][4][1][0], value[3][3]), ...value[3][4][1].slice(1)]]], value[4]];
const completion = (value, state) => {
  const prior = pending(state), primitive = decode(value[5]);
  return [ref(value[0], state[0]), ref(value[1], state[3][0]),
    ref(value[2], prior?.[0], x => command(x, state[3][3])), value[3], ref(value[4], prior?.[3]),
    [ref(encode(primitive[0]), prior?.[2]), encode(primitive[1])]];
};
const plan = (value, state, selected, terminal) => [
  ref(value[0], selected, x => command(x, state[3][3])), ref(value[1], state, compactState),
  value[2][0] === 0 ? [0] : [1, [ref(value[2][1][0], pending(state)?.[3]),
    ref(value[2][1][1], terminal, x => completion(x, state))]], value[3], value[4],
];
export function compactOperation(value) {
  const [tag, state] = value;
  switch (tag) {
    case 0: return value;
    case 1: return [tag, compactState(state), command(value[2], state[3][3]), ...value.slice(3)];
    case 2: return [tag, compactState(state), command(value[2], state[3][3]), plan(value[3], state, value[2]), value[4]];
    case 3: return [tag, compactState(state), completion(value[2], state), ...value.slice(3)];
    case 4: return [tag, compactState(state), completion(value[2], state), value[3], plan(value[4], state, pending(state)?.[0], value[2]), value[5]];
    case 5: return [tag, compactState(state), completion(value[2], state), value[3]];
    case 6: case 7: return [tag, compactState(state), ...value.slice(2)];
    case 8: return [tag, compactState(state), ref(value[2], state, compactState), command(value[3], state[3][3]), plan(value[4], state, value[3]), value[5]];
    default: return value;
  }
}
const arity = (value, length) => {assert.ok(Array.isArray(value)); assert.equal(value.length, length); return value;};
const resolve = (value, expected, unpack = x => x) => {
  assert.ok(Array.isArray(value));
  if (value[0] === 0) {arity(value, 1); assert.notEqual(expected, undefined, 'reference has no predecessor'); return expected;}
  arity(value, 2); assert.equal(value[0], 1, 'only fixed zero or explicit reference');
  const actual = unpack(value[1]);
  assert.ok(expected === undefined || !isDeepStrictEqual(actual, expected), 'explicit-equal reference is noncanonical');
  return actual;
};
const expandCommand = (value, authority) => {arity(value, 4); return [value[0], value[1], resolve(value[2], authority), value[3]];};
export function expandState(value) {
  arity(value, 5); arity(value[3], 5); const p = value[3][4];
  assert.ok(Array.isArray(p));
  if (p[0] === 0) arity(p, 1);
  else {arity(p, 2); assert.equal(p[0], 1); arity(p[1], 4);}
  return [value[0], value[1], value[2], [value[3][0], value[3][1], value[3][2], value[3][3],
    p[0] === 0 ? p : [1, [expandCommand(p[1][0], value[3][3]), ...p[1].slice(1)]]], value[4]];
}
const expandCompletion = (value, state) => {
  arity(value, 6); arity(value[5], 2); const prior = pending(state);
  return [resolve(value[0], state[0]), resolve(value[1], state[3][0]),
    resolve(value[2], prior?.[0], x => expandCommand(x, state[3][3])), value[3], resolve(value[4], prior?.[3]),
    encode([decode(resolve(value[5][0], prior?.[2])), decode(value[5][1])])];
};
const expandPlan = (value, state, selected, terminal) => {
  arity(value, 5); const p = value[2]; assert.ok(Array.isArray(p));
  if (p[0] === 0) arity(p, 1); else {arity(p, 2); assert.equal(p[0], 1); arity(p[1], 2);}
  return [resolve(value[0], selected, x => expandCommand(x, state[3][3])), resolve(value[1], state, expandState),
    p[0] === 0 ? p : [1, [resolve(p[1][0], pending(state)?.[3]), resolve(p[1][1], terminal, x => expandCompletion(x, state))]], value[3], value[4]];
};
export function expandOperation(value) {
  assert.ok(Array.isArray(value)); const tag = value[0];
  if (tag === 0) return arity(value, 10);
  const state = expandState(value[1]);
  switch (tag) {
    case 1: arity(value, 5); return [tag, state, expandCommand(value[2], state[3][3]), ...value.slice(3)];
    case 2: {arity(value, 5); const c = expandCommand(value[2], state[3][3]); return [tag, state, c, expandPlan(value[3], state, c), value[4]];}
    case 3: arity(value, 6); return [tag, state, expandCompletion(value[2], state), ...value.slice(3)];
    case 4: {arity(value, 6); const c = expandCompletion(value[2], state); return [tag, state, c, value[3], expandPlan(value[4], state, pending(state)?.[0], c), value[5]];}
    case 5: arity(value, 4); return [tag, state, expandCompletion(value[2], state), value[3]];
    case 6: arity(value, 3); return [tag, state, value[2]];
    case 7: arity(value, 5); return [tag, state, ...value.slice(2)];
    case 8: {arity(value, 6); const c = expandCommand(value[3], state[3][3]); return [tag, state, resolve(value[2], state, expandState), c, expandPlan(value[4], state, c), value[5]];}
    default: throw Error('unknown operation');
  }
}
export const encodeRequest = operation => encode([1, compactOperation(operation)]);
export const encodeSuccess = state => encode([1, 0, compactState(state)]);
export function decodeRequest(bytes) {const value = arity(decode(bytes), 2); assert.equal(value[0], 1); return expandOperation(value[1]);}
