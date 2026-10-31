// The scenarios and the corpus: well formed, pinned, and held to their sources.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { allChecks, archiveBytes, archiveNames, computeLock, expand, loadScenarios, mismatches, OPERATIONS, problemsOfFile, readLock, writeCorpus } from '../src/index.mjs';
import { referenceModel, REFERENCE_PATH } from '../src/corpus.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const features = loadScenarios();
const checks = allChecks(features);
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('the suite covers each part of the runtime contract the issue names', () => {
  assert.deepEqual(features.map((feature) => feature.feature), ['capabilities', 'digests', 'dispatch', 'errors', 'load', 'replay', 'verify', 'world']);
  for (const feature of features) assert.ok(feature.checks.length >= 5, `${feature.feature} has few checks`);
  assert.equal(new Set(checks.map((check) => check.id)).size, checks.length);
});

test('every replay check is a placeholder tied to its issue, and no other check is one', () => {
  for (const check of checks) {
    if (check.feature === 'replay') {
      assert.equal(check.placeholder?.issue, 284, check.id);
    } else {
      assert.equal(check.placeholder, undefined, check.id);
    }
  }
});

test('every operation and every archive is used by a check, so nothing in the contract or the corpus is dead', () => {
  const used = new Set(checks.map((check) => check.op));
  for (const op of Object.keys(OPERATIONS)) assert.ok(used.has(op), op);
  const archives = new Set(checks.map((check) => check.archive));
  for (const archive of archiveNames()) assert.ok(archives.has(archive), archive);
});

test('no check compares a message: a message is for a person and never part of the contract', () => {
  for (const file of readdirSync(here('../scenarios/'))) {
    assert.doesNotMatch(readFileSync(here(`../scenarios/${file}`), 'utf8'), /"message"/, file);
  }
});

test('a malformed scenario file is refused with the reason', () => {
  const file = (check) => ({ feature: 'load', title: 't', checks: [check] });
  const ok = { id: 'load.x', title: 't', op: 'load', archive: 'reference', expect: { ok: true, result: {} } };
  const problem = (check) => problemsOfFile(file(check), 'load.json')[0];
  assert.deepEqual(problemsOfFile(file(ok), 'load.json'), []);
  assert.match(problem({ ...ok, id: 'Load X' }), /not dotted lowercase/);
  assert.match(problem({ ...ok, id: 'verify.x' }), /does not start with its feature/);
  assert.match(problem({ ...ok, title: '' }), /no title/);
  assert.match(problem({ ...ok, op: 'teleport' }), /unknown operation/);
  assert.match(problem({ ...ok, archive: 'nope' }), /unknown archive/);
  assert.match(problem({ ...ok, archive: undefined }), /names none/);
  assert.match(problem({ ...ok, op: 'capabilities' }), /reads no archive/);
  assert.match(problem({ ...ok, extra: 1 }), /unknown member/);
  assert.match(problem({ ...ok, expect: { ok: true } }), /what result/);
  assert.match(problem({ ...ok, expect: { ok: false } }), /what error/);
  assert.match(problem({ ...ok, expect: {} }), /ok true or false/);
  assert.match(problem({ ...ok, expect: { ok: true, result: { a: { $contain: [] } } } }), /unknown operator \$contain/);
  assert.match(problem({ id: 'load.p', title: 't', placeholder: { reason: 'r' } }), /names no issue/);
  assert.match(problem({ id: 'load.p', title: 't', placeholder: { issue: 1 } }), /no reason/);
  assert.match(problem({ id: 'load.p', title: 't', placeholder: { issue: 1, reason: 'r' }, op: 'load' }), /cannot have op/);
  assert.match(problemsOfFile({ feature: 'other', title: 't', checks: [ok] }, 'load.json')[0], /feature must be load/);
});

test('the reference archive is the runtime fixture, byte for byte, and the file ADR-015 pins', () => {
  const bytes = readFileSync(REFERENCE_PATH);
  assert.deepEqual(bytes, readFileSync(here('../../prism-code/fixtures/Calculator.holo')));
  assert.equal(sha256(bytes), '84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7');
});

