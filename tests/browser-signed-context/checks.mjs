// Private complete owner. All behavior originates in genuinely compiled source.
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, existsSync, linkSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {frozenInputs, prepareSignedContext, sha} from './compile.mjs';
import {corpus} from './corpus.mjs';
import {mutations} from './mutations.mjs';
import {createCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-session-journal/wasm-artifact-checks.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {browserFixture, replayBrowser} from './browser.mjs';
import {verifyHostMutations} from './host-mutations.mjs';
import {captureWpt, collectBrowserWpt, verifyCollectedWpt, verifyNativeWpt} from './wpt.mjs';
import {createRequiredChecks, executeRequiredSubtest, writeOwnerReport} from './aggregate.mjs';

export function verifyNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + `PASS ${rows.length} signed context vectors twice\n`, 'exact native case inventory');
}
export function coherentlyRehashedManifest(original, library) {
  const value = JSON.parse(original), rows = value.files.filter(row => row.path === 'src/lib.rs');
  assert.equal(rows.length, 1, 'one actual generated library manifest member');
  rows[0].sha256 = sha(library);
  return Buffer.from(JSON.stringify(value) + '\n');
}
export function verifyComponents(compiler) {
  const build = prepareSignedContext(compiler), rows = corpus();
  assert.equal(rows.length, 1573); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  const library = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(library), originalManifest = readFileSync(manifest);
  for (const mode of ['source', 'source-and-manifest', 'extra-file', 'hard-link']) {
    const extra = mode === 'hard-link' ? join(build.work, 'linked-generated-source') : join(build.work, 'generated/unexpected');
    try {
      if (mode === 'source' || mode === 'source-and-manifest') {
        writeFileSync(library, Buffer.concat([original, Buffer.from('\n// planted defect\n')]));
        if (mode === 'source-and-manifest') writeFileSync(manifest, coherentlyRehashedManifest(originalManifest, readFileSync(library)));
      } else if (mode === 'extra-file') writeFileSync(extra, 'unowned', {flag: 'wx'});
      else linkSync(library, extra);
      const refusal = mode === 'hard-link' ? /bounded single-link custody file/ : /generated package/;
      for (const standard of [true, false]) {
        assert.throws(() => build.compileNative(standard), refusal);
        assert.ok(!existsSync(join(build.work, standard ? 'runner-std' : 'runner-no-std')));
      }
      assert.throws(() => build.unchanged(), refusal);
    } finally {
      if (mode === 'source' || mode === 'source-and-manifest') {writeFileSync(library, original); writeFileSync(manifest, originalManifest);}
      else unlinkSync(extra);
    }
    build.unchanged();
  }
  const path = join(build.work, 'corpus.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) verifyNativeInventory(build.runNative(standard, ['signed-context', path]), rows);
  const artifact = requireGeneratedWasm(build.wasmOwners['signed-context']);
  const wasm = artifact.run(bytes => executeWasm(bytes, rows)); build.unchanged();
  const evidence = {scope: 'private-signed-context-generated-component', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    wasm: artifact.evidence.original.sha256, cases: rows.length, observed: wasm,
    native: build.nativeEvidence(), nativeArtifacts: build.nativeArtifactEvidence(), inputs: build.inputs, generatedPackages: build.generatedPackages,
    generatedWasm: build.generatedWasm, compiler: build.compilerTools,
    actualValidMaximum: 1037, frameMaximum: 2048, frameOverflow: 2049};
  writeFileSync(join(build.work, 'signed-context-component.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}
export function verifyCompiledMutation(mutation, baseline) {
  baseline.unchanged();
  const row = corpus().find(row => row.id === mutation.probe); assert.ok(row);
  const build = prepareSignedContext(baseline.compilerOwner, mutation.id, baseline.inputs);
  for (const field of ['source_id', 'attestation_id']) assert.notEqual(build.verified[field], baseline.verified[field]);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const artifact = requireGeneratedWasm(build.wasmOwners['signed-context']);
  assert.notEqual(artifact.evidence.original.sha256, baseline.wasmOwners['signed-context'].evidence.original.sha256);
  const path = join(build.work, 'mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['signed-context', path]),
    error => error.message.includes(row.id + ' native output mismatch'),
    'the selected source counterexample, not an unrelated native failure');
  assert.throws(() => artifact.run(bytes => executeWasm(bytes, [row])), error => error.code === 'ERR_ASSERTION'
    && error.message.includes(row.id), 'actual native and Wasm behavioral counterexample, not compile/trap');
  build.unchanged(); baseline.unchanged();
  const evidence = {mutation: build.mutation, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: artifact.evidence.original.sha256,
    request: sha(row.request), response: sha(row.response), native: build.nativeEvidence(), nativeArtifacts: build.nativeArtifactEvidence(),
    generatedPackages: build.generatedPackages, generatedWasm: build.generatedWasm};
  writeFileSync(join(build.work, 'signed-context-mutation.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({mutation: mutation.id, work: build.work, status: 'actual compiled defect detected'}));
  return evidence;
}
export async function verifySignedContext(t) {
  const inputs = frozenInputs(), compiler = createCompilerOwner('signed-context');
  const required = createRequiredChecks(['generated', 'artifact-custody', 'chromium', 'firefox', 'webkit', 'source-mutants', 'final-closure']);
  let build, evidence, wpt;
  const step = async (id, name, body, fatal = false) => {
    const outcome = await required.check(id, () => executeRequiredSubtest(t, name, body));
    if (fatal && !outcome.ok) throw outcome.error;
  };
  await step('generated', 'complete generated source/kernel/native/std/no_std/two-Wasm and all1573 vectors', () => {
    ({build, evidence} = verifyComponents(compiler));
  }, true);
  await step('artifact-custody', 'actual package/compiler/native/Wasm capture substitutions are refused', () => {
    evidence.compilerSubstitutions = verifyCompilerOwnerSubstitutions(compiler);
    evidence.wasmSubstitutions = verifyWasmArtifactSubstitutions(build);
    for (const standard of [true, false]) {
      build.compileNative(standard);
      const artifacts = build.nativeArtifactEvidence()[standard ? 'std' : 'no-std'];
      for (const side of ['original', 'private']) {
        const path = join(build.work, artifacts[side].path), original = readFileSync(path), mode = lstatSync(path).mode & 0o777;
        const refusal = /immutable (original|private) compiler|compiler link count/;
        try {
          chmodSync(path, mode | 0o200); writeFileSync(path, Buffer.concat([original, Buffer.from([0])]));
          assert.throws(() => build.runNative(standard, ['signed-context', join(build.work, 'corpus.tsv')]), refusal);
        } finally {writeFileSync(path, original); chmodSync(path, mode);}
        build.unchanged();
        const saved = path + '.original-inode'; renameSync(path, saved);
        try {
          copyFileSync(saved, path); chmodSync(path, mode);
          assert.throws(() => build.runNative(standard, ['signed-context', join(build.work, 'corpus.tsv')]), refusal);
        } finally {unlinkSync(path); renameSync(saved, path);}
        build.unchanged();
        const alias = path + '.unaccepted-link'; linkSync(path, alias);
        try {assert.throws(() => build.runNative(standard, ['signed-context', join(build.work, 'corpus.tsv')]), /compiler link count/);}
        finally {unlinkSync(alias);}
        build.unchanged();
      }
    }
    build.unchanged(); wpt = captureWpt(); evidence.independentNativeCrypto = verifyNativeWpt(wpt);
  }, true);
  evidence.browser = [];
  for (const engine of ['chromium', 'firefox', 'webkit']) await step(engine,
    engine + ' actual signed contexts, crypto, complete WPT and host mutants', async () => {
    const checks = createRequiredChecks(['pristine-sdk', 'original-wpt', 'host-mutants']), row = {engine};
    const pristine = await checks.check('pristine-sdk', async () => {
      row.result = await browserFixture(build, engine);
      row.replay = replayBrowser(build, row.result, 'browser-' + engine);
    });
    await checks.check('original-wpt', async () => {
      row.wpt = await collectBrowserWpt(engine, wpt);
      writeFileSync(join(build.work, 'original-wpt-' + engine + '.json'),
        JSON.stringify({scope: 'raw-provider-observations', accepted: false, result: row.wpt}, null, 2) + '\n', {flag: 'wx'});
      verifyCollectedWpt(wpt, row.wpt);
    });
    await checks.check('host-mutants', async () => {
      assert.ok(pristine.ok, 'host mutants require the complete pristine SDK journey and native replay');
      row.hostMutations = await verifyHostMutations(build, engine);
    });
    row.checks = checks.report(); evidence.browser.push(row);
    build.unchanged(); checks.finish();
  });
  await step('source-mutants', 'all24 actual compiled source defects produce semantic counterexamples', async () => {
    assert.equal(mutations.length, 24);
    const checks = createRequiredChecks(mutations.map(mutation => mutation.id));
    evidence.sourceMutations = [];
    for (const mutation of mutations) {
      // Integrity loss is a safety boundary, not permission to use a corrupted
      // baseline for further diagnostic compilations.
      build.unchanged();
      await checks.check(mutation.id, () => {
        evidence.sourceMutations.push(verifyCompiledMutation(mutation, build));
      });
    }
    evidence.sourceMutationChecks = checks.report(); build.unchanged(); checks.finish();
    assert.equal(evidence.sourceMutations.length, 24);
  });
  await step('final-closure', 'complete original input and generated artifact closure remains unchanged', () => {
    assert.deepEqual(frozenInputs(), inputs); build.unchanged(); wpt.unchanged();
    evidence.compilerRetirement = compiler.close();
    assert.throws(() => compiler.runDriver(['--help'], build.work), /compiler owner closed/);
  });
  writeOwnerReport(required, evidence, build.work);
  console.log(JSON.stringify({work: build.work, source: build.verified.source_id, scope: evidence.scope, publicApplicationAccepted: false}));
  return {build, evidence};
}
