// prism-code open (experimental): the holo://build link, its refusals, and the exact commands per OS.
// Nothing here opens a window: the plans are checked, and the one real spawn is a stand-in agent in a temporary directory.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTALL_LINKS, MAX_SENTENCE, which } from '../src/agents.mjs';
import { LINUX_TERMINALS, TICKET_SCHEMA, checkSentence, parsePrismUrl, planOpen, planRun, readTicket, shQuote } from '../src/open.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const SENTENCE = 'Go to uor.foundation and build me a Prism app that tells whether a year is a leap year.';
const LINK = `holo://build?agent=claude-code&q=${encodeURIComponent(SENTENCE)}`;
// Everything a shell, cmd.exe, Windows Terminal or AppleScript would act on.
const HOSTILE = `it's 50% "done" & | ^ < > ; $(id) \`id\` %PATH% !x! \\ C:\\`;

const refused = (raw, code, options) => assert.throws(() => parsePrismUrl(raw, options), (e) => e.code === code, raw);

test('a holo://build link gives the agent and the sentence', () => {
  assert.deepEqual(parsePrismUrl(LINK), { agent: 'claude-code', sentence: SENTENCE });
  assert.deepEqual(parsePrismUrl(`holo://build/?agent=codex&q=${encodeURIComponent(HOSTILE)}`), { agent: 'codex', sentence: HOSTILE });
  assert.deepEqual(parsePrismUrl('holo://build?q=hi', { preferred: 'chatgpt' }), { agent: 'chatgpt', sentence: 'hi' });
  for (const agent of ['claude-code', 'codex', 'cursor', 'vscode', 'claude', 'chatgpt']) assert.equal(parsePrismUrl(`holo://build?agent=${agent}&q=x`).agent, agent);
});

test('a link to another host, scheme or path is refused', () => {
  refused('holo://evil?agent=codex&q=hi', 'open.host');
  refused('holo://run?agent=codex&q=hi', 'open.host');
  refused('https://build?agent=codex&q=hi', 'open.url');
  refused('holo://build/x?agent=codex&q=hi', 'open.url');
  refused('holo://user@build?agent=codex&q=hi', 'open.url');
  refused('holo://build:8080?agent=codex&q=hi', 'open.url');
  refused('holo://build?agent=codex&q=hi#x', 'open.url');
  refused('not a url', 'open.url');
});

test('an unknown agent, an unknown or repeated parameter, and no agent are refused', () => {
  refused('holo://build?agent=bash&q=hi', 'open.agent');
  refused('holo://build?agent=claude-desktop&q=hi', 'open.agent');
  refused('holo://build?q=hi', 'open.agent');
  refused('holo://build?agent=codex&q=hi&exec=1', 'open.parameter');
  refused('holo://build?agent=codex&agent=claude-code&q=hi', 'open.parameter');
  refused('holo://build?agent=codex&q=a&q=b', 'open.parameter');
});

test('a sentence is one plain line of at most 2000 characters that does not start with a dash', () => {
  assert.equal(checkSentence('é'.repeat(MAX_SENTENCE)), 'é'.repeat(MAX_SENTENCE));
  refused(`holo://build?agent=codex&q=${'a'.repeat(MAX_SENTENCE + 1)}`, 'open.sentence');
  refused('holo://build?agent=codex', 'open.sentence');
  refused('holo://build?agent=codex&q=%20%20', 'open.sentence');
  refused('holo://build?agent=codex&q=one%0Atwo', 'open.sentence');
  refused('holo://build?agent=codex&q=one%00two', 'open.sentence');
  refused('holo://build?agent=codex&q=one%E2%80%AEtwo', 'open.sentence');
  refused('holo://build?agent=codex&q=--dangerously-skip-permissions', 'open.sentence');
  refused('holo://build?agent=codex&q=%20-p%20x', 'open.sentence');
});

const finder = (files) => (name) => files[name] ?? null;
const context = (platform, files = {}, env = {}) => ({
  platform,
  env,
  find: finder(files),
  configDir: platform === 'win32' ? 'C:\\Users\\u\\.prism' : '/home/u/.prism',
  node: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node',
  handler: platform === 'win32' ? 'C:\\Users\\u\\.prism\\handler\\handler.mjs' : '/home/u/.prism/handler/handler.mjs',
  id: 'T',
});
const ticketOf = (c) => join(c.configDir, 'tickets', 'T.json');

