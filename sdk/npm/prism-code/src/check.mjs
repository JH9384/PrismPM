/**
 * `prism-code check <app.holo>`: judge a holo against a policy and turn the
 * verdict into a CI exit code (issue #270; levels, verdict and exit codes in
 * docs/proposals/269-assurance-levels.md).
 *
 * The verdict is `experimental_verify`'s, so `check`, `holo.verify()` and
 * `@prism-code/verify` cannot disagree. The policy is a verify-time input, a
 * JSON file given with `--policy`, and is never read from the holo.
 *
 * Exit 0 when the policy passes, 1 when it fails, 2 when no verdict was
 * reached. With `--json`, stdout holds exactly one canonical verdict on 0 and
 * 1 and nothing on 2; diagnostics go to stderr.
 *
 * Experimental until the v0.6 freeze (STABILITY.md section 6).
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { experimental_verify } from './verify.mjs';
import { ASSURANCE } from './vendor/verify.mjs';
import { parseArchive, canonicalJson } from './archive.mjs';
import { attestationSection, ATTESTATION_EXTENSION } from './attestations.mjs';
import { PrismError, VerificationError, classForCheck } from './errors.mjs';

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

/** The members a policy file may hold. Signer trust and attestation rules arrive with #285. */
const POLICY_MEMBERS = ['name', 'minimum', 'digests', 'world', 'effects'];

const noVerdict = (check, message, cause) => new VerificationError(message, { check, cause });

/**
 * Read a policy file: a JSON object with `name`, `minimum`, `digests` and
 * `world`, the members `experimental_verify` takes. Without a `name`, the
 * policy is named by the path as given. Rejects with a no-verdict error.
 */
export async function readPolicy(path) {
  let text;
  try {
    text = await readFile(resolve(path), 'utf8');
  } catch (cause) {
    throw noVerdict('policy.unreadable', `the policy file ${path} cannot be read: ${cause.code ?? cause.message}`, cause);
  }
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

/**
 * Why a holo with an attestation section has no verdict yet, or null. The
 * section joins a format revision only when the wire model change of #267
 * merges; until then every reader refuses it, and a pass would be invented.
 */
function attestationBlocker(bytes) {
  let section;
  try {
    section = attestationSection(parseArchive(bytes));
  } catch {
    return null;
  }
  if (!section) return null;
  return noVerdict(
    'format.revision',
    `the holo carries an attestation section (${ATTESTATION_EXTENSION}), which joins a format revision only when the wire model change of #267 merges; no reader can judge its statements until then`,
  );
}

/**
 * Judge one holo. Resolves to the verdict; rejects with a `VerificationError`
 * when no verdict was reached.
 *
 * @param {string} path the holo
 * @param {{ policy?: string, capabilities?: object | null, env?: object }} [options] `policy` is a policy file path; `capabilities` the granted set
 */
export async function check(path, options = {}) {
  const policy = options.policy === undefined ? {} : await readPolicy(options.policy);
  // The capability set the caller grants (run, #282); a policy file never grants.
  if (options.capabilities !== undefined) policy.capabilities = options.capabilities;
  const bytes = await holoBytes(path);
  const blocked = attestationBlocker(bytes);
  if (blocked) throw blocked;
  try {
    return await experimental_verify(bytes, { ...policy, env: options.env });
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
