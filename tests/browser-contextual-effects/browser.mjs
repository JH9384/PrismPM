import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {run, sha} from '../browser-view/compile.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {corpus} from '../browser-effects/corpus.mjs';
import {restoreObserved} from './transcript.mjs';

const draft = dirname(fileURLToPath(import.meta.url)), repository = resolve(draft, '../..');
const names = ['effects.mjs', 'effects-wire.mjs', 'effects-module.mjs', 'identity.mjs', 'store.mjs',
  'credential-custody.mjs', 'browser-fixture.mjs'];
const source = name => join(name === 'browser-fixture.mjs' ? draft : join(repository, 'sdk/browser'), name);
export const cases = Object.freeze(['closed-api-context-and-detached-copies', 'all-eight-real-effect-families',
  'exact-field-and-canonical-refusals', 'active-waiter-stale-and-one-shot', 'cross-host-and-reopened-context-refusal',
  'source-custody-bound-before-admission', 'known-rejection-captured-completion', 'close-before-release-and-active-ack',
  'unknown-commit-blocks-context-and-waiter', 'unknown-late-waiter-release', 'actual-resource-maxima-and-one-over', 'generated-counter-exhaustion',
  'old-staged-interface-stays-result-only']);

export async function journey(effects, custody, replacements = {}, only = null) {
  assert.ok(only === null || cases.includes(only));
  return withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
      contentType: 'text/javascript', body: replacements[name] ?? readFileSync(source(name), 'utf8')}));
    await page.goto(baseURL); let timer;
    const counter = corpus().find(row => row.id === 'Exhausted'); assert.ok(counter);
    try {
      const result = await Promise.race([
        page.evaluate(async input => (await import('./browser-fixture.mjs')).runFixture(input), {
          artifacts: {Effects: [...effects.wasmBytes], Guest: [...effects.guestBytes], Custody: [...custody.wasmBytes]},
          only, counter: {request: [...counter.request], response: [...counter.response]},
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded contextual browser journey timeout')), 240000); }),
      ]);
      assert.deepEqual(errors, [], 'no detached browser failures');
      assert.deepEqual(result.cases, only ? [only] : cases, 'all selected contextual journeys completed');
      return result;
    } finally { clearTimeout(timer); }
  });
}

