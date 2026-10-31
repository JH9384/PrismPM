/**
 * The archives the scenarios name. A scenario says `"archive": "footer-flipped"`
 * and the harness writes that file and hands the shim its path, so a runtime in
 * any language reads the same bytes and needs no code from this package.
 *
 * Every archive derives from one committed file, the reference Calculator holo,
 * by a recipe below. `corpus/archives.lock.json` pins the sha256 of each result,
 * so a changed recipe is a visible change in review, and `corpus --out <dir>`
 * writes them all for a runtime author to read.
 *
 * Rows of the reference table: 0 manifest, 1 metadata, 2 directory, 3 model
 * extension, 4 guest, 5 view, 6 capability set, 7 model document. A content blob
 * starts with a 71-byte `blake3:<hex>` label.
 */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { blake3 } from './vendor/blake3.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
export const REFERENCE_PATH = here('../corpus/Calculator.holo');
export const LOCK_PATH = here('../corpus/archives.lock.json');

const KIND_EXTENSION = 14;
const LABEL = 71;
const GUEST = 4;
const VIEW = 5;
const CAPABILITY_SET = 6;
const MODEL = 7;
const ATTESTATION_EXTENSION = 'https://uor.foundation/extension/attestation-bundle/v1';

const enc = new TextEncoder();
const dec = new TextDecoder();
const hex = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

function leb(n) {
  const out = [];
  do {
    let byte = n & 0x7f;
    n >>>= 7;
    if (n) byte |= 0x80;
    out.push(byte);
  } while (n);
  return Uint8Array.from(out);
}

const reference = () => new Uint8Array(readFileSync(REFERENCE_PATH));

function table(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return Array.from({ length: view.getUint16(8, true) }, (_, i) => {
    const at = 10 + i * 24;
    return { kind: Number(view.getBigUint64(at, true)), offset: Number(view.getBigUint64(at + 8, true)), length: Number(view.getBigUint64(at + 16, true)) };
  });
}

/** Rewrite the footer as a forger who can hash would, so only the named damage remains. */
function reseal(bytes) {
  const end = bytes.length - 32;
  bytes.set(blake3(bytes.subarray(0, end)), end);
  return bytes;
}

/** The reference archive with `edit(bytes, rows)` applied, footer not recomputed. */
function damaged(edit) {
  const bytes = reference();
  edit(bytes, table(bytes));
  return bytes;
}

const resealed = (edit) => reseal(damaged(edit));

/** An archive from whole section rows: header, table, contiguous bodies, BLAKE3 footer. */
function assemble(rows) {
  const head = new Uint8Array(10 + rows.length * 24);
  head.set(enc.encode('HOLO'));
  const view = new DataView(head.buffer);
  view.setUint16(4, 4, true);
  view.setUint16(8, rows.length, true);
  let offset = head.length;
  rows.forEach((row, i) => {
    view.setBigUint64(10 + i * 24, BigInt(row.kind), true);
    view.setBigUint64(18 + i * 24, BigInt(offset), true);
    view.setBigUint64(26 + i * 24, BigInt(row.body.length), true);
    offset += row.body.length;
  });
  return reseal(concat([head, ...rows.map((row) => row.body), new Uint8Array(32)]));
}

const rowsOf = (bytes) => table(bytes).map((row) => ({ kind: row.kind, body: bytes.slice(row.offset, row.offset + row.length) }));

function extensionBody(name, payload) {
  const nameBytes = enc.encode(name);
  return concat([Uint8Array.of(nameBytes.length & 0xff, nameBytes.length >> 8), nameBytes, payload]);
}

/** One line of an attestation section: an unsigned bundle whose statement claims P3. */
function unsignedClaimLine() {
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'guest', digest: { sha256: '0'.repeat(64), blake3: '0'.repeat(64) } }],
    predicateType: 'https://uor.foundation/prism/proof/v1',
    predicate: { verifiedLevels: ['P3'] },
  };
  const bundle = {
    mediaType: 'application/vnd.dev.sigstore.bundle.v0.3+json',
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ keyid: '', sig: 'AA==' }],
    },
  };
  return enc.encode(`${JSON.stringify(bundle)}\n`);
}

const attestationRow = () => ({ kind: KIND_EXTENSION, body: extensionBody(ATTESTATION_EXTENSION, unsignedClaimLine()) });

