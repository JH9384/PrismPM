/**
 * Every trust decision `push` and `pull` need, made here and in no other module
 * (issue #449; the steps are those of docs/proposals/292-push-pull-oci.md).
 *
 * `images` fetches and writes; it hands this module what it fetched, as plain
 * facts, and gets back a verdict or a typed refusal. A pull's closure is:
 *
 *   - `holo`: the layer's bytes, already equal to the layer's sha256 digest;
 *   - `manifestDigest`: the digest of the manifest that names the layer;
 *   - `claims`: what the manifest and layer annotations say the holo is
 *     (`fingerprint`, `blake3`), which are only claims until they hold here;
 *   - `asked`: what the caller asked for (`fingerprint`), if it named one;
 *   - `referrers`: `{ digest, line }` for every bundle the registry listed.
 *
 * Nothing here reads the network or a file, apart from the policy file a policy
 * option names, and nothing here writes.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { holoDigest, parseArchive } from './archive.mjs';
import { blake3Hex } from './blake3.mjs';
import { readAttestations, DSSE_PAYLOAD_TYPE } from './attestations.mjs';
import { checkSubjects, experimental_verifyAttestations, experimental_verifyBundle } from './attest.mjs';
import { check, policyOf } from './check.mjs';
import { MINIMUM_LEVEL_ENV } from './verify.mjs';
import { errorFromVerdict, AttestationNotFoundError, DigestMismatchError, PrismCodeError, PrismError, PullVerificationError, VerificationError } from './errors.mjs';
import { ASSURANCE } from './vendor/verify.mjs';

const decoder = new TextDecoder('utf-8', { fatal: true });
const hexOf = (digest) => digest.slice(digest.indexOf(':') + 1);

/** The signer options `experimental_verifyAttestations` takes; any one of the first four makes a signer policy. */
export const SIGNER_OPTIONS = Object.freeze(['key', 'certificateIdentity', 'certificateIdentityRegexp', 'certificateOidcIssuer']);
const signerOptions = (options) => Object.fromEntries(['type', ...SIGNER_OPTIONS, 'trustedRoot', 'entries', 'timestamps', 'tufMirrorUrl', 'tufRoot', 'tufCache'].filter((name) => options[name] !== undefined).map((name) => [name, options[name]]));
const namesSigner = (options) => SIGNER_OPTIONS.some((name) => options[name] !== undefined);

/**
 * Push, step 1: nothing corrupt leaves this machine. The holo's footer and
 * labels verify, and every attestation's subjects are blobs of this holo.
 *
 * @param {Uint8Array} holo
 * @returns {{ parsed: object, attestations: object[] }}
 */
export function verifyOutgoing(holo) {
  const parsed = parseArchive(holo);
  if (!parsed.verification.footer || !parsed.verification.labels) {
    throw new VerificationError('the holo does not verify: its footer or a content label differs from the bytes', { check: 'holo.integrity' });
  }
  const attestations = readAttestations(parsed);
  for (const attestation of attestations) checkSubjects(parsed, attestation);
  return { parsed, attestations };
}

/**
 * Pull, steps 4 and 5: the bytes are a holo, and every BLAKE3 claim about it,
 * the caller's and the registry's, equals what its bytes give.
 *
 * @param {{ holo: Uint8Array, claims?: { fingerprint?: string, blake3?: string }, asked?: { fingerprint?: string } }} closure
 * @returns {{ parsed: object, fingerprint: string }}
 */
