// Histories and replay (#284): the reference archive replays green, a changed model fails on divergence with the typed
// error, the statement's fields are right, and that statement cannot carry a changed model to P3.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkReplayStatement } from '../../verify/src/statements.mjs';
import { levelOf } from '../../verify/src/level.mjs';
import { validate } from '../../spec/test/json-schema.mjs';
import {
  load,
  parseHistory,
  historyBytes,
  historyDigest,
  historyJson,
  acceptanceHistory,
  experimental_recorder,
  experimental_replay,
  experimental_verify,
  DeterminismViolationError,
  ReplayError,
  PrismError,
  HISTORY_SCHEMA,
  REPLAY_PREDICATE_TYPE,
  blake3Hex,
} from '../src/index.mjs';
import { fromFile } from '../src/node.mjs';
import { policyInput } from '../src/vendor/verify.mjs';
import { VERSION } from '../src/version.mjs';
import { deriveChangedModel } from '../scripts/derive-changed-model.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const bin = here('../bin/prism-code.mjs');
const holoPath = here('../fixtures/Calculator.holo');
const changedPath = here('./fixtures/Calculator.changed-model.holo');
const historyPath = here('../fixtures/Calculator.history.json');
const closurePath = here('./fixtures/calculator-closure');
const SPEC = here('../../spec/test/fixtures/');
const dir = mkdtempSync(join(tmpdir(), 'prism-replay-'));

const original = new Uint8Array(readFileSync(holoPath));
const changed = new Uint8Array(readFileSync(changedPath));
const historyText = readFileSync(historyPath, 'utf8');
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));
const replaySchema = json(here('../../spec/predicates/replay-v1.schema.json'));
const SIGNED = { verified: true };
const encoder = new TextEncoder();

const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
const out = (name) => join(dir, `${name}-${Math.random().toString(36).slice(2)}`);

/** A guest's blobs as the statement check takes them, read off the holo the way a checker would. */
async function blobsOf(bytes) {
  const app = await load(bytes);
  const { resolveArchive } = await import('../src/archive.mjs');
  const { sha256Hex } = await import('../src/sha256.mjs');
  const { guest, model } = resolveArchive(app.archive);
  const digests = async (blob) => ({ blake3: blake3Hex(blob.content), sha256: await sha256Hex(blob.content) });
  return { guest: await digests(guest), model: await digests(model) };
}

// ---- The reference archive replays green.

test('the committed Calculator history is what the holo derives, and it replays with no divergence', async () => {
  const app = await load(original);
  const history = await app.history();
  assert.equal(historyJson(history), historyText, 'fixtures/Calculator.history.json is current');
  assert.equal(history.schema, HISTORY_SCHEMA);
  assert.equal(history.events.length, app.vectors.length);
  const result = await app.experimental_replay(historyText);
  assert.equal(result.events, 22);
  assert.equal(result.divergenceCount, 0);
  assert.deepEqual(result.histories[0].divergences, []);
});

test('the history is the acceptance vectors in bytes: request and response, in order', async () => {
  const app = await load(original);
  const { events } = parseHistory(historyText);
  app.vectors.forEach((vector, i) => {
    assert.equal(events[i].request, Buffer.from(vector.request).toString('hex'));
    assert.equal(events[i].response, Buffer.from(vector.response).toString('hex'));
  });
});

// ---- The statement's fields.

test('the statement names the guest, the model, the history digests, the divergence count and the runtime', async () => {
  const app = await load(original);
  const { statement } = await app.experimental_replay(historyText);
  const blobs = await blobsOf(original);
  assert.equal(statement._type, 'https://in-toto.io/Statement/v1');
  assert.equal(statement.predicateType, REPLAY_PREDICATE_TYPE);
  assert.deepEqual(statement.subject, [{ name: 'guest', digest: blobs.guest }]);
  assert.deepEqual(statement.predicate.model, blobs.model);
  assert.deepEqual(statement.predicate.runtime, { name: 'prism-code', version: VERSION });
  assert.equal(statement.predicate.divergenceCount, 0);
  assert.deepEqual(statement.predicate.histories, [{ digest: await historyDigest(historyText), events: 22, divergences: 0 }]);
  assert.deepEqual(validate(replaySchema, statement.predicate), []);
  // Exactly the four members the predicate defines, so a new one is a decision, not an accident.
  assert.deepEqual(Object.keys(statement.predicate).sort(), ['divergenceCount', 'histories', 'model', 'runtime']);
});

