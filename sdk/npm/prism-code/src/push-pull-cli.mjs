/**
 * The command line verbs of #292, `push` and `pull`. They read flags and print in
 * Docker's shape; everything else is `push-pull.mjs`. `bin` loads this module only
 * when one of them runs.
 */
import { readFile } from 'node:fs/promises';
import { basename, resolve } from 'node:path';
import { canonicalJson } from './archive.mjs';
import { formatVerdict } from './check.mjs';
import {
  DigestMismatchError,
  ManifestNotFoundError,
  PrismCodeError,
  PrismError,
  PullVerificationError,
  ReferenceInvalidError,
  ReferrersUnsupportedError,
  RegistryAuthError,
  RegistryError,
  SigningError,
  TrustRootError,
  VerificationError,
} from './errors.mjs';
import { parseReference } from './oci-reference.mjs';
import { experimental_pull, experimental_push, shortDigest } from './push-pull.mjs';

const PUSH_OPTIONS = ['store', 'key', 'keyless', 'no-attestations', 'signing-config', 'plain-http', 'json', 'tuf-mirror-url', 'tuf-root', 'tuf-cache'];
const PULL_OPTIONS = ['store', 'policy', 'key', 'certificate-identity', 'certificate-identity-regexp', 'certificate-oidc-issuer', 'type', 'trusted-root', 'entries', 'timestamps', 'plain-http', 'json', 'tuf-mirror-url', 'tuf-root', 'tuf-cache'];

const present = (options, name) => typeof options[name] === 'string' && options[name] !== '';
const path = (options, name) => (present(options, name) ? resolve(options[name]) : undefined);
const tuf = (options) => ({ tufMirrorUrl: options['tuf-mirror-url'], tufRoot: path(options, 'tuf-root'), tufCache: path(options, 'tuf-cache') });

async function readOperand(file, what) {
  try {
    return await readFile(resolve(file), 'utf8');
  } catch (error) {
    throw new PrismCodeError('load.path', `${what} ${file} cannot be read: ${error.message}`);
  }
}

/** The exit code of a refusal: 1 the bytes or the holo failed, 2 no answer, 3 signing, 64 usage. */
function exitOf(error) {
  if (error instanceof ReferenceInvalidError) return 64;
  if (error instanceof VerificationError && error.check === 'policy.invalid') return 64;
  if (error instanceof SigningError || error.code === 'attest.unavailable') return 3;
  if (error instanceof DigestMismatchError || error instanceof PullVerificationError) return 1;
  if (error instanceof RegistryError || error instanceof RegistryAuthError || error instanceof ReferrersUnsupportedError || error instanceof ManifestNotFoundError) return 2;
  if (error instanceof PrismCodeError || error instanceof VerificationError || error instanceof TrustRootError) return 2;
  return 1;
}

function report(error) {
  process.stderr.write(`${error.code}: ${error.message}\n`);
  if (error.check) process.stderr.write(`check: ${error.check}\n`);
  if (error.verdict) process.stderr.write(formatVerdict(error.verdict));
  return exitOf(error);
}

const unknownOption = (options, known) => Object.keys(options).find((name) => !known.includes(name));

/** `push <holo | dir://store:tag> <reference>`. Returns the exit code. */
export async function runPush(positional, options, usage) {
  const unknown = unknownOption(options, PUSH_OPTIONS);
  if (unknown) return usage(`push has no option --${unknown}`);
  if (positional.length !== 2) return usage('push takes a holo and a reference');
  if (Object.hasOwn(options, 'key') && !present(options, 'key')) return usage('--key takes a private key file');
  if (present(options, 'key') && options.keyless) return usage('push signs with --key or --keyless, not both');
  try {
    const target = parseReference(positional[1], { store: present(options, 'store') ? resolve(options.store) : undefined });
    const key = present(options, 'key') ? await readOperand(options.key, 'the key') : undefined;
    const json = options.json === true;
    let headed = false;
    const heading = () => {
      if (headed || json) return;
      headed = true;
      const name = target.kind === 'registry' ? `${target.registry}/${target.repository}` : target.repository ?? `dir://${target.path}`;
      process.stdout.write(`The push refers to repository [${name}]\n`);
    };
    heading();
    const result = await experimental_push(/^dir:\/\//.test(positional[0]) ? positional[0] : resolve(positional[0]), target, {
      key,
      keyless: options.keyless === true,
      noAttestations: options['no-attestations'] === true,
      signingConfig: path(options, 'signing-config'),
      plainHttp: options['plain-http'] === true,
      ...tuf(options),
      onProgress: json
        ? undefined
        : ({ action, digest, predicateType }) => process.stdout.write(`${shortDigest(digest)}: ${action}${predicateType ? ` ${predicateType}` : ''}\n`),
    });
    if (json) {
      process.stdout.write(`${canonicalJson(result)}\n`);
    } else {
      process.stdout.write(`${result.tag ?? 'manifest'}: digest: ${result.digest} size: ${result.size}\n`);
      process.stdout.write(`fingerprint: ${result.fingerprint}\n`);
    }
    if (result.referrers.length === 0 && !options['no-attestations'] && (key !== undefined || options.keyless)) {
      process.stderr.write('warning: the holo carries no attestation, so there was nothing to sign; run prism-code attest first\n');
    } else if (result.referrers.some((r) => r.source === 'holo') && !result.referrers.some((r) => r.source !== 'holo')) {
      process.stderr.write('warning: no signer, so no statement names this manifest and cosign verify-attestation will not find one; pass --key or --keyless\n');
    }
    return 0;
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    return report(error);
  }
}

