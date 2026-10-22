import assert from 'node:assert/strict';
import {chmodSync, copyFileSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha} from '../browser-view/compile.mjs';
import {compilerInputPaths, captureCompilerInputs, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {mutateSources, mutationNames} from './mutations.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
export const modules = Object.freeze(['Fixture', 'Production.PublicationAdmission.LinkageV1',
  'Production.PublicationAdmission.LinkageV1Wire', 'Production.PublicationAdmission.V1',
  'Production.PublicationAdmission.V1Wire', 'Foundation.Bytes', 'Foundation.Codec',
  'Foundation.Codec.Cbor.V1.Primitive'].sort());
const modulePath = name => (name === 'Fixture' ? 'tests/publication-context-linkage' : 'stdlib')
  + '/src/' + name.replaceAll('.', '/') + '.lex.tex';
const witnesses = Object.freeze(['collector', 'partition', 'payload', 'bitset'].map(name => name + '_witnesses.rs'));

const capturedInputs = new WeakSet();
function read(path) {
  const absolute = join(repository, path), stat = lstatSync(absolute);
  assert.equal(realpathSync(absolute), absolute, 'unaliased publication linkage input ' + path);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 268435456,
    'bounded regular singly linked publication linkage input ' + path);
  return readFileSync(absolute);
}

export function frozenInputs() {
  pins();
  const files = new Set([...modules.map(modulePath),
    ...['compile.mjs', 'checks.mjs', 'capture-owner.mjs', 'capture-oracle.mjs', 'capture-guard.test.mjs', 'capture.test.mjs', 'owner.test.mjs', 'corpus.mjs', 'maximum-fixtures.mjs', 'mutations.mjs',
      'component.test.mjs', 'resources.test.mjs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs',
      'runner.rs', ...witnesses, 'context-fields-runner.rs', 'context-fields-corpus.mjs', 'execute.mjs', 'CONTRACT.md', 'CONTRACT.cddl'].map(path => 'tests/publication-context-linkage/' + path),
    'tests/publication-admission/corpus.mjs', 'tests/browser-view/compiler-component-binding.test.mjs',
    ...['compile.mjs', 'driver-cache.mjs', 'prerequisites.mjs', 'generated-package.mjs',
      'generated-wasm.mjs', 'verification-products.mjs'].map(path => 'tests/browser-view/' + path),
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/authorities.toml',
    'SPEC.md', 'model/ids.toml', 'features/suites/oci.feature',
    'crates/conformance/src/cases/mod.rs', 'crates/conformance/src/cases/node_suite.rs', 'crates/conformance/tests/conformance.rs',
    'model/dependencies.toml', 'rust-toolchain.toml', 'lean-toolchain', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'scripts/owning-node-reporter.mjs',
    'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256',
  ]);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    for (const line of read(tree + '/MANIFEST.sha256').toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      files.add(tree + '/' + row[2]);
    }
  }
  // Vendor manifests bind their complete tool trees; those trees contain test
  // modules that this owner never executes. Parse the actual owning ESM roots.
  const capturedModules = localModuleInputs(repository,
    ['tests/publication-context-linkage/owner.test.mjs', 'tests/publication-context-linkage/component.test.mjs', 'tests/publication-context-linkage/resources.test.mjs',
      'scripts/owning-node-reporter.mjs'], read);
  for (const path of capturedModules.keys()) files.add(path);
  for (const path of compilerInputPaths('publication-linkage')) files.add(path);
  const inputs = Object.fromEntries([...files].sort().map(path => [path, sha(read(path))]));
  for (const [path, bytes] of capturedModules) assert.equal(sha(bytes), inputs[path], 'actual parsed module snapshot ' + path);
  Object.freeze(inputs); capturedInputs.add(inputs); return inputs;
}

export function assertFrozenInputs(expected) {
  assert.ok(capturedInputs.has(expected), 'actual complete captured publication linkage inputs required');
  for (const [path, digest] of Object.entries(expected))
    assert.equal(sha(read(path)), digest, 'immutable captured publication linkage input ' + path);
}

