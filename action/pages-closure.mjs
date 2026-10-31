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
//
// The release, the build manifest rows and the exported directory are read and
// compared by `prism-code export`'s module (#290), so the Pages check and the
// export agree on what a byte-exact browser export is. This file owns the
// Pages-specific checks: the modeled target and the browser-system binding.
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {browserClosure, checkDirectory, openRelease, parseDocument as parseReleaseDocument, rowsByPath as releaseRows, treeDigest as treeDigestOf}
  from '../sdk/npm/prism-code/src/export.mjs';
import {PrismError} from '../sdk/npm/prism-code/src/errors.mjs';
export {BUILD_MANIFEST_SCHEMA, RELEASE_ARTIFACT_TYPE} from '../sdk/npm/prism-code/src/export.mjs';

export const PAGES_TARGET_KIND = 'github-pages-browser';
export const PAGES_TARGET_API = 'github-pages-artifact@v4';
export const SYSTEM_SCHEMA = 'prismpm/system-model/2';
export const BINDING_PATH = 'projections/browser-system-release.json';
export const BINDING_SCHEMA = 'prismpm/browser-system-release/1';
const CONTROLS = ['application-acceptance', 'artifact-closure', 'source-proof', 'spdx'];
const BROWSER_PREFIX = 'view/browser/';
const DIGEST = /^sha256:[0-9a-f]{64}$/;
const OUTPUT_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DOCUMENT_LIMIT = 16 * 1024 * 1024;
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

// The export module's refusals as the registered diagnostics: an unsafe path
// is PP8001, every other release, manifest or byte disagreement PP6101.
function registered(read) {
  try {
    return read();
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    throw refuse(error.code === 'export.unsafe' ? 'PP8001' : 'PP6101', error.message);
  }
}

const parseDocument = (bytes, what) => registered(() => parseReleaseDocument(bytes, what));
const rowsByPath = (rows, what) => registered(() => releaseRows(rows, what));

/// Validate the exported browser closure of one verified release against its
/// system manifest and return the closure summary, or throw PagesClosureError.
export function validatePagesClosure({project, releaseDigest, output, treeDigest}) {
  if (!DIGEST.test(releaseDigest)) throw refuse('PP6101', 'release digest is not an immutable sha256 digest');
  if (!OUTPUT_NAME.test(output)) throw refuse('PP8001', 'export output must be one new portable directory name');
  if (treeDigest !== undefined && !DIGEST.test(treeDigest)) {
    throw refuse('PP6101', 'expected tree digest is not an immutable sha256 digest');
  }
  const release = registered(() => openRelease(project, releaseDigest));
  const layerBytes = (title, limit) => registered(() => release.layerBytes(title, limit));

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
  const expected = [...bindingRows.keys()]
    .filter(path => path.startsWith(BROWSER_PREFIX))
    .map(path => path.slice(BROWSER_PREFIX.length))
    .sort();
  if (expected.length === 0) throw refuse('PP6101', 'browser system release binding names no browser files');
  // The build manifest's six browser rows, each read back from its stored
  // release blob, so served bytes are bound to the verified store content.
  const closure = registered(() => browserClosure(release));
  const names = closure.files.map(file => file.path);
  if (JSON.stringify(names) !== JSON.stringify(expected)) {
    throw refuse('PP6101', `browser system release binding names ${expected.join(', ')}; `
      + `the build manifest names ${names.join(', ')}`);
  }
  for (const file of closure.files) {
    const row = bindingRows.get(file.title);
    if (row.digest !== file.digest || row.size !== file.size) {
      throw refuse('PP6101', `released file ${file.path} differs from the release binding`);
    }
  }
  const files = registered(() => checkDirectory(join(project, output), closure));
  const tree = treeDigestOf(files);
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
