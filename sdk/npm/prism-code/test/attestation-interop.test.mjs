// The attestation section written by the JavaScript appender is the section the Rust writer writes (#267, HO-25).
// `Calculator.signed.holo` is appendAttestations of `Calculator.holo` with the two lines of `calculator.bundles.jsonl`;
// crates/prismpm/src/holo/attestation_tests.rs attaches the same lines and must produce the same bytes.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { appendAttestations, readAttestations, stripAttestations } from '../src/attestations.mjs';

const read = (name) => new Uint8Array(readFileSync(new URL(name, import.meta.url)));
const original = read('../fixtures/Calculator.holo');
const signed = read('./fixtures/attestation/Calculator.signed.holo');
const lines = Buffer.from(read('./fixtures/attestation/calculator.bundles.jsonl'))
  .toString('utf8')
  // A text checkout may convert line endings; the lines themselves carry none.
  .split(/\r?\n/)
  .filter(Boolean);

test('the committed signed calculator is appendAttestations of the committed lines', () => {
  assert.equal(lines.length, 2);
  assert.ok(Buffer.from(appendAttestations(original, lines)).equals(Buffer.from(signed)));
  const bundles = readAttestations(signed);
  assert.deepEqual(bundles.map((b) => Buffer.from(b.bytes).toString('utf8')), lines);
  assert.ok(bundles.every((b) => b.resolved));
});

test('stripping the committed signed calculator returns the reference archive byte for byte', () => {
  assert.ok(Buffer.from(stripAttestations(signed)).equals(Buffer.from(original)));
});
