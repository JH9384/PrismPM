// Private DK-35 session-host prerequisite: no authenticated journal, effects or release.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createOperationCompiler, frozenInputs, sha} from './compile.mjs';
import {verifyComponents, verifySourceMutation} from './checks.mjs';
import {operationCorpus} from './corpus.mjs';
import {verifyOperationVectors, verifyOperationBoundary, boundaryJourneys} from './journeys.mjs';
import {hostMutations, mutateHost} from './mutations.mjs';
import {maximumVectors, effectResultMaxima} from '../browser-session/maxima.mjs';
import {projectionMutations} from '../browser-session-journal/projection-mutations.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {verifyPayloadOwner} from '../browser-session-payloads/checks.mjs';

async function required(t, name, body) {
  let result, failure;
  await t.test(name, async () => {try {result = await body();} catch(error) {failure = error; throw error;}});
  if (failure) throw failure;
  return result;
}
test('unchanged complete payload owner after private descriptor factoring', {timeout: 3500000}, async t => {
  const result = await verifyPayloadOwner(t);
  t.diagnostic(JSON.stringify({scope: result.evidence.scope, work: result.build.work, receipt: result.receipt}));
});

test('operation capture component: actual source, native, Wasm, browser and all existing bounds', {timeout: 3500000}, async t => {
  const inputs = frozenInputs(), compiler = createOperationCompiler(inputs);
  let complete = false;
  try {
    const compilerSubstitutions = await required(t, 'fresh compiler source/executable/owner substitution refusal',
      () => verifyCompilerOwnerSubstitutions(compiler));
    const {build, evidence} = await required(t, 'actual kernel and complete independent native/no_std/Wasm corpus',
      () => verifyComponents(compiler, inputs));
    const phases = [];
    function checkpoint(name, result) {
      assert.match(name, /^[a-z0-9-]+$/);
      const path = join(build.work, 'phase-' + String(phases.length).padStart(2, '0') + '-' + name + '.json');
      const record = {scope: 'incomplete-operation-capture-phase', wholeOwnerAccepted: false,
        inputsSha256: sha(JSON.stringify(inputs)), source: build.verified.source_id,
        attestation: build.verified.attestation_id, ir: build.generation.ir_sha256, name, result};
      writeFileSync(path, JSON.stringify(record) + '\n', {flag: 'wx'});
      phases.push({name, path, sha256: sha(readFileSync(path))});
    }
    checkpoint('components', {evidence, compilerSubstitutions});
    const browsers = [], boundaries = [], maxima = [], hostDefects = [], sourceDefects = [];
    for (const engine of ['chromium', 'firefox', 'webkit']) {
      const observed = await required(t, engine + ' complete independent operation corpus and native invocation replay',
        () => verifyOperationVectors(build, operationCorpus(), {engine, label: engine + '-corpus'}));
      browsers.push({engine, ...observed});
      checkpoint(engine + '-corpus', observed);
      for (const id of boundaryJourneys) {
        const result = await required(t, engine + ' factory boundary ' + id,
          () => verifyOperationBoundary(build, id, {engine, label: engine + '-' + id}));
        boundaries.push({engine, id, ...result});
        checkpoint(engine + '-' + id, result);
      }
      const observedMaxima = await required(t, engine + ' complete operation maxima and one-over refusals', async () => {
        // One browser per engine; generate, verify and release each complete
        // 64-MiB vector before advancing. No case or transcript is sampled.
        function* rows() {yield* maximumVectors(); yield* effectResultMaxima();}
        const result = await verifyOperationVectors(build, rows(), {engine, label: engine + '-maxima'});
        assert.equal(result.result.length, 27, 'all 18 session and 9 effect-result maxima');
        assert.equal(new Set(result.result.map(row => row.id)).size, 27);
        return result;
      });
      maxima.push({engine, results: observedMaxima.result, calls: observedMaxima.calls});
      checkpoint(engine + '-maxima', observedMaxima);
    }
    const source = readFileSync(new URL('../../sdk/browser/session-operation-capture.mjs', import.meta.url), 'utf8');
    assert.equal(sha(source), inputs['sdk/browser/session-operation-capture.mjs']);
    for (const mutation of hostMutations) {
      const changed = mutateHost(source, mutation);
      await required(t, 'actual operation host defect ' + mutation.id, async () => {
        const options = {source: changed, label: 'mutant-' + mutation.id};
        const run = mutation.journey ? () => verifyOperationBoundary(build, mutation.journey, options)
          : () => verifyOperationVectors(build, operationCorpus().filter(row => row.id === mutation.vector), options);
        await assert.rejects(run, error => error.code === 'ERR_ASSERTION' && error.message.includes(mutation.journey
          ? 'operation boundary ' + mutation.journey + ' contract' : 'operation vector ' + mutation.vector + ' contract'),
        'named semantic counterexample required, not syntax, launch or compilation failure');
      });
      hostDefects.push({id: mutation.id, source: sha(changed)});
      checkpoint('host-' + mutation.id, hostDefects.at(-1));
    }
    for (const mutation of projectionMutations) {
      sourceDefects.push(await required(t, 'actual source defect ' + mutation.id,
        () => verifySourceMutation(compiler, inputs, build, mutation)));
      checkpoint('source-' + mutation.id, sourceDefects.at(-1));
    }
    assert.equal(hostDefects.length, 9); assert.equal(sourceDefects.length, 8);
    build.unchanged();
    const receipt = {...evidence, scope: 'private-DK-35-operation-capture-prerequisite', requiredBy: 'source-owned-browser-session-host',
      authenticatedCurrentState: false, effectsReleased: false, publicationAccepted: false,
      compilerSubstitutions, browsers, boundaries, maxima, hostDefects, sourceDefects, phases};
    const path = join(build.work, 'operation-capture-evidence.json'); writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
    t.diagnostic(JSON.stringify({work: build.work, receipt: sha(readFileSync(path)), scope: receipt.scope,
      browsers: browsers.length, boundaries: boundaries.length, maxima: maxima.reduce((n, row) => n + row.results.length, 0),
      hostDefects: hostDefects.length, sourceDefects: sourceDefects.length}));
    complete = true;
  } finally {
    const retirement = compiler.close();
    t.diagnostic(JSON.stringify({complete, compilerRetirement: retirement}));
  }
});
