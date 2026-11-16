/**
 * A rule app with no build: one fixed, verified holo that carries a rule judge,
 * and the spec written as the numbers that judge reads, named together.
 *
 * The holo is the Forge kernel from UOR-Foundation/foundry
 * (`studio/shell/kernel/kernel.holo`), built and verified once by the SDK. Its
 * rule judge (foundry `app/src/RuleJudge.lex.tex`) answers a request made of
 * the spec's numbers followed by the request's values. Nothing is compiled for
 * an app, so no Docker, Rust or Lean runs here.
 *
 * What is admitted and what a request is answered with are stated in LexLean
 * and proved by Lean (`model/rule-app/src/RuleApp.lex.tex` and its proofs).
 * `admits`, `kernelChecked`, `leastAt`, `greatestAt`, `rulesAt` and
 * `answerKind` below are those definitions, and a test evaluates the model's
 * own text beside them, so the two cannot drift apart unnoticed.
 *
 * Two things differ from a built holo, and the record says both:
 * every rule app runs the same holo, so the record's address names the app,
 * not the holo's; and the text of a request is read here, outside the guest,
 * so refusing malformed text is tested by vectors, not carried by the guest.
 */
import { createHash } from 'node:crypto';
import { loadArchive } from '../index.mjs';
import { acceptanceVectors } from './render.mjs';
import { INVALID, decodeRequest, requestLimits } from './spec.mjs';
import { KernelUnread, WORD_MAX, boundedSpec, ruleWords } from './kernel-prove.mjs';
import { readKernelFile } from './kernel-store.mjs';

export const RULE_APP_SCHEMA = 'prism/rule-app/1';
/** The rule judge's holo this package carries. A record names the holo it was made for by this address. */
export const RULE_JUDGE_HOLO = 'sha256:e775324ea3abf203d3f7cb0b5a31e2c6c2328d751fdddf5fa1c46aae4e0d8cee';
/** The judge reads at most this many numbers in one request: the spec's and the request's together. */
const WORDS_MAX = 1024;
const KEYS = Object.freeze(['schema', 'name', 'title', 'kernel', 'fields', 'outcomes', 'words', 'guarantees', 'vectors', 'proof']);

const sha256 = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const hexWord = (n) => [0, 8, 16, 24].map((k) => ((n >>> k) & 255).toString(16).padStart(2, '0')).join('');
const readWord = (hex) => parseInt(hex.match(/../g).reverse().join(''), 16);
const hexOf = (bytes) => Buffer.from(bytes).toString('hex');

/** A record that is not a rule app, or not this one. `code` names why. */
export class RuleAppRefused extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RuleAppRefused';
    this.code = code;
  }
}

// ---- The model's definitions (RuleApp.lex.tex), one for one. ----

/** The schema the model admits: `prism/rule-app/1`. */
export const SCHEMA_ONE = 1;
export const leastAt = (field) => 2 + (field + field);
export const greatestAt = (field) => 3 + (field + field);
export const rulesAt = (fields) => 4 + (fields + fields);
const holoAdmitted = (r) => r.holoNamed === r.holoPinned && r.holoVerified === 1 && r.holoVectorsFailed === 0;
const numbersAdmitted = (r) => r.fieldsStated === r.fields && r.boundsAgree === 1 && r.words + r.fields <= WORDS_MAX;
const proofAdmitted = (r) => r.hasProof === 0 || (r.hasProof === 1 && r.proofStatement === r.recordStatement);
/** Whether a record with these facts is this app, on this holo. */
export const admits = (r) => r.schema === SCHEMA_ONE && holoAdmitted(r) && numbersAdmitted(r) && proofAdmitted(r);
/** Whether its guarantees were accepted by Lean's kernel for exactly its numbers. */
export const kernelChecked = (r) => admits(r) && r.hasProof === 1;
export const ANSWER = Object.freeze({ outcome: 0, invalid: 1, fault: 2 });
/** What a request is answered with: an outcome needs a well-formed request, in bounds, and the judge's answer. */
export const answerKind = (wellFormed, inBounds, judgeAnswered) => (wellFormed !== 1 ? ANSWER.invalid : inBounds !== 1 ? ANSWER.invalid : judgeAnswered === 1 ? ANSWER.outcome : ANSWER.fault);

/** The statement a kernel check speaks about: the same address kernel-prove.mjs gives its evidence. */
export const statementOf = (words, guarantees) => sha256(JSON.stringify(['prism/kernel-statement/1', words, guarantees]));

