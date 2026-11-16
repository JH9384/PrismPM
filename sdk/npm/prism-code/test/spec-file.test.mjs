// prism/spec.json is the one input of every Prism app: an agent writes or edits it as JSON, and
// everything after is a function of its bytes. Each gate here is held by a planted defect.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SpecError } from '../src/journey/spec.mjs';
import { canonicalJson, readSpecFile } from '../src/journey/spec-file.mjs';
import { renderModel, renderProofs } from '../src/journey/render.mjs';
import { modelMismatches, readProjectSpec, writeApp } from '../src/journey/project.mjs';
import { build } from '../src/journey/engine.mjs';
import { createServer } from '../src/journey/mcp.mjs';

const SPEC = Object.freeze({
  purpose: 'Decide whether a payment request is approved.',
  fields: [
    { name: 'role', kind: 'choice', values: ['clerk', 'manager'] },
    { name: 'amount', kind: 'number', min: 1, max: 1000000 },
    { name: 'limit', kind: 'number', max: 1000000 },
  ],
  outcomes: ['approved', 'refused'],
  rules: [
    { when: [{ field: 'role', op: 'is', value: 'manager' }], then: 'approved', why: 'A manager answers for any amount.' },
    { when: [{ field: 'amount', op: '<=', value: { field: 'limit' } }], then: 'approved', why: 'A clerk may approve up to the limit.' },
  ],
  otherwise: 'refused',
  properties: [{ kind: 'never', when: [{ field: 'role', op: 'is', value: 'clerk' }, { field: 'amount', op: '>', value: { field: 'limit' } }], then: 'approved', why: 'A clerk must not exceed their limit.' }],
  examples: [{ request: 'clerk 250 1000', response: 'approved' }],
});
const text = (value = SPEC) => JSON.stringify(value);
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-spec-file-'));
const refusedWith = (input, rule, where) =>
  assert.throws(() => readSpecFile(input), (error) => {
    assert.ok(error instanceof SpecError, String(error));
    assert.equal(error.rule, rule, error.message);
    if (where) assert.equal(error.where, where, error.message);
    return true;
  });

test('the same JSON gives the same spec.json bytes, hash and LexLean, whatever its key order and spacing', () => {
  const a = readSpecFile(text());
  const reordered = Object.fromEntries(Object.entries(structuredClone(SPEC)).reverse());
  const b = readSpecFile(JSON.stringify(reordered, null, 4));
  assert.equal(a.text, b.text);
  assert.equal(a.specHash, b.specHash);
  assert.match(a.specHash, /^sha256:[0-9a-f]{64}$/);
  assert.equal(renderModel(a.spec) + renderProofs(a.spec), renderModel(b.spec) + renderProofs(b.spec));
  // Reading the canonical bytes again gives them back: spec.json is a fixed point.
  assert.equal(readSpecFile(a.text).text, a.text);
  assert.equal(a.text, canonicalJson(JSON.parse(a.text)));
});

test('a change to the meaning of the JSON changes the hash and the LexLean', () => {
  const a = readSpecFile(text());
  const changed = structuredClone(SPEC);
  changed.rules[1].when[0].op = '<';
  const b = readSpecFile(text(changed));
  assert.notEqual(a.specHash, b.specHash);
  assert.notEqual(renderModel(a.spec), renderModel(b.spec));
});

// G1: closed value sets.
const DEFECTS = [
  ['a member the spec does not define', text({ ...SPEC, color: 'red' }), 'json.member', '$.color'],
  ['a member a rule does not define', text({ ...SPEC, rules: [{ ...SPEC.rules[0], weight: 2 }, SPEC.rules[1]] }), 'json.member', '$.rules[0].weight'],
  ['a duplicate key', text().replace('"otherwise":"refused"', '"otherwise":"refused","otherwise":"approved"'), 'json.duplicate', '$.otherwise'],
  ['a float', text().replace('"min":1,', '"min":1.5,'), 'json.number', '$.fields[1].min'],
  ['an integer above 2^53', text().replace('"min":1,', '"min":9007199254740993,'), 'json.number', '$.fields[1].min'],
  ['an exponent', text().replace('"max":1000000}', '"max":1e6}'), 'json.number', '$.fields[1].max'],
  ['a value outside its set', text({ ...SPEC, otherwise: 'maybe' }), 'rules.otherwise', null],
  ['a choice the field does not have', text({ ...SPEC, rules: [{ when: [{ field: 'role', op: 'is', value: 'boss' }], then: 'approved' }] }), 'choice.value', null],
  ['an operator outside its set', text({ ...SPEC, rules: [{ when: [{ field: 'amount', op: '=>', value: 3 }], then: 'approved' }] }), 'condition.comparison', null],
  ['text that is not JSON', text().slice(0, -1), 'json.syntax', '$'],
  ['a quote in the title', text({ ...SPEC, title: 'Pay "now"' }), 'text.character', 'title'],
];
for (const [name, input, rule, where] of DEFECTS) {
  test(`G1 planted defect: ${name} is refused as ${rule}`, () => refusedWith(input, rule, where));
}

