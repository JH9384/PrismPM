// Private test orchestration; no host implementation of modeled transitions.
import assert from 'node:assert/strict';
import {mkdirSync, mkdtempSync, readFileSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {run, sha} from '../browser-view/compile.mjs';
import {compilerInputPaths, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {captureCompilerArtifact, requireCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {captureFile, capturedFile} from '../browser-view/file-custody.mjs';
import {mutateP256Source} from './mutations.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const projection = 'Foundation.Crypto.P256.Wire';
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
    'mutations.mjs', 'browser.mjs', 'owner.test.mjs', 'oracles.test.mjs',
    'oracles/PKV.rsp.base64', 'oracles/ACVP-KeyVer-FIPS186-5.json.base64',
    'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'])
    files.add('tests/browser-p256/' + path);
  for (const path of ['tests/browser-view/compiler-owner.test.mjs', 'tests/browser-view/compiler-artifact.test.mjs',
    'tests/browser-view/local-module-inputs.test.mjs',
    'tests/browser-view/compiler-artifact-mutations.test.mjs', 'tests/browser-view/generated-package.test.mjs',
    'stdlib/src/Foundation/Crypto/P256/Model.md', 'stdlib/src/Foundation/Crypto/P256/Wire.cddl',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml',
    'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json', 'vendor/lean4-prod/lean.tar']) files.add(path);
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
  for (const path of compilerInputPaths('p256')) files.add(path);
  const captures = new Map([...files].sort().map(path => [path, captureFile(join(repository, path))]));
  const inputs = Object.fromEntries([...captures].map(([path, row]) => [path, row.evidence.sha256]));
  for (const [path, bytes] of capturedModules) assert.equal(sha(bytes), inputs[path], 'actual parsed module snapshot ' + path);
  Object.freeze(inputs); capturedInputs.set(inputs, new Map([...captures].map(([path, row]) => [path, row.evidence]))); return inputs;
}
export function verifyFrozenInputs(inputs) {
  const captured = capturedInputs.get(inputs);
  assert.ok(captured && Object.isFrozen(inputs), 'actual complete captured p256 inputs required');
  // The complete static graph was parsed during capture. Every original file
  // remains checked on every use: changed import edges necessarily change one
  // of these bytes. Do not reparse an identical graph in child Node processes.
  assert.deepEqual(inputs, Object.fromEntries([...captured].map(([path, evidence]) => [path, evidence.sha256])),
    'complete captured P256 source inventory');
  for (const [path, evidence] of captured) capturedFile(join(repository, path), evidence);
}
export function assertCapturedP256Sources(inputs, sources) {
  assert.deepEqual([...sources.keys()].map(modulePath).sort(),
    Object.keys(inputs).filter(path => path.endsWith('.lex.tex')).sort(),
    'complete captured source module inventory');
  for (const [name, bytes] of sources) assert.equal(sha(bytes), inputs[modulePath(name)],
    'actual captured source must match original snapshot ' + name);
}
export function assertP256CompilerInputs(compilerOwner, inputs) {
  const compiler = requireCompilerOwner(compilerOwner, 'p256');
  for (const [path, digest] of Object.entries(compiler.evidence.inputs))
    assert.equal(inputs[path], digest, 'P256 owner and model share the exact captured compiler input ' + path);
  return compiler;
}
export function prepareP256(compilerOwner, mutationId = null, expectedInputs = null) {
  const startedAt = performance.now();
  for (const name of Object.keys(process.env)) assert.ok(!name.startsWith('PRISMPM_P256_'), 'no owner bypass');
  const inputs = frozenInputs(), sources = sourceClosure();
  if (expectedInputs) assert.deepEqual(inputs, expectedInputs, 'one immutable complete owner closure');
  const compiler = assertP256CompilerInputs(compilerOwner, inputs);
  assertCapturedP256Sources(inputs, sources);
  const mutation = mutationId === null ? null : mutateP256Source(sources, mutationId);
  const captured = path => { const bytes = read(path); assert.equal(sha(bytes), inputs[path], 'frozen input ' + path); return bytes; };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-p256-'));
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
    stage('project/lexlean.toml', captured('tests/fixtures/library/native-library/project/lexlean.toml').toString('utf8')
      .replace('name = "library-probe"', 'name = "p256-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/' + projection.replaceAll('.', '/') + '.lex.tex'));
    stage('project/lean-toolchain', captured('lean-toolchain'));
    stage('project/lakefile.toml', 'name = "p256_conformance"\nversion = "0.1.0"\n');
    run('lake', ['update'], project);
    const verified = JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work));
    assert.deepEqual(verified.modules, [...sources.keys()]);
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
    const buildManifest = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestation = JSON.parse(attestationBytes);
    assert.equal(attestation.status, 'verified'); assert.equal(attestation.attestation_id, verified.attestation_id);
    assert.equal(attestation.build_manifest.sha256, sha(buildManifest));
    const expected = new Map([...sources].flatMap(([name, bytes]) => {
      const data = JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1]);
      return data.declarations.map(declaration => ['PrismPM.' + name + '.' + declaration.name, declaration.axioms ?? []]);
    }));
    assert.equal(attestation.declarations.length, expected.size);
    for (const declaration of attestation.declarations) {
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
    stage('lean/lakefile.toml', 'name = "p256"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['
      + [...sources.keys()].map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export'), roots = ['PrismPM.' + projection + '.p256WireBytes'];
    compiler.runExporter(['--module', 'PrismPM.' + projection, ...roots.flatMap(name => ['--root', name]),
      '--ir-module', 'P256', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const ir = join(exported, 'kernel.ir'), generated = join(work, 'generated');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, captured(name));
    const licenses = join(work, 'licenses');
    const generation = JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work));
    const nativePackage = captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256});
    const packages = new Map([['native', nativePackage]]);
    const wasm = {}, wasmOwners = {}, wasmArtifacts = {};
    for (const entry of ['p256']) {
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
          join(target, 'wasm32-unknown-unknown/release/browser_p256_wire_probe.wasm'), entry + '-' + label + '-execution');
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
      stage('runner-' + name + '/src/main.rs', captured('tests/browser-p256/runner.rs'));
      stage('runner-' + name + '/Cargo.toml', '[package]\nname = "browser-p256-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-p256-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + name + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-p256-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-p256-runner"\nversion = "0.1.0"\ndependencies = ["browser-p256-core-probe"]\n');
      run('cargo', ['build', '--locked', '--offline', '--release'], runner, {CARGO_TARGET_DIR: join(runner, 'target')});
      nativePackage.verify();
      // Bind the genuine Cargo original (including its normal dependency link)
      // and a separate private execution file to one captured identity.
      const record = captureCompilerArtifact(work, join(runner, 'target/release/browser-p256-runner'), 'p256-native-' + name);
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
    function unchangedSourcesAndProducts() {
      for (const package_ of packages.values()) package_.verify();
      for (const artifact of Object.values(wasmArtifacts)) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      verifyFrozenInputs(inputs);
      for (const [path, digest] of staged) assert.equal(sha(readFileSync(join(work, path))), digest, 'immutable captured input ' + path);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), buildManifest);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
    }
    function unchanged() {
      assertP256CompilerInputs(compiler, inputs);
      unchangedSourcesAndProducts();
    }
    unchanged();
    const generatedPackages = Object.freeze(Object.fromEntries([...packages].map(([name, package_]) => {
      assert.ok(Object.isFrozen(package_.files), 'immutable captured package file map');
      return [name, package_.files];
    })));
    complete = true;
    return Object.freeze({work, sources, verified, generation, wasm, wasmOwners, wasmArtifacts, generatedWasm,
      compileNative, runNative, nativeEvidence, nativeArtifactEvidence, unchanged, unchangedSourcesAndProducts, inputs, mutation, generatedPackages,
      compilerOwner: compiler, compilerTools: compiler.evidence, preparationMs: performance.now() - startedAt});
  } finally { if (!complete) process.stderr.write('Retained incomplete p256 diagnostic build ' + work + '\n'); }
}
