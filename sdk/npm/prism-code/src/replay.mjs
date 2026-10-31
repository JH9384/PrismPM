/**
 * Histories and replay (issue #284, docs/proposals/284-histories-replay.md).
 *
 * A history, `prism/history/1`, is the dispatches of one application in order,
 * each with its recorded outcome. Acceptance vectors are its first source: a
 * vector is an event with a response. Replay re-executes every event against a
 * build and compares outcomes byte for byte. A difference is a
 * `DeterminismViolationError` (`replay.divergence`); a replay that cannot be
 * carried out is a `ReplayError`. Either way nothing is decoded, so the same
 * code replays any profile.
 *
 * A replay of a holo also produces a `prism/replay/v1` statement about its
 * guest. The statement holds no clock, so the same replay writes the same
 * bytes, and signing it is a separate step (`prism-code attest`).
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { asBytes, canonicalJson, resolveArchive } from './archive.mjs';
import { STATEMENT_TYPE } from './attestations.mjs';
import { blake3Hex } from './blake3.mjs';
import { DeterminismViolationError, ReplayError } from './errors.mjs';
import { sha256Hex } from './sha256.mjs';
import { VERSION } from './version.mjs';

export const HISTORY_SCHEMA = 'prism/history/1';
export const REPLAY_PREDICATE_TYPE = 'https://uor.foundation/prism/replay/v1';
/** The registered diagnostic of `replay.divergence`. */
export const DIVERGENCE_CODE = 'PP5701';

const HEX = /^(?:[0-9a-f]{2})*$/;
const HEX64 = /^[0-9a-f]{64}$/;
const ERROR_CODE = /^[a-z][a-z0-9-]*(?:\.[a-z0-9-]+)+$/;
const TRAP = 'core.trap';

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

function invalid(message) {
  return new ReplayError(`the history is not ${HISTORY_SCHEMA}: ${message}`, { check: 'replay.history' });
}

function toHex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function onlyMembers(value, allowed, where) {
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown !== undefined) throw invalid(`${where} has the unknown member ${unknown}`);
}

function digestSet(value, where) {
  if (!isObject(value)) throw invalid(`${where} is not a digest set`);
  onlyMembers(value, ['blake3', 'sha256'], where);
  for (const key of ['blake3', 'sha256']) {
    if (typeof value[key] !== 'string' || !HEX64.test(value[key])) throw invalid(`${where}.${key} is not 64 lowercase hex characters`);
  }
  return { blake3: value.blake3, sha256: value.sha256 };
}

function hexField(value, where) {
  if (typeof value !== 'string' || !HEX.test(value)) throw invalid(`${where} is not lowercase hex`);
  return value;
}

function eventOf(value, index) {
  const where = `events[${index}]`;
  if (!isObject(value)) throw invalid(`${where} is not an object`);
  const request = hexField(value.request, `${where}.request`);
  const hasResponse = Object.hasOwn(value, 'response');
  const hasError = Object.hasOwn(value, 'error');
  if (hasResponse === hasError) throw invalid(`${where} must hold exactly one of response and error`);
  if (hasResponse) {
    onlyMembers(value, ['request', 'response'], where);
    return { request, response: hexField(value.response, `${where}.response`) };
  }
  onlyMembers(value, ['request', 'error'], where);
  if (typeof value.error !== 'string' || !ERROR_CODE.test(value.error)) throw invalid(`${where}.error is not a stable error code`);
  return { request, error: value.error };
}

/**
 * Read a history from text, UTF-8 bytes or a parsed value. Rejects with a
 * `ReplayError` (`replay.history`) for anything the schema rejects, and returns
 * the history with its members in a fixed order.
 *
 * @param {string | Uint8Array | ArrayBuffer | object} source
 */
