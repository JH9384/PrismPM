import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { inspect, formatInspection, loadArchive, canonicalJson, blake3Hex, parseArchive } from '../src/index.mjs';
import { select, FORMAT_REVISIONS } from '../src/inspect.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
// Byte-identical to artifacts/Calculator.holo in UOR-Foundation/calculator-example (ADR-015).
const fixture = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const bytes = new Uint8Array(readFileSync(fixture));
// A Windows checkout may turn the goldens' LF into CRLF; the CLI always writes LF.
const golden = (name) => readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const run = (args) => {
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8' });
  return { code: result.status, out: result.stdout, err: result.stderr };
};

test('inspect: the human view is the snapshot', () => {
  const { code, out, err } = run(['inspect', fixture]);
  assert.equal(code, 0, err);
  assert.equal(out, golden('Calculator.inspect.txt'));
  assert.equal(formatInspection(JSON.parse(golden('Calculator.inspect.json'))), out);
});

test('inspect --json round-trips: canonical, equal to the API, equal to the snapshot', async () => {
  const { code, out, err } = run(['inspect', fixture, '--json']);
  assert.equal(code, 0, err);
  assert.equal(out, golden('Calculator.inspect.json'));
  const parsed = JSON.parse(out);
  assert.equal(`${canonicalJson(parsed)}\n`, out);
  assert.deepEqual(parsed, await inspect(bytes));
});

test('inspect --format prints one value; a missing path exits 2, a malformed one 64', () => {
  const one = run(['inspect', fixture, '--format', 'sections[0].digest.sha256']);
  assert.equal(one.code, 0, one.err);
  assert.equal(one.out, `${sha256(bytes.subarray(202, 202 + 356))}\n`);
  assert.equal(run(['inspect', fixture, '--format=.sections.7.role']).out, 'model-document\n');
  assert.equal(run(['inspect', fixture, '--format', 'world.exports']).out, '["holo_alloc","holo_run","memory"]\n');
  assert.equal(run(['inspect', fixture, '--format', 'attestations']).out, '[]\n');
  assert.equal(run(['inspect', fixture, '--format', 'revision']).out, '2026-10-23\n');

  const missing = run(['inspect', fixture, '--format', 'sections[8].digest']);
  assert.equal(missing.code, 2);
  assert.equal(missing.out, '');
  assert.match(missing.err, /^inspect\.selector: no value at sections\[8\]\.digest$/m);
  assert.equal(run(['inspect', fixture, '--format', 'nope']).code, 2);

  assert.equal(run(['inspect', fixture, '--format', 'a..b']).code, 64);
  assert.equal(run(['inspect', fixture, '--format']).code, 64);
});

test('inspect digests match an independent sha256 and the archive labels', async () => {
  const inspection = await inspect(bytes);
  assert.equal(inspection.schema, 'prismpm/holo-inspection/1');
  assert.equal(inspection.size, bytes.length);
  assert.deepEqual(inspection.digest, { sha256: sha256(bytes), blake3: blake3Hex(bytes) });
  assert.equal(inspection.footer, Buffer.from(bytes.subarray(bytes.length - 32)).toString('hex'));
  assert.equal(inspection.footer, blake3Hex(bytes.subarray(0, bytes.length - 32)));
  assert.deepEqual(
    inspection.sections.map((s) => [s.kind, s.role]),
    [
      [15, 'app-manifest'],
      [8, 'source-manifest'],
      [14, 'application-directory'],
      [14, 'model-provenance'],
      [16, 'guest'],
      [16, 'view'],
      [16, 'capability-set'],
      [16, 'model-document'],
    ],
  );
  for (const s of inspection.sections) {
    const body = bytes.subarray(s.offset, s.offset + s.length);
    assert.deepEqual(s.digest, { sha256: sha256(body), blake3: blake3Hex(body) }, `section ${s.index}`);
    if (s.kind === 16) {
      const content = body.subarray(71);
      assert.equal(s.label, Buffer.from(body.subarray(0, 71)).toString('latin1'));
      assert.equal(`blake3:${s.content.digest.blake3}`, s.label);
      assert.equal(s.content.digest.sha256, sha256(content));
      assert.equal(s.content.label_matches, true);
    }
  }
  // ADR-015's evidence table: the wasm and model blob subjects.
  assert.equal(inspection.sections[4].content.digest.sha256, 'dcf53677c7c80636f8fc2247676b8f747d1549ce4af742c8505eb0f0ae334c03');
  assert.equal(inspection.model.digest.sha256, '074921890f5c372c89f4ed794d26dd550231d5e9bf99bf9474cc1a78923292c6');
  assert.equal(inspection.model.digest.sha256, inspection.provenance.model_id);
  assert.equal(inspection.revision, '2026-10-23');
  assert.deepEqual(inspection.verification, { footer: true, labels: true, cross_references: true });
  assert.deepEqual(inspection.attestations, []);
});

