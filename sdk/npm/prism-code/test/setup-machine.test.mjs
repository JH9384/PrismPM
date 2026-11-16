// The machine half of prism-code setup: Node, Docker (native or inside WSL), the SDK image, its cache volume
// and line endings, planned on stand-in contexts and applied on fixture directories. No test probes this
// machine's Docker: the command line tests point PRISM_DOCKER at a stub that answers like a daemon.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GITATTRIBUTES_LINE, applyMachine, applyMachineStep, formatMachine, planMachine } from '../src/setup-machine.mjs';
import { readHostConfig } from '../src/host.mjs';
import { telemetryNotice } from '../src/gaps.mjs';
import { DEFAULT_SDK_IMAGE } from '../src/journey/sdk.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const IMAGE = 'ghcr.io/uor-foundation/prismpm-sdk@sha256:36da25ef924d84899453f24ec0c117a7a220e708037933eb8b499caa7723d99e';
const VOLUME = 'prism-sdk-cache-36da25ef924d';

const scratch = (prefix = 'prism-machine-') => mkdtempSync(join(tmpdir(), prefix));
const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

const NATIVE = { kind: 'native', command: '/usr/bin/docker', args: [], mount: 'native', version: '29.1.3', distro: null };
const WSL = { kind: 'wsl', command: 'C:\\Windows\\System32\\wsl.exe', args: ['-d', 'Ubuntu', '--', 'docker'], mount: 'wsl', version: '29.1.3', distro: 'Ubuntu' };

/** A context over a fixture project directory. `answers` maps a docker argument line to its stdout. */
function context({ cwd, configDir, resolved = NATIVE, answers = {}, nodeVersion = '22.21.0' }) {
  const calls = [];
  return {
    calls,
    platform: resolved.kind === 'wsl' ? 'win32' : 'linux',
    env: {},
    cwd,
    configDir,
    nodeVersion,
    exists: (path) => readText(path) !== null,
    readFile: readText,
    run: (command, args) => {
      // Docker's own arguments are cut off the line; git and gh, which the github row asks, have none.
      const line = args.slice(command === 'git' || command === 'gh' ? 0 : (resolved.args ?? []).length).join(' ');
      calls.push(line);
      const hit = Object.entries(answers).find(([key]) => line.startsWith(key));
      return hit ? { status: 0, stdout: hit[1], stderr: '' } : { status: 1, stdout: '', stderr: 'no' };
    },
    resolveDocker: () => resolved,
  };
}

const rows = (plan) => Object.fromEntries(plan.rows.map((row) => [row.id, row]));
const project = (lock = { sdk_image: IMAGE }) => {
  const dir = scratch();
  writeFileSync(join(dir, 'prismpm.lock'), JSON.stringify(lock));
  return dir;
};

test('a fresh machine: the image is deferred by default, with what runs without it and what pulls it', () => {
  const cwd = project();
  const configDir = join(scratch(), '.prism');
  const ctx = context({ cwd, configDir, resolved: WSL });
  const r = rows(planMachine({}, ctx));
  assert.equal(r.image.status, 'deferred', 'setup pulls nothing unless asked');
  assert.equal(r.image.steps, undefined);
  assert.match(r.image.detail, /is not here; build --check and verify --lean run hosted without it, and build, verify and axioms pull it on first use \(about 5.7 GB\); setup --pull gets it now/);
  assert.equal(r.cache.status, 'configure', 'the cache volume is cheap and ready for the first pull');
  assert.match(formatMachine(planMachine({}, ctx), { dryRun: true }), /image {11}deferred {12}ghcr\.io/);
});

test('a fresh machine with --pull: Docker is recorded, the image pulled, the cache created, and sources kept LF', () => {
  const cwd = project();
  const configDir = join(scratch(), '.prism');
  const ctx = context({ cwd, configDir, resolved: WSL });
  const plan = planMachine({ pull: true }, ctx);
  const r = rows(plan);
  assert.equal(r.node.status, 'already');
  assert.equal(r.docker.status, 'configure');
  assert.match(r.docker.detail, /inside WSL Ubuntu/);
  assert.deepEqual(r.docker.steps[0].patch.docker, { command: WSL.command, args: WSL.args, mount: 'wsl' });
  assert.equal(r.image.status, 'configure');
  assert.match(r.image.detail, /prismpm\.lock/);
  assert.deepEqual(r.image.steps[0].args, [...WSL.args, 'pull', IMAGE]);
  assert.equal(r.image.steps[0].inherit, true, 'a pull streams its progress');
  assert.equal(r.cache.status, 'configure');
  assert.deepEqual(r.cache.steps.map((s) => s.kind), ['command', 'merge-json']);
  assert.deepEqual(r.cache.steps[0].args, [...WSL.args, 'volume', 'create', VOLUME]);
  assert.equal(r.endings.status, 'configure');
  assert.equal(r.endings.steps[0].content, `${GITATTRIBUTES_LINE}\n`);
  assert.ok(ctx.calls.includes(`image inspect --format {{.Id}} ${IMAGE}`));
  assert.ok(ctx.calls.includes(`volume inspect --format {{.Name}} ${VOLUME}`));
});

