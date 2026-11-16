// Host-boundary counterexamples only. Separate generated native/Wasm owners
// exercise source ledger transitions; these backend doubles do not qualify them.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createRetainedResourceAdapter, retainedResourceProtocol,
  privateRetainedQuarantinedOwnerCount, privateRetainedInstanceCount}
  from '../crates/prismpm/src/resource_adapter/retained_runtime_v2.mjs';
const bytes = (...xs) => Uint8Array.from(xs);
const all = Uint8Array.from({length: 256}, (_, i) => i);
const limits = {maximumConfigBytes: 256, maximumEventBytes: 256, maximumObservationBytes: 256, maximumSessions: 2};
function fixture(overrides = {}, selected = {}) {
  const calls = [], live = new Set(); let retired = 0;
  const backend = {
    protocol: retainedResourceProtocol,
    init(config) { const resource = {config}; live.add(resource); calls.push(['init', resource, config]); return {kind: 'ready', resource, observation: config}; },
    advance(resource, event) { assert.ok(live.has(resource)); calls.push(['advance', resource, event]); return {kind: 'retained', observation: event}; },
    requestRelease(resource) { assert.ok(live.has(resource)); calls.push(['permit', resource]); return {kind: 'releaseAuthorized', observation: bytes(255)}; },
    release(resource) { assert.ok(live.delete(resource)); calls.push(['destroy', resource]); },
    ...overrides
  };
  const adapter = createRetainedResourceAdapter({backend, limits: {...limits, ...selected}, retire() { retired++; }});
  return {adapter, backend, calls, live, retired: () => retired};
}
async function ready(f, config = bytes()) { const r = await f.adapter.init(config); assert.equal(r.kind, 'ready'); return r.session; }
async function release(f, session) { assert.equal((await f.adapter.requestRelease(session)).kind, 'released'); }

test('opaque observations retain all bytes and never imply terminal destruction', async () => {
  const f = fixture(), session = await ready(f, all);
  for (const event of [all, bytes(), bytes(0), bytes(255), bytes(128, 192, 0)]) {
    assert.deepEqual(await f.adapter.advance(session, event), {kind: 'retained', observation: event});
    assert.equal(f.live.size, 1);
  }
  assert.equal((await f.adapter.close()).code, 'OwnersRetained');
  assert.equal(f.calls.filter(x => x[0] === 'destroy').length, 0);
  await release(f, session); assert.equal(f.live.size, 0); await f.adapter.close();
});

test('a retained source release refusal survives completion, cancel and repeated close', async () => {
  const f = fixture({requestRelease(resource) { f.calls.push(['permit', resource]); return {kind: 'retained', observation: bytes(2, 1)}; }});
  const session = await ready(f);
  for (const event of [bytes(1), bytes(2), bytes(3)]) {
    await f.adapter.advance(session, event);
    assert.equal((await f.adapter.requestRelease(session)).kind, 'retained');
    assert.equal((await f.adapter.close()).code, 'OwnersRetained');
  }
  assert.equal(f.live.size, 1); assert.equal(f.retired(), 0);
  f.backend.requestRelease = () => ({kind: 'releaseAuthorized', observation: bytes(8)});
  await release(f, session); await f.adapter.close();
});

test('release grants are accepted only from the dedicated current-state source call', async () => {
  const f = fixture({advance: () => ({kind: 'releaseAuthorized', observation: bytes()})});
  const session = await ready(f);
  assert.equal((await f.adapter.advance(session, bytes())).code, 'BackendProtocol');
  assert.equal(f.live.size, 1); assert.equal(f.calls.filter(x => x[0] === 'destroy').length, 0);
  assert.equal((await f.adapter.requestRelease(session)).code, 'InstancePoisoned');
});