export function verifyHoloClaims(closure) {
  let parsed;
  try {
    parsed = parseArchive(closure.holo);
  } catch (cause) {
    if (!(cause instanceof PrismCodeError)) throw cause;
    throw new DigestMismatchError(`the pulled bytes are not a holo: ${cause.message}`, { check: 'pull.archive', cause });
  }
  if (!parsed.verification.footer) throw new DigestMismatchError(parsed.format === 5 ? `the holo's seal ${parsed.footer} is not the UORC-SHA256-CHAIN-v1 of the archive` : `the holo's footer ${parsed.footer} is not the BLAKE3 of its body, ${parsed.fingerprint}`, { check: 'pull.archive' });
  if (!parsed.verification.labels) throw new DigestMismatchError(`a content blob of the holo does not match its label: ${parsed.verification.labelMismatches.map((m) => m.label).join(', ')}`, { check: 'pull.archive' });
  const fingerprint = holoDigest(parsed);
  const asked = closure.asked?.fingerprint;
  if (asked && asked !== fingerprint) throw new DigestMismatchError(`asked for the holo ${asked}, and the registry sent ${fingerprint}`, { check: 'digest.fingerprint' });
  const claimed = closure.claims?.fingerprint;
  if (claimed !== undefined && claimed !== fingerprint) throw new DigestMismatchError(`the manifest says the holo is ${claimed}, its bytes say ${fingerprint}`, { check: 'digest.annotation' });
  const file = closure.claims?.blake3;
  if (file !== undefined && file !== blake3Hex(closure.holo)) throw new DigestMismatchError(`the layer says its BLAKE3 is ${file}, its bytes say ${blake3Hex(closure.holo)}`, { check: 'digest.annotation' });
  return { parsed, fingerprint };
}

/** Pull, step 6: every line decodes, and every subject is a blob of this holo with both digests equal. The verdict reads these lines, so they come first. */
function checkAttestations(parsed) {
  let attestations;
  try {
    attestations = readAttestations(parsed);
    for (const attestation of attestations) checkSubjects(parsed, attestation);
  } catch (cause) {
    if (!(cause instanceof PrismError)) throw cause;
    throw new PullVerificationError(`an attestation in the holo does not hold: ${cause.message}`, { check: 'pull.attestation', cause });
  }
  return attestations;
}

/**
 * Pull, step 7: the verdict, which is `check`'s, so one holo and one signer have
 * one verdict. The signed statements in the holo count when the signer named
 * here vouches for them. Bundles in the registry do not raise the level: they
 * are about the manifest, and step 8 judges them.
 */
async function judge(parsed, options) {
  const env = options.env ?? process.env;
  const policy = await policyOf(options.policy === undefined ? { name: 'pull-default', minimum: env[MINIMUM_LEVEL_ENV] || 'P0' } : options.policy);
  const { type, ...signer } = signerOptions(options);
  let verdict;
  try {
    verdict = await check(parsed.bytes, { policy, env, signer: namesSigner(signer) ? signer : undefined });
  } catch (cause) {
    if (!(cause instanceof VerificationError)) throw cause;
    if (cause.check === 'policy.invalid' || cause.check === 'policy.unreadable') throw cause;
    throw new PullVerificationError(`the holo has no verdict: ${cause.message}`, { check: 'pull.verdict', cause });
  }
  if (!verdict.passed) {
    const why = errorFromVerdict(verdict, ASSURANCE.RANK);
    throw new PullVerificationError(`the holo failed policy ${verdict.policy.name}: level ${verdict.level}, requires ${verdict.policy.minimum}; ${why?.check ?? 'policy.level'}: ${why?.message ?? ''}`, { check: 'pull.verdict', verdict, reasons: verdict.reasons, cause: why ?? undefined });
  }
  return verdict;
}

/** What a registry bundle says about itself, or null when it is not a DSSE statement. */
function readStatement(line) {
  try {
    const bundle = JSON.parse(decoder.decode(line));
    const envelope = bundle?.dsseEnvelope;
    if (envelope?.payloadType !== DSSE_PAYLOAD_TYPE || typeof envelope.payload !== 'string') return null;
    const statement = JSON.parse(decoder.decode(Uint8Array.from(atob(envelope.payload), (c) => c.charCodeAt(0))));
    return Array.isArray(statement?.subject) ? { bundle, statement } : null;
  } catch {
    return null;
  }
}

/**
 * A referrer's statement must be about this holo: a subject's `sha256` is the
 * manifest digest, and any subject that claims `blake3` is a blob of this holo;
 * or every subject is a blob of this holo, which is an in-holo line pushed as is.
 */
