// Runtime preservation and malformed transport tests, not full SDK acceptance.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {chmodSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {bootstrapFixture} from './sdk-bootstrap-retention-fixture.mjs';
import {bootstrapNames, canonical, hash, readOriginal, validateBootstrapRetention} from './sdk-bootstrap-retention.mjs';
import {captureCommand, nativeInvocations, releaseContext, validateCommand} from './release-gate-evidence.mjs';
import {captureEvidence, packEvidence} from './sdk-release-evidence.mjs';
import {retainTwoRuns} from './sdk-vv-run.mjs';
const require = createRequire('/opt/prismpm/oracles/package.json'), {load} = require('js-yaml');
const revision = 'a'.repeat(40), image = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:' + 'b'.repeat(64);
const context = releaseContext(revision, 'amd64', image, '123', '1');
const sourceContext = {...context, image_reference: null};
const temporary = t => {const path = mkdtempSync(join(tmpdir(), 'release-original-test-')); t.after(() => rmSync(path, {recursive: true, force: true})); return path;};
const put = (path, name, value) => writeFileSync(join(path, name), Buffer.isBuffer(value) || typeof value === 'string' ? value : canonical(value));
const descriptor = (path, bytes) => ({path, byte_length: bytes.length, sha256: hash(bytes)});
const rawVv = () => Buffer.from(canonical({schema: 'prismpm/vv-evidence/1', commit: revision, status: 'passed', gates: Array.from({length: 15}, (_, i) => i + 1)}));
function commandFixture(root, prefix, command, args, status, stdout = 'unit-only output\n', stderr = '') {
  const out = Buffer.from(stdout), err = Buffer.from(stderr);
  put(root, `${prefix}.stdout`, out); put(root, `${prefix}.stderr`, err);
  put(root, `${prefix}.json`, {command, arguments: args, status, signal: null, orphaned: false, overflow: false, interrupted: null,
    stdout: descriptor(`${prefix}.stdout`, out), stderr: descriptor(`${prefix}.stderr`, err)});
}
function sourceFixture(root) {
  for (const run of [1, 2]) {
    const bootstrap = bootstrapFixture(revision), raw = rawVv();
    commandFixture(root, `source-${run}`, 'just', ['vv'], 0);
    put(root, `source-${run}-vv.json`, raw);
    const rows = [...bootstrap.files].map(([name, bytes]) => {
      const path = `run-${run}-${name}`; put(root, path, bytes); return descriptor(path, bytes);
    });
    put(root, `source-${run}-result.json`, {schema: 'prismpm/source-vv-retention/1', scope: 'original-source-run-only',
      ...sourceContext, run, vv: descriptor(`source-${run}-vv.json`, raw), bootstrap: {run, files: rows}});
  }
}
function nativeFixture(root) {
  const source = '/unit-only/source';
  for (const [prefix, args, status] of nativeInvocations(source, image, 'amd64', 1000, 1000)) commandFixture(root, prefix, 'docker', args, status);
  put(root, 'native-result.json', {schema: 'prismpm/native-equivalence-retention/1', scope: 'original-native-sdk-comparison-only',
    ...context, root: source, uid: 1000, gid: 1000, archive: descriptor('prismpm-0.3.0-x86_64-unknown-linux-gnu.tar.gz', Buffer.from('fixture archive'))});
}

test('actual child execution preserves exact binary stdout, stderr and nonzero status', async t => {
  const root = temporary(t), args = ['-e', 'process.stdout.write(Buffer.from([0,255,10]));process.stderr.write("original error\\n");process.exitCode=7'];
  const row = await captureCommand(root, 'actual', process.execPath, args, root);
  assert.equal(row.status, 7); assert.deepEqual(readFileSync(join(root, 'actual.stdout')), Buffer.from([0,255,10]));
  assert.equal(readFileSync(join(root, 'actual.stderr'), 'utf8'), 'original error\n');
  const files = new Map(readdirSync(root).map(name => [name, readFileSync(join(root, name))]));
  validateCommand(files, 'actual', process.execPath, args, 7);
  assert.throws(() => validateCommand(files, 'actual', process.execPath, args, 0));
  files.set('actual.stdout', Buffer.from('substituted'));
  assert.throws(() => validateCommand(files, 'actual', process.execPath, args, 7));
  await assert.rejects(captureCommand(root, 'actual', process.execPath, ['-e', 'throw Error("must not execute")'], root));
});

