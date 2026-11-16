/**
 * `push` and `pull`: move a holo and its attestations to and from an OCI registry
 * or a local directory store (issue #292, docs/proposals/292-push-pull-oci.md).
 *
 * Both ends implement one endpoint (`oci-registry.mjs`, `oci-store.mjs`), so
 * everything here works on either. `pull` holds everything in memory until every
 * check has passed, and only then writes.
 *
 * This file fetches and writes; it decides nothing about trust (#449). Every
 * check of what was fetched, and of what is about to leave, is `verify`'s, in
 * `verify-closure.mjs`, and every signature is an `auth` identity's.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix.
 */
import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { asBytes } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { BUNDLE_MEDIA_TYPE } from './attestations.mjs';
import { auth } from './auth.mjs';
import { verifyHoloClaims, verifyOutgoing, verifyPullClosure } from './verify-closure.mjs';
import { DigestMismatchError, PrismCodeError, PullVerificationError, ReferenceInvalidError } from './errors.mjs';
import {
  ANNOTATION,
  EMPTY_BYTES,
  EMPTY_DESCRIPTOR,
  HOLO_MEDIA_TYPE,
  MANIFEST_MEDIA_TYPE,
  fingerprintTag,
  hexOf,
  holoLayerOf,
  holoManifest,
  referrerManifest,
  registryStatements,
} from './oci-manifest.mjs';
import { formatReference, parseReference } from './oci-reference.mjs';
import { createRegistryClient, MAX_MANIFEST_BYTES } from './oci-registry.mjs';
import { dockerCredentials } from './oci-auth.mjs';
import { openStore } from './oci-store.mjs';

/** The most a pull accepts for one holo. */
export const MAX_HOLO_BYTES = 1024 * 1024 * 1024;
/** The most a pull accepts for one bundle. Keyless bundles are a few kilobytes plus their statement. */
const MAX_BUNDLE_BYTES = 16 * 1024 * 1024;
/** A registry chooses what it lists; a pull reads this many referrers at most. */
const MAX_REFERRERS = 256;
export const PUSH_SCHEMA = 'prism/push-result/1';
export const PULL_SCHEMA = 'prism/pull-result/1';

const decoder = new TextDecoder('utf-8', { fatal: true });
const encoder = new TextEncoder();
const short = (digest) => hexOf(digest).slice(0, 12);

/** The endpoint a reference names. */
export function openEndpoint(reference, options = {}) {
  if (reference.kind === 'store') return openStore(reference.path, { repository: reference.repository });
  return createRegistryClient(reference, {
    plainHttp: options.plainHttp,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    referrersFallback: options.referrersFallback,
    resolveCredentials: options.credentials !== undefined ? () => options.credentials : (registry) => dockerCredentials(registry, { env: options.env }),
  });
}

const referenceOf = (reference, options = {}) => (typeof reference === 'string' ? parseReference(reference, { store: options.store }) : reference);

const parseJson = (bytes, what) => {
  try {
    return JSON.parse(decoder.decode(bytes));
  } catch (cause) {
    throw new PullVerificationError(`${what} is not UTF-8 JSON: ${cause.message}`, { check: 'pull.manifest', cause });
  }
};

/**
 * A manifest and its holo, fetched and checked against every digest that names
 * them, plus every referrer. Nothing here looks at policy.
 */
async function fetchClosure(endpoint, reference, options = {}) {
  const maxHoloBytes = options.maxHoloBytes ?? MAX_HOLO_BYTES;
  let address = reference.digest ?? reference.tag;
  if (reference.fingerprint) address = await endpoint.resolveFingerprint(reference.fingerprint);
  const { bytes: manifestBytes, digest } = await endpoint.getManifest(address);
  const manifest = parseJson(manifestBytes, `manifest ${digest}`);
  const layer = holoLayerOf(manifest);
  if (!layer) throw new PullVerificationError(`manifest ${digest} is not a holo: it must have exactly one layer of type ${HOLO_MEDIA_TYPE}`, { check: 'pull.manifest' });
  if (typeof layer.digest !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(layer.digest) || !Number.isSafeInteger(layer.size) || layer.size < 0) {
    throw new PullVerificationError(`manifest ${digest} has an unusable holo layer descriptor`, { check: 'pull.manifest' });
  }
  if (layer.size > maxHoloBytes) throw new PullVerificationError(`the holo is ${layer.size} bytes, over the ${maxHoloBytes} byte bound`, { check: 'pull.size' });
  const holo = await endpoint.getBlob(layer.digest, layer.size);
  return { manifest, manifestBytes, digest, layer, holo, referrers: await fetchReferrers(endpoint, digest) };
}

