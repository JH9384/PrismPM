/**
 * `prism-code export` (issue #290): write the six-file browser export of a
 * locally verified release, or one tarball of it, with the holo's attestation
 * bundles beside it, the way buildx's `local` and `tar` exporters write
 * attestation files beside their output.
 *
 * The bytes come from the release that `prismpm build` or `prismpm pull` left
 * in `<project>/.prism/oci`, never from a `.holo`: a holo carries the core
 * guest and the portable view, while the browser export is the wasm-bindgen
 * adapter, its glue, the browser view and `provenance.json` that the build
 * wrote under `view/browser/` (`crates/prismpm/src/oci/browser_export.rs`).
 *
 * Every file is checked three ways before it is written and again after: its
 * stored blob against the release layer digest, the layer against its build
 * manifest row (`manifest.json`, `prismpm/build-manifest/1`), and the written
 * bytes against both. A hand-copied `public/` is therefore not an export, and
 * a mismatch is an `ExportMismatchError`. The Pages closure check of the
 * shared Action (`action/pages-closure.mjs`) reads the release and checks the
 * exported directory through this module.
 *
 * This checks integrity only. The release must already be verified (the
 * `verified/<digest>.json` state `prismpm` writes); nothing here grants
 * publication or deployment authority. Node only.
 */
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ExportMismatchError, PrismCodeError } from './errors.mjs';
import { FIXED_FILES } from './closure.mjs';
import { canonicalJson } from './archive.mjs';
import { attestationSection, readAttestations } from './attestations.mjs';

export const EXPORT_SCHEMA = 'prismpm/browser-export/1';
export const BUILD_MANIFEST_SCHEMA = 'prismpm/build-manifest/1';
export const RELEASE_ARTIFACT_TYPE = 'application/vnd.prismpm.product.release.v1+json';
export const BROWSER_PREFIX = 'view/browser/';
/** The sidecar suffix: `<name>.attestations.jsonl` beside `<name>/` or `<name>.tar`. */
export const ATTESTATIONS_SUFFIX = '.attestations.jsonl';

const DIGEST = /^sha256:[0-9a-f]{64}$/;
// `schemas/browser-export.schema.json`: `reference` and `output`.
const REFERENCE = /^[a-z0-9.-]+(?::[0-9]+)?\/[a-z0-9._/-]+@sha256:[0-9a-f]{64}$/;
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,255}$/;
const DOCUMENT_LIMIT = 16 * 1024 * 1024;
const RELEASE_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 64 * 1024 * 1024;
const HOLO_LIMIT = 256 * 1024 * 1024;
const BLOCK = 512;

/** Refusals that are about evidence or paths, not bytes: `export.reference`, `export.release`, `export.directory`, `export.exists`, `export.unsafe`. */
const refuse = (check, message, details) => new PrismCodeError(`export.${check}`, message, details);
const mismatch = (check, message, details) => new ExportMismatchError(message, { check: `export.${check}`, details });

export const digestOf = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

/** The SDK's tree digest: SHA-256 of the canonical `[{digest, path, size}]` rows, sorted by path. */
export function treeDigest(files) {
  const rows = files.map(({ digest, path, size }) => ({ digest, path, size }));
  return digestOf(Buffer.from(canonicalJson(rows)));
}

function regularFile(path, what) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw refuse('release', `${what} is absent`);
    throw refuse('release', `${what}: ${error.code}`);
  }
  if (stat.isSymbolicLink()) throw refuse('unsafe', `${what} is a link`);
  if (!stat.isFile()) throw refuse('unsafe', `${what} is not a regular file`);
  return stat;
}

function readBlob(store, digest, what, limit, size) {
  if (!DIGEST.test(digest)) throw refuse('release', `${what} digest is not an immutable sha256 digest`);
  const path = join(store, 'blobs/sha256', digest.slice('sha256:'.length));
  const stat = regularFile(path, `release blob ${what}`);
  if (stat.size > limit || (size !== undefined && stat.size !== size)) {
    throw refuse('release', `release blob ${what} has an unexpected size`);
  }
  const bytes = readFileSync(path);
  if (digestOf(bytes) !== digest || (size !== undefined && bytes.length !== size)) {
    throw refuse('release', `release blob ${what} does not match its digest`);
  }
  return bytes;
}

