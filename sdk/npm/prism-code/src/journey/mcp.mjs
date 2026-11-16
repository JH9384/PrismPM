/**
 * `prism-code mcp`: the Prism MCP server, over stdio, with no dependencies.
 *
 * It owns the whole journey: the greeting, the spec session, the model,
 * the proof and the build. An agent only renders what it returns. Proving
 * and building take minutes, longer than some agents wait for one tool call,
 * so both run as jobs: a call waits up to `wait` seconds, and a later call
 * of the same tool picks the job up where it is.
 *
 * It notices, without asking anyone, what the user needed that Prism could
 * not do: a refused answer or spec, and a spec that does not survive its own
 * answers. They are recorded as fingerprints in the gap ledger (../gaps.mjs),
 * as the engine records a proof that fails for Prism's or Lean's reasons.
 */
import { createInterface } from 'node:readline';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { SpecError, validateSpec } from './spec.mjs';
import { answersFromSpec, nextTurn, roundTrip, STEPS } from './session.mjs';
import { appDir, modelPath, readProjectSpec, readSession, writeSession, writeSpecDocument } from './project.mjs';
import { adoptBuild, askForRepository, build, buildQuietFor, prove, tryRequest } from './engine.mjs';
import { gapLedger } from '../gaps.mjs';
import { SPEC_FILE, parseStrictJson, readSpecFile } from './spec-file.mjs';
import { checkSpec, completeSpec, repairMessage } from './complete.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../../package.json');

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export const INSTRUCTIONS = `Prism builds formally verified apps. For Prism or /prism, call prism_start.
Every app has one input: prism/spec.json, prism/spec/1 or, stateful, prism/spec/2. Translate the user's sentence only: pass prism_spec compact JSON with title, fields, rules and otherwise, plus a property only if stated. Every then and otherwise is an answer, such as approved, never a label. Prism derives the rest and proposes guarantees. The same JSON gives the same model. Ask only what you cannot infer; on an issue, fix the draft.
Show the checked draft, proposed guarantees first: Lean proves them, so the user must agree or strike. Prefer an editable card to multiple choice.
On approval, answer the review yes, then call prism_build.
Never write LexLean; spec.json is the one file you write.
prism_prove and prism_build take minutes: while "running", say so and call again.
Say "proved" only for what Lean proved, "tested" for what acceptance vectors cover.`;

const GREETING = 'Prism turns one sentence into an app whose rules are proved by Lean, not just tested. I will draft the spec for your approval, then prove and build it.';

const CONDITIONS = {
  type: 'array',
  minItems: 1,
  description: 'All must hold. A choice field compares with is or is not and one of its choices; a number field compares with a whole number or another number field, as {"field": "income"}.',
  items: {
    type: 'object',
    properties: {
      field: { type: 'string' },
      op: { type: 'string', enum: ['is', 'is not', '<', '<=', '>', '>=', '=', '!='] },
      value: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }, { type: 'object', properties: { field: { type: 'string' } }, required: ['field'] }] },
    },
    required: ['field', 'op', 'value'],
  },
};

const WHY = { type: 'string', description: 'Why, in a few words, such as "it enforces INV-001".' };

/**
 * The prism/spec/1 shape. A draft needs only what the user said: fields, rules and
 * otherwise, with a title. Prism derives the rest (complete.mjs).
 */
/** What a rule's then and otherwise are. Measured on 2026-11-16: 5 of 6 refused drafts from instructions alone wrote a label such as "task" as every answer. */
const ANSWER = 'The answer itself, a lower-case word such as approved or refer: never a label for it such as result, status or decision. The rules and otherwise give two or more different answers.';

