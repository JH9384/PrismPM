// Private test orchestration; no host implementation of modeled transitions.
import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, sha, stageLeanRuntime, ownedAttestations} from '../browser-view/compile.mjs';
import {compilerInputPaths, createCompilerOwner, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {captureCompilerArtifact, requireCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {captureFile, capturedFile} from '../browser-view/file-custody.mjs';
import {captureKernelProvenance} from '../browser-view/kernel-provenance.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {mutateProjectionSource} from '../browser-session-journal/projection-mutations.mjs';
import {lexiconPaths} from '../browser-view/lexicon-inputs.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
export const roles = Object.freeze(['predecessor', 'session', 'observation', 'partition', 'descriptor']);
const modulePath = name => (name === 'Fixture' ? 'tests/browser-session-operation' : 'stdlib') + '/src/' + name.replaceAll('.', '/') + '.lex.tex';
const freeze = value => {if (value && typeof value === 'object') {Object.values(value).forEach(freeze); Object.freeze(value);} return value;};
const capturedInputs = new WeakMap();
function read(path) {
  return captureFile(join(repository, path)).bytes;
}
export function sourceClosure() {
  const sources = new Map();
  function add(name) {
    if (sources.has(name)) return;
    const bytes = read(modulePath(name)); sources.set(name, bytes);
    for (const match of bytes.toString('utf8').matchAll(/\\importmodule\{([^}]+)\}/g)) add(match[1]);
  }
  add('Fixture');
  return new Map([...sources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
export function frozenInputs() {
  const files = new Set([...sourceClosure().keys()].map(modulePath));
  for (const path of [...readdirSync(draft).filter(path => path.endsWith('.mjs')), 'src/Fixture.lex.tex', 'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'])
    files.add('tests/browser-session-operation/' + path);
  for (const path of ['tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/browser-view/kernel-provenance.test.mjs', 'tests/browser-view/local-module-inputs.test.mjs',
    'tests/browser-view/file-custody.test.mjs',
    'scripts/owning-node-reporter.mjs', 'scripts/semantic-source.mjs', 'crates/conformance/src/bin/prismpm-semantic-source.rs', 'crates/conformance/src/cases/node_suite.rs',
    'tests/browser-session/wire.mjs', 'tests/browser-session/corpus.mjs',
    'tests/browser-session/maxima.mjs', 'tests/browser-session/budget.mjs',
    'sdk/browser/session-operation-capture.mjs', 'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'sdk/browser/effects-wire.mjs', 'sdk/browser/effects-module.mjs', 'sdk/browser/presentation-wire.mjs',
    ...lexiconPaths(repository), 'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml',
    'model/ids.toml', 'features/suites/sdk.feature', 'crates/conformance/src/cases/mod.rs',
    'crates/conformance/src/cases/scheduling.rs', 'crates/conformance/tests/conformance.rs',
    'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE',
    'vendor/lean4-prod/lean.tar']) files.add(path);
  // Capture transitive static imports, not only the visible entry filenames.
  // In particular, the independent session corpus imports the effect corpus.
  const modules = localModuleInputs(repository, [...files].filter(path => path.endsWith('.mjs')), read);
  for (const path of modules.keys()) files.add(path);
  const dependencies = read('model/dependencies.toml').toString('utf8').split('[[dependency.artifact]]').slice(1);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const path = tree + '/MANIFEST.sha256', manifest = read(path);
    const rows = dependencies.filter(section => section.split('[[dependency]]')[0].includes('path = "' + path + '"'));
    assert.equal(rows.length, 1, 'one exact compiler registration');
    assert.equal(sha(manifest), /^sha256 = "([a-f0-9]{64})"$/m.exec(rows[0])[1]); files.add(path);
    const seen = new Set();
    for (const line of manifest.toString('utf8').trimEnd().split('\n')) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(match);
      const [, digest, relative] = match;
      assert.ok(!relative.startsWith('/') && !relative.split('/').some(part => !part || part === '.' || part === '..'));
      assert.ok(!seen.has(relative)); seen.add(relative);
      const input = tree + '/' + relative; assert.equal(sha(read(input)), digest); files.add(input);
    }
  }
  for (const path of compilerInputPaths('session-operation')) files.add(path);
  const captures = new Map([...files].sort().map(path => [path, captureFile(join(repository, path))]));
  const inputs = Object.freeze(Object.fromEntries([...captures].map(([path, row]) => [path, row.evidence.sha256])));
  for (const [path, bytes] of modules) assert.equal(sha(bytes), inputs[path], 'captured static module ' + path);
  capturedInputs.set(inputs, new Map([...captures].map(([path, row]) => [path, row.evidence])));
  return inputs;
}
export function verifyFrozenInputs(inputs) {
  const captured = capturedInputs.get(inputs);
  assert.ok(captured && Object.isFrozen(inputs), 'actual complete captured operation inputs required');
  assert.deepEqual(inputs, Object.fromEntries([...captured].map(([path, row]) => [path, row.sha256])),
    'complete captured operation source inventory');
  for (const [path, evidence] of captured) capturedFile(join(repository, path), evidence);
}
export function assertCapturedOperationSources(inputs, sources) {
  assert.deepEqual([...sources.keys()].map(modulePath).sort(),
    Object.keys(inputs).filter(path => (path.startsWith('stdlib/src/') || path === 'tests/browser-session-operation/src/Fixture.lex.tex') && path.endsWith('.lex.tex')).sort(),
    'complete captured source module inventory');
  for (const [name, bytes] of sources) assert.equal(sha(bytes), inputs[modulePath(name)],
    'actual captured source must match original snapshot ' + name);
}
export function assertOperationCompilerInputs(owner, inputs) {
  const compiler = requireCompilerOwner(owner, 'session-operation');
  for (const [path, digest] of Object.entries(compiler.evidence.inputs))
    assert.equal(inputs[path], digest, 'operation owner and model share the exact captured compiler input ' + path);
  return compiler;
}
export function createOperationCompiler(inputs = frozenInputs()) {
  verifyFrozenInputs(inputs);
  const compiler = createCompilerOwner('session-operation');
  try {return assertOperationCompilerInputs(compiler, inputs);}
  catch (error) {compiler.close(); throw error;}
}
export function prepareOperation(compilerOwner, expectedInputs, mutationId = null) {
  for (const name of Object.keys(process.env)) assert.ok(!name.startsWith('PRISMPM_SESSION_OPERATION_'), 'no owner bypass');
  const inputs = frozenInputs(), sources = sourceClosure();
  assert.deepEqual(inputs, expectedInputs, 'one immutable complete operation owner closure');
  const compiler = assertOperationCompilerInputs(compilerOwner, inputs);
  assertCapturedOperationSources(inputs, sources);
  const originals = new Map(sources);
  const mutation = mutationId === null ? null : mutateProjectionSource(sources, mutationId);
  const captured = path => { const bytes = read(path); assert.equal(sha(bytes), inputs[path], 'frozen input ' + path); return bytes; };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-session-operation-'));
  const staged = new Map();
  function stage(path, bytes) {
    const destination = join(work, path); mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, bytes, {flag: 'wx'}); staged.set(path, sha(bytes)); return destination;
  }
  let complete = false;
  try {
    stage('rust-toolchain.toml', captured('rust-toolchain.toml'));
    for (const [name, bytes] of sources) stage('project/src/' + name.replaceAll('.', '/') + '.lex.tex', bytes);
    const project = join(work, 'project');
    for (const path of lexiconPaths(repository)) stage('project/' + path, captured(path));
    stage('project/lexlean.toml', captured('tests/fixtures/library/native-library/project/lexlean.toml').toString('utf8')
      .replace('name = "library-probe"', 'name = "session-operation-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex'));
    stage('project/lean-toolchain', captured('lean-toolchain'));
    stage('project/lakefile.toml', 'name = "session_operation_conformance"\nversion = "0.1.0"\n');
    run('lake', ['update'], project);
    const verified = freeze(JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work)));
    assert.deepEqual(verified.modules, [...sources.keys()]);
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
    const buildManifest = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestation = JSON.parse(attestationBytes);
    assert.equal(attestation.status, 'verified'); assert.equal(attestation.attestation_id, verified.attestation_id);
    assert.equal(attestation.build_manifest.sha256, sha(buildManifest));
    const expected = new Map([...sources].flatMap(([name, bytes]) => {
      const data = readSemantic(bytes.toString('utf8'));
      return data.declarations.map(declaration => ['PrismPM.' + name + '.' + declaration.name, declaration.axioms ?? []]);
    }));
    assert.equal(ownedAttestations(attestation).length, expected.size);
    for (const declaration of ownedAttestations(attestation)) {
      assert.ok(expected.has(declaration.name)); const axioms = expected.get(declaration.name);
      assert.equal(declaration.result, 'ok'); assert.deepEqual(declaration.policy, {kind: axioms.length ? 'exact' : 'none', axioms});
      assert.deepEqual(declaration.observed, axioms); expected.delete(declaration.name);
    }
    assert.equal(expected.size, 0);
    const leanPath = name => 'PrismPM/' + name.replaceAll('.', '/') + '.lean';
    const lean = join(work, 'lean');
    function readLean(root) {
      return new Map([...sources.keys()].map(name => {
        const path = join(root, leanPath(name));
        assert.equal(realpathSync(path), path); assert.ok(lstatSync(path).isFile() && lstatSync(path).nlink === 1);
        return [name, readFileSync(path)];
      }));
    }
    const provenance = captureKernelProvenance([...sources.keys()], {verified, sources,
      manifestBytes: buildManifest, attestationBytes, generated: readLean(join(verified.root, 'modules'))});
    for (const name of sources.keys()) stage('lean/' + leanPath(name), provenance.generatedBytes(name));
    stage('lean/lean-toolchain', captured('lean-toolchain'));
    stage('lean/lakefile.toml', 'name = "journal_projection"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['
      + stageLeanRuntime(verified, lean) + [...sources.keys()].map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export'), roots = ['Predecessor', 'Session', 'Observation', 'Partition', 'Descriptor']
      .map(name => 'PrismPM.Fixture.operation' + name + 'Bytes').sort();
    compiler.runExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(name => ['--root', name]),
      '--ir-module', 'SessionOperationCapture', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const ir = join(exported, 'kernel.ir'), generated = join(work, 'generated');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, captured(name));
    const licenses = join(work, 'licenses');
    const generation = freeze(JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work)));
    const generatedPackages = [captureGeneratedPackage(generated,
      {kind: 'native', inputIrSha256: generation.ir_sha256})];
    const wasm = {}, wasmOwners = {}, wasmArtifacts = {};
    for (const entry of mutation ? [mutation.entry] : roles) {
      const guests = [];
      for (const label of ['a', 'b']) {
        const output = join(work, entry + '-' + label);
        assert.deepEqual(JSON.parse(compiler.runDriver([entry, ir, output, licenses], work)), generation);
        const capturedPackage = captureGeneratedPackage(output, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
        generatedPackages.push(capturedPackage); capturedPackage.verify();
        const target = join(work, entry + '-' + label + '-target');
        try {run('cargo', ['build', '--locked', '--offline', '--release'], output, {CARGO_TARGET_DIR: target});}
        finally {capturedPackage.verify();}
        const artifact = captureGeneratedWasm(work,
          join(target, 'wasm32-unknown-unknown/release/browser_session_operation_wire_probe.wasm'), entry + '-' + label + '-execution');
        wasmArtifacts[entry + '-' + label] = artifact; guests.push(artifact);
      }
      assert.deepEqual(guests[0].bytes, guests[1].bytes, 'two independent complete generated ' + entry + ' packages');
      wasm[entry] = guests[0].bytes; wasmOwners[entry] = guests[0];
    }
    Object.freeze(wasm); Object.freeze(wasmOwners); Object.freeze(wasmArtifacts);
    const generatedWasm = Object.freeze(Object.fromEntries(Object.entries(wasmArtifacts).map(([name, owner]) => [name, owner.evidence])));
    const nativePrograms = new Map();
    function checkedNative(record) {return requireCompilerArtifact(record).path;}
    function compileNative(standard) {
      assert.equal(typeof standard, 'boolean');
      // Once compiled, execution consumes only the exact original/private ELF.
      // Full source/package custody remains mandatory around compilation and
      // at every owning phase boundary; never bypass the cached ELF guard.
      if (nativePrograms.has(standard)) return checkedNative(nativePrograms.get(standard));
      unchanged();
      const name = standard ? 'std' : 'no-std', runner = join(work, 'runner-' + name);
      stage('runner-' + name + '/src/main.rs', captured('tests/browser-session-operation/runner.rs'));
      stage('runner-' + name + '/Cargo.toml', '[package]\nname = "browser-session-operation-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-session-operation-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + name + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-session-operation-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-session-operation-runner"\nversion = "0.1.0"\ndependencies = ["browser-session-operation-core-probe"]\n');
      try {run('cargo', ['build', '--locked', '--offline', '--release'], runner, {CARGO_TARGET_DIR: join(runner, 'target')});}
      finally {for (const capturedPackage of generatedPackages) capturedPackage.verify();}
      const record = captureCompilerArtifact(work,
        join(runner, 'target/release/browser-session-operation-runner'), 'native-' + name);
      nativePrograms.set(standard, record); return checkedNative(record);
    }
    function runNative(standard, args) {
      const binary = compileNative(standard);
      try { return run(binary, args, work); }
      finally { checkedNative(nativePrograms.get(standard)); }
    }
    function nativeEvidence() {
      return Object.fromEntries([...nativePrograms].map(([standard, record]) => {
        checkedNative(record); return [standard ? 'std' : 'no-std', record.evidence];
      }));
    }
    function unchanged() {
      assertOperationCompilerInputs(compiler, inputs);
      for (const capturedPackage of generatedPackages) capturedPackage.verify();
      for (const artifact of Object.values(wasmArtifacts)) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      verifyFrozenInputs(inputs);
      for (const [path, digest] of staged) assert.equal(sha(readFileSync(join(work, path))), digest, 'immutable captured input ' + path);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), buildManifest);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
      provenance.verify({verified, sources: new Map([...sources.keys()].map(name => [name,
        readFileSync(join(project, 'src', name.replaceAll('.', '/') + '.lex.tex'))])),
        manifestBytes: readFileSync(join(verified.root, 'build-manifest.json')),
        attestationBytes: readFileSync(join(verified.root, 'attestation.json')),
        generated: readLean(join(verified.root, 'modules')), staged: readLean(lean)});
      for (const [name, bytes] of originals) assert.deepEqual(read(modulePath(name)), bytes);
    }
    unchanged();
    complete = true;
    return Object.freeze({work, sources, verified, generation, wasm, wasmOwners, wasmArtifacts, generatedWasm,
      compileNative, runNative, nativeEvidence, unchanged, inputs, mutation, provenance: provenance.evidence, compiler: compiler.evidence,
      generatedPackages: freeze(generatedPackages.map(({directory, kind, files}) => ({path: directory.slice(work.length + 1), kind, files})))});
  } finally { if (!complete) process.stderr.write('Retained incomplete session-operation diagnostic build ' + work + '\n'); }
}
