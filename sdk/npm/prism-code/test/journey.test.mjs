// The Prism journey: the spec, its evaluator, the rendered model, the session, agent wiring, setup and the MCP server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SpecError,
  counterexample,
  decodeRequest,
  judge,
  nameFromPurpose,
  parseCondition,
  parseExamples,
  parseFields,
  parseNumber,
  parseOutcomes,
  parseProperties,
  parseRules,
  requestLimits,
  respond,
  unreachableRules,
  validateSpec,
} from '../src/journey/spec.mjs';
import { acceptanceVectors, declarations, names, proofDeclarations, renderModel, renderProofs, renderSpecDocument } from '../src/journey/render.mjs';
import { answersFromSpec, compile, nextTurn } from '../src/journey/session.mjs';
import { journeyServer } from '../src/journey/register.mjs';
import { BUILD_SCRIPT, axiomViolations, buildProgress, declarationAt, parseDiagnostics, steps } from '../src/journey/sdk.mjs';
import { appDir, modelPath, readSession, scaffold, writeApp } from '../src/journey/project.mjs';
import { createServer, INSTRUCTIONS } from '../src/journey/mcp.mjs';

// Gap telemetry (src/gaps.mjs) keeps its ledger under PRISM_HOME: keep what these tests record out of the developer's own.
process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-journey-'));
const enc = (s) => new TextEncoder().encode(s);

const ANSWERS = {
  purpose: 'Payment approval: decide whether a payment request is approved.',
  fields: 'role: clerk|manager, amount: number at least 1, limit: number',
  outcomes: 'approved, refused',
  rules: 'when role is manager then approved\nwhen amount is at most limit then approved\notherwise refused',
  properties: 'never when role is clerk and amount > limit then approved\nalways when role is manager then approved',
  examples: 'clerk 250 1000 -> approved\nclerk 1001 1000 -> refused',
};
const paymentSpec = () => compile({ ...ANSWERS, review: 'yes' }).spec;

test('fields, outcomes, rules, properties and examples parse from the formats the questions show', () => {
  const fields = parseFields(ANSWERS.fields);
  assert.deepEqual(fields, [
    { name: 'role', kind: 'choice', values: ['clerk', 'manager'] },
    { name: 'amount', kind: 'number', min: 1 },
    { name: 'limit', kind: 'number' },
  ]);
  assert.deepEqual(parseFields('score: number 0..100'), [{ name: 'score', kind: 'number', min: 0, max: 100 }]);
  const outcomes = parseOutcomes('approved or refused');
  assert.deepEqual(outcomes, ['approved', 'refused']);
  const { rules, otherwise } = parseRules(ANSWERS.rules, fields, outcomes);
  assert.equal(otherwise, 'refused');
  assert.deepEqual(rules[1].when, [{ field: 'amount', op: '<=', value: { field: 'limit' } }]);
  assert.deepEqual(parseCondition('amount is more than 1000', fields), { field: 'amount', op: '>', value: 1000 });
  assert.deepEqual(parseCondition('role is not clerk', fields), { field: 'role', op: 'is not', value: 'clerk' });
  const props = parseProperties('It should never be possible that when role is clerk and amount > limit then approved', fields, outcomes);
  assert.equal(props[0].kind, 'never');
  assert.equal(props[0].id, 'INV-001');
  assert.deepEqual(parseExamples('`clerk 1 2` -> approved'), [{ request: 'clerk 1 2', response: 'approved' }]);
  assert.equal(nameFromPurpose('Decide whether a payment request is approved'), 'payment-request-approved');
  assert.equal(nameFromPurpose('Payment approval: decide whether it is approved'), 'payment-approval');
});

test('a malformed answer names the problem and the fix', () => {
  const fields = parseFields(ANSWERS.fields);
  assert.throws(() => parseCondition('colour is red', fields), (e) => e instanceof SpecError && /not a field/.test(e.message));
  assert.throws(() => parseCondition('role is boss', fields), /not a choice of `role`; the choices are clerk, manager/);
  assert.throws(() => parseRules('when role is manager then approved', fields, ['approved', 'refused']), /otherwise/);
  assert.throws(() => parseOutcomes('yes'), /at least two/);
  assert.throws(() => validateSpec({ ...paymentSpec(), outcomes: ['invalid', 'ok'] }), /reserved/);
});

