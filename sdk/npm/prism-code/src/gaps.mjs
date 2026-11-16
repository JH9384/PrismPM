/**
 * Gap telemetry: what a user needed that Prism or LexLean could not do, kept
 * as a fingerprint so it can be counted without anything the user wrote.
 *
 * Three points record a gap, none by judgment: a spec refused by validation
 * (which rule refused it), a spec that does not survive its own answers (a
 * Prism bug), and a property Lean did not prove where no sampled request
 * breaks it (a prover or model gap), or a model the toolchain refused. Each
 * gap is appended to `$PRISM_HOME/gaps.jsonl` and delivered in the `_meta` of
 * the next call prism-code already makes to the hosted verifier (hosted.mjs):
 * no endpoint, no request and no process of its own.
 *
 * A fingerprint is a closed record: its kind, a construct from a fixed
 * vocabulary, a diagnostic code and the prism-code version. `fingerprint`
 * drops anything else, and is applied when a gap is recorded and again when
 * it is sent, so nothing written to the ledger by anyone else can leave the
 * machine either. A batch adds a random install ID, so gaps can be counted by
 * how many people hit them; it is drawn once and derived from nothing.
 *
 * `PRISM_TELEMETRY=0` or `DO_NOT_TRACK=1` turns it off: nothing is recorded
 * and nothing is sent.
 */
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { prismHome } from './agents.mjs';
import { VERSION } from './version.mjs';
import { REFUSALS } from './journey/spec.mjs';
import { SPEC_FILE_REFUSALS } from './journey/spec-file.mjs';
import { STATEFUL_REFUSALS } from './journey/stateful.mjs';
import { ROUND_TRIP_PARTS, STEPS } from './journey/session.mjs';

export const GAPS_SCHEMA = 'prism/gaps/1';
/** The `_meta` key a batch travels under: namespaced, as MCP asks of `_meta` keys. */
export const GAPS_META_KEY = 'foundation.uor/prism-gaps';
export const GAP_KINDS = Object.freeze(['refusal', 'roundtrip', 'unproved', 'model-refused']);
/** The steps of the SDK run whose failure on a generated model is Prism's. */
export const MODEL_STEPS = Object.freeze(['prelock', 'format', 'lock', 'check', 'verify', 'build', 'run']);
/** At most this many ledger lines go in one batch; the rest go with the next call. */
export const BATCH_LINES = 256;

/** A LexLean (`LLV7002`, `LLC...`) or SDK (`PP2014`) diagnostic code: a prefix and four digits. */
const CODE = /^(?:LL[A-Z]|PP)[0-9]{4}$/;
const VERSION_TEXT = /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)\.\d{1,4})?$/;
const SHAPES = new Set([
  'choice-is',
  'choice-is-not',
  ...['lt', 'le', 'gt', 'ge', 'eq', 'ne'].flatMap((op) => [`number-${op}-const`, `number-${op}-field`]),
]);
const OP_NAMES = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '=': 'eq', '!=': 'ne' };

/** Whether gaps are recorded and sent: on unless `PRISM_TELEMETRY` is off or `DO_NOT_TRACK` is set. */
export function telemetryOn(env = process.env) {
  if (/^(0|off|false|no)$/i.test(String(env.PRISM_TELEMETRY ?? '').trim())) return false;
  const dnt = String(env.DO_NOT_TRACK ?? '').trim();
  return dnt === '' || /^(0|false)$/i.test(dnt);
}

/** The one line `prism-code setup` prints about it. */
export function telemetryNotice(env = process.env) {
  return telemetryOn(env)
    ? 'telemetry: when Prism refuses a spec or Lean cannot prove a property, prism-code tells the hosted verifier which rule or Lean code it was, with a random install ID, on its next request; never your text, names or numbers. PRISM_TELEMETRY=0 turns it off.'
    : 'telemetry: off (PRISM_TELEMETRY=0 or DO_NOT_TRACK=1); nothing is recorded or sent.';
}

/**
 * The shape of a property, from the fixed vocabulary: `always:choice-is+number-le-field`
 * says an `always` property over a choice test and a number compared with a field.
 * The order and the repetitions of the conditions are not kept.
 */
export function propertyShape(property) {
  const shapes = new Set(
    (property.when ?? []).map((c) => {
      if (c.op === 'is') return 'choice-is';
      if (c.op === 'is not') return 'choice-is-not';
      return `number-${OP_NAMES[c.op] ?? 'eq'}-${typeof c.value === 'object' ? 'field' : 'const'}`;
    }),
  );
  return `${property.kind === 'always' ? 'always' : 'never'}:${[...shapes].sort().join('+')}`;
}