function aboutThisHolo(parsed, statement, manifestDigest) {
  const hex = hexOf(manifestDigest);
  const labels = new Set(parsed.blobs.map((blob) => blob.label));
  const blobs = statement.subject.filter((subject) => typeof subject?.digest?.blake3 === 'string');
  if (blobs.some((subject) => !labels.has(`blake3:${subject.digest.blake3}`))) return false;
  try {
    checkSubjects(parsed, { subjects: blobs.map((subject) => ({ name: subject.name, digest: subject.digest, blob: `blake3:${subject.digest.blake3}` })) });
  } catch {
    return false;
  }
  return statement.subject.some((subject) => subject?.digest?.sha256 === hex) || (blobs.length > 0 && blobs.length === statement.subject.length);
}

/** Pull, step 8: with a signer policy, at least one bundle of the holo or of the registry passes it. */
async function checkSigner(parsed, closure, options) {
  if (!namesSigner(options)) return null;
  const policy = signerOptions(options);
  const inHolo = await experimental_verifyAttestations(parsed.bytes, policy);
  const passing = inHolo.results.filter((r) => r.passed).map((r) => ({ source: 'holo', predicateType: r.predicateType, signer: r.signer, time: r.time }));
  // A failed signature explains more than a holo with no attestation, so it is what gets reported.
  let first = inHolo.error instanceof AttestationNotFoundError ? null : inHolo.error;
  const { type, ...rest } = policy;
  const judged = new Set(readAttestations(parsed).map((a) => Buffer.from(a.bytes).toString('latin1')));
  for (const referrer of closure.referrers ?? []) {
    // A line of the holo pushed as is was judged above; it counts once.
    if (judged.has(Buffer.from(referrer.line).toString('latin1'))) continue;
    const read = readStatement(referrer.line);
    if (!read || (type !== undefined && read.statement.predicateType !== type)) continue;
    if (!aboutThisHolo(parsed, read.statement, closure.manifestDigest)) continue;
    try {
      const outcome = await experimental_verifyBundle(read.bundle, rest);
      passing.push({ source: 'referrer', digest: referrer.digest, predicateType: read.statement.predicateType, signer: { identity: outcome.identity, issuer: outcome.issuer, keyId: outcome.keyId }, time: outcome.time });
    } catch (cause) {
      if (!(cause instanceof PrismError)) throw cause;
      first ??= cause;
    }
  }
  first ??= inHolo.error;
  if (passing.length === 0) {
    throw new PullVerificationError(`no attestation of this holo passes the signer policy${first ? `: ${first.code}: ${first.message}` : ''}`, { check: 'pull.signer', cause: first ?? undefined, details: { cause: first?.code ?? null } });
  }
  return passing;
}

/**
 * Judge a pulled closure, steps 4 to 8, in order: the claims, the attestation
 * subjects, the verdict under `policy`, and, with a signer, at least one passing
 * bundle. Resolves only when every step has passed; otherwise rejects with the
 * typed error of the first that did not.
 *
 * `policy` is a policy file path or a policy object, as `check` takes; the
 * default accepts P0, unless `PRISM_MINIMUM_LEVEL` says otherwise. The signer
 * options are those of `experimental_verifyAttestations`.
 *
 * @param {{ holo: Uint8Array, manifestDigest: string, claims?: object, asked?: object, referrers?: Array<{ digest: string, line: Uint8Array }> }} closure
 * @param {object} [options] `{ policy, env, key, certificateIdentity, certificateIdentityRegexp, certificateOidcIssuer, type, trustedRoot, entries, timestamps, tufMirrorUrl, tufRoot, tufCache }`
 * @returns {Promise<{ parsed: object, fingerprint: string, attestations: object[], verdict: object, signers: object[] | null }>}
 */
export async function verifyPullClosure(closure, options = {}) {
  const { parsed, fingerprint } = verifyHoloClaims(closure);
  const attestations = checkAttestations(parsed);
  const verdict = await judge(parsed, options);
  const signers = await checkSigner(parsed, closure, options);
  return { parsed, fingerprint, attestations, verdict, signers };
}