test('actual stderr maximum is retained and one extra byte kills execution without accepting truncation', {timeout: 30000}, async t => {
  for (const extra of [0, 1]) {
    const root = temporary(t), count = 64 * 1024 * 1024 + extra;
    const pending = captureCommand(root, 'bounded', process.execPath, ['-e', `process.stderr.write(Buffer.alloc(${count},65))`], root);
    if (extra) await assert.rejects(pending, /bound/); else assert.equal((await pending).status, 0);
    const record = JSON.parse(readFileSync(join(root, 'bounded.json')));
    assert.equal(record.overflow, extra === 1);
    const bytes = readFileSync(join(root, 'bounded.stderr'));
    assert(bytes.length <= 64 * 1024 * 1024); assert(bytes.every(byte => byte === 65));
    if (!extra) assert.equal(bytes.length, count);
  }
});

test('a real child cannot substitute its capture file for the observed pipe bytes', async t => {
  const root = temporary(t), path = join(root, 'changed.stdout');
  await assert.rejects(captureCommand(root, 'changed', process.execPath, ['-e',
    `require('node:fs').writeFileSync(${JSON.stringify(path)},'forged bytes not emitted');process.stdout.write('observed')`], root), /observed process bytes/);
  assert(!existsSync(join(root, 'changed.json')), 'changed output must not receive a completed command record');
});

test('actual interruption retains the failed command and terminates its resistant owned process', {timeout: 12000}, t => {
  const root = temporary(t), ready = join(root, 'ready');
  const wrapper = `
    import {existsSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs', import.meta.url).href)};
    const timer = setInterval(() => {if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGTERM');}},10);
    try {await captureCommand(${JSON.stringify(root)},'cancelled',process.execPath,['-e',
      ${JSON.stringify(`process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(ready)},String(process.pid));setInterval(()=>{},1000)`)}],${JSON.stringify(root)}); process.exitCode=1;}
    catch(error){if(error.message!=='gate interrupted')throw error;}
    finally{clearInterval(timer);}
  `;
  execFileSync(process.execPath, ['--input-type=module', '-e', wrapper], {timeout: 10000});
  const row = JSON.parse(readFileSync(join(root, 'cancelled.json')));
  assert.equal(row.interrupted, 'SIGTERM'); assert.equal(row.signal, 'SIGKILL'); assert.equal(row.status, null);
  const pid = Number(readFileSync(ready, 'utf8'));
  assert.throws(() => process.kill(pid, 0), error => error.code === 'ESRCH');
});

