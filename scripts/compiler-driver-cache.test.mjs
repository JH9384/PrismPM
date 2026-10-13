import assert from 'node:assert/strict';
import {chmodSync, chownSync, copyFileSync, cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {retireCompletedCompilerCaches} from '../tests/browser-view/driver-cache.mjs';
import {createPrivateDriverTarget, ensureProdExport, repository, run, sha} from '../tests/browser-view/compile.mjs';

// Reuse the actual pinned exporter configuration; do not substitute a Lake
// manifest format which none of these compiler fixtures executes.
const archive = fileURLToPath(new URL('../vendor/lean4-prod/lean.tar', import.meta.url));
const exporterManifest = Buffer.from(run('tar', ['-xOf', archive, 'lakefile.lean'], dirname(archive)));

function exporterFixture(t) {
  const repo = mkdtempSync(join(tmpdir(), 'prismpm-exporter-adversary-'));
  t.after(() => rmSync(repo, {recursive:true, force:true}));
  for (const path of ['model/dependencies.toml', 'lean-toolchain', 'rust-toolchain.toml', 'vendor/lean4-prod/lean.tar']) {
    mkdirSync(dirname(join(repo, path)), {recursive:true});
    copyFileSync(join(repository, path), join(repo, path));
  }
  for (const path of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    cpSync(join(repository, path), join(repo, path), {recursive:true});
  }
  const cache = join(repo, 'target/lean4-prod-export');
  const executable = join(cache, '.lake/build/bin/prod-export');
  const marker = join(repo, 'planted-executable-ran');
  mkdirSync(dirname(executable), {recursive:true});
  // Adversarial fixture, never an accepted exporter or simulated build result.
  writeFileSync(executable, '#!/bin/sh\nprintf planted > "' + marker + '"\nexit 0\n');
  chmodSync(executable, 0o700);
  return {repo, cache, executable, marker};
}

for (const linked of [false, true]) {
  test(`pinned exporter is genuinely compiled without adopting ${linked ? 'linked' : 'regular'} shared cache`, t => {
    const f = exporterFixture(t), bytes = readFileSync(f.executable);
    if (linked) { renameSync(f.cache, f.cache + '-retained'); symlinkSync(f.cache + '-retained', f.cache); }
    const work = join(f.repo, 'private'); mkdirSync(work, {mode:0o700});
    const result = ensureProdExport(f.repo, work);
    const probe = spawnSync(result.bin, ['--module'], {cwd:result.dir, encoding:'utf8', timeout:30000});
    assert.ifError(probe.error);
    assert(!existsSync(f.marker), 'unproved cached executable must never run');
    assert.equal(result.dir, join(work, 'exporter'));
    assert.notEqual(probe.status, 0);
    assert.match(probe.stderr, /prod-export: unknown or incomplete named-export argument `--module`/);
    assert.deepEqual(readFileSync(f.executable), bytes, 'unowned shared cache remains untouched');
  });
}

for (const [name, mutate, reason] of [
  ['changed archive', f => writeFileSync(join(f.repo, 'vendor/lean4-prod/lean.tar'), 'changed'), /lean.tar/],
  ['coherently resealed archive', f => {
    const path = join(f.repo, 'vendor/lean4-prod/lean.tar'), original = sha(readFileSync(path));
    writeFileSync(path, 'changed');
    const manifest = join(f.repo, 'model/dependencies.toml');
    writeFileSync(manifest, readFileSync(manifest, 'utf8').replace(original, sha(Buffer.from('changed'))));
  }, /dependency authority/],
  ['aliased archive', f => {
    const path = join(f.repo, 'vendor/lean4-prod/lean.tar'); renameSync(path, path + '-retained'); symlinkSync(path + '-retained', path);
  }, /aliased/],
  ['multiply linked archive', f => {
    const path = join(f.repo, 'vendor/lean4-prod/lean.tar'); linkSync(path, path + '-linked');
  }, /singly owned regular/],
  ['changed toolchain', f => writeFileSync(join(f.repo, 'lean-toolchain'), 'leanprover/lean4:nightly\n'), /verified SDK toolchain/],
]) {
  test(`exporter refuses ${name} despite a planted cache`, t => {
    const f = exporterFixture(t); mutate(f);
    assert.throws(() => ensureProdExport(f.repo), reason);
    assert(!existsSync(f.marker));
  });
}

test('private exporter destination and aliased parent cannot be adopted or overwritten', t => {
  const f = exporterFixture(t), work = join(f.repo, 'private');
  assert.throws(() => ensureProdExport(f.repo), /owned exporter workspace required/);
  mkdirSync(work, {mode:0o700});
  mkdirSync(join(work, 'exporter'));
  const retained = join(work, 'exporter/evidence'); writeFileSync(retained, 'preserve');
  assert.throws(() => ensureProdExport(f.repo, work), /EEXIST/);
  assert.equal(readFileSync(retained, 'utf8'), 'preserve');
  const alias = join(f.repo, 'alias'); symlinkSync(work, alias);
  assert.throws(() => ensureProdExport(f.repo, alias), /aliased exporter parent/);
  assert(!existsSync(f.marker));
});

test('exporter refuses nonprivate parents before creating or compiling anything', t => {
  const f = exporterFixture(t), work = join(f.repo, 'private');
  mkdirSync(work, {mode:0o700});
  for (const mode of [0o701, 0o710, 0o720, 0o740, 0o755, 0o777]) {
    chmodSync(work, mode);
    assert.throws(() => ensureProdExport(f.repo, work), /exporter parent must be an owned private directory/);
    assert(!existsSync(join(work, 'exporter')), 'rejection precedes source staging');
    assert(!existsSync(f.marker));
  }
});

test('exporter refuses a private directory belonging to another user', t => {
  const f = exporterFixture(t), work = join(f.repo, 'foreign');
  if (process.getuid() === 0) {
    mkdirSync(work, {mode:0o700});
    chownSync(work, 65534, 65534);
    assert.throws(() => ensureProdExport(f.repo, work), /exporter parent must be an owned private directory/);
    assert(!existsSync(join(work, 'exporter')));
  } else {
    // Root-owned, readable directory: a non-root caller must not accept it
    // merely because mkdir would later fail. No writes may be attempted here.
    assert.throws(() => ensureProdExport(f.repo, '/usr'), /exporter parent must be an owned private directory/);
  }
  assert(!existsSync(f.marker));
});

function fixture(t, prefix = 'prismpm-publication-', owner = 'publication') {
  const work = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(work, {recursive:true, force:true}));
  const directory = {publication:'publication-admission', effects:'browser-effects', custody:'browser-custody'}[owner];
  assert.ok(directory);
  const executable = directory + '-driver';
  const manifest = join(work, 'tests', directory, 'driver/Cargo.toml');
  mkdirSync(join(dirname(manifest), 'src'), {recursive:true});
  writeFileSync(manifest, '[package]\nname="' + executable + '"\nversion="0.1.0"\nedition="2021"\npublish=false\n[workspace]\n');
  writeFileSync(join(dirname(manifest), 'src/main.rs'), 'fn main() {}\n');
  writeFileSync(join(dirname(manifest), 'Cargo.lock'), 'version = 4\n[[package]]\nname="' + executable + '"\nversion="0.1.0"\n');
  const target = createPrivateDriverTarget(work);
  assert(!existsSync(target), 'Cargo initializes the fresh destination');
  run('cargo', ['build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0','--config','build.incremental=false','--manifest-path',manifest], work, {CARGO_TARGET_DIR:target});
  const exporter = join(work, 'exporter');
  mkdirSync(join(exporter, '.lake/build/bin'), {recursive:true});
  writeFileSync(join(exporter, 'lakefile.lean'), exporterManifest);
  // This is cache fixture data, never executed or passed off as a compiler.
  writeFileSync(join(exporter, '.lake/build/bin/prod-export'), 'reconstructible test cache\n');
  const preserved = new Map(['source.lex.tex','proof.json','kernel.ir','guest.wasm'].map(name => [name, Buffer.from(name)]));
  for (const [name, bytes] of preserved) writeFileSync(join(work,name), bytes);
  return {work, target, manifest, exporter, preserved, executable};
}

