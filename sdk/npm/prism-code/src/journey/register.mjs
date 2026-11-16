/**
 * The `prism` MCP server in each agent's configuration, beside `lexlean`.
 *
 * `lexlean` is remote: it checks and verifies LexLean an agent writes. `prism`
 * is local, `prism-code mcp` on stdio: it asks the spec questions, writes the
 * model itself and proves it, in the SDK image when it is on this machine and
 * on the hosted verifier when it is not. setup.mjs plans
 * both with the same step kinds, so `--dry-run` shows both and one apply
 * writes both. A `prism` entry setup wrote before is replaced when the command
 * moved (a newer package, a checkout elsewhere); any other `prism` entry is
 * left alone.
 */
import { join } from 'node:path';
import { parseToml } from '../toml.mjs';
import { VERSION } from '../version.mjs';
import { invocation } from '../plugins.mjs';

export const JOURNEY_NAME = 'prism';

/** How an agent starts the server: npx at this version from the npx cache, else this Node and this package. */
export function journeyServer(context) {
  const bin = join(context.sourceDir, '..', 'bin', 'prism-code.mjs');
  // Read the npx cache off the source folder: on POSIX, join folds a Windows path into its `..`.
  if (/[\\/]_npx[\\/]/.test(context.sourceDir)) {
    const args = ['-y', `prism-code@${VERSION}`, 'mcp'];
    return context.platform === 'win32' ? { command: 'cmd', args: ['/c', 'npx', ...args] } : { command: 'npx', args };
  }
  return { command: context.node, args: [bin, 'mcp'] };
}

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (entry, server) => isObject(entry) && entry.command === server.command && JSON.stringify(entry.args ?? []) === JSON.stringify(server.args);
// An entry setup wrote: it runs prism-code's `mcp` verb, from this or another place.
const ours = (entry) => isObject(entry) && Array.isArray(entry.args) && entry.args.at(-1) === 'mcp' && entry.args.some((a) => /prism-code/.test(String(a)));

/** The text a file will have once the earlier rows' steps on it are applied. */
function pending(file, rows, context) {
  let text = context.readFile(file);
  for (const row of rows) for (const step of row.steps ?? []) if (step.path === file && step.kind === 'json') text = step.content;
  return text;
}

