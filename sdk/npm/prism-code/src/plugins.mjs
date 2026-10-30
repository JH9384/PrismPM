/**
 * CLI plugins (#293, experimental): an executable named `prism-<name>` on the
 * PATH runs as `prism-code <name>`, and later as `prism <name>`, the same way
 * `docker-<name>` runs as `docker <name>`.
 *
 * A plugin answers two calls besides its own commands:
 *
 *   prism-<name> prism-cli-plugin-metadata
 *     prints {"schemaVersion":"1","vendor":"...","version":"...","shortDescription":"...","errorHooks":["build"]}
 *   prism-<name> prism-cli-plugin-hooks
 *     reads {"schemaVersion":"1","command":"build","args":[...],"exitCode":69} on stdin
 *     and prints {"messages":["..."]}
 *
 * Built-in verbs always win. A plugin that does not answer the metadata call
 * is listed as invalid and never runs. Error hooks run after a verb a plugin
 * names in `errorHooks` exits non-zero, as Docker's `error-hooks` do since
 * Engine 29.3.0; their messages are printed under "What's next:".
 *
 * Providers (#294) are found the same way under `prism-provider-<type>`, and
 * are not plugins: the plugin scan skips the `provider-` prefix.
 */
import { spawn, spawnSync } from 'node:child_process';
import { accessSync, constants, readdirSync, statSync } from 'node:fs';
import { constants as os } from 'node:os';
import { basename, extname, join } from 'node:path';

export const PLUGIN_PREFIX = 'prism-';
export const PROVIDER_PREFIX = 'prism-provider-';
export const METADATA_COMMAND = 'prism-cli-plugin-metadata';
export const HOOK_COMMAND = 'prism-cli-plugin-hooks';
export const PLUGIN_SCHEMA_VERSION = '1';
export const NO_HOOKS_ENV = 'PRISM_CODE_NO_HOOKS';

// `prism-code` itself is `prism-<code>`; it is the host, never a plugin.
const RESERVED = new Set(['code']);
const NAME = /^[a-z][a-z0-9-]*$/;
const CALL_TIMEOUT_MS = 5000;
const MAX_MESSAGES = 10;
const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

// The name after the prefix; the first PATH entry wins.
function scan(prefix, accepts, { env = process.env, platform = process.platform } = {}) {
  const windows = platform === 'win32';
  const path = (windows ? env.Path ?? env.PATH : env.PATH) ?? '';
  const extensions = windows ? (env.PATHEXT || DEFAULT_PATHEXT).split(';').filter(Boolean).map((e) => e.toLowerCase()) : null;
  const found = new Map();
  for (const dir of path.split(windows ? ';' : ':')) {
    if (!dir) continue;
    let entries;
    try {
      entries = readdirSync(dir);
    } catch {
      continue;
    }
    const here = new Map();
    for (const entry of entries) {
      const lower = entry.toLowerCase();
      if (!lower.startsWith(prefix)) continue;
      let name = entry;
      let rank = 0;
      if (windows) {
        // Windows runs the first PATHEXT extension present, and names are case-insensitive.
        rank = extensions.indexOf(extname(lower));
        if (rank < 0) continue;
        name = basename(lower, extname(lower));
      }
      name = name.slice(prefix.length);
      if (!NAME.test(name) || !accepts(name) || found.has(name)) continue;
      const file = join(dir, entry);
      if (!executable(file, windows)) continue;
      if (!here.has(name) || rank < here.get(name).rank) here.set(name, { file, rank });
    }
    for (const [name, { file }] of here) found.set(name, file);
  }
  return found;
}

/** @returns {Map<string, string>} plugin name to executable path; the first PATH entry wins */
export const discover = (context) => scan(PLUGIN_PREFIX, (name) => !RESERVED.has(name) && !name.startsWith('provider-'), context);

/** @returns {Map<string, string>} provider type to executable path; the first PATH entry wins */
export const discoverProviders = (context) => scan(PROVIDER_PREFIX, () => true, context);

function executable(file, windows) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

// cmd.exe reparses the line, so a `.cmd` or `.bat` plugin gets its arguments
// quoted and caret-escaped, as cross-spawn does. An npm shim forwards them
// through `%*`, which parses them a second time.
const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

