// `prism.errors` (#448): the same classes and functions as the package exports, the stable codes, the spec's constants, and no other module beneath it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import * as source from '../src/errors.mjs';
import * as index from '../src/index.mjs';
import { errors } from '../src/errors-namespace.mjs';

const RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

test('the namespace holds the same objects as errors.mjs and the package exports', () => {
  for (const [name, value] of Object.entries(source)) {
    if (name === 'fail') continue;
    assert.equal(errors[name], value, name);
    assert.equal(index[name], value, name);
  }
  assert.ok(!('fail' in errors));
  assert.deepEqual(Object.keys(errors).sort(), [...Object.keys(source).filter((name) => name !== 'fail'), 'codes', 'spec'].sort());
});

test('an error raised anywhere in the package is an instance of the class in the namespace', () => {
  assert.throws(() => index.parseArchive(new Uint8Array(4)), (error) => {
    assert.ok(error instanceof errors.PrismError && error instanceof errors.PrismCodeError);
    return true;
  });
  assert.ok(new index.DigestMismatchError('x') instanceof errors.DigestMismatchError);
});

test('every stable code stays what it is (#346)', () => {
  assert.deepEqual(errors.codes, {
    PrismError: 'prism_error',
    VerificationError: 'verification_failed',
    PolicyParseError: 'policy_parse_failed',
    PolicyEvaluationError: 'policy_evaluation_failed',
    PolicyDeniedError: 'policy_denied',
    ProofMismatchError: 'proof_mismatch',
    CapabilityDeniedError: 'capability_denied',
    WorldMismatchError: 'world_mismatch',
    DeterminismViolationError: 'determinism_violation',
    ReplayError: 'replay_failed',
    SigningError: 'signing_failed',
    SignatureInvalidError: 'signature_invalid',
    IdentityMismatchError: 'identity_mismatch',
    TransparencyError: 'transparency_failed',
    SubjectMismatchError: 'subject_mismatch',
    AttestationNotFoundError: 'attestation_not_found',
    TrustRootError: 'trust_root_invalid',
    RegistryError: 'registry_failed',
    RegistryAuthError: 'registry_auth_failed',
    ReferrersUnsupportedError: 'referrers_unsupported',
    ManifestNotFoundError: 'manifest_not_found',
    DigestMismatchError: 'digest_mismatch',
    PullVerificationError: 'pull_verification_failed',
    ReferenceInvalidError: 'reference_invalid',
    ProviderError: 'provider_error',
    ProviderNotFoundError: 'provider_not_found',
    ProviderReplyError: 'provider_reply_invalid',
    ProviderFailedError: 'provider_failed',
    ExportMismatchError: 'export_mismatch',
    MiddlewareError: 'middleware_failed',
  });
  for (const [name, code] of Object.entries(errors.codes)) assert.equal(new errors[name]('x').code, code);
  assert.equal(new errors.PrismCodeError('archive.magic', 'x').code, 'archive.magic');
});

test('the functions work through the namespace', () => {
  const reason = { check: 'proof.subject', code: 'PP5501', message: 'm', withholds: 'P2' };
  const failed = { passed: false, policy: { minimum: 'P2' }, reasons: [reason] };
  assert.equal(errors.classForCheck('replay.divergence'), errors.DeterminismViolationError);
  assert.ok(errors.errorForReason(reason) instanceof errors.ProofMismatchError);
  assert.ok(errors.errorFromVerdict(failed, RANK) instanceof errors.ProofMismatchError);
  assert.equal(errors.errorFromVerdict({ passed: true }, RANK), null);
  assert.equal(errors.exitCodeFor(null), 0);
  assert.equal(errors.exitCodeFor(new errors.ProofMismatchError('x')), 10);
  assert.equal(errors.exitCodeFor(new Error('x')), 70);
  assert.equal(errors.ERROR_CLASSES.proof_mismatch, errors.ProofMismatchError);
  assert.ok(errors.EXIT_CODES.length > 0);
});

test('the namespace cannot be changed', () => {
  assert.ok(Object.isFrozen(errors));
  assert.ok(Object.isFrozen(errors.codes));
  assert.throws(() => {
    errors.spec.MAGIC = 'x';
  }, TypeError);
});

test('the vendored spec is what scripts/vendor-spec.mjs makes from @prism-code/spec today', () => {
  execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/vendor-spec.mjs', import.meta.url)), '--check'], { stdio: 'pipe' });
});

test('spec holds the constants of @prism-code/spec, without the schema paths it generates', async () => {
  // The spec's constants.mjs is hand-written and committed, so no build runs here.
  const constants = await import('../../spec/constants.mjs');
  assert.deepEqual(Object.keys(errors.spec), Object.keys(constants));
  for (const [name, value] of Object.entries(constants)) assert.deepEqual(errors.spec[name], value, name);
  assert.ok(Object.hasOwn(errors.spec, 'ASSURANCE'));
  assert.ok(!Object.hasOwn(errors.spec, 'SCHEMAS'));
});

test('the module imports nothing but errors.mjs and the vendored spec', () => {
  const src = fileURLToPath(new URL('../src/', import.meta.url));
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
    for (const [, specifier] of text.matchAll(/^\s*(?:import|export)\b[^'";]*?\bfrom\s+['"]([^'"]+)['"]/gm)) {
      assert.ok(specifier.startsWith('.'), `${relative(src, file)} imports ${specifier}`);
      visit(join(dirname(file), specifier));
    }
    assert.doesNotMatch(text, /\bimport\s*\(/, relative(src, file));
  };
  visit(join(src, 'errors-namespace.mjs'));
  assert.deepEqual(
    [...seen].map((file) => relative(src, file).replaceAll('\\', '/')).sort(),
    ['errors-namespace.mjs', 'errors.mjs', 'vendor/spec/assurance-levels.mjs', 'vendor/spec/constants.mjs'],
  );
});
