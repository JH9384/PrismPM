// Cheap shape tests only; actual generated owner/browser execution is separate.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createSessionOperationCapture} from '../../sdk/browser/session-operation-capture.mjs';
import {operationCorpus} from './corpus.mjs';
import {enqueueOperationObservation} from './browser.mjs';
import {frozenInputs, verifyFrozenInputs, sourceClosure, assertCapturedOperationSources,
  assertOperationCompilerInputs} from './compile.mjs';

const roles = ['predecessor', 'session', 'observation', 'partition', 'descriptor'];
const options = () => Object.fromEntries(roles.map(role => [role, {bytes: new Uint8Array(8), sha256: new Uint8Array(32)}]));
test('private operation artifact options are closed data and never invoke accessors', async () => {
  for (const value of [null, [], Object.create(null), {...options(), state: {}}, {...options(), authority: true},
    {...options(), success: true}, {...options(), predecessor: {bytes: new Uint8Array(), sha256: new Uint8Array(32), accepted: true}}])
    await assert.rejects(createSessionOperationCapture(value), /invalid-input/);
  let calls = 0;
  for (const depth of ['outer', 'artifact']) {
    const value = options(), target = depth === 'outer' ? value : value.predecessor, key = depth === 'outer' ? 'predecessor' : 'bytes';
    Object.defineProperty(target, key, {get() {calls++; throw Error('accessor executed');}});
    await assert.rejects(createSessionOperationCapture(value), /invalid-input/);
  }
  assert.equal(calls, 0);
  await assert.rejects(createSessionOperationCapture(options(), true), /invalid-input/);
  await assert.rejects(createSessionOperationCapture(options()), /artifact-mismatch/);
});
test('independent operation corpus distinguishes source rejection from complete derived frames', () => {
  const rows = operationCorpus();
  assert.ok(rows.some(row => row.expected.error));
  assert.ok(rows.some(row => row.expected.frames?.before === null));
  assert.ok(rows.some(row => row.expected.frames?.before !== null && row.expected.frames?.before));
  for (const row of rows) if (!row.expected.error) {
    assert.deepEqual(Object.keys(row.expected.frames), ['operation', 'before', 'after', 'beforeObservation', 'afterObservation']);
    for (const [name, bytes] of Object.entries(row.expected.frames))
      assert.equal(row.expected.descriptions[name] === null, bytes === null);
  }
});
test('private owner captures complete source and transitive local harness closure', () => {
  const inputs = frozenInputs(), sources = sourceClosure(); assertCapturedOperationSources(inputs, sources);
  for (const path of ['sdk/browser/session-operation-capture.mjs', 'sdk/browser/session-storage.mjs',
    'sdk/browser/session-payloads.mjs', 'tests/browser-view/kernel-provenance.mjs',
    'tests/browser-view/compiler-owner.mjs', 'tests/browser-view/compiler-artifact.mjs']) assert.ok(inputs[path]);
  sources.delete('Foundation.Bytes');
  assert.throws(() => assertCapturedOperationSources(inputs, sources), /source module inventory/);
});

test('operation input custody refuses copied maps and omitted transitive inputs', () => {
  const inputs = frozenInputs(); verifyFrozenInputs(inputs);
  assert.throws(() => verifyFrozenInputs(Object.freeze({...inputs})), /actual complete captured operation inputs/);
  const missing = {...inputs}; delete missing['tests/browser-view/compiler-owner.mjs'];
  assert.throws(() => verifyFrozenInputs(Object.freeze(missing)), /actual complete captured operation inputs/);
  assert.ok(Object.isFrozen(inputs));
});

test('operation compiler binding rejects fabricated and copied owner handles before execution', () => {
  for (const owner of [null, {}, {evidence: {family: 'session-operation', inputs: {}}},
    {runDriver() {throw Error('caller compiler executed');}}])
    assert.throws(() => assertOperationCompilerInputs(owner, {}), /actual fresh compiler owner/);
});