test('the evaluator decodes exactly the canonical requests the model decodes, and decides by the first matching rule', () => {
  const spec = paymentSpec();
  assert.equal(parseNumber('0'), 0n);
  for (const bad of ['07', '-1', '+1', '1.5', '', ' 1', '1000000000000000000', '١']) assert.equal(parseNumber(bad), null, bad);
  assert.equal(parseNumber('999999999999999999'), 999999999999999999n);
  assert.deepEqual(decodeRequest(spec, 'clerk 250 1000'), { role: 'clerk', amount: 250n, limit: 1000n });
  assert.equal(decodeRequest(spec, 'clerk 0 1000'), null, 'amount has a minimum of 1');
  assert.equal(decodeRequest(spec, 'clerk  250 1000'), null, 'two spaces');
  assert.deepEqual(judge(spec, decodeRequest(spec, 'manager 5000 10')), { outcome: 'approved', rule: 'REQ-001' });
  assert.deepEqual(judge(spec, decodeRequest(spec, 'clerk 11 10')), { outcome: 'refused', rule: null });
  assert.equal(respond(spec, enc('clerk 10 10')), 'approved');
  assert.equal(respond(spec, Uint8Array.of(0xff)), 'invalid');
  assert.equal(respond(spec, enc('x'.repeat(requestLimits(spec).requestMaximum + 1))), 'invalid');
});

test('a property the rules break has a counterexample; one they keep has none', () => {
  const spec = paymentSpec();
  for (const p of spec.properties) assert.equal(counterexample(spec, p).request, null, p.id);
  const broken = validateSpec({ ...spec, properties: [{ kind: 'never', when: [{ field: 'amount', op: '>', value: { field: 'limit' } }], then: 'approved' }] });
  const found = counterexample(broken, broken.properties[0]);
  assert.match(found.request, /^manager \d+ \d+$/);
  assert.equal(found.rule, 'REQ-001');
  const shadowed = validateSpec({ ...spec, rules: [spec.rules[0], { ...spec.rules[0], id: 'REQ-002' }] });
  assert.deepEqual(unreachableRules(shadowed), ['REQ-002']);
});

test('a rule is called unreachable only when every combination was tried', () => {
  // Seven fields: the sample stops long before the first field reaches `married`, yet
  // REQ-001 decides every married request. Claiming it never decides would be false.
  const word = (name) => ({ name, kind: 'choice', values: Array.from({ length: 8 }, (_, i) => `${name}${i}`) });
  const spec = validateSpec({
    purpose: 'decide by status first',
    fields: [{ name: 'status', kind: 'choice', values: ['single', 'head', 'married'] }, ...['a', 'b', 'c', 'd', 'e', 'f'].map(word)],
    outcomes: ['joint', 'alone'],
    rules: [{ when: [{ field: 'status', op: 'is', value: 'married' }], then: 'joint' }],
    otherwise: 'alone',
  });
  assert.deepEqual(unreachableRules(spec), []);
  assert.doesNotMatch((nextTurn(answersFromSpec(spec)).notes ?? []).join(' '), /never decides/, 'no note says REQ-001 never decides');
});

test('the model names every rule and property, states each property over decodable requests, and unfolds exactly what it needs', () => {
  const spec = paymentSpec();
  const n = names(spec);
  assert.equal(n.module, 'PaymentApproval');
  assert.equal(n.prefix, 'PrismPaymentApproval');
  const model = renderModel(spec);
  assert.match(model, /^\\begin\{lexlean\}\{PaymentApproval\}\n/);
  assert.match(model, /\\title\{Text application model\}/, 'a glossary phrase, so LLL1004 cannot occur');
  assert.doesNotMatch(model, /\r/);
  assert.equal(declarations(spec).filter((d) => d.kind === 'theorem').length, 0, 'the app module carries no proof, so the build never compiles one');
  assert.match(model, /recursive_argument: fuel/);
  const theorems = proofDeclarations(spec).filter((d) => d.kind === 'theorem');
  assert.deepEqual(theorems.map((t) => t.name), ['inv001Holds', 'inv002Holds']);
  const unfold = theorems[0].unfold;
  assert.deepEqual(unfold, [...unfold].sort(), 'linear_arithmetic needs its definitions sorted');
  assert.ok(['PaymentApproval::judge', 'PaymentApproval::rule1', 'PaymentApproval::roleClerk'].every((d) => unfold.includes(d)));
  const breaks = proofDeclarations(spec).find((d) => d.name === 'breaksInv001');
  assert.match(breaks.body, /\(1 <=\? \(project request amount\)\)/, 'the bound of amount is a hypothesis');
  assert.match(renderProofs(spec), /^\\begin\{lexlean\}\{PaymentApprovalProofs\}\n[\s\S]*\\importmodule\{PaymentApproval\}/);
  assert.equal(renderProofs({ ...spec, properties: [] }), null);
  assert.match(model, /entryRoot := "PrismPaymentApproval\.PaymentApproval\.dispatch"/);
  assert.match(renderModel(spec, { axioms: { judge: '[propext]' } }), /name: judge,[\s\S]*?axioms: \[propext\]/);
});