/** Every referrer that is a Sigstore bundle, read and hashed. A descriptor that lies about its subject is dropped. */
async function fetchReferrers(endpoint, subject) {
  const listed = (await endpoint.listReferrers(subject)).filter((d) => typeof d?.digest === 'string' && /^sha256:[0-9a-f]{64}$/.test(d.digest));
  const out = [];
  for (const descriptor of listed.slice(0, MAX_REFERRERS)) {
    const { bytes, digest } = await endpoint.getManifest(descriptor.digest);
    if (bytes.length > MAX_MANIFEST_BYTES) continue;
    let manifest;
    try {
      manifest = JSON.parse(decoder.decode(bytes));
    } catch {
      continue;
    }
    if (manifest?.subject?.digest !== subject) continue;
    const layer = manifest.layers?.[0];
    if (manifest.layers?.length !== 1 || layer?.mediaType !== BUNDLE_MEDIA_TYPE || !Number.isSafeInteger(layer.size) || layer.size > MAX_BUNDLE_BYTES) continue;
    out.push({ manifest, manifestBytes: bytes, digest, layer, line: await endpoint.getBlob(layer.digest, layer.size), descriptor });
  }
  return out;
}

/** What `verify` judges of a fetched closure: the bytes, and what the manifest and the caller claim about them. */
const factsOf = (closure, reference) => ({
  holo: closure.holo,
  manifestDigest: closure.digest,
  claims: { fingerprint: closure.manifest.annotations?.[ANNOTATION.FINGERPRINT], blake3: closure.layer.annotations?.[ANNOTATION.BLAKE3] },
  asked: { fingerprint: reference.fingerprint },
  referrers: closure.referrers.map(({ digest, line }) => ({ digest, line })),
});

/** Write a closure to an endpoint: blobs first, then referrers, then the tag, so a tag never names something half there. */
async function writeClosure(endpoint, closure, tag) {
  await endpoint.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  await endpoint.putBlob(closure.layer.digest, closure.holo);
  await endpoint.putManifest(closure.digest, closure.manifestBytes);
  await writeReferrers(endpoint, closure.digest, closure.referrers);
  if (tag) await endpoint.tagManifest(tag, closure.manifestBytes);
}

/** Put referrers and record, in the tag schema's index, any the endpoint did not index. Their bytes do not change. */
async function writeReferrers(endpoint, subject, referrers) {
  const unindexed = [];
  for (const referrer of referrers) {
    await endpoint.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
    await endpoint.putBlob(referrer.layer.digest, referrer.line);
    const { indexed } = await endpoint.putManifest(referrer.digest, referrer.manifestBytes);
    if (!indexed) unindexed.push(referrer.descriptor);
  }
  await endpoint.attachReferrers(subject, unindexed);
}

async function atomicWrite(target, bytes) {
  const scratch = `${target}.pull-${process.pid}.tmp`;
  try {
    await writeFile(scratch, bytes);
    await rename(scratch, target);
  } finally {
    await rm(scratch, { force: true });
  }
}

/**
 * Pull a holo and verify it before anything is written.
 *
 * `output` is a file path, or a `dir://` reference to store it with all its
 * referrers; without one, nothing is written and the bytes are returned. `policy`
 * is a policy file path or a policy object, as `check` takes; the default accepts
 * P0, unless `PRISM_MINIMUM_LEVEL` says otherwise. The signer options are those of
 * `experimental_verifyAttestations`: with any of them, at least one bundle in the
 * holo or in the registry must pass, and the signed statements in the holo count
 * toward the level as they do in `check`. Without a signer a signed holo is P0.
 *
 * @param {string | object} source the reference
 * @param {object} [options] `{ store, output, policy, key, certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer, type, trustedRoot, entries, timestamps, plainHttp, credentials, fetch, env, maxHoloBytes, referrersFallback }`
 * @returns {Promise<object>} `prism/pull-result/1`, with `holo` the bytes
 */