function wasmSections(wasm) {
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
    sections.push({ id, start: at, payload: wasm.slice(at, at + size) });
    at += size;
  }
  return sections;
}

const assembleWasm = (sections) => concat([Uint8Array.of(0, 0x61, 0x73, 0x6d, 1, 0, 0, 0), ...sections.flatMap((s) => [Uint8Array.of(s.id), leb(s.payload.length), s.payload])]);

function referenceGuest() {
  const bytes = reference();
  const row = table(bytes)[GUEST];
  return bytes.slice(row.offset + LABEL, row.offset + row.length);
}

/**
 * The archive with another guest module, every fingerprint recomputed: the label
 * in the manifest, the directory and the provenance, the directory's byte length,
 * the application kappa, the table and the footer. Only the guest is wrong.
 */
function withGuest(wasm) {
  const bytes = reference();
  const rows = rowsOf(bytes);
  const oldLabel = dec.decode(rows[GUEST].body.subarray(0, LABEL));
  const newLabel = `blake3:${hex(blake3(wasm))}`;
  rows[GUEST].body = concat([enc.encode(newLabel), wasm]);
  rows[0].body = enc.encode(dec.decode(rows[0].body).replace(oldLabel, newLabel));
  const editJson = (body, edit) => {
    const nameLength = body[0] | (body[1] << 8);
    const json = JSON.parse(dec.decode(body.subarray(2 + nameLength)));
    edit(json);
    return concat([body.subarray(0, 2 + nameLength), enc.encode(JSON.stringify(json))]);
  };
  rows[2].body = editJson(rows[2].body, (directory) => {
    for (const layer of directory.layers) if (layer.content_kappa === oldLabel) layer.content_kappa = newLabel;
    for (const blob of directory.blobs) {
      if (blob.kappa === oldLabel) {
        blob.kappa = newLabel;
        blob.byte_length = wasm.length;
      }
    }
  });
  rows[3].body = editJson(rows[3].body, (provenance) => {
    provenance.guest_content_kappa = newLabel;
    provenance.application_kappa = `blake3:${hex(blake3(rows[0].body))}`;
  });
  return assemble(rows);
}

function mutateGuest(edit) {
  const sections = wasmSections(referenceGuest());
  edit(sections, (id) => sections.findIndex((s) => s.id === id));
  return withGuest(assembleWasm(sections));
}

const name = (text) => concat([leb(enc.encode(text).length), enc.encode(text)]);

/**
 * Every archive by name. A name is part of the suite's contract: scenarios refer
 * to it, so rename one only together with the scenarios that use it.
 */
