/**
 * Reader for the `.holo` application archive. PrismPM writes holo v5, a UORC
 * archive of ordered objects named by κ (ADR-017, `src/uorc.mjs`); the
 * Hologram physical-v4 archive below stays readable and is never written.
 *
 * Legacy v4 is the archive PrismPM composed before v5 (`SPEC.md` §3, `crates/prismpm/src/holo/archive.rs`, encoded through
 * `Foundation.Holo.V1.Wire`).
 *
 * Layout, little-endian:
 *
 *   0      "HOLO"
 *   4      u16 physical version, 4
 *   6      u16 flags, 0
 *   8      u16 section count
 *   10     section table: per section u64 kind, u64 offset, u64 length
 *   ...    section bodies, contiguous, in table order
 *   end-32 BLAKE3 of everything before it (the archive fingerprint)
 *
 * Section kinds: 15 application manifest, 8 metadata, 14 extension, 16 content
 * blob. A content blob starts with its 71-byte `blake3:<hex>` label.
 */
import { DigestMismatchError, fail } from './errors.mjs';
import { blake3Hex, kappa as v4Label } from './blake3.mjs';
import { isUorc, kappa, layout } from './uorc.mjs';

export const MAGIC = 'HOLO';
export const VERSION = 4;
/** Holo v5 (ADR-017): schema of the manifest object and the roles of the ordered objects. */
export const MANIFEST_SCHEMA_V5 = 'prism/holo/5';
export const PROVENANCE_SCHEMA_V5 = 'prismpm/model-provenance/2';
export const ROLES_V5 = Object.freeze(['manifest', 'source-manifest', 'provenance', 'capabilities', 'guest', 'view', 'model']);
export const ROLE_ATTESTATIONS = 'attestations';
export const KIND = Object.freeze({ APP_MANIFEST: 15, METADATA: 8, EXTENSION: 14, CONTENT_BLOB: 16 });
export const LABEL_LENGTH = 71;
export const FOOTER_LENGTH = 32;
export const HEADER_LENGTH = 10;
export const TABLE_ENTRY_LENGTH = 24;

export const DIRECTORY_EXTENSION = 'https://hologram.foundation/extension/application-directory/v1';
export const MODEL_EXTENSION = 'https://uor.foundation/extension/prismpm-model/v1';
export const APP_MANIFEST_URI = 'https://hologram.foundation/realization/app-manifest';
/** `Foundation.Holo.V1.Wire`: `wireManifestPrefix` is 57 bytes, the manifest 356, `wireManifestSuffix` the 86 bytes below. */
export const MANIFEST_LENGTH = 356;
export const MANIFEST_PREFIX_LENGTH = 57;
export const MANIFEST_SUFFIX_HEX =
  '52000000' + '00000000020000000008000000' + '686f6c6f5f72756e' + '1a000000' + '686f6c6f6772616d3a67756573742f636f72652d7761736d4031' +
  '030a000000' + '696e6465782e68746d6c' + '08000000' + '706f727461626c65' + '00000000';

const decoder = new TextDecoder('utf-8', { fatal: true });

export function asBytes(source) {
  if (source instanceof Uint8Array) return source;
  if (source instanceof ArrayBuffer) return new Uint8Array(source);
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  fail('archive.input', 'expected bytes (Uint8Array or ArrayBuffer)');
}

function u64(view, offset) {
  const value = view.getBigUint64(offset, true);
  if (value > BigInt(Number.MAX_SAFE_INTEGER)) fail('archive.bounds', `field at ${offset} exceeds 2^53`);
  return Number(value);
}

