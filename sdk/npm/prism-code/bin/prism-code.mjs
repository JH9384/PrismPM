#!/usr/bin/env node
/**
 * prism-code — command line.
 *
 *   prism-code run <app.holo> [--policy F] [--allow-unverified] [--capabilities <file>] [--capability-set <name>] [--port N] [--host H]
 *                                                     check the holo (#282), then serve the view and the intent endpoint
 *   prism-code vectors <app.holo | closure-dir>       replay the acceptance vectors
 *   prism-code init [<dir>] [--name N] [--template T] [--sdk-image REF] [--force]
 *                                                     scaffold a project; with --sdk-image, bind it (standards.lock, prismpm.lock)
 *   prism-code manifest [<dir>] [--target browser|node] [--json]
 *                                                     check and lint prism.toml, with its overlay merged
 *   prism-code providers <up|down> [<dir>] [--target browser|node] [--json]
 *                                                     run the providers prism.toml declares (experimental)
 *   prism-code inspect <app.holo> [--json] [--format <path>]
 *                                                     print what the holo says about itself, without running it
 *   prism-code attest <app.holo> --predicate <file> --type <uri> [--key <private.pem>]
 *                                                     sign a statement into the holo's attestation section
 *   prism-code verify-attestation <app.holo> ...      check the signatures of those statements
 *   prism-code check <app.holo> [--policy <file>] [--json]
 *                                                     judge the holo against a policy and print its verdict
 *   prism-code build [--check]|verify|conformance ... run prismpm in the locked SDK image
 *   prism-code <plugin> [args]                        run prism-<plugin> from the PATH (experimental)
 *
 * Exit codes: 0 ok or the policy passed, 1 vectors failed, an attestation did
 * not verify or the policy failed, 2 artifact refused (a guest import no
 * capability set grants, a world outside the grant, a manifest that fails
 * its checks, or a provider that failed, included) or no verdict, 3 signing failed or the sigstore
 * packages are missing, 64 usage, 69 Docker unavailable, otherwise the
 * delegated command's or the plugin's code.
 *
 * `check` without a holo is the 0.2.0 spelling of `build --check`. It still
 * runs, with a warning, and is removed in 0.4.0 (STABILITY.md, Deprecated).
 */
