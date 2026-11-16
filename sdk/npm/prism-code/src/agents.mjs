/**
 * The agents `prism-code setup` configures and `prism-code open` hands a
 * sentence to. The ids, the MCP server and the links are the ones the
 * uor.foundation build box uses (website src/site/build.ts), so a link the
 * website writes and a link this package opens name the same things.
 *
 * This module, open.mjs, handler.mjs, errors.mjs and plugins.mjs import only
 * node: modules and each other: `setup` copies them out of the package as the
 * holo:// handler, so the handler keeps working after npx clears its cache.
 */
import { accessSync, constants, readdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';

export const MCP_NAME = 'lexlean';
export const MCP_URL = 'https://mcp.uor.foundation/';

/** The longest sentence a holo:// link may carry, in characters. */
export const MAX_SENTENCE = 2000;

/**
 * `terminal` agents run as a command with the sentence as one argument, `editor` agents get their MCP install
 * link and the sentence on the clipboard, `web` agents get their prompt URL. `desktop` is only configured.
 */
export const AGENTS = Object.freeze({
  'claude-code': { label: 'Claude Code', kind: 'terminal', binary: 'claude', install: 'https://docs.claude.com/en/docs/claude-code/setup' },
  codex: { label: 'Codex', kind: 'terminal', binary: 'codex', install: 'https://developers.openai.com/codex/cli' },
  cursor: { label: 'Cursor', kind: 'editor', paste: 'the agent panel' },
  vscode: { label: 'VS Code', kind: 'editor', paste: 'Copilot agent mode' },
  'claude-desktop': { label: 'Claude Desktop', kind: 'desktop' },
  claude: { label: 'Claude', kind: 'web' },
  chatgpt: { label: 'ChatGPT', kind: 'web' },
});

/** The agents `setup` looks for on this machine, in the order it prints them. */
export const LOCAL_AGENTS = Object.freeze(['claude-code', 'codex', 'cursor', 'vscode', 'claude-desktop']);

/** The agents a holo://build link may name: the six of the website's build box. */
export const OPEN_AGENTS = Object.freeze(['claude-code', 'codex', 'cursor', 'vscode', 'claude', 'chatgpt']);

const cursorConfig = Buffer.from(JSON.stringify({ url: MCP_URL })).toString('base64');

/** Cursor's and VS Code's own MCP install links, byte for byte the website's. */
export const INSTALL_LINKS = Object.freeze({
  cursor: `cursor://anysphere.cursor-deeplink/mcp/install?name=${MCP_NAME}&config=${cursorConfig}`,
  vscode: `vscode:mcp/install?${encodeURIComponent(JSON.stringify({ name: MCP_NAME, type: 'http', url: MCP_URL }))}`,
});

/** The prompt URL of a web agent, with the sentence in it. */
export function promptUrl(agent, sentence) {
  if (agent === 'claude') return `https://claude.ai/new?q=${encodeURIComponent(sentence)}`;
  if (agent === 'chatgpt') return `https://chatgpt.com/?prompt=${encodeURIComponent(sentence)}`;
  return null;
}

/** Where prism-code keeps its own state: `$PRISM_HOME`, default `~/.prism`, as the container store does. */
export const prismHome = (env = process.env, home = homedir()) => env.PRISM_HOME || join(home, '.prism');

/** The preferred agent `setup` remembered, or null. A missing or unreadable file is no preference. */
export function readPreferredAgent(configDir) {
  try {
    const agent = JSON.parse(readFileSync(join(configDir, 'config.json'), 'utf8')).preferredAgent;
    return typeof agent === 'string' && Object.hasOwn(AGENTS, agent) ? agent : null;
  } catch {
    return null;
  }
}

const DEFAULT_PATHEXT = '.COM;.EXE;.BAT;.CMD';

/**
 * The executable `name` resolves to on the PATH, or null. On Windows the first PATHEXT extension present in a
 * directory wins, as cmd.exe resolves it. The context makes it testable: `exists(path)` defaults to the disk.
 */
export function which(name, { env = process.env, platform = process.platform, exists = isExecutable } = {}) {
  const windows = platform === 'win32';
  const path = (windows ? (env.Path ?? env.PATH) : env.PATH) ?? '';
  const extensions = windows ? (env.PATHEXT || DEFAULT_PATHEXT).split(';').filter(Boolean) : [''];
  const candidates = windows && extname(name) !== '' ? [''] : extensions;
  for (const dir of path.split(windows ? ';' : ':')) {
    if (!dir) continue;
    for (const extension of candidates) {
      const file = join(dir, `${name}${extension.toLowerCase()}`);
      if (exists(file, windows)) return file;
    }
  }
  return null;
}

function isExecutable(file, windows) {
  try {
    if (!statSync(file).isFile()) return false;
    if (!windows) accessSync(file, constants.X_OK);
    return true;
  } catch {
    // Node cannot stat an app execution alias (wt.exe in WindowsApps) and calls it missing; its directory still lists it.
    if (!windows) return false;
    try {
      const name = basename(file).toLowerCase();
      return readdirSync(dirname(file)).some((entry) => entry.toLowerCase() === name);
    } catch {
      return false;
    }
  }
}
