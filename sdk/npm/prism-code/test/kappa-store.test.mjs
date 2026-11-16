// What Prism has proved is kept by content address and reused, so the same proof is never found twice (issue #692).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compile } from '../src/journey/session.mjs';
import { kappa } from '../src/uorc.mjs';
import { PROOF_SCHEMA, derivationKey, findProof, kappaStore, proofRealization, proofReferences, reuseAdmits } from '../src/journey/kappa-store.mjs';
import { guaranteeStatement, kernelProve, pinnedAddresses, ruleWords } from '../src/journey/kernel-prove.mjs';
import { ruleAppRecord } from '../src/journey/rule-app.mjs';

process.env.PRISM_KERNEL_DIR = fileURLToPath(new URL('./fixtures/kernel/', import.meta.url));

const PARKING = {
  purpose: 'Parking fee tier: decide the parking fee tier for a vehicle from the hours parked and the vehicle type.',
  fields: 'hours: number 0..24, vehicle: car|motorcycle|truck',
  outcomes: 'free, standard, premium',
  rules: 'when hours = 0 then free\nwhen vehicle is motorcycle then free\nwhen vehicle is truck then premium\nwhen hours > 8 then premium\notherwise standard',
  properties: 'never when vehicle is motorcycle then premium\nalways when vehicle is truck and hours > 0 then premium\nnever when hours = 0 then standard',
  examples: '0 car -> free',
};
const specOf = (answers = PARKING) => compile({ ...answers, review: 'yes' }).spec;
const home = () => ({ PRISM_HOME: mkdtempSync(join(tmpdir(), 'prism-kappa-')), PRISM_KERNEL_DIR: process.env.PRISM_KERNEL_DIR });
const enc = new TextEncoder();
const files = (dir) => (existsSync(dir) ? readdirSync(dir, { recursive: true, withFileTypes: true }).filter((e) => e.isFile()).map((e) => join(e.parentPath ?? e.path, e.name)) : []);

test('bytes are named by their κ-label, and a read re-derives it', () => {
  const store = kappaStore({ env: home() });
  const label = store.put(enc.encode('hello'));
  assert.equal(label, kappa(enc.encode('hello')));
  assert.deepEqual(store.get(label), enc.encode('hello'));
  assert.equal(store.put(enc.encode('hello')), label, 'equal bytes, equal label');
  assert.equal(store.get(kappa(enc.encode('absent'))), null);
  assert.equal(store.get('not a label'), null);
  // Planted defect M1: stored bytes altered on disk are not returned under their old name.
  const [file] = files(join(store.directory, 'bytes'));
  writeFileSync(file, 'hellp');
  assert.equal(store.get(label), null);
  // Off keeps nothing and answers nothing.
  const off = kappaStore({ env: { ...home(), PRISM_KAPPA: '0' } });
  const kept = off.put(enc.encode('x'));
  off.bind(kept, kept);
  assert.equal(off.get(kept), null);
  assert.equal(off.bound(kept), null);
  assert.equal(existsSync(off.directory), false);
});

test('a derivation key is over a domain and its operands in order, each framed by its length', () => {
  const [a, b] = [kappa(enc.encode('a')), kappa(enc.encode('b'))];
  assert.notEqual(derivationKey('d', [a, b]), derivationKey('d', [b, a]));
  assert.notEqual(derivationKey('d', [a, b]), derivationKey('e', [a, b]));
  assert.notEqual(derivationKey('d', [a]), derivationKey('d', [a, a]));
  // Framing: a domain cannot borrow bytes from the operand that follows it.
  assert.notEqual(derivationKey('ab', [a]), derivationKey('a', [a]));
  assert.equal(derivationKey('d', [a, b]), derivationKey('d', [a, b]));
  assert.throws(() => derivationKey('d', ['sha256:short']), /is not a κ-label/);
});

test('a proof names every input by κ-label, and they are read back out of it', () => {
  const k = (s) => kappa(enc.encode(s));
  const bytes = proofRealization({ key: k('key'), kernel: k('kernel'), library: k('library'), statement: k('statement'), bundle: k('bundle'), axioms: ['propext', 'Quot.sound'] });
  assert.deepEqual(proofReferences(bytes), [k('kernel'), k('library'), k('statement'), k('bundle')]);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(bytes)).axioms, ['Quot.sound', 'propext']);
  assert.deepEqual(Object.keys(JSON.parse(new TextDecoder().decode(bytes))), ['schema', 'key', 'kernel', 'library', 'statement', 'bundle', 'axioms']);
});

