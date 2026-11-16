/**
 * `prism-code setup` (experimental): one run adds the UOR MCP server to every
 * agent on this machine that takes a remote HTTP server, registers the
 * holo:// handler, and remembers the preferred agent.
 *
 * Like open.mjs, everything here plans first: `planSetup` reads the fixture or
 * the real machine through its context and returns, per agent, a status and
 * the steps that would change it. `applySetup` carries the steps out, and
 * `--dry-run` prints them instead. A server already present with the same URL
 * is left alone, one with another URL is reported and left alone, and a file
 * that does not parse is never rewritten.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENTS, LOCAL_AGENTS, MCP_NAME, MCP_URL, prismHome, readPreferredAgent, which } from './agents.mjs';
import { fail } from './errors.mjs';
import { commandLine } from './open.mjs';
import { invocation } from './plugins.mjs';
import { parseToml } from './toml.mjs';
import { JOURNEY_NAME, planJourney } from './journey/register.mjs';
import { VERSION } from './version.mjs';

/** The files `setup` copies out of the package as the holo:// handler: the entry and what it imports. */
export const HANDLER_FILES = Object.freeze(['handler.mjs', 'open.mjs', 'agents.mjs', 'errors.mjs', 'plugins.mjs']);
export const REGISTRY_KEY = 'HKCU\\Software\\Classes\\holo';
/** HKCU and HKLM merged: the command Windows actually opens a holo:// link with. */
export const OPEN_COMMAND_KEY = 'HKCR\\holo\\shell\\open\\command';
export const MAC_APP = 'Prism Open.app';
export const LSREGISTER = '/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';
export const DESKTOP_FILE = 'prism-open.desktop';

const sameUrl = (url) => typeof url === 'string' && url.replace(/\/+$/, '') === MCP_URL.replace(/\/+$/, '');
const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);

/** Where each agent keeps its MCP servers on this OS. */
export function agentPaths({ platform, home, env }) {
  const userConfig = platform === 'win32' ? env.APPDATA || join(home, 'AppData', 'Roaming') : platform === 'darwin' ? join(home, 'Library', 'Application Support') : env.XDG_CONFIG_HOME || join(home, '.config');
  const codex = env.CODEX_HOME || join(home, '.codex');
  return {
    'claude-code': { file: join(env.CLAUDE_CONFIG_DIR || home, '.claude.json') },
    codex: { dir: codex, file: join(codex, 'config.toml') },
    cursor: { dir: join(home, '.cursor'), file: join(home, '.cursor', 'mcp.json') },
    vscode: { dir: join(userConfig, 'Code', 'User'), file: join(userConfig, 'Code', 'User', 'mcp.json') },
    'claude-desktop': { dir: join(userConfig, 'Claude'), file: join(userConfig, 'Claude', 'claude_desktop_config.json') },
  };
}

const MANUAL = {
  'claude-desktop': `its config file takes no remote server; in Claude Desktop open Settings > Connectors > Add custom connector and enter ${MCP_URL}`,
  claude: `in claude.ai, Customize > Connectors: add ${MCP_URL} as a custom connector with no sign in`,
  chatgpt: `in ChatGPT, Settings: connect ${MCP_URL} as an MCP server`,
};