test('stale, double-release, foreign and serialized tokens cannot reach the backend', async () => {
  const a = fixture(), b = fixture(); const one = await ready(a), other = await ready(b);
  assert.equal((await b.adapter.requestRelease(one)).code, 'ForeignSession');
  assert.equal((await a.adapter.advance(JSON.parse(JSON.stringify(one)), bytes())).code, 'ForeignSession');
  await release(a, one);
  const before = a.calls.length;
  assert.equal((await a.adapter.requestRelease(one)).code, 'StaleSession');
  assert.equal((await a.adapter.advance(one, bytes())).code, 'StaleSession');
  assert.equal(a.calls.length, before);
  const newSession = await ready(a); assert.notEqual(newSession, one);
  await release(a, newSession); await release(b, other); await a.adapter.close(); await b.adapter.close();
});

test('copying precedes destruction and output copies survive memory growth and mutation', async () => {
  const memory = new WebAssembly.Memory({initial: 1, maximum: 2});
  const view = new Uint8Array(memory.buffer, 0, 256); view.set(all);
  const f = fixture({requestRelease: () => ({kind: 'releaseAuthorized', observation: view}),
    release(resource) { memory.grow(1); assert.ok(f.live.delete(resource)); f.calls.push(['destroy', resource]); }});
  const session = await ready(f); const result = await f.adapter.requestRelease(session);
  new Uint8Array(memory.buffer).fill(0); assert.deepEqual(result.observation, all);
  assert.equal(f.calls.filter(x => x[0] === 'destroy').length, 1); await f.adapter.close();
});

test('post-dispatch observation limit holds exact grant and refuses replay or destructor', async () => {
  let permits = 0;
  const f = fixture({requestRelease: () => { permits++; return {kind: 'releaseAuthorized', observation: bytes(1, 2)}; }}, {maximumObservationBytes: 1});
  const session = await ready(f);
  assert.equal((await f.adapter.requestRelease(session)).code, 'ObservationLimit');
  for (const op of [() => f.adapter.advance(session, bytes()), () => f.adapter.requestRelease(session), () => f.adapter.init(bytes()), () => f.adapter.close()]) {
    assert.equal((await op()).code, 'ObservationPending');
  }
  assert.equal((await f.adapter.retryObservation(session)).code, 'ObservationLimit');
  assert.equal(permits, 1); assert.equal(f.live.size, 1);
  assert.equal((await f.adapter.abandon()).ownership, 'unknown');
  assert.equal(f.calls.filter(x => x[0] === 'destroy').length, 0);
});

test('a transient adapter-copy refusal retries the same grant then destroys exactly once', async () => {
  // Fault injection in a fresh module realm; no production injection hook and
  // no claim that arbitrary engine/process OOM is catchable or recoverable.
  const Original = globalThis.Uint8Array; let failNextCopy = false;
  globalThis.Uint8Array = new Proxy(Original, {construct(target, argumentsList) {
    if (failNextCopy) { failNextCopy = false; throw new RangeError('injected copy refusal'); }
    return Reflect.construct(target, argumentsList);
  }});
  let factory;
  try { factory = (await import('../crates/prismpm/src/resource_adapter/retained_runtime_v2.mjs?copy-refusal')).createRetainedResourceAdapter; }
  finally { globalThis.Uint8Array = Original; }
  let permits = 0, destroys = 0;
  const backend = {
    protocol: retainedResourceProtocol,
    init: () => ({kind: 'ready', resource: {}, observation: bytes()}),
    advance: () => ({kind: 'retained', observation: bytes()}),
    requestRelease() { permits++; failNextCopy = true; return {kind: 'releaseAuthorized', observation: bytes(0, 255)}; },
    release() { destroys++; }
  };
  const adapter = factory({backend, limits, retire() {}});
  const {session} = await adapter.init(bytes());
  assert.equal((await adapter.requestRelease(session)).code, 'AdapterAllocation');
  assert.equal(permits, 1); assert.equal(destroys, 0);
  assert.deepEqual(await adapter.retryObservation(session), {kind: 'released', observation: bytes(0, 255)});
  assert.equal(permits, 1); assert.equal(destroys, 1);
  assert.equal((await adapter.retryObservation(session)).code, 'StaleSession');
  await adapter.close();
});

