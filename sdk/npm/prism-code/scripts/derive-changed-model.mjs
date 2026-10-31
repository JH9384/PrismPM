/**
 * Derives test/fixtures/Calculator.changed-model.holo from the reference archive
 * (issue #284): the negative fixture that proves a changed model fails replay.
 *
 * The change is one a model author could make: the success word of the response
 * becomes `OK`. The guest's data segment and the model's acceptance vectors change
 * together, and every identity that names them is recomputed, so the archive is
 * coherent. It loads, its footer and labels verify, and its own vectors pass. Only
 * a history recorded from the old build can tell the two apart, which is the point.
 *
 * This is a rewrite, not a rebuild. `source_id`, `semantic_id` and the Lean
 * identities still describe the original sources, and this archive has no proof.
 * Nothing here is reference evidence; it is a test input.
 *
 * `node scripts/derive-changed-model.mjs` writes the file. `--check` fails when it
 * differs from what the reference archive derives to today.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArchive, resolveArchive, KIND, LABEL_LENGTH, MANIFEST_PREFIX_LENGTH, DIRECTORY_EXTENSION, MODEL_EXTENSION } from '../src/archive.mjs';
import { encodeArchive } from '../src/attestations.mjs';
import { kappa } from '../src/blake3.mjs';
import { createHash } from 'node:crypto';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const source = here('../fixtures/Calculator.holo');
const target = here('../test/fixtures/Calculator.changed-model.holo');

const encoder = new TextEncoder();
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function changedGuest(guest) {
  const text = Buffer.from(guest);
  const at = text.indexOf('\tok\t');
  if (at < 0 || text.indexOf('\tok\t', at + 1) >= 0) throw new Error('the reference guest does not hold the success word exactly once');
  const out = new Uint8Array(guest);
  out.set(encoder.encode('OK'), at + 1);
  return out;
}

/** `1\tok\t...` becomes `1\tOK\t...`; a response that reports an error is unchanged. */
function changedResponse(response) {
  const bytes = Uint8Array.from(response);
  const prefix = encoder.encode('1\tok\t');
  if (prefix.every((b, i) => bytes[i] === b)) bytes.set(encoder.encode('OK'), 2);
  return [...bytes];
}

function withName(name, payload) {
  const nameBytes = encoder.encode(name);
  const body = new Uint8Array(2 + nameBytes.length + payload.length);
  body[0] = nameBytes.length & 0xff;
  body[1] = nameBytes.length >> 8;
  body.set(nameBytes, 2);
  body.set(payload, 2 + nameBytes.length);
  return body;
}

function blobBody(label, content) {
  const body = new Uint8Array(LABEL_LENGTH + content.length);
  body.set(encoder.encode(label), 0);
  body.set(content, LABEL_LENGTH);
  return body;
}

export function deriveChangedModel(bytes) {
  const parsed = parseArchive(bytes);
  const { guest, model, modelDocument, directory, provenance } = resolveArchive(parsed);

  const newGuest = changedGuest(guest.content);
  const guestLabel = kappa(newGuest);
  const document = structuredClone(modelDocument);
  document.application.acceptance_vectors = document.application.acceptance_vectors.map((vector) => ({ request: vector.request, response: changedResponse(vector.response) }));
  const newModel = encoder.encode(JSON.stringify(document));
  const modelLabel = kappa(newModel);
  const modelId = sha256(newModel);

  const newDirectory = structuredClone(directory);
  for (const layer of newDirectory.layers) if (layer.content_kappa === guest.label) layer.content_kappa = guestLabel;
  for (const blob of newDirectory.blobs) {
    if (blob.kappa === guest.label) Object.assign(blob, { kappa: guestLabel, byte_length: newGuest.length });
    if (blob.kappa === model.label) Object.assign(blob, { kappa: modelLabel, byte_length: newModel.length });
  }
  // The closed Holo/1 profile keeps content blobs, and the directory's list of them, in label order.
  newDirectory.blobs.sort((a, b) => (a.kappa < b.kappa ? -1 : 1));
  const replaced = new Map([[guest.label, { label: guestLabel, content: newGuest }], [model.label, { label: modelLabel, content: newModel }]]);
  const blobs = parsed.blobs.map((blob) => replaced.get(blob.label) ?? { label: blob.label, content: blob.content }).sort((a, b) => (a.label < b.label ? -1 : 1));

  const manifest = new Uint8Array(parsed.sections[parsed.manifest.section].body);
  parsed.manifest.labels.forEach((label, i) => {
    if (label === guest.label) manifest.set(encoder.encode(guestLabel), MANIFEST_PREFIX_LENGTH + i * LABEL_LENGTH);
  });
  const newProvenance = { ...provenance, application_kappa: kappa(manifest), guest_content_kappa: guestLabel, model_content_kappa: modelLabel, model_id: modelId };
  const metadata = JSON.parse(parsed.metadata.text);
  for (const file of metadata.files) if (file.kind === 'model-document') file.sha256 = modelId;

  let nextBlob = 0;
  const sections = parsed.sections.map(({ index, kind, body }) => {
    if (kind === KIND.APP_MANIFEST) return { kind, body: manifest };
    if (kind === KIND.METADATA) return { kind, body: encoder.encode(JSON.stringify(metadata)) };
    if (kind === KIND.EXTENSION) {
      const { name } = parsed.extensions.find((e) => e.section === index);
      if (name === DIRECTORY_EXTENSION) return { kind, body: withName(name, encoder.encode(JSON.stringify(newDirectory))) };
      if (name === MODEL_EXTENSION) return { kind, body: withName(name, encoder.encode(JSON.stringify(newProvenance))) };
    }
    if (kind === KIND.CONTENT_BLOB) {
      const { label, content } = blobs[nextBlob++];
      return { kind, body: blobBody(label, content) };
    }
    return { kind, body };
  });
  return encodeArchive(sections);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const derived = deriveChangedModel(new Uint8Array(readFileSync(source)));
  if (process.argv.includes('--check')) {
    if (!Buffer.from(derived).equals(readFileSync(target))) {
      console.error('test/fixtures/Calculator.changed-model.holo is not what the reference archive derives to. Run: node scripts/derive-changed-model.mjs');
      process.exit(1);
    }
    console.log('the changed-model fixture is current');
  } else {
    writeFileSync(target, derived);
    console.log(`wrote test/fixtures/Calculator.changed-model.holo, ${derived.length} bytes`);
  }
}
