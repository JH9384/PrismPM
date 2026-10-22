import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, lstatSync, readFileSync, renameSync, unlinkSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, sha, repository, frozenInputs, assertFrozenInputs, assertBaselineSources} from './compile.mjs';
import {captureCompilerInputs, createCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {verifyCompilerOwnerSubstitutions} from '../browser-view/compiler-owner-checks.mjs';
import {corpus, boundaries, maximumCorpus, combinedMaximumCorpus, secretMaximumCorpus, progressMaximumCorpus} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';
import {ownFixtureFiles, consumeNativeFixtures} from './fixture-files.mjs';
export {prerequisite};
export const tsv = rows => rows.map(row => row.id + '\t' + Buffer.from(row.request).toString('hex') + '\t' + Buffer.from(row.response).toString('hex') + '\n').join('');

export function executeWasm(bytes, rows, inputMaximum = 67108864) {
  const memory = inspectEffectModule(bytes, 16384), module = new WebAssembly.Module(bytes);
  assert.deepEqual(WebAssembly.Module.imports(module), []);
  let maximum = 0;
  for (const row of rows) for (let repeat = 0; repeat < 2; repeat++) {
    const instance = new WebAssembly.Instance(module, {}), start = instance.exports.holo_alloc(row.request.length) >>> 0;
    assert.ok(start + row.request.length <= instance.exports.memory.buffer.byteLength);
    new Uint8Array(instance.exports.memory.buffer, start, row.request.length).set(row.request);
    let result;
    try { result = BigInt.asUintN(64, instance.exports.holo_run(start, row.request.length)); }
    catch (error) { throw new Error(row.id + ' actual generated Wasm trap at ' + instance.exports.memory.buffer.byteLength + ' bytes', {cause: error}); }
    const at = Number(result >> 32n), length = Number(result & 0xffffffffn);
    assert.ok(length <= 67108864 && at + length <= instance.exports.memory.buffer.byteLength);
    const actual = Buffer.from(new Uint8Array(instance.exports.memory.buffer, at, length));
    assert.ok(actual.equals(Buffer.from(row.response)), row.id + ' generated Wasm output mismatch: ' + (length < 32 ? actual.toString('hex') : length));
    maximum = Math.max(maximum, instance.exports.memory.buffer.byteLength);
    assert.ok(maximum <= memory.maximumPages * 65536);
  }
  const over = new WebAssembly.Instance(module, {});
  assert.throws(() => over.exports.holo_alloc(inputMaximum + 1), WebAssembly.RuntimeError);
  assert.throws(() => over.exports.memory.grow(memory.maximumPages), RangeError);
  return {maximumBytes: maximum, declaredPages: memory.maximumPages};
}

function executeCapturedWasm(build, mode, rows, maximum) {
  const artifact = build.wasmArtifacts[mode === 'wasm' ? 'a' : mode];
  assert.ok(artifact, 'closed captured presentation Wasm role');
  return artifact.run(bytes => executeWasm(bytes, rows, maximum));
}

export async function verifyWire(t, compilerOwner = null) {
  const frozen = frozenInputs(), compiler = compilerOwner
    ?? createCompilerOwner('presentation', captureCompilerInputs('presentation'));
  const compilerSubstitutions = verifyCompilerOwnerSubstitutions(compiler);
  const build = prepare(null, null, frozen, compiler);
  assertBaselineSources(build.sources, build.sources);
  const missingSource = new Map(build.sources); missingSource.delete('Fixture');
  assert.throws(() => assertBaselineSources(build.sources, missingSource), /complete positive presentation source inventory/);
  const changedSource = new Map(build.sources);
  changedSource.set('Fixture', Buffer.concat([changedSource.get('Fixture'), Buffer.from('\n')]));
  assert.throws(() => assertBaselineSources(build.sources, changedSource), /immutable positive presentation source/);
  for (const name of Object.keys(build))
    assert.throws(() => {build[name] = null;}, TypeError, 'captured presentation evidence cannot be replaced: ' + name);
  for (const record of [build.verified, build.generation]) for (const field of Object.keys(record))
    assert.throws(() => {record[field] = null;}, TypeError, 'immutable nested provenance field ' + field);
  assert.throws(() => {build.verified.modules[0] = 'Substituted';}, TypeError);
  assert.throws(() => {build.verified.modules.push('Substituted');}, TypeError);
  build.compilerSubstitutions = compilerSubstitutions;
  t.after(() => {
    if (build.complete) rmSync(build.work, {recursive: true, force: true});
    else process.stderr.write('Retained incomplete presentation owner ' + build.work + '\n');
  });
  const sourcePath = join(build.work, 'generated/src/lib.rs'), sourceBytes = readFileSync(sourcePath);
  try {
    writeFileSync(sourcePath, Buffer.concat([sourceBytes, Buffer.from('\n// substituted before first compilation\n')]));
    for (const standard of [true, false]) {
      assert.throws(() => build.compileNative(standard), /generated package manifest digest/);
      assert.equal(lstatSync(join(build.work, 'native-target-' + (standard ? 'std' : 'no-std')), {throwIfNoEntry: false}), undefined);
    }
    assert.throws(() => build.unchanged(), /generated package manifest digest/);
  } finally {writeFileSync(sourcePath, sourceBytes);}
  build.unchanged();
  const intentRows = Array.from({length: 17}, (_, code) => ({id: 'IntentCase' + code,
    request: Uint8Array.of(code), response: Uint8Array.of([0, 10, 14, 16].includes(code) ? 245 : 244)}));
  const progressRows = Array.from({length: 16}, (_, code) => ({id: 'ProgressCase' + code,
    request: Uint8Array.of(code), response: Uint8Array.of([0, 1, 9, 15].includes(code) ? 245 : 244)}));
  const rows = [...corpus(), ...boundaries()], maximum = maximumCorpus();
  assert.ok(build.verified?.attestation_id && build.wasmBytes && build.fixtureBytes && build.labelsBytes,
    'source check alone is never owning acceptance');
  const secretRows = [
    ['Exact', [1, 1, 202, [[6, '😀'.repeat(16)], [7, ''], [8, 10]]], true],
    ['Empty', [1, 1, 202, [[6, ''], [7, ''], [8, 10]]], false],
    ['Over', [1, 1, 202, [[6, '😀'.repeat(16) + 'x'], [7, ''], [8, 10]]], false],
    ['WrongType', [1, 1, 202, [[6, 7], [7, ''], [8, 10]]], false],
    ['Stale', [1, 2, 202, [[6, 'synthetic'], [7, ''], [8, 10]]], false],
    ['Missing', [1, 1, 202, [[6, 'synthetic'], [8, 10]]], false],
    ['OtherAction', [1, 1, 101, []], false],
    ['UnknownAction', [1, 1, 303, []], false],
  ].map(([id, intent, accepted]) => ({id: 'BrowserRoute' + id, request: encodeWire(intent), response: Uint8Array.of(accepted ? 245 : 244)}));
  const allRows = [...rows, ...intentRows, ...secretRows, ...progressRows];
  const path = join(build.work, 'vectors.tsv'); writeFileSync(path, tsv(allRows), {flag: 'wx'});
  const binaries = [];
  const fixtureFiles = ownFixtureFiles(build.work);
  build.maximumFrames = [];
  const allMaxima = function* () { yield* maximum; yield* combinedMaximumCorpus(); };
  for (const row of allMaxima()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    fixtureFiles.write(row.id + '.request', row.request); fixtureFiles.write(row.id + '.response', row.response);
    binaries.push({input, output});
    if (row.request === row.response) build.maximumFrames.push({id: row.id,
      request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  const secretBinaries = [];
  build.secretMaxima = [];
  for (const row of secretMaximumCorpus()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    fixtureFiles.write(row.id + '.request', row.request); fixtureFiles.write(row.id + '.response', row.response);
    secretBinaries.push({input, output, mode: row.mode});
    build.secretMaxima.push({id: row.id, request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  const progressBinaries = []; build.progressMaxima = [];
  for (const row of progressMaximumCorpus()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    fixtureFiles.write(row.id + '.request', row.request); fixtureFiles.write(row.id + '.response', row.response);
    progressBinaries.push({input, output, mode: row.mode});
    build.progressMaxima.push({id: row.id, request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  const fixtureRetirement = await consumeNativeFixtures(fixtureFiles, standard => prerequisite(t, 'complete generated ' + (standard ? 'std' : 'no_std') + ' corpus, all structural maxima and exact 64 MiB frame', () => {
    const output = build.runNative(standard, [path]);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row => row[1]), allRows.map(row => row.id));
    assert.match(output, new RegExp('PASS ' + allRows.length + ' complete presentation vectors twice'));
    for (const row of binaries) assert.equal(build.runNative(standard, ['--binary', row.input, row.output]), 'PASS binary complete presentation vector twice\n');
    for (const row of secretBinaries) assert.equal(build.runNative(standard, [row.mode === 'wasm' ? '--binary' : '--' + row.mode, row.input, row.output]), 'PASS binary complete presentation vector twice\n');
    for (const row of progressBinaries) assert.equal(build.runNative(standard, [row.mode === 'wasm' ? '--binary' : '--' + row.mode, row.input, row.output]), 'PASS binary complete presentation vector twice\n');
  }));
  assert.equal(fixtureRetirement.files.length, 2 * (binaries.length + secretBinaries.length + progressBinaries.length));
  fixtureFiles.assertRetired();
  for (const standard of [true, false]) {
    const mode = standard ? 'std' : 'no-std';
    for (const observer of [build.compileNative(standard), join(build.work, 'native-target-' + mode, 'release/browser-presentation-runner')]) {
      const original = readFileSync(observer), changed = Buffer.from(original);
      changed[changed.length - 1] ^= 1;
      try {
        writeFileSync(observer, changed);
        assert.throws(() => build.runNative(standard, [path]), /immutable (original|actual) presentation observer/);
      } finally {writeFileSync(observer, original);}
      build.unchanged();
      const saved = observer + '.captured-inode';
      assert.equal(lstatSync(saved, {throwIfNoEntry: false}), undefined);
      renameSync(observer, saved);
      try {
        copyFileSync(saved, observer);
        assert.throws(() => build.runNative(standard, [path]),
          /immutable (original|actual) presentation observer|presentation observer link count/);
      } finally {unlinkSync(observer); renameSync(saved, observer);}
      build.unchanged();
    }
  }
  for (const artifact of Object.values(build.wasmArtifacts)) {
    const originalPath = join(build.work, artifact.evidence.original.path), generated = readFileSync(originalPath);
    const substituted = Buffer.from(generated); substituted[substituted.length - 1] ^= 1;
    try {
      writeFileSync(originalPath, substituted);
      assert.throws(() => build.unchanged(), /immutable original generated Wasm/);
    } finally {writeFileSync(originalPath, generated);}
    build.unchanged();
    const original = readFileSync(artifact.path), changed = Buffer.from(original); changed[changed.length - 1] ^= 1;
    try {
      chmodSync(artifact.path, 0o600); writeFileSync(artifact.path, changed);
      assert.throws(() => build.unchanged(), /immutable private generated Wasm/);
    } finally {writeFileSync(artifact.path, original); chmodSync(artifact.path, 0o400);}
    build.unchanged();
    artifact.bytes[artifact.bytes.length - 1] ^= 1;
    try {assert.throws(() => build.unchanged(), /immutable execution Wasm buffer/);}
    finally {artifact.bytes[artifact.bytes.length - 1] ^= 1;}
    build.unchanged();
  }
  await prerequisite(t, 'fresh bounded Core-Wasm executes every actual structural maximum and exact 64 MiB frame', () => {
    build.maximum = executeCapturedWasm(build, 'wasm', [...rows, maximum[0]]);
    executeCapturedWasm(build, 'intent', intentRows, 32);
    executeCapturedWasm(build, 'route', secretRows, 4096);
    executeCapturedWasm(build, 'progress', progressRows, 32);
  });
  await prerequisite(t, 'exact 64 MiB payloads execute at every combined node and table boundary position', () => {
    for (const row of combinedMaximumCorpus()) {
      const observed = executeCapturedWasm(build, 'wasm', [row]);
      build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
    }
  });
  await prerequisite(t, 'secret raw field exact/over bounds and actual maximum framed route/sink execute within unchanged 1 GiB memory', () => {
    for (const row of secretMaximumCorpus()) {
      const observed = executeCapturedWasm(build, row.mode, [row], row.mode === 'maxfield' ? 67108865 : 67108864);
      build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
    }
  });
  await prerequisite(t, 'actual progress predicate holds two 64 MiB presentations within 1 GiB and refuses equal revision and input one-over', () => {
    for (const row of progressMaximumCorpus()) {
      if (row.allocationReject) {
        build.wasmArtifacts.maxprogress.run(bytes => {
          const instance = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
          assert.throws(() => instance.exports.holo_alloc(row.request.length), WebAssembly.RuntimeError);
        });
      } else {
        const observed = executeCapturedWasm(build, row.mode, [row]);
        build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
        if (row.mode === 'maxprogress') build.progressMaximum = Math.max(build.progressMaximum ?? 0, observed.maximumBytes);
      }
    }
  });
  assertFrozenInputs(frozen); build.unchanged();
  build.maximumFrame = {request: sha(maximum[0].request), response: sha(maximum[0].response), length: maximum[0].request.length};
  t.diagnostic(JSON.stringify({source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), fixture: sha(build.fixtureBytes), labels: sha(build.labelsBytes),
    vectors: rows.length, maximum: build.maximum, frame: build.maximumFrame, secretMaxima: build.secretMaxima,
    progressMaximum: build.progressMaximum, progressMaxima: build.progressMaxima,
    compiler: compiler.identity, compilerSubstitutions, fixtureRetirement, sources: frozen}));
  // This check is deliberately separate from retirement: omitting or moving
  // retirement must fail before any browser owner may execute.
  fixtureFiles.assertRetired();
  return build;
}

export function captureBrowserTranscript(work, result, stem) {
  assert.ok(['observed-chromium', 'observed-firefox', 'observed-webkit', 'maximum-progress-browser'].includes(stem));
  const roles = {fixture: 'BrowserFixture', labels: 'BrowserLabels', wire: 'BrowserWire',
    secret: 'BrowserSecret', route: 'BrowserRoute', sink: 'BrowserSink', progress: 'BrowserProgress'};
  const rows = result.calls.map((row, index) => ({id: (assert.ok(Object.hasOwn(roles, row.role)), roles[row.role]) + index,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  const path = join(work, stem + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  return {rows, path};
}

export function replayBrowser(build, result, stem) {
  const {rows, path} = captureBrowserTranscript(build.work, result, stem);
  for (const standard of [true, false]) {
    const output = build.runNative(standard, [path]);
    assert.match(output, new RegExp('PASS ' + rows.length + ' complete presentation vectors twice'));
    const changed = rows.map(row => ({...row, response: Buffer.from(row.response)}));
    assert.ok(changed.length && changed[0].response.length); changed[0].response[0] ^= 1;
    const mutation = join(build.work, 'changed-' + stem + '-' + standard + '.tsv'); writeFileSync(mutation, tsv(changed), {flag: 'wx'});
    assert.throws(() => build.runNative(standard, [mutation]), /native output mismatch/, 'observed browser substitution rejects');
  }
}

export function verifyModelMutation(kind, positive) {
  const secret = ['secretbound', 'secretroute'].includes(kind);
  const progress = kind === 'progress';
  const row = progress ? {id: 'ProgressCaseMutation', request: Uint8Array.of(5), response: Uint8Array.of(244)} : secret ? {id: 'BrowserRouteMutation',
    request: encodeWire([1, 1, 202, [[6, 'x'.repeat(kind === 'secretbound' ? 65 : 64)], [7, ''], [8, 10]]]),
    response: Uint8Array.of(kind === 'secretbound' ? 244 : 245)}
    : corpus().find(row => row.id === ({binding: 'WrongBindingKind', trailing: 'Trailing'}[kind]));
  assert.ok(row); positive.unchanged();
  const build = prepare(kind, positive.sources, positive.inputs, positive.compilerOwner);
  let completed = false;
  try {
    const path = join(build.work, 'mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => build.runNative(standard, [path]), /native output mismatch/);
    assert.throws(() => executeCapturedWasm(build, progress ? 'progress' : secret ? 'route' : 'wasm', [row], progress ? 32 : secret ? 4096 : 67108864), /generated Wasm output mismatch/);
    build.unchanged(); positive.unchanged(); completed = true;
  } finally {
    if (completed) rmSync(build.work, {recursive: true, force: true});
    else process.stderr.write('Retained incomplete presentation mutant ' + build.work + '\n');
  }
}

export function verifyInventory() {
  const registry = JSON.parse(readFileSync(join(repository, 'model/browser-presentation-diagnostics.json')));
  assert.equal(registry.capability, 'DK-23'); assert.equal(registry.error_class, 'PresentationError');
  const source = ['wire', 'dom'].map(name => readFileSync(join(repository, 'sdk/browser/presentation-' + name + '.mjs'), 'utf8')).join('\n');
  for (const code of registry.errors) assert.ok(source.includes("'" + code + "'"), code);
  for (const match of source.matchAll(/fail\('([a-z-]+)'\)/g)) assert.ok(registry.errors.includes(match[1]), match[1]);
  assert.equal(registry.wire_errors.length, 10);
  // Independent conservative count over the closed grammar. Body rows are
  // nonempty, so the 4096-cell limit also bounds row-array overhead by4096.
  // Per-node12 covers parent, node/content heads, tag and all scalar fields.
  const maximumValidValues = 8 + 256 * 12 + 64 * 16 + 256 * 3 + 4096 + 4096 + 256 * 16;
  assert.equal(maximumValidValues, 17160); assert.ok(maximumValidValues < 20000);
  const wire = JSON.parse(/\\semanticdata\{(.*)\}/.exec(readFileSync(join(repository,
    'stdlib/src/Foundation/View/Browser/V1/Wire.lex.tex'), 'utf8'))[1]);
  const root = wire.declarations.find(row => row.name === 'viewWireParse');
  const budgets = [];
  function visit(value) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'call' && ['readViewPresentation', 'readViewIntent'].includes(value.function.name)) budgets.push(value.arguments.at(-1));
    Object.values(value).forEach(item => Array.isArray(item) ? item.forEach(visit) : visit(item));
  }
  visit(root); assert.deepEqual(budgets, [{kind: 'nat', value: '20000'}, {kind: 'nat', value: '20000'}]);
}
