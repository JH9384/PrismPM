// The journey's check with Lean's kernel in this process: no Docker, no image, no server (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/journey/session.mjs';
import { appDir, readSession } from '../src/journey/project.mjs';
import { beyondKernel, kernelReads, prove, proveWhere } from '../src/journey/engine.mjs';
import { KERNEL_AXIOMS, KernelUnread, WORD_MAX, boundedSpec, kernelProve, readPinned, ruleWords, unboundedFields } from '../src/journey/kernel-prove.mjs';

process.env.PRISM_HOME = mkdtempSync(join(tmpdir(), 'prism-home-'));
// The kernel's files are fetched once in use; here they are the pinned bytes kept beside the tests, so nothing is fetched.
process.env.PRISM_KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));

const PARKING = {
  purpose: 'Parking fee tier: decide the parking fee tier for a vehicle from the hours parked and the vehicle type.',
  fields: 'hours: number 0..24, vehicle: car|motorcycle|truck',
  outcomes: 'free, standard, premium',
  rules: 'when hours = 0 then free\nwhen vehicle is motorcycle then free\nwhen vehicle is truck then premium\nwhen hours > 8 then premium\notherwise standard',
  properties: 'never when vehicle is motorcycle then premium\nalways when vehicle is truck and hours > 0 then premium\nnever when hours = 0 then standard',
  examples: '0 car -> free\n3 car -> standard\n10 car -> premium',
};
// Two fields compared with each other: the rule judge does not read it.
const PAYMENT = {
  purpose: 'Payment approval: decide whether a payment request is approved.',
  fields: 'role: clerk|manager, amount: number 1..1000000, limit: number 0..1000000',
  outcomes: 'approved, refused',
  rules: 'when role is manager then approved\nwhen amount is at most limit then approved\notherwise refused',
  properties: 'always when role is manager then approved',
  examples: 'clerk 250 1000 -> approved',
};

const specOf = (answers) => compile({ ...answers, review: 'yes' }).spec;
function app(answers) {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-journey-kernel-')));
  return { dir, session: { ...readSession(dir), spec: specOf(answers), axioms: {}, status: {} } };
}

test('where the proof runs: a rule app the judge reads goes to the kernel in this process, with nothing set', () => {
  const { dir, session } = app(PARKING);
  assert.equal(kernelReads(session.spec), true);
  assert.equal(proveWhere(dir, session, { env: {} }), 'kernel');
  assert.equal(proveWhere(dir, session, { env: { PRISM_CODE_TIER: 'kernel' } }), 'kernel');
  // The user can still name the SDK image or the hosted verifier, and Prism never picks the hosted one.
  assert.equal(proveWhere(dir, session, { env: { PRISM_CODE_TIER: 'local' } }), 'local');
  assert.equal(proveWhere(dir, session, { env: { PRISM_CODE_TIER: 'hosted' } }), 'hosted');
  // An app the judge does not read is proved in the SDK image, as before.
  const other = app(PAYMENT);
  assert.equal(kernelReads(other.session.spec), false);
  assert.equal(proveWhere(other.dir, other.session, { env: {} }), 'local');
  assert.equal(proveWhere(other.dir, other.session, { env: { PRISM_CODE_TIER: 'kernel' } }), 'kernel');
});

test('planted defect K5: only an answer that is no verdict falls back to the SDK image, never a false guarantee', () => {
  const unknown = { ok: false, properties: [{ status: 'kernel-checked' }, { status: 'unknown' }] };
  const failing = { ok: false, properties: [{ status: 'failing' }, { status: 'unknown' }] };
  assert.equal(beyondKernel(unknown), true);
  assert.equal(beyondKernel({ ok: false, code: 'kernel.unavailable' }), true);
  assert.equal(beyondKernel({ ok: false, code: 'kernel.refused' }), true);
  // A guarantee a request breaks is the user's to fix: the SDK image would only say so more slowly.
  assert.equal(beyondKernel(failing), false);
  assert.equal(beyondKernel({ ok: true, properties: [{ status: 'kernel-checked' }] }), false);
  // A spec the judge does not read never reaches the kernel by default, so its refusal is only seen when named.
  assert.equal(beyondKernel({ ok: false, code: 'kernel.two-fields' }), false);
});

test('a spec is written as the numbers the rule judge reads, the same numbers every time', () => {
  const { words, guarantees } = ruleWords(specOf(PARKING));
  // version, fields, each field's least and greatest, otherwise, rules, then each rule: conditions, answer, (field, operator, value)*.
  // Answers are numbered from `otherwise`: standard 0, free 1, premium 2.
  assert.deepEqual(words, [1, 2, 0, 24, 0, 2, 0, 4, 1, 1, 0, 4, 0, 1, 1, 1, 4, 1, 1, 2, 1, 4, 2, 1, 2, 0, 2, 8]);
  assert.deepEqual(guarantees, [
    { always: false, when: [[1, 4, 1]], outcome: 2 },
    { always: true, when: [[1, 4, 2], [0, 2, 0]], outcome: 2 },
    { always: false, when: [[0, 4, 0]], outcome: 0 },
  ]);
  assert.deepEqual(ruleWords(specOf(PARKING)), { words, guarantees });
});

