import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const initializer = fileURLToPath(new URL('../sdk/devcontainer-init.sh', import.meta.url));

function launch(limits, args) {
  const env = {...process.env};
  delete env.PRISMPM_EPHEMERAL_HOME;
  return spawnSync('/bin/sh', ['-c', `${limits}\nexec /bin/sh "$@"`, '--', initializer, ...args], {
    env, encoding: 'utf8', timeout: 10_000,
  });
}

test('SDK launcher supplies a bounded 64 MiB stack to the actual requested process', () => {
  const child = launch('ulimit -S -s 8192', ['/bin/sh', '-c', 'ulimit -S -s; ulimit -H -s']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 0, child.stderr);
  const [soft, hard] = child.stdout.trim().split('\n');
  assert.equal(soft, '65536');
  const baseline = spawnSync('/bin/sh', ['-c', 'ulimit -H -s'], {encoding: 'utf8'});
  assert.equal(baseline.status, 0);
  assert.equal(hard, baseline.stdout.trim(), 'the SDK must preserve the host hard limit');
});

test('SDK launcher refuses an insufficient hard stack limit before executing the command', () => {
  const child = launch('ulimit -S -s 8192\nulimit -H -s 8192', ['/bin/sh', '-c', 'printf command-executed']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.notEqual(child.status, 0);
  assert.equal(child.stdout, '');
  assert.match(child.stderr, /ulimit|stack/i);
});

test('SDK launcher preserves requested argv and nonzero exit status', () => {
  const child = launch('ulimit -S -s 8192', ['/bin/sh', '-c', 'printf "%s\\n" "$1"; exit 23', '--', 'literal argument']);
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 23);
  assert.equal(child.stdout, 'literal argument\n');
});

// sdk/cargo-home.sh, exercised with an explicit small seed and home instead of
// the image's 1.15 GB /opt/prismpm/cargo-home.
const cargoHome = fileURLToPath(new URL('../sdk/cargo-home.sh', import.meta.url));

function tree(root) {
  const files = {};
  const visit = (directory, prefix) => {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix ? `${prefix}/${name}` : name;
      if (statSync(path).isDirectory()) visit(path, relative);
      else files[relative] = readFileSync(path).toString('hex');
    }
  };
  visit(root, '');
  return files;
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'prismpm-cargo-home-'));
  t.after(() => {
    spawnSync('chmod', ['-R', 'u+rwX', root]);
    rmSync(root, {recursive: true, force: true});
  });
  const seed = join(root, 'seed');
  mkdirSync(join(seed, 'registry/cache/index'), {recursive: true});
  mkdirSync(join(seed, 'git/db'), {recursive: true});
  writeFileSync(join(seed, 'registry/cache/index/locked-1.0.0.crate'), Buffer.alloc(65536, 7));
  writeFileSync(join(seed, 'git/db/pack'), 'pinned');
  spawnSync('chmod', ['-R', 'a-w', seed]);
  return {seed, home: join(root, 'home'), before: tree(seed)};
}

function seedHome(seed, home, limit = '', env = process.env) {
  return spawnSync('/bin/sh', ['-c', `${limit}\nexec /bin/sh "$@"`, '--', cargoHome, seed, home], {
    encoding: 'utf8', timeout: 30_000, env,
  });
}

const seedOnly = files => Object.fromEntries(Object.entries(files).filter(([name]) => name.startsWith('registry/') || name.startsWith('git/')));
const staging = home => readdirSync(home).filter(name => name.startsWith('.seeding.'));

test('Cargo home seeding copies the seed into an empty home, marks it last and never writes the seed', t => {
  const {seed, home, before} = fixture(t);
  const child = seedHome(seed, home);
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout, `${home}\n`);
  assert.deepEqual(seedOnly(tree(home)), before);
  assert(existsSync(join(home, '.seeded')));
  assert.deepEqual(staging(home), []);
  assert.deepEqual(tree(seed), before, 'the seed is only read');
  writeFileSync(join(home, 'registry/cache/index/new.crate'), 'writable by the executing identity');
});

