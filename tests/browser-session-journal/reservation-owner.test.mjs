// Complete private reservation component owner, not DK-30/public acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareReservation, frozenInputs, run, sha, repository} from './reservation-compile.mjs';
import {reservationCorpus} from './reservation-corpus.mjs';
import {reservationMutations} from './reservation-mutations.mjs';
import {reservationMaximumCorpus} from './reservation-maxima.mjs';
import {tsv} from './runtime.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {verifyReservationNativeInventory} from './reservation-checks.mjs';
import {verifyReservationInputSubstitutions} from './reservation-input-checks.mjs';

function native(build, rows, name, refusal = false) {
  const path = join(build.work, name + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) {
    const execute = () => build.runNative(standard, ['reservation', path]);
    if (refusal) assert.throws(execute, /native output mismatch/);
    else verifyReservationNativeInventory(execute(), rows);
  }
}

function archive(build, destination, additional) {
  run('tar', ['-czf', destination, '-C', build.work,
    'project/src', 'project/lexlean.toml', 'project/.lexlean/verified', 'export', 'generated', ...additional,
    'reservation-a', 'reservation-b', 'reservation-a.wasm', 'reservation-b.wasm',
    'reservation-a-target/wasm32-unknown-unknown/release/browser_session_journal_wire_probe.wasm',
    'reservation-b-target/wasm32-unknown-unknown/release/browser_session_journal_wire_probe.wasm',
    'native-std-runner', 'native-no-std-runner'], build.work);
  return sha(readFileSync(destination));
}

