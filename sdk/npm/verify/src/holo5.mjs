/**
 * The checks of a holo v5 (ADR-017): a raw self-contained UORC archive
 * (`"UORC" 02 01 00 00`, ULEB128 count and lengths, the objects, then the
 * UORC-SHA256-CHAIN-v1 seal of every byte before it) whose ordered objects are
 * the manifest, the source manifest, the provenance, the capability set, the
 * guest, the view, the model and, when signed, the attestations.
 *
 * It records the checks of the v4 reader under the same ids, in the same
 * shape, so a verdict on a v5 holo and on a v4 holo of the same application
 * reach the same level for the same reasons. The Rust twin is
 * crates/prismpm/src/inspect/verdict_v5.rs. Every identity is a κ-label,
 * `sha256:` and the hex SHA-256 of the bytes it names.
 */
import { sha256Hex } from './sha256.mjs';

export const MANIFEST_SCHEMA = 'prism/holo/5';
export const PROVENANCE_SCHEMA = 'prismpm/model-provenance/2';
export const ROLES = Object.freeze(['manifest', 'source-manifest', 'provenance', 'capabilities', 'guest', 'view', 'model']);
export const ROLE_ATTESTATIONS = 'attestations';
const CONTENT = Object.freeze({ capabilities: 3, guest: 4, view: 5, model: 6 });
const BUDGET = Object.freeze({ objects: 16, bytes: 2 ** 30 });
const SEAL_LENGTH = 32;
const KAPPA = /^sha256:[0-9a-f]{64}$/;
const TAG = Uint8Array.from('UORC-SHA256-CHAIN-v1\0', (c) => c.charCodeAt(0));
const utf8 = new TextDecoder('utf-8', { fatal: true });

/** Whether `bytes` start like a UORC archive. */
export const isUorc = (bytes) => bytes.length >= 4 && bytes[0] === 0x55 && bytes[1] === 0x4f && bytes[2] === 0x52 && bytes[3] === 0x43;

export const kappa = (bytes) => `sha256:${sha256Hex(bytes)}`;

const fromHex = (hex) => Uint8Array.from(hex.match(/../g), (pair) => parseInt(pair, 16));
function concat(parts) {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}
const sha = (parts) => fromHex(sha256Hex(concat(parts)));

/** UORC-SHA256-CHAIN-v1 of `preimage`, as hex. */
export function chainHex(preimage) {
  let c = sha([TAG, Uint8Array.of(0)]);
  const whole = preimage.length - (preimage.length % 64);
  for (let at = 0; at < whole; at += 64) c = sha([TAG, Uint8Array.of(1), c, preimage.subarray(at, at + 64)]);
  const tail = preimage.subarray(whole);
  return sha256Hex(concat([TAG, Uint8Array.of(2), c, Uint8Array.of(tail.length), tail]));
}

function readUleb(bytes, at) {
  let value = 0;
  let scale = 1;
  for (const start = at; ; ) {
    if (at >= bytes.length || at - start > 7) return null;
    const byte = bytes[at++];
    value += (byte & 0x7f) * scale;
    scale *= 0x80;
    if (byte < 0x80) return (byte === 0 && at - start > 1) || !Number.isSafeInteger(value) ? null : [value, at];
  }
}

/**
 * The framing of a raw self-contained UORC archive: `{ objects, seal, sealed }`
 * with each object `{ index, offset, length, bytes }`, or `{ problem, check }`
 * when its header cannot be read. The seal is reported, not enforced.
 */
export function readArchive(bytes) {
  const refuse = (problem, check = 'archive.table') => ({ problem, check });
  if (bytes.length < 6 || bytes[4] !== 2 || bytes[5] !== 1) return refuse('a holo v5 file is a UORC archive (format 2, profile 1)', 'archive.version');
  if (bytes.length < 8 + SEAL_LENGTH) return refuse('the UORC archive is truncated');
  const preimage = bytes.subarray(0, bytes.length - SEAL_LENGTH);
  const seal = Array.from(bytes.subarray(bytes.length - SEAL_LENGTH), (b) => b.toString(16).padStart(2, '0')).join('');
  if (preimage[6] !== 0 || preimage[7] !== 0) return refuse('a holo is a self-contained archive whose objects are stored raw', 'archive.flags');
  let read = readUleb(preimage, 8);
  if (!read) return refuse('the object count is not a ULEB128');
  const [count] = read;
  if (count === 0 || count > BUDGET.objects) return refuse(`the archive declares ${count} objects; a holo holds 1 to ${BUDGET.objects}`);
  let at = read[1];
  const lengths = [];
  let total = 0;
  for (let i = 0; i < count; i++) {
    read = readUleb(preimage, at);
    if (!read) return refuse('an object length is not a ULEB128');
    total += read[0];
    if (total > BUDGET.bytes) return refuse('the archive exceeds the decode budget');
    lengths.push(read[0]);
    at = read[1];
  }
  read = readUleb(preimage, at);
  if (!read) return refuse('the body length is not a ULEB128');
  if (read[0] !== total || preimage.length - read[1] !== total) return refuse('the body length disagrees with the objects, or the archive has trailing bytes');
  let offset = read[1];
  const objects = lengths.map((length, index) => {
    const object = { index, offset, length, bytes: preimage.subarray(offset, offset + length) };
    offset += length;
    return object;
  });
  return { objects, seal, sealed: chainHex(preimage) === seal };
}

