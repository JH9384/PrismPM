/**
 * @prism-code/verify: check a `.holo` offline, without the runtime.
 *
 * `inspect(bytes)` describes an archive: its sections, the digests of every
 * part in both algorithms (ADR-015), its format revision and its documents.
 * `verify(bytes, policy)` judges it and returns a Verdict with an assurance
 * level. Nothing here fetches, compiles or runs code; the package works in a
 * browser, a worker or Node with no dependencies.
 */
import * as spec from './vendor/spec.mjs';
import { blake3Hex } from './vendor/blake3.mjs';
import { validate } from './vendor/json-schema.mjs';
import { SCHEMA_FILES } from './vendor/schemas.mjs';
import { sha256Hex } from './sha256.mjs';
import { readStructure } from './reader.mjs';
import * as assurance from './vendor/assurance-levels.mjs';
import * as transparency from './transparency.mjs';
import { checkWorld, checkWorldPolicy, capabilitySetProblem, compareWorldPin, describeWorld } from './world.mjs';

/** The newest holo format revision this package reads, from @prism-code/spec. */
export const FORMAT_REVISION = spec.FORMAT_REVISION;

/**
 * Assurance levels P0 to P3, their order and the default policy, as
 * `@prism-code/spec` states them (issue #269, docs/proposals/269-assurance-levels.md).
 */
export const ASSURANCE = assurance.ASSURANCE;

/**
 * Thrown when no verdict can be reached: the input is not bytes, the policy is
 * invalid, the file is not a readable holo, or it is a holo of a format
 * revision this package does not know. A holo that fails a check is a
 * Verdict, not an error.
 */
export class VerifyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'VerifyError';
    this.code = code;
  }
}

const KIND_NAMES = Object.freeze({
  [spec.SECTION_KIND.APP_MANIFEST]: 'app-manifest',
  [spec.SECTION_KIND.METADATA]: 'metadata',
  [spec.SECTION_KIND.EXTENSION]: 'extension',
  [spec.SECTION_KIND.CONTENT_BLOB]: 'content-blob',
});
const DIGEST_TARGETS = ['archive', 'capabilities', 'guest', 'view', 'model'];
/** Internal checks, in evaluation order. The structural ones decide whether the file is a readable holo at all. */
const STRUCTURE_IDS = ['archive.magic', 'archive.version', 'archive.flags', 'archive.table'];
const ARCHIVE_IDS = [...STRUCTURE_IDS, 'archive.footer', 'blob.labels'];
const DOCUMENT_IDS = ['format.revision', 'manifest.wire', 'metadata.schema', 'directory.schema', 'provenance.schema', 'model.schema', 'references', 'model.sha256', 'world.contract'];
/**
 * The verdict check id each internal check reports under. `holo.integrity`
 * covers every fingerprint that must recompute or agree; `holo.documents`
 * covers the documents inside. `world.contract` is the guest not having the
 * interface its WIT world declares (issue #278). All withhold P1, as the
 * integrity half of P1 in docs/proposals/269-assurance-levels.md.
 */
const REPORTED_AS = Object.freeze({
  'archive.footer': 'holo.integrity',
  'blob.labels': 'holo.integrity',
  references: 'holo.integrity',
  'model.sha256': 'holo.integrity',
  'format.revision': 'holo.documents',
  'manifest.wire': 'holo.documents',
  'metadata.schema': 'holo.documents',
  'directory.schema': 'holo.documents',
  'provenance.schema': 'holo.documents',
  'model.schema': 'holo.documents',
  'world.contract': 'world.contract',
});
const HEX64 = /^[0-9a-f]{64}$/;
const utf8 = new TextDecoder('utf-8', { fatal: true });

function asBytes(source) {
  if (ArrayBuffer.isView(source)) return new Uint8Array(source.buffer, source.byteOffset, source.byteLength);
  const tag = Object.prototype.toString.call(source);
  if (tag === '[object ArrayBuffer]' || tag === '[object SharedArrayBuffer]') return new Uint8Array(source);
  throw new VerifyError('input', 'expected the holo as bytes: a Uint8Array, another typed array or DataView, or an ArrayBuffer');
}

function hex(bytes) {
  let s = '';
  for (const b of bytes) s += b.toString(16).padStart(2, '0');
  return s;
}

function digestsOf(bytes) {
  return { sha256: sha256Hex(bytes), blake3: blake3Hex(bytes) };
}

function isLabel(bytes) {
  if (bytes.length !== spec.LABEL_LENGTH) return false;
  for (let i = 0; i < spec.LABEL_PREFIX.length; i++) if (bytes[i] !== spec.LABEL_PREFIX.charCodeAt(i)) return false;
  for (let i = spec.LABEL_PREFIX.length; i < spec.LABEL_LENGTH; i++) {
    const c = bytes[i];
    if (!((c >= 48 && c <= 57) || (c >= 97 && c <= 102))) return false;
  }
  return true;
}

function decodeJson(bytes) {
  try {
    return { value: JSON.parse(utf8.decode(bytes)) };
  } catch (error) {
    return { error: error.message };
  }
}