test('G1 planted defect: an agent passing a parsed value is held to the same rules', () => {
  refusedWith({ ...SPEC, color: 'red' }, 'json.member', '$.color');
  refusedWith({ ...SPEC, fields: [SPEC.fields[0], { ...SPEC.fields[1], min: 1.5 }, SPEC.fields[2]] }, 'json.number');
});

function appWith(spec = SPEC) {
  const root = scratch();
  const dir = join(root, 'prism');
  const session = { schema: 'prism/session/1', step: 'ready', answers: {}, spec: readSpecFile(spec).spec, axioms: {}, status: {} };
  writeApp(dir, session, { overwrite: true });
  return { root, dir, session };
}

test('the model on disk is exactly what spec.json renders to, and spec.json is canonical bytes', () => {
  const { dir, session } = appWith();
  assert.deepEqual(modelMismatches(dir), []);
  const onDisk = readFileSync(join(dir, 'spec.json'), 'utf8');
  assert.equal(onDisk, readSpecFile(SPEC).text);
  assert.equal(readProjectSpec(dir).specHash, session.status.specHash);
});

// G8: a model that did not come from spec.json is refused at build.
test('G8 planted defect: a hand-edited model is refused at build, naming the file, before anything runs', async () => {
  const { dir, session } = appWith();
  const model = readdir(dir).find((f) => !f.endsWith('Proofs.lex.tex'));
  writeFileSync(join(dir, 'src', model), readFileSync(join(dir, 'src', model), 'utf8').replace('approved', 'refused'));
  // Proved already, so build goes straight to its gate; nothing may run past it.
  session.status.proved = { modelSha: 'x' };
  session.status.modelSha = 'x';
  session.status.lastSpec = JSON.stringify(session.spec);
  const r = await build(dir, session, { remote: 'local', env: {} });
  assert.equal(r.ok, false);
  assert.match(r.message, new RegExp(`^model does not match spec\\.json: src/${model.replace('.', '\\.')}`));
  assert.deepEqual(r.mismatched, [`src/${model}`]);
});

test('G8 planted defect: an extra LexLean file beside the model is refused at build', () => {
  const { dir } = appWith();
  writeFileSync(join(dir, 'src', 'Extra.lex.tex'), 'anything');
  assert.deepEqual(modelMismatches(dir), ['src/Extra.lex.tex']);
});

const readdir = (dir) => readdirSync(join(dir, 'src')).filter((f) => f.endsWith('.lex.tex'));

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

test('an agent edits spec.json directly, and Prism takes that edit as the spec', async () => {
  const root = scratch();
  const tool = mcp(root);
  const set = await tool('prism_spec', { spec: SPEC });
  assert.ok(!set.isError, JSON.stringify(set));
  const dir = join(root, 'prism');
  assert.ok(existsSync(join(dir, 'spec.json')));
  // The agent edits the JSON file itself: a third outcome and a rule for it.
  const edited = JSON.parse(readFileSync(join(dir, 'spec.json'), 'utf8'));
  edited.outcomes = ['approved', 'refused', 'review'];
  edited.rules.push({ when: [{ field: 'amount', op: '>', value: 500000 }], then: 'review', why: 'Large payments need a person.' });
  writeFileSync(join(dir, 'spec.json'), JSON.stringify(edited, null, 2));
  const read = (await tool('prism_spec')).structuredContent;
  assert.match(read.note, /spec\.json was edited/);
  assert.deepEqual(read.spec.outcomes, ['approved', 'refused', 'review']);
  assert.equal(read.spec.rules.length, 3);
  assert.equal(read.specHash, readSpecFile(edited).specHash);
});

