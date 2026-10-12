import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha} from '../browser-view/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture',
  'Production.PublicationAdmission.V1', 'Production.PublicationAdmission.V1Wire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive'].sort();
const sourceRelative = name => (name === 'Fixture' ? 'tests/publication-admission' : 'stdlib')
  + '/src/' + name.replaceAll('.', '/') + '.lex.tex';

export function frozenInputs() {
  pins();
  const paths = new Set([
    ...modules.map(sourceRelative),
    ...['checks.mjs','corpus.mjs','compile.mjs','runner.rs','driver/Cargo.toml','driver/Cargo.lock',
      'driver/src/main.rs','owner.test.mjs'].map(path => 'tests/publication-admission/' + path),
    'tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/browser-view/prerequisites.mjs', 'sdk/browser/effects-module.mjs',
    'sdk/browser/effects-wire.mjs', 'sdk/browser/identity.mjs',
    'crates/prismpm/src/lifecycle.rs', 'model/publication-admission-diagnostics.json',
    'model/dependencies.toml', 'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml',
    'LICENSE-MIT', 'LICENSE-APACHE',
    'tests/fixtures/library/native-library/project/lexlean.toml',
    'vendor/lexlean/MANIFEST.sha256', 'vendor/lean4-prod/rust/MANIFEST.sha256',
    'vendor/lean4-prod/lean.tar',
  ]);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    for (const line of readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      paths.add(tree + '/' + row[2]);
    }
  }
  return Object.freeze(Object.fromEntries([...paths].sort().map(path => [path, sha(readFileSync(join(repository, path)))])));
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
      assert.equal(digest, inputs[tree + '/' + relative], 'captured vendor differs from owner ' + relative);
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
      captured.push({source, destination, digest});
    }
  }
  for (const relative of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
    const source = join(draft, 'driver', relative), destination = join(work, 'tests/publication-admission/driver', relative);
    const bytes = readFileSync(source), digest = sha(bytes);
    assert.equal(digest, inputs['tests/publication-admission/driver/' + relative], 'captured driver differs from owner ' + relative);
    mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    captured.push({source, destination, digest});
  }
  return {manifest: join(work, 'tests/publication-admission/driver/Cargo.toml'), unchanged() {
    for (const {source, destination, digest} of captured) {
      assert.equal(sha(readFileSync(source)), digest, 'frozen compiler source ' + source);
      assert.equal(sha(readFileSync(destination)), digest, 'frozen staged compiler ' + destination);
    }
  }};
}