function capturedInput(path, inputs) {
  const bytes = read(path);
  assert.equal(sha(bytes), inputs[path], 'frozen captured source/tool input ' + path);
  return bytes;
}

function assertCompilerSubset(compilerInputs, inputs) {
  for (const [path, digest] of Object.entries(compilerInputs))
    assert.equal(inputs[path], digest, 'actual compiler input belongs to complete publication linkage snapshot ' + path);
}
export function compilerInputs(inputs) {
  assertFrozenInputs(inputs);
  const captured = captureCompilerInputs('publication-linkage');
  assertCompilerSubset(captured, inputs);
  return captured;
}
function boundCompiler(owner, inputs) {
  assertFrozenInputs(inputs);
  const compiler = requireCompilerOwner(owner, 'publication-linkage');
  assertCompilerSubset(compiler.evidence.inputs, inputs);
  return compiler;
}

export function assertBaselineSources(actual, expected) {
  assert.ok(expected instanceof Map, 'actual positive source closure required before mutations');
  assert.deepEqual([...actual.keys()].sort(), [...expected.keys()].sort(), 'complete positive source module inventory');
  for (const [module, bytes] of actual) assert.deepEqual(bytes, expected.get(module), 'immutable positive source before mutation ' + module);
}

function pins() {
  const artifacts = read('model/dependencies.toml').toString('utf8')
    .split('[[dependency.artifact]]').slice(1).map(section => {
      const text = section.split('[[dependency]]')[0];
      return {path: /^path = "([^"]+)"$/m.exec(text)?.[1],
        hash: /^sha256 = "([0-9a-f]{64})"$/m.exec(text)?.[1],
        tree: /^tree_root = "([^"]+)"$/m.exec(text)?.[1]};
    });
  for (const name of ['vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256']) {
    const rows = artifacts.filter(row => row.path === name); assert.equal(rows.length, 1);
    const [{hash, tree}] = rows, bytes = read(name);
    assert.equal(sha(bytes), hash, name);
    if (!tree) continue;
    const seen = new Set();
    for (const line of bytes.toString('utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      const [, digest, path] = row;
      assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(path)); seen.add(path);
      assert.equal(sha(read(tree + '/' + path)), digest, path);
    }
  }
}

export const prepare = (compilerOwner, mutation = null, baseline = null, inputs = frozenInputs()) =>
  prepareStage(compilerOwner, mutation, baseline, inputs);
