/**
 * Lean's kernel with its library already loaded, kept as an image of its
 * linear memory, so a page that judges a new guarantee does not load and check
 * the library again.
 *
 * Loading the library is a function of the loader, the kernel and the library
 * alone, and leaves everything the kernel knows in its linear memory. An image
 * taken right after a load that the kernel accepted, and laid over a fresh
 * instance of the same kernel, is that kernel with that library. The image is
 * kept by κ-label and found by a derivation key over the loader, the kernel and
 * the library; it stands in for the load only when `reuseAdmits` allows it,
 * the rule Lean proves for every stored result (`model/rule-app`): the same
 * key, kernel and library, and bytes that re-derive to their label.
 *
 * The image is the memory in 4 KiB blocks, with the blocks that are all zero
 * left out: about 15 MB for a 64 MiB memory.
 */
import { isKappa } from '../uorc.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const IMAGE_SCHEMA = 'prism/kernel-image/1';
const MAGIC = enc.encode(`${IMAGE_SCHEMA}\n`);
const BLOCK = 4096;

/** The image of `memory` (bytes): a header, the index of every block that is not all zero, then those blocks. */
export function encodeImage(memory) {
  const kept = [];
  for (let at = 0; at < memory.length; at += BLOCK) {
    const end = Math.min(memory.length, at + BLOCK);
    for (let i = at; i < end; i++) {
      if (memory[i] !== 0) {
        kept.push(at / BLOCK);
        break;
      }
    }
  }
  const head = MAGIC.length + 12 + kept.length * 4;
  const out = new Uint8Array(head + kept.length * BLOCK);
  out.set(MAGIC, 0);
  const view = new DataView(out.buffer);
  view.setUint32(MAGIC.length, memory.length, true);
  view.setUint32(MAGIC.length + 4, BLOCK, true);
  view.setUint32(MAGIC.length + 8, kept.length, true);
  kept.forEach((block, i) => {
    view.setUint32(MAGIC.length + 12 + i * 4, block, true);
    const from = block * BLOCK;
    out.set(memory.subarray(from, Math.min(memory.length, from + BLOCK)), head + i * BLOCK);
  });
  return out;
}

/** The image read back: `{ length, blocks: [[index, bytes]] }`, or null for bytes that are not one exactly. */
export function decodeImage(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < MAGIC.length + 12) return null;
  for (let i = 0; i < MAGIC.length; i++) if (bytes[i] !== MAGIC[i]) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(MAGIC.length, true);
  const block = view.getUint32(MAGIC.length + 4, true);
  const count = view.getUint32(MAGIC.length + 8, true);
  const head = MAGIC.length + 12 + count * 4;
  if (block !== BLOCK || length % BLOCK !== 0 || bytes.length !== head + count * BLOCK) return null;
  const blocks = [];
  let last = -1;
  for (let i = 0; i < count; i++) {
    const index = view.getUint32(MAGIC.length + 12 + i * 4, true);
    // Strictly increasing and inside the memory: one image has one reading.
    if (index <= last || (index + 1) * BLOCK > length) return null;
    last = index;
    blocks.push([index, bytes.subarray(head + i * BLOCK, head + (i + 1) * BLOCK)]);
  }
  return { length, blocks };
}

/**
 * Lay an image over a fresh kernel's memory. `grow(n)` makes the memory at least `n` bytes through the kernel's own
 * allocator, so its views follow; `memory()` returns the memory as it is then. Every byte is written: the image's
 * blocks, and zero everywhere else. Returns false, writing nothing, for bytes that are not an image.
 */
export function restoreImage(bytes, { memory, grow }) {
  const image = decodeImage(bytes);
  if (!image) return false;
  if (memory().buffer.byteLength < image.length) grow(image.length - memory().buffer.byteLength);
  const target = new Uint8Array(memory().buffer);
  if (target.length < image.length) return false;
  target.fill(0);
  for (const [index, block] of image.blocks) target.set(block, index * BLOCK);
  return true;
}

/** The canonical bytes of a kept image: it names its key and every input by κ-label, in one fixed order. */
export function imageRealization({ key, loader, kernel, library, image }) {
  return enc.encode(`${JSON.stringify({ schema: IMAGE_SCHEMA, key, loader, kernel, library, image })}\n`);
}

/**
 * What `reuseAdmits` decides on, from what a store returned: the realization found under the key (or null), and
 * `read(label)`, which resolves the bytes a store holds under a label and the label those bytes re-derive to, or
 * null. Resolves `{ facts, image }`, the image's bytes as read. Nothing here decides.
 */
export async function imageFacts({ key, kernel, library }, bytes, read) {
  const absent = { facts: { present: 0, storedKey: '', computedKey: key, storedKernel: '', kernelPinned: kernel, storedLibrary: '', libraryPinned: library, storedBytes: '', derivedBytes: '' }, image: null };
  if (!bytes) return absent;
  let kept;
  try {
    kept = JSON.parse(dec.decode(bytes));
  } catch {
    return absent;
  }
  if (kept?.schema !== IMAGE_SCHEMA || ![kept.key, kept.loader, kept.kernel, kept.library, kept.image].every(isKappa)) return absent;
  const found = await read(kept.image);
  return {
    facts: {
      present: 1,
      storedKey: kept.key,
      computedKey: key,
      storedKernel: kept.kernel,
      kernelPinned: kernel,
      storedLibrary: kept.library,
      libraryPinned: library,
      storedBytes: kept.image,
      // What the image's bytes are now, not what the realization says they were.
      derivedBytes: found ? found.label : '',
    },
    image: found ? found.bytes : null,
  };
}