test('driver targets refuse prior files, directories, dangling links and aliased or nonprivate parents', t => {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-driver-parent-'));
  t.after(() => rmSync(work, {recursive:true, force:true}));
  const target = createPrivateDriverTarget(work);
  writeFileSync(target, 'preserve');
  assert.throws(() => createPrivateDriverTarget(work), /already exists/);
  assert.equal(readFileSync(target, 'utf8'), 'preserve'); rmSync(target);
  mkdirSync(target); assert.throws(() => createPrivateDriverTarget(work), /already exists/); rmSync(target, {recursive:true});
  symlinkSync(join(work, 'absent'), target); assert.throws(() => createPrivateDriverTarget(work), /already exists/); rmSync(target);
  const real = join(work, 'real'), alias = join(work, 'alias'); mkdirSync(real, {mode:0o700}); symlinkSync(real, alias);
  assert.throws(() => createPrivateDriverTarget(alias), /aliased driver parent/);
  chmodSync(real, 0o755); assert.throws(() => createPrivateDriverTarget(real), /owned private directory/);
  assert(!existsSync(join(real, 'driver-target')));
});

test('actual Cargo initializes the private cache and never adopts a previous executable', t => {
  const f = fixture(t);
  assert.match(readFileSync(join(f.target, 'CACHEDIR.TAG'), 'utf8'), /^Signature: 8a477f597d28d172789f06886806bc55/);
  const original = readFileSync(join(f.target, 'debug', f.executable));
  writeFileSync(join(f.target, 'debug', f.executable), 'planted stale compiler');
  assert.throws(() => createPrivateDriverTarget(f.work), /already exists/);
  assert.equal(readFileSync(join(f.target, 'debug', f.executable), 'utf8'), 'planted stale compiler');
  assert(original.length > 0);
});