test('source-owned complete journal reservation and real guard mutants', {timeout: 3500000}, async t => {
  const inputs = frozenInputs(), inputSubstitutions = verifyReservationInputSubstitutions(inputs);
  const baseline = prepareReservation(null, null, inputs);
  let complete = false;
  t.after(() => {
    if (complete) rmSync(baseline.work, {recursive: true, force: true});
    else process.stderr.write('Retained failed reservation owner ' + baseline.work + '\n');
  });
  assert.throws(() => {baseline.wasm = {};}, TypeError);
  assert.throws(() => {baseline.runWasm = () => {};}, TypeError);
  assert.throws(() => {baseline.wasmArtifacts = [];}, TypeError);
  assert.throws(() => {baseline.generatedPackages[0].path = 'substituted';}, TypeError);
  const packageFile = Object.keys(baseline.generatedPackages[0].files)[0];
  assert.throws(() => {baseline.generatedPackages[0].files[packageFile] = '0'.repeat(64);}, TypeError);
  const generatedSource = join(baseline.work, 'generated/src/lib.rs'), generatedBytes = readFileSync(generatedSource);
  try {
    writeFileSync(generatedSource, Buffer.concat([generatedBytes, Buffer.from('\n// substituted before first compile\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => baseline.compileNative(standard), /generated package manifest digest/);
      assert.equal(lstatSync(join(baseline.work, 'runner-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined);
    }
    assert.throws(() => baseline.unchanged(), /generated package manifest digest/);
  } finally {writeFileSync(generatedSource, generatedBytes);}
  baseline.unchanged();
  assert.throws(() => {baseline.wasm.reservation = new Uint8Array();}, TypeError);
  for (const record of baseline.wasmArtifacts) for (const relative of [record.original.path, record.private.path]) {
    const path = join(baseline.work, relative), mode = lstatSync(path).mode & 0o777;
    const original = readFileSync(path), changed = Buffer.concat([original, Buffer.from([0, 3, 1, 120, 42])]);
    assert.equal(WebAssembly.validate(changed), true, 'actual substituted module remains valid Wasm');
    try {
      chmodSync(path, 0o600);
      writeFileSync(path, changed);
      assert.throws(() => baseline.runWasm([]), /immutable (original|private) generated Wasm/);
      assert.throws(() => baseline.unchanged(), /immutable (original|private) generated Wasm/);
    } finally {writeFileSync(path, original); chmodSync(path, mode);}
    baseline.unchanged();
  }
  baseline.wasm.reservation[0] ^= 1;
  try {
    assert.throws(() => baseline.runWasm([]), /immutable execution Wasm buffer/);
    assert.throws(() => baseline.unchanged(), /immutable execution Wasm buffer/);
  } finally {baseline.wasm.reservation[0] ^= 1;}
  baseline.unchanged();
  const rows = reservationCorpus();
  assert.equal(rows.length, 6490, 'closed complete reservation source corpus');
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(reservationMutations.length, 21, 'closed complete source mutant inventory');
  native(baseline, rows, 'positive');
  const wasm = baseline.runWasm(rows);
  for (const standard of [true, false]) {
    const path = baseline.compileNative(standard), original = readFileSync(path), changed = Buffer.from(original); changed[0] ^= 1;
    try {
      writeFileSync(path, changed);
      assert.throws(() => baseline.compileNative(standard), /immutable generated native observer/);
      assert.throws(() => baseline.unchanged(), /immutable generated native observer/);
    }
    finally {writeFileSync(path, original);}
    assert.equal(baseline.compileNative(standard), path);
  }
  const maxima = [];
  await prerequisite(t, 'complete metadata payload and replay maxima retain reservation in native and Wasm', () => {
    const maximumRows = reservationMaximumCorpus(); assert.equal(maximumRows.length, 7);
    for (const row of maximumRows) {
      const input = join(baseline.work, row.id + '.input'), expected = join(baseline.work, row.id + '.expected');
      writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(expected, row.response, {flag: 'wx'});
      for (const standard of [true, false]) assert.equal(
        baseline.runNative(standard, ['reservation', input, expected]), 'PASS binary journal reservation twice\n');
      maxima.push({id: row.id, length: row.request.length, request: sha(row.request), response: sha(row.response),
        ...baseline.runWasm([row])});
    }
    assert.equal(maxima.length, 7, 'all full metadata and reserved recovery maxima executed');
  });
  const directory = join(repository, 'target/reservation-verification'); mkdirSync(directory, {recursive: true});
  const evidence = mkdtempSync(join(directory, 'run-'));
  writeFileSync(join(evidence, 'inputs.json'), JSON.stringify(inputs) + '\n', {flag: 'wx'});
  const positiveArchive = archive(baseline, join(evidence, 'positive-artifacts.tar.gz'), ['positive.tsv']);
  const receipt = {scope: 'reservation-component-only', source: baseline.verified.source_id,
    attestation: baseline.verified.attestation_id, ir: baseline.generation.ir_sha256,
    wasm: sha(baseline.wasm.reservation), corpus: rows.length, maxima, ...wasm,
    native: baseline.nativeEvidence(), cacheRetirement: baseline.cacheRetirement,
    preparationMs: baseline.preparationMs,
    generatedPackages: baseline.generatedPackages,
    wasmArtifacts: baseline.wasmArtifacts,
    closure: {files: Object.keys(inputs).length, sha256: sha(Buffer.from(JSON.stringify(inputs)))}, inputSubstitutions,
    evidence, archive: positiveArchive};
  writeFileSync(join(evidence, 'positive.json'), JSON.stringify(receipt) + '\n', {flag: 'wx'});
  t.diagnostic(JSON.stringify(receipt));
  const mutants = [];
  for (const mutation of reservationMutations) await prerequisite(t, 'actual source mutant ' + mutation.id, () => {
    const startedAt = performance.now();
    const build = prepareReservation(mutation.id, baseline, inputs); let killed = false;
    try {
      const row = rows.find(row => row.id === mutation.probe); assert.ok(row);
      assert.notEqual(build.verified.source_id, baseline.verified.source_id);
      assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
      assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
      assert.notEqual(sha(build.wasm.reservation), sha(baseline.wasm.reservation));
      native(build, [row], mutation.id, true);
      assert.throws(() => build.runWasm([row]),
        error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id),
        'actual changed response, not compilation failure or execution trap');
      build.unchanged();
      const archiveHash = archive(build, join(evidence, mutation.id + '-artifacts.tar.gz'), [mutation.id + '.tsv']);
      const observed = {id: mutation.id, probe: row.id, request: sha(row.request), expected: sha(row.response),
        source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
        wasm: sha(build.wasm.reservation), native: build.nativeEvidence(), generatedPackages: build.generatedPackages,
        wasmArtifacts: build.wasmArtifacts,
        archive: archiveHash, cacheRetirement: build.cacheRetirement,
        preparationMs: build.preparationMs, elapsedMs: performance.now() - startedAt};
      writeFileSync(join(evidence, mutation.id + '.json'), JSON.stringify(observed) + '\n', {flag: 'wx'});
      t.diagnostic(JSON.stringify({id: mutation.id, probe: row.id, elapsedMs: observed.elapsedMs,
        status: 'actual compiled reservation defect detected', archive: archiveHash}));
      mutants.push(observed); killed = true;
    } finally {
      if (killed) rmSync(build.work, {recursive: true, force: true});
      else process.stderr.write('Retained failed reservation mutant ' + build.work + '\n');
    }
  });
  assert.equal(mutants.length, 21, 'all changed source programs actually compiled and counterexamples executed');
  baseline.unchanged(); assert.deepEqual(frozenInputs(), inputs);
  writeFileSync(join(evidence, 'owner.json'), JSON.stringify({...receipt, mutants, complete: true}) + '\n', {flag: 'wx'});
  complete = true;
});
