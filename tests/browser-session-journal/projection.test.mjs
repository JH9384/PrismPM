import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {projectionCorpus, observationCorpus} from './projection-corpus.mjs';
import {assertCapturedProjectionSources, frozenInputs, sourceClosure} from './compile.mjs';
import {verifyNativeProjectionInventory} from './projection-checks.mjs';
import {mutateProjectionSource, projectionMutations} from './projection-mutations.mjs';

const root = new URL('../../stdlib/src/Foundation/Browser/Application/V1/', import.meta.url);
const semantic = name => JSON.parse(/\\semanticdata\{(.*)\}/.exec(
  readFileSync(new URL(name + '.lex.tex', root), 'utf8'))[1]);
const calls = node => {
  if (!node || typeof node !== 'object') return [];
  return [...node.kind === 'call' ? [node.function] : [],
    ...Object.values(node).flatMap(value => Array.isArray(value) ? value.flatMap(calls) : calls(value))];
};

test('journal predecessor is modeled with complete source-owned parsers, not host state extraction', () => {
  const declarations = semantic('SessionJournalProjection').declarations;
  assert.deepEqual(declarations.map(row => row.name), [
    'projectSessionOperationPredecessor', 'readSessionPredecessor', 'sourceSessionPredecessorBytes',
  ]);
  const dispatch = declarations[0], actual = calls(dispatch.body);
  const SW = 'Foundation.Browser.Application.V1.SessionWire';
  assert.equal(actual.filter(row => row.module === SW && row.name === 'readCompactState').length, 8);
  assert.equal(actual.filter(row => row.module === SW && row.name === 'writeSourceStateSuccess').length, 7);
  assert.ok(actual.some(row => row.module === SW && row.name === 'readCompactPlan'));
  assert.ok(actual.some(row => row.module === SW && row.name === 'readCompactCompletion'));
  assert.equal(actual.filter(row => row.name === 'sourceSessionWireBytes').length, 0,
    'projection does not retain a second full transition allocation');
  for (const row of actual) assert.ok(row.module, 'all parser/writer dependencies are explicit source imports');
});

test('projection oracle covers every existing session vector and all operation-tail boundaries', () => {
  const rows = projectionCorpus();
  assert.equal(rows.length, 904);
  for (let tag = 0; tag <= 8; tag++) assert.ok(rows.some(row => row.id === 'ProjectionTrailingOperation' + tag));
});

test('session observations require the complete generated state predicate and retain exact effect bytes', () => {
  const declarations = semantic('SessionJournalObservation').declarations;
  assert.deepEqual(declarations.map(row => row.name), ['writeSessionObservedPending', 'writeSessionObservationValue',
    'writeSessionObservation', 'readSessionObservation', 'sourceSessionObservationBytes']);
  assert.ok(calls(declarations.find(row => row.name === 'writeSessionObservation').body)
    .some(row => row.module === 'Foundation.Browser.Application.V1.Session' && row.name === 'sourceSessionValid'));
  assert.ok(calls(declarations[0].body).some(row => row.name === 'writeSourceBalancedEffectRequest'));
  const rows = observationCorpus();
  for (const suffix of ['Trailing', 'WrongVersion', 'WrongStatus', 'WrongArity', 'OversizedArity', 'InvalidPrincipal', 'InvalidInstance', 'InvalidPhase'])
    assert.ok(rows.some(row => row.id === 'Observation' + suffix));
});

