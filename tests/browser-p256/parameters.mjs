// Independently transcribed SEC2 v2 §2.4.2; never imported from model output.
import assert from 'node:assert/strict';
import {createECDH} from 'node:crypto';
import {spawnSync} from 'node:child_process';
export const parameters = Object.freeze({
  p: 'ffffffff00000001000000000000000000000000ffffffffffffffffffffffff',
  a: 'ffffffff00000001000000000000000000000000fffffffffffffffffffffffc',
  b: '5ac635d8aa3a93e7b3ebbd55769886bc651d06b0cc53b0f63bce3c3e27d2604b',
  generator: '046b17d1f2e12c4247f8bce6e563a440f277037d812deb33a0f4a13945d898c2964fe342e2fe1a7f9b8ee7eb4a7c0f9e162bce33576b315ececbb6406837bf51f5',
  order: 'ffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551',
  cofactor: 1,
});
export function verifyNativeParameters() {
  const result = spawnSync('openssl', ['ecparam', '-name', 'prime256v1', '-param_enc', 'explicit', '-text', '-noout'],
    {encoding: 'utf8', timeout: 10000, maxBuffer: 16384});
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr);
  const field = (heading, next, signed) => {
    const value = result.stdout.split(heading + ':')[1]?.split(next + ':')[0]; assert.ok(value);
    let hex = value.replaceAll(/\s|:/g, ''); assert.match(hex, /^[a-f0-9]+$/);
    if (signed && hex.startsWith('00')) hex = hex.slice(2);
    return hex;
  };
  assert.equal(field('Prime', 'A', true), parameters.p);
  assert.equal(field('A', 'B', true), parameters.a);
  assert.equal(field('B', 'Generator (uncompressed)', true), parameters.b);
  assert.equal(field('Generator (uncompressed)', 'Order', false), parameters.generator);
  assert.equal(field('Order', 'Cofactor', true), parameters.order);
  assert.match(result.stdout, /Cofactor:\s+1 \(0x1\)/);
  const key = createECDH('prime256v1'); key.setPrivateKey(Buffer.from('01'.padStart(64, '0'), 'hex'));
  assert.equal(key.getPublicKey(undefined, 'uncompressed').toString('hex'), parameters.generator);
  return {parameters, openssl: result.stdout, nodeOpenSSL: process.versions.openssl};
}