import { readFile, stat } from 'node:fs/promises';
import { statSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { userInfo } from 'node:os';
import { createRequire } from 'node:module';
import { fromFile, serve, readManifest, resolveProviders, releaseProviders } from '../src/node.mjs';
import { sdkImageFromLock, dockerArguments, DELEGATED } from '../src/docker.mjs';
import { CapabilityDeniedError, PrismCodeError, PrismError, ProviderError, SigningError, VerificationError } from '../src/errors.mjs';
import { inspect, formatInspection, select } from '../src/inspect.mjs';
import { manifestProviders } from '../src/manifest.mjs';
import { canonicalJson } from '../src/archive.mjs';
import { check, formatVerdict, verdictJson, exitCodeOf, EXIT as CHECK_EXIT } from '../src/check.mjs';
import { discover, errorHookMessages, listPlugins, pluginHelp, readMetadata, runPlugin } from '../src/plugins.mjs';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const USAGE = `prism-code ${version}

Usage:
  prism-code run <app.holo> [--policy <file>] [--capabilities <file>] [--capability-set <name>] [--port N] [--host H]
                                                    check the holo, then serve its view; POST /_hologram/intent
                                                    dispatches. A holo that fails check is refused (exit 1, 2 for
                                                    no verdict) unless --allow-unverified, which warns every start
  prism-code vectors <app.holo | closure-dir>       replay every acceptance vector through the guest
  prism-code init [<dir>] [--name <name>] [--template <name>] [--sdk-image <ref>] [--force]
                                                    scaffold a project: prism.toml, a language-1.2 model and its
                                                    Lean workspace; --sdk-image also writes standards.lock and
                                                    prismpm.lock from that SDK image (needs Docker)
  prism-code manifest [<dir>] [--target <browser|node>] [--json]
                                                    check and lint prism.toml, with prism.<target>.toml merged;
                                                    a secret written as a literal is an error
  prism-code providers <up|down> [<dir>] [--target <browser|node>] [--json]
                                                    run the prism-provider-<type> each capability declares;
                                                    the capability set must allow the type and each variable
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
  prism-code check <app.holo> [--policy <file>] [--json]
                                                    judge the holo against a policy and print its verdict:
                                                    exit 0 passed, 1 failed, 2 no verdict
  prism-code build --check [args]                   prismpm check in the SDK image named by ./prismpm.lock:
                                                    validate the model, write nothing
  prism-code build [args]                           prismpm build (needs the Docker socket)
  prism-code verify [args]                          prismpm verify (needs the Docker socket)
  prism-code conformance [args]                     prismpm conformance
  prism-code <plugin> [args]                        run prism-<plugin> from the PATH; a built-in verb always wins
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
Options for run:      --policy <file>              the policy check judges the holo by, as for check; effects [] is the pure-world policy
                      --allow-unverified           run a holo that fails check, or a closure; prints a warning, never the default
                      --capabilities <file>        a prism/capabilities/1 file; without one the holo is granted nothing
                      --capability-set <name>      the set to apply, default "default"
Options for check:    --policy <file>              a JSON policy: name, minimum (P0 to P3), digests, world;
                                                   default: P2 or above, or PRISM_MINIMUM_LEVEL
                      --json                       the verdict as one canonical JSON object
                      deprecated: check without a holo runs build --check; removed in 0.4.0
Options for manifest: --target <browser|node>      merge prism.browser.toml or prism.node.toml over prism.toml
                      --json                       the merged manifest and the warnings as canonical JSON
Options for providers: --target <browser|node>     merge prism.browser.toml or prism.node.toml over prism.toml
                      --json                       the result as canonical JSON, with the values; text output never prints one
Options for closures: --model <model.prism.json>   the model document (numeric-profile closures need it)
`;

// The built-in verbs are the ones the usage text names and the delegated ones, so a new verb shadows a plugin of its name.
const BUILTINS = new Set([...[...USAGE.matchAll(/^ {2}prism-code ([a-z][a-z-]*)/gm)].map((m) => m[1]), ...Object.keys(DELEGATED), 'help', 'version']);

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
  'policy',
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

const CHECK_OPTIONS = ['policy', 'json'];

/** True when `check` was given a holo, a path ending in `.holo` or a file; otherwise it is the deprecated `build --check`. */
function namesHolo(positional) {
  const [first] = positional;
  if (first === undefined) return false;
  if (/\.holo$/i.test(first)) return true;
  try {
    return statSync(resolve(first)).isFile();
  } catch {
    return false;
  }
}

async function commandCheck(positional, options) {
  const unknown = Object.keys(options).find((name) => !CHECK_OPTIONS.includes(name));
  if (unknown) return usage(`check has no option --${unknown}`);
  if (Object.hasOwn(options, 'policy') && (typeof options.policy !== 'string' || options.policy === '')) return usage('--policy takes a file');
  if (positional.length !== 1) return usage('check takes one holo');
  let verdict;
  try {
    verdict = await check(positional[0], { policy: options.policy });
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    process.stderr.write(`no verdict: ${error.check ?? error.code}: ${error.message}\n`);
    return CHECK_EXIT.NO_VERDICT;
  }
  process.stdout.write(options.json ? verdictJson(verdict) : formatVerdict(verdict, positional[0]));
  return exitCodeOf(verdict);
}

/**
 * `run` gates on `check` (issue #282): the holo is judged against the policy,
 * with the capability set it will run under, before it is opened. A verdict
 * that fails refuses to start (exit 1) and prints the verdict, as `check`
 * does; no verdict refuses with exit 2. `--allow-unverified` starts it anyway,
 * with a warning on every start; it is never the default. A closure has no
 * section table, so it cannot be judged: it runs only with the flag.
 */
async function gateRun(path, options) {
  const allow = options['allow-unverified'] === true;
  const isHolo = (await stat(resolve(path)).catch(() => null))?.isFile() ?? false;
  if (!isHolo) {
    if (allow) return { verdict: null, warning: `${path} is a closure, which check cannot judge; running it unverified (--allow-unverified)` };
    process.stderr.write(`run.unverified: ${path} is a closure, which check cannot judge; build a .holo, or pass --allow-unverified to run it anyway\n`);
    return { refuse: CHECK_EXIT.NO_VERDICT };
  }
  let capabilities = null;
  if (options.capabilities) {
    const { parseCapabilities, grantOf } = await import('../src/capabilities.mjs');
    capabilities = grantOf(parseCapabilities(new Uint8Array(await readFile(resolve(options.capabilities)))), options['capability-set'] ?? 'default').members;
  }
  let verdict;
  try {
    verdict = await check(path, { policy: options.policy, capabilities });
  } catch (error) {
    if (!(error instanceof PrismError)) throw error;
    if (allow) return { verdict: null, warning: `no verdict (${error.check ?? error.code}: ${error.message}); running it unverified (--allow-unverified)` };
    process.stderr.write(`no verdict: ${error.check ?? error.code}: ${error.message}\nrun refused: pass --allow-unverified to run a holo check cannot judge\n`);
    return { refuse: CHECK_EXIT.NO_VERDICT };
  }
  if (verdict.passed) return { verdict, warning: null };
  if (allow) return { verdict, warning: `the holo failed check (${verdict.level}, policy ${verdict.policy.name} requires ${verdict.policy.minimum}): ${verdict.reasons.filter((r) => r.check !== 'policy.level').map((r) => r.check).join(', ') || 'policy.level'}; running it unverified (--allow-unverified)` };
  process.stderr.write(formatVerdict(verdict, path));
  process.stderr.write('run refused: the holo did not pass check. Raise its evidence, run it under a policy that accepts it (--policy), or pass --allow-unverified.\n');
  return { refuse: exitCodeOf(verdict) };
}

async function commandRun(positional, options) {
  if (positional.length !== 1) return usage('run takes one artifact');
  for (const name of ['capabilities', 'capability-set', 'policy']) {
    if (Object.hasOwn(options, name) && (typeof options[name] !== 'string' || options[name] === '')) return usage(`--${name} takes a value`);
  }
  const gate = await gateRun(positional[0], options);
  if (gate.refuse !== undefined) return gate.refuse;
  if (gate.warning) process.stderr.write(`warning: ${gate.warning}\n`);
  const app = await open(positional[0], options);
  const port = options.port === undefined ? 0 : Number(options.port);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return usage('--port must be 0..65535');
  const { url, close } = await serve(app, { port, host: options.host ?? '127.0.0.1' });
  process.stdout.write(`${app.name ?? 'application'} (${app.kind}) at ${url}\n`);
  process.stdout.write(app.capabilities.set === null ? 'capabilities: none granted\n' : `capabilities: set ${app.capabilities.set} of ${options.capabilities}\n`);
  if (app.world?.contract) process.stdout.write(`world: ${app.world.contract} within the grant, ${app.world.pure ? 'pure' : `impure (${app.world.effects.join(', ')})`}\n`);
  process.stdout.write(gate.verdict?.passed ? `check: passed, ${gate.verdict.level}, policy ${gate.verdict.policy.name}\n` : 'check: NOT PASSED, running unverified\n');
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
  const declared = manifestProviders(manifest);
  if (declared.length > 0) process.stdout.write(`providers: ${declared.map((p) => `${p.name} (${p.type})`).join(', ')}\n`);
  for (const w of warnings) process.stderr.write(`warning: ${w.rule}: ${w.message}\n`);
  return 0;
}

async function commandProviders(positional, options) {
  const [verb, directory, ...extra] = positional;
  if ((verb !== 'up' && verb !== 'down') || extra.length > 0) return usage('providers takes up or down, and at most one project directory');
  const bad = missingValue(options);
  if (bad) return usage(`--${bad} takes a value`);
  if (options.target !== undefined && !['browser', 'node'].includes(options.target)) return usage('--target is browser or node');
  const project = await readManifest(resolve(directory ?? '.'), { target: options.target ?? null });
  for (const w of project.warnings) process.stderr.write(`warning: ${w.rule}: ${w.message}\n`);
  const onMessage = ({ capability, type, message }) => {
    if (type === 'info') process.stderr.write(`${capability}: ${message}\n`);
  };
  if (verb === 'down') {
    const { providers } = await releaseProviders(project, { onMessage });
    if (options.json) process.stdout.write(`${canonicalJson({ providers })}\n`);
    else process.stdout.write(`released: ${providers.length ? providers.join(', ') : 'none'}\n`);
    return 0;
  }
  const { env, providers, withheld } = await resolveProviders(project, { onMessage });
  for (const w of withheld) process.stderr.write(`warning: capability ${w.capability} returned ${w.name}, and the capability set does not allow the variable ${w.variable}; it is withheld\n`);
  if (options.json) {
    process.stdout.write(`${canonicalJson({ env, providers, withheld })}\n`);
    return 0;
  }
  if (providers.length === 0) process.stdout.write('providers: none declared\n');
  for (const p of providers) process.stdout.write(`${p.name} (${p.type}): ${p.variables.length ? p.variables.join(', ') : 'no variables'}\n`);
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

// Set once a verb or a plugin runs; error hooks run only after one did.
let ran = null;

async function commandPlugin(command, args) {
  const file = BUILTINS.has(command) ? null : discover().get(command);
  if (!file) return usage(`unknown command ${command}`);
  const { problem } = readMetadata(file);
  if (problem) return usage(`prism-${command} is not a valid plugin: ${problem}`);
  ran = command;
  return runPlugin(file, args);
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (!command || command === '--help' || command === '-h' || command === 'help') {
    process.stdout.write(command ? USAGE + pluginHelp(listPlugins({ builtins: BUILTINS })) : USAGE);
    return command ? 0 : 64;
  }
  if (command === '--version' || command === '-v' || command === 'version') {
    process.stdout.write(`${version}\n`);
    return 0;
  }
  const { positional, options } = parse(rest);
  if (BUILTINS.has(command)) ran = command;
  switch (command) {
    case 'vectors':
      return commandVectors(positional, options);
    case 'inspect':
      return commandInspect(positional, options);
    case 'run':
      return commandRun(positional, options);
    case 'manifest':
      return commandManifest(positional, options);
    case 'providers':
      return commandProviders(positional, options);
    case 'init': {
      const { runInit } = await import('../src/init-cli.mjs');
      return runInit(rest);
    }
    case 'attest':
    case 'verify-attestation':
      return commandAttestation(command, positional, options);
    case 'check':
      if (namesHolo(positional)) return commandCheck(positional, options);
      process.stderr.write('prism-code check without a holo is deprecated and is removed in 0.4.0; use prism-code build --check, which runs the same prismpm check\n');
      return commandDelegate('check', rest);
    case 'build':
      if (rest.includes('--check')) return commandDelegate('check', rest.filter((a) => a !== '--check'));
      return commandDelegate('build', rest);
    default:
      if (Object.hasOwn(DELEGATED, command)) return commandDelegate(command, rest);
      return commandPlugin(command, rest);
  }
}

const argv = process.argv.slice(2);
main(argv).then(
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
      else if (error instanceof CapabilityDeniedError || error instanceof ProviderError) process.exitCode = 2;
      else if (error instanceof SigningError || error.code === 'attest.unavailable') process.exitCode = 3;
      else process.exitCode = 1;
    } else {
      process.stderr.write(`${error?.stack ?? error}\n`);
      process.exitCode = 70;
    }
  },
).then(() => {
  // A plugin may have something to say about a verb that failed, as Docker's error-hooks do.
  if (!ran || !process.exitCode) return;
  const messages = errorHookMessages({ command: ran, args: argv.slice(1), exitCode: process.exitCode, builtins: BUILTINS });
  if (messages.length > 0) process.stderr.write(`\nWhat's next:\n${messages.map((m) => `  ${m}\n`).join('')}`);
});
