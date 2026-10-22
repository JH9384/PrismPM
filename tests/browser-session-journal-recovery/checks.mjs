// Complete generated component execution; not authenticated journal acceptance.
import assert from 'node:assert/strict';
import {chmodSync, lstatSync, readFileSync, unlinkSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {assertCompilerOwner, prepareRecovery, run, sha, draft} from './compile.mjs';
import {recoveryCorpus} from './corpus.mjs';
import {corpus as sessionCorpus} from '../browser-session/corpus.mjs';
import {metadataCorpus} from '../browser-session-journal/metadata-corpus.mjs';
import {executeWasm, tsv} from './runtime.mjs';
import {recoveryMaximumCorpus} from './maxima.mjs';
import {componentMutations} from './mutations.mjs';
import {metadataTraversalCorpus} from './traversal-corpus.mjs';

export function verifyNativeInventory(output, rows) {
  assert.equal(output, rows.map(row => 'PASS ' + row.id + '\n').join('')
    + 'PASS ' + rows.length + ' journal recovery vectors twice\n', 'complete exact native vector inventory');
}
function verifyWasmSubstitutionGuards(build) {
  const rejected = [];
  assert.throws(() => {build.wasm = {};}, TypeError);
  assert.throws(() => {build.withWasm = () => {};}, TypeError);
  assert.throws(() => {build.wasmArtifacts = {};}, TypeError);
  assert.throws(() => {build.generatedPackages[0].path = 'substituted';}, TypeError);
  const packageFile = Object.keys(build.generatedPackages[0].files)[0];
  assert.throws(() => {build.generatedPackages[0].files[packageFile] = '0'.repeat(64);}, TypeError);
  for (const [entry, artifacts] of Object.entries(build.wasmArtifacts)) {
    assert.throws(() => {build.wasm[entry] = new Uint8Array();}, TypeError);
    for (const [index, record] of artifacts.entries()) for (const kind of ['original', 'private']) {
      const path = join(build.work, record[kind].path), original = readFileSync(path), mode = lstatSync(path).mode & 0o777;
      const changed = Buffer.concat([original, Buffer.from([0, 3, 1, 120, 42])]);
      assert.equal(WebAssembly.validate(changed), true, 'actual substituted artifact remains valid Wasm');
      let invoked = false;
      try {
        chmodSync(path, 0o600); writeFileSync(path, changed);
        assert.throws(() => build.withWasm(entry, () => {invoked = true;}),
          /immutable (original|private) generated Wasm/);
        assert.throws(() => build.unchanged(), /immutable (original|private) generated Wasm/);
        assert.equal(invoked, false, 'artifact replacement must refuse before execution');
      } finally {writeFileSync(path, original); chmodSync(path, mode);}
      build.unchanged(); rejected.push(entry + '-' + index + '-' + kind);
    }
    build.wasm[entry][0] ^= 1;
    let invoked = false;
    try {
      assert.throws(() => build.withWasm(entry, () => {invoked = true;}), /immutable execution Wasm buffer/);
      assert.throws(() => build.unchanged(), /immutable execution Wasm buffer/);
      assert.equal(invoked, false, 'mutable buffer replacement must refuse before execution');
    } finally {build.wasm[entry][0] ^= 1;}
    build.unchanged(); rejected.push(entry + '-execution-buffer');
  }
  assert.equal(rejected.length, 20, 'both artifacts and execution buffers for all four actual roots');
  return rejected;
}
export function verifyRecoveryComponents() {
  const build = prepareRecovery(), recovery = recoveryCorpus();
  // Plant a changed source in the actual fresh generated package before either
  // native observer exists. A hash recorded only after compilation is too late.
  const generatedSource = join(build.work, 'generated/src/lib.rs'), generatedBytes = readFileSync(generatedSource);
  try {
    writeFileSync(generatedSource, Buffer.concat([generatedBytes, Buffer.from('\n// substituted before first compile\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => build.compileNative(standard), /generated package manifest digest/);
      assert.equal(lstatSync(join(build.work, 'runner-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined,
        'changed package must refuse before creating or compiling the native observer');
    }
    assert.throws(() => build.unchanged(), /generated package manifest digest/);
  } finally {writeFileSync(generatedSource, generatedBytes);}
  build.unchanged();
  const wasmSubstitutionRejected = verifyWasmSubstitutionGuards(build);
  const vectors = {context: recovery.context, recovery: recovery.recovery,
    session: sessionCorpus(), metadata: [...metadataCorpus(), ...metadataTraversalCorpus()]};
  assert.deepEqual(Object.fromEntries(Object.entries(vectors).map(([entry, rows]) => [entry, rows.length])),
    {context: 1064, recovery: 1035, session: 895, metadata: 141}, 'complete closed component inventories');
  const files = {};
  for (const [entry, rows] of Object.entries(vectors)) {
    assert.ok(rows.length > 0); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
    files[entry] = join(build.work, entry + '.tsv');
    writeFileSync(files[entry], tsv(rows), {flag: 'wx'});
  }
  for (const standard of [true, false]) {
    for (const [entry, rows] of Object.entries(vectors))
      verifyNativeInventory(build.runNative(standard, [entry, files[entry]]), rows);
  }
  const observed = Object.fromEntries(Object.entries(vectors).map(([entry, rows]) =>
    [entry, build.withWasm(entry, bytes => executeWasm(bytes, rows))]));
  build.unchanged();
  const evidence = {scope: 'private-recovery-and-metadata-components', publicApplicationAccepted: false,
    source: build.verified.source_id, attestation: build.verified.attestation_id, ir: build.generation.ir_sha256,
    artifacts: Object.fromEntries(Object.entries(build.wasm).map(([entry, bytes]) => [entry, sha(bytes)])),
    cases: Object.fromEntries(Object.entries(vectors).map(([entry, rows]) => [entry, rows.length])),
    observed, native: build.nativeEvidence(), inputs: build.inputs, compilerOwner: build.compilerOwner.evidence(),
    generatedPackages: build.generatedPackages, wasmArtifacts: build.wasmArtifacts, wasmSubstitutionRejected,
    generatedSourceSubstitutionRejected: ['before-first-std', 'before-first-no-std']};
  writeFileSync(join(build.work, 'recovery-component-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence};
}

export function verifyRecoveryMaxima(build) {
  const evidence = [];
  const request = join(build.work, 'maximum-input.bin'), expected = join(build.work, 'maximum-expected.bin');
  for (const row of recoveryMaximumCorpus()) {
    writeFileSync(request, row.request); writeFileSync(expected, row.response);
    for (const standard of [true, false]) assert.equal(build.runNative(standard, [row.entry, request, expected]),
      'PASS binary journal recovery twice\n', 'actual complete native maximum ' + row.id);
    const observed = row.nativeOnly ? {nativeOnly: true, request: sha(row.request), response: sha(row.response)}
      : build.withWasm(row.entry, (bytes, path) => JSON.parse(run(process.execPath,
        [join(draft, 'maximum-runner.mjs'), path, request, expected, sha(bytes)], build.work)));
    assert.equal(observed.request, sha(row.request)); assert.equal(observed.response, sha(row.response));
    if (!row.nativeOnly) assert.equal(observed.wasm, sha(build.wasm[row.entry]));
    const result = {entry: row.entry, id: row.id, requestBytes: row.request.length, responseBytes: row.response.length, ...observed};
    console.log(JSON.stringify(result)); evidence.push(result);
  }
  assert.equal(evidence.length, 64, '27 original Session, 21 contexts, seven recovery, five metadata and four input-one-over vectors');
  build.unchanged();
  writeFileSync(join(build.work, 'recovery-maximum-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  return evidence;
}

export function verifyCompiledMutation(mutation, baseline) {
  const startedAt = performance.now();
  const corpus = mutation.entry === 'metadata' ? [...metadataCorpus(), ...metadataTraversalCorpus()] : recoveryCorpus()[mutation.entry];
  const row = corpus.find(row => row.id === mutation.probe); assert.ok(row, 'exact independent mutation counterexample');
  baseline.unchanged(); const build = prepareRecovery(mutation.id, baseline.inputs, baseline.compilerOwner);
  assert.notEqual(build.verified.source_id, baseline.verified.source_id, 'actually changed authored source');
  assert.notEqual(build.verified.attestation_id, baseline.verified.attestation_id);
  assert.notEqual(build.generation.ir_sha256, baseline.generation.ir_sha256, 'actual changed lowered program');
  assert.notEqual(sha(build.wasm[mutation.entry]), sha(baseline.wasm[mutation.entry]), 'actual changed Wasm program');
  const file = join(build.work, 'mutation.tsv'); writeFileSync(file, tsv([row]), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [mutation.entry, file]),
    /native output mismatch/, 'compiled source defect must reach actual native behavior');
  assert.throws(() => build.withWasm(mutation.entry, bytes => executeWasm(bytes, [row])),
    error => error.code === 'ERR_ASSERTION' && error.message.includes(row.id),
    'compiled source defect must change the Wasm response, not crash compilation or execution');
  build.unchanged(); baseline.unchanged();
  const evidence = {mutation: build.mutation, source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasm[mutation.entry]),
    request: sha(row.request), expected: sha(row.response), native: build.nativeEvidence(), compilerOwner: build.compilerOwner.evidence(),
    generatedPackages: build.generatedPackages, wasmArtifacts: build.wasmArtifacts};
  writeFileSync(join(build.work, 'recovery-mutation-evidence.json'), JSON.stringify(evidence, null, 2) + '\n', {flag: 'wx'});
  console.log(JSON.stringify({id: mutation.id, work: build.work, status: 'real compiled defect detected',
    elapsedMs: performance.now() - startedAt}));
  return evidence;
}

function verifyCompilerReuseGuards(build) {
  const owner = build.compilerOwner, before = owner.evidence(), rejected = [];
  assert.throws(() => assertCompilerOwner({...owner}, build.inputs), /actual privately built compiler owner/);
  rejected.push('cloned-handle');
  assert.throws(() => assertCompilerOwner(owner, {...build.inputs, substituted: '0'.repeat(64)}),
    /cannot cross frozen owner closures/);
  rejected.push('different-owner-inputs');
  // Do not let a caller rewrite the recorded authority to adopt changed tools.
  assert.throws(() => {before.programs.driver.sha256 = '0'.repeat(64);}, TypeError);
  assert.throws(() => {before.toolchain.programs.cargo.path = '/tmp/substituted-cargo';}, TypeError);
  assert.throws(() => {before.exporterRuntime.files.substituted = '0'.repeat(64);}, TypeError);
  rejected.push('mutable-evidence-authority');
  for (const [name, record] of Object.entries(before.programs)) {
    const original = readFileSync(record.path);
    try {
      writeFileSync(record.path, Buffer.concat([original, Buffer.from([0])]));
      assert.throws(() => owner.execute(name, [], build.work), /immutable privately compiled/,
        'substituted actual compiler must refuse before execution');
    } finally {writeFileSync(record.path, original);}
    assertCompilerOwner(owner, build.inputs); rejected.push('changed-' + name + '-between-uses');
  }
  for (const relative of ['vendor/lexlean/src/lib.rs', 'tests/browser-session-journal-recovery/driver/src/main.rs']) {
    const path = join(owner.work, relative), original = readFileSync(path);
    try {
      writeFileSync(path, Buffer.concat([original, Buffer.from('\n// substituted compiler input\n')]));
      assert.throws(() => owner.execute('driver', [], build.work), /immutable privately staged compiler source/);
    } finally {writeFileSync(path, original);}
    assertCompilerOwner(owner, build.inputs); rejected.push('changed-' + relative);
  }
  const extra = join(owner.work, 'vendor/lexlean/substituted-input.rs');
  try {
    writeFileSync(extra, '// added after compilation\n', {flag: 'wx'});
    assert.throws(() => owner.execute('driver', [], build.work), /complete privately staged compiler file\/directory inventory/);
  } finally {unlinkSync(extra);}
  assertCompilerOwner(owner, build.inputs); rejected.push('extra-staged-input');
  const libraryRelative = Object.keys(before.exporterRuntime.files).find(path => path.endsWith('.olean'));
  assert.ok(libraryRelative, 'actual generated exporter library must be retained');
  const library = join(owner.exporterDirectory, '.lake', libraryRelative), libraryBytes = readFileSync(library);
  try {
    writeFileSync(library, Buffer.concat([libraryBytes, Buffer.from([0])]));
    assert.throws(() => owner.execute('exporter', [], build.work), /immutable private exporter runtime library inventory/);
  } finally {writeFileSync(library, libraryBytes);}
  assertCompilerOwner(owner, build.inputs); rejected.push('changed-exporter-runtime-library');
  assert.equal(owner.evidence().uses, before.uses, 'all substitutions refused before an executable invocation');
  assert.match(owner.execute('cargo', ['--version'], build.work), /^cargo /,
    'restored immutable owner still executes the actual pinned tool');
  assert.equal(owner.evidence().uses, before.uses + 1); build.unchanged();
  return rejected;
}

export function verifyRecoveryOwner() {
  const {build, evidence} = verifyRecoveryComponents();
  const compilerSubstitutionRejected = verifyCompilerReuseGuards(build);
  // Change the actual privately compiled executable, not a fabricated fixture.
  // Appended ELF bytes may leave behavior unchanged; provenance must still fail.
  for (const standard of [true, false]) {
    const program = build.compileNative(standard), original = readFileSync(program);
    try {
      writeFileSync(program, Buffer.concat([original, Buffer.from([0])]));
      assert.throws(() => build.compileNative(standard), /private native executable changed/);
      assert.throws(() => build.unchanged(), /private native executable changed/);
    } finally {writeFileSync(program, original);}
    assert.equal(build.compileNative(standard), program);
  }
  const poisoned = join(build.work, 'changed-generated.wasm'), probe = recoveryCorpus().context[0];
  const input = join(build.work, 'identity-input.bin'), expected = join(build.work, 'identity-expected.bin');
  writeFileSync(poisoned, Buffer.concat([build.wasm.context, Buffer.from([0])]), {flag: 'wx'});
  writeFileSync(input, probe.request, {flag: 'wx'}); writeFileSync(expected, probe.response, {flag: 'wx'});
  assert.throws(() => run(process.execPath, [join(draft, 'maximum-runner.mjs'), poisoned, input, expected, sha(build.wasm.context)], build.work),
    /actual generated maximum Wasm identity/, 'changed generated artifact fails before WebAssembly compilation');
  const maxima = verifyRecoveryMaxima(build);
  const mutations = componentMutations.map(mutation => verifyCompiledMutation(mutation, build));
  assert.equal(mutations.length, 24); build.unchanged();
  const receipt = {...evidence, scope: 'private-recovery-and-metadata-source-components',
    executableSubstitutionRejected: ['std', 'no-std', 'wasm'], compilerSubstitutionRejected,
    compilerOwner: build.compilerOwner.evidence(), maxima, mutations};
  const bytes = JSON.stringify(receipt, null, 2) + '\n';
  writeFileSync(join(build.work, 'recovery-source-owner-evidence.json'), bytes, {flag: 'wx'});
  // Only the compiler is reused. All 25 source verification, generated Lean,
  // lowered IR and product builds remain independent and retained as evidence.
  // Cache retirement follows the complete evidence, never an in-flight mutant.
  const cacheRetirement = build.compilerOwner.retire();
  assert.throws(() => assertCompilerOwner(build.compilerOwner, build.inputs), /live non-reentrant/);
  assert.throws(() => build.compilerOwner.execute('cargo', ['--version'], build.work), /live non-reentrant/);
  assert.throws(() => build.compilerOwner.retire(), /active or already retired/);
  build.unchanged();
  const completion = {scope: receipt.scope, publicApplicationAccepted: false, evidenceSha256: sha(bytes),
    cacheRetirement, retiredOwnerReuseRejected: true};
  writeFileSync(join(build.work, 'recovery-source-owner-completion.json'), JSON.stringify(completion, null, 2) + '\n', {flag: 'wx'});
  return {build, evidence: {...receipt, completion}};
}