test('acceptance vectors agree with the evaluator and include the bound the text profile requires', () => {
  const spec = paymentSpec();
  const vectors = acceptanceVectors(spec);
  const { guestAllocationMaximum } = requestLimits(spec);
  assert.ok(vectors.some((v) => v.bytes.length === guestAllocationMaximum), 'PP2009 needs a vector exactly the guest allocation bound long');
  assert.ok(vectors.every((v) => v.bytes.length <= guestAllocationMaximum));
  for (const v of vectors) assert.equal(v.response, respond(spec, v.bytes));
  assert.ok(vectors.some((v) => v.why === 'example' && v.request === 'clerk 250 1000'));
  for (const outcome of ['approved', 'refused', 'invalid']) assert.ok(vectors.some((v) => v.response === outcome), outcome);
  assert.equal(new Set(vectors.map((v) => Buffer.from(v.bytes).toString('hex'))).size, vectors.length, 'no duplicates');
});

test('the session asks six questions, checks each answer, and can revise an earlier one', () => {
  assert.equal(nextTurn({}).step, 'purpose');
  const partial = { purpose: ANSWERS.purpose, fields: ANSWERS.fields };
  assert.equal(nextTurn(partial).step, 'outcomes');
  assert.match(nextTurn(partial).inferred, /payment-approval/);
  const broken = nextTurn({ ...ANSWERS, properties: 'never when amount > limit then approved' });
  assert.equal(broken.step, 'properties');
  assert.match(broken.issue, /INV-001 does not hold\. The request `manager \d+ \d+`/);
  const wrong = nextTurn({ ...ANSWERS, examples: 'clerk 250 1000 -> refused' });
  assert.equal(wrong.step, 'examples');
  assert.match(wrong.issue, /expects refused, but the rules answer approved, because REQ-002 decides it/);
  const review = nextTurn(ANSWERS);
  assert.equal(review.step, 'review');
  assert.ok(review.summary.split('\n').length <= 10);
  assert.equal(nextTurn({ ...ANSWERS, review: 'yes' }).step, 'ready');
  assert.equal(nextTurn({ ...ANSWERS, review: 'no, change the rules' }).step, 'review');
  const revised = nextTurn({ ...ANSWERS, fields: 'role: clerk|manager, amount: number' });
  assert.equal(revised.step, 'rules', 'rules naming a removed field are asked again');
});

test('a spec written as data joins the same flow and comes back the same', () => {
  const spec = paymentSpec();
  const again = compile({ ...answersFromSpec(spec), review: 'yes' }).spec;
  const strip = (s) => JSON.parse(JSON.stringify(s, (k, v) => (k === 'says' ? undefined : v)));
  assert.deepEqual(strip(again), strip(spec));
});

test('a property is stated only over choice codes a request can carry', () => {
  // role is clerk|manager, codes 0 and 1: every "breaks" test requires role < 2, or an
  // `always` property would fail on a code the decoder never yields.
  const spec = { ...paymentSpec(), properties: [{ kind: 'always', when: [{ field: 'amount', op: '>=', value: 1 }], then: 'approved' }] };
  const breaks = proofDeclarations(validateSpec(spec)).find((d) => d.kind === 'definition');
  assert.match(breaks.body, /\(\(project request \w+\) <\? 2\)/);
});