const SPEC_INPUT = {
  type: 'object',
  description: 'A prism/spec/1 spec, or a draft of one: write title, fields, rules and otherwise from what the user said, compactly, and leave out the rest. Prism derives outcomes, purpose and examples, and proposes guarantees from the rules. Omit to read.',
  properties: {
    name: { type: 'string', description: 'Lower case and hyphens, such as loan-approval.' },
    title: { type: 'string' },
    purpose: { type: 'string', description: 'What the app decides, in one sentence. Omit it and Prism writes one from the answers and the fields.' },
    fields: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      description: 'One request is these values in order, separated by spaces.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A lower-case word.' },
          kind: { type: 'string', enum: ['number', 'choice'] },
          values: { type: 'array', items: { type: 'string' }, description: 'For a choice: two to 32 lower-case words.' },
          min: { type: 'integer', minimum: 0 },
          max: { type: 'integer', minimum: 0 },
          means: { type: 'string', description: 'What the field is, with its unit, such as "yearly income, in whole dollars".' },
        },
        required: ['name', 'kind'],
      },
    },
    outcomes: { type: 'array', minItems: 2, items: { type: 'string' }, description: 'Omit it: Prism lists the answers the rules and otherwise give. Lower-case words; invalid is reserved.' },
    meanings: { type: 'object', additionalProperties: { type: 'string' }, description: 'What each answer means, such as {"review": "a person must decide"}.' },
    rules: { type: 'array', minItems: 1, maxItems: 24, description: 'In order; the first that matches decides.', items: { type: 'object', properties: { when: CONDITIONS, then: { type: 'string', description: ANSWER }, why: WHY }, required: ['when', 'then'] } },
    otherwise: { type: 'string', description: `The answer when no rule matches. ${ANSWER}` },
    otherwiseWhy: WHY,
    properties: { type: 'array', description: 'What must never or always happen; each becomes a theorem Lean proves. Write one only when the user stated it. A draft with fewer than three gets guarantees Prism proposes from the rules, each checked against every request and marked as proposed.', items: { type: 'object', properties: { kind: { type: 'string', enum: ['never', 'always'] }, when: CONDITIONS, then: { type: 'string' }, why: { type: 'string', description: 'The harm it prevents, such as "poor credit history predicts default". Ask the user when you cannot tell.' } }, required: ['kind', 'when', 'then'] } },
    limits: { type: 'array', items: { type: 'string' }, description: 'What the app does not decide, and choices the rules make silently, such as "fair credit is treated as good".' },
    examples: { type: 'array', description: 'Requests and their expected answers; each becomes an acceptance vector. Omit it and Prism takes the first request each rule decides.', items: { type: 'object', properties: { request: { type: 'string' }, response: { type: 'string' } }, required: ['request', 'response'] } },
  },
  required: ['fields', 'rules', 'otherwise'],
};

const NAMED_VALUE = (state) => ({
  type: 'object',
  properties: {
    name: { type: 'string', description: 'A lower-case word.' },
    kind: { type: 'string', enum: ['number', 'choice'] },
    values: { type: 'array', items: { type: 'string' }, description: 'For a choice: two to 32 lower-case words.' },
    min: { type: 'integer', minimum: 0 },
    max: { type: 'integer', minimum: 0, ...(state ? { description: 'Required for a number in the state: state is bounded.' } : {}) },
    ...(state ? { start: { anyOf: [{ type: 'string' }, { type: 'integer', minimum: 0 }], description: 'The value at the start; default the min, or the first choice.' } } : {}),
    means: { type: 'string' },
  },
  required: ['name', 'kind'],
});

/** The prism/spec/2 shape: an app that keeps state between the steps of a session. */
const STATEFUL_SPEC_INPUT = {
  type: 'object',
  description: 'A whole prism/spec/2 spec, for an app that keeps state between steps.',
  properties: {
    schema: { type: 'string', enum: ['prism/spec/2'] },
    name: { type: 'string', description: 'Lower case and hyphens.' },
    title: { type: 'string' },
    purpose: { type: 'string', description: 'What the app keeps and does, in one sentence.' },
    state: { type: 'array', minItems: 1, maxItems: 8, description: 'What the app keeps: each a bounded number or a choice, with a start.', items: NAMED_VALUE(true) },
    outcomes: { type: 'array', minItems: 2, items: { type: 'string' }, description: 'Lower-case words; invalid is reserved.' },
    meanings: { type: 'object', additionalProperties: { type: 'string' } },
    actions: {
      type: 'array',
      minItems: 1,
      maxItems: 8,
      description: 'What a user can do. A step is the action name and its inputs, separated by single spaces.',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'A lower-case word.' },
          means: { type: 'string' },
          inputs: { type: 'array', maxItems: 4, items: NAMED_VALUE(false) },
          rules: {
            type: 'array',
            maxItems: 12,
            description: 'In order. The first whose conditions hold (all of them; none means always) and whose changes keep every number within its bounds answers `then` and makes its changes.',
            items: {
              type: 'object',
              properties: {
                when: { ...CONDITIONS, minItems: 0, description: 'Over the state and this action\'s inputs. A choice compares with is or is not; a number with a whole number or another number, as {"field": "seats"}.' },
                then: { type: 'string' },
                change: {
                  type: 'array',
                  description: 'Changes to the state, each read from the state before the step: set a choice or number, add to or subtract from a number, by a whole number or {"field": name}.',
                  items: { type: 'object', properties: { field: { type: 'string' }, op: { type: 'string', enum: ['set', 'add', 'subtract'] }, value: CONDITIONS.items.properties.value }, required: ['field', 'op', 'value'] },
                },
                why: WHY,
              },
              required: ['then'],
            },
          },
          otherwise: { type: 'string', description: 'The answer when no rule applies; the state does not change.' },
          otherwiseWhy: WHY,
        },
        required: ['name', 'rules', 'otherwise'],
      },
    },
    properties: {
      type: 'array',
      description: 'Each becomes theorems Lean proves for every reachable state. Without action: what is always (or never) true of the state. With action and then: that action never (or always) answers then when the conditions hold.',
      items: { type: 'object', properties: { kind: { type: 'string', enum: ['never', 'always'] }, action: { type: 'string' }, when: { ...CONDITIONS, minItems: 0 }, then: { type: 'string' }, why: WHY }, required: ['kind', 'when'] },
    },
    limits: { type: 'array', items: { type: 'string' } },
    examples: { type: 'array', description: 'Sessions from the start: steps and the answer each gives; each becomes acceptance vectors.', items: { type: 'object', properties: { steps: { type: 'array', items: { type: 'string' } }, answers: { type: 'array', items: { type: 'string' } } }, required: ['steps', 'answers'] } },
  },
  required: ['schema', 'purpose', 'state', 'outcomes', 'actions'],
};

