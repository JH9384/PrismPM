import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const root = fileURLToPath(new URL('../', import.meta.url));
const corpus = 'standards/oracles/openid-conformance-suite-3e09b13b';
const git = (repo, args, options = {}) => execFileSync('git', args, {
  cwd: repo, maxBuffer: 128 * 1024 * 1024, ...options,
});

// Reconstruct checkout content from index blobs, never the local working tree.
// Compare sibling names before descending, exactly as regular_tree in Rust.
function indexDigest(repo, prefix, env = process.env, profile = {}) {
  const rows = git(repo, ['ls-files', '--stage', '-z', '--', `${prefix}/`], { env })
    .toString('utf8').split('\0').filter(Boolean).map(row => {
      const match = /^(100644|100755) ([a-f0-9]{40}|[a-f0-9]{64}) 0\t(.+)$/.exec(row);
      assert.ok(match, `corpus index entry is not an unambiguous regular file: ${row}`);
      assert.ok(match[3].startsWith(`${prefix}/`));
      const path = match[3].slice(prefix.length + 1);
      assert.ok(path.split('/').every(part => part && part !== '.' && part !== '..'));
      return { path, oid: match[2] };
    });
  assert.ok(rows.length, 'corpus has no tracked files');
  rows.sort((left, right) => {
    if (profile.global) return Buffer.compare(Buffer.from(left.path), Buffer.from(right.path));
    const a = left.path.split('/');
    const b = right.path.split('/');
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      const difference = Buffer.compare(Buffer.from(a[i]), Buffer.from(b[i]));
      if (difference) return difference;
    }
    return a.length - b.length;
  });
  const blobs = git(repo, ['cat-file', '--batch'], {
    env, input: rows.map(row => `${row.oid}\n`).join(''),
  });
  const digest = createHash('sha256');
  if (profile.files) assert.deepEqual(rows.map(row => row.path), Object.keys(profile.files)
    .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
  let offset = 0;
  for (const row of rows) {
    const end = blobs.indexOf(10, offset);
    assert.ok(end >= offset, 'Git blob header is absent');
    const header = /^([a-f0-9]+) blob ([0-9]+)$/.exec(blobs.subarray(offset, end).toString('ascii'));
    assert.ok(header, 'Git object is not a blob');
    assert.equal(header[1], row.oid);
    const size = Number(header[2]);
    assert.ok(Number.isSafeInteger(size));
    offset = end + 1;
    assert.ok(offset + size < blobs.length, 'Git blob is truncated');
    if (profile.files) {
      assert.deepEqual(profile.files[row.path], {
        bytes: size,
        sha256: createHash('sha256').update(blobs.subarray(offset, offset + size)).digest('hex'),
      }, `imported member differs from tracked bytes: ${row.path}`);
    }
    const name = Buffer.from(row.path);
    const nameLength = Buffer.alloc(8);
    const byteLength = Buffer.alloc(8);
    nameLength.writeBigUInt64BE(BigInt(name.length));
    byteLength.writeBigUInt64BE(BigInt(size));
    digest.update(nameLength).update(name).update(byteLength).update(blobs.subarray(offset, offset + size));
    offset += size;
    assert.equal(blobs[offset++], 10);
  }
  assert.equal(offset, blobs.length, 'Git returned unexpected blob content');
  return digest.digest('hex');
}

