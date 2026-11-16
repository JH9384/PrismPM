// Gap telemetry: each point that records a gap, the ledger, delivery in the _meta of a hosted call,
// the opt-out, and the redaction: no text, name or number a user wrote ever leaves the machine.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GAPS_META_KEY, GAPS_SCHEMA, BATCH_LINES, MODEL_STEPS, fingerprint, gapLedger, propertyShape, telemetryNotice, telemetryOn } from '../src/gaps.mjs';
import { REFUSALS } from '../src/journey/spec.mjs';
import { ROUND_TRIP_PARTS, STEPS, compile, roundTrip } from '../src/journey/session.mjs';
import { names } from '../src/journey/render.mjs';
import { appDir, readSession, writeApp } from '../src/journey/project.mjs';
import { prove } from '../src/journey/engine.mjs';
import { createServer } from '../src/journey/mcp.mjs';
import { hostedClient } from '../src/hosted.mjs';
import { VERSION } from '../src/version.mjs';

const scratch = () => mkdtempSync(join(tmpdir(), 'prism-gaps-'));
const ledger = (env = {}) => gapLedger({ env, dir: scratch() });
const lines = (l) => (existsSync(l.file) ? readFileSync(l.file, 'utf8').trim().split('\n').filter(Boolean).map((x) => JSON.parse(x)) : []);
const recorded = (l) => lines(l).map(({ kind, construct, code }) => ({ kind, construct, code }));

const ANSWERS = {
  purpose: 'Payment approval: decide whether a payment request is approved.',
  fields: 'role: clerk|manager, amount: number at least 1, limit: number',
  outcomes: 'approved, refused',
  rules: 'when role is manager then approved\nwhen amount is at most limit then approved\notherwise refused',
  properties: 'never when role is clerk and amount > limit then approved\nalways when role is manager then approved',
  examples: 'clerk 250 1000 -> approved\nclerk 1001 1000 -> refused',
};
const paymentSpec = () => compile({ ...ANSWERS, review: 'yes' }).spec;
/** A valid spec Prism cannot read back: the choice `under-65` is read as the comparison "under 65". */
const ageSpec = () => ({
  purpose: 'Age band: decide the band.',
  fields: [{ name: 'age', kind: 'choice', values: ['under-65', 'over-65'] }],
  outcomes: ['young', 'old'],
  rules: [{ when: [{ field: 'age', op: 'is', value: 'under-65' }], then: 'young' }],
  otherwise: 'old',
});

function mcp(gaps, cwd = scratch()) {
  const sent = [];
  const server = createServer({ cwd, send: (m) => sent.push(m), gaps });
  let id = 0;
  return {
    async tool(name, args = {}) {
      const n = ++id;
      await server.handle({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } });
      return sent.find((m) => m.id === n).result;
    },
  };
}

/** A stand-in hosted verifier that keeps every request it is sent; `answers` are the verify results, one per call. */
function server(gaps, answers = []) {
  const requests = [];
  let id = 0;
  let down = false;
  const PROFILE = { id: 'p1', name: 'prism-app', roots: ['src'], packages: [{ package: 'lexlean.core' }, { package: 'lexlean.std.nat' }, { package: 'prism.arch' }] };
  const fetch = async (_url, { body }) => {
    if (down) throw new Error('connection refused');
    const request = JSON.parse(body);
    requests.push(request);
    const tool = request.params.name;
    let result = {};
    if (tool === 'lexlean_profiles') result = { structuredContent: { profiles: [PROFILE] } };
    else if (tool === 'lexlean_draft_write') result = { structuredContent: { draft: `prism-app/${++id}` } };
    else if (tool === 'lexlean_verify') result = answers.shift();
    return { status: 200, text: async () => JSON.stringify({ jsonrpc: '2.0', id: request.id, result }) };
  };
  return {
    requests,
    setDown: (value) => (down = value),
    client: hostedClient({ url: 'https://lexlean.example.test/', fetch, sleep: async () => {}, retries: 0, retryMs: 0, gaps }),
  };
}