export const TOOLS = [
  {
    name: 'prism_start',
    description: 'Start or resume the Prism session in this project. Returns a short greeting, and the next question for when you cannot draft the whole spec with prism_spec. Call it first, and whenever you lose track.',
    inputSchema: { type: 'object', properties: { restart: { type: 'boolean', description: 'Discard the answers so far and start over.' } }, additionalProperties: false },
  },
  {
    name: 'prism_answer',
    description: 'Record the user\'s answer to the current question and get the next one. Pass step to change an earlier answer (purpose, fields, outcomes, rules, properties, examples, review). When the result has an issue, ask the user about it and answer the same step again.',
    inputSchema: {
      type: 'object',
      properties: { answer: { type: 'string', description: 'The answer, in the format the question shows.' }, step: { type: 'string', enum: STEPS, description: 'The step this answers; default the current one.' } },
      required: ['answer'],
      additionalProperties: false,
    },
  },
  {
    name: 'prism_spec',
    description: 'Read the whole spec as JSON, or replace it in one call with a spec you drafted from the user\'s request: prism/spec/1 for an app that decides one answer from one request, prism/spec/2 for an app that keeps state between steps. A prism/spec/1 draft needs only title, fields, rules and otherwise: Prism completes it, the same way every time, with the answers, a purpose, examples and up to three proposed guarantees, and returns `proposed` (their ids) and `notes` (what it dropped). A spec that already holds purpose, outcomes, properties and examples is taken as written and nothing is proposed, so pass the whole spec back to change it. It is checked exactly as answers are: each example against the rules, each property for a counterexample; when one fails, `repair` says what to fix. The result is the review step, with a summary to show the user for approval.',
    inputSchema: { type: 'object', properties: { spec: { anyOf: [SPEC_INPUT, STATEFUL_SPEC_INPUT], description: 'A whole spec. Omit to read.' } }, additionalProperties: false },
  },
  {
    name: 'prism_prove',
    description: 'Check every property. An app that decides one answer from one request, each condition a field against a value, is checked by the Lean kernel in this process in about two seconds: no SDK image, nothing sent, reported as kernel-checked. Any other app, or a guarantee the kernel cannot settle, is proved by Lean in the SDK image on this machine, which takes one to five minutes; PRISM_CODE_TIER=local asks for that always. The hosted verifier at https://mcp.uor.foundation/ is used only when the user sets PRISM_CODE_TIER=hosted, and it stores the files under prism/src/ unlisted, not privately. Returns state running while it works; call again to keep waiting.',
    inputSchema: { type: 'object', properties: { wait: { type: 'number', description: 'Seconds to wait before returning, default 45.' }, overwrite: { type: 'boolean', description: 'Replace a model that was edited by hand.' } }, additionalProperties: false },
  },
  {
    name: 'prism_build',
    description: 'Check, then build the app and replay its acceptance vectors through it. An app that decides one answer from one request, each condition a field against a value, needs no build: it becomes the verified rule judge and its own numbers, named together, in about two seconds with no SDK image, and prism_try then answers from it. That record is not a holo. Any other app, or PRISM_CODE_TIER=local, is proved and built into a holo in the SDK image on this machine, downloading it first if it is missing (about 5.7 GB). It builds on GitHub Actions only when the user asks for it by naming a repository (remote github): ask the user before doing so, since the app then lives in a public repository. Prism creates it from UOR-Foundation/template, so the app gets the template\'s frame, page and gate; writes the app, its claims, tests and page into it; pushes; and once the gate and the page pass, returns the live GitHub Pages URL, after checking the live holo here. A GitHub build takes ten to fifteen minutes. Returns state running while it works; call again to keep waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        wait: { type: 'number', description: 'Seconds to wait before returning, default 45.' },
        overwrite: { type: 'boolean', description: 'Replace a model that was edited by hand.' },
        remote: { type: 'string', enum: ['github', 'local'], description: 'Where to build, when the user asks for one: github (the repository\'s Actions) or local (the SDK image). Omit to build locally.' },
        repository: { type: 'string', description: 'owner/name of the GitHub repository to create for the app, only after the user approved it.' },
      },
      additionalProperties: false,
    },
  },
  {
    name: 'prism_try',
    description: 'Answer one request, from the built app when there is one, else from the spec, and say which rule decided it.',
    inputSchema: { type: 'object', properties: { request: { type: 'string', description: 'One request line, the fields separated by single spaces; for a prism/spec/2 app, a session: its steps separated by ;, as book 4;cancel 2.' } }, required: ['request'], additionalProperties: false },
  },
  {
    name: 'prism_status',
    description: 'Where the session is: the next question, what is proved, what is built, and any job in progress.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
];

