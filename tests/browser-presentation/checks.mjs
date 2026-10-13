import assert from 'node:assert/strict';
import {readFileSync, writeFileSync, rmSync} from 'node:fs';
import {join} from 'node:path';
import {prepare, run, sha, repository} from './compile.mjs';
import {captureCompilerInputs} from '../browser-view/compiler-owner.mjs';
import {corpus, boundaries, maximumCorpus, combinedMaximumCorpus, secretMaximumCorpus, progressMaximumCorpus} from './corpus.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';
import {encodeWire} from '../../sdk/browser/presentation-wire.mjs';
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

export function sourceClosure() {
  const sourceNames = ['compile.mjs', 'checks.mjs', 'corpus.mjs', 'maximum-fixtures.mjs', 'runner.rs',
    'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'];
  const paths = [
    ...sourceNames.map(path => 'tests/browser-presentation/' + path),
    'tests/browser-presentation/src/Fixture.lex.tex', 'tests/browser-presentation/browser.mjs',
    'tests/browser-presentation/browser-fixture.mjs', 'sdk/browser/presentation.test.mjs',
    'sdk/browser/presentation-dom.mjs', 'sdk/browser/presentation-wire.mjs',
    'sdk/browser/identity.mjs', 'sdk/browser/browser-test-server.mjs',
    'sdk/browser/effects-module.mjs', 'sdk/browser/effects-wire.mjs',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/verification-products.mjs',
    'tests/browser-view/prerequisites.mjs', 'tests/fixtures/library/native-library/project/lexlean.toml',
    'stdlib/src/Foundation/View/Browser/V1/Model.lex.tex',
    'stdlib/src/Foundation/View/Browser/V1/Wire.lex.tex', 'stdlib/src/Foundation/Bytes.lex.tex',
    'stdlib/src/Foundation/Codec.lex.tex', 'stdlib/src/Foundation/Codec/Cbor/V1/Primitive.lex.tex',
    'model/browser-presentation-diagnostics.json', 'LICENSE-MIT', 'LICENSE-APACHE',
  ];
  return {...captureCompilerInputs('presentation'),
    ...Object.fromEntries(paths.map(path => [path, sha(readFileSync(join(repository, path)))]))};
}

