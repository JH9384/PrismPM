#!/usr/bin/env node
/**
 * prism-code — command line.
 *
 *   prism-code run <app.holo> [--port N] [--host H]   serve the view and the intent endpoint
 *   prism-code vectors <app.holo | closure-dir>       replay the acceptance vectors
 *   prism-code inspect <app.holo | closure-dir>       print what the artifact says about itself
 *   prism-code check|build|verify|conformance ...     run prismpm in the locked SDK image
 *
 * Exit codes: 0 ok, 1 vectors failed, 2 artifact refused, 64 usage,
 * 69 Docker unavailable, otherwise the delegated command's code.
 */
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { fromFile, serve } from '../src/node.mjs';
import { sdkImageFromLock, dockerArguments, DELEGATED } from '../src/docker.mjs';
import { PrismCodeError } from '../src/errors.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const USAGE = `prism-code ${version}

Usage:
  prism-code run <app.holo> [--port N] [--host H]   serve the application's view; POST /_hologram/intent dispatches
  prism-code vectors <app.holo | closure-dir>       replay every acceptance vector through the guest
  prism-code inspect <app.holo | closure-dir>       print identities, limits, provenance and view files as JSON
  prism-code check [args]                           prismpm check in the SDK image named by ./prismpm.lock
  prism-code build [args]                           prismpm build (needs the Docker socket)
  prism-code verify [args]                          prismpm verify (needs the Docker socket)
  prism-code conformance [args]                     prismpm conformance
  prism-code --version | --help

Options for closures: --model <model.prism.json>   the model document (numeric-profile closures need it)
`;

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(USAGE);
  return 64;
}

function parse(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      if (eq > 0) options[a.slice(2, eq)] = a.slice(eq + 1);
      else if (['port', 'host', 'model'].includes(a.slice(2))) options[a.slice(2)] = argv[++i];
      else options[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, options };
}

const text = (bytes) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return `0x${Buffer.from(bytes).toString('hex')}`;
  }
};

async function open(path, options) {
  return fromFile(resolve(path), { model: options.model ? resolve(options.model) : null });
}

async function commandVectors(positional, options) {
  if (positional.length !== 1) return usage('vectors takes one artifact');
  const app = await open(positional[0], options);
  const result = await app.acceptance();
  for (const f of result.failed) {
    process.stdout.write(`vector ${f.index}: request ${JSON.stringify(text(f.request))}\n  expected ${JSON.stringify(text(f.expected))}\n  actual   ${f.actual ? JSON.stringify(text(f.actual)) : String(f.error)}\n`);
  }
  process.stdout.write(`${result.passed} of ${result.total} vectors passed (${app.kind}, ${app.name ?? 'unnamed'}${app.identities.verified ? ', identities verified' : ', identities NOT verified'})\n`);
  return result.failed.length === 0 && result.total > 0 ? 0 : 1;
}

async function commandInspect(positional, options) {
  if (positional.length !== 1) return usage('inspect takes one artifact');
  const app = await open(positional[0], options);
  const summary = {
    kind: app.kind,
    name: app.name,
    profile: app.profile,
    limits: app.limits,
    vectors: app.vectors.length,
    identities: app.identities,
    evidence: app.evidence,
    provenance: app.provenance,
    view: { entry: app.view.entry, files: [...app.view.files.keys()] },
  };
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  return 0;
}

async function commandRun(positional, options) {
  if (positional.length !== 1) return usage('run takes one artifact');
  const app = await open(positional[0], options);
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usage('--port must be 0..65535');
  const { url, close } = await serve(app, { port, host: options.host ?? '127.0.0.1' });
  process.stdout.write(`${app.name ?? 'application'} (${app.kind}) at ${url}\n`);
  await new Promise((done) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(done));
  });
  return 0;
}

async function commandDelegate(command, args) {
  const cwd = process.cwd();
  let lock;
  try {
    lock = await readFile(resolve(cwd, 'prismpm.lock'), 'utf8');
  } catch {
    process.stderr.write('prismpm.lock not found in the current directory\n');
    return 64;
  }
  const image = sdkImageFromLock(lock);
  const { build } = DELEGATED[command];
  let dockerSocketGid = null;
  if (build && process.platform !== 'win32') {
    try {
      dockerSocketGid = statSync('/var/run/docker.sock').gid;
    } catch {
      dockerSocketGid = null;
    }
  }
  let uid = null;
  let gid = null;
  if (process.platform !== 'win32') ({ uid, gid } = userInfo());
  const dockerArgs = dockerArguments({ image, cwd, command, args, uid, gid, build, dockerSocketGid });
  if (process.env.PRISM_CODE_DRY_RUN) {
    process.stdout.write(`docker ${dockerArgs.map((a) => (/\s/.test(a) ? JSON.stringify(a) : a)).join(' ')}\n`);
    return 0;
  }
  return new Promise((done) => {
    const child = spawn('docker', dockerArgs, { stdio: 'inherit' });
    child.on('error', (error) => {
      process.stderr.write(error.code === 'ENOENT' ? 'docker is not installed or not on PATH; prism-code check/build/verify need Docker\n' : `${error.message}\n`);
      done(69);
    });
    child.on('exit', (code, signal) => done(code ?? (signal ? 1 : 0)));
  });
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(USAGE);
    return command ? 0 : 64;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  const { positional, options } = parse(rest);
  switch (command) {
    case 'vectors':
      return commandVectors(positional, options);
    case 'inspect':
      return commandInspect(positional, options);
    case 'run':
      return commandRun(positional, options);
    default:
      if (Object.hasOwn(DELEGATED, command)) return commandDelegate(command, rest);
      return usage(`unknown command ${command}`);
  }
}

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    if (error instanceof PrismCodeError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.exitCode = error.code.startsWith('lock.') ? 64 : 2;
    } else {
      process.stderr.write(`${error?.stack ?? error}\n`);
      process.exitCode = 70;
    }
  },
);
