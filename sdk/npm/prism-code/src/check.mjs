/**
 * `prism-code check <app.holo>`: judge a holo against a policy and turn the
 * verdict into a CI exit code (issue #270; levels, verdict and exit codes in
 * docs/proposals/269-assurance-levels.md).
 *
 * The verdict is `experimental_verify`'s, so `check`, `holo.verify()` and
 * `@prism-code/verify` cannot disagree. The policy is a verify-time input, never
 * read from the holo: a shipped policy by name, a Rego file (#285,
 * docs/proposals/285-policy-file.md) or a JSON file of options.
 *
 * Exit 0 when the policy passes, 1 when it fails or denies, 2 when no verdict
 * was reached, which includes a policy that does not parse or cannot be
 * evaluated. With `--json`, stdout holds exactly one canonical verdict on 0 and
 * 1 and nothing on 2; diagnostics go to stderr.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { experimental_verify } from './verify.mjs';
import { ASSURANCE, POLICIES } from './vendor/verify.mjs';
import { canonicalJson, parseArchive } from './archive.mjs';
import { attestationSection, readAttestations, stripAttestations } from './attestations.mjs';
import { PolicyParseError, PrismError, VerificationError, classForCheck } from './errors.mjs';

export const EXIT = ASSURANCE.EXIT;

/**
 * What the check trusts the signer for, printed with every verdict that
 * reaches P2 (docs/proposals/266-proof-predicate.md, "What `prism check`
 * cannot know").
 */
export const LIMITS = Object.freeze([
  'That the kernel really accepted the proofs: the statement says so; only a replay shows it.',
  'That the shipped wasm computes what the Lean defines: no proof exists; the acceptance corpus is evidence.',
  'That the theorems mean what the author intended: reading the generated Lean is the only way.',
  'That the named SDK image was the one used: the signature binds the claim, not the execution.',
]);

/** The members a JSON policy file may hold. A rule beyond these is written in Rego (#285). */
const POLICY_MEMBERS = ['name', 'minimum', 'digests', 'world', 'effects'];

const noVerdict = (check, message, cause) => new VerificationError(message, { check, cause });

/**
 * Read a policy: the name of a shipped policy (`default`, `pure-only`,
 * `provenance-only`), a Rego file ending in `.rego`, or a JSON object with
 * `name`, `minimum`, `digests` and `world`, the members `experimental_verify`
 * takes. A file is named by the path as given, unless JSON names itself. A file
 * that shares a name with a shipped policy is reached as `./name`. Rejects with
 * a no-verdict error.
 */
export async function readPolicy(path) {
  if (Object.hasOwn(POLICIES, path)) return { name: path, rego: POLICIES[path] };
  if (/\.cue$/i.test(path)) {
    throw new PolicyParseError(`the policy file ${path} is CUE, which this version does not evaluate; write the policy in Rego (.rego)`, { check: 'policy.parse' });
  }
  let text;
  try {
    text = await readFile(resolve(path), 'utf8');
  } catch (cause) {
    throw noVerdict('policy.unreadable', `the policy file ${path} cannot be read: ${cause.code ?? cause.message}`, cause);
  }
  if (/\.rego$/i.test(path)) return { name: path, rego: text };
  let policy;
  try {
    policy = JSON.parse(text);
  } catch (cause) {
    throw noVerdict('policy.invalid', `the policy file ${path} is not JSON: ${cause.message}`, cause);
  }
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) throw noVerdict('policy.invalid', `the policy file ${path} must hold one JSON object`);
  const unknown = Object.keys(policy).filter((key) => !POLICY_MEMBERS.includes(key));
  if (unknown.length > 0) throw noVerdict('policy.invalid', `the policy file ${path} has unknown members ${unknown.join(', ')}; expected ${POLICY_MEMBERS.join(', ')}`);
  return { name: path, ...policy };
}

/** The holo's bytes, or a no-verdict error for a path that is not a file. */
async function holoBytes(path) {
  const info = await stat(resolve(path)).catch(() => null);
  if (!info) throw noVerdict('load.path', `${path} does not exist`);
  if (info.isDirectory()) throw noVerdict('verify.kind', `${path} is a directory; check reads a .holo archive, and a closure has no footer or section table`);
  return new Uint8Array(await readFile(resolve(path)));
}

