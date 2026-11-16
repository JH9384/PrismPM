/**
 * Prism's content-addressed store in a browser: the origin's private file
 * system, laid out as `kappa-store.mjs` lays out a disk, so a page keeps what
 * it has already fetched and proved and does not do it again on the next visit.
 *
 * Every read re-derives the κ-label, so bytes that are not what their name says
 * are not returned, and reuse is decided by `kappa-rules.mjs` alone. What is
 * stored is what this origin's own pages wrote: the store is trusted no further
 * than the origin that serves the page's code.
 */
import { sha256Hex } from '../sha256.mjs';
import { isKappa } from '../uorc.mjs';
import { proofFacts, proofRealization } from './kappa-rules.mjs';
import { imageFacts, imageRealization } from './kernel-image.mjs';

const enc = new TextEncoder();
const label = async (bytes) => `sha256:${await sha256Hex(bytes)}`;

/**
 * The store, or one that keeps nothing where the browser has no origin-private file system or refuses it
 * (a private window, a blocked site). Every method resolves; none throws. `get` resolves bytes only when
 * they re-derive to the label asked for.
 */
export async function opfsStore({ root = null } = {}) {
  let top = root;
  try {
    top ??= await (await navigator.storage.getDirectory()).getDirectoryHandle('prism-kappa', { create: true });
  } catch {
    top = null;
  }
  const off = top === null;
  const dirOf = async (kind, name, create) => {
    const k = await top.getDirectoryHandle(kind, { create });
    return k.getDirectoryHandle(name.slice(7, 9), { create });
  };
  const read = async (kind, name) => {
    try {
      const file = await (await (await dirOf(kind, name, false)).getFileHandle(name.slice(9))).getFile();
      return new Uint8Array(await file.arrayBuffer());
    } catch {
      return null;
    }
  };
  const write = async (kind, name, bytes) => {
    try {
      const handle = await (await dirOf(kind, name, true)).getFileHandle(name.slice(9), { create: true });
      // A writable stream replaces the file only on close, so a reader never sees half of it.
      const stream = await handle.createWritable();
      await stream.write(bytes);
      await stream.close();
    } catch {
      // A store that cannot keep something has not kept it; the next visit does the work again.
    }
  };
  return {
    off,
    async put(bytes) {
      const name = await label(bytes);
      if (!off) await write('bytes', name, bytes);
      return name;
    },
    async get(name) {
      if (off || !isKappa(name)) return null;
      const bytes = await read('bytes', name);
      // The universal check under every stored byte: bytes that are not what their name says are not there.
      return bytes && (await label(bytes)) === name ? bytes : null;
    },
    async bind(key, name) {
      if (!off) await write('derived', key, enc.encode(name));
    },
    async bound(key) {
      if (off || !isKappa(key)) return null;
      const bytes = await read('derived', key);
      const name = bytes ? new TextDecoder().decode(bytes) : '';
      return isKappa(name) ? name : null;
    },
  };
}

/** Keep an accepted proof: its bytes, its realization, and the key that leads to it. Resolves the realization's κ-label. */
export async function keepProof(store, { key, kernel, library, statement, text, axioms }) {
  const bundle = await store.put(enc.encode(text));
  const name = await store.put(proofRealization({ key, kernel, library, statement, bundle, axioms }));
  await store.bind(key, name);
  return name;
}

/** Look a proof up by its derivation key. Resolves `{ facts, proof, text }`, as `kappa-store.mjs` does; the caller asks the rule. */
export async function findProof(store, { key, kernel, library }) {
  const name = await store.bound(key);
  const bytes = name ? await store.get(name) : null;
  let bundle = null;
  if (bytes) {
    try {
      const named = JSON.parse(new TextDecoder().decode(bytes)).bundle;
      bundle = isKappa(named) ? await store.get(named) : null;
    } catch {
      bundle = null;
    }
  }
  return proofFacts({ key, kernel, library }, bytes, () => bundle);
}

/** Keep the image of a kernel that loaded its library: the image, its realization, and the key that leads to it. */
export async function keepImage(store, { key, loader, kernel, library, bytes }) {
  const image = await store.put(bytes);
  const name = await store.put(imageRealization({ key, loader, kernel, library, image }));
  await store.bind(key, name);
  return name;
}

/** Look an image up by its derivation key. Resolves `{ facts, image }`; the caller asks `reuseAdmits`. */
export async function findImage(store, { key, kernel, library }) {
  const name = await store.bound(key);
  const bytes = name ? await store.get(name) : null;
  // `get` returns bytes only when they re-derive to the label asked for, so the label is what the bytes are now.
  return imageFacts({ key, kernel, library }, bytes, async (label) => {
    const image = await store.get(label);
    return image ? { bytes: image, label } : null;
  });
}
