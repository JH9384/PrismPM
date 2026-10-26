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

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (b) => Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
const concat = (parts) => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const leb = (n) => {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Uint8Array.from(out);
};

/** The top-level sections of a core wasm module: [{ id, payload }]. */
export function wasmSections(wasm) {
  const sections = [];
  let at = 8;
  const readLeb = () => {
    let result = 0;
    for (let shift = 0; ; shift += 7) {
      const byte = wasm[at++];
      result += (byte & 0x7f) * 2 ** shift;
      if (byte < 0x80) return result;
    }
  };
  while (at < wasm.length) {
    const id = wasm[at++];
    const size = readLeb();
    sections.push({ id, payload: wasm.slice(at, at + size) });
    at += size;
  }
  return sections;
}

/** A core wasm module from its sections, in the order given. */
export function assembleWasm(sections) {
  return concat([wasmHeader, ...sections.flatMap((s) => [Uint8Array.of(s.id), leb(s.payload.length), s.payload])]);
}
const wasmHeader = Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0);

/** The reference archive's guest module. */
export function referenceGuest() {
  const bytes = reference();
  const row = table(bytes)[4];
  return bytes.slice(row.offset + 71, row.offset + row.length);
}

/**
 * The archive with another guest module in place of the reference guest, every
 * fingerprint recomputed: the guest's label in the manifest, the directory and
 * the provenance, the directory's byte length, the provenance's application
 * kappa, the section table and the footer. The only thing wrong with the result
 * is the guest.
 */
export function withGuest(wasm) {
  const bytes = reference();
  const rows = table(bytes);
  const bodies = rows.map((r) => bytes.slice(r.offset, r.offset + r.length));
  const oldLabel = dec.decode(bodies[4].subarray(0, 71));
  const newLabel = `blake3:${hex(blake3(wasm))}`;
  bodies[4] = concat([enc.encode(newLabel), wasm]);
  bodies[0] = enc.encode(dec.decode(bodies[0]).replace(oldLabel, newLabel));
  const editJson = (body, edit) => {
    const nameLength = body[0] | (body[1] << 8);
    const head = body.subarray(0, 2 + nameLength);
    const json = JSON.parse(dec.decode(body.subarray(2 + nameLength)));
    edit(json);
    return concat([head, enc.encode(JSON.stringify(json))]);
  };
  bodies[2] = editJson(bodies[2], (directory) => {
    for (const layer of directory.layers) if (layer.content_kappa === oldLabel) layer.content_kappa = newLabel;
    for (const blob of directory.blobs) {
      if (blob.kappa === oldLabel) {
        blob.kappa = newLabel;
        blob.byte_length = wasm.length;
      }
    }
  });
  bodies[3] = editJson(bodies[3], (provenance) => {
    provenance.guest_content_kappa = newLabel;
    provenance.application_kappa = `blake3:${hex(blake3(bodies[0]))}`;
  });
  const count = bodies.length;
  const head = new Uint8Array(10 + count * 24);
  head.set(bytes.subarray(0, 10));
  const view = new DataView(head.buffer);
  let offset = head.length;
  bodies.forEach((body, i) => {
    view.setBigUint64(10 + i * 24, BigInt(rows[i].kind), true);
    view.setBigUint64(10 + i * 24 + 8, BigInt(offset), true);
    view.setBigUint64(10 + i * 24 + 16, BigInt(body.length), true);
    offset += body.length;
  });
  const out = concat([head, ...bodies, new Uint8Array(32)]);
  return reseal(out);
}

/** The reference guest with one change to its interface; `kind` names the change. Only the interface stays readable, not every result is a valid module. */
export function mutatedGuest(kind) {
  const guest = referenceGuest();
  const sections = wasmSections(guest);
  const at = (id) => sections.findIndex((s) => s.id === id);
  switch (kind) {
    case 'extra import': {
      // import global env.g: i32, immutable; a global import shifts no function index
      const payload = concat([Uint8Array.of(1), leb(3), enc.encode('env'), leb(1), enc.encode('g'), Uint8Array.of(3, 0x7f, 0)]);
      sections.splice(at(1) + 1, 0, { id: 2, payload });
      return assembleWasm(sections);
    }
    case 'extra export': {
      const s = sections[at(7)];
      const count = s.payload[0];
      if (count >= 127) throw new Error('unexpected export count');
      s.payload = concat([Uint8Array.of(count + 1), s.payload.subarray(1), leb(5), enc.encode('extra'), Uint8Array.of(0, 0)]);
      return assembleWasm(sections);
    }
    case 'renamed export': {
      const s = sections[at(7)];
      const text = dec.decode(s.payload);
      if (!text.includes('holo_run')) throw new Error('no holo_run export');
      s.payload = enc.encode(text.replace('holo_run', 'holo_rux'));
      return assembleWasm(sections);
    }
    case 'changed signature': {
      // holo_alloc: (i32) -> i32 becomes (i64) -> i32 in the type section
      const s = sections[at(1)];
      const i = s.payload.findIndex((_, k) => s.payload[k] === 0x60 && s.payload[k + 1] === 1 && s.payload[k + 2] === 0x7f && s.payload[k + 3] === 1 && s.payload[k + 4] === 0x7f);
      if (i < 0) throw new Error('no (i32) -> i32 type');
      s.payload = Uint8Array.from(s.payload);
      s.payload[i + 2] = 0x7e;
      return assembleWasm(sections);
    }
    case 'changed kind': {
      // memory is exported as a global
      const s = sections[at(7)];
      const marker = enc.encode('memory');
      const i = s.payload.findIndex((_, k) => marker.every((b, j) => s.payload[k + j] === b));
      s.payload = Uint8Array.from(s.payload);
      s.payload[i + 6] = 3;
      return assembleWasm(sections);
    }
    default:
      throw new Error(`unknown mutation ${kind}`);
  }
}