test('SPEC.md is an OpenSpec spec that says what is proved and what is tested', () => {
  const doc = renderSpecDocument(paymentSpec(), { properties: { 'INV-001': 'proved', 'INV-002': 'failing' } });
  assert.match(doc, /^# payment-approval Specification\n/);
  assert.match(doc, /\n## Purpose\n\nPayment approval: .*\.\n\n## Requirements\n/);
  assert.match(doc, /### Requirement: Never approved when role is clerk and amount is above limit\n\nThe app SHALL NOT answer `approved` when role is clerk and amount is above limit\.\n\nVerified: proved by Lean for every request \(INV-001/);
  assert.match(doc, /Verified: not proved: see the counterexample \(INV-002/);
  assert.match(doc, /#### Scenario: INV-001 holds\n\n- \*\*WHEN\*\* the request is `clerk \d+ \d+`.*\n- \*\*THEN\*\* the answer SHALL NOT be `approved`\n- \*\*AND\*\* the app answers `refused`/);
  assert.match(doc, /### Requirement: REQ-002 .*\n\nThe app SHALL answer `\w+` when .* and no earlier rule matches\./);
  assert.match(doc, /tested, not proved/);
  // Every requirement has a scenario, as OpenSpec requires.
  const requirements = doc.split('\n### Requirement:').slice(1);
  assert.ok(requirements.length >= spec3(paymentSpec()));
  for (const r of requirements) assert.match(r, /\n#### Scenario: .+\n\n- \*\*WHEN\*\* .+\n- \*\*THEN\*\* .+SHALL/);
});

/** A spec's requirements at least: one per property and rule, the fallback, and the request. */
const spec3 = (s) => s.properties.length + s.rules.length + 2;

test('reasons, meanings and limits survive the answers and reach the review and SPEC.md', () => {
  const base = paymentSpec();
  const spec = {
    ...base,
    fields: base.fields.map((f) => (f.name === 'limit' ? { ...f, means: 'the most a clerk may approve, in dollars' } : f)),
    meanings: { approved: 'pay it now' },
    rules: base.rules.map((r, i) => (i === 0 ? { ...r, why: 'a manager answers for any amount' } : r)),
    properties: base.properties.map((p, i) => (i === 0 ? { ...p, why: 'a clerk must not exceed their limit' } : p)),
    otherwiseWhy: 'anything unexpected is refused',
    limits: ['Fraud checks'],
  };
  const answers = answersFromSpec(spec);
  const review = nextTurn(answers);
  assert.equal(review.step, 'review');
  assert.match(review.summary, /INV-001: never approved when .*, because a clerk must not exceed their limit \(to be proved\)/);
  assert.match(review.summary, /REQ-001: .*, because a manager answers for any amount/);
  assert.match(review.summary, /limit \(number[^)]*; the most a clerk may approve, in dollars\)/);
  assert.match(review.summary, /approved \(pay it now\)/);
  assert.match(review.summary, /Out of scope: Fraud checks/);
  assert.ok(review.summary.indexOf('INV-001') < review.summary.indexOf('REQ-001'), 'guarantees come before rules');
  if (base.properties.length > 1) assert.match(review.notes.join(' '), /INV-002 has no reason/);
  const ready = nextTurn({ ...answers, review: 'yes' }).spec;
  const doc = renderSpecDocument(ready);
  assert.match(doc, /SHALL NOT answer `approved` when .*, because a clerk must not exceed their limit\./);
  assert.match(doc, /\| `limit` \| [^|]+ \| the most a clerk may approve, in dollars \|/);
  assert.match(doc, /\n## Out of scope\n\n- Fraud checks\n/);
  // A rule that changes loses its reason instead of keeping one that no longer fits.
  const revised = nextTurn({ ...answers, rules: answers.rules.replace(/^when [^\n]*/, (line) => line.replace(/then \w+$/, 'then refused')) });
  assert.ok(!(revised.spec ?? {}).rules?.[0]?.why);
});

test('diagnostics, axiom violations and step markers are read from the SDK output', () => {
  const output = [
    '@@step verify',
    'error[LLV7005]: `PrismPaymentApproval.PaymentApproval.inv001Holds` violates its exact axiom policy: observed [Quot.sound, propext]',
    '  --> lexlean.toml:1:1',
    "error[LLV7002]: Lean rejected `PrismX.X` (error): omega could not prove the goal:",
    'a possible counterexample may satisfy the constraints',
    '  --> src/X.lex.tex:74:1',
    '  note: generated location: $STAGING/lean-src/X.lean:43:12',
    '@@exit verify 1',
  ].join('\n');
  const d = parseDiagnostics(output);
  assert.equal(d.length, 2);
  assert.deepEqual(d[1].span, { file: 'src/X.lex.tex', line: 74, column: 1 });
  assert.deepEqual(axiomViolations(d), [{ name: 'inv001Holds', axioms: '[Quot.sound, propext]', forbidden: [] }]);
  assert.deepEqual(steps(output), [{ step: 'verify', code: 1 }]);
  const proofs = renderProofs(paymentSpec());
  const line = proofs.split('\n').findIndex((l) => l.startsWith('theorem{')) + 1;
  assert.equal(declarationAt(proofs, line), 'inv001Holds');
});

test('a build names each stage it enters, so a polling agent sees which one is running (#585)', () => {
  assert.match(BUILD_SCRIPT, /PRISMPM_PROGRESS=1 prismpm verify/);
  assert.equal(buildProgress('@@step build'), 'Stage: Building the app with prismpm verify.');
  assert.equal(buildProgress('@@step format'), 'Stage: Formatting the model.');
  assert.equal(buildProgress('prismpm: stage lean-proof'), 'Stage: Lean proof (lean-proof).');
  assert.equal(buildProgress('prismpm: stage lean4-prod-build'), 'Stage: Lean export (lean4-prod-build).');
  assert.equal(buildProgress('prismpm: stage cargo'), 'Stage: Rust (cargo).');
  assert.equal(buildProgress('prismpm: stage browser-core-wasm'), 'Stage: WebAssembly (browser-core-wasm).');
  assert.equal(buildProgress('prismpm: stage holo'), 'Stage: the holo (holo).');
  assert.equal(buildProgress('prismpm: stage text-cli-acceptance'), 'Stage: the acceptance run (text-cli-acceptance).');
  for (const line of ['@@exit build 0', 'error[PP5004]: application kernel', 'prismpm: stage', 'Compiling foo']) assert.equal(buildProgress(line), null, line);
});

test('the app lives in prism/, a hand edit of the model is noticed, and renaming follows the spec', () => {
  const root = scratch();
  const dir = appDir(root);
  assert.equal(dir, join(root, 'prism'));
  assert.ok(scaffold(dir).includes('lexlean.toml'));
  assert.deepEqual(scaffold(dir), [], 'scaffolding again writes nothing');
  const session = { ...readSession(dir), spec: paymentSpec(), status: {} };
  assert.equal(writeApp(dir, session).edited, false);
  assert.match(readFileSync(join(dir, 'lexlean.toml'), 'utf8'), /module_prefix = "PrismPaymentApproval"[\s\S]*entrypoints = \["src\/PaymentApproval\.lex\.tex"\]/);
  assert.match(readFileSync(join(dir, 'lakefile.toml'), 'utf8'), /name = "PrismPaymentApproval"/);
  assert.ok(!existsSync(join(dir, 'src', 'TextRequest.lex.tex')));
  assert.equal(readFileSync(join(dir, '.gitattributes'), 'utf8'), '* text eol=lf\n');
  session.status.modelSha = 'something else';
  assert.equal(writeApp(dir, session).edited, true);
  assert.equal(writeApp(dir, session, { overwrite: true }).edited, false);
  assert.ok(existsSync(modelPath(dir, session.spec)));
  assert.ok(existsSync(join(dir, 'src', 'PaymentApprovalProofs.lex.tex')));
  assert.doesNotMatch(readFileSync(join(dir, 'lexlean.toml'), 'utf8'), /Proofs/, 'the proofs module is not a build entrypoint');
});

test('agents start the server with this package, or with npx at this version from the npx cache', () => {
  const context = (sourceDir, platform = 'linux') => ({ sourceDir, platform, node: '/usr/bin/node' });
  assert.deepEqual(journeyServer(context('/repo/sdk/npm/prism-code/src')), { command: '/usr/bin/node', args: [join('/repo/sdk/npm/prism-code/src', '..', 'bin', 'prism-code.mjs'), 'mcp'] });
  assert.equal(journeyServer(context('/home/u/.npm/_npx/abc/node_modules/prism-code/src')).command, 'npx');
  assert.deepEqual(journeyServer(context('C:\\npm-cache\\_npx\\abc\\node_modules\\prism-code\\src', 'win32')).args.slice(0, 3), ['/c', 'npx', '-y']);
});

function mcp(cwd) {
  const sent = [];
  const server = createServer({ cwd, send: (m) => sent.push(m) });
  let id = 0;
  return {
    async call(method, params) {
      const n = ++id;
      await server.handle({ jsonrpc: '2.0', id: n, method, params });
      return sent.find((m) => m.id === n);
    },
    async tool(name, args = {}) {
      return (await this.call('tools/call', { name, arguments: args })).result;
    },
  };
}

test('the MCP server greets, asks, records answers and refuses to build an unfinished spec', async () => {
  const root = scratch();
  const s = mcp(root);
  const init = await s.call('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 't', version: '0' } });
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.instructions, INSTRUCTIONS);
  assert.ok(INSTRUCTIONS.split(/\s+/).length < 150);
  const tools = (await s.call('tools/list')).result.tools.map((t) => t.name);
  assert.deepEqual(tools, ['prism_start', 'prism_answer', 'prism_spec', 'prism_prove', 'prism_build', 'prism_try', 'prism_status']);
  const specInput = (await s.call('tools/list')).result.tools.find((t) => t.name === 'prism_spec').inputSchema.properties.spec;
  // prism/spec/1 first, then prism/spec/2 for an app that keeps state.
  assert.deepEqual(specInput.anyOf[0].required, ['fields', 'rules', 'otherwise'], 'a draft needs only what the user said');
  assert.deepEqual(specInput.anyOf[1].required, ['schema', 'purpose', 'state', 'outcomes', 'actions']);
  const start = await s.tool('prism_start');
  assert.match(start.structuredContent.greeting, /draft the spec for your approval/);
  assert.equal(start.structuredContent.step, 'purpose');
  const blocked = await s.tool('prism_build');
  assert.equal(blocked.isError, true);
  assert.equal(blocked.structuredContent.state, 'blocked');
  for (const step of ['purpose', 'fields', 'outcomes', 'rules', 'properties', 'examples']) await s.tool('prism_answer', { answer: ANSWERS[step] });
  const review = await s.tool('prism_answer', { answer: 'yes' });
  assert.equal(review.structuredContent.step, 'ready');
  assert.ok(existsSync(join(root, 'prism', 'spec.json')) && existsSync(join(root, 'prism', 'SPEC.md')));
  const tried = await s.tool('prism_try', { request: 'clerk 1001 1000' });
  assert.deepEqual([tried.structuredContent.answer, tried.structuredContent.decidedBy], ['refused', 'otherwise']);
  const resumed = await mcp(root).tool('prism_start');
  assert.match(resumed.structuredContent.greeting, /Welcome back/);
  const changed = await s.tool('prism_answer', { step: 'examples', answer: 'clerk 250 1000 -> refused' });
  assert.match(changed.structuredContent.issue, /REQ-002/);
  assert.equal((await s.call('tools/call', { name: 'nope', arguments: {} })).error.code, -32602);
  assert.equal((await s.call('no/such')).error.code, -32601);
  assert.match((await s.call('resources/read', { uri: 'prism://spec' })).result.contents[0].text, /# payment-approval Specification/);
  assert.match((await s.call('prompts/get', { name: 'prism' })).result.messages[0].content.text, /prism_start/);
});

test('a whole spec given as data is checked like answers', async () => {
  const s = mcp(scratch());
  const r = await s.tool('prism_spec', { spec: { ...paymentSpec(), properties: [{ kind: 'never', when: [{ field: 'amount', op: '>', value: { field: 'limit' } }], then: 'approved' }] } });
  assert.equal(r.structuredContent.step, 'properties');
  assert.match(r.structuredContent.issue, /does not hold/);
  const ok = await s.tool('prism_spec', { spec: paymentSpec() });
  assert.equal(ok.structuredContent.step, 'review');
  assert.equal((await s.tool('prism_build')).structuredContent.state, 'blocked', 'a drafted spec is not built before the user approves it');
  assert.equal((await s.tool('prism_answer', { answer: 'yes' })).structuredContent.step, 'ready');
});

test('mcp serves over stdio', () => {
  const root = scratch();
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2099-01-01', capabilities: {}, clientInfo: { name: 't', version: '0' } } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'prism_start', arguments: {} } },
  ].map((m) => JSON.stringify(m)).join('\n');
  const r = spawnSync(process.execPath, [bin, 'mcp'], { cwd: root, input: `${input}\nnot json\n`, encoding: 'utf8' });
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.find((m) => m.id === 1).result.protocolVersion, '2025-06-18', 'an unknown version gets the newest');
  assert.equal(lines.find((m) => m.id === 2).result.structuredContent.step, 'purpose');
  assert.equal(lines.find((m) => m.id === null).error.code, -32700);
});

test('the review lists every property, and a rule example uses a number the field can hold', () => {
  const many = {
    ...ANSWERS,
    rules: 'when role is manager then approved\nwhen amount <= limit then approved\nwhen amount < 5 then approved\nwhen limit > 1000000 then approved\notherwise refused',
    properties: 'never when role is clerk and amount > limit and amount > 4 and limit <= 1000000 then approved\nalways when role is manager then approved\nalways when amount <= limit then approved',
  };
  const review = nextTurn(many);
  assert.equal(review.step, 'review');
  for (const id of ['INV-001', 'INV-002', 'INV-003']) assert.match(review.summary, new RegExp(id));
  const ages = nextTurn({ purpose: 'Ticket price: decide a ticket.', fields: 'age: number 0..120', outcomes: 'child, adult' });
  assert.equal(ages.step, 'rules');
  assert.match(ages.example, /age <= 60/);
  assert.doesNotMatch(ages.example, /1000/);
});

test('a build another live Prism server is running is not started twice, and an unchanged spec is not rebuilt', async () => {
  const root = scratch();
  const s = mcp(root);
  await s.tool('prism_spec', { spec: paymentSpec() });
  await s.tool('prism_answer', { answer: 'yes' });
  const dir = join(root, 'prism');
  const session = readSession(dir);
  session.status.job = { kind: 'build', pid: process.pid === 1 ? 2 : 1, started: Date.now() - 5000 };
  writeFileSync(join(dir, 'session.json'), JSON.stringify({ ...session, status: { ...session.status, job: { ...session.status.job, pid: process.ppid } } }));
  const busy = await mcp(root).tool('prism_build', { wait: 0 });
  assert.equal(busy.structuredContent.state, 'running');
  assert.match(busy.structuredContent.next, /another Prism server/);
  const holo = join(root, 'App.holo');
  writeFileSync(holo, 'x');
  const done = readSession(dir);
  delete done.status.job;
  done.status.lastSpec = JSON.stringify(done.spec);
  done.status.modelSha = 'abc';
  done.status.lastBuild = { modelSha: 'abc', holo, result: { ok: true, message: 'Built.', holo } };
  writeFileSync(join(dir, 'session.json'), JSON.stringify(done));
  const again = await mcp(root).tool('prism_build', { wait: 0 });
  assert.equal(again.structuredContent.state, 'done');
  assert.match(again.structuredContent.note, /not built again/);
});

test('an app named like a namespace LexLean reserves gets a module it accepts', async () => {
  // Measured on 2026-11-16: an app titled "Result" was refused at the proof (LLT4001), as a Prism bug.
  const { moduleName, RESERVED_MODULE_NAMES, names } = await import('../src/journey/render.mjs');
  assert.equal(moduleName({ name: 'result' }), 'ResultApp');
  assert.equal(moduleName({ name: 'list' }), 'ListApp');
  assert.equal(moduleName({ name: 'lex-lean-core' }), 'LexLeanCoreApp');
  assert.equal(moduleName({ name: 'shipping-method' }), 'ShippingMethod');
  assert.equal(moduleName({ name: 'result-checker' }), 'ResultChecker');
  assert.equal(names(compile({ ...ANSWERS, purpose: 'Result: decide whether a payment request is approved.', review: 'yes' }).spec).module, 'ResultApp');
  // The set is LexLean's own, read from the vendored compiler where this repository has it.
  const source = (path) => readFileSync(new URL(`../../../../${path}`, import.meta.url), 'utf8');
  const strings = (text, name) => {
    const start = text.indexOf(`${name}: [&str;`);
    const list = text.slice(text.indexOf('= [', start) + 3, text.indexOf('];', start));
    return [...list.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
  };
  if (existsSync(new URL('../../../../vendor/lexlean/src/ir/semantic.rs', import.meta.url))) {
    const semantic = source('vendor/lexlean/src/ir/semantic.rs');
    const config = source('vendor/lexlean/src/config.rs');
    const reserved = [...strings(semantic, 'BACKEND_BARE_NAMES'), ...strings(semantic, 'QUALIFIED_NAMESPACES'), ...strings(config, 'SHIPPED_ROOTS'), ...strings(config, 'LIBRARY_ROOTS')];
    for (const name of reserved.filter((x) => /^[A-Z][A-Za-z0-9]*$/.test(x))) assert.ok(RESERVED_MODULE_NAMES.has(name) || /^LexLean/.test(name), `${name} is reserved by LexLean`);
  }
});
