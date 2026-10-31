/**
 * The local directory store of `push` and `pull`: an OCI image layout (issue
 * #292, docs/proposals/292-push-pull-oci.md). Node only. It implements the same
 * endpoint as the registry client, so everything above works on either.
 *
 *   oci-layout            {"imageLayoutVersion":"1.0.0"}
 *   index.json            every manifest, as descriptors
 *   blobs/sha256/<hex>    manifests, configs and layers
 *
 * A tagged manifest carries `org.opencontainers.image.ref.name` (the tag) and,
 * when it has one, `io.containerd.image.name` (the full name), as `docker save`
 * writes them. Referrers are untagged descriptors: a layout has no referrers
 * API, and tools build the graph from `index.json`. Moving a tag leaves the old
 * manifest listed, so its digest still resolves, as it does in a registry.
 *
 * Every read recomputes `sha256`. Every write is a temporary file and a rename,
 * and `index.json` is replaced last, so an interrupted write loses nothing.
 */
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { DigestMismatchError, ManifestNotFoundError, RegistryError } from './errors.mjs';
import { ANNOTATION, canonicalBytes, digestOf, hexOf, INDEX_MEDIA_TYPE, MANIFEST_MEDIA_TYPE, referrerDescriptor } from './oci-manifest.mjs';

const LAYOUT = { imageLayoutVersion: '1.0.0' };
let sequence = 0;

async function writeAtomic(target, bytes) {
  const scratch = `${target}.${process.pid}.${sequence++}.tmp`;
  try {
    await writeFile(scratch, bytes);
    await rename(scratch, target);
  } finally {
    await rm(scratch, { force: true });
  }
}

const refName = (descriptor) => descriptor.annotations?.[ANNOTATION.REF_NAME] ?? null;
const imageName = (descriptor) => descriptor.annotations?.[ANNOTATION.IMAGE_NAME] ?? null;

/** Tagged descriptors first, by name and then tag; the rest by digest. The file does not depend on the order of writes. */
function sortDescriptors(manifests) {
  const key = (d) => [refName(d) === null ? 1 : 0, imageName(d) ?? '', refName(d) ?? '', d.digest].join('\0');
  return [...manifests].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}

