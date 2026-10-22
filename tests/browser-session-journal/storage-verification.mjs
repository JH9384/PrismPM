// Independent native replay and deliberate host defects; no model replacement.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {captureStorageSources, verifySessionStorage} from './storage-browser.mjs';
import {sha} from '../browser-view/compile.mjs';
import {validateStorageObservations} from './storage-observations.mjs';

export function verifyStorageTranscript(build, calls, label = 'chromium') {
  assert.match(label, /^(chromium|firefox|webkit)$/);
  validateStorageObservations(calls);
  assert.throws(() => validateStorageObservations(calls.slice(1)), /complete observed storage call inventory/,
    'an actually dropped browser observation cannot be accepted');
  const lostTransition = calls.findIndex(row => row.request.startsWith('860100'));
  const validation = calls.find(row => row.request.startsWith('830101'));
  assert.ok(lostTransition >= 0 && validation, 'actual transition and validation observations required');
  const substituted = calls.map((row, index) => index === lostTransition
    ? {...validation, journey: row.journey} : row);
  assert.throws(() => validateStorageObservations(substituted), /complete generated operation inventory/,
    'replacing an actual transition with a genuine validation cannot preserve coverage');
  const lines = calls.map((row, index) => {
    return 'Storage' + index + '\t' + row.request + '\t' + row.response + '\n';
  });
  const path = join(build.work, 'storage-' + label + '-transcript.tsv');
  const changed = join(build.work, 'storage-' + label + '-changed-transcript.tsv');
  const mutated = [...lines], fields = mutated[0].trimEnd().split('\t');
  fields[2] = (parseInt(fields[2].slice(0, 2), 16) ^ 1).toString(16).padStart(2, '0') + fields[2].slice(2);
  mutated[0] = fields.join('\t') + '\n';
  writeFileSync(path, lines.join(''), {flag: 'wx'}); writeFileSync(changed, mutated.join(''), {flag: 'wx'});
  const expected = calls.map((_, index) => 'PASS Storage' + index + '\n').join('')
    + 'PASS ' + calls.length + ' journal retention vectors twice\n';
  for (const standard of [true, false]) {
    assert.equal(build.runNative(standard, ['retention', path]), expected, 'every observed browser call replays natively');
    assert.throws(() => build.runNative(standard, ['retention', changed]), /native output mismatch/,
      'a changed observed response must not pass native replay');
  }
  return {engine: label, calls: calls.length, transcript: sha(readFileSync(path)),
    maximumBytes: Math.max(...calls.map(row => row.memory)), alteredTranscriptRejected: ['std', 'no-std'],
    missingObservationsRejected: ['dropped-call', 'transition-replaced-by-validation']};
}

export const storageHostMutations = Object.freeze([
  {id: 'strict-durability', case: 'a transaction must report strict durability',
    before: "if (tx.durability !== 'strict') throw fail('storage-unavailable');", after: 'void tx.durability;'},
  {id: 'complete-frontier-cas', case: 'competing real transactions',
    before: "if (!equal(await snapshot(tx), expected)) throw fail('frontier-conflict');", after: 'await snapshot(tx);'},
  {id: 'transaction-acknowledgement', case: 'publication cannot acknowledge',
    before: 'const result = await operation(tx); await done; return result;', after: 'const result = await operation(tx); return result;'},
  {id: 'same-handle-overlap', case: 'missing closure, invalid input, close',
    before: "if (this.#busy) throw fail('storage-busy');", after: 'void this.#busy;'},
  {id: 'quota-diagnostic', case: 'quota failure aborts',
    before: "error?.name === 'QuotaExceededError' ? 'storage-quota' : 'storage-unavailable'", after: "'storage-unavailable'"},
  {id: 'stored-payload-digest', case: 'read refuses changed stored payload',
    before: "if (!(bytes instanceof Uint8Array) || bytes.length > CHUNK || !equal(await hash(bytes), digest)) throw fail('object-corrupt');",
    after: "if (!(bytes instanceof Uint8Array) || bytes.length > CHUNK) throw fail('object-corrupt');"},
]);

export function mutateStorageHost(source, mutation) {
  assert.equal(source.split(mutation.before).length, 2, 'one exact host guard for ' + mutation.id);
  return source.replace(mutation.before, mutation.after);
}

export async function verifyStorageHostMutations(t, wire, {engine = 'chromium', inputs} = {}) {
  const path = new URL('../../sdk/browser/session-storage.mjs', import.meta.url);
  const source = captureStorageSources(inputs)['session-storage.mjs'];
  const results = [];
  for (const mutation of storageHostMutations) {
    const changed = mutateStorageHost(source, mutation);
    let failure;
    await t.test('executed storage host defect ' + mutation.id, async () => {
      try {
        let selected = 0;
        await assert.rejects(verifySessionStorage({async test(name, body) {
          if (!name.startsWith(mutation.case)) return;
          selected++; await body();
        }}, wire, {source: changed, engine, inputs}), error => error.code === 'ERR_ASSERTION',
        'the actual browser journey must detect changed behavior, not a launch or syntax failure');
        assert.equal(selected, 1, 'one exact behavioral counterexample');
      } catch (error) {failure = error; throw error;}
    });
    if (failure) throw failure;
    results.push({id: mutation.id, source: sha(changed), counterexample: mutation.case});
  }
  assert.equal(readFileSync(path, 'utf8'), source, 'mutants never edit actual SDK source');
  return results;
}