test('the statement equals the spec fixture but for the runtime version, so the fixture cannot go stale', async () => {
  const { statement } = await (await load(original)).experimental_replay(historyText);
  const fixture = json(join(SPEC, 'attestation/statement/calculator-replay.json'));
  fixture.predicate.runtime.version = VERSION;
  assert.deepEqual(statement, fixture);
  assert.equal(readFileSync(join(SPEC, 'history/history-v1/calculator.json'), 'utf8'), historyText);
});

test('the same replay writes the same statement bytes, and it holds no clock', async () => {
  const app = await load(original);
  const a = JSON.stringify((await app.experimental_replay(historyText)).statement);
  const b = JSON.stringify((await (await load(original)).experimental_replay(historyText)).statement);
  assert.equal(a, b);
  assert.doesNotMatch(a, /"(?:time|date)[a-zA-Z]*":|"[a-zA-Z]+(?:Time|Date)[a-zA-Z]*":/);
});

test('the digest covers canonical JSON, so reordered members and a CRLF file are the same history', async () => {
  const value = JSON.parse(historyText);
  const reordered = { events: value.events, application: value.application, recordedFrom: value.recordedFrom, schema: value.schema };
  const expected = await historyDigest(historyText);
  assert.deepEqual(await historyDigest(reordered), expected);
  assert.deepEqual(await historyDigest(JSON.stringify(value, null, 2).replaceAll('\n', '\r\n')), expected);
  assert.equal(blake3Hex(historyBytes(reordered)), expected.blake3);
  assert.equal(Buffer.from(historyBytes(value)).toString(), historyText.trimEnd(), 'no trailing newline');
});

// ---- The divergence path.

test('a changed model fails: its own vectors pass, the recorded history diverges with the typed error', async () => {
  const app = await load(changed);
  assert.equal(app.identities.verified, true, 'the changed archive is coherent');
  const own = await app.acceptance();
  assert.equal(own.passed, own.total, 'its own vectors agree with it, so only the history can tell');

  await assert.rejects(
    () => app.experimental_replay(historyText),
    (error) => {
      assert.ok(error instanceof DeterminismViolationError && error instanceof PrismError);
      assert.equal(error.code, 'determinism_violation');
      assert.equal(error.check, 'replay.divergence');
      assert.equal(error.diagnostic, 'PP5701');
      assert.equal(error.details.divergenceCount, 7);
      assert.equal(error.details.statement.predicate.divergenceCount, 7);
      assert.match(error.message, /7 of 22 events/);
      assert.match(error.message, /recorded "1\\tok\\t0", replayed "1\\tOK\\t0"/);
      return true;
    },
  );
});

test('every divergence is reported with its index, its request and both outcomes', async () => {
  const app = await load(changed);
  const result = await app.experimental_replay(historyText, { throw: false });
  const { divergences } = result.histories[0];
  assert.equal(divergences.length, 7);
  assert.deepEqual(divergences[1], {
    index: 1,
    request: Buffer.from('1\tadd\t20\t22').toString('hex'),
    expected: { response: Buffer.from('1\tok\t42').toString('hex') },
    actual: { response: Buffer.from('1\tOK\t42').toString('hex') },
  });
  assert.equal(result.statement.predicate.histories[0].divergences, 7);
});

test('an edited recording diverges against the unchanged build', async () => {
  const value = JSON.parse(historyText);
  value.events[3].response = '00';
  const result = await (await load(original)).experimental_replay(value, { throw: false });
  assert.equal(result.divergenceCount, 1);
  assert.equal(result.histories[0].divergences[0].index, 3);
});