export function parseDocument(bytes, what) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw refuse('release', `${what} is not JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refuse('release', `${what} is not an object`);
  return value;
}

/** Rows of a file list by `path`; an unnamed or repeated row is refused. */
export function rowsByPath(rows, what) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.path !== 'string' || map.has(row.path)) {
      throw refuse('release', `${what} has an unnamed or duplicated file row`);
    }
    map.set(row.path, row);
  }
  return map;
}

/**
 * Open a verified release in `<project>/.prism/oci` by digest. Returns the
 * release manifest, its layers by title, and `layerBytes(title, limit)`, which
 * reads a layer's stored blob and checks it against the layer digest and size
 * (undefined when the release has no layer of that title).
 */
export function openRelease(project, releaseDigest) {
  if (typeof releaseDigest !== 'string' || !DIGEST.test(releaseDigest)) {
    throw refuse('release', 'release digest is not an immutable sha256 digest');
  }
  const store = join(project, '.prism/oci');
  regularFile(join(store, 'verified', `${releaseDigest.slice('sha256:'.length)}.json`), 'verified release state');
  const manifest = parseDocument(readBlob(store, releaseDigest, 'release manifest', RELEASE_LIMIT), 'release manifest');
  if (manifest.artifactType !== RELEASE_ARTIFACT_TYPE || !Array.isArray(manifest.layers)) {
    throw refuse('release', 'release manifest is not a PrismPM product release');
  }
  const layers = new Map();
  for (const layer of manifest.layers) {
    const title = layer?.annotations?.['org.opencontainers.image.title'];
    if (typeof title !== 'string' || layers.has(title) || !DIGEST.test(layer.digest) || !Number.isInteger(layer.size)) {
      throw refuse('release', 'release manifest layer is untitled, duplicated or unbound');
    }
    layers.set(title, layer);
  }
  const layerBytes = (title, limit = FILE_LIMIT) => {
    const layer = layers.get(title);
    return layer ? readBlob(store, layer.digest, title, limit, layer.size) : undefined;
  };
  return { project, store, digest: releaseDigest, manifest, layers, layerBytes };
}

/** A release layer's bytes, checked against its build manifest row. */
function rowChecked(release, rows, title, limit = FILE_LIMIT) {
  const row = rows.get(title);
  if (!release.layers.has(title)) throw mismatch('layer', `${title} has a build manifest row and no release layer`, { path: title });
  const bytes = release.layerBytes(title, limit);
  const digest = digestOf(bytes);
  if (!row || `sha256:${row.sha256}` !== digest || row.byte_length !== bytes.length) {
    throw mismatch('manifest', `release layer ${title} differs from the build manifest`, {
      path: title,
      expected: row ? { digest: `sha256:${row.sha256}`, size: row.byte_length } : null,
      actual: { digest, size: bytes.length },
    });
  }
  return { bytes, digest, size: bytes.length };
}

/**
 * The browser closure of an opened release: the six `view/browser/` files of
 * its build manifest, each read from its layer and checked against its row.
 * Returns the build manifest (bytes, document, rows) and the files sorted by
 * name, each `{ path, title, bytes, digest, size }`.
 */
export function browserClosure(release) {
  const manifestBytes = release.layerBytes('manifest.json', DOCUMENT_LIMIT);
  if (!manifestBytes) throw refuse('release', 'build manifest is absent');
  const manifest = parseDocument(manifestBytes, 'build manifest');
  if (manifest.schema !== BUILD_MANIFEST_SCHEMA || !Array.isArray(manifest.files)) {
    throw refuse('release', 'build manifest is not a PrismPM build manifest');
  }
  const rows = rowsByPath(manifest.files, 'build manifest');
  const names = [...rows.keys()]
    .filter((path) => path.startsWith(BROWSER_PREFIX))
    .map((path) => path.slice(BROWSER_PREFIX.length))
    .sort();
  const wasm = names.filter((name) => name.endsWith('_bg.wasm'));
  const stem = wasm.length === 1 ? wasm[0].slice(0, -'_bg.wasm'.length) : null;
  const profile = stem === null ? [] : [...FIXED_FILES, `${stem}.js`, `${stem}_bg.wasm`].sort();
  if (stem === null || canonicalJson(names) !== canonicalJson(profile)) {
    throw refuse('release', `build manifest browser rows are not the exact six-file profile: ${names.join(', ') || 'none'}`);
  }
  const files = names.map((name) => {
    if (!FILE_NAME.test(name)) throw refuse('unsafe', `browser file name ${name} is not portable`);
    const title = `${BROWSER_PREFIX}${name}`;
    return { path: name, title, ...rowChecked(release, rows, title) };
  });
  return { manifestBytes, manifest, rows, files, tree_digest: treeDigest(files) };
}

function lstatOrNull(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw refuse('directory', `${path}: ${error.code}`);
  }
}

/**
 * Check an exported directory against a browser closure: exactly the six
 * names, each a regular file whose bytes are the closure's. Returns the
 * `[{digest, path, size}]` rows of the directory.
 */
export function checkDirectory(directory, closure) {
  const stat = lstatOrNull(directory);
  if (!stat) throw refuse('directory', 'export directory is absent');
  if (stat.isSymbolicLink()) throw refuse('unsafe', 'export directory is a link');
  if (!stat.isDirectory()) throw refuse('unsafe', 'export directory is not a directory');
  const expected = closure.files.map((f) => f.path);
  const entries = readdirSync(directory).sort();
  if (canonicalJson(entries) !== canonicalJson(expected)) {
    throw mismatch('files', `exported files differ from the release closure: expected ${expected.join(', ')}; found ${entries.join(', ') || 'nothing'}`, {
      expected,
      actual: entries,
    });
  }
  return closure.files.map((file) => {
    if (!FILE_NAME.test(file.path)) throw refuse('unsafe', `exported file name ${file.path} is not portable`);
    const path = join(directory, file.path);
    const info = regularFile(path, `exported file ${file.path}`);
    if (info.size > FILE_LIMIT) throw refuse('release', `exported file ${file.path} exceeds the browser file bound`);
    return written(file, readFileSync(path));
  });
}

function written(file, bytes) {
  const digest = digestOf(bytes);
  if (digest !== file.digest || bytes.length !== file.size) {
    throw mismatch('manifest', `exported file ${file.path} differs from the build manifest`, {
      path: file.path,
      expected: { digest: file.digest, size: file.size },
      actual: { digest, size: bytes.length },
    });
  }
  return { digest, path: file.path, size: bytes.length };
}

// ustar, deterministic: one regular file per entry in name order, mode 0644,
// owner 0:0 with no names, mtime 0, then two zero blocks. No directory entry,
// so the archive unpacks to the six files at its root, as a Pages artifact.
function octal(value, width) {
  return `${value.toString(8).padStart(width - 1, '0')}\0`;
}

function tarHeader(name, size) {
  const header = Buffer.alloc(BLOCK);
  const put = (text, at) => header.write(text, at, 'ascii');
  put(name, 0);
  put(octal(0o644, 8), 100);
  put(octal(0, 8), 108);
  put(octal(0, 8), 116);
  put(octal(size, 12), 124);
  put(octal(0, 12), 136);
  put('        ', 148);
  put('0', 156);
  put('ustar\0', 257);
  put('00', 263);
  put(octal(0, 8), 329);
  put(octal(0, 8), 337);
  let sum = 0;
  for (const byte of header) sum += byte;
  put(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  return header;
}

/** The deterministic ustar archive of a closure's files. */
export function encodeTar(files) {
  const parts = [];
  for (const file of files) {
    if (!FILE_NAME.test(file.path) || file.path.length > 100) throw refuse('unsafe', `tar entry ${file.path} is not portable`);
    parts.push(tarHeader(file.path, file.bytes.length), Buffer.from(file.bytes));
    const pad = (BLOCK - (file.bytes.length % BLOCK)) % BLOCK;
    if (pad) parts.push(Buffer.alloc(pad));
  }
  parts.push(Buffer.alloc(2 * BLOCK));
  return Buffer.concat(parts);
}

/** Read the regular-file entries of a ustar archive, in archive order; anything else is refused. */
export function decodeTar(bytes) {
  const entries = [];
  let at = 0;
  const field = (header, start, length) => header.subarray(start, start + length).toString('ascii').replace(/\0.*$/s, '');
  while (true) {
    if (at + BLOCK > bytes.length) throw refuse('directory', 'tarball ends without its two zero blocks');
    const header = bytes.subarray(at, at + BLOCK);
    if (header.every((b) => b === 0)) {
      if (at + 2 * BLOCK > bytes.length || !bytes.subarray(at + BLOCK, at + 2 * BLOCK).every((b) => b === 0)) {
        throw refuse('directory', 'tarball ends without its two zero blocks');
      }
      if (bytes.subarray(at + 2 * BLOCK).some((b) => b !== 0)) throw refuse('directory', 'tarball has bytes after its end blocks');
      return entries;
    }
    let sum = 0;
    for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 32 : header[i];
    if (Number.parseInt(field(header, 148, 8).trim(), 8) !== sum) throw refuse('directory', `tar header at ${at} has a bad checksum`);
    if (field(header, 257, 6) !== 'ustar') throw refuse('directory', `tar header at ${at} is not ustar`);
    const name = field(header, 0, 100);
    const type = field(header, 156, 1);
    if ((type !== '0' && type !== '') || field(header, 345, 155) !== '') throw refuse('unsafe', `tar entry ${name} is not a plain regular file`);
    if (!FILE_NAME.test(name)) throw refuse('unsafe', `tar entry ${name} is not a portable top-level name`);
    const size = Number.parseInt(field(header, 124, 12).trim(), 8);
    if (!Number.isSafeInteger(size) || size > FILE_LIMIT) throw refuse('directory', `tar entry ${name} has an unusable size`);
    const start = at + BLOCK;
    if (start + size > bytes.length) throw refuse('directory', `tar entry ${name} overruns the tarball`);
    entries.push({ path: name, bytes: bytes.subarray(start, start + size) });
    at = start + Math.ceil(size / BLOCK) * BLOCK;
  }
}

/** Check a tarball against a browser closure, as `checkDirectory` checks a directory. */
export function checkTar(path, closure) {
  regularFile(path, 'export tarball');
  const entries = decodeTar(readFileSync(path));
  const names = entries.map((e) => e.path);
  const expected = closure.files.map((f) => f.path);
  if (canonicalJson(names) !== canonicalJson(expected)) {
    throw mismatch('files', `tarball entries differ from the release closure: expected ${expected.join(', ')}; found ${names.join(', ') || 'nothing'}`, {
      expected,
      actual: names,
    });
  }
  return closure.files.map((file, i) => written(file, entries[i].bytes));
}

/** The one `.holo` of a release, checked against its build manifest row, or null. */
function releaseHolo(release, rows) {
  const titles = [...rows.keys()].filter((path) => !path.includes('/') && path.endsWith('.holo'));
  if (titles.length > 1) throw refuse('release', `build manifest names ${titles.length} holos: ${titles.join(', ')}`);
  return titles.length === 0 ? null : { title: titles[0], ...rowChecked(release, rows, titles[0], HOLO_LIMIT) };
}

function writeNew(path, bytes) {
  const fd = openSync(path, 'wx', 0o644);
  try {
    let at = 0;
    while (at < bytes.length) at += writeSync(fd, bytes, at, bytes.length - at);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

function absent(path, what) {
  const stat = lstatOrNull(path);
  if (stat) throw refuse('exists', `${what} ${path} already exists; export never replaces a file or directory`);
}

/**
 * Export the browser closure of one verified release.
 *
 * `reference` is `NAME@sha256:DIGEST`, the registry-qualified immutable
 * reference `prismpm export-browser` takes. Give `out`, a new directory name
 * in the project, or `tar`, a new `<name>.tar` in the project. The holo's
 * attestation bundles, when it carries any, are written byte for byte to
 * `<name>.attestations.jsonl` beside the output. Nothing that exists is
 * replaced. Returns the `prismpm/browser-export/1` receipt (the shape
 * `prismpm export-browser` prints, `output` naming the directory the tarball
 * unpacks to), the written paths, and the attestation count.
 */
export function exportBrowser({ project = '.', reference, out, tar } = {}) {
  if (typeof reference !== 'string' || reference.length > 512 || !REFERENCE.test(reference)) {
    throw refuse('reference', 'reference must be a registry-qualified immutable reference, NAME@sha256:DIGEST');
  }
  if ((out === undefined) === (tar === undefined)) throw refuse('unsafe', 'give exactly one of out (a directory name) and tar (a <name>.tar file name)');
  const name = out ?? (typeof tar === 'string' && tar.endsWith('.tar') ? tar.slice(0, -'.tar'.length) : '');
  if (typeof name !== 'string' || !OUTPUT_NAME.test(name)) {
    throw refuse('unsafe', out !== undefined
      ? 'export output must be one new portable directory name in the project'
      : 'export tarball must be one new portable <name>.tar in the project');
  }
  const root = resolve(project);
  const rootStat = lstatOrNull(root);
  if (!rootStat || rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw refuse('unsafe', `project ${root} is not a directory`);
  const target = join(root, out ?? tar);
  const sidecar = join(root, `${name}${ATTESTATIONS_SUFFIX}`);
  absent(target, out !== undefined ? 'export directory' : 'export tarball');
  absent(sidecar, 'attestation file');

  const releaseDigest = reference.slice(reference.lastIndexOf('@') + 1);
  const release = openRelease(root, releaseDigest);
  const closure = browserClosure(release);
  if (!closure.rows.has('model.prism.json')) throw refuse('release', 'build manifest names no model.prism.json');
  const model = rowChecked(release, closure.rows, 'model.prism.json', DOCUMENT_LIMIT);
  const holo = releaseHolo(release, closure.rows);
  const section = holo ? attestationSection(holo.bytes) : null;
  // Decoding checks every line is a bundle whose subjects name this holo's blobs.
  const bundles = section ? readAttestations(holo.bytes).length : 0;

  const receipt = {
    schema: EXPORT_SCHEMA,
    reference,
    release_digest: releaseDigest,
    model_digest: model.digest,
    build_digest: digestOf(closure.manifestBytes),
    output: name,
    files: closure.files.map(({ digest, path, size }) => ({ digest, path, size })),
    tree_digest: closure.tree_digest,
  };

  // Stage beside the target, then rename, so a failed export leaves nothing.
  const staging = join(root, `.prism-code-export-${process.pid}-${randomBytes(6).toString('hex')}`);
  let staged = false;
  try {
    if (out !== undefined) {
      mkdirSync(staging, { mode: 0o755 });
      staged = true;
      for (const file of closure.files) writeNew(join(staging, file.path), file.bytes);
      absent(target, 'export directory');
      renameSync(staging, target);
      staged = false;
    } else {
      staged = true;
      writeNew(staging, encodeTar(closure.files));
      absent(target, 'export tarball');
      renameSync(staging, target);
      staged = false;
    }
  } finally {
    if (staged) rmSync(staging, { recursive: true, force: true });
  }

  // Read back what was written: the export is what the manifest says, or it is refused.
  try {
    const files = out !== undefined ? checkDirectory(target, closure) : checkTar(target, closure);
    if (treeDigest(files) !== closure.tree_digest) throw mismatch('tree', 'written tree digest differs from the release closure');
    if (section) writeNew(sidecar, section.payload);
  } catch (error) {
    removeExport(target, out !== undefined ? closure.files : null);
    throw error;
  }
  return { receipt, path: target, attestations: section ? { path: sidecar, bundles } : null };
}

// Remove only what this export created: its flat files, then the empty directory.
function removeExport(target, files) {
  try {
    if (files) {
      for (const file of files) rmSync(join(target, file.path), { force: true });
      rmdirSync(target);
    } else rmSync(target, { force: true });
  } catch {
    // Something else now lives there; leave it.
  }
}

/**
 * Check an existing export, a directory or a tarball, against a verified
 * release: every file's bytes and digest must match its build manifest row and
 * release layer. Returns `{ files, tree_digest }`.
 */
export function checkExport({ project = '.', releaseDigest, path }) {
  const root = resolve(project);
  const closure = browserClosure(openRelease(root, releaseDigest));
  const target = resolve(root, path);
  const stat = lstatOrNull(target);
  const files = stat && stat.isFile() ? checkTar(target, closure) : checkDirectory(target, closure);
  return { files, tree_digest: treeDigest(files) };
}
