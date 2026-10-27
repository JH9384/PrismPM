#!/usr/bin/env node
/**
 * prism-code — command line.
 *
 *   prism-code run <app.holo> [--port N] [--host H] [--capabilities <file>] [--capability-set <name>]
 *                                                     serve the view and the intent endpoint
 *   prism-code vectors <app.holo | closure-dir>       replay the acceptance vectors
 *   prism-code manifest [<dir>] [--target browser|node] [--json]
 *                                                     check and lint prism.toml, with its overlay merged
 *   prism-code inspect <app.holo> [--json] [--format <path>]
 *                                                     print what the holo says about itself, without running it
 *   prism-code attest <app.holo> --predicate <file> --type <uri> [--key <private.pem>]
 *                                                     sign a statement into the holo's attestation section
 *   prism-code verify-attestation <app.holo> ...      check the signatures of those statements
 *   prism-code check|build|verify|conformance ...     run prismpm in the locked SDK image
 *
 * Exit codes: 0 ok, 1 vectors failed or an attestation did not verify,
 * 2 artifact refused (a guest import no capability set grants, a world outside the grant, or a manifest that fails its checks, included), 3 signing failed or the sigstore packages are missing,
 * 64 usage, 69 Docker unavailable, otherwise the delegated command's code.
 */
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { fromFile, serve, readManifest } from '../src/node.mjs';
import { sdkImageFromLock, dockerArguments, DELEGATED } from '../src/docker.mjs';
import { CapabilityDeniedError, PrismCodeError, PrismError, SigningError, VerificationError } from '../src/errors.mjs';
import { inspect, formatInspection, select } from '../src/inspect.mjs';
import { canonicalJson } from '../src/archive.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const USAGE = `prism-code ${version}

Usage:
  prism-code run <app.holo> [--port N] [--host H] [--capabilities <file>] [--capability-set <name>]
                                                    serve the application's view; POST /_hologram/intent dispatches
  prism-code vectors <app.holo | closure-dir>       replay every acceptance vector through the guest
  prism-code manifest [<dir>] [--target <browser|node>] [--json]
                                                    check and lint prism.toml, with prism.<target>.toml merged;
                                                    a secret written as a literal is an error
  prism-code inspect <app.holo> [--json] [--format <path>]
                                                    print sections, digests, manifest, model, world and
                                                    attestations without running the guest
  prism-code attest <app.holo> --predicate <file> --type <uri> [--subject <s>]... [--key <private.pem>] [--output <file>]
                                                    sign an in-toto statement into the holo; keyless unless --key
  prism-code verify-attestation <app.holo> --certificate-identity <id> --certificate-oidc-issuer <url>
  prism-code verify-attestation <app.holo> --key <public.pem>
                                                    check the holo's attestations against a signer policy;
                                                    --certificate-identity-regexp <re> in place of the exact id,
                                                    --type <uri> to check one predicate type, --json for the result
  prism-code check [args]                           prismpm check in the SDK image named by ./prismpm.lock
  prism-code build [args]                           prismpm build (needs the Docker socket)
  prism-code verify [args]                          prismpm verify (needs the Docker socket)
  prism-code conformance [args]                     prismpm conformance
  prism-code --version | --help

Options for inspect:  --json                       the whole inspection as canonical JSON
                      --format <path>              one value, by dotted path: sections[0].digest.sha256
Options for attest:   --subject <s>                a role (guest, view, model, capabilities) or a blob label (blake3:...), default guest;
                                                   repeatable; name=<s> renames it in the statement
                      --signing-config <file>      a Sigstore signing configuration (a private instance); default is the public one
                      keyless signing takes its OIDC token from GitHub Actions (permission id-token: write) or SIGSTORE_ID_TOKEN
Options for verify-attestation:
                      --trusted-root <file>        pin a trusted_root.json; default is the public instance's, fetched over TUF
                      --entries <n>, --timestamps <n>
                                                   least verified log entries and timestamps: 1 and 1 keyless, 0 and 0 with --key
Options for run:      --capabilities <file>        a prism/capabilities/1 file; without one the holo is granted nothing
                      --capability-set <name>      the set to apply, default "default"
Options for manifest: --target <browser|node>      merge prism.browser.toml or prism.node.toml over prism.toml
                      --json                       the merged manifest and the warnings as canonical JSON
