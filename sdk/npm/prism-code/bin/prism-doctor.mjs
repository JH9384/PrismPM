#!/usr/bin/env node
/**
 * prism-doctor — the first-party CLI plugin (#293, experimental).
 *
 *   prism-code doctor        check what prism-code needs here: Node.js, Docker,
 *                            ./prismpm.lock and the optional sigstore packages
 *
 * It ships in the prism-code package as a second binary, so installing
 * prism-code puts `prism-doctor` on the PATH and `prism-code doctor` finds it.
 * Its error hook points at it when check, build, verify or conformance fail
 * for want of Docker or a lockfile.
 *
 * Exit codes: 0 nothing failed, 1 a check failed.
 */
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { sdkImageFromLock } from '../src/docker.mjs';
import { HOOK_COMMAND, METADATA_COMMAND, PLUGIN_SCHEMA_VERSION } from '../src/plugins.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// The verbs that run prismpm in the SDK image, and so need Docker and ./prismpm.lock.
const HOOKED = ['check', 'build', 'verify', 'conformance', 'export-browser'];

const METADATA = {
  schemaVersion: PLUGIN_SCHEMA_VERSION,
  vendor: 'UOR Foundation',
  version,
  shortDescription: 'Check Node.js, Docker, prismpm.lock and the sigstore packages',
  errorHooks: HOOKED,
};

// 64 is a missing prismpm.lock and 69 a missing Docker: the two failures doctor explains.
const EXPLAINED = new Set([64, 69]);

function hook(input) {
  let call;
  try {
    call = JSON.parse(input);
  } catch {
    call = null;
  }
  // `check <app.holo>` judges a holo without Docker; only the lockfile spelling is doctor's.
  const judged = call?.command === 'check' && Array.isArray(call.args) && call.args.some((a) => typeof a === 'string' && a.endsWith('.holo'));
  const messages = HOOKED.includes(call?.command) && EXPLAINED.has(call?.exitCode) && !judged ? ['Run `prism-code doctor` to check Node.js, Docker and prismpm.lock.'] : [];
  return { messages };
}

function node() {
  const major = Number(process.versions.node.split('.')[0]);
  return major >= 22 ? ['ok', `node ${process.versions.node}`] : ['fail', `node ${process.versions.node}; prism-code needs 22 or later`];
}

function docker() {
  const result = spawnSync('docker', ['version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  if (result.error?.code === 'ENOENT') return ['fail', 'docker is not on the PATH; check, build, verify and conformance need it'];
  if (result.error || result.status !== 0) return ['fail', 'docker is installed but its daemon did not answer; start Docker'];
  return ['ok', `docker ${result.stdout.trim()}`];
}

function lock() {
  let text;
  try {
    text = readFileSync(resolve('prismpm.lock'), 'utf8');
  } catch {
    return ['warn', 'no prismpm.lock here; check, build, verify and conformance run in a project that has one'];
  }
  try {
    return ['ok', `prismpm.lock pins ${sdkImageFromLock(text)}`];
  } catch (error) {
    return ['fail', `prismpm.lock: ${error.message}`];
  }
}

function sigstore() {
  try {
    require.resolve('@sigstore/sign');
    require.resolve('@sigstore/verify');
    return ['ok', 'sigstore packages installed'];
  } catch {
    return ['warn', 'the optional sigstore packages are not installed; attest and verify-attestation need them'];
  }
}

function doctor() {
  const results = [node(), docker(), lock(), sigstore()];
  for (const [status, message] of results) process.stdout.write(`${status.padEnd(6)}${message}\n`);
  return results.some(([status]) => status === 'fail') ? 1 : 0;
}

const [command] = process.argv.slice(2);
if (command === METADATA_COMMAND) {
  process.stdout.write(`${JSON.stringify(METADATA)}\n`);
} else if (command === HOOK_COMMAND) {
  process.stdout.write(`${JSON.stringify(hook(readFileSync(0, 'utf8')))}\n`);
} else if (command === '--help' || command === '-h') {
  process.stdout.write('Usage: prism-code doctor\n\nCheck Node.js, Docker, ./prismpm.lock and the optional sigstore packages. Exits 1 when a check fails.\n');
} else if (command === undefined) {
  process.exitCode = doctor();
} else {
  process.stderr.write(`prism-code doctor takes no arguments; got ${command}\n`);
  process.exitCode = 64;
}
