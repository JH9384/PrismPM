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
  mkdirSync(join(cache, 'Prod'));
  writeFileSync(join(cache, 'Prod/Emit.lean'), 'untrusted cached source\n');
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
    assert.equal(readFileSync(join(f.cache, 'Prod/Emit.lean'), 'utf8'), 'untrusted cached source\n');
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
  const directory = {publication:'publication-admission', effects:'browser-effects', custody:'browser-custody',
    'session-payloads':'browser-session-payloads',
    'operation-journal':'browser-operation-journal', presentation:'browser-presentation',
    'semantic-presentation':'browser-semantic-presentation',
    'dynamic-choice':'browser-dynamic-choice',
    view:'browser-view', journal:'browser-journal', query:'browser-query', command:'browser-command'}[owner];
  assert.ok(directory);
  const executable = (['view','journal','query','command'].includes(owner) ? 'browser-workspace-' + owner : directory) + '-driver';
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
  const poison = '#!/bin/sh\nprintf planted-driver\n';
  writeFileSync(join(f.target, 'debug', f.executable), poison);
  const build = ['build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0','--config','build.incremental=false','--manifest-path',f.manifest];
  run('cargo', build, f.work, {CARGO_TARGET_DIR:f.target});
  assert.equal(run(join(f.target, 'debug', f.executable), [], f.work), 'planted-driver',
    'Cargo freshness alone does not authenticate an existing executable');
  assert.throws(() => createPrivateDriverTarget(f.work), /already exists/);
  assert.equal(readFileSync(join(f.target, 'debug', f.executable), 'utf8'), poison);
  assert(original.length > 0);
  const fresh = mkdtempSync(join(tmpdir(), 'prismpm-driver-fresh-'));
  t.after(() => rmSync(fresh, {recursive:true, force:true}));
  const target = createPrivateDriverTarget(fresh);
  run('cargo', build, f.work, {CARGO_TARGET_DIR:target});
  assert.equal(run(join(target, 'debug', f.executable), [], f.work), '');
  assert.throws(() => createPrivateDriverTarget(fresh), /already exists/);
});

