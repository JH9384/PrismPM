// Private host component counterexamples; generated-Wasm execution has its own
// source-owned Rust/Node probe. These stubs are never application acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {runInNewContext} from 'node:vm';
import {createResourceAdapter, privateQuarantinedOwnerCount} from '../crates/prismpm/src/resource_adapter/runtime.mjs';

const bytes = (...value) => Uint8Array.from(value);
const all = Uint8Array.from({length: 256}, (_, i) => i);
const limits = {maximumConfigBytes: 256, maximumChunkBytes: 256, maximumOutputBytes: 256,
  maximumDiagnosticBytes: 256, maximumSummaryBytes: 256, maximumSessions: 2};
const failed = () => ({kind: 'failed', error: bytes(0, 255), disposition: bytes(2)});
function fixture(overrides = {}, selectedLimits = {}) {
  const calls = [], live = new Set(); let retired = 0;
  const backend = {
    init(config) { const resource = {config, eof: false}; live.add(resource); calls.push(['init', resource]); return {kind: 'ready', resource}; },
    step(resource, event) {
      assert.ok(live.has(resource)); calls.push(['step', resource, event]);
      if (event.kind === 'tick') return {kind: 'needInput'};
      if (event.kind === 'chunk') return {kind: 'output', bytes: event.bytes};
      if (event.kind === 'endOfInput') { resource.eof = true; return {kind: 'complete', summary: resource.config}; }
      if (event.kind === 'cancel') return failed();
      throw new Error('unreachable fixture input');
    },
    release(resource) { assert.ok(live.delete(resource)); calls.push(['release', resource]); },
    ...overrides
  };
  const adapter = createResourceAdapter({backend, limits: {...limits, ...selectedLimits}, retire() { retired++; }});
  return {adapter, calls, live, backend, retired: () => retired};
}
const ready = async (adapter, config = bytes()) => { const result = await adapter.init(config); assert.equal(result.kind, 'ready'); return result.session; };
async function demand(adapter, session) { assert.deepEqual(await adapter.step(session, {kind: 'tick'}), {kind: 'needInput'}); }

test('all octets, NUL, invalid UTF-8 and empty chunks remain bytes through EOF', async () => {
  const f = fixture(); const session = await ready(f.adapter, all);
  for (const input of [all, bytes()]) {
    await demand(f.adapter, session);
    const result = await f.adapter.step(session, {kind: 'chunk', bytes: input});
    assert.equal(result.kind, 'output'); assert.deepEqual(result.bytes, input);
  }
  await demand(f.adapter, session);
  assert.deepEqual(await f.adapter.step(session, {kind: 'endOfInput'}), {kind: 'complete', summary: all});
  assert.equal(f.live.size, 0); assert.equal(f.calls.filter(row => row[0] === 'release').length, 1);
  assert.equal((await f.adapter.release(session)).code, 'StaleSession');
});

test('opaque identity rejects cross-instance collisions and stale tokens after backend index wrap', async () => {
  const a = fixture(), b = fixture();
  const old = await ready(a.adapter); const other = await ready(b.adapter);
  assert.notEqual(old, other); assert.ok(Object.isFrozen(old)); assert.equal(Object.keys(old).length, 0);
  assert.equal((await b.adapter.step(old, {kind: 'tick'})).code, 'ForeignSession');
  assert.equal((await a.adapter.release(other)).code, 'ForeignSession');
  assert.deepEqual(await a.adapter.release(old), {kind: 'released'});
  // Simulate an allocator/table reusing the identical raw address/index. The
  // host identity remains a new object and cannot wrap back to the old token.
  const reusedRawResource = a.calls[0][1];
  a.backend.init = () => { a.live.add(reusedRawResource); return {kind: 'ready', resource: reusedRawResource}; };
  const next = await ready(a.adapter); assert.notEqual(next, old);
  assert.equal((await a.adapter.step(old, {kind: 'tick'})).code, 'StaleSession');
  assert.equal((await a.adapter.release(old)).code, 'StaleSession');
  await demand(a.adapter, next); assert.equal(a.live.size, 1);
  await a.adapter.close(); await b.adapter.close();
});