/** JSON as the canonical form of a holo document: keys sorted, no whitespace. */
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function decode(bytes) {
  try {
    const value = JSON.parse(utf8.decode(bytes));
    return value && typeof value === 'object' && !Array.isArray(value) ? { value } : { error: 'is not a JSON object' };
  } catch (error) {
    return { error: `is not JSON: ${error.message}` };
  }
}

/**
 * The checks and facts of a holo v5, in the shape `analyze` returns for v4.
 *
 * @param {Uint8Array} bytes
 * @param {{ spec: object, schemaErrors: Function, checkWorld: Function, order: string[], structureIds: string[], documentIds: string[], archiveIds: string[] }} context
 */
export function analyzeV5(bytes, context) {
  const { spec, schemaErrors, checkWorld } = context;
  /** The two layers of a holo whose guest and view are named by these κ. */
  const layersOf = (guest, view) => [
    { contract: spec.CORE_WASM.CONTRACT, entry: spec.CORE_WASM.ENTRY, kappa: guest, kind: 'wasm' },
    { entry: spec.HOLOVIEW.ENTRY, kappa: view, kind: 'view', surface: 'portable' },
  ];
  const checks = [{ id: 'archive.magic', level: 'archive', status: 'pass', detail: 'magic UORC' }];
  const facts = { v5: true, structure: { ok: false }, sections: [], documents: {}, roles: {}, revision: null, layoutRevision: null, footer: null, fingerprint: null, newestDifferences: [] };
  const add = (level, id, ok, detail) => checks.push({ id, level, status: ok ? 'pass' : 'fail', detail });
  const skip = (level, id, detail) => checks.push({ id, level, status: 'skip', detail });

  const archive = readArchive(bytes);
  if (archive.problem) {
    for (const id of context.structureIds.slice(1)) {
      if (id === archive.check) add('archive', id, false, archive.problem);
      else if (!checks.some((c) => c.id === archive.check)) add('archive', id, true, 'UORC format 2, profile 1');
    }
    for (const id of context.archiveIds) if (!checks.some((c) => c.id === id)) skip('archive', id, `not checked: ${archive.check} failed`);
    for (const id of context.documentIds) skip('documents', id, `not checked: ${archive.check} failed`);
    return { checks, facts };
  }
  add('archive', 'archive.version', true, 'UORC format 2, profile 1');
  add('archive', 'archive.flags', true, 'a self-contained archive, objects stored raw');
  add('archive', 'archive.table', true, `${archive.objects.length} objects, contiguous, ending at the seal`);
  facts.structure.ok = true;
  facts.footer = { stored: archive.seal, computed: archive.sealed ? archive.seal : null, matches: archive.sealed };
  facts.fingerprint = kappa(bytes);
  add(
    'archive',
    'archive.footer',
    archive.sealed,
    archive.sealed ? `the seal is the UORC-SHA256-CHAIN-v1 of the archive, ${archive.seal}` : `the seal ${archive.seal} is not the UORC-SHA256-CHAIN-v1 of the archive: the archive was altered`,
  );

  const known = archive.objects.length === ROLES.length || archive.objects.length === ROLES.length + 1;
  const contentRoles = new Map(Object.entries(CONTENT).map(([role, index]) => [index, role]));
  facts.sections = archive.objects.map((object) => {
    const role = ROLES[object.index] ?? ROLE_ATTESTATIONS;
    const section = { index: object.index, kind: null, kindName: role, role, offset: object.offset, length: object.length, payload: object.bytes };
    if (contentRoles.has(object.index)) {
      section.label = kappa(object.bytes);
      section.content = object.bytes;
      section.digests = { sha256: section.label.slice('sha256:'.length) };
      section.labelMatches = true;
    }
    return section;
  });
  const at = (index) => (known ? facts.sections[index] : undefined);
  const labelOf = (index) => at(index)?.label ?? (at(index) ? kappa(at(index).payload) : undefined);

  // manifest.wire and blob.labels: the manifest names every object by its κ.
  {
    const problems = [];
    const decoded = at(0) ? decode(at(0).payload) : { error: 'is missing: the archive does not hold the objects of a holo' };
    const manifest = decoded.value;
    if (decoded.error) problems.push(`the holo manifest ${decoded.error}`);
    else {
      if (manifest.schema !== MANIFEST_SCHEMA) problems.push(`the manifest names schema ${JSON.stringify(manifest.schema)}`);
      if (typeof manifest.name !== 'string' || manifest.name.length === 0) problems.push('the manifest names no application');
      if (manifest.basis !== undefined && !KAPPA.test(manifest.basis)) problems.push('the manifest basis is not a κ-label');
      if (!KAPPA.test(manifest.requires)) problems.push('the manifest requires no κ-label');
      // The shape of the layers here; whether their κ name the objects is blob.labels.
      const named = (i) => (Array.isArray(manifest.layers) ? manifest.layers[i]?.kappa : undefined);
      if (canonical(manifest.layers) !== canonical(layersOf(named(0), named(1))) || ![named(0), named(1)].every((k) => KAPPA.test(k))) problems.push('the manifest layers are not the wasm and view layers of a holo');
      if (canonical(manifest) !== utf8.decode(at(0).payload)) problems.push('the manifest is not canonical JSON');
    }
    if (problems.length === 0) facts.documents.manifest = manifest;
    add('documents', 'manifest.wire', problems.length === 0, problems.length === 0 ? `the holo manifest is canonical ${MANIFEST_SCHEMA}` : problems.join('; '));
    if (manifest && problems.length === 0) {
      // The provenance names the manifest, so the manifest lists every object but the provenance.
      const expected = [1, 3, 4, 5, 6].map((i) => ({ kappa: labelOf(i), length: at(i).length, role: ROLES[i] }));
      const ok = canonical(manifest.objects) === canonical(expected) && manifest.requires === labelOf(3) && canonical(manifest.layers) === canonical(layersOf(labelOf(4), labelOf(5)));
      add('archive', 'blob.labels', ok, ok ? `all ${expected.length} objects match the κ the manifest gives them` : "the manifest's κ-labels and lengths are not those of the objects in their roles");
    } else skip('archive', 'blob.labels', 'not checked: manifest.wire failed');
  }

  const documentCheck = (id, what, object, schemaPath, key, check) => {
    if (!object) return add('documents', id, false, `${what} is missing`);
    const decoded = decode(object.payload ?? object.content);
    if (decoded.error) return add('documents', id, false, `${what} ${decoded.error}`);
    const path = typeof schemaPath === 'function' ? schemaPath(decoded.value) : schemaPath;
    if (!path) return add('documents', id, false, `${what} names schema ${JSON.stringify(decoded.value?.schema)}, which no known format revision packs into a holo`);
    const errors = schemaErrors(path, decoded.value) || (check ? check(decoded.value) : '');
    if (errors) return add('documents', id, false, `${what} does not match ${path}: ${errors}`);
    facts.documents[key] = decoded.value;
    return add('documents', id, true, `${what} matches ${path}`);
  };
  const revisions = Object.values(spec.FORMAT_REVISIONS);
  const modelSchemas = new Set(revisions.flatMap((r) => r.modelDocumentSchemas));

  documentCheck('metadata.schema', 'the source manifest', at(1), spec.HOLO_SCHEMAS.SOURCE_MANIFEST, 'sourceManifest');
  skip('documents', 'directory.schema', 'not checked: a holo v5 names its layers in the manifest');
  documentCheck(
    'provenance.schema',
    'the model provenance',
    at(2),
    (v) => (v?.schema === PROVENANCE_SCHEMA ? spec.SCHEMAS[PROVENANCE_SCHEMA] : null),
    'provenance',
    (v) => (canonical(v) === utf8.decode(at(2).payload) ? '' : 'it is not canonical JSON'),
  );
  const provenance = facts.documents.provenance;
  const modelBlob = at(CONTENT.model);
  if (!provenance) skip('documents', 'model.schema', 'not checked: provenance.schema failed');
  else documentCheck('model.schema', 'the model document', modelBlob, (v) => (modelSchemas.has(v?.schema) ? spec.SCHEMAS[v.schema] : null), 'modelDocument');

  if (known) for (const [role, index] of Object.entries(CONTENT)) facts.roles[role] = labelOf(index);

  // references: the provenance names the objects in their roles.
  if (!provenance || !known) skip('documents', 'references', 'not checked: the provenance did not decode');
  else {
    const problems = [];
    for (const [role, recorded, actual] of [
      ['guest', provenance.guest_content_kappa, labelOf(4)],
      ['model', provenance.model_content_kappa, labelOf(6)],
      ['application', provenance.application_kappa, labelOf(0)],
    ]) {
      if (recorded !== actual) problems.push(`the provenance ${role} ${recorded} is not the ${role} object ${actual}`);
    }
    const binding = provenance.view_binding;
    if (binding?.tag === 'present' && binding.view_content_kappa !== labelOf(5)) problems.push(`the provenance view ${binding.view_content_kappa} is not the view object ${labelOf(5)}`);
    add('documents', 'references', problems.length === 0, problems.length === 0 ? 'the manifest and the provenance name the same objects' : problems.join('; '));
  }

  // model.sha256: as in v4.
  if (!provenance || !modelBlob) skip('documents', 'model.sha256', 'not checked: no model document');
  else {
    const actual = modelBlob.digests.sha256;
    const problems = [];
    if (provenance.model_id !== actual) problems.push(`the provenance model_id ${provenance.model_id} differs from the model document's sha256 ${actual}`);
    const listed = facts.documents.sourceManifest?.files?.find((f) => f.kind === 'model-document');
    if (listed && listed.sha256 !== actual) problems.push(`the source manifest lists model-document sha256 ${listed.sha256}, the blob hashes to ${actual}`);
    add('documents', 'model.sha256', problems.length === 0, problems.length === 0 ? `the model document's sha256 ${actual} equals the recorded model_id` : problems.join('; '));
  }

  // world.contract: as in v4, with the contract the provenance records.
  const contract = provenance?.core_wasm_contract;
  const guest = at(CONTENT.guest);
  if (!contract || !guest) skip('documents', 'world.contract', 'not checked: the provenance or the guest is missing');
  else {
    const world = checkWorld(contract, guest.content);
    if (!world.known) skip('documents', 'world.contract', `not checked: this package has no world for the contract ${contract}`);
    else add('documents', 'world.contract', world.conforms, world.conforms ? `the guest has exactly the imports and exports of the ${contract} world` : `the guest does not match the ${contract} world: ${world.problems.join('; ')}`);
  }

  // format.revision: the roles, the contract, the source manifest and the view.
  {
    const revision = spec.FORMAT_REVISIONS[spec.FORMAT_REVISION];
    const differences = [];
    if (!known) differences.push(`the archive holds ${archive.objects.length} objects, expected ${ROLES.length} or ${ROLES.length + 1} when signed`);
    // As for v4: this package judges the unsigned holo, and `check` reads the attestations and strips them first.
    if (archive.objects.length === ROLES.length + 1) differences.push(`the archive carries an ${ROLE_ATTESTATIONS} object, which this package does not read; check reads it`);
    if (contract && contract !== revision.coreWasmContract) differences.push(`the guest contract is ${contract}, expected ${revision.coreWasmContract}`);
    const sourceManifest = facts.documents.sourceManifest;
    if (sourceManifest && sourceManifest.version !== revision.sourceManifestVersion) differences.push(`the source manifest version is ${sourceManifest.version}, expected ${revision.sourceManifestVersion}`);
    const view = at(CONTENT.view)?.content;
    if (view) {
      const magic = view.length >= 10 ? String.fromCharCode(...view.subarray(0, 8)) : '';
      const version = view.length >= 10 ? (view[8] << 8) | view[9] : null;
      if (magic !== spec.HOLOVIEW.MAGIC || version !== revision.holoviewVersion) differences.push(`the view is not a HOLOVIEW version ${revision.holoviewVersion} bundle`);
    }
    // A signed holo has no layout revision, so verdict refuses it as for v4; check strips the attestations first.
    if (known && archive.objects.length === ROLES.length) facts.layoutRevision = spec.FORMAT_REVISION;
    if (differences.length === 0) facts.revision = spec.FORMAT_REVISION;
    facts.newestDifferences = differences;
    add('documents', 'format.revision', differences.length === 0, differences.length === 0 ? `holo v5, format revision ${spec.FORMAT_REVISION}` : `the archive matches no format revision this package knows (holo v5): ${differences.join('; ')}`);
  }

  checks.sort((a, b) => context.order.indexOf(a.id) - context.order.indexOf(b.id));
  return { checks, facts };
}