test('detached observation after state adoption is held rather than dropped or replayed', async () => {
  const detached = bytes(5); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  let advances = 0;
  const f = fixture({advance: () => { advances++; return {kind: 'retained', observation: detached}; }});
  const session = await ready(f);
  assert.equal((await f.adapter.advance(session, bytes())).code, 'AdapterAllocation');
  assert.equal((await f.adapter.retryObservation(session)).code, 'AdapterAllocation');
  assert.equal((await f.adapter.requestRelease(session)).code, 'ObservationPending');
  assert.equal(advances, 1); assert.equal(f.live.size, 1); await f.adapter.abandon();
});

test('init observation refusal returns its retained session and never retries init', async () => {
  const f = fixture({}, {maximumObservationBytes: 0});
  const r = await f.adapter.init(bytes(1)); assert.equal(r.code, 'ObservationLimit'); assert.ok(r.session);
  assert.equal((await f.adapter.retryObservation(r.session)).code, 'ObservationLimit');
  assert.equal((await f.adapter.retryObservation(Object.freeze({}))).code, 'ForeignSession');
  assert.equal(f.calls.filter(x => x[0] === 'init').length, 1); assert.equal(f.live.size, 1); await f.adapter.abandon();
});

test('every checked-error variant retains owners and blocks all further guest calls', async () => {
  for (const code of ['AddOverflow', 'MulOverflow', 'ShiftExponentTooLarge', 'ShiftOverflow', 'PowExponentTooLarge', 'PowOverflow', 'OutputTooSmall']) {
    const f = fixture({advance: () => ({kind: 'computeError', code})}); const session = await ready(f);
    assert.deepEqual(await f.adapter.advance(session, bytes()), {kind: 'computeError', code, ownership: 'retained', recovery: 'blocked'});
    for (const op of [() => f.adapter.advance(session, bytes()), () => f.adapter.requestRelease(session), () => f.adapter.close(), () => f.adapter.init(bytes())]) {
      assert.equal((await op()).code, 'ComputeFailureHeld');
    }
    assert.equal(f.live.size, 1); assert.equal((await f.adapter.abandon()).ownership, 'unknown');
    assert.equal(f.calls.filter(x => x[0] === 'destroy').length, 0);
  }
});

test('checked failure in release authorization cannot use the old state to release', async () => {
  const f = fixture({requestRelease: () => ({kind: 'computeError', code: 'AddOverflow'})}); const session = await ready(f);
  assert.equal((await f.adapter.requestRelease(session)).kind, 'computeError');
  assert.equal((await f.adapter.requestRelease(session)).code, 'ComputeFailureHeld');
  assert.equal(f.live.size, 1); await f.adapter.abandon();
});

test('pre-call copy and resource refusal preserve healthy ownership without a fault barrier', async () => {
  const detached = bytes(1); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  const f = fixture(); assert.equal((await f.adapter.init(detached)).code, 'AdapterAllocation'); assert.equal(f.calls.length, 0);
  const session = await ready(f), before = f.calls.length;
  assert.equal((await f.adapter.advance(session, detached)).code, 'AdapterAllocation'); assert.equal(f.calls.length, before);
  f.backend.advance = () => ({kind: 'resourceRefusal'});
  assert.equal((await f.adapter.advance(session, bytes())).code, 'ResourceRefusal');
  await release(f, session); await f.adapter.close();
});

test('reentrancy, concurrent steps and busy abandon refuse before guest dispatch', async () => {
  let unblock, entered;
  const enteredPromise = new Promise(resolve => { entered = resolve; });
  const f = fixture({async advance() { entered(); await new Promise(resolve => { unblock = resolve; }); return {kind: 'retained', observation: bytes()}; }});
  const session = await ready(f); const running = f.adapter.advance(session, bytes()); await enteredPromise;
  for (const op of [() => f.adapter.advance(session, bytes()), () => f.adapter.requestRelease(session), () => f.adapter.abandon(), () => f.adapter.close()]) {
    assert.equal((await op()).code, 'ConcurrentCall');
  }
  assert.equal(f.retired(), 0); unblock(); assert.equal((await running).kind, 'retained');
  await release(f, session); await f.adapter.close();
});