test('distinct sessions retain independent resources and configured session limits are retryable', async () => {
  const f = fixture(); const one = await ready(f.adapter, bytes(1)), two = await ready(f.adapter, bytes(2));
  assert.equal((await f.adapter.init(bytes())).code, 'SessionLimit');
  await demand(f.adapter, one); await demand(f.adapter, two);
  await f.adapter.step(two, {kind: 'endOfInput'});
  assert.equal(f.live.size, 1); await demand(f.adapter, one);
  const three = await ready(f.adapter, bytes(3)); assert.notEqual(three, two);
  await f.adapter.close(); assert.equal(f.live.size, 0); assert.equal(f.retired(), 1);
  assert.equal((await f.adapter.init(bytes())).code, 'InstanceClosed');
});

test('input demand, one-shot EOF and completion sequencing are enforced before guest mutation', async () => {
  const f = fixture(); const session = await ready(f.adapter);
  assert.equal((await f.adapter.step(session, {kind: 'chunk', bytes: bytes()})).code, 'InvalidPhase');
  assert.equal((await f.adapter.step(session, {kind: 'endOfInput'})).code, 'InvalidPhase');
  assert.equal(f.calls.filter(row => row[0] === 'step').length, 0);
  await demand(f.adapter, session);
  f.backend.step = (_resource, event) => ({kind: event.kind === 'endOfInput' ? 'advanced' : 'complete', summary: bytes()});
  // A malformed advanced event is an unknown backend outcome and poisons the
  // instance, rather than being interpreted as source completion.
  const result = await f.adapter.step(session, {kind: 'endOfInput'});
  assert.equal(result.kind, 'fatal'); assert.equal(result.code, 'BackendProtocol');
  assert.equal(f.retired(), 1);
});

test('EOF cannot be fed twice, and needInput after EOF is a protocol failure', async () => {
  const f = fixture(); const session = await ready(f.adapter); await demand(f.adapter, session);
  f.backend.step = () => ({kind: 'advanced'});
  assert.deepEqual(await f.adapter.step(session, {kind: 'endOfInput'}), {kind: 'advanced'});
  assert.equal((await f.adapter.step(session, {kind: 'endOfInput'})).code, 'InvalidPhase');
  assert.equal((await f.adapter.step(session, {kind: 'chunk', bytes: bytes()})).code, 'InvalidPhase');
  f.backend.step = () => ({kind: 'needInput'});
  assert.equal((await f.adapter.step(session, {kind: 'tick'})).code, 'BackendProtocol');
});

test('source completion before EOF poisons without falsely releasing an unknown guest state', async () => {
  const f = fixture({step: () => ({kind: 'complete', summary: bytes()})}); const session = await ready(f.adapter);
  assert.equal((await f.adapter.step(session, {kind: 'tick'})).kind, 'fatal');
  assert.equal(f.calls.filter(row => row[0] === 'release').length, 0);
  assert.equal((await f.adapter.release(session)).code, 'InstancePoisoned');
});

test('cancellation after output consumes state but preserves the prior independent byte copy', async () => {
  const f = fixture(); const session = await ready(f.adapter); await demand(f.adapter, session);
  const result = await f.adapter.step(session, {kind: 'chunk', bytes: all});
  const cancel = await f.adapter.step(session, {kind: 'cancel'});
  assert.deepEqual(cancel, {kind: 'cancelled', error: bytes(0, 255), sourceDisposition: bytes(2)});
  assert.deepEqual(result.bytes, all); assert.equal(f.live.size, 0);
  assert.equal((await f.adapter.step(session, {kind: 'tick'})).code, 'StaleSession');
});

test('cancel yielding output/completion does not create publication permission', async () => {
  for (const response of [{kind: 'output', bytes: all}, {kind: 'complete', summary: bytes()}, {kind: 'advanced'}, {kind: 'needInput'}]) {
    const f = fixture({step: () => response}); const session = await ready(f.adapter);
    const result = await f.adapter.step(session, {kind: 'cancel'});
    assert.equal(result.kind, 'fatal'); assert.equal(result.code, 'BackendProtocol');
    assert.equal(f.calls.filter(row => row[0] === 'release').length, 0);
  }
});

