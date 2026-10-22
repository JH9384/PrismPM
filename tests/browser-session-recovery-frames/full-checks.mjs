// Private component acceptance, never authority/freshness or public SDK admission.
import assert from 'node:assert/strict';
import {readFileSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {prepareFrames, run, sha, draft} from './compile.mjs';
import {verifyBaseline, exactNativeInventory} from './checks.mjs';
import {corpus, MAXIMUM} from './corpus.mjs';
import {maxima} from './maxima.mjs';
import {mutations} from './mutations.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {browserComposition, verifyBrowserResult, hostMutations} from './browser.mjs';
const performBrowser = (build, row, options = {}) => browserComposition(build.wasm, row, {...options, inputs: build.inputs});

function record(path, value) {
  writeFileSync(path, JSON.stringify(value, null, 2) + '\n', {flag: 'wx'});
  return value;
}
function browserReplay(build, id, result) {
  const groups = {layout: [], tail: []};
  for (const [index, row] of result.trace.entries()) {
    assert.ok(row.request && row.response, 'complete actual browser invocation bytes');
    groups[index === 1 ? 'tail' : 'layout'].push({id: id + 'Call' + index,
      request: Uint8Array.from(row.request), response: Uint8Array.from(row.response)});
  }
  for (const [entry, rows] of Object.entries(groups)) if (rows.length) {
    const path = join(build.work, 'browser-' + id + '-' + entry + '.tsv');
    writeFileSync(path, tsv(rows), {flag: 'wx'});
    for (const standard of [true, false]) exactNativeInventory(build.runNative(standard, [entry, path]), rows);
  }
}

async function verifyBrowsers(build) {
  const rows = corpus().composition, results = [];
  for (const row of rows) {
    const actual = await performBrowser(build, row); verifyBrowserResult(row, actual);
    browserReplay(build, row.id, actual);
    results.push({id: row.id, hashes: actual.hashes, calls: actual.trace.map(value => value.hashes)});
  }
  const row = rows[0];
  for (const option of ['mutateCaller', 'mutateArtifacts']) {
    const actual = await performBrowser(build, row, {[option]: true});
    verifyBrowserResult(row, actual); browserReplay(build, option, actual);
    results.push({id: option, hashes: actual.hashes, calls: actual.trace.map(value => value.hashes)});
  }
  for (const [option, code] of [['corruptArtifact', 'artifact-mismatch'], ['extraLayout', 'invalid-input'],
    ['inputGetter', 'invalid-input'], ['artifactGetter', 'invalid-input'], ['prototypeInput', 'invalid-input']]) {
    const actual = await performBrowser(build, row, {[option]: true});
    assert.equal(actual.ok, false); assert.equal(actual.code, code); assert.equal(actual.trace.length, 0);
    results.push({id: option, code});
  }
  const refused = structuredClone(row); refused.values[0][2] = 0;
  const actual = await performBrowser(build, refused);
  assert.equal(actual.ok, false); assert.equal(actual.code, 'source-refusal'); assert.equal(actual.trace.length, 2);
  browserReplay(build, 'authority-refusal', actual);
  results.push({id: 'authority-refusal', code: actual.code, calls: actual.trace.map(value => value.hashes)});
  const defects = [];
  for (const mutation of hostMutations) {
    const actual = await performBrowser(build, row,
      {mutation, ...(mutation.id === 'artifact-digest' ? {corruptArtifact: true} : {})});
    if (mutation.id === 'artifact-digest') {
      assert.equal(actual.ok, true, 'real artifact-digest defect admits wrongly bound artifact');
      verifyBrowserResult(row, actual);
    } else if (mutation.id === 'final-validation') {
      assert.equal(actual.ok, true); assert.equal(actual.trace.length, 2);
      assert.throws(() => verifyBrowserResult(row, actual), /layout, tail, complete final generated validation/);
    } else {
      assert.equal(actual.ok, false); assert.equal(actual.code, 'source-refusal');
      assert.equal(actual.trace.length, 3, 'complete generated validation refuses actual mutated assembled bytes');
    }
    defects.push({id: mutation.id, admitted: actual.ok, code: actual.code ?? null,
      calls: actual.trace.map(value => value.hashes)});
  }
  assert.equal(results.length, rows.length + 8); assert.equal(defects.length, 5);
  build.unchanged(); return {journeys: results, hostDefects: defects};
}

async function verifyMaxima(build) {
  const modules = Object.fromEntries(['layout', 'tail'].map(entry => {
    const path = join(build.work, 'maximum-' + entry + '.wasm'); writeFileSync(path, build.wasm[entry], {flag: 'wx'});
    return [entry, path];
  }));
  const input = join(build.work, 'maximum-input.bin'), expected = join(build.work, 'maximum-output.bin');
  const results = [];
  for (const row of maxima()) {
    if (row.composition) {
      const composition = {id: row.id, ...row.composition};
      const actual = await performBrowser(build, composition, {maximum: true});
      verifyBrowserResult(composition, actual);
      results.push({id: row.id, requestBytes: composition.state.length, responseBytes: composition.response.length,
        hashes: actual.hashes, calls: actual.trace.map(value => ({hashes: value.hashes,
          requestBytes: value.requestBytes, responseBytes: value.responseBytes}))});
    } else {
      writeFileSync(input, row.request); writeFileSync(expected, row.response);
      for (const standard of [true, false]) assert.equal(build.runNative(standard, [row.entry, input, expected]),
        'PASS binary recovery frame twice\n');
      let observed;
      if (row.request.length > MAXIMUM) {
        const actual = new WebAssembly.Instance(new WebAssembly.Module(build.wasm[row.entry]), {});
        assert.throws(() => actual.exports.holo_alloc(row.request.length), WebAssembly.RuntimeError);
        observed = {allocatorRefused: true, request: sha(row.request), response: sha(row.response),
          wasm: sha(build.wasm[row.entry])};
      } else {
        observed = JSON.parse(run(process.execPath, [join(draft, 'maximum-runner.mjs'), modules[row.entry], input,
          expected, sha(build.wasm[row.entry])], build.work));
        assert.equal(observed.request, sha(row.request)); assert.equal(observed.response, sha(row.response));
        assert.equal(observed.wasm, sha(build.wasm[row.entry]));
        assert.ok(observed.maximumBytes <= 1073741824); assert.equal(observed.declaredPages, 16384);
      }
      results.push({id: row.id, entry: row.entry, requestBytes: row.request.length,
        responseBytes: row.response.length, ...observed});
    }
    console.log(JSON.stringify({maximum: results.at(-1)})); build.unchanged();
  }
  assert.equal(results.length, 26);
  record(join(build.work, 'frames-maxima-evidence.json'), results); return results;
}

function verifySourceDefect(mutation, baseline) {
  baseline.unchanged();
  const row = corpus()[mutation.entry].find(value => value.id === mutation.probe); assert.ok(row);
  const build = prepareFrames(mutation.id, baseline.inputs);
  assert.notEqual(build.verified.source_id, baseline.verified.source_id);
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256);
  assert.notEqual(sha(build.wasm[mutation.entry]), sha(baseline.wasm[mutation.entry]));
  const path = join(build.work, 'probe.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [mutation.entry, path]),
    /native output mismatch/, 'actual compiled source defect changes native response');
  assert.throws(() => executeWasm(build.wasm[mutation.entry], [row]),
    error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id),
    'actual compiled source defect changes Wasm output, not a trap or compiler failure');
  build.unchanged(); baseline.unchanged();
  const evidence = record(join(build.work, 'frames-mutation-evidence.json'), {
    mutation: build.mutation, work: build.work, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasm[mutation.entry]), native: build.nativeEvidence(),
    probe: {id: row.id, request: sha(row.request), expected: sha(row.response)},
    cacheRetirement: build.cacheRetirement, generatedPackages: build.generatedPackages});
  console.log(JSON.stringify({mutation: mutation.id, work: build.work})); return evidence;
}

