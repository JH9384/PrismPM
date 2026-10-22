import assert from 'node:assert/strict';
import {lstatSync, readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareProjection, run, sha, draft} from './compile.mjs';
import {projectionCorpus, projectExpected, observationCorpus, observedExpected} from './projection-corpus.mjs';
import {decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {corpus} from '../browser-session/corpus.mjs';
import {maximumVectors, effectResultMaxima} from '../browser-session/maxima.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {projectionMutations} from './projection-mutations.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {verifyWasmArtifactSubstitutions} from './wasm-artifact-checks.mjs';

export function verifyNativeProjectionInventory(output, rows) {
  const expected = rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' journal projection vectors twice\n';
  assert.equal(output, expected, 'complete exact native vector inventory');
}

export function verifyProjection() {
  const build = prepareProjection(), projection = projectionCorpus(), session = corpus(), observation = observationCorpus();
  const generatedSource = join(build.work, 'generated/src/lib.rs'), generatedBytes = readFileSync(generatedSource);
  try {
    writeFileSync(generatedSource, Buffer.concat([generatedBytes, Buffer.from('\n// substituted before first compile\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => build.compileNative(standard), /generated package manifest digest/);
      assert.equal(lstatSync(join(build.work, 'runner-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined,
        'changed generated package refuses before creating or compiling the native observer');
    }
    assert.throws(() => build.unchanged(), /generated package manifest digest/);
  } finally {writeFileSync(generatedSource, generatedBytes);}
  build.unchanged();
  assert.equal(projection.length, 904); assert.equal(session.length, 895); assert.equal(observation.length, 596);
  const vectors = {predecessor: projection, session, observation};
  const paths = {};
  for (const [entry, rows] of Object.entries(vectors)) {
    paths[entry] = join(build.work, entry + '.tsv'); writeFileSync(paths[entry], tsv(rows), {flag: 'wx'});
  }
  for (const standard of [true, false]) {
    for (const [entry, rows] of Object.entries(vectors)) {
      const output = build.runNative(standard, [entry, paths[entry]]);
      verifyNativeProjectionInventory(output, rows);
    }
  }
  const wasmSubstitutions = verifyWasmArtifactSubstitutions(build);
  const observed = Object.fromEntries(Object.entries(vectors).map(([entry, rows]) =>
    [entry, requireGeneratedWasm(build.wasmOwners[entry]).run(bytes => executeWasm(bytes, rows))]));
  build.unchanged();
  const evidence = {scope: 'private-predecessor-projection-component', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    artifacts: Object.fromEntries(Object.entries(build.wasmOwners).map(([entry, owner]) => [entry, requireGeneratedWasm(owner).evidence.original.sha256])),
    cases: {predecessor: projection.length, session: session.length, observation: observation.length}, observed,
    native: build.nativeEvidence(), inputs: build.inputs, cacheRetirement: build.cacheRetirement,
    generatedPackages: build.generatedPackages, generatedWasm: build.generatedWasm, wasmSubstitutions,
    generatedSourceSubstitutionRejected: ['before-first-std', 'before-first-no-std']};
  writeFileSync(join(build.work, 'projection-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}

export function verifyProjectionMaxima(build) {
  const artifact = requireGeneratedWasm(build.wasmOwners.predecessor);
  const input = join(build.work, 'projection-maximum-input.bin'), expected = join(build.work, 'projection-maximum-output.bin');
  const results = [];
  // Generator chaining avoids retaining every complete 64-MiB vector at once.
  for (const factory of [maximumVectors, effectResultMaxima]) for (const baseline of factory()) {
    const row = projectExpected(baseline);
    writeFileSync(input, row.request); writeFileSync(expected, row.response);
    for (const standard of [true, false]) assert.equal(build.runNative(standard, ['predecessor', input, expected]),
      'PASS binary journal projection twice\n');
    const observed = artifact.run(() => JSON.parse(run(process.execPath,
      [join(draft, 'maximum-runner.mjs'), artifact.path, input, expected, artifact.evidence.original.sha256], build.work)));
    assert.equal(observed.request, sha(row.request)); assert.equal(observed.response, sha(row.response));
    assert.equal(observed.wasm, artifact.evidence.original.sha256);
    assert.ok(observed.maximumBytes <= 1073741824); assert.equal(observed.declaredPages, 16384);
    const result = {id: row.id, requestBytes: row.request.length, responseBytes: row.response.length, ...observed};
    console.log(JSON.stringify(result)); results.push(result);
  }
  assert.equal(results.length, 27, '18 session and 9 effect-result domain maxima');
  build.unchanged();
  writeFileSync(join(build.work, 'projection-maxima-evidence.json'), JSON.stringify(results, null, 2) + '\n', {flag: 'wx'});
  return results;
}

export function verifyObservationMaxima(build) {
  const artifact = requireGeneratedWasm(build.wasmOwners.observation);
  const input = join(build.work, 'observation-maximum-input.bin'), expected = join(build.work, 'observation-maximum-output.bin');
  const results = [];
  for (const factory of [maximumVectors, effectResultMaxima]) for (const baseline of factory()) {
    const reply = decode(baseline.response);
    if (reply[1] !== 0 || !Array.isArray(reply[2])) continue;
    const row = {id: baseline.id, request: baseline.response, response: observedExpected(baseline.response)};
    writeFileSync(input, row.request); writeFileSync(expected, row.response);
    for (const standard of [true, false]) assert.equal(build.runNative(standard, ['observation', input, expected]),
      'PASS binary journal projection twice\n');
    const observed = artifact.run(() => JSON.parse(run(process.execPath,
      [join(draft, 'maximum-runner.mjs'), artifact.path, input, expected, artifact.evidence.original.sha256], build.work)));
    assert.equal(observed.request, sha(row.request)); assert.equal(observed.response, sha(row.response));
    assert.equal(observed.wasm, artifact.evidence.original.sha256);
    const result = {id: row.id, requestBytes: row.request.length, responseBytes: row.response.length, ...observed};
    console.log(JSON.stringify(result)); results.push(result);
  }
  assert.equal(results.length, 21, 'all accepted session and effect-result successors, including exact64MiB input');
  build.unchanged();
  writeFileSync(join(build.work, 'observation-maxima-evidence.json'), JSON.stringify(results, null, 2) + '\n', {flag: 'wx'});
  return results;
}

function verifyProjectionMutation(mutation, baseline) {
  baseline.unchanged();
  const sourceRows = mutation.entry === 'predecessor' ? projectionCorpus() : observationCorpus();
  const rows = mutation.probes.map(id => {const row = sourceRows.find(row => row.id === id); assert.ok(row); return row;});
  const build = prepareProjection(mutation.id, baseline.inputs);
  assert.notEqual(build.verified.source_id, baseline.verified.source_id);
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  const artifact = requireGeneratedWasm(build.wasmOwners[mutation.entry]);
  assert.notEqual(artifact.evidence.original.sha256, requireGeneratedWasm(baseline.wasmOwners[mutation.entry]).evidence.original.sha256);
  for (const row of rows) {
    const file = join(build.work, row.id + '.tsv'); writeFileSync(file, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [mutation.entry, file]),
      /native output mismatch/, 'source defect changes native behavior, not compilation');
    assert.throws(() => artifact.run(bytes => executeWasm(bytes, [row])),
      error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id),
      'source defect changes actual Wasm response, not a compilation failure or trap');
  }
  build.unchanged(); baseline.unchanged();
  const evidence = {mutation: build.mutation, source: build.verified.source_id,
    attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    wasm: artifact.evidence.original.sha256, generatedWasm: build.generatedWasm, native: build.nativeEvidence(),
    cases: rows.map(row => ({id: row.id, request: sha(row.request), expected: sha(row.response)})),
    cacheRetirement: build.cacheRetirement, generatedPackages: build.generatedPackages};
  writeFileSync(join(build.work, 'projection-mutation-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({id: mutation.id, work: build.work, cases: rows.length})); return evidence;
}

export function verifyProjectionOwner() {
  const {build, evidence} = verifyProjection();
  for (const standard of [true, false]) {
    const path = build.compileNative(standard), bytes = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
      assert.throws(() => build.runNative(standard, ['predecessor', join(build.work, 'predecessor.tsv')]), /immutable generated native observer/);
      assert.throws(() => build.unchanged(), /immutable generated native observer/);
    } finally {writeFileSync(path, bytes);}
  }
  const poisoned = join(build.work, 'changed-generated.wasm'), probe = projectionCorpus()[0];
  const artifact = requireGeneratedWasm(build.wasmOwners.predecessor);
  const input = join(build.work, 'identity-input.bin'), expected = join(build.work, 'identity-expected.bin');
  artifact.run(bytes => writeFileSync(poisoned, Buffer.concat([bytes, Buffer.from([0])]), {flag: 'wx'}));
  writeFileSync(input, probe.request, {flag: 'wx'}); writeFileSync(expected, probe.response, {flag: 'wx'});
  assert.throws(() => run(process.execPath, [join(draft, 'maximum-runner.mjs'), poisoned, input, expected,
    artifact.evidence.original.sha256], build.work), /actual generated projection Wasm identity/);
  const predecessorMaxima = verifyProjectionMaxima(build), observationMaxima = verifyObservationMaxima(build);
  const mutations = projectionMutations.map(mutation => verifyProjectionMutation(mutation, build));
  assert.equal(mutations.length, 8); build.unchanged();
  const receipt = {...evidence, scope: 'private-projection-source-component',
    executableSubstitutionRejected: ['std', 'no-std', 'wasm'], predecessorMaxima, observationMaxima, mutations};
  writeFileSync(join(build.work, 'projection-source-owner-evidence.json'), JSON.stringify(receipt, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence: receipt};
}