const PROMPTS = [{ name: 'prism', description: 'Build a formally verified app with Prism', arguments: [] }];

/** An answer that approves and says nothing else. */
const APPROVAL = /^\s*(yes|y|ok|okay|approved?|go ahead|looks good|correct|build it|ship it)\s*[.!]?\s*$/i;

/** A build whose server is gone is taken as still running while it wrote this recently. */
const ORPHAN_QUIET_SECONDS = 90;

/**
 * What is wrong with a tool call's arguments, in words that say what to send; null
 * when they fit the tool's schema. A call that does not fit is answered, never
 * guessed at: measured on 2026-11-15, a draft passed beside `spec` instead of
 * inside it was read as a request to show the spec, and nothing was said.
 */
export function argumentIssue(name, args) {
  const schema = TOOLS.find((t) => t.name === name).inputSchema;
  const takes = Object.keys(schema.properties);
  const shape = takes.length ? `It takes ${takes.map((k) => `\`${k}\``).join(', ')}.` : 'It takes no arguments.';
  if (!args || typeof args !== 'object' || Array.isArray(args)) return `${name} takes its arguments as one JSON object. ${shape}`;
  const unknown = Object.keys(args).filter((k) => !takes.includes(k));
  if (unknown.length) {
    const listed = unknown.slice(0, 6).map((k) => `\`${k}\``).join(', ');
    if (name === 'prism_spec' && unknown.some((k) => ['fields', 'rules', 'otherwise', 'title', 'state', 'actions', 'outcomes', 'properties', 'examples', 'schema'].includes(k))) {
      return `prism_spec takes the spec as one argument named \`spec\`: {"spec": {"title": ..., "fields": [...], "rules": [...], "otherwise": ...}}. It was passed ${listed} beside it, so nothing was read or changed. Call it again with the draft inside \`spec\`.`;
    }
    return `${name} does not take ${listed}. ${shape} Nothing was changed.`;
  }
  for (const key of schema.required ?? []) if (args[key] === undefined || args[key] === null) return `${name} needs \`${key}\`. ${shape}`;
  for (const [key, value] of Object.entries(args)) {
    const type = schema.properties[key].type;
    if (value === undefined || value === null || !type) continue;
    const fits = type === 'number' ? typeof value === 'number' && Number.isFinite(value) : typeof value === type;
    if (!fits) return `${name}: \`${key}\` must be a ${type}, not ${Array.isArray(value) ? 'a list' : typeof value === 'object' ? 'an object' : `the ${typeof value} ${JSON.stringify(value)}`}. Nothing was changed.`;
  }
  if (name === 'prism_spec' && args.spec !== undefined && args.spec !== null) {
    if (Array.isArray(args.spec) || !['object', 'string'].includes(typeof args.spec)) return 'prism_spec: `spec` must be one JSON object, the whole spec or draft. Nothing was changed.';
  }
  return null;
}

/** A server bound to a working directory. `send` writes one JSON-RPC message. */
/** Whether a process still runs. */
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
};

