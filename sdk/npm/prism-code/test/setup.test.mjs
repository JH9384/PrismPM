// prism-code setup (experimental): detection and writing on fixture home directories for each OS, the
// handler registration commands, the preferred agent and the printed lines. No test reads or writes the
// real home directory, the registry or LaunchServices: every command goes to a recording stand-in.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MCP_URL } from '../src/agents.mjs';
import { parseToml } from '../src/toml.mjs';
import { FIRST_SENTENCE, HANDLER_FILES, LSREGISTER, OPEN_COMMAND_KEY, REGISTRY_KEY, RETIRED_SKILLS, SKILL_FILE, agentPaths, applySetup, bundledSkills, formatNext, formatSetup, nextSteps, planSetup } from '../src/setup.mjs';
import { createHash } from 'node:crypto';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const sourceDir = fileURLToPath(new URL('../src/', import.meta.url));

/** A fixture home: `files` maps paths relative to it to contents, or to null for an empty directory. */
function fixtureHome(files = {}) {
  const home = mkdtempSync(join(tmpdir(), 'prism-setup-'));
  for (const [path, content] of Object.entries(files)) {
    const full = join(home, path);
    if (content === null) mkdirSync(full, { recursive: true });
    else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, content);
    }
  }
  return home;
}

const readText = (path) => {
  try {
    return readFileSync(path, 'utf8');
  } catch {
    return null;
  }
};

function context(platform, home, { found = {}, env = {}, registry = {}, mime = {} } = {}) {
  return {
    platform,
    home,
    env: platform === 'win32' ? { APPDATA: join(home, 'AppData', 'Roaming'), ...env } : env,
    find: (name) => found[name] ?? null,
    exists: existsSync,
    readFile: readText,
    registryValue: (key) => registry[key] ?? null,
    mimeDefault: (type) => mime[type] ?? null,
    configDir: join(home, '.prism'),
    node: platform === 'win32' ? 'C:\\Program Files\\nodejs\\node.exe' : '/usr/bin/node',
    sourceDir,
  };
}