test('OSCAL import descriptors bind the complete globally sorted validator corpora without acceptance claims', () => {
  const imported = JSON.parse(readFileSync(join(root, 'standards/imports/oscal-json-structural.json')));
  const source = readFileSync(join(root, 'sdk/oracles/oscal/src/main.rs'), 'utf8');
  const runtime = [...source.matchAll(/\btree\(\s*"([^"]+)",\s*"([a-f0-9]{64})",\s*(\d+),/g)]
    .map(row => ({directory: 'standards/corpora/' + row[1], digest: row[2], files: Number(row[3])}));
  assert.equal(runtime.length, 2, 'both original validator corpus bindings are required');
  const verify = value => {
    assert.equal(value.schema, 'prismpm/oscal-json-import-sources/1');
    assert.equal(value.scope, 'immutable-source-acquisition-only');
    assert.equal(value.oracle_acceptance, false);
    assert.equal(value.complete_standard_acceptance, false);
    assert.equal(value.tree_encoding, 'globally byte-sorted relative UTF-8 file paths; each path and its content preceded by unsigned 64-bit big-endian byte length');
    assert.deepEqual(value.corpora.map(row => row.directory), runtime.map(row => row.directory));
    for (const [index, row] of value.corpora.entries()) {
      assert.equal(row.expected_files, runtime[index].files);
      assert.equal(Object.keys(row.files).length, row.expected_files);
      assert.equal(row.expected_tree, runtime[index].digest);
      assert.equal(indexDigest(root, row.directory, process.env, {global: true, files: row.files}), row.expected_tree);
    }
  };
  verify(imported);
  for (const change of [
    value => { value.tree_encoding = 'directory traversal order'; },
    value => { value.corpora[0].expected_tree = 'd76b20f487c40a66ce929fe821ff8a36fac2dc33a7f0ade347086b23e84b3335'; },
    value => { delete value.corpora[0].files.LICENSE; },
    value => { value.corpora[0].files.LICENSE.sha256 = '0'.repeat(64); },
    value => { value.oracle_acceptance = true; },
    value => { value.complete_standard_acceptance = true; },
  ]) {
    const altered = structuredClone(imported); change(altered);
    assert.throws(() => verify(altered), undefined, 'incorrect corpus custody or acceptance must be refused');
  }
});

test('global corpus inventory follows UTF-8 byte order rather than UTF-16 code-unit order', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-corpus-utf8-'));
  try {
    git(scratch, ['init', '--quiet']);
    git(scratch, ['config', 'core.autocrlf', 'false']);
    mkdirSync(join(scratch, 'corpus'));
    const files = {};
    for (const name of ['\u{10000}', '\uE000']) {
      const bytes = Buffer.from(name + '\n');
      writeFileSync(join(scratch, 'corpus', name), bytes);
      files[name] = {bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex')};
    }
    git(scratch, ['add', '--', 'corpus']);
    const names = Object.keys(files);
    assert.notDeepEqual(names.slice().sort(), names.slice()
      .sort((a, b) => Buffer.compare(Buffer.from(a), Buffer.from(b))));
    assert.equal(indexDigest(scratch, 'corpus', process.env, {global: true, files}),
      indexDigest(scratch, 'corpus', process.env, {global: true}));
  } finally {
    rmSync(scratch, {recursive: true});
  }
});

test('OpenID corpus index reproduces the unchanged authoritative tree digest', () => {
  const catalog = readFileSync(join(root, 'model/authorities.toml'), 'utf8');
  const section = catalog.split('[[oracle]]').find(row => /^\s*id = "oidc-core-1.0-profile"$/m.test(row));
  assert.ok(section);
  const binding = /^corpus = \{ path = "([^"]+)", sha256 = "([a-f0-9]{64})" \}$/m.exec(section);
  assert.ok(binding);
  assert.equal(binding[1], corpus);
  const source = readFileSync(join(root, 'crates/prismpm/src/upstream_conformance.rs'), 'utf8');
  const runtime = /const OPENID_CONFORMANCE_TREE: &str =\s*"([a-f0-9]{64})";/.exec(source);
  assert.ok(runtime);
  assert.equal(runtime[1], binding[2], 'runtime and authority must bind the same unchanged tree');
  assert.equal(indexDigest(root, corpus), binding[2], 'clean checkouts must include the complete upstream corpus');

  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-corpus-index-'));
  try {
    const index = join(scratch, 'index');
    copyFileSync(resolve(root, git(root, ['rev-parse', '--git-path', 'index']).toString().trim()), index);
    const env = { ...process.env, GIT_INDEX_FILE: index };
    const paths = git(root, ['ls-files', '-z', '--', `${corpus}/.claude/`, `${corpus}/.idea/`])
      .toString().split('\0').filter(Boolean);
    assert.equal(paths.length, 10, 'all ten archive-verified upstream metadata files must be tracked');
    git(root, ['update-index', '--force-remove', '--', ...paths], { env });
    assert.notEqual(indexDigest(root, corpus, env), binding[2], 'ignored upstream files cannot be supplied by the working tree');
    assert.equal(indexDigest(root, corpus), binding[2], 'the real source index is unchanged by the planted omission');
  } finally {
    rmSync(scratch, { recursive: true });
  }
});

test('index closure rejects missing, changed, extra, and nonregular entries, independent of worktree bytes', () => {
  const scratch = mkdtempSync(join(tmpdir(), 'prismpm-corpus-fixture-'));
  try {
    git(scratch, ['init', '--quiet']);
    git(scratch, ['config', 'core.autocrlf', 'false']);
    const files = ['corpus/.idea/config', 'corpus/a/child', 'corpus/a.txt'];
    for (const path of files) {
      mkdirSync(dirname(join(scratch, path)), { recursive: true });
      writeFileSync(join(scratch, path), `${path}\n`);
    }
    git(scratch, ['add', '--', ...files]);
    const expected = indexDigest(scratch, 'corpus');
    const baseline = join(scratch, 'baseline-index');
    copyFileSync(join(scratch, '.git/index'), baseline);
    writeFileSync(join(scratch, files[0]), 'unstaged change');
    assert.equal(indexDigest(scratch, 'corpus'), expected, 'only the materialized Git closure is measured');
    for (const mutation of ['missing', 'changed', 'extra', 'symlink']) {
      copyFileSync(baseline, join(scratch, '.git/index'));
      if (mutation === 'missing') git(scratch, ['update-index', '--force-remove', '--', files[0]]);
      if (mutation === 'changed') git(scratch, ['add', '--', files[0]]);
      if (mutation === 'extra') {
        writeFileSync(join(scratch, 'corpus/extra'), 'extra source');
        git(scratch, ['add', '--', 'corpus/extra']);
      }
      if (mutation === 'symlink') {
        const oid = git(scratch, ['hash-object', '-w', '--stdin'], { input: 'outside' }).toString().trim();
        git(scratch, ['update-index', '--add', '--cacheinfo', `120000,${oid},corpus/link`]);
        assert.throws(() => indexDigest(scratch, 'corpus'), /unambiguous regular file/);
      } else {
        assert.notEqual(indexDigest(scratch, 'corpus'), expected, mutation);
      }
    }
  } finally {
    rmSync(scratch, { recursive: true });
  }
});