export function escapeCmdArgument(arg, doubleEscape = false) {
  let quoted = String(arg)
    .replace(/(\\*)"/g, '$1$1\\"')
    .replace(/(\\*)$/, '$1$1');
  quoted = `"${quoted}"`.replace(CMD_META, '^$1');
  return doubleEscape ? quoted.replace(CMD_META, '^$1') : quoted;
}

/** The command, arguments and spawn options that run `file` with `args` on this platform. */
export function invocation(file, args, { env = process.env, platform = process.platform } = {}) {
  if (platform === 'win32' && /\.(cmd|bat)$/i.test(file)) {
    const line = [file.replace(CMD_META, '^$1'), ...args.map((a) => escapeCmdArgument(a, true))].join(' ');
    // Only process.env is case-insensitive; a plain env object may spell it COMSPEC, or restrict the PATH cmd.exe is on.
    return { command: env.ComSpec || env.COMSPEC || process.env.ComSpec || 'cmd.exe', args: ['/d', '/s', '/c', `"${line}"`], options: { windowsVerbatimArguments: true } };
  }
  return { command: file, args, options: {} };
}

function call(file, args, input, context) {
  const { command, args: argv, options } = invocation(file, args, context);
  return spawnSync(command, argv, { ...options, input, encoding: 'utf8', timeout: CALL_TIMEOUT_MS, windowsHide: true, stdio: ['pipe', 'pipe', 'ignore'] });
}

/** @returns {{ metadata: object } | { problem: string }} */
export function readMetadata(file, context) {
  const result = call(file, [METADATA_COMMAND], '', context);
  if (result.error || result.status !== 0) return { problem: `${METADATA_COMMAND} ${result.error ? `failed: ${result.error.code ?? result.error.message}` : `exited ${result.status}`}` };
  let metadata;
  try {
    metadata = JSON.parse(result.stdout);
  } catch {
    return { problem: `${METADATA_COMMAND} did not print JSON` };
  }
  if (metadata?.schemaVersion !== PLUGIN_SCHEMA_VERSION) return { problem: `schemaVersion is not "${PLUGIN_SCHEMA_VERSION}"` };
  for (const key of ['vendor', 'version', 'shortDescription']) {
    if (typeof metadata[key] !== 'string' || metadata[key] === '') return { problem: `metadata has no ${key}` };
  }
  if (metadata.errorHooks !== undefined && !(Array.isArray(metadata.errorHooks) && metadata.errorHooks.every((v) => typeof v === 'string'))) {
    return { problem: 'errorHooks is not a list of verbs' };
  }
  return { metadata };
}

/** Every plugin on the PATH that a built-in verb does not shadow, with its metadata or the problem with it. */
export function listPlugins({ builtins, ...context } = {}) {
  const plugins = [];
  for (const [name, file] of discover(context)) {
    if (builtins?.has(name)) continue;
    plugins.push({ name, file, ...readMetadata(file, context) });
  }
  return plugins.sort((a, b) => a.name.localeCompare(b.name));
}

/** The "Plugins" section of `--help`, or '' when there are none. */
export function pluginHelp(plugins) {
  if (plugins.length === 0) return '';
  const width = Math.max(...plugins.map((p) => p.name.length)) + 2;
  const lines = plugins.map((p) => `  ${p.name.padEnd(width)}${p.metadata ? `${p.metadata.shortDescription} (${p.metadata.vendor}, ${p.metadata.version})` : `invalid: ${p.problem}`}`);
  return `\nPlugins (experimental; prism-<name> on PATH runs as prism-code <name>):\n${lines.join('\n')}\n`;
}

/** Run a plugin with the arguments as given; resolves to its exit code. */
export function runPlugin(file, args, context) {
  const { command, args: argv, options } = invocation(file, args, context);
  return new Promise((done) => {
    const child = spawn(command, argv, { ...options, stdio: 'inherit' });
    // The plugin owns the terminal: a signal goes to it, and its exit code is ours.
    const forward = (signal) => child.kill(signal);
    for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, forward);
    const finish = (code) => {
      for (const signal of ['SIGINT', 'SIGTERM']) process.off(signal, forward);
      done(code);
    };
    child.on('error', (error) => {
      process.stderr.write(`${basename(file)}: ${error.message}\n`);
      finish(126);
    });
    child.on('exit', (code, signal) => finish(code ?? 128 + (os.signals[signal] ?? 0)));
  });
}

/**
 * Ask every plugin that hooks `command` what to say after it failed.
 * @returns {string[]} at most ten lines; empty when the command succeeded or hooks are off
 */
export function errorHookMessages({ command, args, exitCode, builtins, env = process.env, ...context }) {
  if (!exitCode || env[NO_HOOKS_ENV]) return [];
  const payload = JSON.stringify({ schemaVersion: PLUGIN_SCHEMA_VERSION, command, args, exitCode });
  const messages = [];
  for (const plugin of listPlugins({ builtins, env, ...context })) {
    if (!plugin.metadata?.errorHooks?.includes(command) || plugin.name === command) continue;
    const result = call(plugin.file, [HOOK_COMMAND], payload, { env, ...context });
    if (result.error || result.status !== 0) continue;
    try {
      const reply = JSON.parse(result.stdout);
      if (Array.isArray(reply?.messages)) messages.push(...reply.messages.filter((m) => typeof m === 'string'));
    } catch {
      // A hook that prints something else says nothing.
    }
  }
  return messages.slice(0, MAX_MESSAGES);
}
