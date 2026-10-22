import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import test from 'node:test';
import {createPkceCompiler, frozenInputs, sha} from './compile.mjs';
import {component, replay, sourceMutation} from './checks.mjs';
import {browserRun, hostMutations} from './browser.mjs';
import {sourceMutations} from './mutations.mjs';
import {tsv} from './corpus.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-session-journal/wasm-artifact-checks.mjs';

export async function required(t, name, action) {
  let entered = false, completed = false, result, failure;
  await t.test(name, async () => {
    entered = true;
    try {result = await action(); completed = true;} catch(error) {failure = error; throw error;}
  });
  assert.ok(entered, 'required PKCE check omitted: ' + name);
  if (failure) throw failure;
  assert.ok(completed, 'required PKCE check incomplete: ' + name);
  return result;
}
test('ST-17 complete generated PKCE and real browser S256', {timeout: 3500000}, async t => {
  const inputs = frozenInputs(), compiler = createPkceCompiler(inputs);
  let complete = false, build;
  try {
    const result = await required(t, 'complete official and independently enumerated native/no_std/Wasm corpus', () => component(compiler, inputs));
    build = result.build;
    const evidence = {scope: 'private-pkce-s256-component', authenticatedMailbox: false, deploymentAccepted: false, ...result.evidence};
    evidence.substitutions = await required(t, 'actual compiler and generated Wasm substitutions refuse', () => ({
      compiler: verifyCompilerOwnerSubstitutions(compiler), wasm: verifyWasmArtifactSubstitutions(build),
    }));
    // Compile behavioral defects before expensive complete browser corpora.
    evidence.sourceMutations = [];
    for (const mutation of sourceMutations) evidence.sourceMutations.push(await required(t, 'actual compiled source defect ' + mutation.id,
      () => sourceMutation(compiler, inputs, build, mutation)));
    evidence.browsers = [];
    for (const engine of ['chromium', 'firefox', 'webkit']) evidence.browsers.push(await required(t, engine + ' actual cryptography, lifecycle and native transcript replay', async () => {
      const observed = await browserRun(build, engine);
      const rows = observed.calls.map((row, at) => ({id: 'observed-' + at, request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
      const native = replay(build, rows, engine);
      const changed = rows.map(row => ({...row, response: Buffer.from(row.response)})); changed[0].response[0] ^= 1;
      const path = join(build.work, engine + '-corrupt.tsv'); writeFileSync(path, tsv(changed), {flag: 'wx'});
      for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]), /observed-0 native output mismatch/);
      build.unchanged(); return {engine, completeCorpus: observed.completeCorpus, check: observed.check, native};
    }));
    evidence.hostMutations = [];
    for (const mutation of hostMutations) evidence.hostMutations.push(await required(t, 'actual host defect ' + mutation.id, async () => {
      for (const engine of ['chromium', 'firefox', 'webkit']) await assert.rejects(browserRun(build, engine, mutation),
        error => error.code === 'ERR_ASSERTION' && error.message.includes('PKCE host ' + mutation.check + ' contract'),
        'named host behavior must fail, not a missing module or provider exception');
      return mutation.id;
    }));
    await required(t, 'complete frozen source and generated package closure', () => {
      assert.deepEqual(frozenInputs(), inputs); build.unchanged();
      assert.equal(evidence.browsers.length, 3); assert.equal(evidence.hostMutations.length, 4); assert.equal(evidence.sourceMutations.length, 5);
    });
    evidence.nativeExecutables = build.nativeEvidence(); evidence.retirement = compiler.close();
    const path = join(build.work, 'owner.json'); writeFileSync(path, JSON.stringify(evidence) + '\n', {flag: 'wx'});
    complete = true; t.diagnostic(JSON.stringify({work: build.work, sha256: sha(readFileSync(path)), scope: evidence.scope}));
  } finally {if (!complete) t.diagnostic(JSON.stringify({accepted: false, compiler: compiler.evidence.work, build: build?.work}));}
});
