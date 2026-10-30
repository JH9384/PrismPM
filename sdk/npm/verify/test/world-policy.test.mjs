// Is the world within the granted capabilities, and is it pure (issue #283, docs/proposals/283-world-within-policy.md)?
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify, worldPolicy, VerifyError } from '../src/index.mjs';
import { classifyImport, worldPurity, worldWithinGrant, checkWorldPolicy, capabilitySetProblem, IMPURE_EFFECTS } from '../src/world.mjs';
import { reference, assertVerdict } from './helpers.mjs';

const CONTRACT = 'hologram:guest/core-wasm@1';
const STATEMENTS = ['provenance.statement', 'proof.statement', 'replay.statement'];
const checks = (verdict) => verdict.reasons.map((r) => r.check);

/** A world row with these imports and the core-wasm exports; no such contract exists yet, so the rows are built here. */
const world = (...imports) => ({ imports: imports.map(([module, name, capability]) => ({ module, name, kind: 'func', ...(capability ? { capability } : {}) })) });

test('a capability set may allow providers, and no world import can name that kind (#294)', () => {
  assert.equal(capabilitySetProblem({ 'allow-providers': ['kv'], 'deny-providers': ['*'] }), null);
  assert.match(capabilitySetProblem({ 'allow-provider': ['kv'] }), /has no member allow-provider/);
  const world = { imports: [{ module: 'env', name: 'provision', kind: 'function', capability: 'providers' }] };
  const { within, problems } = worldWithinGrant(world, { 'allow-providers': ['*'] });
  assert.equal(within, false);
  assert.match(problems[0], /names no capability kind/);
});

test('imports are classified by WASI interface or WASI 0.1 function, and anything else is unknown', () => {
  const cases = [
    [['wasi:clocks/wall-clock@0.2.0', 'now'], 'clock'],
    [['wasi:clocks/monotonic-clock@0.2.0', 'now'], 'clock'],
    [['wasi:random/random@0.2.0', 'get-random-bytes'], 'random'],
    [['wasi:sockets/tcp@0.2.0', 'start-connect'], 'socket'],
    [['wasi:http/outgoing-handler@0.2.0', 'handle'], 'socket'],
    [['wasi:filesystem/types@0.2.0', 'read'], 'filesystem'],
    [['wasi_snapshot_preview1', 'clock_time_get'], 'clock'],
    [['wasi_snapshot_preview1', 'random_get'], 'random'],
    [['wasi_snapshot_preview1', 'sock_accept'], 'socket'],
    [['wasi_snapshot_preview1', 'poll_oneoff'], 'socket'],
    [['wasi_snapshot_preview1', 'fd_write'], 'filesystem'],
    [['wasi_snapshot_preview1', 'path_open'], 'filesystem'],
    [['wasi_snapshot_preview1', 'proc_exit'], 'none'],
    [['wasi_unstable', 'args_get'], 'none'],
    [['env', 'host'], 'unknown'],
    [['wasi:keyvalue/store@0.2.0', 'get'], 'unknown'],
  ];
  for (const [[module, name], effect] of cases) assert.equal(classifyImport({ module, name }), effect, `${module}.${name}`);
  assert.deepEqual(IMPURE_EFFECTS, ['clock', 'random', 'socket', 'filesystem', 'unknown']);
});

test('a world with no impure import is pure; each impure effect is listed once, sorted', () => {
  assert.deepEqual(worldPurity(world()), { pure: true, effects: [] });
  assert.deepEqual(worldPurity(world(['wasi_snapshot_preview1', 'proc_exit'])), { pure: true, effects: [] });
  assert.deepEqual(worldPurity(world(['wasi:random/random@0.2.0', 'a'], ['wasi:clocks/wall-clock@0.2.0', 'now'], ['wasi:random/random@0.2.0', 'b'])), {
    pure: false,
    effects: ['clock', 'random'],
  });
  assert.deepEqual(worldPurity(world(['env', 'host'])), { pure: false, effects: ['unknown'] }, 'an import nothing describes is not assumed pure');
});

test('a world with no imports is within every grant, including none', () => {
  for (const set of [null, {}, { 'deny-variables': ['*'] }, { 'allow-outbound-hosts': ['https://api.example.com'] }]) {
    assert.deepEqual(worldWithinGrant(world(), set), { within: true, problems: [], pure: true, effects: [] });
  }
});