/** A replay statement from a file (#284), or a no-verdict error. Its checks are the verdict's; only reading it is here. */
async function readReplay(path) {
  let text;
  try {
    text = await readFile(resolve(path), 'utf8');
  } catch (cause) {
    throw noVerdict('replay.statement', `the replay statement ${path} cannot be read: ${cause.code ?? cause.message}`, cause);
  }
  try {
    return JSON.parse(text);
  } catch (cause) {
    throw noVerdict('replay.statement', `the replay statement ${path} is not JSON: ${cause.message}`, cause);
  }
}

/**
 * The footer of the file as given covers the attestation section, and the verdict judges the archive without it, whose
 * footer is recomputed. So a file whose own footer does not match its bytes would read as intact: this puts the damage
 * back as the first `holo.integrity` reason, which withholds P1, and moves the level and the policy result with it.
 */
function withoutIntegrity(verdict, { footer, fingerprint }) {
  const { RANK } = ASSURANCE;
  const message = `The footer ${footer} does not equal the BLAKE3 of everything before it, ${fingerprint}.`;
  const kept = verdict.reasons.filter((r) => r.check !== 'policy.level');
  const reasons = [{ check: 'holo.integrity', withholds: 'P1', message }, ...kept];
  const level = 'P0';
  let passed = !kept.some((r) => r.withholds === null);
  if (RANK[level] < RANK[verdict.policy.minimum]) {
    passed = false;
    reasons.push({ check: 'policy.level', code: 'PP5601', withholds: null, message: `The level is ${level}; the policy requires ${verdict.policy.minimum} or above.` });
  }
  return { level, passed, reasons };
}

/** Why a statement's signature counts for nothing, when the caller named no signer. */
const NO_SIGNER = 'The signature was not checked: name the signer with a key or a certificate identity and issuer (check --key, --certificate-identity and --certificate-oidc-issuer), and an unchecked signature is no evidence.';

/**
 * The attestation section of a holo, read for the verdict (#270): the bytes
 * the verdict judges (the archive without the section, which the footer of the
 * signed file covers and the subjects of the statements name by blob), and
 * the provenance and proof statements with the outcome of their signature
 * check against `signer`. The signature is checked here, in the Node package,
 * because `@prism-code/verify` verifies none; the checks of what the statement
 * says are `@prism-code/verify`'s.
 *
 * Returns null for a holo without the section.
 */
async function attestedEvidence(bytes, signer) {
  let parsed;
  try {
    parsed = parseArchive(bytes);
  } catch {
    return null;
  }
  if (!attestationSection(parsed)) return null;
  let attestations;
  try {
    attestations = readAttestations(parsed);
  } catch (cause) {
    throw noVerdict(cause.check ?? 'attestation.bundle', `the attestation section cannot be read: ${cause.message}`, cause);
  }
  const { PROVENANCE, PROOF } = { PROVENANCE: ASSURANCE.PREDICATES.provenance, PROOF: ASSURANCE.PREDICATES.proof };
  const statements = {};
  for (const [kind, type] of [['provenance', PROVENANCE], ['proof', PROOF]]) {
    for (const attestation of attestations.filter((a) => a.predicateType === type)) {
      const envelope = await signatureOutcome(attestation, signer);
      // The first statement of the kind that verifies wins; otherwise the first one stands, to say why it does not count.
      if (statements[kind] === undefined || (envelope.verified && !statements[kind].envelope.verified)) statements[kind] = { statement: attestation.statement, envelope };
    }
  }
  return { unsigned: stripAttestations(parsed), statements, footerMatches: parsed.verification.footer, footer: Buffer.from(bytes.subarray(bytes.length - 32)).toString('hex'), computed: parsed.fingerprint, fingerprint: `blake3:${parsed.fingerprint}` };
}