test('the digests the scenarios expect are the ones ADR-015 states, not read from a runtime', () => {
  const adr = readFileSync(here('../../../../docs/adr/015-dual-digests.md'), 'utf8');
  const digests = features.find((feature) => feature.feature === 'digests');
  const pinned = digests.checks.find((check) => check.id === 'digests.pin.match').input.policy.digests;
  for (const target of ['archive', 'guest', 'model']) {
    for (const algorithm of ['sha256', 'blake3']) assert.ok(adr.includes(pinned[target][algorithm]), `${target} ${algorithm} is not in ADR-015`);
  }
  assert.ok(adr.includes('8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba'), 'the footer is not in ADR-015');
});

test('the dispatch vectors are the model document\'s own, so a change to either fails here', () => {
  const { requests } = expand(checks.find((check) => check.id === 'dispatch.vectors.reference').input);
  const { responses } = expand(checks.find((check) => check.id === 'dispatch.vectors.reference').expect.result);
  const vectors = referenceModel().application.acceptance_vectors;
  assert.equal(vectors.length, 22);
  assert.deepEqual(requests, vectors.map((vector) => Buffer.from(vector.request).toString('hex')));
  assert.deepEqual(responses.map((response) => response.hex), vectors.map((vector) => Buffer.from(vector.response).toString('hex')));
});

test('the corpus is deterministic and matches its lock', () => {
  assert.deepEqual(computeLock(), readLock());
  assert.deepEqual(Object.keys(readLock()).sort(), archiveNames());
});

test('every damaged archive differs from the reference, and all have distinct bytes', () => {
  const lock = readLock();
  assert.equal(new Set(Object.values(lock)).size, archiveNames().length);
});

test('writeCorpus writes the locked bytes, and refuses bytes the lock does not pin', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-conformance-corpus-'));
  const paths = writeCorpus(dir, ['footer-flipped']);
  assert.equal(sha256(readFileSync(paths['footer-flipped'])), readLock()['footer-flipped']);
  assert.throws(() => archiveBytes('footer-flipped', { 'footer-flipped': '0'.repeat(64) }), /archives\.lock\.json pins/);
  assert.throws(() => archiveBytes('nope'), /no archive named/);
});

test('the vendored files are what scripts/vendor.mjs makes from their origins today', () => {
  execFileSync(process.execPath, [here('../scripts/vendor.mjs'), '--check'], { stdio: 'pipe' });
});

test('expand writes hex and leaves everything else alone', () => {
  assert.equal(expand({ $utf8: '1\tok' }), '3109' + '6f6b');
  assert.equal(expand({ $utf8: '' }), '');
  assert.equal(expand({ $zeros: 2 }), '0000');
  assert.deepEqual(expand({ a: [{ $utf8: 'A' }, 'ff', 1, null] }), { a: ['41', 'ff', 1, null] });
});

test('the matcher: a subset of objects, whole arrays, and the operators', () => {
  const ok = (expected, actual) => assert.deepEqual(mismatches(expected, actual), []);
  const no = (expected, actual, pattern) => assert.match(mismatches(expected, actual).join('\n'), pattern);
  ok({ a: 1 }, { a: 1, b: 2 });
  ok({ a: { b: null } }, { a: { b: null, c: 1 } });
  no({ a: 1 }, { a: 2 }, /\$\.a: expected 1, found 2/);
  no({ a: 1 }, {}, /expected 1, found nothing/);
  no({ a: null }, {}, /expected null/);
  no({ a: 1 }, null, /expected an object/);
  ok([1, 2], [1, 2]);
  no([1], [1, 2], /expected 1 elements, found 2/);
  no([1, 2], [2, 1], /\$\[0\]/);
  no([], 'x', /expected an array/);
  ok({ $contains: [{ a: 1 }] }, [{ a: 2 }, { a: 1, b: 1 }]);
  no({ $contains: [{ a: 3 }] }, [{ a: 1 }], /no element matches/);
  no({ $contains: [] }, 'x', /expected an array/);
  ok({ $excludes: [{ a: 3 }] }, [{ a: 1 }]);
  no({ $excludes: [{ a: 1 }] }, [{ a: 1, b: 2 }], /must not appear/);
  ok({ v: { $absent: true } }, {});
  ok({ v: { $absent: true } }, { v: null });
  no({ v: { $absent: true } }, { v: 0 }, /expected nothing, found 0/);
});
