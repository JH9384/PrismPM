import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { checkSkill } from '../skill.mjs';
import { readCli, readPages } from '../lib/generate.mjs';
import { PRISM_CODE_DIR } from '../lib/runtime.mjs';
import { DOC_PAGES, TRY_IT, fillSkill, readSkill, renderSkill, skillBlocks, skillProblems } from '../lib/skill.mjs';
import { shippedCommandProblem } from '../lib/site.mjs';

const cli = readCli();
const pages = readPages();
const good = readSkill();
const problems = (text) => skillProblems(text, { cli, pages });

test('the committed skill follows every rule and its generated blocks are current', () => {
  assert.deepEqual(checkSkill(), []);
});

test('the verbs cli.json lists for prism-code are the verbs the command prints in --help', () => {
  const help = spawnSync(process.execPath, [join(PRISM_CODE_DIR, 'bin', 'prism-code.mjs'), '--help'], { encoding: 'utf8' });
  assert.equal(help.status, 0);
  const printed = [...help.stdout.matchAll(/^ {2}prism-code ([a-z][a-z-]*)\b/gm)].map((m) => m[1]);
  assert.deepEqual([...cli.prismCode.verbs.map((v) => v.name)].sort(), [...new Set(printed)].sort());
});

test('a verb or a flag that prism-code does not have is named', () => {
  assert.equal(shippedCommandProblem('npx prism-code run app.holo --port 80', cli), null);
  assert.equal(shippedCommandProblem('prism-code@0.2.0 vectors app.holo', cli), null);
  assert.equal(shippedCommandProblem('npx prism-code --version', cli), null);
  assert.equal(shippedCommandProblem('npm install prism-code', cli), null);
  assert.equal(shippedCommandProblem('npx prism-code doctor', cli), null);
  assert.match(shippedCommandProblem('npx prism-code deploy', cli), /deploy is not a verb/);
  assert.match(shippedCommandProblem('prism-code run app.holo --tls', cli), /no flag --tls/);
  assert.match(shippedCommandProblem('prism-code inspect app.holo --json', cli), /no flag --json/);
});

test('every command the skill tells an agent to try is a shipped command', () => {
  for (const { command } of TRY_IT) assert.equal(shippedCommandProblem(command, cli), null, command);
});

test('every page the skill points at is in the page list', () => {
  const listed = new Set(pages.groups.flatMap((g) => g.pages.map((p) => p.path)));
  for (const { path } of DOC_PAGES) assert.ok(listed.has(path), path);
});

test('the skill is refused when it names a command that has not shipped', () => {
  assert.match(problems(`${good}\n\`\`\`bash\nprism build\n\`\`\`\n`).join('\n'), /prism build names a command that has not shipped/);
  assert.match(problems(`${good}\nRun \`prism check\` first.\n`).join('\n'), /prism check names a command that has not shipped/);
  assert.match(problems(`${good}\n\`\`\`bash\nnpx prism-code sign app.holo\n\`\`\`\n`).join('\n'), /sign is not a verb/);
});

test('the skill is refused when its frontmatter is wrong', () => {
  assert.match(problems(good.replace('name: prism', 'name: prism-sdk')).join('\n'), /name is "prism-sdk"/);
  assert.match(problems(good.replace(/^description: .*$/m, 'description: ')).join('\n'), /no description/);
  assert.match(problems(good.replace('---\n', '---\nlicense: MIT\n')).join('\n'), /key license/);
  assert.match(problems(good.replace(/^---\n[\s\S]*?\n---\n/, '')).join('\n'), /no frontmatter/);
});

test('the skill is refused when a marker is missing, including the MCP spot', () => {
  assert.match(problems(good.replace('<!-- mcp:begin -->', '')).join('\n'), /marker mcp:begin appears 0 times/);
  assert.match(problems(good.replace('<!-- generated:docs:end -->', '')).join('\n'), /marker docs:end appears 0 times/);
  assert.throws(() => fillSkill(good.replace('<!-- generated:try:begin -->', ''), skillBlocks({ cli, pages, exampleRun: { source: '', output: '' } })), /needs exactly one/);
});

test('the skill is refused when it links a page the site does not have, or uses a banned word', () => {
  assert.match(problems(`${good}\n${pages.site}/guides/nothing-here\n`).join('\n'), /is not a page of the site/);
  assert.match(problems(`${good}\nThe Atlas builds it.\n`).join('\n'), /Atlas/);
});

test('a stale generated block is rebuilt, and a hand edit inside one does not survive', () => {
  const edited = good.replace('<!-- generated:try:begin -->\n', '<!-- generated:try:begin -->\nhand edit\n');
  assert.notEqual(edited, good);
  assert.equal(renderSkill({ cli, pages, text: edited }), good);
});

test('the command block lists every shipped verb and exit code', () => {
  const { commands } = skillBlocks({ cli, pages, exampleRun: { source: '', output: '' } });
  for (const verb of cli.prismCode.verbs) assert.ok(commands.includes(`\`${verb.usage}\``), verb.name);
  for (const exit of cli.prismCode.exitCodes) assert.ok(commands.includes(`| ${exit.code}`), String(exit.code));
});
