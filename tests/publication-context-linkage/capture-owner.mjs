// Fresh private source compilation and actual OCI replay; never SDK acceptance.
import assert from 'node:assert/strict';
import {chmodSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync,
  readlinkSync, realpathSync, renameSync, symlinkSync, unlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, relative, resolve, sep} from 'node:path';
import {captureCompilerArtifact} from '../browser-view/compiler-artifact.mjs';
import {runPublicationCapture} from '../browser-view/compile.mjs';
import {prerequisite} from '../browser-view/prerequisites.mjs';
import {repository, run, sha} from './compile.mjs';
import {executeWasm} from './execute.mjs';
import {verifyCaptureOracle} from './capture-oracle.mjs';

const excluded = new Set(['.git', 'target', '.lexlean', '.prism']);
const completeOwners = new WeakSet();
export function requireCaptureCompletion(value) {
  assert.ok(completeOwners.has(value), 'actual fresh capture and generated replay completion required');
  return value;
}
const captureInventoryRole = Symbol('captured actual release tree');
export function sourceInventory(root, role = null) {
  assert.ok(role === null || role === captureInventoryRole);
  const records = new Map(); let bytes = 0;
  function visit(path) {
    const absolute = join(root, path), stat = lstatSync(absolute);
    assert.ok(records.size < 100000, 'bounded complete capture-owner source inventory');
    if (stat.isSymbolicLink()) {
      const target = readlinkSync(absolute), resolved = resolve(dirname(absolute), target);
      assert.ok(!target.startsWith('/') && resolved.startsWith(root + sep), 'repository-local source alias only');
      assert.equal(realpathSync(absolute), resolved, 'source aliases cannot chain or escape');
      records.set(path, {kind:'link', target, resolved:relative(root, resolved)});
    } else if (stat.isDirectory()) {
      records.set(path, {kind:'directory'});
      // The actual producer's Cargo oracle cache is reconstructible, not source
      // or captured release evidence. Every other output path is retained.
      if (role === captureInventoryRole && path === 'producer-source/target') return;
      for (const name of readdirSync(absolute).sort()) visit(join(path, name));
    } else {
      assert.ok(stat.isFile() && stat.nlink === 1 && stat.size <= 268435456,
        'bounded singly linked capture-owner source: ' + path);
      bytes += stat.size; assert.ok(bytes <= 536870912, 'bounded source-build closure, not a model payload cap');
      records.set(path, {kind:'file', bytes:stat.size, sha256:sha(readFileSync(absolute)), executable:!!(stat.mode & 0o100)});
    }
  }
  for (const name of readdirSync(root).sort())
    if (role === captureInventoryRole || !excluded.has(name)) visit(name);
  for (const record of records.values()) if (record.kind === 'link')
    assert.ok(records.has(record.resolved), 'every source alias resolves inside the captured inventory');
  return records;
}

function stageSource(work) {
  const records = sourceInventory(repository), root = join(work, 'source'); mkdirSync(root, {mode:0o700});
  for (const [path, record] of records) {
    const target = join(root, path);
    if (record.kind === 'directory') mkdirSync(target, {mode:0o700});
    else if (record.kind === 'link') symlinkSync(record.target, target);
    else {
      const bytes = readFileSync(join(repository, path)); assert.equal(sha(bytes), record.sha256);
      writeFileSync(target, bytes, {flag:'wx', mode:record.executable ? 0o500 : 0o400});
    }
  }
  const verify = () => {
    assert.deepEqual(sourceInventory(repository), records, 'complete live capture source remained frozen');
    assert.deepEqual(sourceInventory(root), records, 'complete private capture source remained frozen');
  };
  verify(); return {root, records, verify};
}

