import assert from 'node:assert/strict';
import {createHash, createPublicKey} from 'node:crypto';
import test from 'node:test';
import {CORPUS_CASES, corpus, domain, encode, genesis, projection, publicKey, validPublicKey} from './corpus.mjs';

test('independent exact canonical sizes and complete finite inventory', () => {
  assert.equal(encode(genesis()).length, 137);
  assert.equal(domain.length, 26);
  assert.equal(projection(genesis())[3].length, 163);
  assert.equal(encode([1, 2, genesis()[1], genesis()]).length, 174);
  assert.equal(encode([1, 0, projection(genesis())]).length, 409);
  const rows = corpus();
  assert.equal(rows.length, CORPUS_CASES);
  assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  assert.equal(rows.filter(row => row.id.startsWith('Truncated')).length, 174);
  for (const id of ['FrameMaximum', 'FrameOverflow', 'NamespaceMismatch31',
    'IdentityByte1_31', 'IdentityByte2_31', 'InitialKeyByte64', 'InitialValidKey64',
    'ZeroPoint_0', 'CoordinateXEqualsP_1', 'CoordinateYAboveP_2'])
    assert.ok(rows.some(row => row.id === id), id);
});

test('OpenSSL imports the actual initial point and independently hashes identity material', () => {
  const key = publicKey(), jwk = {kty: 'EC', crv: 'P-256',
    x: key.subarray(1, 33).toString('base64url'), y: key.subarray(33).toString('base64url')};
  assert.equal(createPublicKey({key: jwk, format: 'jwk'}).asymmetricKeyType, 'ec');
  const base = genesis(), digest = value => createHash('sha256').update(projection(value)[3]).digest('hex');
  const identities = new Set([digest(base)]);
  for (const field of [1, 2, 3]) {
    const value = genesis();
    if (field === 3) value[3] = validPublicKey(2);
    else value[field][0] ^= 1;
    identities.add(digest(value));
  }
  assert.equal(identities.size, 4);
  const withoutDomain = createHash('sha256').update(encode(base)).digest('hex');
  assert.notEqual(withoutDomain, digest(base));
  assert.throws(() => createPublicKey({format: 'jwk', key: {...jwk,
    x: Buffer.alloc(32).toString('base64url'), y: Buffer.alloc(32).toString('base64url')}}));
});
