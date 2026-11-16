// The build tiers: where the LexLean project is found for `verify --lean`, and the command it runs in the image.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lexleanProjectArgument, lexleanProjectDir } from '../src/tiers.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const template = fileURLToPath(new URL('../templates/text-request', import.meta.url));
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-tiers-'));

test('the LexLean project is the root, or found between the model sources and the root', () => {
  assert.equal(lexleanProjectDir(template, 'src'), '.');
  const nested = scratch();
  mkdirSync(join(nested, 'app', 'src'), { recursive: true });
  writeFileSync(join(nested, 'app', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  assert.equal(lexleanProjectDir(nested, 'app/src'), 'app');
  assert.equal(lexleanProjectDir(nested, 'app'), 'app');
  assert.equal(lexleanProjectDir(nested), 'app', 'with no [model] source, the one project directly under the root');
  assert.throws(() => lexleanProjectDir(scratch()), (e) => e.code === 'tier.project' && /no lexlean\.toml/.test(e.message));
  assert.throws(() => lexleanProjectDir(nested, 'elsewhere/src'), (e) => e.code === 'tier.project');
  assert.throws(() => lexleanProjectDir(nested, '../outside'), (e) => e.code === 'tier.project', 'a source outside the root is never searched');
});

test('a template instance: no prism.toml, the one LexLean project directly under the root; two need --project', () => {
  const instance = scratch();
  mkdirSync(join(instance, 'app'));
  writeFileSync(join(instance, 'app', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  mkdirSync(join(instance, 'node_modules', 'x'), { recursive: true });
  writeFileSync(join(instance, 'node_modules', 'x', 'lexlean.toml'), '');
  assert.equal(lexleanProjectDir(instance), 'app', 'node_modules is never a project');
  mkdirSync(join(instance, 'gateway'));
  writeFileSync(join(instance, 'gateway', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  assert.throws(() => lexleanProjectDir(instance), (e) => e.code === 'tier.project' && /2 LexLean projects here \(app, gateway\); name one with --project/.test(e.message));
  assert.equal(lexleanProjectDir(instance, null, 'gateway'), 'gateway');
  assert.throws(() => lexleanProjectDir(instance, null, 'missing'), (e) => e.code === 'tier.project');
  assert.throws(() => lexleanProjectDir(instance, null, '..'), (e) => e.code === 'tier.project' && /outside/.test(e.message));
});

test('the --project argument names the file inside the container', () => {
  assert.equal(lexleanProjectArgument('C:\\app', '.', 'win32'), '/work/lexlean.toml');
  assert.equal(lexleanProjectArgument('C:\\app', 'app', 'win32'), '/work/app/lexlean.toml');
  assert.equal(lexleanProjectArgument('/home/u/app', 'app', 'linux'), '/home/u/app/app/lexlean.toml');
});

test('verify --lean runs lexlean verify in the image without the Docker socket with --local (dry run)', () => {
  const dir = scratch();
  writeFileSync(join(dir, 'prismpm.lock'), JSON.stringify({ sdk_image: IMAGE }));
  mkdirSync(join(dir, 'app', 'src'), { recursive: true });
  writeFileSync(join(dir, 'app', 'lexlean.toml'), 'spec = "lexlean/project/1"\n');
  writeFileSync(join(dir, 'prism.toml'), '[application]\nname = "tiers"\nversion = "0.1.0"\n\n[model]\nsource = "app/src"\n\n[capabilities]\n');
  const env = { ...process.env, PRISM_CODE_DRY_RUN: '1', PRISM_HOME: join(scratch(), '.prism') };
  const r = spawnSync(process.execPath, [bin, 'verify', '--lean', '--local', '--all'], { cwd: dir, env, encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const workdir = process.platform === 'win32' ? '/work' : realpathSync(dir);
  assert.ok(r.stdout.endsWith(`${IMAGE} lexlean verify --project ${workdir}/app/lexlean.toml --all\n`), r.stdout);
  assert.ok(!r.stdout.includes('docker.sock'), 'no socket for a Lean-only verify');
  assert.ok(spawnSync(process.execPath, [bin, 'verify'], { cwd: dir, env, encoding: 'utf8' }).stdout.includes(`${IMAGE} prismpm verify`));
  const named = spawnSync(process.execPath, [bin, 'verify', '--lean', '--local', '--project', 'app', '--all'], { cwd: dir, env, encoding: 'utf8' });
  assert.ok(named.stdout.endsWith(`lexlean verify --project ${workdir}/app/lexlean.toml --all\n`), named.stdout);
  const bare = spawnSync(process.execPath, [bin, 'verify', '--lean'], { cwd: scratch(), env, encoding: 'utf8' });
  assert.equal(bare.status, 64, 'no lockfile is usage, as for every delegated verb');
});
