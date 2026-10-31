// `prism-code export` (#290): the six-file browser export of a verified release, or one tarball of
// it, byte-matching the build manifest rows, with the holo's attestation bundles beside it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArchive, resolveArchive } from '../src/archive.mjs';
import { appendAttestations, attestationSection, BUNDLE_MEDIA_TYPE } from '../src/attestations.mjs';
import { ExportMismatchError, PrismCodeError, ERROR_CLASSES } from '../src/index.mjs';
import { experimental_exportBrowser, experimental_checkExport } from '../src/node.mjs';
import { decodeTar, encodeTar } from '../src/export.mjs';

const CLI = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const CLOSURE = fileURLToPath(new URL('./fixtures/calculator-closure/', import.meta.url));
const REFERENCE_TAR = fileURLToPath(new URL('./fixtures/export/reference.tar', import.meta.url));
const RELEASE_TYPE = 'application/vnd.prismpm.product.release.v1+json';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const digestOf = (bytes) => `sha256:${sha256(bytes)}`;
const sortKeys = (v) => (Array.isArray(v) ? v.map(sortKeys) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sortKeys(v[k])])) : v);
const canonical = (v) => Buffer.from(JSON.stringify(sortKeys(v)));

const holo = new Uint8Array(readFileSync(new URL('../fixtures/Calculator.holo', import.meta.url)));
const resolved = resolveArchive(parseArchive(holo));
const browser = Object.fromEntries(readdirSync(CLOSURE).sort().map((name) => [name, readFileSync(join(CLOSURE, name))]));

/** An unsigned placeholder bundle about the guest: the shape is real, the signature is not. */
function bundle(predicateType) {
  const guest = resolved.guest.content;
  const statement = {
    _type: 'https://in-toto.io/Statement/v1',
    subject: [{ name: 'guest', digest: { blake3: resolved.guest.label.slice('blake3:'.length), sha256: sha256(guest) } }],
    predicateType,
    predicate: {},
  };
  return {
    mediaType: BUNDLE_MEDIA_TYPE,
    verificationMaterial: { publicKey: { hint: 'placeholder' }, tlogEntries: [] },
    dsseEnvelope: {
      payload: Buffer.from(JSON.stringify(statement)).toString('base64'),
      payloadType: 'application/vnd.in-toto+json',
      signatures: [{ keyid: '', sig: Buffer.from('not a real signature').toString('base64') }],
    },
  };
}
const signed = appendAttestations(holo, [bundle('https://uor.foundation/prism/proof/v1'), bundle('https://slsa.dev/provenance/v1')]);

/**
 * A verified local release with the byte relationships `prismpm build` writes: layers titled by build
 * path, blobs by digest, the build manifest's rows, and the verified state. `layerBytes` replaces the
 * stored bytes of some layers after the manifest rows are written, the way a hand-copied file differs.
 */
function release(t, { files = browser, holoBytes = signed, layerBytes = {}, mutateManifest } = {}) {
  const project = mkdtempSync(join(tmpdir(), 'prism-code-export-'));
  t.after(() => rmSync(project, { recursive: true, force: true }));
  const build = {
    'Calculator.holo': Buffer.from(holoBytes),
    'model.prism.json': Buffer.from(resolved.model.content),
    ...Object.fromEntries(Object.entries(files).map(([name, bytes]) => [`view/browser/${name}`, bytes])),
  };
  const rows = Object.entries(build).map(([path, bytes]) => ({ path, kind: 'artifact', byte_length: bytes.length, sha256: sha256(bytes) }));
  const manifest = { files: rows, inputs: { schema: 'prismpm/build-inputs/2' }, schema: 'prismpm/build-manifest/1' };
  mutateManifest?.(manifest);
  build['manifest.json'] = canonical(manifest);
  Object.assign(build, layerBytes);
  const layers = Object.entries(build).map(([path, bytes]) => ({
    mediaType: 'application/octet-stream',
    digest: digestOf(bytes),
    size: bytes.length,
    annotations: { 'org.opencontainers.image.title': path },
  }));
  const config = canonical({ schema: 'prismpm/product-release/1' });
  const manifestBytes = canonical({
    schemaVersion: 2,
    mediaType: 'application/vnd.oci.image.manifest.v1+json',
    artifactType: RELEASE_TYPE,
    config: { mediaType: RELEASE_TYPE, digest: digestOf(config), size: config.length },
    layers,
  });
  const store = join(project, '.prism/oci');
  mkdirSync(join(store, 'blobs/sha256'), { recursive: true });
  mkdirSync(join(store, 'verified'));
  for (const bytes of [...Object.values(build), config, manifestBytes]) writeFileSync(join(store, 'blobs/sha256', sha256(bytes)), bytes);
  const releaseDigest = digestOf(manifestBytes);
  writeFileSync(join(store, 'verified', `${sha256(manifestBytes)}.json`), '{}');
  return { project, store, releaseDigest, reference: `ghcr.io/uor-foundation/calculator@${releaseDigest}`, build };
}