test('Cargo home seeding reuses a home marked complete without copying', t => {
  const {seed, home} = fixture(t);
  mkdirSync(join(home, 'registry'), {recursive: true});
  writeFileSync(join(home, 'registry/kept'), 'pre-seeded');
  writeFileSync(join(home, '.seeded'), '');
  const child = seedHome(seed, home);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(tree(join(home, 'registry')), {kept: Buffer.from('pre-seeded').toString('hex')});
});

test('Cargo home seeding replaces a partial home that was never marked complete and keeps unrelated content', t => {
  const {seed, home, before} = fixture(t);
  mkdirSync(join(home, 'registry/cache/index'), {recursive: true});
  writeFileSync(join(home, 'registry/cache/index/locked-1.0.0.crate'), Buffer.alloc(512, 7));
  mkdirSync(join(home, 'bin'));
  writeFileSync(join(home, 'bin/tool'), 'installed by the user');
  const child = seedHome(seed, home);
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(seedOnly(tree(home)), before);
  assert.equal(readFileSync(join(home, 'bin/tool'), 'utf8'), 'installed by the user');
  assert(existsSync(join(home, '.seeded')));
});

test('Cargo home seeding interrupted mid-copy stays incomplete, and the next start completes it', t => {
  const {seed, home, before} = fixture(t);
  // A file-size limit kills cp partway through the 64 KiB crate, as a signal or
  // ENOSPC would: the home must not be marked complete.
  const interrupted = seedHome(seed, home, 'ulimit -f 16');
  assert.notEqual(interrupted.status, 0);
  assert(!existsSync(join(home, '.seeded')));
  assert.equal(staging(home).length, 1, 'the partial copy stays in staging, not in the home');
  assert(!existsSync(join(home, 'registry')));
  const retried = seedHome(seed, home);
  assert.equal(retried.status, 0, retried.stderr);
  assert.deepEqual(seedOnly(tree(home)), before);
  assert(existsSync(join(home, '.seeded')));
  assert.deepEqual(staging(home), [], 'stale staging is discarded on retry');
  assert.deepEqual(tree(seed), before);
});

test('Cargo home seeding publishes completion only after a root caller transfers ownership, and retries a failed transfer', t => {
  const {seed, home, before} = fixture(t);
  // Model a root caller without privileges or executable temporary files:
  // shell functions take precedence over PATH, so `id -u` reports 0 and
  // `chown` records its arguments and fails (73) until the control file exists.
  const control = join(home, '..');
  const log = join(control, 'chown.log');
  const allow = join(control, 'chown-allowed');
  const asRoot = () => spawnSync('/bin/sh', ['-c', `
    id() { if [ "$1" = -u ]; then echo 0; else command id "$@"; fi; }
    chown() { printf '%s\\n' "$*" >> "$LOG"; [ -e "$ALLOW" ] || return 73; }
    set -- "$SEED" "$HOME_UNDER_TEST"
    . "$HELPER"`], {
    encoding: 'utf8', timeout: 30_000,
    env: {...process.env, LOG: log, ALLOW: allow, SEED: seed, HOME_UNDER_TEST: home, HELPER: cargoHome},
  });
  const failed = asRoot();
  assert.equal(failed.status, 73, failed.stderr);
  assert(!existsSync(join(home, '.seeded')), 'no completion marker before the ownership transfer succeeds');
  writeFileSync(allow, '');
  const retried = asRoot();
  assert.equal(retried.status, 0, retried.stderr);
  assert(existsSync(join(home, '.seeded')));
  assert(!existsSync(join(home, '.seeded.pending')));
  assert.deepEqual(seedOnly(tree(home)), before);
  assert.deepEqual(readFileSync(log, 'utf8').trim().split('\n'),
    [`-R 1000:1000 ${home}`, `-R 1000:1000 ${home}`, `1000:1000 ${home}/.seeded.pending`],
    'the retry repeats the ownership transfer before publishing completion');
  assert.deepEqual(tree(seed), before);
});