/** Schema errors as one line, or the empty string when the value is valid. */
function schemaErrors(path, value) {
  const errors = validate(SCHEMA_FILES[path], value);
  const shown = errors.slice(0, 3).map((e) => `${e.path} ${e.message}`);
  if (errors.length > 3) shown.push(`and ${errors.length - 3} more`);
  return shown.join('; ');
}

/** Decode one section body. Problems are recorded, never thrown. */
function decodeSection(bytes, row) {
  const body = bytes.subarray(row.offset, row.offset + row.length);
  const section = { ...row, kindName: KIND_NAMES[row.kind] ?? 'unknown' };
  switch (row.kind) {
    case spec.SECTION_KIND.CONTENT_BLOB: {
      if (body.length < spec.LABEL_LENGTH || !isLabel(body.subarray(0, spec.LABEL_LENGTH))) {
        section.problem = 'the blob does not start with a blake3 label';
        break;
      }
      section.label = utf8.decode(body.subarray(0, spec.LABEL_LENGTH));
      section.content = body.subarray(spec.LABEL_LENGTH);
      section.digests = digestsOf(section.content);
      section.labelMatches = section.label === `${spec.LABEL_PREFIX}${section.digests.blake3}`;
      break;
    }
    case spec.SECTION_KIND.EXTENSION: {
      const nameLength = body.length >= 2 ? body[0] | (body[1] << 8) : -1;
      if (nameLength < 0 || 2 + nameLength > body.length) {
        section.problem = 'the extension name overruns the section';
        break;
      }
      try {
        section.name = utf8.decode(body.subarray(2, 2 + nameLength));
      } catch {
        section.problem = 'the extension name is not UTF-8';
        break;
      }
      section.payload = body.subarray(2 + nameLength);
      break;
    }
    default:
      section.payload = body;
  }
  return section;
}

