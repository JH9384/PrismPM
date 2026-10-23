import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { blake3Hex, Blake3, kappa } from '../src/blake3.mjs';

const vectors = JSON.parse(readFileSync(new URL('./blake3-vectors.json', import.meta.url), 'utf8'));

function input(length) {
  const out = new Uint8Array(length);
  for (let i = 0; i < length; i++) out[i] = i % 251;
  return out;
}

test('BLAKE3 matches the official test vectors', () => {
  for (const { input_len, hash } of vectors.cases) {
    assert.equal(blake3Hex(input(input_len)), hash, `input length ${input_len}`);
  }
});

test('BLAKE3 is independent of how the input is split', () => {
  const bytes = input(7169);
  const whole = blake3Hex(bytes);
  for (const step of [1, 7, 63, 64, 65, 1000, 1024, 1025, 4096]) {
    const hasher = new Blake3();
    for (let at = 0; at < bytes.length; at += step) hasher.update(bytes.subarray(at, at + step));
    assert.equal(Buffer.from(hasher.digest()).toString('hex'), whole, `step ${step}`);
  }
});

test('a kappa label is blake3: and 64 hex characters, 71 bytes', () => {
  const label = kappa(new Uint8Array(0));
  assert.equal(label, 'blake3:af1349b9f5f9a1a6a0404dea36dcc9499bcb25c9adc112b7cc9a93cae41f3262');
  assert.equal(Buffer.byteLength(label), 71);
});