test('all private driver callers retain locked offline builds and bounded resource options', () => {
  // Source regression guard, not a replacement for each complete real owning
  // component run. Mutations demonstrate that dropping any option is detected.
  const callers = ['view', 'command', 'query', 'journal', 'custody', 'effects', 'presentation', 'operation-journal']
    .map(name => `tests/browser-${name}/compile.mjs`)
    .concat(['sdk/browser/workspace-model-test.mjs', 'sdk/browser/envelope-model-test.mjs']);
  const check = source => {
    assert.match(source, /const driverTarget\s*=\s*createPrivateDriverTarget\(work\)/);
    const calls = [...source.matchAll(/run\('cargo',\s*\[([^;]*?)\],\s*(?:repository|work),\s*\{CARGO_TARGET_DIR:\s*driverTarget\}\)/g)];
    assert.equal(calls.length, 1, 'one actual driver build call');
    const args = calls[0][1];
    assert.match(args, /^'build'/);
    for (const option of ['--locked', '--offline']) assert(args.includes(`'${option}'`), option);
    for (const [option, value] of [['--jobs', '1'], ['--config', 'profile.dev.debug=0'], ['--config', 'build.incremental=false']]) {
      assert(new RegExp(`'${option}',\\s*'${value.replaceAll('.', '\\.')}'`).test(args), value);
    }
  };
  for (const caller of callers) {
    const source = readFileSync(join(repository, caller), 'utf8'); check(source);
    for (const text of ['--locked', '--offline', '--jobs', 'profile.dev.debug=0', 'build.incremental=false']) {
      const changed = source.replace(text, 'REMOVED'); assert.notEqual(changed, source);
      assert.throws(() => check(changed), caller + ': ' + text);
    }
  }
});

test('completed effects and custody tool caches retire under their exact owning paths', t => {
  for (const owner of ['effects', 'custody']) {
    const f = fixture(t, 'prismpm-' + owner + '-', owner);
    const path = join(f.target, 'debug', f.executable), bytes = readFileSync(path);
    const receipt = retireCompletedCompilerCaches(f.work, owner);
    assert.equal(receipt.owner, owner);
    assert.deepEqual(receipt.records[1], {path:'driver-target/debug/' + f.executable,
      byte_length:bytes.length, sha256:sha(bytes)});
    assert(!existsSync(path) && !existsSync(join(f.exporter, '.lake/build')));
    assert(existsSync(f.manifest));
    for (const [name, preserved] of f.preserved) assert.deepEqual(readFileSync(join(f.work, name)), preserved);
    assert.throws(() => retireCompletedCompilerCaches(f.work, owner));
  }
});