test('a machine already set up changes nothing, and a second run says so', () => {
  const cwd = project();
  const configDir = join(scratch(), '.prism');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ preferredAgent: 'codex', docker: { command: NATIVE.command, args: [], mount: 'native' }, cache: true }));
  writeFileSync(join(cwd, '.gitattributes'), '*.png binary\n* text eol=lf\n');
  const plan = planMachine({}, context({ cwd, configDir, answers: { 'image inspect': 'sha256:abcdef0123456789\n', 'volume inspect': `${VOLUME}\n` } }));
  assert.deepEqual(plan.rows.map((row) => [row.id, row.status]), [['node', 'already'], ['docker', 'already'], ['image', 'already'], ['cache', 'already'], ['endings', 'already'], ['github', 'manual']]);
  assert.equal(plan.rows.every((row) => (row.steps ?? []).length === 0), true);
  assert.match(formatMachine(plan), /^prism-code setup: this machine\n {2}node {12}ok {18}node 22\.21\.0\n/);
});

test('no Docker: the row is a manual step with the reason, the image and cache are not checked, and the rest still runs', () => {
  const cwd = project();
  const plan = planMachine({}, context({ cwd, configDir: join(scratch(), '.prism'), resolved: { kind: 'missing', reason: 'docker is not on the PATH' } }));
  const r = rows(plan);
  assert.equal(r.docker.status, 'manual', 'agents can still be set up without Docker');
  assert.match(r.docker.detail, /not on the PATH.*PRISM_DOCKER/);
  assert.equal(r.image.status, 'manual');
  assert.match(r.image.detail, /Docker is missing/);
  assert.equal(r.cache.status, 'not-found');
  assert.equal(r.endings.status, 'configure');
  assert.equal(rows(planMachine({}, context({ cwd, configDir: join(scratch(), '.prism'), nodeVersion: '20.11.0' }))).node.status, 'failed');
});

test('outside a project: no lockfile means the image a new app is pinned to, unless --image names one; without a pull it is deferred', () => {
  const cwd = scratch();
  const configDir = join(scratch(), '.prism');
  const none = rows(planMachine({}, context({ cwd, configDir })));
  assert.equal(none.image.status, 'deferred');
  assert.equal(none.image.reference, DEFAULT_SDK_IMAGE, 'the image prism_prove asks for in an app that is not pinned yet');
  assert.match(none.image.detail, /\(no prismpm\.lock here, the image new apps are pinned to\) is not here; .*setup --pull gets it now/);
  assert.equal(none.endings.status, 'not-found');
  const named = rows(planMachine({ image: IMAGE, pull: false }, context({ cwd, configDir })));
  assert.equal(named.image.status, 'deferred');
  assert.match(named.image.detail, new RegExp(`--image\\) is not here; .*setup --image ${escape(IMAGE)} gets it now`), 'setup --pull would get another image');
  assert.equal(named.cache.status, 'configure', 'the cache volume is created for the named image even before it is pulled');
  const bad = rows(planMachine({}, context({ cwd: project({ sdk_image: 'ghcr.io/x/y:latest' }), configDir })));
  assert.equal(bad.image.status, 'failed');
  assert.match(bad.image.detail, /prismpm\.lock/);
});

test('line endings: a project with CRLF sources is told to renormalize, and an existing .gitattributes is appended to', () => {
  const cwd = project();
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'App.lex.tex'), '\\begin{lexlean}{App}\r\n\\end{lexlean}\r\n');
  writeFileSync(join(cwd, '.gitattributes'), '*.png binary');
  const row = rows(planMachine({}, context({ cwd, configDir: join(scratch(), '.prism') }))).endings;
  assert.equal(row.status, 'configure');
  assert.match(row.detail, /1 file has CRLF already.*git add --renormalize/);
  assert.equal(row.steps[0].content, `*.png binary\n${GITATTRIBUTES_LINE}\n`);
  writeFileSync(join(cwd, '.gitattributes'), '* text eol=lf\n');
  const warned = rows(planMachine({}, context({ cwd, configDir: join(scratch(), '.prism') }))).endings;
  assert.equal(warned.status, 'manual', 'the rule is there, but the file on disk is still CRLF');
});

