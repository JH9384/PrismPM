import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {draft, repository, run, sha} from './compile.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';

const names = ['operation-journal.mjs', 'effects.mjs', 'effects-wire.mjs', 'effects-module.mjs',
  'credential-custody.mjs', 'identity.mjs', 'store.mjs', 'browser-fixture.mjs'];
const source = name => join(name === 'browser-fixture.mjs' ? draft : join(repository, 'sdk/browser'), name);
const cases = ['explicit-genesis-open-capture', 'bootstrap-descriptor-snapshots', 'actual-execution-terminal-reopen',
  'opaque-custody-source-bounds-before-prepare', 'journal-namespace-isolation', 'journal-signing-domain-isolation',
  'lost-prepared-and-terminal-acknowledgments', 'close-during-staging-and-prepared',
  'unknown-real-application-commit-retained', 'actual-rejected-effect-durable-terminal', 'missing-chunk-fails-authenticated-replay',
  'finite-history-exhaustion', 'concurrent-initialize-and-open', 'actual-two-context-prepared-cas-race',
  'quota-before-prepared-never-executes', 'actual-object-count-exhaustion', 'immutable-closure-and-precopy-budget',
  'corrupt-chunk-cannot-be-replayed', 'content-addressed-forged-signature-rejected', 'private-staged-counters-waiter-and-one-shot-release',
  'actual-64mib-shared-transport', 'actual-two-context-maximum-staging-race'];
const closure = () => Object.fromEntries([...names.map(name => [name, source(name)]),
  ['browser.mjs', join(draft, 'browser.mjs')], ['runner.rs', join(draft, 'runner.rs')],
  ['browser-test-server.mjs', join(repository, 'sdk/browser/browser-test-server.mjs')]]
  .map(([name, path]) => [name, sha(readFileSync(path))]));

export async function journey(build, custody, replacements = {}) {
  return withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
      contentType: 'text/javascript', body: replacements[name] ?? readFileSync(source(name), 'utf8')}));
    await page.goto(baseURL); let timer;
    try {
      const result = await Promise.race([
        page.evaluate(async input => (await import('./browser-fixture.mjs')).runFixture(input), {
          Journal: [...build.journalBytes], Partition: [...build.partitionBytes], Effects: [...build.wasmBytes],
          Guest: [...build.guestBytes], Custody: [...custody.wasmBytes],
        }),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('bounded journal browser journey timeout')), 240000); }),
      ]);
      assert.deepEqual(errors, [], 'no detached browser errors'); assert.deepEqual(result.cases, cases);
      return result;
    } finally { clearTimeout(timer); }
  });
}