test('all twelve private compiler constructions optimize only the fixed SHA-2 package', () => {
  const callers = [
    ...['view', 'command', 'query', 'journal'].map(name => [
      `tests/browser-${name}/compile.mjs`, "join(draft,'driver/Cargo.toml')", 'repository']),
    ...['custody', 'effects', 'presentation', 'operation-journal', 'budget'].map(name => [
      `tests/browser-${name}/compile.mjs`, 'compiler.manifest', 'work']),
    ['tests/publication-admission/compile.mjs', 'compiler.manifest', 'work'],
    ['sdk/browser/workspace-model-test.mjs', "join(repository,'tests/browser-workspace/Cargo.toml')", 'repository'],
    ['sdk/browser/envelope-model-test.mjs', "join(fixture,'driver/Cargo.toml')", 'repository'],
  ];
  const optimization = "'--config','profile.dev.package.sha2.opt-level=3',";
  const check = (source, manifest, cwd) => {
    const calls = [...source.matchAll(/run\('cargo',\s*\[([^;]*?)\],\s*(repository|work),\s*\{CARGO_TARGET_DIR:\s*driverTarget\}\)/g)];
    assert.equal(calls.length, 1, 'one exact private driver construction');
    const args = calls[0][1].replace(/\s+/g, '');
    assert.equal(args, "'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0'," +
      "'--config','build.incremental=false'," + optimization + "'--manifest-path'," + manifest,
      'only the fixed SHA-2 optimization may extend the original argv');
    assert.equal(calls[0][2], cwd, 'original construction working directory');
    const context = {
      draft: '/private/draft', fixture: '/private/fixture', repository: '/source',
      work: '/private/work', compiler: {manifest: '/private/compiler/Cargo.toml'},
      driverTarget: '/private/fresh-driver-target',
    };
    const names = Object.keys(context), values = Object.values(context), recorded = [];
    // Execute the extracted real expression with an inert argument recorder.
    // This checks construction argv, not simulated compiler acceptance.
    Function('run', 'join', ...names, 'return '+calls[0][0])(
      (program, argv, directory, environment) => recorded.push({program, argv, directory, environment}),
      join, ...values);
    const actualManifest = Function('join', ...names, 'return '+manifest)(join, ...values);
    assert.deepEqual(recorded, [{program: 'cargo', argv: [
      'build', '--locked', '--offline', '--jobs', '1', '--config', 'profile.dev.debug=0',
      '--config', 'build.incremental=false', '--config', 'profile.dev.package.sha2.opt-level=3',
      '--manifest-path', actualManifest,
    ], directory: context[cwd], environment: {CARGO_TARGET_DIR: context.driverTarget}}],
    'exact original program, arguments, directory and private target');
    return calls[0][0];
  };
  for (const [caller, manifest, cwd] of callers) {
    const source = readFileSync(join(repository, caller), 'utf8');
    const call = check(source, manifest, cwd), compact = call.replace(/\s+/g, '');
    const changedCalls = [
      compact.replace("'--locked',", ''), compact.replace("'--offline',", ''),
      compact.replace("'--jobs','1'", "'--jobs','2'"),
      compact.replace('profile.dev.debug=0', 'profile.dev.debug=1'),
      compact.replace('build.incremental=false', 'build.incremental=true'),
      compact.replace(optimization, ''),
      compact.replace('profile.dev.package.sha2.opt-level=3', 'profile.dev.package.sha2.opt-level=2'),
      compact.replace('profile.dev.package.sha2.opt-level=3', 'profile.dev.opt-level=3'),
      compact.replace('profile.dev.package.sha2.opt-level=3', 'profile.test.package.sha2.opt-level=3'),
      compact.replace(optimization, optimization + optimization),
      compact.replace(optimization, optimization + "'--config','profile.dev.package.sha2.opt-level=0',"),
      compact.replace(manifest, 'wrongManifest'),
      compact.replace('],'+cwd+',', '],'+(cwd === 'work' ? 'repository' : 'work')+','),
      compact.replace('CARGO_TARGET_DIR:driverTarget', 'CARGO_TARGET_DIR:sharedTarget'),
      compact.replace("run('cargo'", "run('rustc'"),
    ];
    for (const changedCall of changedCalls) {
      assert.notEqual(changedCall, compact, 'mutation must change the real construction: '+caller);
      assert.throws(() => check(source.replace(call, changedCall), manifest, cwd),
        'actual source construction mutation must be rejected: '+caller);
    }
    const target = caller === 'tests/browser-budget/compile.mjs' || caller === 'tests/publication-admission/compile.mjs'
      ? /const driverTarget\s*=\s*join\(work,\s*'driver-target'\)/
      : /const driverTarget\s*=\s*createPrivateDriverTarget\(work\)/;
    assert.match(source, target, 'original private target constructor: '+caller);
    const declaration = target.exec(source)[0];
    assert.throws(() => assert.match(source.replace(declaration, 'const driverTarget = sharedTarget'), target),
      'substituted shared target constructor must be rejected: '+caller);
  }
});