function backgroundCommand(root, resistant) {
  const grandchild = resistant
    ? `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(${JSON.stringify(join(root, 'grandchild'))},String(process.pid));process.stdout.write('grandchild-ready\\n');setInterval(()=>{},1000)`
    : `setTimeout(()=>{process.stdout.write('late stdout\\n');process.stderr.write('late stderr\\n');},250)`;
  return `const child=require('node:child_process').spawn(process.execPath,['-e',${JSON.stringify(grandchild)}],{stdio:['ignore',1,2]});child.unref();require('node:fs').writeFileSync(${JSON.stringify(join(root, 'leader'))},String(process.pid));process.stdout.write('leader-exit\\n');process.exit(0)`;
}
function killOwnedLeader(root) {
  if (!existsSync(join(root, 'leader'))) return;
  const pid = Number(readFileSync(join(root, 'leader'), 'utf8'));
  assert(Number.isSafeInteger(pid) && pid > 1);
  try {process.kill(-pid, 'SIGKILL');} catch (error) {if (error.code !== 'ESRCH') throw error;}
}
// SIGKILL delivery is asynchronous: a killed process stays runnable until the
// kernel tears it down, so wait (bounded) for it to become a zombie or vanish.
async function noExecutingProcess(path) {
  const pid = Number(readFileSync(path, 'utf8'));
  let state;
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
      state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
    } catch (error) {if (error.code !== 'ENOENT') throw error; return;}
    if (state === 'Z') return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(state, 'Z');
}
test('ordinary exit drains short-lived descendants but rejects orphaned pipe holders', {timeout: 17000}, async t => {
  const normal = temporary(t);
  const result = await captureCommand(normal, 'normal', process.execPath, ['-e', backgroundCommand(normal, false)], normal);
  assert.equal(result.status, 0);
  assert.equal(result.orphaned, false);
  assert.equal(readFileSync(join(normal, 'normal.stdout'), 'utf8'), 'leader-exit\nlate stdout\n');
  assert.equal(readFileSync(join(normal, 'normal.stderr'), 'utf8'), 'late stderr\n');
  const root = temporary(t); let forced = false;
  const watchdog = setTimeout(() => {forced = true; killOwnedLeader(root);}, 14000);
  try {
    await assert.rejects(captureCommand(root, 'orphan', process.execPath, ['-e', backgroundCommand(root, true)], root), /orphaned output pipes/);
    assert.equal(forced, false, 'owner, not test watchdog, must terminate the orphaned group');
    const record = JSON.parse(readFileSync(join(root, 'orphan.json')));
    assert.equal(record.status, 0, 'preserve original leader status'); assert.equal(record.signal, null);
    assert.equal(record.orphaned, true); assert.equal(record.interrupted, null);
    const files = new Map(['json', 'stdout', 'stderr'].map(suffix => [`orphan.${suffix}`, readFileSync(join(root, `orphan.${suffix}`))]));
    assert.throws(() => validateCommand(files, 'orphan', process.execPath, ['-e', backgroundCommand(root, true)], 0));
    await noExecutingProcess(join(root, 'grandchild'));
  } finally {clearTimeout(watchdog); killOwnedLeader(root);}
});

test('cancellation after the leader exits terminates its resistant pipe-holding grandchild', {timeout: 12000}, async t => {
  const root = temporary(t), ready = join(root, 'grandchild');
  const wrapper = `
    import {existsSync} from 'node:fs';
    import {captureCommand} from ${JSON.stringify(new URL('./release-gate-evidence.mjs', import.meta.url).href)};
    const timer=setInterval(()=>{if(existsSync(${JSON.stringify(ready)})){clearInterval(timer);process.kill(process.pid,'SIGHUP');}},10);
    try{await captureCommand(${JSON.stringify(root)},'cancel-orphan',process.execPath,['-e',${JSON.stringify(backgroundCommand(root, true))}],${JSON.stringify(root)});process.exitCode=1;}
    catch(error){if(error.message!=='gate interrupted')throw error;}finally{clearInterval(timer);}
  `;
  try {
    execFileSync(process.execPath, ['--input-type=module', '-e', wrapper], {timeout: 10000});
    const record = JSON.parse(readFileSync(join(root, 'cancel-orphan.json')));
    assert.equal(record.status, 0); assert.equal(record.interrupted, 'SIGHUP');
    assert.equal(record.orphaned, false, 'cancellation must not be relabeled as an ordinary exit failure');
    await noExecutingProcess(ready);
  } finally {killOwnedLeader(root);}
});