function captureExecutable(work, source) {
  const target = join(work, 'cargo-target');
  assert.equal(lstatSync(target, {throwIfNoEntry:false}), undefined, 'never adopt a cached capture executable');
  const output = run('cargo', ['test', '--locked', '--offline', '-p', 'prismpm', '-p', 'repo-conformance', '--lib', '--no-run',
    '--message-format=json', '--jobs', '1', '--config', 'profile.dev.debug=0', '--config', 'build.incremental=false'],
  source.root, {CARGO_TARGET_DIR:target});
  source.verify();
  writeFileSync(join(work, 'cargo.jsonl'), output, {flag:'wx', mode:0o444});
  const emitted = output.trim().split('\n').map(line => JSON.parse(line));
  function capture(name, role) {
    const artifacts = emitted.filter(row =>
      row.reason === 'compiler-artifact' && row.target.name === name && row.profile.test && row.executable);
    assert.equal(artifacts.length, 1, 'one fresh actual Rust library test executable');
    assert.equal(artifacts[0].fresh, false, 'fresh source compilation required');
    const original = artifacts[0].executable;
    assert.ok(original.startsWith(target + sep));
    assert.equal(realpathSync(original), original);
    const stat = lstatSync(original); assert.ok(stat.isFile() && stat.nlink === 1);
    const digest = sha(readFileSync(original)), retained = join(work, role + '-built-tests');
    assert.equal(lstatSync(retained, {throwIfNoEntry:false}), undefined);
    // Relocate the actual newly emitted inode out of the reconstructible cache,
    // then authenticate it and a distinct execution copy. No cached binary is adopted.
    renameSync(original, retained);
    const after = lstatSync(retained);
    assert.equal(after.dev, stat.dev); assert.equal(after.ino, stat.ino);
    assert.equal(sha(readFileSync(retained)), digest);
    const owner = captureCompilerArtifact(work, retained, role);
    assert.equal(owner.evidence.original.sha256, digest);
    writeFileSync(join(work, role + '-executable-relocation.json'), JSON.stringify({
      cargoArtifact:relative(work, original), retained:relative(work, retained),
      device:String(stat.dev), inode:String(stat.ino), sha256:digest}) + '\n', {flag:'wx', mode:0o444});
    return owner;
  }
  const owner = capture('prismpm', 'publication-capture');
  const gate = capture('repo_conformance', 'publication-gate');
  source.verify(); owner.verify(); gate.verify();
  const fixtureOutput = run(owner.path,
    ['--exact', 'controller::release_tests::readonly_source_copy_is_mutable_only_in_the_private_fixture', '--nocapture'], source.root);
  assert.match(fixtureOutput, /test result: ok\. 1 passed; 0 failed; 0 ignored;/);
  writeFileSync(join(work, 'readonly-fixture.stdout'), fixtureOutput, {flag:'wx', mode:0o444});
  const gateTests = [
    'compiler_phase_diagnostics_are_closed_bounded_and_not_acceptance',
    'complete_diagnostics_are_formatted_before_the_transport_write',
    'complete_json_records_survive_competing_stdout_and_stderr_writers',
    'diagnostics_precede_libtest_summary',
    'exact_owner_inventory_rejects_an_actual_removed_capture_test',
    'failure_excerpts_are_bounded_and_preserve_both_stream_ends',
    'file_rows_are_closed_unique_nonempty_and_reconciled',
    'invented_stdout_completion_does_not_become_a_registered_test',
    'selected_file_inventory_is_closed_and_unique',
    'selected_paths_reject_aliases_nonregular_and_omitted_files_before_execution',
    'unavailable_or_oversized_diagnostics_do_not_become_acceptance_failures',
  ].map(name => 'cases::node_suite::tests::' + name);
  const gateList = run(gate.path, ['cases::node_suite::tests::', '--list'], source.root);
  assert.deepEqual(gateList.split('\n').filter(line => line.length > 0),
    [...gateTests.map(name => name + ': test'), '11 tests, 0 benchmarks'],
    'complete current exact-gate regression inventory before execution');
  writeFileSync(join(work, 'exact-gate.list'), gateList, {flag:'wx', mode:0o444});
  source.verify(); owner.verify(); gate.verify();
  const gateOutput = run(gate.path, ['cases::node_suite::tests::', '--nocapture'], source.root);
  assert.match(gateOutput, /test result: ok\. 11 passed; 0 failed; 0 ignored; 0 measured;/);
  writeFileSync(join(work, 'exact-gate.stdout'), gateOutput, {flag:'wx', mode:0o444});
  writeFileSync(join(work, 'exact-gate-evidence.json'), JSON.stringify(gate.evidence) + '\n', {flag:'wx', mode:0o444});
  assert.equal(readFileSync(join(target, 'CACHEDIR.TAG'), 'utf8').split('\n')[0],
    'Signature: 8a477f597d28d172789f06886806bc55');
  source.verify(); owner.verify(); gate.verify();
  run('cargo', ['clean', '--manifest-path', join(source.root, 'Cargo.toml'), '--target-dir', target], source.root);
  source.verify(); owner.verify(); gate.verify(); return owner;
}

