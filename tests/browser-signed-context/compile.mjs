// Private test orchestration; no host implementation of modeled transitions.
import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, sha, stageLeanRuntime, ownedAttestations} from '../browser-view/compile.mjs';
import {compilerInputPaths, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {captureCompilerArtifact, requireCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {captureFile, capturedFile} from '../browser-view/file-custody.mjs';
import {mutateSignedContextSource} from './mutations.mjs';
import {lexiconPaths} from '../browser-view/lexicon-inputs.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const projection = 'Foundation.Browser.Application.V1.SignedContextWire';
const modulePath = name => 'stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex';
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
  add(projection);
  return new Map([...sources].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0));
}
export function frozenInputs() {
  const files = new Set([...sourceClosure().keys()].map(modulePath));
  for (const path of ['compile.mjs', 'checks.mjs', 'corpus.mjs', 'corpus.test.mjs', 'bridge.test.mjs',
    'mutations.mjs', 'wpt.mjs', 'wpt.test.mjs', 'aggregate.test.mjs', 'browser.mjs', 'owner.test.mjs',
    'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'])
    files.add('tests/browser-signed-context/' + path);
  for (const path of ['tests/browser-view/compiler-owner.test.mjs', 'tests/browser-view/compiler-artifact.test.mjs',
    'tests/browser-view/compiler-artifact-mutations.test.mjs', 'tests/browser-view/generated-package.test.mjs',
    'sdk/browser/signed-context.mjs', 'sdk/browser/signed-context-test.mjs',
    ...lexiconPaths(repository), 'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml',
    'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json', 'vendor/lean4-prod/lean.tar']) files.add(path);
  const wpt = 'sdk/browser/oracles/wpt-ecdsa/';
  // Imported authoritative point sources are data, not static JS import edges.
  for (const path of ['PKV.rsp.base64', 'ACVP-KeyVer-FIPS186-5.json.base64'])
    files.add('tests/browser-p256/oracles/' + path);
  files.add(wpt + 'source.json');
  for (const row of JSON.parse(read(wpt + 'source.json')).files) {
    assert.ok(typeof row.path === 'string' && /^[A-Za-z0-9_./-]+$/.test(row.path)
      && !row.path.split('/').some(part => part === '' || part === '.' || part === '..'));
    assert.equal(sha(read(wpt + row.path)), row.sha256); files.add(wpt + row.path);
  }
  const capturedModules = localModuleInputs(repository, [...files].filter(path => path.endsWith('.mjs')), read);
  for (const path of capturedModules.keys()) files.add(path);
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
  for (const path of compilerInputPaths('signed-context')) files.add(path);
  const captures = new Map([...files].sort().map(path => [path, captureFile(join(repository, path))]));
  const inputs = Object.fromEntries([...captures].map(([path, row]) => [path, row.evidence.sha256]));
  for (const [path, bytes] of capturedModules) assert.equal(sha(bytes), inputs[path], 'actual parsed module snapshot ' + path);
  Object.freeze(inputs); capturedInputs.set(inputs, new Map([...captures].map(([path, row]) => [path, row.evidence]))); return inputs;
}
export function verifyFrozenInputs(inputs) {
  const captured = capturedInputs.get(inputs);
  assert.ok(captured && Object.isFrozen(inputs), 'actual complete captured signed-context inputs required');
  // The complete static graph was parsed during capture. Every original file
  // remains checked on every use: changed import edges necessarily change one
  // of these bytes. Do not reparse an identical graph in child Node processes.
  assert.deepEqual(inputs, Object.fromEntries([...captured].map(([path, evidence]) => [path, evidence.sha256])),
    'complete captured signed-context source inventory');
  for (const [path, evidence] of captured) capturedFile(join(repository, path), evidence);
}
export function assertCapturedSignedContextSources(inputs, sources) {
  assert.deepEqual([...sources.keys()].map(modulePath).sort(),
    Object.keys(inputs).filter(path => path.endsWith('.lex.tex') && !path.startsWith('vendor/')).sort(),
    'complete captured source module inventory');
  for (const [name, bytes] of sources) assert.equal(sha(bytes), inputs[modulePath(name)],
    'actual captured source must match original snapshot ' + name);
}
export function assertSignedContextCompilerInputs(compilerOwner, inputs) {
  const compiler = requireCompilerOwner(compilerOwner, 'signed-context');
  for (const [path, digest] of Object.entries(compiler.evidence.inputs))
    assert.equal(inputs[path], digest, 'signed-context owner and model share the exact captured compiler input ' + path);
  return compiler;
}
export function prepareSignedContext(compilerOwner, mutationId = null, expectedInputs = null) {
  const startedAt = performance.now();
  for (const name of Object.keys(process.env)) assert.ok(!name.startsWith('PRISMPM_SIGNED_CONTEXT_'), 'no owner bypass');
  const inputs = frozenInputs(), sources = sourceClosure();
  if (expectedInputs) assert.deepEqual(inputs, expectedInputs, 'one immutable complete owner closure');
  const compiler = assertSignedContextCompilerInputs(compilerOwner, inputs);
  assertCapturedSignedContextSources(inputs, sources);
  const mutation = mutationId === null ? null : mutateSignedContextSource(sources, mutationId);
  const captured = path => { const bytes = read(path); assert.equal(sha(bytes), inputs[path], 'frozen input ' + path); return bytes; };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-signed-context-'));
  const staged = new Map();
  function stage(path, bytes) {
    const destination = join(work, path); mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, bytes, {flag: 'wx'}); staged.set(path, sha(bytes)); return destination;
  }
  let complete = false;
  try {
    stage('rust-toolchain.toml', captured('rust-toolchain.toml'));
    // Only compiler tools are reused. This new model project, kernel evidence,
    // generated Lean/IR/native/two Wasm packages are rebuilt for every mutation.
    for (const [name, bytes] of sources) stage('project/src/' + name.replaceAll('.', '/') + '.lex.tex', bytes);
    const project = join(work, 'project');
    for (const path of lexiconPaths(repository)) stage('project/' + path, captured(path));
    stage('project/lexlean.toml', captured('tests/fixtures/library/native-library/project/lexlean.toml').toString('utf8')
      .replace('name = "library-probe"', 'name = "signed-context-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/' + projection.replaceAll('.', '/') + '.lex.tex'));
    stage('project/lean-toolchain', captured('lean-toolchain'));
    stage('project/lakefile.toml', 'name = "signed_context_conformance"\nversion = "0.1.0"\n');
    run('lake', ['update'], project);
    const verified = JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work));
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
    for (const name of sources.keys()) {
      const relative = 'PrismPM/' + name.replaceAll('.', '/') + '.lean';
      stage('lean/' + relative, readFileSync(join(verified.root, 'modules', relative)));
    }
    const lean = join(work, 'lean');
    stage('lean/lean-toolchain', captured('lean-toolchain'));
    stage('lean/lakefile.toml', 'name = "signed_context"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['
      + stageLeanRuntime(verified, lean) + [...sources.keys()].map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export'), roots = ['PrismPM.' + projection + '.signedContextWireBytes'];
    compiler.runExporter(['--module', 'PrismPM.' + projection, ...roots.flatMap(name => ['--root', name]),
      '--ir-module', 'SignedContext', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const ir = join(exported, 'kernel.ir'), generated = join(work, 'generated');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, captured(name));
    const licenses = join(work, 'licenses');
    const generation = JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work));
    const nativePackage = captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256});
    const packages = new Map([['native', nativePackage]]);
    const wasm = {}, wasmOwners = {}, wasmArtifacts = {};
    for (const entry of ['signed-context']) {
      const guests = [];
      for (const label of ['a', 'b']) {
        const output = join(work, entry + '-' + label);
        assert.deepEqual(JSON.parse(compiler.runDriver([entry, ir, output, licenses], work)), generation);
        const package_ = captureGeneratedPackage(output, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
        packages.set(entry + '-' + label, package_); package_.verify();
        const target = join(work, 'wasm-target-' + entry + '-' + label);
        try {run('cargo', ['build', '--locked', '--offline', '--release'], output, {CARGO_TARGET_DIR: target});}
        finally {package_.verify();}
        const artifact = captureGeneratedWasm(work,
          join(target, 'wasm32-unknown-unknown/release/browser_signed_context_wire_probe.wasm'), entry + '-' + label + '-execution');
        wasmArtifacts[entry + '-' + label] = artifact; guests.push(artifact);
      }
      assert.deepEqual(guests[0].bytes, guests[1].bytes, 'two independent complete generated ' + entry + ' packages');
      wasm[entry] = guests[0].bytes; wasmOwners[entry] = guests[0];
    }
    Object.freeze(wasm); Object.freeze(wasmOwners); Object.freeze(wasmArtifacts);
    const generatedWasm = Object.freeze(Object.fromEntries(Object.entries(wasmArtifacts).map(([name, owner]) => [name, owner.evidence])));
    const nativePrograms = new Map();
    function checkedNative(record) {
      return requireCompilerArtifact(record).path;
    }
    function compileNative(standard) {
      nativePackage.verify();
      if (nativePrograms.has(standard)) return checkedNative(nativePrograms.get(standard));
      const name = standard ? 'std' : 'no-std', runner = join(work, 'runner-' + name);
      stage('runner-' + name + '/src/main.rs', captured('tests/browser-signed-context/runner.rs'));
      stage('runner-' + name + '/Cargo.toml', '[package]\nname = "browser-signed-context-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-signed-context-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + name + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-signed-context-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-signed-context-runner"\nversion = "0.1.0"\ndependencies = ["browser-signed-context-core-probe"]\n');
      run('cargo', ['build', '--locked', '--offline', '--release'], runner, {CARGO_TARGET_DIR: join(runner, 'target')});
      nativePackage.verify();
      // Bind the genuine Cargo output and its distinct private execution copy.
      const record = captureCompilerArtifact(work, join(runner, 'target/release/browser-signed-context-runner'), 'signed-context-native-' + name);
      nativePrograms.set(standard, record); return checkedNative(record);
    }
    function runNative(standard, arguments_) {
      compileNative(standard); unchanged();
      try {return nativePrograms.get(standard).run(arguments_, work);}
      finally {unchanged();}
    }
    function nativeEvidence() {
      return Object.fromEntries([...nativePrograms].map(([standard, record]) => {
        checkedNative(record); return [standard ? 'std' : 'no-std', record.evidence.private.sha256];
      }));
    }
    function nativeArtifactEvidence() {
      return Object.freeze(Object.fromEntries([...nativePrograms].map(([standard, record]) => {
        checkedNative(record); return [standard ? 'std' : 'no-std', record.evidence];
      })));
    }
    function unchanged() {
      assertSignedContextCompilerInputs(compiler, inputs);
      for (const package_ of packages.values()) package_.verify();
      for (const artifact of Object.values(wasmArtifacts)) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      verifyFrozenInputs(inputs);
      for (const [path, digest] of staged) assert.equal(sha(readFileSync(join(work, path))), digest, 'immutable captured input ' + path);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), buildManifest);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
    }
    unchanged();
    complete = true;
    const generatedPackages = Object.freeze(Object.fromEntries([...packages].map(([name, package_]) => {
      assert.ok(Object.isFrozen(package_.files), 'immutable captured package file map');
      return [name, package_.files];
    })));
    return Object.freeze({work, sources, verified, generation, wasm, wasmOwners, wasmArtifacts, generatedWasm,
      compileNative, runNative, nativeEvidence, nativeArtifactEvidence, unchanged, inputs, mutation, generatedPackages,
      compilerOwner: compiler, compilerTools: compiler.evidence, preparationMs: performance.now() - startedAt});
  } finally { if (!complete) process.stderr.write('Retained incomplete signed-context diagnostic build ' + work + '\n'); }
}