test('source and native archives preserve complete originals without promoting their scope', t => {
  for (const [kind, fixture, binding] of [['source-vv', sourceFixture, sourceContext], ['native-equivalence', nativeFixture, context]]) {
    const root = temporary(t); fixture(root); const output = join(temporary(t), 'original.tar');
    const captured = packEvidence(root, kind, output, binding);
    assert.equal(captured.scope, 'original-gate-evidence-only'); assert(captured.unclaimed.includes('sdk-acceptance'));
    for (const row of captured.files) assert.deepEqual(execFileSync('tar', ['-xOf', output, row.path]), readFileSync(join(root, row.path)));
    for (const changed of [{source_revision: 'c'.repeat(40)}, {run_id: '124'}, {run_attempt: '2'}, {architecture: 'arm64'}]) {
      assert.throws(() => captureEvidence(root, kind, {...binding, ...changed}));
    }
  }
});

test('missing bootstrap, failed command, substituted bytes and wrong native invocation fail closed', t => {
  for (const [kind, fixture, binding, changes] of [
    ['source-vv', sourceFixture, sourceContext, [
      root => rmSync(join(root, 'run-2-bootstrap-prior-capture.json')),
      root => put(root, 'source-2-vv.json', rawVv().subarray(1)),
      root => put(root, 'source-1.stdout', 'changed original'),
      root => {const row = JSON.parse(readFileSync(join(root, 'source-2.json'))); row.status = 1; put(root, 'source-2.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'source-2.json'))); row.arguments = ['check']; put(root, 'source-2.json', row);},
    ]],
    ['native-equivalence', nativeFixture, context, [
      root => rmSync(join(root, 'container-error.stderr')),
      root => commandFixture(root, 'container-error', 'docker', ['run', 'changed'], 6),
      root => {const row = JSON.parse(readFileSync(join(root, 'native-error.json'))); row.status = 0; put(root, 'native-error.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'native-result.json'))); row.archive.path = 'prismpm-0.3.0-aarch64-unknown-linux-gnu.tar.gz'; put(root, 'native-result.json', row);},
      root => {const row = JSON.parse(readFileSync(join(root, 'container-check.json'))); commandFixture(root, 'container-check', row.command, row.arguments, 0, 'different success');},
    ]],
  ]) for (const mutate of changes) {
    const root = temporary(t); fixture(root); mutate(root);
    const target = join(temporary(t), 'forbidden.tar'); assert.throws(() => packEvidence(root, kind, target, binding)); assert(!existsSync(target));
  }
});

test('retention requires fresh complete bootstrap outputs on each real callback invocation', async t => {
  for (const fault of ['none', 'unicode', 'missing', 'changed', 'stale', 'first-modified']) {
    const source = temporary(t), output = temporary(t); mkdirSync(join(source, 'target'));
    const bootstrap = bootstrapFixture(revision, fault === 'unicode'); let calls = 0;
    const pending = retainTwoRuns(source, output, revision, async run => {
      calls++;
      for (const name of bootstrapNames) assert(!existsSync(join(source, 'target', name)), 'old success must be invalidated');
      put(join(source, 'target'), 'vv-evidence.json', rawVv());
      if (run === 2 && fault === 'stale') return 0;
      for (const [name, bytes] of bootstrap.files) {
        if (run === 2 && fault === 'missing' && name === 'bootstrap-evidence.json') continue;
        put(join(source, 'target'), name, run === 2 && fault === 'changed' && name === 'bootstrap-current-capture.json' ? '{}' : bytes);
      }
      if (run === 2 && fault === 'first-modified') {
        const path = join(output, 'run-1-bootstrap-prior-capture.json'); chmodSync(path, 0o644); writeFileSync(path, '{}');
      }
      return 0;
    });
    if (!['none', 'unicode'].includes(fault)) {await assert.rejects(pending); assert(!existsSync(join(output, 'bootstrap.json')));}
    else {
      await pending;
      validateBootstrapRetention(readFileSync(join(output, 'bootstrap.json')), new Map([...bootstrap.retained.keys()].map(name => [name, readFileSync(join(output, name))])), revision);
    }
    assert.equal(calls, 2);
  }
});

test('original files reject symbolic links, hardlinks and parent aliases before command execution', async t => {
  const root = temporary(t), actual = join(root, 'actual'); writeFileSync(actual, 'retain');
  for (const [name, alias] of [['sym', symlinkSync], ['hard', linkSync]]) {
    const path = join(root, name); alias(actual, path); assert.throws(() => readOriginal(path));
  }
  const alias = join(root, 'directory'); symlinkSync(root, alias);
  await assert.rejects(captureCommand(alias, 'refused', process.execPath, ['-e', 'process.exit(0)'], root));
  assert(!existsSync(join(root, 'refused.stdout')));
});

function workflowContract(value) {
  const source = value.jobs.gate.steps.find(step => step.with?.runCmd);
  assert.equal(source.if, undefined); assert.equal(source['continue-on-error'], undefined);
  assert.equal(source.with.runCmd, "set -euo pipefail\nbash scripts/vv.sh --with-sdk bash -euo pipefail -c \"$(cat <<'PRISMPM_VV'\n" + [1, 2].map(run =>
    `node scripts/release-gate-evidence.mjs source-run . target/source-vv-evidence '\${{ github.sha }}' amd64 - '\${{ github.run_id }}' '\${{ github.run_attempt }}' ${run}\n`).join('') + 'PRISMPM_VV\n)"\n');
  const sourceUpload = value.jobs.gate.steps.find(step => step.with?.name === 'source-vv');
  assert.equal(sourceUpload.if, 'always()'); assert.equal(sourceUpload.with['if-no-files-found'], 'error');
  assert.equal(sourceUpload.with.path, 'target/source-vv-evidence/');
  const native = value.jobs.native.steps.find(step => step.run?.includes('release-gate-evidence.mjs native'));
  assert.equal(native.if, undefined); assert.equal(native['continue-on-error'], undefined);
  assert(!native.run.includes('||'), 'native failure cannot be waived');
  assert(native.run.includes('node scripts/release-gate-evidence.mjs native . .native-equivalence "$GITHUB_SHA" \\\n  "${PLATFORM#linux/}" "$sdk_image" "$GITHUB_RUN_ID" "$GITHUB_RUN_ATTEMPT" "$archive"'));
  const nativeUpload = value.jobs.native.steps.find(step => step.with?.name === 'sdk-equivalence-${{ matrix.arch }}');
  assert.equal(nativeUpload.if, 'always()'); assert.equal(nativeUpload.with.path, '.native-equivalence/');
  assert.equal(nativeUpload.with['if-no-files-found'], 'error');
  assert.deepEqual(value.jobs.native.strategy.matrix.include, [
    {platform: 'linux/amd64', target: 'x86_64-unknown-linux-gnu', arch: 'amd64'},
    {platform: 'linux/arm64', target: 'aarch64-unknown-linux-gnu', arch: 'arm64'},
  ]);
}
test('actual workflow retains both unchanged full source runs and complete native failure originals', () => {
  const value = load(readFileSync(new URL('../.github/workflows/release.yml', import.meta.url), 'utf8')); workflowContract(value);
  for (const mutate of [
    v => {v.jobs.gate.steps.find(s => s.with?.runCmd).with.runCmd = 'just vv\n';},
    v => {v.jobs.gate.steps.find(s => s.with?.name === 'source-vv').if = 'success()';},
    v => {v.jobs.native.steps.find(s => s.run?.includes('release-gate-evidence.mjs native')).run += ' || true';},
    v => {v.jobs.native.steps.find(s => s.with?.name === 'sdk-equivalence-${{ matrix.arch }}').with.path = '.';},
    v => {v.jobs.native.strategy.matrix.include[1].arch = 'amd64';},
  ]) {
    const changed = structuredClone(value); mutate(changed);
    assert.throws(() => workflowContract(changed));
  }
});
