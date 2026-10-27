// prism-code init (issue #281): a scaffolded project, the SDK binding commands, and the CLI.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TEMPLATES, DEFAULT_TEMPLATE, IMAGE_STANDARDS_LOCK, templateFiles, manifestText, nameFromDirectory, planInit, bindCommands } from '../src/init.mjs';
import { parseManifest } from '../src/manifest.mjs';
import { parseToml } from '../src/toml.mjs';
import { readManifest } from '../src/node.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const createBin = fileURLToPath(new URL('../../create-prism-code/bin/create-prism-code.mjs', import.meta.url));
const REPO = fileURLToPath(new URL('../../../../', import.meta.url));
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';

const scratch = () => mkdtempSync(join(tmpdir(), 'prism-init-'));
const run = (file, args, options = {}) => {
  const r = spawnSync(process.execPath, [file, ...args], { encoding: 'utf8', ...options });
  return { code: r.status, out: r.stdout, err: r.stderr };
};
const walk = (root, dir = root, out = []) => {
  for (const e of readdirSync(dir).sort()) {
    const f = join(dir, e);
    if (statSync(f).isDirectory()) walk(root, f, out);
    else out.push(relative(root, f).split(sep).join('/'));
  }
  return out;
};
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('each template is its fixture, byte for byte, so the gate that checks the fixture vouches for the template', () => {
  for (const [name, template] of Object.entries(TEMPLATES)) {
    const origin = join(REPO, template.origin);
    const files = templateFiles(name);
    assert.deepEqual([...files.keys()].sort(), walk(origin).sort(), name);
    for (const [path, bytes] of files) assert.equal(Buffer.from(bytes).toString('utf8'), readFileSync(join(origin, path), 'utf8').replaceAll('\r\n', '\n'), `${name}/${path}`);
  }
  const sync = run(fileURLToPath(new URL('../scripts/sync-templates.mjs', import.meta.url)), ['--check']);
  assert.equal(sync.code, 0, sync.err);
});

test('the template lexlean.lock binds the template bytes it ships with', () => {
  const files = templateFiles(DEFAULT_TEMPLATE);
  // The lock has arrays of tables, which the manifest's strict TOML reader refuses by design; its head is plain keys.
  const text = Buffer.from(files.get('lexlean.lock')).toString('utf8');
  const lock = parseToml(text.slice(0, text.indexOf('[[')));
  assert.equal(lock.spec, 'lexlean/lock/2');
  assert.equal(lock.language, '1.2');
  const pins = [...text.matchAll(/\[\[workspace_file\]\]\npath = "([^"]+)"\nsha256 = "([0-9a-f]{64})"/g)];
  assert.ok(pins.length >= 3);
  for (const [, path, digest] of pins) assert.equal(sha256(files.get(path)), digest, path);
  assert.equal(sha256(files.get('lexlean.toml')), lock.project_config_sha256);
});

test('the generated prism.toml is a valid manifest that grants nothing', () => {
  const text = manifestText('calculator');
  const { manifest, warnings } = parseManifest(text);
  assert.deepEqual(warnings, []);
  assert.equal(manifest.application.name, 'calculator');
  assert.equal(manifest.application.version, '0.1.0');
  assert.equal(manifest.model.source, 'src');
  assert.deepEqual(manifest.capabilities, {});
  assert.throws(() => manifestText('Calculator'), (e) => e.code === 'manifest.invalid');
});

test('a project name comes from the directory', () => {
  assert.equal(nameFromDirectory('/home/me/My Calculator'), 'my-calculator');
  assert.equal(nameFromDirectory('C:\\work\\2026_app\\'), 'app');
  assert.equal(nameFromDirectory('/'), 'app');
  assert.equal(nameFromDirectory('/x/' + 'a'.repeat(80)), 'a'.repeat(63));
});

test('planInit is the template plus prism.toml; an unknown template is refused', () => {
  const files = planInit({ name: 'calc' });
  assert.ok(files.has('prism.toml') && files.has('lexlean.lock') && files.has('prismpm.toml') && files.has('src/TextRequest.lex.tex'));
  assert.equal(files.size, templateFiles().size + 1);
  assert.throws(() => planInit({ name: 'calc', template: 'nope' }), (e) => e.code === 'init.template' && /text-request/.test(e.message));
});

test('binding takes the image standards.lock and runs prismpm update --toolchain in the project', () => {
  const { standards, update } = bindCommands({ image: IMAGE, cwd: '/work/calc', uid: 1000, gid: 1000, platform: 'linux' });
  assert.deepEqual(standards, ['run', '--rm', '--network', 'none', '--entrypoint', 'cat', IMAGE, IMAGE_STANDARDS_LOCK]);
  assert.deepEqual(update.slice(-5), [IMAGE, 'prismpm', 'update', '--toolchain', IMAGE]);
  assert.ok(update.includes('--volume') && update.includes('/work/calc:/work/calc'));
  for (const bad of [undefined, 'ghcr.io/x/y:latest', 'ghcr.io/x/y@sha256:abc']) assert.throws(() => bindCommands({ image: bad, cwd: '/w' }), (e) => e.code === 'lock.image');
});