export const ARCHIVES = Object.freeze({
  reference,

  // Not a holo at all, or a structure no reader may accept.
  empty: () => new Uint8Array(0),
  'too-short': () => new Uint8Array(10),
  'bad-magic': () => damaged((b) => (b[0] ^= 1)),
  'bad-version': () => damaged((b) => (b[4] = 3)),
  'bad-flags': () => damaged((b) => (b[6] = 1)),
  'truncated-table': () => reference().slice(0, 100),
  'section-overrun': () => resealed((b) => new DataView(b.buffer).setBigUint64(26, 999999n, true)),
  'unknown-kind': () => resealed((b) => (b[10] = 99)),
  'manifest-uri': () => resealed((b, rows) => (b[rows[0].offset + 2] ^= 1)),

  // Readable, with one fingerprint that no longer agrees.
  'footer-flipped': () => damaged((b) => (b[b.length - 1] ^= 1)),
  'guest-undecodable': () => resealed((b, rows) => (b[rows[GUEST].offset + LABEL + 10] ^= 0xff)),
  // The last byte of the data section: the guest still compiles and only its label is wrong.
  'guest-data-flipped': () =>
    resealed((b, rows) => {
      const guest = b.subarray(rows[GUEST].offset + LABEL, rows[GUEST].offset + rows[GUEST].length);
      const data = wasmSections(guest).find((s) => s.id === 11);
      if (!data) throw new Error('the reference guest has no data section');
      guest[data.start + data.payload.length - 1] ^= 0x01;
    }),
  'label-flipped': () => resealed((b, rows) => (b[rows[CAPABILITY_SET].offset + 10] = b[rows[CAPABILITY_SET].offset + 10] === 97 ? 98 : 97)),
  'view-flipped': () => resealed((b, rows) => (b[rows[VIEW].offset + LABEL + 10] ^= 0xff)),
  'model-flipped': () => resealed((b, rows) => (b[rows[MODEL].offset + LABEL + 10] ^= 0x01)),

  // A guest whose interface differs from the world it names, with every fingerprint correct.
  'guest-extra-import': () =>
    mutateGuest((sections, at) => {
      const payload = concat([Uint8Array.of(1), name('env'), name('g'), Uint8Array.of(3, 0x7f, 0)]);
      sections.splice(at(1) + 1, 0, { id: 2, payload });
    }),
  'guest-extra-export': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      section.payload = concat([Uint8Array.of(section.payload[0] + 1), section.payload.subarray(1), name('extra'), Uint8Array.of(0, 0)]);
    }),
  'guest-renamed-export': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      section.payload = enc.encode(dec.decode(section.payload).replace('holo_run', 'holo_rux'));
    }),
  'guest-changed-signature': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(1)];
      const p = Uint8Array.from(section.payload);
      const i = p.findIndex((_, k) => p[k] === 0x60 && p[k + 1] === 1 && p[k + 2] === 0x7f && p[k + 3] === 1 && p[k + 4] === 0x7f);
      if (i < 0) throw new Error('no (i32) -> i32 type');
      p[i + 2] = 0x7e;
      section.payload = p;
    }),
  'guest-changed-kind': () =>
    mutateGuest((sections, at) => {
      const section = sections[at(7)];
      const p = Uint8Array.from(section.payload);
      const marker = enc.encode('memory');
      const i = p.findIndex((_, k) => marker.every((b, j) => p[k + j] === b));
      p[i + 6] = 3;
      section.payload = p;
    }),
  // A table import shifts no function or global index, so the guest compiles and the import is all a runtime can refuse.
  'guest-table-import': () =>
    mutateGuest((sections, at) => {
      const payload = concat([Uint8Array.of(1), name('env'), name('host'), Uint8Array.of(1, 0x70, 0, 0)]);
      sections.splice(at(1) + 1, 0, { id: 2, payload });
    }),

  // The attestation section.
  'unsigned-p3-claim': () => assemble([...rowsOf(reference()), attestationRow()]),
  'attestation-not-last': () => {
    const rows = rowsOf(reference());
    rows.splice(rows.length - 1, 0, attestationRow());
    return assemble(rows);
  },
  'attestation-duplicate': () => assemble([...rowsOf(reference()), attestationRow(), attestationRow()]),
});

export const archiveNames = () => Object.keys(ARCHIVES).sort();

/** The bytes of one named archive, checked against the lock when one is given. */
export function archiveBytes(archive, lock = null) {
  const recipe = ARCHIVES[archive];
  if (!recipe) throw new Error(`no archive named ${archive}`);
  const bytes = recipe();
  if (lock) {
    const digest = sha256(bytes);
    if (lock[archive] !== digest) throw new Error(`archive ${archive} is sha256 ${digest}; corpus/archives.lock.json pins ${lock[archive] ?? 'nothing'}`);
  }
  return bytes;
}

export const readLock = () => JSON.parse(readFileSync(LOCK_PATH, 'utf8'));

/** The lock for the recipes as they are now. */
export function computeLock() {
  return Object.fromEntries(archiveNames().map((archive) => [archive, sha256(archiveBytes(archive))]));
}

export function writeLock() {
  writeFileSync(LOCK_PATH, `${JSON.stringify(computeLock(), null, 2)}\n`);
}

/** Write every locked archive into `dir` as `<name>.holo`; returns name to absolute path. */
export function writeCorpus(dir, names = archiveNames()) {
  mkdirSync(dir, { recursive: true });
  const lock = readLock();
  const paths = {};
  for (const archive of names) {
    const path = join(dir, `${archive}.holo`);
    writeFileSync(path, archiveBytes(archive, lock));
    paths[archive] = path;
  }
  return paths;
}

/** The model document of the reference archive, read here so a test can hold the scenario's vectors to it. */
export function referenceModel() {
  const bytes = reference();
  const row = table(bytes)[MODEL];
  return JSON.parse(dec.decode(bytes.subarray(row.offset + LABEL, row.offset + row.length)));
}