Options for closures: --model <model.prism.json>   the model document (numeric-profile closures need it)
`;

function usage(message) {
  if (message) process.stderr.write(`${message}\n\n`);
  process.stderr.write(USAGE);
  return 64;
}

// Options that take a value. `--subject` also repeats, and collects into an array.
const VALUE_OPTIONS = [
  'port',
  'host',
  'model',
  'format',
  'predicate',
  'type',
  'subject',
  'key',
  'output',
  'signing-config',
  'trusted-root',
  'certificate-identity',
  'certificate-identity-regexp',
  'certificate-oidc-issuer',
  'entries',
  'timestamps',
  'tuf-mirror-url',
  'tuf-root',
  'tuf-cache',
  'capabilities',
  'capability-set',
  'target',
];

function parse(argv) {
  const positional = [];
  const options = {};
  const set = (name, value) => {
    if (name === 'subject') (options.subject ??= []).push(value);
    else options[name] = value;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (a.startsWith('--') && a.length > 2) {
      const eq = a.indexOf('=');
      if (eq > 0) set(a.slice(2, eq), a.slice(eq + 1));
      else if (VALUE_OPTIONS.includes(a.slice(2))) set(a.slice(2), argv[++i]);
      else options[a.slice(2)] = true;
    } else positional.push(a);
  }
  return { positional, options };
}

/** The first value option given without a value, for a usage message. */
function missingValue(options) {
  return VALUE_OPTIONS.find((name) => Object.hasOwn(options, name) && (name === 'subject' ? options.subject.some((v) => !v) : typeof options[name] !== 'string' || options[name] === ''));
}

const text = (bytes) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return `0x${Buffer.from(bytes).toString('hex')}`;
  }
};

async function open(path, options) {
  return fromFile(resolve(path), {
    model: options.model ? resolve(options.model) : null,
    capabilities: options.capabilities ? resolve(options.capabilities) : null,
    capabilitySet: options['capability-set'],
  });
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

function closureSummary(app) {
  return {
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
}

async function commandInspect(positional, options) {
  if (positional.length !== 1) return usage('inspect takes one artifact');
  if (Object.hasOwn(options, 'format') && (typeof options.format !== 'string' || options.format === '')) return usage('--format takes a path, such as sections[0].digest.sha256');
  const path = resolve(positional[0]);
  const info = await stat(path).catch(() => null);
  if (!info) throw new PrismCodeError('load.path', `${path} does not exist`);
  // A closure has no section table; it keeps the 0.2.0 summary.
  const closure = info.isDirectory();
  const value = closure ? closureSummary(await open(positional[0], options)) : await inspect(new Uint8Array(await readFile(path)));
  if (typeof options.format === 'string') {
    let picked;
    try {
      picked = select(value, options.format);
    } catch (error) {
      if (error instanceof PrismCodeError) return usage(error.message);
      throw error;
    }
    if (!picked.found) {
      process.stderr.write(`inspect.selector: no value at ${options.format}\n`);
      return 2;
    }
    process.stdout.write(`${typeof picked.value === 'string' ? picked.value : canonicalJson(picked.value ?? null)}\n`);
    return 0;
  }
  if (options.json) process.stdout.write(`${canonicalJson(value)}\n`);
  else if (closure) process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
  else process.stdout.write(formatInspection(value));
  return 0;
}

// The sigstore packages are optional and large; load them only when one of these verbs runs.
async function commandAttestation(verb, positional, options) {
  const bad = missingValue(options);
  if (bad) return usage(`--${bad} takes a value`);
  const cli = await import('../src/attest-cli.mjs');
  return verb === 'attest' ? cli.runAttest(positional, options, usage) : cli.runVerifyAttestation(positional, options, usage);
}

async function commandRun(positional, options) {
  if (positional.length !== 1) return usage('run takes one artifact');
  for (const name of ['capabilities', 'capability-set']) {
    if (Object.hasOwn(options, name) && (typeof options[name] !== 'string' || options[name] === '')) return usage(`--${name} takes a value`);
  }
  const app = await open(positional[0], options);
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usage('--port must be 0..65535');
  const { url, close } = await serve(app, { port, host: options.host ?? '127.0.0.1' });
  process.stdout.write(`${app.name ?? 'application'} (${app.kind}) at ${url}\n`);
  process.stdout.write(app.capabilities.set === null ? 'capabilities: none granted\n' : `capabilities: set ${app.capabilities.set} of ${options.capabilities}\n`);
  if (app.world?.contract) process.stdout.write(`world: ${app.world.contract} within the grant, ${app.world.pure ? 'pure' : `impure (${app.world.effects.join(', ')})`}\n`);
  await new Promise((done) => {
    for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => close().then(done));
  });
  return 0;
}

async function commandManifest(positional, options) {
  if (positional.length > 1) return usage('manifest takes at most one project directory');
  const bad = missingValue(options);
  if (bad) return usage(`--${bad} takes a value`);
  if (options.target !== undefined && !['browser', 'node'].includes(options.target)) return usage('--target is browser or node');
  const result = await readManifest(resolve(positional[0] ?? '.'), { target: options.target ?? null });
  const { manifest, warnings, files, grant } = result;
  if (options.json) {
    process.stdout.write(`${canonicalJson({ files, target: result.target, manifest, warnings })}\n`);
    return 0;
  }
  const app = manifest.application;
  const granted = grant.capabilities === null ? 'none granted' : `set ${grant.capabilitySet}${manifest.capabilities?.file ? ` of ${manifest.capabilities.file}` : ' (inline)'}`;
  const variables = Object.entries(manifest.variables ?? {}).map(([name, entry]) => (typeof entry === 'object' && entry.secret ? `${name} (secret)` : name));
  process.stdout.write(`${app.name} ${app.version} from ${files.join(' + ')}\n`);
  process.stdout.write(`capabilities: ${granted}\n`);
  process.stdout.write(`variables: ${variables.length ? variables.join(', ') : 'none'}\n`);
  for (const w of warnings) process.stderr.write(`warning: ${w.rule}: ${w.message}\n`);
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
    case 'manifest':
      return commandManifest(positional, options);
    case 'attest':
    case 'verify-attestation':
      return commandAttestation(command, positional, options);
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
    } else if (error instanceof PrismError) {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      if (error.check) process.stderr.write(`check: ${error.check}\n`);
      if (error instanceof VerificationError && error.check === 'policy.invalid') process.exitCode = 64;
      else if (error instanceof CapabilityDeniedError) process.exitCode = 2;
      else if (error instanceof SigningError || error.code === 'attest.unavailable') process.exitCode = 3;
      else process.exitCode = 1;
    } else {
      process.stderr.write(`${error?.stack ?? error}\n`);
      process.exitCode = 70;
    }
  },
);