export function parseHistory(source) {
  let value = source;
  if (source instanceof Uint8Array || source instanceof ArrayBuffer || ArrayBuffer.isView(source)) {
    try {
      value = decoder.decode(asBytes(source));
    } catch {
      throw invalid('it is not UTF-8');
    }
  }
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch (error) {
      throw invalid(`it is not JSON: ${error.message}`);
    }
  }
  if (!isObject(value)) throw invalid('it is not a JSON object');
  onlyMembers(value, ['schema', 'application', 'recordedFrom', 'events'], 'the history');
  if (value.schema !== HISTORY_SCHEMA) throw invalid(`schema is ${JSON.stringify(value.schema)}`);
  if (!Object.hasOwn(value, 'application')) throw invalid('application is missing');
  if (value.application !== null && (typeof value.application !== 'string' || value.application === '')) throw invalid('application must be a name or null');
  if (!Array.isArray(value.events) || value.events.length === 0) throw invalid('events must hold at least one event');
  const history = { schema: HISTORY_SCHEMA, application: value.application };
  if (Object.hasOwn(value, 'recordedFrom')) {
    if (!isObject(value.recordedFrom)) throw invalid('recordedFrom is not an object');
    onlyMembers(value.recordedFrom, ['guest', 'model'], 'recordedFrom');
    history.recordedFrom = { guest: digestSet(value.recordedFrom.guest, 'recordedFrom.guest'), model: digestSet(value.recordedFrom.model, 'recordedFrom.model') };
  }
  history.events = value.events.map(eventOf);
  return history;
}

/** The bytes both digests of a history cover: its canonical JSON, with no trailing newline. */
export function historyBytes(history) {
  return encoder.encode(canonicalJson(parseHistory(history)));
}

async function digestsOf(bytes) {
  return { blake3: blake3Hex(bytes), sha256: await sha256Hex(bytes) };
}

/** Both digests of a history, as `prism/replay/v1` names it (ADR-015). */
export function historyDigest(history) {
  return digestsOf(historyBytes(history));
}

/** A history as a file: canonical JSON and one LF. */
export function historyJson(history) {
  return `${canonicalJson(parseHistory(history))}\n`;
}

/** The guest and model blobs of an opened holo with both digests of their bytes, or null for a closure. */
async function buildOf(app) {
  if (app.kind !== 'holo') return null;
  const { guest, model } = resolveArchive(app.archive);
  return { guest: await digestsOf(guest.content), model: await digestsOf(model.content) };
}

/** The stable code of a failed dispatch. A `PrismError` names its own; a guest trap has no stable message, so it has one code. */
function errorCodeOf(error) {
  return typeof error?.code === 'string' && ERROR_CODE.test(error.code) ? error.code : TRAP;
}

async function historyFrom(app, events) {
  if (events.length === 0) throw new ReplayError('a history needs at least one event, and none was recorded', { check: 'replay.history' });
  const build = await buildOf(app);
  return parseHistory({ schema: HISTORY_SCHEMA, application: app.name ?? null, ...(build ? { recordedFrom: build } : {}), events });
}

/**
 * The acceptance vectors of an application as a history, its first history.
 * Rejects with `replay.history` when it carries none.
 */
export function acceptanceHistory(app) {
  return historyFrom(
    app,
    app.vectors.map((vector) => ({ request: toHex(vector.request), response: toHex(vector.response) })),
  );
}

/**
 * Record dispatches as they run. `dispatch` behaves as `app.dispatch` does, a
 * refusal included; `history()` resolves to what has finished, in call order.
 *
 * @returns {{ dispatch(request: Uint8Array | ArrayBuffer): Promise<Uint8Array>, history(): Promise<object>, events(): number }}
 */
export function experimental_recorder(app) {
  const slots = [];
  const finished = () => slots.filter((event) => event !== null);
  return Object.freeze({
    dispatch: async (request) => {
      const bytes = asBytes(request);
      const hex = toHex(bytes);
      const slot = slots.push(null) - 1;
      try {
        const response = await app.dispatch(bytes);
        slots[slot] = { request: hex, response: toHex(response) };
        return response;
      } catch (error) {
        slots[slot] = { request: hex, error: errorCodeOf(error) };
        throw error;
      }
    },
    history: () => historyFrom(app, finished()),
    events: () => finished().length,
  });
}

/** Run one event and compare its outcome with the recording. Returns the divergence, or null. */
async function replayEvent(app, event, index) {
  const expected = event.error === undefined ? { response: event.response } : { error: event.error };
  let actual;
  try {
    actual = { response: toHex(await app.dispatch(fromHex(event.request))) };
  } catch (error) {
    actual = { error: errorCodeOf(error) };
  }
  if (actual.response === expected.response && actual.error === expected.error) return null;
  return { index, request: event.request, expected, actual };
}