test('a spec the rule judge does not read is refused by name, not guessed at', () => {
  const refusal = (spec) => {
    try {
      ruleWords(spec);
    } catch (error) {
      assert.ok(error instanceof KernelUnread);
      return error.code;
    }
    return null;
  };
  assert.equal(refusal(specOf(PAYMENT)), 'kernel.two-fields');
  const spec = specOf(PARKING);
  // A number field with no upper bound is read up to the judge's 32-bit words, and the numbers say so.
  const open = { ...spec, fields: [{ name: 'hours', kind: 'number' }, spec.fields[1]] };
  assert.equal(refusal(open), null);
  assert.deepEqual(unboundedFields(open), ['hours']);
  assert.deepEqual(ruleWords(open).words.slice(2, 4), [0, WORD_MAX]);
  assert.deepEqual(boundedSpec(open).fields[0], { name: 'hours', kind: 'number', max: WORD_MAX });
  assert.equal(boundedSpec(spec), spec);
  assert.equal(refusal({ ...spec, fields: [{ ...spec.fields[0], max: WORD_MAX + 1 }, spec.fields[1]] }), 'kernel.range');
  assert.equal(refusal({ ...spec, actions: [] }), 'kernel.stateful');
  assert.equal(refusal(spec), null);
});

test("Lean's kernel accepts every guarantee of a rule app, on the lemma's axioms only, and says what that is worth", { timeout: 120000 }, async () => {
  const { dir, session } = app(PARKING);
  const lines = [];
  const r = await prove(dir, session, { where: 'kernel', log: (l) => lines.push(l) });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.where, 'kernel');
  assert.deepEqual(r.properties.map((p) => p.status), ['kernel-checked', 'kernel-checked', 'kernel-checked']);
  assert.match(r.message, /^Lean's kernel accepted all 3 guarantees for every request in the fields' bounds, in [\d.]+ s\. /);
  // Planted defect K4: the kernel route never calls its answer the proof of the built app.
  assert.match(r.message, /It is not a proof of the rendered model/);
  assert.doesNotMatch(r.message, /Lean proved/);
  assert.equal(session.status.proved, undefined);
  assert.deepEqual(session.status.properties, { 'INV-001': 'kernel-checked', 'INV-002': 'kernel-checked', 'INV-003': 'kernel-checked' });
  const manifest = JSON.parse(readFileSync(new URL('../src/journey/kernel/manifest.json', import.meta.url), 'utf8'));
  assert.equal(r.evidence.kernel, `sha256:${manifest.wasm.sha256}`);
  assert.equal(r.evidence.library, `sha256:${manifest.library.sha256}`);
  assert.deepEqual(r.evidence.axioms, [...KERNEL_AXIOMS]);
  assert.equal(session.status.kernelChecked.statement, r.evidence.statement);
  assert.match(lines[0], /No SDK image is used and nothing is sent/);
  // The same spec gives the same proof bytes and the same statement.
  const again = await kernelProve(session.spec);
  assert.equal(again.evidence.bundle, r.evidence.bundle);
  assert.equal(again.evidence.statement, r.evidence.statement);
});