export async function experimental_pull(source, options = {}) {
  const reference = referenceOf(source, options);
  const endpoint = openEndpoint(reference, options);
  const closure = await fetchClosure(endpoint, reference, options);
  // Steps 4 to 8 are verify's; nothing is written unless every one passed.
  const { fingerprint, attestations, verdict, signers } = await verifyPullClosure(factsOf(closure, reference), options);

  let output = null;
  if (typeof options.output === 'string' && options.output.startsWith('dir://')) {
    const destination = parseReference(options.output);
    if (destination.digest || destination.fingerprint) throw new ReferenceInvalidError('a store to pull into is named by a tag, not a digest', { check: 'reference.store' });
    await writeClosure(openEndpoint(destination), closure, destination.tag);
    output = options.output;
  } else if (typeof options.output === 'string') {
    output = resolve(options.output);
    await atomicWrite(output, closure.holo);
  }
  return {
    schema: PULL_SCHEMA,
    reference: formatReference(reference, closure.digest),
    digest: closure.digest,
    size: closure.layer.size,
    fingerprint,
    sha256: hexOf(closure.layer.digest),
    blake3: blake3Hex(closure.holo),
    verdict,
    attestations: { holo: attestations.length, referrers: closure.referrers.length, signatures: signers === null ? 'not checked' : 'verified', verified: signers ?? [] },
    output,
    holo: closure.holo,
  };
}

/** The holo's own attestations and any referrers already in a store being pushed from. */
async function readSource(source, options) {
  if (typeof source === 'string' && source.startsWith('dir://')) {
    const reference = parseReference(source);
    const closure = await fetchClosure(openEndpoint(reference), reference, options);
    verifyHoloClaims(factsOf(closure, reference));
    return { holo: closure.holo, carried: closure.referrers, carriedFor: closure.digest };
  }
  if (typeof source === 'string') {
    try {
      return { holo: new Uint8Array(await readFile(resolve(source))), carried: [], carriedFor: null };
    } catch (cause) {
      throw new PrismCodeError('load.path', `${source} cannot be read: ${cause.code ?? cause.message}`);
    }
  }
  return { holo: asBytes(source), carried: [], carriedFor: null };
}

/**
 * Push a holo: its layer and manifest, one referrer per attestation line, with a
 * signer one registry-facing statement per predicate, and finally its tags.
 *
 * `key` signs with a private key; `keyless: true` signs with an OIDC token, as
 * `attest` does. `noAttestations` pushes only the holo's manifest.
 *
 * @param {Uint8Array | ArrayBuffer | string} source the holo's bytes, a path, or a `dir://` reference
 * @param {string | object} target the reference
 * @param {object} [options] `{ store, key, keyless, noAttestations, signingConfig, identityToken, tufMirrorUrl, tufRoot, tufCache, plainHttp, credentials, fetch, env, referrersFallback, onProgress }`
 * @returns {Promise<object>} `prism/push-result/1`
 */
