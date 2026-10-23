// Readiness for the owner's first crates.io upload (#214): what crates.io needs
// from each archive, that the stdlib archive is the one the SDK embeds, and that
// the upload path refuses to run without a credential or from a dirty tree.
// Nothing here uploads, and nothing here needs a token.
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { copyFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repository = join(dirname(fileURLToPath(import.meta.url)), '..');
const check = join(repository, 'scripts/crate-metadata-check.sh');
const release = join(repository, 'scripts/package-release-crates.sh');
const reviewed = [
  'stdlib/generated/prism-stdlib-0.2.0.crate',
  'vendor/lean4-prod/crates/prod-ir-0.1.0.crate',
  'vendor/lean4-prod/crates/prod-codegen-0.1.0.crate',
].map(path => join(repository, path));

const scratch = () => mkdtempSync(join(tmpdir(), 'prismpm-crate-readiness-'));
const run = (command, args, options = {}) => spawnSync(command, args, {encoding: 'utf8', ...options});

// A minimal archive shaped like `cargo package` output: <name>-<version>/Cargo.toml and files.
function crate(directory, {name = 'sample', manifest, files = {'README.md': '# sample\n'}, padding = 0} = {}) {
  const root = join(directory, `${name}-1.0.0`);
  mkdirSync(root, {recursive: true});
  const lines = ['[package]', `name = "${name}"`, 'version = "1.0.0"',
    ...(manifest ?? ['description = "A sample"', 'license = "MIT"', 'repository = "https://example.test/sample"', 'readme = "README.md"'])];
  writeFileSync(join(root, 'Cargo.toml'), lines.join('\n') + '\n');
  for (const [file, text] of Object.entries(files)) writeFileSync(join(root, file), text);
  if (padding) writeFileSync(join(root, 'padding.bin'), randomBytes(padding));
  const archive = join(directory, `${name}-1.0.0.crate`);
  execFileSync('tar', ['-C', directory, '-czf', archive, `${name}-1.0.0`]);
  return archive;
}

test('every reviewed archive meets the crates.io metadata and size requirements', () => {
  const result = run('sh', [check, ...reviewed]);
  assert.equal(result.status, 0, result.stderr);
});

test('an archive without what crates.io needs is refused, naming the defect', () => {
  const directory = scratch();
  try {
    assert.equal(run('sh', [check, crate(directory, {name: 'good'})]).status, 0);
    const base = ['description = "A sample"', 'license = "MIT"', 'repository = "https://example.test/sample"', 'readme = "README.md"'];
    const plants = [
      ['no description', {manifest: base.filter(line => !line.startsWith('description'))}, /no `description`/],
      ['no license', {manifest: base.filter(line => !line.startsWith('license'))}, /neither `license` nor `license-file`/],
      ['no repository', {manifest: base.filter(line => !line.startsWith('repository'))}, /no `repository`/],
      ['a readme the archive lacks', {files: {}}, /names a file the archive does not carry/],
      ['more than the crates.io limit of 10 MiB', {padding: 11 * 1024 * 1024}, /exceeds the crates\.io limit/],
    ];
    for (const [label, options, message] of plants) {
      const result = run('sh', [check, crate(directory, {name: label.replace(/\W+/g, '-'), ...options})]);
      assert.notEqual(result.status, 0, `${label} must be refused`);
      assert.match(result.stderr, message, label);
    }
    const missing = run('sh', [check, join(directory, 'absent.crate')]);
    assert.notEqual(missing.status, 0);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

// The part of the repository `--identity` reads: the include in application_build.rs, the
// stdlib release record, and the reviewed archive.
function identityTree(directory) {
  mkdirSync(join(directory, 'scripts'), {recursive: true});
  copyFileSync(release, join(directory, 'scripts/package-release-crates.sh'));
  copyFileSync(check, join(directory, 'scripts/crate-metadata-check.sh'));
  mkdirSync(join(directory, 'crates/prismpm/src'), {recursive: true});
  copyFileSync(join(repository, 'crates/prismpm/src/application_build.rs'), join(directory, 'crates/prismpm/src/application_build.rs'));
  mkdirSync(join(directory, 'stdlib/generated'), {recursive: true});
  copyFileSync(join(repository, 'stdlib/release.json'), join(directory, 'stdlib/release.json'));
  copyFileSync(reviewed[0], join(directory, 'stdlib/generated/prism-stdlib-0.2.0.crate'));
  return join(directory, 'scripts/package-release-crates.sh');
}

test('the stdlib archive must be the crate the SDK embeds, the record names, and the reviewed copy', () => {
  const directory = scratch();
  try {
    const script = identityTree(directory);
    const embedded = join(directory, 'stdlib/generated/prism-stdlib-0.2.0.crate');
    const identity = (packaged = embedded) => run('sh', [script, '--identity', packaged]);
    assert.equal(identity().status, 0, 'the reviewed archive is the embedded one');

    // A packaged archive that differs from the embedded crate by one byte.
    const bytes = readFileSync(embedded);
    const altered = Buffer.from(bytes); altered[altered.length - 1] ^= 1;
    const packaged = join(directory, 'packaged.crate');
    writeFileSync(packaged, altered);
    assert.notEqual(identity(packaged).status, 0, 'a package that differs from the embedded crate is refused');

    // The reviewed copy changes while the packaged archive stays: the record no longer names it.
    writeFileSync(embedded, altered);
    assert.notEqual(identity(reviewed[0]).status, 0, 'a reviewed copy that differs from the record is refused');
    writeFileSync(embedded, bytes);
    assert.equal(identity().status, 0);

    // The record names another archive hash.
    const record = join(directory, 'stdlib/release.json');
    const original = readFileSync(record, 'utf8');
    writeFileSync(record, original.replace(/"crate_sha256":"[0-9a-f]/, match => match.slice(0, -1) + (match.endsWith('0') ? '1' : '0')));
    assert.notEqual(identity().status, 0, 'a record that names another hash is refused');
    writeFileSync(record, original.replace('prism-stdlib-0.2.0.crate', 'prism-stdlib-9.9.9.crate'));
    assert.notEqual(identity().status, 0, 'a record that names another path is refused');
    writeFileSync(record, original);

    // The SDK stops including the reviewed archive.
    const source = join(directory, 'crates/prismpm/src/application_build.rs');
    const build = readFileSync(source, 'utf8');
    writeFileSync(source, build.replace('include_bytes!("../stdlib/generated/prism-stdlib-0.2.0.crate")', 'include_bytes!("../stdlib/other.crate")'));
    assert.notEqual(identity().status, 0, 'an SDK that embeds another file is refused');
    writeFileSync(source, build);
    assert.equal(identity().status, 0);
  } finally { rmSync(directory, {recursive: true, force: true}); }
});

test('the upload path refuses without a credential and from an unclean tree, before packaging anything', () => {
  const directory = scratch();
  try {
    const script = identityTree(directory);
    execFileSync('git', ['init', '-q'], {cwd: directory});
    execFileSync('git', ['add', '-A'], {cwd: directory});
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.test', 'commit', '-qm', 'fixture'], {cwd: directory});
    // Any cargo or curl call is a failure of the refusal: both are stubs that record themselves.
    const bin = join(directory, 'bin'); mkdirSync(bin);
    for (const tool of ['cargo', 'curl']) {
      writeFileSync(join(bin, tool), `#!/bin/sh\necho ${tool} >> "${directory}/called"\nexit 99\n`);
      chmodSync(join(bin, tool), 0o755);
    }
    const environment = token => ({PATH: `${bin}:${process.env.PATH}`, HOME: directory,
      ...(token ? {CARGO_REGISTRY_TOKEN: 'not-a-real-token'} : {})});
    const withoutToken = run('sh', [script, '--publish'], {env: environment(false), cwd: directory});
    assert.equal(withoutToken.status, 64);
    assert.match(withoutToken.stderr, /set CARGO_REGISTRY_TOKEN/);
    writeFileSync(join(directory, 'untracked.txt'), 'dirty\n');
    const dirty = run('sh', [script, '--publish'], {env: environment(true), cwd: directory});
    assert.equal(dirty.status, 1);
    assert.match(dirty.stderr, /working tree must be clean/);
    assert.ok(!existsSync(join(directory, 'called')), 'a refused upload must not reach cargo or the registry');
    assert.ok(!`${withoutToken.stdout}${withoutToken.stderr}${dirty.stdout}${dirty.stderr}`.includes('not-a-real-token'),
      'the token is never printed');
  } finally { rmSync(directory, {recursive: true, force: true}); }
});
