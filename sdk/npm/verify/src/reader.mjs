/**
 * The structural layer of a `.holo`: header, section table, footer position.
 * It never throws on bad bytes. Each step becomes a check, and the first
 * failure stops the walk, because nothing after a broken table can be located.
 *
 * Same layout as `parseArchive` in sdk/npm/prism-code/src/archive.mjs, written
 * against the @prism-code/spec constants; test/agreement.test.mjs compares the
 * two on the reference archive.
 *
 * The table passes only when the archive is one the Wire codec admits
 * (`Foundation.Holo.V1.Wire.validArchiveFrame`, SPEC section 3): the eight
 * Holo/1 rows, or nine with the attestation row last, the manifest template,
 * blobs in ascending label order, and every manifest reference present. The
 * Rust verifier calls the generated codec itself; the conformance suite holds
 * the two to the same refusals. Anything the codec refuses gets no verdict.
 */
import { MAGIC, PHYSICAL_VERSION, FLAGS, HEADER_LENGTH, TABLE_ENTRY_LENGTH, FOOTER_LENGTH, SECTION_ORDER, SECTION_KIND, LABEL_PREFIX, LABEL_LENGTH, APP_MANIFEST, CAPABILITY_SET, EXTENSION, ATTESTATION_BUNDLE } from './vendor/spec.mjs';

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  return value > BigInt(Number.MAX_SAFE_INTEGER) ? null : Number(value);
}

/**
 * @returns {{ checks: { id: string, status: 'pass' | 'fail', detail: string }[],
 *   ok: boolean, sections: { index: number, kind: number, offset: number, length: number }[],
 *   bodyEnd: number }}
 */
export function readStructure(bytes) {
  const checks = [];
  const result = { checks, ok: false, sections: [], bodyEnd: Math.max(0, bytes.length - FOOTER_LENGTH) };
  const pass = (id, detail) => checks.push({ id, status: 'pass', detail });
  const fail = (id, detail) => {
    checks.push({ id, status: 'fail', detail });
    return result;
  };

  if (bytes.length < 4) return fail('archive.magic', `the input is ${bytes.length} bytes, too short for the ${MAGIC} magic`);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) return fail('archive.magic', `expected magic ${MAGIC}, found ${JSON.stringify(magic)}`);
  pass('archive.magic', `magic ${MAGIC}`);

  if (bytes.length < HEADER_LENGTH + FOOTER_LENGTH) {
    return fail('archive.version', `the archive is ${bytes.length} bytes, shorter than its header and footer`);
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint16(4, true);
  if (version !== PHYSICAL_VERSION) return fail('archive.version', `expected physical version ${PHYSICAL_VERSION}, found ${version}`);
  pass('archive.version', `physical version ${version}`);

  const flags = view.getUint16(6, true);
  if (flags !== FLAGS) return fail('archive.flags', `expected flags ${FLAGS}, found ${flags}`);
  pass('archive.flags', `flags ${flags}`);

  const count = view.getUint16(8, true);
  const tableEnd = HEADER_LENGTH + count * TABLE_ENTRY_LENGTH;
  const bodyEnd = bytes.length - FOOTER_LENGTH;
  if (tableEnd > bodyEnd) return fail('archive.table', `a table of ${count} sections needs ${tableEnd} bytes; the body has ${bodyEnd}`);
  let cursor = tableEnd;
  for (let i = 0; i < count; i++) {
    const at = HEADER_LENGTH + i * TABLE_ENTRY_LENGTH;
    const kind = u64(view, at);
    const offset = u64(view, at + 8);
    const length = u64(view, at + 16);
    if (kind === null || offset === null || length === null) return fail('archive.table', `section ${i} has a field above 2^53`);
    if (offset !== cursor) return fail('archive.table', `section ${i} starts at ${offset}, expected ${cursor}`);
    if (offset + length > bodyEnd) return fail('archive.table', `section ${i} ends at ${offset + length}, past the body end ${bodyEnd}: the archive is truncated`);
    result.sections.push({ index: i, kind, offset, length });
    cursor = offset + length;
  }
  if (cursor !== bodyEnd) {
    return fail('archive.table', `the sections end at ${cursor} but the footer starts at ${bodyEnd}: the archive is truncated or padded`);
  }
  const refused = wireProblem(bytes, result.sections);
  if (refused) return fail('archive.table', `the section table is not one the Holo/1 wire model admits: ${refused}`);
  pass('archive.table', `${count} sections, contiguous, ending at the footer, admitted by the Wire codec`);
  result.ok = true;
  return result;
}

const ascii = (text) => Uint8Array.from(text, (c) => c.charCodeAt(0));
const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
/** `wireDirectoryPrefix`, `wireProvenancePrefix`, `wireAttestationPrefix`: a u16 length and the extension name. */
const extensionPrefix = (name) => Uint8Array.from([name.length & 0xff, name.length >> 8, ...ascii(name)]);
const DIRECTORY_PREFIX = extensionPrefix(EXTENSION.APPLICATION_DIRECTORY);
const PROVENANCE_PREFIX = extensionPrefix(EXTENSION.PRISMPM_MODEL);
const ATTESTATION_PREFIX = extensionPrefix(ATTESTATION_BUNDLE.EXTENSION);
const MANIFEST_PREFIX = fromHex(APP_MANIFEST.PREFIX_HEX);
const MANIFEST_SUFFIX = fromHex(APP_MANIFEST.SUFFIX_HEX);
const EMPTY_CAPABILITIES = fromHex(CAPABILITY_SET.EMPTY_HEX);
const LF = ATTESTATION_BUNDLE.LINE_TERMINATOR;
const HEX_DIGIT = /^[0-9a-f]$/;