function isLabel(bytes) {
  if (bytes.length !== LABEL_LENGTH) return false;
  for (let i = 0; i < 7; i++) if (bytes[i] !== 'blake3:'.charCodeAt(i)) return false;
  for (let i = 7; i < LABEL_LENGTH; i++) {
    const c = bytes[i];
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

/**
 * Parse an archive. Structural errors throw; integrity results are returned in
 * `verification` so a caller can decide what an unverified archive is worth.
 */
export function parseArchive(source) {
  const bytes = asBytes(source);
  if (isUorc(bytes)) return parseArchiveV5(bytes);
  if (bytes.length < HEADER_LENGTH + FOOTER_LENGTH) fail('archive.bounds', 'archive shorter than header and footer');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const magic = String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
  if (magic !== MAGIC) fail('archive.magic', `expected magic ${MAGIC}, found ${JSON.stringify(magic)}`);
  const version = view.getUint16(4, true);
  if (version !== VERSION) fail('archive.version', `expected physical version ${VERSION}, found ${version}`);
  const flags = view.getUint16(6, true);
  if (flags !== 0) fail('archive.flags', `expected flags 0, found ${flags}`);
  const count = view.getUint16(8, true);
  const tableEnd = HEADER_LENGTH + count * TABLE_ENTRY_LENGTH;
  const bodyEnd = bytes.length - FOOTER_LENGTH;
  if (tableEnd > bodyEnd) fail('archive.bounds', `section table of ${count} entries overruns the archive`);

  const sections = [];
  let cursor = tableEnd;
  for (let i = 0; i < count; i++) {
    const at = HEADER_LENGTH + i * TABLE_ENTRY_LENGTH;
    const kind = u64(view, at);
    const offset = u64(view, at + 8);
    const length = u64(view, at + 16);
    if (offset !== cursor) fail('archive.bounds', `section ${i} starts at ${offset}, expected ${cursor}`);
    if (offset + length > bodyEnd) fail('archive.bounds', `section ${i} overruns the archive body`);
    sections.push({ index: i, kind, offset, length, body: bytes.subarray(offset, offset + length) });
    cursor = offset + length;
  }
  if (cursor !== bodyEnd) fail('archive.bounds', `sections end at ${cursor}, body ends at ${bodyEnd}`);

  const body = bytes.subarray(0, bodyEnd);
  const footer = blake3HexOf(bytes.subarray(bodyEnd));
  const fingerprint = blake3Hex(body);
  const labelMismatches = [];
  // Text a section holds, or a refusal: never a raw decoding error. When the footer
  // does not match either, the bytes were altered, and that is the reason to name.
  const text = (slice, check, what) => {
    try {
      return decoder.decode(slice);
    } catch {
      if (footer !== fingerprint) {
        throw new DigestMismatchError(`integrity failure: the holo was altered: the footer is not the BLAKE3 of the body, and ${what} is not UTF-8`, { check: 'holo.integrity' });
      }
      return fail(check, `${what} is not UTF-8`);
    }
  };

  let manifest = null;
  let metadata = null;
  const extensions = [];
  const blobs = [];
  try {
  for (const section of sections) {
    const b = section.body;
    switch (section.kind) {
      case KIND.APP_MANIFEST: {
        // `Foundation.Holo.V1.Wire.validAppManifest`: exactly 356 bytes, the
        // 57-byte prefix (URI, NUL, u32 LE 3), three 71-byte labels (requires,
        // guest, view), then the fixed 86-byte layer suffix.
        if (b.length !== MANIFEST_LENGTH) fail('archive.manifest', `application manifest is ${b.length} bytes, expected ${MANIFEST_LENGTH}`);
        const nul = b.indexOf(0);
        if (nul !== MANIFEST_PREFIX_LENGTH - 5) fail('archive.manifest', 'application manifest URI has the wrong length');
        const uri = text(b.subarray(0, nul), 'archive.manifest', 'the application manifest URI');
        if (uri !== APP_MANIFEST_URI) fail('archive.manifest', `application manifest URI is ${uri}`);
        const labelCount = new DataView(b.buffer, b.byteOffset + nul + 1, 4).getUint32(0, true);
        if (labelCount !== 3) fail('archive.manifest', `application manifest declares ${labelCount} labels, expected 3`);
        const labels = [];
        for (let i = 0; i < 3; i++) {
          const label = b.subarray(MANIFEST_PREFIX_LENGTH + i * LABEL_LENGTH, MANIFEST_PREFIX_LENGTH + (i + 1) * LABEL_LENGTH);
          if (!isLabel(label)) fail('archive.manifest', `application manifest label ${i} is not a blake3 label`);
          labels.push(decoder.decode(label));
        }
        const suffix = b.subarray(MANIFEST_PREFIX_LENGTH + 3 * LABEL_LENGTH);
        if (blake3HexOf(suffix) !== MANIFEST_SUFFIX_HEX) fail('archive.manifest', 'application manifest layer suffix is not the Wire constant');
        if (manifest) fail('archive.manifest', 'more than one application manifest');
        manifest = { uri, labels, suffix, section: section.index };
        break;
      }
      case KIND.METADATA: {
        if (metadata) fail('archive.metadata', 'more than one metadata section');
        metadata = { text: text(b, 'archive.metadata', `metadata section ${section.index}`), section: section.index };
        break;
      }
      case KIND.EXTENSION: {
        if (b.length < 2) fail('archive.extension', 'extension shorter than its name length');
        const nameLength = b[0] | (b[1] << 8);
        if (2 + nameLength > b.length) fail('archive.extension', 'extension name overruns the section');
        const name = text(b.subarray(2, 2 + nameLength), 'archive.extension', `the name of extension section ${section.index}`);
        const payload = b.subarray(2 + nameLength);
        extensions.push({ name, payload, text: text(payload, 'archive.extension', `extension ${name}`), section: section.index });
        break;
      }
      case KIND.CONTENT_BLOB: {
        if (b.length < LABEL_LENGTH) fail('archive.blob', 'content blob shorter than its label');
        const labelBytes = b.subarray(0, LABEL_LENGTH);
        if (!isLabel(labelBytes)) fail('archive.blob', `content blob ${blobs.length} has no blake3 label`);
        const label = decoder.decode(labelBytes);
        const content = b.subarray(LABEL_LENGTH);
        const actual = v4Label(content);
        if (actual !== label) labelMismatches.push({ section: section.index, label, actual });
        blobs.push({ label, content, section: section.index });
      break;
      }
      default:
        fail('archive.kind', `unknown section kind ${section.kind} at section ${section.index}`);
    }
  }
  if (!manifest) fail('archive.manifest', 'no application manifest section');
  } catch (error) {
    // A section that does not parse in a holo whose footer does not match either was altered:
    // name the damage first, and keep what broke as the detail.
    if (footer !== fingerprint && error?.code !== DigestMismatchError.code && !(error instanceof DigestMismatchError)) {
      throw new DigestMismatchError(`integrity failure: the holo was altered: the footer is not the BLAKE3 of the body (${error.code ?? 'parse'}: ${error.message})`, { check: 'holo.integrity', cause: error });
    }
    throw error;
  }

  return {
    bytes,
    body,
    version,
    flags,
    sections,
    manifest,
    metadata,
    extensions,
    blobs,
    footer,
    fingerprint,
    verification: {
      footer: footer === fingerprint,
      labels: labelMismatches.length === 0,
      labelMismatches,
    },
  };
}

const hexOf = (bytes) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

/**
 * Parse a holo v5. The result has the v4 reader's shape (sections, blobs,
 * extensions, manifest labels, verification) so every consumer reads both:
 * each object is a section whose `kind` is its role, the provenance object is
 * the model extension and the attestation object the attestation extension.
 */
function parseArchiveV5(bytes) {
  const { objects, sealed, seal, preimage } = layout(bytes);
  if (objects.length !== ROLES_V5.length && objects.length !== ROLES_V5.length + 1) {
    fail('archive.bounds', `a v5 application holo holds ${ROLES_V5.length} objects, or ${ROLES_V5.length + 1} when signed; this one holds ${objects.length}`);
  }
  const roles = [...ROLES_V5, ROLE_ATTESTATIONS];
  const sections = objects.map((object, index) => ({ index, kind: roles[index], offset: object.offset, length: object.length, body: object.bytes }));
  const text = (slice, what) => {
    try {
      return decoder.decode(slice);
    } catch {
      if (!sealed) throw new DigestMismatchError(`integrity failure: the holo was altered: its seal does not match, and ${what} is not UTF-8`, { check: 'holo.integrity' });
      return fail('archive.manifest', `${what} is not UTF-8`);
    }
  };
  const manifestText = text(objects[0].bytes, 'the manifest');
  let holoManifest;
  try {
    holoManifest = JSON.parse(manifestText);
  } catch (error) {
    if (!sealed) throw new DigestMismatchError('integrity failure: the holo was altered: its seal does not match', { check: 'holo.integrity', cause: error });
    fail('archive.manifest', `the manifest is not JSON: ${error.message}`);
  }
  if (holoManifest?.schema !== MANIFEST_SCHEMA_V5) fail('archive.manifest', `the manifest schema is ${JSON.stringify(holoManifest?.schema)}, expected ${MANIFEST_SCHEMA_V5}`);
  const layer = (kind) => (Array.isArray(holoManifest.layers) ? holoManifest.layers.find((l) => l.kind === kind) : undefined);
  const labels = [holoManifest.requires, layer('wasm')?.kappa, layer('view')?.kappa];
  const blobs = [3, 4, 5, 6].map((index) => ({ label: kappa(objects[index].bytes), content: objects[index].bytes, section: index }));
  const extensions = [
    { name: MODEL_EXTENSION, payload: objects[2].bytes, text: text(objects[2].bytes, 'the provenance object'), section: 2 },
  ];
  if (objects.length > ROLES_V5.length) {
    const payload = objects[ROLES_V5.length].bytes;
    extensions.push({ name: 'https://uor.foundation/extension/attestation-bundle/v1', payload, text: text(payload, 'the attestation object'), section: ROLES_V5.length });
  }
  const listed = Array.isArray(holoManifest.objects) ? holoManifest.objects : [];
  const expected = [1, 3, 4, 5, 6].map((index) => ({ role: ROLES_V5[index], kappa: kappa(objects[index].bytes), length: objects[index].length }));
  const labelMismatches = expected
    .filter((row, i) => listed[i]?.role !== row.role || listed[i]?.kappa !== row.kappa || listed[i]?.length !== row.length)
    .map((row) => ({ section: ROLES_V5.indexOf(row.role), label: listed.find((l) => l.role === row.role)?.kappa ?? null, actual: row.kappa }));
  if (listed.length !== expected.length) labelMismatches.push({ section: null, label: null, actual: null });
  const fingerprint = hexOf(seal);
  return {
    format: 5,
    bytes,
    body: preimage,
    version: 5,
    flags: 0,
    sections,
    manifest: { uri: MANIFEST_SCHEMA_V5, labels, section: 0 },
    holoManifest,
    metadata: { text: text(objects[1].bytes, 'the source manifest'), section: 1 },
    extensions,
    blobs,
    footer: fingerprint,
    fingerprint: sealed ? fingerprint : null,
    kappa: kappa(bytes),
    verification: {
      footer: sealed,
      seal: sealed,
      labels: labelMismatches.length === 0,
      labelMismatches,
    },
  };
}

function blake3HexOf(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

/** JSON with sorted keys and no whitespace, the SDK's canonical encoding (`holo/canonical.rs`). */
/**
 * The identity of a holo: for a holo v5 its κ, the `sha256:` of the file, which is also its OCI layer digest
 * (ADR-017); for a legacy v4 holo the `blake3:` of its body, which its footer claims.
 */
export const holoDigest = (parsed) => (parsed.format === 5 ? parsed.kappa : `blake3:${parsed.fingerprint}`);

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Resolve the parsed archive into the application's parts, cross-checking the
 * directory and model extensions against the manifest and the blobs.
 */
export function resolveArchive(parsed) {
  if (parsed.format === 5) return resolveArchiveV5(parsed);
  const extension = (name) => parsed.extensions.find((e) => e.name === name);
  const directoryExtension = extension(DIRECTORY_EXTENSION);
  const modelExtension = extension(MODEL_EXTENSION);
  if (!directoryExtension) fail('archive.directory', `missing extension ${DIRECTORY_EXTENSION}`);
  if (!modelExtension) fail('archive.provenance', `missing extension ${MODEL_EXTENSION}`);
  const directory = JSON.parse(directoryExtension.text);
  const provenance = JSON.parse(modelExtension.text);
  const byLabel = new Map(parsed.blobs.map((b) => [b.label, b]));
  const blob = (label, what) => {
    const found = byLabel.get(label);
    if (!found) fail('archive.directory', `${what} ${label} is not a content blob of this archive`);
    return found;
  };

  const layers = Array.isArray(directory.layers) ? directory.layers : [];
  const wasmLayer = layers.find((l) => l.kind === 'wasm');
  const viewLayer = layers.find((l) => l.kind === 'view');
  if (!wasmLayer) fail('archive.directory', 'application directory has no wasm layer');
  if (!viewLayer) fail('archive.directory', 'application directory has no view layer');
  if (wasmLayer.entry !== 'holo_run') fail('archive.directory', `wasm layer entry is ${wasmLayer.entry}, expected holo_run`);
  if (typeof provenance.model_content_kappa !== 'string') fail('archive.provenance', 'model extension names no model_content_kappa');

  const guest = blob(wasmLayer.content_kappa, 'wasm layer');
  const view = blob(viewLayer.content_kappa, 'view layer');
  const model = blob(provenance.model_content_kappa, 'model document');
  const capabilities = blob(directory.requires_kappa, 'capability set');

  const consistent =
    provenance.guest_content_kappa === wasmLayer.content_kappa &&
    parsed.manifest.labels.includes(wasmLayer.content_kappa) &&
    parsed.manifest.labels.includes(viewLayer.content_kappa) &&
    parsed.manifest.labels.includes(directory.requires_kappa) &&
    parsed.manifest.uri === APP_MANIFEST_URI;

  let modelDocument;
  try {
    modelDocument = JSON.parse(decoder.decode(model.content));
  } catch (error) {
    fail('archive.model', `model document is not JSON: ${error.message}`);
  }

  return {
    directory,
    provenance,
    modelDocument,
    guest,
    view,
    model,
    capabilities,
    identities: {
      archiveFingerprint: parsed.fingerprint,
      footer: parsed.footer,
      guestKappa: guest.label,
      viewKappa: view.label,
      modelKappa: model.label,
      capabilitiesKappa: capabilities.label,
      applicationKappa: provenance.application_kappa ?? null,
      verified: parsed.verification.footer && parsed.verification.labels && consistent,
      consistent,
    },
  };
}

function resolveArchiveV5(parsed) {
  const manifest = parsed.holoManifest;
  const provenance = JSON.parse(parsed.extensions.find((e) => e.name === MODEL_EXTENSION).text);
  const [capabilities, guest, view, model] = parsed.blobs;
  const wasmLayer = manifest.layers?.find((l) => l.kind === 'wasm');
  const viewLayer = manifest.layers?.find((l) => l.kind === 'view');
  if (!wasmLayer || wasmLayer.entry !== 'holo_run') fail('archive.directory', 'the manifest has no wasm layer entered at holo_run');
  if (!viewLayer) fail('archive.directory', 'the manifest has no view layer');
  const applicationKappa = kappa(parsed.sections[0].body);
  const consistent =
    canonicalJson(manifest) === decoder.decode(parsed.sections[0].body) &&
    manifest.requires === capabilities.label &&
    wasmLayer.kappa === guest.label &&
    viewLayer.kappa === view.label &&
    provenance.schema === PROVENANCE_SCHEMA_V5 &&
    provenance.guest_content_kappa === guest.label &&
    provenance.model_content_kappa === model.label &&
    provenance.view_binding?.view_content_kappa === view.label &&
    provenance.application_kappa === applicationKappa &&
    canonicalJson(provenance) === parsed.extensions.find((e) => e.name === MODEL_EXTENSION).text;
  let modelDocument;
  try {
    modelDocument = JSON.parse(decoder.decode(model.content));
  } catch (error) {
    fail('archive.model', `model document is not JSON: ${error.message}`);
  }
  return {
    directory: { schema_version: 5, primary_layer: 0, requires_kappa: manifest.requires, layers: manifest.layers.map((l) => ({ ...l, content_kappa: l.kappa })) },
    manifest,
    provenance,
    modelDocument,
    guest,
    view,
    model,
    capabilities,
    identities: {
      archiveFingerprint: parsed.fingerprint,
      footer: parsed.footer,
      archiveKappa: parsed.kappa,
      basis: manifest.basis ?? null,
      guestKappa: guest.label,
      viewKappa: view.label,
      modelKappa: model.label,
      capabilitiesKappa: capabilities.label,
      applicationKappa,
      verified: parsed.verification.seal && parsed.verification.labels && consistent,
      consistent,
    },
  };
}
