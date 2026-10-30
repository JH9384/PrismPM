/**
 * Provider services (issue #294, docs/proposals/294-provider-services.md,
 * experimental), after Docker Compose's provider services.
 *
 * A capability in `prism.toml` declares `provider = { type, options }`. Prism
 * finds `prism-provider-<type>` on the PATH the way #293 finds a plugin and runs
 *
 *   prism-provider-<type> --project-name <application> up [--<option>=<value> ...] <name>
 *
 * in the project directory. The provider replies on stdout with JSON Lines,
 * each `{"type","message"}`: `info`, `debug`, `error`, or `setenv` with the
 * message `VAR=value`, which becomes `<NAME>_<VAR>`. `down` takes the same
 * arguments and releases what `up` provisioned.
 *
 * The capability set bounds this twice. A provider runs only when the
 * `providers` kind allows its type, and every declaration is checked before
 * any provider starts. A returned variable is produced only when the
 * `variables` kind allows its name; otherwise it is withheld and reported by
 * name. No error message quotes a reply line, because a reply may hold a
 * secret; the text of an `error` message is the one exception.
 */
import { spawn } from 'node:child_process';
import { basename } from 'node:path';
import { grantOf } from './capabilities.mjs';
import { CapabilityDeniedError, ProviderFailedError, ProviderNotFoundError, ProviderReplyError } from './errors.mjs';
import { manifestProviders } from './manifest.mjs';
import { discoverProviders, invocation, PROVIDER_PREFIX } from './plugins.mjs';

export const PROVIDER_MESSAGES = Object.freeze(['info', 'error', 'debug', 'setenv']);
export const PROVIDER_MESSAGES_ENV = 'PRISM_PROVIDER_MESSAGES';
export const PROVIDER_TIMEOUT_MS = 120_000;

const MAX_REPLY_BYTES = 1024 * 1024;
const VARIABLE = /^[A-Z][A-Z0-9_]*$/;

/** What is wrong with one reply line, or the message it holds. The problem never quotes the line. */
function parseLine(line) {
  let value;
  try {
    value = JSON.parse(line);
  } catch {
    return { problem: 'is not JSON' };
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return { problem: 'is not an object' };
  const extra = Object.keys(value).some((key) => key !== 'type' && key !== 'message');
  if (extra || typeof value.type !== 'string' || typeof value.message !== 'string') return { problem: 'is not exactly { type, message }, both strings' };
  if (!PROVIDER_MESSAGES.includes(value.type)) return { problem: `has a type this version does not accept; it accepts ${PROVIDER_MESSAGES.join(', ')}` };
  return { message: value };
}

function parseSetenv(text) {
  const at = text.indexOf('=');
  if (at < 0) return { problem: 'is a setenv with no =' };
  const key = text.slice(0, at);
  const value = text.slice(at + 1);
  if (!VARIABLE.test(key)) return { problem: `is a setenv whose name does not match ${VARIABLE.source}` };
  if (value.includes('\0')) return { problem: 'is a setenv whose value holds a NUL' };
  return { key, value };
}

function stop(child, platform) {
  // On Windows a .cmd shim is cmd.exe with the provider beneath it, and killing cmd.exe leaves the provider running.
  if (platform === 'win32' && child.pid !== undefined) spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }).on('error', () => child.kill());
  else child.kill();
  child.stdout.destroy();
  child.unref();
}

