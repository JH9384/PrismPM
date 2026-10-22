import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {posix} from 'node:path';

// This closed wire reader checks structure, never trust. Consumers must still
// authenticate the exact bytes against their independently pinned inventory.
export function decodeExporterSeed(bytes) {
  assert(bytes.length <= 8 * 1024 * 1024, 'bounded exporter manifest required');
  const text = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
  const value = JSON.parse(text);
  assert.equal(encodeInventory(value), text, 'canonical exporter manifest required');
  const closed = (object, keys) => {
    assert(object && typeof object === 'object' && !Array.isArray(object));
    assert.deepEqual(Object.keys(object).sort(), keys.sort(), 'closed exporter manifest fields required');
  };
  const digest = hash => { assert.equal(typeof hash, 'string'); assert.match(hash, /^[0-9a-f]{64}$/); };
  const mode = bits => assert(Number.isSafeInteger(bits) && bits >= 0 && bits <= 0o777);
  const relative = path => {
    assert.equal(typeof path, 'string');
    assert(path.length <= 4096 && path.split('/').every(part =>
      /^[A-Za-z0-9_.+-]+$/.test(part) && part !== '.' && part !== '..'), 'canonical relative compiler path required');
  };
  const absolute = path => {
    assert.equal(typeof path, 'string'); assert(path.startsWith('/'));
    relative(path.slice(1));
  };
  function file(row, maximum) {
    mode(row.mode); digest(row.sha256);
    assert(Number.isSafeInteger(row.byte_length) && row.byte_length >= 0 && row.byte_length <= maximum);
  }
  function tree(rows, maximum, totalMaximum, countMaximum, aliases = false) {
    assert(Array.isArray(rows) && rows.length > 0 && rows.length <= countMaximum);
    let previous = '', total = 0;
    const known = new Map();
    for (const row of rows) {
      relative(row.path); mode(row.mode);
      assert(Buffer.from(previous).compare(Buffer.from(row.path)) < 0, 'compiler paths must be sorted and unique');
      previous = row.path;
      if (row.kind === 'file') {
        closed(row, ['path', 'kind', 'mode', 'byte_length', 'sha256']); file(row, maximum);
        total += row.byte_length; assert(total <= totalMaximum, 'compiler aggregate size exceeded');
      } else if (row.kind === 'directory') closed(row, ['path', 'kind', 'mode']);
      else {
        assert(aliases && row.kind === 'symlink', 'compiler alias refused');
        closed(row, ['path', 'kind', 'mode', 'target']); relative(row.target);
      }
      const parent = posix.dirname(row.path);
      assert(parent === '.' || known.get(parent)?.kind === 'directory', 'compiler parent directory missing');
      known.set(row.path, row);
    }
    const resolvedAliases = new Set();
    for (const row of rows.filter(row => row.kind === 'symlink')) {
      let target = row;
      const visited = new Set();
      while (target?.kind === 'symlink' && !resolvedAliases.has(target.path)) {
        assert(!visited.has(target.path), 'cyclic toolchain alias refused');
        visited.add(target.path);
        target = known.get(posix.join(posix.dirname(target.path), target.target));
      }
      assert(target?.kind === 'file' || resolvedAliases.has(target?.path),
        'toolchain alias must identify a declared regular file');
      for (const path of visited) resolvedAliases.add(path);
    }
    return known;
  }
  closed(value, ['schema', 'platform', 'compiler_revision', 'archive_sha256', 'toolchain',
    'configuration', 'source_files', 'toolchain_files', 'runtime_files', 'files']);
  assert.equal(value.schema, 'prismpm/exporter-seed/1');
  assert(['linux/amd64', 'linux/arm64'].includes(value.platform));
  assert.equal(typeof value.compiler_revision, 'string'); assert.match(value.compiler_revision, /^[0-9a-f]{40}$/);
  digest(value.archive_sha256);
  assert.equal(typeof value.toolchain, 'string'); assert.match(value.toolchain, /^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/);
  const toolchain = '/usr/local/elan/toolchains/' + value.toolchain.replace('/', '--').replace(':', '---');
  assert.deepEqual(value.configuration, {
    argv: ['build', 'prod-export'], construction_root: '/tmp/prismpm-exporter-construction',
    temporary_directory: 'private-bounded-tmpfs', environment: {
      PATH: `${toolchain}/bin:/usr/bin:/bin`, LANG: 'C', LC_ALL: 'C', ELAN_HOME: '/usr/local/elan',
      ELAN_TOOLCHAIN: value.toolchain, LEAN_NUM_THREADS: '2', SOURCE_DATE_EPOCH: '0',
    },
  }, 'closed pinned exporter construction required');
  const sources = tree(value.source_files, 16 * 1024 ** 2, 16 * 1024 ** 2, 4096);
  assert.equal(sources.get('Prod/Export.lean')?.kind, 'file');
  assert(!value.source_files.some(row => row.path === '.lake' || row.path.startsWith('.lake/')));
  const tools = tree(value.toolchain_files, 1024 ** 3, 4 * 1024 ** 3, 32768, true);
  for (const path of ['bin/lean', 'bin/lake']) {
    const tool = tools.get(path);
    assert(tool?.kind === 'file' && tool.byte_length > 0 && (tool.mode & 0o111), 'executable compiler tool required');
  }
  assert(Array.isArray(value.runtime_files) && value.runtime_files.length > 0 && value.runtime_files.length <= 4096);
  let previous = '', runtimeTotal = 0;
  const runtimeIdentities = new Map();
  for (const row of value.runtime_files) {
    closed(row, ['selected', 'path', 'mode', 'byte_length', 'sha256']);
    absolute(row.selected); absolute(row.path); file(row, 1024 ** 3);
    assert(Buffer.from(previous).compare(Buffer.from(row.selected)) < 0, 'runtime paths must be sorted and unique');
    assert(!row.path.startsWith(toolchain + '/'), 'toolchain runtime must be in the toolchain closure');
    const identity = {mode: row.mode, byte_length: row.byte_length, sha256: row.sha256};
    if (runtimeIdentities.has(row.path)) assert.deepEqual(runtimeIdentities.get(row.path), identity,
      'runtime aliases disagree about their canonical file');
    runtimeIdentities.set(row.path, identity);
    previous = row.selected; runtimeTotal += row.byte_length; assert(runtimeTotal <= 4 * 1024 ** 3);
  }
  const files = tree(value.files, 256 * 1024 ** 2, 512 * 1024 ** 2, 4096);
  assert(value.files.every(row => row.path === '.lake' || row.path.startsWith('.lake/')));
  const executable = files.get('.lake/build/bin/prod-export');
  assert(executable?.kind === 'file' && executable.byte_length > 0 && (executable.mode & 0o111),
    'actual native exporter required');
  return value;
}