const asText = (bytes, what) => {
  try {
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch (cause) {
    throw new RegistryError(`${what} is not JSON: ${cause.message}`, { check: 'store.layout', cause });
  }
};

/**
 * Open a store. The directory is created on the first write, not here, so a pull
 * from a mistyped path leaves nothing behind.
 *
 * @param {string} path
 * @param {{ repository?: string | null }} [options] the name this endpoint reads and writes tags under
 */
export function openStore(path, options = {}) {
  const root = resolve(path);
  const repository = options.repository ?? null;
  const blobPath = (digest) => join(root, 'blobs', 'sha256', hexOf(digest));

  const readIndex = async () => {
    let bytes;
    try {
      bytes = await readFile(join(root, 'index.json'));
    } catch (cause) {
      if (cause.code === 'ENOENT') return { schemaVersion: 2, mediaType: INDEX_MEDIA_TYPE, manifests: [] };
      throw new RegistryError(`the store ${root} cannot be read: ${cause.message}`, { check: 'store.layout', cause });
    }
    const index = asText(bytes, `${join(root, 'index.json')}`);
    if (!Array.isArray(index?.manifests)) throw new RegistryError(`${join(root, 'index.json')} is not an OCI index`, { check: 'store.layout' });
    return index;
  };

  const ensureLayout = async () => {
    await mkdir(join(root, 'blobs', 'sha256'), { recursive: true });
    const marker = join(root, 'oci-layout');
    const existing = await readFile(marker).catch((cause) => {
      if (cause.code === 'ENOENT') return null;
      throw cause;
    });
    if (existing === null) await writeAtomic(marker, canonicalBytes(LAYOUT));
    else if (asText(existing, marker)?.imageLayoutVersion !== LAYOUT.imageLayoutVersion) throw new RegistryError(`${marker} is not an OCI layout this store can write`, { check: 'store.layout' });
  };

  const writeIndex = async (index) => {
    await writeAtomic(join(root, 'index.json'), canonicalBytes({ ...index, manifests: sortDescriptors(index.manifests) }));
  };

  const matchesName = (descriptor, tag) => {
    if (refName(descriptor) !== tag) return false;
    if (repository === null) return true;
    return imageName(descriptor) === `${repository}:${tag}`;
  };

  /** The one descriptor a tag names. `dir://store:v1` with two names under the tag is ambiguous, not a guess. */
  const findTag = async (tag) => {
    const { manifests } = await readIndex();
    const found = manifests.filter((d) => matchesName(d, tag));
    if (found.length > 1) throw new RegistryError(`the tag ${tag} is on ${found.map((d) => imageName(d) ?? d.digest).join(' and ')}; name one with --store and its full name, or use its digest`, { check: 'store.ambiguous' });
    return found[0] ?? null;
  };

  const store = {
    kind: 'store',
    root,
    repository,

    async hasBlob(digest) {
      return stat(blobPath(digest)).then(() => true, () => false);
    },

    /** Write one blob, content-addressed. Returns false when the store already had it. */
    async putBlob(digest, bytes) {
      const actual = await digestOf(bytes);
      if (actual !== digest) throw new DigestMismatchError(`blob ${digest} has the digest ${actual}`, { check: 'digest.blob' });
      await ensureLayout();
      if (await store.hasBlob(digest)) return false;
      await writeAtomic(blobPath(digest), bytes);
      return true;
    },

    async getBlob(digest, size = undefined) {
      let bytes;
      try {
        bytes = new Uint8Array(await readFile(blobPath(digest)));
      } catch (cause) {
        if (cause.code === 'ENOENT') throw new RegistryError(`blob ${digest} is missing from the store ${root}`, { check: 'store.blob', cause });
        throw cause;
      }
      if (size !== undefined && bytes.length !== size) throw new DigestMismatchError(`blob ${digest} is ${bytes.length} bytes in the store, its descriptor says ${size}`, { check: 'digest.blob' });
      const actual = await digestOf(bytes);
      if (actual !== digest) throw new DigestMismatchError(`blob ${digest} in the store has the digest ${actual}`, { check: 'digest.blob' });
      return bytes;
    },

    /** Store a manifest and list it, untagged unless `reference` is a tag. A store always indexes `subject`. */
    async putManifest(reference, bytes, mediaType = MANIFEST_MEDIA_TYPE) {
      const digest = await digestOf(bytes);
      if (reference.startsWith('sha256:') && reference !== digest) throw new DigestMismatchError(`manifest ${reference} has the digest ${digest}`, { check: 'digest.manifest' });
      await store.putBlob(digest, bytes);
      const manifest = asText(bytes, `manifest ${digest}`);
      const index = await readIndex();
      if (!index.manifests.some((d) => d.digest === digest)) {
        const annotations = manifest.subject ? {} : { annotations: fingerprintAnnotation(manifest) };
        const descriptor = manifest.subject ? referrerDescriptor(manifest, digest, bytes.length) : { mediaType, digest, size: bytes.length, ...annotations };
        index.manifests.push(descriptor);
        await writeIndex(index);
      }
      return { digest, indexed: true };
    },

    async getManifest(reference) {
      let digest = reference;
      let size;
      if (!reference.startsWith('sha256:')) {
        const found = await findTag(reference);
        if (!found) throw new ManifestNotFoundError(`no manifest is tagged ${reference} in the store ${root}`, { check: 'store.reference' });
        ({ digest, size } = found);
      } else if (!(await store.hasBlob(digest))) {
        throw new ManifestNotFoundError(`manifest ${reference} is not in the store ${root}`, { check: 'store.reference' });
      }
      return { bytes: await store.getBlob(digest, size), digest, mediaType: MANIFEST_MEDIA_TYPE };
    },

    /** Move a tag onto a stored manifest. Its old manifest stays listed, untagged. */
    async tagManifest(tag, bytes) {
      const digest = await digestOf(bytes);
      await store.putManifest(digest, bytes);
      const index = await readIndex();
      const manifest = asText(bytes, `manifest ${digest}`);
      const annotations = { ...fingerprintAnnotation(manifest), [ANNOTATION.REF_NAME]: tag };
      if (repository !== null) annotations[ANNOTATION.IMAGE_NAME] = `${repository}:${tag}`;
      const others = index.manifests.filter((d) => d.digest !== digest).map((d) => {
        if (!matchesName(d, tag) || (repository === null && imageName(d) !== null)) return d;
        const { [ANNOTATION.REF_NAME]: _tag, [ANNOTATION.IMAGE_NAME]: _name, ...rest } = d.annotations;
        return { ...d, annotations: rest };
      });
      // One manifest may carry several tags: each is its own descriptor, as in `docker save`.
      const same = index.manifests.filter((d) => d.digest === digest && refName(d) !== null && !matchesName(d, tag));
      index.manifests = [...others, ...same, { mediaType: MANIFEST_MEDIA_TYPE, digest, size: bytes.length, annotations }];
      await writeIndex(index);
      return { digest, indexed: true };
    },

    /** Every referrer of a manifest: the untagged descriptors whose manifest's `subject` names it. */
    async listReferrers(digest) {
      const { manifests } = await readIndex();
      const found = [];
      for (const descriptor of manifests) {
        if (!descriptor.artifactType || descriptor.digest === digest) continue;
        const manifest = asText(await store.getBlob(descriptor.digest, descriptor.size), `manifest ${descriptor.digest}`);
        if (manifest.subject?.digest === digest) found.push(descriptor);
      }
      return found;
    },

    /** A store indexes referrers as it stores them, so there is nothing to attach. */
    async attachReferrers() {},

    /** The manifest digest of a fingerprint, from `index.json`. The bytes are verified later, as for any address. */
    async resolveFingerprint(fingerprint) {
      const { manifests } = await readIndex();
      const found = manifests.find((d) => d.annotations?.[ANNOTATION.FINGERPRINT] === fingerprint);
      if (!found) throw new ManifestNotFoundError(`no holo has the fingerprint ${fingerprint} in the store ${root}`, { check: 'store.reference' });
      return found.digest;
    },

    /** Every tagged holo in the store, for `images` (#349). */
    async list() {
      const { manifests } = await readIndex();
      return manifests.filter((d) => refName(d) !== null).map((d) => ({
        name: imageName(d) ?? refName(d),
        tag: refName(d),
        digest: d.digest,
        size: d.size,
        fingerprint: d.annotations?.[ANNOTATION.FINGERPRINT] ?? null,
      }));
    },
  };
  return store;
}

function fingerprintAnnotation(manifest) {
  const fingerprint = manifest?.annotations?.[ANNOTATION.FINGERPRINT];
  return typeof fingerprint === 'string' ? { [ANNOTATION.FINGERPRINT]: fingerprint } : {};
}
