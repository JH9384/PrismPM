/**
 * The verdict on a kernel check, given by a verified guest and not by this code.
 *
 * The pinned Forge kernel holo carries `InTabKernel.verdictCode`, stated in
 * LexLean and proved by Lean in UOR-Foundation/foundry (`app/src/InTabKernel.lex.tex`
 * and its proofs): no acceptance under another kernel, another library, another
 * statement, or axioms outside the declared set. This module only writes what
 * was pinned and what was derived, whole, and reads the guest's answer back.
 * It never states that two addresses agree: both are sent and the guest compares them.
 */
import { loadArchive } from '../index.mjs';

const ADDRESSES = ['libraryPinned', 'libraryDerived', 'bundleNamed', 'bundleDerived', 'kernelPinned', 'kernelDerived', 'specStatement', 'checkedStatement'];
const FLAGS = ['hasBytes', 'leanRan', 'leanAccepted', 'secondRan', 'secondAccepted'];
const ORDER = ['version', 'hasBytes', ...ADDRESSES, 'axiomsDeclared', 'axiomsObserved', 'leanRan', 'leanAccepted', 'secondRan', 'secondAccepted'];
const ERRORS = new Set(['malformedVerdictRequest', 'verdictRequestTooLarge']);
/** The guest's words, by code. Only the first two accept. */
export const VERDICTS = Object.freeze(['proved', 'kernel-checked', 'checking', 'refused']);
const ALLOWED = new Map([['propext', 1], ['Classical.choice', 2], ['Quot.sound', 4]]);

const fail = () => {
  throw Object.assign(new Error('Invalid verdict request'), { code: 'malformedVerdictRequest' });
};
const uint = (n) => (Number.isInteger(n) && n >= 0 && n <= 0xffffffff ? n : fail());
const flag = (n) => (n === 0 || n === 1 ? n : fail());
const hex = (words) => {
  const bytes = new Uint8Array(words.length * 4);
  const view = new DataView(bytes.buffer);
  words.forEach((n, i) => view.setUint32(i * 4, uint(n), true));
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
};

/** A SHA-256 address as the eight words the wire carries, all 256 bits. */
export function addressWords(value) {
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/.test(value)) fail();
  const bytes = Uint8Array.from(value.slice(7).match(/../g), (s) => parseInt(s, 16));
  const view = new DataView(bytes.buffer);
  return Array.from({ length: 8 }, (_, i) => view.getUint32(i * 4, true));
}

/** A set of axiom names as the wire's bit set. An axiom outside the three Lean admits sets 8, which the model refuses. */
export function axiomSet(names) {
  if (!Array.isArray(names) || names.some((n) => typeof n !== 'string')) fail();
  return names.reduce((set, n) => set | (ALLOWED.get(n) ?? 8), 0);
}

export function encodeVerdictRequest(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).sort().join() !== [...ORDER].sort().join() || input.version !== 1) fail();
  const words = ORDER.flatMap((k) => (ADDRESSES.includes(k) ? (Array.isArray(input[k]) && input[k].length === 8 ? input[k].map(uint) : fail()) : FLAGS.includes(k) ? [flag(input[k])] : [uint(input[k])]));
  return new TextEncoder().encode(`verdict ${hex(words)}`);
}

export function decodeVerdictResponse(raw) {
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(raw);
    if (ERRORS.has(text)) return { ok: false, code: text };
    if (!/^ok [0-9a-f]{24}$/.test(text)) throw new Error('shape');
    const bytes = Uint8Array.from(text.slice(3).match(/../g), (s) => parseInt(s, 16));
    const view = new DataView(bytes.buffer);
    const [version, code, word] = [0, 1, 2].map((i) => view.getUint32(i * 4, true));
    // The model shows each code under its own word; a reply that pairs them otherwise is not the guest's.
    if (version !== 1 || code > 3 || word !== code) throw new Error('pairing');
    return { ok: true, code, verdict: VERDICTS[code] };
  } catch {
    return { ok: false, code: 'invalidVerdictResponse' };
  }
}

/**
 * Ask the guest for the verdict on one kernel check. `pinned` is what the
 * package names, `derived` what was hashed here, `statement` what the spec
 * says and `checked` what the kernel was shown. Resolves `{ ok, verdict }`,
 * or `{ ok: false, code }` when the guest gave none: never a verdict made here.
 */
export async function guestVerdict(holo, { pinned, derived, bundle, statement, checked, declared, observed, accepted }) {
  let request;
  try {
    request = encodeVerdictRequest({
      version: 1,
      hasBytes: 1,
      libraryPinned: addressWords(pinned.library),
      libraryDerived: addressWords(derived.library),
      // The proof is written here, not fetched, so its one address is the one derived.
      bundleNamed: addressWords(bundle),
      bundleDerived: addressWords(bundle),
      kernelPinned: addressWords(pinned.kernel),
      kernelDerived: addressWords(derived.kernel),
      specStatement: addressWords(statement),
      checkedStatement: addressWords(checked),
      axiomsDeclared: axiomSet(declared),
      axiomsObserved: axiomSet(observed),
      leanRan: 1,
      leanAccepted: accepted ? 1 : 0,
      secondRan: 0,
      secondAccepted: 0,
    });
  } catch {
    return { ok: false, code: 'malformedVerdictRequest' };
  }
  try {
    const guest = await loadArchive(holo, {});
    if (guest.identities?.verified !== true) return { ok: false, code: 'verdictGuestUnverified' };
    return decodeVerdictResponse(await guest.dispatch(request));
  } catch {
    return { ok: false, code: 'verdictRuntimeFailed' };
  }
}
