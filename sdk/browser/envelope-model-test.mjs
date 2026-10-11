import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {run} from '../../tests/browser-journal/compile.mjs';
import {createPrivateDriverTarget, ensureProdExport} from '../../tests/browser-view/compile.mjs';
import {
  copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync,
  realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const fixture = join(repository, 'tests/browser-envelope');
const moduleName = 'Foundation.Browser.V1.WorkspaceEnvelope';
const workspaceModule = 'Foundation.Browser.V1.Workspace';
const files = ['Workspace.lex.tex', 'WorkspaceEnvelope.lex.tex', 'WorkspaceEnvelopeCorpus.lex.tex'];
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
  assert.equal(requests.length, 43, 'complete modeled acceptance corpus');
  assert.ok(declarations.size <= requests.length * 3 + 16, 'bounded fixture declaration closure');
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
      assert.ok(result.length <= 4_365, 'bounded expanded fixture bytes');
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
          function: {module: moduleName, name: 'workspaceEnvelopeBytes'}, kind: 'call'},
        {arguments: [], function: {name: `response${id}`}, kind: 'call'},
      ], kind: 'primitive', operation: 'equal', result: {kind: 'bool'},
    }, `probe binds exact modeled entry and expectation: ${id}`);
    assert.deepEqual(probe.parameters, []);
    assert.deepEqual(probe.result, {kind: 'bool'});
    used.add(`probe${id}`);
    return {id, request: expand(name).toString('hex'), response: expand(`response${id}`).toString('hex')};
  });
  assert.deepEqual([...used].sort(), [...declarations.keys()].sort(), 'complete request/response/probe/data closure');
  return vectors;
}


test('envelope corpus binds generated codec and closed literal data', () => {
  const source = readRegular(join(repository, 'stdlib/src/Foundation/Browser/V1/WorkspaceEnvelopeCorpus.lex.tex')).toString('utf8');
  const match = /\\semanticdata\{([^\n]+)\}\n/.exec(source);
  assert.ok(match, 'fixture parses before each planted negative');
  function changed(mutate) {
    const data = JSON.parse(match[1]); mutate(data.declarations);
    return source.replace(match[1], JSON.stringify(canonical(data)));
  }
  assert.throws(() => corpus(changed(rows => rows.pop())));
  assert.throws(() => corpus(changed(rows => rows.push(rows[0]))));
  assert.throws(() => corpus(changed(rows => {
    rows.find(row => row.name === 'probeRoundTripGenesis').body.arguments[0].function.name = 'workspaceEnvelopeCandidate';
  })));
  assert.throws(() => corpus(changed(rows => {
    rows.find(row => row.name === 'requestRoundTripGenesis').body = {kind: 'call', function: {name: 'requestRoundTripGenesis'}, arguments: []};
  })));
});