// Bind the produced executable separately from its complete seed manifest.
// These measurements are not a claim that a consumer or oracle executed it.
export function exporterArtifactBindings(bytes, revision, platform, observedExecutable) {
  const manifest = decodeExporterSeed(bytes);
  assert.equal(manifest.schema, 'prismpm/exporter-seed/1');
  assert.equal(manifest.compiler_revision, revision);
  assert.match(revision, /^[0-9a-f]{40}$/);
  assert(['linux/amd64', 'linux/arm64'].includes(platform));
  assert.equal(manifest.platform, platform, 'exporter must be built in its native runtime');
  assert(Array.isArray(manifest.files) && manifest.files.length <= 4096);
  const executable = manifest.files.filter(row => row.path === '.lake/build/bin/prod-export');
  assert.equal(executable.length, 1, 'exact native exporter artifact required');
  const [row] = executable;
  assert.equal(row.kind, 'file');
  assert(Number.isSafeInteger(row.mode) && row.mode >= 0 && row.mode <= 0o777 && (row.mode & 0o111));
  assert(Number.isSafeInteger(row.byte_length) && row.byte_length > 0 && row.byte_length <= 256 * 1024 * 1024);
  assert.match(row.sha256, /^[0-9a-f]{64}$/);
  assert.deepEqual(observedExecutable, {byte_length: row.byte_length, mode: row.mode, sha256: row.sha256},
    'actual native exporter differs from the seed manifest');
  return [
    {id: 'lean4-prod-exporter', kind: 'binary', version: revision, digest: `sha256:${row.sha256}`},
    {id: 'lean4-prod-exporter-seed', kind: 'dependency-lock', version: '1',
      digest: `sha256:${createHash('sha256').update(bytes).digest('hex')}`},
  ];
}

export function encodeInventory(value) {
  const canonical = item => Array.isArray(item) ? item.map(canonical)
    : item && typeof item === 'object'
    ? Object.fromEntries(Object.keys(item).sort((a, b) => Buffer.from(a).compare(Buffer.from(b)))
      .map(key => [key, canonical(item[key])])) : item;
  return `${JSON.stringify(canonical(value))}\n`;
}

