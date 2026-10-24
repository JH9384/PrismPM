import assert from 'node:assert/strict';
import { test } from 'node:test';
import { verify, VerifyError, ASSURANCE } from '../src/index.mjs';
import { reference, table, reseal, editExtension, ADR_015, assertVerdict } from './helpers.mjs';

const MODEL_EXTENSION = 'https://uor.foundation/extension/prismpm-model/v1';
const STATEMENTS = ['provenance.statement', 'proof.statement', 'replay.statement'];
const checks = (verdict) => verdict.reasons.map((r) => r.check);

test('the reference archive is P0 today: intact, but it carries no signed statements', async () => {
  const verdict = await verify(reference());
  assertVerdict(verdict);
  assert.equal(verdict.holo, `blake3:${ADR_015.footer}`);
  assert.equal(verdict.level, 'P0');
  assert.deepEqual(verdict.policy, { name: 'default', minimum: ASSURANCE.DEFAULT_MINIMUM });
  assert.equal(verdict.passed, false);
  assert.deepEqual(checks(verdict), [...STATEMENTS, 'policy.level']);
  assert.deepEqual(verdict.reasons.map((r) => r.withholds), ['P1', 'P2', 'P3', null]);
  assert.equal(verdict.reasons[3].code, 'PP5601');
  assert.equal(verdict.reasons[3].message, 'The level is P0; the policy requires P2 or above.');
  assert.ok(!checks(verdict).some((c) => c.startsWith('holo.')));
});

test('a P0 policy accepts the reference archive and keeps the reasons for the missing levels', async () => {
  const verdict = await verify(reference(), { name: 'browser-preview', minimum: 'P0' });
  assertVerdict(verdict);
  assert.equal(verdict.passed, true);
  assert.equal(verdict.level, 'P0');
  assert.deepEqual(verdict.policy, { name: 'browser-preview', minimum: 'P0' });
  assert.deepEqual(checks(verdict), STATEMENTS);
});

test('an ArrayBuffer and a DataView are accepted as well as a Uint8Array', async () => {
  const bytes = reference();
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  assert.deepEqual(await verify(buffer), await verify(bytes));
  assert.deepEqual(await verify(new DataView(buffer)), await verify(bytes));
});

test('a flipped byte in the guest blob is reported as holo.integrity, twice: footer and label', async () => {
  const bytes = reference();
  bytes[table(bytes)[4].offset + 71 + 100] ^= 0x01;
  const verdict = await verify(bytes);
  assertVerdict(verdict);
  assert.equal(verdict.level, 'P0');
  assert.equal(verdict.passed, false);
  assert.notEqual(verdict.holo, `blake3:${ADR_015.footer}`);
  assert.deepEqual(checks(verdict), ['holo.integrity', 'holo.integrity', ...STATEMENTS, 'policy.level']);
  assert.match(verdict.reasons[0].message, /^The footer 8408e089\w+ does not equal the BLAKE3 of the body, \w+: the archive was altered\.$/);
  assert.match(verdict.reasons[1].message, /^Section 4 is labelled blake3:2adca3e7\w+ but its content hashes to blake3:\w+\.$/);
  assert.equal(verdict.reasons[0].withholds, 'P1');
});

test('a flipped byte in a document fails the footer even when every label still matches', async () => {
  const bytes = reference();
  bytes[table(bytes)[1].offset + 20] ^= 0x01;
  const verdict = await verify(bytes);
  assertVerdict(verdict);
  assert.equal(verdict.reasons[0].check, 'holo.integrity');
  assert.match(verdict.reasons[0].message, /^The footer /);
  assert.ok(!verdict.reasons.some((r) => r.message.startsWith('Section ')));
});

test('a resealed footer does not hide a changed blob: the label still fails', async () => {
  const bytes = reference();
  bytes[table(bytes)[4].offset + 71 + 100] ^= 0x01;
  reseal(bytes);
  const verdict = await verify(bytes);
  assertVerdict(verdict);
  assert.deepEqual(checks(verdict), ['holo.integrity', ...STATEMENTS, 'policy.level']);
  assert.match(verdict.reasons[0].message, /^Section 4 is labelled/);
});