async function signatureOutcome(attestation, signer) {
  if (!attestation.signed) return { verified: false, message: 'The statement is an unsigned placeholder: its signature is empty, and no verifier accepts it.' };
  if (signer === undefined) return { verified: false, message: NO_SIGNER };
  const { experimental_verifyBundle } = await import('./attest.mjs');
  try {
    await experimental_verifyBundle(attestation.bundle, signer);
    return { verified: true };
  } catch (error) {
    if (error instanceof PrismError && error.check !== 'policy.invalid') return { verified: false, message: `The signature does not verify: ${error.message}` };
    throw error;
  }
}

/**
 * Judge one holo. Resolves to the verdict; rejects with a `VerificationError`
 * when no verdict was reached.
 *
 * A holo with an attestation section is judged by the statements in it: the
 * provenance statement supports P1 and the proof statement P2, each only when
 * its signature verifies against `signer`. Without `signer` a signed holo is
 * P0, because an unchecked signature is no evidence. The verdict's `holo`
 * member is the fingerprint of the file as given, computed over its body.
 *
 * @param {string} path the holo
 * @param {{ policy?: string, capabilities?: object | null, replay?: string, env?: object, signer?: object }} [options] `policy` is a shipped policy's name or a file path; `capabilities` the granted set; `replay` the path of a `prism/replay/v1` statement; `signer` the signer policy of `experimental_verifyBundle` (`key`, or `certificateIdentity` or `certificateIdentityRegexp` with `certificateOidcIssuer`, and `trustedRoot`)
 */
export async function check(path, options = {}) {
  const policy = options.policy === undefined ? {} : await readPolicy(options.policy);
  // The capability set the caller grants (run, #282); a policy file never grants.
  if (options.capabilities !== undefined) policy.capabilities = options.capabilities;
  if (options.replay !== undefined) policy.replay = await readReplay(options.replay);
  const bytes = await holoBytes(path);
  const attested = await attestedEvidence(bytes, options.signer);
  try {
    if (!attested) return await experimental_verify(bytes, { ...policy, env: options.env });
    const verdict = await experimental_verify(attested.unsigned, { ...policy, statements: attested.statements, env: options.env });
    return { ...verdict, ...(attested.footerMatches ? {} : withoutIntegrity(verdict, { footer: attested.footer, fingerprint: attested.computed })), holo: attested.fingerprint };
  } catch (error) {
    if (error instanceof PrismError) throw error;
    throw noVerdict('verify.input', error.message, error);
  }
}

/** The human title of a reason: its error class without the `Error` suffix, such as `ProofMismatch`. */
export function titleOf(reason) {
  return classForCheck(reason.check).name.replace(/Error$/, '');
}

/** A verdict as text for a person. The message of a reason is never part of the contract. */
export function formatVerdict(verdict, path = undefined) {
  const { NAMES, RANK } = ASSURANCE;
  const lines = [];
  lines.push(`${verdict.passed ? 'PASSED' : 'FAILED'}  ${verdict.level} ${NAMES[verdict.level]}  policy ${verdict.policy.name} requires ${verdict.policy.minimum} or above`);
  if (path !== undefined) lines.push(`holo    ${path}`);
  lines.push(`digest  ${verdict.holo}`);
  if (verdict.reasons.length > 0) {
    lines.push('', 'Reasons:');
    for (const reason of verdict.reasons) {
      const tags = [reason.code, titleOf(reason), reason.withholds ? `withholds ${reason.withholds}` : 'policy rule'].filter(Boolean).join(', ');
      lines.push(`  ${reason.check} (${tags})`, `    ${reason.message}`);
    }
  }
  if (RANK[verdict.level] >= RANK.P2) {
    lines.push('', 'This check trusts the signer for what it cannot know:');
    for (const limit of LIMITS) lines.push(`  ${limit}`);
  }
  return `${lines.join('\n')}\n`;
}

/** The exit code of a verdict. */
export function exitCodeOf(verdict) {
  return verdict.passed ? EXIT.PASSED : EXIT.FAILED;
}

/** The verdict as `--json` prints it: one canonical JSON object and a newline. */
export function verdictJson(verdict) {
  return `${canonicalJson(verdict)}\n`;
}
