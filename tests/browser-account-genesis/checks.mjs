// Private complete owner. All behavior originates in genuinely compiled source.
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, existsSync, linkSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {frozenInputs, prepareAccountGenesis, sha} from './compile.mjs';
import {CORPUS_CASES, corpus} from './corpus.mjs';
import {mutations} from './mutations.mjs';
import {createCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-p256/wasm-artifact-checks.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {browserFixture, verifyObservations} from './browser.mjs';
import {verifyHostMutations} from './host-mutations.mjs';
import {verifyBootstrapFaults} from './bootstrap-faults.mjs';
const mutationArtifacts = new WeakMap();

export function verifyNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + `PASS ${rows.length} account-genesis vectors twice\n`, 'exact native case inventory');
}
export function coherentlyRehashedManifest(original, library) {
  const value=JSON.parse(original), rows=value.files.filter(row=>row.path==='src/lib.rs');
  assert.equal(rows.length,1,'one actual generated library manifest member');
  rows[0].sha256=sha(library);
  return Buffer.from(JSON.stringify(value)+'\n');
}
export function verifyComponents(compiler) {
  const build = prepareAccountGenesis(compiler), rows = corpus();
  assert.equal(rows.length, CORPUS_CASES); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  const library = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(library), originalManifest = readFileSync(manifest);
  for (const mode of ['source', 'source-and-manifest', 'extra-file', 'hard-link']) {
    const extra = mode === 'hard-link' ? join(build.work, 'linked-generated-source') : join(build.work, 'generated/unexpected');
    try {
      if (mode === 'source' || mode === 'source-and-manifest') {
        writeFileSync(library, Buffer.concat([original, Buffer.from('\n// planted defect\n')]));
        if (mode === 'source-and-manifest') writeFileSync(manifest,coherentlyRehashedManifest(originalManifest,readFileSync(library)));
      } else if (mode === 'extra-file') writeFileSync(extra, 'unowned', {flag: 'wx'});
      else linkSync(library, extra);
      const refusal=mode==='hard-link'?/bounded single-link custody file/:/generated package/;
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
  for (const standard of [true, false]) verifyNativeInventory(build.runNative(standard, ['account-genesis', path]), rows);
  const artifact = requireGeneratedWasm(build.wasmOwners['account-genesis']);
  const wasm = artifact.run(bytes => executeWasm(bytes, rows)); build.unchanged();
  const evidence = {scope: 'private-account-genesis-generated-component', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    wasm: artifact.evidence.original.sha256, cases: rows.length, observed: wasm,
    native: build.nativeEvidence(), nativeArtifacts: build.nativeArtifactEvidence(), inputs: build.inputs, generatedPackages: build.generatedPackages,
    generatedWasm: build.generatedWasm, compiler: build.compilerTools,
    actualValidMaximum: 174, frameMaximum: 512, frameOverflow: 513,
    inputAllocationMaximum: 1024, outputAllocationMaximum: 512};
  writeFileSync(join(build.work, 'account-genesis-component.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}
export function verifyCompiledMutation(mutation, baseline) {
  baseline.unchanged();
  const row = corpus().find(row => row.id === mutation.probe); assert.ok(row);
  const build = prepareAccountGenesis(baseline.compilerOwner, mutation.id, baseline.inputs);
  for (const field of ['source_id', 'attestation_id']) assert.notEqual(build.verified[field], baseline.verified[field]);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const artifact = requireGeneratedWasm(build.wasmOwners['account-genesis']);
  assert.notEqual(artifact.evidence.original.sha256, baseline.wasmOwners['account-genesis'].evidence.original.sha256);
  const path = join(build.work, 'mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['account-genesis', path]),
    error => error.message.includes(row.id + ' native output mismatch'),
    'the selected source counterexample, not a build failure or unrelated exception');
  assert.throws(() => artifact.run(bytes => executeWasm(bytes, [row])), error => error.code === 'ERR_ASSERTION'
    && error.message.includes(row.id), 'actual native and Wasm behavioral counterexample, not compile/trap');
  build.unchanged(); baseline.unchanged();
  const evidence = {mutation: build.mutation, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: artifact.evidence.original.sha256,
    request: sha(row.request), response: sha(row.response), native: build.nativeEvidence(), nativeArtifacts: build.nativeArtifactEvidence(),
    generatedPackages: build.generatedPackages, generatedWasm: build.generatedWasm};
  writeFileSync(join(build.work, 'account-genesis-mutation.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({mutation: mutation.id, work: build.work, status: 'actual compiled defect detected'}));
  mutationArtifacts.set(evidence, build.wasmOwners['account-genesis']);
  return evidence;
}
export async function executeRequiredSubtest(t, name, body) {
  let entered = false, completed = false, failed = false, failure;
  await t.test(name, async () => {
    entered = true;
    try {await body(); completed = true;}
    catch (error) {failed = true; failure = error; throw error;}
  });
  assert.ok(entered, 'required account-genesis subtest body was not executed');
  if (failed) throw failure;
  assert.ok(completed, 'required account-genesis subtest body did not complete');
}

export async function verifyAccountGenesis(t) {
  const inputs = frozenInputs(), compiler = createCompilerOwner('account-genesis');
  let build, evidence;
  const step = (name, body) => executeRequiredSubtest(t, name, body);
  await step('complete generated source/kernel/native/std/no_std/two-Wasm and all' + CORPUS_CASES + ' vectors', () => {
    ({build, evidence} = verifyComponents(compiler));
  });
  await step('actual package/compiler/native/Wasm capture substitutions are refused', () => {
    evidence.compilerSubstitutions = verifyCompilerOwnerSubstitutions(compiler, inputs);
    evidence.wasmSubstitutions = verifyWasmArtifactSubstitutions(build);
    for (const standard of [true, false]) {
      build.compileNative(standard);
      const artifacts=build.nativeArtifactEvidence()[standard?'std':'no-std'];
      for(const side of ['original','private']) {
        const path=join(build.work,artifacts[side].path),original=readFileSync(path),mode=lstatSync(path).mode&0o777;
        const refusal=/immutable (original|private) compiler|compiler link count/;
        try {
          chmodSync(path,mode|0o200);writeFileSync(path,Buffer.concat([original,Buffer.from([0])]));
          assert.throws(()=>build.runNative(standard,['account-genesis',join(build.work,'corpus.tsv')]),refusal);
        } finally {writeFileSync(path,original);chmodSync(path,mode);}
        build.unchanged();
        const saved=path+'.original-inode';renameSync(path,saved);
        try {
          copyFileSync(saved,path);chmodSync(path,mode);
          assert.throws(()=>build.runNative(standard,['account-genesis',join(build.work,'corpus.tsv')]),refusal);
        } finally {unlinkSync(path);renameSync(saved,path);}
        build.unchanged();
        const alias=path+'.unaccepted-link';linkSync(path,alias);
        try {assert.throws(()=>build.runNative(standard,['account-genesis',join(build.work,'corpus.tsv')]),/compiler link count/);}
        finally {unlinkSync(alias);}
        build.unchanged();
      }
    }
    build.unchanged();
  });
  await step('all11 actual compiled source defects produce semantic counterexamples', () => {
    evidence.sourceMutations = mutations.map(mutation => verifyCompiledMutation(mutation, build));
    assert.equal(evidence.sourceMutations.length, 11); build.unchanged();
  });
  const foreignArtifact = mutationArtifacts.get(evidence.sourceMutations[0]);
  assert.ok(foreignArtifact, 'actual compiled foreign model required for every browser bootstrap adversary');
  evidence.browser = [];
  for (const engine of ['chromium', 'firefox', 'webkit']) await step(engine + ' actual account genesis, curve/hash checks and host mutants', async () => {
    const result = await browserFixture(build, engine, null, foreignArtifact), replay = replayBrowser(build, result, 'browser-' + engine);
    const bootstrap = await verifyBootstrapFaults(build, engine, foreignArtifact);
    const hostMutations = await verifyHostMutations(build, engine, foreignArtifact);
    evidence.browser.push({result, replay, bootstrap, hostMutations}); build.unchanged();
  });
  await step('complete original input and generated artifact closure remains unchanged', () => {
    assert.deepEqual(frozenInputs(), inputs); build.unchanged();
  });
  evidence.scope = 'private-account-genesis-complete-component';
  evidence.consumerIntegrationAccepted = false;
  evidence.compilerRetirement = compiler.close();
  assert.throws(() => compiler.runDriver(['--help'], build.work), /compiler owner closed/);
  build.unchangedSourcesAndProducts();
  assert.deepEqual(frozenInputs(),inputs,'complete account model and artifact closure survives compiler retirement');
  writeFileSync(join(build.work, 'account-genesis-owner.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({work: build.work, source: build.verified.source_id, scope: evidence.scope, publicApplicationAccepted: false}));
  return {build, evidence};
}

function replayBrowser(build, result, stem) {
  verifyObservations(result);
  const rows = result.calls.map((row, index) => ({id: 'Observed' + index,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  const path = join(build.work, stem + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) verifyNativeInventory(build.runNative(standard, ['account-genesis', path]), rows);
  const dropped = structuredClone(result); dropped.calls.pop(); assert.throws(() => verifyObservations(dropped));
  const renamed = structuredClone(result); renamed.journeys[0].id = 'unknown'; assert.throws(() => verifyObservations(renamed));
  const wrongTag = structuredClone(result);
  wrongTag.calls[0].request = '820100';
  assert.throws(() => verifyObservations(wrongTag), /exact source operation tags/);
  const changed = rows.map(row => ({...row, response: Buffer.from(row.response)})); changed[0].response[0] ^= 1;
  const defect = join(build.work, stem + '-changed.tsv'); writeFileSync(defect, tsv(changed), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['account-genesis', defect]),
    error => error.message.includes('Observed0 native output mismatch'));
  return {journeys: result.journeys.length, calls: result.calls.length,
    transcript: sha(Buffer.from(tsv(rows))), native: build.nativeEvidence()};
}
