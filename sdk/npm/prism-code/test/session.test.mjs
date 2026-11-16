// Sessions of the session world hologram:guest/core-wasm@2 (issue #629, docs/proposals/629-session-world.md).
//
// The guest under test is the session ABI probe: the generated shim of crates/prismpm/src/session_guest
// around a test entry (test/fixtures/session-probe/entry.rs), pinned to the generator by a Rust test. It keeps a
// counter and an accumulating buffer; requests 0xf0 to 0xf4 make the entry answer what the shim must refuse.
// The archive is the reference holo with that guest and the @2 contract, rewritten and resealed, so only the
// world differs. It is a test input, never reference evidence.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  DeterminismViolationError,
  PrismCodeError,
  ReplayError,
  SESSION_CONTRACT,
  SESSION_HISTORY_SCHEMA,
  compileGuest,
  decodeResponses,
  experimental_recorder,
  experimental_replay,
  load,
  openSession,
  parseHistory,
  runSessionAcceptance,
  runStep,
} from '../src/index.mjs';
import { editExtension, reference, withGuest } from '../../verify/test/helpers.mjs';

const PROBE = new Uint8Array(readFileSync(new URL('./fixtures/session-probe/probe.wasm', import.meta.url)));
const LIMITS = { request: 64, guestAllocation: 64, response: 256, responseCount: 4 };
const DIRECTORY = 'https://hologram.foundation/extension/application-directory/v1';
const PROVENANCE = 'https://uor.foundation/extension/prismpm-model/v1';
const text = (s) => new TextEncoder().encode(s);
const hex = (bytes) => Buffer.from(bytes).toString('hex');
const u32 = (n) => hex(Uint8Array.of(n >>> 24, (n >>> 16) & 255, (n >>> 8) & 255, n & 255));

/** The reference holo with the probe as its guest and the session world as its contract. */
function sessionArchive() {
  let bytes = withGuest(PROBE);
  const toSession = (json) => json.replaceAll('hologram:guest/core-wasm@1', SESSION_CONTRACT);
  bytes = editExtension(bytes, DIRECTORY, toSession);
  bytes = editExtension(bytes, PROVENANCE, toSession);
  return bytes;
}

async function probeSession() {
  const module = await compileGuest(PROBE, undefined, SESSION_CONTRACT);
  return openSession({
    instantiate: () => new WebAssembly.Instance(module, {}),
    check: (request) => {
      if (request.length > LIMITS.guestAllocation) throw new PrismCodeError('core.allocation', 'over the bound');
    },
    step: (instance, request) => runStep(instance, request, LIMITS),
  });
}

const responsesOf = async (session, request) => (await session.dispatch(request)).map(hex);

test('a session keeps its counter and buffer across three steps, and two sessions share nothing', async () => {
  const first = await probeSession();
  assert.deepEqual(await responsesOf(first, text('ab')), [u32(1), hex(text('ab'))]);
  assert.deepEqual(await responsesOf(first, text('c')), [u32(2), hex(text('abc'))]);
  assert.deepEqual(await responsesOf(first, text('d')), [u32(3), hex(text('abcd'))]);
  assert.equal(first.steps, 3);
  const second = await probeSession();
  assert.deepEqual(await responsesOf(second, text('x')), [u32(1), hex(text('x'))]);
  assert.deepEqual(await responsesOf(first, text('e')), [u32(4), hex(text('abcde'))]);
});

test('a step returns zero or more responses, through dispatch and through stream', async () => {
  const session = await probeSession();
  assert.deepEqual(await session.dispatch(new Uint8Array(0)), []);
  const streamed = [];
  for await (const response of session.stream(text('hi'))) streamed.push(hex(response));
  assert.deepEqual(streamed, [u32(1), hex(text('hi'))]);
  assert.equal(session.steps, 2);
});

test('the state survives a step that answers nothing, and the arena is reused across many steps', async () => {
  const session = await probeSession();
  for (let i = 0; i < 200; i++) assert.deepEqual(await session.dispatch(new Uint8Array(0)), []);
  // 200 steps in two pages of memory: each step's temporaries were released.
  assert.deepEqual(await responsesOf(session, text('z')), [u32(1), hex(text('z'))]);
});

test('every answer the shim must refuse traps, and the trap ends the session', async () => {
  for (const [code, why] of [
    [0xf0, 'a state over the declared maximum'],
    [0xf1, 'a byte after the last response'],
    [0xf2, 'more responses than declared'],
    [0xf3, 'a response over the declared maximum'],
    [0xf4, 'a checked failure in the model'],
  ]) {
    const session = await probeSession();
    await session.dispatch(text('a'));
    await assert.rejects(session.dispatch(Uint8Array.of(code)), WebAssembly.RuntimeError, why);
    assert.equal(session.closed, true, why);
    await assert.rejects(session.dispatch(text('a')), (e) => e instanceof PrismCodeError && e.code === 'session.closed', why);
  }
});

