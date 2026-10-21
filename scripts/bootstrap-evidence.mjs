import { readSemantic, writeSemantic } from './semantic-source.mjs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync, readdirSync, readlinkSync, renameSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const LIMIT = 64 * 1024 * 1024;
const hex = { test: value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) };
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
export const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = bytes => `sha256:${sha(bytes)}`;
const order = (a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b));

export function sha256Base32(value) {
  requireThat(hex.test(value), 'invalid SHA256 for bootstrap projection');
  // The accepted 0.2 lexer scans decimal runs even inside semantic strings.
  // RFC4648 §6 preserves all digest bits without the problematic 0/1 digits.
  const encoded = execFileSync('/usr/bin/base32', ['--wrap=0'], {
    input: Buffer.from(value, 'hex'), encoding: 'utf8', maxBuffer: 128, timeout: 10000
  });
  requireThat(/^[A-Z2-7]{51}[AQ]====$/.test(encoded), 'noncanonical SHA256 Base32 encoding');
  return encoded;
}

export function canonical(value) {
  if (typeof value === 'number') requireThat(Number.isSafeInteger(value), 'unsafe JSON integer');
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort(order).map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function keys(value, expected, label) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value)
    && canonical(Object.keys(value).sort()) === canonical([...expected].sort()), `${label} fields differ`);
}

function regular(path) {
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const metadata = fstatSync(descriptor, { bigint: true });
    requireThat(metadata.isFile() && metadata.size <= BigInt(LIMIT), `not a bounded regular file: ${path}`);
    const bytes = Buffer.alloc(Number(metadata.size) + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor, { bigint: true });
    requireThat(BigInt(length) === metadata.size && after.size === metadata.size
      && after.mtimeNs === metadata.mtimeNs && after.ctimeNs === metadata.ctimeNs,
    `file changed while reading: ${path}`);
    return bytes.subarray(0, length);
  } finally { closeSync(descriptor); }
}

function confined(root, relative) {
  requireThat(typeof relative === 'string' && relative.length > 0
    && !relative.includes('\\') && relative.split('/').every(part => part !== '' && part !== '.' && part !== '..'),
  'noncanonical evidence path');
  let path = root;
  for (const part of relative.split('/')) {
    path = join(path, part);
    requireThat(!lstatSync(path).isSymbolicLink(), 'symlink in evidence path');
  }
  return path;
}

function document(path, framed = false) {
  const bytes = regular(path);
  const value = JSON.parse(bytes.toString('utf8'));
  requireThat(bytes.equals(Buffer.from(canonical(value) + (framed ? '\n' : ''))),
    `noncanonical evidence: ${path}`);
  return value;
}

export function sourceManifest(root) {
  const paths = execFileSync('git', ['-C', root, 'ls-files', '-z'], { maxBuffer: LIMIT })
    .toString('utf8').split('\0').filter(Boolean).sort(order);
  requireThat(new Set(paths).size === paths.length && paths.length > 0, 'invalid tracked source closure');
  const files = paths.map(path => {
    const absolute = join(root, path);
    const metadata = lstatSync(absolute);
    const kind = metadata.isFile() ? 'file' : metadata.isSymbolicLink() ? 'symlink' : null;
    requireThat(kind !== null, `unsupported tracked source kind: ${path}`);
    const bytes = kind === 'file' ? regular(absolute) : Buffer.from(readlinkSync(absolute));
    return { kind, path, sha256: sha(bytes), size: bytes.length };
  });
  return { files, schema: 'prismpm/source-manifest/1' };
}

function manifestDefinition(name, value) {
  return { body: { kind: 'string', value }, kind: 'definition', name, parameters: [], result: { kind: 'string' } };
}

