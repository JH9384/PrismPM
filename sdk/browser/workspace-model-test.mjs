import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {
  copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {createPrivateDriverTarget, ensureProdExport} from '../../tests/browser-view/compile.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const moduleName = 'Foundation.Browser.V1.Workspace';
const files = ['Workspace.lex.tex', 'WorkspaceCorpus.lex.tex'];
const sha256 = value => createHash('sha256').update(value).digest('hex');
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;

function readRegular(path, maximum = 32 * 1024 * 1024) {
  const stat = lstatSync(path);
  assert.ok(stat.isFile() && stat.size <= maximum, `bounded regular file: ${path}`);
  assert.equal(realpathSync(path), resolve(path), `no source symlink: ${path}`);
  const bytes = readFileSync(path);
  assert.equal(bytes.length, stat.size, 'source size changed during read');
  return bytes;
}

function assertSameBytes(actual, expected, label) {
  assert.ok(Buffer.isBuffer(actual) && Buffer.isBuffer(expected), 'exact byte buffers required');
  // Buffer diffs can allocate far more memory than the bounded input itself.
  assert.ok(actual.equals(expected), label);
}

test('large byte mismatches fail with bounded diagnostics and exact equality', () => {
  const expected = Buffer.alloc(1_104_665, 97), actual = Buffer.from(expected);
  assertSameBytes(actual, expected, 'same bytes');
  actual[actual.length - 1] ^= 1;
  for (const value of [actual, expected.subarray(1)]) {
    assert.throws(() => assertSameBytes(value, expected, 'bounded byte mismatch'), error =>
      error instanceof assert.AssertionError && error.message === 'bounded byte mismatch');
  }
});

function run(program, args, cwd, extraEnv = {}) {
  const result = spawnSync(program, args, {
    cwd, encoding: 'utf8', timeout: 300_000, maxBuffer: 16 * 1024 * 1024,
    env: {...process.env, CARGO_NET_OFFLINE: 'true', ...extraEnv},
  });
  assert.ifError(result.error);
  assert.equal(result.status, 0,
    `${program} ${args.join(' ')}\n${result.stdout}\n${result.stderr}`);
  return result.stdout;
}

function verifyPins() {
  const manifest = readRegular(join(repository, 'model/dependencies.toml')).toString('utf8');
  const artifacts = manifest.split('[[dependency.artifact]]').slice(1).map(section => {
    const text = section.split('[[dependency]]')[0];
    return {
      path: /^path = "([^"]+)"$/m.exec(text)?.[1],
      hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],
      tree: /^tree_root = "([^"]+)"$/m.exec(text)?.[1],
    };
  });
  for (const name of [
    'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256',
    'vendor/lexlean/MANIFEST.sha256',
  ]) {
    const matches = artifacts.filter(artifact => artifact.path === name);
    assert.equal(matches.length, 1, `one exact compiler pin: ${name}`);
    const [{hash, tree}] = matches;
    const bytes = readRegular(join(repository, name));
    assert.equal(sha256(bytes), hash, `compiler artifact: ${name}`);
    if (!tree) continue;
    const seen = new Set();
    for (const row of bytes.toString('utf8').trimEnd().split('\n')) {
      const match = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(row);
      assert.ok(match, 'canonical compiler manifest row');
      const [, digest, path] = match;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => part === '..' || part === '.' || part === ''));
      assert.ok(!seen.has(path), 'unique compiler manifest paths');
      seen.add(path);
      assert.equal(sha256(readRegular(join(repository, tree, path))), digest, `compiler source: ${path}`);
    }
  }
}

