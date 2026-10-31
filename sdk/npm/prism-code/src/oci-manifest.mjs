/**
 * The registry objects of a holo (issue #292, docs/proposals/292-push-pull-oci.md).
 *
 * The holo manifest is a pure function of the holo's bytes: no clock, no path
 * and no reference goes in, so the same file has one manifest digest on every
 * registry (ADR-015). Every descriptor is `sha256`; BLAKE3 travels in
 * annotations, because registries refuse `blake3:` digests.
 *
 * Referrers copy cosign's own layout, so `cosign verify-attestation` and `oras
 * discover` read them (ADR-015, #267).
 */
import { canonicalJson, parseArchive, resolveArchive, asBytes } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { sha256Hex } from './sha256.mjs';
import { BUNDLE_MEDIA_TYPE, OCI_MANIFEST_SUBJECT, STATEMENT_TYPE } from './attestations.mjs';

export const MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json';
export const INDEX_MEDIA_TYPE = 'application/vnd.oci.image.index.v1+json';
export const EMPTY_MEDIA_TYPE = 'application/vnd.oci.empty.v1+json';
export const HOLO_MEDIA_TYPE = 'application/vnd.uor.prism.holo.v1';

/** The OCI empty descriptor: the two bytes `{}`, inlined. */
export const EMPTY_BYTES = new Uint8Array([0x7b, 0x7d]);
export const EMPTY_DESCRIPTOR = Object.freeze({
  mediaType: EMPTY_MEDIA_TYPE,
  digest: 'sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a',
  size: 2,
  data: 'e30=',
});

export const ANNOTATION = Object.freeze({
  CREATED: 'org.opencontainers.image.created',
  TITLE: 'org.opencontainers.image.title',
  REF_NAME: 'org.opencontainers.image.ref.name',
  IMAGE_NAME: 'io.containerd.image.name',
  FINGERPRINT: 'foundation.uor.prism.holo.fingerprint',
  APPLICATION: 'foundation.uor.prism.holo.application',
  BLAKE3: 'foundation.uor.prism.digest.blake3',
  BUNDLE_CONTENT: 'dev.sigstore.bundle.content',
  BUNDLE_PREDICATE: 'dev.sigstore.bundle.predicateType',
});

/** Fixed, so a manifest depends on nothing but the bytes (ADR-015). */
export const CREATED = '1970-01-01T00:00:00Z';
export const BUNDLE_CONTENT = 'dsse-envelope';

const encoder = new TextEncoder();

/** A JSON value as the bytes a registry stores: canonical, so its digest is reproducible. */
export const canonicalBytes = (value) => encoder.encode(canonicalJson(value));

/** The `sha256:` digest of some bytes. */
export const digestOf = async (bytes) => `sha256:${await sha256Hex(bytes)}`;

export const hexOf = (digest) => digest.slice(digest.indexOf(':') + 1);

/** Tag of the referrers tag schema of the distribution spec. */
export const referrersTag = (digest) => `sha256-${hexOf(digest)}`;

/** The tag that makes a BLAKE3 fingerprint a pull address. */
export const fingerprintTag = (fingerprint) => `blake3-${hexOf(fingerprint)}`;

function identityOf(parsed) {
  const { identities, modelDocument, provenance } = resolveArchive(parsed);
  const name = modelDocument.application?.name ?? provenance.cargo_name ?? null;
  return { name: typeof name === 'string' && name !== '' ? name : 'application', applicationKappa: identities.applicationKappa };
}

/**
 * The manifest of a holo and everything that goes with it.
 *
 * @param {Uint8Array | ArrayBuffer | object} source the holo's bytes, or a parsed archive
 * @returns {Promise<{ manifest: object, bytes: Uint8Array, digest: string, size: number, descriptor: object, layer: object, fingerprint: string, name: string }>}
 */
