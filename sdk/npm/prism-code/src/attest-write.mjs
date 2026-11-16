/**
 * `attest` and `signStatements`: write signed in-toto statements into a holo's
 * attestation section (issues #272 and #582, design in
 * `docs/proposals/272-attest-verify.md`).
 *
 * This is the writing half of attestation, and it belongs to `images`, which
 * may use both modules it needs and nothing more: the statement is built over
 * the holo's blobs, and signed by an `auth` identity (`auth.identities.from`).
 * Checking a statement again is `verify` (`attest.mjs`); signing keys never
 * leave `auth`. Node only.
 *
 * Experimental until the v0.6 freeze, hence the `experimental_` prefix.
 */
import { createHash } from 'node:crypto';
import { SigningError, SubjectMismatchError } from './errors.mjs';
import { parseArchive, resolveArchive, canonicalJson } from './archive.mjs';
import { readAttestations, appendAttestations, stripAttestations, STATEMENT_TYPE } from './attestations.mjs';
import { holoBytes } from './attest.mjs';
import { auth } from './auth.mjs';

const ROLES = ['guest', 'view', 'model', 'capabilities'];
const encoder = new TextEncoder();
const URI = /^[A-Za-z][A-Za-z0-9+.-]*:\S+$/;

const sha256Hex = (bytes) => createHash('sha256').update(bytes).digest('hex');

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** The signer the options name. Every signature goes through `auth`, which keeps the key or token out of every error. */
const signerOf = (options) => auth.identities.from(options);

function predicateOf(predicate) {
  let value = predicate;
  if (value instanceof Uint8Array || typeof value === 'string') {
    try {
      value = JSON.parse(typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value));
    } catch (cause) {
      throw new SigningError(`the predicate is not JSON: ${cause.message}`, { check: 'sign.predicate', cause });
    }
  }
  if (value === undefined || value === null) throw new SigningError('a predicate is required', { check: 'sign.predicate' });
  return value;
}

/**
 * The subjects of a statement, as `{ name, digest: { sha256 } }` (the κ) over
 * content blobs of the holo. A request is a role (`guest`, `view`, `model`,
 * `capabilities`), a κ-label (`sha256:<hex>`), or `name=<role or label>`.
 * Without a request the subject is the guest, which is what the proof and
 * provenance predicates describe (#266, #268).
 */
export function resolveSubjects(parsed, requests = []) {
  const wanted = requests.length === 0 ? ['guest'] : requests;
  let roles = null;
  const subjects = wanted.map((request) => {
    if (typeof request !== 'string' || request === '') throw new SigningError('a subject is a role or a blob label', { check: 'sign.subject' });
    const eq = request.indexOf('=');
    const name = eq > 0 ? request.slice(0, eq) : null;
    const target = eq > 0 ? request.slice(eq + 1) : request;
    let label;
    if (ROLES.includes(target)) {
      roles ??= resolveArchive(parsed).identities;
      label = roles[`${target}Kappa`];
    } else if (/^sha256:[0-9a-f]{64}$/.test(target)) label = target;
    else throw new SigningError(`subject ${JSON.stringify(request)} is neither a role (${ROLES.join(', ')}) nor a κ-label (sha256:<hex>)`, { check: 'sign.subject' });
    const blob = parsed.blobs.find((b) => b.label === label);
    if (!blob) throw new SigningError(`subject ${label} is not a content blob of this holo`, { check: 'sign.subject' });
    return { name: name ?? (ROLES.includes(target) ? target : label), digest: { sha256: sha256Hex(blob.content) } };
  });
  if (new Set(subjects.map((s) => s.name)).size !== subjects.length) throw new SigningError('two subjects have the same name', { check: 'sign.subject' });
  return subjects;
}

/** The in-toto Statement v1 bytes that get signed. */
export function buildStatement(parsed, { type, predicate, subjects }) {
  if (typeof type !== 'string' || !URI.test(type)) throw new SigningError('the predicate type must be a URI, such as https://slsa.dev/provenance/v1', { check: 'sign.predicate' });
  const statement = { _type: STATEMENT_TYPE, subject: resolveSubjects(parsed, subjects), predicateType: type, predicate: predicateOf(predicate) };
  return { statement, bytes: encoder.encode(JSON.stringify(statement)) };
}

/**
 * Sign a statement about a holo and return the holo with the bundle appended to
 * its attestation section. The input holo is not modified.
 *
 * With `key`, the statement is signed by that private key (PEM or KeyObject)
 * and no network is used. Without it the signing is keyless: an OIDC identity
 * token (`identityToken`, else GitHub Actions or `SIGSTORE_ID_TOKEN`) is
 * exchanged for a Fulcio certificate, and the Rekor v2 entry and RFC 3161
 * timestamp of the signing configuration (`signingConfig`, else the public
 * instance's, from TUF) are embedded in the bundle. If the log refuses the entry
 * as a duplicate of a re-sent request, the statement is signed once more, which
 * makes a new entry; the first one stays in the log, unused.
 *
 * @param {Uint8Array | ArrayBuffer | string | object} source the holo as bytes, a path, or an opened holo
 * @param {{ type: string, predicate: unknown, subjects?: string[], key?: string | KeyObject, identityToken?: string, signingConfig?: object | string, tufMirrorUrl?: string, tufRoot?: string, tufCache?: string }} options
 * @returns {Promise<{ holo: Uint8Array, bundle: object, statement: object, attestations: number }>} `attestations` counts the bundles now in the holo
 */