test('a refusal is an outcome: it replays when it recurs, and diverges when it does not', async () => {
  const app = await load(original);
  const big = new Uint8Array(app.limits.guestAllocation + 1);
  const recorder = app.experimental_recorder();
  await assert.rejects(() => recorder.dispatch(big), (error) => error.code === 'core.allocation');
  const history = await recorder.history();
  assert.deepEqual(Object.keys(history.events[0]).sort(), ['error', 'request']);
  assert.equal(history.events[0].error, 'core.allocation');
  assert.equal((await app.experimental_replay(history)).divergenceCount, 0);

  const value = { ...history, events: [{ request: history.events[0].request, response: '' }] };
  const { histories } = await app.experimental_replay(value, { throw: false });
  assert.deepEqual(histories[0].divergences[0].actual, { error: 'core.allocation' });

  const expectingRefusal = { ...history, events: [{ request: '', error: 'core.allocation' }] };
  const other = await app.experimental_replay(expectingRefusal, { throw: false });
  assert.equal(other.divergenceCount, 1);
  assert.ok(other.histories[0].divergences[0].actual.response !== undefined);
});

test('several histories: the statement names each one and sums their divergences', async () => {
  const app = await load(changed);
  const second = { schema: HISTORY_SCHEMA, application: null, events: [{ request: Buffer.from('1\tadd\t1\t1').toString('hex'), response: Buffer.from('1\tok\t2').toString('hex') }] };
  const { statement, events } = await app.experimental_replay([historyText, second], { throw: false });
  assert.equal(events, 23);
  assert.deepEqual(statement.predicate.histories.map((h) => [h.events, h.divergences]), [[22, 7], [1, 1]]);
  assert.equal(statement.predicate.divergenceCount, 8);
});

// ---- A changed model cannot reach P3.

test('a changed model cannot reach P3: not with the old statement, and not with its own', async () => {
  const before = await (await load(original)).experimental_replay(historyText);
  const after = await (await load(changed)).experimental_replay(historyText, { throw: false });
  const blobs = await blobsOf(changed);

  // With every lower level assumed, the reasons of the replay check alone decide P3.
  assert.equal(levelOf(checkReplayStatement(before.statement, await blobsOf(original), SIGNED)), 'P3', 'the reference archive reaches it');

  const stale = checkReplayStatement(before.statement, blobs, SIGNED);
  assert.deepEqual(stale.map((r) => r.check), ['replay.subject', 'replay.model']);
  assert.equal(levelOf(stale), 'P2');

  const own = checkReplayStatement(after.statement, blobs, SIGNED);
  assert.deepEqual(own.map((r) => [r.check, r.code]), [['replay.divergence', 'PP5701']]);
  assert.equal(levelOf(own), 'P2');
});

test('check does not reach P3 on the changed model today: it still names the missing replay statement', async () => {
  const verdict = await experimental_verify(changed, { minimum: 'P0', env: {} });
  assert.equal(verdict.level, 'P0');
  assert.ok(verdict.reasons.some((r) => r.check === 'replay.statement' && r.withholds === 'P3'));
  assert.ok(!verdict.reasons.some((r) => r.check === 'holo.integrity'), 'the fixture is coherent, so only replay can catch it');
});

// ---- The replay statement in the verdict (`check --replay`).

test('check judges a statement from beside the holo: the changed model fails replay in the verdict', async () => {
  const before = await (await load(original)).experimental_replay(historyText);
  const after = await (await load(changed)).experimental_replay(historyText, { throw: false });
  const replayChecks = (verdict) => verdict.reasons.filter((r) => r.check.startsWith('replay.')).map((r) => [r.check, r.code, r.withholds]);
  const envelope = ['replay.envelope', 'PP5702', 'P3'];

  const own = await experimental_verify(changed, { minimum: 'P0', replay: after.statement, env: {} });
  assert.deepEqual(replayChecks(own), [envelope, ['replay.divergence', 'PP5701', 'P3']]);
  assert.equal(own.level, 'P0');
  assert.equal(own.passed, true, 'replay withholds P3; the policy says whether that fails the holo');

  const stale = await experimental_verify(changed, { minimum: 'P0', replay: before.statement, env: {} });
  assert.deepEqual(replayChecks(stale), [envelope, ['replay.subject', 'PP5704', 'P3'], ['replay.model', 'PP5705', 'P3']]);

  const shape = await experimental_verify(changed, { minimum: 'P0', replay: { not: 'a statement' }, env: {} });
  assert.deepEqual(replayChecks(shape), [envelope, ['replay.statement', 'PP5703', 'P3']]);
});