const count = (options, name) => {
  if (options[name] === undefined) return undefined;
  if (!/^(0|[1-9][0-9]*)$/.test(options[name])) throw new VerificationError(`--${name} is a count, 0 or more`, { check: 'policy.invalid' });
  return Number(options[name]);
};

/** The file a pull writes without an operand: the repository's last component, from what the user typed, never from what the registry says. */
function defaultOutput(reference) {
  if (reference.repository) return `${reference.repository.split('/').pop()}.holo`;
  return `${basename(reference.path.replaceAll('\\', '/')) || 'application'}.holo`;
}

/** `pull <reference> [<out.holo> | dir://store:tag]`. Returns the exit code. */
export async function runPull(positional, options, usage) {
  const unknown = unknownOption(options, PULL_OPTIONS);
  if (unknown) return usage(`pull has no option --${unknown}`);
  if (positional.length < 1 || positional.length > 2) return usage('pull takes a reference and at most one output');
  try {
    const source = parseReference(positional[0], { store: present(options, 'store') ? resolve(options.store) : undefined });
    const key = present(options, 'key') ? await readOperand(options.key, 'the key') : undefined;
    const given = positional[1];
    const output = given === undefined ? resolve(defaultOutput(source)) : given.startsWith('dir://') ? given : resolve(given);
    const json = options.json === true;
    if (!json) {
      const where = source.kind === 'registry' ? source.repository : source.repository ?? `dir://${source.path}`;
      process.stdout.write(`${source.tag ?? source.digest ?? source.fingerprint}: Pulling from ${where}\n`);
    }
    const { holo, ...result } = await experimental_pull(source, {
      output,
      policy: present(options, 'policy') ? options.policy : undefined,
      key,
      certificateIdentity: options['certificate-identity'],
      certificateIdentityRegexp: options['certificate-identity-regexp'],
      certificateOidcIssuer: options['certificate-oidc-issuer'],
      type: options.type,
      trustedRoot: path(options, 'trusted-root'),
      entries: count(options, 'entries'),
      timestamps: count(options, 'timestamps'),
      plainHttp: options['plain-http'] === true,
      ...tuf(options),
    });
    if (json) {
      process.stdout.write(`${canonicalJson(result)}\n`);
      return 0;
    }
    const { attestations, verdict } = result;
    process.stdout.write(`${result.sha256.slice(0, 12)}: Pull complete\n`);
    process.stdout.write(`Digest: ${result.digest}\n`);
    process.stdout.write(`Fingerprint: ${result.fingerprint}\n`);
    process.stdout.write(`Verdict: ${verdict.level}, policy ${verdict.policy.name} requires ${verdict.policy.minimum}\n`);
    process.stdout.write(`Attestations: ${attestations.holo} in the holo, ${attestations.referrers} referrer${attestations.referrers === 1 ? '' : 's'}, ${attestations.signatures === 'verified' ? `${attestations.verified.length} verified` : 'signatures not checked'}\n`);
    process.stdout.write(`Status: Verified and wrote ${given ?? defaultOutput(source)}\n`);
    process.stdout.write(`${result.reference}\n`);
    return 0;
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    return report(error);
  }
}