test('serial View and Custody owners preserve fresh tools and every product verification', () => {
  // Supplemental source/argument controls. Genuine owners still execute every
  // original model, kernel, native, Wasm, browser and planted defect assertion.
  const owner = readFileSync(join(repository, 'tests/browser-view/compiler-owner.mjs'), 'utf8');
  const check = source => {
    const call = /run\('cargo',\s*\['build',[\s\S]*?\], work, \{CARGO_TARGET_DIR: target\}\)/.exec(source);
    assert.ok(call, 'one fresh owner construction');
    const recorded = [];
    Function('run', 'join', 'work', 'manifest', 'target', call[0])(
      (...args) => recorded.push(args), join, '/private/owner', 'driver/Cargo.toml', '/private/owner/driver-target');
    assert.deepEqual(recorded, [['cargo', ['build', '--locked', '--offline', '--jobs', '1',
      '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false',
      '--config', 'profile.dev.package.sha2.opt-level=3', '--manifest-path', '/private/owner/driver/Cargo.toml'],
      '/private/owner', {CARGO_TARGET_DIR: '/private/owner/driver-target'}]]);
    assert.match(source, /const target = createPrivateDriverTarget\(work\)/);
    assert.match(source, /exporter = ensureProdExport\(repository, work\)/);
    return call[0];
  };
  const call = check(owner);
  for (const [before, after] of [["'--locked'", "'REMOVED'"], ["'--offline'", "'REMOVED'"],
    ["'--jobs', '1'", "'--jobs', '2'"], ['profile.dev.debug=0', 'profile.dev.debug=2'],
    ['build.incremental=false', 'build.incremental=true'],
    ['profile.dev.package.sha2.opt-level=3', 'profile.dev.opt-level=3']]) {
    assert.ok(call.includes(before));
    assert.throws(() => check(owner.replace(call, call.replace(before, after))), before);
  }
  for (const family of ['view', 'custody']) {
    const compile = readFileSync(join(repository, 'tests/browser-' + family + '/compile.mjs'), 'utf8');
    assert.match(compile, new RegExp("requireCompilerOwner\\(compilerOwner,\\s*'" + family + "'\\)"));
    assert.match(compile, /shared\.runDriver\(/);
    assert.match(compile, /shared\.runExporter\(/);
    assert.match(compile, /if\s*\(shared\)\s*shared\.verify\(\)/);
    const testPath = family === 'view' ? 'sdk/browser/view-model-test.mjs' : 'sdk/browser/credential-custody-test.mjs';
    const testSource = readFileSync(join(repository, testPath), 'utf8');
    assert.match(testSource, new RegExp("createCompilerOwner\\('" + family + "'\\)"));
    assert.match(testSource, /verifyModelMutation\(kind,\s*owner\)/);
    assert.match(testSource, /owner\.close\(\)/);
    assert.match(testSource, /verifyCompilerOwnerSubstitutions\(owner\)/);
    assert.match(testSource, /timeout:\s*3500000/);
  }
});

test('additional serial compiler owners preserve all independent models, mutations and post-retirement evidence', () => {
  const families = [
    {name:'effects', caller:'sdk/browser/effects-test.mjs',
      mutants:"['binding', 'trailing', 'unknown']", invocation:'verifyModelMutation(kind, owner)'},
    {name:'budget', caller:'sdk/browser/budget-model-test.mjs',
      mutants:"['identity', 'policy', 'manifest', 'request', 'coverage', 'order', 'limit']",
      invocation:'verifyModelMutation(kind,inputs,owner,'},
    {name:'operation-journal', caller:'tests/browser-operation-journal/checks.mjs',
      mutants:"['binding', 'trailing', 'reservation', 'payload', 'partition']",
      invocation:'verifyModelMutation(kind, owner)'},
    {name:'presentation', caller:'sdk/browser/presentation.test.mjs',
      mutants:"['binding', 'trailing', 'secretbound', 'secretroute', 'progress']",
      invocation:'verifyModelMutation(kind, owner)'},
    {name:'publication', directory:'publication-admission', caller:'tests/publication-admission/owner.test.mjs',
      mutants:"['binding','coverage','timeline','trailing','preimage','partition']",
      invocation:'verifyModelMutation(kind,inputs,owner)'},
  ];
  for (const family of families) {
    const directory = family.directory ?? 'browser-' + family.name;
    const compile = readFileSync(join(repository, 'tests/' + directory + '/compile.mjs'), 'utf8');
    const caller = readFileSync(join(repository, family.caller), 'utf8');
    const checks = readFileSync(join(repository, 'tests/' + directory + '/checks.mjs'), 'utf8');
    const check = (compiled, owned, oracle) => {
      for (const anchor of ["requireCompilerOwner(compilerOwner, '" + family.name + "')",
        'shared.runDriver(', 'shared.runExporter(', 'if (shared) shared.verify()',
        "run('lake', ['build', 'PrismGenerated'], lean)", 'verifyEvidence',
        "readFileSync(join(verified.root, 'build-manifest.json'))",
        "readFileSync(join(verified.root, 'attestation.json'))"])
        assert(compiled.includes(anchor), 'retained fresh model/tool/proof boundary: ' + anchor);
      for (const anchor of ["createCompilerOwner('" + family.name + "')",
        'verifyCompilerOwnerSubstitutions(owner)', family.mutants, family.invocation,
        'owner.close()', 'build.verifyEvidence()', 'compiler owner closed'])
        assert(owned.includes(anchor), 'complete actual serial owner: ' + anchor);
      assert(oracle.includes('executeWasm('), 'every generated Wasm execution remains');
      assert(oracle.includes('native output mismatch'), 'actual generated native mutants remain');
      assert(oracle.includes('generated Wasm output mismatch'), 'actual generated Wasm mutants remain');
      const close = owned.indexOf('owner.close()');
      assert(close >= 0 && owned.indexOf('build.verifyEvidence()') > close,
        'proof/source checks follow actual compiler retirement');
      const productChecks = [...owned.matchAll(/captureVerificationProducts\(build\.work/g)].map(row => row.index);
      assert.equal(productChecks.length, 2);
      assert(productChecks[0] < close && productChecks[1] > close,
        'actual complete product snapshots surround compiler retirement');
    };
    check(compile, caller, checks);
    for (const anchor of ['shared.runDriver(', 'shared.runExporter(', 'verifyEvidence']) {
      assert.throws(() => check(compile.replaceAll(anchor, 'REMOVED'), caller, checks), anchor);
    }
    for (const anchor of [family.mutants, family.invocation, 'owner.close()', 'build.verifyEvidence()']) {
      assert.throws(() => check(compile, caller.replaceAll(anchor, 'REMOVED'), checks), anchor);
    }
    for (const anchor of ['native output mismatch', 'generated Wasm output mismatch'])
      assert.throws(() => check(compile, caller, checks.replaceAll(anchor, 'REMOVED')), anchor);
    const moved = caller.replace('build.verifyEvidence();', '')
      .replace('owner.close()', '(build.verifyEvidence(), owner.close())');
    assert.notEqual(moved, caller);
    assert.throws(() => check(compile, moved, checks), 'pre-retirement-only proof checks');
  }
});

test('actual Cargo and Lake retirement preserves all non-cache evidence and exact original tool identities', t => {
  const f = fixture(t);
  const binary = readFileSync(join(f.target,'debug/publication-admission-driver'));
  const result = retireCompletedCompilerCaches(f.work, 'publication');
  assert.equal(result.scope, 'completed-private-tool-caches-only');
  assert.deepEqual(result.records[1], {path:'driver-target/debug/publication-admission-driver', byte_length:binary.length, sha256:sha(binary)});
  assert.deepEqual(JSON.parse(readFileSync(join(f.work,'compiler-cache-retirement.json'))), result);
  for (const [name, bytes] of f.preserved) assert.deepEqual(readFileSync(join(f.work,name)),bytes);
  assert(existsSync(f.manifest));
  assert.deepEqual(readFileSync(join(f.exporter,'lakefile.lean')), exporterManifest);
  assert.deepEqual(result.records[2], {path:'exporter/lakefile.lean', byte_length:exporterManifest.length, sha256:sha(exporterManifest)});
  assert(!existsSync(join(f.target,'debug/publication-admission-driver')));
  assert(!existsSync(join(f.exporter,'.lake/build')));
  assert.throws(() => retireCompletedCompilerCaches(f.work, 'publication'));
});

test('invalid owner, prefix, tag, aliases and existing evidence reject before any deletion', t => {
  const f = fixture(t), driver = join(f.target,'debug/publication-admission-driver');
  assert.throws(() => retireCompletedCompilerCaches(f.work, 'unknown'), /unregistered/);
  assert.throws(() => retireCompletedCompilerCaches(f.work, 'budget'), /owned work prefix/);
  const tag = join(f.target,'CACHEDIR.TAG'), original = readFileSync(tag);
  writeFileSync(tag, 'not a Cargo cache\n');
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'), /cache tag/);
  writeFileSync(tag, original);
  renameSync(f.target, f.target + '-retained'); symlinkSync(f.target + '-retained', f.target);
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'), /aliased/);
  rmSync(f.target); renameSync(f.target + '-retained',f.target);
  renameSync(f.manifest,f.manifest + '-retained'); symlinkSync(f.manifest + '-retained',f.manifest);
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'));
  rmSync(f.manifest); renameSync(f.manifest + '-retained',f.manifest);
  const exporterBinary = join(f.exporter,'.lake/build/bin/prod-export');
  renameSync(exporterBinary,exporterBinary + '-retained');
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'));
  assert(existsSync(driver), 'late missing input must not remove the earlier Cargo cache');
  renameSync(exporterBinary + '-retained',exporterBinary);
  writeFileSync(join(f.work,'compiler-cache-retirement.json'),'original evidence');
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'), /overwrite/);
  assert.equal(readFileSync(join(f.work,'compiler-cache-retirement.json'),'utf8'),'original evidence');
  assert(existsSync(driver) && existsSync(join(f.exporter,'.lake/build/bin/prod-export')));
  for (const [name,bytes] of f.preserved) assert.deepEqual(readFileSync(join(f.work,name)),bytes);
});

test('removing the owned-prefix guard is detected by actual cleanup behavior', async t => {
  const f = fixture(t, 'unowned-cache-');
  assert.throws(() => retireCompletedCompilerCaches(f.work,'publication'), /owned work prefix/);
  const path = new URL('../tests/browser-view/driver-cache.mjs', import.meta.url);
  const source = readFileSync(path,'utf8');
  const guard = "  assert.match(basename(work), new RegExp('^prismpm-' + owner + '-[A-Za-z0-9]+$'), 'owned work prefix required');";
  assert.equal(source.split(guard).length,2);
  const mutation = source.replace(guard,'').replace("'./compile.mjs'", JSON.stringify(new URL('../tests/browser-view/compile.mjs',import.meta.url).href));
  const changed = await import('data:text/javascript;base64,' + Buffer.from(mutation).toString('base64'));
  assert.throws(() => assert.throws(() => changed.retireCompletedCompilerCaches(f.work,'publication'), /owned work prefix/), /Missing expected exception/);
  assert(!existsSync(join(f.target,'debug/publication-admission-driver')));
  for (const [name,bytes] of f.preserved) assert.deepEqual(readFileSync(join(f.work,name)),bytes);
});