test('line endings: a root rule that turns conversion off is left alone, since a later * text line would override it', () => {
  const cwd = project();
  mkdirSync(join(cwd, 'src'));
  writeFileSync(join(cwd, 'src', 'App.lex.tex'), '\\begin{lexlean}{App}\n\\end{lexlean}\n');
  for (const rule of ['# byte for byte, for template check\n* -text\n', '* binary\n']) {
    writeFileSync(join(cwd, '.gitattributes'), rule);
    const row = rows(planMachine({}, context({ cwd, configDir: join(scratch(), '.prism') }))).endings;
    assert.equal(row.status, 'already', rule);
    assert.match(row.detail, /byte for byte.*left as it is/);
    assert.equal(row.steps, undefined, 'nothing is written');
  }
  writeFileSync(join(cwd, 'src', 'App.lex.tex'), '\\begin{lexlean}{App}\r\n\\end{lexlean}\r\n');
  assert.equal(rows(planMachine({}, context({ cwd, configDir: join(scratch(), '.prism') }))).endings.status, 'manual', 'a CRLF source is still named');
});

test('applying a plan: the config merge keeps keys another writer set, a failed command marks its row and the next row still runs', () => {
  const cwd = project();
  const configDir = join(scratch(), '.prism');
  mkdirSync(configDir, { recursive: true });
  writeFileSync(join(configDir, 'config.json'), JSON.stringify({ preferredAgent: 'claude-code' }));
  const plan = planMachine({ pull: true }, context({ cwd, configDir, resolved: WSL }));
  const calls = [];
  applyMachine(plan, {
    run: (command, args) => {
      calls.push(args.join(' '));
      return args.includes('pull') ? { status: 1, stdout: '', stderr: 'no space left' } : { status: 0, stdout: '', stderr: '' };
    },
  });
  const r = rows(plan);
  assert.equal(r.docker.status, 'configure');
  assert.equal(r.image.status, 'failed');
  assert.match(r.image.detail, /docker pull .* failed: exit 1: no space left/);
  assert.equal(r.cache.status, 'configure', 'the cache row ran after the failed pull');
  assert.ok(calls.some((line) => line.endsWith(`volume create ${VOLUME}`)));
  const config = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8'));
  assert.equal(config.preferredAgent, 'claude-code', 'the agent half\'s key survives');
  assert.deepEqual(config.docker, { command: WSL.command, args: WSL.args, mount: 'wsl' });
  assert.equal(config.cache, true);
  assert.deepEqual(readHostConfig(configDir), { command: WSL.command, args: WSL.args, mount: 'wsl', cache: true });
  assert.equal(readFileSync(join(cwd, '.gitattributes'), 'utf8'), `${GITATTRIBUTES_LINE}\n`);
  assert.throws(() => applyMachineStep({ kind: 'frobnicate' }), /unknown step/);
});