test('a clean statement from beside the holo cannot raise the level: it is unsigned, and no option says otherwise', async () => {
  const { statement } = await (await load(original)).experimental_replay(historyText);
  const verdict = await experimental_verify(original, { minimum: 'P3', replay: statement, env: {} });
  assert.deepEqual(verdict.reasons.filter((r) => r.check.startsWith('replay.')).map((r) => r.check), ['replay.envelope']);
  assert.equal(verdict.level, 'P0');
  assert.equal(verdict.passed, false);

  const claimed = { ...statement, verified: true, envelope: { verified: true } };
  const again = await experimental_verify(original, { minimum: 'P0', replay: claimed, env: {} });
  assert.ok(again.reasons.some((r) => r.check.startsWith('replay.') && r.withholds === 'P3'), 'extra members claim nothing');
});

test('a Rego policy can deny on what the replay statement says, and it is marked unverified', async () => {
  const { statement } = await (await load(changed)).experimental_replay(historyText, { throw: false });
  const rego = [
    'package prism.policy',
    'minimum := "P0"',
    'deny contains {"rule": "policy.replay.diverged", "message": "the replay diverged"} if {',
    '  input.predicates.replay.predicate.divergenceCount > 0',
    '}',
    'deny contains {"rule": "policy.replay.unsigned", "message": "the replay is unsigned"} if {',
    '  input.predicates.replay.verified == false',
    '}',
  ].join('\n');
  const verdict = await experimental_verify(changed, { name: 'replay', rego, replay: statement, env: {} });
  assert.equal(verdict.passed, false);
  assert.deepEqual(verdict.reasons.filter((r) => r.check.startsWith('policy.')).map((r) => r.check).sort(), ['policy.replay.diverged', 'policy.replay.unsigned']);

  const without = await experimental_verify(changed, { name: 'replay', rego, env: {} });
  assert.equal(without.passed, true, 'no statement, nothing to deny on');

  const input = await policyInput(changed, { replay: statement });
  assert.deepEqual(validate(json(here('../../spec/schemas/policy/policy-input-v1.schema.json')), input), []);
  assert.equal(input.predicates.replay.verified, false);
  assert.equal((await policyInput(changed, { replay: { not: 'a statement' } })).predicates.replay, null);
  assert.equal((await policyInput(changed)).predicates.replay, null);
});

test('check --replay: the reasons print, the exit follows the policy, and an unreadable statement is no verdict', async () => {
  const { statement } = await (await load(changed)).experimental_replay(historyText, { throw: false });
  const statementPath = join(dir, 'check-replay.statement.json');
  writeFileSync(statementPath, JSON.stringify(statement));

  const failed = cli('check', changedPath, '--replay', statementPath, '--json');
  assert.equal(failed.status, 1);
  const verdict = JSON.parse(failed.stdout);
  assert.ok(verdict.reasons.some((r) => r.check === 'replay.divergence' && r.code === 'PP5701'));
  assert.ok(!verdict.reasons.some((r) => r.check === 'replay.statement'));

  assert.equal(cli('check', changedPath, '--replay', join(dir, 'absent.json')).status, 2);
  writeFileSync(join(dir, 'not-json.json'), 'not json');
  assert.equal(cli('check', changedPath, '--replay', join(dir, 'not-json.json')).status, 2);
  assert.equal(cli('check', changedPath, '--replay').status, 64);
});

test('the changed-model fixture is what the reference archive derives to', () => {
  assert.ok(Buffer.from(deriveChangedModel(original)).equals(Buffer.from(changed)));
  execFileSync(process.execPath, [here('../scripts/derive-changed-model.mjs'), '--check'], { stdio: 'pipe' });
});

// ---- A replay that cannot be carried out.

test('a replay that cannot be carried out is a ReplayError, never a divergence', async () => {
  const app = await load(original);
  const refused = async (histories, check, options) =>
    assert.rejects(
      () => app.experimental_replay(histories, options),
      (error) => error instanceof ReplayError && !(error instanceof DeterminismViolationError) && error.code === 'replay_failed' && error.check === check,
    );
  await refused('not json', 'replay.history');
  await refused({}, 'replay.history');
  await refused([], 'replay.history');
  await refused([historyText, historyText], 'replay.history');
  await refused(historyText, 'replay.options', { colour: 'red' });
});

