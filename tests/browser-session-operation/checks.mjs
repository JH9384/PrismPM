import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareOperation, roles, sha} from './compile.mjs';
import {projectionCorpus, observationCorpus} from '../browser-session-journal/projection-corpus.mjs';
import {corpus as sessionCorpus} from '../browser-session/corpus.mjs';
import {corpus as descriptorCorpus, partitionCorpus} from '../browser-operation-journal/corpus.mjs';
import {executeWasm, tsv} from '../browser-session-journal/runtime.mjs';
import {projectionMutations} from '../browser-session-journal/projection-mutations.mjs';
import {verifyWasmArtifactSubstitutions} from '../browser-session-journal/wasm-artifact-checks.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyNativeDuringUse} from './native-custody.mjs';
import {verifyNativeTranscriptReplay} from './replay-checks.mjs';

export function componentCorpus() {
  return {predecessor: projectionCorpus(), session: sessionCorpus(), observation: observationCorpus(),
    partition: partitionCorpus(), descriptor: descriptorCorpus()};
}
export async function verifyComponents(compiler, inputs) {
  const build = prepareOperation(compiler, inputs), vectors = componentCorpus(), observed = {};
  assert.deepEqual(Object.fromEntries(Object.entries(vectors).map(([key, rows]) => [key, rows.length])),
    {predecessor: 904, session: 895, observation: 596, partition: 7, descriptor: 68});
  assert.throws(() => {build.verified.modules[0] = 'Replaced';}, TypeError);
  assert.throws(() => {build.generation.ir_sha256 = '0'.repeat(64);}, TypeError);
  const firstFile = Object.keys(build.generatedPackages[0].files)[0]; assert.ok(firstFile);
  assert.throws(() => {build.generatedPackages[0].files[firstFile] = '0'.repeat(64);}, TypeError);
  const proofSubstitutions = [];
  for (const [kind, path] of [
    ['kernel-manifest', join(build.verified.root, 'build-manifest.json')],
    ['kernel-attestation', join(build.verified.root, 'attestation.json')],
    ['original-generated-lean', join(build.verified.root, 'modules/PrismPM/Fixture.lean')],
    ['staged-generated-lean', join(build.work, 'lean/PrismPM/Fixture.lean')],
    ['captured-source', join(build.work, 'project/src/Fixture.lex.tex')],
  ]) {
    const bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from('\n')]));
      for (const standard of [true, false]) {
        assert.throws(() => build.compileNative(standard), {code: 'ERR_ASSERTION'});
        assert.equal(lstatSync(join(build.work, 'runner-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined,
          'changed proof/source refuses before first native compilation');
      }
      assert.throws(() => build.unchanged(), {code: 'ERR_ASSERTION'});
    } finally {writeFileSync(path, bytes);}
    build.unchanged(); proofSubstitutions.push(kind);
  }
  const library = join(build.work, 'generated/src/lib.rs'), manifest = join(build.work, 'generated/generation-manifest.json');
  const original = readFileSync(library), manifestBytes = readFileSync(manifest);
  for (const rewrite of [false, true]) {
    const refusal = rewrite ? /immutable generated package captured immediately after code generation/
      : /generated package manifest digest src\/lib\.rs/;
    try {
      writeFileSync(library, Buffer.concat([original, Buffer.from('\n// actual substituted generated source\n')]));
      if (rewrite) {
        const data = JSON.parse(manifestBytes); data.files.find(row => row.path === 'src/lib.rs').sha256 = sha(readFileSync(library));
        writeFileSync(manifest, JSON.stringify(data, (_key, child) => child && !Array.isArray(child) && typeof child === 'object'
          ? Object.fromEntries(Object.keys(child).sort().map(key => [key, child[key]])) : child) + '\n');
      }
      for (const standard of [true, false]) {
        assert.throws(() => build.compileNative(standard), refusal);
        assert.equal(lstatSync(join(build.work, 'runner-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined);
      }
      assert.throws(() => build.unchanged(), refusal);
    } finally {writeFileSync(library, original); writeFileSync(manifest, manifestBytes);}
    build.unchanged();
  }
  const substitutions = verifyWasmArtifactSubstitutions(build);
  for (const entry of roles) {
    const rows = vectors[entry];
    if (entry === 'partition') {
      for (const row of rows) {
        const input = join(build.work, 'partition-input.bin'), output = join(build.work, 'partition-expected.bin');
        writeFileSync(input, row.request); writeFileSync(output, row.response);
        for (const standard of [true, false]) assert.equal(build.runNative(standard, [entry, input, output]), 'PASS binary operation component twice\n');
      }
    } else {
      const path = join(build.work, entry + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
      const expected = rows.map(row => 'PASS ' + row.id + '\n').join('') + 'PASS ' + rows.length + ' operation component vectors twice\n';
      for (const standard of [true, false]) assert.equal(build.runNative(standard, [entry, path]), expected);
    }
    observed[entry] = requireGeneratedWasm(build.wasmOwners[entry]).run(bytes => executeWasm(bytes, rows.filter(row => !row.nativeOnly)));
  }
  const nativeSubstitutions = [];
  for (const standard of [true, false]) {
    const record = build.nativeEvidence()[standard ? 'std' : 'no-std'];
    for (const side of ['original', 'private']) {
      const path = join(build.work, record[side].path), bytes = readFileSync(path), mode = lstatSync(path).mode & 0o777;
      try {
        chmodSync(path, mode | 0o200); writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
        assert.throws(() => build.runNative(standard, ['session', join(build.work, 'session.tsv')]), /immutable (original|private) compiler|compiler link count/);
        assert.throws(() => build.unchanged(), /immutable (original|private) compiler/);
      } finally {writeFileSync(path, bytes); chmodSync(path, mode);}
      build.unchanged();
      const saved = path + '.saved'; renameSync(path, saved);
      try {
        copyFileSync(saved, path); chmodSync(path, mode);
        assert.throws(() => build.runNative(standard, ['session', join(build.work, 'session.tsv')]), /immutable (original|private) compiler|compiler link count/);
      } finally {unlinkSync(path); renameSync(saved, path);}
      build.unchanged(); nativeSubstitutions.push((standard ? 'std:' : 'no-std:') + side);
    }
  }
  const nativeDuringUse = await verifyNativeDuringUse(build, vectors.session.find(row => row.id === 'Initialize'));
  const nativeTranscriptReplay = verifyNativeTranscriptReplay(build, vectors);
  return {build, evidence: {scope: 'private-operation-kernels', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    cases: Object.fromEntries(Object.entries(vectors).map(([entry, rows]) => [entry, rows.length])),
    observed, substitutions, nativeSubstitutions, nativeDuringUse, nativeTranscriptReplay, proofSubstitutions, provenance: build.provenance, compiler: build.compiler,
    generatedPackages: build.generatedPackages, generatedWasm: build.generatedWasm, native: build.nativeEvidence(), inputs}};
}

export function verifySourceMutation(compiler, inputs, baseline, mutation) {
  assert.ok(projectionMutations.includes(mutation)); baseline.unchanged();
  const build = prepareOperation(compiler, inputs, mutation.id);
  const inventory = mutation.entry === 'predecessor' ? projectionCorpus() : observationCorpus();
  const rows = mutation.probes.map(id => {const row = inventory.find(row => row.id === id); assert.ok(row); return row;});
  for (const field of ['source_id', 'attestation_id']) assert.notEqual(build.verified[field], baseline.verified[field]);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const artifact = requireGeneratedWasm(build.wasmOwners[mutation.entry]);
  assert.notEqual(artifact.evidence.original.sha256, baseline.wasmOwners[mutation.entry].evidence.original.sha256);
  for (const row of rows) {
    const path = join(build.work, row.id + '.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [mutation.entry, path]), /native output mismatch/);
    assert.throws(() => artifact.run(bytes => executeWasm(bytes, [row])),
      error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id), 'actual source mutant changes byte behavior');
  }
  build.unchanged(); baseline.unchanged();
  return {id: mutation.id, work: build.work, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: artifact.evidence.original.sha256, cases: rows.map(row => row.id), provenance: build.provenance};
}