/** Run one verb of one provider. Resolves to the `setenv` pairs of its reply, as a Map. */
function call(provider, verb, { application, directory, env, platform, timeoutMs, onMessage }) {
  const label = `${basename(provider.file).replace(/\.[^.]+$/, '')} (capability ${provider.name})`;
  const details = { capability: provider.name, type: provider.type };
  const { command, args, options } = invocation(provider.file, ['--project-name', application, verb, ...provider.flags, provider.name], { env, platform });
  return new Promise((done, reject) => {
    const variables = new Map();
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let reported = null;
    let pending = '';
    let size = 0;
    let lineNumber = 0;
    let settled = false;
    let child;
    let timer;
    const settle = (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else done(variables);
    };
    const abort = (error) => {
      settle(error);
      stop(child, platform);
    };
    const badReply = (problem) => abort(new ProviderReplyError(`${label} broke the protocol on ${verb}: reply line ${lineNumber} ${problem}`, { check: 'provider.reply', details: { ...details, line: lineNumber } }));
    const onLine = (line) => {
      lineNumber += 1;
      if (line.trim() === '') return;
      const { problem, message } = parseLine(line);
      if (problem) return badReply(problem);
      if (message.type === 'setenv') {
        if (verb !== 'up') return;
        const pair = parseSetenv(message.message);
        if (pair.problem) return badReply(pair.problem);
        variables.set(pair.key, pair.value);
        return;
      }
      if (message.type === 'error') reported ??= message.message;
      try {
        onMessage?.({ capability: provider.name, type: message.type, message: message.message });
      } catch (error) {
        abort(error);
      }
    };
    const onText = (text) => {
      pending += text;
      const lines = pending.split('\n');
      pending = lines.pop();
      for (const line of lines) {
        if (settled) return;
        onLine(line.replace(/\r$/, ''));
      }
    };
    try {
      child = spawn(command, args, { ...options, cwd: directory, env: { ...env, [PROVIDER_MESSAGES_ENV]: PROVIDER_MESSAGES.join(',') }, stdio: ['ignore', 'pipe', 'inherit'], windowsHide: true });
    } catch (error) {
      settle(new ProviderFailedError(`${label} could not start: ${error.code ?? error.message}`, { check: 'provider.spawn', details, cause: error }));
      return;
    }
    timer = setTimeout(() => abort(new ProviderFailedError(`${label} did not finish ${verb} within ${timeoutMs} ms`, { check: 'provider.timeout', details })), timeoutMs);
    child.on('error', (error) => settle(new ProviderFailedError(`${label} could not start: ${error.code ?? error.message}`, { check: 'provider.spawn', details, cause: error })));
    child.stdout.on('data', (chunk) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_REPLY_BYTES) return abort(new ProviderReplyError(`${label} replied with more than ${MAX_REPLY_BYTES} bytes on ${verb}`, { check: 'provider.reply', details }));
      try {
        onText(decoder.decode(chunk, { stream: true }));
      } catch {
        badReply('is not UTF-8');
      }
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      try {
        onText(decoder.decode());
      } catch {
        return badReply('is not UTF-8');
      }
      if (!settled && pending !== '') onLine(pending.replace(/\r$/, ''));
      if (settled) return;
      if (code !== 0 || reported !== null) {
        const why = reported !== null ? `failed: ${reported}` : code === null ? `was stopped by ${signal}` : `exited ${code}`;
        return settle(new ProviderFailedError(`${label} ${why}`, { check: 'provider.failed', details: { ...details, exitCode: code, signal } }));
      }
      settle(null);
    });
  });
}

/** Every declaration, checked against the grant and the PATH, before anything runs. */
function plan(project, options) {
  const { manifest, grant: { capabilities, capabilitySet }, directory } = project;
  const { env = process.env, platform = process.platform, timeoutMs = PROVIDER_TIMEOUT_MS, onMessage = null } = options;
  const grant = grantOf(capabilities, capabilitySet);
  const declared = manifestProviders(manifest);
  for (const provider of declared) {
    if (!grant.allows('providers', provider.type)) {
      const by = grant.set === null ? 'no capability set grants anything' : `capability set ${grant.set} does not allow it`;
      throw new CapabilityDeniedError(`capability ${provider.name} needs provider ${provider.type}, and ${by}`, { check: 'capabilities.providers', details: { kind: 'providers', resource: provider.type, capability: provider.name, set: grant.set } });
    }
  }
  const found = discoverProviders({ env, platform });
  const providers = declared.map((provider) => {
    const file = found.get(provider.type);
    if (file === undefined) {
      throw new ProviderNotFoundError(`capability ${provider.name} needs ${PROVIDER_PREFIX}${provider.type}, and it is not on the PATH`, { check: 'provider.not-found', details: { capability: provider.name, type: provider.type } });
    }
    return { ...provider, file };
  });
  return { grant, providers, context: { application: manifest.application.name, directory, env, platform, timeoutMs, onMessage } };
}

