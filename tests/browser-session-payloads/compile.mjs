// Private test orchestration; no host implementation of modeled transitions.
import assert from 'node:assert/strict';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPrivateDriverTarget, ensureProdExport, run, sha} from '../browser-view/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {ownPayloadTranscripts} from './transcript-retention.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const projection = 'Fixture';
const modulePath = name => name === 'Fixture' ? 'tests/browser-session-payloads/src/Fixture.lex.tex'
  : 'stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex';
function read(path) {
  const absolute = join(repository, path), stat = lstatSync(absolute);
  assert.equal(realpathSync(absolute), absolute, 'unaliased compiler input ' + path);
  assert.ok(stat.isFile() && stat.nlink === 1, 'regular singly linked compiler input ' + path);
  return readFileSync(absolute);
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
  for (const path of ['compile.mjs', 'checks.mjs', 'component.test.mjs', 'transcript-retention.test.mjs', 'owner.test.mjs', 'runtime.mjs', 'browser.mjs', 'journeys.mjs', 'mutations.mjs', 'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'])
    files.add('tests/browser-session-payloads/' + path);
  for (const path of ['tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'sdk/browser/session-payloads.mjs', 'sdk/browser/session-storage.mjs',
    'sdk/browser/session-retention-wire.mjs',
    'tests/browser-view/generated-package.test.mjs',
    'tests/browser-session/wire.mjs', 'tests/browser-session/corpus.mjs',
    'tests/browser-session/maxima.mjs', 'tests/browser-session/budget.mjs',
    'sdk/browser/effects-wire.mjs', 'sdk/browser/effects-module.mjs', 'sdk/browser/presentation-wire.mjs',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml',
    'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json',
    'vendor/lean4-prod/lean.tar']) files.add(path);
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
  const inputs = Object.fromEntries([...files].sort().map(path => [path, sha(read(path))]));
  for (const [path, bytes] of capturedModules) assert.equal(sha(bytes), inputs[path], 'actual parsed module snapshot ' + path);
  return Object.freeze(inputs);
}
export function assertCapturedPayloadSources(inputs, sources) {
  assert.deepEqual([...sources.keys()].map(modulePath).sort(),
    Object.keys(inputs).filter(path => path.endsWith('.lex.tex')).sort(),
    'complete captured source module inventory');
  for (const [name, bytes] of sources) assert.equal(sha(bytes), inputs[modulePath(name)],
    'actual captured source must match original snapshot ' + name);
}
export function preparePayloads(expectedInputs = null) {
  for (const name of Object.keys(process.env)) assert.ok(!name.startsWith('PRISMPM_SESSION_PAYLOADS_'), 'no owner bypass');
  const inputs = frozenInputs(), sources = sourceClosure();
  if (expectedInputs) assert.deepEqual(inputs, expectedInputs, 'one immutable complete owner closure');
  assertCapturedPayloadSources(inputs, sources);
  const captured = path => { const bytes = read(path); assert.equal(sha(bytes), inputs[path], 'frozen input ' + path); return bytes; };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-session-payloads-'));
  const staged = new Map();
  function stage(path, bytes) {
    const destination = join(work, path); mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, bytes, {flag: 'wx'}); staged.set(path, sha(bytes)); return destination;
  }
  let complete = false;
  try {
    stage('rust-toolchain.toml', captured('rust-toolchain.toml'));
    // This verifies registered compiler trees before any captured driver runs.
    const exporter = ensureProdExport(repository, work);
    for (const path of Object.keys(inputs).filter(path => path.startsWith('vendor/lexlean/') || path.startsWith('vendor/lean4-prod/rust/')))
      stage(path, captured(path));
    for (const name of ['Cargo.toml', 'Cargo.lock', 'src/main.rs']) {
      const path = 'tests/browser-session-payloads/driver/' + name; stage(path, captured(path));
    }
    const driverTarget = createPrivateDriverTarget(work);
    const manifest = join(work, 'tests/browser-session-payloads/driver/Cargo.toml');
    run('cargo', ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', manifest], work, {CARGO_TARGET_DIR: driverTarget});
    const driver = join(driverTarget, 'debug/browser-session-payloads-driver');
    for (const [name, bytes] of sources) stage('project/src/' + name.replaceAll('.', '/') + '.lex.tex', bytes);
    const project = join(work, 'project');
    stage('project/lexlean.toml', captured('tests/fixtures/library/native-library/project/lexlean.toml').toString('utf8')
      .replace('name = "library-probe"', 'name = "session-journal-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/' + projection.replaceAll('.', '/') + '.lex.tex'));
    stage('project/lean-toolchain', captured('lean-toolchain'));
    stage('project/lakefile.toml', 'name = "session_journal_conformance"\nversion = "0.1.0"\n');
    run('lake', ['update'], project);
    const verified = JSON.parse(run(driver, ['verify', join(project, 'lexlean.toml')], work));
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
    stage('lean/lakefile.toml', 'name = "journal_retention"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['
      + [...sources.keys()].map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export'), roots = ['payloadJournalBytes', 'payloadPartitionBytes', 'payloadRetentionBytes'].map(name => 'PrismPM.Fixture.' + name).sort();
    run(exporter.bin, ['--module', 'PrismPM.' + projection, ...roots.flatMap(name => ['--root', name]),
      '--ir-module', 'SessionPayloads', '--out', exported], exporter.dir, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const ir = join(exported, 'kernel.ir'), generated = join(work, 'generated');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, captured(name));
    const licenses = join(work, 'licenses');
    const generation = JSON.parse(run(driver, ['native', ir, generated, licenses], work));
    const nativePackage = captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256});
    const packages = new Map([['native', nativePackage]]);
    const wasm = {}, wasmOwners = {}, wasmArtifacts = {};
    for (const entry of ['journal', 'partition', 'retention']) {
      const guests = [];
      for (const label of ['a', 'b']) {
        const output = join(work, entry + '-' + label);
        assert.deepEqual(JSON.parse(run(driver, [entry, ir, output, licenses], work)), generation);
        const package_ = captureGeneratedPackage(output, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
        packages.set(entry + '-' + label, package_); package_.verify();
        const target = join(work, 'wasm-target-' + entry + '-' + label);
        try {run('cargo', ['build', '--locked', '--offline', '--release'], output, {CARGO_TARGET_DIR: target});}
        finally {package_.verify();}
        const artifact = captureGeneratedWasm(work,
          join(target, 'wasm32-unknown-unknown/release/browser_session_payloads_wire_probe.wasm'), entry + '-' + label + '-execution');
        wasmArtifacts[entry + '-' + label] = artifact; guests.push(artifact);
      }
      assert.deepEqual(guests[0].bytes, guests[1].bytes, 'two independent complete generated ' + entry + ' packages');
      wasm[entry] = guests[0].bytes; wasmOwners[entry] = guests[0];
    }
    Object.freeze(wasm); Object.freeze(wasmOwners); Object.freeze(wasmArtifacts);
    const generatedWasm = Object.freeze(Object.fromEntries(Object.entries(wasmArtifacts).map(([name, owner]) => [name, owner.evidence])));
    const nativePrograms = new Map();
    function checkedNative(record) {
      const stat = lstatSync(record.binary);
      assert.equal(realpathSync(record.binary), record.binary, 'unaliased private native executable');
      assert.ok(stat.isFile() && stat.nlink === 1, 'regular singly linked private native executable');
      assert.equal(sha(readFileSync(record.binary)), record.sha256, 'private native executable changed after genuine compilation');
      return record.binary;
    }
    function compileNative(standard) {
      nativePackage.verify();
      if (nativePrograms.has(standard)) return checkedNative(nativePrograms.get(standard));
      const name = standard ? 'std' : 'no-std', runner = join(work, 'runner-' + name);
      stage('runner-' + name + '/src/main.rs', captured('tests/browser-session-payloads/runner.rs'));
      stage('runner-' + name + '/Cargo.toml', '[package]\nname = "browser-session-payloads-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-session-payloads-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + name + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-session-payloads-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-session-payloads-runner"\nversion = "0.1.0"\ndependencies = ["browser-session-payloads-core-probe"]\n');
      run('cargo', ['build', '--locked', '--offline', '--release'], runner, {CARGO_TARGET_DIR: join(runner, 'target')});
      nativePackage.verify();
      // Cargo links its output to a dependency artifact. Capture the just-built
      // bytes into a distinct private executable, not a mutable Cargo alias.
      const binary = stage('native-' + name + '-runner', readFileSync(join(runner, 'target/release/browser-session-payloads-runner')));
      chmodSync(binary, 0o700);
      const record = {binary, sha256: sha(readFileSync(binary))};
      nativePrograms.set(standard, record); return checkedNative(record);
    }
    function runNative(standard, arguments_) {
      const program = compileNative(standard);
      try {return run(program, arguments_, work);}
      finally {checkedNative(nativePrograms.get(standard));}
    }
    function nativeEvidence() {
      return Object.fromEntries([...nativePrograms].map(([standard, record]) => {
        checkedNative(record); return [standard ? 'std' : 'no-std', record.sha256];
      }));
    }
    function unchanged() {
      for (const package_ of packages.values()) package_.verify();
      for (const artifact of Object.values(wasmArtifacts)) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      assert.deepEqual(frozenInputs(), inputs);
      for (const [path, digest] of staged) assert.equal(sha(readFileSync(join(work, path))), digest, 'immutable captured input ' + path);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), buildManifest);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
    }
    unchanged(); const cacheRetirement = retireCompletedCompilerCaches(work, 'session-payloads'); unchanged();
    complete = true;
    const generatedPackages = Object.freeze(Object.fromEntries([...packages].map(([name, package_]) => {
      assert.ok(Object.isFrozen(package_.files));return [name, package_.files];
    })));
    return Object.freeze({work, sources, verified, generation, wasm, wasmOwners, wasmArtifacts, generatedWasm,
      compileNative, runNative, nativeEvidence, unchanged, inputs, cacheRetirement, generatedPackages,
      transcripts: ownPayloadTranscripts(work)});
  } finally { if (!complete) process.stderr.write('Retained incomplete session-journal diagnostic build ' + work + '\n'); }
}