export function createServer({ cwd = process.cwd(), send, gaps = gapLedger() }) {
  const dir = appDir(cwd);
  const jobs = new Map();

  /**
   * The session, with spec.json as the source of truth: when an agent edited
   * spec.json directly since Prism last wrote it, the edit is adopted, as if
   * it had been passed to prism_spec. A spec.json that does not read is left
   * on disk and its refusal kept, so the next call can say what to fix.
   */
  /**
   * spec.json as it reads strictly; or, when it holds a draft (what a model
   * writes: fields, rules and otherwise), the spec Prism completes it to.
   */
  const readOrComplete = () => {
    try {
      return readProjectSpec(dir);
    } catch (error) {
      if (!(error instanceof SpecError)) throw error;
      const done = completeSpec(readFileSync(join(dir, SPEC_FILE), 'utf8'));
      if (!done.draft && done.notes.length === 0) throw error;
      return { ...readSpecFile(done.spec), completed: done };
    }
  };

  const load = () => {
    const session = readSession(dir);
    let read;
    try {
      read = readOrComplete();
    } catch (error) {
      if (!(error instanceof SpecError)) throw error;
      session.specFileIssue = { message: error.message, where: error.where, rule: error.rule };
      return session;
    }
    if (read && read.specHash !== session.status?.specHash) {
      session.answers = { ...answersFromSpec(read.spec), review: undefined };
      delete session.answers.review;
      session.spec = null;
      session.step = nextTurn(session.answers).step;
      session.status = { ...(session.status ?? {}), specHash: read.specHash };
      session.adopted = [
        read.completed?.draft ? 'spec.json held a draft; Prism completed it, and that is now the spec.' : 'spec.json was edited since Prism last wrote it; that edit is now the spec.',
        ...(read.completed?.notes ?? []),
      ].join(' ');
    }
    return session;
  };
  const save = (session) => {
    const { specFileIssue, adopted, ...kept } = session;
    writeSession(dir, kept);
  };

  /**
   * A session started over. The spec.json of the app before is still on disk, and the next call
   * would adopt it as an edit: the session was then at its review, unseen, and a "yes" approved it
   * (measured on 2026-11-16, in 0.9.2). So the file as it stands is remembered as already seen:
   * it is left alone until someone changes it, or a new spec replaces it.
   */
  const restarted = () => {
    const { adopted, specFileIssue, ...before } = load();
    let seen = {};
    try {
      const read = readOrComplete();
      if (read) seen = { specHash: read.specHash };
    } catch (error) {
      if (!(error instanceof SpecError)) throw error;
    }
    return { ...before, step: 'purpose', answers: {}, spec: null, status: seen, axioms: {} };
  };

  /** A spec that does not come back from its own answers is a Prism bug: record which part. */
  function checkRoundTrip(spec) {
    let found = null;
    try {
      found = roundTrip(spec);
    } catch {
      // A spec the check cannot take was refused, and that refusal is recorded where it happened.
    }
    if (found) gaps.record({ kind: 'roundtrip', construct: found.refusal ? `${found.part}:${found.refusal}` : found.part });
  }

  /** The next turn. `answered` is true when it follows the user's answer, whose refusal is then recorded. */
  function turn(session, { answered = false } = {}) {
    const t = nextTurn(session.answers);
    session.step = t.step;
    if (t.spec) session.spec = t.spec;
    save(session);
    if (session.spec) writeSpecDocument(dir, session);
    if (answered && t.refusal) gaps.record({ kind: 'refusal', construct: t.refusal });
    if (answered && t.step === 'ready') checkRoundTrip(t.spec);
    const { spec, refusal, ...rest } = t;
    return rest;
  }

  function startJob(kind, run, args = {}) {
    const job = { kind, args, state: 'running', log: [], started: Date.now(), result: null };
    const log = (line) => {
      job.log.push(line);
      if (job.log.length > 200) job.log.shift();
      job.onLog?.(line);
    };
    job.promise = run(log)
      .then((result) => Object.assign(job, { state: 'done', result }))
      .catch((error) => Object.assign(job, { state: 'done', result: { ok: false, message: `Prism failed: ${error.message}` } }));
    jobs.set(kind, job);
    return job;
  }

  async function awaitJob(job, waitSeconds, progress) {
    const timer = new Promise((done) => setTimeout(done, Math.max(0, Math.min(waitSeconds, 600)) * 1000));
    let tick = 0;
    job.onLog = (line) => progress?.(++tick, line);
    await Promise.race([job.promise, timer]);
    job.onLog = null;
    const elapsed = Math.round((Date.now() - job.started) / 1000);
    if (job.state === 'running') return { state: 'running', elapsed, latest: job.log.slice(-3), next: `Still working after ${elapsed} s. Call ${job.kind === 'build' ? 'prism_build' : 'prism_prove'} again to keep waiting.` };
    jobs.delete(job.kind);
    return { state: 'done', elapsed, ...job.result };
  }

  async function longTool(kind, args, progress) {
    const session = load();
    if (session.specFileIssue) return { state: 'blocked', message: `prism/spec.json does not read: ${session.specFileIssue.message} Fix spec.json, or pass the corrected spec to prism_spec.`, issue: session.specFileIssue };
    if (session.adopted) save(session);
    if (!session.spec || session.step !== 'ready') {
      const t = nextTurn(session.answers);
      if (t.step !== 'ready') return { state: 'blocked', message: `The spec is not complete yet. Next question: ${t.question}`, step: t.step };
      session.spec = t.spec;
    }
    const other = jobs.get(kind === 'build' ? 'prove' : 'build');
    if (other) return { state: 'busy', message: `A ${other.kind} is running; call prism_${other.kind} to follow it.` };
    // A job another Prism server started (an agent that restarted its server) is not
    // started twice; that server finishes it and saves the result here.
    const elsewhere = session.status.job;
    if (!jobs.get(kind) && elsewhere && elsewhere.pid !== process.pid && alive(elsewhere.pid)) {
      const elapsed = Math.round((Date.now() - elsewhere.started) / 1000);
      return { state: 'running', elapsed, next: `A ${elsewhere.kind} another Prism server started ${elapsed} s ago is still running. Call prism_${kind} again to keep waiting; it returns the result when that one finishes.` };
    }
    // The server that started a job is gone (an agent restarted it), but the job's container may
    // not be: it runs on, and when it finishes nobody is there to save what it built. Wait while
    // it still writes, take the build once the toolchain records it as verified, and only then
    // start again. Measured on 2026-11-16: such a build finished unseen, and a second one over it failed.
    let before = null;
    if (!jobs.get(kind) && elsewhere && elsewhere.pid !== process.pid) {
      const elapsed = Math.round((Date.now() - elsewhere.started) / 1000);
      const adopted = elsewhere.kind === 'build' && kind === 'build' ? await adoptBuild(dir, session) : null;
      if (adopted) {
        session.status.lastSpec = JSON.stringify(session.spec);
        session.status.lastBuild = { modelSha: session.status.modelSha, holo: adopted.holo, result: adopted };
        delete session.status.job;
        save(session);
        return { state: 'done', elapsed: 0, ...adopted, note: `This build finished after the Prism server that started it had stopped. It is the build the toolchain verified, so it was taken as it is and not built again.` };
      }
      const quiet = elsewhere.kind === 'build' ? buildQuietFor(dir) : null;
      if (quiet !== null && quiet < ORPHAN_QUIET_SECONDS) {
        return { state: 'running', elapsed, next: `A build started ${elapsed} s ago is still writing (${quiet} s ago), though the Prism server that started it has stopped. Call prism_${kind} again to keep waiting; its result is taken when it finishes.` };
      }
      delete session.status.job;
      save(session);
      before = `A ${elsewhere.kind} started ${elapsed} s ago did not finish: the Prism server running it stopped. It was started again.`;
    }
    if (!jobs.get(kind) && kind === 'build' && session.status.lastBuild && session.status.lastBuild.modelSha === session.status.modelSha && session.status.lastSpec === JSON.stringify(session.spec) && existsSync(session.status.lastBuild.holo ?? '')) {
      return { state: 'done', elapsed: 0, ...session.status.lastBuild.result, note: 'Nothing changed since this build, so it was not built again.' };
    }
    // A GitHub build with nowhere to build asks where, before any proof: the question used to come
    // only after minutes of proving.
    const remote = args.repository && !args.remote ? 'github' : args.remote ?? null;
    if (kind === 'build' && remote === 'github' && !jobs.get(kind)) {
      const question = askForRepository(dir, session, { repository: args.repository ?? null });
      if (question) return { state: 'done', elapsed: 0, ...question };
    }
    // A call that names a repository joins a build only if that build was started for it: joined,
    // the repository was silently ignored (measured on 2026-11-16).
    const running = jobs.get(kind);
    if (running && kind === 'build' && args.repository && args.repository !== running.args?.repository) {
      const elapsed = Math.round((Date.now() - running.started) / 1000);
      return { state: 'running', elapsed, latest: running.log.slice(-3), next: `A build started ${elapsed} s ago ${running.args?.repository ? `for ${running.args.repository}` : 'without a repository'} is still running, and ${args.repository} is not applied to it. Call prism_build again with repository ${args.repository} once it returns.` };
    }
    const job =
      jobs.get(kind) ??
      startJob(kind, async (log) => {
        const s = load();
        s.spec = validateSpec(s.spec ?? session.spec);
        s.status.job = { kind, pid: process.pid, started: Date.now() };
        save(s);
        const result = kind === 'build' ? await build(dir, s, { log, overwrite: args.overwrite, remote: args.remote ?? null, root: cwd, repository: args.repository ?? null, gaps }) : await prove(dir, s, { log, overwrite: args.overwrite, gaps });
        if (kind === 'prove' || result.ok) s.status.lastSpec = JSON.stringify(s.spec);
        if (kind === 'build' && result.ok) s.status.lastBuild = { modelSha: s.status.modelSha, holo: result.holo, result };
        delete s.status.job;
        // Answers given while the job ran stay; only what the job learned is merged in.
        const latest = load();
        save({ ...latest, status: s.status, axioms: s.axioms, image: s.image ?? latest.image });
        return result;
      }, { remote, repository: args.repository ?? null });
    const waited = await awaitJob(job, args.wait ?? 45, progress);
    return before ? { ...waited, note: before } : waited;
  }

  const tools = {
    prism_start(args) {
      // The kernel opens while the user is still describing the app, so the first check does not wait for it.
      setImmediate(() => import('./kernel-prove.mjs').then((m) => m.warmKernel()).catch(() => {}));
      const session = args.restart ? restarted() : load();
      if (session.adopted) save(session);
      const t = turn(session);
      const resumed = Object.keys(session.answers).length > 0;
      return { greeting: resumed ? `Welcome back. ${t.progress}.` : GREETING, project: dir, ...t, ...(session.adopted ? { note: session.adopted } : {}), ...(session.specFileIssue ? { issue: session.specFileIssue } : {}) };
    },
    prism_answer(args) {
      const session = load();
      const step = args.step ?? session.step ?? nextTurn(session.answers).step;
      if (step === 'ready') return { message: 'The spec is complete. Call prism_build to prove and build it, or pass step to change an answer.' };
      // An approval answers the review and nothing else: taken as any other step's answer it would
      // become the app's purpose, and the app would be called "yes".
      if (step !== 'review' && APPROVAL.test(String(args.answer))) {
        const { spec, refusal, notes, ...current } = nextTurn(session.answers);
        return { ...current, issue: `"${String(args.answer).trim()}" approves a review, and there is no checked spec to review yet: the step is ${step}. Answer the question, or pass the whole draft to prism_spec.` };
      }
      session.answers[step] = args.answer;
      if (step !== 'review') delete session.answers.review;
      return turn(session, { answered: true });
    },
    prism_spec(args) {
      const session = load();
      // A model that writes the draft as text meant the object it spells.
      if (typeof args.spec === 'string') args = { ...args, spec: parseStrictJson(args.spec) };
      if (args.spec === undefined || args.spec === null) {
        if (session.adopted) save(session);
        const spec = session.spec ?? nextTurn(session.answers).spec ?? null;
        return { spec, step: session.step, specHash: session.status?.specHash ?? null, ...(session.adopted ? { note: session.adopted } : {}), ...(session.specFileIssue ? { issue: session.specFileIssue } : {}) };
      }
      let done;
      let given;
      try {
        // The same strict reading spec.json gets: no member its schema does not define, whole numbers only.
        // A draft is completed first: what the user did not say is derived, the same way every time.
        done = completeSpec(args.spec);
        // A spec that was whole and needed nothing is taken exactly as it was passed.
        const { name, ...unnamed } = done.spec;
        given = done.draft ? done.spec : done.notes.length ? (args.spec.name ? done.spec : unnamed) : args.spec;
        readSpecFile(given);
        session.answers = { ...answersFromSpec(given), review: undefined };
      } catch (error) {
        if (error instanceof SpecError) gaps.record({ kind: 'refusal', construct: error.rule });
        throw error;
      }
      // The spec was valid, so a refusal of its answers is Prism's, recorded by the round trip.
      checkRoundTrip(given);
      delete session.answers.review;
      const t = turn(session);
      const notes = [...done.notes, ...(t.notes ?? [])];
      // A guarantee or example the rules break: say which, beside the rule that decides, and the ways out.
      const repair = t.issue ? repairMessage(checkSpec(args.spec)) : null;
      return { ...t, ...(notes.length ? { notes } : {}), ...(repair ? { repair } : {}) };
    },
    prism_prove: (args, progress) => longTool('prove', args, progress),
    prism_build: (args, progress) => longTool('build', args, progress),
    async prism_try(args) {
      const session = load();
      const t = nextTurn(session.answers);
      if (!t.spec && !session.spec) return { message: 'There is no complete spec yet to answer from.' };
      return tryRequest({ ...session, spec: session.spec ?? t.spec }, args.request);
    },
    prism_status() {
      const session = load();
      const t = nextTurn(session.answers);
      return {
        project: dir,
        step: t.step,
        question: t.question,
        properties: session.status.properties ?? {},
        proved: session.status.proved ?? null,
        built: session.status.built ?? null,
        holo: session.status.holo ?? null,
        ruleApp: session.status.ruleApp ?? null,
        jobs: [...jobs.values()].map((j) => ({ kind: j.kind, state: j.state, elapsed: Math.round((Date.now() - j.started) / 1000), latest: j.log.slice(-3) })),
      };
    },
  };

  const text = (value) => (typeof value === 'string' ? value : JSON.stringify(value, null, 2));
  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const error = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message) {
    const { id, method, params = {} } = message;
    const isRequest = id !== undefined && id !== null;
    try {
      switch (method) {
        case 'initialize': {
          const requested = params.protocolVersion;
          return reply(id, {
            protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0],
            capabilities: { tools: {}, prompts: {}, resources: {} },
            serverInfo: { name: 'prism', title: 'Prism', version },
            instructions: INSTRUCTIONS,
          });
        }
        case 'ping':
          return reply(id, {});
        case 'tools/list':
          return reply(id, { tools: TOOLS });
        case 'tools/call': {
          const tool = tools[params.name];
          if (!tool) return error(id, -32602, `Unknown tool: ${params.name}`);
          const wrong = argumentIssue(params.name, params.arguments ?? {});
          if (wrong) return reply(id, { content: [{ type: 'text', text: wrong }], structuredContent: { issue: wrong }, isError: true });
          const token = params._meta?.progressToken;
          const progress = token === undefined ? null : (n, line) => send({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken: token, progress: n, message: line } });
          let result;
          try {
            result = await tool(params.arguments ?? {}, progress);
          } catch (e) {
            if (e instanceof SpecError) return reply(id, { content: [{ type: 'text', text: e.message }], structuredContent: { issue: e.message }, isError: true });
            throw e;
          }
          const isError = result && (result.ok === false || result.state === 'blocked');
          return reply(id, { content: [{ type: 'text', text: text(result) }], structuredContent: result, ...(isError ? { isError: true } : {}) });
        }
        case 'prompts/list':
          return reply(id, { prompts: PROMPTS });
        case 'prompts/get':
          if (params.name !== 'prism') return error(id, -32602, `Unknown prompt: ${params.name}`);
          return reply(id, { description: PROMPTS[0].description, messages: [{ role: 'user', content: { type: 'text', text: 'Call the prism_start tool and follow what it returns: draft the whole spec from what I want, and show it to me for approval before you build.' } }] });
        case 'resources/list':
          return reply(id, {
            resources: [
              { uri: 'prism://spec', name: 'SPEC.md', description: 'The spec in prose, with what is proved', mimeType: 'text/markdown' },
              { uri: 'prism://model', name: 'model', description: 'The generated LexLean model', mimeType: 'application/x-tex' },
              { uri: 'prism://status', name: 'status', description: 'Session progress, proofs and build', mimeType: 'application/json' },
            ],
          });
        case 'resources/templates/list':
          return reply(id, { resourceTemplates: [] });
        case 'resources/read': {
          const session = load();
          const read = (path) => (existsSync(path) ? readFileSync(path, 'utf8') : '');
          const contents = {
            'prism://spec': () => ({ mimeType: 'text/markdown', text: read(join(dir, 'SPEC.md')) || 'No spec yet.' }),
            'prism://model': () => ({ mimeType: 'application/x-tex', text: session.spec ? read(modelPath(dir, session.spec)) || 'Not generated yet.' : 'Not generated yet.' }),
            'prism://status': () => ({ mimeType: 'application/json', text: text(tools.prism_status()) }),
          }[params.uri];
          if (!contents) return error(id, -32602, `Unknown resource: ${params.uri}`);
          return reply(id, { contents: [{ uri: params.uri, ...contents() }] });
        }
        case 'logging/setLevel':
          return reply(id, {});
        case 'completion/complete':
          return reply(id, { completion: { values: [], hasMore: false } });
        default:
          if (method?.startsWith('notifications/')) return undefined;
          if (isRequest) return error(id, -32601, `Method not found: ${method}`);
          return undefined;
      }
    } catch (e) {
      if (isRequest) return error(id, -32603, e.message);
      return undefined;
    }
  }
  /** Settles when no job runs, so a closing server still saves what its jobs learn. */
  const idle = () => Promise.allSettled([...jobs.values()].map((j) => j.promise));
  return { handle, dir, idle };
}

/** Serve on stdin and stdout until stdin closes. */
export function serveStdio({ cwd = process.cwd(), input = process.stdin, output = process.stdout } = {}) {
  const server = createServer({ cwd, send: (message) => output.write(`${JSON.stringify(message)}\n`) });
  const lines = createInterface({ input, crlfDelay: Infinity });
  const pending = new Set();
  lines.on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      output.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })}\n`);
      return;
    }
    for (const m of Array.isArray(message) ? message : [message]) {
      const p = server.handle(m);
      pending.add(p);
      p.finally(() => pending.delete(p));
    }
  });
  return new Promise((done) => lines.on('close', () => Promise.allSettled([...pending]).then(() => server.idle()).then(() => done(server))));
}