/** Every check, and the facts both entry points report, computed once. */
function analyze(bytes) {
  const structure = readStructure(bytes);
  const checks = structure.checks.map((c) => ({ ...c, level: 'archive' }));
  const facts = { structure, sections: [], documents: {}, roles: {}, revision: null, layoutRevision: null, footer: null, fingerprint: null };
  const add = (level, id, ok, detail) => checks.push({ id, level, status: ok ? 'pass' : 'fail', detail });
  const skip = (level, id, detail) => checks.push({ id, level, status: 'skip', detail });

  if (!structure.ok) {
    const failed = checks[checks.length - 1].id;
    for (const id of ARCHIVE_IDS) if (!checks.some((c) => c.id === id)) skip('archive', id, `not checked: ${failed} failed`);
    for (const id of DOCUMENT_IDS) skip('documents', id, `not checked: ${failed} failed`);
    return { checks, facts };
  }

  // P0: the footer and the labels.
  const stored = hex(bytes.subarray(structure.bodyEnd));
  const computed = blake3Hex(bytes.subarray(0, structure.bodyEnd));
  facts.footer = { stored, computed, matches: stored === computed };
  facts.fingerprint = `${spec.LABEL_PREFIX}${computed}`;
  add(
    'archive',
    'archive.footer',
    facts.footer.matches,
    facts.footer.matches
      ? `the footer equals the BLAKE3 of the body, ${computed}`
      : `the footer ${stored} does not equal the BLAKE3 of the body, ${computed}: the archive was altered`,
  );

  facts.sections = structure.sections.map((row) => decodeSection(bytes, row));
  const blobs = facts.sections.filter((s) => s.kind === spec.SECTION_KIND.CONTENT_BLOB);
  const badBlobs = blobs.filter((s) => s.problem || !s.labelMatches);
  add(
    'archive',
    'blob.labels',
    badBlobs.length === 0,
    badBlobs.length === 0
      ? `all ${blobs.length} content blobs match their BLAKE3 labels`
      : badBlobs
          .map((s) =>
            s.problem ? `section ${s.index}: ${s.problem}` : `section ${s.index} is labelled ${s.label} but its content hashes to blake3:${s.digests.blake3}`,
          )
          .join('; '),
  );

  // P1: the documents.
  const byKind = (kind) => facts.sections.filter((s) => s.kind === kind);
  const extension = (name) => facts.sections.find((s) => s.kind === spec.SECTION_KIND.EXTENSION && s.name === name);
  const blobByLabel = new Map(blobs.filter((s) => s.label).map((s) => [s.label, s]));

  // manifest.wire: Foundation.Holo.V1.Wire.validAppManifest.
  {
    const manifests = byKind(spec.SECTION_KIND.APP_MANIFEST);
    const m = manifests[0];
    const M = spec.APP_MANIFEST;
    let problem = null;
    if (manifests.length !== 1) problem = `expected one application manifest, found ${manifests.length}`;
    else if (m.payload.length !== M.LENGTH) problem = `the application manifest is ${m.payload.length} bytes, expected ${M.LENGTH}`;
    else if (hex(m.payload.subarray(0, M.PREFIX_LENGTH)) !== M.PREFIX_HEX) problem = 'the application manifest prefix is not the Wire constant';
    else if (hex(m.payload.subarray(M.LENGTH - M.SUFFIX_LENGTH)) !== M.SUFFIX_HEX) problem = 'the application manifest layer suffix is not the Wire constant';
    else {
      const labels = [];
      for (let i = 0; i < 3 && !problem; i++) {
        const at = M.PREFIX_LENGTH + i * spec.LABEL_LENGTH;
        const label = m.payload.subarray(at, at + spec.LABEL_LENGTH);
        if (isLabel(label)) labels.push(utf8.decode(label));
        else problem = `application manifest label ${i} (${M.LABELS[i]}) is not a blake3 label`;
      }
      if (!problem) {
        const errors = schemaErrors(spec.HOLO_SCHEMAS.APP_MANIFEST, { uri: M.URI, labels, suffix: M.SUFFIX_HEX });
        if (errors) problem = `the application manifest does not match its schema: ${errors}`;
        else facts.documents.manifest = { uri: M.URI, labels: { capabilitySet: labels[0], guest: labels[1], view: labels[2] } };
      }
    }
    add('documents', 'manifest.wire', !problem, problem ?? `the application manifest is the ${M.LENGTH}-byte Wire form with three blake3 labels`);
  }

  // A JSON document checked against its schema.
  const documentCheck = (id, what, section, schemaPath, key, summary) => {
    if (!section) return add('documents', id, false, `${what} is missing`);
    if (section.problem) return add('documents', id, false, `${what}: ${section.problem}`);
    const decoded = decodeJson(section.payload);
    if (decoded.error) return add('documents', id, false, `${what} is not JSON: ${decoded.error}`);
    const path = typeof schemaPath === 'function' ? schemaPath(decoded.value) : schemaPath;
    if (!path) {
      return add('documents', id, false, `${what} names schema ${JSON.stringify(decoded.value?.schema)}, which no known format revision packs into a holo`);
    }
    const errors = schemaErrors(path, decoded.value);
    if (errors) return add('documents', id, false, `${what} does not match ${path}: ${errors}`);
    facts.documents[key] = decoded.value;
    return add('documents', id, true, `${what} matches ${path}${summary ? `, ${summary(decoded.value)}` : ''}`);
  };

  const revisions = Object.values(spec.FORMAT_REVISIONS);
  const provenanceSchemas = new Set(revisions.map((r) => r.provenanceSchema));
  const modelSchemas = new Set(revisions.flatMap((r) => r.modelDocumentSchemas));

  const metadata = byKind(spec.SECTION_KIND.METADATA);
  documentCheck(
    'metadata.schema',
    'the source manifest',
    metadata.length > 1 ? { problem: `the archive has ${metadata.length} metadata sections, expected one` } : metadata[0],
    spec.HOLO_SCHEMAS.SOURCE_MANIFEST,
    'sourceManifest',
    (v) => `version ${v.version}`,
  );
  documentCheck(
    'directory.schema',
    'the application directory extension',
    extension(spec.EXTENSION.APPLICATION_DIRECTORY),
    spec.HOLO_SCHEMAS.APPLICATION_DIRECTORY,
    'directory',
    (v) => `${v.layers.length} layers`,
  );
  documentCheck(
    'provenance.schema',
    'the model provenance extension',
    extension(spec.EXTENSION.PRISMPM_MODEL),
    (v) => (provenanceSchemas.has(v?.schema) ? spec.SCHEMAS[v.schema] : null),
    'provenance',
  );

  // The model document is the content blob the provenance names.
  const provenance = facts.documents.provenance;
  const modelBlob = provenance ? blobByLabel.get(provenance.model_content_kappa) : undefined;
  if (!provenance) skip('documents', 'model.schema', 'not checked: provenance.schema failed');
  else if (!modelBlob) {
    add('documents', 'model.schema', false, `the provenance names model document ${provenance.model_content_kappa}, which is not a content blob of this archive`);
  } else {
    documentCheck(
      'model.schema',
      'the model document',
      { payload: modelBlob.content },
      (v) => (modelSchemas.has(v?.schema) ? spec.SCHEMAS[v.schema] : null),
      'modelDocument',
    );
  }

  // references: the manifest, directory and provenance name the same blobs.
  const directory = facts.documents.directory;
  const manifest = facts.documents.manifest;
  if (!directory || !provenance || !manifest) {
    skip('documents', 'references', 'not checked: the manifest, directory or provenance did not decode');
  } else {
    const problems = [];
    const wasm = directory.layers.find((l) => l.kind === 'wasm');
    const viewLayer = directory.layers.find((l) => l.kind === 'view');
    if (!wasm) problems.push('the directory has no wasm layer');
    if (!viewLayer) problems.push('the directory has no view layer');
    if (wasm && viewLayer) {
      const expected = [directory.requires_kappa, wasm.content_kappa, viewLayer.content_kappa];
      const actual = [manifest.labels.capabilitySet, manifest.labels.guest, manifest.labels.view];
      spec.APP_MANIFEST.LABELS.forEach((role, i) => {
        if (actual[i] !== expected[i]) problems.push(`the manifest ${role} label ${actual[i]} differs from the directory's ${expected[i]}`);
      });
      if (provenance.guest_content_kappa !== wasm.content_kappa) {
        problems.push(`the provenance guest ${provenance.guest_content_kappa} differs from the wasm layer ${wasm.content_kappa}`);
      }
      const binding = provenance.view_binding;
      if (binding?.tag === 'present' && binding.view_content_kappa !== viewLayer.content_kappa) {
        problems.push(`the provenance view ${binding.view_content_kappa} differs from the view layer ${viewLayer.content_kappa}`);
      }
      facts.roles = {
        capabilities: directory.requires_kappa,
        guest: wasm.content_kappa,
        view: viewLayer.content_kappa,
        model: provenance.model_content_kappa,
      };
    }
    const listed = new Set();
    for (const entry of directory.blobs) {
      listed.add(entry.kappa);
      const blob = blobByLabel.get(entry.kappa);
      if (!blob) problems.push(`the directory lists ${entry.kappa}, which is not a content blob of this archive`);
      else if (blob.content.length !== entry.byte_length) problems.push(`${entry.kappa} is ${blob.content.length} bytes; the directory says ${entry.byte_length}`);
    }
    for (const blob of blobs) if (blob.label && !listed.has(blob.label)) problems.push(`content blob ${blob.label} is not listed in the directory`);
    for (const [role, label] of Object.entries(facts.roles)) if (!blobByLabel.has(label)) problems.push(`the ${role} ${label} is not a content blob of this archive`);
    add(
      'documents',
      'references',
      problems.length === 0,
      problems.length === 0 ? 'the manifest, directory and provenance name the same blobs, and the directory lists every blob' : problems.join('; '),
    );
  }

  // model.sha256: the provenance records the model document's sha256 as model_id.
  if (!provenance || !modelBlob) skip('documents', 'model.sha256', 'not checked: no model document');
  else {
    const actual = modelBlob.digests.sha256;
    const problems = [];
    if (provenance.model_id !== actual) problems.push(`the provenance model_id ${provenance.model_id} differs from the model document's sha256 ${actual}`);
    const listedFile = facts.documents.sourceManifest?.files?.find((f) => f.kind === 'model-document');
    if (listedFile && listedFile.sha256 !== actual) problems.push(`the source manifest lists model-document sha256 ${listedFile.sha256}, the blob hashes to ${actual}`);
    add('documents', 'model.sha256', problems.length === 0, problems.length === 0 ? `the model document's sha256 ${actual} equals the recorded model_id` : problems.join('; '));
  }

  // world.contract: the guest module has the imports and exports its contract's WIT world declares.
  {
    const wasm = directory?.layers?.find((l) => l.kind === 'wasm');
    const guestBlob = facts.roles.guest ? blobByLabel.get(facts.roles.guest) : undefined;
    if (!wasm || !guestBlob) skip('documents', 'world.contract', 'not checked: the directory or the guest blob is missing');
    else if (guestBlob.problem || !guestBlob.labelMatches) skip('documents', 'world.contract', 'not checked: the guest blob fails its label, which blob.labels reports');
    else {
      const world = checkWorld(wasm.contract, guestBlob.content);
      if (!world.known) skip('documents', 'world.contract', `not checked: this package has no world for the contract ${wasm.contract}`);
      else {
        add(
          'documents',
          'world.contract',
          world.conforms,
          world.conforms ? `the guest has exactly the imports and exports of the ${wasm.contract} world` : `the guest does not match the ${wasm.contract} world: ${world.problems.join('; ')}`,
        );
      }
    }
  }

  // format.revision: an archive carries no date; its identifiers name the revision.
  {
    const differencesFrom = (revision) => {
      const differences = [];
      const order = facts.sections.map((s) => s.kind);
      if (order.join(',') !== revision.sectionOrder.join(',')) differences.push(`the section kinds are [${order}], expected [${revision.sectionOrder}]`);
      const names = facts.sections.filter((s) => s.kind === spec.SECTION_KIND.EXTENSION).map((s) => s.name);
      if (names.join(' ') !== revision.extensions.join(' ')) differences.push(`the extensions are ${JSON.stringify(names)}, expected ${JSON.stringify(revision.extensions)}`);
      const wasm = directory?.layers?.find((l) => l.kind === 'wasm');
      if (wasm && wasm.contract !== revision.coreWasmContract) differences.push(`the guest contract is ${wasm.contract}, expected ${revision.coreWasmContract}`);
      if (provenance && provenance.core_wasm_contract !== revision.coreWasmContract) differences.push(`the provenance contract is ${provenance.core_wasm_contract}`);
      if (provenance && provenance.schema !== revision.provenanceSchema) differences.push(`the provenance schema is ${provenance.schema}, expected ${revision.provenanceSchema}`);
      const sourceManifest = facts.documents.sourceManifest;
      if (sourceManifest && sourceManifest.version !== revision.sourceManifestVersion) {
        differences.push(`the source manifest version is ${sourceManifest.version}, expected ${revision.sourceManifestVersion}`);
      }
      const modelDocument = facts.documents.modelDocument;
      if (modelDocument && !revision.modelDocumentSchemas.includes(modelDocument.schema)) differences.push(`the model document schema ${modelDocument.schema} is not packed by this revision`);
      const viewBlob = facts.roles.view ? blobByLabel.get(facts.roles.view) : undefined;
      if (viewBlob) {
        const c = viewBlob.content;
        const magic = c.length >= 10 ? String.fromCharCode(...c.subarray(0, 8)) : '';
        const version = c.length >= 10 ? (c[8] << 8) | c[9] : null;
        if (magic !== spec.HOLOVIEW.MAGIC || version !== revision.holoviewVersion) differences.push(`the view is not a HOLOVIEW version ${revision.holoviewVersion} bundle`);
      }
      return differences;
    };
    let newest = [];
    for (const [date, revision] of Object.entries(spec.FORMAT_REVISIONS)) {
      const differences = differencesFrom(revision);
      if (differences.length === 0) {
        facts.revision = date;
        break;
      }
      if (date === FORMAT_REVISION) newest = differences;
    }
    // The layout alone (section kinds and extension names) decides whether
    // this is a format revision we know at all. Document-level identifiers
    // that differ are a document problem, reported, not a reason to give up.
    const kinds = facts.sections.map((s) => s.kind).join(',');
    const names = facts.sections.filter((s) => s.kind === spec.SECTION_KIND.EXTENSION).map((s) => s.name).join(' ');
    for (const [date, revision] of Object.entries(spec.FORMAT_REVISIONS)) {
      if (kinds === revision.sectionOrder.join(',') && names === revision.extensions.join(' ')) {
        facts.layoutRevision = date;
        break;
      }
    }
    facts.newestDifferences = newest;
    add(
      'documents',
      'format.revision',
      facts.revision !== null,
      facts.revision !== null
        ? `format revision ${facts.revision}`
        : `the archive matches no format revision this package knows (newest ${FORMAT_REVISION}): ${newest.join('; ')}`,
    );
  }

  const order = [...ARCHIVE_IDS, ...DOCUMENT_IDS];
  checks.sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
  return { checks, facts };
}

