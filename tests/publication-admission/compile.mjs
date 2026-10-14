import assert from 'node:assert/strict';
import {copyFileSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha} from '../browser-view/compile.mjs';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
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
    'tests/browser-view/compiler-owner.mjs', 'tests/browser-view/compiler-artifact.mjs',
    'tests/browser-view/compiler-owner-checks.mjs',
    'tests/browser-view/verification-products.mjs',
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

export function prepare(mutation = null, inputs = frozenInputs(), compilerOwner = null) {
  const started = performance.now();
  assert.deepEqual(frozenInputs(), inputs, 'complete owning input closure changed before compilation');
  assert.ok([null, 'binding', 'coverage', 'timeline', 'trailing', 'preimage', 'partition'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_PUBLICATION_'), 'publication acceptance refuses bypass ' + key);
  pins();
  const work = mkdtempSync(join(tmpdir(), 'prismpm-publication-'));
  const sourcePath = name => join(repository, sourceRelative(name));
  const sources = new Map(modules.map(name => [name, readFileSync(sourcePath(name))]));
  const originals = new Map(sources);
  for (const [module, bytes] of originals) assert.equal(sha(bytes), inputs[sourceRelative(module)], 'captured original model differs from owner ' + module);
  const compiler = compilerOwner === null ? createCompilerOwner('publication', captureCompilerInputs('publication'))
    : requireCompilerOwner(compilerOwner, 'publication');
  for (const [path, digest] of Object.entries(compiler.evidence.inputs))
    assert.equal(inputs[path], digest, 'compiler tool closure differs from frozen publication owner');
  const ownsCompiler = compilerOwner === null;
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
    run('lake', ['update'], project);
    const verified = JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work));
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
    const exported = join(work, 'export');
    const roots = ['PrismPM.Production.PublicationAdmission.V1Wire.publicationWireBytes'];
    compiler.runExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserPublication', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const generation = JSON.parse(compiler.runDriver(['native', ir, generated, repository], work));
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
      assert.deepEqual(JSON.parse(compiler.runDriver([mode, ir, guest, repository], work)), generation);
      run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--release'], guest, {CARGO_TARGET_DIR: join(guest, 'target')});
      guests.push(readFileSync(join(guest, 'target/wasm32-unknown-unknown/release/publication_admission_' + 'wire' + '_probe.wasm')));
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    pins(); compiler.verify(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    pins(); compiler.verify(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'retained source ' + module);
    assert.deepEqual(frozenInputs(), inputs, 'complete owning input closure changed after compilation');
    const verifyEvidence = () => {
      assert.deepEqual(frozenInputs(), inputs, 'complete retained publication input closure');
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
      for (const [module, bytes] of originals)
        assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'retained model source ' + module);
    };
    // Borrowed tools stay live only in this serial owner. Every model/proof/IR
    // and generated std/no_std/two-Wasm build remains fresh and independent.
    const cacheRetirement = ownsCompiler ? compiler.close() : null;
    assert.deepEqual(frozenInputs(), inputs, 'complete publication inputs changed during compiler retirement');
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'post-retirement source ' + module);
    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
    verifyEvidence();
    completed = true;
    return {work, sources, verified, generation, compileNative, runner, wasmBytes: guests[0], cacheRetirement,
      verifyEvidence, preparationMs: performance.now() - started,
      compiler: {identity: compiler.identity, evidence: compiler.evidence}};
  } finally { if (!completed) process.stderr.write('Retained incomplete publication diagnostic build ' + work + '\n'); }
}
