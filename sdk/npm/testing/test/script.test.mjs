import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PrismCodeError, PrismError } from 'prism-code';
import { scriptedDispatch, historyScript, ScriptIncompleteError, TestSetupError, UnexpectedCallError, referenceArchive } from '../src/index.mjs';

const text = (bytes) => new TextDecoder().decode(bytes);

test('answers listed calls in order and records them', async () => {
  const dispatch = scriptedDispatch([
    { request: 'add 1 2', response: '3' },
    { request: new Uint8Array([1, 2]), response: new Uint8Array([9]) },
    { request: (bytes) => text(bytes).startsWith('echo'), response: (bytes) => text(bytes).toUpperCase() },
  ]);
  assert.equal(text(await dispatch('add 1 2')), '3');
  assert.deepEqual([...(await dispatch(new Uint8Array([1, 2])))], [9]);
  assert.equal(text(await dispatch('echo hi')), 'ECHO HI');
  assert.equal(dispatch.remaining(), 0);
  assert.equal(dispatch.calls.length, 3);
  dispatch.assertComplete();
});

test('a request the script did not list throws UnexpectedCallError and leaves the script in place', async () => {
  const dispatch = scriptedDispatch([{ request: 'a', response: '1' }, { request: 'b', response: '2' }]);
  await assert.rejects(dispatch('b'), (error) => {
    assert.ok(error instanceof UnexpectedCallError && error instanceof PrismError);
    assert.equal(error.code, 'unexpected_call');
    assert.equal(error.check, 'testing.unexpected_call');
    assert.deepEqual(error.details, { index: 0, expected: 'a', received: 'b' });
    assert.match(error.message, /expected|lists request "a"; received "b"/);
    return true;
  });
  assert.equal(text(await dispatch('a')), '1');
  assert.equal(dispatch.remaining(), 1);
});

test('a call past the end throws UnexpectedCallError', async () => {
  const dispatch = scriptedDispatch([{ request: 'a', response: '1' }]);
  await dispatch('a');
  await assert.rejects(dispatch('a'), (error) => error instanceof UnexpectedCallError && error.details.expected === null);
  await assert.rejects(scriptedDispatch([])('x'), UnexpectedCallError);
});

test('assertComplete throws ScriptIncompleteError while calls remain', async () => {
  const dispatch = scriptedDispatch([{ request: 'a', response: '1' }, { request: 'b', response: '2' }]);
  await dispatch('a');
  assert.throws(() => dispatch.assertComplete(), (error) => {
    assert.ok(error instanceof ScriptIncompleteError);
    assert.equal(error.code, 'script_incomplete');
    assert.deepEqual(error.details, { remaining: 1, next: 'request "b"' });
    return true;
  });
  await dispatch('b');
  dispatch.assertComplete();
});

test('an error entry throws a PrismCodeError for a code, or the Error given', async () => {
  const boom = new RangeError('boom');
  const dispatch = scriptedDispatch([{ request: 'a', error: 'dispatch.limit' }, { request: 'b', error: boom }]);
  await assert.rejects(dispatch('a'), (error) => error instanceof PrismCodeError && error.code === 'dispatch.limit');
  await assert.rejects(dispatch('b'), (error) => error === boom);
  dispatch.assertComplete();
});

test('a malformed script is a TestSetupError', () => {
  for (const script of [null, 'x', [null], [{ request: 'a' }], [{ request: 'a', response: 'b', error: 'c.d' }], [{ request: 1, response: 'b' }], [{ request: 'a', error: 3 }]]) {
    assert.throws(() => scriptedDispatch(script), TestSetupError, JSON.stringify(script));
  }
});

test('a prism/history/1 is a script, and a reference archive\'s history answers its own vectors', async () => {
  const calculator = await referenceArchive('Calculator');
  const history = await calculator.history();
  const dispatch = scriptedDispatch(history);
  assert.equal(historyScript(history).length, history.events.length);
  const app = await calculator.load();
  for (const vector of app.vectors) assert.deepEqual(await dispatch(vector.request), vector.response);
  dispatch.assertComplete();
  await assert.rejects(dispatch('unlisted'), UnexpectedCallError);
});

test('a recorded refusal in a history throws its stable code', async () => {
  const dispatch = scriptedDispatch({ schema: 'prism/history/1', application: null, events: [{ request: '00', error: 'core.trap' }] });
  await assert.rejects(dispatch(new Uint8Array([0])), (error) => error.code === 'core.trap');
});