/**
 * The world a guest contract names, as the `world` member of an inspection
 * prints it (issue #278): WIT package, name, file, digests, imports, exports
 * and whether the guest module conforms. `prism-code`'s `inspect` calls this
 * one function, so the two cannot disagree. `guest` may be null, and then
 * `conforms` is null.
 *
 * @param {string} contract for example `hologram:guest/core-wasm@1`
 * @param {Uint8Array | null} guest the guest module
 */
export function worldOf(contract, guest) {
  return describeWorld(contract, guest);
}

/**
 * Is the world a contract names within a granted capability set, and is it
 * pure (issue #283)? Read from the world's declared imports alone; nothing is
 * instantiated. `set` is one set of a `prism/capabilities/1` file, or null
 * when nothing is granted. Returns `{ known, within, problems, pure, effects }`;
 * `known` is false, and nothing is claimed, for a contract this reader has no
 * world for. `prism-code` calls this one function before it compiles a guest.
 *
 * @param {string} contract
 * @param {object | null} set
 */
export function worldPolicy(contract, set) {
  const problem = set === null || set === undefined ? null : capabilitySetProblem(set);
  if (problem) throw new VerifyError('policy.invalid', `capabilities: ${problem}`);
  return checkWorldPolicy(contract, set ?? null);
}

