import assert from 'node:assert/strict';
import {createECDH, ECDH} from 'node:crypto';
import {cpSync, mkdtempSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {oraclePoints} from './oracles.mjs';

test('complete original P-256 key-validation sources agree with independent OpenSSL point admission', () => {
  const cases = oraclePoints(); assert.equal(cases.length, 15);
  for (const row of cases) {
    let admitted = false;
    try { ECDH.convertKey(row.key, 'prime256v1', undefined, undefined, 'uncompressed'); admitted = true; } catch {}
    assert.equal(admitted, row.valid, row.source + ':' + row.id);
  }
  const generated = createECDH('prime256v1'); generated.setPrivateKey(Buffer.from('01'.padStart(64, '0'), 'hex'));
  assert.equal(generated.getPublicKey().length, 65);
  assert.equal(cases.filter(row => row.key.length > 65).length, 5, 'all oversized original coordinates are retained');
});

test('substituted original vector bytes cannot be accepted through a self-updated inventory', () => {
  const work = mkdtempSync(join(tmpdir(), 'prismpm-p256-oracle-'));
  try {
    cpSync(new URL('./oracles/', import.meta.url), work, {recursive: true});
    const path = join(work, 'PKV.rsp.base64'), bytes = Buffer.from(readFileSync(path, 'utf8').replaceAll('\n', ''), 'base64');
    bytes[0] ^= 1;
    writeFileSync(path, bytes.toString('base64').match(/.{1,76}/g).join('\n') + '\n');
    assert.throws(() => oraclePoints(new URL('file://' + work + '/')), /independently pinned original vector source/);
  } finally { rmSync(work, {recursive: true}); }
});