test('operation observations retain every byte and ordered replay without instance ownership', async () => {
  const names = ['operationObservationDone', 'operationRecordStart', 'operationRecordPart', 'operationRecordEnd'];
  const saved = names.map(name => Object.getOwnPropertyDescriptor(globalThis, name));
  const jobs = [], source = enqueueOperationObservation.toString(), declaration = 'const job = {entry, request, response, memory};';
  assert.equal(source.split(declaration).length, 2);
  // The only instrumented statement records the actual owned job; all queue,
  // byte transport and cleanup behavior remains the captured function body.
  function witnessed(text) {
    return new Function('witness', 'return (' + text.replace(declaration, declaration + ' witness(job);') + ');')(job => jobs.push(job));
  }
  const enqueue = witnessed(source);
  try {
    // Exercise the exact function sent to the browser, including zero-length
    // frames and both sides of every transport chunk boundary.
    for (const length of [0, 1, 262143, 262144, 262145, 524289]) {
      const request = Uint8Array.from({length}, (_, index) => index % 251), response = request.slice().reverse();
      const events = [], chunks = {request: [], response: []}; let active = false, next = 0;
      globalThis.operationObservationDone = Promise.resolve();
      globalThis.operationRecordStart = async (entry, requestLength, responseLength, memory) => {
        assert.equal(active, false); active = true;
        assert.equal(memory, 1048576); assert.equal(requestLength, length); assert.equal(responseLength, length);
        events.push(['start', entry]); return next++;
      };
      globalThis.operationRecordPart = async (id, kind, offset, text) => {
        assert.equal(active, true); assert.equal(id, 0);
        const bytes = Buffer.from(text, 'base64');
        assert.equal(text, bytes.toString('base64')); assert(bytes.length > 0 && bytes.length <= 262144);
        assert.equal(offset, chunks[kind].reduce((sum, part) => sum + part.length, 0));
        chunks[kind].push(bytes); events.push(['part', kind, offset]);
      };
      globalThis.operationRecordEnd = async id => {assert.equal(id, 0); assert.equal(active, true); active = false; events.push(['end']);};
      await enqueue('session', request, response, 1048576);
      assert.equal(jobs.at(-1).request, null); assert.equal(jobs.at(-1).response, null);
      assert.deepEqual(Buffer.concat(chunks.request), Buffer.from(request));
      assert.deepEqual(Buffer.concat(chunks.response), Buffer.from(response));
      assert.deepEqual(events[0], ['start', 'session']); assert.deepEqual(events.at(-1), ['end']);
      assert.equal(events.length, 2 + 2 * Math.ceil(length / 262144)); assert.equal(active, false);
    }
    const order = [], gate = Promise.withResolvers();
    globalThis.operationObservationDone = Promise.resolve();
    globalThis.operationRecordStart = async entry => {order.push(['start', entry]); return entry;};
    globalThis.operationRecordPart = async entry => {order.push(['part', entry]); if (entry === 'first') await gate.promise;};
    globalThis.operationRecordEnd = async entry => {order.push(['end', entry]);};
    const first = enqueue('first', Uint8Array.of(1), new Uint8Array(), 1);
    const second = enqueue('second', Uint8Array.of(2), new Uint8Array(), 1);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, [['start', 'first'], ['part', 'first']]);
    gate.resolve(); await first; await second;
    assert.deepEqual(order, [['start', 'first'], ['part', 'first'], ['end', 'first'],
      ['start', 'second'], ['part', 'second'], ['end', 'second']]);
    for (const job of jobs.slice(-2)) {assert.equal(job.request, null); assert.equal(job.response, null);}
    for (const stage of ['Start', 'Part', 'End']) {
      const failure = new Error('actual transport refusal ' + stage), calls = [];
      globalThis.operationObservationDone = Promise.resolve();
      for (const point of ['Start', 'Part', 'End']) globalThis['operationRecord' + point] = async () => {
        calls.push(point); if (point === stage) throw failure; return 1;
      };
      const failed = enqueue('first', Uint8Array.of(1), Uint8Array.of(2), 1);
      const blocked = enqueue('second', Uint8Array.of(3), Uint8Array.of(4), 1);
      await assert.rejects(failed, error => error === failure);
      await assert.rejects(blocked, error => error === failure);
      assert.equal(calls.filter(point => point === 'Start').length, 1);
      assert.equal(calls.at(-1), stage);
      for (const job of jobs.slice(-2)) {assert.equal(job.request, null); assert.equal(job.response, null);}
    }
    const cleanup = '.finally(() => {job.request = null; job.response = null;})';
    assert.equal(source.split(cleanup).length, 2);
    globalThis.operationObservationDone = Promise.resolve();
    globalThis.operationRecordStart = async () => 0;
    globalThis.operationRecordPart = async () => {};
    globalThis.operationRecordEnd = async () => {};
    await witnessed(source.replace(cleanup, ''))('mutant', Uint8Array.of(1), Uint8Array.of(2), 1);
    assert.throws(() => {assert.equal(jobs.at(-1).request, null); assert.equal(jobs.at(-1).response, null);},
      error => error.code === 'ERR_ASSERTION', 'executed removed-cleanup mutation must fail the actual job-state predicate');

    // Exercise the actual serialized browser wrapper with a tiny real Wasm
    // round-trip fixture. This tests observation wiring, not modeled app logic.
    const binary = Uint8Array.of(0,97,115,109,1,0,0,0,1,12,2,96,1,127,1,127,96,2,127,127,1,126,
      3,3,2,0,1,5,3,1,0,1,7,34,3,6,109,101,109,111,114,121,2,0,
      10,104,111,108,111,95,97,108,108,111,99,0,0,8,104,111,108,111,95,114,117,110,0,1,
      10,12,2,4,0,65,0,11,5,0,32,1,173,11);
    assert.equal(WebAssembly.validate(binary), true);
    const fixtureSource = readFileSync(new URL('./browser.mjs', import.meta.url), 'utf8');
    const start = 'await page.evaluate(entries => {', end = '\n  }, entries);';
    assert.equal(fixtureSource.split(start).length, 2); assert.equal(fixtureSource.split(end).length, 2);
    const wrapper = 'entries => {' + fixtureSource.split(start)[1].split(end)[0] + '\n}';
    async function observed(text) {
      const recorded = [], sandbox = {WebAssembly: {...WebAssembly, compile: WebAssembly.compile,
        Instance: WebAssembly.Instance}, entries: {session: Array.from(binary)}};
      sandbox.enqueueOperationObservation = (entry, request, response, memory) => {
        recorded.push({entry, request, response, memory});
      };
      runInNewContext('(' + text + ')(entries)', sandbox);
      const module = await sandbox.WebAssembly.compile(binary), instance = new sandbox.WebAssembly.Instance(module, {});
      new Uint8Array(instance.exports.memory.buffer, 0, 3).set([1, 2, 3]);
      assert.equal(instance.exports.holo_run(0, 3), 3n);
      new Uint8Array(instance.exports.memory.buffer, 0, 3).fill(0);
      assert.equal(sandbox.operationInvocationCounts.session, 1);
      assert.equal(recorded.length, 1, 'actual wrapper-to-byte-queue handoff');
      assert.deepEqual(Array.from(recorded[0].request), [1, 2, 3]);
      assert.deepEqual(Array.from(recorded[0].response), [1, 2, 3]);
      assert.equal(recorded[0].entry, 'session'); assert.equal(recorded[0].memory, 65536);
    }
    await observed(wrapper);
    const handoff = 'enqueueOperationObservation(entry, request, response, memory);';
    assert.equal(wrapper.split(handoff).length, 2);
    await assert.rejects(observed(wrapper.replace(handoff, '')),
      error => error.code === 'ERR_ASSERTION' && error.message.includes('wrapper-to-byte-queue'),
      'executed wrapper-bypass mutation must fail the actual handoff predicate');
  } finally {
    for (const [index, name] of names.entries()) {
      if (saved[index]) Object.defineProperty(globalThis, name, saved[index]); else delete globalThis[name];
    }
  }
});
