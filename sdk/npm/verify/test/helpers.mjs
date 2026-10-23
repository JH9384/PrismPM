/**
 * The reference archive and ways to damage it. Not a test file.
 *
 * calculator-example `artifacts/Calculator.holo` is the same file as
 * prism-code's fixture (sha256 below, also in ADR-015 and @prism-code/spec's
 * reference test), so the tests read the fixture already in this repository.
 */
import { existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { blake3 } from '../src/vendor/blake3.mjs';
import { validate } from '../src/vendor/json-schema.mjs';

export const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export const REFERENCE_PATH = here('../../prism-code/fixtures/Calculator.holo');
export const REFERENCE_SHA256 = '84371aaac82af6b2a81a25a81d43d4097892985f55ae4919cfdcfa8b6e3486e7';

/** ADR-015's digest table for the reference archive. */
export const ADR_015 = Object.freeze({
  archive: { sha256: REFERENCE_SHA256, blake3: '4efe02106778d44a469cc0fc8f6998167af7c9075a3ac605c150098c0f5243bb' },
  footer: '8408e0895572fab09e783f7aadb129dc4cb96d0b62850a16f3ddbe44ed6021ba',
  guest: { sha256: 'dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03', blake3: '2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380' },
  model: { sha256: '074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6', blake3: 'e76544838a98c46341ed8807f72897ec68de5a8a9bf28721738a76761c9df90e' },
});

/** A fresh copy of the reference archive, so a test may damage it. */
export function reference() {
  const bytes = new Uint8Array(readFileSync(REFERENCE_PATH));
  const digest = createHash('sha256').update(bytes).digest('hex');
  if (digest !== REFERENCE_SHA256) throw new Error(`the reference archive changed: sha256 ${digest}`);
  return bytes;
}

/** The section table of an intact archive: [{ kind, offset, length }]. */
export function table(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(8, true);
  return Array.from({ length: count }, (_, i) => {
    const at = 10 + i * 24;
    return { kind: Number(view.getBigUint64(at, true)), offset: Number(view.getBigUint64(at + 8, true)), length: Number(view.getBigUint64(at + 16, true)) };
  });
}

/** Rewrite the footer to the BLAKE3 of the body, as a forger who can hash would. */
export function reseal(bytes) {
  const end = bytes.length - 32;
  bytes.set(blake3(bytes.subarray(0, end)), end);
  return bytes;
}

/**
 * Replace the JSON payload of the extension section named `name` with
 * `edit(json)`, keeping its length (the edit must preserve the byte count),
 * then reseal the footer.
 */
export function editExtension(bytes, name, edit) {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  for (const row of table(bytes)) {
    if (row.kind !== 14) continue;
    const body = bytes.subarray(row.offset, row.offset + row.length);
    const nameLength = body[0] | (body[1] << 8);
    if (decoder.decode(body.subarray(2, 2 + nameLength)) !== name) continue;
    const payload = body.subarray(2 + nameLength);
    const replaced = encoder.encode(edit(decoder.decode(payload)));
    if (replaced.length !== payload.length) throw new Error('the edit changed the payload length');
    payload.set(replaced);
    return reseal(bytes);
  }
  throw new Error(`no extension ${name}`);
}

/**
 * The `prism/verdict/1` schema: @prism-code/spec's once PR #334 (issue #269)
 * has merged, until then the copy in test/fixtures taken from that PR.
 */
export const VERDICT_SCHEMA_PATH = existsSync(here('../../spec/schemas/verdict/verdict-v1.schema.json'))
  ? here('../../spec/schemas/verdict/verdict-v1.schema.json')
  : here('fixtures/verdict-v1.schema.json');
const verdictSchema = JSON.parse(readFileSync(VERDICT_SCHEMA_PATH, 'utf8'));

/** Fail unless `verdict` validates against `prism/verdict/1`. */
export function assertVerdict(verdict) {
  const errors = validate(verdictSchema, JSON.parse(JSON.stringify(verdict)));
  if (errors.length) throw new Error(`not a prism/verdict/1 object: ${JSON.stringify(errors)}`);
}
