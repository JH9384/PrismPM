// Independent finite state graph for tests, never an application implementation.
import assert from 'node:assert/strict';

export const UINT32_MAX = 4294967295;
const memo = new Map();
const key = value => JSON.stringify(value);

// Required progress branches only. Arbitrary new commands and reopen cycles
// require new admission; they are not an infinite terminal obligation.
export function terminalBranches(value) {
  const {phase, remaining} = value;
  const move = (kind, phase, remaining = null) => ({kind, state: {...value, phase, remaining}});
  if (phase === 0) return [move(6, 3)];
  if (phase === 3 && remaining === null) return [];
  if (phase === 3) return [move(9, 0)];
  if (phase === 2) return [move(6, 3, remaining), move(9, 0)];
  assert.equal(phase, 1); assert.ok(Number.isInteger(remaining) && remaining >= 0);
  return [move(3, 0), move(5, 2, remaining), move(6, 3, remaining),
    ...(remaining ? [move(4, 1, remaining - 1)] : [])];
}

// Minimize housekeeping for each genuine outcome, then preserve the most
// expensive possible outcome. Optional checkpoint loops at retained=0 cannot
// improve a finite strategy. This graph does not encode the source's fixed tail.
export function graphCapacity(value) {
  const identity = key(value);
  if (memo.has(identity)) return memo.get(identity);
  const {maximum, retained} = value;
  assert.ok(maximum >= 2 && maximum <= 1024 && retained >= 0 && retained <= maximum);
  const branches = terminalBranches(value);
  const costs = branches.map(({kind, state}) => {
    const slots = kind === 4 ? 2 : 1;
    const direct = retained + slots <= maximum
      ? 1 + graphCapacity({...state, retained: retained + 1}) : Infinity;
    const checkpoint = retained > 0
      ? 2 + graphCapacity({...state, retained: 1}) : Infinity;
    return Math.min(direct, checkpoint);
  });
  const result = costs.length ? Math.max(...costs) : 0;
  memo.set(identity, result); return result;
}

export function abstractPosition(state) {
  const position = state[5], pending = position[4];
  return {phase: position[2], remaining: pending[0] ? pending[1][2] - pending[1][1] : null,
    maximum: state[0][8], retained: state[4]};
}

export const capacity = state => graphCapacity(abstractPosition(state));
export const invariant = state => capacity(state) <= UINT32_MAX - state[2];

// Exhaustively enumerate finite credited paths, including optional checkpoints.
// Each admitted edge retains a completion strategy and consumes a real ordinal.
export function exploreReservedGraph(initial, credits) {
  const queue = [[initial, credits]], seen = new Set(); let edges = 0, terminals = 0;
  while (queue.length) {
    const [value, available] = queue.pop(), identity = key([value, available]);
    if (seen.has(identity)) continue; seen.add(identity);
    assert.ok(available >= graphCapacity(value));
    if (value.phase === 3 && value.remaining === null) terminals++;
    const branches = terminalBranches(value);
    const successors = branches.filter(({kind}) => value.retained + (kind === 4 ? 2 : 1) <= value.maximum)
      .map(({state}) => ({...state, retained: value.retained + 1}));
    successors.push({...value, retained: 0});
    for (const next of successors) if (available > 0 && available - 1 >= graphCapacity(next)) {
      edges++; queue.push([next, available - 1]);
    }
  }
  assert.ok(terminals > 0, 'every explored start has a finite terminal path');
  return {states: seen.size, edges, terminals};
}
