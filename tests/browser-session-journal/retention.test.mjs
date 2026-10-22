// Construction/source-interface checks; not generated retention acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {encodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {encodeRetentionFixture, retentionCorpus, retentionMaximumCorpus, reference} from './retention-corpus.mjs';
import {retentionMutations, mutateRetentionSource} from './retention-mutations.mjs';
const module = 'Foundation.Browser.Application.V1.SessionJournalRetention';
const source = name => readFileSync(new URL('../../stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex', import.meta.url));

test('independent retention framing agrees on shared canonical scalar/record domain', () => {
  for (const value of [[1, 1, [1, 0, [], []]], [1, 0, [1, 255, [reference(1)], [['a', reference(1), [reference(1)]]]], [0], [], []],
    [1, 0, true], [1, 1, 11], [1, 2, 8]])
    assert.deepEqual(encodeRetentionFixture(value), encodeEffectWire(value));
});

test('retention corpus covers current/staging/shared closures and complete declared maxima', () => {
  const rows = retentionCorpus(), maxima = retentionMaximumCorpus();
  assert.equal(new Set([...rows, ...maxima].map(row => row.id)).size, rows.length + maxima.length);
  for (const name of ['RetentionProtectActive', 'RetentionProtectShared', 'RetentionProtectStaging',
    'RetentionAtomicAddReplaceRetire', 'RetentionStaleExpectedHead', 'RetentionMissingNewChunk', 'RetentionRevisionExhausted'])
    assert.ok(rows.some(row => row.id === name), name);
  assert.equal(maxima.length, 6);
  const largest = maxima.find(row => row.id === 'RetentionMaximumFrontier');
  assert.ok(largest.request.length > 8 * 1024 * 1024 && largest.response.length > 8 * 1024 * 1024);
  for (const row of maxima) assert.ok(row.request.length <= 67108864 && row.response.length <= 67108864);
});

test('each retention defect mutates real source and has a separate behavioral refusal fixture', () => {
  const rows = retentionCorpus();
  for (const selected of retentionMutations) {
    const sources = new Map([module, module + 'Wire'].map(name => [name, source(name)]));
    const result = mutateRetentionSource(sources, selected.id);
    assert.ok(rows.some(row => row.id === result.probe));
    assert.equal(result.changes, selected.id === 'retention-trailing' ? 2 : 1);
  }
});

test('retention source calls and record constructors match exact pinned signatures', () => {
  const modules = new Map();
  function capture(name) {
    if (modules.has(name)) return; const text = source(name).toString('utf8');
    modules.set(name, JSON.parse(/\\semanticdata\{(.*)\}/.exec(text)[1]).declarations);
    for (const match of text.matchAll(/\\importmodule\{([^}]+)\}/g)) capture(match[1]);
  }
  capture(module + 'Wire');
  for (const name of [module, module + 'Wire']) {
    function visit(value) {
      if (!value || typeof value !== 'object') return;
      if (value.kind === 'call') {
        const definition = modules.get(value.function.module ?? name)?.find(row => row.name === value.function.name);
        assert.equal(definition?.kind, 'definition'); assert.equal(value.arguments.length, definition.parameters.length, value.function.name);
      }
      if (value.kind === 'record') {
        const definition = modules.get(value.type.module ?? name)?.find(row => row.name === value.type.name);
        assert.equal(definition?.kind, 'structure'); assert.deepEqual(value.fields.map(row => row.field).sort(), definition.fields.map(row => row.name).sort(), value.type.name);
      }
      Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(visit) : visit(child));
    }
    modules.get(name).forEach(visit);
  }
});