const startsWith = (value, prefix) => value.length >= prefix.length && prefix.every((byte, i) => value[i] === byte);
const equal = (a, b) => a.length === b.length && startsWith(a, b);
/** `wireBytesLess`: lexicographic, a proper prefix first. */
function less(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i] < b[i];
  return a.length < b.length;
}
/** `wireKappaLabelValid`: `blake3:` and 64 lowercase hex characters. */
const kappa = (value) =>
  value.length === LABEL_LENGTH && startsWith(value, ascii(LABEL_PREFIX)) && [...value.subarray(LABEL_PREFIX.length)].every((b) => HEX_DIGIT.test(String.fromCharCode(b)));
const text = (value) => String.fromCharCode(...value);

/**
 * Why `Foundation.Holo.V1.Wire.validArchiveFrame` refuses the archive whose
 * rows are already contiguous and end at the footer, or null when it admits it.
 */
function wireProblem(bytes, rows) {
  const count = rows.length;
  if (count !== SECTION_ORDER.length && count !== SECTION_ORDER.length + 1) {
    return `it has ${count} rows; the wire model admits ${SECTION_ORDER.length}, or ${SECTION_ORDER.length + 1} with the attestation row last`;
  }
  // wireRowsValid: each row's kind is wireSectionKind of its index.
  const kinds = count === SECTION_ORDER.length ? SECTION_ORDER : [...SECTION_ORDER, ATTESTATION_BUNDLE.SECTION_KIND];
  for (const row of rows) {
    if (row.kind !== kinds[row.index]) return `row ${row.index} is kind ${row.kind}, where the wire model puts kind ${kinds[row.index]}`;
  }
  const payload = (row) => bytes.subarray(row.offset, row.offset + row.length);
  // validCanonicalArchiveBody (every row non-empty) and, with nine rows, its own metadata rule.
  if (rows[1].length === 0) return 'the metadata row is empty';
  // wireBodyPayloadsValid: the extension names, then wirePayloadsValid.
  if (!startsWith(payload(rows[2]), DIRECTORY_PREFIX)) return `row 2 is not the ${EXTENSION.APPLICATION_DIRECTORY} extension`;
  if (!startsWith(payload(rows[3]), PROVENANCE_PREFIX)) return `row 3 is not the ${EXTENSION.PRISMPM_MODEL} extension`;
  // validAppManifest.
  const manifest = payload(rows[0]);
  if (manifest.length !== APP_MANIFEST.LENGTH) return `the application manifest is ${manifest.length} bytes, not ${APP_MANIFEST.LENGTH}`;
  if (!startsWith(manifest, MANIFEST_PREFIX)) return 'the application manifest does not start with the Wire manifest prefix';
  if (!equal(manifest.subarray(APP_MANIFEST.LENGTH - APP_MANIFEST.SUFFIX_LENGTH), MANIFEST_SUFFIX)) return 'the application manifest does not end with the Wire manifest suffix';
  const references = APP_MANIFEST.LABELS.map((role, i) => {
    const at = APP_MANIFEST.PREFIX_LENGTH + i * LABEL_LENGTH;
    return { role, label: manifest.subarray(at, at + LABEL_LENGTH) };
  });
  const malformed = references.find((r) => !kappa(r.label));
  if (malformed) return `the application manifest's ${malformed.role} reference is not a blake3 label`;
  // wireBlobsValid: four blobs, each labelled, in strictly ascending label order.
  const blobs = rows.filter((row) => row.kind === SECTION_KIND.CONTENT_BLOB).map(payload);
  for (const [i, blob] of blobs.entries()) {
    if (!kappa(blob.subarray(0, LABEL_LENGTH))) return `content blob ${i} does not start with a blake3 label`;
    if (i > 0 && !less(blobs[i - 1].subarray(0, LABEL_LENGTH), blob.subarray(0, LABEL_LENGTH))) {
      return `content blob ${i} (${text(blob.subarray(0, LABEL_LENGTH))}) is not after ${text(blobs[i - 1].subarray(0, LABEL_LENGTH))}: blobs are in ascending label order`;
    }
  }
  // wireCapabilitiesPresent and wireReferencePresent.
  for (const { role, label } of references) {
    const blob = blobs.find((b) => equal(b.subarray(0, LABEL_LENGTH), label));
    if (!blob) return `the application manifest's ${role} reference ${text(label)} names no content blob`;
    if (role === APP_MANIFEST.LABELS[0] && !equal(blob.subarray(LABEL_LENGTH), EMPTY_CAPABILITIES)) {
      return `the capability set blob ${text(label)} is not the empty capability set the wire model admits`;
    }
  }
  // wireAttestationRowValid: the extension name, then JSON Lines that end with LF and hold no blank line.
  if (count > SECTION_ORDER.length) {
    const row = payload(rows[SECTION_ORDER.length]);
    if (!startsWith(row, ATTESTATION_PREFIX)) return `row ${SECTION_ORDER.length} is not the ${ATTESTATION_BUNDLE.EXTENSION} extension`;
    if (row.length < ATTESTATION_PREFIX.length + 2) return 'the attestation row holds no bundle line';
    if (row[row.length - 1] !== LF) return 'the attestation row does not end with LF';
    if (row[ATTESTATION_PREFIX.length] === LF) return 'the attestation row starts with a blank line';
    for (let i = 0; i + 1 < row.length; i++) if (row[i] === LF && row[i + 1] === LF) return 'the attestation row holds a blank line';
  }
  return null;
}