function prepareStage(compilerOwner, mutation, baseline, inputs) {
  const compiler = boundCompiler(compilerOwner, inputs);
  assert.ok(mutation === null || mutationNames.includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_PUBLICATION_LINKAGE_'), 'publication linkage acceptance refuses bypass ' + key);
  assertFrozenInputs(inputs);
  const work = mkdtempSync(join(tmpdir(), 'prismpm-publication-linkage-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, capturedInput(modulePath(name), inputs)]));
  const originals = new Map(sources);
  if (mutation !== null) assertBaselineSources(originals, baseline);
  let completed = false;
  try {
    if (mutation) mutateSources(sources, mutation);
    const project = join(work, 'project');
    for (const [module, bytes] of sources) {
      const destination = join(project, 'src', ...module.split('.')) + '.lex.tex';
      mkdirSync(dirname(destination), {recursive: true}); writeFileSync(destination, bytes, {flag: 'wx'});
    }
    const base = capturedInput('tests/fixtures/library/native-library/project/lexlean.toml', inputs).toString('utf8')
      .replace('name = "library-probe"', 'name = "publication-linkage-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    writeFileSync(join(project, 'lexlean.toml'), base, {flag: 'wx'});
    writeFileSync(join(project, 'lakefile.toml'), 'name = "publication_linkage_conformance"\nversion = "0.1.0"\n', {flag: 'wx'});
    writeFileSync(join(project, 'lean-toolchain'), capturedInput('lean-toolchain', inputs), {flag: 'wx'});
    writeFileSync(join(work, 'rust-toolchain.toml'), capturedInput('rust-toolchain.toml', inputs), {flag: 'wx'});
    const checked = JSON.parse(compiler.runDriver(['check', join(project, 'lexlean.toml')], work));
    assert.deepEqual(checked.modules, modules);
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
    writeFileSync(join(lean, 'lean-toolchain'), capturedInput('lean-toolchain', inputs), {flag: 'wx'});
    writeFileSync(join(lean, 'lakefile.toml'), 'name = "publication_linkage_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n', {flag: 'wx'});
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export');
    // Three existing source wrappers are private witness roots: production
    // traversals call their accumulator workers directly. SDK exports stay 66.
    const roots = ['PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkageCollectRows',
      'PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkageCollectIdChunks',
      'PrismPM.Production.PublicationAdmission.LinkageV1.publicationLinkageCollectServiceRows',
      'PrismPM.Production.PublicationAdmission.LinkageV1Wire.publicationContextFieldsWireBytes',
      'PrismPM.Production.PublicationAdmission.LinkageV1Wire.publicationLinkageWireBytes',
      'PrismPM.Production.PublicationAdmission.V1Wire.publicationContextFieldsPreimage',
      'PrismPM.Production.PublicationAdmission.V1Wire.publicationWireBytes'].sort();
    compiler.runExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'PublicationContextLinkage', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    const licenses = join(work, 'licenses'); mkdirSync(licenses);
    for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) writeFileSync(join(licenses, path), capturedInput(path, inputs), {flag: 'wx'});
    const generation = JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work));
    const generatedPackages = [captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256})];
    const wasmArtifacts = new Map();
    const runner = join(work, 'runner'); mkdirSync(join(runner, 'src'), {recursive: true});
    writeFileSync(join(runner, 'src/main.rs'), capturedInput('tests/publication-context-linkage/runner.rs', inputs), {flag: 'wx'});
    for (const path of witnesses)
      writeFileSync(join(runner, 'src', path), capturedInput('tests/publication-context-linkage/' + path, inputs), {flag:'wx'});
    writeFileSync(join(runner, 'Cargo.lock'), 'version = 4\n[[package]]\nname = "publication-context-linkage-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "publication-context-linkage-runner"\nversion = "0.1.0"\ndependencies = ["publication-context-linkage-core-probe"]\n', {flag: 'wx'});
    const contextRunner = join(work, 'context-fields-runner'); mkdirSync(join(contextRunner, 'src'), {recursive: true});
    writeFileSync(join(contextRunner, 'src/main.rs'), capturedInput('tests/publication-context-linkage/context-fields-runner.rs', inputs), {flag: 'wx'});
    copyFileSync(join(runner, 'Cargo.lock'), join(contextRunner, 'Cargo.lock'));
    const nativeBinaries = new Map();
    function checkedNative(record) {
      const stat = lstatSync(record.path);
      assert.equal(realpathSync(record.path), record.path, 'unaliased private native observer');
      assert.ok(stat.isFile() && stat.nlink === 1, 'regular singly linked private native observer');
      assert.equal(sha(readFileSync(record.path)), record.sha256, 'immutable actual native binary');
      return record.path;
    }
    function unchanged() {
      boundCompiler(compiler, inputs);
      for (const capturedPackage of generatedPackages) capturedPackage.verify();
      for (const record of nativeBinaries.values()) checkedNative(record);
      for (const owner of wasmArtifacts.values()) owner.verify();
      assert.equal(sha(readFileSync(join(runner, 'src/main.rs'))), inputs['tests/publication-context-linkage/runner.rs'], 'exact staged native observer');
      for (const path of witnesses)
        assert.equal(sha(readFileSync(join(runner, 'src', path))), inputs['tests/publication-context-linkage/' + path], 'exact staged semantic witness ' + path);
      assert.equal(sha(readFileSync(join(contextRunner, 'src/main.rs'))), inputs['tests/publication-context-linkage/context-fields-runner.rs'], 'exact staged typed context observer');
      assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      for (const [module, bytes] of sources) assert.deepEqual(readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex'), bytes);
      for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) assert.equal(sha(readFileSync(join(licenses, path))), inputs[path]);
    }
    function compileNative(standard, context = false) {
      unchanged();
      assert.equal(typeof context, 'boolean', 'closed native observer role');
      const mode = (context ? 'context-fields-' : '') + (standard ? 'std' : 'no_std'), previous = nativeBinaries.get(mode);
      const selectedRunner = context ? contextRunner : runner;
      if (previous) return checkedNative(previous);
      writeFileSync(join(selectedRunner, 'Cargo.toml'), '[package]\nname = "publication-context-linkage-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\npublication-context-linkage-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      const target = join(work, 'native-' + mode);
      try {run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(selectedRunner, 'Cargo.toml')], selectedRunner, {CARGO_TARGET_DIR: target});}
      finally {unchanged();}
      const path = join(work, 'native-' + mode + '-observer');
      writeFileSync(path, readFileSync(join(target, 'release/publication-context-linkage-runner')), {flag: 'wx', mode: 0o700});
      chmodSync(path, 0o700);
      const record = {path, sha256: sha(readFileSync(path))}; nativeBinaries.set(mode, record);
      return checkedNative(record);
    }
    function runNative(standard, arguments_, context = false) {
      const binary = compileNative(standard, context);
      try {return run(binary, arguments_, runner);}
      finally {checkedNative(nativeBinaries.get((context ? 'context-fields-' : '') + (standard ? 'std' : 'no_std')));}
    }
    function nativeEvidence() {
      return Object.fromEntries([...nativeBinaries].map(([mode, record]) => {checkedNative(record); return [mode, record.sha256];}));
    }
    // The baseline owns all roles. A mutant rebuilds only the affected roles;
    // each still has two independent generated packages, never a cached guest.
    const roles = mutation === null ? ['wasm', 'context-fields-wasm', 'admission-wasm']
      : mutation.startsWith('context-') ? ['context-fields-wasm', 'admission-wasm'] : ['wasm'];
    for (const mode of roles) for (const suffix of ['', '-repro']) {
      const label = mode + suffix, guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(compiler.runDriver([mode, ir, guest, licenses], work)), generation);
      const capturedPackage = captureGeneratedPackage(guest, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
      generatedPackages.push(capturedPackage); capturedPackage.verify();
      const target = join(work, 'guest-' + label + '-target');
      try {run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: target});}
      finally {capturedPackage.verify();}
      const artifact = captureGeneratedWasm(work,
        join(target, 'wasm32-unknown-unknown/release/publication_context_linkage_wire_probe.wasm'),
        'guest-' + label);
      wasmArtifacts.set(label, artifact);
      if (suffix) assert.deepEqual(artifact.bytes, wasmArtifacts.get(mode).bytes,
        'two independent generated Core-Wasm packages for ' + mode);
    }
    function withWasm(role, operation) {
      assert.ok(roles.includes(role), 'closed publication linkage guest role');
      return wasmArtifacts.get(role).run(operation);
    }
    async function withWasmAsync(role, operation) {
      assert.ok(roles.includes(role), 'closed publication linkage guest role');
      return wasmArtifacts.get(role).runAsync(operation);
    }
    function wasmEvidence() {
      return Object.freeze(Object.fromEntries([...wasmArtifacts].map(([role, owner]) => {
        owner.verify(); return [role, owner.evidence];
      })));
    }
    pins(); compiler.verify(); assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    assertFrozenInputs(inputs); compiler.verify();
    assert.equal(generation.ir_sha256, sha(readFileSync(ir)));
    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
    for (const [module, bytes] of sources) assert.deepEqual(readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex'), bytes, 'exact staged source after tool execution ' + module);
    for (const path of ['LICENSE-MIT', 'LICENSE-APACHE']) assert.equal(sha(readFileSync(join(licenses, path))), inputs[path], 'unchanged staged license');
    unchanged(); completed = true;
    return Object.freeze({work, sources, verified, generation, compileNative, runNative, nativeEvidence,
      unchanged, runner, withWasm, withWasmAsync, wasmEvidence, inputs, compilerOwner: compiler, compilerTools: compiler.evidence,
      generatedPackages: Object.freeze(generatedPackages.map(({directory, kind, files}) =>
        Object.freeze({path: directory.slice(work.length + 1), kind, files})))});

  } finally { if (!completed) process.stderr.write('Retained incomplete publication linkage diagnostic build ' + work + '\n'); }
}