test('a terminal agent: a ticket holds the sentence, and the terminal runs only the handler with its path', () => {
  const c = context('win32', { wt: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe' });
  const plan = planOpen({ agent: 'claude-code', sentence: HOSTILE }, c);
  assert.deepEqual(plan.steps[0], { kind: 'write', path: ticketOf(c), content: `${JSON.stringify({ schema: TICKET_SCHEMA, agent: 'claude-code', sentence: HOSTILE })}\n` });
  assert.deepEqual(plan.steps[1], { kind: 'spawn', command: 'C:\\Users\\u\\AppData\\Local\\Microsoft\\WindowsApps\\wt.exe', args: ['new-tab', '--title', 'Prism', c.node, c.handler, '--run', ticketOf(c)] });
  assert.match(plan.summary, /^opened a terminal for Claude Code: claude "it's 50% \\"done\\" /);
  for (const platform of ['win32', 'darwin', 'linux']) {
    const p = planOpen({ agent: 'codex', sentence: HOSTILE }, context(platform, { 'x-terminal-emulator': '/usr/bin/x-terminal-emulator' }));
    assert.ok(!JSON.stringify(p.steps[1]).includes('50%'), `${platform}: the sentence never reaches the terminal's command line`);
  }
});

test('Windows without Windows Terminal, or with a ";" in a path, opens a console with start', () => {
  const c = context('win32', {}, { ComSpec: 'C:\\Windows\\system32\\cmd.exe' });
  assert.deepEqual(planOpen({ agent: 'codex', sentence: 'hi' }, c).steps[1], {
    kind: 'spawn',
    command: 'C:\\Windows\\system32\\cmd.exe',
    args: ['/d', '/c', `start "Prism" "${c.node}" "${c.handler}" "--run" "${ticketOf(c)}"`],
    options: { windowsVerbatimArguments: true },
  });
  const semicolon = { ...context('win32', { wt: 'C:\\wt.exe' }), configDir: 'C:\\Users\\a;b\\.prism' };
  assert.equal(planOpen({ agent: 'codex', sentence: 'hi' }, semicolon).steps[1].args[0], '/d');
});

test('macOS runs the handler in Terminal.app through osascript, every path quoted for the shell', () => {
  const c = { ...context('darwin'), configDir: "/Users/o'k/.prism" };
  const step = planOpen({ agent: 'claude-code', sentence: 'hi' }, c).steps[1];
  // The ticket path is joined on the host running the tests; on a Mac it is /Users/o'k/.prism/tickets/T.json.
  const ticket = shQuote(ticketOf(c)).replace(/(["\\])/g, '\\$1');
  assert.equal(shQuote("/Users/o'k"), `'/Users/o'\\''k'`);
  assert.deepEqual(step, {
    kind: 'spawn',
    command: 'osascript',
    args: ['-e', `tell application "Terminal" to do script "'/usr/bin/node' '/home/u/.prism/handler/handler.mjs' '--run' ${ticket}"`, '-e', 'tell application "Terminal" to activate'],
  });
});

test('Linux uses $TERMINAL, then the first terminal found, each with its own way to run a command', () => {
  const argv = (c) => [c.node, c.handler, '--run', ticketOf(c)];
  let c = context('linux', { kitty: '/usr/bin/kitty', xterm: '/usr/bin/xterm' }, { TERMINAL: 'kitty' });
  assert.deepEqual(planOpen({ agent: 'codex', sentence: 'hi' }, c).steps[1], { kind: 'spawn', command: '/usr/bin/kitty', args: argv(c) });
  c = context('linux', { 'my-term': '/opt/my-term' }, { TERMINAL: 'my-term' });
  assert.deepEqual(planOpen({ agent: 'codex', sentence: 'hi' }, c).steps[1].args, ['-e', ...argv(c)]);
  c = context('linux', { 'gnome-terminal': '/usr/bin/gnome-terminal', xterm: '/usr/bin/xterm' });
  assert.deepEqual(planOpen({ agent: 'codex', sentence: 'hi' }, c).steps[1], { kind: 'spawn', command: '/usr/bin/gnome-terminal', args: ['--', ...argv(c)] });
  assert.equal(LINUX_TERMINALS[0][0], 'x-terminal-emulator');
  assert.throws(() => planOpen({ agent: 'codex', sentence: 'hi' }, context('linux')), (e) => e.code === 'open.terminal');
});

test('Cursor and VS Code: the sentence on the clipboard through stdin, then their own install link', () => {
  const win = planOpen({ agent: 'cursor', sentence: HOSTILE }, context('win32'));
  assert.equal(win.steps[0].kind, 'clipboard');
  assert.equal(win.steps[0].command, 'powershell.exe');
  assert.equal(win.steps[0].input, HOSTILE);
  assert.ok(!win.steps[0].args.join(' ').includes('50%'));
  assert.deepEqual(win.steps[1], { kind: 'spawn', command: 'rundll32.exe', args: ['url.dll,FileProtocolHandler', INSTALL_LINKS.cursor] });
  assert.equal(INSTALL_LINKS.cursor, 'cursor://anysphere.cursor-deeplink/mcp/install?name=lexlean&config=eyJ1cmwiOiJodHRwczovL21jcC51b3IuZm91bmRhdGlvbi8ifQ==');
  assert.equal(INSTALL_LINKS.vscode, 'vscode:mcp/install?%7B%22name%22%3A%22lexlean%22%2C%22type%22%3A%22http%22%2C%22url%22%3A%22https%3A%2F%2Fmcp.uor.foundation%2F%22%7D');
  const mac = planOpen({ agent: 'vscode', sentence: 'hi' }, context('darwin'));
  assert.deepEqual(mac.steps, [
    { kind: 'clipboard', command: 'pbcopy', args: [], env: { LANG: 'en_US.UTF-8' }, input: 'hi' },
    { kind: 'spawn', command: 'open', args: [INSTALL_LINKS.vscode] },
  ]);
  assert.match(mac.summary, /paste it into Copilot agent mode/);
  assert.deepEqual(planOpen({ agent: 'vscode', sentence: 'hi' }, context('linux', { 'wl-copy': '/usr/bin/wl-copy', xclip: '/usr/bin/xclip' }, { WAYLAND_DISPLAY: 'wayland-0' })).steps[0].command, 'wl-copy');
  assert.deepEqual(planOpen({ agent: 'vscode', sentence: 'hi' }, context('linux', { xclip: '/usr/bin/xclip' })).steps[0].args, ['-selection', 'clipboard']);
  const bare = planOpen({ agent: 'cursor', sentence: 'hi there' }, context('linux'));
  assert.deepEqual(bare.steps, [{ kind: 'spawn', command: 'xdg-open', args: [INSTALL_LINKS.cursor] }]);
  assert.match(bare.summary, /no clipboard command found; paste this into the agent panel:\n {2}hi there/);
});

test('Claude and ChatGPT open their prompt URL', () => {
  assert.deepEqual(planOpen({ agent: 'claude', sentence: 'a b&c' }, context('darwin')).steps, [{ kind: 'spawn', command: 'open', args: ['https://claude.ai/new?q=a%20b%26c'] }]);
  assert.deepEqual(planOpen({ agent: 'chatgpt', sentence: 'a b&c' }, context('linux')).steps, [{ kind: 'spawn', command: 'xdg-open', args: ['https://chatgpt.com/?prompt=a%20b%26c'] }]);
});

test('the runner starts the agent with the sentence as its one argument, escaped for cmd.exe when the agent is an npm shim', () => {
  const ticket = { schema: TICKET_SCHEMA, agent: 'claude-code', sentence: SENTENCE };
  assert.deepEqual(planRun(ticket, { platform: 'linux', env: {}, find: finder({ claude: '/home/u/.local/bin/claude' }) }), {
    found: true,
    command: '/home/u/.local/bin/claude',
    args: [SENTENCE],
    options: {},
    display: `claude "${SENTENCE}"`,
  });
  const exe = planRun(ticket, { platform: 'win32', env: {}, find: finder({ claude: 'C:\\Users\\u\\.local\\bin\\claude.exe' }) });
  assert.deepEqual([exe.command, exe.args], ['C:\\Users\\u\\.local\\bin\\claude.exe', [SENTENCE]]);
  const shim = planRun({ ...ticket, sentence: 'a & b' }, { platform: 'win32', env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' }, find: finder({ claude: 'C:\\npm\\claude.cmd' }) });
  assert.deepEqual([shim.command, shim.args, shim.options], ['C:\\Windows\\system32\\cmd.exe', ['/d', '/s', '/c', '"C:\\npm\\claude.cmd ^^^"a^^^ ^^^&^^^ b^^^""'], { windowsVerbatimArguments: true }]);
  const missing = planRun({ ...ticket, agent: 'codex' }, { platform: 'linux', env: {}, find: finder({}) });
  assert.equal(missing.found, false);
  assert.match(missing.message, /Codex \(codex\) is not on the PATH/);
  assert.match(missing.message, new RegExp(`codex "${SENTENCE.replace(/\./g, '\\.')}"`));
  for (const bad of [{}, { ...ticket, schema: 'x' }, { ...ticket, agent: 'cursor' }, { ...ticket, sentence: '-x' }]) {
    assert.throws(() => planRun(bad, { platform: 'linux', env: {}, find: finder({}) }), (e) => e.code === 'open.ticket' || e.code === 'open.sentence');
  }
});

test('a ticket is read once', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-ticket-'));
  const path = join(dir, 'T.json');
  writeFileSync(path, JSON.stringify({ schema: TICKET_SCHEMA, agent: 'codex', sentence: 'hi' }));
  assert.equal(readTicket(path).sentence, 'hi');
  assert.equal(existsSync(path), false);
  assert.throws(() => readTicket(path), (e) => e.code === 'open.ticket');
});

test('a stand-in agent on the PATH receives a hostile sentence as exactly one argument', () => {
  // On Windows the stand-in is an npm-style .cmd shim, which cmd.exe parses twice; elsewhere a shell script.
  const dir = mkdtempSync(join(tmpdir(), 'prism-agent-'));
  const out = join(dir, 'argv.json');
  writeFileSync(join(dir, 'echo.mjs'), `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(out)}, JSON.stringify(process.argv.slice(2)));\n`);
  if (process.platform === 'win32') {
    writeFileSync(join(dir, 'claude.cmd'), `@"${process.execPath}" "%~dp0echo.mjs" %*\r\n`);
  } else {
    // PATH holds only this directory, so the script names everything by its full path.
    writeFileSync(join(dir, 'claude'), `#!/bin/sh\nexec "${process.execPath}" "${join(dir, 'echo.mjs')}" "$@"\n`);
    chmodSync(join(dir, 'claude'), 0o755);
  }
  const env = { ...process.env, PATH: dir, Path: dir };
  const plan = planRun({ schema: TICKET_SCHEMA, agent: 'claude-code', sentence: HOSTILE }, { platform: process.platform, env, find: (name) => which(name, { env }) });
  assert.equal(plan.found, true);
  const result = spawnSync(plan.command, plan.args, { ...plan.options, env, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), [HOSTILE]);
});

function cli(args) {
  const home = mkdtempSync(join(tmpdir(), 'prism-open-home-'));
  const env = { ...process.env, PRISM_HOME: join(home, '.prism') };
  if (process.platform === 'linux') {
    // A CI runner has no terminal installed; a stand-in on the PATH is enough for --dry-run to plan one.
    const terminal = join(home, 'bin');
    mkdirSync(terminal);
    writeFileSync(join(terminal, 'x-terminal-emulator'), '#!/bin/sh\nexit 0\n');
    chmodSync(join(terminal, 'x-terminal-emulator'), 0o755);
    env.PATH = `${terminal}:${env.PATH ?? ''}`;
    delete env.TERMINAL;
  }
  const result = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env });
  return { code: result.status, out: result.stdout, err: result.stderr, home };
}

test('prism-code open prints its plan with --dry-run, refuses a bad link with exit 2, and takes one link', () => {
  const dry = cli(['open', LINK, '--dry-run']);
  assert.equal(dry.code, 0, dry.err);
  assert.match(dry.out, /^write .*tickets[\\/][0-9a-f-]{36}\.json\n {2}\{"schema":"prism\/open-ticket\/1","agent":"claude-code","sentence":"Go to uor/);
  // macOS quotes each word for the shell inside the AppleScript, so --run may stand in quotes.
  assert.match(dry.out, /\nrun .*--run/);
  assert.equal(existsSync(join(dry.home, '.prism', 'tickets')), false, '--dry-run writes nothing');
  const bad = cli(['open', 'holo://evil?q=x', '--dry-run']);
  assert.equal(bad.code, 2);
  assert.match(bad.err, /^open\.host: /);
  assert.equal(cli(['open']).code, 64);
  assert.equal(cli(['open', LINK, '--force']).code, 64);
});
