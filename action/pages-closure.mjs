// Pages publication closure check for the shared PrismPM Action.
//
// Reads the verified local OCI release that `prismpm build` wrote and the
// directory that `prismpm export-browser` published, then refuses, before any
// upload step can run, a release whose system manifest does not name the
// GitHub Pages target or whose exported bytes differ from the release closure
// (system manifest, browser-system binding, build manifest, release layers and
// stored blobs). It reuses the SDK's registered diagnostics: PP2101 when the
// modeled target is absent or incompatible, PP6101 when release evidence is
// invalid or inconsistent, PP8001 for unsafe filesystem access. This checks
// integrity only; it grants no publication or deployment authority.
import {createHash} from 'node:crypto';
import {lstatSync, readdirSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

export const PAGES_TARGET_KIND = 'github-pages-browser';
export const PAGES_TARGET_API = 'github-pages-artifact@v4';
export const SYSTEM_SCHEMA = 'prismpm/system-model/2';
export const BINDING_PATH = 'projections/browser-system-release.json';
export const BINDING_SCHEMA = 'prismpm/browser-system-release/1';
export const BUILD_MANIFEST_SCHEMA = 'prismpm/build-manifest/1';
export const RELEASE_ARTIFACT_TYPE = 'application/vnd.prismpm.product.release.v1+json';
const CONTROLS = ['application-acceptance', 'artifact-closure', 'source-proof', 'spdx'];
const BROWSER_PREFIX = 'view/browser/';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const FILE_NAME = /^[A-Za-z0-9_][A-Za-z0-9_.-]{0,255}$/;
const DOCUMENT_LIMIT = 16 * 1024 * 1024;
const RELEASE_LIMIT = 64 * 1024 * 1024;
const FILE_LIMIT = 64 * 1024 * 1024;
// Exit classes of the reused registered codes (model/errors.toml).
const EXIT = {PP2101: 3, PP6101: 5, PP8001: 1};

export class PagesClosureError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.exit = EXIT[code];
  }
}

const refuse = (code, message) => new PagesClosureError(code, message);
const sha256 = bytes => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
const sortKeys = value => (Array.isArray(value) ? value.map(sortKeys)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, sortKeys(value[key])])) : value);
export const canonical = value => Buffer.from(JSON.stringify(sortKeys(value)));

function regularFile(path, what) {
  let stat;
  try {
    stat = lstatSync(path);
  } catch (error) {
    if (error.code === 'ENOENT') throw refuse('PP6101', `${what} is absent`);
    throw refuse('PP6101', `${what}: ${error.code}`);
  }
  if (stat.isSymbolicLink()) throw refuse('PP8001', `${what} is a link`);
  if (!stat.isFile()) throw refuse('PP8001', `${what} is not a regular file`);
  return stat;
}

function readBlob(store, digest, what, limit, size) {
  if (!DIGEST.test(digest)) throw refuse('PP6101', `${what} digest is not an immutable sha256 digest`);
  const path = join(store, 'blobs/sha256', digest.slice('sha256:'.length));
  const stat = regularFile(path, `release blob ${what}`);
  if (stat.size > limit || (size !== undefined && stat.size !== size)) {
    throw refuse('PP6101', `release blob ${what} has an unexpected size`);
  }
  const bytes = readFileSync(path);
  if (sha256(bytes) !== digest || (size !== undefined && bytes.length !== size)) {
    throw refuse('PP6101', `release blob ${what} does not match its digest`);
  }
  return bytes;
}