const failed = (diagnostics) => ({ taskId: 't', status: 'completed', result: { content: [{ type: 'text', text: JSON.stringify({ command: 'verify', diagnostics }) }], structuredContent: { state: 'failed' } } });

/** A proof Lean refuses at the theorem of property `index`, on the hosted stand-in. */
async function refuseProperty(spec, index, gaps, code = 'LLV7002') {
  const dir = appDir(scratch());
  const session = { ...readSession(dir), spec, axioms: {}, status: {} };
  writeApp(dir, session);
  const n = names(spec);
  const id = spec.properties[index].id;
  const proofs = readFileSync(join(dir, 'src', `${n.proofs}.lex.tex`), 'utf8').split('\n');
  const line = proofs.findIndex((l, i) => /^theorem\{/.test(l) && (proofs[i + 1] ?? '').includes(n.properties[id].theorem)) + 1;
  assert.ok(line > 0);
  const refused = { code, severity: 'error', message: 'Lean rejected `X` (error): unsolved goals', primary: { path: `src/${n.proofs}.lex.tex`, line_start: line } };
  const { client } = server(null, [failed([refused])]);
  return prove(dir, session, { where: 'hosted', client, overwrite: true, gaps });
}

test('a fingerprint is a closed record: a kind, a construct from its vocabulary, a code and a version, and nothing else', () => {
  assert.deepEqual(fingerprint({ kind: 'refusal', construct: 'fields.too-many', code: null, version: '0.6.0', purpose: 'secret' }), { kind: 'refusal', construct: 'fields.too-many', code: null, version: '0.6.0' });
  assert.deepEqual(fingerprint({ kind: 'roundtrip', construct: 'rules:choice.value', version: '0.6.0' }).construct, 'rules:choice.value');
  assert.equal(fingerprint({ kind: 'unproved', construct: 'always:choice-is+number-le-field', code: 'LLV7002', version: '0.6.0' }).code, 'LLV7002');
  assert.equal(fingerprint({ kind: 'model-refused', construct: 'check', code: 'PP2014', version: '0.6.0-rc.1' }).construct, 'check');
  for (const bad of [
    { kind: 'refusal', construct: 'amount', version: '0.6.0' },
    { kind: 'refusal', construct: 'fields.too-many ', version: '0.6.0' },
    { kind: 'roundtrip', construct: 'rules:my-field', version: '0.6.0' },
    { kind: 'roundtrip', construct: 'rules:choice.value:x', version: '0.6.0' },
    { kind: 'unproved', construct: 'always:amount', version: '0.6.0' },
    { kind: 'unproved', construct: 'sometimes:choice-is', version: '0.6.0' },
    { kind: 'model-refused', construct: 'my-app', version: '0.6.0' },
    { kind: 'refusal', construct: 'fields.none', code: 'error: amount', version: '0.6.0' },
    { kind: 'refusal', construct: 'fields.none', code: 'llv7002', version: '0.6.0' },
    { kind: 'refusal', construct: 'fields.none', version: '0.6.0-secret' },
    { kind: 'question', construct: 'fields.none', version: '0.6.0' },
    null,
    'refusal',
  ]) assert.equal(fingerprint(bad), null, JSON.stringify(bad));
});

test('every rule the spec code refuses by is in REFUSALS, and every listed rule is one the code names', () => {
  const source = ['../src/journey/spec.mjs', '../src/journey/session.mjs'].map((p) => readFileSync(new URL(p, import.meta.url), 'utf8')).join('\n');
  const named = new Set([...source.matchAll(/(?:refuse\(|new SpecError\().*, '([a-z]+\.[a-z-]+)'\);/g)].map((m) => m[1]));
  const calls = (source.match(/\brefuse\(|new SpecError\(/g) ?? []).length - 1; // less the one inside refuse itself
  assert.equal([...source.matchAll(/(?:refuse\(|new SpecError\().*, '([a-z]+\.[a-z-]+)'\);/g)].length, calls, 'every refusal names its rule');
  assert.deepEqual([...named].sort(), [...REFUSALS].sort());
});

test('a property shape keeps the kind and the kinds of comparison, never a field, a value or a number', () => {
  const p = { kind: 'always', when: [{ field: 'amount', op: '<=', value: { field: 'limit' } }, { field: 'role', op: 'is', value: 'manager' }, { field: 'amount', op: '>', value: 987654 }] };
  assert.equal(propertyShape(p), 'always:choice-is+number-gt-const+number-le-field');
  assert.equal(propertyShape({ kind: 'never', when: [{ field: 'x', op: 'is not', value: 'y' }] }), 'never:choice-is-not');
});

// The gateway that receives the gaps (UOR-Foundation/lexlean-mcp, OB-16) keeps a gap only when it
// fits its grammar, and drops it silently otherwise. A rule or part named here that does not fit
// would never be counted, so the vocabulary is held to that grammar here.
test('every construct prism-code can emit fits the gateway\'s grammar', () => {
  const word = /^[a-z]+(?:-[a-z]+)*$/;
  const rule = (r) => r.split('.').length === 2 && r.split('.').every((w) => word.test(w) && w.length <= 24);
  const GATEWAY_PARTS = ['name', 'title', 'purpose', 'fields', 'outcomes', 'rules', 'otherwise', 'properties', 'examples', 'review'];
  for (const r of REFUSALS) assert.ok(rule(r), `refusal rule ${r}`);
  for (const p of new Set([...ROUND_TRIP_PARTS, ...STEPS])) assert.ok(GATEWAY_PARTS.includes(p), `round-trip part ${p}`);
  assert.deepEqual([...MODEL_STEPS].sort(), ['build', 'check', 'format', 'lock', 'prelock', 'run', 'verify']);
});

test('detection (a): an answer the spec refuses records the rule that refused it, once per answer', async () => {
  const gaps = ledger();
  const s = mcp(gaps);
  for (const step of ['purpose', 'fields', 'outcomes']) await s.tool('prism_answer', { answer: ANSWERS[step] });
  const r = await s.tool('prism_answer', { answer: 'when role is manager then 42\notherwise refused' });
  assert.match(r.structuredContent.issue, /not an answer/);
  assert.equal(r.structuredContent.refusal, undefined, 'the agent is not shown the rule id');
  await s.tool('prism_status');
  await s.tool('prism_start');
  assert.deepEqual(recorded(gaps), [{ kind: 'refusal', construct: 'outcome.unknown', code: null }], 'reading the session again records nothing');
});

test('detection (a): a spec given as data that validation refuses records the rule', async () => {
  const gaps = ledger();
  const s = mcp(gaps);
  const nine = Array.from({ length: 9 }, (_, i) => ({ name: `f${i}`, kind: 'number' }));
  const r = await s.tool('prism_spec', { spec: { ...paymentSpec(), fields: nine } });
  assert.equal(r.isError, true);
  assert.deepEqual(recorded(gaps), [{ kind: 'refusal', construct: 'fields.too-many', code: null }]);
});

test('detection (b): a valid spec that does not come back from its own answers is a Prism bug, recorded by part and rule', async () => {
  assert.equal(roundTrip(paymentSpec()), null);
  assert.deepEqual(roundTrip(ageSpec()), { part: 'rules', refusal: 'choice.value' });
  assert.deepEqual(roundTrip({ ...paymentSpec(), title: 'A title that is longer than forty characters in all' }), { part: 'title', refusal: null });
  const gaps = ledger();
  const s = mcp(gaps);
  await s.tool('prism_spec', { spec: paymentSpec() });
  assert.deepEqual(recorded(gaps), [], 'a spec that round-trips records nothing');
  await s.tool('prism_spec', { spec: ageSpec() });
  assert.deepEqual(recorded(gaps), [{ kind: 'roundtrip', construct: 'rules:choice.value', code: null }], 'the refusal of its answers is the round trip, not the user');
});

test('detection (b): answers that reach a ready spec are checked once, when the user approves', async () => {
  const gaps = ledger();
  const s = mcp(gaps);
  for (const step of Object.keys(ANSWERS)) await s.tool('prism_answer', { answer: ANSWERS[step] });
  const ready = await s.tool('prism_answer', { answer: 'yes' });
  assert.equal(ready.structuredContent.step, 'ready');
  assert.deepEqual(recorded(gaps), []);
});

test('detection (c): a property Lean did not prove and no sampled request breaks is a prover gap, with its code and shape', async () => {
  const gaps = ledger();
  const r = await refuseProperty(paymentSpec(), 0, gaps);
  assert.equal(r.ok, false);
  assert.match(r.message, /none of \d+ sampled requests breaks it/);
  assert.deepEqual(recorded(gaps), [{ kind: 'unproved', construct: 'never:choice-is+number-gt-field', code: 'LLV7002' }]);
});

test('detection (c): a property the rules break is the user\'s mistake and records nothing', async () => {
  const gaps = ledger();
  const spec = paymentSpec();
  spec.properties[0] = { ...spec.properties[0], kind: 'never', when: [{ field: 'role', op: 'is', value: 'manager' }], then: 'approved' };
  const r = await refuseProperty(spec, 0, gaps);
  assert.match(r.message, /is false/);
  assert.deepEqual(recorded(gaps), []);
});

test('detection (c): a generated model the toolchain refuses records the step and the code', async () => {
  const gaps = ledger();
  const dir = appDir(scratch());
  const session = { ...readSession(dir), spec: paymentSpec(), axioms: {}, status: {} };
  const { client } = server(null, [failed([{ code: 'LLV3001', severity: 'error', message: 'cannot elaborate `PaymentApproval`', primary: { path: 'src/PaymentApproval.lex.tex', line_start: 1 } }])]);
  const r = await prove(dir, session, { where: 'hosted', client, overwrite: true, gaps });
  assert.match(r.message, /Prism bug/);
  assert.deepEqual(recorded(gaps), [{ kind: 'model-refused', construct: 'verify', code: 'LLV3001' }]);
});

test('the ledger is appended to and delivered in the _meta of the next hosted call, counted by fingerprint, then marked sent', async () => {
  const gaps = ledger();
  gaps.record({ kind: 'refusal', construct: 'fields.too-many' });
  gaps.record({ kind: 'refusal', construct: 'fields.too-many' });
  gaps.record({ kind: 'unproved', construct: 'always:choice-is', code: 'LLV7002' });
  assert.equal(lines(gaps).length, 3);
  assert.match(lines(gaps)[0].day, /^\d{4}-\d{2}-\d{2}$/);
  const { client, requests } = server(gaps);
  await client.call('lexlean_profiles', { profile: 'prism-app' });
  const batch = requests[0].params._meta[GAPS_META_KEY];
  assert.deepEqual(Object.keys(batch).sort(), ['gaps', 'install', 'schema']);
  assert.equal(batch.schema, GAPS_SCHEMA);
  assert.match(batch.install, /^[0-9a-f]{32}$/);
  assert.deepEqual(batch.gaps, [
    { kind: 'refusal', construct: 'fields.too-many', code: null, version: VERSION, count: 2 },
    { kind: 'unproved', construct: 'always:choice-is', code: 'LLV7002', version: VERSION, count: 1 },
  ]);
  assert.ok(requests[0].params._meta['io.modelcontextprotocol/protocolVersion'], 'the call keeps its own _meta');
  await client.call('lexlean_profiles', { profile: 'prism-app' });
  assert.equal(requests[1].params._meta[GAPS_META_KEY], undefined, 'sent once');
  gaps.record({ kind: 'refusal', construct: 'rules.too-many' });
  await client.call('lexlean_profiles', { profile: 'prism-app' });
  const next = requests[2].params._meta[GAPS_META_KEY];
  assert.equal(next.install, batch.install, 'one install ID');
  assert.deepEqual(next.gaps.map((g) => g.construct), ['rules.too-many']);
});

test('a call that is not answered marks nothing sent; the gaps go with the next one', async () => {
  const gaps = ledger();
  gaps.record({ kind: 'refusal', construct: 'fields.too-many' });
  const { client, requests, setDown } = server(gaps);
  setDown(true);
  await assert.rejects(client.call('lexlean_profiles', { profile: 'prism-app' }), /did not answer/);
  setDown(false);
  await client.call('lexlean_profiles', { profile: 'prism-app' });
  assert.equal(requests[0].params._meta[GAPS_META_KEY].gaps[0].count, 1);
});

test('a batch holds at most BATCH_LINES lines; the rest go with the next call', async () => {
  const gaps = ledger();
  for (let i = 0; i < BATCH_LINES + 3; i++) gaps.record({ kind: 'refusal', construct: 'fields.none' });
  const { client, requests } = server(gaps);
  await client.call('lexlean_profiles', {});
  await client.call('lexlean_profiles', {});
  assert.deepEqual(requests.map((r) => r.params._meta[GAPS_META_KEY].gaps[0].count), [BATCH_LINES, 3]);
});

test('PRISM_TELEMETRY=0 or DO_NOT_TRACK=1 records nothing and sends nothing; setup says what is sent and how to stop it', async () => {
  assert.equal(telemetryOn({}), true);
  assert.equal(telemetryOn({ DO_NOT_TRACK: '0' }), true);
  for (const env of [{ PRISM_TELEMETRY: '0' }, { PRISM_TELEMETRY: 'off' }, { DO_NOT_TRACK: '1' }, { DO_NOT_TRACK: 'true' }]) {
    assert.equal(telemetryOn(env), false, JSON.stringify(env));
    const gaps = ledger(env);
    assert.equal(gaps.record({ kind: 'refusal', construct: 'fields.none' }), null);
    assert.equal(existsSync(gaps.file), false);
    appendFileSync(gaps.file, `${JSON.stringify({ kind: 'refusal', construct: 'fields.none', code: null, version: VERSION })}\n`);
    assert.equal(gaps.pending(), null, 'a ledger written before it was turned off is not sent');
  }
  assert.match(telemetryNotice({}), /^telemetry: .*never your text, names or numbers\. PRISM_TELEMETRY=0 turns it off\.$/);
  assert.match(telemetryNotice({ DO_NOT_TRACK: '1' }), /^telemetry: off/);
  assert.equal(telemetryNotice({}).split('\n').length, 1);
});

// The redaction claim. A journey whose every word, name and number is a canary drives every
// detection point; then the ledger and every byte sent to the hosted verifier are searched for
// the canaries. The ledger is also poisoned with lines another program wrote: they must not leave.
test('redaction: no text, field name, choice, answer or number a user wrote leaves the machine', async () => {
  const CANARIES = ['zqx', '987654', '424242'];
  const gaps = ledger();
  const s = mcp(gaps);
  const answers = {
    purpose: 'Zqx secret purpose: decide whether zqx things pass.',
    fields: 'zqxrole: zqxclerk|zqxboss, zqxamount: number 1..987654, zqxlimit: number',
    outcomes: 'zqxyes, zqxno',
    rules: 'when zqxrole is zqxboss then zqxyes\nwhen zqxamount is at most zqxlimit then zqxyes\notherwise zqxno',
    properties: 'never when zqxrole is zqxclerk and zqxamount > zqxlimit then zqxyes',
    examples: 'zqxclerk 424242 987654 -> zqxyes',
  };
  for (const step of ['purpose', 'fields', 'outcomes']) await s.tool('prism_answer', { answer: answers[step] });
  await s.tool('prism_answer', { answer: 'when zqxrole is zqxboss then zqx987654\notherwise zqxno' }); // (a) outcome.unknown
  await s.tool('prism_answer', { answer: 'when zqxrole < 987654 then zqxyes\notherwise zqxno' }); // (a) choice.comparison
  for (const step of ['rules', 'properties', 'examples']) await s.tool('prism_answer', { answer: answers[step] });
  await s.tool('prism_answer', { answer: 'yes' });
  const spec = compile({ ...answers, review: 'yes' }).spec;
  assert.equal(spec.fields[0].name, 'zqxrole', 'the canaries are in the spec');
  await s.tool('prism_spec', { spec: { ...spec, fields: [...spec.fields, ...Array.from({ length: 6 }, (_, i) => ({ name: `zqxextra${i}`, kind: 'number', max: 987654 }))] } }); // (a) fields.too-many
  await s.tool('prism_spec', { spec: { ...spec, title: 'Zqx title that is longer than forty characters 987654' } }); // (b) title
  await s.tool('prism_spec', { spec: { ...spec, fields: [{ name: 'zqxage', kind: 'choice', values: ['under-987654', 'zqxover'] }, ...spec.fields.slice(1)], rules: [{ when: [{ field: 'zqxage', op: 'is', value: 'under-987654' }], then: 'zqxyes' }], properties: [], examples: [] } }); // (b) rules:choice.value
  await refuseProperty(spec, 0, gaps, 'LLV7002'); // (c) unproved
  const kinds = new Set(lines(gaps).map((l) => l.kind));
  for (const kind of ['refusal', 'roundtrip', 'unproved']) assert.ok(kinds.has(kind), `the journey reached detection point ${kind}`);
  const written = lines(gaps).length;
  const ledgerText = readFileSync(gaps.file, 'utf8').toLowerCase();
  for (const canary of CANARIES) assert.equal(ledgerText.includes(canary), false, `the ledger Prism wrote holds ${canary}`);
  // Lines another program wrote, each with a canary where a fingerprint has a value or beside it.
  for (const poison of [
    { kind: 'refusal', construct: 'zqx', code: null, version: VERSION },
    { kind: 'refusal', construct: 'fields.none', code: 'ZQX9876', version: VERSION },
    { kind: 'refusal', construct: 'fields.none', code: null, version: VERSION, purpose: 'zqx', count: 987654 },
    { kind: 'unproved', construct: 'always:zqx', code: null, version: VERSION },
    { kind: 'refusal', construct: 'fields.none', code: null, version: '987654.0.0-zqx' },
  ]) appendFileSync(gaps.file, `${JSON.stringify(poison)}\n`);
  appendFileSync(gaps.file, 'zqx not json 987654\n');

  const { client, requests } = server(gaps);
  await client.call('lexlean_profiles', { profile: 'prism-app' });
  const sent = JSON.stringify(requests);
  for (const canary of CANARIES) assert.equal(sent.toLowerCase().includes(canary), false, `a request carried ${canary}: ${sent}`);
  const batch = requests[0].params._meta[GAPS_META_KEY];
  for (const gap of batch.gaps) {
    assert.deepEqual(Object.keys(gap).sort(), ['code', 'construct', 'count', 'kind', 'version']);
    assert.deepEqual(fingerprint(gap), { kind: gap.kind, construct: gap.construct, code: gap.code, version: gap.version }, 'each gap sent is a fingerprint');
  }
  // The one poisoned line with a valid fingerprint is counted, without what was beside it.
  assert.equal(batch.gaps.reduce((n, g) => n + g.count, 0), written + 1, 'every line Prism wrote was sent, and of the others only a fingerprint');
});

test('a ledger written by another tool, or replaced, is read safely', async () => {
  const dir = scratch();
  const gaps = gapLedger({ env: {}, dir });
  writeFileSync(join(dir, 'gaps.json'), '{"install":"zqx","sent":-1}');
  gaps.record({ kind: 'refusal', construct: 'fields.none' });
  const first = gaps.pending();
  assert.match(first.meta.install, /^[0-9a-f]{32}$/, 'a damaged state gets a new install ID');
  first.commit();
  writeFileSync(gaps.file, '');
  gaps.record({ kind: 'refusal', construct: 'rules.none' });
  assert.deepEqual(gaps.pending().meta.gaps.map((g) => g.construct), ['rules.none'], 'a ledger shorter than what was sent is read from its start');
});