const recorder = () => {
  const calls = [];
  const run = (command, args) => {
    calls.push([command, ...args]);
    return { status: 0, stdout: '', stderr: '' };
  };
  return { calls, run };
};
const byAgent = (plan) => Object.fromEntries(plan.agents.map((a) => [a.agent, a]));
const json = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('Linux: each agent found is configured once, in its own file and format, and a second run changes nothing', () => {
  const home = fixtureHome({
    '.claude.json': JSON.stringify({ numStartups: 3, projects: { '/w': { mcpServers: {} } } }),
    '.codex/config.toml': 'model = "o3"\n[mcp_servers.other]\ncommand = "npx"\n',
    '.cursor/mcp.json': JSON.stringify({ mcpServers: { lexlean: { url: 'https://mcp.uor.foundation' } } }),
    '.config/Code/User': null,
    '.config/Claude': null,
  });
  const c = context('linux', home, { found: { 'xdg-mime': '/usr/bin/xdg-mime' } });
  const plan = planSetup({ hosted: true }, c);
  const rows = byAgent(plan);
  assert.deepEqual(Object.fromEntries(plan.agents.map((a) => [a.agent, a.status])), { 'claude-code': 'configure', codex: 'configure', cursor: 'already', vscode: 'configure', 'claude-desktop': 'manual' });
  assert.match(rows['claude-desktop'].detail, /Settings > Connectors > Add custom connector/);
  const { calls, run } = recorder();
  applySetup(plan, { run });

  const claude = json(join(home, '.claude.json'));
  assert.deepEqual(Object.keys(claude.mcpServers), ['lexlean', 'prism']);
  assert.deepEqual(claude.mcpServers.lexlean, { type: 'http', url: MCP_URL });
  assert.equal(claude.numStartups, 3, 'the rest of the file stays');
  assert.equal(readFileSync(join(home, '.claude.json.prism-backup'), 'utf8'), JSON.stringify({ numStartups: 3, projects: { '/w': { mcpServers: {} } } }), 'one backup, of the file as it was');
  const codex = readFileSync(join(home, '.codex', 'config.toml'), 'utf8');
  assert.ok(codex.startsWith('model = "o3"\n[mcp_servers.other]\ncommand = "npx"\n\n[mcp_servers.lexlean]\nurl = "https://mcp.uor.foundation/"\n\n[mcp_servers.prism]\n'), codex);
  assert.deepEqual(parseToml(codex).mcp_servers.lexlean, { url: MCP_URL });
  // Beside the remote lexlean server, the local Prism server: this Node running this package's `mcp` verb.
  const prism = { command: '/usr/bin/node', args: [join(sourceDir, '..', 'bin', 'prism-code.mjs'), 'mcp'] };
  assert.deepEqual(json(join(home, '.claude.json')).mcpServers.prism, { type: 'stdio', ...prism });
  assert.deepEqual(parseToml(codex).mcp_servers.prism, { command: prism.command, args: prism.args, startup_timeout_sec: 30, tool_timeout_sec: 900 });
  assert.deepEqual(json(join(home, '.cursor', 'mcp.json')).mcpServers.prism, prism);
  assert.deepEqual(json(join(home, '.config', 'Code', 'User', 'mcp.json')), { servers: { lexlean: { type: 'http', url: MCP_URL }, prism: { type: 'stdio', ...prism } } });
  assert.deepEqual(json(join(home, '.config', 'Claude', 'claude_desktop_config.json')), { mcpServers: { prism } }, 'Claude Desktop takes no url server in its file, but it takes a local one');

  const desktop = join(home, '.local', 'share', 'applications', 'prism-open.desktop');
  const entry = join(home, '.prism', 'handler', 'handler.mjs');
  assert.equal(readFileSync(desktop, 'utf8'), ['[Desktop Entry]', 'Type=Application', 'Name=Prism', 'Comment=Opens holo://build links in your agent', `Exec="/usr/bin/node" "${entry.replace(/\\/g, '\\\\\\\\')}" %u`, 'Terminal=false', 'NoDisplay=true', 'MimeType=x-scheme-handler/holo;', ''].join('\n'));
  for (const name of HANDLER_FILES) assert.equal(readFileSync(join(home, '.prism', 'handler', name), 'utf8'), readFileSync(join(sourceDir, name), 'utf8'), name);
  assert.deepEqual(calls, [['/usr/bin/xdg-mime', 'default', 'prism-open.desktop', 'x-scheme-handler/holo']]);
  assert.deepEqual(json(join(home, '.prism', 'config.json')), { preferredAgent: 'claude-code' });

  // The copy runs on its own, outside the package: a refused link exits 2 and is logged, with no terminal to show it.
  const refused = spawnSync(process.execPath, [entry, 'holo://evil?agent=codex&q=hi'], { encoding: 'utf8', env: { ...process.env, PRISM_HOME: join(home, '.prism') }, stdio: ['ignore', 'pipe', 'pipe'] });
  assert.equal(refused.status, 2, refused.stderr);
  assert.match(readFileSync(join(home, '.prism', 'handler.log'), 'utf8'), /^\S+ open\.host: holo:\/\/evil is not a link prism-code opens/);

  const again = planSetup({ hosted: true }, c);
  assert.deepEqual(again.agents.map((a) => a.status), ['already', 'already', 'already', 'already', 'manual']);
  assert.deepEqual(again.journey.map((a) => [a.agent, a.status]), [['claude-code', 'already'], ['codex', 'already'], ['cursor', 'already'], ['vscode', 'already'], ['claude-desktop', 'already']]);
  assert.equal(again.handler.status, 'already');
  assert.deepEqual(again.preferred.steps, []);
});