test('all private driver callers retain locked offline builds and bounded resource options', () => {
  // Source regression guard, not a replacement for each complete real owning
  // component run. Mutations demonstrate that dropping any option is detected.
  const callers = ['view', 'command', 'query', 'journal', 'custody', 'effects', 'presentation', 'operation-journal']
    .map(name => `tests/browser-${name}/compile.mjs`)
    .concat(['sdk/browser/workspace-model-test.mjs', 'sdk/browser/envelope-model-test.mjs',
      'tests/browser-session/compile.mjs','tests/publication-admission/compile.mjs']);
  const sharedFamilies = new Map(['presentation', 'session']
    .map(name => [`tests/browser-${name}/compile.mjs`, name])
    .concat([['tests/publication-admission/compile.mjs','publication']]));
  const registration = family => family === 'publication'
    ? {directory:'publication-admission',executable:'publication-admission-driver'}
    : {directory:'browser-'+family,executable:'browser-'+family+'-driver'};
  const shared = readFileSync(join(repository, 'tests/browser-view/compiler-owner.mjs'), 'utf8');
  const optimized = new Set(['view','command','query'].map(name=>`tests/browser-${name}/compile.mjs`));
  const check = (source, target = 'driverTarget', hashOptimized = false) => {
    assert.ok(['driverTarget', 'target'].includes(target));
    assert.match(source, new RegExp(`const ${target}\\s*=\\s*createPrivateDriverTarget\\(work\\)`));
    const calls = [...source.matchAll(new RegExp(
      `run\\('cargo',\\s*\\[([^;]*?)\\],\\s*(?:repository|work),\\s*\\{CARGO_TARGET_DIR:\\s*${target}\\}\\)`, 'g'))];
    assert.equal(calls.length, 1, 'one actual driver build call');
    const args = calls[0][1];
    assert.match(args, /^'build'/);
    for (const option of ['--locked', '--offline']) assert(args.includes(`'${option}'`), option);
    for (const [option, value] of [['--jobs', '1'], ['--config', 'profile.dev.debug=0'], ['--config', 'build.incremental=false']]) {
      assert(new RegExp(`'${option}',\\s*'${value.replaceAll('.', '\\.')}'`).test(args), value);
    }
    if(hashOptimized){
      const setting="'--config','profile.dev.package.sha2.opt-level=3'";
      assert.equal(args.split(setting).length,2,'one fixed SHA-256 package override');
      assert.doesNotMatch(args,/profile\.(?:dev|test)\.opt-level/,'no broad optimization override');
    }
  };
  const delegation = family => new RegExp(
    `createCompilerOwner\\(\\s*'${family}'\\s*,\\s*captureCompilerInputs\\(\\s*'${family}'\\s*\\)\\s*\\)`);
  const checkShared = (source, owner, family) => {
    assert.match(source, /from '\.\.\/browser-view\/compiler-owner\.mjs'/);
    assert.doesNotMatch(source, /\b(?:createPrivateDriverTarget|ensureProdExport)\s*\(/,
      'shared callers cannot construct additional compiler tools');
    const builds = [...source.matchAll(/run\('cargo',\s*\[([^;]*?)\],\s*[^;]*?\{CARGO_TARGET_DIR:\s*[^}]+\}\)/g)];
    assert.equal(builds.length, (source.match(/\brun\('cargo'/g) ?? []).length,
      'every direct Cargo invocation must be a generated product build');
    for (const [, args] of builds) {
      assert.match(args, /'--release'/, 'shared callers retain only generated product builds');
      assert.doesNotMatch(args, /driver/, 'a release flag cannot disguise a direct compiler-driver build');
    }
    assert.match(source, delegation(family), 'exact family and complete captured input delegation');
    assert.match(source, new RegExp(`requireCompilerOwner\\(\\s*compilerOwner\\s*,\\s*'${family}'\\s*\\)`),
      'borrowed owners require the same admitted family');
    const selected=registration(family);
    assert.match(owner, new RegExp(`${family}:\\s*Object\\.freeze\\(\\{\\s*directory:\\s*'${selected.directory}',\\s*executable:\\s*'${selected.executable}'\\s*\\}\\)`),
      'registered family binds its exact driver directory and executable');
    check(owner, 'target');
  };
  for (const caller of callers) {
    const source = readFileSync(join(repository, caller), 'utf8'), family = sharedFamilies.get(caller);
    if (family === undefined) check(source,'driverTarget',optimized.has(caller)); else checkShared(source, shared, family);
    for (const text of ['--locked', '--offline', '--jobs', 'profile.dev.debug=0', 'build.incremental=false']) {
      const owningSource = family === undefined ? source : shared;
      const changed = owningSource.replace(text, 'REMOVED'); assert.notEqual(changed, owningSource);
      assert.throws(() => family === undefined ? check(changed,'driverTarget',optimized.has(caller)) : checkShared(source, changed, family),
        caller + ': ' + text);
    }
    if(optimized.has(caller)){
      for(const replacement of ['REMOVED','profile.dev.package.sha2.opt-level=2','profile.dev.opt-level=3']){
        const changed=source.replace('profile.dev.package.sha2.opt-level=3',replacement);
        assert.notEqual(changed,source);
        assert.throws(()=>check(changed,'driverTarget',true),caller+': '+replacement);
      }
    }
    if (family !== undefined) {
      const call = delegation(family).exec(source)[0];
      for (const changedCall of [call.replace('createCompilerOwner', 'REMOVED'),
        call.replace('captureCompilerInputs', 'REMOVED'), call.replace(`'${family}'`, "'wrong-family'")]) {
        const changed = source.replace(call, changedCall); assert.notEqual(changed, source);
        assert.throws(() => checkShared(changed, shared, family), caller + ': owner delegation');
      }
      const missingTarget = shared.replace('createPrivateDriverTarget(work)', 'REMOVED(work)');
      assert.notEqual(missingTarget, shared);
      assert.throws(() => checkShared(source, missingTarget, family), caller + ': private target');
      const wrongBorrowedFamily = source.replace(new RegExp(
        `requireCompilerOwner\\(\\s*compilerOwner\\s*,\\s*'${family}'\\s*\\)`), "requireCompilerOwner(compilerOwner,'wrong-family')");
      assert.notEqual(wrongBorrowedFamily, source);
      assert.throws(() => checkShared(wrongBorrowedFamily, shared, family), caller + ': borrowed family');
      for (const additional of ['createPrivateDriverTarget(work)', 'ensureProdExport(repository, work)',
        `run('cargo', ['build', '--locked', '--offline', '--manifest-path', join(repository, 'tests/browser-${family}/driver/Cargo.toml')], work, {CARGO_TARGET_DIR: driverTarget})`,
        `run('cargo', ['build', '--locked', '--offline', '--release', '--manifest-path', join(repository, 'tests/browser-${family}/driver/Cargo.toml')], work, {CARGO_TARGET_DIR: driverTarget})`]) {
        assert.throws(() => checkShared(source + '\n' + additional + ';\n', shared, family),
          caller + ': additional direct compiler construction');
      }
      for (const field of [`'${registration(family).directory}'`, `'${registration(family).executable}'`]) {
        const changed = shared.replace(field, "'wrong-family'"); assert.notEqual(changed, shared);
        assert.throws(() => checkShared(source, changed, family), caller + ': registered ' + field);
      }
    }
  }
  // Supplemental source guards only: the complete real OC09 owner and actual
  // private-copy cleanup-interference controls establish runtime behavior.
  // In particular, checking inputs before close does not cover cleanup itself.
  const publication = readFileSync(join(repository, 'tests/publication-admission/compile.mjs'), 'utf8');
  const publicationOwner = readFileSync(join(repository, 'tests/publication-admission/owner.test.mjs'), 'utf8');
  const coldRetirement = "    const cacheRetirement = ownsCompiler ? compiler.close() : null;";
  const coldInputs = "    assert.deepEqual(frozenInputs(), inputs, 'complete publication inputs changed during compiler retirement');";
  const coldModels = "    for (const [module, bytes] of originals) assert.deepEqual(readFileSync(sourcePath(module)), bytes, 'post-retirement source ' + module);";
  const coldManifest = "    assert.deepEqual(readFileSync(join(verified.root, 'build-manifest.json')), manifestBytes);";
  const coldAttestation = "    assert.deepEqual(readFileSync(join(verified.root, 'attestation.json')), attestationBytes);";
  const sharedRetirement = " retirementAttempted=true;const cacheRetirement=compiler.close();retired=true;";
  const sharedInputs = " assert.deepEqual(frozenInputs(),inputs,'complete publication inputs changed during final compiler retirement');";
  const checkRetirement = (source, owner) => {
    const coldStart = source.indexOf(coldRetirement);
    const coldEnd = source.indexOf('    completed = true;', coldStart);
    assert(coldStart >= 0 && coldEnd > coldStart, 'cold cleanup precedes completed return');
    const postClose = source.slice(coldStart, coldEnd);
    for (const guard of [coldInputs, coldModels, coldManifest, coldAttestation]) {
      assert(postClose.includes(guard), 'cold post-retirement source/proof check: ' + guard);
    }
    const sharedStart = owner.indexOf(sharedRetirement);
    const sharedEnd = owner.indexOf(' const evidence=', sharedStart);
    assert(sharedStart >= 0 && sharedEnd > sharedStart, 'shared cleanup precedes acceptance evidence');
    assert(owner.slice(sharedStart, sharedEnd).includes(sharedInputs), 'shared complete inputs rechecked after cleanup');
  };
  checkRetirement(publication, publicationOwner);
  for (const guard of [coldInputs, coldModels, coldManifest, coldAttestation]) {
    // Manifest and attestation checks also exist before retirement. Removing
    // or moving just the final one must refuse, not accept the earlier check.
    const start = publication.indexOf(coldRetirement);
    const prefix = publication.slice(0, start), suffix = publication.slice(start);
    assert(suffix.includes(guard));
    for (const changed of [prefix + suffix.replace(guard, ''), prefix + guard + '\n' + suffix.replace(guard, '')]) {
      assert.notEqual(changed, publication);
      assert.throws(() => checkRetirement(changed, publicationOwner), 'removed or pre-close cold guard');
    }
  }
  for (const changed of [publicationOwner.replace(sharedInputs, ''),
    publicationOwner.replace(sharedRetirement, sharedInputs + '\n' + sharedRetirement).replace(sharedRetirement + '\n' + sharedInputs, sharedRetirement)]) {
    assert.notEqual(changed, publicationOwner);
    assert.throws(() => checkRetirement(publication, changed), 'removed or pre-close shared guard');
  }
});

test('completed effects, custody and session-payload tool caches retire under their exact owning paths', t => {
  for (const owner of ['effects', 'custody', 'session-payloads']) {
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

test('all remaining retained browser fixtures retire only their exact tool caches', t => {
  for (const owner of ['operation-journal','presentation','semantic-presentation','dynamic-choice','view','journal','query','command']) {
    const f = fixture(t, 'prismpm-' + owner + '-', owner);
    const source = join(repository, 'tests/browser-' + owner + '/driver/Cargo.toml');
    const original = readFileSync(source);
    const binary = readFileSync(join(f.target, 'debug', f.executable));
    const result = retireCompletedCompilerCaches(f.work, owner);
    assert.equal(result.owner, owner);
    const external = ['view','journal','query','command'].includes(owner);
    assert.deepEqual(result.records[0], {path:external ? 'repository/tests/browser-' + owner + '/driver/Cargo.toml'
      : 'tests/browser-' + owner + '/driver/Cargo.toml',
    byte_length:external ? original.length : readFileSync(f.manifest).length,
    sha256:sha(external ? original : readFileSync(f.manifest))});
    assert.deepEqual(result.records[1], {path:'driver-target/debug/' + f.executable,
      byte_length:binary.length, sha256:sha(binary)});
    assert.deepEqual(readFileSync(source), original, 'source manifest must never be modified by retirement');
    assert(!existsSync(join(f.target, 'debug', f.executable)) && !existsSync(join(f.exporter, '.lake/build')));
    for (const [name, bytes] of f.preserved) assert.deepEqual(readFileSync(join(f.work, name)), bytes);
    assert.throws(() => retireCompletedCompilerCaches(f.work, owner), /overwrite/);
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
  const check = (source, manifest, cwd, shared = false) => {
    const calls = [...source.matchAll(/run\('cargo',\s*\[([^;]*?)\],\s*(repository|work),\s*\{CARGO_TARGET_DIR:\s*(?:driverTarget|target)\}\)/g)];
    assert.equal(calls.length, 1, 'one exact private driver construction');
    const args = calls[0][1].replace(/\s+/g, '');
    assert.equal(args, "'build','--locked','--offline','--jobs','1','--config','profile.dev.debug=0'," +
      "'--config','build.incremental=false'," + optimization + "'--manifest-path'," + manifest,
      'only the fixed SHA-2 optimization may extend the original argv');
    assert.equal(calls[0][2], cwd, 'original construction working directory');
    const context = {
      draft: '/private/draft', fixture: '/private/fixture', repository: '/source',
      work: '/private/work', compiler: {manifest: '/private/compiler/Cargo.toml'},
      driverTarget: '/private/fresh-driver-target', target: '/private/fresh-driver-target', manifest: 'driver/Cargo.toml',
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
    ], directory: context[cwd], environment: {CARGO_TARGET_DIR: shared ? context.target : context.driverTarget}}],
    'exact original program, arguments, directory and private target');
    return calls[0][0];
  };
  for (const [caller, manifest, cwd] of callers) {
    const actual = readFileSync(join(repository, caller), 'utf8');
    const shared = ['tests/browser-presentation/compile.mjs','tests/publication-admission/compile.mjs'].includes(caller);
    const source = shared ? readFileSync(join(repository, 'tests/browser-view/compiler-owner.mjs'), 'utf8') : actual;
    const selectedManifest = shared ? 'join(work,manifest)' : manifest;
    const selectedCwd = shared ? 'work' : cwd;
    const call = check(source, selectedManifest, selectedCwd, shared), compact = call.replace(/\s+/g, '');
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
      compact.replace(selectedManifest, 'wrongManifest'),
      compact.replace('],'+selectedCwd+',', '],'+(selectedCwd === 'work' ? 'repository' : 'work')+','),
      compact.replace('CARGO_TARGET_DIR:'+(shared?'target':'driverTarget'), 'CARGO_TARGET_DIR:sharedTarget'),
      compact.replace("run('cargo'", "run('rustc'"),
    ];
    for (const changedCall of changedCalls) {
      assert.notEqual(changedCall, compact, 'mutation must change the real construction: '+caller);
      assert.throws(() => check(source.replace(call, changedCall), selectedManifest, selectedCwd, shared),
        'actual source construction mutation must be rejected: '+caller);
    }
    const target = shared ? /const target\s*=\s*createPrivateDriverTarget\(work\)/
      : caller === 'tests/browser-budget/compile.mjs'
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
      invocation:'verifyModelMutation(kind, build)'},
    {name:'publication', directory:'publication-admission', caller:'tests/publication-admission/owner.test.mjs',
      mutants:"['binding','coverage','timeline','trailing','preimage','partition']",
      invocation:'verifyModelMutation(kind,inputs,compiler)'},
  ];
  for (const family of families) {
    const directory = family.directory ?? 'browser-' + family.name;
    const compile = readFileSync(join(repository, 'tests/' + directory + '/compile.mjs'), 'utf8');
    const caller = readFileSync(join(repository, family.caller), 'utf8');
    const checks = readFileSync(join(repository, 'tests/' + directory + '/checks.mjs'), 'utf8');
    const ownedSource = family.name === 'presentation' ? caller+'\n'+checks : caller;
    const central = ['presentation', 'publication'].includes(family.name);
    const compilerName = central ? 'compiler' : 'owner';
    const driverName = central ? 'compiler' : 'shared';
    const closeAnchor = family.name === 'publication'
      ? 'retirementAttempted=true;const cacheRetirement=compiler.close();retired=true;'
      : family.name === 'budget' ? 'const retirement=owner.close();' : 'const retirement = owner.close();';
    const creation = family.name === 'publication'
      ? "createCompilerOwner('publication',captureCompilerInputs('publication'))"
      : "createCompilerOwner('" + family.name + "')";
    const check = (compiled, owned, oracle) => {
      for (const anchor of ["requireCompilerOwner(compilerOwner, '" + family.name + "')",
        driverName+'.runDriver(', driverName+'.runExporter(',
        central ? (family.name === 'publication' ? 'compiler.verify()' : "requireCompilerOwner(compiler, 'presentation')") : 'if (shared) shared.verify()',
        "run('lake', ['build', 'PrismGenerated'], lean)", 'verifyEvidence',
        "readFileSync(join(verified.root, 'build-manifest.json'))",
        "readFileSync(join(verified.root, 'attestation.json'))"])
        assert(compiled.includes(anchor), 'retained fresh model/tool/proof boundary: ' + anchor);
      for (const anchor of [creation,
        'verifyCompilerOwnerSubstitutions('+compilerName+')', family.mutants, family.invocation,
        closeAnchor, 'build.verifyEvidence()', 'compiler owner closed'])
        assert(owned.includes(anchor), 'complete actual serial owner: ' + anchor);
      assert(oracle.includes('executeWasm('), 'every generated Wasm execution remains');
      assert(oracle.includes('native output mismatch'), 'actual generated native mutants remain');
      assert(oracle.includes('generated Wasm output mismatch'), 'actual generated Wasm mutants remain');
      const close = owned.indexOf(closeAnchor);
      assert(close >= 0 && owned.indexOf('build.verifyEvidence()', close + closeAnchor.length) > close,
        'proof/source checks follow actual compiler retirement');
      const productChecks = [...owned.matchAll(/captureVerificationProducts\(build\.work/g)].map(row => row.index);
      assert.equal(productChecks.length, 2);
      assert(productChecks[0] < close && productChecks[1] > close,
        'actual complete product snapshots surround compiler retirement');
    };
    check(compile, ownedSource, checks);
    for (const anchor of [driverName+'.runDriver(', driverName+'.runExporter(', 'verifyEvidence']) {
      assert.throws(() => check(compile.replaceAll(anchor, 'REMOVED'), ownedSource, checks), anchor);
    }
    for (const anchor of [family.mutants, family.invocation, closeAnchor, 'build.verifyEvidence()']) {
      assert.throws(() => check(compile, ownedSource.replaceAll(anchor, 'REMOVED'), checks), anchor);
    }
    for (const anchor of ['native output mismatch', 'generated Wasm output mismatch'])
      assert.throws(() => check(compile, ownedSource, checks.replaceAll(anchor, 'REMOVED')), anchor);
    // Mutation owners may also verify their own products earlier. Target the
    // serial owner's actual post-retirement barrier, not the first call.
    const barrier = 'build.verifyEvidence();';
    const postClose = ownedSource.indexOf(barrier, ownedSource.indexOf(closeAnchor) + closeAnchor.length);
    assert(postClose >= 0, 'actual post-retirement proof barrier exists');
    const removed = ownedSource.slice(0, postClose) + ownedSource.slice(postClose + barrier.length);
    assert.throws(() => check(compile, removed, checks), 'missing post-retirement proof checks');
    const moved = removed
      .replace(closeAnchor, 'build.verifyEvidence();\n'+closeAnchor);
    assert.notEqual(moved, ownedSource);
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
