#!/usr/bin/env node
// A stand-in for `docker`, for tests of what Prism does around a proof and a build: it runs nothing
// of the SDK image. `PRISM_DOCKER` names it, so the real server spawns it exactly as it spawns Docker.
//
// The plan is JSON in FAKE_DOCKER_PLAN:
//   app      the app folder (the project's prism/), where a build's files are written
//   prove    "ok" | "cut"            cut: the output stops inside the verify step, as when the container is killed
//   build    "ok" | "cut" | "fail"   fail: the step ends and reports exit 1
//   buildMs  how long the build step takes
//   holo     the holo a finished build leaves under .prism/build, with the toolchain's verified record
//   log      a file each proof and build appends one line to, so a test can count them
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const plan = JSON.parse(process.env.FAKE_DOCKER_PLAN ?? '{}');
// The server that spawned this may be killed mid-build, as a restarted agent kills it: keep going with nobody reading.
process.stdout.on('error', () => {});
process.stderr.on('error', () => {});
const say = (line) => {
  try {
    process.stdout.write(`${line}\n`);
  } catch {
    // Nobody is reading.
  }
};
const wait = (ms) => new Promise((done) => setTimeout(done, ms));
const record = (line) => plan.log && appendFileSync(plan.log, `${line}\n`);
const BUILD_ID = '7'.repeat(64);

/** The build's work, in a process that outlives the client: what the container does. */
async function buildWork(done) {
  record('build');
  for (let waited = 0; waited < (plan.buildMs ?? 0); waited += 100) {
    writeFileSync(join(plan.app, '.prism', '.staging'), String(waited));
    await wait(100);
  }
  if (plan.build === 'fail') return writeFileSync(done, '1');
  if (plan.holo) {
    const folder = join(plan.app, '.prism', 'build', BUILD_ID);
    mkdirSync(folder, { recursive: true });
    copyFileSync(plan.holo, join(folder, 'Shipping Method.holo'));
  }
  // A build that is cut leaves its holo and no verified record: the holo is written early in the step.
  if (plan.build === 'cut') return writeFileSync(done, '137');
  if (plan.holo) {
    const bytes = readFileSync(plan.holo);
    const verified = join(plan.app, '.prism', 'verified', '4'.repeat(64));
    mkdirSync(verified, { recursive: true });
    // The shape the toolchain's verify step writes: the build it verified, and each artifact with its hash.
    writeFileSync(join(verified, 'manifest.json'), JSON.stringify({ build_id: BUILD_ID, exporter_owner: { phases: [{ artifacts: [{ byte_length: bytes.length, path: 'Shipping Method.holo', sha256: createHash('sha256').update(bytes).digest('hex') }] }] } }));
  }
  record('built');
  return writeFileSync(done, '0');
}

if (args[0] === '--build-work') {
  await buildWork(args[1]);
} else if (args[0] === 'version') {
  say('27.0.0');
} else if (args[0] === 'image' || args[0] === 'pull') {
  say('sha256:fake');
} else if (args[0] === 'run' && args.includes('cat')) {
  say('fake standards lock');
} else if (args[0] === 'run') {
  let script = '';
  for await (const chunk of process.stdin) script += chunk;
  const image = args.find((a) => /@sha256:[0-9a-f]{64}$/.test(a));
  const ok = (step) => {
    say(`@@step ${step}`);
    say(`@@exit ${step} 0`);
  };
  if (script.includes('prismpm update')) {
    writeFileSync(join(plan.app, 'prismpm.lock'), `${JSON.stringify({ sdk_image: image })}\n`);
  } else if (script.includes('prismpm verify')) {
    for (const step of ['prelock', 'format', 'lock']) ok(step);
    say('@@step build');
    // A container outlives the client that started it: the work runs in a process of its own, as the
    // Docker daemon runs a container, and this one only waits for it. (On Windows a child dies with
    // its parent unless it is detached.)
    mkdirSync(join(plan.app, '.prism'), { recursive: true });
    const done = join(plan.app, '.prism', `.fake-done-${process.pid}`);
    spawn(process.execPath, [fileURLToPath(import.meta.url), '--build-work', done], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env }).unref();
    while (!existsSync(done)) await wait(50);
    const code = Number(readFileSync(done, 'utf8'));
    if (code === 137) process.exit(137);
    if (code !== 0) {
      say('error[PP9999]: the stand-in build was told to fail');
      say(`@@exit build ${code}`);
      process.exit(code);
    }
    say('verified attestation: fake');
    say('@@exit build 0');
  } else if (script.includes('lexlean verify --all')) {
    record('prove');
    for (const step of ['prelock', 'format', 'lock', 'check']) ok(step);
    say('@@step verify');
    await wait(plan.proveMs ?? 0);
    if (plan.prove === 'cut') process.exit(137);
    say('@@exit verify 0');
  } else {
    say(`fake docker: a script it does not know: ${script.slice(0, 80)}`);
    process.exit(64);
  }
} else {
  say(`fake docker: unknown arguments ${args.join(' ')}`);
  process.exit(64);
}
