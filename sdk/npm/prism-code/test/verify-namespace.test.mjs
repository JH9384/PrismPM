// prism.verify (#449): the same verdicts and refusals as the code under it, on the conformance corpus and the signed
// fixtures, and an import graph that stays within what #440 lets the module depend on. AL-07 owns this file whole and
// allows no skip, so nothing here needs the optional sigstore packages; verify-namespace-signed.test.mjs is what does.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verify as verifyPackage, VerifyError } from '../../verify/src/index.mjs';
import { archiveBytes, archiveNames } from '../../conformance/src/corpus.mjs';
import { check as checkDirect, formatVerdict, LIMITS, readPolicy } from '../src/check.mjs';
import { experimental_verifyAttestations, experimental_verifyBundle } from '../src/attest.mjs';
import {
  DeterminismViolationError,
  PolicyEvaluationError,
  PolicyParseError,
  ReplayError,
  VerificationError,
  experimental_verify,
  historyJson,
  load,
  readAttestations,
  stripAttestations,
} from '../src/index.mjs';
import { verify } from '../src/verify-namespace.mjs';

const here = (path) => fileURLToPath(new URL(path, import.meta.url));
const calculatorPath = here('../fixtures/Calculator.holo');
const calculator = new Uint8Array(readFileSync(calculatorPath));
const signedPath = here('./fixtures/signed/Calculator.signed.holo');
const signer = { key: readFileSync(here('./fixtures/signed/signer.pub.pem'), 'utf8') };
const stranger = { key: readFileSync(here('./fixtures/signed/stranger.pub.pem'), 'utf8') };
const none = { env: {} };
const dir = mkdtempSync(join(tmpdir(), 'prism-verify-namespace-'));

/** A verdict, or the check and class of the refusal: what a caller can depend on. A message is not in it. */
async function outcome(call) {
  try {
    return { verdict: await call() };
  } catch (error) {
    return { refused: error.check ?? error.code, name: error.name };
  }
}

test('the namespace holds exactly these members, frozen all the way down', () => {
  assert.deepEqual(Object.keys(verify).sort(), ['attestations', 'check', 'format', 'limits', 'policy', 'pullClosure', 'replay', 'verdict']);
  assert.deepEqual(Object.keys(verify.policy).sort(), ['evaluate', 'input', 'levels', 'minimumLevelEnv', 'names', 'parse', 'read', 'resolve']);
  assert.deepEqual(Object.keys(verify.attestations).sort(), ['read', 'strip', 'verify', 'verifyBundle']);
  assert.deepEqual(Object.keys(verify.replay).sort(), ['acceptance', 'digest', 'historySchema', 'json', 'parse', 'predicateType', 'record', 'run']);
  for (const value of [verify, verify.policy, verify.policy.names, verify.attestations, verify.replay]) assert.ok(Object.isFrozen(value));
});

test('on every archive of the conformance corpus, verdict agrees with @prism-code/verify and check agrees with check.mjs', async () => {
  const names = archiveNames();
  assert.ok(names.length > 20, 'the corpus is there');
  let verdicts = 0;
  for (const name of names) {
    const bytes = archiveBytes(name);
    const path = join(dir, `${name}.holo`);
    writeFileSync(path, bytes);
    const fromVerdict = await outcome(() => verify.verdict(bytes, none));
    const fromExport = await outcome(() => experimental_verify(bytes, none));
    assert.deepEqual(fromVerdict, fromExport, `${name}: verdict and experimental_verify`);
    const fromPackage = await outcome(() => verifyPackage(bytes));
    if (fromPackage.verdict) {
      verdicts += 1;
      assert.deepEqual(fromVerdict.verdict, fromPackage.verdict, `${name}: verdict and @prism-code/verify`);
    } else {
      assert.equal(fromVerdict.refused, fromPackage.refused, `${name}: the same refusal as @prism-code/verify`);
    }
    assert.deepEqual(await outcome(() => verify.check(path, none)), await outcome(() => checkDirect(path, none)), `${name}: check and check.mjs`);
  }
  assert.ok(verdicts > 0, 'some archives reach a verdict');
});