/** A JSON config with servers under `key`: add `entry` as lexlean unless a lexlean is there. */
function planJson(agent, file, key, entry, context) {
  const text = context.readFile(file);
  let doc = {};
  if (text !== null && text.trim() !== '') {
    const byHand = `add "${key}": {"${MCP_NAME}": ${JSON.stringify(entry)}} by hand`;
    try {
      doc = JSON.parse(text);
    } catch {
      return { agent, status: 'unreadable', detail: `${file} is not plain JSON (comments or trailing commas?); ${byHand}` };
    }
    if (!isObject(doc) || (doc[key] !== undefined && !isObject(doc[key]))) return { agent, status: 'unreadable', detail: `${file} has no "${key}" object; ${byHand}` };
  }
  const existing = doc[key]?.[MCP_NAME];
  if (existing !== undefined) {
    if (sameUrl(existing?.url)) return { agent, status: 'already', detail: file };
    return { agent, status: 'conflict', detail: `${file} has a ${MCP_NAME} server at ${existing?.url ?? JSON.stringify(existing)}; left as it is` };
  }
  const indent = text?.match(/^([ \t]+)"/m)?.[1] ?? '  ';
  const next = { ...doc, [key]: { ...(doc[key] ?? {}), [MCP_NAME]: entry } };
  return {
    agent,
    status: 'configure',
    detail: file,
    steps: [{ kind: 'json', path: file, key: `${key}.${MCP_NAME}`, value: entry, content: `${JSON.stringify(next, null, indent)}\n`, backup: text !== null }],
  };
}

function planClaudeCode(paths, context) {
  const { file } = paths['claude-code'];
  const binary = context.find('claude');
  if (!binary && context.readFile(file) === null) return { agent: 'claude-code', status: 'not-found' };
  const fromFile = planJson('claude-code', file, 'mcpServers', { type: 'http', url: MCP_URL }, context);
  if (!binary || fromFile.status === 'already' || fromFile.status === 'conflict') return fromFile;
  // The CLI owns ~/.claude.json; with it on the PATH, it writes the entry. User scope, so every project sees it.
  const args = ['mcp', 'add', '--transport', 'http', '--scope', 'user', MCP_NAME, MCP_URL];
  return { agent: 'claude-code', status: 'configure', detail: `claude ${args.join(' ')}`, steps: [{ kind: 'command', ...invocation(binary, args, context), display: `claude ${args.join(' ')}` }] };
}

function planCodex(paths, context) {
  const { dir, file } = paths.codex;
  if (!context.find('codex') && !context.exists(dir)) return { agent: 'codex', status: 'not-found' };
  const text = context.readFile(file);
  if (text !== null) {
    let servers;
    try {
      servers = parseToml(text).mcp_servers;
    } catch {
      // This reader covers the TOML of manifests, not all of TOML. Appending a new table is still safe while the name is nowhere in the file.
      if (text.includes(MCP_NAME)) return { agent: 'codex', status: 'unreadable', detail: `${file} names ${MCP_NAME} in TOML this reader does not parse; check [mcp_servers.${MCP_NAME}] by hand` };
    }
    const existing = isObject(servers) ? servers[MCP_NAME] : undefined;
    if (existing !== undefined) {
      if (sameUrl(existing?.url)) return { agent: 'codex', status: 'already', detail: file };
      return { agent: 'codex', status: 'conflict', detail: `${file} has [mcp_servers.${MCP_NAME}] at ${existing?.url ?? 'no url'}; left as it is` };
    }
  }
  const before = text === null || text === '' ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  return { agent: 'codex', status: 'configure', detail: file, steps: [{ kind: 'append', path: file, content: `${before}[mcp_servers.${MCP_NAME}]\nurl = "${MCP_URL}"\n` }] };
}

/** What setup would do for one agent. */
export function planAgent(agent, context, paths = agentPaths(context)) {
  switch (agent) {
    case 'claude-code':
      return planClaudeCode(paths, context);
    case 'codex':
      return planCodex(paths, context);
    case 'cursor':
      if (!context.exists(paths.cursor.dir) && !context.find('cursor')) return { agent, status: 'not-found' };
      return planJson(agent, paths.cursor.file, 'mcpServers', { url: MCP_URL }, context);
    case 'vscode':
      if (!context.exists(paths.vscode.dir) && !context.find('code')) return { agent, status: 'not-found' };
      return planJson(agent, paths.vscode.file, 'servers', { type: 'http', url: MCP_URL }, context);
    case 'claude-desktop':
      if (!context.exists(paths['claude-desktop'].dir)) return { agent, status: 'not-found' };
      return { agent, status: 'manual', detail: MANUAL[agent] };
    default:
      return { agent, status: 'manual', detail: MANUAL[agent] };
  }
}

const appleScriptString = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
// A .desktop Exec argument: quoted, with the four reserved characters escaped, then backslashes and % escaped for the key file.
const desktopArgument = (s) => `"${String(s).replace(/([\\"`$])/g, '\\$1')}"`.replace(/\\/g, '\\\\').replace(/%/g, '%%');

/**
 * Where the handler is, for an app that owns holo:// and forwards holo://build links: it runs `node` with
 * `entry` and the link as the two arguments, never through a shell.
 */
export const HANDLER_RECORD_SCHEMA = 'prism/handler/1';

