// A rule app with no build: the pinned rule judge's holo and the spec's numbers, named together (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/journey/session.mjs';
import { appDir, readSession } from '../src/journey/project.mjs';
import { build, tryRequest } from '../src/journey/engine.mjs';
import { respond } from '../src/journey/spec.mjs';
import { RULE_APP_SCHEMA, RULE_JUDGE_HOLO, RuleAppRefused, loadRuleApp, pinnedHolo, ruleAppRecord } from '../src/journey/rule-app.mjs';

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
const KERNEL = { PRISM_CODE_TIER: 'kernel' };
const enc = new TextEncoder();
const dec = new TextDecoder();
const spec = () => compile({ ...PARKING, review: 'yes' }).spec;
function app() {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-rule-app-')));
  return { dir, session: { ...readSession(dir), spec: spec(), axioms: {}, status: {} } };
}
const refusal = async (make) => {
  try {
    await make();
  } catch (error) {
    assert.ok(error instanceof RuleAppRefused, String(error));
    return error.code;
  }
  return null;
};
const edited = (bytes, change) => {
  const record = JSON.parse(dec.decode(bytes));
  change(record);
  return enc.encode(`${JSON.stringify(record, null, 1)}\n`);
};

test('the same spec gives the same record, byte for byte, and another spec gives another address', () => {
  const a = ruleAppRecord(spec());
  const b = ruleAppRecord(JSON.parse(JSON.stringify(spec())));
  assert.deepEqual(Buffer.from(a.bytes), Buffer.from(b.bytes));
  assert.equal(a.address, b.address);
  assert.match(a.address, /^sha256:[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(a.record), ['schema', 'name', 'title', 'kernel', 'fields', 'outcomes', 'words', 'guarantees', 'vectors', 'proof']);
  assert.equal(a.record.schema, RULE_APP_SCHEMA);
  assert.equal(a.record.kernel.holo, RULE_JUDGE_HOLO);
  // Nothing of the machine or the moment is in the bytes.
  assert.doesNotMatch(dec.decode(a.bytes), /\d{4}-\d{2}-\d{2}T|[A-Za-z]:\\|\/home\/|\/Users\//);
  const other = spec();
  other.rules[3].when[0].value = 9;
  assert.notEqual(ruleAppRecord(other).address, a.address);
});

test('a build with PRISM_CODE_TIER=kernel writes the app with no SDK image, and it answers as the rules do', { timeout: 120000 }, async () => {
  const { dir, session } = app();
  const lines = [];
  // Nothing is set: a rule app the judge reads takes this route on its own.
  const r = await build(dir, session, { env: {}, log: (l) => lines.push(l) });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.where, 'kernel');
  assert.equal(r.holo, RULE_JUDGE_HOLO);
  assert.equal(r.vectors.passed, r.vectors.total);
  assert.ok(r.vectors.total >= 10);
  assert.match(r.message, /^Built in [\d.]+ s with no SDK image and nothing compiled: .* Lean's kernel accepted all 3 guarantees for that rule judge\. Tested: \d+ of \d+ acceptance vectors pass through it\./);
  // Planted defect R6: the route never passes its record off as a holo, or its check as the model's proof.
  assert.match(r.message, /refusing malformed text is tested, not proved\. Its page is the folder .* This is not a holo: prism_try answers from it/);
  assert.equal(session.status.holo, undefined);
  assert.equal(session.status.proved, undefined);
  assert.equal(session.status.ruleApp.address, r.address);
  assert.ok(lines.some((l) => /Nothing is compiled/.test(l)));
  assert.ok(!lines.some((l) => /SDK image is not on this machine|Downloading/.test(l)));

  const written = readFileSync(r.app);
  const loaded = await loadRuleApp(written);
  assert.equal(loaded.address, r.address);
  assert.equal(loaded.kernelChecked, true);
  // Every request inside the bounds, against the evaluator the acceptance vectors come from.
  let asked = 0;
  for (let hours = 0; hours <= 24; hours++) {
    for (const vehicle of ['car', 'motorcycle', 'truck']) {
      const request = enc.encode(`${hours} ${vehicle}`);
      assert.equal(dec.decode(await loaded.dispatch(request)), respond(session.spec, request), `${hours} ${vehicle}`);
      asked++;
    }
  }
  assert.equal(asked, 75);
  // Outside the bounds and malformed text are refused as a built text app refuses them.
  for (const text of ['25 car', '3 bus', '', '3', '3 car car', '3  car', '03 car', '-1 car', 'x car']) assert.equal(dec.decode(await loaded.dispatch(enc.encode(text))), 'invalid', text);
  assert.equal(dec.decode(await loaded.dispatch(Uint8Array.of(0xff))), 'invalid');
  assert.equal(dec.decode(await loaded.dispatch(enc.encode('x'.repeat(600)))), 'invalid');
  // prism_try answers from the record, and from the spec again once the spec has moved on.
  const tried = await tryRequest(session, '10 car');
  assert.deepEqual(tried, { request: '10 car', answer: 'premium', from: 'the built app (the rule judge)', decidedBy: 'REQ-004', agreesWithSpec: true });
  assert.equal((await tryRequest(session, '25 car')).answer, 'invalid');
  const moved = { ...session, spec: { ...session.spec, rules: session.spec.rules.map((rule, i) => (i === 3 ? { ...rule, when: [{ ...rule.when[0], value: 12 }] } : rule)) } };
  assert.deepEqual(await tryRequest(moved, '10 car'), { request: '10 car', answer: 'standard', from: 'the spec (not built yet)', decidedBy: 'otherwise' });
  // The record is the one the spec gives, so a second machine writes the same file.
  assert.deepEqual(Buffer.from(written), Buffer.from(ruleAppRecord(session.spec, { proof: loaded.record.proof }).bytes));
});

test('planted defect R1: a guarantee the rules break stops the build at the proof, and nothing is written', { timeout: 120000 }, async () => {
  const { dir, session } = app();
  session.spec = { ...session.spec, rules: session.spec.rules.map((rule, i) => (i === 1 ? { ...rule, then: 'premium' } : rule)) };
  const r = await build(dir, session, { env: KERNEL, overwrite: true });
  assert.equal(r.ok, false);
  assert.equal(r.stage, 'prove');
  assert.match(r.message, /^INV-001 is false\./);
  assert.equal(session.status.ruleApp, undefined);
  assert.equal(existsSync(join(dir, '.prism', 'build', `${session.spec.name}.rule-app.json`)), false);
});

test('planted defects R2 to R5: an altered record is refused, or its own vectors catch it', { timeout: 120000 }, async () => {
  const { dir, session } = app();
  const built = await build(dir, session, { env: KERNEL });
  assert.equal(built.ok, true, built.message);
  const good = readFileSync(built.app);
  // R2: rule 2's answer changed in the numbers, the proof kept: the proof is about other numbers.
  const swapped = (record) => {
    record.words[2 + 2 * record.fields.length + 2 + 5 + 1] = 2;
  };
  assert.equal(JSON.parse(dec.decode(good)).words[2 + 4 + 2 + 5 + 1], 1, 'rule 2 answers free, outcome 1');
  assert.equal(await refusal(() => loadRuleApp(edited(good, swapped))), 'rule-app.proof');
  // R3: the same change with the proof dropped loads as unchecked, and the record's vectors fail through the judge.
  const unproved = await loadRuleApp(edited(good, (record) => {
    swapped(record);
    record.proof = null;
  }));
  assert.equal(unproved.kernelChecked, false);
  const replay = await unproved.acceptance();
  assert.ok(replay.failed.length > 0);
  assert.equal(replay.passed + replay.failed.length, replay.total);
  // R4: bounds that are not the ones the numbers state would decode one app and judge another.
  assert.equal(await refusal(() => loadRuleApp(edited(good, (record) => {
    record.fields[0].max = 99;
  }))), 'rule-app.fields');
  // R5: another holo, an altered pinned holo, and a record that is not one.
  const calculator = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
  assert.equal(await refusal(() => loadRuleApp(good, { holo: calculator })), 'rule-app.holo');
  const pinned = pinnedHolo();
  assert.equal(await refusal(async () => pinnedHolo({ read: () => Uint8Array.from(pinned, (b, i) => (i === 100 ? b ^ 1 : b)) })), 'rule-app.holo');
  assert.equal(await refusal(() => loadRuleApp(edited(good, (record) => {
    record.extra = 1;
  }))), 'rule-app.malformed');
  assert.equal(await refusal(() => loadRuleApp(edited(good, (record) => {
    record.schema = 'prism/rule-app/2';
  }))), 'rule-app.malformed');
  assert.equal(await refusal(() => loadRuleApp(enc.encode('not json'))), 'rule-app.malformed');
  // The untouched record still loads and passes.
  const again = await (await loadRuleApp(good)).acceptance();
  assert.equal(again.failed.length, 0);
});

test('a number field with no upper bound: the app reads it up to the judge\'s words, says so, and refuses more', { timeout: 120000 }, async () => {
  const dir = appDir(mkdtempSync(join(tmpdir(), 'prism-rule-app-open-')));
  const open = compile({ ...PARKING, fields: 'hours: number, vehicle: car|motorcycle|truck', review: 'yes' }).spec;
  assert.equal(open.fields[0].max, undefined);
  const session = { ...readSession(dir), spec: open, axioms: {}, status: {} };
  const r = await build(dir, session, { env: {} });
  assert.equal(r.ok, true, r.message);
  assert.equal(r.where, 'kernel');
  assert.match(r.message, /The spec gives `hours` no upper bound; this app reads it up to 4294967295 and refuses more\./);
  const loaded = await loadRuleApp(readFileSync(r.app));
  assert.deepEqual(loaded.record.fields[0], { name: 'hours', kind: 'number', min: 0, max: 4294967295 });
  for (const [text, want] of [['4294967295 car', 'premium'], ['4294967296 car', 'invalid'], ['0 car', 'free'], ['8 car', 'standard']]) assert.equal(dec.decode(await loaded.dispatch(enc.encode(text))), want, text);
  // prism_try holds the built app to the bounded spec, and says a number past the bound is not read.
  assert.deepEqual(await tryRequest(session, '4294967296 car'), { request: '4294967296 car', answer: 'invalid', from: 'the built app (the rule judge)', decidedBy: 'malformed', agreesWithSpec: true });
});