test('Claude Code on the PATH is configured by its own CLI at user scope', () => {
  const home = fixtureHome({ '.claude.json': '{}' });
  const plan = planSetup({ hosted: true, agent: 'claude-code' }, context('linux', home, { found: { claude: '/usr/local/bin/claude' } }));
  assert.deepEqual(plan.agents[0].steps, [{ kind: 'command', command: '/usr/local/bin/claude', args: ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'lexlean', MCP_URL], options: {}, display: `claude mcp add --transport http --scope user lexlean ${MCP_URL}` }]);
  const shim = planSetup({ hosted: true, agent: 'claude-code' }, context('win32', home, { found: { claude: 'C:\\npm\\claude.cmd' }, env: { ComSpec: 'C:\\Windows\\system32\\cmd.exe' } }));
  assert.equal(shim.agents[0].steps[0].command, 'C:\\Windows\\system32\\cmd.exe');
  assert.match(shim.agents[0].steps[0].args[3], /claude\.cmd \^\^\^"mcp\^\^\^" .*\^\^\^"--scope\^\^\^" \^\^\^"user\^\^\^"/);
});

test('nothing installed: every agent is not found, and no preferred agent is set', () => {
  const plan = planSetup({ hosted: true }, context('linux', fixtureHome()));
  assert.deepEqual(plan.agents.map((a) => a.status), ['not-found', 'not-found', 'not-found', 'not-found', 'not-found']);
  assert.equal(plan.preferred.agent, null);
  assert.match(formatSetup(plan), / {2}preferred agent none: pass --agent <id>\n$/);
});

test('a lexlean server at another URL is reported and left alone', () => {
  const home = fixtureHome({
    '.cursor/mcp.json': JSON.stringify({ mcpServers: { lexlean: { url: 'http://localhost:9000/' } } }),
    '.codex/config.toml': '[mcp_servers.lexlean]\ncommand = "lexlean-mcp"\n',
  });
  const rows = byAgent(planSetup({ hosted: true }, context('linux', home)));
  assert.equal(rows.cursor.status, 'conflict');
  assert.match(rows.cursor.detail, /lexlean server at http:\/\/localhost:9000\/; left as it is/);
  assert.equal(rows.cursor.steps, undefined);
  assert.equal(rows.codex.status, 'conflict');
});

test('a file this reader cannot parse is never rewritten', () => {
  const home = fixtureHome({
    '.config/Code/User/mcp.json': '{\n  // my servers\n  "servers": {}\n}\n',
    '.cursor/mcp.json': '[]',
    // A float is valid TOML that the manifest reader refuses.
    '.codex/config.toml': 'temperature = 0.2\n[mcp_servers.lexlean]\nurl = "x"\n',
  });
  const rows = byAgent(planSetup({ hosted: true }, context('linux', home)));
  assert.equal(rows.vscode.status, 'unreadable');
  assert.match(rows.vscode.detail, /not plain JSON.*add "servers": \{"lexlean": \{"type":"http","url":"https:\/\/mcp\.uor\.foundation\/"\}\} by hand/);
  assert.equal(rows.cursor.status, 'unreadable');
  assert.equal(rows.codex.status, 'unreadable');
  // TOML this reader does not parse, with no lexlean in it, still gets the table appended.
  const other = fixtureHome({ '.codex/config.toml': 'temperature = 0.2\n' });
  assert.equal(byAgent(planSetup({ hosted: true }, context('linux', other))).codex.status, 'configure');
});