/** The schema of an inspection, shared with `prism-code`'s `inspect` (issue #271, PR #335). */
export const INSPECTION_SCHEMA = 'prismpm/holo-inspection/1';

/** The fields of the 86-byte manifest suffix, which `manifest.wire` checks byte for byte against the Wire constant. */
const MANIFEST_SUFFIX_FIELDS = Object.freeze({
  entry: spec.CORE_WASM.ENTRY,
  contract: spec.CORE_WASM.CONTRACT,
  view_entry: spec.HOLOVIEW.ENTRY,
  surface: 'portable',
});

const ROLE_NAMES = Object.freeze({ capabilities: 'capability-set', guest: 'guest', view: 'view', model: 'model-document' });

function roleOf(section, facts) {
  switch (section.kind) {
    case spec.SECTION_KIND.APP_MANIFEST:
      return 'app-manifest';
    case spec.SECTION_KIND.METADATA:
      return 'source-manifest';
    case spec.SECTION_KIND.EXTENSION:
      if (section.name === spec.EXTENSION.APPLICATION_DIRECTORY) return 'application-directory';
      if (section.name === spec.EXTENSION.PRISMPM_MODEL) return 'model-provenance';
      return 'extension';
    case spec.SECTION_KIND.CONTENT_BLOB: {
      const role = Object.entries(facts.roles).find(([, label]) => label === section.label);
      return role ? ROLE_NAMES[role[0]] : 'content-blob';
    }
    default:
      return 'unknown';
  }
}