const PARTS = new Set([...ROUND_TRIP_PARTS, ...STEPS]);
const REFUSED = new Set([...REFUSALS, ...SPEC_FILE_REFUSALS, ...STATEFUL_REFUSALS]);

/** Whether `construct` belongs to the vocabulary of `kind`. */
function knownConstruct(kind, construct) {
  if (typeof construct !== 'string') return false;
  switch (kind) {
    case 'refusal':
      return REFUSED.has(construct);
    case 'roundtrip': {
      const [part, refusal, ...rest] = construct.split(':');
      return rest.length === 0 && PARTS.has(part) && (refusal === undefined || REFUSED.has(refusal));
    }
    case 'unproved': {
      const m = /^(always|never):(.+)$/.exec(construct);
      return Boolean(m) && m[2].split('+').every((s) => SHAPES.has(s));
    }
    case 'model-refused':
      return MODEL_STEPS.includes(construct);
    default:
      return false;
  }
}

/**
 * The fingerprint of a gap: `{ kind, construct, code, version }`, each from its
 * fixed vocabulary or grammar, or null when any of them is not. No other key
 * survives.
 */
export function fingerprint(gap) {
  if (!gap || typeof gap !== 'object') return null;
  const { kind, construct, code = null, version } = gap;
  if (!GAP_KINDS.includes(kind) || !knownConstruct(kind, construct)) return null;
  if (code !== null && !(typeof code === 'string' && CODE.test(code))) return null;
  if (typeof version !== 'string' || !VERSION_TEXT.test(version)) return null;
  return { kind, construct, code, version };
}

/**
 * The gap ledger under `dir` (`$PRISM_HOME`, default `~/.prism`):
 * `gaps.jsonl`, one fingerprint and its day per line, and `gaps.json`, the
 * install ID and how far the ledger has been sent. Telemetry never fails what
 * the user asked for, so every error here is swallowed.
 */
export function gapLedger({ env = process.env, dir = prismHome(env), now = () => new Date() } = {}) {
  const file = join(dir, 'gaps.jsonl');
  const stateFile = join(dir, 'gaps.json');
  const readState = () => {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'));
      if (/^[0-9a-f]{32}$/.test(state.install) && Number.isSafeInteger(state.sent) && state.sent >= 0) return state;
    } catch {
      // No state yet, or a damaged one: start over with a new install ID.
    }
    return null;
  };
  return {
    file,
    /** Append a gap; returns its fingerprint, or null when it is off, unknown or cannot be written. */
    record(gap) {
      if (!telemetryOn(env)) return null;
      const found = fingerprint({ version: VERSION, ...gap });
      if (!found) return null;
      try {
        mkdirSync(dir, { recursive: true });
        appendFileSync(file, `${JSON.stringify({ ...found, day: now().toISOString().slice(0, 10) })}\n`);
      } catch {
        return null;
      }
      return found;
    },
    /**
     * The gaps not sent yet, counted by fingerprint, as `{ meta, commit }`:
     * `meta` goes in a request's `_meta`, and `commit` marks them sent once the
     * request was answered. Null when there is nothing to send.
     */
    pending() {
      if (!telemetryOn(env)) return null;
      let bytes;
      try {
        bytes = readFileSync(file);
      } catch {
        return null;
      }
      const state = readState() ?? { install: randomBytes(16).toString('hex'), sent: 0 };
      // A ledger shorter than what was sent was replaced: send it from its start.
      const from = state.sent <= bytes.length ? state.sent : 0;
      const counts = new Map();
      let end = from;
      for (let lines = 0; lines < BATCH_LINES; lines++) {
        const newline = bytes.indexOf(10, end);
        if (newline < 0) break;
        let found = null;
        try {
          found = fingerprint(JSON.parse(bytes.subarray(end, newline).toString('utf8')));
        } catch {
          found = null;
        }
        end = newline + 1;
        if (!found) continue;
        const key = JSON.stringify(found);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (end === from) return null;
      const gaps = [...counts].map(([key, count]) => ({ ...JSON.parse(key), count }));
      return {
        meta: gaps.length ? { schema: GAPS_SCHEMA, install: state.install, gaps } : null,
        commit() {
          try {
            writeFileSync(stateFile, `${JSON.stringify({ install: state.install, sent: end })}\n`);
          } catch {
            // Not marked sent: it goes again with the next call.
          }
        },
      };
    },
  };
}
