// The reference archives (#278): Calculator and Payment Approval. Every archive under fixtures/ is one, and each
// must load, replay, inspect to its golden, declare the core-wasm world and conform to it, and reach the same
// assurance level through holo.verify() and `prism-code check`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inspect as verifyInspect } from '../../verify/src/index.mjs';
import { EXIT } from '../src/check.mjs';
import { resolveArchive, inspect, experimental_verify, formatInspection, canonicalJson, runCli, referenceArchive, referenceArchives, assertReplays, scriptedDispatch } from '../../testing/src/index.mjs';
import { spec } from '../../spec/test/spec.mjs';
import { validate } from '../../spec/test/json-schema.mjs';

const here = (relative) => fileURLToPath(new URL(relative, import.meta.url));
const golden = (name) => readFileSync(here(`./fixtures/${name}`), 'utf8').replace(/\r\n/g, '\n');
const run = (args, env = {}) => runCli(args, { env });

/** Each reference archive: its vector count, the application profile the runtime reports and its model document schema. */
export const REFERENCE_ARCHIVES = Object.freeze({
  Calculator: { vectors: 22, profile: 'prismpm/model-document/1', document: 'prismpm/model-document/1' },
  PaymentApproval: { vectors: 19, profile: 'prismpm/text-application/1', document: 'prismpm/model-document/2' },
  // The same applications written as holo v5, UORC archives named by κ (ADR-017).
  'Calculator.v5': { app: 'Calculator', vectors: 22, profile: 'prismpm/model-document/1', document: 'prismpm/model-document/1' },
  'PaymentApproval.v5': { app: 'PaymentApproval', vectors: 19, profile: 'prismpm/text-application/1', document: 'prismpm/model-document/2' },
});

const dir = mkdtempSync(join(tmpdir(), 'prism-reference-archives-'));
const P0 = join(dir, 'p0.json');
writeFileSync(P0, JSON.stringify({ minimum: 'P0' }));
const bytesOf = (name) => new Uint8Array(readFileSync(here(`../fixtures/${name}.holo`)));
const none = { env: {} };

test('every holo under fixtures/ is a registered reference archive', async () => {
  assert.deepEqual(await referenceArchives(), Object.keys(REFERENCE_ARCHIVES).sort());
});

for (const [name, expected] of Object.entries(REFERENCE_ARCHIVES)) {
  test(`${name} loads, is named, and replays every vector and its recorded history (@prism-code/testing)`, async () => {
    const archive = await referenceArchive(name);
    const app = await archive.load();
    assert.equal(app.kind, 'holo');
    assert.equal(app.name, expected.app ?? name);
    assert.equal(app.profile, expected.profile);
    assert.equal(app.vectors.length, expected.vectors);
    assert.equal(app.identities.verified, true);
    assert.deepEqual(await app.acceptance(), { total: expected.vectors, passed: expected.vectors, failed: [] });
    const history = await archive.history();
    assert.equal(history.events.length, expected.vectors);
    assert.equal((await assertReplays(app, history)).divergenceCount, 0);
    // The scripted dispatch is the history's other reading: it answers the recorded requests and nothing else.
    const scripted = scriptedDispatch(history);
    for (const vector of app.vectors) assert.deepEqual(await scripted(vector.request), vector.response);
    scripted.assertComplete();
    const vectors = run(['vectors', here(`../fixtures/${name}.holo`)]);
    assert.equal(vectors.code, 0, vectors.err);
    assert.match(vectors.out, new RegExp(`^${expected.vectors} of ${expected.vectors} vectors passed \\(holo, ${expected.app ?? name}, identities verified\\)`, 'm'));
  });

  test(`${name} inspects to its golden, equally through @prism-code/verify, and declares the core-wasm world`, async () => {
    const bytes = bytesOf(name);
    const inspection = await inspect(bytes);
    assert.equal(`${canonicalJson(inspection)}\n`, golden(`${name}.inspect.json`));
    assert.deepEqual(inspection, verifyInspect(bytes));
    assert.equal(formatInspection(inspection), golden(`${name}.inspect.txt`));
    assert.equal(inspection.model.name, expected.app ?? name);
    assert.equal(inspection.model.vectors, expected.vectors);
    assert.equal(inspection.world.contract, spec.CORE_WASM.CONTRACT);
    assert.equal(inspection.world.conforms, true);
    assert.deepEqual(inspection.world.digest, spec.WORLDS[spec.CORE_WASM.CONTRACT].digest);
    assert.deepEqual(inspection.world.exports, [...spec.CORE_WASM.EXPORTS]);
    assert.equal(inspection.world.capability_set.empty, true);
    assert.deepEqual(inspection.verification, { footer: true, labels: true, cross_references: true });
  });

  test(`${name}: the model document matches the schema it names`, async () => {
    const app = await (await referenceArchive(name)).load();
    const document = app.archive ? resolveArchive(app.archive).modelDocument : null;
    assert.equal(document.schema, expected.document);
    const path = spec.SCHEMAS[document.schema];
    const schema = JSON.parse(readFileSync(here(`../../spec/${path}`), 'utf8'));
    assert.deepEqual(validate(schema, document), []);
  });
}

test('both reference archives reach the same level, for the same reasons, through verify and check', async () => {
  const verdicts = {};
  for (const name of Object.keys(REFERENCE_ARCHIVES)) {
    const bytes = bytesOf(name);
    const verdict = await experimental_verify(bytes, none);
    verdicts[name] = verdict;
    const passed = await experimental_verify(bytes, { ...none, minimum: 'P0', world: spec.WORLDS[spec.CORE_WASM.CONTRACT].digest && { contract: spec.CORE_WASM.CONTRACT, ...spec.WORLDS[spec.CORE_WASM.CONTRACT].digest } });
    assert.equal(passed.passed, true, `${name} passes a P0 policy that pins the world`);
    const holo = here(`../fixtures/${name}.holo`);
    const failed = run(['check', holo, '--json'], { PRISM_MINIMUM_LEVEL: '' });
    assert.equal(failed.code, EXIT.FAILED, `${name}: ${failed.err}`);
    assert.equal(JSON.parse(failed.out).level, verdict.level);
    const accepted = run(['check', holo, '--policy', P0]);
    assert.equal(accepted.code, EXIT.PASSED, `${name}: ${accepted.err}`);
  }
  const [first, ...rest] = Object.values(verdicts);
  for (const other of rest) {
    assert.equal(other.level, first.level);
    assert.deepEqual(other.reasons.map((r) => [r.check, r.withholds]), first.reasons.map((r) => [r.check, r.withholds]));
  }
});
