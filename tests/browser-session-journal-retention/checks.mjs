// Execute actual generated source; expected cases never implement the reducer.
import assert from 'node:assert/strict';
import {existsSync, readFileSync, writeFileSync, linkSync, unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {prepareRetention, frozenInputs, compilerInputs, verifyFrozenInputs, run, sha, draft} from './compile.mjs';
import {createCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {verifyRetentionInputSubstitutions} from './input-checks.mjs';
import {retentionCorpus, retentionMaximumCorpus} from '../browser-session-journal/retention-corpus.mjs';
import {retentionMutations} from '../browser-session-journal/retention-mutations.mjs';
import {verifySessionStorage} from '../browser-session-journal/storage-browser.mjs';
import {verifyStorageTranscript, verifyStorageHostMutations} from '../browser-session-journal/storage-verification.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-session-journal/wasm-artifact-checks.mjs';

export function verifyNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' journal retention vectors twice\n', 'exact complete native case inventory');
}

export function verifyRetentionComponents(compilerOwner) {
  const build = prepareRetention(compilerOwner), rows = retentionCorpus();
  assert.equal(rows.length, 86, 'complete fixed independent retention corpus');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  // Plant actual generated-source defects before either first Cargo build.
  // Rewriting a matching manifest must not replace the in-memory capture.
  const library = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(library), originalManifest = readFileSync(manifest);
  for (const mode of ['source', 'source-and-manifest', 'extra-file', 'hard-link']) {
    const refusal = {source: /generated package manifest digest src\/lib\.rs/,
      'source-and-manifest': /immutable generated package captured immediately after code generation/,
      'extra-file': /complete generated package file inventory/, 'hard-link': /bounded single-link custody file/}[mode];
    const extra = mode === 'hard-link' ? join(build.work, 'linked-generated-source') : join(build.work, 'generated/unexpected');
    try {
      if (mode === 'source' || mode === 'source-and-manifest') {
        writeFileSync(library, Buffer.concat([original, Buffer.from('\n// planted generated-source change\n')]));
        if (mode === 'source-and-manifest') {const value = JSON.parse(originalManifest); value.files.find(row => row.path === 'src/lib.rs').sha256 = sha(readFileSync(library));
          writeFileSync(manifest, JSON.stringify(value, (_key, child) => child && !Array.isArray(child) && typeof child === 'object'
            ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child) + '\n');}
      } else if (mode === 'extra-file') writeFileSync(extra, 'planted extra package input', {flag: 'wx'});
      else linkSync(library, extra);
      for (const standard of [true, false]) {
        assert.throws(() => build.compileNative(standard), refusal);
        assert.ok(!existsSync(join(build.work, standard ? 'runner-std' : 'runner-no-std')), 'changed source refused before first observer/compiler creation');
      }
      assert.throws(() => build.unchanged(), refusal);
    } finally {
      if (mode === 'source' || mode === 'source-and-manifest') {writeFileSync(library, original); writeFileSync(manifest, originalManifest);}
      else unlinkSync(extra);
    }
    build.unchanged();
  }
  const file = join(build.work, 'retention.tsv'); writeFileSync(file, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) verifyNativeInventory(build.runNative(standard, ['retention', file]), rows);
  const wasmSubstitutions = verifyWasmArtifactSubstitutions(build);
  const artifact = requireGeneratedWasm(build.wasmOwners.retention);
  const observed = artifact.run(bytes => executeWasm(bytes, rows)); build.unchanged();
  const evidence = {scope: 'private-retention-component', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    wasm: artifact.evidence.original.sha256, cases: rows.length, observed, native: build.nativeEvidence(),
    inputs: build.inputs, generatedPackages: build.generatedPackages, generatedWasm: build.generatedWasm, wasmSubstitutions,
    generatedSourceSubstitutionRejected: ['source', 'source-and-manifest', 'extra-file', 'hard-link'],
    compilerTools: build.compilerTools, preparationMs: build.preparationMs};
  writeFileSync(join(build.work, 'retention-component-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}

export function verifyRetentionMaxima(build) {
  const input = join(build.work, 'maximum-input.bin'), expected = join(build.work, 'maximum-expected.bin');
  const artifact = requireGeneratedWasm(build.wasmOwners.retention);
  const evidence = [];
  for (const row of retentionMaximumCorpus()) {
    writeFileSync(input, row.request); writeFileSync(expected, row.response);
    for (const standard of [true, false]) assert.equal(build.runNative(standard, ['retention', input, expected]),
      'PASS binary journal retention twice\n', 'complete native maximum ' + row.id);
    const observed = artifact.run(() => JSON.parse(run(process.execPath,
      [join(draft, 'maximum-runner.mjs'), artifact.path, input, expected, artifact.evidence.original.sha256], build.work)));
    assert.equal(observed.request, sha(row.request)); assert.equal(observed.response, sha(row.response));
    assert.equal(observed.wasm, artifact.evidence.original.sha256);
    const result = {id: row.id, requestBytes: row.request.length, responseBytes: row.response.length, ...observed};
    console.log(JSON.stringify(result)); evidence.push(result);
  }
  assert.equal(evidence.length, 6); build.unchanged();
  writeFileSync(join(build.work, 'retention-maximum-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return evidence;
}

export function verifyCompiledMutation(mutation, baseline) {
  const row = retentionCorpus().find(row => row.id === mutation.probe); assert.ok(row);
  baseline.unchanged(); const build = prepareRetention(baseline.compilerOwner, mutation.id, baseline.inputs);
  assert.notEqual(build.verified.source_id, baseline.verified.source_id);
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const artifact = requireGeneratedWasm(build.wasmOwners.retention);
  assert.notEqual(artifact.evidence.original.sha256, requireGeneratedWasm(baseline.wasmOwners.retention).evidence.original.sha256);
  const file = join(build.work, 'mutation.tsv'); writeFileSync(file, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['retention', file]),
    /native output mismatch/, 'actual compiled source defect must change native behavior');
  assert.throws(() => artifact.run(bytes => executeWasm(bytes, [row])),
    error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id),
    'actual Wasm response mismatch required, not a compilation failure or trap');
  build.unchanged(); baseline.unchanged();
  const evidence = {mutation: build.mutation, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: artifact.evidence.original.sha256, generatedWasm: build.generatedWasm,
    request: sha(row.request), expected: sha(row.response),
    native: build.nativeEvidence(), generatedPackages: build.generatedPackages,
    compiler: build.compilerOwner.identity, preparationMs: build.preparationMs};
  writeFileSync(join(build.work, 'retention-mutation-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({id: mutation.id, work: build.work, status: 'real compiled defect detected'})); return evidence;
}

export async function verifyRetentionOwner(t) {
  const inputs = frozenInputs(), inputSubstitutions = verifyRetentionInputSubstitutions(inputs);
  const compiler = createCompilerOwner('session-retention', compilerInputs(inputs));
  const compilerSubstitutions = verifyCompilerOwnerSubstitutions(compiler, inputs);
  const {build, evidence} = verifyRetentionComponents(compiler);
  for (const standard of [true, false]) {
    const path = build.compileNative(standard), bytes = readFileSync(path);
    try {writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
      assert.throws(() => build.runNative(standard, ['retention', join(build.work, 'retention.tsv')]), /private native executable changed/);
      assert.throws(() => build.unchanged(), /private native executable changed/);
    } finally {writeFileSync(path, bytes);}
  }
  const poisoned = join(build.work, 'changed-generated.wasm'), probe = retentionCorpus()[0];
  const artifact = requireGeneratedWasm(build.wasmOwners.retention);
  const input = join(build.work, 'identity-input.bin'), expected = join(build.work, 'identity-expected.bin');
  artifact.run(bytes => writeFileSync(poisoned, Buffer.concat([bytes, Buffer.from([0])]), {flag: 'wx'}));
  writeFileSync(input, probe.request, {flag: 'wx'}); writeFileSync(expected, probe.response, {flag: 'wx'});
  assert.throws(() => run(process.execPath,
    [join(draft, 'maximum-runner.mjs'), poisoned, input, expected, artifact.evidence.original.sha256], build.work),
  /actual generated maximum Wasm identity/);
  const maxima = verifyRetentionMaxima(build), browser = [];
  const calls = await artifact.runAsync(bytes => verifySessionStorage({async test(name, body) {
    let failure; await t.test(name, async () => {try {await body();} catch (error) {failure = error; throw error;}});
    if (failure) throw failure; browser.push(name);
  }}, bytes, {inputs: build.inputs}));
  assert.equal(browser.length, 11); build.unchanged();
  const browserTranscript = verifyStorageTranscript(build, calls);
  const hostMutations = await artifact.runAsync(bytes => verifyStorageHostMutations(t, bytes, {inputs: build.inputs}));
  assert.equal(hostMutations.length, 6); build.unchanged();
  const mutations = retentionMutations.map(mutation => verifyCompiledMutation(mutation, build));
  assert.equal(mutations.length, 9); build.unchanged();
  const receipt = {...evidence, scope: 'private-retention-source-and-storage-component',
    executableSubstitutionRejected: ['std', 'no-std', 'wasm'], compilerSubstitutions, inputSubstitutions,
    maxima, browser, browserTranscript, hostMutations, mutations};
  receipt.compilerCacheRetirement = compiler.close();
  assert.throws(() => compiler.runDriver(['--help'], build.work), /compiler owner closed/);
  assert.throws(() => compiler.close(), /compiler owner closed/);
  verifyFrozenInputs(inputs);
  writeFileSync(join(build.work, 'retention-source-owner-evidence.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence: receipt};
}
