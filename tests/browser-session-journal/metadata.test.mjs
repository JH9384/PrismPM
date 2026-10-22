// Construction checks only; the DK-30 owner must execute the actual artifacts.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {metadataCorpus, metadataExamples, initial} from './metadata-corpus.mjs';
import {metadataMutations, mutateMetadataSource} from './metadata-mutations.mjs';
import {metadataMaximumCorpus, encodeMetadataReplay} from './metadata-maxima.mjs';
import {encodeEffectWire as encode} from '../../sdk/browser/effects-wire.mjs';
const root = new URL('../../stdlib/src/', import.meta.url), model = 'Foundation.Browser.Application.V1.SessionJournal';
const source = module => readFileSync(new URL(module.replaceAll('.', '/') + '.lex.tex', root));

test('metadata expected corpus is independent and covers every transition family', () => {
  const rows = metadataCorpus(); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  for (const name of ['Genesis', 'ReadOnly', 'Prepared', 'ContinuedPrepared', 'Settled', 'Unknown', 'CloseUnknown',
    'CloseReady', 'CloseBusy', 'Rebound', 'RecoveryReady', 'RecoveryTerminalUnknown', 'RecoveryTerminalClosed',
    'CheckpointReady', 'CheckpointBusy', 'CheckpointUnknown', 'CheckpointClosedPending', 'SettleAfterPendingCheckpoint',
    'ReplayPreparedContinue', 'ReplayUnknownClose', 'ReserveTerminalSlot', 'CheckpointFullSegment', 'EnvelopeExact'])
    assert.ok(rows.some(row => row.id === 'Metadata' + name), name);
  for (const row of rows) {assert.ok(row.request instanceof Uint8Array); assert.ok(row.response instanceof Uint8Array);}
});

test('each metadata source mutation changes a closed real declaration and has an independent refusal probe', () => {
  const rows = metadataCorpus();
  for (const mutation of metadataMutations) {
    const sources = new Map([model, model + 'Wire'].map(module => [module, source(module)]));
    const result = mutateMetadataSource(sources, mutation.id);
    assert.equal(result.probe, mutation.probe); assert.ok(rows.some(row => row.id === result.probe));
    assert.equal(result.changed, mutation.id === 'metadata-trailing' ? 6 : 1);
    const untouched = mutation.module === model ? model + 'Wire' : model;
    assert.deepEqual(sources.get(untouched), source(untouched), 'no collateral module mutation');
  }
});

test('metadata schema has exact source fields and no self-referential prepared envelope', () => {
  const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(source(model).toString('utf8'))[1]);
  const fields = name => data.declarations.find(row => row.name === name).fields.map(row => row.name);
  assert.deepEqual(fields('SessionJournalRecord'), ['binding', 'genesis', 'sequence', 'previous', 'kind', 'before', 'operation', 'after', 'receipt', 'frontier', 'recovery']);
  assert.deepEqual(fields('SessionJournalAnchor'), ['envelope', 'position', 'step', 'observedReceipt']);
  assert.deepEqual(fields('SessionJournalRecoveryPlan'), ['preparedEnvelope', 'context', 'settleBefore', 'settleOperation', 'settled', 'rebindOperation', 'receipt']);
  assert.ok(!fields('SessionJournalRecord').includes('envelope'));
});

test('metadata oracle retains full replay, full step and descriptor maxima without hidden narrowing', () => {
  const x = metadataExamples(), entries = [[x.begin, x.envelope], [x.continued, x.continuedEnvelope]];
  assert.deepEqual(encodeMetadataReplay(initial, entries), encode([1, 2, initial, entries]), 'shared small replay framing agrees exactly');
  const rows = metadataMaximumCorpus(); assert.equal(rows.length, 5);
  assert.deepEqual(rows.find(row => row.id === 'MetadataMaximum512StepsWithPendingCheckpoints').facts,
    {steps: 512, checkpoints: 511, records: 1024, maximumRetained: 2});
  assert.equal(rows.find(row => row.id === 'MetadataMaximum1024Replay').facts.records, 1024);
  for (const row of rows) assert.ok(row.request.byteLength <= 67108864);
});

test('metadata calls retain exact pinned source definition arities', () => {
  const declarations = new Map();
  function capture(module) {
    if (declarations.has(module)) return;
    const bytes = source(module).toString('utf8');
    declarations.set(module, JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes)[1]).declarations);
    for (const match of bytes.matchAll(/\\importmodule\{([^}]+)\}/g)) capture(match[1]);
  }
  capture(model + 'Wire');
  for (const module of [model, model + 'Wire']) {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'call') {
        const selected = value.function.module ?? module;
        const definition = declarations.get(selected)?.find(row => row.name === value.function.name);
        assert.equal(definition?.kind, 'definition', selected + '.' + value.function.name);
        assert.equal(value.arguments.length, definition.parameters.length, 'exact pinned call ' + selected + '.' + definition.name);
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
    }
    declarations.get(module).forEach(visit);
  }
});