export function prepare(root, envelope) {
  const manifest = sourceManifest(root);
  for (const path of ['scripts/bootstrap-evidence.mjs', 'scripts/bootstrap-evidence.test.mjs', 'sdk/bootstrap/runner.mjs', 'sdk/bootstrap/runtime.lock.json']) {
    requireThat(manifest.files.some(file => file.path === path), `bootstrap helper is not tracked: ${path}`);
  }
  writeFileSync(join(envelope, 'source-manifest.json'), canonical(manifest));
  const path = join(envelope, 'stdlib/src/Foundation/Core.lex.tex');
  const text = regular(path).toString('utf8');
  const payload = readSemantic(text);
  requireThat(Array.isArray(payload.declarations), 'missing canonical bootstrap semantic data');
  payload.declarations.push(
    manifestDefinition('sourceManifestSha256Base32', sha256Base32(sha(canonical(manifest)))),
    manifestDefinition('sourceManifestFileCount', String(manifest.files.length))
  );
  writeFileSync(path, writeSemantic(text, payload));
}

function compiler(lock) {
  requireThat(typeof lock === 'string', 'lock must be text');
  const values = [...lock.matchAll(/^compiler_semantics = "([0-9a-f]{64})"$/gm)];
  requireThat(values.length === 1, 'lock compiler identity is missing or ambiguous');
  return values[0][1];
}

function check(value) {
  keys(value, ['entity_count', 'model_id', 'schema', 'semantic_id', 'snapshot_id'], 'check result');
  requireThat(value.schema === 'prismpm/check-result/1' && Number.isSafeInteger(value.entity_count)
    && value.entity_count > 0, 'invalid check result');
  for (const field of ['model_id', 'semantic_id', 'snapshot_id']) requireThat(hex.test(value[field]), `invalid ${field}`);
}

export function validateCapture(capture, expectedCompiler) {
  keys(capture, ['build', 'check', 'lock', 'manifest', 'model', 'snapshot'], 'capture');
  check(capture.check);
  keys(capture.build, ['build_id', 'manifest_path', 'model_path', 'schema', 'semantic_id', 'source_id'], 'build result');
  const snapshot = capture.snapshot;
  keys(capture.manifest, ['files', 'inputs', 'schema'], 'build manifest');
  keys(snapshot, ['compiler_semantics_id', 'language', 'lexicon_closure', 'modules', 'semantic_id', 'source_id', 'spec'], 'snapshot');
  for (const field of ['source_id', 'semantic_id', 'compiler_semantics_id']) requireThat(hex.test(snapshot[field]), `invalid snapshot ${field}`);
  requireThat(snapshot.spec === 'lexlean/semantic-snapshot/1' && snapshot.language === '1.1'
    && Array.isArray(snapshot.modules) && snapshot.modules.length > 0, 'invalid snapshot');
  requireThat(snapshot.compiler_semantics_id === expectedCompiler && compiler(capture.lock) === expectedCompiler,
    'unexpected compiler identity');
  requireThat(sha(`${canonical(snapshot)}\n`) === capture.check.snapshot_id, 'snapshot digest differs from check');
  requireThat(snapshot.semantic_id === capture.check.semantic_id && snapshot.semantic_id === capture.build.semantic_id
    && snapshot.source_id === capture.build.source_id, 'snapshot identity differs from check/build');
  requireThat(capture.build.schema === 'prismpm/build-result/1'
    && sha(canonical(capture.manifest.inputs)) === capture.build.build_id, 'build identity differs from manifest');
  requireThat(capture.manifest.schema === 'prismpm/build-manifest/1'
    && capture.manifest.inputs.schema === 'prismpm/build-inputs/1'
    && capture.manifest.inputs.lexlean_semantic_id === snapshot.semantic_id
    && capture.manifest.inputs.lexlean_source_id === snapshot.source_id, 'build manifest snapshot identity differs');
  requireThat(capture.model.schema === 'prismpm/model-document/1'
    && sha(canonical(capture.model)) === capture.check.model_id
    && capture.manifest.inputs.model_id === capture.check.model_id, 'model digest differs from check/build');
  keys(capture.model.provenance, ['compiler_semantics_id', 'emitter_semantics_id', 'facet_packages', 'semantic_id', 'snapshot_id', 'source_id'], 'model provenance');
  for (const field of ['compiler_semantics_id', 'semantic_id', 'source_id']) {
    requireThat(capture.model.provenance[field] === snapshot[field], `model provenance ${field} differs`);
  }
  requireThat(capture.model.provenance.snapshot_id === capture.check.snapshot_id
    && hex.test(capture.model.provenance.emitter_semantics_id)
    && capture.model.provenance.emitter_semantics_id === capture.manifest.inputs.emitter_semantics_id,
  'model provenance snapshot/emitter differs');
  const rows = capture.manifest.files;
  requireThat(Array.isArray(rows) && new Set(rows.map(row => row.path)).size === rows.length,
    'duplicate or missing build manifest rows');
  for (const [path, value] of [['lexlean/snapshot.json', snapshot], ['model.prism.json', capture.model]]) {
    const row = rows.find(row => row.path === path);
    const bytes = canonical(value) + (path === 'lexlean/snapshot.json' ? '\n' : '');
    requireThat(row && row.sha256 === sha(bytes) && row.byte_length === Buffer.byteLength(bytes),
      `${path} differs from build manifest`);
  }
  return snapshot;
}