export async function verifyBrowser(t, effects, custody) {
  const result = await journey(effects, custody), rows = {effects: [], custody: []}, binaries = [], roles = new Set();
  assert.ok(result.calls.length >= 100 && result.calls.length <= 4096, 'bounded nonempty complete observed model calls');
  for (const [index, row] of result.calls.entries()) {
    assert.deepEqual(Object.keys(row).sort(), ['request', 'response', 'role']); roles.add(row.role);
    const request = restoreObserved(row.request, row.role), response = restoreObserved(row.response, row.role);
    const selected = row.role === 'Custody' ? 'custody' : 'effects', build = selected === 'custody' ? custody : effects;
    const id = 'Browser' + (row.role === 'Guest' ? 'Guest' : row.role) + index;
    if (row.role !== 'Guest' && Math.max(request.length, response.length) > 1048576) {
      const input = join(build.work, 'contextual-' + index + '.request'), output = join(build.work, 'contextual-' + index + '.response');
      writeFileSync(input, request, {flag:'wx'}); writeFileSync(output, response, {flag:'wx'});
      binaries.push({selected, input, output});
    } else rows[selected].push(id + '\t' + Buffer.from(request).toString('hex') + '\t' + Buffer.from(response).toString('hex') + '\n');
  }
  assert.deepEqual([...roles].sort(), ['Custody', 'Effects', 'Guest']);
  for (const [role, pages] of [['Effects',16384],['Guest',256],['Custody',2048]])
    assert.ok(result.maximum[role] > 0 && result.maximum[role] <= pages * 65536, 'actual generated memory maximum ' + role);
  const files = {};
  for (const [name, build] of [['effects', effects], ['custody', custody]]) {
    files[name] = join(build.work, 'contextual-browser.tsv'); writeFileSync(files[name], rows[name].join(''), {flag:'wx'});
  }
  const mutants = [];
  for (const role of ['Effects','Guest','Custody']) {
    const name = role === 'Custody' ? 'custody' : 'effects', build = name === 'custody' ? custody : effects;
    const index = rows[name].findIndex(row => row.startsWith('Browser' + role)); assert.ok(index >= 0);
    const changed = rows[name].slice(), fields = changed[index].trimEnd().split('\t'); fields[2] = 'ff'; changed[index] = fields.join('\t') + '\n';
    const path = join(build.work, 'contextual-reply-' + role + '-mutant.tsv'); writeFileSync(path, changed.join(''), {flag:'wx'});
    mutants.push({name, path});
  }
  for (const standard of [true, false]) await prerequisite(t, 'all actual contextual browser observations replayed in generated ' + (standard ? 'std' : 'no_std'), () => {
    const executables = {effects: effects.compileNative(standard), custody: custody.compileNative(standard)};
    for (const [name, build] of [['effects', effects], ['custody', custody]])
      assert.match(run(executables[name], [files[name]], build.runner), new RegExp('PASS ' + rows[name].length + ' complete ' + name + ' vectors twice'));
    for (const row of binaries) {
      const build = row.selected === 'custody' ? custody : effects;
      assert.match(run(executables[row.selected], ['--binary', row.input, row.output], build.runner), /PASS binary complete (?:effects|custody) vector twice/);
    }
    for (const row of mutants) {
      const build = row.name === 'custody' ? custody : effects;
      assert.throws(() => run(executables[row.name], [row.path], build.runner), /native output mismatch/, 'changed actual ' + row.name + ' reply refuses native replay');
    }
  });
  const evidence = {cases: result.cases, calls: result.calls.length, binaryCalls: binaries.length, maximum: result.maximum,
    transcripts: Object.fromEntries(Object.entries(files).map(([name, path]) => [name, sha(readFileSync(path))])),
    observedFrames: result.calls.map(row => ({role: row.role, request: {length: row.request.length, sha256: row.request.sha256},
      response: {length: row.response.length, sha256: row.response.sha256}}))};
  writeFileSync(join(effects.work, 'contextual-browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag:'wx'});
  t.diagnostic(JSON.stringify({cases: evidence.cases, calls: evidence.calls, binaryCalls: evidence.binaryCalls, maximum: evidence.maximum}));
  return evidence;
}

export async function verifyHostMutations(t, effects, custody) {
  const original = readFileSync(source('effects.mjs'), 'utf8');
  const replace = (text, from, to) => { assert.equal(text.split(from).length, 2, 'one exact contextual host mutation anchor'); return text.replace(from, to); };
  const mutations = [
    ['exact-request-repair', 'exact-field-and-canonical-refusals', replace(original, 'const request = exact ? intent',
      'const request = exact ? [this.#manifest[0], this.#manifest[1], this.#session, this.#state[2], intent[4], intent[5]]'), /expected contextual model-rejected, got undefined/],
    ['context-borrowed-session', 'closed-api-context-and-detached-copies', replace(original,
      'session: this.#session.slice(), nextOperation: this.#state[2]', 'session: this.#session, nextOperation: this.#state[2]'), /context never lends internal session bytes|model-rejected|invalid-generated-output/],
    ['completion-request-substitution', 'all-eight-real-effect-families', replace(original,
      'encodeEffectWire([item.request, decodeEffectWire(result)])',
      'encodeEffectWire([[...item.request.slice(0, 3), item.request[3] + 1, ...item.request.slice(4)], decodeEffectWire(result)])'), /completion is bound to the original actual request/],
    ['completion-caller-copy', 'closed-api-context-and-detached-copies', replace(original,
      'encodeEffectWire([item.request, decodeEffectWire(result)])', 'encodeEffectWire([decodeEffectWire(request), decodeEffectWire(result)])'), /invalid-input|trailing|cbor|private completion ignores/i],
    ['premature-exact-release', 'all-eight-real-effect-families', replace(replace(original,
      'released: !staged, started: false', 'released: !staged || exact, started: false'),
      'const item = this.#admit(value, true, exact);', 'const item = this.#admit(value, true, exact); if (exact) void this.#execute(item);'), /no primitive before private release/],
    ['waiter-skips-active', 'active-waiter-stale-and-one-shot', replace(original,
      'if (this.#pending[0] === item) void this.#execute(item);', 'void this.#execute(item);'), /released waiter cannot bypass unreleased active exact request/],
    ['one-shot-removed', 'active-waiter-stale-and-one-shot', replace(original,
      "if (released) return Promise.reject(fail('invalid-input'));", 'void released;'), /duplicate exact release must refuse immediately/],
    ['custody-preauthorization-removed', 'source-custody-bound-before-admission', replace(original,
      'checkCredentialSigning(adapter.custody, request[4], request[5][1]);', 'void 0;'), /expected contextual host-unavailable, got undefined/],
    ['unknown-late-waiter-priority', 'unknown-late-waiter-release', replace(original,
      "if (exact && !this.#closed && this.#state[4]) return Promise.reject(fail('effect-outcome-unknown'));", 'void exact;'),
      /expected contextual effect-outcome-unknown, got host-closed/],
  ];
  for (const [name, selected, mutated, diagnostic] of mutations) await prerequisite(t, 'executed contextual host mutation ' + name, async () => {
    await assert.rejects(journey(effects, custody, {'effects.mjs': mutated}, selected), diagnostic);
  });
  return mutations.map(row => row[0]);
}