export function prepare(mutation = null, inputs = frozenInputs()) {
  assert.deepEqual(frozenInputs(), inputs, 'complete owning input closure changed before compilation');
  assert.ok([null, 'binding', 'coverage', 'timeline', 'trailing', 'preimage', 'partition'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_PUBLICATION_'), 'publication acceptance refuses bypass ' + key);
  pins();
  const work = mkdtempSync(join(tmpdir(), 'prismpm-publication-'));
  const sourcePath = name => join(repository, sourceRelative(name));
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  for (const [module, bytes] of originals) assert.equal(sha(bytes), inputs[sourceRelative(module)], 'captured original model differs from owner ' + module);
  let completed = false;
  try {
    if (mutation) {
      const module = ['trailing','preimage','partition'].includes(mutation) ? 'Production.PublicationAdmission.V1Wire' : 'Production.PublicationAdmission.V1';
      const text = sources.get(module).toString('utf8'), matched = /\\semanticdata\{(.*)\}/.exec(text);
      const model = JSON.parse(matched[1]); let changed = 0;
      function walk(node) {
        if (!node || typeof node !== 'object') return;
        if (mutation === 'binding' && node.kind === 'call' && node.function.name === 'publicationPublicationContextEqual') {
          node.arguments[1] = structuredClone(node.arguments[0]); changed++; return;
        }
        if (mutation === 'coverage' && node.kind === 'call' && node.function.name === 'publicationFactsComplete') {
          Object.keys(node).forEach(key => delete node[key]); node.kind = 'bool'; node.value = true; changed++; return;
        }
        if (mutation === 'trailing' && node.kind === 'call' && node.function.name === 'finishCborCursor') {
          node.arguments[0] = {kind: 'record', type: {module: 'Foundation.Codec', name: 'BoundedCursor'}, fields: [
            {field: 'bytes', value: {kind: 'bytes', hex: ''}}, {field: 'offset', value: {kind: 'nat', value: '0'}}, {field: 'limit', value: {kind: 'nat', value: '0'}},
          ]}; changed++; return;
        }
        if (mutation === 'timeline' && node.kind === 'ble' && node.left.kind === 'project' && node.left.field === 'authorizedAt' && node.right.kind === 'project' && node.right.field === 'observed') {
          node.left = {kind:'nat',value:'0'}; changed++; return;
        }
        if (mutation === 'preimage' && node.kind === 'project' && node.field === 'instance') {
          Object.keys(node).forEach(key => delete node[key]); node.kind='bytes';node.hex='00'.repeat(32);changed++;return;
        }
        if (mutation === 'partition' && node.kind === 'nat' && node.value === '64') {
          node.value='63';changed++;return;
        }
        for (const value of Object.values(node)) if (Array.isArray(value)) value.forEach(walk); else walk(value);
      }
      const selected = {binding: 'publicationTransition', coverage: 'publicationTransition', timeline: 'publicationTransition', trailing: 'dispatchPublicationWire', preimage:'publicationContextPreimage', partition:'readPublicationWirePublicationObligationsGroups'}[mutation];
      const declarations = model.declarations.filter(row => row.name === selected);
      assert.equal(declarations.length, 1); declarations.forEach(walk);
      assert.equal(changed, {binding:1,coverage:2,timeline:1,trailing:5,preimage:1,partition:4}[mutation], 'exact production guard mutation');
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
      .replace('name = "library-probe"', 'name = "publication-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "publication_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    copyFileSync(join(repository, 'lean-toolchain'), join(project, 'lean-toolchain'));
    copyFileSync(join(repository, 'rust-toolchain.toml'), join(work, 'rust-toolchain.toml'));
    const driverTarget = join(work, 'driver-target');
    const compiler = stageCompiler(work, inputs);
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', compiler.manifest], work, {CARGO_TARGET_DIR: driverTarget});
    const driver = join(driverTarget, 'debug/publication-admission-driver');
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
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "publication_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const exporter = join(work, 'exporter'); mkdirSync(exporter);
    run('tar', ['-xf', join(repository, 'vendor/lean4-prod/lean.tar'), '-C', exporter], repository);
    run('lake', ['build', 'prod-export'], exporter);
    const exported = join(work, 'export');
    const roots = ['PrismPM.Production.PublicationAdmission.V1Wire.publicationWireBytes'];
    run(join(exporter, '.lake/build/bin/prod-export'), ['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserPublication', '--out', exported], exporter, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(run(driver, ['native', ir, generated, repository], repository));
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    copyFileSync(join(draft, 'runner.rs'), join(runner, 'src/main.rs'));
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "publication-admission-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "publication-admission-runner"\nversion = "0.1.0"\ndependencies = ["publication-admission-core-probe"]\n', {flag: 'wx'});
    function compileNative(standard) {
      writeFileSync(join(runner, 'Cargo.toml'), '[package]\nname = "publication-admission-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\npublication-admission-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: join(work, 'native-target')});
      return join(work, 'native-target/release/publication-admission-runner');
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(run(driver, [mode, ir, guest, repository], repository)), generation);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/publication_admission_' + 'wire' + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    pins(); compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    const cacheRetirement = retireCompletedCompilerCaches(work, 'publication');
    pins(); compiler.unchanged(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'retained source ' + module);
    assert.deepEqual(frozenInputs(), inputs, 'complete owning input closure changed after compilation');
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, wasmBytes: guests[0], cacheRetirement};
  } finally { if (!completed) process.stderr.write('Retained incomplete publication diagnostic build ' + work + '\n'); }
}
