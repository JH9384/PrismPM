/**
 * The two command line verbs of #272, `attest` and `verify-attestation`. They
 * read and write files and print; everything else is `attest.mjs`. `bin`
 * loads this module only when one of them runs, because the sigstore packages
 * it needs are optional.
 */
import { readFile, writeFile, rename, rm } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PrismCodeError, VerificationError } from './errors.mjs';
import { canonicalJson } from './archive.mjs';
import { experimental_verifyAttestations } from './attest.mjs';
import { experimental_attest, experimental_signStatements } from './attest-write.mjs';

const present = (options, name) => typeof options[name] === 'string' && options[name] !== '';
const path = (options, name) => (present(options, name) ? resolve(options[name]) : undefined);

async function readOperand(file, what, encoding) {
  try {
    return await readFile(resolve(file), encoding);
  } catch (error) {
    throw new PrismCodeError('load.path', `${what} ${file} cannot be read: ${error.message}`);
  }
}

const tuf = (options) => ({ tufMirrorUrl: options['tuf-mirror-url'], tufRoot: path(options, 'tuf-root'), tufCache: path(options, 'tuf-cache') });

/** Write beside the target and rename, so an interrupted run never leaves half a holo. */
async function replace(target, holo) {
  const scratch = `${target}.attest-${process.pid}.tmp`;
  try {
    await writeFile(scratch, holo);
    await rename(scratch, target);
  } finally {
    await rm(scratch, { force: true });
  }
}

/**
 * `attest <holo> [--unsigned] [--statement <file>]`: sign what is already
 * written, the holo's unsigned placeholders and a whole statement (#582).
 */
async function runSignStatements(positional, options, usage) {
  if (present(options, 'predicate') || present(options, 'type') || options.subject !== undefined) {
    return usage('attest signs either a new predicate (--predicate and --type) or written statements (--unsigned, --statement), not both');
  }
  if (options.unsigned !== undefined && options.unsigned !== true) return usage('--unsigned takes no value');
  const statements = present(options, 'statement') ? [await readOperand(options.statement, 'the statement', null)] : [];
  const key = present(options, 'key') ? await readOperand(options.key, 'the key', 'utf8') : undefined;
  const { holo, signed, attestations } = await experimental_signStatements(resolve(positional[0]), {
    unsigned: options.unsigned === true,
    statements,
    key,
    signingConfig: path(options, 'signing-config'),
    ...tuf(options),
  });
  const target = resolve(options.output ?? positional[0]);
  await replace(target, holo);
  const how = key === undefined ? 'keyless' : `key ${signed[0].bundle.verificationMaterial.publicKey?.hint}`;
  for (const { statement } of signed) process.stdout.write(`${target}: signed ${statement.predicateType} (${statement.subject.map((s) => s.name).join(', ')}), ${how}\n`);
  process.stdout.write(`${target}: ${attestations} attestation${attestations === 1 ? '' : 's'}\n`);
  return 0;
}

/** `attest <holo> --predicate <file> --type <uri> [--key <private.pem>]`, or the written statements. Returns the exit code. */
export async function runAttest(positional, options, usage) {
  if (positional.length !== 1) return usage('attest takes one holo');
  if (options.unsigned !== undefined || present(options, 'statement')) return runSignStatements(positional, options, usage);
  if (!present(options, 'predicate') || !present(options, 'type')) return usage('attest needs --predicate <file> and --type <uri>, or --unsigned or --statement <file>');
  const predicate = await readOperand(options.predicate, 'the predicate', null);
  const key = present(options, 'key') ? await readOperand(options.key, 'the key', 'utf8') : undefined;
  const { holo, bundle, statement, attestations } = await experimental_attest(resolve(positional[0]), {
    type: options.type,
    predicate,
    subjects: options.subject,
    key,
    signingConfig: path(options, 'signing-config'),
    ...tuf(options),
  });
  const target = resolve(options.output ?? positional[0]);
  await replace(target, holo);
  const how = key === undefined ? 'keyless' : `key ${bundle.verificationMaterial.publicKey?.hint}`;
  process.stdout.write(`${target}: attested ${statement.predicateType} (${statement.subject.map((s) => s.name).join(', ')}), ${how}; ${attestations} attestation${attestations === 1 ? '' : 's'}\n`);
  return 0;
}

const describe = (error) => ({ code: error.code, ...(error.check ? { check: error.check } : {}), message: error.message });

/** `verify-attestation <holo> ...`. Returns the exit code: 0 verified, 1 not. */
export async function runVerifyAttestation(positional, options, usage) {
  if (positional.length !== 1) return usage('verify-attestation takes one holo');
  const count = (name) => {
    if (options[name] === undefined) return undefined;
    if (!/^(0|[1-9][0-9]*)$/.test(options[name])) throw new VerificationError(`--${name} is a count, 0 or more`, { check: 'policy.invalid' });
    return Number(options[name]);
  };
  const key = present(options, 'key') ? await readOperand(options.key, 'the key', 'utf8') : undefined;
  const result = await experimental_verifyAttestations(resolve(positional[0]), {
    type: options.type,
    certificateIdentity: options['certificate-identity'],
    certificateIdentityRegexp: options['certificate-identity-regexp'],
    certificateOidcIssuer: options['certificate-oidc-issuer'],
    key,
    trustedRoot: path(options, 'trusted-root'),
    entries: count('entries'),
    timestamps: count('timestamps'),
    ...tuf(options),
  });
  if (options.json) {
    const results = result.results.map(({ error, ...r }) => ({ ...r, ...(error ? { error: describe(error) } : {}) }));
    process.stdout.write(`${canonicalJson({ passed: result.passed, results, ...(result.error ? { error: describe(result.error) } : {}) })}\n`);
    return result.passed ? 0 : 1;
  }
  for (const r of result.results) {
    const who = r.signer?.identity ?? (r.signer?.keyId ? `key ${r.signer.keyId}` : '');
    const outcome = r.passed ? `verified ${who}${r.time ? ` at ${r.time}` : ''}` : `${r.error.code}: ${r.error.message}`;
    process.stdout.write(`attestation ${r.index} ${r.predicateType} (${r.subjects.join(', ')}): ${outcome}\n`);
  }
  if (result.results.length === 0) process.stderr.write(`${result.error.code}: ${result.error.message}\n`);
  process.stdout.write(result.passed ? 'verified\n' : 'not verified\n');
  return result.passed ? 0 : 1;
}