test('in-flight and recursive calls are refused without racing or pretending cancellation', async () => {
  let resolve, reentry, adapter;
  const f = fixture({step(resource, event) {
    reentry = adapter.step(session, {kind: 'tick'});
    return new Promise(done => { resolve = done; });
  }}); adapter = f.adapter; const session = await ready(adapter);
  const pending = adapter.step(session, {kind: 'tick'});
  assert.equal((await reentry).code, 'ConcurrentCall');
  for (const operation of [() => adapter.init(bytes()), () => adapter.release(session),
    () => adapter.close(), () => adapter.step(session, {kind: 'cancel'})]) {
    assert.equal((await operation()).code, 'ConcurrentCall');
  }
  resolve({kind: 'output', bytes: all}); assert.equal((await pending).kind, 'output');
  f.backend.step = () => failed(); assert.equal((await adapter.step(session, {kind: 'cancel'})).kind, 'cancelled');
});

test('configuration and chunks are copied before asynchronous guest use', async () => {
  let configSeen, chunkSeen, resolve;
  const f = fixture({init(config) { configSeen = config; return {kind: 'ready', resource: {}}; },
    step(_resource, event) { if (event.kind === 'tick') return {kind: 'needInput'};
      chunkSeen = event.bytes; return new Promise(done => { resolve = done; }); }, release() {}});
  const config = bytes(0, 255); const session = await ready(f.adapter, config); config.fill(1);
  assert.deepEqual(configSeen, bytes(0, 255)); await demand(f.adapter, session);
  const chunk = bytes(5, 0, 255); const pending = f.adapter.step(session, {kind: 'chunk', bytes: chunk});
  chunk.fill(9); assert.deepEqual(chunkSeen, bytes(5, 0, 255));
  resolve({kind: 'output', bytes: chunkSeen}); const result = await pending;
  chunkSeen.fill(7); assert.deepEqual(result.bytes, bytes(5, 0, 255)); await f.adapter.release(session);
});

test('output copies survive Wasm memory growth and explicit resource release', async () => {
  const memory = new WebAssembly.Memory({initial: 1, maximum: 3});
  new Uint8Array(memory.buffer).set(all);
  const f = fixture({step: () => ({kind: 'output', bytes: new Uint8Array(memory.buffer, 0, 256)})});
  const session = await ready(f.adapter); const output = await f.adapter.step(session, {kind: 'tick'});
  memory.grow(1); new Uint8Array(memory.buffer).fill(0);
  await f.adapter.release(session); assert.deepEqual(output.bytes, all);
});

test('species aliases and shadowed buffer/length cannot bypass byte ownership or limits', async () => {
  const planted = bytes(3, 4, 5);
  class AliasingBytes extends Uint8Array {
    static get [Symbol.species]() { return function () { return planted; }; }
  }
  const source = new AliasingBytes([0, 255, 1]);
  Object.defineProperties(source, {byteLength: {value: 0}, buffer: {value: new ArrayBuffer(0)}});
  const f = fixture({step: () => ({kind: 'output', bytes: source})});
  const session = await ready(f.adapter, source);
  assert.deepEqual(f.calls[0][1].config, bytes(0, 255, 1));
  const output = await f.adapter.step(session, {kind: 'tick'});
  source.fill(6); planted.fill(7); assert.deepEqual(output.bytes, bytes(0, 255, 1));
  const limited = fixture({}, {maximumConfigBytes: 0});
  assert.equal((await limited.adapter.init(source)).code, 'ConfigLimit');
  if (typeof SharedArrayBuffer !== 'undefined') {
    const shared = new Uint8Array(new SharedArrayBuffer(3));
    Object.defineProperty(shared, 'buffer', {value: new ArrayBuffer(0)});
    assert.equal((await f.adapter.init(shared)).code, 'InvalidInput');
  }
  await f.adapter.close();
});

test('a refused adapter copy leaves input state unchanged or releases a safe tagged output', async () => {
  const detached = bytes(1, 2); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  const f = fixture(); assert.equal((await f.adapter.init(detached)).code, 'AdapterAllocation');
  assert.equal(f.calls.length, 0);
  const session = await ready(f.adapter); await demand(f.adapter, session);
  assert.equal((await f.adapter.step(session, {kind: 'chunk', bytes: detached})).code, 'AdapterAllocation');
  assert.equal(f.calls.filter(row => row[0] === 'step').length, 1);
  f.backend.step = () => ({kind: 'output', bytes: detached});
  assert.deepEqual(await f.adapter.step(session, {kind: 'tick'}),
    {kind: 'adapterError', code: 'AdapterAllocation', ownership: 'released'});
  assert.equal(f.live.size, 0);
});

