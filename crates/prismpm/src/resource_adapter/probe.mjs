// Conformance-only actual generated source/Wasm probe. No domain state machine
// is implemented here; JavaScript supplies events and checks source-owned bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pathToFileURL} from 'node:url';

const [runtimePath, bindingPath, wasmPath] = process.argv.slice(2);
assert.equal(process.argv.length, 5);
const {createResourceAdapter, privateQuarantinedOwnerCount} = await import(pathToFileURL(runtimePath).href);
const wasm = readFileSync(wasmPath);
const limits = Object.freeze({maximumConfigBytes: 65536, maximumChunkBytes: 65536,
  maximumOutputBytes: 65536, maximumDiagnosticBytes: 32,
  maximumSummaryBytes: 131072, maximumSessions: 4});
let instanceNumber = 0;
async function owner() {
  // Distinct module URLs are necessary: reinitializing one cached binding would
  // retain its existing Wasm instance and would not test cross-instance identity.
  const binding = await import(pathToFileURL(bindingPath).href + '?owner=' + (++instanceNumber));
  const exports = await binding.default({module_or_path: wasm});
  const resources = [], calls = [];
  let releases = 0, retirements = 0, trapNext = false;
  const backend = {
    init(bytes) {
      calls.push({kind: 'init', length: bytes.length});
      const result = binding.begin(bytes);
      if (result.kind === 'ready') resources.push(result.resource);
      return result;
    },
    step(resource, event) {
      calls.push({kind: event.kind, length: event.bytes?.length ?? 0});
      if (trapNext) { trapNext = false; binding.trap_for_probe(); }
      return resource.advance(event.kind, event.bytes ?? new Uint8Array());
    },
    release(resource) { releases++; resource.free(); }
  };
  const runtime = createResourceAdapter({backend, limits, retire() { retirements++; }});
  return {runtime, binding, exports, resources, calls, trap() { trapNext = true; },
    get releases() { return releases; }, get retirements() { return retirements; }};
}
const bytes = value => [...value];
const tick = {kind: 'tick'}, eof = {kind: 'endOfInput'}, cancel = {kind: 'cancel'};
const first = await owner(), second = await owner();
const config = Uint8Array.from({length: 256}, (_, index) => index);
const ready = await first.runtime.init(config), other = await second.runtime.init(config);
assert.equal(ready.kind, 'ready'); assert.equal(other.kind, 'ready');
assert.equal(first.resources[0].__wbg_ptr, second.resources[0].__wbg_ptr,
  'independent real guests deliberately allocate the same raw resource address');
assert.notEqual(first.exports.memory.buffer, second.exports.memory.buffer);
assert.equal((await second.runtime.step(ready.session, tick)).code, 'ForeignSession');
assert.equal((await first.runtime.step(other.session, tick)).code, 'ForeignSession');
assert.equal(first.binding.live_wrappers(), 1); assert.equal(second.binding.live_wrappers(), 1);
config.fill(199);
assert.equal((await first.runtime.step(ready.session, tick)).kind, 'needInput');
const input = Uint8Array.from({length: 256}, (_, index) => index);
const answer = await first.runtime.step(ready.session, {kind: 'chunk', bytes: input});
assert.equal(answer.kind, 'output'); assert.deepEqual(bytes(answer.bytes), Array.from({length: 256}, (_, index) => index));
input.fill(88);
first.exports.memory.grow(1);
assert.deepEqual(bytes(answer.bytes), Array.from({length: 256}, (_, index) => index), 'copied output survives guest memory growth');
assert.equal((await first.runtime.step(ready.session, tick)).kind, 'needInput');
assert.equal((await first.runtime.step(ready.session, {kind: 'chunk', bytes: new Uint8Array()})).bytes.length, 0);
assert.equal((await first.runtime.step(ready.session, tick)).kind, 'needInput');
const finalInput = Uint8Array.of(9, 8);
const lastOutput = await first.runtime.step(ready.session, {kind: 'chunk', bytes: finalInput});
finalInput.fill(77); lastOutput.bytes.fill(66);
assert.equal((await first.runtime.step(ready.session, tick)).kind, 'needInput');
assert.equal((await first.runtime.step(ready.session, eof)).kind, 'advanced');
const completed = await first.runtime.step(ready.session, tick);
assert.equal(completed.kind, 'complete');
assert.deepEqual(bytes(completed.summary), [...Array.from({length: 256}, (_, index) => index), 9, 8],
  'only typed State retained the original config and last chunk between calls');