const orNull = (value) => (value === undefined ? null : value);

/**
 * A `prismpm/holo-inspection/1` object, the shape `prism-code`'s `inspect`
 * returns (sdk/npm/prism-code/src/inspect.mjs, PR #335): snake_case keys, a
 * section digest over exactly its table bytes, and for a content blob a
 * `content.digest` over the bytes after its label (ADR-015).
 */
function inspectionOf(bytes, facts, checks) {
  const status = (id) => checks.find((c) => c.id === id)?.status === 'pass';
  const blobOf = (role) => (facts.roles[role] ? facts.sections.find((s) => s.label === facts.roles[role]) : undefined);
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  const sections = facts.sections.map((s) => {
    const entry = {
      index: s.index,
      kind: s.kind,
      kind_name: s.kindName,
      role: roleOf(s, facts),
      offset: s.offset,
      length: s.length,
      digest: digestsOf(bytes.subarray(s.offset, s.offset + s.length)),
    };
    if (s.name !== undefined) entry.name = s.name;
    if (s.label !== undefined) {
      entry.label = s.label;
      entry.content = { length: s.content.length, digest: s.digests, label_matches: s.labelMatches };
    }
    return entry;
  });

  const { manifest, provenance, directory, modelDocument } = facts.documents;
  const application = modelDocument?.application ?? {};
  const modelBlob = blobOf('model');
  const capabilities = blobOf('capabilities');
  const wasm = directory?.layers?.find((l) => l.kind === 'wasm');
  const contract = wasm?.contract ?? provenance?.core_wasm_contract ?? null;
  const guest = blobOf('guest');

  return {
    schema: INSPECTION_SCHEMA,
    name: application.name ?? provenance?.cargo_name ?? null,
    revision: facts.revision,
    physical_version: header.getUint16(4, true),
    flags: header.getUint16(6, true),
    size: bytes.length,
    digest: digestsOf(bytes),
    footer: facts.footer.stored,
    sections,
    manifest: manifest
      ? {
          uri: manifest.uri,
          labels: { capability_set: manifest.labels.capabilitySet, guest: manifest.labels.guest, view: manifest.labels.view },
          ...MANIFEST_SUFFIX_FIELDS,
        }
      : null,
    model:
      modelDocument && modelBlob
        ? {
            schema: orNull(modelDocument.schema),
            name: orNull(application.name),
            cargo_name: orNull(application.cargo_name),
            cargo_version: orNull(application.cargo_version),
            description: orNull(application.cargo_description),
            profile: orNull(application.profile),
            function: orNull(application.function_name),
            vectors: Array.isArray(application.acceptance_vectors) ? application.acceptance_vectors.length : 0,
            limits: {
              request: orNull(application.request_maximum),
              response: orNull(application.response_maximum),
              guest_allocation: orNull(application.guest_allocation_maximum),
            },
            digest: modelBlob.digests,
          }
        : null,
    provenance: provenance
      ? {
          schema: orNull(provenance.schema),
          application_kappa: orNull(provenance.application_kappa),
          model_id: orNull(provenance.model_id),
          compiler_semantics_id: orNull(provenance.compiler_semantics_id),
          stdlib_semantics_id: orNull(provenance.stdlib_semantics_id),
          lexlean_commit: orNull(provenance.lexlean_commit),
        }
      : null,
    world:
      contract && capabilities
        ? {
            ...describeWorld(contract, guest ? guest.content : null),
            capability_set: { label: capabilities.label, empty: hex(capabilities.content) === spec.CAPABILITY_SET.EMPTY_HEX },
          }
        : null,
    // Statements inside the archive arrive with the attestation section
    // (issue #267). Until then no holo carries any, and the list is empty.
    attestations: [],
    verification: {
      footer: status('archive.footer'),
      labels: status('blob.labels'),
      cross_references: status('references'),
    },
  };
}

/**
 * Describe a holo as a `prismpm/holo-inspection/1` object. Throws VerifyError
 * when the header or section table cannot be read, because then there are no
 * sections to describe. Later damage is reported, not thrown: `verification`
 * flags, `label_matches`, a null `revision`, and null for a document that
 * does not decode.
 *
 * @param {Uint8Array | ArrayBuffer} source the whole holo
 */
export function inspect(source) {
  const bytes = asBytes(source);
  const { checks, facts } = analyze(bytes);
  const broken = checks.find((c) => c.status === 'fail' && STRUCTURE_IDS.includes(c.id));
  if (broken) throw new VerifyError(broken.id, broken.detail);
  return inspectionOf(bytes, facts, checks);
}

