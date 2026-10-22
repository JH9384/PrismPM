// Independent protocol oracle: RFC bytes plus Node's separate base64/SHA implementation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

export const RFC_SHA256 = '1972e5d81cbaba7066cfd46374207bc2b4546b085ed5dd9b034e79e023e0ca31';
export function officialExample() {
  const bytes = readFileSync(new URL('./oracles/rfc7636.txt', import.meta.url));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), RFC_SHA256, 'exact official RFC source');
  const text = bytes.toString('utf8').split('The client uses output of a suitable random number generator to')[1];
  assert.ok(text);
  const arrays = [...text.matchAll(/\[([0-9,\s]+)\]/g)].slice(0, 2).map(match =>
    Buffer.from(match[1].split(',').map(value => Number(value.trim()))));
  const verifier = /code_verifier:\s+([A-Za-z0-9_-]{43})/.exec(text)[1];
  const challenge = /code_challenge:\s+([A-Za-z0-9_-]{43})/.exec(text)[1];
  assert.equal(arrays.length, 2); assert.ok(arrays.every(value => value.length === 32));
  assert.equal(arrays[0].toString('base64url'), verifier);
  assert.deepEqual(createHash('sha256').update(verifier, 'ascii').digest(), arrays[1]);
  assert.equal(arrays[1].toString('base64url'), challenge);
  return {entropy: arrays[0], digest: arrays[1], verifier, challenge};
}
export function corpus() {
  const rows = [], official = officialExample();
  const add = (id, operation, input, expected) => rows.push({id,
    request: Buffer.concat([Buffer.from([operation]), input]), response: Buffer.from(expected)});
  const success = value => Buffer.concat([Buffer.from([0]), value]);
  const badLength = [1, 1], badCharacter = [1, 2], badOperation = [1, 3];
  add('rfc-entropy', 0, official.entropy, success(Buffer.from(official.verifier)));
  add('rfc-digest', 2, official.digest, success(Buffer.from(official.challenge)));
  add('rfc-verifier', 1, Buffer.from(official.verifier), success(Buffer.from(official.verifier)));
  rows.push({id: 'empty', request: Buffer.alloc(0), response: Buffer.from(badLength)});
  for (let length = 0; length <= 130; length++) {
    const value = Buffer.alloc(length, 65);
    add('length-' + length, 1, value, length >= 43 && length <= 128 ? success(value) : badLength);
    for (const [name, operation] of [['entropy', 0], ['digest', 2]])
      add(name + '-' + length, operation, value, length === 32 ? success(Buffer.from(value.toString('base64url'))) : badLength);
  }
  // Every possible octet at every position of the longest admitted verifier.
  for (let at = 0; at < 128; at++) for (let byte = 0; byte <= 255; byte++) {
    const value = Buffer.alloc(128, 65); value[at] = byte;
    const valid = /^[A-Za-z0-9._~-]$/.test(String.fromCharCode(byte));
    add('octet-128-' + at + '-' + byte, 1, value, valid ? success(value) : badCharacter);
  }
  for (let byte = 0; byte <= 255; byte++) {
    const value = Buffer.alloc(32, byte);
    add('encoding-octet-' + byte, 0, value, success(Buffer.from(value.toString('base64url'))));
  }
  for (let bit = 0; bit < 256; bit++) {
    const value = Buffer.alloc(32); value[bit >> 3] = 1 << (bit & 7);
    add('encoding-bit-' + bit, 2, value, success(Buffer.from(value.toString('base64url'))));
  }
  for (let operation = 3; operation <= 255; operation++) add('operation-' + operation, operation, official.entropy, badOperation);
  assert.equal(rows.length, 33930); assert.equal(new Set(rows.map(row => row.id)).size, rows.length);
  return rows;
}
export const tsv = rows => rows.map(row => row.id + '\t' + row.request.toString('hex') + '\t' + row.response.toString('hex') + '\n').join('');
