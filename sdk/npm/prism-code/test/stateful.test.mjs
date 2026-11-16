// prism/spec/2: an app that keeps state. The same strict reading, the same canonical bytes, the same
// seal as prism/spec/1; a state machine whose properties Lean proves over every reachable state.
// Each gate here is held by a planted defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecError, validateSpec } from '../src/journey/spec.mjs';
import { readSpecFile } from '../src/journey/spec-file.mjs';
import { SPEC_SEAL_MARK, acceptanceVectors, describedBy, names, renderModel, renderProofs, renderSpecDocument } from '../src/journey/render.mjs';
import { STATEFUL_REFUSALS, act, initialState, reachableStates, respondSession, runSession, statefulCounterexample } from '../src/journey/stateful.mjs';
import { checkSpecBinding, specAddressOf } from '../src/journey/binding.mjs';
import { modelMismatches, writeApp } from '../src/journey/project.mjs';
import { createServer } from '../src/journey/mcp.mjs';
import { tryRequest } from '../src/journey/engine.mjs';

const FIXTURE = readFileSync(new URL('./fixtures/stateful/dinner-seats.spec.json', import.meta.url), 'utf8');
const SPEC = Object.freeze(JSON.parse(FIXTURE));
const clone = (patch = (s) => s) => patch(structuredClone(SPEC));
const text = (value = SPEC) => JSON.stringify(value);
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-stateful-'));
const enc = (s) => new TextEncoder().encode(s);
const refusedWith = (input, rule, where) =>
  assert.throws(() => readSpecFile(input), (error) => {
    assert.ok(error instanceof SpecError, String(error));
    assert.equal(error.rule, rule, error.message);
    if (where) assert.equal(error.where, where, error.message);
    return true;
  });

