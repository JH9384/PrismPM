/**
 * The rules of Prism's content-addressed store that hold wherever it runs: the
 * derivation key, the reuse rule, and a proof's canonical bytes. Nothing here
 * reads or writes; `kappa-store.mjs` keeps bytes on disk for Node and
 * `kappa-opfs.mjs` in a browser's origin-private file system, and both decide
 * reuse with these same functions.
 */
import { sha256HexSync } from '../sha256.mjs';
import { isKappa, kappa } from '../uorc.mjs';

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const PROOF_SCHEMA = 'prism/kernel-proof/1';

/** The key of a derivation: a domain and its operands' κ-labels, in order, each framed by its length. `f(A, B)` is not `f(B, A)`. */
export function derivationKey(domain, operands) {
  for (const operand of operands) if (!isKappa(operand)) throw new Error(`${operand} is not a κ-label`);
  const parts = [domain, ...operands].map((part) => enc.encode(part));
  const bytes = new Uint8Array(parts.reduce((n, part) => n + 4 + part.length, 0));
  const view = new DataView(bytes.buffer);
  let at = 0;
  for (const part of parts) {
    view.setUint32(at, part.length, true);
    bytes.set(part, at + 4);
    at += 4 + part.length;
  }
  return kappa(bytes);
}

/** The statement one guarantee's proof is about: the spec's numbers and that guarantee, and nothing of where it sits. */
export const guaranteeStatement = (words, guarantee) => `sha256:${sha256HexSync(enc.encode(JSON.stringify(['prism/kernel-guarantee/1', words, guarantee])))}`;

// ---- The reuse rule (RuleApp.lex.tex, `reuseAdmits`), one for one. ----

/** Whether a stored proof may stand in for running the kernel: only under the same key, kernel, library and proof bytes. */
export const reuseAdmits = (s) => s.present === 1 && s.storedKey === s.computedKey && s.storedKernel === s.kernelPinned && s.storedLibrary === s.libraryPinned && s.storedBytes === s.derivedBytes;

/** The canonical bytes of an accepted proof: it names its key and every input by κ-label, in one fixed order. */
export function proofRealization({ key, kernel, library, statement, bundle, axioms }) {
  return enc.encode(`${JSON.stringify({ schema: PROOF_SCHEMA, key, kernel, library, statement, bundle, axioms: [...axioms].sort() })}\n`);
}

/** The κ-labels a proof's canonical bytes name: what it depends on, read back out of it. */
export function proofReferences(bytes) {
  const proof = JSON.parse(dec.decode(bytes));
  return [proof.kernel, proof.library, proof.statement, proof.bundle];
}

/**
 * What `reuseAdmits` decides on, from what a store returned: the realization's bytes found under the key (or null)
 * and the bytes found under the proof's bundle label (or null). Resolves `{ facts, proof, text }`. Nothing here decides.
 */
export function proofFacts({ key, kernel, library }, bytes, readBundle) {
  const absent = { facts: { present: 0, storedKey: '', computedKey: key, storedKernel: '', kernelPinned: kernel, storedLibrary: '', libraryPinned: library, storedBytes: '', derivedBytes: '' }, proof: null, text: null };
  if (!bytes) return absent;
  let proof;
  try {
    proof = JSON.parse(dec.decode(bytes));
  } catch {
    return absent;
  }
  if (proof?.schema !== PROOF_SCHEMA || !Array.isArray(proof.axioms) || ![proof.key, proof.kernel, proof.library, proof.statement, proof.bundle].every(isKappa)) return absent;
  const bundle = readBundle(proof.bundle);
  const facts = {
    present: 1,
    storedKey: proof.key,
    computedKey: key,
    storedKernel: proof.kernel,
    kernelPinned: kernel,
    storedLibrary: proof.library,
    libraryPinned: library,
    storedBytes: proof.bundle,
    // What the proof's bytes are now, not what the record says they were.
    derivedBytes: bundle ? kappa(bundle) : '',
  };
  return { facts, proof, text: bundle ? dec.decode(bundle) : null };
}
