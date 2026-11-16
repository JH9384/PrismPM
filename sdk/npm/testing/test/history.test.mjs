import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DeterminismViolationError, ReplayError, acceptanceHistory, historyJson as runtimeHistoryJson, parseHistory as runtimeParseHistory } from 'prism-code';
import { HISTORY_SCHEMA, TestSetupError, assertReplays, historyJson, parseHistory, readHistory, recordHistory, referenceArchive, referenceArchives, writeHistory } from '../src/index.mjs';

test('the history format is prism-code\'s own, not a copy', () => {
  assert.equal(HISTORY_SCHEMA, 'prism/history/1');
  assert.equal(parseHistory, runtimeParseHistory);
  assert.equal(historyJson, runtimeHistoryJson);
});

test('the reference archives are found with their histories', async () => {
  const names = await referenceArchives();
  assert.ok(names.includes('Calculator'));
  await assert.rejects(referenceArchive('Nope'), TestSetupError);
});

test('each reference archive replays its committed history with no divergence', async () => {
  for (const name of await referenceArchives()) {
    const archive = await referenceArchive(name);
    const app = await archive.load();
    const result = await assertReplays(app, await archive.history());
    assert.equal(result.divergenceCount, 0, name);
    assert.equal(result.statement.predicateType, 'https://uor.foundation/prism/replay/v1');
    // The committed file is exactly what the holo derives, so a fixture cannot drift from its archive.
    assert.equal(await readFile(archive.historyPath, 'utf8'), historyJson(await acceptanceHistory(app)), name);
  }
});

test('recordHistory records dispatches, refusals included, and the history replays', async () => {
  const archive = await referenceArchive('Calculator');
  const app = await archive.load();
  const [first] = app.vectors;
  const history = await recordHistory(app, async (dispatch) => {
    assert.deepEqual(await dispatch(first.request), first.response);
    await assert.rejects(dispatch(new Uint8Array(app.limits.guestAllocation + 1)), (error) => error.code === 'core.allocation');
  });
  assert.equal(history.events.length, 2);
  assert.equal(history.events[0].response !== undefined, true);
  assert.equal(history.events[1].error, 'core.allocation');
  assert.equal((await assertReplays(app, history)).divergenceCount, 0);
});

test('writeHistory and readHistory round-trip the bytes prism-code replay reads', async () => {
  const archive = await referenceArchive('Calculator');
  const history = await archive.history();
  const directory = await mkdtemp(join(tmpdir(), 'prism-testing-'));
  const path = join(directory, 'nested', 'copy.history.json');
  await writeHistory(path, history);
  assert.equal(await readFile(path, 'utf8'), await readFile(archive.historyPath, 'utf8'));
  assert.deepEqual(await readHistory(path), history);
});

test('a history the schema rejects is a ReplayError, and a changed answer a DeterminismViolationError', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'prism-testing-'));
  const bad = join(directory, 'bad.json');
  await writeFile(bad, '{"schema":"prism/history/1"}');
  await assert.rejects(readHistory(bad), ReplayError);
  const archive = await referenceArchive('Calculator');
  const app = await archive.load();
  const history = await archive.history();
  const events = history.events.map((event, i) => (i === 0 ? { ...event, response: event.response.slice(2) } : event));
  await assert.rejects(assertReplays(app, { ...history, events }), (error) => error instanceof DeterminismViolationError && error.details.divergenceCount === 1);
  assert.equal((await assertReplays(app, { ...history, events }, { throw: false })).divergenceCount, 1);
});