test('no option raises the level: a tampered guest stays below P1 and a policy that asks for more only fails', async () => {
  const asked = await verify.verdict(calculator, { minimum: 'P3', ...none });
  assert.equal(asked.level, 'P0');
  assert.equal(asked.passed, false);
  const tampered = await verify.verdict(archiveBytes('guest-data-flipped'), { minimum: 'P0', ...none });
  assert.equal(tampered.level, 'P0');
  assert.ok(tampered.reasons.some((r) => r.withholds === 'P1'));

  // The statements of a signed holo, read by anyone, with a self-written envelope: no signature is checked anywhere.
  const signed = new Uint8Array(readFileSync(signedPath));
  const unsigned = stripAttestations(signed);
  const statement = (type) => verify.attestations.read(signed).find((a) => a.predicateType === type).statement;
  const statements = {
    provenance: { statement: statement('https://slsa.dev/provenance/v1'), envelope: { verified: true } },
    proof: { statement: statement('https://uor.foundation/prism/proof/v1'), envelope: { verified: true } },
  };
  const refused = (error) => error instanceof VerificationError && error.check === 'policy.invalid' && /statements/.test(error.message);
  await assert.rejects(verify.verdict(unsigned, { statements, ...none }), refused);
  await assert.rejects(verify.policy.input(unsigned, { statements }), refused);
  assert.equal((await verify.verdict(unsigned, none)).level, 'P0');
});

test('check agrees with check.mjs under any signer, and no signer or another signer leaves a signed holo at P0', async () => {
  for (const options of [none, { signer, ...none }, { signer: stranger, ...none }]) {
    assert.deepEqual(await verify.check(signedPath, options), await checkDirect(signedPath, options));
  }
  assert.equal((await verify.check(signedPath, none)).level, 'P0', 'an unchecked signature is no evidence');
  assert.equal((await verify.check(signedPath, { signer: stranger, ...none })).level, 'P0', 'the wrong signer is no evidence');
});

test('verdict refuses a holo with an attestation section instead of judging it unsigned; check is what reads it', async () => {
  await assert.rejects(verify.verdict(new Uint8Array(readFileSync(signedPath)), none), (error) => error instanceof VerificationError);
});

test('format and limits name what a verdict at P2 trusts', async () => {
  const trusted = JSON.parse(readFileSync(here('./fixtures/signed/calculator.trusted.json'), 'utf8'));
  assert.equal(trusted.level, 'P2');
  assert.equal(await verify.format(trusted), formatVerdict(trusted));
  assert.deepEqual(await verify.limits(), LIMITS);
  for (const limit of await verify.limits()) assert.ok((await verify.format(trusted)).includes(limit));
  assert.match((await verify.limits()).join('\n'), /no proof exists/, 'the limits say the program is not proven');
});

test('policy.read takes what check takes, and refuses what check refuses', async () => {
  assert.deepEqual(verify.policy.levels, ['P0', 'P1', 'P2', 'P3']);
  assert.ok(verify.policy.names.includes('default'));
  for (const name of verify.policy.names) assert.deepEqual(await verify.policy.read(name), await readPolicy(name));
  const path = join(dir, 'unknown.json');
  writeFileSync(path, JSON.stringify({ minimum: 'P0', signer: 'me' }));
  await assert.rejects(verify.policy.read(path), (error) => error instanceof VerificationError && error.check === 'policy.invalid');
});

test('policy.resolve lets no environment variable lower a Rego policy', () => {
  assert.equal(verify.policy.resolve(undefined, { env: { [verify.policy.minimumLevelEnv]: 'P1' } }).policy.minimum, 'P1');
  assert.equal(verify.policy.resolve(undefined, { rego: 'package prism', env: { [verify.policy.minimumLevelEnv]: 'P0' } }).policy.minimum, undefined);
});