/** The pinned rule judge's holo, checked against its address. */
export function pinnedHolo({ read = () => readKernelFile('kernel.holo') } = {}) {
  const bytes = new Uint8Array(read());
  if (sha256(bytes) !== RULE_JUDGE_HOLO) throw new RuleAppRefused('rule-app.holo', "the rule judge's holo is not the pinned one");
  return bytes;
}

/**
 * The record of a rule app: a pure function of the spec and the proof's
 * evidence, so the same spec gives the same bytes on every machine.
 * Throws `KernelUnread` for a spec the rule judge does not read.
 */
export function ruleAppRecord(spec, { proof = null } = {}) {
  const { words, guarantees } = ruleWords(spec);
  if (words.length + spec.fields.length > WORDS_MAX) throw new KernelUnread('kernel.range', `it needs more than the ${WORDS_MAX} numbers the rule judge reads in one request`);
  const record = {
    schema: RULE_APP_SCHEMA,
    name: spec.name,
    title: spec.title,
    kernel: { holo: RULE_JUDGE_HOLO },
    fields: spec.fields.map((f) => (f.kind === 'choice' ? { name: f.name, kind: 'choice', values: [...f.values] } : { name: f.name, kind: 'number', min: f.min ?? 0, max: f.max ?? WORD_MAX })),
    outcomes: [...new Set([spec.otherwise, ...spec.rules.map((r) => r.then)])],
    words,
    guarantees,
    // The vectors are the bounded app's: a number past the judge's words is refused, and a vector says so.
    vectors: acceptanceVectors(boundedSpec(spec)).map((v) => ({ request: hexOf(v.bytes), response: hexOf(new TextEncoder().encode(v.response)) })),
    proof,
  };
  const bytes = new TextEncoder().encode(`${JSON.stringify(record, null, 1)}\n`);
  return { record, bytes, address: sha256(bytes) };
}

function readRecord(bytes) {
  let record;
  try {
    record = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    throw new RuleAppRefused('rule-app.malformed', 'the record is not JSON');
  }
  const isList = Array.isArray;
  const whole = (n) => Number.isInteger(n) && n >= 0 && n <= 0xffffffff;
  // Only the shape is decided here. Whether the record is admitted is `admits`, on the facts below.
  const shaped = record !== null && typeof record === 'object' && !isList(record)
    && JSON.stringify(Object.keys(record)) === JSON.stringify(KEYS)
    && typeof record.schema === 'string'
    && typeof record.kernel?.holo === 'string'
    && isList(record.fields) && record.fields.every((f) => typeof f?.name === 'string' && (f.kind === 'choice' ? isList(f.values) && f.values.every((v) => typeof v === 'string') : f.kind === 'number' && whole(f.min) && whole(f.max)))
    && isList(record.outcomes) && record.outcomes.every((o) => typeof o === 'string')
    && isList(record.words) && record.words.every(whole)
    && isList(record.guarantees)
    && isList(record.vectors) && record.vectors.every((v) => /^([0-9a-f]{2})*$/.test(v?.request ?? 'x') && /^([0-9a-f]{2})*$/.test(v?.response ?? 'x'))
    && (record.proof === null || typeof record.proof?.statement === 'string');
  if (!shaped) throw new RuleAppRefused('rule-app.malformed', 'the record does not have the shape of a rule app');
  return record;
}

/** The facts the model decides admission on, read from the record and from the holo it is given. */
async function factsOf(record, holo) {
  let kernel = null;
  let verified = 0;
  let failed = 1;
  try {
    kernel = await loadArchive(holo, {});
    verified = kernel.identities?.verified === true ? 1 : 0;
    failed = (await kernel.acceptance()).failed.length;
  } catch {
    // A holo that does not load is not verified; the facts say so and `admits` refuses it.
    kernel = null;
  }
  const fields = record.fields.length;
  // Each field's bounds, where the judge reads them: a record whose bounds and numbers disagree would decode one app and judge another.
  const boundsAgree = record.fields.every((f, i) => record.words[leastAt(i)] === (f.kind === 'choice' ? 0 : f.min) && record.words[greatestAt(i)] === (f.kind === 'choice' ? f.values.length - 1 : f.max)) && rulesAt(fields) <= record.words.length ? 1 : 0;
  const facts = {
    schema: record.schema === RULE_APP_SCHEMA ? SCHEMA_ONE : 0,
    holoNamed: record.kernel.holo,
    holoPinned: sha256(holo),
    holoVerified: verified,
    holoVectorsFailed: failed,
    fields,
    fieldsStated: record.words[1],
    boundsAgree,
    words: record.words.length,
    hasProof: record.proof === null ? 0 : 1,
    proofStatement: record.proof === null ? '' : record.proof.statement,
    recordStatement: statementOf(record.words, record.guarantees),
  };
  return { facts, kernel };
}