test('prism-code init scaffolds a project that prism-code manifest reads', async () => {
  const dir = join(scratch(), 'my-calc');
  const r = run(bin, ['init', dir]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /^Creating my-calc in /);
  assert.match(r.out, /Not bound to an SDK/);
  assert.equal(readFileSync(join(dir, 'lexlean.lock'), 'utf8'), Buffer.from(templateFiles().get('lexlean.lock')).toString('utf8'));
  assert.ok(!existsSync(join(dir, 'prismpm.lock')), 'no SDK named, no lock');
  const { manifest, grant } = await readManifest(dir);
  assert.equal(manifest.application.name, 'my-calc');
  assert.deepEqual(grant.capabilities.sets.default, {});
  assert.equal(run(bin, ['manifest', dir]).code, 0);
});

test('init refuses to overwrite, names the files, and --force overwrites', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'prism.toml'), 'keep');
  const r = run(bin, ['init', dir]);
  assert.equal(r.code, 2);
  assert.match(r.err, /^init\.exists: .*prism\.toml.* already exist/);
  assert.equal(readFileSync(join(dir, 'prism.toml'), 'utf8'), 'keep');
  assert.equal(run(bin, ['init', dir, '--force']).code, 0);
  assert.notEqual(readFileSync(join(dir, 'prism.toml'), 'utf8'), 'keep');
});

test('init: --name, a bad name, an unknown template, usage errors', () => {
  const dir = scratch();
  assert.equal(run(bin, ['init', join(dir, 'a'), '--name', 'calculator']).code, 0);
  assert.match(readFileSync(join(dir, 'a', 'prism.toml'), 'utf8'), /name = "calculator"/);
  const bad = run(bin, ['init', join(dir, 'b'), '--name', 'Bad Name']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /^manifest\.invalid: application\.name/);
  assert.equal(run(bin, ['init', join(dir, 'c'), '--template', 'nope']).code, 2);
  assert.equal(run(bin, ['init', '--sdk-image']).code, 64);
  assert.equal(run(bin, ['init', 'a', 'b']).code, 64);
  assert.equal(run(bin, ['init', '--frobnicate']).code, 64);
  assert.match(run(bin, ['init', '--help']).out, /--sdk-image <ref>/);
});

test('init --sdk-image prints the two docker commands under PRISM_CODE_DRY_RUN', () => {
  const dir = join(scratch(), 'bound');
  const r = run(bin, ['init', dir, '--sdk-image', IMAGE], { env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(r.code, 0, r.err);
  const lines = r.out.trim().split('\n').slice(-2);
  assert.match(lines[0], new RegExp(`^docker run --rm --network none --entrypoint cat ${IMAGE.replace(/[.@]/g, '\\$&')} /opt/prismpm/share/standards\\.lock > standards\\.lock$`));
  assert.match(lines[1], new RegExp(`prismpm update --toolchain ${IMAGE.replace(/[.@]/g, '\\$&')}$`));
  const refused = run(bin, ['init', join(scratch(), 'x'), '--sdk-image', 'ghcr.io/x/y:latest'], { env: { ...process.env, PRISM_CODE_DRY_RUN: '1' } });
  assert.equal(refused.code, 2);
  assert.match(refused.err, /^lock\.image:/);
});

test('npm create prism-code is prism-code init', () => {
  const root = scratch();
  const viaCreate = run(createBin, ['proj', '--name', 'same'], { cwd: root });
  assert.equal(viaCreate.code, 0, viaCreate.err);
  mkdirSync(join(root, 'other'));
  assert.equal(run(bin, ['init', 'proj2', '--name', 'same'], { cwd: root }).code, 0);
  const a = walk(join(root, 'proj'));
  assert.deepEqual(a, walk(join(root, 'proj2')));
  for (const path of a) assert.ok(readFileSync(join(root, 'proj', path)).equals(readFileSync(join(root, 'proj2', path))), path);
});

test('a bound project points at build --check, the model check, not the deprecated bare check (#368)', { skip: process.platform === 'win32' && 'the docker stub is a POSIX shell script' }, () => {
  // A stub docker on PATH: `cat` of the image standards.lock prints a fixed file; `prismpm update` writes prismpm.lock.
  const stubDir = scratch();
  const stub = join(stubDir, 'docker');
  writeFileSync(
    stub,
    [
      '#!/bin/sh',
      'case "$*" in',
      '  *"--entrypoint cat"*) printf \'{"stub":"standards"}\' ;;',
      '  *"prismpm update --toolchain"*) prev=; for a in "$@"; do [ "$prev" = --workdir ] && d="$a"; prev="$a"; done; printf \'{"stub":"lock"}\' > "$d/prismpm.lock" ;;',
      '  *) exit 9 ;;',
      'esac',
      '',
    ].join('\n'),
    { mode: 0o755 },
  );
  const dir = join(scratch(), 'bound');
  const r = run(bin, ['init', dir, '--sdk-image', IMAGE], { env: { ...process.env, PATH: `${stubDir}:${process.env.PATH}` } });
  assert.equal(r.code, 0, r.err);
  assert.equal(readFileSync(join(dir, 'standards.lock'), 'utf8'), '{"stub":"standards"}');
  assert.ok(existsSync(join(dir, 'prismpm.lock')));
  assert.match(r.out, /Done\. Next: cd .* && npx prism-code build --check\n$/);
  assert.doesNotMatch(r.out, /prism-code check\n/);
});
