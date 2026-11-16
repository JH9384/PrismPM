/**
 * What a holo says about the spec it was built from.
 *
 * `prism/spec.json` is an app's one input, and its UOR content address — the
 * kappa of its canonical bytes, the same `blake3:<hex>` a holo labels its own
 * blobs with — is the seal. The model the spec renders to carries that address
 * (render.mjs, `SPEC_SEAL_MARK`), so it sits inside the holo's model blob,
 * whose label is that blob's kappa and whose bytes the footer covers. Changing
 * the seal changes the holo, and the integrity check refuses it.
 *
 * So an app verifies itself against its spec with nothing else in hand: read
 * the address it carries, take the address of the spec.json beside it, and
 * compare. `checkSpecBinding` does both and names which of the three cases it
 * found, so a caller can refuse.
 *
 * What this is not: the holo does not yet carry `spec.json` itself, so a holo
 * whose seal matches is one built from that spec, not one the spec can be read
 * out of. The spec belongs in a blob of its own, labelled with exactly this
 * address; that is the Rust builder's to add.
 */
import { parseArchive } from '../archive.mjs';
import { SPEC_SEAL_MARK } from './render.mjs';
import { readSpecFile } from './spec-file.mjs';

/** The model document a holo carries, or null when it has none that parses. */
export function modelDocument(parsed) {
  for (const blob of parsed.blobs) {
    try {
      const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(blob.content));
      if (value?.application) return value;
    } catch {
      // Not the model blob: the guest is WebAssembly and the view is HTML.
    }
  }
  return null;
}

/** The spec address a holo carries, or null when it carries none. Takes the archive's bytes, or an archive already parsed. */
export function specAddressOf(holo) {
  const model = modelDocument(ArrayBuffer.isView(holo) || holo instanceof ArrayBuffer ? parseArchive(holo) : holo);
  const described = model?.application?.cargo_description;
  return (typeof described === 'string' && SPEC_SEAL_MARK.exec(described)?.[1]) || null;
}

/**
 * Hold a holo to a spec. Returns `{ ok, reason, specAddress, sealed }`:
 *
 * - `bound`: the holo's seal is the address of this spec. The app matches the
 *   JSON it was built from.
 * - `unbound`: the holo carries no seal, so nothing ties it to a spec. A holo
 *   built before the seal, or by another route, reads this way.
 * - `mismatch`: the holo was built from another spec.
 */
export function checkSpecBinding(holo, spec) {
  const specAddress = readSpecFile(spec).specAddress;
  const sealed = specAddressOf(holo);
  if (sealed === null) {
    return { ok: false, reason: 'unbound', specAddress, sealed, message: 'The holo carries no spec seal: nothing in it says which prism/spec.json it was built from. Build it again from a spec with this version of Prism.' };
  }
  if (sealed !== specAddress) {
    return { ok: false, reason: 'mismatch', specAddress, sealed, message: `The holo was built from another spec: its seal is ${sealed}, and this spec.json is ${specAddress}.` };
  }
  return { ok: true, reason: 'bound', specAddress, sealed, message: `The holo matches this spec, ${specAddress}.` };
}
