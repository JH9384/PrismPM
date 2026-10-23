// Private test orchestration; no host implementation of modeled transitions.
import { readSemantic } from '../../scripts/semantic-source.mjs';
import assert from 'node:assert/strict';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createPrivateDriverTarget, ensureProdExport, run, sha, stageLeanRuntime, ownedAttestations} from '../browser-view/compile.mjs';
import {retireCompletedCompilerCaches} from '../browser-view/driver-cache.mjs';
import {localModuleInputs} from '../browser-view/local-module-inputs.mjs';
import {captureGeneratedPackage} from '../browser-view/generated-package.mjs';
import {captureGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {mutateComponentSource} from './mutations.mjs';
export {run, sha};
export const draft = dirname(fileURLToPath(import.meta.url));
export const repository = resolve(draft, '../..');
const projection = 'Fixture';
const recovery = 'Foundation.Browser.Application.V1.SessionJournalRecovery';
const modulePath = name => name === 'Fixture' ? 'tests/browser-session-journal-recovery/src/Fixture.lex.tex'
  : 'stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex';
function read(path, root = repository) {
  assert.ok(typeof path === 'string' && path.split('/').every(part => /^[A-Za-z0-9_.-]+$/.test(part)
    && part !== '.' && part !== '..'), 'closed captured compiler input path');
  const absolute = join(root, path), stat = lstatSync(absolute);
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
  for (const path of ['compile.mjs', 'corpus.mjs', 'checks.mjs',
    'component.test.mjs', 'owner.test.mjs', 'runtime.mjs', 'maximum-runner.mjs', 'runner.rs', 'driver/Cargo.toml', 'driver/Cargo.lock', 'driver/src/main.rs'])
    files.add('tests/browser-session-journal-recovery/' + path);
  for (const path of ['tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/browser-session/wire.mjs', 'tests/browser-session/corpus.mjs',
    'tests/browser-session/maxima.mjs', 'tests/browser-session/budget.mjs',
    'sdk/browser/effects-wire.mjs', 'sdk/browser/effects-module.mjs', 'sdk/browser/presentation-wire.mjs',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'model/dependencies.toml',
    'model/authorities.toml', 'lean-toolchain', 'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE',
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
export function verifyCapturedInputBytes(inputs, root = repository) {
  assert.ok(Object.keys(inputs).length > 0, 'nonempty captured compiler closure');
  // The complete graph and compiler pins are independently parsed at the
  // product boundary. Identical bytes imply identical imports and manifests;
  // re-parsing unchanged JavaScript in dozens of subprocesses adds no evidence.
  for (const [path, digest] of Object.entries(inputs)) assert.equal(sha(read(path, root)), digest,
    'immutable complete owner input ' + path);
}
function measured(stage, operation) {
  const start = performance.now(); let complete = false;
  try {const result = operation(); complete = true; return result;}
  finally {console.log(JSON.stringify({scope: 'private-recovery-stage-timing', stage,
    elapsedMs: performance.now() - start, complete}));}
}
export function assertCapturedRecoverySources(inputs, sources) {
  assert.deepEqual([...sources.keys()].map(modulePath).sort(),
    Object.keys(inputs).filter(path => path.endsWith('.lex.tex') && !path.startsWith('vendor/')).sort(),
    'complete captured source module inventory');
  for (const [name, bytes] of sources) assert.equal(sha(bytes), inputs[modulePath(name)],
    'actual captured source must match original snapshot ' + name);
}

// Handles can only originate in this fresh-build function. No filename, caller
// digest, ambient cache or cloned object can authorize executable reuse.
const compilerOwners = new WeakSet();
function regularBytes(path, owned = false) {
  const stat = lstatSync(path);
  assert.equal(realpathSync(path), path, 'unaliased private compiler input');
  assert.ok(stat.isFile() && stat.nlink === 1 && (!owned || stat.uid === process.getuid()),
    'regular singly linked private compiler input');
  return readFileSync(path);
}
function privateTree(directory, omittedRootDirectory = null) {
  const files = new Map(), directories = [];
  function visit(relative) {
    const path = relative ? join(directory, relative) : directory, stat = lstatSync(path);
    assert.equal(realpathSync(path), path, 'unaliased private compiler directory');
    assert.ok(stat.isDirectory() && stat.uid === process.getuid(), 'owned private compiler directory');
    directories.push(relative);
    for (const name of readdirSync(path).sort()) {
      if (!relative && name === omittedRootDirectory) continue;
      const child = relative ? relative + '/' + name : name, absolute = join(directory, child);
      if (lstatSync(absolute).isDirectory()) visit(child);
      else files.set(child, sha(regularBytes(absolute, true)));
    }
  }
  visit(''); return Object.freeze({files: Object.freeze(Object.fromEntries(files)), directories: Object.freeze(directories.sort())});
}
function declaredTree(files, explicitDirectories = []) {
  const directories = new Set(['', ...explicitDirectories]);
  for (const path of [...Object.keys(files), ...explicitDirectories]) {
    let parent = dirname(path);
    while (parent !== '.') {directories.add(parent); parent = dirname(parent);}
  }
  return {files, directories: [...directories].sort()};
}
export function verifyPrivateCompilerTree(directory, files, directories = [], omittedRootDirectory = null) {
  assert.deepEqual(privateTree(directory, omittedRootDirectory), declaredTree(files, directories),
    'complete privately staged compiler file/directory inventory');
}
// Tar directory names have one terminal slash. It is a type marker, not an
// empty path component: retain it in the archive lookup, but never in the
// canonical filesystem inventory. No other normalization is permitted.
export function captureExtractedCompilerArchive(archive, directory, work) {
  const listing = run('tar', ['-tf', archive], work).trimEnd();
  assert.ok(listing.length > 0, 'nonempty pinned compiler archive');
  const files = new Map(), directories = [], seen = new Set();
  for (const member of listing.split('\n')) {
    const isDirectory = member.endsWith('/'), path = isDirectory ? member.slice(0, -1) : member;
    assert.match(path, /^[A-Za-z0-9_./-]+$/);
    assert.ok(!path.startsWith('/') && !path.split('/').some(part => !part || part === '.' || part === '..'),
      'canonical compiler archive member');
    assert.ok(!seen.has(path), 'unique typed compiler archive member'); seen.add(path);
    const absolute = join(directory, path), stat = lstatSync(absolute);
    assert.equal(realpathSync(absolute), absolute, 'unaliased extracted compiler member');
    if (isDirectory) {
      assert.ok(stat.isDirectory() && stat.uid === process.getuid(), 'owned extracted compiler directory');
      directories.push(path);
    } else {
      const bytes = regularBytes(absolute, true);
      assert.deepEqual(bytes, Buffer.from(run('tar', ['-xOf', archive, member], work)),
        'actual extracted pinned compiler source');
      files.set(path, sha(bytes));
    }
  }
  return Object.freeze({files: Object.freeze(Object.fromEntries(files)), directories: Object.freeze(directories.sort())});
}
// Capturing a tool file does not mint compiler authority. Only a genuine private
// build can mint the WeakSet handle below. Reuse verifies bytes without running
// even a version command on a potentially substituted executable.
export function captureCompilerTool(path, allowLauncherAlias = false) {
  assert.equal(resolve(path), path, 'canonical absolute compiler tool path');
  const canonicalPath = realpathSync(path), stat = lstatSync(canonicalPath);
  if (!allowLauncherAlias) assert.equal(canonicalPath, path, 'unaliased actual compiler tool');
  assert.ok(stat.isFile() && (allowLauncherAlias || stat.nlink === 1), 'regular captured compiler tool');
  return Object.freeze({path, canonicalPath, sha256: sha(readFileSync(canonicalPath)),
    uid: stat.uid, mode: stat.mode, links: stat.nlink});
}
export function verifyCompilerTool(record) {
  assert.equal(realpathSync(record.path), record.canonicalPath, 'captured compiler tool resolution changed');
  const stat = lstatSync(record.canonicalPath);
  assert.ok(stat.isFile() && stat.uid === record.uid && stat.mode === record.mode && stat.nlink === record.links,
    'captured compiler tool file identity changed');
  assert.equal(sha(readFileSync(record.canonicalPath)), record.sha256, 'captured compiler tool bytes changed before execution');
}
function verifyToolchain(toolchain) {
  for (const record of [...Object.values(toolchain.programs), ...toolchain.launchers]) {
    verifyCompilerTool(record);
    if (record.lookup) verifyCompilerTool(record.lookup);
  }
}
function actualToolchain(work, inputs) {
  const rust = /^channel\s*=\s*"([^"]+)"/m.exec(read('rust-toolchain.toml').toString())[1];
  const lean = /:v([^\s]+)$/.exec(read('lean-toolchain').toString().trim())[1];
  const tools = {}, launchers = Object.freeze([
    '/usr/local/cargo/bin/rustup', '/usr/local/cargo/bin/cargo', '/usr/local/cargo/bin/rustc',
    '/usr/local/elan/bin/elan', '/usr/local/elan/bin/lean', '/usr/local/elan/bin/lake',
  ].map(path => captureCompilerTool(path, true)));
  for (const [name, manager] of [['rustc', '/usr/local/cargo/bin/rustup'], ['cargo', '/usr/local/cargo/bin/rustup'],
    ['lean', '/usr/local/elan/bin/elan'], ['lake', '/usr/local/elan/bin/elan']]) {
    for (const launcher of launchers) verifyCompilerTool(launcher);
    const reported = run(manager, ['which', name], work).trim(), lookup = captureCompilerTool(reported, true);
    const path = lookup.canonicalPath, captured = captureCompilerTool(path);
    const version = run(path, name === 'rustc' ? ['--version', '--verbose'] : ['--version'], work);
    verifyCompilerTool(captured); verifyCompilerTool(lookup);
    if (name === 'rustc') assert.ok(version.startsWith('rustc ' + rust + ' ') && version.includes('\nrelease: ' + rust + '\n'));
    else if (name === 'cargo') assert.ok(version.startsWith('cargo ' + rust + ' '));
    else if (name === 'lean') assert.ok(version.startsWith('Lean (version ' + lean + ','));
    else assert.ok(version.includes('(Lean version ' + lean + ')'));
    tools[name] = Object.freeze({...captured, lookup, version});
  }
  tools.leanchecker = captureCompilerTool(join(dirname(tools.lean.path), 'leanchecker'));
  assert.equal(sha(read('rust-toolchain.toml')), inputs['rust-toolchain.toml']);
  assert.equal(sha(read('lean-toolchain')), inputs['lean-toolchain']);
  const toolchain = Object.freeze({programs: Object.freeze(tools), launchers});
  verifyToolchain(toolchain); return toolchain;
}
function createCompilerOwner(inputs) {
  assert.deepEqual(frozenInputs(), inputs, 'complete initial private compiler owner closure');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-session-journal-recovery-'));
  const staged = new Map();
  function stage(path, bytes) {
    const output = join(work, path); mkdirSync(dirname(output), {recursive: true});
    writeFileSync(output, bytes, {flag: 'wx'}); staged.set(path, sha(bytes)); return output;
  }
  for (const path of Object.keys(inputs).filter(path => path.startsWith('vendor/lexlean/')
    || path.startsWith('vendor/lean4-prod/rust/') || path.startsWith('tests/browser-session-journal-recovery/driver/')
    || ['rust-toolchain.toml', 'lean-toolchain'].includes(path))) {
    const bytes = read(path); assert.equal(sha(bytes), inputs[path]); stage(path, bytes);
  }
  const toolchain = actualToolchain(work, inputs);
  const exporter = measured('fresh-exporter-build', () => ensureProdExport(repository, work));
  const archive = join(exporter.dir, '.source-lean.tar');
  assert.equal(sha(regularBytes(archive, true)), inputs['vendor/lean4-prod/lean.tar']);
  staged.set('exporter/.source-lean.tar', inputs['vendor/lean4-prod/lean.tar']);
  const extracted = captureExtractedCompilerArchive(archive, exporter.dir, work);
  for (const [path, digest] of Object.entries(extracted.files)) staged.set('exporter/' + path, digest);
  const exporterRuntime = privateTree(join(exporter.dir, '.lake'));
  let closed = false, using = false, uses = 0;
  const invocationTimings = [];
  function sourcesUnchanged() {
    verifyCapturedInputBytes(inputs);
    for (const [path, digest] of staged) assert.equal(sha(regularBytes(join(work, path), true)), digest,
      'immutable privately staged compiler source ' + path);
    for (const prefix of ['vendor/lexlean', 'vendor/lean4-prod/rust', 'tests/browser-session-journal-recovery/driver', 'exporter']) {
      const expected = Object.fromEntries([...staged].filter(([path]) => path.startsWith(prefix + '/'))
        .map(([path, digest]) => [path.slice(prefix.length + 1), digest]));
      verifyPrivateCompilerTree(join(work, prefix), expected,
        prefix === 'exporter' ? extracted.directories : [], prefix === 'exporter' ? '.lake' : null);
    }
    if (!closed) assert.deepEqual(privateTree(join(exporter.dir, '.lake')), exporterRuntime,
      'immutable private exporter runtime library inventory');
    verifyToolchain(toolchain);
  }
  sourcesUnchanged();
  const target = createPrivateDriverTarget(work), manifest = join(work, 'tests/browser-session-journal-recovery/driver/Cargo.toml');
  measured('fresh-driver-build', () => run(toolchain.programs.cargo.path,
    ['build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', manifest], work, {CARGO_TARGET_DIR: target}));
  sourcesUnchanged();
  const directory = join(work, 'private-tools'); mkdirSync(directory, {mode: 0o700});
  const programs = {};
  for (const [name, original] of [['driver', join(target, 'debug/browser-session-journal-recovery-driver')], ['exporter', exporter.bin]]) {
    // Cargo's just-built driver may have its own hard-linked dependency path.
    // The reusable executable is a new private single-link copy of those bytes.
    const bytes = readFileSync(original), path = join(directory, name === 'exporter' ? 'prod-export' : name);
    writeFileSync(path, bytes, {flag: 'wx', mode: 0o700}); chmodSync(path, 0o700);
    programs[name] = Object.freeze({path, sha256: sha(bytes)});
  }
  Object.freeze(programs);
  function verify() {
    sourcesUnchanged();
    assert.equal(realpathSync(directory), directory);
    const stat = lstatSync(directory);
    assert.ok(stat.isDirectory() && stat.uid === process.getuid() && (stat.mode & 0o777) === 0o700);
    assert.deepEqual(readdirSync(directory).sort(), ['driver', 'prod-export'], 'closed private compiler executable inventory');
    for (const [name, program] of Object.entries(programs)) {
      assert.equal(lstatSync(program.path).mode & 0o777, 0o700, 'private compiler executable mode');
      assert.equal(sha(regularBytes(program.path, true)), program.sha256,
        'immutable privately compiled ' + name + ' executable');
    }
  }
  function execute(name, arguments_, cwd, environment = {}) {
    assert.ok(!closed && !using, 'live non-reentrant private compiler owner required');
    assert.ok(['driver', 'exporter', 'cargo', 'lake'].includes(name), 'closed private compiler command');
    const start = performance.now(); verify(); const invokedAt = performance.now(); using = true;
    let complete = false;
    try {
      uses++;
      const result = run(programs[name]?.path ?? toolchain.programs[name].path, arguments_, cwd, environment);
      complete = true; return result;
    } finally {
      const finishedAt = performance.now(); using = false; verify();
      const timing = {scope: 'private-recovery-invocation-timing', name, mode: arguments_[0], cwd,
        beforeGuardMs: invokedAt - start, invocationMs: finishedAt - invokedAt,
        afterGuardMs: performance.now() - finishedAt, complete};
      invocationTimings.push(Object.freeze(timing)); console.log(JSON.stringify(timing));
    }
  }
  const handle = Object.freeze({work, exporterDirectory: exporter.dir, inputs,
    verify, execute,
    evidence() {verify(); return {scope: 'one-private-owner-compiler-only', programs, toolchain,
      staged: Object.fromEntries(staged), exporterRuntime, uses, invocationTimings: invocationTimings.slice()};},
    retire() {
      assert.ok(!closed && !using, 'cannot retire an active or already retired compiler owner');
      verify(); closed = true;
      const receipt = retireCompletedCompilerCaches(work, 'session-journal-recovery'); verify(); return receipt;
    },
    admit(expected) {
      assert.ok(!closed && !using, 'live non-reentrant private compiler owner required');
      assert.deepEqual(inputs, expected, 'compiler reuse cannot cross frozen owner closures'); verify();
    },
  });
  compilerOwners.add(handle); verify(); return handle;
}
export function assertCompilerOwner(owner, inputs) {
  assert.ok(compilerOwners.has(owner), 'actual privately built compiler owner required'); owner.admit(inputs);
}

export function prepareRecovery(mutationId = null, expectedInputs = null, sharedCompiler = null) {
  for (const name of Object.keys(process.env)) assert.ok(!name.startsWith('PRISMPM_SESSION_JOURNAL_'), 'no owner bypass');
  const inputs = measured('complete-product-input-closure', frozenInputs), sources = sourceClosure();
  if (expectedInputs) assert.deepEqual(inputs, expectedInputs, 'one immutable complete owner closure');
  if (sharedCompiler !== null) assertCompilerOwner(sharedCompiler, inputs);
  assertCapturedRecoverySources(inputs, sources);
  const mutation = mutationId === null ? null : mutateComponentSource(sources, mutationId);
  const captured = path => { const bytes = read(path); assert.equal(sha(bytes), inputs[path], 'frozen input ' + path); return bytes; };
  const work = mkdtempSync(join(tmpdir(), 'prismpm-session-journal-recovery-'));
  const staged = new Map();
  function stage(path, bytes) {
    const destination = join(work, path); mkdirSync(dirname(destination), {recursive: true});
    writeFileSync(destination, bytes, {flag: 'wx'}); staged.set(path, sha(bytes)); return destination;
  }
  let complete = false;
  try {
    stage('rust-toolchain.toml', captured('rust-toolchain.toml'));
    const compilerOwner = sharedCompiler ?? createCompilerOwner(inputs);
    assertCompilerOwner(compilerOwner, inputs);
    for (const [name, bytes] of sources) stage('project/src/' + name.replaceAll('.', '/') + '.lex.tex', bytes);
    const project = join(work, 'project');
    stage('project/lexlean.toml', captured('tests/fixtures/library/native-library/project/lexlean.toml').toString('utf8')
      .replace('name = "library-probe"', 'name = "session-journal-conformance"')
      .replace('module_prefix = "LibraryProbe"', 'module_prefix = "PrismPM"')
      .replace('src/Probe.lex.tex', 'src/' + projection.replaceAll('.', '/') + '.lex.tex'));
    stage('project/lean-toolchain', captured('lean-toolchain'));
    stage('project/lakefile.toml', 'name = "session_journal_conformance"\nversion = "0.1.0"\n');
    compilerOwner.execute('lake', ['update'], project);
    const verified = JSON.parse(compilerOwner.execute('driver', ['verify', join(project, 'lexlean.toml')], work));
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
    stage('lean/lakefile.toml', 'name = "journal_recovery"\nversion = "0.1.0"\n[[lean_lib]]\nname = "PrismGenerated"\nroots = ['
      + stageLeanRuntime(verified, lean) + [...sources.keys()].map(name => '"PrismPM.' + name + '"').join(',') + ']\n');
    compilerOwner.execute('lake', ['build', 'PrismGenerated'], lean);
    const exported = join(work, 'export'), roots = [
      'PrismPM.' + recovery + '.sourceRecoveryContextBytes',
      'PrismPM.' + recovery + '.sourceRecoveryWireBytes',
      'PrismPM.Foundation.Browser.Application.V1.SessionJournalWire.sessionJournalWireBytes',
      'PrismPM.Foundation.Browser.Application.V1.SessionWire.sourceSessionWireBytes',
    ].sort();
    compilerOwner.execute('exporter', ['--module', 'PrismPM.' + projection, ...roots.flatMap(name => ['--root', name]),
      '--ir-module', 'SessionJournalRecovery', '--out', exported], compilerOwner.exporterDirectory, {LEAN_PATH: join(lean, '.lake/build/lib/lean')});
    const ir = join(exported, 'kernel.ir'), generated = join(work, 'generated');
    for (const name of ['LICENSE-MIT', 'LICENSE-APACHE']) stage('licenses/' + name, captured(name));
    const licenses = join(work, 'licenses');
    const generation = JSON.parse(compilerOwner.execute('driver', ['native', ir, generated, licenses], work));
    const generatedPackages = [captureGeneratedPackage(generated,
      {kind: 'native', inputIrSha256: generation.ir_sha256})];
    const wasm = {}, wasmArtifacts = new Map();
    for (const entry of (mutation ? [mutation.entry] : ['context', 'recovery', 'session', 'metadata'])) {
      const guests = [];
      for (const label of ['a', 'b']) {
        const output = join(work, entry + '-' + label);
        assert.deepEqual(JSON.parse(compilerOwner.execute('driver', [entry, ir, output, licenses], work)), generation);
        const capturedPackage = captureGeneratedPackage(output, {kind: 'wasm', inputIrSha256: generation.ir_sha256});
        generatedPackages.push(capturedPackage); capturedPackage.verify();
        const target = join(work, entry + '-' + label + '-target');
        try {compilerOwner.execute('cargo', ['build', '--locked', '--offline', '--release'], output, {CARGO_TARGET_DIR: target});}
        finally {capturedPackage.verify();}
        guests.push(captureGeneratedWasm(work,
          join(target, 'wasm32-unknown-unknown/release/browser_session_journal_recovery_wire_probe.wasm'),
          entry + '-' + label));
      }
      assert.deepEqual(guests[0].bytes, guests[1].bytes, 'two independent complete generated ' + entry + ' packages');
      wasm[entry] = guests[0].bytes; wasmArtifacts.set(entry, guests);
    }
    Object.freeze(wasm);
    const nativePrograms = new Map();
    function checkedNative(record) {
      const stat = lstatSync(record.binary);
      assert.equal(realpathSync(record.binary), record.binary, 'unaliased private native executable');
      assert.ok(stat.isFile() && stat.nlink === 1, 'regular singly linked private native executable');
      assert.equal(sha(readFileSync(record.binary)), record.sha256, 'private native executable changed after genuine compilation');
      return record.binary;
    }
    function compileNative(standard) {
      for (const capturedPackage of generatedPackages) capturedPackage.verify();
      if (nativePrograms.has(standard)) return checkedNative(nativePrograms.get(standard));
      const name = standard ? 'std' : 'no-std', runner = join(work, 'runner-' + name);
      stage('runner-' + name + '/src/main.rs', captured('tests/browser-session-journal-recovery/runner.rs'));
      stage('runner-' + name + '/Cargo.toml', '[package]\nname = "browser-session-journal-recovery-runner"\nversion = "0.1.0"\nedition = "2021"\npublish = false\n[workspace]\n[dependencies]\nbrowser-session-journal-recovery-core-probe = {path = "../generated", default-features = ' + standard + '}\n');
      stage('runner-' + name + '/Cargo.lock', 'version = 4\n[[package]]\nname = "browser-session-journal-recovery-core-probe"\nversion = "0.1.0"\n[[package]]\nname = "browser-session-journal-recovery-runner"\nversion = "0.1.0"\ndependencies = ["browser-session-journal-recovery-core-probe"]\n');
      try {compilerOwner.execute('cargo', ['build', '--locked', '--offline', '--release'], runner, {CARGO_TARGET_DIR: join(runner, 'target')});}
      finally {for (const capturedPackage of generatedPackages) capturedPackage.verify();}
      // Cargo links its output to a dependency artifact. Capture the just-built
      // bytes into a distinct private executable, not a mutable Cargo alias.
      const binary = stage('native-' + name + '-runner', readFileSync(join(runner, 'target/release/browser-session-journal-recovery-runner')));
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
    function withWasm(entry, operation) {
      assert.ok(wasmArtifacts.has(entry), 'actual captured generated recovery entry required');
      assert.equal(typeof operation, 'function'); unchanged();
      const artifact = wasmArtifacts.get(entry)[0];
      try {return artifact.run(bytes => operation(bytes, artifact.path));}
      finally {unchanged();}
    }
    function unchanged() {
      compilerOwner.verify();
      for (const capturedPackage of generatedPackages) capturedPackage.verify();
      for (const artifacts of wasmArtifacts.values()) for (const artifact of artifacts) artifact.verify();
      for (const record of nativePrograms.values()) checkedNative(record);
      assert.deepEqual(frozenInputs(), inputs);
      for (const [path, digest] of staged) assert.equal(sha(readFileSync(join(work, path))), digest, 'immutable captured input ' + path);
      assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);
      assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), buildManifest);
      assert.equal(sha(readFileSync(ir)), generation.ir_sha256);
    }
    unchanged();
    complete = true;
    return Object.freeze({work, sources, verified, generation, wasm, withWasm, compileNative, runNative, nativeEvidence, unchanged, inputs, compilerOwner, mutation,
      wasmArtifacts: Object.freeze(Object.fromEntries([...wasmArtifacts].map(([entry, artifacts]) =>
        [entry, Object.freeze(artifacts.map(artifact => artifact.evidence))]))),
      generatedPackages: Object.freeze(generatedPackages.map(({directory, kind, files}) =>
        Object.freeze({path: directory.slice(work.length + 1), kind, files})))});
  } finally { if (!complete) process.stderr.write('Retained incomplete session-journal diagnostic build ' + work + '\n'); }
}
