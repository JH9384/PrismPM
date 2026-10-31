// Containers: one run of a holo with Docker's states and an exit code (issue #348, docs/proposals/348-container-lifecycle.md).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  prism,
  createPrism,
  load,
  experimental_verify,
  memoryContainerStore,
  CONTAINER_SCHEMA,
  EXIT_CODES,
  ERROR_CLASSES,
  exitCodeFor,
  PrismError,
  PrismCodeError,
  VerificationError,
  ProofMismatchError,
  CapabilityDeniedError,
  WorldMismatchError,
  DeterminismViolationError,
  ReplayError,
  SigningError,
} from '../src/index.mjs';
import { containersDirectory, fileContainerStore } from '../src/node.mjs';
import { EXIT as CHECK_EXIT, check } from '../src/check.mjs';
import { assembleWasm, withGuest } from '../../verify/test/helpers.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const closure = fileURLToPath(new URL('./fixtures/calculator-closure', import.meta.url));
const guide = fileURLToPath(new URL('../../../../docs/site/guides/run-a-holo.md', import.meta.url));

const ADD = '1\tadd\t20\t22';
const SUM = '1\tok\t42';
const P0 = Object.freeze({ policy: { minimum: 'P0' } });
const scratch = (name = 'prism-containers-') => mkdtempSync(join(tmpdir(), name));
const quiet = () => createPrism({ warn: () => {} });

/** A loaded holo whose dispatch waits until the test lets it return or throw. */
async function held() {
  let release;
  let called;
  const gate = new Promise((resolve, reject) => {
    release = { returns: resolve, throws: reject };
  });
  const dispatched = new Promise((resolve) => {
    called = resolve;
  });
  const app = {
    ...(await load(fixture)),
    dispatch: () => {
      called();
      return gate;
    },
  };
  return { app, release, dispatched };
}

/** A loaded holo whose dispatch throws this. */
async function throwing(error) {
  return { ...(await load(fixture)), dispatch: async () => { throw error; } };
}

/** The smallest guest with the Core-Wasm exports whose holo_run traps. */
function trappingHolo() {
  const name = (text) => [text.length, ...new TextEncoder().encode(text)];
  return withGuest(
    assembleWasm([
      { id: 1, payload: Uint8Array.from([2, 0x60, 1, 0x7f, 1, 0x7f, 0x60, 2, 0x7f, 0x7f, 1, 0x7e]) },
      { id: 3, payload: Uint8Array.from([2, 0, 1]) },
      { id: 5, payload: Uint8Array.from([1, 0, 1]) },
      { id: 7, payload: Uint8Array.from([3, ...name('memory'), 2, 0, ...name('holo_alloc'), 0, 0, ...name('holo_run'), 0, 1]) },
      { id: 10, payload: Uint8Array.from([2, 4, 0, 0x41, 0, 0x0b, 3, 0, 0x00, 0x0b]) },
    ]),
  );
}

test('created: the image is open, the digest is known, and nothing has run', async () => {
  const container = await prism.containers.create(fixture, ADD, P0);
  const record = await container.inspect();
  assert.equal(record.schema, CONTAINER_SCHEMA);
  assert.match(record.id, /^[0-9a-f]{64}$/);
  assert.equal(record.id, container.id);
  assert.equal(record.image.name, 'Calculator');
  assert.match(record.image.digest, /^blake3:[0-9a-f]{64}$/);
  assert.deepEqual(record.state, { status: 'created', exitCode: null, error: null, startedAt: null, finishedAt: null });
  assert.equal(record.output, null);
  assert.equal(container.status, 'created');
  assert.equal(container.exitCode, null);
  assert.equal(container.output, null);
  await container.remove();
});