export async function verifyWire(t, compilerOwner = null) {
  const frozen = sourceClosure();
  if (compilerOwner) for (const [path, digest] of Object.entries(compilerOwner.evidence.inputs))
    assert.equal(frozen[path], digest, 'compiler tool closure differs from frozen presentation inputs');
  const build = prepare(null, compilerOwner);
  t.after(() => rmSync(build.work, {recursive: true, force: true}));
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
  build.maximumFrames = [];
  const allMaxima = function* () { yield* maximum; yield* combinedMaximumCorpus(); };
  for (const row of allMaxima()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    binaries.push({input, output});
    if (row.request === row.response) build.maximumFrames.push({id: row.id,
      request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  const secretBinaries = [];
  build.secretMaxima = [];
  for (const row of secretMaximumCorpus()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    secretBinaries.push({input, output, mode: row.mode});
    build.secretMaxima.push({id: row.id, request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  const progressBinaries = []; build.progressMaxima = [];
  for (const row of progressMaximumCorpus()) {
    const input = join(build.work, row.id + '.request'), output = join(build.work, row.id + '.response');
    writeFileSync(input, row.request, {flag: 'wx'}); writeFileSync(output, row.response, {flag: 'wx'});
    progressBinaries.push({input, output, mode: row.mode});
    build.progressMaxima.push({id: row.id, request: sha(row.request), response: sha(row.response), length: row.request.length});
  }
  for (const standard of [true, false]) await prerequisite(t, 'complete generated ' + (standard ? 'std' : 'no_std') + ' corpus, all structural maxima and exact 64 MiB frame', () => {
    const binary = build.compileNative(standard), output = run(binary, [path], build.runner);
    assert.deepEqual([...output.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(row => row[1]), allRows.map(row => row.id));
    assert.match(output, new RegExp('PASS ' + allRows.length + ' complete presentation vectors twice'));
    for (const row of binaries) assert.equal(run(binary, ['--binary', row.input, row.output], build.runner), 'PASS binary complete presentation vector twice\n');
    for (const row of secretBinaries) assert.equal(run(binary, [row.mode === 'wasm' ? '--binary' : '--' + row.mode, row.input, row.output], build.runner), 'PASS binary complete presentation vector twice\n');
    for (const row of progressBinaries) assert.equal(run(binary, [row.mode === 'wasm' ? '--binary' : '--' + row.mode, row.input, row.output], build.runner), 'PASS binary complete presentation vector twice\n');
  });
  await prerequisite(t, 'fresh bounded Core-Wasm executes every actual structural maximum and exact 64 MiB frame', () => {
    build.maximum = executeWasm(build.wasmBytes, [...rows, maximum[0]]);
    executeWasm(build.intentBytes, intentRows, 32);
    executeWasm(build.routeBytes, secretRows, 4096);
    executeWasm(build.progressBytes, progressRows, 32);
  });
  await prerequisite(t, 'exact 64 MiB payloads execute at every combined node and table boundary position', () => {
    for (const row of combinedMaximumCorpus()) {
      const observed = executeWasm(build.wasmBytes, [row]);
      build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
    }
  });
  await prerequisite(t, 'secret raw field exact/over bounds and actual maximum framed route/sink execute within unchanged 1 GiB memory', () => {
    for (const row of secretMaximumCorpus()) {
      const observed = executeWasm(build[row.mode + 'Bytes'], [row], row.mode === 'maxfield' ? 67108865 : 67108864);
      build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
    }
  });
  await prerequisite(t, 'actual progress predicate holds two 64 MiB presentations within 1 GiB and refuses equal revision and input one-over', () => {
    for (const row of progressMaximumCorpus()) {
      if (row.allocationReject) {
        const instance = new WebAssembly.Instance(new WebAssembly.Module(build.maxprogressBytes), {});
        assert.throws(() => instance.exports.holo_alloc(row.request.length), WebAssembly.RuntimeError);
      } else {
        const observed = executeWasm(build[row.mode + 'Bytes'], [row]);
        build.maximum.maximumBytes = Math.max(build.maximum.maximumBytes, observed.maximumBytes);
        if (row.mode === 'maxprogress') build.progressMaximum = Math.max(build.progressMaximum ?? 0, observed.maximumBytes);
      }
    }
  });
  assert.deepEqual(sourceClosure(), frozen, 'owning oracle source remained frozen');
  build.maximumFrame = {request: sha(maximum[0].request), response: sha(maximum[0].response), length: maximum[0].request.length};
  t.diagnostic(JSON.stringify({source: build.verified.source_id, attestation: build.verified.attestation_id,
    ir: build.generation.ir_sha256, wasm: sha(build.wasmBytes), fixture: sha(build.fixtureBytes), labels: sha(build.labelsBytes),
    vectors: rows.length, maximum: build.maximum, frame: build.maximumFrame, secretMaxima: build.secretMaxima,
    progressMaximum: build.progressMaximum, progressMaxima: build.progressMaxima, sources: frozen}));
  return build;
}

export function replayBrowser(build, result, stem = 'observed-browser') {
  assert.ok(['observed-browser', 'maximum-progress-browser'].includes(stem));
  const roles = {fixture: 'BrowserFixture', labels: 'BrowserLabels', wire: 'BrowserWire',
    secret: 'BrowserSecret', route: 'BrowserRoute', sink: 'BrowserSink', progress: 'BrowserProgress'};
  const rows = result.calls.map((row, index) => ({id: (assert.ok(roles[row.role]), roles[row.role]) + index,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  const path = join(build.work, stem + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  for (const standard of [true, false]) {
    const binary = build.compileNative(standard), output = run(binary, [path], build.runner);
    assert.match(output, new RegExp('PASS ' + rows.length + ' complete presentation vectors twice'));
    const changed = rows.map(row => ({...row, response: Buffer.from(row.response)}));
    assert.ok(changed.length && changed[0].response.length); changed[0].response[0] ^= 1;
    const mutation = join(build.work, 'changed-' + stem + '-' + standard + '.tsv'); writeFileSync(mutation, tsv(changed), {flag: 'wx'});
    assert.throws(() => run(binary, [mutation], build.runner), /native output mismatch/, 'observed browser substitution rejects');
  }
}

export function verifyModelMutation(kind, compilerOwner = null) {
  const secret = ['secretbound', 'secretroute'].includes(kind);
  const progress = kind === 'progress';
  const row = progress ? {id: 'ProgressCaseMutation', request: Uint8Array.of(5), response: Uint8Array.of(244)} : secret ? {id: 'BrowserRouteMutation',
    request: encodeWire([1, 1, 202, [[6, 'x'.repeat(kind === 'secretbound' ? 65 : 64)], [7, ''], [8, 10]]]),
    response: Uint8Array.of(kind === 'secretbound' ? 244 : 245)}
    : corpus().find(row => row.id === ({binding: 'WrongBindingKind', trailing: 'Trailing'}[kind]));
  assert.ok(row); const build = prepare(kind, compilerOwner);
  try {
    const path = join(build.work, 'mutation.tsv'); writeFileSync(path, tsv([row]), {flag: 'wx'});
    for (const standard of [true, false]) assert.throws(() => run(build.compileNative(standard), [path], build.runner), /native output mismatch/);
    assert.throws(() => executeWasm(progress ? build.progressBytes : secret ? build.routeBytes : build.wasmBytes, [row], progress ? 32 : secret ? 4096 : 67108864), /generated Wasm output mismatch/);
  } finally { rmSync(build.work, {recursive: true, force: true}); }
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