function corpus(source) {
  const match = /\\semanticdata\{([^\n]+)\}\n/.exec(source);
  assert.ok(match, 'one canonical semantic module');
  assert.equal(source.match(/\\semanticdata\{/g)?.length, 1);
  const data = JSON.parse(match[1]);
  assert.equal(JSON.stringify(canonical(data)), match[1]);
  assert.equal(data.spec, 'lexlean/semantic-module/1');
  const declarations = new Map(data.declarations.map(declaration => [declaration.name, declaration]));
  assert.equal(declarations.size, data.declarations.length);
  const requests = [...declarations.keys()].filter(name => name.startsWith('request'));
  assert.equal(requests.length, 45, 'complete modeled acceptance corpus');
  assert.equal(declarations.size, 847, 'exact bounded fixture declaration closure');
  const helpers = data.declarations.filter(declaration => declaration.name.startsWith('fixtureLiteral'));
  assert.equal(helpers.length, 706, 'complete bounded literal helper set');
  for (const [index, helper] of helpers.entries()) {
    assert.equal(helper.name, `fixtureLiteral${index}`);
    assert.deepEqual(Object.keys(helper).sort(), ['body', 'kind', 'name', 'parameters', 'result']);
    assert.equal(helper.kind, 'definition');
    assert.deepEqual(helper.parameters, []);
    assert.deepEqual(helper.result, {kind: 'bytes'});
    assert.deepEqual(Object.keys(helper.body).sort(), ['hex', 'kind']);
    assert.equal(helper.body.kind, 'bytes');
    assert.match(helper.body.hex, /^(?:[0-9a-f]{2})*$/);
    assert.ok(helper.body.hex.length <= 512, 'bounded literal C initializer');
  }
  const used = new Set();
  const cache = new Map();
  function expand(name, active = new Set()) {
    assert.ok(!active.has(name), 'nonrecursive fixture data');
    assert.ok(active.size <= 16, 'bounded fixture reference depth');
    used.add(name);
    if (cache.has(name)) return cache.get(name);
    const value = declarations.get(name);
    assert.equal(value?.kind, 'definition');
    assert.deepEqual(value.parameters, []);
    assert.deepEqual(value.result, {kind: 'bytes'});
    const next = new Set([...active, name]);
    function bytes(expression, depth = 0) {
      assert.ok(depth <= 32, 'bounded fixture concatenation depth');
      let result;
      if (expression.kind === 'bytes') {
        assert.deepEqual(Object.keys(expression).sort(), ['hex', 'kind']);
        assert.match(expression.hex, /^(?:[0-9a-f]{2})*$/);
        assert.ok(expression.hex.length <= 512, 'bounded literal C initializer');
        result = Buffer.from(expression.hex, 'hex');
      } else if (expression.kind === 'call') {
        assert.deepEqual(Object.keys(expression).sort(), ['arguments', 'function', 'kind']);
        assert.deepEqual(expression.arguments, []);
        assert.deepEqual(Object.keys(expression.function), ['name']);
        assert.match(expression.function.name, /^(?:fixture|request)[A-Za-z0-9]+$/);
        result = expand(expression.function.name, next);
      } else {
        assert.deepEqual(Object.keys(expression).sort(), ['arguments', 'kind', 'operation', 'result']);
        assert.equal(expression.kind, 'primitive');
        assert.equal(expression.operation, 'append');
        assert.deepEqual(expression.result, {kind: 'bytes'});
        assert.equal(expression.arguments.length, 2);
        result = Buffer.concat(expression.arguments.map(argument => bytes(argument, depth + 1)));
      }
      assert.ok(result.length <= 1_104_665, 'bounded expanded fixture bytes');
      return result;
    }
    const result = bytes(value.body);
    cache.set(name, result);
    return result;
  }
  const vectors = requests.map(name => {
    const id = name.slice('request'.length);
    const request = declarations.get(name);
    const response = declarations.get(`response${id}`);
    const probe = declarations.get(`probe${id}`);
    assert.ok(request && response && probe);
    assert.deepEqual(probe.body, {
      arguments: [
        {arguments: [{arguments: [], function: {name}, kind: 'call'}],
          function: {module: moduleName, name: 'reduceWorkspaceBytes'}, kind: 'call'},
        {arguments: [], function: {name: `response${id}`}, kind: 'call'},
      ], kind: 'primitive', operation: 'equal', result: {kind: 'bool'},
    }, `probe binds exact modeled entry and expectation: ${id}`);
    assert.deepEqual(probe.parameters, []);
    assert.deepEqual(probe.result, {kind: 'bool'});
    used.add(`probe${id}`);
    return {id, request: expand(name).toString('hex'), response: expand(`response${id}`).toString('hex')};
  });
  assert.deepEqual([...used].sort(), [...declarations.keys()].sort(), 'complete request/response/probe/data closure');
  assert.equal(sha256(vectors.map(vector => `${vector.id}\t${vector.request}\t${vector.response}\n`).join('')),
    '70e4ec78bc68029b81943fc2e0dcf4ae320c0e12ddf43d5fc4f1e8def0560147', 'exact original 45 vectors');
  return vectors;
}

test('corpus collector rejects altered probe bindings and non-data fixture expressions', () => {
  const source = readRegular(join(repository,
    'stdlib/src/Foundation/Browser/V1/WorkspaceCorpus.lex.tex')).toString('utf8');
  const match = /\\semanticdata\{([^\n]+)\}\n/.exec(source);
  function changed(mutate) {
    const data = JSON.parse(match[1]);
    mutate(data.declarations);
    return source.replace(match[1], JSON.stringify(canonical(data)));
  }
  assert.throws(() => corpus(changed(rows => rows.pop())));
  assert.throws(() => corpus(changed(rows => rows.push(rows[0]))));
  for (const mutate of [
    rows => {
      const helper = rows.find(row => row.name.startsWith('fixtureLiteral') && row.body.hex.length > 0);
      helper.body.hex = 'ff' + helper.body.hex.slice(2);
    },
    rows => rows.push({...structuredClone(rows[0]), name: 'fixtureLiteralUnused'}),
    rows => rows.splice(0, 1),
  ]) assert.throws(() => corpus(changed(mutate)));
  assert.throws(() => corpus(changed(rows => {
    const helper = rows.find(row => row.name.startsWith('fixtureLiteral') && row.body.hex === '');
    assert.ok(helper, 'exact empty literal helper');
    function inline(value) {
      if (Array.isArray(value)) return value.map(inline);
      if (!value || typeof value !== 'object') return value;
      if (value.kind === 'call' && value.function.name === helper.name) return {kind: 'bytes', hex: ''};
      return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, inline(child)]));
    }
    for (const row of rows) row.body = inline(row.body);
    assert.equal(rows.length, 847, 'unused-helper mutation preserves cardinality and bytes');
  })), /complete request\/response\/probe\/data closure/);
  assert.throws(() => corpus(changed(rows => {
    rows.find(row => row.name === 'probeGenesis').body.arguments[0].function.name = 'encodeWorkspaceError';
  })));
  for (const body of [
    {kind: 'call', function: {name: 'fixtureMaximumBody'}, arguments: []},
    {kind: 'call', function: {name: 'fixtureMissing'}, arguments: []},
    {kind: 'call', function: {module: moduleName, name: 'reduceWorkspaceBytes'}, arguments: []},
    {kind: 'if', condition: {kind: 'bool', value: true}, then_value: {kind: 'bytes', hex: '00'}, else_value: {kind: 'bytes', hex: '01'}},
    {kind: 'bytes', hex: '00'.repeat(1_104_666)},
  ]) assert.throws(() => corpus(changed(rows => {
    rows.find(row => row.name === 'fixtureMaximumBody').body = body;
  })));
});