function checkPolicy(policy) {
  const { LEVELS, DEFAULT_MINIMUM, DEFAULT_POLICY } = ASSURANCE;
  if (policy === undefined || policy === null) return { name: DEFAULT_POLICY, minimum: DEFAULT_MINIMUM, digests: {}, world: undefined, capabilities: null };
  if (typeof policy !== 'object') throw new VerifyError('policy.invalid', 'the policy must be an object');
  for (const key of Object.keys(policy)) {
    if (!['name', 'minimum', 'digests', 'world', 'capabilities'].includes(key)) throw new VerifyError('policy.invalid', `unknown policy member ${key}; expected name, minimum, digests, world or capabilities`);
  }
  const name = policy.name ?? DEFAULT_POLICY;
  if (typeof name !== 'string' || name.length < 1 || name.length > 1024) throw new VerifyError('policy.invalid', 'policy.name must be a string of 1 to 1024 characters');
  const minimum = policy.minimum ?? DEFAULT_MINIMUM;
  if (!LEVELS.includes(minimum)) throw new VerifyError('policy.invalid', `policy.minimum ${JSON.stringify(minimum)} is not one of ${LEVELS.join(', ')}`);
  const digests = policy.digests ?? {};
  if (typeof digests !== 'object') throw new VerifyError('policy.invalid', 'policy.digests must be an object');
  for (const [target, set] of Object.entries(digests)) {
    if (!DIGEST_TARGETS.includes(target)) throw new VerifyError('policy.invalid', `policy.digests.${target} is not one of ${DIGEST_TARGETS.join(', ')}`);
    const algorithms = Object.keys(set ?? {});
    if (algorithms.length === 0) throw new VerifyError('policy.invalid', `policy.digests.${target} names no digest`);
    for (const algorithm of algorithms) {
      if (algorithm !== 'sha256' && algorithm !== 'blake3') throw new VerifyError('policy.invalid', `policy.digests.${target}.${algorithm}: only sha256 and blake3 are known`);
      if (!HEX64.test(set[algorithm])) throw new VerifyError('policy.invalid', `policy.digests.${target}.${algorithm} is not 64 lowercase hex characters`);
    }
  }
  const capabilities = policy.capabilities ?? null;
  if (capabilities !== null) {
    const problem = capabilitySetProblem(capabilities);
    if (problem) throw new VerifyError('policy.invalid', `policy.capabilities: ${problem}`);
  }
  return { name, minimum, digests, world: checkWorldPin(policy.world), capabilities };
}

/**
 * The `world` member of a policy: the lock's `inputs.world` (issue #278), so a
 * caller passes it unchanged. `undefined` pins nothing; `null` says no world
 * is expected.
 */
function checkWorldPin(pin) {
  if (pin === undefined || pin === null) return pin;
  if (typeof pin !== 'object' || Array.isArray(pin)) throw new VerifyError('policy.invalid', 'policy.world must be an object, as in the inputs.world of the lock, or null');
  for (const key of Object.keys(pin)) {
    if (!['contract', 'blake3', 'sha256'].includes(key)) throw new VerifyError('policy.invalid', `policy.world.${key} is not one of contract, blake3, sha256`);
  }
  if (Object.keys(pin).length === 0) throw new VerifyError('policy.invalid', 'policy.world names nothing');
  if (pin.contract !== undefined && (typeof pin.contract !== 'string' || pin.contract.length < 1)) throw new VerifyError('policy.invalid', 'policy.world.contract must be a string');
  for (const algorithm of ['blake3', 'sha256']) {
    if (pin[algorithm] !== undefined && !HEX64.test(pin[algorithm])) throw new VerifyError('policy.invalid', `policy.world.${algorithm} is not 64 lowercase hex characters`);
  }
  return pin;
}

/** A detail line as one plain sentence, within the verdict schema's 1024 characters. */
function sentence(detail) {
  let text = detail.charAt(0).toUpperCase() + detail.slice(1);
  if (!text.endsWith('.')) text += '.';
  return text.length <= 1024 ? text : `${text.slice(0, 1020)}...`;
}

/**
 * The evidence above the archive itself. Format revision 2026-10-23 has no
 * attestation bundle, so no holo carries these statements yet; each absent
 * statement withholds its level (docs/proposals/269-assurance-levels.md).
 */
const STATEMENTS = Object.freeze([
  { check: 'provenance.statement', withholds: 'P1', message: 'The holo carries no provenance statement; format revision 2026-10-23 has no attestation bundle (issues #267 and #268).' },
  { check: 'proof.statement', withholds: 'P2', message: 'The holo carries no proof statement (issue #266).' },
  { check: 'replay.statement', withholds: 'P3', message: 'The holo carries no replay statement (issue #284).' },
]);

/**
 * Check a holo and return its verdict, a `prism/verdict/1` object
 * (docs/proposals/269-assurance-levels.md). The level is computed from the
 * evidence; the policy only decides `passed`. Every check runs, so the
 * reasons list every problem at once.
 *
 * Rejects with VerifyError when no verdict can be reached: input that is not
 * bytes, an invalid policy, a file whose header or section table cannot be
 * read, or an intact holo of a format revision this package does not know.
 * Asynchronous so that bundle signature verification (issue #267), which
 * needs WebCrypto, can join without an API change.
 *
 * @param {Uint8Array | ArrayBuffer} source the whole holo
 * @param {{ name?: string, minimum?: 'P0' | 'P1' | 'P2' | 'P3', digests?: Record<string, { sha256?: string, blake3?: string }>, world?: { contract?: string, sha256?: string, blake3?: string } | null }} [policy]
 */