/**
 * holo:// may already belong to another program, such as the Hologram app. Taking it over would send that
 * program's links to a handler that opens only holo://build, so setup leaves the registration alone. It still
 * installs the handler and its record, so that program can forward holo://build links to it.
 */
const foreign = (current, record, steps) => ({
  status: 'conflict',
  detail: `holo:// already opens ${current}; left alone. That app can forward holo://build links to the handler ${record} names`,
  steps,
});

/** The holo:// handler: copy the entry out of the package and record where it is, then register it with the OS. */
export function planHandler(context) {
  const { platform, home, env, configDir, node, sourceDir } = context;
  const handlerDir = join(configDir, 'handler');
  const entry = join(handlerDir, 'handler.mjs');
  const steps = [];
  let same = true;
  for (const name of HANDLER_FILES) {
    const from = join(sourceDir, name);
    const to = join(handlerDir, name);
    if (context.readFile(to) !== context.readFile(from)) {
      same = false;
      steps.push({ kind: 'copy', from, to });
    }
  }
  const record = join(configDir, 'handler.json');
  const recordContent = `${JSON.stringify({ schema: HANDLER_RECORD_SCHEMA, scheme: 'holo', host: 'build', node, entry }, null, 2)}\n`;
  if (context.readFile(record) !== recordContent) {
    same = false;
    steps.push({ kind: 'write', path: record, content: recordContent });
  }
  if (platform === 'win32') {
    const command = `"${node}" "${entry}" "%1"`;
    const where = `${REGISTRY_KEY} -> ${command}`;
    const current = context.registryValue(OPEN_COMMAND_KEY);
    if (current && !current.includes(entry)) return foreign(current, record, steps);
    if (same && current === command) return { status: 'already', detail: where, steps: [] };
    for (const args of [
      ['add', REGISTRY_KEY, '/ve', '/d', 'URL:Prism build link', '/f'],
      ['add', REGISTRY_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
      ['add', `${REGISTRY_KEY}\\shell\\open\\command`, '/ve', '/d', command, '/f'],
    ]) {
      steps.push({ kind: 'command', command: 'reg.exe', args, options: {} });
    }
    return { status: 'configure', detail: where, steps };
  }
  if (platform === 'darwin') {
    const app = join(home, 'Applications', MAC_APP);
    const script = join(handlerDir, 'prism-open.applescript');
    const source = [
      'on open location theURL',
      `\tdo shell script quoted form of ${appleScriptString(node)} & " " & quoted form of ${appleScriptString(entry)} & " " & quoted form of theURL & " >/dev/null 2>&1 &"`,
      'end open location',
      '',
    ].join('\n');
    const plist = join(app, 'Contents', 'Info.plist');
    if (same && context.readFile(script) === source && (context.readFile(plist) ?? '').includes('<string>holo</string>')) return { status: 'already', detail: app, steps: [] };
    steps.push({ kind: 'write', path: script, content: source });
    if (context.exists(app)) steps.push({ kind: 'remove', path: app });
    steps.push(
      { kind: 'command', command: 'osacompile', args: ['-o', app, script], options: {} },
      {
        kind: 'command',
        command: '/usr/libexec/PlistBuddy',
        args: [
          '-c', 'Add :CFBundleURLTypes array',
          '-c', 'Add :CFBundleURLTypes:0 dict',
          '-c', 'Add :CFBundleURLTypes:0:CFBundleURLName string foundation.uor.prism',
          '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array',
          '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string holo',
          plist,
        ],
        options: {},
      },
      // Editing Info.plist breaks the applet's ad-hoc signature, which Apple silicon requires; sign it again.
      { kind: 'command', command: 'codesign', args: ['--force', '--sign', '-', app], options: {} },
      { kind: 'command', command: LSREGISTER, args: ['-f', app], options: {} },
    );
    return { status: 'configure', detail: app, steps };
  }
  const applications = join(env.XDG_DATA_HOME || join(home, '.local', 'share'), 'applications');
  const file = join(applications, DESKTOP_FILE);
  const content = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=Prism',
    'Comment=Opens holo://build links in your agent',
    `Exec=${desktopArgument(node)} ${desktopArgument(entry)} %u`,
    'Terminal=false',
    'NoDisplay=true',
    'MimeType=x-scheme-handler/holo;',
    '',
  ].join('\n');
  const current = context.mimeDefault('x-scheme-handler/holo');
  if (current && current !== DESKTOP_FILE) return foreign(current, record, steps);
  if (same && context.readFile(file) === content) return { status: 'already', detail: file, steps: [] };
  steps.push({ kind: 'write', path: file, content });
  const xdgMime = context.find('xdg-mime');
  if (!xdgMime) return { status: 'manual', detail: `${file} written; xdg-mime not found: make ${DESKTOP_FILE} the default for x-scheme-handler/holo`, steps };
  steps.push({ kind: 'command', command: xdgMime, args: ['default', DESKTOP_FILE, 'x-scheme-handler/holo'], options: {} });
  const database = context.find('update-desktop-database');
  if (database) steps.push({ kind: 'command', command: database, args: [applications], options: {}, optional: true });
  return { status: 'configure', detail: file, steps };
}