assert.equal(first.binding.live_wrappers(), 0); assert.equal(first.releases, 1);
assert.equal((await first.runtime.step(ready.session, tick)).code, 'StaleSession');
assert.equal((await first.runtime.release(ready.session)).code, 'StaleSession');

const cancelled = await first.runtime.init(Uint8Array.of(5));
assert.equal((await first.runtime.step(cancelled.session, tick)).kind, 'needInput');
const provisional = await first.runtime.step(cancelled.session, {kind: 'chunk', bytes: Uint8Array.of(6)});
const cancellation = await first.runtime.step(cancelled.session, cancel);
assert.equal(cancellation.kind, 'cancelled'); assert.deepEqual(bytes(cancellation.error), [3]);
assert.deepEqual(bytes(cancellation.sourceDisposition), [0]);
assert.deepEqual(bytes(provisional.bytes), [6], 'prior copied output remains bytes, not completion permission');
assert.equal(first.binding.live_wrappers(), 0);
assert.equal((await first.runtime.step(cancelled.session, tick)).code, 'StaleSession');

const denied = await first.runtime.init(Uint8Array.of(254));
assert.equal(denied.kind, 'modeledError'); assert.deepEqual(bytes(denied.error), [1]);
assert.equal(first.binding.live_wrappers(), 0);
for (const [octet, expected] of [[255, 'modeledError'], [253, 'computeError']]) {
  const current = await first.runtime.init(new Uint8Array());
  await first.runtime.step(current.session, tick);
  const result = await first.runtime.step(current.session, {kind: 'chunk', bytes: Uint8Array.of(octet)});
  assert.equal(result.kind, expected);
  if (expected === 'computeError') assert.equal(result.code, 'AddOverflow');
  else assert.deepEqual(bytes(result.error), [2]);
  assert.equal(first.binding.live_wrappers(), 0);
  assert.equal((await first.runtime.release(current.session)).code, 'StaleSession');
}
const pages = [];
for (let iteration = 0; iteration < 96; iteration++) {
  const current = await first.runtime.init(new Uint8Array(32768).fill(17));
  assert.equal((await first.runtime.step(current.session, tick)).kind, 'needInput');
  const output = await first.runtime.step(current.session, {kind: 'chunk', bytes: new Uint8Array(8192).fill(iteration)});
  assert.equal(output.kind, 'output'); assert.equal(output.bytes.length, 8192);
  assert.equal((await first.runtime.release(current.session)).kind, 'released');
  assert.equal(first.binding.live_wrappers(), 0);
  pages.push(first.exports.memory.buffer.byteLength / 65536);
}
assert.equal(new Set(pages.slice(-32)).size, 1, 'observed fixture page use plateaus after ownership churn');
// This observed plateau and wrapper count are not a physical memory bound,
// allocator-recovery guarantee, source State size bound or product measurement.
assert.ok(first.calls.filter(call => call.kind === 'tick').every(call => call.length === 0));
assert.ok(first.calls.filter(call => !['init', 'chunk'].includes(call.kind)).every(call => call.length === 0));
assert.equal((await first.runtime.close()).kind, 'closed');
assert.equal(first.retirements, 1);
assert.equal((await second.runtime.close()).kind, 'closed');
assert.equal(second.binding.live_wrappers(), 0); assert.equal(second.releases, 1);

const quarantineBefore = privateQuarantinedOwnerCount();
const trapped = await owner(), trappedSession = await trapped.runtime.init(Uint8Array.of(4));
trapped.trap();
const fatal = await trapped.runtime.step(trappedSession.session, tick);
assert.equal(fatal.kind, 'fatal'); assert.equal(fatal.code, 'BackendTrap');
assert.equal(trapped.retirements, 1); assert.equal(trapped.releases, 0);
assert.equal(privateQuarantinedOwnerCount(), quarantineBefore + 1);
assert.equal((await trapped.runtime.release(trappedSession.session)).code, 'InstancePoisoned');
// No guest destructor or observation is called after this actual Wasm trap.
// Known raw owners remain strongly quarantined, potentially indefinitely.
// Node records retirement request only; real Worker/realm destruction is a later gate.
console.log('private generated typed-state Wasm component passed: ' + JSON.stringify({
  allBytes: 256, churnSessions: 96, observedFinalPages: pages.at(-1),
  physicalMemoryBoundClaimed: false, stateZeroCopyClaimed: false,
  browserWorkerAcceptanceClaimed: false, publicationAcceptanceClaimed: false,
  physicalRealmTerminationClaimed: false, quarantineMayRetainIndefinitely: true
}));
