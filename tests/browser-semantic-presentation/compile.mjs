import { readSemantic, writeSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {createPrivateDriverTarget, ensureProdExport, run, sha} from '../browser-view/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
export {ensureProdExport, run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
export const modules = Object.freeze(['Fixture', 'Foundation.View.Browser.V1.Model',
  'Foundation.View.Browser.V1.Wire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive',
  'Foundation.View.Browser.V1.Design', 'Foundation.View.Browser.V1.DesignWire',
  'Foundation.View.Browser.V1.Semantics', 'Foundation.View.Browser.V1.SemanticsWire'].sort());
const modulePath = name => (name === 'Fixture' ? 'tests/browser-semantic-presentation' : 'stdlib')
  + '/src/' + name.replaceAll('.', '/') + '.lex.tex';

export function frozenInputs() {
  pins();
  const files = new Set([...modules.map(modulePath),
    ...['compile.mjs', 'check-source.mjs', 'checks.mjs', 'corpus.mjs', 'maximum-fixtures.mjs',
      'browser.mjs', 'wire.test.mjs', 'dom.test.mjs', 'driver/Cargo.toml', 'driver/Cargo.lock',
      'driver/src/main.rs', 'runner.rs'].map(path => 'tests/browser-semantic-presentation/' + path),
    ...readdirSync(join(repository, 'sdk/browser')).filter(path => path.endsWith('.mjs')).map(path => 'sdk/browser/' + path),
    ...['compile.mjs', 'checks.mjs', 'corpus.mjs', 'maximum-fixtures.mjs',
      'provenance.mjs', 'fixture-files.mjs'].map(path => 'tests/browser-presentation/' + path),
    ...['compile.mjs', 'driver-cache.mjs', 'prerequisites.mjs', 'generated-package.mjs',
      'generated-package.test.mjs', 'file-custody.mjs', 'compiler-owner.mjs',
      'compiler-artifact.mjs', 'compiler-owner-checks.mjs', 'generated-wasm.mjs']
      .map(path => 'tests/browser-view/' + path),
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/authorities.toml',
    'model/dependencies.toml', 'rust-toolchain.toml', 'lean-toolchain', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'model/browser-semantic-presentation-oracles.json', 'model/browser-semantic-presentation-diagnostics.json',
    'scripts/browser-api-sdk-check.mjs', 'sdk/account-genesis-artifact.mjs', 'scripts/owning-node-reporter.mjs', 'scripts/semantic-source.mjs', 'crates/conformance/src/bin/prismpm-semantic-source.rs',
    'scripts/sdk-command-owner.mjs', 'scripts/sdk-command-owner.py',
    'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256',
  ]);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    for (const line of readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      files.add(tree + '/' + row[2]);
    }
  }
  return Object.freeze(Object.fromEntries([...files].sort().map(path => [path, sha(readFileSync(join(repository, path)))])));
}

export function assertFrozenInputs(expected) {
  assert.deepEqual(frozenInputs(), expected, 'complete frozen semantic presentation owner inputs');
}

function capturedInput(path, inputs) {
  const bytes = readFileSync(join(repository, path));
  assert.equal(sha(bytes), inputs[path], 'frozen captured source/tool input ' + path);
  return bytes;
}

export function assertBaselineSources(actual, expected) {
  assert.ok(expected instanceof Map, 'actual positive source closure required before mutations');
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'complete positive source module inventory');
  for (const [module, bytes] of actual) assert.deepEqual(bytes, expected.get(module), 'immutable positive source before mutation ' + module);
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
      const bytes = capturedInput(tree + '/' + relative, inputs); assert.equal(sha(bytes), digest);
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
      captured.push({source, destination, digest});
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/browser-semantic-presentation/driver', relative);
    const bytes = capturedInput('tests/browser-semantic-presentation/driver/' + relative, inputs), digest = sha(bytes);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/browser-semantic-presentation/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export const checkSource = () => prepareStage(null, true, null, frozenInputs());
export const prepare = (mutation = null, baseline = null, inputs = frozenInputs()) => prepareStage(mutation, false, baseline, inputs);
function prepareStage(mutation, sourceOnly, baseline, inputs) {
  assert.ok([null, 'purpose', 'main', 'trailing', 'design', 'catalogue'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_SEMANTIC_PRESENTATION_'), 'presentation acceptance refuses bypass ' + key);
  assertFrozenInputs(inputs);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-semantic-presentation-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, capturedInput(modulePath(name), inputs)]));
  const originals = new Map(sources);
  if (mutation !== null) assertBaselineSources(originals, baseline);
  let completed = false;
  try {
    if (mutation) {
      const name = 'Foundation.View.Browser.V1.' + (mutation === 'trailing' ? 'SemanticsWire' : mutation === 'design' ? 'Design' : 'Semantics');
      const text = sources.get(name).toString('utf8'), matched = [text, JSON.stringify(readSemantic(text))];
      const model = JSON.parse(matched[1]);
      if (mutation === 'trailing') {
        const target = model.declarations.find(row => row.name === 'semanticWireParse');
        let changed = 0;
        function walk(value) {
          if (!value || typeof value !== 'object') return;
          if (value.kind === 'beq' && value.right?.kind === 'primitive' && value.right.operation === 'length') {
            Object.keys(value).forEach(key => delete value[key]);
            Object.assign(value, {kind: 'bool', value: true}); changed++; return;
          }
          Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(walk) : walk(child));
        }
        walk(target); assert.equal(changed, 1);
      } else {
        const target = model.declarations.find(row => row.name === ({purpose: 'purposeFits',
          main: 'semanticPresentationValid', design: 'designTokensValid', catalogue: 'semanticCatalogueFits'}[mutation]));
        assert.ok(target?.body);
        target.body = {kind: 'or', left: target.body, right: {kind: 'bool', value: true}};
      }
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      sources.set(name, Buffer.from(writeSemantic(text, canonical(model))));
    }
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = capturedInput('tests/fixtures/library/native-library/project/lexlean.toml', inputs).toString('utf8')
      .replace('name = "library-probe"', 'name = "presentation-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "presentation_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    writeFileSync(join(project, 'lean-toolchain'), capturedInput('lean-toolchain', inputs), {flag: 'wx'});
    writeFileSync(join(work, 'rust-toolchain.toml'), capturedInput('rust-toolchain.toml', inputs), {flag: 'wx'});
    const driverTarget = createPrivateDriverTarget(work);
    const compiler = stageCompiler(work, inputs);
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
    const driver = join(driverTarget, 'debug/browser-semantic-presentation-driver');
    const checked = JSON.parse(run(driver, ['check', join(project, 'lexlean.toml')], repository));
    assert.deepEqual(checked.modules, modules);
    if (sourceOnly) {
      compiler.unchanged();
      for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
      assertFrozenInputs(inputs);
      completed = true; return {work, checked, sourceOnly: true, inputs};
    }
    run('lake', ['update'], project);
    const verified = JSON.parse(run(driver, ['verify', join(project, 'lexlean.toml')], repository));
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
    writeFileSync(join(lean, 'lean-toolchain'), capturedInput('lean-toolchain', inputs), {flag: 'wx'});
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "presentation_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
    assert.equal(sha(readFileSync(join(exporter, '.source-lean.tar'))), inputs['vendor/lean4-prod/lean.tar'], 'frozen actual exporter source archive');
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.View.Browser.V1.SemanticsWire.semanticWireBytes', ...[
      'fixturePresentationBytes', 'fixtureLabelsBytes', 'fixtureDesignsBytes', 'fixturePredicatesBytes',
    ].map(name => 'PrismPM.Fixture.' + name)].sort();
    run(prodExport, ['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserPresentation', '--out', exported], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const licenses = join(work, 'licenses'); mkdirSync(licenses);
    for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) writeFileSync(join(licenses, path), capturedInput(path, inputs), {flag: 'wx'});
    const generation = JSON.parse(run(driver, ['native', ir, generated, licenses], repository));
    const generatedPackages = [captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256})];
    const wasmArtifacts = new Map();
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    writeFileSync(join(runner, 'src/main.rs'), capturedInput('tests/browser-semantic-presentation/runner.rs', inputs), {flag: 'wx'});
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-semantic-presentation-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-semantic-presentation-runner"\nversion = "0.1.0"\ndependencies = ["browser-semantic-presentation-core-probe"]\n', {flag: 'wx'});
    const nativeBinaries = new Map();
    function checkedNative(record) {
      const stat = lstatSync(record.path);
      assert.equal(realpathSync(record.path), record.path, 'unaliased private native observer');
      assert.ok(stat.isFile() && stat.nlink === 1, 'regular singly linked private native observer');
      assert.equal(sha(readFileSync(record.path)), record.sha256, 'immutable actual native binary');
      return record.path;
    }
    function unchanged() {
      assertFrozenInputs(inputs); compiler.unchanged();
      for (const capturedPackage of generatedPackages) capturedPackage.verify();
      for (const record of nativeBinaries.values()) checkedNative(record);
      for (const owner of wasmArtifacts.values()) owner.verify();
      assert.equal(sha(readFileSync(join(runner, 'src/main.rs'))), inputs['tests/browser-semantic-presentation/runner.rs'], 'exact staged native observer');
      assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      for (const [module, bytes] of sources) assert.deepEqual(readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex'), bytes);
      for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) assert.equal(sha(readFileSync(join(licenses, path))), inputs[path]);
      assert.equal(sha(readFileSync(join(exporter, '.source-lean.tar'))), inputs['vendor/lean4-prod/lean.tar']);
    }
    function compileNative(standard) {
      unchanged();
      const mode = standard ? 'std' : 'no_std', previous = nativeBinaries.get(mode);
      if (previous) return checkedNative(previous);
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-semantic-presentation-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-semantic-presentation-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      const target = join(work, 'native-' + mode);
      try {run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: target});}
      finally {unchanged();}
      const path = join(work, 'native-' + mode + '-observer');
      writeFileSync(path, readFileSync(join(target, 'release/browser-semantic-presentation-runner')), {flag: 'wx', mode: 0o700});
      chmodSync(path, 0o700);
      const record = {path, sha256: sha(readFileSync(path))}; nativeBinaries.set(mode, record);
      return checkedNative(record);
    }
    function runNative(standard, arguments_) {
      const binary = compileNative(standard);
      try {return run(binary, arguments_, runner);}
      finally {checkedNative(nativeBinaries.get(standard ? 'std' : 'no_std'));}
    }
    function nativeEvidence() {
      return Object.fromEntries([...nativeBinaries].map(([mode, record]) => {checkedNative(record); return [mode, record.sha256];}));
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm'], ['fixture', 'fixture'], ['labels', 'labels'], ['designs', 'designs'], ['predicates', 'predicates']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(run(driver, [mode, ir, guest, licenses], repository)), generation);
      const capturedPackage = captureGeneratedPackage(guest, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
      generatedPackages.push(capturedPackage); capturedPackage.verify();
      const target = join(work, 'guest-' + label + '-target');
      try {run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: target});}
      finally {capturedPackage.verify();}
      const artifact = captureGeneratedWasm(work,
        join(target, 'wasm32-unknown-unknown/release/browser_semantic_presentation_' + (mode === 'wasm' ? 'wire' : mode) + '_probe.wasm'),
        'guest-' + label);
      wasmArtifacts.set(label, artifact); guests.push(artifact.bytes);
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    function withWasm(role, operation) {
      assert.ok(wasmArtifacts.has(role), 'closed semantic presentation guest role');
      return wasmArtifacts.get(role).run(operation);
    }
    function wasmEvidence() {
      return Object.freeze(Object.fromEntries([...wasmArtifacts].map(([role, owner]) => {
        owner.verify(); return [role, owner.evidence];
      })));
    }
    pins(); compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    const cacheRetirement = retireCompletedCompilerCaches(work, 'semantic-presentation');
    assertFrozenInputs(inputs); compiler.unchanged();
    assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
    for (const [module, bytes] of sources) assert.deepEqual(readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex'), bytes, 'exact staged source after tool execution ' + module);
    for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) assert.equal(sha(readFileSync(join(licenses, path))), inputs[path], 'unchanged staged license');
    assert.equal(sha(readFileSync(join(exporter, '.source-lean.tar'))), inputs['vendor/lean4-prod/lean.tar'], 'unchanged actual exporter archive');
    unchanged(); completed = true;
    // Evidence accumulation is mutable; compiled inputs, selected artifacts and
    // their guards are not. Byte mutation is additionally rejected by each
    // captured owner before/after consumption and by unchanged().
    const fixed = {work, sources, verified, generation, compileNative, runNative, nativeEvidence,
      unchanged, runner, withWasm, wasmEvidence, wasmBytes: guests[0], fixtureBytes: guests[2],
      labelsBytes: guests[3], designsBytes: guests[4], predicatesBytes: guests[5], cacheRetirement, inputs,
      generatedPackages: Object.freeze(generatedPackages.map(({directory, kind, files}) =>
        Object.freeze({path: directory.slice(work.length + 1), kind, files})))};
    return Object.seal(Object.defineProperties({complete: false, artifactSubstitutions: null, maximum: null, maxima: null,
      evidenceDirectory: null, positiveArchive: null, mutationEvidence: null,
      browserEvidence: null, browserMutationEvidence: null}, Object.fromEntries(
      Object.entries(fixed).map(([name, value]) => [name,
        {value, enumerable: true, writable: false, configurable: false}]))));
  } finally { if (!completed) process.stderr.write('Retained incomplete presentation diagnostic build ' + work + '\n'); }
}
