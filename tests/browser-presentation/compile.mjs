import assert from 'node:assert/strict';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
// Reuse the existing pinned-toolchain, override-refusing process boundary.
import {run, sha} from '../browser-view/compile.mjs';
import {captureCompilerInputs, createCompilerOwner, requireCompilerOwner} from '../browser-view/compiler-owner.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {captureFile, capturedFile} from '../browser-view/file-custody.mjs';
import {capturePresentationProvenance, presentationOutputRows} from './provenance.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const modules = ['Fixture', 'Foundation.View.Browser.V1.Model',
  'Foundation.View.Browser.V1.Wire', 'Foundation.Bytes',
  'Foundation.Codec', 'Foundation.Codec.Cbor.V1.Primitive'].sort();
const modulePath = name => (name === 'Fixture' ? 'tests/browser-presentation' : 'stdlib')
  + '/src/' + name.replaceAll('.', '/') + '.lex.tex';

function freezeRecord(value) {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeRecord(child);
    Object.freeze(value);
  }
  return value;
}

export function frozenInputs() {
  pins();
  const files = new Set([...modules.map(modulePath),
    ...readdirSync(draft).filter(path => path.endsWith('.mjs')).map(path => 'tests/browser-presentation/' + path),
    ...['driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs', 'runner.rs'].map(path => 'tests/browser-presentation/' + path),
    ...readdirSync(join(repository, 'sdk/browser')).filter(path => path.endsWith('.mjs')).map(path => 'sdk/browser/' + path),
    ...['compile.mjs', 'prerequisites.mjs', 'compiler-owner.mjs', 'compiler-owner-checks.mjs',
      'compiler-owner.test.mjs', 'compiler-artifact.mjs', 'compiler-artifact.test.mjs',
      'generated-package.mjs', 'generated-package.test.mjs', 'generated-wasm.mjs',
      'generated-wasm.test.mjs', 'driver-cache.mjs'].map(path => 'tests/browser-view/' + path),
    'tests/browser-view/file-custody.mjs', 'tests/browser-view/file-custody.test.mjs',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/authorities.toml',
    'model/dependencies.toml', 'rust-toolchain.toml', 'lean-toolchain', 'LICENSE-MIT', 'LICENSE-APACHE',
    'sdk/oracles/package.json', 'sdk/oracles/package-lock.json', 'model/browser-presentation-diagnostics.json',
    'scripts/browser-api-sdk-check.mjs', 'scripts/browser-api-sdk-check.test.mjs', 'scripts/owning-node-reporter.mjs',
    'scripts/sdk-command-owner.mjs', 'scripts/sdk-command-owner.py',
    'sdk/account-genesis-artifact.mjs',
    'crates/conformance/src/cases/mod.rs', 'crates/conformance/tests/conformance.rs',
    'vendor/lean4-prod/lean.tar', 'vendor/lean4-prod/rust/MANIFEST.sha256', 'vendor/lexlean/MANIFEST.sha256',
  ]);
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust'])
    for (const line of readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n')) {
      const row = /^([0-9a-f]{64})  ([A-Za-z0-9_./-]+)$/.exec(line); assert.ok(row);
      files.add(tree + '/' + row[2]);
    }
  return Object.freeze(Object.fromEntries([...files].sort().map(path => [path, captureFile(join(repository, path)).evidence])));
}

export function assertFrozenInputs(inputs) {
  assert.deepEqual(frozenInputs(), inputs, 'complete frozen presentation owner inputs');
}

function capturedInput(path, inputs) {
  return capturedFile(join(repository, path), inputs[path]);
}

export function assertBaselineSources(actual, expected) {
  assert.ok(expected instanceof Map, 'actual positive presentation source closure required');
  assert.deepEqual([...actual.keys()], [...expected.keys()], 'complete positive presentation source inventory');
  for (const [name, bytes] of actual) assert.deepEqual(bytes, expected.get(name), 'immutable positive presentation source ' + name);
}

