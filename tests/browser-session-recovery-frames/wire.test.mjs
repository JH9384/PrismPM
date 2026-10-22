import assert from 'node:assert/strict';
import test from 'node:test';
import {corpus, expectedLayout, expectedTail, joinBytes} from './corpus.mjs';
import {sourceClosure} from './compile.mjs';
import {mutations, mutateFramesSource} from './mutations.mjs';
import {decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {expandState} from '../browser-session/wire.mjs';

test('frame source calls resolve exact existing codec arities', () => {
  const sources = sourceClosure(), modules = new Map([...sources].map(([name, bytes]) =>
    [name, JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1])]));
  const root = 'Foundation.Browser.Application.V1.SessionRecoveryFrames'; let calls = 0;
  const sorted = value => Array.isArray(value) ? value.map(sorted) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])])) : value;
  assert.equal(/\\semanticdata\{(.*)\}/.exec(sources.get(root).toString('utf8'))[1], JSON.stringify(sorted(modules.get(root))));
  function walk(value) {
    if (!value || typeof value !== 'object') return;
    assert.notEqual(value.kind, 'sub', 'Nat subtraction uses the declared subtract primitive');
    if (value.kind === 'call') {
      const owner = value.function.module ?? root;
      const target = modules.get(owner)?.declarations.find(item => item.name === value.function.name);
      assert.ok(target, owner + '.' + value.function.name);
      assert.equal(value.arguments.length, target.parameters.length, value.function.name); calls++;
    }
    for (const child of Object.values(value)) Array.isArray(child) ? child.forEach(walk) : walk(child);
  }
  modules.get(root).declarations.forEach(walk); assert.ok(calls > 50);
});
test('independent slice recipe exactly recreates original-recovery expected bytes', () => {
  const vectors = corpus();
  assert.deepEqual(Object.fromEntries(Object.entries(vectors).map(([name, rows]) => [name, rows.length])),
    {layout: 1467, tail: 365, parity: 36, composition: 23});
  for (const row of vectors.composition) {
    const state = expandState(decode(row.state)[2]), layout = expectedLayout(state);
    assert.deepEqual(joinBytes(row.state.slice(0, layout[0]), expectedTail(row.values)), row.response, row.id);
  }
});
test('every actual source defect has one exact location and a named independent probe', () => {
  const vectors = corpus(); assert.equal(mutations.length, 18);
  for (const mutation of mutations) {
    assert.ok(vectors[mutation.entry].some(row => row.id === mutation.probe), mutation.id);
    const source = sourceClosure(), before = source.get('Foundation.Browser.Application.V1.SessionRecoveryFrames');
    mutateFramesSource(source, mutation.id);
    assert.notDeepEqual(source.get('Foundation.Browser.Application.V1.SessionRecoveryFrames'), before);
  }
});