function replay(build, oracle) {
  const native = join(build.work, 'actual-capture-native.tsv');
  writeFileSync(native, 'ActualCapturedRelease\t' + oracle.linkage.request.toString('hex') + '\t'
    + oracle.linkage.response.toString('hex') + '\n', {flag:'wx', mode:0o444});
  for (const standard of [true, false]) build.runNative(standard, [native]);
  const linkage = build.withWasm('wasm', bytes => executeWasm(bytes, [oracle.linkage]));
  const context = join(build.work, 'actual-context.tsv');
  writeFileSync(context, oracle.context.id + '\t' + oracle.context.request.toString('hex') + '\t'
    + oracle.context.response.toString('hex') + '\t' + oracle.context.admission.toString('hex') + '\t'
    + oracle.context.preimage.toString('hex') + '\n', {flag:'wx', mode:0o444});
  for (const standard of [true, false]) build.runNative(standard, [context], true);
  const fields = build.withWasm('context-fields-wasm', bytes => executeWasm(bytes, [oracle.context]));
  const admission = build.withWasm('admission-wasm', bytes => executeWasm(bytes, [{...oracle.context, request:oracle.context.admission}]));
  build.unchanged(); return {linkage, fields, admission};
}

export async function verifyCapturedFactory(t) {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-publication-capture-'));
  let source, executable, oracle, finished = false;
  try {
    await prerequisite(t, 'fresh complete source-built capture executable has private custody', () => {
      source = stageSource(work); executable = captureExecutable(work, source);
      const path = executable.path, original = readFileSync(path);
      try {
        chmodSync(path, 0o700); const changed = Buffer.from(original); changed[8] ^= 1; writeFileSync(path, changed);
        assert.throws(() => executable.verify(), /immutable private compiler/);
      } finally {writeFileSync(path, original); chmodSync(path, 0o500);}
      executable.verify(); source.verify();
    });
    const output = join(work, 'capture'); mkdirSync(output, {mode:0o700});
    await prerequisite(t, 'occupied capture output is refused before actual process execution', () => {
      const planted = join(output, 'planted'); writeFileSync(planted, 'not a fresh capture', {flag:'wx'});
      try {
        executable.verify();
        assert.throws(() => runPublicationCapture(executable.path, work, output), /fresh empty capture output required/);
        assert.equal(lstatSync(join(work, 'capture.stdout'), {throwIfNoEntry:false}), undefined);
      } finally {unlinkSync(planted); executable.verify(); source.verify();}
    });
    await prerequisite(t, 'actual source-free release and 22 changed/missing blob refusals execute', () => {
      executable.verify(); source.verify();
      try {runPublicationCapture(executable.path, work, output);}
      finally {executable.verify(); source.verify();}
    });
    await prerequisite(t, 'independent retained-source metadata and all eight preimages agree', () => {
      oracle = verifyCaptureOracle(output, executable.evidence.private.sha256, source.root);
      const snapshotPath = join(output, 'captured/build/lexlean/snapshot.json'), snapshotBytes = readFileSync(snapshotPath);
      const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
      for (const path of ['../outside', '/outside', 'src/./Publication.lex.tex', 'src//Publication.lex.tex']) {
        const changed = JSON.parse(snapshotBytes);
        changed.modules.find(module => module.name === 'Publication').source.path = path;
        try {
          writeFileSync(snapshotPath, JSON.stringify(canonical(changed)) + '\n');
          assert.throws(() => verifyCaptureOracle(output, executable.evidence.private.sha256, source.root), /canonical confined capture path/);
        } finally {writeFileSync(snapshotPath, snapshotBytes);}
        verifyCaptureOracle(output, executable.evidence.private.sha256, source.root);
      }
      for (const path of ['metadata.request', 'context.request', 'context.preimage', 'linkage-0.preimage',
        'linkage-1.preimage', 'linkage-2.preimage', 'linkage-3.preimage', 'linkage-4.preimage',
        'linkage-5.preimage', 'linkage-6.preimage', 'sdk-lock.json']) {
        const file = join(output, path), original = readFileSync(file), changed = Buffer.from(original);
        changed[changed.length - 1] ^= 1;
        try {writeFileSync(file, changed); assert.throws(() => verifyCaptureOracle(output, executable.evidence.private.sha256, source.root));}
        finally {writeFileSync(file, original);}
        verifyCaptureOracle(output, executable.evidence.private.sha256, source.root);
      }
    });
    const retained = sourceInventory(output, captureInventoryRole);
    const verify = () => {executable.verify(); source.verify();
      assert.deepEqual(sourceInventory(output, captureInventoryRole), retained, 'complete retained actual capture tree');
      assert.deepEqual(verifyCaptureOracle(output, executable.evidence.private.sha256, source.root), oracle);};
    verify();
    for (const name of ['.git', 'target', '.lexlean', '.prism']) {
      const path = join(output, name); assert.equal(lstatSync(path, {throwIfNoEntry:false}), undefined);
      try {
        writeFileSync(path, 'unmodeled captured root input', {flag:'wx'});
        assert.throws(verify, /complete retained actual capture tree/);
      } finally {unlinkSync(path);}
      verify();
    }
    const evidence = {schema:'prismpm/private-publication-capture-factory/1', completeApplicationAccepted:false,
      source:Object.fromEntries(source.records), executable:executable.evidence,
      actualCapture:oracle.evidence, retainedTree:Object.fromEntries(retained),
      reconstructibleCacheOnly:['producer-source/target']};
    const receipt = join(work, 'capture-factory-evidence.json');
    writeFileSync(receipt, JSON.stringify(evidence) + '\n', {flag:'wx', mode:0o444});
    t.diagnostic(JSON.stringify({scope:'conditional-private-capture-only', path:receipt, sha256:sha(readFileSync(receipt))}));
    finished = true; return Object.freeze({work, output, oracle, verify, evidence,
      receipt:Object.freeze({path:receipt, sha256:sha(readFileSync(receipt))})});
  } finally {
    if (!finished) process.stderr.write('Retained incomplete actual capture owner ' + work + '\n');
  }
}

export async function verifyCapturedPublicationLinkage(t, build) {
  assert.ok(build && typeof build.unchanged === 'function', 'fresh still-owned component build required');
  build.unchanged();
  const capture = await verifyCapturedFactory(t);
  let execution;
  await prerequisite(t, 'actual capture agrees in generated native/no_std, context and admission Wasm', () => {
    capture.verify(); build.unchanged();
    try {execution = replay(build, capture.oracle);}
    finally {capture.verify(); build.unchanged();}
  });
  const evidence = {schema:'prismpm/private-publication-capture-owner/1', completeApplicationAccepted:false,
    factory:capture.receipt, execution, compiler:build.compilerTools, ir:build.generation.ir_sha256};
  const receipt = join(capture.work, 'capture-owner-evidence.json');
  writeFileSync(receipt, JSON.stringify(evidence) + '\n', {flag:'wx', mode:0o444});
  const result = Object.freeze({path:receipt, sha256:sha(readFileSync(receipt))}); completeOwners.add(result);
  t.diagnostic(JSON.stringify(result)); return result;
}