test('the indentation of a JSON file is kept', () => {
  const home = fixtureHome({ '.cursor/mcp.json': '{\n\t"mcpServers": {\n\t\t"a": {"url": "https://a/"}\n\t}\n}\n' });
  const plan = planSetup({ hosted: true, agent: 'cursor' }, context('linux', home));
  applySetup(plan, recorder());
  const bin = JSON.stringify(join(sourceDir, '..', 'bin', 'prism-code.mjs'));
  assert.equal(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'), `{\n\t"mcpServers": {\n\t\t"a": {\n\t\t\t"url": "https://a/"\n\t\t},\n\t\t"lexlean": {\n\t\t\t"url": "https://mcp.uor.foundation/"\n\t\t},\n\t\t"prism": {\n\t\t\t"command": "/usr/bin/node",\n\t\t\t"args": [\n\t\t\t\t${bin},\n\t\t\t\t"mcp"\n\t\t\t]\n\t\t}\n\t}\n}\n`);
});

test('Windows: config under %APPDATA%, and the handler registered under HKCU with reg.exe', () => {
  const home = fixtureHome({ 'AppData/Roaming/Code/User': null, 'AppData/Roaming/Claude/claude_desktop_config.json': '{}', '.cursor': null });
  const c = context('win32', home);
  const paths = agentPaths(c);
  assert.equal(paths.vscode.file, join(home, 'AppData', 'Roaming', 'Code', 'User', 'mcp.json'));
  assert.equal(paths['claude-desktop'].file, join(home, 'AppData', 'Roaming', 'Claude', 'claude_desktop_config.json'));
  const plan = planSetup({ hosted: true }, c);
  assert.deepEqual(plan.agents.map((a) => a.status), ['not-found', 'not-found', 'configure', 'configure', 'manual']);
  const entry = join(home, '.prism', 'handler', 'handler.mjs');
  const command = `"C:\\Program Files\\nodejs\\node.exe" "${entry}" "%1"`;
  assert.deepEqual(plan.handler.steps.filter((s) => s.kind === 'command').map((s) => [s.command, ...s.args]), [
    ['reg.exe', 'add', REGISTRY_KEY, '/ve', '/d', 'URL:Prism build link', '/f'],
    ['reg.exe', 'add', REGISTRY_KEY, '/v', 'URL Protocol', '/d', '', '/f'],
    ['reg.exe', 'add', `${REGISTRY_KEY}\\shell\\open\\command`, '/ve', '/d', command, '/f'],
  ]);
  const { calls, run } = recorder();
  applySetup(plan, { run });
  assert.equal(calls.length, 3);
  const again = planSetup({ hosted: true }, context('win32', home, { registry: { [OPEN_COMMAND_KEY]: command } }));
  assert.equal(again.handler.status, 'already');
  assert.equal(planSetup({ hosted: true }, context('win32', home)).handler.status, 'configure', 'a missing registration is written');
  const moved = `"D:\\node\\node.exe" "${entry}" "%1"`;
  assert.equal(planSetup({ hosted: true }, context('win32', home, { registry: { [OPEN_COMMAND_KEY]: moved } })).handler.status, 'configure', 'our handler under another node is written again');
});

test('a holo:// handler another program owns is left alone, on Windows and on Linux', () => {
  const home = fixtureHome();
  const hologram = '"C:\\Users\\u\\AppData\\Local\\Hologram\\hologram.exe" "%1"';
  const record = join(home, '.prism', 'handler.json');
  const win = planSetup({ hosted: true }, context('win32', home, { registry: { [OPEN_COMMAND_KEY]: hologram } })).handler;
  assert.equal(win.status, 'conflict');
  assert.equal(win.detail, `holo:// already opens ${hologram}; left alone. That app can forward holo://build links to the handler ${record} names`);
  // The registration is left alone, but the handler and its record are still installed for that app to forward to.
  assert.deepEqual(win.steps.map((s) => s.kind), [...HANDLER_FILES.map(() => 'copy'), 'write']);
  assert.ok(!win.steps.some((s) => s.kind === 'command'));
  const linux = planSetup({ hosted: true }, context('linux', home, { found: { 'xdg-mime': '/usr/bin/xdg-mime' }, mime: { 'x-scheme-handler/holo': 'hologram.desktop' } })).handler;
  assert.equal(linux.status, 'conflict');
  assert.ok(!linux.steps.some((s) => s.kind === 'command' || s.path?.endsWith('.desktop')));
  applySetup({ agents: [], handler: linux, preferred: { steps: [] } }, recorder());
  assert.deepEqual(json(record), { schema: 'prism/handler/1', scheme: 'holo', host: 'build', node: '/usr/bin/node', entry: join(home, '.prism', 'handler', 'handler.mjs') });
  assert.equal(planSetup({ hosted: true }, context('linux', home, { found: { 'xdg-mime': '/usr/bin/xdg-mime' }, mime: { 'x-scheme-handler/holo': 'hologram.desktop' } })).handler.steps.length, 0, 'a second run installs nothing again');
  const ours = planSetup({ hosted: true }, context('linux', home, { found: { 'xdg-mime': '/usr/bin/xdg-mime' }, mime: { 'x-scheme-handler/holo': 'prism-open.desktop' } })).handler;
  assert.equal(ours.status, 'configure');
  const text = formatSetup(planSetup({ hosted: true }, context('win32', home, { registry: { [OPEN_COMMAND_KEY]: hologram } })));
  assert.match(text, /\n {2}holo:\/\/ {9}left alone {10}holo:\/\/ already opens /);
});

test('macOS: config under Application Support, and the handler an AppleScript applet with a holo URL type', () => {
  const home = fixtureHome({ 'Library/Application Support/Code/User': null, '.codex': null });
  const c = context('darwin', home);
  assert.equal(agentPaths(c).vscode.file, join(home, 'Library', 'Application Support', 'Code', 'User', 'mcp.json'));
  const plan = planSetup({ hosted: true }, c);
  assert.deepEqual(plan.agents.map((a) => a.status), ['not-found', 'configure', 'not-found', 'configure', 'not-found']);
  const app = join(home, 'Applications', 'Prism Open.app');
  const script = join(home, '.prism', 'handler', 'prism-open.applescript');
  const steps = plan.handler.steps.filter((s) => s.kind !== 'copy' && !s.path?.endsWith('handler.json'));
  assert.equal(steps[0].path, script);
  assert.match(steps[0].content, /^on open location theURL\n\tdo shell script quoted form of "\/usr\/bin\/node" & " " & quoted form of ".*handler\.mjs" & " " & quoted form of theURL & " >\/dev\/null 2>&1 &"\nend open location\n$/);
  assert.deepEqual(steps.slice(1).map((s) => [s.command, ...s.args]), [
    ['osacompile', '-o', app, script],
    ['/usr/libexec/PlistBuddy', '-c', 'Add :CFBundleURLTypes array', '-c', 'Add :CFBundleURLTypes:0 dict', '-c', 'Add :CFBundleURLTypes:0:CFBundleURLName string foundation.uor.prism', '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes array', '-c', 'Add :CFBundleURLTypes:0:CFBundleURLSchemes:0 string holo', join(app, 'Contents', 'Info.plist')],
    ['codesign', '--force', '--sign', '-', app],
    [LSREGISTER, '-f', app],
  ]);
  assert.equal(plan.preferred.agent, 'codex');
});

test('--agent limits setup to one agent and makes it the preferred one; an unknown agent is refused', () => {
  const home = fixtureHome({ '.cursor': null, '.codex': null, '.prism/config.json': JSON.stringify({ preferredAgent: 'codex', other: 1 }) });
  const plan = planSetup({ hosted: true, agent: 'cursor' }, context('linux', home));
  assert.deepEqual(plan.agents.map((a) => a.agent), ['cursor']);
  assert.deepEqual(plan.preferred, { agent: 'cursor', steps: [{ kind: 'write', path: join(home, '.prism', 'config.json'), content: '{\n  "preferredAgent": "cursor",\n  "other": 1\n}\n' }] });
  assert.deepEqual(planSetup({ hosted: true }, context('linux', home)).preferred, { agent: 'codex', steps: [] }, 'without --agent a remembered agent stays');
  assert.equal(planSetup({ hosted: true, agent: 'chatgpt' }, context('linux', home)).agents[0].status, 'manual');
  assert.throws(() => planSetup({ hosted: true, agent: 'emacs' }, context('linux', home)), (e) => e.code === 'setup.agent');
});

test('a command that fails marks its row failed and the rest still run', () => {
  const home = fixtureHome({ '.cursor': null });
  const plan = planSetup({ hosted: true }, context('linux', home, { found: { 'xdg-mime': '/usr/bin/xdg-mime' } }));
  applySetup(plan, { run: () => ({ status: 1, stderr: 'no display' }) });
  assert.equal(plan.handler.status, 'failed');
  assert.match(plan.handler.detail, /xdg-mime failed: exit 1: no display/);
  assert.equal(byAgent(plan).cursor.status, 'configure');
  assert.ok(existsSync(join(home, '.cursor', 'mcp.json')));
});

test('--dry-run prints every step under its agent and writes nothing', () => {
  const home = fixtureHome({ '.cursor/mcp.json': '{}', '.codex': null });
  const text = formatSetup(planSetup({ hosted: true }, context('linux', home)), { dryRun: true });
  assert.match(text, /^prism-code setup --dry-run: your agents\n {2}the server lexlean, remote at https:\/\/mcp\.uor\.foundation\/: checks and proves LexLean models; it stores them unlisted, not privately\n/);
  assert.match(text, /\n {2}claude-code {5}not found\n/);
  assert.match(text, /\n {2}codex {11}would configure {5}.*config\.toml\n {6}append to .*config\.toml:\n {8}\[mcp_servers\.lexlean\]\n {8}url = "https:\/\/mcp\.uor\.foundation\/"\n/);
  assert.match(text, /\n {2}cursor {10}would configure {5}.*mcp\.json\n {6}set mcpServers\.lexlean = \{"url":"https:\/\/mcp\.uor\.foundation\/"\} in .*\(backup .*mcp\.json\.prism-backup\)\n/);
  assert.match(text, /\n {2}holo:\/\/ {9}manual {14}.*xdg-mime not found/);
  assert.match(text, /\n {2}preferred agent codex\n {6}write .*config\.json\n$/);
  assert.equal(readFileSync(join(home, '.cursor', 'mcp.json'), 'utf8'), '{}');
  assert.equal(existsSync(join(home, '.prism')), false);
});

test('prism-code setup --dry-run reads the home it is given, and refuses an unknown option', () => {
  const home = fixtureHome({ '.cursor': null });
  const env = { PATH: '', Path: '', SystemRoot: process.env.SystemRoot ?? '', HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData', 'Roaming'), XDG_CONFIG_HOME: join(home, '.config'), XDG_DATA_HOME: join(home, '.local', 'share'), PRISM_HOME: join(home, '.prism') };
  const result = spawnSync(process.execPath, [bin, 'setup', '--dry-run', '--hosted'], { encoding: 'utf8', env });
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /\n {2}cursor {10}would configure {5}/);
  // A machine with the Hologram app already has a holo:// handler, which setup leaves alone.
  assert.match(result.stdout, /\n {2}holo:\/\/ {9}(would register|manual|left alone) /);
  assert.equal(existsSync(join(home, '.cursor', 'mcp.json')), false);
  assert.equal(spawnSync(process.execPath, [bin, 'setup', '--yes'], { encoding: 'utf8', env }).status, 64);
  assert.equal(spawnSync(process.execPath, [bin, 'setup', '--agent'], { encoding: 'utf8', env }).status, 64);
});

// The skills step: the one `prism` skill this package ships, written where agents read skills.
const SKILL = '---\nname: prism-new-app\ndescription: Build a Prism app.\n---\n\n# New Prism app\n';
const sha = (text) => `sha256:${createHash('sha256').update(text).digest('hex')}`;
const ORIGIN = 'prism-code@test/';

test('the skill setup installs is the one prism skill, the repository skill byte for byte', () => {
  const bundled = bundledSkills();
  assert.equal(bundled.skills.length, 1);
  const [skill] = bundled.skills;
  assert.equal(skill.name, 'prism');
  assert.match(skill.markdown, /^---\nname: prism\ndescription: Build a new Prism app/);
  assert.match(skill.markdown, /\n## Build a new app\n/);
  assert.match(skill.markdown, /npx prism-code@latest setup/);
  const repository = readFileSync(fileURLToPath(new URL('../../../../skills/prism/SKILL.md', import.meta.url)), 'utf8').replace(/\r\n/g, '\n');
  assert.equal(skill.markdown, repository, 'node sdk/docs/skill.mjs writes both copies');
  assert.equal(skill.digest, sha(repository));
  assert.ok(existsSync(SKILL_FILE));
  assert.match(bundledSkills(join(tmpdir(), 'no-such-skill.md')).error, /ENOENT/);
});

test('setup removes a skill it installed and prism replaces, and never one it did not install', () => {
  const home = fixtureHome({
    '.claude.json': '{}',
    '.claude/skills/prism-sdk/SKILL.md': 'old\n',
    '.claude/skills/prism-sdk/.prism-code.json': '{}\n',
    '.cursor': null,
    '.agents/skills/prism-sdk/SKILL.md': 'the user wrote this\n',
  });
  assert.deepEqual(RETIRED_SKILLS, ['prism-sdk']);
  const plan = planSetup({ hosted: true, skills: bundledSkills() }, context('linux', home));
  assert.deepEqual(plan.skills.steps.filter((s) => s.kind === 'remove').map((s) => s.path), [join(home, '.claude', 'skills', 'prism-sdk')]);
  assert.match(plan.skills.detail, /; replaces prism-sdk/);
  applySetup(plan, recorder());
  assert.equal(existsSync(join(home, '.claude', 'skills', 'prism-sdk')), false);
  assert.equal(readFileSync(join(home, '.agents', 'skills', 'prism-sdk', 'SKILL.md'), 'utf8'), 'the user wrote this\n');
  assert.ok(existsSync(join(home, '.claude', 'skills', 'prism', 'SKILL.md')));
  assert.equal(planSetup({ hosted: true, skills: bundledSkills() }, context('linux', home)).skills.status, 'already');
});

test('skills go to ~/.claude/skills for Claude Code and ~/.agents/skills for Codex, Cursor and VS Code, once', () => {
  const home = fixtureHome({ '.claude.json': '{}', '.cursor': null });
  const fetched = { skills: [{ name: 'prism-new-app', markdown: SKILL, digest: sha(SKILL), url: `${ORIGIN}prism-new-app/SKILL.md` }] };
  const plan = planSetup({ hosted: true, skills: fetched }, context('linux', home));
  assert.equal(plan.skills.status, 'configure');
  assert.equal(plan.skills.detail, `prism-new-app in ${join(home, '.claude', 'skills')}, ${join(home, '.agents', 'skills')}`);
  applySetup(plan, recorder());
  for (const dir of [join(home, '.claude', 'skills'), join(home, '.agents', 'skills')]) {
    assert.equal(readFileSync(join(dir, 'prism-new-app', 'SKILL.md'), 'utf8'), SKILL);
    assert.deepEqual(json(join(dir, 'prism-new-app', '.prism-code.json')), { source: `${ORIGIN}prism-new-app/SKILL.md`, digest: sha(SKILL) });
  }
  assert.equal(planSetup({ hosted: true, skills: fetched }, context('linux', home)).skills.status, 'already');
  assert.match(formatSetup(planSetup({ hosted: true, skills: fetched }, context('linux', home))), /\n {2}skills {10}already installed {3}prism-new-app in /);
  // A newer skill replaces the one prism-code wrote.
  const newer = { skills: [{ ...fetched.skills[0], markdown: `${SKILL}More.\n`, digest: sha(`${SKILL}More.\n`) }] };
  assert.equal(planSetup({ hosted: true, skills: newer }, context('linux', home)).skills.steps.length, 4);
  // Only Cursor found: only the shared folder.
  const cursorOnly = fixtureHome({ '.cursor': null });
  assert.match(planSetup({ hosted: true, skills: fetched }, context('linux', cursorOnly)).skills.detail, /in [^,]*\.agents[\\/]skills$/);
});

test('a skill folder prism-code did not write is left alone, and no skills is not an error', () => {
  const home = fixtureHome({ '.claude.json': '{}', '.claude/skills/prism-new-app/SKILL.md': 'my own notes\n' });
  const fetched = { skills: [{ name: 'prism-new-app', markdown: SKILL, digest: sha(SKILL), url: `${ORIGIN}prism-new-app/SKILL.md` }] };
  const plan = planSetup({ hosted: true, agent: 'claude-code', skills: fetched }, context('linux', home));
  assert.equal(plan.skills.status, 'conflict');
  assert.deepEqual(plan.skills.steps, []);
  assert.match(plan.skills.detail, /left alone, not written by prism-code: .*prism-new-app[\\/]SKILL\.md$/);
  assert.deepEqual(planSetup({ hosted: true, skills: { error: 'skill/SKILL.md: ENOENT' } }, context('linux', home)).skills, { status: 'unreadable', detail: 'not read: skill/SKILL.md: ENOENT', steps: [] });
  assert.equal(planSetup({ hosted: true, skills: fetched }, context('linux', fixtureHome())).skills.status, 'not-found');
  assert.equal(planSetup({ hosted: true }, context('linux', home)).skills, undefined, 'without fetched skills there is no row');
});

test('setup ends with what to do next: sign in when needed, restart the agent it changed, then the first sentence', () => {
  const plan = (status, journey = 'already') => ({
    agents: [{ agent: 'claude-code', status }, { agent: 'codex', status: 'not-found' }],
    journey: [{ agent: 'claude-code', status: journey }],
    preferred: { agent: 'claude-code', steps: [] },
  });
  const ask = `Ask Claude Code: "${FIRST_SENTENCE}"`;
  assert.deepEqual(nextSteps(plan('already')), [ask], 'nothing changed: no restart');
  assert.deepEqual(nextSteps(plan('already', 'configure')), ['Restart Claude Code, so it loads the new servers.', ask]);
  const signedOut = { id: 'github', status: 'manual', detail: 'not signed in: run gh auth login, so apps build on GitHub Actions without Docker' };
  assert.equal(nextSteps(plan('configure'), { github: signedOut })[0], 'Run gh auth login, so your app builds on GitHub Actions and this machine needs no Docker.');
  const missing = { agents: [{ agent: 'claude-code', status: 'not-found' }], journey: [], preferred: { agent: null, steps: [] } };
  assert.match(nextSteps(missing)[0], /^Install an agent, such as Claude Code \(https:/);
  assert.equal(formatNext(['one', 'two']), 'next\n  1. one\n  2. two\n');
  assert.equal(formatNext([]), '');
});

// Planted defect G9: setup used to add the hosted lexlean server to every agent it found.
test('without --hosted, setup adds no hosted server to any agent; the local prism server is still added', () => {
  const home = fixtureHome({ '.codex/config.toml': 'model = "o3"\n', '.config/Code/User': null, '.config/Claude': null });
  const plan = planSetup({}, context('linux', home));
  assert.equal(plan.hosted, false);
  for (const row of plan.agents) {
    assert.notEqual(row.status, 'configure', `${row.agent} gets no hosted server`);
    for (const step of row.steps ?? []) assert.doesNotMatch(JSON.stringify(step), /mcp\.uor\.foundation/);
  }
  assert.ok(plan.agents.some((row) => row.status === 'local-only'));
  assert.ok((plan.journey ?? []).some((row) => row.status === 'configure'), 'the local prism server is added');
  assert.match(formatSetup(plan), /not added; it stores models unlisted, not privately \(pass --hosted to add it\)/);
});

test('without --hosted each agent is listed once, under the local server', () => {
  // Measured on 2026-11-15: every agent had a row under the hosted server that was not added, and a second under the local one.
  const home = fixtureHome({ '.cursor/mcp.json': '{"mcpServers":{"lexlean":{"url":"https://mcp.uor.foundation/"}}}', '.codex': null });
  const text = formatSetup(planSetup({ hosted: false }, context('linux', home)));
  for (const agent of ['cursor', 'codex', 'claude-code']) assert.equal(text.split('\n').filter((line) => line.startsWith(`  ${agent} `)).length, 1, `${agent} in:\n${text}`);
  assert.match(text, /: not added; it stores models unlisted, not privately \(pass --hosted to add it\)\n {4}already in cursor from an earlier setup; left as it is\n {2}the server prism, local/);
  assert.match(text, /\n {2}claude-code {5}not found\n/);
  // With --hosted the hosted server's rows are its own, as before.
  const hosted = formatSetup(planSetup({ hosted: true }, context('linux', home)));
  assert.equal(hosted.split('\n').filter((line) => line.startsWith('  codex ')).length, 2);
});
