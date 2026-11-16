import { PrismCodeError, HISTORY_SCHEMA } from './runtime.mjs';
import { ScriptIncompleteError, TestSetupError, UnexpectedCallError } from './errors.mjs';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8');

const fromHex = (hex) => Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
const toBytes = (value, where) => {
  if (typeof value === 'string') return encoder.encode(value);
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  throw new TestSetupError(`${where} is text or bytes`, { check: 'testing.script' });
};
const same = (a, b) => a.length === b.length && a.every((byte, i) => byte === b[i]);
const show = (bytes) => {
  try {
    return JSON.stringify(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return `0x${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
  }
};

/** The entries of a `prism/history/1` as script entries: a recorded response, or a thrown error code. */
export function historyScript(history) {
  if (history?.schema !== HISTORY_SCHEMA) throw new TestSetupError(`a history is ${HISTORY_SCHEMA}`, { check: 'testing.script' });
  return history.events.map((event) =>
    event.error === undefined ? { request: fromHex(event.request), response: fromHex(event.response) } : { request: fromHex(event.request), error: event.error },
  );
}

function entryOf(entry, index) {
  const where = `script[${index}]`;
  if (entry === null || typeof entry !== 'object') throw new TestSetupError(`${where} is an object with a request and a response or an error`, { check: 'testing.script' });
  const hasResponse = Object.hasOwn(entry, 'response');
  const hasError = Object.hasOwn(entry, 'error');
  if (hasResponse === hasError) throw new TestSetupError(`${where} must hold exactly one of response and error`, { check: 'testing.script' });
  const request = typeof entry.request === 'function' ? entry.request : toBytes(entry.request, `${where}.request`);
  if (hasResponse) return { request, response: typeof entry.response === 'function' ? entry.response : toBytes(entry.response, `${where}.response`) };
  const error = entry.error;
  if (!(error instanceof Error) && typeof error !== 'string') throw new TestSetupError(`${where}.error is an Error or a stable error code`, { check: 'testing.script' });
  return { request, error };
}

const describe = (entry) => (typeof entry.request === 'function' ? 'a request the matcher accepts' : `request ${show(entry.request)}`);

/**
 * A stand-in for `app.dispatch` that answers from a list and throws on anything else.
 *
 * `script` is an array of `{ request, response }` or `{ request, error }`, or a `prism/history/1`, whose
 * events become the entries. A request or response is text (UTF-8) or bytes; a request may also be a
 * function of the received bytes returning true, and a response a function of the received bytes
 * returning the answer. An `error` is an `Error` to throw or a stable error code, thrown as a
 * `PrismCodeError` the way a failed dispatch is. Calls are matched in order.
 *
 * A call with nothing left in the script, or whose request is not the next one listed, throws
 * `UnexpectedCallError` (`unexpected_call`) naming both. The script then stays where it was, so the
 * test sees the failure rather than a shifted script. `assertComplete()` throws `ScriptIncompleteError`
 * (`script_incomplete`) while entries remain.
 *
 * @param {Array<{ request: any, response?: any, error?: any }> | object} script
 * @returns {((request: Uint8Array | string) => Promise<Uint8Array>) & { assertComplete(): void, remaining(): number, calls: object[] }}
 */
export function scriptedDispatch(script) {
  const list = (Array.isArray(script) ? script : script?.schema === HISTORY_SCHEMA ? historyScript(script) : null);
  if (list === null) throw new TestSetupError('a script is an array of entries or a prism/history/1', { check: 'testing.script' });
  const entries = list.map(entryOf);
  const calls = [];
  let position = 0;

  const dispatch = async (input) => {
    const received = toBytes(input, 'a dispatched request');
    const index = calls.length;
    const expected = entries[position];
    if (expected === undefined) {
      throw new UnexpectedCallError(`dispatch ${index} was not expected: the script lists ${entries.length} and all have happened; received ${show(received)}`, {
        check: 'testing.unexpected_call',
        details: { index, expected: null, received: decoder.decode(received) },
      });
    }
    const matches = typeof expected.request === 'function' ? expected.request(received) === true : same(expected.request, received);
    if (!matches) {
      throw new UnexpectedCallError(`dispatch ${index} was not expected: the script lists ${describe(expected)}; received ${show(received)}`, {
        check: 'testing.unexpected_call',
        details: { index, expected: typeof expected.request === 'function' ? 'matcher' : decoder.decode(expected.request), received: decoder.decode(received) },
      });
    }
    position++;
    calls.push({ request: received });
    if (expected.error !== undefined) {
      throw expected.error instanceof Error ? expected.error : new PrismCodeError(expected.error, `scripted failure ${expected.error}`);
    }
    return typeof expected.response === 'function' ? toBytes(await expected.response(received), 'a response function result') : expected.response;
  };

  return Object.assign(dispatch, {
    /** Throws `ScriptIncompleteError` while listed calls have not happened. */
    assertComplete() {
      if (position === entries.length) return;
      const left = entries.slice(position);
      throw new ScriptIncompleteError(`${left.length} of ${entries.length} scripted calls never happened; next was ${describe(left[0])}`, {
        check: 'testing.script_incomplete',
        details: { remaining: left.length, next: describe(left[0]) },
      });
    },
    remaining: () => entries.length - position,
    calls,
  });
}