/**
 * Which agent `open` uses for a link that names none: `--agent` when given, else the one remembered, else the
 * first terminal agent found.
 */
function planPreferred(requested, agents, context) {
  const current = readPreferredAgent(context.configDir);
  const found = agents.find((a) => AGENTS[a.agent].kind === 'terminal' && a.status !== 'not-found')?.agent ?? null;
  const agent = requested ?? current ?? found;
  if (agent === null) return { agent: null, steps: [] };
  if (agent === current) return { agent, steps: [] };
  const file = join(context.configDir, 'config.json');
  let config = {};
  try {
    const parsed = JSON.parse(context.readFile(file) ?? '{}');
    if (isObject(parsed)) config = parsed;
  } catch {
    // An unreadable config is replaced; it holds nothing but this preference.
  }
  return { agent, steps: [{ kind: 'write', path: file, content: `${JSON.stringify({ ...config, preferredAgent: agent }, null, 2)}\n` }] };
}

/** The one Prism skill, shipped in this package beside the CLI it describes (generated from skills/prism/SKILL.md). */
export const SKILL_FILE = fileURLToPath(new URL('../skill/SKILL.md', import.meta.url));
const SKILL_MARKER = '.prism-code.json';
/** Skills an earlier setup installed and the one `prism` skill replaces; removed only where setup's marker is. */
export const RETIRED_SKILLS = Object.freeze(['prism-sdk']);

/**
 * The skill this package ships. Never throws: an unreadable file is `{ error }`, and setup goes on without it.
 * @returns {{ skills: { name: string, markdown: string, digest: string, url: string }[] } | { error: string }}
 */
export function bundledSkills(file = SKILL_FILE) {
  try {
    const markdown = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
    const digest = `sha256:${createHash('sha256').update(markdown).digest('hex')}`;
    return { skills: [{ name: 'prism', markdown, digest, url: `prism-code@${VERSION}` }] };
  } catch (error) {
    return { error: `${file}: ${error.code ?? error.message}` };
  }
}

/**
 * Write each skill where the agents found here read skills: `~/.claude/skills` for Claude Code, and the shared
 * `~/.agents/skills` for Codex, Cursor and VS Code. A skill folder prism-code did not write is left alone; one it
 * wrote (it holds the marker) is brought up to date, and a retired one it wrote is removed.
 */
export function planSkills(fetched, agents, context) {
  if (fetched.error) return { status: 'unreadable', detail: `not read: ${fetched.error}`, steps: [] };
  const found = new Set(agents.filter((a) => a.status !== 'not-found').map((a) => a.agent));
  const dirs = [];
  if (found.has('claude-code')) dirs.push(join(context.env.CLAUDE_CONFIG_DIR || join(context.home, '.claude'), 'skills'));
  if (['codex', 'cursor', 'vscode'].some((a) => found.has(a))) dirs.push(join(context.home, '.agents', 'skills'));
  if (dirs.length === 0 || fetched.skills.length === 0) return { status: 'not-found', detail: dirs.length ? 'no skill to install' : 'no agent here reads skill folders', steps: [] };
  const steps = [];
  const kept = [];
  const retired = [];
  for (const dir of dirs) {
    for (const name of RETIRED_SKILLS) {
      if (context.readFile(join(dir, name, SKILL_MARKER)) === null) continue;
      steps.push({ kind: 'remove', path: join(dir, name) });
      retired.push(name);
    }
    for (const skill of fetched.skills) {
      const file = join(dir, skill.name, 'SKILL.md');
      const current = context.readFile(file);
      if (current === skill.markdown) continue;
      if (current !== null && context.readFile(join(dir, skill.name, SKILL_MARKER)) === null) {
        kept.push(file);
        continue;
      }
      steps.push({ kind: 'write', path: file, content: skill.markdown }, { kind: 'write', path: join(dir, skill.name, SKILL_MARKER), content: `${JSON.stringify({ source: skill.url, digest: skill.digest })}\n` });
    }
  }
  const replaced = [...new Set(retired)];
  const detail = `${fetched.skills.map((s) => s.name).join(', ')} in ${dirs.join(', ')}${replaced.length ? `; replaces ${replaced.join(', ')}` : ''}${kept.length ? `; left alone, not written by prism-code: ${kept.join(', ')}` : ''}`;
  return { status: steps.length > 0 ? 'configure' : kept.length > 0 ? 'conflict' : 'already', detail, steps };
}