test('fresh generated envelope codec and actual browser crypto interoperability', {timeout: 600_000}, async t => {
  verifyPins();
  const sources = new Map(files.map(file => [file, readRegular(join(repository, 'stdlib/src/Foundation/Browser/V1', file))]));
  assert.equal(sha256(sources.get('Workspace.lex.tex')), '32e718bc606af3cd00703558ec4c1ecdcf1e69239e88adb6ad3a364e69aacc4e');
  assert.deepEqual(sources.get('Workspace.lex.tex'), readRegular(join(repository, 'stdlib/src/Foundation/Browser/V1/Workspace.lex.tex')));
  const vectors = corpus(sources.get('WorkspaceEnvelopeCorpus.lex.tex').toString('utf8'));
  const work = mkdtempSync(join(tmpdir(), 'prismpm-workspace-envelope-'));
  t.after(() => rmSync(work, {recursive: true, force: true}));
  copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
  const project = join(work, 'project'), sourceRoot = join(project, 'src/Foundation/Browser/V1');
  mkdirSync(sourceRoot, {recursive: true});
  for (const [file, bytes] of sources) writeFileSync(join(sourceRoot, file), bytes, {flag: 'wx'});
  for (const file of ['lexlean.toml', 'lakefile.toml', 'lean-toolchain']) copyFileSync(join(fixture, file), join(project, file));
  const driverTarget = createPrivateDriverTarget(work);
  run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', join(fixture, 'driver/Cargo.toml')], repository, {CARGO_TARGET_DIR: driverTarget});
  const driver = join(driverTarget, 'debug/browser-workspace-envelope-driver');
  run('lake', ['update'], project);
  const verified = JSON.parse(run(driver, ['verify', join(project, 'lexlean.toml')], repository));
  assert.deepEqual(verified.modules, [workspaceModule, moduleName, moduleName + 'Corpus']);
  assert.equal(verified.root, join(project, '.lexlean/verified', verified.attestation_id));
  const lean = join(work, 'lean'), leanSource = join(lean, 'PrismPM/Foundation/Browser/V1');
  mkdirSync(leanSource, {recursive: true});
  for (const file of files) {
    const name = file.replace('.lex.tex', '.lean');
    copyFileSync(join(verified.root, 'modules/PrismPM/Foundation/Browser/V1', name), join(leanSource, name));
  }
  copyFileSync(join(repository, 'lean-toolchain'), join(lean, 'lean-toolchain'));
  writeFileSync(join(lean, 'lakefile.toml'), 'name = "workspace_envelope_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ["PrismPM.' + workspaceModule + '", "PrismPM.' + moduleName + '", "PrismPM.' + moduleName + 'Corpus"]\n', {flag: 'wx'});
  run('lake', ['build', 'PrismGenerated'], lean);
  const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
  const exported = join(work, 'export');
  run(prodExport, ['--module', 'PrismPM.' + moduleName, '--root', 'PrismPM.' + moduleName + '.workspaceEnvelopeBytes',
    '--ir-module', 'BrowserWorkspaceEnvelope', '--out', exported], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
  const generated = join(work, 'generated');
  const generation = JSON.parse(run(driver, ['generate', join(exported, 'kernel.ir'), generated, repository], repository));
  assert.equal(generation.ir_sha256, sha256(readRegular(join(exported, 'kernel.ir'))));
  t.diagnostic('source ' + verified.source_id + '; attestation ' + verified.attestation_id + '; LCNF ' + generation.ir_sha256);
  writeFileSync(join(work, 'vectors.tsv'), vectors.map(value => value.id + '\t' + value.request + '\t' + value.response + '\n').join(''), {flag: 'wx'});
  const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
  copyFileSync(join(fixture, 'runner.rs'), join(runner, 'src/main.rs'));
  writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-workspace-envelope-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-workspace-envelope-runner"\nversion = "0.1.0"\ndependencies = ["browser-workspace-envelope-core-probe"]\n', {flag: 'wx'});
  const nativeTarget = join(work, 'native-target');
  for (const standard of [true, false]) {
    writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-workspace-envelope-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-workspace-envelope-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
    const stdout = run('cargo', ['run', '--locked', '--offline', '--manifest-path', join(runner, 'Cargo.toml'), '--', join(work, 'vectors.tsv')], runner, {CARGO_TARGET_DIR: nativeTarget});
    assert.deepEqual([...stdout.matchAll(/^PASS ([A-Za-z0-9]+)$/gm)].map(match => match[1]), vectors.map(value => value.id));
    assert.match(stdout, /PASS all 43 modeled envelope vectors twice; every genesis prefix rejected; typed encoder rejects malformed fields/);
    await t.test(standard ? 'generated standard Rust' : 'generated no_std Rust', () => {});
  }
  const guest = join(work, 'guest');
  assert.deepEqual(JSON.parse(run(driver, ['generate-wasm', join(exported, 'kernel.ir'), guest, repository], repository)), generation);
  run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
  const wasmBytes = readRegular(join(guest, 'target/wasm32-unknown-unknown/release/browser_workspace_envelope_wasm_probe.wasm'));
  const wasm = new WebAssembly.Module(wasmBytes);
  assert.deepEqual(WebAssembly.Module.imports(wasm), []);
  function invoke(input) {
    const instance = new WebAssembly.Instance(wasm, {});
    const pointer = instance.exports.holo_alloc(input.length);
    new Uint8Array(instance.exports.memory.buffer, pointer, input.length).set(input);
    const packed = BigInt.asUintN(64, instance.exports.holo_run(pointer, input.length));
    const output = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
    assert.ok(size <= 4364 && output + size <= instance.exports.memory.buffer.byteLength);
    assert.ok(instance.exports.memory.buffer.byteLength <= 32 * 65536);
    return Buffer.from(new Uint8Array(instance.exports.memory.buffer, output, size));
  }
  for (const vector of vectors) for (let repeat = 0; repeat < 2; repeat++) {
    const input = Buffer.from(vector.request, 'hex');
    if (input.length > 4364) {
      assert.equal(vector.id, 'OverMaximum'); assert.equal(vector.response, '01');
      assert.throws(() => invoke(input), WebAssembly.RuntimeError);
    } else assert.deepEqual(invoke(input), Buffer.from(vector.response, 'hex'), vector.id);
  }
  const genesis = Buffer.from(vectors.find(value => value.id === 'RoundTripGenesis').request, 'hex');
  for (let n = 1; n < genesis.length; n++) assert.deepEqual(invoke(genesis.subarray(0, n)), Buffer.from([1]));
  await t.test('generated CoreWasm: complete corpus twice and every truncated genesis prefix', () => {});
  const {withBrowser} = await import(new URL('./browser-test-server.mjs', import.meta.url));
  const result = await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(); await page.goto(baseURL);
    return page.evaluate(async ({wasmBytes, template, maximum}) => {
      const host = await import('/identity.mjs');
      const module = await WebAssembly.compile(new Uint8Array(wasmBytes));
      const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
      const unhex = hex => new Uint8Array(hex.match(/../g)?.map(byte => parseInt(byte, 16)) ?? []);
      const calls = [];
      function codec(op, envelope) {
        const input = new Uint8Array(1 + envelope.length); input[0] = op; input.set(envelope, 1);
        const instance = new WebAssembly.Instance(module, {});
        const pointer = instance.exports.holo_alloc(input.length);
        new Uint8Array(instance.exports.memory.buffer, pointer, input.length).set(input);
        const packed = BigInt.asUintN(64, instance.exports.holo_run(pointer, input.length));
        const offset = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
        const result = new Uint8Array(instance.exports.memory.buffer, offset, length).slice();
        calls.push([hex(input), hex(result)]);
        if (result[0] !== 0) throw new Error('codec rejection');
        return result.slice(1);
      }
      const check = (condition, message) => { if (!condition) throw new Error(message); };
      const context = 'prismpm/workspace-event/1';
      const identity = await host.createIdentity(), other = await host.createIdentity();
      async function sign(template, signingContext = context) {
        const candidate = unhex(template);
        candidate.set(identity.publicKey, 4);
        candidate.set(unhex(identity.principal.slice(7)), 231);
        const unsigned = codec(1, candidate), preimage = codec(2, candidate);
        candidate.set(unhex((await host.digestBytes(preimage)).slice(7)), 167);
        candidate.set(await host.signBytes(identity, signingContext, unsigned), 69);
        check(hex(codec(0, candidate)) === hex(candidate), 'generated canonical envelope roundtrip');
        return candidate;
      }
      // Test-only crypto composition; no writes, reducer invocation or app authority.
      async function authentic(envelope) {
        try {
          const key = codec(3, envelope), signature = codec(4, envelope);
          const author = codec(6, envelope), eventId = codec(7, envelope);
          const unsigned = codec(1, envelope), preimage = codec(2, envelope);
          if (await host.identityPrincipal(key) !== 'sha256:' + hex(author)) return false;
          if (await host.digestBytes(preimage) !== 'sha256:' + hex(eventId)) return false;
          return await host.verifyBytes(key, context, unsigned, signature);
        } catch { return false; }
      }
      const cases = [];
      async function expect(name, envelope, expected) {
        check(await authentic(envelope) === expected, name);
        cases.push(name);
      }
      const positive = await sign(template), full = await sign(maximum);
      await expect('real P-256 genesis', positive, true);
      await expect('real P-256 maximum body', full, true);
      await expect('wrong signing context', await sign(template, 'prismpm/workspace-event/2'), false);
      const mutated = (source, at) => { const bytes = source.slice(); bytes[at] ^= 1; return bytes; };
      await expect('changed body', mutated(full, full.length - 1), false);
      await expect('changed author', mutated(positive, 231), false);
      await expect('changed event ID', mutated(positive, 167), false);
      await expect('changed signature', mutated(positive, 69), false);
      const replacedKey = positive.slice(); replacedKey.set(other.publicKey, 4);
      await expect('changed public key', replacedKey, false);
      const wrongAuthor = positive.slice(); wrongAuthor.set(unhex(other.principal.slice(7)), 231);
      wrongAuthor.set(unhex((await host.digestBytes(codec(2, wrongAuthor))).slice(7)), 167);
      wrongAuthor.set(await host.signBytes(identity, context, codec(1, wrongAuthor)), 69);
      check(await host.verifyBytes(identity.publicKey, context, codec(1, wrongAuthor), codec(4, wrongAuthor)), 'wrong-author signature genuinely valid');
      await expect('valid signature cannot assert another author', wrongAuthor, false);
      const wrongId = mutated(positive, 167);
      check(await host.verifyBytes(identity.publicKey, context, codec(1, wrongId), codec(4, wrongId)), 'event ID omission is deliberate');
      await expect('signature alone cannot validate event ID', wrongId, false);
      const offCurve = positive.slice(); offCurve.fill(0, 5, 69);
      check(codec(0, offCurve).length === offCurve.length, 'opaque key syntax accepted without curve claim');
      await expect('actual key importer rejects off-curve point', offCurve, false);
      return {cases, calls, positive: hex(positive), maximum: hex(full)};
    }, {wasmBytes: Array.from(wasmBytes), template: vectors.find(value => value.id === 'RoundTripGenesis').request.slice(2), maximum: vectors.find(value => value.id === 'MaximumRoundTrip').request.slice(2)});
  });
  assert.deepEqual(result.cases, ['real P-256 genesis', 'real P-256 maximum body', 'wrong signing context',
    'changed body', 'changed author', 'changed event ID', 'changed signature', 'changed public key',
    'valid signature cannot assert another author', 'signature alone cannot validate event ID',
    'actual key importer rejects off-curve point']);
  for (const [input, expected] of result.calls) {
    assert.deepEqual(invoke(Buffer.from(input, 'hex')), Buffer.from(expected, 'hex'));
    const actual = run(join(nativeTarget, 'debug/browser-workspace-envelope-runner'), ['--query', input], runner).trim();
    assert.equal(actual, expected, 'independent generated native replay of browser crypto projection');
  }
  await t.test('real Chromium P-256: bounded envelopes and forged context, key, author, payload and ID rejection', () => {});
  t.diagnostic('browser crypto cases ' + result.cases.length + '; native/Wasm cross-checked generated extraction calls ' + result.calls.length);
  for (const [file, bytes] of sources) assert.deepEqual(readRegular(join(repository, 'stdlib/src/Foundation/Browser/V1', file)), bytes);
  verifyPins();
});