test('planted defect K1: a rule that breaks a guarantee is refused by the kernel, with the request that breaks it', { timeout: 120000 }, async () => {
  const { dir, session } = app(PARKING);
  // The checker refuses the draft's false guarantee before a proof is asked for, so the spec is taken as written.
  session.spec = { ...specOf(PARKING), rules: specOf(PARKING).rules.map((rule, i) => (i === 1 ? { ...rule, then: 'premium' } : rule)) };
  const r = await prove(dir, session, { where: 'kernel', overwrite: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.properties.map((p) => p.status), ['failing', 'kernel-checked', 'kernel-checked']);
  assert.match(r.message, /^INV-001 is false\. The request `\d+ motorcycle` meets "vehicle is motorcycle" and the rules answer premium \(REQ-002\)\./);
  assert.equal(session.status.kernelChecked, null);
  assert.equal(session.status.proved, undefined);
  // It is the kernel that refuses: the writer states `wordsCheck … = true` whatever the rules are.
  const judged = (await kernelProve(session.spec)).judged;
  assert.match(judged[0].output, /\(kernel\) declaration type mismatch/);
  assert.deepEqual(judged.map((j) => j.accepted), [false, true, true]);
});

test('a guarantee this route cannot prove is unknown, never false and never accepted', { timeout: 120000 }, async () => {
  const { dir, session } = app(PARKING);
  // True: after eight hours a car and a truck pay premium, and only the motorcycle, which it excludes, parks free.
  // The excluded value lies between the other two, and the pinned lemma does not yet split an `is not`
  // (foundry #231), so the kernel does not accept it. When the library gains that lemma this expectation changes.
  session.spec = { ...session.spec, properties: [...session.spec.properties, { id: 'INV-004', kind: 'never', when: [{ field: 'vehicle', op: 'is not', value: 'motorcycle' }, { field: 'hours', op: '>', value: 8 }], then: 'free', says: 'never when vehicle is not motorcycle and hours > 8 then free', why: 'a long stay is never free for a car or a truck' }] };
  const r = await prove(dir, session, { where: 'kernel', overwrite: true });
  assert.equal(r.ok, false);
  assert.deepEqual(r.properties.map((p) => p.status), ['kernel-checked', 'kernel-checked', 'kernel-checked', 'unknown']);
  assert.match(r.message, /^Lean's kernel did not accept INV-004 .* this is not a verdict on INV-004\./);
  assert.doesNotMatch(r.message, /INV-004 is false/);
  assert.equal(r.next, undefined);
});

test('a spec the route does not read sends the user to the SDK image, and records nothing', async () => {
  const { dir, session } = app(PAYMENT);
  const r = await prove(dir, session, { where: 'kernel' });
  assert.equal(r.ok, false);
  assert.equal(r.code, 'kernel.two-fields');
  assert.match(r.message, /^Lean's kernel in this process cannot read this spec: it compares `amount` with another field.* call prism_prove again\.$/);
  assert.match(r.message, /set PRISM_CODE_TIER=local/);
  assert.equal(session.status.properties, undefined);
  assert.equal(session.status.kernelChecked, undefined);
});

test('planted defect K2 and K3: altered bytes and an unbound library are refused before the kernel runs', () => {
  const real = (file) => readFileSync(new URL(file === 'manifest.json' ? '../src/journey/kernel/manifest.json' : `./fixtures/kernel/${file}`, import.meta.url));
  assert.equal(readPinned().addresses.kernel, JSON.parse(real('manifest.json')).wasm.sha256);
  for (const altered of ['lean-kernel.mjs.gz', 'lean-kernel.wasm.gz', 'library.ndjson.gz']) {
    const other = real(altered === 'lean-kernel.wasm.gz' ? 'library.ndjson.gz' : 'lean-kernel.wasm.gz');
    assert.throws(() => readPinned({ read: (file) => (file === altered ? other : real(file)) }), /is not the pinned one/, altered);
  }
  const unbound = JSON.parse(real('manifest.json'));
  unbound.binding.library = '0'.repeat(64);
  assert.throws(() => readPinned({ read: (file) => (file === 'manifest.json' ? Buffer.from(JSON.stringify(unbound)) : real(file)) }), /no record that this kernel judged this library whole/);
});

test('planted defects V1 to V5: the verdict is the verified guest\'s, and it refuses what is not pinned, stated or declared', { timeout: 120000 }, async () => {
  const { guestVerdict, decodeVerdictResponse, encodeVerdictRequest } = await import('../src/journey/kernel-verdict.mjs');
  const { pinnedHolo, statementOf } = await import('../src/journey/rule-app.mjs');
  const spec = specOf(PARKING);
  const result = await kernelProve(spec);
  const stated = ruleWords(spec);
  const good = { pinned: result.pinned, derived: { kernel: result.evidence.kernel, library: result.evidence.library }, bundle: result.evidence.bundle, statement: statementOf(stated.words, stated.guarantees), checked: result.evidence.statement, declared: [...KERNEL_AXIOMS], observed: result.evidence.axioms, accepted: true };
  const holo = pinnedHolo();
  const other = `sha256:${'ab'.repeat(32)}`;
  assert.deepEqual(await guestVerdict(holo, good), { ok: true, code: 0, verdict: 'proved' });
  // V1: another kernel. V2: another library. V3: the kernel was shown another statement.
  assert.equal((await guestVerdict(holo, { ...good, derived: { ...good.derived, kernel: other } })).verdict, 'refused');
  assert.equal((await guestVerdict(holo, { ...good, derived: { ...good.derived, library: other } })).verdict, 'refused');
  assert.equal((await guestVerdict(holo, { ...good, checked: other })).verdict, 'refused');
  // V4: an axiom outside the declared set, sorryAx among them. V5: the kernel did not accept.
  assert.equal((await guestVerdict(holo, { ...good, observed: ['propext', 'Quot.sound', 'Classical.choice'] })).verdict, 'refused');
  assert.equal((await guestVerdict(holo, { ...good, observed: ['propext', 'sorryAx'] })).verdict, 'refused');
  assert.equal((await guestVerdict(holo, { ...good, accepted: false })).verdict, 'refused');
  // No verdict is made here: a guest that is not the verified one, or a reply that is not its shape, gives none.
  const calculator = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  assert.equal((await guestVerdict(calculator, good)).ok, false);
  assert.deepEqual(decodeVerdictResponse(new TextEncoder().encode('proved')), { ok: false, code: 'invalidVerdictResponse' });
  assert.throws(() => encodeVerdictRequest({ version: 1, verdict: 'proved' }), { code: 'malformedVerdictRequest' });
});