/**
 * Run `up` for every provider the manifest declares, in order of capability
 * name, and produce the environment. Sets it on no process: the caller gives
 * it to what it runs.
 *
 * `env` holds the granted `<NAME>_<VAR>` variables, `providers` what ran and
 * which variables each produced, and `withheld` the ones the capability set
 * does not allow, by name. There is no rollback, because `down` may delete
 * data: a failure's `details.started` names the capabilities already up.
 *
 * @param {{ manifest: object, grant: { capabilities: object | null, capabilitySet: string }, directory: string }} project the result of `readManifest`
 * @param {{ env?: Record<string, string | undefined>, platform?: string, timeoutMs?: number, onMessage?: (message: { capability: string, type: string, message: string }) => void }} [options]
 */
export async function resolveProviders(project, options = {}) {
  const { grant, providers, context } = plan(project, options);
  // A name with two sources would be decided by the order they ran in.
  const sources = new Map(Object.keys(project.manifest.variables ?? {}).map((name) => [name, `variables.${name}`]));
  const env = {};
  const withheld = [];
  const ran = [];
  for (const provider of providers) {
    const started = ran.map((r) => r.name);
    try {
      const reply = await call(provider, 'up', context);
      const produced = [];
      for (const [key, value] of reply) {
        const name = `${provider.name.toUpperCase()}_${key}`;
        const variable = name.toLowerCase();
        if (sources.has(variable)) {
          throw new ProviderReplyError(`capability ${provider.name} produced ${name}, and ${sources.get(variable)} also names ${variable}`, { check: 'provider.collision', details: { capability: provider.name, type: provider.type, variable, other: sources.get(variable) } });
        }
        sources.set(variable, `capability ${provider.name}`);
        if (grant.allows('variables', variable)) {
          env[name] = value;
          produced.push(name);
        } else {
          withheld.push(Object.freeze({ capability: provider.name, name, variable }));
        }
      }
      ran.push(Object.freeze({ name: provider.name, type: provider.type, file: provider.file, variables: Object.freeze(produced) }));
    } catch (error) {
      if (error.details !== undefined) error.details = { ...error.details, started };
      throw error;
    }
  }
  return Object.freeze({ env: Object.freeze(env), providers: Object.freeze(ran), withheld: Object.freeze(withheld) });
}

/**
 * Run `down` for every declared provider, in reverse order, attempting all of
 * them. Throws the first failure, with `details.released` and `details.failed`
 * naming the capabilities on each side. Returns `{ providers }`, the names
 * released.
 *
 * @param {{ manifest: object, grant: { capabilities: object | null, capabilitySet: string }, directory: string }} project the result of `readManifest`
 * @param {{ env?: Record<string, string | undefined>, platform?: string, timeoutMs?: number, onMessage?: (message: { capability: string, type: string, message: string }) => void }} [options]
 */
export async function releaseProviders(project, options = {}) {
  const { providers, context } = plan(project, options);
  const released = [];
  const errors = [];
  for (const provider of [...providers].reverse()) {
    try {
      await call(provider, 'down', context);
      released.push(provider.name);
    } catch (error) {
      errors.push(error);
    }
  }
  if (errors.length > 0) {
    const [first] = errors;
    if (first.details !== undefined) first.details = { ...first.details, released, failed: errors.map((e) => e.details?.capability) };
    throw first;
  }
  return Object.freeze({ providers: Object.freeze(released) });
}