test('policy.parse, evaluate and input decide as a verdict does, and refuse with the typed errors, not VerifyError', async () => {
  const { rego } = await verify.policy.read('default');
  const decision = verify.policy.evaluate(verify.policy.parse(rego), await verify.policy.input(calculator));
  assert.equal(decision.minimum, (await verify.verdict(calculator, none)).policy.minimum);
  assert.throws(() => verify.policy.parse('this is not rego'), (error) => error instanceof PolicyParseError && !(error instanceof VerifyError) && error.check === 'policy.parse');
  assert.throws(
    () => verify.policy.evaluate(verify.policy.parse('package prism.policy\nminimum := "P0" if input.nope'), {}),
    (error) => error instanceof PolicyEvaluationError && !(error instanceof VerifyError) && error.check === 'policy.evaluation',
  );
  await assert.rejects(verify.policy.input('not bytes'), (error) => error instanceof VerificationError && !(error instanceof VerifyError));
});

test('attestations reads statements without trusting them; verify and verifyBundle answer as the code under them does', async () => {
  const signed = new Uint8Array(readFileSync(signedPath));
  assert.deepEqual(verify.attestations.read(signed), readAttestations(signed));
  assert.equal(verify.attestations.read(calculator).length, 0);
  assert.deepEqual(verify.attestations.strip(signed), stripAttestations(signed));

  const [bundle] = verify.attestations.read(signed);
  for (const key of [signer, stranger]) {
    assert.deepEqual(await outcome(() => verify.attestations.verify(signed, key)), await outcome(() => experimental_verifyAttestations(signed, key)));
    assert.deepEqual(await outcome(() => verify.attestations.verifyBundle(bundle.bundle, key)), await outcome(() => experimental_verifyBundle(bundle.bundle, key)));
  }
});

test('replay re-executes against an opened application: green when unchanged, typed when it diverges or cannot run', async () => {
  const history = readFileSync(here('../fixtures/Calculator.history.json'), 'utf8');
  const app = await load(calculator);
  const green = await verify.replay.run(app, history);
  assert.equal(green.divergenceCount, 0);
  assert.equal(green.statement.predicateType, verify.replay.predicateType);
  assert.equal(verify.replay.parse(history).schema, verify.replay.historySchema);
  assert.deepEqual(await verify.replay.digest(history), green.histories[0].digest);
  assert.equal(verify.replay.json(history), historyJson(history));

  const changed = await load(new Uint8Array(readFileSync(here('./fixtures/Calculator.changed-model.holo'))));
  await assert.rejects(verify.replay.run(changed, history), (error) => error instanceof DeterminismViolationError && error.check === 'replay.divergence');
  assert.throws(() => verify.replay.parse('{}'), (error) => error instanceof ReplayError && error.check === 'replay.history');

  const first = await verify.replay.acceptance(app);
  assert.equal((await verify.replay.run(app, first)).divergenceCount, 0);
  const recorder = verify.replay.record(app);
  await recorder.dispatch(app.vectors[0].request);
  assert.equal(recorder.events(), 1);
  assert.equal((await verify.replay.run(app, await recorder.history())).divergenceCount, 0);
});

test('outside Node, the members that need it refuse with a typed no-verdict error, and verdict still judges', async () => {
  const saved = Object.getOwnPropertyDescriptor(globalThis, 'process');
  delete globalThis.process;
  try {
    for (const call of [
      () => verify.check(calculatorPath),
      () => verify.format({}),
      () => verify.limits(),
      () => verify.policy.read('default'),
      () => verify.attestations.verify(calculator),
      () => verify.attestations.verifyBundle({}),
    ]) {
      await assert.rejects(call(), (error) => error instanceof VerificationError && error.check === 'verify.kind');
    }
    assert.equal((await verify.verdict(calculator, none)).level, 'P0');
  } finally {
    Object.defineProperty(globalThis, 'process', saved);
  }
});

// What a module imports when it loads, and what it imports only when called. A comment does not count.
function importsOf(file) {
  const text = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const specifiers = (pattern) => [...text.matchAll(pattern)].map((m) => m[1]);
  return { eager: specifiers(/^(?:import|export)\s[^;]*?\sfrom\s+'([^']+)'/gm).concat(specifiers(/^import\s+'([^']+)'/gm)), lazy: specifiers(/\bimport\('([^']+)'\)/g) };
}

