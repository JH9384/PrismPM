import { readSemantic, writeSemantic } from './semantic-source.mjs';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, truncateSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { canonical, captureProjection, compare, prepare, publish, sha, sha256Base32, sourceManifest, validateCapture } from './bootstrap-evidence.mjs';
import { historicalInvocation, qemuArguments, RUNTIME, verifyRuntime } from '../sdk/bootstrap/runner.mjs';

const OLD = '4'.repeat(64);
const NEW = '5'.repeat(64);
const lock = compiler => `spec = "lexlean/lock/1"\nlanguage = "1.1"\ncompiler_semantics = "${compiler}"\n`;
const manifest = { files: [{ kind: 'file', path: 'source.lex.tex', sha256: '6'.repeat(64), size: 10 }], schema: 'prismpm/source-manifest/1' };
const base32Vectors = [
  ['zero', '00'.repeat(32), 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA===='],
  ['ff', 'ff'.repeat(32), '777777777777777777777777777777777777777777777777777Q===='],
  ['mixed', '000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f', 'AAAQEAYEAUDAOCAJBIFQYDIOB4IBCEQTCQKRMFYYDENBWHA5DYPQ===='],
  ['regression', '08de670ba6fe6cf458c0f1b07ad948d9fa5030a1462b1e6a2c45572628689084', 'BDPGOC5G7ZWPIWGA6GYHVWKI3H5FAMFBIYVR42RMIVLSMKDISCCA====']
];

test('RFC4648 padded Base32 preserves all 32 SHA256 bytes and rejects malformed digests', () => {
  for (const [, value, expected] of base32Vectors) {
    assert.equal(sha256Base32(value), expected);
    assert.deepEqual(execFileSync('/usr/bin/base32', ['--decode'], { input: expected, timeout: 10000 }), Buffer.from(value, 'hex'));
  }
  for (const invalid of ['', '0'.repeat(63), '0'.repeat(65), 'FF'.repeat(32), 'g'.repeat(64), null, 0]) {
    assert.throws(() => sha256Base32(invalid), /invalid SHA256/);
  }
});

function reseal(capture) {
  capture.check.snapshot_id = sha(`${canonical(capture.snapshot)}\n`);
  capture.check.semantic_id = capture.snapshot.semantic_id;
  capture.build.source_id = capture.snapshot.source_id;
  capture.build.semantic_id = capture.snapshot.semantic_id;
  capture.model.provenance = {
    ...capture.model.provenance,
    compiler_semantics_id: capture.snapshot.compiler_semantics_id,
    semantic_id: capture.snapshot.semantic_id,
    snapshot_id: capture.check.snapshot_id,
    source_id: capture.snapshot.source_id
  };
  capture.check.model_id = sha(canonical(capture.model));
  capture.manifest.inputs = {
    emitter_semantics_id: capture.model.provenance.emitter_semantics_id,
    lexlean_semantic_id: capture.snapshot.semantic_id,
    lexlean_source_id: capture.snapshot.source_id,
    model_id: capture.check.model_id,
    schema: 'prismpm/build-inputs/1'
  };
  capture.build.build_id = sha(canonical(capture.manifest.inputs));
  const base = `.prism/build/${capture.build.build_id}`;
  capture.build.manifest_path = `${base}/manifest.json`;
  capture.build.model_path = `${base}/model.prism.json`;
  capture.manifest.files = [['lexlean/snapshot.json', capture.snapshot], ['model.prism.json', capture.model]]
    .map(([path, value]) => {
      const bytes = canonical(value) + (path === 'lexlean/snapshot.json' ? '\n' : '');
      return { byte_length: Buffer.byteLength(bytes), kind: 'artifact', path, sha256: sha(bytes) };
    });
  return capture;
}

function fixture(compiler = OLD) {
  const definition = (name, value) => ({ body: { kind: 'string', value }, kind: 'definition', name, parameters: [], result: { kind: 'string' } });
  return reseal({
    build: { build_id: '', manifest_path: '', model_path: '', schema: 'prismpm/build-result/1', semantic_id: '', source_id: '' },
    check: { entity_count: 1, model_id: '', schema: 'prismpm/check-result/1', semantic_id: '', snapshot_id: '' },
    lock: lock(compiler),
    manifest: { files: [], inputs: {}, schema: 'prismpm/build-manifest/1' },
    model: { architecture: { components: ['one'] }, provenance: { emitter_semantics_id: '7'.repeat(64), facet_packages: [{ package: 'fixture', content_id: '8'.repeat(64) }] }, schema: 'prismpm/model-document/1' },
    snapshot: {
      compiler_semantics_id: compiler, language: '1.1', lexicon_closure: { packages: ['one'] },
      modules: [{ name: 'Foundation.Core', imports: [], linked_ir: { term: 1, proof: ['refl'] },
        semantic: { declarations: [definition('sourceManifestSha256Base32', sha256Base32(sha(canonical(manifest)))), definition('sourceManifestFileCount', '1')] },
        source: { path: 'source.lex.tex', sha256: sha('source') } }],
      semantic_id: compiler === OLD ? 'a'.repeat(64) : 'b'.repeat(64),
      source_id: compiler === OLD ? 'c'.repeat(64) : 'd'.repeat(64), spec: 'lexlean/semantic-snapshot/1'
    }
  });
}

test('different reviewed compiler identities retain complete semantic and model equality', () => {
  const before = fixture();
  const after = fixture(NEW);
  const evidence = compare(before, after, manifest, lock(OLD), lock(NEW));
  assert.notEqual(evidence.prior.semantic_id, evidence.current.semantic_id);
  assert.notEqual(evidence.prior.snapshot_id, evidence.current.snapshot_id);
  assert.equal(evidence.shared_content_digest.length, 71);
  assert.equal(evidence.shared_model_digest.length, 71);
});

test('owning comparison rejects resealed semantic, proof, closure, source, import and nested-field mutations', () => {
  for (const mutate of [
    capture => { capture.snapshot.modules[0].linked_ir.term = 2; },
    capture => { capture.snapshot.modules[0].linked_ir.proof = ['admit']; },
    capture => { capture.snapshot.lexicon_closure.packages.push('extra'); },
    capture => { capture.snapshot.modules[0].source.sha256 = '0'.repeat(64); },
    capture => { capture.snapshot.modules[0].imports.push('Hidden'); },
    capture => { capture.snapshot.modules[0].unrecognized = true; },
    capture => { capture.snapshot.modules.reverse(); capture.snapshot.modules.push(structuredClone(capture.snapshot.modules[0])); }
  ]) {
    const changed = fixture(NEW);
    mutate(changed);
    reseal(changed);
    assert.throws(() => compare(fixture(), changed, manifest, lock(OLD), lock(NEW)), /complete bootstrap semantic content differs/);
  }
});

test('owning comparison rejects projected domain and facet drift after all hashes are resealed', () => {
  for (const mutate of [
    capture => { capture.model.architecture.components = ['different']; },
    capture => { capture.model.provenance.facet_packages[0].content_id = '9'.repeat(64); },
    capture => { capture.model.extra = true; }
  ]) {
    const changed = fixture(NEW);
    mutate(changed);
    reseal(changed);
    assert.throws(() => compare(fixture(), changed, manifest, lock(OLD), lock(NEW)), /complete projected model content differs/);
  }
});

test('owning capture validator rejects stale and substituted provenance or unrecognized envelopes', () => {
  for (const mutate of [
    capture => { capture.check.snapshot_id = '0'.repeat(64); },
    capture => { capture.check.model_id = '0'.repeat(64); },
    capture => { capture.build.source_id = '0'.repeat(64); },
    capture => { capture.manifest.inputs.emitter_semantics_id = '0'.repeat(64); capture.build.build_id = sha(canonical(capture.manifest.inputs)); },
    capture => { capture.manifest.files[0].sha256 = '0'.repeat(64); },
    capture => { capture.manifest.files.push(capture.manifest.files[0]); },
    capture => { capture.check.extra = true; },
    capture => { capture.manifest.extra = true; },
    capture => { capture.check.semantic_id = [capture.check.semantic_id]; },
    capture => { capture.snapshot.extra = true; },
    capture => { capture.snapshot.compiler_semantics_id = '0'.repeat(64); },
    capture => { capture.model.schema = 'unknown'; reseal(capture); },
    capture => { capture.manifest.inputs.schema = 'unknown'; capture.build.build_id = sha(canonical(capture.manifest.inputs)); }
  ]) {
    const changed = fixture();
    mutate(changed);
    assert.throws(() => validateCapture(changed, OLD));
  }
});

test('exact accepted compiler and projection lock changes cannot be caller substitutions', () => {
  assert.throws(() => compare(fixture(), fixture(NEW), manifest, lock('0'.repeat(64)), lock(NEW)), /unexpected compiler/);
  assert.throws(() => compare(fixture(), fixture(NEW), manifest, lock(OLD), lock('0'.repeat(64))), /unexpected compiler/);
  const changed = fixture(NEW);
  changed.lock += 'extra = "changed"\n';
  assert.throws(() => compare(fixture(), changed, manifest, lock(OLD), lock(NEW)), /lock changed beyond compiler/);
  changed.lock = lock(NEW) + `compiler_semantics = "${NEW}"\n`;
  assert.throws(() => compare(fixture(), changed, manifest, lock(OLD), lock(NEW)), /ambiguous/);
});

test('modeled manifest digest and count must match the supplied exact source closure', () => {
  const changed = structuredClone(manifest);
  changed.files[0].sha256 = '9'.repeat(64);
  assert.throws(() => compare(fixture(), fixture(NEW), changed, lock(OLD), lock(NEW)), /sourceManifestSha256Base32/);
  const before = fixture();
  const after = fixture(NEW);
  for (const capture of [before, after]) {
    capture.snapshot.modules[0].semantic.declarations[1].body.value = '2';
    reseal(capture);
  }
  assert.throws(() => compare(before, after, manifest, lock(OLD), lock(NEW)), /sourceManifestFileCount/);
});

test('coherently resealed alternate digest encodings and names cannot replace canonical Base32 binding', () => {
  const value = sha256Base32(sha(canonical(manifest)));
  for (const mutate of [
    declaration => { declaration.name = 'sourceManifestDigest'; },
    declaration => { declaration.body.value = `sha256:${sha(canonical(manifest))}`; },
    declaration => { declaration.body.value = value.toLowerCase(); },
    declaration => { declaration.body.value = value.slice(0, -4); },
    declaration => { declaration.body.value = 'A'.repeat(52) + '===='; },
    declaration => { declaration.body.value = value.slice(0, -5) + 'B===='; }
  ]) {
    const before = fixture(), after = fixture(NEW);
    for (const capture of [before, after]) {
      mutate(capture.snapshot.modules[0].semantic.declarations[0]);
      reseal(capture);
    }
    assert.throws(() => compare(before, after, manifest, lock(OLD), lock(NEW)), /sourceManifestSha256Base32/);
  }
});

for (const route of ['platform-runner', 'explicit-QEMU-diagnostic']) test(`actual pinned 0.2 SDK accepts Base32, rejects raw-08 hex and detects rebuilt tampering (${route})`, { timeout: 120000 }, () => {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  const work = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-legacy-test.'));
  const run = (command, args, options = {}) => execFileSync(command, args, { timeout: 30000, maxBuffer: 64 * 1024 * 1024, ...options });
  try {
    const archive = join(root, '.prism/cache/bootstrap/prismpm-0.2.0-x86_64-unknown-linux-gnu.tar.gz');
    assert.equal(sha(readFileSync(archive)), 'f3dd999f5618db154fa06222a06f9de95d86e1dbf683954426ea91c974cbe24c');
    run('tar', ['--extract', '--gzip', '--file', archive, '--directory', work, '--no-same-owner', '--no-same-permissions']);
    const prior = join(work, 'prismpm-0.2.0-x86_64-unknown-linux-gnu/prismpm');
    assert.equal(sha(readFileSync(prior)), 'fed990f31a1cdc5f819f5a99e79bc441c7db11f7c8ea45c748d9cec1097ee8e6');
    const runPrior = args => {
      const invocation = historicalInvocation(prior, args);
      if (route === 'explicit-QEMU-diagnostic') {
        verifyRuntime(RUNTIME, process.arch === 'arm64' ? 'arm64' : 'amd64');
        return run(join(RUNTIME, 'qemu-x86_64-static'), qemuArguments(prior, args), { env: invocation.environment });
      }
      return run(invocation.command, invocation.args, { env: invocation.environment });
    };
    const envelope = join(work, 'envelope');
    mkdirSync(envelope);
    run('git', ['-C', root, 'archive', '--output', join(work, 'source.tar'), 'f378fd3a8dc5711cb4b22cec9ee2f874353628c3']);
    run('tar', ['--extract', '--file', join(work, 'source.tar'), '--directory', envelope]);
    prepare(root, envelope);
    const core = join(envelope, 'stdlib/src/Foundation/Core.lex.tex');
    const coreText = readFileSync(core, 'utf8');
    const payload = readSemantic(coreText);
    for (const [name, value] of base32Vectors) payload.declarations.push({
      body: { kind: 'string', value: sha256Base32(value) }, kind: 'definition', name: `base32Probe_${name}`, parameters: [], result: { kind: 'string' }
    });
    const save = () => { writeFileSync(core, writeSemantic(coreText, payload)); };
    const capture = () => {
      writeFileSync(join(work, 'check.json'), runPrior(['--project', envelope, 'check', '--json']));
      writeFileSync(join(work, 'build.json'), runPrior(['--project', envelope, 'build', '--json']));
      captureProjection(envelope, join(work, 'check.json'), join(work, 'build.json'), join(work, 'capture.json'));
      return JSON.parse(readFileSync(join(work, 'capture.json'), 'utf8'));
    };
    save();
    const accepted = capture();
    const declarations = accepted.snapshot.modules.find(module => module.name === 'Foundation.Core').semantic.declarations;
    for (const [name, value, expected] of base32Vectors) {
      const actual = declarations.find(declaration => declaration.name === `base32Probe_${name}`).body.value;
      assert.equal(actual, expected);
      assert.deepEqual(run('/usr/bin/base32', ['--decode'], { input: actual }), Buffer.from(value, 'hex'));
    }
    const actualManifest = JSON.parse(readFileSync(join(envelope, 'source-manifest.json'), 'utf8'));
    assert.deepEqual(actualManifest, sourceManifest(root));
    const binding = declarations.find(declaration => declaration.name === 'sourceManifestSha256Base32').body.value;
    assert.equal(run('/usr/bin/base32', ['--decode'], { input: binding }).toString('hex'), sha(canonical(actualManifest)));
    compare(accepted, accepted, actualManifest, accepted.lock, accepted.lock);

    const modeledDigest = payload.declarations.find(declaration => declaration.name === 'sourceManifestSha256Base32');
    modeledDigest.body.value = base32Vectors[0][2];
    save();
    const tampered = capture();
    assert.throws(() => compare(tampered, tampered, actualManifest, tampered.lock, tampered.lock), /sourceManifestSha256Base32/);

    modeledDigest.name = 'sourceManifestDigest';
    modeledDigest.body.value = `sha256:${base32Vectors[3][1]}`;
    save();
    assert.throws(() => runPrior(['--project', envelope, 'check', '--json']), error => {
      const result = JSON.parse(error.stdout.toString('utf8'));
      return error.status === 1 && result.diagnostic.code === 'PP2001'
        && result.diagnostic.causes.some(cause => cause.code === 'LLL1003' && cause.message.includes('`08`'));
    });
  } finally { rmSync(work, { recursive: true, force: true }); }
});

test('capture reads real artifact closure and rejects file tampering, extra files, and symlinks', () => {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-capture-test.'));
  try {
    const capture = fixture();
    const base = join(root, `.prism/build/${capture.build.build_id}`);
    mkdirSync(join(base, 'lexlean'), { recursive: true });
    writeFileSync(join(root, 'source.lex.tex'), 'source');
    writeFileSync(join(root, 'lexlean.lock'), capture.lock);
    writeFileSync(join(root, 'check.json'), `${canonical(capture.check)}\n`);
    writeFileSync(join(root, 'build.json'), `${canonical(capture.build)}\n`);
    for (const [path, value] of [['manifest.json', capture.manifest], ['model.prism.json', capture.model], ['lexlean/snapshot.json', capture.snapshot]]) {
      writeFileSync(join(base, path), canonical(value) + (path === 'lexlean/snapshot.json' ? '\n' : ''));
    }
    const run = () => captureProjection(root, join(root, 'check.json'), join(root, 'build.json'), join(root, 'capture.json'));
    run();
    assert.equal(readFileSync(join(root, 'capture.json'), 'utf8'), canonical(capture));
    writeFileSync(join(root, 'check.json'), canonical(capture.check));
    assert.throws(run, /noncanonical evidence/);
    writeFileSync(join(root, 'check.json'), `${canonical(capture.check).slice(0, -1)},"entity_count":1}\n`);
    assert.throws(run, /noncanonical evidence/);
    writeFileSync(join(root, 'check.json'), `${canonical(capture.check)}\n`);
    writeFileSync(join(root, 'source.lex.tex'), 'tampered');
    assert.throws(run, /snapshot source digest/);
    writeFileSync(join(root, 'source.lex.tex'), 'source');
    writeFileSync(join(base, 'extra'), 'extra');
    assert.throws(run, /artifact closure/);
    rmSync(join(base, 'extra'));
    writeFileSync(join(base, 'model.prism.json'), '{}');
    assert.throws(run, /artifact bytes/);
    rmSync(join(base, 'model.prism.json'));
    assert.throws(run, /ENOENT/);
    symlinkSync(join(root, 'source.lex.tex'), join(base, 'model.prism.json'));
    assert.throws(run, /symlink/);
    rmSync(join(base, 'model.prism.json'));
    execFileSync('mkfifo', [join(base, 'model.prism.json')]);
    assert.throws(run, /not a bounded regular file/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('preparation rejects untracked helpers and publication rejects changed tracked source without replacing evidence', () => {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-publication-test.'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'source'), 'one');
    execFileSync('git', ['-C', root, 'add', 'source']);
    const work = join(root, 'work');
    mkdirSync(join(work, 'envelope'), { recursive: true });
    assert.throws(() => prepare(root, join(work, 'envelope')), /helper is not tracked/);
    writeFileSync(join(work, 'envelope/source-manifest.json'), canonical(sourceManifest(root)));
    mkdirSync(join(root, 'target'));
    writeFileSync(join(root, 'target/bootstrap-evidence.json'), 'old-evidence');
    writeFileSync(join(root, 'source'), 'changed');
    assert.throws(() => publish(root, work), /tracked source changed before evidence publication/);
    assert.equal(readFileSync(join(root, 'target/bootstrap-evidence.json'), 'utf8'), 'old-evidence');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('tracked source manifest changes for changed bytes, added tracked paths and symlink targets', () => {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-source-test.'));
  try {
    execFileSync('git', ['init', '--quiet', root]);
    writeFileSync(join(root, 'source'), 'one');
    execFileSync('git', ['-C', root, 'add', 'source']);
    const first = canonical(sourceManifest(root));
    writeFileSync(join(root, 'source'), 'two');
    assert.notEqual(canonical(sourceManifest(root)), first);
    symlinkSync('source', join(root, 'link'));
    execFileSync('git', ['-C', root, 'add', 'link']);
    const second = canonical(sourceManifest(root));
    rmSync(join(root, 'link'));
    symlinkSync('elsewhere', join(root, 'link'));
    assert.notEqual(canonical(sourceManifest(root)), second);
    truncateSync(join(root, 'source'), 0);
    assert.equal(sourceManifest(root).files.find(file => file.path === 'source').size, 0);
    truncateSync(join(root, 'source'), 64 * 1024 * 1024 + 1);
    assert.throws(() => sourceManifest(root), /not a bounded regular file/);
    assert.throws(() => canonical(JSON.parse('{"n":9007199254740993}')), /unsafe JSON integer/);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function bootstrapLockProbe(source, status = 0) {
  const block = source.match(/^if ! cargo run[^\n]*[\s\S]*?\$root\/vendor\/lexlean\/Cargo\.toml[\s\S]*?^fi$/m);
  assert(block, 'bootstrap must retain its owning LexLean lock command');
  const directory = mkdtempSync(join(tmpdir(), 'prismpm-bootstrap-lock-probe.'));
  try {
    const root = join(directory, 'source with spaces');
    const work = join(directory, 'private work with spaces');
    const bin = join(directory, 'bin');
    const capture = join(directory, 'argv.json');
    mkdirSync(join(root, 'vendor/lexlean'), { recursive: true });
    mkdirSync(join(work, 'envelope'), { recursive: true });
    mkdirSync(bin);
    // Invocation/fault-injection fixture only; it is not a compiler or
    // bootstrap acceptance oracle. Execute the actual unchanged shell block.
    writeFileSync(join(bin, 'cargo'), `#!${process.execPath}\nimport fs from 'node:fs';\nfs.writeFileSync(process.env.CAPTURE, JSON.stringify(process.argv.slice(2)));\nprocess.exit(Number(process.env.PROBE_STATUS));\n`, { mode: 0o755 });
    const script = join(directory, 'lock.sh');
    writeFileSync(script, `set -euo pipefail\nroot=$1\nwork=$2\nenvelope="$work/envelope"\n${block[0]}\n`);
    const result = spawnSync('/bin/bash', [script, root, work], {
      timeout: 10000, maxBuffer: 65536,
      env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, CAPTURE: capture,
        PROBE_STATUS: String(status), CARGO_TARGET_DIR: join(root, 'vendor/lexlean/target') }
    });
    assert.equal(result.error, undefined);
    return { result, argv: JSON.parse(readFileSync(capture, 'utf8')), root, work };
  } finally { rmSync(directory, { recursive: true, force: true }); }
}

function validateBootstrapLockProbe({ result, argv, root, work }) {
  assert.equal(result.status, 0, result.stderr?.toString());
  assert.deepEqual(argv, ['run', '--locked', '--offline', '--quiet', '--manifest-path',
    join(root, 'vendor/lexlean/Cargo.toml'), '--target-dir', join(work, 'lexlean-target'),
    '--', '--project', join(work, 'envelope/lexlean.toml'), 'lock']);
}

test('bootstrap LexLean lock keeps all flags and isolates compilation from the sealed package', () => {
  const source = readFileSync(new URL('./bootstrap-verify.sh', import.meta.url), 'utf8');
  validateBootstrapLockProbe(bootstrapLockProbe(source));
});

test('bootstrap LexLean lock preserves its owning failure boundary', () => {
  const source = readFileSync(new URL('./bootstrap-verify.sh', import.meta.url), 'utf8');
  const { result, argv } = bootstrapLockProbe(source, 77);
  assert.equal(result.status, 1);
  assert.equal(argv.at(-1), 'lock');
});

test('bootstrap LexLean lock regression rejects real target and flag mutations', () => {
  const source = readFileSync(new URL('./bootstrap-verify.sh', import.meta.url), 'utf8');
  for (const [before, after] of [
    [' --locked', ''],
    [' --offline', ''],
    [' --target-dir "$work/lexlean-target"', ''],
    [' --target-dir "$work/lexlean-target"', ' --target-dir "$root/vendor/lexlean/target"']
  ]) {
    assert.equal(source.split(before).length, before.startsWith(' --target-dir') ? 2 : 6);
    const mutated = source.replace(before, after);
    assert.notEqual(mutated, source);
    assert.throws(() => validateBootstrapLockProbe(bootstrapLockProbe(mutated)), { code: 'ERR_ASSERTION' });
  }
});