test('an archive that fails its own integrity is refused before anything runs', async () => {
  const bytes = original.slice();
  const { parseArchive } = await import('../src/archive.mjs');
  const parsed = parseArchive(bytes);
  const guest = parsed.blobs[0];
  bytes[parsed.sections[guest.section].offset + 71 + 10] ^= 0xff;
  const app = await load(bytes).catch(() => null);
  if (app === null) return; // A guest this damaged may not even compile, which is also a refusal.
  await assert.rejects(
    () => experimental_replay(app, historyText),
    (error) => error instanceof ReplayError && error.check === 'replay.holo',
  );
});

test('parseHistory takes what the schema takes and rejects what it rejects, on the spec fixtures', () => {
  const folder = join(SPEC, 'history/history-v1');
  const valid = readdirSync(folder).filter((name) => name.endsWith('.json'));
  assert.ok(valid.length >= 2);
  for (const name of valid) assert.doesNotThrow(() => parseHistory(readFileSync(join(folder, name))), name);
  const invalid = readdirSync(join(folder, 'invalid'));
  assert.ok(invalid.length >= 5);
  for (const name of invalid) {
    assert.throws(() => parseHistory(readFileSync(join(folder, 'invalid', name))), (error) => error instanceof ReplayError && error.check === 'replay.history', name);
  }
});

// ---- Recording.

test('the recorder returns what dispatch returns, and what it records replays', async () => {
  const app = await load(original);
  const recorder = experimental_recorder(app);
  const response = await recorder.dispatch(encoder.encode('1\tadd\t20\t22'));
  assert.equal(Buffer.from(response).toString(), '1\tok\t42');
  await recorder.dispatch(encoder.encode('1\tsubtract\t5\t7'));
  assert.equal(recorder.events(), 2);
  const history = await recorder.history();
  assert.equal(history.application, 'Calculator');
  assert.deepEqual(history.recordedFrom, await blobsOf(original));
  assert.equal(history.events.length, 2);
  assert.equal((await app.experimental_replay(history)).divergenceCount, 0);
  const after = await load(changed);
  await assert.rejects(() => after.experimental_replay(history), DeterminismViolationError);
});

test('a recorder that recorded nothing has no history', async () => {
  const recorder = experimental_recorder(await load(original));
  await assert.rejects(() => recorder.history(), (error) => error instanceof ReplayError && error.check === 'replay.history');
});

// ---- A closure.

test('a closure replays too, and has no statement because it has no guest blob to name', async () => {
  const app = await fromFile(closurePath, { model: (await load(original)).model });
  const events = [{ request: Buffer.from('1\tadd\t20\t22').toString('hex'), response: Buffer.from('1\tok\t42').toString('hex') }];
  const result = await app.experimental_replay({ schema: HISTORY_SCHEMA, application: null, events });
  assert.equal(result.divergenceCount, 0);
  assert.equal(result.statement, null);
});

// ---- The command.

test('replay: exit 0 on the reference archive, and the statement file is the statement', async () => {
  const statement = out('statement.json');
  const r = cli('replay', historyPath, '--holo', holoPath, '--statement', statement);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Replaying 1 history against Calculator@blake3:2adca3e7ca42$/m);
  assert.match(r.stdout, /Calculator\.history\.json {2}22 events, no divergence/);
  assert.match(r.stdout, /^Replay: PASS {2}no divergence$/m);
  const { statement: expected } = await (await load(original)).experimental_replay(historyText);
  const { canonicalJson } = await import('../src/archive.mjs');
  assert.equal(readFileSync(statement, 'utf8'), `${canonicalJson(expected)}\n`);
});

test('replay: exit 1 on the changed model, every divergence printed, and the failed statement still written', () => {
  const statement = out('statement.json');
  const r = cli('replay', historyPath, '--holo', changedPath, '--statement', statement);
  assert.equal(r.status, 1, r.stderr);
  assert.match(r.stdout, /22 events, 7 divergences/);
  assert.match(r.stdout, /event 1: request "1\\tadd\\t20\\t22"\n\s+recorded "1\\tok\\t42"\n\s+replayed "1\\tOK\\t42"/);
  assert.match(r.stdout, /^Replay: FAIL {2}7 divergences \(DeterminismViolationError, replay\.divergence\)$/m);
  assert.equal(json(statement).predicate.divergenceCount, 7);
});