test('modeled, compute and explicit adapter refusals remain distinguishable and release terminal state', async () => {
  for (const [response, expected] of [[failed(), 'modeledError'], [{kind: 'computeError', code: 'AddOverflow'}, 'computeError'],
    [{kind: 'resourceRefusal'}, 'adapterError']]) {
    const f = fixture({step: () => response}); const session = await ready(f.adapter);
    assert.equal((await f.adapter.step(session, {kind: 'tick'})).kind, expected);
    assert.equal(f.live.size, 0); assert.equal(f.retired(), 0);
  }
  for (const response of [failed(), {kind: 'computeError', code: 'MulOverflow'}, {kind: 'resourceRefusal'}]) {
    const f = fixture({init: () => response}); const result = await f.adapter.init(bytes());
    assert.notEqual(result.kind, 'ready'); assert.equal(f.calls.length, 0); assert.equal(f.retired(), 0);
  }
});

test('typed ComputeError during cancellation is not successful cancellation', async () => {
  const f = fixture({step: () => ({kind: 'computeError', code: 'OutputTooSmall'})}); const session = await ready(f.adapter);
  assert.deepEqual(await f.adapter.step(session, {kind: 'cancel'}), {kind: 'computeError', code: 'OutputTooSmall'});
  assert.equal(f.live.size, 0);
});

test('transport limits refuse before execution or safely release after a tagged oversized result', async () => {
  const f = fixture({}, {maximumConfigBytes: 0, maximumChunkBytes: 0, maximumOutputBytes: 0});
  assert.equal((await f.adapter.init(bytes(1))).code, 'ConfigLimit'); assert.equal(f.calls.length, 0);
  const session = await ready(f.adapter); await demand(f.adapter, session);
  assert.equal((await f.adapter.step(session, {kind: 'chunk', bytes: bytes(1)})).code, 'ChunkLimit');
  assert.equal(f.calls.filter(row => row[0] === 'step').length, 1);
  f.backend.step = () => ({kind: 'output', bytes: bytes(1)});
  assert.deepEqual(await f.adapter.step(session, {kind: 'chunk', bytes: bytes()}),
    {kind: 'adapterError', code: 'OutputLimit', ownership: 'released'});
  assert.equal(f.live.size, 0);
});

test('oversized diagnostics and summaries release safely, while malformed bytes poison', async () => {
  const f = fixture({step: () => failed()}, {maximumDiagnosticBytes: 0}); const session = await ready(f.adapter);
  assert.deepEqual(await f.adapter.step(session, {kind: 'tick'}), {kind: 'adapterError', code: 'DiagnosticLimit', ownership: 'released'});
  const g = fixture({}, {maximumSummaryBytes: 0}); const other = await ready(g.adapter, bytes(1)); await demand(g.adapter, other);
  assert.equal((await g.adapter.step(other, {kind: 'endOfInput'})).code, 'SummaryLimit'); assert.equal(g.live.size, 0);
  const h = fixture({step: () => ({kind: 'output', bytes: 'not bytes'})}); const bad = await ready(h.adapter);
  assert.equal((await h.adapter.step(bad, {kind: 'tick'})).kind, 'fatal');
});

test('unknown computation codes, leaked state and duplicate resource aliases retire the instance', async () => {
  for (const response of [{kind: 'computeError', code: 'debug(private)'}, {kind: 'advanced', state: {}}, null]) {
    const f = fixture({step: () => response}); const session = await ready(f.adapter);
    assert.equal((await f.adapter.step(session, {kind: 'tick'})).code, 'BackendProtocol'); assert.equal(f.retired(), 1);
  }
  const resource = {}; const f = fixture({init: () => ({kind: 'ready', resource})}); await ready(f.adapter);
  assert.equal((await f.adapter.init(bytes())).code, 'BackendProtocol');
});

test('traps and unexpected exceptions poison all sessions without calling guest destructors', async () => {
  for (const [error, code] of [[new WebAssembly.RuntimeError('unreachable'), 'BackendTrap'],
    [new RangeError('guest allocator failure'), 'BackendException'], [new Error('backend failure'), 'BackendException']]) {
    const f = fixture({step() { throw error; }}); const one = await ready(f.adapter), two = await ready(f.adapter);
    const result = await f.adapter.step(one, {kind: 'tick'});
    assert.equal(result.kind, 'fatal'); assert.equal(result.code, code); assert.equal(result.ownership, 'unknown');
    assert.equal(f.retired(), 1); assert.equal((await f.adapter.release(two)).code, 'InstancePoisoned');
    assert.equal((await f.adapter.close()).code, 'InstancePoisoned');
    assert.equal(f.calls.filter(row => row[0] === 'release').length, 0);
  }
});