test('a stateful spec reads strictly and fills in only what prism/spec/2 defines by default', () => {
  const { spec, text: canonical } = readSpecFile(FIXTURE);
  assert.equal(spec.schema, 'prism/spec/2');
  assert.deepEqual(spec.state.map((f) => f.start), [0, 'open'], 'a number starts at its min, a choice at its first value');
  assert.deepEqual(spec.actions.flatMap((a) => a.rules.map((r) => r.id)), ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004'], 'rule ids run across the actions');
  assert.deepEqual(spec.properties.map((p) => p.id), ['INV-001', 'INV-002', 'INV-003']);
  assert.equal(readSpecFile(canonical).text, canonical, 'reading the canonical bytes again gives the same bytes');
});

test('the same JSON gives the same spec.json bytes, address and LexLean, whatever its key order and spacing', () => {
  const reordered = Object.fromEntries(Object.entries(SPEC).reverse());
  const a = readSpecFile(FIXTURE);
  const b = readSpecFile(JSON.stringify(reordered, null, 7));
  assert.equal(a.text, b.text);
  assert.equal(a.specAddress, b.specAddress);
  assert.equal(renderModel(a.spec, { specAddress: a.specAddress }), renderModel(b.spec, { specAddress: b.specAddress }));
  assert.equal(renderProofs(a.spec), renderProofs(b.spec));
  assert.equal(renderSpecDocument(a.spec), renderSpecDocument(b.spec));
  // Rendering is a function of the spec alone: twice gives the same bytes.
  assert.equal(renderModel(a.spec, { specAddress: a.specAddress }), renderModel(readSpecFile(FIXTURE).spec, { specAddress: a.specAddress }));
  // Any change to the JSON changes the address, and so the seal the model carries.
  const c = readSpecFile(text(clone((s) => ((s.actions[0].rules[1].why = 'a party that fits is booked'), s))));
  assert.notEqual(c.specAddress, a.specAddress);
  assert.notEqual(renderModel(c.spec, { specAddress: c.specAddress }), renderModel(a.spec, { specAddress: a.specAddress }));
  // A change of behaviour changes the model itself.
  const d = readSpecFile(text(clone((s) => ((s.actions[1].otherwise = 'full'), s))));
  assert.notEqual(renderModel(d.spec), renderModel(a.spec));
});

test('every rule the stateful code refuses by is in STATEFUL_REFUSALS or the shared REFUSALS, and fits the gateway grammar', async () => {
  const { REFUSALS } = await import('../src/journey/spec.mjs');
  const source = readFileSync(new URL('../src/journey/stateful.mjs', import.meta.url), 'utf8');
  const pattern = /(?:refuse\(|new SpecError\().*, '([a-z]+\.[a-z-]+)'\);/g;
  const named = new Set([...source.matchAll(pattern)].map((m) => m[1]));
  const calls = (source.match(/\brefuse\(|new SpecError\(/g) ?? []).length - 1;
  assert.equal([...source.matchAll(pattern)].length, calls, 'every refusal names its rule');
  for (const r of named) assert.ok(STATEFUL_REFUSALS.includes(r) || REFUSALS.includes(r), `rule ${r} is registered`);
  for (const r of STATEFUL_REFUSALS) assert.ok(named.has(r), `listed rule ${r} is one the code names`);
  for (const r of STATEFUL_REFUSALS) assert.ok(!REFUSALS.includes(r), `${r} is listed once`);
  const word = /^[a-z]+(?:-[a-z]+)*$/;
  for (const r of STATEFUL_REFUSALS) assert.ok(r.split('.').length === 2 && r.split('.').every((w) => word.test(w) && w.length <= 24), r);
});

test('G1 planted defects: what prism/spec/2 cannot carry is refused, naming the rule', () => {
  const cases = [
    ['a member the spec does not define', clone((s) => ((s.fields = []), s)), 'json.member', '$.fields'],
    ['a member of a rule it does not define', clone((s) => ((s.actions[0].rules[0].otherwise = 'x'), s)), 'json.member', '$.actions[0].rules[0].otherwise'],
    ['no state', clone((s) => ((s.state = []), s)), 'state.none'],
    ['an unbounded number in the state', clone((s) => (delete s.state[0].max, s)), 'state.bound'],
    ['a start outside the bounds', clone((s) => ((s.state[0].start = 13), s)), 'state.start'],
    ['a start that is not a choice', clone((s) => ((s.state[1].start = 'ajar'), s)), 'state.start'],
    ['no action', clone((s) => ((s.actions = []), s)), 'actions.none'],
    ['an action named twice', clone((s) => ((s.actions[1].name = 'book'), s)), 'action.duplicate'],
    ['an input named as the state', clone((s) => ((s.actions[0].inputs[0].name = 'booked'), s)), 'input.clash'],
    ['a change to an input', clone((s) => ((s.actions[0].rules[1].change[0].field = 'seats'), s)), 'change.unknown-field'],
    ['a choice added to', clone((s) => ((s.actions[2].rules[0].change[0].op = 'add'), s)), 'change.op'],
    ['a set outside the bounds', clone((s) => ((s.actions[2].rules[0].change = [{ field: 'booked', op: 'set', value: 99 }]), s)), 'change.bound'],
    ['a value changed twice', clone((s) => (s.actions[1].rules[0].change.push({ field: 'booked', op: 'add', value: 1 }), s)), 'change.duplicate'],
    ['a condition on an unknown name', clone((s) => ((s.actions[0].rules[0].when[0].field = 'room'), s)), 'condition.unknown-field'],
    ['no otherwise', clone((s) => (delete s.actions[0].otherwise, s)), 'rules.otherwise'],
    ['an answer that is not an outcome', clone((s) => ((s.actions[0].rules[0].then = 'maybe'), s)), 'outcome.unknown'],
    ['a state property naming an input', clone((s) => ((s.properties[0].when[0].field = 'seats'), s)), 'condition.unknown-field'],
    ['a property with then and no action', clone((s) => (delete s.properties[1].action, s)), 'property.action'],
    ['a property on an unknown action', clone((s) => ((s.properties[1].action = 'sell'), s)), 'property.action'],
    ['an example with a step per answer missing', clone((s) => (s.examples[0].answers.pop(), s)), 'examples.format'],
    ['an example step with a semicolon', clone((s) => ((s.examples[0].steps[0] = 'book 4;book 1'), s)), 'example.step'],
    ['an example the rules contradict', clone((s) => ((s.examples[0].answers[2] = 'booked'), s)), 'example.disagrees'],
    ['an outcome named invalid', clone((s) => (s.outcomes.push('invalid'), s)), 'outcomes.reserved'],
  ];
  for (const [why, spec, rule, where] of cases) {
    try {
      readSpecFile(text(spec));
      assert.fail(`${why}: accepted`);
    } catch (error) {
      assert.ok(error instanceof SpecError, `${why}: ${error}`);
      assert.equal(error.rule, rule, `${why}: ${error.message}`);
      if (where) assert.equal(error.where, where, why);
    }
  }
  refusedWith(text(clone((s) => ((s.schema = 'prism/spec/3'), s))), 'spec.schema');
});

test('an example the rules contradict says which step and which rule decides it', () => {
  assert.throws(() => validateSpec(clone((s) => ((s.examples[0].answers[2] = 'booked'), s))), /step 3 \(`book 3`\) to answer booked, but it answers full, by otherwise/);
});

test('the evaluator: the first rule whose conditions hold and whose changes fit decides; otherwise changes nothing', () => {
  const spec = validateSpec(SPEC);
  const [book, cancel, close] = spec.actions;
  const start = initialState(spec);
  assert.deepEqual(start, { booked: 0n, list: 'open' });
  assert.deepEqual(act(spec, start, book, { seats: 6n }), { state: { booked: 6n, list: 'open' }, outcome: 'booked', rule: 'REQ-002' });
  // The add would take booked past 12, so REQ-002 does not apply and otherwise answers, changing nothing.
  assert.deepEqual(act(spec, { booked: 10n, list: 'open' }, book, { seats: 3n }), { state: { booked: 10n, list: 'open' }, outcome: 'full', rule: null });
  // The subtract would take booked below 0.
  assert.equal(act(spec, start, cancel, { seats: 1n }).outcome, 'nothing');
  assert.equal(act(spec, start, close, {}).state.list, 'closed');
  assert.deepEqual(runSession(spec, ['book 4', 'boom', 'book 1']).map((r) => r.outcome), ['booked', 'invalid', 'invalid'], 'a malformed step breaks the rest of the session');
});

test('a session is one request: steps separated by ;, answered with the last outcome and the state', () => {
  const spec = validateSpec(SPEC);
  const answer = (s) => respondSession(spec, enc(s));
  assert.equal(answer('book 4;book 6;book 3'), 'full booked=10 list=open');
  assert.equal(answer('book 4;close;book 1'), 'closed booked=4 list=closed');
  for (const bad of ['', 'book', 'book 4;', 'book 4;;book 1', ' book 4', 'book  4', 'book 04', 'book 7', 'book 0', 'close now', 'x'.repeat(1025)]) assert.equal(answer(bad), 'invalid', JSON.stringify(bad));
  assert.equal(respondSession(spec, Uint8Array.of(0xff)), 'invalid');
});

test('the search finds a session that breaks a false property, and none for a true one', () => {
  const spec = validateSpec(SPEC);
  for (const p of spec.properties) assert.equal(statefulCounterexample(spec, p).steps, null, p.id);
  const lax = validateSpec(clone((s) => ((s.properties[0].when[0].value = 9), s)));
  const found = statefulCounterexample(lax, lax.properties[0]);
  assert.ok(found.steps, 'booked can pass 9');
  assert.match(respondSession(lax, enc(found.steps.join(';'))), /booked=1[0-2] /);
  const wrong = validateSpec(clone((s) => ((s.properties[1].then = 'closed'), s)));
  const broken = statefulCounterexample(wrong, wrong.properties[1]);
  assert.deepEqual(broken.steps.at(-1).split(' ')[0], 'book');
  assert.equal(broken.outcome, 'closed');
  assert.ok(reachableStates(spec).length >= 26, 'every booked value, open and closed, is reachable');
});

test('the model and its proofs: one theorem per obligation, every one linear_arithmetic', () => {
  const read = readSpecFile(FIXTURE);
  const n = names(read.spec);
  const model = renderModel(read.spec, { specAddress: read.specAddress });
  const proofs = renderProofs(read.spec);
  for (const d of ['structure{\n  name: State', 'name: afterBook', 'name: replyBook', 'name: afterCancel', 'name: replay', 'name: dispatch', 'name: application']) assert.ok(model.includes(d), d);
  assert.ok(!/theorem\{/.test(model), 'the app module the guest is built from proves nothing, so the build never runs omega');
  const theorems = [...proofs.matchAll(/theorem\{\n  name: (\w+)/g)].map((m) => m[1]);
  assert.deepEqual(theorems, ['startInBounds', 'inv001AtStart', 'bookKeepsBounds', 'inv001KeptByBook', 'inv002Holds', 'inv003Holds', 'cancelKeepsBounds', 'inv001KeptByCancel', 'closeKeepsBounds', 'inv001KeptByClose']);
  assert.deepEqual(n.properties['INV-001'].theorems, ['inv001AtStart', 'inv001KeptByBook', 'inv001KeptByCancel', 'inv001KeptByClose']);
  assert.equal((proofs.match(/proof: linear_arithmetic\{/g) ?? []).length, theorems.length);
  assert.ok(!/sorry|native_decide|decide\b/.test(proofs));
  // A spec with no property still proves its bounds.
  const bare = readSpecFile(text(clone((s) => ((s.properties = []), s))));
  assert.match(renderProofs(bare.spec), /name: startInBounds/);
});

test('the acceptance vectors are the evaluator\'s answers: every example prefix, every rule, and malformed sessions', () => {
  const spec = validateSpec(SPEC);
  const vectors = acceptanceVectors(spec);
  for (const v of vectors) assert.equal(v.response, respondSession(spec, v.bytes), v.why);
  const by = Object.fromEntries(vectors.map((v) => [v.request, v.response]));
  assert.equal(by['book 4;book 6;book 3;cancel 2;book 3;close;book 1'], 'closed booked=11 list=closed');
  for (const id of ['REQ-001', 'REQ-002', 'REQ-003', 'REQ-004']) assert.ok(vectors.some((v) => v.why === `decided by ${id}`), id);
  for (const why of ['empty session', 'not UTF-8', 'a trailing semicolon', 'exactly the guest allocation bound']) assert.ok(vectors.some((v) => v.why === why && v.response === 'invalid'), why);
  assert.equal(vectors.find((v) => v.why === 'exactly the guest allocation bound').bytes.length, 2048);
});

// The seal: a stateful app carries the UOR content address of its spec.json exactly as a decision app does.
const sealedHolo = (described) => ({ blobs: [{ content: enc('not json') }, { content: enc(JSON.stringify({ application: { cargo_description: described } })) }] });

test('the seal: the model carries [prism/spec/2 <address>], and the holo is bound, unbound or built from another spec', () => {
  const read = readSpecFile(FIXTURE);
  const model = renderModel(read.spec, { specAddress: read.specAddress });
  assert.equal(SPEC_SEAL_MARK.exec(model)?.[1], read.specAddress);
  assert.ok(model.includes(`[prism/spec/2 ${read.specAddress}]`), 'the mark names the schema the spec is read by');
  const holo = sealedHolo(describedBy(read.spec, read.specAddress));
  assert.equal(specAddressOf(holo), read.specAddress);
  const bound = checkSpecBinding(holo, FIXTURE);
  assert.deepEqual([bound.ok, bound.reason], [true, 'bound']);
  // Planted defect: the same app held to a spec it was not built from.
  const mismatch = checkSpecBinding(holo, text(clone((s) => ((s.state[0].max = 11), s))));
  assert.deepEqual([mismatch.ok, mismatch.reason], [false, 'mismatch']);
  // Planted defect: an app with no seal cannot claim a spec.
  const unbound = checkSpecBinding(sealedHolo(read.spec.purpose), FIXTURE);
  assert.deepEqual([unbound.ok, unbound.reason], [false, 'unbound']);
  // Planted defect: a schema the reader does not know is no seal.
  assert.equal(specAddressOf(sealedHolo(`Purpose. [prism/spec/3 ${read.specAddress}]`)), null);
});

test('the model on disk is exactly what spec.json renders to, and an edited model is refused', () => {
  const dir = scratch();
  const session = { spec: readSpecFile(FIXTURE).spec, status: {}, axioms: {} };
  writeApp(dir, session);
  const n = names(session.spec);
  assert.ok(existsSync(join(dir, 'src', `${n.module}.lex.tex`)));
  assert.ok(existsSync(join(dir, 'src', `${n.proofs}.lex.tex`)));
  assert.deepEqual(modelMismatches(dir), []);
  assert.match(readFileSync(join(dir, 'SPEC.md'), 'utf8'), /Requirement: The state stays within its bounds/);
});

function mcp(cwd) {
  const sent = [];
  const server = createServer({ cwd, send: (m) => sent.push(m) });
  let id = 0;
  return async (name, args = {}) => {
    const n = ++id;
    await server.handle({ jsonrpc: '2.0', id: n, method: 'tools/call', params: { name, arguments: args } });
    return sent.find((m) => m.id === n).result;
  };
}

test('an agent writes only JSON: prism_spec takes a prism/spec/2 spec to review, and approval makes it ready', async () => {
  const root = scratch();
  const tool = mcp(root);
  const set = (await tool('prism_spec', { spec: SPEC })).structuredContent;
  assert.equal(set.step, 'review', JSON.stringify(set));
  assert.match(set.summary, /INV-001: In every reachable state, booked is at most 12, because the room has twelve seats \(to be proved\)/);
  assert.match(set.summary, /Action book <seats: number from 1 up to 6>/);
  const onDisk = readFileSync(join(root, 'prism', 'spec.json'), 'utf8');
  assert.equal(onDisk, readSpecFile(FIXTURE).text, 'spec.json is the canonical bytes');
  const ready = (await tool('prism_answer', { answer: 'yes' })).structuredContent;
  assert.equal(ready.step, 'ready');
  const read = (await tool('prism_spec')).structuredContent;
  assert.equal(read.spec.schema, 'prism/spec/2');
  // A property the rules break is found before Lean is asked.
  const broken = (await tool('prism_spec', { spec: clone((s) => ((s.properties[0].when[0].value = 9), s)) })).structuredContent;
  assert.match(broken.issue, /INV-001 does not hold\. The session `[^`]+` reaches the state 1[0-2] /);
  // A member prism/spec/2 does not define is refused as it is for spec.json.
  const r = await tool('prism_spec', { spec: { ...SPEC, fields: [] } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /\$\.fields.*is not a member of prism\/spec\/2/);
});

test('the MCP server tells a model about prism/spec/2 and declares its shape', async () => {
  const { INSTRUCTIONS } = await import('../src/journey/mcp.mjs');
  assert.match(INSTRUCTIONS, /prism\/spec\/2/);
  assert.match(INSTRUCTIONS, /Never write LexLean/);
  const sent = [];
  const server = createServer({ cwd: scratch(), send: (m) => sent.push(m) });
  await server.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' });
  const spec = sent[0].result.tools.find((t) => t.name === 'prism_spec').inputSchema.properties.spec;
  assert.deepEqual(spec.anyOf.map((s) => s.properties.schema?.enum?.[0] ?? 'prism/spec/1'), ['prism/spec/1', 'prism/spec/2']);
});

test('prism_try answers a session from the spec, step by step', async () => {
  const r = await tryRequest({ spec: validateSpec(SPEC), status: {} }, 'book 4;book 9');
  assert.equal(r.answer, 'invalid', 'seats are at most 6');
  const ok = await tryRequest({ spec: validateSpec(SPEC), status: {} }, 'book 4;book 6;book 3');
  assert.equal(ok.answer, 'full booked=10 list=open');
  assert.deepEqual(ok.steps.map((s) => s.decidedBy), ['REQ-002', 'REQ-002', 'otherwise']);
});
