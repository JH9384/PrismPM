/**
 * Runtimes that are wrong on purpose. Not a test file. The first argument names
 * the way this one is wrong:
 *
 * - A broken runtime does not answer properly: crash, garbage, hang, wrong-contract.
 * - A lazy runtime answers one thing to everything: always-ok, always-refuse, unsupported.
 * - A lying runtime runs the real JavaScript shim and changes one fact in its answer.
 *
 * A suite that accepts any of these is measuring nothing, so the tests hold every
 * lie to a named check.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REAL_SHIM = fileURLToPath(new URL('../../../prism-code/conformance/shim.mjs', import.meta.url));
const mode = process.argv[2];
const DESCRIBE = { contract: 'prism/conformance-shim/1', runtime: 'fake', name: 'fake', version: '0.0.0', revisions: [] };

const send = (value) => process.stdout.write(JSON.stringify(value));

const LIES = {
  /** Grants every capability a query asks about: deny by default is gone. */
  'allow-everything': (op, answer) => {
    if (op === 'capabilities' && answer.ok) answer.result.answers = answer.result.answers.map(() => true);
  },
  /** Ignores deny entries: answers as though only the allow list existed. */
  'deny-does-not-win': (op, answer, request) => {
    if (op !== 'capabilities' || !answer.ok) return;
    const set = request.input.capabilities?.sets?.[request.input.capabilitySet ?? 'default'] ?? {};
    answer.result.answers = (request.input.queries ?? []).map(({ kind, resource }) => (set[`allow-${kind}`] ?? []).some((entry) => entry === '*' || entry === resource || entry.includes('*')) || answer.result.answers[0]);
  },
  /** Reports the level the holo would like to have. */
  'inflate-level': (op, answer) => {
    if (op === 'verify' && answer.ok) answer.result.level = 'P3';
  },
  /** Reports a passed verdict whatever the checks found. */
  'always-passed': (op, answer) => {
    if (op === 'verify' && answer.ok) answer.result.passed = true;
  },
  /** Drops the integrity reasons, so damage goes unnoticed. */
  'hide-integrity': (op, answer) => {
    if (op === 'verify' && answer.ok) answer.result.reasons = answer.result.reasons.filter((reason) => reason.check !== 'holo.integrity');
  },
  /** A verdict with a member the schema does not have, which no scenario asks about by name. */
  'verdict-off-schema': (op, answer) => {
    if (op === 'verify' && answer.ok) answer.result.extra = true;
  },
  /** Says the identities verified when they did not. */
  'hide-damage-on-load': (op, answer) => {
    if (op === 'load' && answer.ok) answer.result.verified = true;
  },
  /** Reports only the BLAKE3 of the archive. */
  'one-digest-only': (op, answer) => {
    if (op === 'inspect' && answer.ok) delete answer.result.digest.sha256;
  },
  /** Says the footer verified when it did not. */
  'hide-damage-on-inspect': (op, answer) => {
    if (op === 'inspect' && answer.ok) answer.result.verification.footer = true;
  },
  /** One wrong byte in every guest answer. */
  'wrong-byte': (op, answer) => {
    if (op !== 'dispatch' || !answer.ok) return;
    for (const response of answer.result.responses) if (response.hex) response.hex = `${response.hex.slice(0, -2)}00`;
  },
  /** Answers the vectors the holo holds by replaying them, while dispatch is wrong. */
  'acceptance-only': (op, answer) => {
    if (op === 'dispatch' && answer.ok) answer.result.responses = answer.result.responses.map(() => ({ hex: '00' }));
  },
  /** Every error is one generic error, so nothing can branch on it. */
  'untyped-errors': (_op, answer) => {
    if (!answer.ok && answer.error) answer.error = { code: 'error' };
  },
  /** Refuses nothing at load that it can open: a bad version is accepted. */
  'accept-bad-version': (op, answer) => {
    if (op === 'load' && answer.error?.code === 'archive.version') {
      answer.ok = true;
      answer.result = { kind: 'holo' };
      delete answer.error;
    }
  },
};

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const text = Buffer.concat(chunks).toString('utf8');
const request = JSON.parse(text);

if (mode === 'wrong-contract' && request.op === 'describe') {
  send({ ok: true, result: { ...DESCRIBE, contract: 'prism/conformance-shim/0' } });
} else if (request.op === 'describe' && !LIES[mode]) {
  send({ ok: true, result: DESCRIBE });
} else if (mode === 'crash') {
  process.stderr.write('boom\n');
  process.exit(3);
} else if (mode === 'garbage') {
  process.stdout.write('not json');
} else if (mode === 'no-code') {
  send({ ok: false, error: {} });
} else if (mode === 'hang') {
  await new Promise(() => setInterval(() => {}, 1000));
} else if (mode === 'always-ok') {
  send({ ok: true, result: {} });
} else if (mode === 'always-refuse') {
  send({ ok: false, error: { code: 'nope' } });
} else if (mode === 'unsupported') {
  send({ ok: false, unsupported: 'this runtime has not got that far' });
} else if (LIES[mode]) {
  const real = spawnSync(process.execPath, [REAL_SHIM], { input: text, encoding: 'utf8', env: process.env, maxBuffer: 64 * 1024 * 1024 });
  const answer = JSON.parse(real.stdout);
  if (request.op !== 'describe') LIES[mode](request.op, answer, request);
  send(answer);
} else {
  process.stderr.write(`unknown mode ${mode}\n`);
  process.exit(9);
}