test('a state that outgrows its maximum traps on the step that grows it', async () => {
  const session = await probeSession();
  const chunk = new Uint8Array(60).fill(0x61);
  for (let i = 0; i < 4; i++) await session.dispatch(chunk);
  // The state is the 4-byte counter and the buffer: 4 + 240 = 244 bytes. Thirteen more make a 253-byte
  // buffer, a response within the 256 the probe declares, and a 257-byte state, over its 256.
  await assert.rejects(session.dispatch(new Uint8Array(13).fill(0x62)), WebAssembly.RuntimeError);
  assert.equal(session.closed, true);
});

test('a request over the bound is refused before the guest runs, and ends the session', async () => {
  const session = await probeSession();
  await assert.rejects(session.dispatch(new Uint8Array(65)), (e) => e.code === 'core.allocation');
  assert.equal(session.closed, true);
});

test('close ends a session; a later step fails session.closed and runs nothing', async () => {
  const session = await probeSession();
  await session.dispatch(text('a'));
  session.close();
  await assert.rejects(session.dispatch(text('b')), (e) => e.code === 'session.closed');
  assert.equal(session.steps, 1);
});

test('a step while another is in flight fails session.busy and leaves the session open', async () => {
  const module = await compileGuest(PROBE, undefined, SESSION_CONTRACT);
  let release;
  const gate = new Promise((resolve) => (release = resolve));
  const session = await openSession({
    instantiate: () => new WebAssembly.Instance(module, {}),
    step: async (instance, request) => {
      await gate;
      return runStep(instance, request, LIMITS);
    },
  });
  const first = session.dispatch(text('a'));
  await assert.rejects(session.dispatch(text('b')), (e) => e.code === 'session.busy');
  release();
  assert.deepEqual((await first).map(hex), [u32(1), hex(text('a'))]);
  assert.equal(session.closed, false);
  assert.deepEqual(await responsesOf(session, text('c')), [u32(2), hex(text('ac'))]);
});

test('the host refuses a responses frame that is malformed or over a declared bound', () => {
  const frame = (...parts) => Uint8Array.from(Buffer.from(parts.join(''), 'hex')).buffer;
  const refuses = (buffer, limits, why) => assert.throws(() => decodeResponses(buffer, 0, buffer.byteLength, limits), (e) => e.code === 'core.response', why);
  assert.deepEqual(decodeResponses(frame(u32(2), u32(1), 'aa', u32(0)), 0, 13).map(hex), ['aa', '']);
  refuses(frame('0000'), {}, 'no count');
  refuses(frame(u32(1)), {}, 'a missing length');
  refuses(frame(u32(1), u32(3), 'aa'), {}, 'a response past the end');
  refuses(frame(u32(0), 'ff'), {}, 'a trailing byte');
  refuses(frame(u32(2), u32(0), u32(0)), { responseCount: 1 }, 'too many responses');
  refuses(frame(u32(1), u32(2), 'aaaa'), { response: 1 }, 'a response over the bound');
  assert.throws(() => decodeResponses(new ArrayBuffer(8), 4, 8), (e) => e.code === 'core.response', 'outside memory');
});

test('a @1 guest is refused as a session guest, and a session guest as a @1 guest', async () => {
  const calculator = (await load(reference())).archive;
  assert.ok(calculator);
  await assert.rejects(compileGuest(PROBE), (e) => e.code === 'core.exports');
  const { guest } = await import('../src/archive.mjs').then((m) => m.resolveArchive(m.parseArchive(reference())));
  await assert.rejects(compileGuest(guest.content, undefined, SESSION_CONTRACT), (e) => e.code === 'core.exports');
});

test('a holo of the session world loads as a session application: dispatch is refused, open takes steps', async () => {
  const app = await load(sessionArchive());
  assert.equal(app.world.contract, SESSION_CONTRACT);
  assert.equal(app.world.session, true);
  assert.equal(app.world.pure, true);
  assert.equal(app.identities.verified, true);
  await assert.rejects(app.dispatch(text('a')), (e) => e instanceof PrismCodeError && e.code === 'session.required');
  const session = await app.open();
  assert.deepEqual(await responsesOf(session, text('ab')), [u32(1), hex(text('ab'))]);
  assert.deepEqual(await responsesOf(session, text('c')), [u32(2), hex(text('abc'))]);
});

test('a stateless holo has no sessions', async () => {
  const app = await load(reference());
  assert.equal(app.world.session, false);
  assert.throws(() => app.open(), (e) => e.code === 'session.unsupported');
});

test('acceptance sessions pass step by step, and a changed expectation fails at that step', async () => {
  const open = () => probeSession();
  const sessions = [
    [
      { request: text('ab'), responses: [Buffer.from(u32(1), 'hex'), text('ab')] },
      { request: text('c'), responses: [Buffer.from(u32(2), 'hex'), text('abc')] },
      { request: new Uint8Array(0), responses: [] },
    ],
    [{ request: text('x'), responses: [Buffer.from(u32(1), 'hex'), text('x')] }],
  ];
  assert.deepEqual(await runSessionAcceptance(sessions, open), { total: 4, passed: 4, failed: [] });
  sessions[0][1].responses[1] = text('abd');
  const result = await runSessionAcceptance(sessions, open);
  assert.equal(result.passed, 3);
  assert.deepEqual(result.failed.map((f) => [f.session, f.index]), [[0, 1]]);
});

