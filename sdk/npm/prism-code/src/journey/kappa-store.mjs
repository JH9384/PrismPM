/**
 * A content-addressed store for what Prism has already worked out, so the same
 * work is never done twice: on this machine, across apps, across versions.
 *
 * It follows Hologram's substrate (Hologram-Technologies/hologram,
 * `hologram-space/src/substrate.rs`) in the three things that matter:
 *
 * - Bytes are named by their κ-label (`kappa`, the uor-addr label prism-code
 *   already gives a holo's blobs), and every read re-derives the label. Bytes
 *   that do not re-derive are not returned.
 * - A result names its inputs by κ-label inside its own canonical bytes, so
 *   what it depends on can be read back out of it.
 * - A derivation key is taken over a domain tag and the operands' labels, in
 *   order, each framed by its length, so no two different derivations share one.
 *
 * Whether a stored proof may be reused is `reuseAdmits`, stated in LexLean and
 * proved by Lean (`model/rule-app`): only under the same key, kernel, library
 * and proof bytes. The store is trusted no further than that rule.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { prismHome } from '../agents.mjs';
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

/** Where the store keeps its bytes. `PRISM_KAPPA_DIR` names another place; `PRISM_KAPPA=0` keeps nothing. */
export const kappaDirectory = (env = process.env) => env.PRISM_KAPPA_DIR || join(prismHome(env), 'kappa');

/**
 * The store. `put` returns the bytes' κ-label; `get` returns bytes only when
 * they re-derive to the label asked for; `bind` and `bound` keep which result
 * a derivation key led to. A store that is off answers nothing and keeps nothing.
 */
export function kappaStore({ env = process.env } = {}) {
  const off = env.PRISM_KAPPA === '0';
  const directory = kappaDirectory(env);
  const fileOf = (kind, label) => join(directory, kind, label.slice(7, 9), label.slice(9));
  const write = (file, bytes) => {
    mkdirSync(join(file, '..'), { recursive: true });
    // Moved into place, so a reader never sees half a file. A name already taken holds the same bytes.
    const partial = `${file}.${process.pid}.partial`;
    writeFileSync(partial, bytes);
    try {
      renameSync(partial, file);
    } catch (error) {
      if (!existsSync(file)) throw error;
    }
  };
  return {
    directory,
    off,
    put(bytes) {
      const label = kappa(bytes);
      if (!off && !existsSync(fileOf('bytes', label))) write(fileOf('bytes', label), bytes);
      return label;
    },
    get(label) {
      if (off || !isKappa(label) || !existsSync(fileOf('bytes', label))) return null;
      const bytes = new Uint8Array(readFileSync(fileOf('bytes', label)));
      // The universal check under every stored byte: bytes that are not what their name says are not there.
      return kappa(bytes) === label ? bytes : null;
    },
    bind(key, label) {
      if (!off) write(fileOf('derived', key), enc.encode(label));
    },
    bound(key) {
      if (off || !isKappa(key) || !existsSync(fileOf('derived', key))) return null;
      const label = readFileSync(fileOf('derived', key), 'utf8');
      return isKappa(label) ? label : null;
    },
  };
}

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

/** Keep an accepted proof: its bytes, its realization, and the key that leads to it. Returns the realization's κ-label. */
export function keepProof(store, { key, kernel, library, statement, text, axioms }) {
  const bundle = store.put(enc.encode(text));
  const label = store.put(proofRealization({ key, kernel, library, statement, bundle, axioms }));
  store.bind(key, label);
  return label;
}

/**
 * Look a proof up by its derivation key. Resolves `{ facts, proof, text }`:
 * `facts` is what `reuseAdmits` decides on, and `text` the proof's own bytes
 * as read, when there are any. Nothing here decides; the caller asks the rule.
 */
export function findProof(store, { key, kernel, library }) {
  const absent = { present: 0, storedKey: '', computedKey: key, storedKernel: '', kernelPinned: kernel, storedLibrary: '', libraryPinned: library, storedBytes: '', derivedBytes: '' };
  const label = store.bound(key);
  const bytes = label ? store.get(label) : null;
  if (!bytes) return { facts: absent, proof: null, text: null };
  let proof;
  try {
    proof = JSON.parse(dec.decode(bytes));
  } catch {
    return { facts: absent, proof: null, text: null };
  }
  if (proof?.schema !== PROOF_SCHEMA || !Array.isArray(proof.axioms) || ![proof.key, proof.kernel, proof.library, proof.statement, proof.bundle].every(isKappa)) return { facts: absent, proof: null, text: null };
  const bundle = store.get(proof.bundle);
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
