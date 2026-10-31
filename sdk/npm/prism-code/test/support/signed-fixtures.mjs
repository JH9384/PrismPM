// Writes test/fixtures/signed/: the reference archives with a provenance statement and a proof statement
// signed by a throwaway key, and the verdicts `prism-code check` prints for them. `prismpm check` is held
// to the same verdicts (crates/prismpm/src/inspect/verdict_tests.rs, parity), and both CLIs verify the
// signatures for real against signer.pub.pem. The private key is discarded: regenerating writes new
// signatures, a new public key and new goldens, and nothing else depends on the old ones.
//
//   node test/support/signed-fixtures.mjs
//
// The proof predicate is the recorded Calculator sample with the model ids rewritten for the archive it is
// attached to. It claims no Lean run; it exists so the verifiers have a statement to check.
import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parseArchive, resolveArchive } from '../../src/index.mjs';
import { experimental_attest, signStatement } from '../../src/attest.mjs';
import { appendAttestations } from '../../src/index.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const out = here('../fixtures/signed');
const bin = here('../../bin/prism-code.mjs');
const read = (path) => new Uint8Array(readFileSync(path));
const calculator = read(here('../../fixtures/Calculator.holo'));
const paymentApproval = read(here('../../fixtures/PaymentApproval.holo'));
const sample = JSON.parse(readFileSync(here('../../../spec/test/fixtures/attestation/statement/calculator.json'), 'utf8'));

const pair = () => generateKeyPairSync('ec', { namedCurve: 'P-256' });
const signing = pair();
const stranger = pair();
const privatePem = signing.privateKey.export({ type: 'pkcs8', format: 'pem' });

function proofPredicateFor(bytes) {
  const resolved = resolveArchive(parseArchive(bytes));
  const { provenance } = resolved;
  const predicate = structuredClone(sample.predicate);
  predicate.model.document = { sha256: provenance.model_id, blake3: resolved.identities.modelKappa.slice('blake3:'.length) };
  Object.assign(predicate.model, { sourceId: provenance.source_id, semanticId: provenance.semantic_id, snapshotId: provenance.snapshot_id, compilerSemanticsId: provenance.compiler_semantics_id, leanManifestSha256: provenance.lean_manifest_sha256 });
  return predicate;
}

async function signed(bytes, { proof = true } = {}) {
  let holo = (await experimental_attest(bytes, { type: 'https://slsa.dev/provenance/v1', predicate: { buildDefinition: { buildType: 'https://uor.foundation/prism/holo-build/v1' } }, subjects: ['guest', 'view', 'model', 'capabilities'], key: privatePem })).holo;
  if (proof) holo = (await experimental_attest(holo, { type: 'https://uor.foundation/prism/proof/v1', predicate: proofPredicateFor(bytes), subjects: ['guest'], key: privatePem })).holo;
  return holo;
}

mkdirSync(out, { recursive: true });
const write = (name, content) => writeFileSync(join(out, name), content);
write('signer.pub.pem', signing.publicKey.export({ type: 'spki', format: 'pem' }));
write('stranger.pub.pem', stranger.publicKey.export({ type: 'spki', format: 'pem' }));
write('Calculator.signed.holo', await signed(calculator));
write('PaymentApproval.signed.holo', await signed(paymentApproval));
// The Calculator's own statement, validly signed, attached to Payment Approval: the signature holds and the subject does not.
const bundle = await signStatement(readFileSync(here('../../../spec/test/fixtures/attestation/statement/calculator.json')), { key: privatePem });
write('PaymentApproval.mismatch.holo', appendAttestations(await signed(paymentApproval, { proof: false }), [bundle]));

// The signed Calculator with one byte of the guest changed, 100 bytes after its label, as the tests tamper it. Not kept.
const damaged = read(join(out, 'Calculator.signed.holo'));
const guest = parseArchive(damaged).blobs.find((b) => b.label === 'blake3:2adca3e7ca42d7415a5227a20002baad90047d087249cbb9ea36e557f5a4a380');
damaged[guest.content.byteOffset + 100] ^= 0xff;
write('tampered.tmp.holo', damaged);

for (const [name, args] of Object.entries({
  'calculator.tampered': ['tampered.tmp.holo', '--key', 'signer.pub.pem'],
  'calculator.trusted': ['Calculator.signed.holo', '--key', 'signer.pub.pem'],
  'payment-approval.trusted': ['PaymentApproval.signed.holo', '--key', 'signer.pub.pem'],
  'calculator.no-signer': ['Calculator.signed.holo'],
  'calculator.stranger': ['Calculator.signed.holo', '--key', 'stranger.pub.pem'],
  'payment-approval.mismatch': ['PaymentApproval.mismatch.holo', '--key', 'signer.pub.pem'],
})) {
  const result = spawnSync(process.execPath, [bin, 'check', ...args, '--json'], { cwd: out, encoding: 'utf8' });
  write(`${name}.json`, result.stdout);
  console.log(name, result.status);
}
rmSync(join(out, 'tampered.tmp.holo'));