test('G1 planted defect: a spec.json edited into something invalid blocks prove and build, with its refusal', async () => {
  const root = scratch();
  const tool = mcp(root);
  await tool('prism_spec', { spec: SPEC });
  const path = join(root, 'prism', 'spec.json');
  writeFileSync(path, readFileSync(path, 'utf8').replace('"otherwise":"refused"', '"otherwise":"refused","otherwise":"approved"'));
  for (const name of ['prism_prove', 'prism_build']) {
    const r = (await tool(name)).structuredContent;
    assert.equal(r.state, 'blocked', name);
    assert.match(r.message, /spec\.json does not read: .*appears twice/, name);
    assert.equal(r.issue.rule, 'json.duplicate');
  }
});

test('G1 planted defect: prism_spec refuses a member the spec does not define', async () => {
  const tool = mcp(scratch());
  const r = await tool('prism_spec', { spec: { ...SPEC, color: 'red' } });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /\$\.color.*is not a member of prism\/spec\/1/);
});

// The seal: an app carries the UOR content address of the spec.json it was built from,
// inside its model blob, so it verifies itself against that JSON with nothing else in hand.
test('the seal is the spec\'s UOR content address, and the model carries it', async () => {
  const { SPEC_SEAL_MARK } = await import('../src/journey/render.mjs');
  const { kappa } = await import('../src/blake3.mjs');
  const read = readSpecFile(text());
  assert.equal(read.specAddress, kappa(read.bytes), 'the seal is the kappa of the canonical bytes');
  assert.match(read.specAddress, /^blake3:[0-9a-f]{64}$/, 'the same shape a holo labels its blobs with');
  const model = renderModel(read.spec, { specAddress: read.specAddress });
  assert.equal(SPEC_SEAL_MARK.exec(model)?.[1], read.specAddress, 'the model names the spec it came from');
  // A change to the JSON changes the seal the model carries.
  const other = readSpecFile(text({ ...SPEC, otherwise: 'approved' }));
  assert.notEqual(other.specAddress, read.specAddress);
  assert.equal(SPEC_SEAL_MARK.exec(renderModel(other.spec, { specAddress: other.specAddress }))?.[1], other.specAddress);
});

/** A holo's model blob, as `specAddressOf` reads one, carrying `described`. */
const sealedHolo = (described) => ({ blobs: [{ content: new TextEncoder().encode('not json') }, { content: new TextEncoder().encode(JSON.stringify({ application: { cargo_description: described } })) }] });

test('an app verifies itself against its spec: bound, unbound and built from another spec', async () => {
  const { checkSpecBinding, specAddressOf } = await import('../src/journey/binding.mjs');
  const { describedBy } = await import('../src/journey/render.mjs');
  const read = readSpecFile(text());
  const holo = sealedHolo(describedBy(read.spec, read.specAddress));
  assert.equal(specAddressOf(holo), read.specAddress);
  const bound = checkSpecBinding(holo, text());
  assert.equal(bound.ok, true);
  assert.equal(bound.reason, 'bound');
  assert.match(bound.message, /matches this spec/);
  // Planted defect: the same app held to a spec it was not built from.
  const mismatch = checkSpecBinding(holo, text({ ...SPEC, otherwise: 'approved' }));
  assert.equal(mismatch.ok, false);
  assert.equal(mismatch.reason, 'mismatch');
  assert.match(mismatch.message, /built from another spec/);
  // Planted defect: an app with no seal cannot claim a spec.
  const unbound = checkSpecBinding(sealedHolo('A description with no seal.'), text());
  assert.equal(unbound.ok, false);
  assert.equal(unbound.reason, 'unbound');
  // Planted defect: a seal that is not a content address is no seal.
  assert.equal(specAddressOf(sealedHolo('Purpose. [prism/spec/1 sha256:' + 'a'.repeat(64) + ']')), null);
  assert.equal(specAddressOf(sealedHolo('Purpose. [prism/spec/1 blake3:short]')), null);
});

test('the seal lives in the model blob, so the archive digest covers it', async () => {
  const { parseArchive } = await import('../src/archive.mjs');
  const { modelDocument } = await import('../src/journey/binding.mjs');
  const { kappa } = await import('../src/blake3.mjs');
  const bytes = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  const parsed = parseArchive(bytes);
  const model = parsed.blobs.find((b) => { try { return JSON.parse(new TextDecoder().decode(b.content))?.application; } catch { return false; } });
  assert.ok(model, 'the holo carries a model blob');
  assert.equal(model.label, kappa(model.content), 'the blob is named by its own content address');
  assert.ok(modelDocument(parsed).application.cargo_description, 'the description the seal rides in is inside that blob');
  // The shipped fixture predates the seal, so it carries none.
  assert.equal((await import('../src/journey/binding.mjs')).specAddressOf(bytes), null);
});