function fromHex(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * The `prism/replay/v1` statement of a replay (docs/proposals/284-histories-replay.md).
 * Its one subject is the guest blob, named `guest` as `prism-code attest` names it.
 */
function statementOf(build, histories, runtime) {
  return {
    _type: STATEMENT_TYPE,
    subject: [{ name: 'guest', digest: build.guest }],
    predicateType: REPLAY_PREDICATE_TYPE,
    predicate: {
      runtime,
      model: build.model,
      histories: histories.map(({ digest, events, divergences }) => ({ digest, events, divergences: divergences.length })),
      divergenceCount: histories.reduce((sum, h) => sum + h.divergences.length, 0),
    },
  };
}

/** Bytes as a person reads them: the text when they are UTF-8, otherwise `0x` and hex. */
export function displayBytes(hex) {
  try {
    return JSON.stringify(decoder.decode(fromHex(hex)));
  } catch {
    return `0x${hex}`;
  }
}

/** A recorded or replayed outcome as a person reads it. */
export function displayOutcome(outcome) {
  return outcome.error === undefined ? displayBytes(outcome.response) : `error ${outcome.error}`;
}

/**
 * Re-execute histories against an opened application. Every event of every
 * history runs, so one replay reports every divergence and the statement
 * counts them all.
 *
 * Resolves to the result when nothing diverged. On a divergence it rejects with
 * `DeterminismViolationError` (`replay.divergence`), whose `details` is the
 * result, statement included; with `throw: false` it resolves to the result
 * instead. A history that does not parse, a repeated history and an archive
 * that fails its own integrity checks reject with `ReplayError`, always.
 *
 * @param {object} app an application from `load`
 * @param {string | Uint8Array | object | Array<string | Uint8Array | object>} histories
 * @param {{ throw?: boolean, runtime?: { name: string, version: string } }} [options]
 */
export async function experimental_replay(app, histories, options = {}) {
  const unknown = Object.keys(options ?? {}).find((key) => !['throw', 'runtime'].includes(key));
  if (unknown !== undefined) throw new ReplayError(`unknown replay option ${unknown}; expected throw, runtime`, { check: 'replay.options' });
  const { throw: throwOnDivergence = true, runtime = { name: 'prism-code', version: VERSION } } = options ?? {};
  const list = Array.isArray(histories) ? histories : [histories];
  if (list.length === 0) throw new ReplayError('replay takes at least one history', { check: 'replay.history' });
  if (!app.identities?.verified) throw new ReplayError('the archive fails its own integrity checks; a replay of it would prove nothing', { check: 'replay.holo' });
  const parsed = list.map(parseHistory);
  const digests = await Promise.all(parsed.map(historyDigest));
  if (new Set(digests.map((d) => d.blake3)).size !== digests.length) throw new ReplayError('the same history was given twice; the statement names each one once', { check: 'replay.history' });

  const replayed = [];
  for (const [position, history] of parsed.entries()) {
    const divergences = [];
    for (const [index, event] of history.events.entries()) {
      const divergence = await replayEvent(app, event, index);
      if (divergence) divergences.push(divergence);
    }
    replayed.push({ digest: digests[position], application: history.application, events: history.events.length, divergences });
  }
  const build = await buildOf(app);
  const divergenceCount = replayed.reduce((sum, h) => sum + h.divergences.length, 0);
  const result = {
    application: app.name ?? null,
    runtime,
    events: replayed.reduce((sum, h) => sum + h.events, 0),
    divergenceCount,
    histories: replayed,
    // A closure has no guest blob to name, so it has no statement.
    statement: build ? statementOf(build, replayed, runtime) : null,
  };
  if (divergenceCount > 0 && throwOnDivergence) {
    const first = replayed.flatMap((h) => h.divergences)[0];
    throw new DeterminismViolationError(
      `the replay diverged from its history on ${divergenceCount} of ${result.events} events; first at event ${first.index}: recorded ${displayOutcome(first.expected)}, replayed ${displayOutcome(first.actual)}`,
      { check: 'replay.divergence', diagnostic: DIVERGENCE_CODE, details: result },
    );
  }
  return result;
}