const rejects = (fn, Class, code) => assert.throws(fn, (e) => e instanceof Class && (Class === ExportMismatchError ? e.check : e.code) === code, `expected ${code}`);
const exported = (r, options) => experimental_exportBrowser({ project: r.project, reference: r.reference, ...options });

test('the export is the six build-manifest files, byte for byte, with the holo attestations beside it', (t) => {
  const r = release(t);
  const { receipt, path, attestations } = exported(r, { out: 'site' });
  assert.equal(path, join(r.project, 'site'));
  assert.deepEqual(readdirSync(path).sort(), Object.keys(browser));
  const manifest = JSON.parse(r.build['manifest.json']);
  for (const name of Object.keys(browser)) {
    const row = manifest.files.find((f) => f.path === `view/browser/${name}`);
    const bytes = readFileSync(join(path, name));
    assert.equal(sha256(bytes), row.sha256, name);
    assert.equal(bytes.length, row.byte_length, name);
  }
  const files = Object.entries(browser).map(([p, bytes]) => ({ digest: digestOf(bytes), path: p, size: bytes.length }));
  assert.deepEqual(receipt, {
    schema: 'prismpm/browser-export/1',
    reference: r.reference,
    release_digest: r.releaseDigest,
    model_digest: digestOf(r.build['model.prism.json']),
    build_digest: digestOf(r.build['manifest.json']),
    output: 'site',
    files,
    tree_digest: digestOf(canonical(files)),
  });
  // The sidecar is the holo's attestation section payload, unchanged: JSON Lines, one bundle per line.
  assert.deepEqual(attestations, { path: join(r.project, 'site.attestations.jsonl'), bundles: 2 });
  const payload = readFileSync(attestations.path);
  assert.ok(payload.equals(Buffer.from(attestationSection(signed).payload)));
  assert.deepEqual(payload.toString().trimEnd().split('\n').map((l) => JSON.parse(l).mediaType), [BUNDLE_MEDIA_TYPE, BUNDLE_MEDIA_TYPE]);
  assert.deepEqual(experimental_checkExport({ project: r.project, releaseDigest: r.releaseDigest, path: 'site' }), { files, tree_digest: receipt.tree_digest });
  assert.deepEqual(readdirSync(r.project).sort(), ['.prism', 'site', 'site.attestations.jsonl'], 'no staging left behind');
});

test('tar mode writes one deterministic tarball of the same six files, checked against the manifest', (t) => {
  const r = release(t);
  const { receipt, path, attestations } = exported(r, { tar: 'site.tar' });
  assert.equal(receipt.output, 'site', 'output names the directory the tarball unpacks to');
  const bytes = readFileSync(path);
  assert.ok(bytes.equals(encodeTar(decodeTar(bytes))), 'byte-stable');
  assert.deepEqual(decodeTar(bytes).map((e) => [e.path, sha256(e.bytes)]), Object.entries(browser).map(([n, b]) => [n, sha256(b)]));
  assert.equal(attestations.path, join(r.project, 'site.attestations.jsonl'));
  assert.equal(experimental_checkExport({ project: r.project, releaseDigest: r.releaseDigest, path: 'site.tar' }).tree_digest, receipt.tree_digest);
  const again = release(t);
  assert.ok(readFileSync(exported(again, { tar: 'site.tar' }).path).equals(bytes), 'the same release gives the same tarball');
});

test('the reference archive: six files in name order, mode 0644, owner 0, mtime 0, readable by tar', (t) => {
  const files = ['app.css', 'app.js', 'index.html', 'provenance.json', 'ref.js', 'ref_bg.wasm'].map((path) => ({
    path,
    bytes: path === 'ref_bg.wasm' ? Buffer.from([0, 0x61, 0x73, 0x6d, 1, 0, 0, 0]) : Buffer.from(`${path}\n`),
  }));
  const reference = readFileSync(REFERENCE_TAR);
  assert.ok(encodeTar(files).equals(reference), 'encodeTar reproduces the committed reference archive');
  assert.equal(sha256(reference), 'a19ba9b937a535788a1d7aad07e558ec9f3d2196a457825d34a5754793c64cb6');
  assert.deepEqual(decodeTar(reference).map((e) => e.path), files.map((f) => f.path));
  // An independent reader, when the host has one.
  const into = mkdtempSync(join(tmpdir(), 'prism-code-tar-'));
  t.after(() => rmSync(into, { recursive: true, force: true }));
  // Through stdin, so no host's tar reads a drive letter as a remote host.
  const tar = spawnSync('tar', ['-xf', '-'], { cwd: into, input: reference, encoding: 'utf8' });
  if (tar.error) return t.diagnostic('no tar on this host; the independent read is skipped');
  assert.equal(tar.status, 0, tar.stderr);
  for (const f of files) assert.ok(readFileSync(join(into, f.path)).equals(f.bytes), f.path);
});

