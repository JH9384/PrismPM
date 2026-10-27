// `prism-code run` gated on `check` (issue #282, docs/proposals/282-run-gated-on-check.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify, VerifyError } from '../../verify/src/index.mjs';
import { worldWithinGrant, effectsOutsidePolicy } from '../../verify/src/world.mjs';
import { reference } from '../../verify/test/helpers.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const holo = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const closure = fileURLToPath(new URL('./fixtures/calculator-closure', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'prism-run-gate-'));
const policy = (body) => {
  const path = join(dir, `policy-${Math.random().toString(36).slice(2)}.json`);
  writeFileSync(path, JSON.stringify(body));
  return path;
};

/** Start `run`; resolve with what it printed once it serves, or with its exit when it refuses. */
function start(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [bin, 'run', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    // Served means it printed its start lines and we stopped it. On POSIX run handles SIGTERM and exits 0;
    // on Windows the kill is forced and reports a signal. Either way, it is the stop we asked for.
    let served = false;
    child.stdout.on('data', (chunk) => {
      out += chunk;
      if (!served && /\ncheck: [^\n]*\n/.test(out)) {
        served = true;
        child.kill();
      }
    });
    child.stderr.on('data', (chunk) => (err += chunk));
    child.on('error', reject);
    child.on('exit', (code) => resolve({ code: served ? 'served' : code, out, err }));
  });
}

test('an unchecked holo is refused: the default policy needs P2, every holo today is P0', async () => {
  const r = await start([holo]);
  assert.equal(r.code, 1);
  assert.equal(r.out, '', 'nothing is served');
  assert.match(r.err, /^FAILED {2}P0 unverified {2}policy default requires P2 or above/m);
  assert.match(r.err, /run refused: the holo did not pass check/);
});

test('a holo that passes its policy runs, and says so', async () => {
  const r = await start([holo, '--policy', policy({ minimum: 'P0' })]);
  assert.equal(r.code, 'served', r.err);
  assert.match(r.out, /^Calculator \(holo\) at http:\/\/127\.0\.0\.1:\d+\/\ncapabilities: none granted\nworld: hologram:guest\/core-wasm@1 within the grant, pure\ncheck: passed, P0, policy .*policy-[a-z0-9]+\.json\n$/);
  assert.equal(r.err, '');
});

test('--allow-unverified runs a holo that fails check, with a warning, and the start line says unverified', async () => {
  const r = await start([holo, '--allow-unverified']);
  assert.equal(r.code, 'served', r.err);
  assert.match(r.err, /^warning: the holo failed check \(P0, policy default requires P2\): provenance\.statement, proof\.statement, replay\.statement; running it unverified \(--allow-unverified\)\n$/);
  assert.match(r.out, /\ncheck: NOT PASSED, running unverified\n$/);
});

test('no verdict refuses with exit 2: an unreadable or invalid policy', () => {
  const missing = spawnSync(process.execPath, [bin, 'run', holo, '--policy', join(dir, 'nope.json')], { encoding: 'utf8' });
  assert.equal(missing.status, 2);
  assert.match(missing.stderr, /^no verdict: policy\.unreadable:/);
  const bad = spawnSync(process.execPath, [bin, 'run', holo, '--policy', policy({ effects: ['time'] })], { encoding: 'utf8' });
  assert.equal(bad.status, 2);
  assert.match(bad.stderr, /policy\.effects must be an array of clock, random, socket, filesystem, unknown/);
  assert.equal(spawnSync(process.execPath, [bin, 'run', holo, '--policy'], { encoding: 'utf8' }).status, 64);
});

test('a closure cannot be judged: refused without the flag, run unverified with it', async () => {
  const refused = spawnSync(process.execPath, [bin, 'run', closure, '--model', join(closure, '..', 'nope')], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^run\.unverified: .* is a closure, which check cannot judge/);
});

test('the pure-world policy: effects [] passes a world with no imports, and refuses clock or random unless granted', async () => {
  const pure = await verify(reference(), { minimum: 'P0', effects: [] });
  assert.equal(pure.passed, true);
  assert.ok(!pure.reasons.some((r) => r.check === 'policy.effects'));
  // No world with imports exists yet (core-wasm@1 imports nothing), so the impure cases run through the same
  // two functions verify() calls: worldWithinGrant for the world's effects, effectsOutsidePolicy for the decision.
  const world = (module, name) => ({ imports: [{ module, name, kind: 'func', capability: 'variables' }] });
  const grant = { 'allow-variables': ['*'] };
  for (const [w, effect] of [[world('wasi:clocks/wall-clock@0.2.0', 'now'), 'clock'], [world('wasi:random/random@0.2.0', 'get-random-u64'), 'random']]) {
    const { effects } = worldWithinGrant(w, grant);
    assert.deepEqual(effects, [effect]);
    assert.deepEqual(effectsOutsidePolicy(effects, []), [effect], `${effect} refused by the pure-world policy`);
    assert.deepEqual(effectsOutsidePolicy(effects, [effect]), [], `${effect} allowed when granted`);
    assert.deepEqual(effectsOutsidePolicy(effects, null), [], 'no effects member allows any');
  }
});

test('policy.effects is checked: a list of known effects, without repeats', async () => {
  for (const effects of ['clock', ['time'], ['clock', 'clock'], [1]]) {
    await assert.rejects(verify(reference(), { effects }), (e) => e instanceof VerifyError && e.code === 'policy.invalid', JSON.stringify(effects));
  }
  for (const effects of [[], ['clock'], ['clock', 'random', 'socket', 'filesystem', 'unknown']]) {
    assert.equal((await verify(reference(), { minimum: 'P0', effects })).passed, true, JSON.stringify(effects));
  }
});

test('run judges the grant it will run under: world.capabilities sees the --capabilities set', async () => {
  const caps = join(dir, 'caps.json');
  writeFileSync(caps, JSON.stringify({ schema: 'prism/capabilities/1', sets: { default: {}, online: { 'allow-outbound-hosts': ['https://api.example.com'] } } }));
  const r = await start([holo, '--policy', policy({ minimum: 'P0' }), '--capabilities', caps, '--capability-set', 'online']);
  assert.equal(r.code, 'served', r.err);
  assert.match(r.out, /\ncapabilities: set online of .*caps\.json\n/);
});