export async function holoManifest(source) {
  const parsed = source && typeof source === 'object' && Array.isArray(source.sections) ? source : parseArchive(asBytes(source));
  const { name, applicationKappa } = identityOf(parsed);
  const fingerprint = `blake3:${parsed.footer}`;
  const layer = {
    mediaType: HOLO_MEDIA_TYPE,
    digest: await digestOf(parsed.bytes),
    size: parsed.bytes.length,
    annotations: { [ANNOTATION.TITLE]: `${name}.holo`, [ANNOTATION.BLAKE3]: blake3Hex(parsed.bytes) },
  };
  const annotations = { [ANNOTATION.CREATED]: CREATED, [ANNOTATION.TITLE]: name, [ANNOTATION.FINGERPRINT]: fingerprint };
  if (typeof applicationKappa === 'string') annotations[ANNOTATION.APPLICATION] = applicationKappa;
  const manifest = { schemaVersion: 2, mediaType: MANIFEST_MEDIA_TYPE, artifactType: HOLO_MEDIA_TYPE, config: EMPTY_DESCRIPTOR, layers: [layer], annotations };
  const bytes = canonicalBytes(manifest);
  const digest = await digestOf(bytes);
  const descriptor = { mediaType: MANIFEST_MEDIA_TYPE, digest, size: bytes.length };
  return { manifest, bytes, digest, size: bytes.length, descriptor, layer, fingerprint, name };
}

/**
 * The referrer manifest of one Sigstore bundle. `line` is the bundle's bytes,
 * unchanged: for an attestation line of a holo they equal the line without its
 * LF (#267 rule 10).
 *
 * @param {Uint8Array} line
 * @param {{ mediaType: string, digest: string, size: number }} subject the holo manifest's descriptor
 * @param {string} predicateType
 */
export async function referrerManifest(line, subject, predicateType) {
  const layer = { mediaType: BUNDLE_MEDIA_TYPE, digest: await digestOf(line), size: line.length };
  const manifest = {
    schemaVersion: 2,
    mediaType: MANIFEST_MEDIA_TYPE,
    artifactType: BUNDLE_MEDIA_TYPE,
    config: EMPTY_DESCRIPTOR,
    layers: [layer],
    subject: { mediaType: subject.mediaType, digest: subject.digest, size: subject.size },
    annotations: { [ANNOTATION.BUNDLE_CONTENT]: BUNDLE_CONTENT, [ANNOTATION.BUNDLE_PREDICATE]: predicateType, [ANNOTATION.CREATED]: CREATED },
  };
  const bytes = canonicalBytes(manifest);
  const digest = await digestOf(bytes);
  return { manifest, bytes, digest, layer, descriptor: referrerDescriptor(manifest, digest, bytes.length) };
}

/** How a referrer is listed in an index: its identity, its type and its annotations. */
export function referrerDescriptor(manifest, digest, size) {
  const descriptor = { mediaType: manifest.mediaType ?? MANIFEST_MEDIA_TYPE, digest, size };
  const type = manifest.artifactType ?? manifest.config?.mediaType;
  if (type) descriptor.artifactType = type;
  if (manifest.annotations) descriptor.annotations = manifest.annotations;
  return descriptor;
}

/**
 * The registry-facing statement of one in-holo statement (ADR-015, #267): the
 * OCI manifest first, with `sha256` only, then the same blob subjects, and the
 * same predicate. It can name the manifest because it never goes in the holo.
 */
export function registryStatement(statement, manifestDigest) {
  const blobs = statement.subject.filter((subject) => subject.name !== OCI_MANIFEST_SUBJECT);
  return {
    _type: STATEMENT_TYPE,
    subject: [{ name: OCI_MANIFEST_SUBJECT, digest: { sha256: hexOf(manifestDigest) } }, ...blobs],
    predicateType: statement.predicateType,
    predicate: statement.predicate,
  };
}

/** One registry-facing statement per distinct predicate of the holo, in section order. */
export function registryStatements(attestations, manifestDigest) {
  const seen = new Set();
  const statements = [];
  for (const { statement } of attestations) {
    const key = canonicalJson([statement.predicateType, statement.predicate ?? null]);
    if (seen.has(key)) continue;
    seen.add(key);
    statements.push(registryStatement(statement, manifestDigest));
  }
  return statements;
}

/** An empty referrers index, the shape the referrers API and the tag schema share. */
export const emptyIndex = () => ({ schemaVersion: 2, mediaType: INDEX_MEDIA_TYPE, manifests: [] });

/** The one holo layer of a manifest, or null when the manifest is not a holo's. */
export function holoLayerOf(manifest) {
  if (manifest === null || typeof manifest !== 'object' || !Array.isArray(manifest.layers)) return null;
  const layers = manifest.layers.filter((layer) => layer?.mediaType === HOLO_MEDIA_TYPE);
  return layers.length === 1 && manifest.layers.length === 1 ? layers[0] : null;
}