export async function verifyBrowser(t, build, custody) {
  const before = closure(), result = await journey(build, custody);
  for (const role of ['Journal', 'Partition', 'Effects', 'Guest', 'Custody']) {
    assert.ok(result.calls.some(row => row.role === role), 'actual source-generated ' + role + ' execution');
    assert.ok(result.maximum[role] > 0 && result.maximum[role] <= 1073741824);
  }
  const tsv = rows => rows.map((row, index) => row.role + index + '\t' + row.request + '\t' + row.response + '\n').join('');
  const journalRows = result.calls.filter(row => row.role !== 'Custody'), custodyRows = result.calls.filter(row => row.role === 'Custody');
  const transcript = join(build.work, 'browser-journal.tsv'), credentialTranscript = join(custody.work, 'browser-journal-custody.tsv');
  writeFileSync(transcript, tsv(journalRows), {flag: 'wx'}); writeFileSync(credentialTranscript, tsv(custodyRows), {flag: 'wx'});
  const damaged = journalRows.map(row => ({...row}));
  const selected = damaged.find(row => row.role === 'Journal' && row.response.length > 6); assert.ok(selected);
  selected.response = selected.response.slice(0, -2) + (selected.response.endsWith('00') ? '01' : '00');
  const mutation = join(build.work, 'browser-journal-mutant.tsv'); writeFileSync(mutation, tsv(damaged), {flag: 'wx'});
  const maximum = Buffer.alloc(67108864, 0x5a);
  for (let index = 0; index < 64; index++) maximum[index * 1048576] = index;
  assert.equal(result.payload.length, maximum.length); assert.equal(result.payload.digest, sha(maximum));
  assert.equal(result.large.length, 3, 'maximum stage/load and competing staging exercise complete source partition');
  const input = join(build.work, 'browser-maximum.request'); writeFileSync(input, maximum, {flag: 'wx'});
  for (const standard of [true, false]) {
    const runner = build.compileNative(standard), credentialRunner = custody.compileNative(standard);
    assert.match(run(runner, [transcript], build.runner), new RegExp('PASS ' + journalRows.length + ' complete journal vectors twice'));
    assert.throws(() => run(runner, [mutation], build.runner), /native output mismatch/, 'changed observed generated reply cannot pass native replay');
    assert.match(run(credentialRunner, [credentialTranscript], custody.runner), new RegExp('PASS ' + custodyRows.length + ' complete custody vectors twice'));
    for (const [index, row] of result.large.entries()) {
      assert.equal(row.role, 'Partition'); assert.equal(row.length, maximum.length); assert.equal(row.digest, sha(maximum));
      const output = join(build.work, 'browser-maximum-' + standard + '-' + index + '.response');
      writeFileSync(output, Buffer.from(row.response, 'hex'), {flag: 'wx'});
      assert.equal(run(runner, ['--binary', 'PartitionMaximum', input, output], build.runner), 'PASS binary complete journal vector twice\n');
    }
  }
  assert.deepEqual(closure(), before, 'frozen production/browser oracle closure');
  const evidence = {cases: result.cases, calls: {journal: journalRows.length, custody: custodyRows.length},
    maximum: result.maximum, payload: {length: maximum.length, sha256: sha(maximum)},
    transcript: sha(readFileSync(transcript)), custodyTranscript: sha(readFileSync(credentialTranscript)), sources: before};
  writeFileSync(join(build.work, 'operation-journal-browser-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  t.diagnostic(JSON.stringify(evidence));
}

export async function verifyHostMutations(t, build, custody) {
  const journal = readFileSync(source('operation-journal.mjs'), 'utf8'), effects = readFileSync(source('effects.mjs'), 'utf8');
  const replace = (text, before, after) => {
    assert.equal(text.split(before).length, 2, 'one exact owning guard'); return text.replace(before, after);
  };
  const mutations = [
    ['descriptor-value-snapshot', 'operation-journal.mjs',
      replace(journal, 'return Object.fromEntries(names.map(name => [name, descriptors[name].value]));', 'return value;'),
      /descriptor snapshot invoked caller property getter: options/],
    ['array-length-snapshot', 'operation-journal.mjs',
      replace(journal, 'const length = descriptors.length?.value;', 'const length = value.length;'),
      /descriptor snapshot invoked caller property getter: guests/],
    ['primitive-before-prepared', 'operation-journal.mjs',
      replace(replace(journal, 'const payload = await this.#stage(request); this.#check();',
        'const early = staged.release(); const payload = await this.#stage(request); this.#check();'),
      'bytesCopy(await staged.release(), FRAME)', 'bytesCopy(await early, FRAME)'), /primitive custody while actual acknowledgment is withheld/],
    ['terminal-acknowledgment-swallowed', 'operation-journal.mjs',
      replace(journal, 'await this.#publish(terminal); this.#check();', 'await this.#publish(terminal).catch(() => {}); this.#check();'),
      /lost acknowledgment is never called success/],
    ['replay-signature-bypass', 'operation-journal.mjs',
      replace(journal, '|| !await verifyBytes(this.#binding[5], CONTEXT, envelope[1], envelope[2]))', '|| false)'),
      /expected journal signature-invalid, got undefined/],
    ['application-storage-alias', 'operation-journal.mjs',
      replace(journal, "throw fail('storage-alias');", 'void 0;'), /expected journal storage-alias, got undefined/],
    ['application-signing-domain-alias', 'operation-journal.mjs',
      replace(journal, "throw fail('signing-alias');", 'void 0;'), /expected journal signing-alias, got undefined/],
    ['captured-custody-preauthorization', 'effects.mjs',
      replace(effects, 'checkCredentialSigning(adapter.custody, request[4], request[5][1]);', 'void 0;'),
      /source-bound signing limit rejects before Prepared or effect execution/],
    ['combined-artifact-precopy-budget', 'operation-journal.mjs',
      replace(journal, "if (total + bytesLength(journalWire, FRAME) + bytesLength(partition, FRAME) > EFFECT_ARTIFACTS_MAXIMUM) throw fail('invalid-input');", 'void total;'),
      /expected journal invalid-input, got artifact-mismatch|complete aggregate artifact budget rejects/],
    ['released-waiter-bypasses-active', 'effects.mjs',
      replace(effects, 'if (this.#pending[0] === item) void this.#execute(item);', 'void this.#execute(item);'),
      /released waiter cannot bypass unacknowledged active request/],
    ['one-shot-release-guard', 'effects.mjs',
      replace(effects, "if (released) return Promise.reject(fail('invalid-input'));", 'void released;'),
      /expected journal invalid-input, got host-closed/],
    ['known-rejection-not-returned-to-journal', 'effects.mjs',
      replace(effects, 'result[0] === 8 && !item.staged', 'result[0] === 8'), /OperationJournalError: journal-uncertain/],
  ];
  const before = closure();
  for (const [name, file, mutated, diagnostic] of mutations) await prerequisite(t, 'executed private journal host mutation ' + name, async () => {
    await assert.rejects(journey(build, custody, {[file]: mutated}), diagnostic);
  });
  assert.deepEqual(closure(), before, 'mutants never edit the accepted production source');
}
