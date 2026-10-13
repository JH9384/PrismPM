import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {createPrivateDriverTarget, ensureProdExport, run, sha} from '../browser-view/compile.mjs';
import {requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
export {ensureProdExport, run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture', 'Foundation.Browser.Application.V1.Effects',
  'Foundation.Browser.Application.V1.EffectsWire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive'].sort();

function pins() {
  const artifacts = readFileSync(join(repository, 'model/dependencies.toml'), 'utf8')
    .split('[[dependency.artifact]]').slice(1).map(section => {
      const text = section.split('[[dependency]]')[0];
      return {path: /^path = "([^"]+)"$/m.exec(text)?.[1],
        hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],
        tree: /^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
    });
  for (const name of ['vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256']) {
    const rows = artifacts.filter(row => row.path === name); assert.equal(rows.length, 1);
    const [{hash, tree}] = rows, bytes = readFileSync(join(repository, name));
    assert.equal(sha(bytes), hash, name);
    if (!tree) continue;
    const seen = new Set();
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      const [, digest, path] = row;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(path)); seen.add(path);
      assert.equal(sha(readFileSync(join(repository, tree, path))), digest, path);
    }
  }
}

function stageCompiler(work) {
  // Cargo resolves inherited workspace lint/dependency policy while loading
  // path dependencies. Keep each pinned vendor workspace intact, outside any
  // containing checkout/worktree workspace; do not override its policy.
  const captured = [];
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const entries = readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n');
    for (const entry of entries) {
      const [, digest, relative] = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(entry);
      const source = join(repository, tree, relative), destination = join(work, tree, relative);
      const bytes = readFileSync(source); assert.equal(sha(bytes), digest);
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
      captured.push({source, destination, digest});
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/browser-effects/driver', relative);
    const bytes = readFileSync(source), digest = sha(bytes);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/browser-effects/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export function prepare(mutation = null, compilerOwner = null) {
  const started = performance.now();
  assert.ok([null, 'binding', 'trailing', 'unknown'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_EFFECT_'), 'effects acceptance refuses bypass ' + key);
  pins();
  const shared = compilerOwner === null ? null : requireCompilerOwner(compilerOwner, 'effects');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-effects-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  let completed = false;
  try {
    if (mutation) {
      const module = mutation === 'trailing' ? 'Foundation.Browser.Application.V1.EffectsWire' : 'Foundation.Browser.Application.V1.Effects';
      const text = sources.get(module).toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text);
      const model = JSON.parse(matched[1]); let changed = 0;
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (mutation === 'binding' && node.kind === 'call' && node.function.name === 'effectRequestEqual') {
          node.function.name = 'effectRequestEqual';
          node.arguments[1] = structuredClone(node.arguments[0]); changed++; return;
        }
        if (mutation === 'trailing' && node.kind === 'call' && node.function.name === 'finishCborCursor') {
          node.arguments[0] = {kind: 'record', type: {module: 'Foundation.Codec', name: 'BoundedCursor'}, fields: [
            {field: 'bytes', value: {kind: 'bytes', hex: ''}}, {field: 'offset', value: {kind: 'nat', value: '0'}}, {field: 'limit', value: {kind: 'nat', value: '0'}},
          ]}; changed++; return;
        }
        if (mutation === 'unknown' && node.kind === 'record' && node.type.name === 'EffectSession') {
          const uncertain = node.fields.find(field => field.field === 'uncertain');
          if (uncertain?.value.kind === 'bool' && uncertain.value.value) { uncertain.value.value = false; changed++; }
        }
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
      }
      const declarations = model.declarations.filter(row => mutation === 'binding' ? row.name === 'completeEffect' : mutation === 'unknown' ? row.name === 'completeEffect' : row.name === 'dispatchEffectWire');
      assert.equal(declarations.length, 1); declarations.forEach(walk);
      assert.equal(changed, mutation === 'trailing' ? 4 : 1, 'exact production guard mutation');
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      sources.set(module, Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}')));
    }
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = readFileSync(join(repository, 'tests/fixtures/library/native-library/project/lexlean.toml'), 'utf8')
      .replace('name = "library-probe"', 'name = "effects-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "effects_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    copyFileSync(join(repository, 'lean-toolchain'), join(project, 'lean-toolchain'));
    copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
    let compiler, invokeDriver;
    if (shared) invokeDriver = args => shared.runDriver(args, repository);
    else {
      const driverTarget = createPrivateDriverTarget(work);
      compiler = stageCompiler(work);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
      const driver = join(driverTarget, 'debug/browser-effects-driver');
      invokeDriver = args => run(driver, args, repository);
    }
    run('lake', ['update'], project);
    const verified = JSON.parse(invokeDriver(['verify', join(project, 'lexlean.toml')]));
    assert.deepEqual(verified.modules, modules);
    const manifestBytes = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
    const attestation = JSON.parse(attestationBytes);
    assert.equal(attestation.status, 'verified');
    assert.equal(attestation.build_manifest.sha256, sha(manifestBytes));
    assert.equal(attestation.attestation_id, verified.attestation_id);
    const expected = new Map([...sources].flatMap(([module, bytes]) => {
      const semantic = JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1]);
      return semantic.declarations.map(declaration => ['PrismPM.' + module + '.' + declaration.name,
        {kind: declaration.axioms?.length ? 'exact' : 'none', axioms: declaration.axioms ?? []}]);
    }));
    assert.equal(attestation.declarations.length, expected.size);
    for (const audit of attestation.declarations) {
      assert.equal(audit.result, 'ok'); assert.ok(expected.has(audit.name));
      const policy = expected.get(audit.name); assert.deepEqual(audit.policy, policy);
      assert.deepEqual(audit.observed, policy.axioms); expected.delete(audit.name);
    }
    assert.equal(expected.size, 0);
    const lean = join(work, 'lean'); mkdirSync(lean);
    for (const module of modules) {
      const relative = join('PrismPM', ...module.split('.')) + '.lean', destination = join(lean, relative);
      mkdirSync(dirname(destination), {recursive: true}); copyFileSync(join(verified.root, 'modules', relative), destination);
    }
    copyFileSync(join(repository, 'lean-toolchain'), join(lean, 'lean-toolchain'));
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "effects_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const exporter = shared ? null : ensureProdExport(repository, work);
    const invokeExporter = args => shared ? shared.runExporter(args, join(lean, '.lake/build/lib/lean'))
      : run(exporter.bin, args, exporter.dir, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.Browser.Application.V1.EffectsWire.effectWireBytes', 'PrismPM.Fixture.fixtureEchoBytes'].sort();
    invokeExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserEffects', '--out', exported]);
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(invokeDriver(['native', ir, generated, repository]));
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    copyFileSync(join(draft, 'runner.rs'), join(runner, 'src/main.rs'));
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-effects-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-effects-runner"\nversion = "0.1.0"\ndependencies = ["browser-effects-core-probe"]\n', {flag: 'wx'});
    function compileNative(standard) {
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-effects-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-effects-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: join(work, 'native-target')});
      return join(work, 'native-target/release/browser-effects-runner');
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm'], ['echo', 'guest']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(invokeDriver([mode, ir, guest, repository])), generation);
      run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/browser_effects_' + (mode === 'guest' ? 'guest' : 'wire') + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    pins(); if (shared) shared.verify(); else compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    const verifyEvidence = () => {
      pins();
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
      for (const [module, bytes] of originals)
        assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'retained model source ' + module);
    };
    verifyEvidence();
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, compilerOwner: shared?.identity ?? null, preparationMs: performance.now() - started, verifyEvidence, wasmBytes: guests[0], guestBytes: guests[2]};
  } finally { if (!completed) process.stderr.write('Retained incomplete effects diagnostic build ' + work + '\n'); }
}
