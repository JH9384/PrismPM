import { readSemantic, writeSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha, stageLeanRuntime, ownedAttestations} from '../browser-view/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
import {compilerInputPaths, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {lexiconPaths} from '../browser-view/lexicon-inputs.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture','Foundation.Browser.Application.V1.Budget','Foundation.Browser.Application.V1.Effects','Foundation.Browser.Application.V1.EffectsWire','Foundation.Browser.Application.V1.Custody','Foundation.Bytes','Foundation.Codec','Foundation.Codec.Cbor.V1.Primitive'].sort();
const modulePath = name => (name === 'Fixture' ? 'tests/browser-budget' : 'stdlib') + '/src/' + name.replaceAll('.', '/') + '.lex.tex';

export function frozenInputs() {
  pins();
  const files = new Set([
    ...modules.map(modulePath),
    ...['checks.mjs','corpus.mjs','compile.mjs','fallback-owner.test.mjs','runner.rs','driver/Cargo.toml','driver/Cargo.lock','driver/src/main.rs'].map(path=>'tests/browser-budget/'+path),
    'sdk/browser/budget-model-test.mjs','sdk/browser/effects-module.mjs','sdk/browser/effects-wire.mjs','sdk/browser/identity.mjs',
    'crates/prismpm/src/holo/browser_application.rs',
    'tests/browser-view/compile.mjs','tests/browser-view/driver-cache.mjs','tests/browser-view/prerequisites.mjs',
    'tests/browser-view/compiler-owner.mjs','tests/browser-view/compiler-artifact.mjs','tests/browser-view/compiler-owner-checks.mjs',
    'tests/browser-view/verification-products.mjs',
    ...lexiconPaths(repository), 'tests/fixtures/library/native-library/project/lexlean.toml',
    'model/dependencies.toml','model/authorities.toml','lean-toolchain','rust-toolchain.toml','LICENSE-MIT','LICENSE-APACHE',
    'vendor/lean4-prod/lean.tar','vendor/lean4-prod/rust/MANIFEST.sha256','vendor/lexlean/MANIFEST.sha256',
  ]);
  for (const tree of ['vendor/lexlean','vendor/lean4-prod/rust']) {
    for (const line of readFileSync(join(repository,tree,'MANIFEST.sha256'),'utf8').trimEnd().split('\n')) {
      const row=/^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line);assert.ok(row);
      files.add(tree+'/'+row[2]);
    }
  }
  for (const path of compilerInputPaths('budget')) files.add(path);
  return Object.freeze(Object.fromEntries([...files].sort().map(path=>[path,sha(readFileSync(join(repository,path)))])));
}

export function assertFrozenInputs(expected) {
  assert.deepEqual(frozenInputs(),expected,'complete frozen budget owner inputs');
}

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