test('fresh LexLean workspace corpus executes completely through pinned production codegen', {timeout: 1_200_000}, async t => {
  verifyPins();
  const sources = new Map(files.map(file => [file, readRegular(join(repository,
    'stdlib/src/Foundation/Browser/V1', file))]));
  const vectors = corpus(sources.get('WorkspaceCorpus.lex.tex').toString('utf8'));
  const workspace = JSON.parse(/\\semanticdata\{([^\n]+)\}\n/.exec(sources.get('Workspace.lex.tex').toString('utf8'))[1]);
  const errors = workspace.declarations.find(declaration => declaration.name === 'WorkspaceError');
  assert.equal(errors.kind, 'inductive');
  assert.deepEqual([...new Set(vectors.filter(vector => /^[0-9a-f]{2}$/.test(vector.response))
    .map(vector => Number.parseInt(vector.response, 16)))].sort((a, b) => a - b),
  errors.constructors.map((_, index) => index + 1), 'every modeled typed rejection is exercised');
  assert.equal(vectors.find(vector => vector.id === 'CombinedMaximumStateRejectedAtEventLimit').request.length / 2,
    1_104_664, 'simultaneous maximum state and event payload');
  assert.equal(vectors.find(vector => vector.id === 'CombinedMaximumStateControlAccepted').response.length / 2,
    1_100_428, 'accepted control operation reaches the exact maximum encoded state');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-workspace-model-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  const rustToolchain = readRegular(join(repository, 'rust-toolchain.toml'));
  const leanToolchain = readRegular(join(repository, 'lean-toolchain')).toString('utf8').trim();
  assert.equal(leanToolchain, 'leanprover/lean4:v4.32.1', 'fixture matches the pinned Lean edition');
  writeFileSync(join(work, 'rust-toolchain.toml'), rustToolchain, {flag: 'wx'});
  const project = join(work, 'project');
  const sourceRoot = join(project, 'src/Foundation/Browser/V1');
  mkdirSync(sourceRoot, {recursive: true});
  for (const [file, bytes] of sources) writeFileSync(join(sourceRoot, file), bytes, {flag: 'wx'});
  writeFileSync(join(project, 'lean-toolchain'), 'leanprover/lean4:v4.32.1\n', {flag: 'wx'});
  writeFileSync(join(project, 'lakefile.toml'), 'name = "workspace_verification"\nversion = "0.1.0"\n', {flag: 'wx'});
  writeFileSync(join(project, 'lexlean.toml'), `spec = "lexlean/project/1"
name = "workspace-model-verification"
language = "1.1"
module_prefix = "PrismPM"
source_roots = ["src"]
entrypoints = ["src/Foundation/Browser/V1/WorkspaceCorpus.lex.tex"]
build_root = ".lexlean"
lockfile = "lexlean.lock"
lean_workspace = "."
lean_toolchain = "leanprover/lean4:v4.32.1"
[[lexicon_source]]
package = "lexlean.std.nat"
kind = "builtin"
[limits]
max_file_bytes = 4194304
max_total_source_bytes = 67108864
max_primitive_atoms = 2000000
max_token_lattice_edges = 4000000
max_parse_states = 4000000
max_ir_nodes = 2000000
max_scope_depth = 1024
max_import_depth = 128
max_diagnostics = 256
max_child_output_bytes = 16777216
child_timeout_ms = 300000
`, {flag: 'wx'});
  const driverTarget = createPrivateDriverTarget(work);
  run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path',
    join(repository, 'tests/browser-workspace/Cargo.toml')], repository, {CARGO_TARGET_DIR: driverTarget});
  const driver = join(driverTarget, 'debug/browser-workspace-model-driver');
  run('lake', ['update'], project);
  const verified = JSON.parse(run(driver, ['verify', join(project, 'lexlean.toml')], repository));
  assert.deepEqual(verified.modules, [moduleName, `${moduleName}Corpus`]);
  for (const name of ['source_id', 'semantic_id', 'build_id', 'attestation_id']) assert.match(verified[name], /^[0-9a-f]{64}$/);
  assert.equal(verified.root, join(project, '.lexlean/verified', verified.attestation_id));
  const lean = join(work, 'lean');
  const leanSource = join(lean, 'PrismPM/Foundation/Browser/V1');
  mkdirSync(leanSource, {recursive: true});
  for (const name of ['Workspace', 'WorkspaceCorpus']) {
    const generatedLean = readRegular(join(verified.root, `modules/PrismPM/Foundation/Browser/V1/${name}.lean`));
    writeFileSync(join(leanSource, `${name}.lean`), generatedLean, {flag: 'wx'});
  }
  writeFileSync(join(lean, 'lean-toolchain'), 'leanprover/lean4:v4.32.1\n', {flag: 'wx'});
  writeFileSync(join(lean, 'lakefile.toml'), `name = "workspace_generated_probe"
version = "0.1.0"
[[lean_lib]]
name = "PrismGenerated"
roots = ["PrismPM.${moduleName}", "PrismPM.${moduleName}Corpus"]
`, {flag: 'wx'});
  run('lake', ['build', 'PrismGenerated'], lean);
  const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
  const exported = join(work, 'export');
  const roots = ['reduceWorkspaceBytes', 'workspaceRole', 'workspaceSigningPreimage'].map(name => `PrismPM.${moduleName}.${name}`);
  run(prodExport, [
    '--module', `PrismPM.${moduleName}`, ...roots.flatMap(name => ['--root', name]),
    '--ir-module', 'BrowserWorkspace', '--out', exported,
  ], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
  const generated = join(work, 'generated');
  const generation = JSON.parse(run(driver, ['generate', join(exported, 'kernel.ir'), generated, repository], repository));
  assert.equal(generation.ir_sha256, sha256(readRegular(join(exported, 'kernel.ir'))));
  t.diagnostic(`source ${verified.source_id}; attestation ${verified.attestation_id}; LCNF ${generation.ir_sha256}`);
  const serialized = vectors.map(value => `${value.id}\t${value.request}\t${value.response}\n`).join('');
  writeFileSync(join(work, 'vectors.tsv'), serialized, {flag: 'wx'});
  const runner = join(work, 'runner');
  mkdirSync(join(runner, 'src'), {recursive: true});
  copyFileSync(join(repository, 'tests/browser-workspace/runner.rs'), join(runner, 'src/main.rs'));
  writeFileSync(join(runner, 'Cargo.lock'), `# This file is automatically @generated by Cargo.
# It is not intended for manual editing.
version = 4
[[package]]
name = "browser-workspace-core-probe"
version = "0.1.0"
[[package]]
name = "browser-workspace-corpus-runner"
version = "0.1.0"
dependencies = ["browser-workspace-core-probe"]
`, {flag: 'wx'});
  for (const standard of [true, false]) {
    writeFileSync(join(runner, 'Cargo.toml'), `[package]
name = "browser-workspace-corpus-runner"
version = "0.1.0"
edition = "2021"
publish = false
[workspace]
[dependencies]
browser-workspace-core-probe = { path = "../generated", default-features = ${standard} }
`);
    const stdout = run('cargo', ['run', '--locked', '--offline', '--manifest-path',
      join(runner, 'Cargo.toml'), '--', join(work, 'vectors.tsv')], runner,
    {CARGO_TARGET_DIR: join(work, 'native-target')});
    const rows = [...stdout.matchAll(/^PASS ([A-Za-z0-9]+) [0-9]+ms$/gm)].map(match => match[1]);
    assert.deepEqual(rows, vectors.map(value => value.id), 'all exact cases executed in order');
    assert.match(stdout, /PASS all 45 generated production reducer cases, twice each/);
    await t.test(standard ? 'generated standard Rust: all 45 cases twice' : 'generated no_std Rust: all 45 cases twice', () => {});
  }
  const replay = run('cargo', ['run', '--release', '--locked', '--offline', '--manifest-path',
    join(runner, 'Cargo.toml'), '--', join(work, 'vectors.tsv'), '--replay'], runner,
  {CARGO_TARGET_DIR: join(work, 'native-target')});
  assert.match(replay, /^PASS generated replay: 1024 accepted events, exact prestate, maximum 1100428-byte response, event-cap rejection, [0-9]+ms\n$/);
  t.diagnostic(replay.trim());
  const guest = join(work, 'guest');
  const wasmGeneration = JSON.parse(run(driver, ['generate-wasm', join(exported, 'kernel.ir'), guest, repository], repository));
  assert.deepEqual(wasmGeneration, generation, 'same exact LCNF for native and browser guest');
  run('cargo', ['build', '--locked', '--offline', '--release'], guest,
    {CARGO_TARGET_DIR: join(guest, 'target')});
  const wasm = new WebAssembly.Module(readRegular(join(guest,
    'target/wasm32-unknown-unknown/release/browser_workspace_wasm_probe.wasm')));
  assert.deepEqual(WebAssembly.Module.imports(wasm), [], 'generated pure reducer has no host imports');
  function invoke(instance, input) {
    const {holo_alloc, holo_run, memory} = instance.exports;
    const pointer = holo_alloc(input.length);
    new Uint8Array(memory.buffer, pointer, input.length).set(input);
    const packed = BigInt.asUintN(64, holo_run(pointer, input.length));
    const output = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
    assert.ok(size <= 1_100_428 && output + size <= memory.buffer.byteLength);
    return {output, size, bytes: Buffer.from(new Uint8Array(memory.buffer, output, size))};
  }
  let maximumMemory = 0;
  for (const vector of vectors) {
    const input = Buffer.from(vector.request, 'hex');
    for (let repeat = 0; repeat < 2; repeat++) {
      // The generated allocator retains earlier outputs: use a fresh instance
      // per pure command, caching only the compiled module, never resetting it.
      const instance = new WebAssembly.Instance(wasm, {});
      if (input.length > 1_104_664) {
        assert.equal(vector.id, 'CombinedMaximumRequestOverflowRejected');
        assert.equal(vector.response, '01', 'native byte decoder rejects oversize');
        assert.throws(() => invoke(instance, input), WebAssembly.RuntimeError,
          'CoreWasm rejects before admitting an over-cap input allocation');
      } else {
        let output;
        try { output = invoke(instance, input).bytes; }
        catch (error) { throw new Error(`${vector.id}, repeat ${repeat}, guest memory ${instance.exports.memory.buffer.byteLength}: ${error.message}`, {cause: error}); }
        assertSameBytes(output, Buffer.from(vector.response, 'hex'),
          `actual generated guest exact modeled response: ${vector.id}, repeat ${repeat}`);
      }
      const memory = instance.exports.memory.buffer.byteLength;
      assert.ok(memory <= 512 * 65536, 'bounded actual guest memory');
      maximumMemory = Math.max(maximumMemory, memory);
      if (repeat === 0 && vector.id.startsWith('Combined')) t.diagnostic(`${vector.id}: ${memory} guest bytes`);
    }
  }
  await t.test('generated CoreWasm: all 45 boundary cases twice, fresh instances', () => {});
  const resident = new WebAssembly.Instance(wasm, {});
  const largest = vectors.find(vector => vector.id === 'CombinedMaximumStateControlAccepted');
  const input = Buffer.from(largest.request, 'hex');
  const first = invoke(resident, input);
  let repeated = 'accepted';
  try {
    assertSameBytes(invoke(resident, input).bytes, first.bytes, 'repeated guest bytes');
  } catch (error) {
    assert.ok(error instanceof WebAssembly.RuntimeError);
    repeated = 'bounded allocation trap';
  }
  assertSameBytes(Buffer.from(new Uint8Array(resident.exports.memory.buffer, first.output, first.size)),
    first.bytes, 'a repeated call never resets or overwrites the first output');
  t.diagnostic(`maximum single-call memory ${maximumMemory}; second resident maximum-state call: ${repeated}; resident memory ${resident.exports.memory.buffer.byteLength}`);
  for (const [file, bytes] of sources) assertSameBytes(readRegular(join(repository,
    'stdlib/src/Foundation/Browser/V1', file)), bytes, 'modeled sources unchanged');
  assert.deepEqual(readRegular(join(repository, 'rust-toolchain.toml')), rustToolchain);
  assert.equal(readRegular(join(repository, 'lean-toolchain')).toString('utf8').trim(), leanToolchain);
  verifyPins();
});