export function captureProjection(envelope, checkPath, buildPath, outputPath) {
  const result = document(buildPath, true);
  requireThat(hex.test(result.build_id), 'invalid build path identity');
  const base = `.prism/build/${result.build_id}`;
  requireThat(result.manifest_path === `${base}/manifest.json` && result.model_path === `${base}/model.prism.json`,
    'unexpected bootstrap artifact location');
  const manifest = document(confined(envelope, result.manifest_path));
  requireThat(Array.isArray(manifest.files) && manifest.files.length <= 4096, 'invalid manifest file closure');
  const names = new Set();
  for (const row of manifest.files) {
    keys(row, ['byte_length', 'kind', 'path', 'sha256'], 'manifest row');
    requireThat(hex.test(row.sha256) && Number.isSafeInteger(row.byte_length) && row.byte_length >= 0,
      'invalid manifest artifact identity');
    requireThat(!names.has(row.path), 'duplicate manifest artifact');
    names.add(row.path);
    const bytes = regular(confined(envelope, `${base}/${row.path}`));
    requireThat(bytes.length === row.byte_length && sha(bytes) === row.sha256, 'manifest artifact bytes differ');
  }
  names.add('manifest.json');
  const actual = [];
  function walk(path, prefix = '') {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const relative = `${prefix}${entry.name}`;
      if (entry.isDirectory()) walk(join(path, entry.name), `${relative}/`);
      else {
        requireThat(entry.isFile() && !entry.isSymbolicLink(), 'unsupported artifact kind');
        actual.push(relative);
      }
    }
  }
  walk(confined(envelope, base));
  requireThat(canonical(actual.sort(order)) === canonical([...names].sort(order)), 'artifact closure differs from manifest');
  const capture = {
    build: result,
    check: document(checkPath, true),
    lock: regular(join(envelope, 'lexlean.lock')).toString('utf8'),
    manifest,
    model: document(confined(envelope, result.model_path)),
    snapshot: document(confined(envelope, `${base}/lexlean/snapshot.json`), true)
  };
  validateCapture(capture, compiler(capture.lock));
  for (const module of capture.snapshot.modules) {
    requireThat(sha(regular(confined(envelope, module.source.path))) === module.source.sha256,
      'snapshot source digest differs from projection file');
  }
  writeFileSync(outputPath, canonical(capture));
}