function nativeIdentity(path, links = null) {
  assert.equal(realpathSync(path), path, 'unaliased presentation observer');
  const before = lstatSync(path, {bigint: true});
  assert.ok(before.isFile() && before.uid === BigInt(process.getuid())
    && before.size >= 4n && before.size <= 268435456n
    && (before.mode & 0o100n) !== 0n && (before.mode & 0o022n) === 0n,
    'bounded owned executable presentation observer');
  if (links !== null) assert.equal(before.nlink.toString(), links, 'presentation observer link count');
  const bytes = readFileSync(path), after = lstatSync(path, {bigint: true});
  for (const key of ['dev', 'ino', 'uid', 'nlink', 'size', 'mode', 'mtimeNs', 'ctimeNs'])
    assert.equal(after[key], before[key], 'stable presentation observer capture ' + key);
  assert.deepEqual(bytes.subarray(0, 4), Buffer.from([0x7f, 0x45, 0x4c, 0x46]), 'native Linux presentation observer');
  return Object.freeze({device: before.dev.toString(), inode: before.ino.toString(),
    links: before.nlink.toString(), size: bytes.length, sha256: sha(bytes)});
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

export function checkSource() {
  const inputs = frozenInputs(), compiler = createCompilerOwner('presentation', captureCompilerInputs('presentation'));
  try {return prepareStage(null, true, null, inputs, compiler);}
  finally {compiler.close();}
}
export const prepare = (mutation, baseline, inputs, compiler) => prepareStage(mutation, false, baseline, inputs, compiler);
function prepareStage(mutation, sourceOnly, baseline, inputs, compilerOwner) {
  assert.ok([null, 'binding', 'trailing', 'secretbound', 'secretroute', 'progress'].includes(mutation));
  for (const key of Object.keys(process.env)) assert.ok(!key.startsWith('PRISMPM_PRESENTATION_'), 'presentation acceptance refuses bypass ' + key);
  assertFrozenInputs(inputs);
  const compiler = requireCompilerOwner(compilerOwner, 'presentation');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-presentation-'));
  const sourcePath = name => join(name === 'Fixture' ? draft : join(repository, 'stdlib'), 'src', ...name.split('.')) + '.lex.tex';
  const sources = new Map(modules.map(name => [name, capturedInput(modulePath(name), inputs)]));
  const originals = new Map(sources);
  if (mutation !== null) assertBaselineSources(originals, baseline);
  const staged = new Map();
  function stage(relative, bytes) {
    const destination = join(work, relative); mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, bytes, {flag: 'wx'}); staged.set(relative, sha(bytes)); return destination;
  }
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
      stage('project/src/' + module.replaceAll('.', '/') + '.lex.tex', bytes);
    }
    const base = capturedInput('tests/fixtures/library/native-library/project/lexlean.toml', inputs).toString('utf8')
      .replace('name = "library-probe"', 'name = "presentation-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/Fixture.lex.tex');
    stage('project/lexlean.toml', base);
    stage('project/lakefile.toml', 'name = "presentation_conformance"\nversion = "0.1.0"\n');
    stage('project/lean-toolchain', capturedInput('lean-toolchain', inputs));
    stage('rust-toolchain.toml', capturedInput('rust-toolchain.toml', inputs));
    const checked = JSON.parse(compiler.runDriver(['check', join(project, 'lexlean.toml')], work));
    assert.deepEqual(checked.modules, modules);
    if (sourceOnly) {
      requireCompilerOwner(compiler, 'presentation'); assertFrozenInputs(inputs);
      for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
      completed = true; return {work, checked, sourceOnly: true};
    }
    run('lake', ['update'], project);
    const verified = freezeRecord(JSON.parse(compiler.runDriver(['verify', join(project, 'lexlean.toml')], work)));
    assert.deepEqual(verified.modules, modules);
    const manifestBytes = readFileSync(join(verified.root, 'build-manifest.json'));
    const attestationBytes = readFileSync(join(verified.root, 'attestation.json'));
    const attestation = JSON.parse(attestationBytes);
    function readOutputs() {
      return new Map(presentationOutputRows.map(({path}) =>
        [path, captureFile(join(verified.root, path)).bytes]));
    }
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
    const lean = join(work, 'lean');
    const generatedPath = module => join('PrismPM', ...module.split('.')) + '.lean';
    function readLean(root) {
      return new Map(modules.map(module => {
        const path = join(root, generatedPath(module));
        assert.equal(realpathSync(path), path, 'unaliased kernel-bound generated Lean');
        assert.ok(lstatSync(path).isFile() && lstatSync(path).nlink === 1, 'regular kernel-bound generated Lean');
        return [module, readFileSync(path)];
      }));
    }
    const provenance = capturePresentationProvenance({verified, sources, manifestBytes, attestationBytes,
      generated: readLean(join(verified.root, 'modules')), outputs: readOutputs()});
    for (const module of modules) {
      stage('lean/' + generatedPath(module), provenance.generatedBytes(module));
    }
    stage('lean/lean-toolchain', capturedInput('lean-toolchain', inputs));
    stage('lean/lakefile.toml', 'name = "presentation_probe"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = [' + modules.map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    run('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export');
    const roots = ['PrismPM.Foundation.View.Browser.V1.Wire.viewWireBytes', ...[
      'fixturePresentationBytes', 'fixtureLabelsBytes', 'fixtureIntentFitsBytes',
      'fixtureSecretPresentationBytes', 'fixtureSecretRouteBytes', 'fixtureSecretSinkBytes',
      'fixtureSecretMaximumRouteBytes', 'fixtureSecretMaximumSinkBytes', 'fixtureSecretMaximumFieldBytes',
      'fixtureSecretMaximumPresentationBytes',
      'fixtureProgressFitsBytes',
      'fixtureProgressMaximumBytes',
    ].map(name => 'PrismPM.Fixture.' + name)].sort();
    compiler.runExporter(['--module', 'PrismPM.Fixture', ...roots.flatMap(root => ['--root', root]),
      '--ir-module', 'BrowserPresentation', '--out', exported], join(lean, '.lake/build/lib/lean'));
    const generated = join(work, 'generated'), ir = join(exported, 'kernel.ir');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, capturedInput(name, inputs));
    const licenses = join(work, 'licenses');
    const generation = freezeRecord(JSON.parse(compiler.runDriver(['native', ir, generated, licenses], work)));
    const packages = new Map([['native', captureGeneratedPackage(generated, {kind: 'native', inputIrSha256: generation.ir_sha256})]]);
    const artifacts = new Map(), nativePrograms = new Map();
    function checkedNative(record) {
      assert.deepEqual(nativeIdentity(record.original, record.originalIdentity.links), record.originalIdentity,
        'immutable original presentation observer');
      assert.deepEqual(nativeIdentity(record.path, '1'), record.privateIdentity, 'immutable actual presentation observer');
      return record.path;
    }
    function unchanged() {
      requireCompilerOwner(compiler, 'presentation'); assertFrozenInputs(inputs);
      for (const package_ of packages.values()) package_.verify();
      for (const artifact of artifacts.values()) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      for (const [relative, hash] of staged) assert.equal(sha(readFileSync(join(work, relative))), hash, 'immutable staged presentation input ' + relative);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
      provenance.verify({verified,
        sources: new Map(modules.map(module => [module, readFileSync(join(project, 'src', ...module.split('.')) + '.lex.tex')])),
        manifestBytes: readFileSync(join(verified.root, 'build-manifest.json')),
        attestationBytes: readFileSync(join(verified.root, 'attestation.json')),
        generated: readLean(join(verified.root, 'modules')), staged: readLean(lean), outputs: readOutputs()});
    }
    function compileNative(standard) {
      assert.equal(typeof standard, 'boolean'); unchanged();
      if (nativePrograms.has(standard)) return checkedNative(nativePrograms.get(standard));
      const mode = standard ? 'std' : 'no-std', runner = join(work, 'runner-' + mode);
      stage('runner-' + mode + '/src/main.rs', capturedInput('tests/browser-presentation/runner.rs', inputs));
      stage('runner-' + mode + '/Cargo.toml', '[package]\nname = "browser-presentation-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-presentation-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + mode + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-presentation-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-presentation-runner"\nversion = "0.1.0"\ndependencies = ["browser-presentation-core-probe"]\n');
      const target = join(work, 'native-target-' + mode);
      try {run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(runner, 'Cargo.toml')], runner, {CARGO_TARGET_DIR: target});}
      finally {unchanged();}
      const original = join(target, 'release/browser-presentation-runner'), originalIdentity = nativeIdentity(original);
      const path = stage('native-' + mode + '-observer', readFileSync(original));
      chmodSync(path, 0o700);
      const privateIdentity = nativeIdentity(path, '1');
      assert.equal(privateIdentity.sha256, originalIdentity.sha256);
      const record = Object.freeze({path, original, originalIdentity, privateIdentity});
      nativePrograms.set(standard, record); return checkedNative(record);
    }
    function runNative(standard, arguments_) {
      const binary = compileNative(standard);
      try {return run(binary, arguments_, work);}
      finally {unchanged();}
    }
    const guests = [];
    for (const [label, mode] of [['a', 'wasm'], ['b', 'wasm'], ['fixture', 'fixture'], ['labels', 'labels'], ['intent', 'intent'],
      ['secret', 'secret'], ['route', 'route'], ['sink', 'sink'],
      ['maxroute', 'maxroute'], ['maxsink', 'maxsink'], ['maxfield', 'maxfield'], ['maxsecret', 'maxsecret'], ['progress', 'progress'], ['maxprogress', 'maxprogress']]) {
      const guest = join(work, 'guest-' + label);
      assert.deepEqual(JSON.parse(compiler.runDriver([mode, ir, guest, licenses], work)), generation);
      const package_ = captureGeneratedPackage(guest, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
      packages.set(label, package_); package_.verify();
      const target = join(work, 'guest-target-' + label);
      try {run('cargo', ['build', '--locked', '--offline', '--release'], guest, {CARGO_TARGET_DIR: target});}
      finally {package_.verify();}
      const artifact = captureGeneratedWasm(work,
        join(target, 'wasm32-unknown-unknown/release/browser_presentation_' + (mode === 'wasm' ? 'wire' : mode) + '_probe.wasm'), 'guest-' + label + '-execution');
      artifacts.set(label, artifact); guests.push(artifact.bytes);
    }
    assert.deepEqual(guests[0], guests[1], 'two independent generated Core-Wasm packages');
    unchanged();
    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'frozen source ' + module);
    completed = true;
    const fixed = {work, sources, verified, generation, compileNative, runNative, unchanged, inputs, compilerOwner: compiler,
      provenance: provenance.evidence,
      generatedPackages: Object.freeze(Object.fromEntries([...packages].map(([name, value]) => [name, value.files]))),
      wasmArtifacts: Object.freeze(Object.fromEntries(artifacts)),
      nativeEvidence: () => Object.fromEntries([...nativePrograms].map(([mode, record]) => [mode ? 'std' : 'no-std', (checkedNative(record),
        {original: record.originalIdentity, private: record.privateIdentity})])),
      wasmBytes: guests[0], fixtureBytes: guests[2], labelsBytes: guests[3], intentBytes: guests[4],
      secretBytes: guests[5], routeBytes: guests[6], sinkBytes: guests[7],
      maxrouteBytes: guests[8], maxsinkBytes: guests[9], maxfieldBytes: guests[10], maxsecretBytes: guests[11], progressBytes: guests[12], maxprogressBytes: guests[13]};
    // Evidence fields cannot be replaced, while result observations are added
    // by the serial owner. Captured buffers are separately verified each time.
    return Object.defineProperties({}, Object.fromEntries(Object.entries(fixed).map(([name, value]) =>
      [name, {value, enumerable: true, writable: false, configurable: false}])));
  } finally { if (!completed) process.stderr.write('Retained incomplete presentation diagnostic build ' + work + '\n'); }
}