function closure(entry) {
  const src = dirname(entry);
  const seen = new Map();
  const walk = (file) => {
    const name = relative(src, file).replaceAll('\\', '/');
    if (seen.has(name)) return;
    const { eager, lazy } = importsOf(file);
    seen.set(name, { eager, lazy });
    for (const specifier of eager) if (specifier.startsWith('.')) walk(resolve(dirname(file), specifier));
  };
  walk(entry);
  return seen;
}

test('at load the module needs no Node and reaches only what docs/proposals/440-nine-modules.md gives verify and errors', () => {
  const graph = closure(here('../src/verify-namespace.mjs'));
  // verify: archive, attestations, blake3, sha256, uorc (the holo v5 container), replay, the vendored verifier and its own files. errors: errors, version.
  // provenance.mjs writes statements, so it is `images`', and verify may not depend on images.
  assert.deepEqual([...graph.keys()].sort(), [
    'archive.mjs',
    'attestations.mjs',
    'blake3.mjs',
    'errors.mjs',
    'replay.mjs',
    'sha256.mjs',
    'uorc.mjs',
    'vendor/verify.mjs',
    'verify-namespace.mjs',
    'verify.mjs',
    'version.mjs',
  ]);
  for (const [name, { eager }] of graph) assert.deepEqual(eager.filter((s) => !s.startsWith('.')), [], `${name} imports nothing outside the package at load`);
  assert.deepEqual(graph.get('verify-namespace.mjs').lazy.sort(), ['./attest.mjs', './check.mjs', './verify-closure.mjs'], 'the Node-only half loads on first use');
});

test('on first use it adds only check.mjs, attest.mjs and verify-closure.mjs, whose own imports stay within the same set', () => {
  const allowed = new Set([...closure(here('../src/verify-namespace.mjs')).keys(), 'check.mjs', 'attest.mjs', 'verify-closure.mjs']);
  for (const entry of ['../src/check.mjs', '../src/attest.mjs', '../src/verify-closure.mjs']) {
    for (const [name, { eager }] of closure(here(entry))) {
      assert.ok(allowed.has(name), `${entry} reaches ${name}`);
      assert.deepEqual(eager.filter((s) => !s.startsWith('.') && !s.startsWith('node:')), [], `${name} imports no package at load`);
    }
  }
});

test('adding the namespace leaves the package export map as it was: it is reachable only through #441', () => {
  const { exports: map } = JSON.parse(readFileSync(here('../package.json'), 'utf8'));
  assert.deepEqual(Object.keys(map), ['.', './node', './browser', './init', './canonical', './package.json']);
});

test('pullClosure is the verdict pull gets: it refuses claims that do not hold, and passes a closure that does', async () => {
  const holo = calculator;
  const manifestDigest = `sha256:${'0'.repeat(64)}`;
  const passed = await verify.pullClosure({ holo, manifestDigest, referrers: [] }, none);
  assert.equal(passed.verdict.passed, true);
  assert.equal(passed.signers, null);
  assert.match(passed.fingerprint, /^blake3:[0-9a-f]{64}$/);
  const asked = await outcome(() => verify.pullClosure({ holo, manifestDigest, asked: { fingerprint: `blake3:${'1'.repeat(64)}` } }));
  assert.deepEqual(asked, { refused: 'digest.fingerprint', name: 'DigestMismatchError' });
  const claimed = await outcome(() => verify.pullClosure({ holo, manifestDigest, claims: { blake3: '2'.repeat(64) } }));
  assert.deepEqual(claimed, { refused: 'digest.annotation', name: 'DigestMismatchError' });
  const broken = holo.slice();
  broken[broken.length - 1] ^= 0xff;
  assert.equal((await outcome(() => verify.pullClosure({ holo: broken, manifestDigest }))).refused, 'pull.archive');
  assert.equal((await outcome(() => verify.pullClosure({ holo, manifestDigest }, { statements: [] }))).refused, 'policy.invalid');
});