test('created to running to exited, each visible, with start and finish times', async () => {
  const { app, release, dispatched } = await held();
  const { containers } = quiet();
  const container = await containers.create(app, ADD, P0);
  const before = Date.now();
  const started = container.start();
  await dispatched;
  const running = await container.inspect();
  assert.equal(container.status, 'running');
  assert.equal(running.state.status, 'running');
  assert.equal(running.state.exitCode, null);
  assert.equal(running.state.finishedAt, null);
  assert.ok(Date.parse(running.state.startedAt) >= before - 1);

  release.returns(new TextEncoder().encode(SUM));
  assert.equal(await started, container, 'start resolves to the container');
  const exited = await container.inspect();
  assert.equal(exited.state.status, 'exited');
  assert.equal(exited.state.exitCode, 0);
  assert.equal(exited.state.error, null);
  assert.ok(Date.parse(exited.state.finishedAt) >= Date.parse(exited.state.startedAt));
  assert.deepEqual(exited.output, { encoding: 'utf-8', data: SUM });
  assert.equal(container.text(), SUM);
});

test('run returns the container after it exits, and the record outlives the call until it is removed', async () => {
  const container = await prism.containers.run(fixture, ADD, P0);
  assert.equal(container.status, 'exited');
  assert.equal(container.exitCode, 0);
  assert.equal(container.text(), SUM);
  assert.deepEqual([...container.output], [...new TextEncoder().encode(SUM)]);
  assert.equal(await prism.containers.get(container.id), container, 'kept');
  assert.equal(await prism.containers.get(container.id.slice(0, 12)), container, 'a unique prefix names it');
  await prism.containers.remove(container.id);
  await assert.rejects(prism.containers.get(container.id), { code: 'container.missing' });
});

test('input is a string or bytes, and anything else is refused before a container exists', async () => {
  const bytes = new TextEncoder().encode(ADD);
  for (const input of [bytes, bytes.buffer, new DataView(bytes.buffer)]) {
    const container = await prism.containers.run(fixture, input, { ...P0, rm: true });
    assert.equal(container.text(), SUM);
  }
  for (const input of [undefined, null, 7, { op: 'add' }]) {
    await assert.rejects(prism.containers.create(fixture, input, P0), { code: 'container.input' });
  }
});

test('an image that cannot be opened makes no container: create and run reject with the typed error', async () => {
  const seen = [];
  const store = { ...memoryContainerStore(), put: async (record) => void seen.push(record.id) };
  const { containers } = createPrism({ store });
  await assert.rejects(containers.create(join(scratch(), 'missing.holo'), ADD), { code: 'load.path' });
  await assert.rejects(containers.run(new Uint8Array(64), ADD), (error) => error instanceof PrismCodeError && error.code.startsWith('archive.'));
  assert.deepEqual(seen, []);
});

test('a run that fails check exits without running the guest: exit 1, no start time, the verdict kept', async () => {
  let dispatched = 0;
  const app = { ...(await load(fixture)), dispatch: async () => dispatched++ };
  const { containers } = quiet();
  const container = await containers.run(app, ADD);
  assert.equal(dispatched, 0, 'the guest never ran');
  assert.equal(container.status, 'exited');
  assert.equal(container.exitCode, 1);
  assert.ok(container.error instanceof VerificationError);
  assert.equal(container.output, null);
  const record = await container.inspect();
  assert.equal(record.state.startedAt, null);
  assert.ok(record.state.finishedAt);
  assert.equal(record.state.error.name, 'VerificationError');
  assert.equal(record.state.error.code, 'verification_failed');
  assert.equal(record.state.error.check, 'provenance.statement');
  assert.equal(record.verdict.passed, false);
  assert.equal(record.verdict.level, 'P0');
  assert.equal(record.verdict.holo, record.image.digest, 'the digest is the one the verdict judged');
});

test('the gate is the verdict of check: a passing container and check agree', async () => {
  const container = await prism.containers.run(fixture, ADD, { ...P0, rm: true });
  assert.equal(container.exitCode, 0);
  const viaCheck = await check(fixture);
  const refused = await quiet().containers.run(fixture, ADD);
  const { verdict } = await refused.inspect();
  assert.deepEqual(verdict, viaCheck);
});

test('a policy no holo can be judged by is no verdict: exit 2, the guest never ran', async () => {
  const { containers } = quiet();
  for (const policy of [{ effects: ['time'] }, { unknown: true }, async () => { throw new VerificationError('unreadable', { check: 'policy.unreadable' }); }]) {
    const container = await containers.run(fixture, ADD, { policy });
    assert.equal(container.exitCode, 2);
    assert.ok(container.error instanceof VerificationError);
    assert.equal(container.error.verdict, undefined);
    assert.equal((await container.inspect()).state.startedAt, null);
  }
});

