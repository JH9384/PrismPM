// Build provenance (#268): the statement, the unsigned bundle, and appending it to the archive.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseArchive, KIND } from '../src/archive.mjs';
import { readAttestations, stripAttestations, ATTESTATION_EXTENSION } from '../src/attestations.mjs';
import {
  HOLO_BUILD_TYPE,
  PROVENANCE_PREDICATE_TYPE,
  attachProvenance,
  provenanceBundle,
  provenanceStatement,
  readProvenance,
  resolvedDependencies,
  statementBytes,
} from '../src/provenance.mjs';
import { load, PrismCodeError } from '../src/index.mjs';

const original = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const pristine = original.slice();
const lockBytes = new Uint8Array(readFileSync(new URL('../../spec/test/fixtures/documents/sdk-lock-v3/calculator.json', import.meta.url)));
const lock = JSON.parse(new TextDecoder().decode(lockBytes));
const goldenLine = new Uint8Array(readFileSync(new URL('./fixtures/Calculator.provenance-min.bundle.jsonl', import.meta.url)));

const maxOptions = {
  lock: lockBytes,
  mode: 'max',
  arguments: ['build', '--provenance=max'],
  platform: 'linux/amd64',
  invocationId: 'urn:prismpm:invocation:1',
  startedOn: '2026-10-25T14:00:00Z',
  finishedOn: '2026-10-25T14:03:12Z',
};

const rejects = async (promise, code) => {
  await assert.rejects(promise, (error) => error instanceof PrismCodeError && error.code === code, `expected ${code}`);
};
const changedLock = (edit) => {
  const copy = structuredClone(lock);
  edit(copy);
  return JSON.stringify(copy);
};

test('the min statement is SLSA provenance v1 over the four content blobs with the lock as its dependencies', async () => {
  const statement = await provenanceStatement(original, { lock: lockBytes });
  assert.equal(statement.predicateType, PROVENANCE_PREDICATE_TYPE);
  assert.equal(statement.predicate.buildDefinition.buildType, HOLO_BUILD_TYPE);
  assert.equal(statement.subject.length, 4);
  assert.equal(statement.predicate.runDetails.builder.id, lock.sdk_image);
  const rows = statement.predicate.buildDefinition.resolvedDependencies;
  assert.ok(rows.some((r) => r.uri === 'urn:prismpm:sdk-lock' && r.digest.blake3 && r.digest.sha256));
  assert.deepEqual(rows, [...rows].sort((a, b) => (a.uri === b.uri ? (a.name < b.name ? -1 : 1) : a.uri < b.uri ? -1 : 1)));
  assert.ok(original.every((b, i) => b === pristine[i]), 'the input was modified');
});

test('min is the default, deterministic, and records no build argument, platform, time or invocation', async () => {
  const a = await provenanceStatement(original, { lock: lockBytes });
  const b = await provenanceStatement(original, { lock: lockBytes, mode: 'min' });
  assert.deepEqual(statementBytes(a), statementBytes(b));
  assert.doesNotMatch(Buffer.from(statementBytes(a)).toString('utf8'), /arguments|platform|startedOn|finishedOn|invocationId/);
});

test('max adds the arguments, platform, invocation id and timestamps and nothing else', async () => {
  const min = await provenanceStatement(original, { lock: lockBytes });
  const max = await provenanceStatement(original, maxOptions);
  assert.deepEqual(max.predicate.buildDefinition.externalParameters.arguments, ['build', '--provenance=max']);
  assert.deepEqual(max.predicate.buildDefinition.internalParameters, { platform: 'linux/amd64' });
  assert.deepEqual(max.predicate.runDetails.metadata, { invocationId: 'urn:prismpm:invocation:1', startedOn: '2026-10-25T14:00:00Z', finishedOn: '2026-10-25T14:03:12Z' });
  assert.deepEqual(max.subject, min.subject);
  assert.deepEqual(max.predicate.buildDefinition.resolvedDependencies, min.predicate.buildDefinition.resolvedDependencies);
});

test('min refuses the members only max records, so a leak cannot happen by passing them anyway', async () => {
  for (const extra of [{ arguments: ['build'] }, { platform: 'linux/amd64' }, { invocationId: 'x' }, { startedOn: '2026-10-25T14:00:00Z' }]) {
    await rejects(provenanceStatement(original, { lock: lockBytes, ...extra }), 'provenance.mode');
  }
  await rejects(provenanceStatement(original, { lock: lockBytes, mode: 'full' }), 'provenance.mode');
});

test('max needs every member it records', async () => {
  for (const key of ['arguments', 'platform', 'invocationId', 'startedOn', 'finishedOn']) {
    const options = { ...maxOptions };
    delete options[key];
    await rejects(provenanceStatement(original, options), 'provenance.input');
  }
  await rejects(provenanceStatement(original, { ...maxOptions, startedOn: '2026-10-25 14:00:00' }), 'provenance.input');
  await rejects(provenanceStatement(original, { ...maxOptions, platform: 'amd64' }), 'provenance.input');
  await rejects(provenanceStatement(original, { ...maxOptions, arguments: ['build', 3] }), 'provenance.input');
});