test('release exceptions poison and quarantine without another destructor or false cleanup', async () => {
  const before = privateRetainedQuarantinedOwnerCount();
  const f = fixture({release() { throw new Error('partial release outcome unknown'); }}); const session = await ready(f);
  const r = await f.adapter.requestRelease(session); assert.equal(r.kind, 'fatal'); assert.equal(r.code, 'ReleaseFailure'); assert.equal(r.ownership, 'unknown');
  assert.equal(privateRetainedQuarantinedOwnerCount(), before + 1); assert.equal(f.retired(), 1);
  assert.equal((await f.adapter.requestRelease(session)).code, 'InstancePoisoned');
});

test('traps retain all sessions and unreturned candidates until external realm retirement', async () => {
  const f = fixture(); const a = await ready(f), b = await ready(f);
  f.backend.advance = () => { throw new WebAssembly.RuntimeError('trap'); };
  assert.equal((await f.adapter.advance(a, bytes())).code, 'BackendTrap');
  assert.equal((await f.adapter.requestRelease(b)).code, 'InstancePoisoned'); assert.equal(f.live.size, 2);
});

test('module custody remains registered until explicit healthy close retires it', async () => {
  const before = privateRetainedInstanceCount();
  const f = fixture(); assert.equal(privateRetainedInstanceCount(), before + 1);
  const session = await ready(f); assert.equal((await f.adapter.close()).code, 'OwnersRetained');
  assert.equal(privateRetainedInstanceCount(), before + 1);
  await release(f, session); await f.adapter.close(); assert.equal(privateRetainedInstanceCount(), before);
  assert.equal((await f.adapter.init(bytes())).code, 'InstanceClosed');
});

test('limits use intrinsic lengths and buffers are copied despite species and shadow fields', async () => {
  class Alias extends Uint8Array { static get [Symbol.species]() { throw new Error('must not call'); } }
  const input = new Alias(all); Object.defineProperties(input, {byteLength: {value: 0}, buffer: {value: new ArrayBuffer(0)}});
  const f = fixture(); const r = await f.adapter.init(input); input.fill(9); assert.deepEqual(r.observation, all);
  const tiny = fixture({}, {maximumConfigBytes: 0}); assert.equal((await tiny.adapter.init(input)).code, 'ConfigLimit'); await tiny.adapter.close();
  if (typeof SharedArrayBuffer !== 'undefined') assert.equal((await f.adapter.advance(r.session, new Uint8Array(new SharedArrayBuffer(1)))).code, 'InvalidInput');
  await release(f, r.session); await f.adapter.close();
});

test('accessor replies and invalid protocols refuse without treating text as source authority', async () => {
  assert.throws(() => fixture({protocol: 'prismpm/private-resource-component/1'}), TypeError);
  let reads = 0; const f = fixture({advance: () => ({get kind() { reads++; return 'retained'; }, observation: bytes()})}); const session = await ready(f);
  assert.equal((await f.adapter.advance(session, bytes())).code, 'BackendProtocol'); assert.equal(reads, 0); assert.equal(f.live.size, 1);
});

test('a Proxy reply cannot upgrade retained status to a release grant between descriptor reads', async () => {
  let kindReads = 0;
  const reply = new Proxy({kind: 'retained', observation: bytes(4)}, {
    getOwnPropertyDescriptor(target, key) {
      if (key === 'kind') return {value: ++kindReads === 1 ? 'retained' : 'releaseAuthorized', writable: true, enumerable: true, configurable: true};
      return Reflect.getOwnPropertyDescriptor(target, key);
    }
  });
  const f = fixture({requestRelease: () => reply}); const session = await ready(f);
  assert.equal((await f.adapter.requestRelease(session)).kind, 'retained');
  assert.equal(kindReads, 1); assert.equal(f.live.size, 1);
  assert.equal(f.calls.filter(row => row[0] === 'destroy').length, 0);
  await f.adapter.abandon();
});
