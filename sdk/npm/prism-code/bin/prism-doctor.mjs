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
import { prismHome } from '../src/agents.mjs';
import { commandDisplay, sdkImageFromLock } from '../src/docker.mjs';
import { hostDocker } from '../src/host.mjs';
import { HOOK_COMMAND, METADATA_COMMAND, PLUGIN_SCHEMA_VERSION } from '../src/plugins.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

// The verbs that run in the SDK image, and so need Docker and ./prismpm.lock.
const HOOKED = ['check', 'build', 'verify', 'axioms', 'conformance', 'export-browser'];

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

/**
 * Docker as the delegated verbs reach it: the program `setup` recorded in
 * `$PRISM_HOME/config.json` (Docker inside WSL on Windows, say), `PRISM_DOCKER`,
 * or a fresh probe of the PATH. A record is not proof the daemon answers now,
 * so the resolved program is asked for its version either way.
 */
function docker() {
  let resolved;
  try {
    resolved = hostDocker({ configDir: prismHome() });
  } catch (error) {
    return ['fail', `${error.message}; check, build, verify and axioms need it. Run \`npx prism-code@latest setup\` to find and record it`];
  }
  const display = commandDisplay(resolved.command, resolved.args);
  const result = spawnSync(resolved.command, [...resolved.args, 'version', '--format', '{{.Server.Version}}'], { encoding: 'utf8', timeout: 20000, windowsHide: true });
  const version = result.error || result.status !== 0 ? '' : String(result.stdout ?? '').trim();
  if (!version) return ['fail', `${display} did not answer docker version; start Docker`];
  const recorded = resolved.source === 'config' ? ', as setup recorded it' : '';
  if (resolved.mount === 'wsl') {
    const at = resolved.args.indexOf('-d');
    const distro = at >= 0 ? resolved.args[at + 1] : null;
    return ['ok', `docker ${version} inside WSL${distro ? ` ${distro}` : ''}, host paths mounted under /mnt${recorded}`];
  }
  return ['ok', `docker ${version}, ${display}${recorded}`];
}

function lock() {
  let text;
  try {
    text = readFileSync(resolve('prismpm.lock'), 'utf8');
  } catch {
    return ['warn', 'no prismpm.lock here; check, build, verify and axioms run in a project that has one'];
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