export async function verify(source, policy) {
  const bytes = asBytes(source);
  const wanted = checkPolicy(policy);
  const { checks, facts } = analyze(bytes);

  const unreadable = checks.find((c) => c.status === 'fail' && STRUCTURE_IDS.includes(c.id));
  if (unreadable) throw new VerifyError(unreadable.id, `no verdict: ${unreadable.detail}`);
  if (facts.layoutRevision === null && facts.footer.matches) {
    throw new VerifyError('format.revision', `no verdict: ${sentence(`the archive matches no format revision this package knows (newest ${FORMAT_REVISION}): ${facts.newestDifferences.join('; ')}`)}`);
  }

  const reasons = [];
  for (const check of checks) {
    if (check.status === 'fail' && REPORTED_AS[check.id]) reasons.push({ check: REPORTED_AS[check.id], withholds: 'P1', message: sentence(check.detail) });
  }
  for (const statement of STATEMENTS) reasons.push({ ...statement });

  // world.capabilities (#283): the declared world's imports within the granted set. It withholds P3, and the default policy requires it at every level.
  const contract = facts.documents.directory?.layers?.find((l) => l.kind === 'wasm')?.contract ?? facts.documents.provenance?.core_wasm_contract ?? null;
  const worldPolicy = contract === null ? null : checkWorldPolicy(contract, wanted.capabilities);
  const outsideGrant = worldPolicy?.known && !worldPolicy.within;
  if (outsideGrant) {
    reasons.push({ check: 'world.capabilities', code: 'PP5602', withholds: 'P3', message: sentence(`the world exceeds the granted capabilities: ${worldPolicy.problems.join('; ')}`) });
  }

  const { LEVELS, RANK } = ASSURANCE;
  const lowestWithheld = Math.min(...reasons.filter((r) => r.withholds).map((r) => RANK[r.withholds]), LEVELS.length);
  const level = LEVELS[lowestWithheld - 1];

  let passed = !outsideGrant;
  if (RANK[level] < RANK[wanted.minimum]) {
    passed = false;
    reasons.push({ check: 'policy.level', code: 'PP5601', withholds: null, message: `The level is ${level}; the policy requires ${wanted.minimum} or above.` });
  }
  for (const [target, expected] of Object.entries(wanted.digests)) {
    let actual = null;
    if (target === 'archive') actual = digestsOf(bytes);
    else if (facts.roles[target]) actual = facts.sections.find((s) => s.label === facts.roles[target])?.digests ?? null;
    const mismatches = actual
      ? Object.entries(expected)
          .filter(([algorithm, value]) => actual[algorithm] !== value)
          .map(([algorithm, value]) => `its ${algorithm} is ${actual[algorithm]}, the policy pins ${value}`)
      : ['it could not be located in this archive'];
    if (mismatches.length > 0) {
      passed = false;
      reasons.push({ check: `policy.digests.${target}`, withholds: null, message: sentence(`the ${target} does not match the policy: ${mismatches.join('; ')}`) });
    }
  }

  if (wanted.world !== undefined) {
    const mismatches = contract === null ? ['the holo declares no guest contract to compare with the pinned world'] : compareWorldPin(contract, wanted.world);
    if (mismatches.length > 0) {
      passed = false;
      reasons.push({ check: 'world.hash', withholds: null, message: sentence(`the world does not match the policy: ${mismatches.join('; ')}`) });
    }
  }

  return {
    schema: ASSURANCE.VERDICT,
    holo: facts.fingerprint,
    level,
    policy: { name: wanted.name, minimum: wanted.minimum },
    passed,
    reasons,
  };
}

/**
 * Check the transparency log entries and RFC 3161 timestamps of one Sigstore
 * bundle against a pinned Sigstore trusted root, offline (issue #275,
 * docs/proposals/275-transparency-log.md). The result lists every problem at
 * once; `reasons` has the shape of a verdict's `reasons`.
 *
 * Rejects with VerifyError `trustedroot.invalid` when the trusted root is not
 * usable, and `input` when the bundle is not an object.
 *
 * @param {object} bundle a Sigstore bundle v0.3
 * @param {object} trustedRoot a Sigstore `trusted_root.json`, pinned by the caller
 * @param {{ crypto?: { subtle: SubtleCrypto }, entries?: number, timestamps?: number }} [options]
 */
export async function verifyTransparency(bundle, trustedRoot, options) {
  if (bundle === null || typeof bundle !== 'object' || Array.isArray(bundle)) throw new VerifyError('input', 'the bundle must be an object');
  try {
    return await transparency.verifyTransparency(bundle, trustedRoot, options);
  } catch (error) {
    if (error instanceof transparency.TrustedRootError) throw new VerifyError('trustedroot.invalid', error.message);
    throw error;
  }
}