/**
 * Everything setup would do. `agent` limits the agents to one, and makes it the preferred agent. `skills` is what
 * `fetchSkills` returned; without it there is no skills row.
 * @param {{ agent?: string, skills?: object }} options
 */
export function planSetup({ agent, skills, hosted = false } = {}, context) {
  if (agent !== undefined && !Object.hasOwn(AGENTS, agent)) fail('setup.agent', `${agent} is not an agent; one of ${Object.keys(AGENTS).join(', ')}`);
  const paths = agentPaths(context);
  const found = (agent === undefined ? LOCAL_AGENTS : [agent]).map((id) => planAgent(id, context, paths));
  // The hosted lexlean server stores what it is sent unlisted, not privately, so no agent gets it unless setup is told --hosted.
  // The local prism server (the journey rows) proves on this machine either way. An entry already there is left as it is.
  const agents = hosted ? found : found.map((a) => (a.status === 'configure' || a.status === 'manual' ? { agent: a.agent, status: 'local-only', detail: `the hosted ${MCP_NAME} server is added only with --hosted; the local prism server proves on this machine` } : a));
  // The local server is planned over the rows that will be carried out. Planned over the hosted rows
  // as found, it folded their edit into its own: without --hosted the hosted server was still written
  // to each agent that did not have it, while the report said "not added", and with no backup of the
  // file, since the hosted row was taken to have made one. Found on a clean profile, 2026-11-16, in 0.9.2.
  const plan = { hosted, agents, journey: planJourney(agents, context, paths), handler: planHandler(context), preferred: planPreferred(agent, found, context) };
  if (skills !== undefined) plan.skills = planSkills(skills, agents, context);
  return plan;
}

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

/** The default value of a registry key, or null; Windows only. */
function registryValue(key) {
  const result = spawnSync('reg.exe', ['query', key, '/ve'], { encoding: 'utf8', windowsHide: true });
  if (result.status !== 0) return null;
  return result.stdout.match(/REG_SZ\s+(.*?)\r?$/m)?.[1] ?? null;
}

/**
 * Whether the Claude Desktop app is running: true, false, or null when the
 * process list could not be read. Claude Code is also `claude.exe` on Windows
 * and `claude` elsewhere, so the app is known by where it is installed: the
 * Store package or the installer's AnthropicClaude folder, or Claude.app.
 */
export function claudeDesktopRunning({ platform = process.platform, run = spawnSync } = {}) {
  let result;
  if (platform === 'win32') {
    result = run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', 'Get-Process -Name claude -ErrorAction SilentlyContinue | ForEach-Object { $_.Path }'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
  } else if (platform === 'darwin') {
    result = run('ps', ['-axo', 'comm='], { encoding: 'utf8', timeout: 15000 });
  } else return false;
  if (result.error || result.status !== 0) return null;
  const paths = String(result.stdout ?? '').split(/\r?\n/);
  const app = platform === 'win32' ? /[\\/](WindowsApps[\\/]Claude_[^\\/]*|AnthropicClaude)[\\/]/i : /\/Claude\.app\/Contents\/MacOS\/Claude$/;
  return paths.some((path) => app.test(path.trim()));
}