function parseDocument(bytes, what) {
  let value;
  try {
    value = JSON.parse(bytes.toString('utf8'));
  } catch {
    throw refuse('PP6101', `${what} is not JSON`);
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw refuse('PP6101', `${what} is not an object`);
  return value;
}

function rowsByPath(rows, what) {
  const map = new Map();
  for (const row of rows) {
    if (!row || typeof row.path !== 'string' || map.has(row.path)) {
      throw refuse('PP6101', `${what} has an unnamed or duplicated file row`);
    }
    map.set(row.path, row);
  }
  return map;
}

/// Validate the exported browser closure of one verified release against its
/// system manifest and return the closure summary, or throw PagesClosureError.
export function validatePagesClosure({project, releaseDigest, output, treeDigest}) {
  if (!DIGEST.test(releaseDigest)) throw refuse('PP6101', 'release digest is not an immutable sha256 digest');
  if (!OUTPUT_NAME.test(output)) throw refuse('PP8001', 'export output must be one new portable directory name');
  if (treeDigest !== undefined && !DIGEST.test(treeDigest)) {
    throw refuse('PP6101', 'expected tree digest is not an immutable sha256 digest');
  }
  const store = join(project, '.prism/oci');
  regularFile(join(store, 'verified', `${releaseDigest.slice('sha256:'.length)}.json`), 'verified release state');
  const release = parseDocument(readBlob(store, releaseDigest, 'release manifest', RELEASE_LIMIT), 'release manifest');
  if (release.artifactType !== RELEASE_ARTIFACT_TYPE || !Array.isArray(release.layers)) {
    throw refuse('PP6101', 'release manifest is not a PrismPM product release');
  }
  const layers = new Map();
  for (const layer of release.layers) {
    const title = layer?.annotations?.['org.opencontainers.image.title'];
    if (typeof title !== 'string' || layers.has(title) || !DIGEST.test(layer.digest) || !Number.isInteger(layer.size)) {
      throw refuse('PP6101', 'release manifest layer is untitled, duplicated or unbound');
    }
    layers.set(title, layer);
  }
  const layerBytes = (title, limit) => {
    const layer = layers.get(title);
    return layer ? readBlob(store, layer.digest, title, limit, layer.size) : undefined;
  };

  // The modeled target is checked first: a release that does not name the
  // Pages target is refused before the exported directory is read.
  const systemBytes = layerBytes('system.prism.json', DOCUMENT_LIMIT);
  if (!systemBytes) {
    throw refuse('PP2101', 'release has no containing system model, so no system manifest names the Pages target');
  }
  const system = parseDocument(systemBytes, 'system model');
  if (system.schema !== SYSTEM_SCHEMA) {
    throw refuse('PP2101', `system manifest profile ${system.schema} does not name the Pages target; `
      + `the browser-resident profile ${SYSTEM_SCHEMA} is required`);
  }
  if (!Array.isArray(system.targets) || system.targets.length !== 1) {
    throw refuse('PP2101', 'system manifest does not name exactly one Pages target');
  }
  const [target] = system.targets;
  if (target.kind !== PAGES_TARGET_KIND || target.api_version !== PAGES_TARGET_API) {
    throw refuse('PP2101', `system manifest names target ${target.id} as ${target.kind} ${target.api_version}, `
      + `not the Pages target ${PAGES_TARGET_KIND} ${PAGES_TARGET_API}`);
  }
  if (!DIGEST.test(target.adapter_digest) || typeof target.id !== 'string' || !target.id) {
    throw refuse('PP2101', 'system manifest Pages target is not bound to an adapter digest and identity');
  }
  if (typeof system.product?.id !== 'string' || typeof system.product?.version !== 'string') {
    throw refuse('PP6101', 'system manifest product identity is absent');
  }

  const bindingBytes = layerBytes(BINDING_PATH, DOCUMENT_LIMIT);
  if (!bindingBytes) throw refuse('PP6101', 'browser system release binding is absent');
  const binding = parseDocument(bindingBytes, 'browser system release binding');
  if (binding.schema !== BINDING_SCHEMA || binding.target !== target.id
    || binding.system_digest !== sha256(systemBytes)
    || binding.application_model_digest !== system.application_profile?.application_model_digest
    || JSON.stringify(binding.controls) !== JSON.stringify(CONTROLS) || !Array.isArray(binding.files)) {
    throw refuse('PP6101', 'browser system release binding does not bind the released system manifest and Pages target');
  }
  const bindingRows = rowsByPath(binding.files, 'browser system release binding');
  const manifestBytes = layerBytes('manifest.json', DOCUMENT_LIMIT);
  if (!manifestBytes) throw refuse('PP6101', 'build manifest is absent');
  const manifest = parseDocument(manifestBytes, 'build manifest');
  if (manifest.schema !== BUILD_MANIFEST_SCHEMA || !Array.isArray(manifest.files)) {
    throw refuse('PP6101', 'build manifest is not a PrismPM build manifest');
  }
  const manifestRows = rowsByPath(manifest.files, 'build manifest');
  const expected = [...bindingRows.keys()]
    .filter(path => path.startsWith(BROWSER_PREFIX))
    .map(path => path.slice(BROWSER_PREFIX.length))
    .sort();
  if (expected.length === 0) throw refuse('PP6101', 'browser system release binding names no browser files');

  const outputPath = join(project, output);
  let outputStat;
  try {
    outputStat = lstatSync(outputPath);
  } catch (error) {
    if (error.code === 'ENOENT') throw refuse('PP6101', 'export directory is absent');
    throw refuse('PP6101', `export directory: ${error.code}`);
  }
  if (outputStat.isSymbolicLink()) throw refuse('PP8001', 'export directory is a link');
  if (!outputStat.isDirectory()) throw refuse('PP8001', 'export directory is not a directory');
  const entries = readdirSync(outputPath).sort();
  if (JSON.stringify(entries) !== JSON.stringify(expected)) {
    throw refuse('PP6101', `exported files differ from the release binding: expected ${expected.join(', ')}; `
      + `found ${entries.join(', ') || 'nothing'}`);
  }
  const files = [];
  for (const name of entries) {
    if (!FILE_NAME.test(name)) throw refuse('PP8001', `exported file name ${name} is not portable`);
    const path = join(outputPath, name);
    const stat = regularFile(path, `exported file ${name}`);
    if (stat.size > FILE_LIMIT) throw refuse('PP6101', `exported file ${name} exceeds the browser file bound`);
    const bytes = readFileSync(path);
    const digest = sha256(bytes);
    const size = bytes.length;
    const title = `${BROWSER_PREFIX}${name}`;
    const row = bindingRows.get(title);
    if (row.digest !== digest || row.size !== size) {
      throw refuse('PP6101', `exported file ${name} differs from the release binding`);
    }
    const layer = layers.get(title);
    if (!layer || layer.digest !== digest || layer.size !== size) {
      throw refuse('PP6101', `exported file ${name} differs from the release layer`);
    }
    const manifestRow = manifestRows.get(title);
    if (!manifestRow || `sha256:${manifestRow.sha256}` !== digest || manifestRow.byte_length !== size) {
      throw refuse('PP6101', `exported file ${name} differs from the build manifest`);
    }
    // The stored release blob is read back, so served bytes are bound to the
    // verified store content, not only to digests written beside it.
    readBlob(store, layer.digest, title, FILE_LIMIT, layer.size);
    files.push({digest, path: name, size});
  }
  const tree = sha256(canonical(files));
  if (treeDigest !== undefined && tree !== treeDigest) {
    throw refuse('PP6101', 'exported tree digest differs from the export receipt');
  }
  return {
    api_version: target.api_version,
    files,
    output,
    product_id: system.product.id,
    product_version: system.product.version,
    release_digest: releaseDigest,
    system_digest: sha256(systemBytes),
    target_id: target.id,
    target_kind: target.kind,
    tree_digest: tree,
  };
}

function main() {
  const [project, releaseDigest, output, treeDigest] = process.argv.slice(2);
  if (!project || releaseDigest === undefined || output === undefined) {
    process.stderr.write('usage: pages-closure.mjs PROJECT RELEASE_DIGEST OUTPUT [TREE_DIGEST]\n');
    process.exit(2);
  }
  try {
    const summary = validatePagesClosure({project, releaseDigest, output, treeDigest});
    process.stdout.write(`${canonical(summary)}\n`);
  } catch (error) {
    if (error instanceof PagesClosureError) {
      process.stderr.write(`${JSON.stringify({code: error.code, message: error.message})}\n`);
      process.exit(error.exit);
    }
    throw error;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