function stageCompiler(work, inputs) {
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
      assert.equal(digest,inputs[tree+'/'+relative],'frozen staged vendor input');
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
      captured.push({source, destination, digest});
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/browser-budget/driver', relative);
    const bytes = readFileSync(source), digest = sha(bytes);
    assert.equal(digest,inputs['tests/browser-budget/driver/'+relative],'frozen staged driver input');
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/browser-budget/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export function prepare(mutation, inputs, compilerOwner = null) {
  const started = performance.now();
  assert.ok([null,'identity','policy','manifest','request','coverage','order','limit'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_BUDGET_'), 'budget acceptance refuses bypass ' + key);
  assertFrozenInputs(inputs);
  const shared = compilerOwner === null ? null : requireCompilerOwner(compilerOwner, 'budget');
  if (shared) for (const [path, digest] of Object.entries(shared.evidence.inputs))
    assert.equal(inputs[path], digest, 'compiler tool closure differs from frozen budget inputs');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-budget-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  for (const [module, bytes] of originals) assert.equal(sha(bytes),inputs[modulePath(module)],'frozen captured original source '+module);
  let completed = false;
  try {
    if (mutation) {
      const module='Foundation.Browser.Application.V1.Budget', text=sources.get(module).toString('utf8');
      const model=readSemantic(text); let changed=0;
      const selected={identity:'effectBudgetFitsManifest',policy:'effectiveRequestFits',manifest:'effectBudgetFitsManifest',request:'effectiveRequestFits',coverage:'effectBudgetFitsManifest',order:'budgetRowsFit',limit:'budgetOperationFits'}[mutation];
      function walk(value) {
        if(!value||typeof value!=='object')return;
        const match=(mutation==='identity'&&value.kind==='primitive'&&value.operation==='equal'&&value.arguments[0]?.field==='application'&&value.arguments[1]?.field==='application')
          ||(mutation==='policy'&&value.kind==='primitive'&&value.operation==='equal'&&value.arguments[0]?.field==='requestedPolicy')
          ||(mutation==='manifest'&&value.kind==='call'&&value.function.name==='effectManifestValid')
          ||(mutation==='request'&&value.kind==='call'&&value.function.name==='effectRequestValid')
          ||(mutation==='coverage'&&value.kind==='call'&&value.function.name==='budgetRowsFit')
          ||(mutation==='order'&&value.kind==='call'&&value.function.name==='custodyTextLess')
          ||(mutation==='limit'&&value.kind==='ble');
        if(match){const original=structuredClone(value);for(const key of Object.keys(value))delete value[key];Object.assign(value,{kind:'or',left:original,right:{kind:'bool',value:true}});changed++;return;}
        for(const child of Object.values(value))if(Array.isArray(child))child.forEach(walk);else walk(child);
      }
      const declarations=model.declarations.filter(row=>row.name===selected);assert.equal(declarations.length,1);declarations.forEach(walk);
      assert.equal(changed,mutation==='limit'?5:1,'exact production guard mutation');
      const canonical=value=>Array.isArray(value)?value.map(canonical):value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
      sources.set(module,Buffer.from(writeSemantic(text, canonical(model))));
    }
    const project = join(work, 'project');
    for (const path of lexiconPaths(repository)) {
      const destination = join(project, path);
      mkdirSync(dirname(destination), {recursive: true});
      writeFileSync(destination, readFileSync(join(repository, path)), {flag: 'wx'});
    }
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = readFileSync(join(repository, 'tests/fixtures/library/native-library/project/lexlean.toml'), 'utf8')
      .replace('name = "library-probe"', 'name = "budget-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "budget_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    copyFileSync(join(repository, 'lean-toolchain'), join(project, 'lean-toolchain'));
    copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
    let compiler, invokeDriver;
    if (shared) invokeDriver = args => shared.runDriver(args, repository);
    else {
      const driverTarget = join(work, 'driver-target');
      compiler = stageCompiler(work, inputs);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
        '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
      const driver = join(driverTarget, 'debug/browser-budget-driver');
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
      const semantic = readSemantic(bytes.toString('utf8'));
      return semantic.declarations.map(declaration => ['PrismPM.' + module + '.' + declaration.name,
        {kind: declaration.axioms?.length ? 'exact' : 'none', axioms: declaration.axioms ?? []}]);
    }));
    assert.equal(ownedAttestations(attestation).length, expected.size);
    for (const audit of ownedAttestations(attestation)) {
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
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "budget_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + stageLeanRuntime(verified, lean) + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const exporter = join(work, 'exporter');
    if (!shared) {
      mkdirSync(exporter);
      run('tar', ['-xf', join(repository, 'vendor/lean4-prod/lean.tar'), '-C', exporter], repository);
      run('lake', ['build', 'prod-export'], exporter);
    }
    const invokeExporter = args => shared ? shared.runExporter(args, join(lean, '.lake/build/lib/lean'))
      : run(join(exporter, '.lake/build/bin/prod-export'), args, exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const exported = join(work, 'export');
    const roots = ['PrismPM.Fixture.budgetProbeBytes'];
    invokeExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserBudget', '--out', exported]);
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(invokeDriver(['native', ir, generated, repository]));
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    copyFileSync(join(draft, 'runner.rs'), join(runner, 'src/main.rs'));
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-budget-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-budget-runner"\nversion = "0.1.0"\ndependencies = ["browser-budget-core-probe"]\n', {flag: 'wx'});
    function compileNative(standard) {
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-budget-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-budget-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: join(work, 'native-target')});
      return join(work, 'native-target/release/browser-budget-runner');
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(invokeDriver([mode, ir, guest, repository])), generation);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/browser_budget_' + 'wire' + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    pins(); if (shared) shared.verify(); else compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    // Completed private tool caches only; source, proof, IR and outputs remain.
    const cacheRetirement = shared ? null : retireCompletedCompilerCaches(work, 'budget');
    if (shared) shared.verify(); else compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    assertFrozenInputs(inputs);
    const verifyEvidence = () => {
      assertFrozenInputs(inputs);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
      for (const [module, bytes] of originals)
        assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'retained model source ' + module);
    };
    verifyEvidence();
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, wasmBytes: guests[0], cacheRetirement,
      compilerOwner: shared?.identity ?? null, preparationMs: performance.now() - started, verifyEvidence};
  } finally { if (!completed) process.stderr.write('Retained incomplete budget diagnostic build ' + work + '\n'); }
}