export async function experimental_attest(source, options) {
  if (!isObject(options)) throw new SigningError('attest takes an options object with a type and a predicate', { check: 'sign.predicate' });
  const parsed = parseArchive(await holoBytes(source));
  const { statement, bytes } = buildStatement(parsed, options);
  const bundle = await signerOf(options).sign(bytes);
  const holo = appendAttestations(parsed, [bundle]);
  return { holo, bundle, statement, attestations: readAttestations(holo).length };
}

/**
 * A whole statement someone else wrote, such as the proof statement
 * `prismpm verify` writes (#266): an in-toto Statement v1 whose every subject
 * is an object of this holo named by its κ (sha256) alone. Returns the bytes
 * to sign, its canonical JSON.
 */
function statementBytes(parsed, statement) {
  let value = statement;
  if (value instanceof Uint8Array || typeof value === 'string') {
    try {
      value = JSON.parse(typeof value === 'string' ? value : new TextDecoder('utf-8', { fatal: true }).decode(value));
    } catch (cause) {
      throw new SigningError(`the statement is not JSON: ${cause.message}`, { check: 'sign.statement', cause });
    }
  }
  if (!isObject(value) || value._type !== STATEMENT_TYPE) throw new SigningError(`the statement's _type is not ${STATEMENT_TYPE}`, { check: 'sign.statement' });
  if (typeof value.predicateType !== 'string' || !URI.test(value.predicateType)) throw new SigningError('the statement has no predicateType URI', { check: 'sign.statement' });
  if (!Array.isArray(value.subject) || value.subject.length === 0) throw new SigningError('the statement has no subject', { check: 'sign.statement' });
  for (const subject of value.subject) {
    const blob = parsed.blobs.find((b) => b.label === `sha256:${subject?.digest?.sha256}`);
    if (!blob || Object.keys(subject.digest).length !== 1) {
      throw new SubjectMismatchError(`subject ${JSON.stringify(subject?.name)} is not an object of this holo named by its κ alone`, { check: 'sign.subject' });
    }
  }
  return { statement: value, bytes: encoder.encode(canonicalJson(value)) };
}

/**
 * Sign statements that are already written, and return the holo that carries
 * them signed (#582). This is how a build on a CI runner turns what
 * `prismpm build` and `prismpm verify` wrote into evidence a checker accepts:
 *
 *   - `unsigned: true` signs each unsigned placeholder in the holo, such as
 *     the provenance statement `prismpm build` writes (#268), and puts the
 *     signed bundle in its place. The signed payload is the placeholder's,
 *     byte for byte.
 *   - `statements` are whole statements to add, such as the proof statement
 *     of the verified directory. Each is signed as canonical JSON.
 *
 * The signer options are `experimental_attest`'s. The input holo is not
 * modified. Resolves to `{ holo, signed, attestations }`, where `signed` lists
 * `{ statement, bundle }` in signing order.
 *
 * @param {Uint8Array | ArrayBuffer | string | object} source the holo as bytes, a path, or an opened holo
 * @param {{ unsigned?: boolean, statements?: Array<object | string | Uint8Array>, key?: string | KeyObject, identityToken?: string, signingConfig?: object | string, tufMirrorUrl?: string, tufRoot?: string, tufCache?: string }} options
 * @returns {Promise<{ holo: Uint8Array, signed: Array<{ statement: object, bundle: object }>, attestations: number }>}
 */
export async function experimental_signStatements(source, options) {
  if (!isObject(options)) throw new SigningError('signStatements takes an options object', { check: 'sign.statement' });
  const statements = options.statements ?? [];
  if (!Array.isArray(statements)) throw new SigningError('statements is an array of statements', { check: 'sign.statement' });
  const parsed = parseArchive(await holoBytes(source));
  const added = statements.map((statement) => statementBytes(parsed, statement));
  const present = readAttestations(parsed);
  const placeholders = options.unsigned === true ? present.filter((a) => !a.signed) : [];
  if (added.length === 0 && placeholders.length === 0) {
    throw new SigningError(options.unsigned === true ? 'the holo has no unsigned statement, and no statement was given' : 'nothing to sign: pass statements, or unsigned: true', { check: 'sign.statement' });
  }
  const signer = signerOf(options);
  const signed = [];
  const replaced = new Map();
  for (const attestation of placeholders) {
    const bytes = Buffer.from(attestation.envelope.payload, 'base64');
    const bundle = await signer.sign(bytes);
    replaced.set(attestation.index, bundle);
    signed.push({ statement: attestation.statement, bundle });
  }
  for (const { statement, bytes } of added) signed.push({ statement, bundle: await signer.sign(bytes) });
  const lines = [...present.map((a) => replaced.get(a.index) ?? a.bytes), ...signed.slice(placeholders.length).map((s) => s.bundle)];
  const holo = appendAttestations(stripAttestations(parsed), lines);
  return { holo, signed, attestations: readAttestations(holo).length };
}