test('replay --json prints one canonical object, on a pass and on a failure', () => {
  for (const [holo, code, count] of [[holoPath, 0, 0], [changedPath, 1, 7]]) {
    const r = cli('replay', historyPath, '--holo', holo, '--json');
    assert.equal(r.status, code, r.stderr);
    const value = JSON.parse(r.stdout);
    assert.equal(value.schema, 'prismpm/replay-result/1');
    assert.equal(value.divergenceCount, count);
    assert.equal(value.statement.predicate.divergenceCount, count);
    assert.equal(r.stdout.trimEnd().includes('\n'), false, 'one line');
  }
});

test('replay takes a directory of histories, sorted by name', () => {
  const folder = out('histories');
  mkdirSync(folder);
  copyFileSync(historyPath, join(folder, 'b.json'));
  const second = { schema: HISTORY_SCHEMA, application: null, events: [{ request: Buffer.from('1\tadd\t1\t1').toString('hex'), response: Buffer.from('1\tok\t2').toString('hex') }] };
  writeFileSync(join(folder, 'a.json'), JSON.stringify(second));
  writeFileSync(join(folder, 'notes.txt'), 'not a history');
  const r = cli('replay', folder, '--holo', holoPath);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Replaying 2 histories/);
  assert.match(r.stdout, /a\.json {2}1 event, no divergence\n\s+b\.json {2}22 events/);
});

test('replay: exit 2 when it cannot be carried out, 64 on bad usage', () => {
  const bad = out('bad.json');
  writeFileSync(bad, '{"schema":"prism/history/1"}');
  for (const args of [[bad, '--holo', holoPath], [out('absent.json'), '--holo', holoPath], [historyPath, '--holo', out('absent.holo')], [historyPath, '--holo', closurePath, '--statement', out('s.json')], [historyPath, '--holo', holoPath, '--statement', join(out('absent-dir'), 's.json')]]) {
    const r = cli('replay', ...args);
    assert.equal(r.status, 2, `${args.join(' ')}: ${r.stderr}`);
    assert.equal(r.stdout, '');
  }
  assert.match(cli('replay', bad, '--holo', holoPath).stderr, /could not replay: replay\.history/);
  assert.equal(cli('replay', historyPath).status, 64);
  assert.equal(cli('replay', '--holo', holoPath).status, 64);
  assert.equal(cli('replay', historyPath, '--holo', holoPath, '--colour', 'red').status, 64);
});

test('history: prints the acceptance vectors, or writes them with --output', () => {
  const printed = cli('history', holoPath);
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(printed.stdout, historyText);
  const file = out('history.json');
  assert.equal(cli('history', holoPath, '--output', file).status, 0);
  assert.equal(readFileSync(file, 'utf8'), historyText);
  assert.equal(cli('history').status, 64);
});

test('run --record writes every dispatch to the file, and that file replays', async () => {
  const record = out('recorded.json');
  const child = spawn(process.execPath, [bin, 'run', holoPath, '--allow-unverified', '--record', record], { stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    const url = await new Promise((resolve, reject) => {
      let text = '';
      child.stdout.on('data', (chunk) => {
        text += chunk;
        const match = /at (http:\S+)\n[\s\S]*\ncheck: /.exec(text);
        if (match) resolve(match[1]);
      });
      child.on('exit', (code) => reject(new Error(`run exited ${code}`)));
    });
    const response = await fetch(new URL('_hologram/intent', url), { method: 'POST', body: JSON.stringify({ version: 1, name: 'application.invoke', payload: '1\tadd\t20\t22' }) });
    assert.deepEqual(await response.json(), { version: 1, outputs: ['1\tok\t42'] });
  } finally {
    child.removeAllListeners('exit');
    child.kill();
  }
  const history = parseHistory(readFileSync(record));
  assert.deepEqual(history.events, [{ request: Buffer.from('1\tadd\t20\t22').toString('hex'), response: Buffer.from('1\tok\t42').toString('hex') }]);
  assert.equal(cli('replay', record, '--holo', holoPath).status, 0);
  assert.equal(cli('replay', record, '--holo', changedPath).status, 1);
});

test('the version constant is the one package.json states, and acceptanceHistory matches app.history', async () => {
  assert.equal(VERSION, json(here('../package.json')).version);
  const app = await load(original);
  assert.deepEqual(await acceptanceHistory(app), await app.history());
});