test('a proof is found once: the same spec again opens no kernel, and the answer and the app are byte for byte the same', { timeout: 120000 }, async () => {
  const env = home();
  const spec = specOf();
  const first = await kernelProve(spec, { env });
  assert.deepEqual([first.reused, first.judged.map((j) => j.accepted)], [0, [true, true, true]]);
  // A kernel that must not be opened: any call to it fails the test.
  const closed = { judge: () => assert.fail('the kernel was asked again') };
  const again = await kernelProve(spec, { env, kernel: closed });
  assert.equal(again.reused, 3);
  assert.deepEqual(again.judged.map((j) => [j.accepted, j.reused, j.axioms]), first.judged.map((j) => [true, true, j.axioms]));
  assert.deepEqual(again.evidence, first.evidence);
  assert.deepEqual(Buffer.from(ruleAppRecord(spec, { proof: again.evidence }).bytes), Buffer.from(ruleAppRecord(spec, { proof: first.evidence }).bytes));
  // Reordering the guarantees proves nothing new: a proof does not depend on where its guarantee sits.
  const reordered = { ...spec, properties: [...spec.properties].reverse() };
  assert.equal((await kernelProve(reordered, { env, kernel: closed })).reused, 3);
});

test('only what changed is proved: an edited guarantee reuses the others, and an edited rule reuses none', { timeout: 120000 }, async () => {
  const env = home();
  await kernelProve(specOf(), { env });
  const guarantee = await kernelProve(specOf({ ...PARKING, properties: PARKING.properties.replace('never when hours = 0 then standard', 'never when hours = 0 then premium') }), { env });
  assert.deepEqual(guarantee.judged.map((j) => j.reused), [true, true, false]);
  assert.equal(guarantee.judged[2].accepted, true);
  const rule = await kernelProve(specOf({ ...PARKING, rules: PARKING.rules.replace('hours > 8', 'hours > 9') }), { env });
  assert.deepEqual(rule.judged.map((j) => j.reused), [false, false, false]);
  // A guarantee the kernel refuses is not kept, so it is asked again and refused again.
  const broken = { ...specOf(), rules: specOf().rules.map((r, i) => (i === 1 ? { ...r, then: 'premium' } : r)) };
  for (let round = 0; round < 2; round++) assert.deepEqual((await kernelProve(broken, { env })).judged.map((j) => [j.accepted, j.reused])[0], [false, false]);
});

test('planted defects M2 to M5: a stored proof is reused only under the same key, kernel, library and bytes', { timeout: 120000 }, async () => {
  const env = home();
  const spec = specOf();
  await kernelProve(spec, { env });
  const store = kappaStore({ env });
  const pinned = pinnedAddresses();
  const { words, guarantees } = ruleWords(spec);
  const statement = guaranteeStatement(words, guarantees[0]);
  const key = derivationKey(PROOF_SCHEMA, [pinned.kernel, pinned.library, statement]);
  const found = findProof(store, { key, kernel: pinned.kernel, library: pinned.library });
  assert.equal(reuseAdmits(found.facts), true);
  assert.equal(found.proof.statement, statement);
  // M2: another kernel is pinned (a new release): nothing proved under the old one is reused.
  const other = kappa(enc.encode('another kernel'));
  assert.equal(reuseAdmits(findProof(store, { key, kernel: other, library: pinned.library }).facts), false);
  assert.equal(reuseAdmits(findProof(store, { key, kernel: pinned.kernel, library: other }).facts), false);
  // M3: a proof kept under one key is put under another: its own bytes name the key it was made for.
  const elsewhere = derivationKey(PROOF_SCHEMA, [pinned.kernel, pinned.library, guaranteeStatement(words, guarantees[1])]);
  const label = store.bound(key);
  store.bind(elsewhere, label);
  assert.equal(reuseAdmits(findProof(store, { key: elsewhere, kernel: pinned.kernel, library: pinned.library }).facts), false);
  // M4: the proof's bytes are altered on disk: what is read no longer has the address the record names.
  const bundle = files(join(store.directory, 'bytes')).find((f) => readFileSync(f, 'utf8').includes('Prism'));
  writeFileSync(bundle, `${readFileSync(bundle, 'utf8')}\n`);
  const altered = findProof(store, { key, kernel: pinned.kernel, library: pinned.library });
  assert.equal(altered.facts.derivedBytes, '');
  assert.equal(reuseAdmits(altered.facts), false);
  // So the kernel is asked again, and only for the proofs that are gone.
  const again = await kernelProve(spec, { env });
  assert.ok(again.reused < 3);
  assert.deepEqual(again.judged.map((j) => j.accepted), [true, true, true]);
  // M5: a record that is not a proof is not one, whatever key leads to it.
  const junk = store.put(enc.encode('{"schema":"prism/kernel-proof/1","key":"x"}\n'));
  store.bind(key, junk);
  assert.equal(findProof(store, { key, kernel: pinned.kernel, library: pinned.library }).facts.present, 0);
});