test('projection consumes the same complete canonical parser and EOF checks as SessionWire', () => {
  function normalized(node) {
    if (Array.isArray(node)) return node.map(normalized);
    if (!node || typeof node !== 'object') return node;
    // Ignore only the result after a successful EOF check, not any parser,
    // branch, field reference, arity, encoding check or failure result.
    if (node.kind === 'match' && node.scrutinee?.kind === 'beq'
      && node.scrutinee.left?.kind === 'project' && node.scrutinee.left.field === 'cursor'
      && node.scrutinee.right?.kind === 'primitive' && node.scrutinee.right.operation === 'length') {
      const result = structuredClone(node);
      const accepted = result.branches.find(row => row.constructor.name === 'Bool.true');
      assert.ok(accepted); accepted.body = {kind: 'verified-eof-success'};
      return Object.fromEntries(Object.entries(result).map(([key, value]) => [key, normalized(value)]));
    }
    const result = Object.fromEntries(Object.entries(node).map(([key, value]) => [key, normalized(value)]));
    if (result.kind === 'call' && result.function.module === 'Foundation.Browser.Application.V1.SessionWire')
      delete result.function.module;
    return result;
  }
  const baseline = semantic('SessionWire').declarations.find(row => row.name === 'dispatchSourceWire');
  const projection = semantic('SessionJournalProjection').declarations.find(row => row.name === 'projectSessionOperationPredecessor');
  assert.deepEqual(normalized(projection.body), normalized(baseline.body));
});

test('captured projection source substitution and incomplete module inventories reject before compilation', () => {
  const inputs = frozenInputs(), sources = sourceClosure();
  for (const path of ['tests/browser-effects/corpus.mjs', 'tests/browser-view/local-module-inputs.mjs',
    'tests/browser-session-journal/runtime.mjs', 'tests/browser-session-journal/maximum-runner.mjs',
    'tests/browser-view/generated-wasm.mjs', 'tests/browser-session-journal/wasm-artifact-checks.mjs'])
    assert.match(inputs[path], /^[a-f0-9]{64}$/, 'transitive or separately invoked owner dependency ' + path);
  assertCapturedProjectionSources(inputs, sources);
  const [name, bytes] = sources.entries().next().value;
  const changed = new Map(sources); changed.set(name, Buffer.concat([bytes, Buffer.from('\n')]));
  assert.throws(() => assertCapturedProjectionSources(inputs, changed), /actual captured source/);
  assert.deepEqual(frozenInputs(), inputs, 'current files can remain unchanged while captured bytes differ');
  const missing = new Map(sources); missing.delete(name);
  assert.throws(() => assertCapturedProjectionSources(inputs, missing), /complete captured source module inventory/);
});

test('native inventory preserves hyphenated boundary cases and rejects missing or extra output', () => {
  const rows = [{id: 'FrameReservationEdge1-0'}, {id: 'Initialize'}];
  const output = 'PASS FrameReservationEdge1-0\nPASS Initialize\nPASS 2 journal projection vectors twice\n';
  verifyNativeProjectionInventory(output, rows);
  for (const changed of [output.replace('PASS FrameReservationEdge1-0\n', ''),
    output + 'PASS Extra\n', output.replace('PASS Initialize\n', 'PASS Initialize\nPASS Initialize\n'),
    output.replace('PASS 2 journal', 'PASS 1 journal')])
    assert.throws(() => verifyNativeProjectionInventory(changed, rows), /complete exact native vector inventory/);
});

test('closed projection defect catalogue changes only the named source declaration', () => {
  const rows = {predecessor: projectionCorpus(), observation: observationCorpus()};
  const baseline = sourceClosure(); assert.equal(projectionMutations.length, 8);
  for (const mutation of projectionMutations) {
    const changed = new Map(baseline), result = mutateProjectionSource(changed, mutation.id);
    assert.equal(result.changed, mutation.id === 'predecessor-eof' ? 9 : 1);
    const parse = bytes => JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1]);
    for (const [name, bytes] of baseline) {
      if (name !== mutation.module) {assert.deepEqual(changed.get(name), bytes); continue;}
      const before = parse(bytes), after = parse(changed.get(name));
      assert.deepEqual(after.declarations.map(row => row.name), before.declarations.map(row => row.name));
      for (let i = 0; i < before.declarations.length; i++) {
        if (before.declarations[i].name === mutation.definition) assert.notDeepEqual(after.declarations[i], before.declarations[i]);
        else assert.deepEqual(after.declarations[i], before.declarations[i]);
      }
    }
    for (const probe of mutation.probes) assert.equal(rows[mutation.entry].filter(row => row.id === probe).length, 1);
  }
  assert.throws(() => mutateProjectionSource(new Map(baseline), 'not-a-source-defect'), /closed projection mutation/);
});