/** Why `admits` refused these facts, for a message. The decision itself is `admits`. */
function refusalOf(r) {
  if (r.schema !== SCHEMA_ONE) return ['rule-app.malformed', `the record is not a ${RULE_APP_SCHEMA}`];
  if (r.holoNamed !== r.holoPinned) return ['rule-app.holo', `the record names the rule judge ${r.holoNamed}, and this is another holo`];
  if (r.holoVerified !== 1) return ['rule-app.holo', "the rule judge's holo does not verify"];
  if (r.holoVectorsFailed !== 0) return ['rule-app.holo', `the rule judge fails ${r.holoVectorsFailed} of its own acceptance vectors`];
  if (r.fieldsStated !== r.fields || r.boundsAgree !== 1 || r.words + r.fields > WORDS_MAX) return ['rule-app.fields', "the record's fields are not the ones its numbers state"];
  return ['rule-app.proof', "the record's proof is about another statement"];
}

/**
 * Load a rule app from its record. It answers only when the model admits it:
 * the holo is the one the record names, verifies and passes its own vectors,
 * the fields are the ones the numbers state, and a proof is about exactly
 * these numbers. Resolves `{ record, address, facts, kernelChecked, dispatch, acceptance }`.
 */
export async function loadRuleApp(recordBytes, { holo = null } = {}) {
  const bytes = new Uint8Array(recordBytes);
  const record = readRecord(bytes);
  holo ??= pinnedHolo();
  const { facts, kernel } = await factsOf(record, holo);
  if (!admits(facts)) throw new RuleAppRefused(...refusalOf(facts));
  const shape = { fields: record.fields };
  const prefix = `rule ${record.words.map(hexWord).join('')}`;
  const enc = new TextEncoder();
  const dec = new TextDecoder();
  const { requestMaximum } = requestLimits(shape);

  /** Bytes in, bytes out, as a built text app answers: the outcome's word, or `invalid`. */
  async function dispatch(request) {
    const input = new Uint8Array(request);
    let decoded = null;
    if (input.length <= requestMaximum) {
      try {
        // `decodeRequest` refuses text that is malformed and values outside the bounds alike.
        decoded = decodeRequest(shape, new TextDecoder('utf-8', { fatal: true }).decode(input));
      } catch {
        decoded = null;
      }
    }
    const read = decoded ? 1 : 0;
    let outcome;
    let reply = '';
    if (read === 1) {
      const values = record.fields.map((f) => (f.kind === 'choice' ? f.values.indexOf(decoded[f.name]) : Number(decoded[f.name])));
      reply = dec.decode(await kernel.dispatch(enc.encode(prefix + values.map(hexWord).join(''))));
      outcome = /^ok [0-9a-f]{24}$/.test(reply) ? record.outcomes[readWord(reply.slice(11, 19))] : undefined;
    }
    const kind = answerKind(read, read, outcome === undefined ? 0 : 1);
    if (kind === ANSWER.invalid) return enc.encode(INVALID);
    // The judge and this reader disagreeing is a fault, never an answer.
    if (kind === ANSWER.fault) throw new RuleAppRefused('rule-app.judge', `the rule judge answered \`${reply.slice(0, 40)}\` to a request inside the bounds`);
    return enc.encode(outcome);
  }

  /** Replay the record's vectors through the judge. */
  async function acceptance() {
    const failed = [];
    for (const [index, v] of record.vectors.entries()) {
      let got;
      try {
        got = hexOf(await dispatch(Buffer.from(v.request, 'hex')));
      } catch (error) {
        got = `fault: ${error.message}`;
      }
      if (got !== v.response) failed.push({ index, request: v.request, expected: v.response, got });
    }
    return { total: record.vectors.length, passed: record.vectors.length - failed.length, failed };
  }

  return { record, address: sha256(bytes), facts, kernelChecked: kernelChecked(facts), dispatch, acceptance };
}
