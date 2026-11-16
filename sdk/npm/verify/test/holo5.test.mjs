// Holo v5 (ADR-017): the verdict on the v5 Calculator is the verdict on the v4 one, and damage is caught by the seal.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { verify } from '../src/index.mjs';
import { reference, referenceV5 } from './helpers.mjs';

const checks = (verdict) => verdict.reasons.map((r) => r.check);

test('a holo v5 reaches the level of the same application as v4, for the same reasons, and is named by its κ', async () => {
  const v5 = await verify(referenceV5());
  const v4 = await verify(reference());
  assert.deepEqual({ ...v5, holo: null }, { ...v4, holo: null });
  assert.equal(v5.holo, `sha256:${createHash('sha256').update(referenceV5()).digest('hex')}`);
});

test('any changed byte of a holo v5 fails holo.integrity', async () => {
  const bytes = referenceV5();
  for (const at of [9, 40, 1500, bytes.length - 1]) {
    const bad = bytes.slice();
    bad[at] ^= 1;
    let verdict;
    try {
      verdict = await verify(bad);
    } catch (error) {
      assert.ok(['archive.table', 'archive.version', 'archive.flags', 'format.revision'].includes(error.code), `byte ${at}: ${error.code}`);
      continue;
    }
    assert.ok(checks(verdict).includes('holo.integrity'), `byte ${at}`);
    assert.equal(verdict.passed, false);
  }
});