export function compare(prior, current, manifest, priorLock, currentLock) {
  const before = validateCapture(prior, compiler(priorLock));
  const after = validateCapture(current, compiler(currentLock));
  requireThat(prior.lock === priorLock, 'prior lock differs from accepted source');
  requireThat(prior.lock.replace(/^compiler_semantics = "[0-9a-f]{64}"$/m, '')
    === current.lock.replace(/^compiler_semantics = "[0-9a-f]{64}"$/m, ''), 'projection lock changed beyond compiler identity');
  const content = snapshot => {
    const { source_id, semantic_id, compiler_semantics_id, ...payload } = snapshot;
    return canonical(payload);
  };
  requireThat(content(before) === content(after), 'complete bootstrap semantic content differs');
  const modelContent = model => {
    const { source_id, semantic_id, compiler_semantics_id, snapshot_id, emitter_semantics_id, ...provenance } = model.provenance;
    return canonical({ ...model, provenance });
  };
  requireThat(modelContent(prior.model) === modelContent(current.model), 'complete projected model content differs');
  requireThat(prior.check.entity_count === current.check.entity_count, 'projection entity counts differ');
  const core = before.modules.filter(module => module.name === 'Foundation.Core');
  requireThat(core.length === 1 && Array.isArray(core[0].semantic?.declarations), 'missing manifest semantic module');
  for (const [name, value] of [['sourceManifestSha256Base32', sha256Base32(sha(canonical(manifest)))], ['sourceManifestFileCount', String(manifest.files.length)]]) {
    const declarations = core[0].semantic.declarations.filter(declaration => declaration.name === name);
    requireThat(declarations.length === 1 && canonical(declarations[0]) === canonical(manifestDefinition(name, value)),
      `modeled ${name} differs from complete tracked source manifest`);
  }
  const identity = capture => ({
    capture_digest: digest(canonical(capture)),
    compiler_semantics_id: capture.snapshot.compiler_semantics_id,
    emitter_semantics_id: capture.model.provenance.emitter_semantics_id,
    entity_count: capture.check.entity_count,
    lock_digest: digest(capture.lock),
    model_id: capture.check.model_id,
    result_digest: digest(`${canonical(capture.check)}\n`),
    semantic_id: capture.check.semantic_id,
    snapshot_id: capture.check.snapshot_id,
    source_id: capture.snapshot.source_id
  });
  return { current: identity(current), prior: identity(prior), shared_content_digest: digest(content(before)), shared_model_digest: digest(modelContent(prior.model)) };
}

function emit(root, work, archiveSha, binarySha, sourceCommit) {
  const envelope = join(work, 'envelope');
  const manifest = document(join(envelope, 'source-manifest.json'));
  requireThat(canonical(manifest) === canonical(sourceManifest(root)), 'tracked source changed during bootstrap');
  const priorLock = execFileSync('git', ['-C', root, 'show', `${sourceCommit}:lexlean.lock`], { maxBuffer: LIMIT }).toString('utf8');
  const prior = document(join(work, 'prior-capture.json'));
  const current = document(join(work, 'current-capture.json'));
  const production = document(join(work, 'production.json'), true);
  check(production);
  const evidence = {
    bootstrap: { archive_digest: `sha256:${archiveSha}`, binary_digest: `sha256:${binarySha}`, source_commit: sourceCommit, version: '0.2.0' },
    compatibility_projection: compare(prior, current, manifest, priorLock, regular(join(root, 'lexlean.lock')).toString('utf8')),
    production_model: { ...production, result_digest: digest(`${canonical(production)}\n`) },
    schema: 'prismpm/bootstrap-evidence/2',
    source_manifest: { digest: digest(canonical(manifest)), file_count: manifest.files.length },
    status: 'passed'
  };
  writeFileSync(join(work, 'evidence.json'), canonical(evidence));
}

export function publish(root, work) {
  const target = join(root, 'target');
  mkdirSync(target, { recursive: true });
  const manifest = document(join(work, 'envelope/source-manifest.json'));
  requireThat(canonical(manifest) === canonical(sourceManifest(root)), 'tracked source changed before evidence publication');
  // Evidence is published last; its digests never authenticate partial inputs.
  for (const [source, name] of [
    ['prior-capture.json', 'bootstrap-prior-capture.json'],
    ['current-capture.json', 'bootstrap-current-capture.json'],
    ['envelope/source-manifest.json', 'bootstrap-source-manifest.json'],
    ['evidence.json', 'bootstrap-evidence.json']
  ]) {
    const destination = join(target, name);
    const temporary = `${destination}.${process.pid}.tmp`;
    writeFileSync(temporary, regular(join(work, source)), { flag: 'wx' });
    renameSync(temporary, destination);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  const commands = { prepare: [2, prepare], capture: [4, captureProjection], emit: [5, emit], publish: [2, publish] };
  requireThat(commands[command] && args.length === commands[command][0], 'invalid bootstrap evidence arguments');
  commands[command][1](...args);
}