test('terminal release failure replaces apparent success with fatal unknown and stops later destruction', async () => {
  let releases = 0;
  const f = fixture({release() { releases++; throw new Error('release trapped'); }});
  const one = await ready(f.adapter), two = await ready(f.adapter); await demand(f.adapter, one);
  const result = await f.adapter.step(one, {kind: 'endOfInput'});
  assert.equal(result.kind, 'fatal'); assert.equal(result.code, 'ReleaseFailure'); assert.equal(result.ownership, 'unknown');
  assert.equal((await f.adapter.release(two)).code, 'InstancePoisoned'); assert.equal(releases, 1);
});

test('a malformed resolved release response is a fatal backend protocol failure', async () => {
  const f = fixture({release: () => ({kind: 'complete'})}); const session = await ready(f.adapter);
  assert.equal((await f.adapter.release(session)).code, 'BackendProtocol');
  assert.equal((await f.adapter.init(bytes())).code, 'InstancePoisoned');
});

test('owner retirement failure is recorded and never retried as successful cleanup', async () => {
  let attempts = 0;
  const f = fixture();
  const adapter = createResourceAdapter({backend: f.backend, limits, retire() { attempts++; throw new Error('owner shutdown failed'); }});
  await ready(adapter);
  assert.deepEqual(await adapter.close(), {kind: 'fatal', code: 'RetirementFailure', ownership: 'unknown', retirement: 'failed'});
  assert.equal((await adapter.init(bytes())).code, 'InstancePoisoned');
  assert.equal((await adapter.close()).code, 'InstancePoisoned'); assert.equal(attempts, 1);
});

test('malformed caller input does not poison or call the guest; no default semantic caps exist', async () => {
  const f = fixture(); const session = await ready(f.adapter);
  for (const event of [null, {kind: 'chunk', bytes: 'utf8'}, {kind: 'tick', extra: 1}, {kind: 'unknown'}]) {
    assert.equal((await f.adapter.step(session, event)).code, 'InvalidInput');
  }
  assert.equal((await f.adapter.init('text')).code, 'InvalidInput');
  if (typeof SharedArrayBuffer !== 'undefined') assert.equal((await f.adapter.init(new Uint8Array(new SharedArrayBuffer(2)))).code, 'InvalidInput');
  await demand(f.adapter, session); await f.adapter.close();
  assert.throws(() => createResourceAdapter({backend: f.backend, retire() {}, limits: {}}), TypeError);
});

test('accessor byte fields cannot change between limit validation and copying', async () => {
  const f = fixture({}, {maximumChunkBytes: 0}); const session = await ready(f.adapter); await demand(f.adapter, session);
  let reads = 0;
  const event = {kind: 'chunk', get bytes() { return reads++ === 0 ? bytes() : all; }};
  assert.equal((await f.adapter.step(session, event)).code, 'InvalidInput'); assert.equal(reads, 0);
  f.backend.step = () => ({kind: 'output', get bytes() { return reads++ === 0 ? bytes() : all; }});
  assert.equal((await f.adapter.step(session, {kind: 'tick'})).code, 'BackendProtocol'); assert.equal(reads, 0);
});

test('typed array and storage brands cannot be forged through local or foreign prototypes', async () => {
  const f = fixture();
  const forged = new Uint16Array([0x1234]); Object.setPrototypeOf(forged, Uint8Array.prototype);
  assert.equal((await f.adapter.init(forged)).code, 'InvalidInput');
  const shared = runInNewContext('new Uint8Array(new SharedArrayBuffer(3))');
  Object.setPrototypeOf(shared, Uint8Array.prototype);
  assert.equal((await f.adapter.init(shared)).code, 'InvalidInput');
  // A genuine byte array with ordinary storage remains byte-exact across realms.
  const foreign = runInNewContext('Uint8Array.of(0,255,128)');
  const session = await ready(f.adapter, foreign);
  assert.deepEqual(f.calls[0][1].config, bytes(0, 255, 128)); await f.adapter.release(session);
});

