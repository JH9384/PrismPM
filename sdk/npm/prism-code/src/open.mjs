/**
 * `prism-code open holo://build?agent=<id>&q=<sentence>` (experimental): hand
 * one sentence to the agent the link names.
 *
 * A terminal agent (Claude Code, Codex) gets a new terminal that runs it with
 * the sentence as one argument. No shell, no Windows Terminal command line and
 * no AppleScript ever sees the sentence: it goes into a ticket file, and the
 * terminal runs `node handler.mjs --run <ticket>`, which holds only paths this
 * package chose. The runner shows the sentence and starts the agent after
 * Enter, because any web page can write a holo:// link. Cursor and VS Code get
 * their own MCP install link and the sentence on the clipboard. Claude and
 * ChatGPT get their prompt URL.
 *
 * Every function here plans: it returns the files to write and the commands to
 * run, and `execute` carries them out. The tests check the plans for each OS
 * without running anything.
 */
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fail } from './errors.mjs';
import { AGENTS, INSTALL_LINKS, MAX_SENTENCE, OPEN_AGENTS, prismHome, promptUrl, readPreferredAgent, which } from './agents.mjs';
import { invocation } from './plugins.mjs';

export const TICKET_SCHEMA = 'prism/open-ticket/1';
const PARAMETERS = ['agent', 'q'];
// C0 and C1 controls, and the bidirectional overrides that could make the shown sentence differ from the one run.
const FORBIDDEN = /[\u0000-\u001f\u007f-\u009f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/** Refuse a sentence that is not one plain line of at most MAX_SENTENCE characters, or that an agent would read as a flag. */
export function checkSentence(sentence) {
  if (typeof sentence !== 'string' || sentence.trim() === '') fail('open.sentence', 'the link carries no sentence: give it as q=<urlencoded sentence>');
  const length = [...sentence].length;
  if (length > MAX_SENTENCE) fail('open.sentence', `the sentence is ${length} characters; a holo:// link carries at most ${MAX_SENTENCE}`);
  if (FORBIDDEN.test(sentence)) fail('open.sentence', 'the sentence holds a control or bidirectional character; a holo:// link carries one plain line');
  if (/^\s*-/.test(sentence)) fail('open.sentence', 'the sentence starts with "-", which an agent would read as a flag');
  return sentence;
}

/**
 * The agent and sentence of a holo://build link. `preferred` stands in when the link names no agent.
 * @returns {{ agent: string, sentence: string }}
 */
export function parsePrismUrl(raw, { preferred = null } = {}) {
  let url;
  try {
    url = new URL(String(raw));
  } catch {
    fail('open.url', `${JSON.stringify(String(raw))} is not a URL; prism-code open takes holo://build?agent=<id>&q=<sentence>`);
  }
  if (url.protocol !== 'holo:') fail('open.url', `${url.protocol}// is not holo://; prism-code open takes holo://build?agent=<id>&q=<sentence>`);
  if (url.username || url.password || url.port || url.hash) fail('open.url', 'a holo:// link carries no user, password, port or fragment');
  if (url.hostname !== 'build') fail('open.host', `holo://${url.hostname} is not a link prism-code opens; only holo://build is`);
  if (url.pathname !== '' && url.pathname !== '/') fail('open.url', `holo://build${url.pathname} has a path; the link is holo://build?agent=<id>&q=<sentence>`);
  const values = new Map();
  for (const [name, value] of url.searchParams) {
    if (!PARAMETERS.includes(name)) fail('open.parameter', `holo://build takes agent and q, not ${name}`);
    if (values.has(name)) fail('open.parameter', `${name} is given twice`);
    values.set(name, value);
  }
  const agent = values.get('agent') ?? preferred;
  if (!agent) fail('open.agent', 'the link names no agent and no preferred agent is set; add agent=<id>, or run npx prism-code@latest setup --agent <id>');
  if (!OPEN_AGENTS.includes(agent)) fail('open.agent', `${agent} is not an agent prism-code opens; one of ${OPEN_AGENTS.join(', ')}`);
  return { agent, sentence: checkSentence(values.get('q')) };
}

/** One word for a POSIX shell. */
export const shQuote = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`;
const appleScriptString = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;

/** How the command reads when a person types it, as the website's copy card shows it. */
export const displayCommand = (binary, sentence) => `${binary} "${sentence.replace(/(["\\$`])/g, '\\$1')}"`;

/** The command that opens a URL with the handler the OS has for its scheme. No shell parses it. */
export function openUrlCommand(url, platform) {
  if (platform === 'win32') return { command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', url] };
  if (platform === 'darwin') return { command: 'open', args: [url] };
  return { command: 'xdg-open', args: [url] };
}

/** The command that puts its stdin on the clipboard, or null when this machine has none. */
export function clipboardCommand({ platform, env, find }) {
  if (platform === 'win32') {
    return { command: 'powershell.exe', args: ['-NoProfile', '-NonInteractive', '-Command', '[Console]::InputEncoding = [Text.Encoding]::UTF8; Set-Clipboard -Value ([Console]::In.ReadToEnd())'] };
  }
  if (platform === 'darwin') return { command: 'pbcopy', args: [], env: { LANG: 'en_US.UTF-8' } };
  if (env.WAYLAND_DISPLAY && find('wl-copy')) return { command: 'wl-copy', args: [] };
  if (find('xclip')) return { command: 'xclip', args: ['-selection', 'clipboard'] };
  if (find('xsel')) return { command: 'xsel', args: ['--clipboard', '--input'] };
  return null;
}

/** Linux terminals in the order tried after $TERMINAL, each with the arguments that run a command in it. */
export const LINUX_TERMINALS = Object.freeze([
  ['x-terminal-emulator', ['-e']],
  ['gnome-terminal', ['--']],
  ['konsole', ['-e']],
  ['xfce4-terminal', ['-x']],
  ['kitty', []],
  ['alacritty', ['-e']],
  ['wezterm', ['start', '--']],
  ['foot', []],
  ['xterm', ['-e']],
]);

/**
 * The command that opens a new terminal window running `argv`. `argv` holds only paths this package chose,
 * never the sentence.
 */
export function terminalCommand(argv, { platform, env, find }) {
  if (platform === 'win32') {
    // Windows Terminal splits its command line at ";", so a path holding one goes through cmd.exe's start instead.
    const wt = find('wt');
    if (wt && !argv.some((a) => a.includes(';'))) return { command: wt, args: ['new-tab', '--title', 'Prism', ...argv] };
    return { command: env.ComSpec || env.COMSPEC || 'cmd.exe', args: ['/d', '/c', `start "Prism" ${argv.map((a) => `"${a}"`).join(' ')}`], options: { windowsVerbatimArguments: true } };
  }
  if (platform === 'darwin') {
    return { command: 'osascript', args: ['-e', `tell application "Terminal" to do script ${appleScriptString(argv.map(shQuote).join(' '))}`, '-e', 'tell application "Terminal" to activate'] };
  }
  const named = env.TERMINAL ? find(env.TERMINAL) : null;
  if (named) {
    const known = LINUX_TERMINALS.find(([name]) => env.TERMINAL === name || env.TERMINAL.endsWith(`/${name}`));
    return { command: named, args: [...(known ? known[1] : ['-e']), ...argv] };
  }
  for (const [name, prefix] of LINUX_TERMINALS) {
    const file = find(name);
    if (file) return { command: file, args: [...prefix, ...argv] };
  }
  fail('open.terminal', `no terminal found: set TERMINAL, or install one of ${LINUX_TERMINALS.map(([name]) => name).join(', ')}`);
}

/**
 * What `open` does for one agent and sentence: the files to write and the commands to run.
 * @param {{ agent: string, sentence: string }} link
 * @param {{ platform: string, env: object, find: (name: string) => string | null, configDir: string, node: string, handler: string, id: string }} context
 */
export function planOpen({ agent, sentence }, context) {
  const { platform, configDir, node, handler, id } = context;
  const { label, kind, binary, paste } = AGENTS[agent];
  if (kind === 'terminal') {
    const ticket = join(configDir, 'tickets', `${id}.json`);
    return {
      agent,
      steps: [
        { kind: 'write', path: ticket, content: `${JSON.stringify({ schema: TICKET_SCHEMA, agent, sentence })}\n` },
        { kind: 'spawn', ...terminalCommand([node, handler, '--run', ticket], context) },
      ],
      summary: `opened a terminal for ${label}: ${displayCommand(binary, sentence)} (it starts after Enter)`,
    };
  }
  if (kind === 'editor') {
    const clipboard = clipboardCommand(context);
    const steps = [];
    if (clipboard) steps.push({ kind: 'clipboard', ...clipboard, input: sentence });
    steps.push({ kind: 'spawn', ...openUrlCommand(INSTALL_LINKS[agent], platform) });
    const where = clipboard ? `the sentence is on the clipboard: paste it into ${paste}` : `no clipboard command found; paste this into ${paste}:\n  ${sentence}`;
    return { agent, steps, summary: `opened ${label}'s MCP install link; ${where}` };
  }
  return { agent, steps: [{ kind: 'spawn', ...openUrlCommand(promptUrl(agent, sentence), platform) }], summary: `opened ${label} with the sentence` };
}

/** The context `planOpen` and `planRun` read on this machine. */
export function hostContext({ handler, env = process.env, platform = process.platform } = {}) {
  return {
    platform,
    env,
    find: (name) => which(name, { env, platform }),
    configDir: prismHome(env),
    node: process.execPath,
    handler,
    id: randomUUID(),
  };
}

/** Read a ticket and remove it, so it runs once. */
export function readTicket(path) {
  let text;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    fail('open.ticket', `the ticket ${path} cannot be read: ${cause.code ?? cause.message}`);
  }
  try {
    unlinkSync(path);
  } catch {
    // A ticket that cannot be removed still runs; it holds nothing the link did not already say.
  }
  let ticket;
  try {
    ticket = JSON.parse(text);
  } catch {
    fail('open.ticket', `the ticket ${path} is not JSON`);
  }
  return ticket;
}

/**
 * The command the runner starts for a ticket: the agent's binary with the sentence as its one argument.
 * @returns {{ found: true, command: string, args: string[], options: object, display: string } | { found: false, message: string }}
 */
export function planRun(ticket, { platform, env, find }) {
  if (ticket?.schema !== TICKET_SCHEMA) fail('open.ticket', `the ticket is not ${TICKET_SCHEMA}`);
  if (!OPEN_AGENTS.includes(ticket.agent) || AGENTS[ticket.agent].kind !== 'terminal') fail('open.ticket', `the ticket names ${ticket.agent}, which is not a terminal agent`);
  const sentence = checkSentence(ticket.sentence);
  const { label, binary, install } = AGENTS[ticket.agent];
  const display = displayCommand(binary, sentence);
  const file = find(binary);
  if (!file) return { found: false, message: `${label} (${binary}) is not on the PATH. Install it from ${install}, then run:\n\n  ${display}\n` };
  const { command, args, options } = invocation(file, [sentence], { env, platform });
  return { found: true, command, args, options, display };
}

/** Carry out a plan. A spawn is detached and not waited for; a clipboard command gets the sentence on stdin. */
export async function execute(steps) {
  for (const step of steps) {
    if (step.kind === 'write') {
      mkdirSync(dirname(step.path), { recursive: true });
      writeFileSync(step.path, step.content, { mode: 0o600 });
    } else if (step.kind === 'clipboard') {
      const result = spawnSync(step.command, step.args, { input: step.input, env: { ...process.env, ...step.env }, windowsHide: true, stdio: ['pipe', 'ignore', 'ignore'] });
      if (result.error || result.status !== 0) fail('open.clipboard', `${step.command} could not set the clipboard: ${result.error?.code ?? `exit ${result.status}`}`);
    } else if (step.kind === 'spawn') {
      await new Promise((done, reject) => {
        const child = spawn(step.command, step.args, { ...step.options, detached: true, stdio: 'ignore' });
        child.once('error', (error) => reject(new Error(`${step.command}: ${error.code ?? error.message}`)));
        child.once('spawn', () => {
          child.unref();
          done();
        });
      });
    }
  }
}

/** Open a holo:// link: parse it against the remembered preference, plan, and carry the plan out. */
export async function openLink(raw, context, { dryRun = false } = {}) {
  const link = parsePrismUrl(raw, { preferred: readPreferredAgent(context.configDir) });
  const plan = planOpen(link, context);
  if (!dryRun) await execute(plan.steps);
  return plan;
}

/** A command as a person reads it: an argument with a space or a quote in double quotes, its quotes as \". */
export const commandLine = (command, args) => [command, ...args].map((a) => (/[\s"]/.test(a) || a === '' ? `"${a.replace(/"/g, '\\"')}"` : a)).join(' ');

/** Format a plan's steps for --dry-run, one line per step. */
export function formatSteps(steps) {
  return steps
    .map((step) => {
      if (step.kind === 'write') return `write ${step.path}\n  ${step.content.trimEnd()}`;
      const line = commandLine(step.command, step.args);
      return step.kind === 'clipboard' ? `clipboard ${line} < ${JSON.stringify(step.input)}` : `run ${line}`;
    })
    .join('\n');
}