/** The context `planSetup` reads on this machine. */
export function hostSetupContext({ env = process.env, platform = process.platform, home = homedir() } = {}) {
  return {
    platform,
    home,
    env,
    find: (name) => which(name, { env, platform }),
    exists: existsSync,
    readFile: readText,
    registryValue,
    claudeDesktopRunning: () => claudeDesktopRunning({ platform }),
    mimeDefault: (type) => {
      const xdgMime = platform === 'linux' ? which('xdg-mime', { env, platform }) : null;
      if (!xdgMime) return null;
      const result = spawnSync(xdgMime, ['query', 'default', type], { encoding: 'utf8' });
      return result.status === 0 ? result.stdout.trim() || null : null;
    },
    configDir: prismHome(env, home),
    node: process.execPath,
    sourceDir: dirname(fileURLToPath(import.meta.url)),
  };
}

function writeAtomic(path, content) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.prism-${process.pid}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

/** Carry out one step. A command that fails throws, unless it is optional. */
export function applyStep(step, { run = spawnSync } = {}) {
  switch (step.kind) {
    case 'json':
      if (step.backup) copyFileSync(step.path, `${step.path}.prism-backup`);
      writeAtomic(step.path, step.content);
      return;
    case 'append':
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, step.content, { flag: 'a' });
      return;
    case 'write':
      writeAtomic(step.path, step.content);
      return;
    case 'copy':
      mkdirSync(dirname(step.to), { recursive: true });
      copyFileSync(step.from, step.to);
      return;
    case 'remove':
      rmSync(step.path, { recursive: true, force: true });
      return;
    case 'command': {
      const result = run(step.command, step.args, { ...step.options, encoding: 'utf8', windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
      if ((result.error || result.status !== 0) && !step.optional) {
        fail('setup.command', `${step.display ?? step.command} failed: ${result.error?.code ?? `exit ${result.status}`}${result.stderr ? `: ${result.stderr.trim()}` : ''}`);
      }
      return;
    }
    default:
      throw new Error(`unknown step ${step.kind}`);
  }
}

/** Carry out a plan. A step that fails marks its row failed and the rest still run. */
export function applySetup(plan, options) {
  for (const row of [...plan.agents, ...(plan.journey ?? []), plan.handler, ...(plan.skills ? [plan.skills] : []), plan.preferred]) {
    try {
      for (const step of row.steps ?? []) applyStep(step, options);
    } catch (error) {
      row.status = 'failed';
      row.detail = error.message;
    }
  }
  return plan;
}

const WORDS = {
  configure: ['would configure', 'configured'],
  already: ['already configured', 'already configured'],
  'not-found': ['not found', 'not found'],
  manual: ['manual', 'manual'],
  conflict: ['left alone', 'left alone'],
  unreadable: ['skipped', 'skipped'],
  failed: ['failed', 'failed'],
  'local-only': ['not added', 'not added'],
};
const SKILL_WORDS = { configure: ['would install', 'installed'], already: ['already installed', 'already installed'], conflict: ['left alone', 'left alone'], unreadable: ['skipped', 'skipped'], 'not-found': ['none', 'none'], failed: ['failed', 'failed'] };
const HANDLER_WORDS = { configure: ['would register', 'registered'], already: ['already registered', 'already registered'], conflict: ['left alone', 'left alone'], manual: ['manual', 'manual'], failed: ['failed', 'failed'] };

function formatStep(step) {
  switch (step.kind) {
    case 'json':
      return `set ${step.key} = ${JSON.stringify(step.value)} in ${step.path}${step.backup ? ` (backup ${step.path}.prism-backup)` : ''}`;
    case 'append':
      return `append to ${step.path}:\n${step.content.replace(/^\n+/, '').trimEnd().replace(/^/gm, '        ')}`;
    case 'write':
      return `write ${step.path}`;
    case 'copy':
      return `copy ${step.from} to ${step.to}`;
    case 'remove':
      return `remove ${step.path}`;
    default:
      return `run ${step.display ?? commandLine(step.command, step.args)}`;
  }
}

/** One line per agent for each server, then the handler, the skills and the preferred agent; with `dryRun`, every step under its row. */
export function formatSetup(plan, { dryRun = false } = {}) {
  const tense = dryRun ? 0 : 1;
  const lines = [`prism-code setup${dryRun ? ' --dry-run' : ''}: your agents`, plan.hosted === false ? `  the server ${MCP_NAME}, remote at ${MCP_URL}: not added; it stores models unlisted, not privately (pass --hosted to add it)` : `  the server ${MCP_NAME}, remote at ${MCP_URL}: checks and proves LexLean models; it stores them unlisted, not privately`];
  const row = (name, words, status, detail, steps) => {
    lines.push(`  ${name.padEnd(16)}${(words[status] ?? [status, status])[tense].padEnd(20)}${detail ?? ''}`.trimEnd());
    if (dryRun) for (const step of steps ?? []) lines.push(`      ${formatStep(step)}`);
  };
  // Without --hosted nothing is done for that server, so its agents are not listed a second time
  // under it: only where it already is, from an earlier setup, in one line. Every agent has its
  // row under the local server below.
  const kept = plan.agents.filter((a) => a.status === 'already').map((a) => a.agent);
  if (plan.hosted !== false || !plan.journey?.length) for (const a of plan.agents) row(a.agent, WORDS, a.status, a.detail, a.steps);
  else if (kept.length) lines.push(`    already in ${kept.join(', ')} from an earlier setup; left as it is`);
  if (plan.journey?.length) {
    lines.push(`  the server ${JOURNEY_NAME}, local (prism-code mcp): checks the spec the agent drafts, proves and builds the app`);
    for (const a of plan.journey) row(a.agent, WORDS, a.status, a.detail, a.steps);
    // An agent that is not on this machine has no row above; say so once, here.
    if (plan.hosted === false) for (const a of plan.agents) if (a.status === 'not-found' && !plan.journey.some((j) => j.agent === a.agent)) row(a.agent, WORDS, a.status, a.detail, []);
  }
  row('holo://', HANDLER_WORDS, plan.handler.status, plan.handler.detail, plan.handler.steps);
  if (plan.skills) row('skills', SKILL_WORDS, plan.skills.status, plan.skills.detail, plan.skills.steps);
  const preferred = plan.preferred.agent ? `${plan.preferred.agent}${plan.preferred.steps.length ? '' : ' (unchanged)'}` : 'none: pass --agent <id>';
  lines.push(`  ${'preferred agent'.padEnd(16)}${preferred}`);
  if (dryRun) for (const step of plan.preferred.steps) lines.push(`      ${formatStep(step)}`);
  return `${lines.join('\n')}\n`;
}

/** The sentence a new user tries first; the same one the skill and the website use. */
export const FIRST_SENTENCE = 'build me a Prism app that tells whether a year is a leap year';

/**
 * What to do after setup, numbered: sign in to GitHub when that is missing,
 * restart the agent when a server was added to it, then the first sentence.
 * `github` is the machine half's github row, or null when it did not run.
 */
export function nextSteps(plan, { github = null } = {}) {
  const agent = plan.preferred?.agent ?? null;
  const row = plan.agents.find((a) => a.agent === agent);
  if (agent === null || !row || row.status === 'not-found') {
    if (agent === null && plan.agents.some((a) => a.status !== 'not-found')) return [];
    return [`Install an agent, such as Claude Code (${AGENTS['claude-code'].install}), then run npx prism-code@latest setup again.`];
  }
  const label = AGENTS[agent]?.label ?? agent;
  const steps = [];
  if (github?.status === 'manual' && /not signed in/.test(github.detail ?? '')) steps.push('Run gh auth login, so your app builds on GitHub Actions and this machine needs no Docker.');
  const changed = [...plan.agents, ...(plan.journey ?? [])].some((r) => r.agent === agent && r.status === 'configure');
  // A running Claude Desktop would drop the entry, so it was not written: that comes before anything else.
  if (plan.journey?.some((r) => r.agent === 'claude-desktop' && r.status === 'manual')) steps.push(`Quit Claude Desktop (from the tray or menu bar too), then run npx prism-code@latest setup again, so it keeps the ${JOURNEY_NAME} server.`);
  if (changed) steps.push(`Restart ${label}, so it loads the new servers.`);
  steps.push(`Ask ${label}: "${FIRST_SENTENCE}"`);
  return steps;
}

/** The numbered next steps, as printed after the rows. */
export function formatNext(steps) {
  if (steps.length === 0) return '';
  const lines = steps.map((step, i) => `  ${i + 1}. ${step}`);
  return ['next', ...lines, ''].join('\n');
}