export async function verifyOwner() {
  const {build, evidence} = verifyBaseline();
  for (const standard of [true, false]) {
    const path = build.compileNative(standard), original = readFileSync(path);
    try {writeFileSync(path, Buffer.concat([original, Buffer.from([0])]));
      assert.throws(() => build.runNative(standard, ['layout', join(build.work, 'layout.tsv')]), /immutable generated native observer/);
      assert.throws(() => build.unchanged(), /immutable generated native observer/);
    } finally {writeFileSync(path, original);}
  }
  for (const entry of ['layout', 'tail', 'parity']) {
    const original = Buffer.from(build.wasm[entry]);
    try {build.wasm[entry][0] ^= 1;
      assert.throws(() => build.unchanged(), /immutable captured Wasm bytes/);
    } finally {build.wasm[entry].set(original);}
    for (const [path, diagnostic] of [
      [join(build.work, 'wasm-' + entry + '-a.wasm'), /immutable generated Wasm file/],
      [join(build.work, entry + '-a-target/wasm32-unknown-unknown/release/browser_session_recovery_frames_wire_probe.wasm'),
        /immutable original compiled Wasm/],
    ]) {
      const bytes = readFileSync(path);
      try {writeFileSync(path, Buffer.concat([bytes, Buffer.from([0])]));
        assert.throws(() => build.unchanged(), diagnostic);
      } finally {writeFileSync(path, bytes);}
    }
  }
  const deliveryProbe = corpus().composition[0];
  await assert.rejects(() => browserComposition(build.wasm, deliveryProbe,
    {inputs: {...build.inputs, 'sdk/browser/identity.mjs': '0'.repeat(64)}}), /captured actual browser module identity/);
  build.unchanged();
  const row = corpus().layout[0], poisoned = join(build.work, 'poisoned.wasm');
  const input = join(build.work, 'poison-input.bin'), expected = join(build.work, 'poison-output.bin');
  writeFileSync(poisoned, Buffer.concat([build.wasm.layout, Buffer.from([0])]), {flag: 'wx'});
  writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(expected, row.response, {flag: 'wx'});
  assert.throws(() => run(process.execPath, [join(draft, 'maximum-runner.mjs'), poisoned, input, expected,
    sha(build.wasm.layout)], build.work), /actual generated recovery frame Wasm identity/);
  const browser = await verifyBrowsers(build), actualMaxima = await verifyMaxima(build);
  const sourceDefects = mutations.map(mutation => verifySourceDefect(mutation, build));
  assert.equal(sourceDefects.length, 18); build.unchanged();
  const complete = {...evidence, scope: 'private-separate-frame-recovery-component', componentAccepted: true,
    publicApplicationAccepted: false, authorityAndJournalAccepted: false, browser, actualMaxima, sourceDefects,
    executableSubstitutionRejected: ['std', 'no-std', 'wasm'], native: build.nativeEvidence()};
  delete complete.accepted;
  record(join(build.work, 'frames-owner-evidence.json'), complete);
  return {build, evidence: complete};
}