test('an import needs its capability kind granted, by at least one allow entry no deny entry cancels', () => {
  const w = world(['wasi:http/outgoing-handler@0.2.0', 'handle', 'outbound-hosts'], ['wasi:config/store@0.2.0', 'get', 'variables']);
  assert.equal(worldWithinGrant(w, { 'allow-outbound-hosts': ['https://api.example.com'], 'allow-variables': ['log_level'] }).within, true);
  const none = worldWithinGrant(w, null);
  assert.equal(none.within, false);
  assert.deepEqual(none.problems, [
    'the world imports wasi:http/outgoing-handler@0.2.0.handle, which needs outbound-hosts, and no capability set was granted',
    'the world imports wasi:config/store@0.2.0.get, which needs variables, and no capability set was granted',
  ]);
  const partial = worldWithinGrant(w, { 'allow-variables': ['*'] });
  assert.deepEqual(partial.problems, ['the world imports wasi:http/outgoing-handler@0.2.0.handle, which needs outbound-hosts, and the capability set grants none']);
  // A deny of everything wins over any allow, and a deny of the only allowed entry leaves nothing.
  assert.equal(worldWithinGrant(w, { 'allow-outbound-hosts': ['https://a.example'], 'deny-outbound-hosts': ['*://*'], 'allow-variables': ['*'] }).within, false);
  assert.equal(worldWithinGrant(w, { 'allow-outbound-hosts': ['https://a.example'], 'allow-variables': ['x'], 'deny-variables': ['x'] }).within, false);
  assert.equal(worldWithinGrant(w, { 'allow-outbound-hosts': ['https://a.example'], 'allow-variables': ['*'], 'deny-variables': ['*'] }).within, false);
  // Purity is reported next to the grant: an outbound HTTP import is a socket.
  assert.deepEqual([none.pure, none.effects], [false, ['socket', 'unknown']]);
});

test('an import that names no capability kind can never be granted', () => {
  const result = worldWithinGrant(world(['env', 'host']), { 'allow-outbound-hosts': ['*://*:*'], 'allow-key-value-stores': ['*'], 'allow-variables': ['*'] });
  assert.equal(result.within, false);
  assert.match(result.problems[0], /names no capability kind, so no capability set can grant it/);
});

test('the shape of a capability set is checked; its entry syntax is the runtime\'s', () => {
  assert.equal(capabilitySetProblem({}), null);
  assert.equal(capabilitySetProblem({ 'allow-variables': ['x'] }), null);
  assert.match(capabilitySetProblem([]), /is an object/);
  assert.match(capabilitySetProblem({ 'allow-outbound-host': [] }), /no member allow-outbound-host/);
  assert.match(capabilitySetProblem({ 'allow-variables': 'x' }), /array of strings/);
});

test('worldPolicy for the reference contract: within, pure, and nothing is claimed for an unknown contract', () => {
  assert.deepEqual(worldPolicy(CONTRACT, null), { known: true, within: true, problems: [], pure: true, effects: [] });
  assert.deepEqual(worldPolicy(CONTRACT, { 'allow-variables': ['*'] }).within, true);
  assert.deepEqual(checkWorldPolicy('hologram:guest/core-wasm@2', null), { known: false, within: null, problems: [], pure: null, effects: null });
  assert.throws(() => worldPolicy(CONTRACT, { nope: [] }), (e) => e instanceof VerifyError && e.code === 'policy.invalid');
});

test('the reference archive is within any granted set: no world.capabilities reason, verdict unchanged', async () => {
  const plain = await verify(reference(), { minimum: 'P0' });
  for (const capabilities of [null, {}, { 'allow-outbound-hosts': ['https://api.example.com'] }]) {
    const verdict = await verify(reference(), { minimum: 'P0', capabilities });
    assertVerdict(verdict);
    assert.deepEqual(checks(verdict), STATEMENTS);
    assert.deepEqual(verdict, plain);
  }
});

test('a capabilities policy of the wrong shape gives no verdict: VerifyError policy.invalid', async () => {
  for (const capabilities of ['x', [], { 'allow-host': [] }, { 'allow-variables': [1] }]) {
    await assert.rejects(verify(reference(), { capabilities }), (e) => e instanceof VerifyError && e.code === 'policy.invalid' && /policy\.capabilities/.test(e.message), JSON.stringify(capabilities));
  }
});