test('a file whose bytes differ from its build manifest row is an ExportMismatchError and nothing is written', (t) => {
  // calculator-example's hand-copied public/prism_calculator.js is 10,625 bytes, its build manifest row 10,310.
  const handCopied = Buffer.concat([browser['prism_calculator.js'], Buffer.from('\n// copied by hand\n')]);
  const r = release(t, { layerBytes: { 'view/browser/prism_calculator.js': handCopied } });
  for (const options of [{ out: 'site' }, { tar: 'site.tar' }]) {
    assert.throws(() => exported(r, options), (e) => {
      assert.ok(e instanceof ExportMismatchError);
      assert.equal(e.code, 'export_mismatch');
      assert.equal(e.check, 'export.manifest');
      assert.equal(e.details.path, 'view/browser/prism_calculator.js');
      assert.deepEqual(e.details.expected, { digest: digestOf(browser['prism_calculator.js']), size: browser['prism_calculator.js'].length });
      return true;
    });
  }
  assert.deepEqual(readdirSync(r.project), ['.prism']);
  assert.equal(ERROR_CLASSES.export_mismatch, ExportMismatchError);
  const holoRow = release(t, { mutateManifest: (m) => (m.files.find((f) => f.path === 'Calculator.holo').byte_length += 1) });
  rejects(() => exported(holoRow, { out: 'site' }), ExportMismatchError, 'export.manifest');
});

test('an export changed after it was written fails the check, with the file named', (t) => {
  const r = release(t);
  const { path } = exported(r, { out: 'site' });
  const check = () => experimental_checkExport({ project: r.project, releaseDigest: r.releaseDigest, path: 'site' });
  writeFileSync(join(path, 'app.js'), 'export const app = 2;');
  assert.throws(check, (e) => e instanceof ExportMismatchError && e.check === 'export.manifest' && /app\.js/.test(e.message));
  writeFileSync(join(path, 'app.js'), browser['app.js']);
  writeFileSync(join(path, 'CNAME'), 'example.test');
  rejects(check, ExportMismatchError, 'export.files');
});

test('export refuses what it cannot do safely, before writing anything', (t) => {
  const r = release(t);
  mkdirSync(join(r.project, 'taken'));
  rejects(() => exported(r, { out: 'taken' }), PrismCodeError, 'export.exists');
  writeFileSync(join(r.project, 'site.attestations.jsonl'), '');
  rejects(() => exported(r, { out: 'site' }), PrismCodeError, 'export.exists');
  for (const out of ['../escape', 'a/b', '.prism', 'site name', '']) rejects(() => exported(r, { out }), PrismCodeError, 'export.unsafe');
  for (const tar of ['site.tgz', '../site.tar', '.tar']) rejects(() => exported(r, { tar }), PrismCodeError, 'export.unsafe');
  rejects(() => exported(r, { out: 'a', tar: 'a.tar' }), PrismCodeError, 'export.unsafe');
  for (const reference of [r.releaseDigest, 'calculator:latest', `calculator@${r.releaseDigest}`]) {
    rejects(() => experimental_exportBrowser({ project: r.project, reference, out: 'x' }), PrismCodeError, 'export.reference');
  }
  rejects(() => exported(r, { out: 'x', reference: `ghcr.io/x/y@sha256:${'3'.repeat(64)}` }), PrismCodeError, 'export.release');
  rmSync(join(r.store, 'verified'), { recursive: true });
  rejects(() => exported(r, { out: 'x' }), PrismCodeError, 'export.release');
  const noGlue = { ...browser };
  delete noGlue['prism_calculator.js'];
  rejects(() => exported(release(t, { files: noGlue }), { out: 'x' }), PrismCodeError, 'export.release');
});

test('a holo with no attestation section exports with no sidecar', (t) => {
  const r = release(t, { holoBytes: holo });
  const { attestations } = exported(r, { out: 'site' });
  assert.equal(attestations, null);
  assert.equal(existsSync(join(r.project, 'site.attestations.jsonl')), false);
});

test('prism-code export prints the canonical receipt with --json and exits 2 on a mismatch', (t) => {
  const r = release(t);
  const run = (...args) => spawnSync(process.execPath, [CLI, 'export', ...args], { encoding: 'utf8', cwd: r.project });
  const json = run(r.reference, '--json');
  assert.equal(json.status, 0, json.stderr);
  const receipt = JSON.parse(json.stdout);
  assert.equal(json.stdout, `${JSON.stringify(sortKeys(receipt))}\n`, 'one canonical line');
  assert.equal(receipt.output, 'export', '--out defaults to export');
  const text = run(r.reference, '--tar', 'site.tar', '--project', r.project);
  assert.equal(text.status, 0, text.stderr);
  assert.match(text.stdout, /exported 6 files of sha256:[0-9a-f]{64} to .*site\.tar \(integrity only\)\n/);
  assert.match(text.stdout, /2 attestation bundle\(s\) in .*site\.attestations\.jsonl/);
  assert.equal(run(r.reference, '--out', 'a', '--tar', 'a.tar').status, 64);
  assert.equal(run().status, 64);
  const bad = release(t, { layerBytes: { 'view/browser/app.css': Buffer.from('body{}') } });
  const refused = spawnSync(process.execPath, [CLI, 'export', bad.reference, '--project', bad.project], { encoding: 'utf8' });
  assert.equal(refused.status, 2);
  assert.match(refused.stderr, /^export_mismatch: release layer view\/browser\/app\.css differs from the build manifest\ncheck: export\.manifest\n/);
});