test('a recorded session history parses as prism/history/2 and replays green against the same build', async () => {
  const app = await load(sessionArchive());
  const recorder = experimental_recorder(app);
  const session = await recorder.open();
  await session.dispatch(text('ab'));
  await session.dispatch(new Uint8Array(0));
  await session.dispatch(text('c'));
  await assert.rejects(session.dispatch(Uint8Array.of(0xf4)));
  await assert.rejects(session.dispatch(text('d')), (e) => e.code === 'session.closed');
  const other = await recorder.open();
  await other.dispatch(text('x'));
  const history = await recorder.history();
  assert.equal(history.schema, SESSION_HISTORY_SCHEMA);
  assert.deepEqual(history.sessions, [
    {
      steps: [
        { request: hex(text('ab')), responses: [u32(1), hex(text('ab'))] },
        { request: '', responses: [] },
        { request: hex(text('c')), responses: [u32(2), hex(text('abc'))] },
      ],
      failure: { request: 'f4', error: 'core.trap' },
    },
    { steps: [{ request: hex(text('x')), responses: [u32(1), hex(text('x'))] }] },
  ]);
  assert.deepEqual(parseHistory(JSON.stringify(history)), history);
  const result = await experimental_replay(app, history);
  assert.equal(result.divergenceCount, 0);
  assert.equal(result.events, 5);
  assert.equal(result.statement.predicate.histories[0].events, 5);
});

test('a changed response in a session history is one divergence, a DeterminismViolationError', async () => {
  const app = await load(sessionArchive());
  const history = {
    schema: SESSION_HISTORY_SCHEMA,
    application: null,
    sessions: [{ steps: [
      { request: hex(text('ab')), responses: [u32(1), hex(text('ab'))] },
      { request: hex(text('c')), responses: [u32(2), hex(text('abX'))] },
      { request: hex(text('d')), responses: [u32(3), hex(text('abcd'))] },
    ] }],
  };
  await assert.rejects(experimental_replay(app, history), (e) => {
    assert.ok(e instanceof DeterminismViolationError);
    assert.equal(e.details.divergenceCount, 1);
    assert.deepEqual(e.details.histories[0].divergences.map((d) => [d.session, d.step, d.index]), [[0, 1, 1]]);
    return true;
  });
});

test('a replay that ends early reports every later record as a divergence', async () => {
  const app = await load(sessionArchive());
  const history = {
    schema: SESSION_HISTORY_SCHEMA,
    application: null,
    sessions: [{ steps: [
      { request: 'f4', responses: [] },
      { request: hex(text('a')), responses: [u32(1), hex(text('a'))] },
    ] }],
  };
  const result = await experimental_replay(app, history, { throw: false });
  assert.deepEqual(result.histories[0].divergences.map((d) => d.actual), [{ error: 'core.trap' }, { error: 'session.closed' }]);
});

test('a session history against a stateless holo, and a stateless history against a session holo, fail replay.history', async () => {
  const calculator = await load(reference());
  const session = await load(sessionArchive());
  const sessionHistory = { schema: SESSION_HISTORY_SCHEMA, application: null, sessions: [{ steps: [{ request: '61', responses: [] }] }] };
  await assert.rejects(experimental_replay(calculator, sessionHistory), (e) => e instanceof ReplayError && e.check === 'replay.history');
  await assert.rejects(experimental_replay(session, await calculator.history()), (e) => e instanceof ReplayError && e.check === 'replay.history');
});

test('parseHistory refuses what the prism/history/2 schema refuses', () => {
  const base = () => ({ schema: SESSION_HISTORY_SCHEMA, application: null, sessions: [{ steps: [{ request: '61', responses: ['62'] }] }] });
  const refuses = (edit, why) => {
    const value = base();
    edit(value);
    assert.throws(() => parseHistory(value), (e) => e instanceof ReplayError && e.check === 'replay.history', why);
  };
  refuses((v) => (v.sessions = []), 'no sessions');
  refuses((v) => (v.sessions = [{ steps: [] }]), 'an empty session');
  refuses((v) => (v.sessions[0].steps[0].error = 'core.trap'), 'a step with an error');
  refuses((v) => (v.sessions[0].failure = { request: '00', error: 'trap' }), 'an error code without a dot');
  refuses((v) => (v.sessions[0].failure = { request: '00', error: 'core.trap', responses: [] }), 'a failure with responses');
  refuses((v) => (v.sessions[0].steps[0].responses = ['6A']), 'upper-case hex');
  refuses((v) => (v.sessions[0].events = []), 'an unknown member');
  refuses((v) => delete v.application, 'no application');
  refuses((v) => (v.sessions[0].steps[0].responses = new Array(65536).fill('')), 'more responses than a step may return');
  assert.deepEqual(parseHistory({ ...base(), sessions: [{ steps: [], failure: { request: '00', error: 'core.allocation' } }] }).sessions[0].steps, []);
});