test('--dry-run prints every step and writes nothing; --json prints the rows; --agents-only skips the machine', () => {
  const cwd = project();
  const home = scratch('prism-machine-home-');
  const stub = join(scratch(), 'docker-stub.mjs');
  // A daemon stand-in: answers `version`, knows no image and no volume, and records a pull it must never be asked for.
  writeFileSync(stub, `const a = process.argv.slice(2);
if (a[0] === 'version') { process.stdout.write('29.1.3\\n'); process.exit(0); }
if (a[0] === 'pull') { require('node:fs').writeFileSync(process.env.PULLED, 'yes'); process.exit(0); }
process.exit(1);
`);
  const pulled = join(scratch(), 'pulled');
  const env = { ...process.env, HOME: home, USERPROFILE: home, PRISM_HOME: join(home, '.prism'), PRISM_DOCKER: `"${process.execPath}" "${stub}"`, PULLED: pulled };
  const plain = spawnSync(process.execPath, [bin, 'setup', '--dry-run'], { cwd, env, encoding: 'utf8' });
  assert.equal(plain.status, 0, plain.stderr);
  assert.doesNotMatch(plain.stdout, /\n {2}(docker|image|cache) /, 'a plain setup does not look at Docker');
  assert.match(plain.stdout, /\n {2}github {10}/);
  assert.ok(plain.stdout.endsWith(`\n${telemetryNotice(env)}\n`), 'setup ends with the one line on gap telemetry');
  const local = spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--local'], { cwd, env, encoding: 'utf8' });
  assert.equal(local.status, 0, local.stderr);
  assert.match(local.stdout, /image {11}deferred {12}/, 'without --pull the image waits for its first use');
  assert.doesNotMatch(local.stdout, /run docker pull/);
  assert.equal(spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--pull', '--no-pull'], { cwd, env, encoding: 'utf8' }).status, 64);
  const dry = spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--pull'], { cwd, env, encoding: 'utf8' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^prism-code setup --dry-run: this machine\n/);
  assert.match(dry.stdout, /docker {10}would configure {5}docker 29\.1\.3/);
  assert.match(dry.stdout, new RegExp(`image {11}would configure {5}${IMAGE.replace(/[.@]/g, '\\$&')} \\(prismpm\\.lock\\): pull`));
  assert.match(dry.stdout, new RegExp(`run docker pull ${IMAGE.replace(/[.@]/g, '\\$&')}`));
  assert.match(dry.stdout, new RegExp(`run docker volume create ${VOLUME}`));
  assert.match(dry.stdout, /endings {9}would configure {5}\.gitattributes/);
  assert.match(dry.stdout, /prism-code setup --dry-run: your agents\n {2}the server lexlean, remote at https:\/\/mcp\.uor\.foundation\//);
  assert.equal(readText(join(home, '.prism', 'config.json')), null, 'a dry run writes nothing');
  assert.equal(readText(pulled), null);

  const json = spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--json'], { cwd, env, encoding: 'utf8' });
  const report = JSON.parse(json.stdout);
  assert.equal(report.schema, 'prism/setup-report/1');
  assert.equal(report.dryRun, true);
  assert.deepEqual(report.machine.map((row) => row.id), ['node', 'endings', 'github']);
  assert.ok(Array.isArray(report.agents));
  assert.ok(Array.isArray(report.next));
  assert.equal(report.telemetry, telemetryNotice(env));
  const localJson = JSON.parse(spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--local', '--json'], { cwd, env, encoding: 'utf8' }).stdout);
  assert.deepEqual(localJson.machine.map((row) => row.id), ['node', 'docker', 'image', 'cache', 'endings', 'github']);

  const agents = spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--agents-only', '--json'], { cwd, env, encoding: 'utf8' });
  assert.equal(JSON.parse(agents.stdout).machine, null);
  assert.equal(spawnSync(process.execPath, [bin, 'setup', '--image'], { cwd, env, encoding: 'utf8' }).status, 64);
});

test('the github row: no origin is not a repository; a github.com origin with a token and build.yml is ready, and each missing piece is named', () => {
  const cwd = project();
  const configDir = join(scratch(), '.prism');
  const git = (origin) => (command, args) => (command === 'git' && args.includes('get-url') ? { status: 0, stdout: `${origin}\n`, stderr: '' } : { status: 1, stdout: '', stderr: 'no' });
  const none = rows(planMachine({}, context({ cwd, configDir })));
  assert.equal(none.github.status, 'manual', 'outside a repository, no sign-in is the one thing to fix');
  assert.match(none.github.detail, /^not signed in: run gh auth login/);
  const signedIn = rows(planMachine({}, { ...context({ cwd, configDir }), env: { GH_TOKEN: 'secret' } }));
  assert.equal(signedIn.github.status, 'already');
  assert.equal(signedIn.github.detail, 'signed in (GH_TOKEN): apps build on GitHub Actions, no Docker needed');

  const elsewhere = rows(planMachine({}, { ...context({ cwd, configDir }), run: git('https://gitlab.com/acme/app.git') }));
  assert.equal(elsewhere.github.status, 'manual');
  assert.match(elsewhere.github.detail, /gitlab\.com.*not a github\.com repository/);

  const noToken = rows(planMachine({}, { ...context({ cwd, configDir }), run: git('git@github.com:acme/app.git') }));
  assert.equal(noToken.github.status, 'manual');
  assert.match(noToken.github.detail, /^acme\/app; no token: set GITHUB_TOKEN or GH_TOKEN, or run gh auth login; no \.github\/workflows\/build\.yml: add the template's, https:\/\/github\.com\/UOR-Foundation\/template/);

  mkdirSync(join(cwd, '.github', 'workflows'), { recursive: true });
  writeFileSync(join(cwd, '.github', 'workflows', 'build.yml'), 'name: build\n');
  const ready = rows(planMachine({}, { ...context({ cwd, configDir }), env: { GH_TOKEN: 'secret' }, run: git('https://github.com/acme/app') }));
  assert.equal(ready.github.status, 'already');
  assert.equal(ready.github.detail, 'acme/app; token from GH_TOKEN; .github/workflows/build.yml present');
  assert.ok(!ready.github.detail.includes('secret'), 'the token itself is never shown');
  assert.equal(ready.github.steps, undefined, 'the row applies nothing');
});

const escape = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A daemon stand-in that answers `version`, knows no image, and records each pull in `$PULLED`. */
function pullingDocker() {
  const home = scratch('prism-machine-home-');
  const stub = join(scratch(), 'docker-stub.cjs');
  writeFileSync(stub, [
    'const a = process.argv.slice(2);',
    "if (a[0] === 'version') { process.stdout.write('29.1.3\\n'); process.exit(0); }",
    "if (a[0] === 'pull') { require('node:fs').appendFileSync(process.env.PULLED, a[1] + '\\n'); process.exit(0); }",
    "if (a[0] === 'volume' && a[1] === 'create') process.exit(0);",
    'process.exit(1);',
    '',
  ].join('\n'));
  const pulled = join(scratch(), 'pulled');
  const env = { ...process.env, HOME: home, USERPROFILE: home, PRISM_HOME: join(home, '.prism'), PRISM_DOCKER: `"${process.execPath}" "${stub}"`, PULLED: pulled };
  return { env, pulled };
}

test('setup --pull outside a project pulls the image new apps are pinned to, never a silent success', () => {
  // Found on Windows, 2026-11-16, in 0.9.4: run from the home folder, setup --pull exited 0 and pulled nothing.
  const plan = planMachine({ pull: true }, context({ cwd: scratch(), configDir: join(scratch(), '.prism') }));
  const r = rows(plan);
  assert.equal(r.image.status, 'configure');
  assert.deepEqual(r.image.steps.map((step) => step.args), [['pull', DEFAULT_SDK_IMAGE]]);

  const { env, pulled } = pullingDocker();
  const run = spawnSync(process.execPath, [bin, 'setup', '--pull', '--machine-only'], { cwd: scratch('prism-machine-empty-'), env, encoding: 'utf8' });
  assert.equal(run.status, 0, run.stderr);
  assert.equal(readText(pulled), `${DEFAULT_SDK_IMAGE}\n`, 'the pull reached Docker');
  assert.match(run.stdout, new RegExp(`image {11}configured {10}${escape(DEFAULT_SDK_IMAGE)} \\(no prismpm\\.lock here`));
});

test('the prove refusal for a missing image names a command that pulls that image from any folder', () => {
  // Found on Windows, 2026-11-16, in 0.9.4: the refusal said to run setup --pull, which pulled nothing outside a project.
  const { env, pulled } = pullingDocker();
  const engine = new URL('../src/journey/engine.mjs', import.meta.url).href;
  const app = scratch('prism-machine-app-');
  for (const session of [{}, { image: IMAGE }]) {
    const script = `const { prepare } = await import(${JSON.stringify(engine)}); process.stdout.write(JSON.stringify(await prepare(${JSON.stringify(app)}, ${JSON.stringify(session)}, () => {})));`;
    const proved = spawnSync(process.execPath, ['--input-type=module', '-e', script], { env, encoding: 'utf8' });
    assert.equal(proved.status, 0, proved.stderr + proved.stdout);
    const refusal = JSON.parse(proved.stdout);
    assert.equal(refusal.ok, false);
    const image = session.image ?? DEFAULT_SDK_IMAGE;
    const named = /Run `npx prism-code@latest (setup [^`]+)`/.exec(refusal.message);
    assert.ok(named, refusal.message);
    // Follow the advice from a folder that is no project, as a user in their home folder would.
    rmSync(pulled, { force: true });
    const followed = spawnSync(process.execPath, [bin, ...named[1].split(' ')], { cwd: scratch('prism-machine-elsewhere-'), env, encoding: 'utf8' });
    // Found on macOS CI, 2026-11-16: the advice ran a whole setup, whose holo:// handler failed and made it exit 1
    // although the image was pulled. Getting an image is the machine's half only: no agent, no handler, no skill.
    assert.doesNotMatch(followed.stdout, /your agents|holo:\/\/|skills/, `${named[1]} does more than get the image`);
    assert.equal(followed.status, 0, `${named[1]} exited ${followed.status}:\n${followed.stdout}${followed.stderr}`);
    assert.equal(readText(pulled), `${image}\n`, `${named[1]} pulls the image the refusal asked for`);
  }
});
