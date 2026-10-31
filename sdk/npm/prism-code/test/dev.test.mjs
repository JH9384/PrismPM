// `prism-code dev` (#288): the watcher, the rebuild trigger, the Check tab's data, the server and the verb end to end.
import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { createServer, get, request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_WATCH, createDevLoop, createSnapshot, createWatcher, describeProject, globMatcher, judgeHolo, runBuild, watchedPath, watchPatterns } from '../src/dev.mjs';
import { buildCommand, formatCycle } from '../src/dev-cli.mjs';
import { REPLAY_STATES, readReplay } from '../src/dev-replay.mjs';
import { ASSETS, CONTENT_SECURITY_POLICY, STUDIO_PORT, serveStudio } from '../src/dev-server.mjs';
import { agreement, checkTab, replayTab } from '../src/studio/tabs.mjs';
import { verify } from '../src/vendor/verify.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const cliJson = fileURLToPath(new URL('../../../docs/cli.json', import.meta.url));

const made = [];
function project(files = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'prism-dev-'));
  made.push(directory);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(directory, path, '..'), { recursive: true });
    writeFileSync(join(directory, path), text);
  }
  return directory;
}
after(() => {
  for (const directory of made) {
    try {
      rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch {
      // Windows may still hold a directory a stopped child ran in; one left in the temporary directory fails nothing.
    }
  }
});

const delay = (ms) => new Promise((done) => setTimeout(done, ms));

/** Save as an editor does: a temporary file renamed over the source, so nothing sees it half written. */
function save(root, path, text) {
  writeFileSync(join(root, `${path}.tmp`), text);
  renameSync(join(root, `${path}.tmp`), join(root, path));
}

async function until(predicate, what, ms = 15000) {
  const end = Date.now() + ms;
  for (;;) {
    const value = await predicate();
    if (value) return value;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await delay(20);
  }
}

// The watcher

test('the patterns: * stops at a slash, ** does not, and a bare name covers what is under it', () => {
  const matches = globMatcher(['model/**/*.lex.tex', 'examples/*.json', 'intent.md', 'data']);
  for (const yes of ['model/a.lex.tex', 'model/x/y/a.lex.tex', 'examples/one.json', 'intent.md', 'data', 'data/deep/file.bin']) assert.ok(matches(yes), yes);
  for (const no of ['model/a.lean', 'examples/x/one.json', 'other/intent.md', 'intent.md.bak', 'database', 'modelx/a.lex.tex']) assert.ok(!matches(no), no);
});

test('a scan reports a change of bytes and nothing for a save of the same bytes', async () => {
  const root = project({ 'src/a.lex.tex': 'one' });
  const snapshot = createSnapshot({ root, patterns: DEFAULT_WATCH });
  assert.deepEqual((await snapshot.scan()).changed, ['src/a.lex.tex']);
  assert.deepEqual((await snapshot.scan()).changed, []);

  const later = new Date(Date.now() + 5000);
  utimesSync(join(root, 'src/a.lex.tex'), later, later);
  assert.deepEqual((await snapshot.scan()).changed, [], 'a new time on the same bytes is no change');

  writeFileSync(join(root, 'src/a.lex.tex'), 'two');
  const edited = await snapshot.scan();
  assert.deepEqual(edited.changed, ['src/a.lex.tex']);
  assert.ok(edited.editedAt > 0, 'the change carries its edit time');

  rmSync(join(root, 'src/a.lex.tex'));
  assert.deepEqual((await snapshot.scan()).changed, ['src/a.lex.tex'], 'a deleted source is a change');
});

test('a scan skips build output, and a policy outside the project is watched by its path', async () => {
  const outside = project({ 'policy.json': '{}' });
  const policy = join(outside, 'policy.json');
  const root = project({ 'src/a.lex.tex': 'one', '.prism/build/x/a.lex.tex': 'output', 'node_modules/p/a.lex.tex': 'dep', 'target/src/a.lex.tex': 'output' });
  const snapshot = createSnapshot({ root, patterns: ['**/*.lex.tex'], extra: [watchedPath(root, policy)] });
  assert.deepEqual((await snapshot.scan()).files.sort(), [policy, 'src/a.lex.tex'].sort());
  writeFileSync(policy, '{"minimum":"P0"}');
  assert.deepEqual((await snapshot.scan()).changed, [policy]);
});

test('the watcher fires on an edit, once, and not for a file outside its patterns', async () => {
  const root = project({ 'src/a.lex.tex': 'one', 'notes.txt': 'n' });
  const seen = [];
  const watcher = await createWatcher({ root, patterns: DEFAULT_WATCH, onChange: (change) => seen.push(change), pollMs: 100 });
  try {
    assert.deepEqual(watcher.files, ['src/a.lex.tex']);
    await delay(150);
    assert.deepEqual(seen, [], 'the first scan reports nothing');

    writeFileSync(join(root, 'notes.txt'), 'changed');
    await delay(250);
    assert.deepEqual(seen, [], 'a file no pattern names');

    save(root, 'src/a.lex.tex', 'two');
    await until(() => seen.length === 1, 'the edit');
    assert.deepEqual(seen[0].files, ['src/a.lex.tex']);
    await delay(250);
    assert.equal(seen.length, 1, 'one edit is one change');

    // A plain write truncates first, so a scan may see the empty file and then the full one. It settles on the full one.
    writeFileSync(join(root, 'src/a.lex.tex'), 'three');
    await until(() => seen.length >= 2, 'the plain write');
    await delay(250);
    const settled = seen.length;
    assert.ok(seen.slice(1).every((change) => change.files[0] === 'src/a.lex.tex'));
    await delay(250);
    assert.equal(seen.length, settled, 'and then it is quiet');
  } finally {
    watcher.close();
  }
});

test('with no file system events the slow scan still notices an edit', async () => {
  const root = project({ 'src/a.lex.tex': 'one' });
  const seen = [];
  const watcher = await createWatcher({ root, patterns: DEFAULT_WATCH, onChange: (change) => seen.push(change), events: false, pollMs: 30 });
  try {
    assert.equal(watcher.watching, false);
    writeFileSync(join(root, 'src/a.lex.tex'), 'two');
    await until(() => seen.length === 1, 'the polled edit');
  } finally {
    watcher.close();
  }
});

test('what a project watches: [model].watch, then [model].source, then the defaults; the manifest always', () => {
  assert.deepEqual(watchPatterns(null), [...DEFAULT_WATCH]);
  assert.deepEqual(watchPatterns({ model: { watch: ['model/**/*.lex.tex', 'intent.md'] } }), ['model/**/*.lex.tex', 'intent.md', 'prism.toml']);
  assert.deepEqual(watchPatterns({ model: { source: 'spec' } }), ['spec/**', 'prism.toml']);
  assert.deepEqual(watchPatterns({ model: { watch: ['m/**'] }, capabilities: { file: 'caps.json' } }), ['m/**', 'prism.toml', 'caps.json']);
});

// The rebuild trigger

const VERDICT = (digest, passed = false) => ({ schema: 'prism/verdict/1', holo: digest, level: 'P0', passed, policy: { name: 'default', minimum: 'P2' }, reasons: [] });

function fakeLoop({ build, judge } = {}) {
  const calls = { build: 0, judge: 0 };
  const states = [];
  const loop = createDevLoop({
    build: async () => {
      calls.build += 1;
      return build ? build(calls.build) : { ok: true, code: 0, ms: 5, log: '', holo: 'app.holo', problem: null };
    },
    judge: async (holo) => {
      calls.judge += 1;
      return judge ? judge(holo, calls.judge) : { verdict: VERDICT(`blake3:${calls.judge}`), bytes: new Uint8Array([calls.judge]), policy: {}, limits: [], levelName: 'Integrity', reasons: [] };
    },
    replay: readReplay,
    onState: (state) => states.push(state),
  });
  return { loop, calls, states };
}

test('a change rebuilds, then checks, and the state walks building, checking, idle', async () => {
  const { loop, calls, states } = fakeLoop();
  await loop.trigger({ files: ['src/a.lex.tex'], editedAt: Date.now() - 100 });
  assert.deepEqual([calls.build, calls.judge], [1, 1]);
  assert.deepEqual(states.map((s) => s.phase), ['building', 'checking', 'idle']);
  const { cycle, result, replay, revision } = loop.state;
  assert.equal(result.outcome, 'verdict');
  assert.deepEqual(cycle.files, ['src/a.lex.tex']);
  assert.ok(cycle.editToVerdictMs >= 100, `edit to verdict is measured from the edit, got ${cycle.editToVerdictMs}`);
  assert.equal(replay.state, 'unavailable');
  assert.equal(revision, 3);
  assert.deepEqual(loop.holoBytes, new Uint8Array([1]));
});

test('edits during a build become exactly one more build, and it reaches the newest edit', async () => {
  let release;
  const gate = new Promise((done) => {
    release = done;
  });
  const { loop, calls } = fakeLoop({
    build: async (count) => {
      if (count === 1) await gate;
      return { ok: true, code: 0, ms: 5, log: '', holo: 'app.holo', problem: null };
    },
  });
  const finished = loop.trigger({ files: ['a'], editedAt: 1 });
  await delay(5);
  loop.trigger({ files: ['b'], editedAt: 2 });
  loop.trigger({ files: ['c'], editedAt: 3 });
  release();
  await finished;
  assert.equal(calls.build, 2);
  assert.deepEqual(loop.state.cycle.files, ['b', 'c']);
  assert.equal(loop.state.cycle.editedAt, 3);
});

test('a failed build leaves no current verdict: the last one moves to previous and the holo is withdrawn', async () => {
  const { loop } = fakeLoop({ build: (count) => (count === 1 ? { ok: true, code: 0, ms: 1, log: '', holo: 'app.holo', problem: null } : { ok: false, code: 1, ms: 1, log: 'no theorem\n', holo: null, problem: null }) });
  await loop.trigger({});
  assert.equal(loop.state.result.outcome, 'verdict');
  await loop.trigger({ files: ['src/a.lex.tex'], editedAt: Date.now() });
  assert.equal(loop.state.result.outcome, 'build-failed');
  assert.equal(loop.state.result.log, 'no theorem\n');
  assert.equal(loop.state.previous.verdict.holo, 'blake3:1');
  assert.equal(loop.state.replay, null);
  assert.equal(loop.holoBytes, null);
  assert.ok(formatCycle(loop.state, 'app').startsWith('Build failed (exit 1)'));
});

test('the next good build clears previous', async () => {
  const { loop } = fakeLoop({ build: (count) => (count === 2 ? { ok: false, code: 1, ms: 1, log: 'x', holo: null, problem: null } : { ok: true, code: 0, ms: 1, log: '', holo: 'app.holo', problem: null }) });
  await loop.trigger({});
  await loop.trigger({});
  await loop.trigger({});
  assert.equal(loop.state.result.outcome, 'verdict');
  assert.equal(loop.state.previous, null);
});

test('a build that spawns nothing is a failed build, not a crash', async () => {
  const { loop } = fakeLoop({ build: () => { throw new Error('spawn failed'); } });
  await loop.trigger({});
  assert.equal(loop.state.result.outcome, 'build-failed');
  assert.match(loop.state.result.log, /spawn failed/);
  assert.equal(loop.state.phase, 'idle');
});

test('a build that names no holo reaches no verdict, rather than judging an older file', async () => {
  const { loop, calls } = fakeLoop({ build: () => ({ ok: true, code: 0, ms: 1, log: '', holo: null, problem: 'wrote no .holo' }) });
  await loop.trigger({});
  assert.equal(calls.judge, 0);
  assert.deepEqual([loop.state.result.outcome, loop.state.result.check], ['no-verdict', 'dev.holo']);
});

test('a holo check cannot judge is no verdict, and the loop keeps running', async () => {
  const { loop } = fakeLoop({ judge: () => { throw Object.assign(new Error('not a holo'), { check: 'holo.magic' }); } });
  await loop.trigger({});
  assert.deepEqual([loop.state.result.outcome, loop.state.result.check], ['no-verdict', 'holo.magic']);
  assert.equal(loop.holoBytes, null);
  assert.equal(loop.state.phase, 'idle');
});

test('an edit to the policy re-checks without a build, unless there is no holo yet', async () => {
  const { loop, calls } = fakeLoop();
  await loop.trigger({ reason: 'policy', files: ['policy.json'], editedAt: 1, rebuild: false });
  assert.deepEqual([calls.build, calls.judge], [1, 1], 'nothing to re-judge yet');
  await loop.trigger({ reason: 'policy', files: ['policy.json'], editedAt: 1, rebuild: false });
  assert.deepEqual([calls.build, calls.judge], [1, 2]);
  assert.equal(loop.state.cycle.build, null);
  assert.ok(formatCycle(loop.state, 'app').startsWith('Checked app'));
});

test('runBuild takes the holo the build reports, so a rebuild that reuses an old directory is judged correctly', async () => {
  const report = (id) => `{"schema":"prismpm/build-result/1","build_id":"${id}","manifest_path":".prism/build/${id}/manifest.json"}`;
  const root = project({ '.prism/build/old/App.holo': 'old', '.prism/build/new/App.holo': 'new', 'report.mjs': `console.log('Compiling');console.log(process.argv[2]);` });
  // The newest file by time is new/, and the source went back to what built old/.
  const past = new Date(Date.now() - 60000);
  utimesSync(join(root, '.prism/build/old/App.holo'), past, past);
  const built = await runBuild({ directory: root, command: `node report.mjs ${JSON.stringify(JSON.stringify(JSON.parse(report('old'))))}` });
  assert.equal(built.ok, true, built.log);
  assert.equal(built.holo, join(root, '.prism/build/old/App.holo'));
});

test('runBuild with a build that writes no holo reports the problem and never an old file', async () => {
  const root = project({ 'App.holo': 'stale' });
  const past = new Date(Date.now() - 60000);
  utimesSync(join(root, 'App.holo'), past, past);
  const built = await runBuild({ directory: root, command: 'node -e 0' });
  assert.deepEqual([built.ok, built.holo], [true, null]);
  assert.match(built.problem, /wrote no \.holo/);
});

test('runBuild keeps the end of a failed build, and finds a holo written this run', async () => {
  const root = project({ 'fail.mjs': `console.error('PP2014 no theorem');process.exit(3);`, 'ok.mjs': `import {writeFileSync} from 'node:fs';writeFileSync('App.holo','x');` });
  const failed = await runBuild({ directory: root, command: 'node fail.mjs' });
  assert.deepEqual([failed.ok, failed.code, failed.holo], [false, 3, null]);
  assert.match(failed.log, /PP2014 no theorem/);
  const good = await runBuild({ directory: root, command: 'node ok.mjs' });
  assert.equal(good.holo, join(root, 'App.holo'));
});

test('the build a project asks for: the flag, then the manifest, and prism build is the built-in one', () => {
  assert.equal(buildCommand(undefined, null), null);
  assert.equal(buildCommand(undefined, { model: { build: 'prism build' } }), null);
  assert.equal(buildCommand('prism-code build', null), null);
  assert.equal(buildCommand(undefined, { model: { build: 'make holo' } }), 'make holo');
  assert.equal(buildCommand('just dev', { model: { build: 'make holo' } }), 'just dev');
});

test('describeProject reads the reference project, and a directory with neither file is no project', async () => {
  const calculator = fileURLToPath(new URL('../../../../examples/Calculator', import.meta.url));
  const described = await describeProject(calculator);
  assert.deepEqual([described.name, described.buildRoot, described.isProject, described.hasManifest], ['Calculator', '.prism', true, false]);
  assert.equal((await describeProject(project())).isProject, false);
});

// The Check tab's data

const POLICY_FILE = project({ 'p0.json': '{"name":"local","minimum":"P0"}' });

async function judgedState(holo, policy = undefined) {
  const directory = project();
  const loop = createDevLoop({
    build: async () => ({ ok: true, code: 0, ms: 12, log: '', holo, problem: null }),
    judge: (path) => judgeHolo({ directory, holo: path, policy, hasManifest: false }),
    replay: readReplay,
  });
  await loop.trigger({ files: ['src/Calculator.lex.tex'], editedAt: Date.now() });
  return loop;
}

test('the Check tab on the reference archive under the default policy: FAILED, P0, the reason, the digest', async () => {
  const { state } = await judgedState(fixture);
  const view = checkTab(state);
  assert.equal(view.status, 'failed');
  assert.equal(view.current, true);
  assert.equal(view.busy, null);
  assert.deepEqual([view.verdict.level, view.verdict.levelName, view.verdict.minimum, view.verdict.policy], ['P0', 'unverified', 'P2', 'default']);
  assert.match(view.verdict.digest, /^blake3:[0-9a-f]{64}$/);
  assert.ok(view.verdict.reasons.length > 0);
  for (const reason of view.verdict.reasons) {
    assert.equal(typeof reason.check, 'string');
    assert.equal(typeof reason.title, 'string');
  }
  assert.deepEqual(view.verdict.limits, [], 'below P2 there is nothing to trust a signer for');
  assert.deepEqual(view.timing.files, ['src/Calculator.lex.tex']);
  assert.equal(view.timing.buildMs, 12);
  assert.equal(typeof view.timing.checkMs, 'number');
  assert.equal(typeof view.timing.editToVerdictMs, 'number');
});

test('the Check tab with a policy that accepts the level: PASSED, and an edit to the policy file takes effect', async () => {
  const { state } = await judgedState(fixture, join(POLICY_FILE, 'p0.json'));
  const view = checkTab(state);
  assert.equal(view.status, 'passed');
  assert.deepEqual([view.verdict.policy, view.verdict.minimum, view.verdict.level], ['local', 'P0', 'P0']);
});

test('the Check tab names the same verdict the check verb prints', async () => {
  const { state } = await judgedState(fixture);
  const printed = JSON.parse(spawnSync(process.execPath, [bin, 'check', fixture, '--json'], { encoding: 'utf8' }).stdout);
  assert.deepEqual(JSON.parse(JSON.stringify(state.result.verdict)), printed);
});

test('the Check tab of a damaged holo carries the integrity reason', async () => {
  const root = project();
  const bytes = readFileSync(fixture);
  bytes[bytes.length - 200] ^= 0xff;
  writeFileSync(join(root, 'bad.holo'), bytes);
  const view = checkTab((await judgedState(join(root, 'bad.holo'))).state);
  assert.equal(view.status, 'failed');
  assert.ok(view.verdict.reasons.some((reason) => reason.check.startsWith('holo.')), JSON.stringify(view.verdict.reasons.map((r) => r.check)));
});

test('the Check tab with a file that is no holo says no verdict and keeps the last verdict apart', async () => {
  const root = project({ 'junk.holo': 'not a holo at all' });
  const loop = createDevLoop({
    build: async () => ({ ok: true, code: 0, ms: 1, log: '', holo: loop.state.cycle.number === 1 ? fixture : join(root, 'junk.holo'), problem: null }),
    judge: (path) => judgeHolo({ directory: root, holo: path, hasManifest: false }),
    replay: readReplay,
  });
  await loop.trigger({});
  await loop.trigger({});
  const view = checkTab(loop.state);
  assert.equal(view.status, 'no-verdict');
  assert.equal(view.verdict, null);
  assert.equal(typeof view.problem.check, 'string');
  assert.match(view.previous.digest, /^blake3:/);
});

test('the Check tab while busy says the rest describes the last finished cycle', () => {
  const finished = { phase: 'idle', cycle: null, previous: null, result: { outcome: 'verdict', holo: 'a.holo', verdict: VERDICT('blake3:1'), reasons: [], limits: [], levelName: 'Integrity' } };
  assert.deepEqual([checkTab(finished).busy, checkTab(finished).current], [null, true]);
  const rebuilding = checkTab({ ...finished, phase: 'building' });
  assert.deepEqual([rebuilding.busy, rebuilding.current, rebuilding.status], ['building', false, 'failed']);
  assert.equal(checkTab({ phase: 'building', cycle: null, result: null, previous: null }).status, 'waiting');
});

test('a failed build in the Check tab shows its log and no current verdict', () => {
  const view = checkTab({ phase: 'idle', cycle: null, previous: { outcome: 'verdict', holo: 'a.holo', verdict: VERDICT('blake3:1'), reasons: [], limits: [], levelName: 'Integrity' }, result: { outcome: 'build-failed', code: 1, log: 'PP2014\n' } });
  assert.equal(view.status, 'build-failed');
  assert.equal(view.log, 'PP2014\n');
  assert.equal(view.verdict, null);
  assert.equal(view.previous.digest, 'blake3:1');
});

test('the page verifier reaches the verdict of the command line, and agreement sees a difference', async () => {
  const { state } = await judgedState(fixture, join(POLICY_FILE, 'p0.json'));
  const browser = await verify(new Uint8Array(readFileSync(fixture)), state.result.policy);
  assert.equal(agreement(state.result.verdict, browser), true);
  assert.equal(agreement(state.result.verdict, { ...browser, passed: !browser.passed }), false);
  assert.equal(agreement(state.result.verdict, { ...browser, level: 'P1' }), false);
  assert.equal(agreement(state.result.verdict, { ...browser, holo: 'blake3:other' }), false);
  // A reason's message is for a person; a change to it is no disagreement.
  const failing = (await judgedState(fixture)).state.result;
  const judged = await verify(new Uint8Array(readFileSync(fixture)), failing.policy);
  assert.ok(judged.reasons.length > 0);
  assert.equal(agreement(failing.verdict, { ...judged, reasons: judged.reasons.map((r) => ({ ...r, message: 'reworded' })) }), true);
  assert.equal(agreement(failing.verdict, { ...judged, reasons: [] }), false);
});

// The Replay tab's interface

test('the replay source says unavailable until replay ships, and the tab shows every state of the interface', async () => {
  const replay = await readReplay({ holo: fixture, directory: '.', verdict: VERDICT('blake3:1') });
  assert.equal(replay.state, 'unavailable');
  assert.ok(REPLAY_STATES.includes(replay.state));
  assert.equal(replayTab({ phase: 'idle', replay }).state, 'unavailable');
  assert.match(replayTab({ phase: 'idle', replay }).reason, /no replay/);
  assert.equal(replayTab({ phase: 'idle', replay: null }).state, 'waiting');

  const passed = replayTab({ phase: 'idle', replay: { state: 'passed', events: 22, divergences: 0, histories: [{ name: 'a.json', events: 22, divergences: 0 }] } });
  assert.deepEqual([passed.state, passed.events, passed.divergences, passed.histories.length, passed.reason], ['passed', 22, 0, 1, null]);
  const diverged = replayTab({ phase: 'idle', replay: { state: 'diverged', reason: 'first at event 3', events: 22, divergences: 1, histories: [] } });
  assert.deepEqual([diverged.state, diverged.divergences, diverged.reason], ['diverged', 1, 'first at event 3']);
  for (const state of ['no-histories', 'no-verdict']) assert.equal(replayTab({ phase: 'idle', replay: { state, reason: 'why' } }).reason, 'why');
});

test('a replay that throws is no verdict on the Replay tab and leaves the Check tab alone', async () => {
  const loop = createDevLoop({
    build: async () => ({ ok: true, code: 0, ms: 1, log: '', holo: 'a.holo', problem: null }),
    judge: async () => ({ verdict: VERDICT('blake3:1'), bytes: new Uint8Array(1), policy: {}, limits: [], levelName: 'Integrity', reasons: [] }),
    replay: async () => {
      throw new Error('the history is not prism/history/1');
    },
  });
  await loop.trigger({});
  assert.equal(replayTab(loop.state).state, 'no-verdict');
  assert.equal(checkTab(loop.state).status, 'failed');
});

// The server

function fetchRaw(url, { host, method = 'GET' } = {}) {
  const target = new URL(url);
  return new Promise((done, reject) => {
    const request = httpRequest({ hostname: '127.0.0.1', port: target.port, path: target.pathname, method, headers: host ? { host } : {} }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () => done({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
    });
    request.on('error', reject);
    request.end();
  });
}

async function withStudio(work, { state = { schema: 'prism/dev-state/1', revision: 1 }, holo = null } = {}) {
  let current = state;
  const studio = await serveStudio({ getState: () => current, getHolo: () => holo, port: 0 });
  try {
    await work(studio, (next) => {
      current = next;
      studio.publish(next);
    });
  } finally {
    await studio.close();
  }
}

test('the port is 4100 and the documents agree', () => {
  assert.equal(STUDIO_PORT, 4100);
  const help = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }).stdout;
  assert.match(help, /http:\/\/localhost:4100/);
  assert.match(help, /--port <n> +the studio's port, default 4100/);
  const verbs = JSON.parse(readFileSync(cliJson, 'utf8'));
  assert.equal(verbs.verbs.find((verb) => verb.name === 'dev').flags.find((flag) => flag.flag === '--port <n>').default, '4100');
  assert.ok(verbs.prismCode.verbs.find((verb) => verb.name === 'dev'));
});

test('the page and its files load from this origin, with a policy that allows nothing else', async () => {
  await withStudio(async (studio) => {
    assert.match(studio.url, /^http:\/\/localhost:\d+$/);
    for (const path of Object.keys(ASSETS)) {
      const response = await fetchRaw(`http://127.0.0.1:${studio.port}${path}`);
      assert.equal(response.status, 200, path);
      assert.equal(response.headers['content-security-policy'], CONTENT_SECURITY_POLICY);
      assert.equal(response.headers['x-content-type-options'], 'nosniff');
      assert.equal(response.headers['cache-control'], 'no-store');
    }
    const page = (await fetchRaw(`http://127.0.0.1:${studio.port}/`)).body.toString();
    assert.match(page, /role="tab"[^>]*>Check</);
    assert.match(page, /role="tab"[^>]*>Replay</);
  });
  assert.ok(!/\bhttps?:|\*/.test(CONTENT_SECURITY_POLICY));
  assert.match(CONTENT_SECURITY_POLICY, /default-src 'none'/);
  assert.match(CONTENT_SECURITY_POLICY, /connect-src 'self'/);
});

test('the page names no outside address and loads only what the table serves', () => {
  for (const path of ['/', '/studio.css', '/studio.mjs', '/tabs.mjs']) {
    const text = readFileSync(ASSETS[path].file, 'utf8');
    assert.doesNotMatch(text, /(?:https?:|wss?:)?\/\/[a-z0-9-]+\.[a-z]{2,}/i, `${path} names an outside address`);
    assert.doesNotMatch(text, /@import|url\(|<iframe|XMLHttpRequest|WebSocket|sendBeacon/, path);
  }
  const page = readFileSync(ASSETS['/'].file, 'utf8');
  for (const [, reference] of page.matchAll(/(?:src|href)="([^"]+)"/g)) assert.ok(Object.hasOwn(ASSETS, reference), `${reference} is not served`);
  const script = readFileSync(ASSETS['/studio.mjs'].file, 'utf8');
  for (const [, module] of script.matchAll(/from '\.\/([^']+)'/g)) assert.ok(Object.hasOwn(ASSETS, `/${module}`), `${module} is not served`);
  assert.deepEqual([...script.matchAll(/fetch\(([^)]*)\)/g)].map((m) => m[1]), ["'/holo'"]);
  const verifier = readFileSync(ASSETS['/verify.mjs'].file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(verifier, /\bfetch\(|XMLHttpRequest|WebSocket|\bimport\(|^import /m, 'the verifier reaches for nothing');
});

test('only a loopback Host reaches the studio, and it is read only', async () => {
  await withStudio(async (studio) => {
    const base = `http://127.0.0.1:${studio.port}`;
    assert.equal((await fetchRaw(`${base}/api/state`, { host: 'attacker.example' })).status, 421);
    assert.equal((await fetchRaw(`${base}/api/state`, { host: `attacker.example:${studio.port}` })).status, 421);
    assert.equal((await fetchRaw(`${base}/api/state`, { host: `localhost:${studio.port}` })).status, 200);
    assert.equal((await fetchRaw(`${base}/api/state`, { method: 'POST' })).status, 405);
    assert.equal((await fetchRaw(`${base}/holo`, { method: 'DELETE' })).status, 405);
    assert.equal((await fetchRaw(`${base}/..%2f..%2fpackage.json`)).status, 404);
    assert.equal((await fetchRaw(`${base}/src/dev.mjs`)).status, 404);
    assert.equal((await fetchRaw(`${base}/constructor`)).status, 404);
    assert.equal((await fetchRaw(`${base}/favicon.ico`)).status, 204);
  });
});

test('/holo serves the judged bytes, and nothing before there are any', async () => {
  await withStudio(async (studio) => assert.equal((await fetchRaw(`http://127.0.0.1:${studio.port}/holo`)).status, 404));
  const bytes = new Uint8Array([1, 2, 3]);
  await withStudio(async (studio) => {
    const response = await fetchRaw(`http://127.0.0.1:${studio.port}/holo`);
    assert.equal(response.status, 200);
    assert.deepEqual(new Uint8Array(response.body), bytes);
  }, { holo: bytes });
});

test('the stream sends the current state on connect and every state after it', async () => {
  await withStudio(async (studio, publish) => {
    const received = [];
    let buffer = '';
    const request = get({ hostname: '127.0.0.1', port: studio.port, path: '/api/events' }, (response) => {
      assert.equal(response.headers['content-type'], 'text/event-stream; charset=utf-8');
      response.setEncoding('utf8').on('data', (text) => {
        buffer += text;
        for (;;) {
          const end = buffer.indexOf('\n\n');
          if (end < 0) break;
          received.push(JSON.parse(buffer.slice(6, end)));
          buffer = buffer.slice(end + 2);
        }
      });
    });
    request.on('error', () => {});
    await until(() => received.length === 1, 'the first state');
    assert.equal(received[0].revision, 1);
    publish({ schema: 'prism/dev-state/1', revision: 2 });
    await until(() => received.length === 2, 'the next state');
    assert.equal(received[1].revision, 2);
    assert.equal(JSON.parse((await fetchRaw(`http://127.0.0.1:${studio.port}/api/state`)).body.toString()).revision, 2);
    request.destroy();
  });
});

test('a port in use is an error that names the way out, not a move', async () => {
  const holder = createServer();
  await new Promise((done) => holder.listen(0, '127.0.0.1', done));
  const { port } = holder.address();
  try {
    await assert.rejects(serveStudio({ getState: () => ({}), getHolo: () => null, port }), (error) => {
      assert.equal(error.code, 'dev.port');
      assert.match(error.message, new RegExp(`port ${port} is in use`));
      assert.match(error.message, /--port/);
      return true;
    });
  } finally {
    await new Promise((done) => holder.close(done));
  }
});

// The verb, end to end

const BUILD = `
// The test's stand-in for prismpm build: the holo follows the model, as the real one does.
import { readFileSync, writeFileSync } from 'node:fs';
const model = readFileSync('src/App.lex.tex', 'utf8');
if (model.includes('SYNTAX')) { console.error('PP2014 the model does not parse'); process.exit(1); }
const bytes = readFileSync(process.argv[2]);
if (model.includes('DAMAGE')) bytes[bytes.length - 200] ^= 0xff;
writeFileSync('App.holo', bytes);
`;

function startDev(args, { cwd } = {}) {
  const child = spawn(process.execPath, [bin, 'dev', ...args, '--no-open', '--port', '0'], { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
  const output = { out: '', err: '' };
  child.stdout.setEncoding('utf8').on('data', (text) => {
    output.out += text;
  });
  child.stderr.setEncoding('utf8').on('data', (text) => {
    output.err += text;
  });
  const exited = new Promise((done) => child.on('exit', (code) => done(code)));
  return { child, output, exited };
}

const stateOf = async (url) => JSON.parse((await fetchRaw(`${url}/api/state`)).body.toString());

test('dev rebuilds and re-checks on a model edit, and the studio shows each new verdict', { timeout: 60000 }, async (t) => {
  // A P0 policy accepts even a damaged holo, so this one also pins the digest of the first build.
  const pinned = createHash('sha256').update(readFileSync(fixture)).digest('hex');
  const policy = (minimum) => JSON.stringify({ name: 'local', minimum, digests: { archive: { sha256: pinned } } });
  const root = project({ 'prismpm.toml': 'spec = "prismpm/project/1"\nproject = "App"\nbuild_root = ".prism"\n', 'src/App.lex.tex': 'model one\n', 'build.mjs': BUILD, 'policy.json': policy('P0') });
  copyFileSync(fixture, join(root, 'base.bin'));
  const dev = startDev([root, '--build', 'node build.mjs base.bin', '--holo', 'App.holo', '--policy', join(root, 'policy.json')]);
  t.after(async () => {
    dev.child.kill();
    await dev.exited;
  });
  const url = await until(() => /Studio at (http:\/\/localhost:\d+)\s+tabs: Check, Replay/.exec(dev.output.out)?.[1], `the studio address in ${JSON.stringify(dev.output)}`);
  const local = url.replace('localhost', '127.0.0.1');
  assert.match(dev.output.out, /Watching src\/\*\*\/\*\.lex\.tex/);

  const settled = (predicate, what) => until(async () => {
    const state = await stateOf(local);
    return state.phase === 'idle' && state.cycle && predicate(state) ? state : null;
  }, what);

  const first = await settled((state) => state.result?.outcome === 'verdict', 'the first verdict');
  assert.equal(checkTab(first).status, 'passed');
  assert.equal(first.cycle.editToVerdictMs, null, 'starting up is no edit');
  assert.equal(replayTab(first).state, 'unavailable');
  assert.equal((await fetchRaw(`${local}/holo`)).body.length, readFileSync(fixture).length);

  save(root, 'src/App.lex.tex', 'model two DAMAGE\n');
  const damaged = await settled((state) => state.cycle.number >= 2 && state.result?.outcome === 'verdict', 'the verdict on the edit');
  assert.equal(checkTab(damaged).status, 'failed');
  assert.ok(damaged.result.verdict.reasons.some((reason) => reason.check.startsWith('holo.')));
  assert.notEqual(damaged.result.verdict.holo, first.result.verdict.holo);
  assert.deepEqual(damaged.cycle.files, ['src/App.lex.tex']);
  assert.ok(damaged.cycle.editToVerdictMs > 0);

  save(root, 'src/App.lex.tex', 'model three SYNTAX\n');
  const broken = await settled((state) => state.result?.outcome === 'build-failed', 'the failed build');
  const view = checkTab(broken);
  assert.equal(view.status, 'build-failed');
  assert.match(view.log, /PP2014/);
  assert.equal(view.previous.digest, damaged.result.verdict.holo);
  assert.equal((await fetchRaw(`${local}/holo`)).status, 404, 'no bytes while nothing describes the source');

  save(root, 'src/App.lex.tex', 'model four\n');
  const fixed = await settled((state) => state.result?.outcome === 'verdict', 'the fixed build');
  assert.equal(checkTab(fixed).status, 'passed');
  assert.equal(fixed.previous, null);

  // A policy edit changes the judgement with no build.
  const cyclesBefore = fixed.cycle.number;
  save(root, 'policy.json', policy('P2'));
  const stricter = await settled((state) => state.cycle.number > cyclesBefore && state.result?.outcome === 'verdict', 'the re-check');
  assert.equal(checkTab(stricter).status, 'failed');
  assert.equal(stricter.cycle.build, null);
  assert.deepEqual(stricter.cycle.files, ['policy.json']);

  assert.match(dev.output.out, /Changed src\/App\.lex\.tex; rebuilding/);
  assert.match(dev.output.out, /Built App in [\d.]+s {2}Level: P0 {2}FAILED, policy local requires P0 {2}edit to verdict [\d.]+s/);
  assert.match(dev.output.out, /Build failed \(exit 1\)/);
});

test('dev refuses what it cannot serve: no project, a missing directory, a bad option', () => {
  const run = (args) => spawnSync(process.execPath, [bin, 'dev', ...args, '--no-open'], { encoding: 'utf8', timeout: 20000 });
  const empty = run([project()]);
  assert.equal(empty.status, 2, empty.stderr);
  assert.match(empty.stderr, /dev\.project/);
  const missing = run([join(project(), 'nowhere')]);
  assert.equal(missing.status, 2, missing.stderr);
  assert.match(missing.stderr, /dev\.path/);
  for (const args of [['--frobnicate'], ['--port', 'many'], ['--port', '70000'], ['--policy'], ['a', 'b']]) {
    const bad = run(args);
    assert.equal(bad.status, 64, `${args}: ${bad.stderr}`);
    assert.match(bad.stderr, /Usage: dev/);
  }
  const help = run(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /default 4100/);
});

test('a bad manifest is refused at the start, and dev is a built-in verb no plugin can shadow', () => {
  const root = project({ 'prism.toml': '[application]\nname = "NotValid"\nversion = "0.1.0"\n' });
  const refused = spawnSync(process.execPath, [bin, 'dev', root, '--no-open'], { encoding: 'utf8', timeout: 20000 });
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(refused.stderr, /manifest\./);
  assert.match(spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8' }).stdout, /prism-code dev \[<dir>\]/);
});

test('Ctrl-C stops dev with exit 0 and frees the port', { skip: process.platform === 'win32' ? 'Windows has no signal to catch' : false, timeout: 30000 }, async () => {
  const root = project({ 'prismpm.toml': 'project = "App"\n', 'src/App.lex.tex': 'model\n', 'build.mjs': `import { copyFileSync } from 'node:fs';copyFileSync(process.argv[2], 'App.holo');` });
  const dev = startDev([root, '--build', `node build.mjs ${JSON.stringify(fixture)}`, '--holo', 'App.holo']);
  const url = await until(() => /Studio at (http:\/\/localhost:\d+)/.exec(dev.output.out)?.[1], 'the studio address');
  const local = url.replace('localhost', '127.0.0.1');
  await until(async () => (await stateOf(local)).result?.outcome === 'verdict', 'the first verdict');
  dev.child.kill('SIGINT');
  assert.equal(await dev.exited, 0, dev.output.err);
  await assert.rejects(fetchRaw(`${local}/api/state`));
});

// The default build, and the policies check takes

test('the default build updates the lock, because a plain build refuses every edit to the model', async () => {
  const image = `ghcr.io/uor-foundation/prismpm-sdk@sha256:${'a'.repeat(64)}`;
  const root = project({ 'prismpm.lock': JSON.stringify({ sdk_image: image }) });
  const built = await runBuild({ directory: root, command: null, env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(built.code, 0, built.log);
  assert.match(built.log, new RegExp(`${image} prismpm build --update --json`));
});

test('the page verifier takes each policy check takes, and reaches the same verdict', async () => {
  const bytes = new Uint8Array(readFileSync(fixture));
  const files = project({ 'p0.rego': 'package prism.policy\n\nimport rego.v1\n\nminimum := "P0"\n', 'p0.json': '{"minimum":"P0"}' });
  for (const policy of [undefined, 'pure-only', join(files, 'p0.rego'), join(files, 'p0.json')]) {
    const { verdict, policy: forPage } = await judgeHolo({ directory: files, holo: fixture, policy, hasManifest: false });
    assert.equal(agreement(verdict, await verify(bytes, forPage)), true, String(policy));
    // The page receives the policy as JSON.
    assert.equal(agreement(verdict, await verify(bytes, JSON.parse(JSON.stringify(forPage)))), true, String(policy));
  }
});

test('dev judges by a shipped policy name, which is no file to resolve or watch', { timeout: 30000 }, async (t) => {
  const root = project({ 'prismpm.toml': 'project = "App"\n', 'src/App.lex.tex': 'model\n', 'build.mjs': `import { copyFileSync } from 'node:fs';copyFileSync(process.argv[2], 'App.holo');` });
  const dev = startDev([root, '--build', `node build.mjs ${JSON.stringify(fixture)}`, '--holo', 'App.holo', '--policy', 'pure-only']);
  t.after(async () => {
    dev.child.kill();
    await dev.exited;
  });
  const url = await until(() => /Studio at (http:\/\/localhost:\d+)/.exec(dev.output.out)?.[1], `the studio address in ${JSON.stringify(dev.output)}`);
  const state = await until(async () => {
    const current = await stateOf(url.replace('localhost', '127.0.0.1'));
    return current.phase === 'idle' && current.result ? current : null;
  }, 'the first cycle');
  assert.equal(state.result.outcome, 'verdict', JSON.stringify(state.result));
  assert.equal(state.result.verdict.policy.name, 'pure-only');
  assert.doesNotMatch(dev.output.out, /rebuilding/);
});

// The reference projects

test('an edit to a lexicon entry rebuilds, and the patterns reach every model input of both reference projects', async () => {
  const example = (name) => fileURLToPath(new URL(`../../../../examples/${name}`, import.meta.url));
  const watched = async (name) => (await createSnapshot({ root: example(name), patterns: DEFAULT_WATCH }).scan()).files;
  const payment = await watched('PaymentApproval');
  assert.ok(payment.includes('src/PaymentApproval.lex.tex'));
  assert.ok(payment.includes('src/Foundation/Bytes.lex.tex'));
  assert.ok(payment.includes('language/prism.arch/entries/arch-edge.toml'));
  assert.ok(payment.includes('lexlean.toml'));
  assert.ok((await watched('Calculator')).includes('src/Calculator.lex.tex'));
  assert.equal((await describeProject(example('PaymentApproval'))).name, 'PaymentApproval');

  const root = project({ 'language/prism.arch/entries/arch-edge.toml': 'one', 'language/notes.md': 'one' });
  const seen = [];
  const watcher = await createWatcher({ root, patterns: DEFAULT_WATCH, onChange: (change) => seen.push(change), pollMs: 50 });
  try {
    save(root, 'language/notes.md', 'two');
    await delay(200);
    assert.deepEqual(seen, [], 'not a lexicon entry');
    save(root, 'language/prism.arch/entries/arch-edge.toml', 'two');
    await until(() => seen.length === 1, 'the lexicon edit');
    assert.deepEqual(seen[0].files, ['language/prism.arch/entries/arch-edge.toml']);
  } finally {
    watcher.close();
  }
});