test('Proxy get traps cannot substitute bytes after their descriptor snapshot was validated', async () => {
  const f = fixture({}, {maximumChunkBytes: 2}); const session = await ready(f.adapter); await demand(f.adapter, session);
  let gets = 0;
  const event = new Proxy({kind: 'chunk', bytes: new Uint8Array(10)}, {
    get(target, key) { gets++; return key === 'bytes' ? bytes() : target[key]; }
  });
  assert.equal((await f.adapter.step(session, event)).code, 'ChunkLimit'); assert.equal(gets, 0);
  assert.equal(f.calls.filter(row => row[0] === 'step').length, 1);
  f.backend.step = () => new Proxy({kind: 'output', bytes: all}, {
    get(target, key) { return key === 'bytes' ? bytes(1) : target[key]; }
  });
  const output = await f.adapter.step(session, {kind: 'tick'}); assert.deepEqual(output.bytes, all);
  await f.adapter.release(session);
});

test('resource configuration uses one descriptor snapshot and rejects accessor limits', async () => {
  const f = fixture(); let reads = 0;
  const changing = {...limits, get maximumChunkBytes() { reads++; return reads === 1 ? 2 : 1000; }};
  assert.throws(() => createResourceAdapter({backend: f.backend, limits: changing, retire() {}}), TypeError);
  assert.equal(reads, 0);
  const selected = new Proxy({...limits, maximumConfigBytes: 0}, {get: () => 1000});
  const adapter = createResourceAdapter({backend: f.backend, limits: selected, retire() {}});
  assert.equal((await adapter.init(bytes(1))).code, 'ConfigLimit'); await adapter.close();
});

test('poisoned known owners remain strongly quarantined after failed retirement and runtime abandonment', async () => {
  const count = privateQuarantinedOwnerCount(); let releases = 0;
  let adapter = createResourceAdapter({limits,
    backend: {init: () => ({kind: 'ready', resource: {}}), step() { throw new WebAssembly.RuntimeError('trap'); }, release() { releases++; }},
    retire() { throw new Error('owner termination failed'); }});
  const session = await ready(adapter);
  assert.equal((await adapter.step(session, {kind: 'tick'})).retirement, 'failed');
  assert.equal((await adapter.close()).code, 'InstancePoisoned');
  adapter = null;
  assert.equal(privateQuarantinedOwnerCount(), count + 1); assert.equal(releases, 0);
  // This deterministic observation establishes retention, not actual Worker
  // termination, finalizer timing or any physical memory reclamation bound.
});

test('an init trap poisons prior sessions and close stops after its first failed destructor', async () => {
  const f = fixture(); const session = await ready(f.adapter);
  f.backend.init = () => { throw new WebAssembly.RuntimeError('init trapped'); };
  assert.equal((await f.adapter.init(bytes())).code, 'BackendTrap');
  assert.equal((await f.adapter.release(session)).code, 'InstancePoisoned');
  assert.equal(f.calls.filter(row => row[0] === 'release').length, 0);
  let drops = 0;
  const g = fixture({release() { drops++; throw new Error('failed drop'); }});
  await ready(g.adapter); await ready(g.adapter);
  assert.equal((await g.adapter.close()).code, 'ReleaseFailure'); assert.equal(drops, 1);
});

test('detached terminal summary and disposition copies consume their known resource exactly once', async () => {
  const detached = bytes(1); structuredClone(detached.buffer, {transfer: [detached.buffer]});
  for (const response of [{kind: 'complete', summary: detached}, {kind: 'failed', error: bytes(1), disposition: detached}]) {
    const f = fixture(); const session = await ready(f.adapter); await demand(f.adapter, session);
    if (response.kind === 'complete') {
      f.backend.step = () => ({kind: 'advanced'});
      await f.adapter.step(session, {kind: 'endOfInput'});
    }
    f.backend.step = () => response;
    assert.deepEqual(await f.adapter.step(session, {kind: 'tick'}),
      {kind: 'adapterError', code: 'AdapterAllocation', ownership: 'released'});
    assert.equal(f.calls.filter(row => row[0] === 'release').length, 1);
    assert.equal((await f.adapter.release(session)).code, 'StaleSession');
  }
});