function planJson(agent, file, key, entry, server, rows, context) {
  const text = pending(file, rows, context);
  const touched = rows.some((row) => (row.steps ?? []).some((step) => step.path === file));
  let doc = {};
  if (text !== null && text.trim() !== '') {
    try {
      doc = JSON.parse(text);
    } catch {
      return { agent, status: 'unreadable', detail: `${file} is not plain JSON; add "${key}": {"${JOURNEY_NAME}": ${JSON.stringify(entry)}} by hand` };
    }
    if (!isObject(doc) || (doc[key] !== undefined && !isObject(doc[key]))) return { agent, status: 'unreadable', detail: `${file} has no "${key}" object` };
  }
  const existing = doc[key]?.[JOURNEY_NAME];
  if (existing !== undefined && same(existing, server)) return { agent, status: 'already', detail: file };
  if (existing !== undefined && !ours(existing)) return { agent, status: 'conflict', detail: `${file} has another ${JOURNEY_NAME} server; left as it is` };
  const indent = text?.match(/^([ \t]+)"/m)?.[1] ?? '  ';
  const next = { ...doc, [key]: { ...(doc[key] ?? {}), [JOURNEY_NAME]: entry } };
  return {
    agent,
    status: 'configure',
    detail: file,
    steps: [{ kind: 'json', path: file, key: `${key}.${JOURNEY_NAME}`, value: entry, content: `${JSON.stringify(next, null, indent)}\n`, backup: text !== null && !touched }],
  };
}

function planCodex(file, server, context) {
  const text = context.readFile(file);
  if (text !== null) {
    let servers;
    try {
      servers = parseToml(text).mcp_servers;
    } catch {
      if (text.includes(`mcp_servers.${JOURNEY_NAME}]`)) return { agent: 'codex', status: 'unreadable', detail: `${file} names [mcp_servers.${JOURNEY_NAME}] in TOML this reader does not parse; check it by hand` };
    }
    const existing = isObject(servers) ? servers[JOURNEY_NAME] : undefined;
    if (existing !== undefined) {
      if (same(existing, server)) return { agent: 'codex', status: 'already', detail: file };
      return { agent: 'codex', status: 'conflict', detail: `${file} has [mcp_servers.${JOURNEY_NAME}] with another command; left as it is` };
    }
  }
  // TOML basic strings take JSON's escapes, so a Windows path stays exact.
  const table = [`[mcp_servers.${JOURNEY_NAME}]`, `command = ${JSON.stringify(server.command)}`, `args = [${server.args.map((a) => JSON.stringify(a)).join(', ')}]`, 'startup_timeout_sec = 30', 'tool_timeout_sec = 900', ''].join('\n');
  return { agent: 'codex', status: 'configure', detail: file, steps: [{ kind: 'append', path: file, content: `\n${table}` }] };
}

/**
 * One row per agent found: whether its configuration gets the `prism` server.
 * `rows` are the `lexlean` rows planned for the same files, so a JSON file
 * both change is written once with both entries.
 */
export function planJourney(rows, context, paths) {
  const server = journeyServer(context);
  const found = new Set(rows.filter((r) => r.status !== 'not-found').map((r) => r.agent));
  const out = [];
  if (found.has('claude-code')) {
    const binary = context.find('claude');
    const fromFile = planJson('claude-code', paths['claude-code'].file, 'mcpServers', { type: 'stdio', command: server.command, args: server.args }, server, rows, context);
    if (binary && fromFile.status === 'configure') {
      // The CLI owns ~/.claude.json; with it on the PATH, it writes the entry.
      const args = ['mcp', 'add', '--scope', 'user', JOURNEY_NAME, '--', server.command, ...server.args];
      out.push({ ...fromFile, detail: `claude mcp add --scope user ${JOURNEY_NAME}`, steps: [{ kind: 'command', ...invocation(binary, args, context), display: `claude ${args.join(' ')}` }] });
    } else out.push(fromFile);
  }
  if (found.has('codex')) out.push(planCodex(paths.codex.file, server, context));
  if (found.has('cursor')) out.push(planJson('cursor', paths.cursor.file, 'mcpServers', { command: server.command, args: server.args }, server, rows, context));
  if (found.has('vscode')) out.push(planJson('vscode', paths.vscode.file, 'servers', { type: 'stdio', command: server.command, args: server.args }, server, rows, context));
  // Claude Desktop takes no remote server, but it does take a local one.
  if (found.has('claude-desktop')) out.push(planDesktop(planJson('claude-desktop', paths['claude-desktop'].file, 'mcpServers', { command: server.command, args: server.args }, server, rows, context), context));
  return out;
}

/**
 * Claude Desktop keeps its config file in memory and writes it back whole when
 * a preference changes or it quits, so an entry written while it runs is lost.
 * Found on Windows, 2026-11-16, in 0.9.4: the entry setup wrote was gone half an
 * hour later. While it runs nothing is written; when it cannot be told, the
 * entry is written and the row says what would undo it.
 */
function planDesktop(row, context) {
  if (row.status !== 'configure') return row;
  const running = context.claudeDesktopRunning ? context.claudeDesktopRunning() : false;
  if (running === true) {
    return { agent: row.agent, status: 'manual', detail: `Claude Desktop is running, and it rewrites ${row.detail} from memory, which would drop the ${JOURNEY_NAME} server; quit Claude Desktop (from the tray or menu bar too), then run npx prism-code@latest setup again` };
  }
  if (running === null) return { ...row, detail: `${row.detail}; could not tell whether Claude Desktop is running; if it is, quit it and run setup again, or it drops this entry` };
  return row;
}