test('a gate that throws something untyped fails closed: no verdict, exit 2, the guest never ran', async () => {
  let dispatched = 0;
  const app = { ...(await load(fixture)), experimental_verify: async () => { throw new TypeError('broken'); }, dispatch: async () => dispatched++ };
  const container = await quiet().containers.run(app, ADD);
  assert.equal(container.exitCode, 2);
  assert.equal(container.error.check, 'verify.input');
  assert.equal(dispatched, 0);
});

test('the input is copied at create: a later start runs what was given', async () => {
  const bytes = new TextEncoder().encode(ADD);
  const container = await prism.containers.create(fixture, bytes, { ...P0, rm: true });
  bytes.fill(0);
  await container.start();
  assert.equal(container.text(), SUM);
});

test('a closure cannot be judged: no verdict and exit 2 without the flag, and it runs with it, with no digest', async () => {
  const closureApp = {
    ...(await load(fixture)),
    kind: 'closure',
    archive: undefined,
    identities: { stem: 'calculator' },
    experimental_verify: (options) => experimental_verify({ kind: 'closure' }, options),
  };
  const refused = await quiet().containers.run(closureApp, ADD);
  assert.equal(refused.exitCode, 2);
  assert.equal(refused.error.check, 'verify.kind');
  const record = await refused.inspect();
  assert.equal(record.image.digest, null);
  assert.equal(record.image.kind, 'closure');
  assert.equal(record.verdict, null);
  const warnings = [];
  const allowed = await createPrism({ warn: (message) => warnings.push(message) }).containers.run(closureApp, ADD, { allowUnverified: true });
  assert.equal(allowed.exitCode, 0);
  assert.match(warnings[0], /^no verdict \(verify\.kind: /);
});

test('a verdict that fails for a typed reason exits with that class\'s code', async () => {
  const verdict = (check) => ({
    schema: 'prism/verdict/1',
    holo: `blake3:${'0'.repeat(64)}`,
    level: 'P0',
    policy: { name: 'default', minimum: 'P0' },
    passed: false,
    reasons: [{ check, withholds: null, message: 'no' }],
  });
  const cases = [
    ['proof.subject', ProofMismatchError, 10],
    ['world.hash', WorldMismatchError, 11],
    ['replay.divergence', DeterminismViolationError, 12],
    ['replay.history', ReplayError, 13],
    ['world.capabilities', CapabilityDeniedError, 2],
    ['policy.digests.guest', VerificationError, 1],
  ];
  for (const [check, Class, exit] of cases) {
    const app = { ...(await load(fixture)), experimental_verify: async () => verdict(check) };
    const container = await quiet().containers.run(app, ADD);
    assert.ok(container.error instanceof Class, check);
    assert.equal(container.exitCode, exit, check);
  }
});

test('a run whose dispatch throws a typed error exits with its code, with a start time', async () => {
  const oversized = await quiet().containers.run(fixture, new Uint8Array(70000), P0);
  assert.equal(oversized.status, 'exited');
  assert.equal(oversized.exitCode, 2);
  assert.ok(oversized.error instanceof PrismCodeError);
  assert.equal(oversized.error.code, 'core.allocation');
  const record = await oversized.inspect();
  assert.ok(record.state.startedAt);
  assert.equal(record.state.error.code, 'core.allocation');

  const denied = await quiet().containers.run(await throwing(new CapabilityDeniedError('no', { check: 'capabilities.import' })), ADD, P0);
  assert.equal(denied.exitCode, 2);
  assert.equal((await denied.inspect()).state.error.check, 'capabilities.import');
});

test('a guest that traps exits 70, and the trap is the error', async () => {
  const app = await load(trappingHolo());
  const container = await quiet().containers.run(app, ADD, { allowUnverified: true });
  assert.equal(container.status, 'exited');
  assert.equal(container.exitCode, 70);
  assert.ok(container.error instanceof WebAssembly.RuntimeError);
  assert.equal((await container.inspect()).state.error.name, 'RuntimeError');
  assert.equal(container.output, null);
});

test('every row of the exit table: its class gives its code', () => {
  assert.equal(exitCodeFor(null), 0);
  assert.equal(exitCodeFor(undefined), 0);
  const classes = { PrismError, PrismCodeError, ...Object.fromEntries(Object.values(ERROR_CLASSES).map((C) => [C.name, C])) };
  const covered = new Set();
  for (const row of EXIT_CODES) {
    if (row.error === null) {
      assert.equal(row.exit, 0);
      continue;
    }
    if (row.error === 'anything else') {
      for (const thrown of [new Error('x'), new WebAssembly.RuntimeError('x'), 'a string']) assert.equal(exitCodeFor(thrown), row.exit);
      continue;
    }
    const Class = classes[row.error];
    assert.ok(Class, `${row.error} is a class`);
    const options = row.when === 'with a verdict' ? { verdict: { passed: false } } : {};
    const error = Class === PrismCodeError ? new PrismCodeError('archive.magic', 'x') : new Class('x', options);
    assert.equal(exitCodeFor(error), row.exit, `${row.error} ${row.when ?? ''}`);
    covered.add(row.error);
  }
  for (const Class of Object.values(classes)) assert.ok(covered.has(Class.name), `${Class.name} has a row`);
});

test('the table keeps the codes the command line already gave', () => {
  assert.equal(exitCodeFor(new VerificationError('x', { verdict: {} })), CHECK_EXIT.FAILED);
  assert.equal(exitCodeFor(new VerificationError('x')), CHECK_EXIT.NO_VERDICT);
  assert.equal(exitCodeFor(new PrismCodeError('lock.image', 'x')), 64);
  assert.equal(exitCodeFor(new PrismError('x', { code: 'attest.unavailable' })), 3);
  assert.equal(exitCodeFor(new SigningError('x')), 3);
  assert.equal(exitCodeFor(new CapabilityDeniedError('x')), 2);
});

test('the docs page holds the same table', () => {
  const rows = [...readFileSync(guide, 'utf8').matchAll(/^\| (\d+) \| (.+?) \| (.+?) \|$/gm)].map((m) => [Number(m[1]), m[2], m[3]]);
  const expected = EXIT_CODES.map((row) => [row.exit, `${row.error === null ? 'none' : row.error === 'anything else' ? row.error : `\`${row.error}\``}${row.when ? `, ${row.when}` : ''}`, row.meaning]);
  assert.deepEqual(rows, expected);
});

test('rm removes the container on exit, whatever its code; what you hold keeps the result', async () => {
  const ok = await prism.containers.run(fixture, ADD, { ...P0, rm: true });
  assert.equal(ok.status, 'exited');
  assert.equal(ok.exitCode, 0);
  assert.equal(ok.text(), SUM);
  await assert.rejects(ok.inspect(), { code: 'container.missing' });
  await assert.rejects(prism.containers.get(ok.id), { code: 'container.missing' });
  await assert.rejects(ok.start(), { code: 'container.missing' });
  await assert.rejects(ok.remove(), { code: 'container.missing' });

  const refused = await prism.containers.run(fixture, ADD, { rm: true });
  assert.equal(refused.exitCode, 1);
  assert.ok(refused.error instanceof VerificationError);
  await assert.rejects(prism.containers.get(refused.id), { code: 'container.missing' });
});

test('a running container cannot be removed, and a second start joins the run', async () => {
  const { app, release, dispatched } = await held();
  const { containers } = quiet();
  const container = await containers.create(app, ADD, P0);
  const first = container.start();
  const second = container.start();
  assert.equal(first, second);
  await dispatched;
  await assert.rejects(container.remove(), { code: 'container.running' });
  release.returns(new Uint8Array());
  await first;
  await container.remove();
});

test('start after exit runs it again, as docker start does: exited to running to exited', async () => {
  let calls = 0;
  const app = {
    ...(await load(fixture)),
    dispatch: async () => {
      calls++;
      if (calls === 1) throw new PrismCodeError('core.response', 'first run fails');
      return new TextEncoder().encode('second');
    },
  };
  const { containers } = quiet();
  const container = await containers.run(app, ADD, P0);
  assert.equal(container.exitCode, 2);
  const firstStart = (await container.inspect()).state.startedAt;
  await containers.start(container.id);
  assert.equal(calls, 2);
  assert.equal(container.exitCode, 0);
  assert.equal(container.error, null);
  assert.equal(container.text(), 'second');
  const record = await container.inspect();
  assert.equal(record.state.error, null);
  assert.ok(Date.parse(record.state.startedAt) >= Date.parse(firstStart));
});

test('allowUnverified runs a holo that fails check, warns on every start, and the record says so', async () => {
  const warnings = [];
  const { containers } = createPrism({ warn: (message) => warnings.push(message) });
  const container = await containers.run(fixture, ADD, { allowUnverified: true });
  assert.equal(container.exitCode, 0);
  assert.equal(container.text(), SUM);
  assert.equal((await container.inspect()).verdict.passed, false);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /^the holo failed check \(P0, policy default requires P2\): .*running it unverified$/);
  await container.start();
  assert.equal(warnings.length, 2);
});

test('an id that is not hex, or a prefix that names two, is not looked up as a path', async () => {
  const { containers } = quiet();
  for (const id of ['../../etc/passwd', 'XYZ', '', null, undefined, 7]) {
    await assert.rejects(containers.get(id), { code: 'container.missing' });
  }
  const two = createPrism({ store: { ...memoryContainerStore(), find: async () => ['a', 'b'] } });
  await assert.rejects(two.containers.get('a'), { code: 'container.ambiguous' });
});

test('createPrism keeps its own containers', async () => {
  const one = quiet();
  const other = quiet();
  const container = await one.containers.run(fixture, ADD, P0);
  await assert.rejects(other.containers.get(container.id), { code: 'container.missing' });
  assert.equal(await one.containers.get(container.id), container);
});

test('the file store keeps the record across clients, never the input, and a read-back container cannot be restarted', async () => {
  const directory = join(scratch(), 'containers');
  const SECRET_INPUT = '1\tadd\t1234567\t1';
  const first = createPrism({ store: fileContainerStore(directory) });
  const container = await first.containers.run(fixture, SECRET_INPUT, P0);
  const path = join(directory, `${container.id}.json`);
  const text = readFileSync(path, 'utf8');
  assert.ok(!text.includes('1234567\\t1') && !text.includes(SECRET_INPUT), 'the input is not on disk');
  if (process.platform !== 'win32') assert.equal(statSync(path).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), [`${container.id}.json`], 'no scratch file is left');

  const second = createPrism({ store: fileContainerStore(directory) });
  const again = await second.containers.get(container.id.slice(0, 16));
  assert.notEqual(again, container);
  assert.equal(again.status, 'exited');
  assert.equal(again.exitCode, 0);
  assert.equal(again.text(), container.text());
  assert.deepEqual(await again.inspect(), await container.inspect());
  await assert.rejects(again.start(), { code: 'container.state' });

  await second.containers.remove(container.id);
  assert.ok(!existsSync(path));
  await assert.rejects(second.containers.get(container.id), { code: 'container.missing' });

  const gone = createPrism({ store: fileContainerStore(directory) });
  const removed = await gone.containers.run(fixture, ADD, { ...P0, rm: true });
  assert.equal(removed.exitCode, 0);
  assert.deepEqual(readdirSync(directory), [], '--rm leaves nothing');
});

test('the file store keeps output that is not text, and names the directory it cannot write', async () => {
  const directory = join(scratch(), 'containers');
  const app = { ...(await load(fixture)), dispatch: async () => Uint8Array.from([0xff, 0x00, 0xfe]) };
  const { containers } = createPrism({ store: fileContainerStore(directory) });
  const container = await containers.run(app, ADD, P0);
  assert.deepEqual((await container.inspect()).output, { encoding: 'hex', data: 'ff00fe' });
  const again = await createPrism({ store: fileContainerStore(directory) }).containers.get(container.id);
  assert.deepEqual([...again.output], [0xff, 0x00, 0xfe]);

  const blocker = join(scratch(), 'a-file');
  writeFileSync(blocker, '');
  const blocked = createPrism({ store: fileContainerStore(join(blocker, 'containers')) });
  await assert.rejects(blocked.containers.create(fixture, ADD, P0), { code: 'container.store' });
});

test('containersDirectory is PRISM_HOME, or ~/.prism', () => {
  assert.equal(containersDirectory({ PRISM_HOME: join('x', 'y') }), join('x', 'y', 'containers'));
  assert.match(containersDirectory({ PRISM_HOME: '' }), /\.prism[\\/]containers$/);
});

test('the 0.2.0 calls still run unchanged beside the containers', async () => {
  const app = await load(fixture);
  assert.equal(app.name, 'Calculator');
  assert.equal(app.identities.verified, true);
  assert.deepEqual(app.limits, { request: 52, response: 27, guestAllocation: 65536 });
  const response = await app.dispatch(new TextEncoder().encode(ADD));
  assert.equal(new TextDecoder().decode(response), SUM);
  assert.deepEqual(await app.acceptance(), { total: 22, passed: 22, failed: [] });
});

// The command line: the same lifecycle, with the record on disk under PRISM_HOME.

function cli(args, home = scratch('prism-home-')) {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { ...process.env, PRISM_HOME: home, PRISM_CODE_NO_HOOKS: '1' } });
  return { code: result.status, out: result.stdout, err: result.stderr, home };
}
const policyFile = () => {
  const path = join(scratch('prism-policy-'), 'p0.json');
  writeFileSync(path, JSON.stringify({ minimum: 'P0' }));
  return path;
};
const stored = (home) => {
  const directory = join(home, 'containers');
  return existsSync(directory) ? readdirSync(directory) : [];
};

test('prism-code run with an input: stdout is the output and nothing else, exit 0, the container is kept', () => {
  const home = scratch('prism-home-');
  const run = cli(['run', fixture, ADD, '--policy', policyFile()], home);
  assert.equal(run.code, 0, run.err);
  assert.equal(run.out, SUM);
  const id = run.err.match(/^container ([0-9a-f]{64}) exited 0$/m)?.[1];
  assert.ok(id, run.err);
  assert.deepEqual(stored(home), [`${id}.json`]);

  const record = JSON.parse(cli(['inspect', id, '--json'], home).out);
  assert.equal(record.schema, CONTAINER_SCHEMA);
  assert.equal(record.state.status, 'exited');
  assert.equal(record.state.exitCode, 0);
  assert.ok(record.state.startedAt && record.state.finishedAt);
  assert.match(record.image.digest, /^blake3:[0-9a-f]{64}$/);
  assert.deepEqual(record.output, { encoding: 'utf-8', data: SUM });

  assert.equal(cli(['inspect', id.slice(0, 12), '--format', 'state.exitCode'], home).out, '0\n');
  assert.equal(cli(['inspect', id, '--format', 'image.name'], home).out, 'Calculator\n');
  const human = cli(['inspect', id], home).out;
  assert.match(human, /^Status: {5}exited$/m);
  assert.match(human, /^Exit code: {2}0$/m);
  assert.match(human, /^Image: {6}Calculator blake3:/m);

  const removed = cli(['rm', id.slice(0, 12)], home);
  assert.equal(removed.code, 0, removed.err);
  assert.deepEqual(stored(home), []);
  const gone = cli(['inspect', id], home);
  assert.equal(gone.code, 2);
  assert.match(gone.err, /^load\.path:/);
  const again = cli(['rm', id], home);
  assert.equal(again.code, 2);
  assert.match(again.err, /^container\.missing:/);
});

test('--input is the same as the second argument', () => {
  const run = cli(['run', fixture, '--input', ADD, '--policy', policyFile(), '--rm']);
  assert.equal(run.code, 0, run.err);
  assert.equal(run.out, SUM);
});

test('--rm leaves no record and says nothing on stderr', () => {
  const run = cli(['run', fixture, ADD, '--rm', '--policy', policyFile()]);
  assert.equal(run.code, 0, run.err);
  assert.equal(run.out, SUM);
  assert.equal(run.err, '');
  assert.deepEqual(stored(run.home), []);
});

test('a run that fails check: exit 1, the verdict on stderr, nothing on stdout, the exited container kept', () => {
  const run = cli(['run', fixture, ADD]);
  assert.equal(run.code, 1);
  assert.equal(run.out, '');
  assert.match(run.err, /^FAILED {2}P0 unverified {2}policy default requires P2 or above/m);
  assert.match(run.err, /run refused: the holo did not pass check/);
  const id = run.err.match(/^container ([0-9a-f]{64}) exited 1$/m)?.[1];
  assert.ok(id, run.err);
  const record = JSON.parse(cli(['inspect', id, '--json'], run.home).out);
  assert.equal(record.state.status, 'exited');
  assert.equal(record.state.exitCode, 1);
  assert.equal(record.state.startedAt, null);
  assert.equal(record.state.error.name, 'VerificationError');
  assert.equal(record.verdict.passed, false);

  const removed = cli(['run', fixture, ADD, '--rm']);
  assert.equal(removed.code, 1);
  assert.deepEqual(stored(removed.home), []);
});

test('no verdict: exit 2 for an unreadable or invalid policy and for a closure', () => {
  const missing = cli(['run', fixture, ADD, '--policy', join(scratch(), 'nope.json')]);
  assert.equal(missing.code, 2);
  assert.match(missing.err, /^no verdict: policy\.unreadable:/);
  const bad = join(scratch(), 'bad.json');
  writeFileSync(bad, JSON.stringify({ effects: ['time'] }));
  assert.equal(cli(['run', fixture, ADD, '--policy', bad]).code, 2);
  // A numeric closure with no model cannot even be opened, so no container exists.
  const closed = cli(['run', closure, ADD]);
  assert.equal(closed.code, 2, closed.err);
  assert.match(closed.err, /^closure\.model:/);
  assert.deepEqual(stored(closed.home), []);
});

test('--allow-unverified runs it with the warning, and exit 0', () => {
  const run = cli(['run', fixture, ADD, '--allow-unverified', '--rm']);
  assert.equal(run.code, 0, run.err);
  assert.equal(run.out, SUM);
  assert.match(run.err, /^warning: the holo failed check \(P0, policy default requires P2\): .*running it unverified \(--allow-unverified\)\n$/);
});

test('a run whose dispatch throws: a trap exits 70 and names the trap, and the container is kept', () => {
  const holo = join(scratch(), 'trap.holo');
  writeFileSync(holo, trappingHolo());
  const run = cli(['run', holo, ADD, '--allow-unverified']);
  assert.equal(run.code, 70, run.err);
  assert.equal(run.out, '');
  assert.match(run.err, /RuntimeError: unreachable/);
  const id = run.err.match(/^container ([0-9a-f]{64}) exited 70$/m)?.[1];
  assert.ok(id, run.err);
  const record = JSON.parse(cli(['inspect', id, '--json'], run.home).out);
  assert.equal(record.state.exitCode, 70);
  assert.ok(record.state.startedAt);
});

test('an image that cannot be opened makes no container: exit 2 with the reader\'s code', () => {
  const bad = join(scratch(), 'bad.holo');
  writeFileSync(bad, Buffer.from(`HOLX${'\0'.repeat(60)}`));
  const run = cli(['run', bad, ADD, '--policy', policyFile()]);
  assert.equal(run.code, 2);
  assert.match(run.err, /^archive\.magic:/);
  assert.deepEqual(stored(run.home), []);
});

test('a store it cannot write is exit 2 and names the fix', () => {
  const blocker = join(scratch(), 'a-file');
  writeFileSync(blocker, '');
  const run = cli(['run', fixture, ADD, '--policy', policyFile()], blocker);
  assert.equal(run.code, 2);
  assert.match(run.err, /^container\.store: .*set PRISM_HOME/);
});

test('usage: exit 64', () => {
  const p0 = policyFile();
  assert.equal(cli(['run', fixture, ADD, 'extra', '--policy', p0]).code, 64);
  assert.equal(cli(['run', fixture, ADD, '--input', ADD, '--policy', p0]).code, 64);
  assert.equal(cli(['run', fixture, '--input']).code, 64);
  assert.equal(cli(['run', fixture, ADD, '--port', '0', '--policy', p0]).code, 64);
  const rm = cli(['run', fixture, '--rm', '--policy', p0]);
  assert.equal(rm.code, 64);
  assert.match(rm.err, /--rm needs an input/);
  assert.equal(cli(['rm']).code, 64);
});