test('an intact archive with an inconsistent document reports the disagreement', async () => {
  const bytes = editExtension(reference(), MODEL_EXTENSION, (text) => text.replace(ADR_015.model.sha256, '0'.repeat(64)));
  const verdict = await verify(bytes);
  assertVerdict(verdict);
  assert.deepEqual(checks(verdict), ['holo.integrity', ...STATEMENTS, 'policy.level']);
  assert.match(verdict.reasons[0].message, /^The provenance model_id 0{64} differs from the model document's sha256 074921890f5c/);
});

test('a document that breaks its schema is reported as holo.documents', async () => {
  const bytes = editExtension(reference(), MODEL_EXTENSION, (text) => text.replace('"cargo_version":"0.1.0"', '"cargo_version":7      '));
  const verdict = await verify(bytes);
  assertVerdict(verdict);
  assert.equal(verdict.reasons[0].check, 'holo.documents');
  assert.match(verdict.reasons[0].message, /model-provenance-v1\.schema\.json: \$\.cargo_version expected string/);
});

test('a truncated footer gives no verdict: VerifyError archive.table', async () => {
  for (const cut of [1, 31, 32]) {
    const full = reference();
    await assert.rejects(verify(full.subarray(0, full.length - cut)), (e) => e instanceof VerifyError && e.code === 'archive.table' && /truncated/.test(e.message));
  }
});

test('a wrong magic gives no verdict: VerifyError archive.magic', async () => {
  const bytes = reference();
  bytes[0] = 'J'.charCodeAt(0);
  await assert.rejects(verify(bytes), (e) => e instanceof VerifyError && e.code === 'archive.magic' && e.message === 'no verdict: expected magic HOLO, found "JOLO"');
  await assert.rejects(verify(new Uint8Array(0)), (e) => e.code === 'archive.magic');
  const version = reference();
  version[4] = 5;
  await assert.rejects(verify(version), (e) => e.code === 'archive.version');
});

test('an intact holo of an unknown format revision gives no verdict', async () => {
  // Rename the model extension, keeping its length, and reseal: a newer writer.
  const bytes = reference();
  const row = table(bytes)[3];
  const name = new TextEncoder().encode(MODEL_EXTENSION.replace('/v1', '/v9'));
  bytes.set(name, row.offset + 2);
  reseal(bytes);
  await assert.rejects(verify(bytes), (e) => e instanceof VerifyError && e.code === 'format.revision' && /matches no format revision/.test(e.message));
});

test('pinned digests in both algorithms pass, and one wrong digest fails the policy, not the level', async () => {
  const pinned = await verify(reference(), { minimum: 'P0', digests: { archive: ADR_015.archive, guest: ADR_015.guest, model: ADR_015.model } });
  assertVerdict(pinned);
  assert.equal(pinned.passed, true);
  const wrong = await verify(reference(), { minimum: 'P0', digests: { guest: { sha256: ADR_015.guest.sha256, blake3: ADR_015.model.blake3 } } });
  assertVerdict(wrong);
  assert.equal(wrong.passed, false);
  assert.equal(wrong.level, 'P0');
  const reason = wrong.reasons.at(-1);
  assert.equal(reason.check, 'policy.digests.guest');
  assert.equal(reason.withholds, null);
  assert.match(reason.message, /its blake3 is 2adca3e7\w+, the policy pins e7654483/);
});

test('bad input and bad policies reject with VerifyError', async () => {
  await assert.rejects(verify('HOLO'), (e) => e instanceof VerifyError && e.code === 'input');
  await assert.rejects(verify(reference(), { minimum: 'P4' }), (e) => e instanceof VerifyError && e.code === 'policy.invalid');
  await assert.rejects(verify(reference(), { level: 'P0' }), /unknown policy member level/);
  await assert.rejects(verify(reference(), { name: '' }), /policy.name/);
  await assert.rejects(verify(reference(), { digests: { guest: { sha512: 'a'.repeat(64) } } }), /only sha256 and blake3/);
  await assert.rejects(verify(reference(), { digests: { guest: { sha256: 'ABC' } } }), /64 lowercase hex/);
  await assert.rejects(verify(reference(), { digests: { footer: { blake3: ADR_015.footer } } }), /is not one of archive/);
});