test('inspect never compiles or instantiates the guest', async () => {
  const saved = { compile: WebAssembly.compile, instantiate: WebAssembly.instantiate, Module: WebAssembly.Module, Instance: WebAssembly.Instance };
  const refuse = () => {
    throw new Error('inspect touched WebAssembly');
  };
  Object.assign(WebAssembly, { compile: refuse, instantiate: refuse, Module: refuse, Instance: refuse });
  try {
    assert.equal((await inspect(bytes)).world.contract, 'hologram:guest/core-wasm@1');
  } finally {
    Object.assign(WebAssembly, saved);
  }
});

test('a damaged holo is still inspected, and verification says what broke', async () => {
  const footer = bytes.slice();
  footer[footer.length - 1] ^= 1;
  assert.deepEqual((await inspect(footer)).verification, { footer: false, labels: true, cross_references: true });

  const guest = bytes.slice();
  guest[4440 + 71 + 100] ^= 1;
  const damaged = await inspect(guest);
  assert.equal(damaged.verification.labels, false);
  assert.equal(damaged.sections[4].content.label_matches, false);
  assert.equal(damaged.sections[5].content.label_matches, true);
  assert.match(formatInspection(damaged), /Labels: {12}FAIL/);

  await assert.rejects(inspect(new Uint8Array(64)), (e) => e.code === 'archive.magic');
});

test('Application.inspect() is the same object as inspect(bytes)', async () => {
  const app = await loadArchive(bytes);
  const first = app.inspect();
  assert.equal(app.inspect(), first);
  assert.deepEqual(await first, await inspect(bytes));
  assert.deepEqual(await inspect(new Blob([bytes])), await first);
});

test('select reads dotted paths and indexes, and refuses malformed ones', async () => {
  const inspection = await inspect(bytes);
  assert.deepEqual(select(inspection, 'manifest.labels.guest'), { found: true, value: inspection.manifest.labels.guest });
  assert.deepEqual(select(inspection, '.sections[2].name'), { found: true, value: 'https://hologram.foundation/extension/application-directory/v1' });
  assert.deepEqual(select(inspection, 'sections.3.role'), { found: true, value: 'model-provenance' });
  assert.deepEqual(select(inspection, 'model.profile'), { found: true, value: null });
  assert.equal(select(inspection, 'sections[0].label').found, false);
  assert.equal(select(inspection, 'size.length').found, false);
  for (const bad of ['', '.', 'a.', '[x]', 'a[0', 'a b', '{{json .world}}']) {
    assert.throws(() => select(inspection, bad), (e) => e.code === 'inspect.selector', bad);
  }
});

test('the format revision table agrees with @prism-code/spec', async () => {
  const spec = await import('../../spec/index.mjs');
  assert.deepEqual(FORMAT_REVISIONS, spec.FORMAT_REVISIONS);
  const inspection = await inspect(bytes);
  assert.ok(Object.hasOwn(spec.FORMAT_REVISIONS, inspection.revision));
  assert.deepEqual(inspection.world.exports, [...spec.CORE_WASM.EXPORTS]);
  assert.equal(inspection.world.contract, spec.CORE_WASM.CONTRACT);
  assert.deepEqual(Object.values(inspection.manifest.labels), parseArchive(bytes).manifest.labels);
  const capabilities = parseArchive(bytes).blobs.find((b) => b.label === inspection.world.capability_set.label);
  assert.equal(Buffer.from(capabilities.content).toString('hex'), spec.CAPABILITY_SET.EMPTY_HEX);
  assert.equal(inspection.world.capability_set.empty, true);
});