test('resolvedDependencies reads a /3 lock fully and a /2 lock as far as it goes', async () => {
  const three = await resolvedDependencies(lockBytes);
  assert.deepEqual(three.map((r) => r.name), ['sdk-image', 'world', 'application-generator', 'library-generator', 'sdk-lock', 'standards-lock', 'lean', 'lexlean', 'prismpm', 'rustc', 'wasm-bindgen']);
  const two = JSON.parse(changedLock((l) => { delete l.inputs; l.schema = 'prismpm/sdk-lock/2'; }));
  const rows = await resolvedDependencies(JSON.stringify(two));
  assert.deepEqual(rows.map((r) => r.name), ['sdk-image', 'sdk-lock', 'standards-lock']);
  assert.equal(rows.find((r) => r.name === 'sdk-lock').mediaType, 'application/vnd.prismpm.sdk-lock.v2+json');
  const statement = await provenanceStatement(original, { lock: JSON.stringify(two) });
  assert.equal(statement.predicate.buildDefinition.externalParameters.spec, undefined);
  assert.equal(statement.predicate.runDetails.builder.version, undefined);
});

test('a lock that does not describe the archive, or is not a usable lock, is refused with its check id', async () => {
  await rejects(provenanceStatement(original, { lock: changedLock((l) => { l.inputs.model.sha256 = '0'.repeat(64); }) }), 'provenance.lock');
  await rejects(provenanceStatement(original, { lock: changedLock((l) => { l.schema = 'prismpm/sdk-lock/1'; }) }), 'provenance.lock');
  await rejects(provenanceStatement(original, { lock: changedLock((l) => { l.sdk_image = 'ghcr.io/uor-foundation/prismpm-sdk:latest'; }) }), 'provenance.lock');
  await rejects(provenanceStatement(original, { lock: changedLock((l) => { l.standards_lock = 'blake3:00'; }) }), 'provenance.lock');
  await rejects(provenanceStatement(original, { lock: changedLock((l) => { l.inputs.generation.library_generator_sha256 = 'x'; }) }), 'provenance.lock');
  await rejects(provenanceStatement(original, { lock: 'not json' }), 'provenance.lock');
  await rejects(provenanceStatement(original, {}), 'provenance.lock');
});

test('an archive whose footer does not verify is not described', async () => {
  const broken = original.slice();
  broken[broken.length - 1] ^= 1;
  await rejects(provenanceStatement(broken, { lock: lockBytes }), 'provenance.archive');
});

test('the bundle line is canonical JSON, one line, with an empty signature, and equals the stored golden line', async () => {
  const statement = await provenanceStatement(original, { lock: lockBytes });
  const line = provenanceBundle(statement);
  assert.equal(line.includes(0x0a), false);
  assert.deepEqual(line, goldenLine.subarray(0, goldenLine.length - 1));
  assert.equal(goldenLine[goldenLine.length - 1], 0x0a);
  const bundle = JSON.parse(Buffer.from(line).toString('utf8'));
  assert.deepEqual(bundle.dsseEnvelope.signatures, [{ sig: '' }]);
  assert.deepEqual(Buffer.from(bundle.dsseEnvelope.payload, 'base64'), Buffer.from(statementBytes(statement)));
});

test('attachProvenance adds one last Extension row and keeps every original section byte-identical', async () => {
  const stamped = await attachProvenance(original, { lock: lockBytes });
  assert.ok(original.every((b, i) => b === pristine[i]), 'the input was modified');
  const parsed = parseArchive(stamped);
  assert.equal(parsed.sections.length, 9);
  assert.equal(parsed.sections[8].kind, KIND.EXTENSION);
  assert.equal(parsed.extensions.at(-1).name, ATTESTATION_EXTENSION);
  const before = parseArchive(original);
  for (let i = 0; i < 8; i++) assert.deepEqual(parsed.sections[i].body, before.sections[i].body);
  assert.ok(parsed.verification.footer && parsed.verification.labels);
  assert.deepEqual(stripAttestations(stamped), original, 'the unsigned archive is recoverable byte for byte');
});

test('the stored provenance reads back: SLSA, min, unsigned, every subject a blob of this archive', async () => {
  const stamped = await attachProvenance(original, { lock: lockBytes });
  const [attestation] = readAttestations(stamped);
  assert.equal(attestation.predicateType, PROVENANCE_PREDICATE_TYPE);
  assert.equal(attestation.resolved, true);
  assert.equal(attestation.signed, false);
  assert.deepEqual(attestation.bytes, goldenLine.subarray(0, goldenLine.length - 1));
  const [found] = readProvenance(stamped);
  assert.deepEqual({ mode: found.mode, signed: found.signed, index: found.index }, { mode: 'min', signed: false, index: 0 });
  assert.deepEqual(found.statement, await provenanceStatement(original, { lock: lockBytes }));
  const maxStamped = await attachProvenance(original, maxOptions);
  assert.equal(readProvenance(maxStamped)[0].mode, 'max');
  assert.deepEqual(readProvenance(original), []);
});

test('attaching is deterministic, and a second provenance statement is refused', async () => {
  const a = await attachProvenance(original, { lock: lockBytes });
  const b = await attachProvenance(original, { lock: lockBytes });
  assert.deepEqual(a, b);
  await rejects(attachProvenance(a, { lock: lockBytes }), 'provenance.duplicate');
});

test('a holo that carries provenance still loads, replays and reports the statement', async () => {
  const stamped = await attachProvenance(original, { lock: lockBytes });
  const app = await load(stamped);
  const result = await app.acceptance();
  assert.equal(result.failed.length, 0);
  assert.equal(app.attestations().length, 1);
  assert.equal(app.attestations()[0].predicateType, PROVENANCE_PREDICATE_TYPE);
});