export async function experimental_push(source, target, options = {}) {
  const reference = referenceOf(target, options);
  if (reference.fingerprint) throw new ReferenceInvalidError('a push cannot name a BLAKE3 fingerprint: the fingerprint comes from the holo', { check: 'reference.digest' });
  const { holo, carried, carriedFor } = await readSource(source, options);
  const progress = options.onProgress ?? (() => {});

  // Step 1: nothing corrupt leaves this machine, as verify judges it.
  const { parsed, attestations } = verifyOutgoing(holo);

  const built = await holoManifest(parsed);
  const { digest, bytes: manifestBytes, descriptor, layer, fingerprint } = built;
  if (reference.digest && reference.digest !== digest) {
    throw new DigestMismatchError(`the reference names ${reference.digest}, and this holo's manifest is ${digest}`, { check: 'digest.push' });
  }

  const endpoint = openEndpoint(reference, options);
  // Step 2 and 3: the blobs, then the manifest by digest.
  await endpoint.putBlob(EMPTY_DESCRIPTOR.digest, EMPTY_BYTES);
  const uploaded = await endpoint.putBlob(layer.digest, holo);
  progress({ action: uploaded ? 'Pushed' : 'Layer already exists', digest: layer.digest });
  await endpoint.putManifest(digest, manifestBytes);

  // Step 4: the referrers.
  const referrers = [];
  const pending = [];
  if (!options.noAttestations) {
    for (const attestation of attestations) {
      const { manifest, bytes, digest: referrerDigest, layer: bundleLayer, descriptor: bundleDescriptor } = await referrerManifest(attestation.bytes, descriptor, attestation.predicateType);
      pending.push({ manifest, manifestBytes: bytes, digest: referrerDigest, layer: bundleLayer, line: attestation.bytes, descriptor: bundleDescriptor });
      referrers.push({ digest: referrerDigest, predicateType: attestation.predicateType, source: 'holo', signed: attestation.signed });
    }
    if (options.key !== undefined || options.keyless) {
      const signer = auth.identities.from({ key: options.key, identityToken: options.identityToken ?? (options.env?.SIGSTORE_ID_TOKEN || undefined), signingConfig: options.signingConfig, tufMirrorUrl: options.tufMirrorUrl, tufRoot: options.tufRoot, tufCache: options.tufCache });
      for (const statement of registryStatements(attestations, digest)) {
        const signed = await signer.sign(encoder.encode(JSON.stringify(statement)));
        const line = encoder.encode(JSON.stringify(signed));
        const { manifest, bytes, digest: referrerDigest, layer: bundleLayer, descriptor: bundleDescriptor } = await referrerManifest(line, descriptor, statement.predicateType);
        pending.push({ manifest, manifestBytes: bytes, digest: referrerDigest, layer: bundleLayer, line, descriptor: bundleDescriptor });
        referrers.push({ digest: referrerDigest, predicateType: statement.predicateType, source: 'push', signed: true });
      }
    }
    // What a store already held for this manifest travels with it, bytes unchanged.
    const known = new Set(pending.map((p) => p.digest));
    if (carriedFor === digest) {
      for (const referrer of carried) {
        if (known.has(referrer.digest)) continue;
        known.add(referrer.digest);
        pending.push(referrer);
        referrers.push({ digest: referrer.digest, predicateType: referrer.manifest.annotations?.[ANNOTATION.BUNDLE_PREDICATE] ?? null, source: 'store', signed: true });
      }
    }
    await writeReferrers(endpoint, digest, pending);
    for (const { digest: referrerDigest, predicateType, source: from } of referrers) progress({ action: from === 'push' ? 'Signed' : 'Attached', digest: referrerDigest, predicateType });
  }

  // Step 5: the tags, last, so a tag never names a holo whose attestations are on the way.
  const tags = [];
  if (reference.tag && !reference.digest) tags.push(reference.tag);
  // A legacy v4 holo gets a tag for its BLAKE3 fingerprint; a holo v5 is already addressed by its κ, the layer digest.
  if (reference.kind === 'registry' && fingerprint.startsWith('blake3:')) tags.push(fingerprintTag(fingerprint));
  for (const tag of tags) await endpoint.tagManifest(tag, manifestBytes);

  return {
    schema: PUSH_SCHEMA,
    reference: formatReference(reference, digest),
    repository: reference.kind === 'registry' ? `${reference.registry}/${reference.repository}` : reference.repository ?? `dir://${reference.path}`,
    tag: reference.digest ? null : reference.tag,
    digest,
    mediaType: MANIFEST_MEDIA_TYPE,
    size: manifestBytes.length,
    layer: { digest: layer.digest, size: layer.size, uploaded },
    fingerprint,
    sha256: hexOf(layer.digest),
    blake3: blake3Hex(holo),
    tags,
    referrers,
  };
}

export { short as shortDigest };
