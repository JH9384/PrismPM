import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {createPrivateDriverTarget, ensureProdExport, run, sha} from '../browser-view/compile.mjs';
export {ensureProdExport, run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture', 'Foundation.View.Browser.V1.Model',
  'Foundation.View.Browser.V1.Wire', 'Foundation.Bytes',
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
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/browser-presentation/driver', relative);
    const bytes = readFileSync(source), digest = sha(bytes);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/browser-presentation/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export const checkSource = () => prepareStage(null, true);
export const prepare = (mutation = null) => prepareStage(mutation, false);
function prepareStage(mutation, sourceOnly) {
  assert.ok([null, 'binding', 'trailing', 'secretbound', 'secretroute', 'progress'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_PRESENTATION_'), 'presentation acceptance refuses bypass ' + key);
  pins();
  const work = mkdtempSync(join(tmpdir(), 'prismpm-presentation-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  let completed = false;
  try {
    if (mutation) {
      const name = mutation === 'trailing' ? 'Foundation.View.Browser.V1.Wire' : 'Foundation.View.Browser.V1.Model';
      const text = sources.get(name).toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text);
      const model = JSON.parse(matched[1]);
      if (mutation === 'binding') {
        const target = model.declarations.find(row => row.name === 'bindingValid');
        const step = target?.body.branches.find(row => row.constructor.name === 'List.cons').body;
        assert.equal(step?.kind, 'and'); assert.equal(step.left.kind, 'match');
        // Bypass the actual per-field check while preserving the recursive
        // declaration and used bindings required by the source/kernel policy.
        step.left = {kind: 'or', left: step.left, right: {kind: 'bool', value: true}};
      } else if (mutation === 'secretbound') {
        const target = model.declarations.find(row => row.name === 'fieldValueFits');
        const branch = target.body.branches.find(row => row.constructor.name === 'Content.SecretInput');
        assert.equal(branch.body.kind, 'match');
        branch.body = {kind: 'or', left: branch.body, right: {kind: 'bool', value: true}};
      } else if (mutation === 'secretroute') {
        const target = model.declarations.find(row => row.name === 'intentRequiresSecret');
        assert.equal(target.body.kind, 'and');
        target.body = {kind: 'and', left: target.body, right: {kind: 'bool', value: false}};
      } else if (mutation === 'progress') {
        const target = model.declarations.find(row => row.name === 'progressFits');
        assert.equal(target.body.kind, 'and');
        target.body = {kind: 'or', left: target.body, right: {kind: 'bool', value: true}};
      } else {
        const target = model.declarations.find(row => row.name === 'viewWireParse');
        let changed = 0;
        function walk(value) {
          if (!value || typeof value !== 'object') return;
          if (value.kind === 'beq' && value.right?.kind === 'primitive' && value.right.operation === 'length') {
            Object.keys(value).forEach(key => delete value[key]);
            Object.assign(value, {kind: 'bool', value: true}); changed++; return;
          }
          Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(walk) : walk(child));
        }
        walk(target); assert.equal(changed, 2);
      }
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      sources.set(name, Buffer.from(text.replace(matched[0], '\\semanticdata{' + JSON.stringify(canonical(model)) + '}')));
    }
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = readFileSync(join(repository, 'tests/fixtures/library/native-library/project/lexlean.toml'), 'utf8')
      .replace('name = "library-probe"', 'name = "presentation-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "presentation_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    copyFileSync(join(repository, 'lean-toolchain'), join(project, 'lean-toolchain'));
    copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
    const driverTarget = createPrivateDriverTarget(work);
    const compiler = stageCompiler(work);
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
    const driver = join(driverTarget, 'debug/browser-presentation-driver');
    const checked = JSON.parse(run(driver, ['check', join(project, 'lexlean.toml')], repository));
    assert.deepEqual(checked.modules, modules);
    if (sourceOnly) {
      compiler.unchanged();
      for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
      completed = true; return {work, checked, sourceOnly: true};
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
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "presentation_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const {dir: exporter, bin: prodExport} = ensureProdExport(repository, work);
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.View.Browser.V1.Wire.viewWireBytes', ...[
      'fixturePresentationBytes', 'fixtureLabelsBytes', 'fixtureIntentFitsBytes',
      'fixtureSecretPresentationBytes', 'fixtureSecretRouteBytes', 'fixtureSecretSinkBytes',
      'fixtureSecretMaximumRouteBytes', 'fixtureSecretMaximumSinkBytes', 'fixtureSecretMaximumFieldBytes',
      'fixtureSecretMaximumPresentationBytes',
      'fixtureProgressFitsBytes',
      'fixtureProgressMaximumBytes',
    ].map(name => 'PrismPM.Fixture.' + name)].sort();
    run(prodExport, ['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserPresentation', '--out', exported], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(run(driver, ['native', ir, generated, repository], repository));
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    copyFileSync(join(draft, 'runner.rs'), join(runner, 'src/main.rs'));
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "browser-presentation-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-presentation-runner"\nversion = "0.1.0"\ndependencies = ["browser-presentation-core-probe"]\n', {flag: 'wx'});
    function compileNative(standard) {
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "browser-presentation-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-presentation-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: join(work, 'native-target')});
      return join(work, 'native-target/release/browser-presentation-runner');
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm'], ['fixture', 'fixture'], ['labels', 'labels'], ['intent', 'intent'],
      ['secret', 'secret'], ['route', 'route'], ['sink', 'sink'],
      ['maxroute', 'maxroute'], ['maxsink', 'maxsink'], ['maxfield', 'maxfield'], ['maxsecret', 'maxsecret'], ['progress', 'progress'], ['maxprogress', 'maxprogress']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(run(driver, [mode, ir, guest, repository], repository)), generation);
      run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/browser_presentation_' + (mode === 'wasm' ? 'wire' : mode) + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    pins(); compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, wasmBytes: guests[0], fixtureBytes: guests[2], labelsBytes: guests[3], intentBytes: guests[4],
      secretBytes: guests[5], routeBytes: guests[6], sinkBytes: guests[7],
      maxrouteBytes: guests[8], maxsinkBytes: guests[9], maxfieldBytes: guests[10], maxsecretBytes: guests[11], progressBytes: guests[12], maxprogressBytes: guests[13]};
  } finally { if (!completed) process.stderr.write('Retained incomplete presentation diagnostic build ' + work + '\n'); }
}