// This bootstrap reader intentionally accepts only the register's closed
// string-valued TOML shape, not arbitrary TOML. A representation change fails
// closed and must update this reader alongside the authoritative Rust model.
export function compilerRevision(source) {
  const root = {};
  const dependencies = [];
  let table = root;
  for (const line of source.split('\n').map(line => line.trim())) {
    if (!line || line.startsWith('#')) continue;
    if (line === '[[dependency]]') {
      table = {};
      dependencies.push(table);
    } else if (line === '[[dependency.artifact]]') {
      assert.ok(dependencies.length, 'artifact has no dependency');
      table = {};
    } else {
      const match = /^([a-z][a-z0-9_]*) = ("(?:[^"\\]|\\["\\bfnrt]|\\u[0-9a-fA-F]{4})*")$/.exec(line);
      assert.ok(match, 'unsupported dependency-register syntax');
      assert.ok(!Object.hasOwn(table, match[1]), 'duplicate dependency-register field');
      table[match[1]] = JSON.parse(match[2]);
    }
  }
  assert.deepEqual(root, {spec: 'prismpm/dependencies/1'});
  assert.equal(new Set(dependencies.map(row => row.id)).size, dependencies.length);
  const matches = dependencies.filter(row => row.id === 'lean4-prod');
  assert.equal(matches.length, 1, 'exact lean4-prod authority is required');
  const dependency = matches[0];
  assert.deepEqual(Object.keys(dependency).sort(), ['id', 'lean_version', 'revision', 'source']);
  assert.equal(dependency.source, 'vendored');
  assert.match(dependency.lean_version, /^[0-9]+\.[0-9]+\.[0-9]+$/);
  assert.match(dependency.revision, /^[0-9a-f]{40}$/);
  return dependency.revision;
}

export function validateAuthorityMetadata(artifacts, revision) {
  const compiler = artifacts.filter(row => row.id === 'lean4-prod');
  const corpus = artifacts.filter(row => row.id === 'conformance-corpus');
  assert.equal(compiler.length, 1);
  assert.equal(compiler[0].version, revision, 'SDK compiler inventory names a stale authority revision');
  assert.equal(corpus.length, 1);
  assert.equal(corpus[0].version, 'prismpm/ids/1', 'SDK corpus metadata must identify its stable schema, not stale counts');
}

// These rows measure sealed input data, not a materialized checkout's mutable
// Git metadata and not proof that any acceptance command ran.
export function validateImageInputMetadata(artifacts, policy, manifest, manifestDigest, policyDigest) {
  assert.equal(manifest.schema, 'prismpm/sdk-vv-input-closure/1');
  assert.equal(manifest.scope, 'sdk-vv-inputs-only');
  assert.deepEqual(manifest.policy, policy);
  assert(Array.isArray(manifest.artifacts));
  assert.deepEqual(manifest.artifacts.map(row => row.path), ['advisory.pack', 'bootstrap.tar.gz', 'source.pack']);
  for (const row of manifest.artifacts) {
    assert.deepEqual(Object.keys(row).sort(), ['byte_length', 'path', 'sha256']);
    assert.match(row.sha256, /^[0-9a-f]{64}$/);
    assert(Number.isSafeInteger(row.byte_length) && row.byte_length > 0
      && row.byte_length <= (row.path === 'bootstrap.tar.gz' ? 64 : 256) * 1024 * 1024,
    'bounded sealed payload length required');
  }
  const payloads = new Map(manifest.artifacts.map(row => [row.path, row.sha256]));
  assert.equal(payloads.size, 3);
  assert.equal(payloads.get('bootstrap.tar.gz'), policy.bootstrap_sha256);
  const rows = [
    ['sdk-vv-source', policy.source_revision, `sha256:${payloads.get('source.pack')}`],
    ['sdk-vv-advisory', policy.advisory_revision, `sha256:${payloads.get('advisory.pack')}`],
    ['sdk-vv-bootstrap', '0.2.0', `sha256:${policy.bootstrap_sha256}`],
    ['sdk-vv-manifest', '1', manifestDigest],
    ['sdk-vv-policy', '1', policyDigest],
  ];
  for (const [id, version, digest] of rows) {
    const matches = artifacts.filter(row => row.id === id);
    assert.equal(matches.length, 1, `exact measured SDK input required: ${id}`);
    assert.deepEqual(matches[0], { id, kind: 'test-corpus', version, digest });
    assert.match(digest, /^sha256:[0-9a-f]{64}$/);
  }
  for (const [id, path] of [
    ['sdk-vv-verifier', 'scripts/sdk-vv-inputs.mjs'],
    ['sdk-image-input-verifier', 'scripts/sdk-image-inputs.mjs'],
    ['sdk-image-input-authorities', 'sdk/vv-inputs.lock.json'],
  ]) {
    const selected = manifest.source.files.filter(row => row.path === path);
    const rows = artifacts.filter(row => row.id === id);
    assert.equal(selected.length, 1); assert.equal(rows.length, 1);
    assert.deepEqual(rows[0], { id, kind: 'test-corpus', version: '1', digest: `sha256:${selected[0].sha256}` });
  }
}
