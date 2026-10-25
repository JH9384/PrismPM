#!/usr/bin/env node
/**
 * The Agent Skill for Prism, skills/prism/SKILL.md.
 *
 *   node sdk/docs/skill.mjs            rebuild the generated blocks in the skill
 *   node sdk/docs/skill.mjs --check    exit 1 when a block is stale or the skill breaks a rule
 *   node sdk/docs/skill.mjs smoke      install prism-code from npm in a scratch directory
 *                                      and run every command the skill tells an agent to try
 *
 * The rules and the blocks are in lib/skill.mjs.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readCli, readPages } from './lib/generate.mjs';
import { SKILL_FILE, SKILL_PATH, TRY_IT, readSkill, renderSkill, skillProblems } from './lib/skill.mjs';

/** Problems with the committed skill: broken rules, then stale blocks. */
export function checkSkill() {
  const cli = readCli();
  const pages = readPages();
  const text = readSkill();
  const problems = skillProblems(text, { cli, pages });
  if (problems.length === 0 && renderSkill({ cli, pages, text }) !== text) {
    problems.push(`a generated block is stale; run node sdk/docs/skill.mjs and commit ${SKILL_FILE}`);
  }
  return problems;
}

function smoke() {
  const dir = mkdtempSync(join(tmpdir(), 'prism-skill-smoke-'));
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
  try {
    writeFileSync(join(dir, 'package.json'), '{"private":true}\n');
    const install = spawnSync(npm, ['install', 'prism-code'], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
    if (install.status !== 0) return 1;
    for (const { command } of TRY_IT) {
      console.log(`$ ${command}`);
      const [, ...args] = command.split(' ');
      const run = spawnSync(npx, ['--no-install', ...args], { cwd: dir, stdio: 'inherit', shell: process.platform === 'win32' });
      if (run.status !== 0) {
        console.error(`skill: ${command} exited with ${run.status}`);
        return 1;
      }
    }
    console.log('every command in the skill ran against the published prism-code');
    return 0;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function main(argv) {
  if (argv[0] === 'smoke') return smoke();
  const check = argv.includes('--check');
  const unknown = argv.filter((a) => a !== '--check');
  if (unknown.length > 0) throw new Error(`unknown argument ${unknown[0]}`);
  if (check) {
    const problems = checkSkill();
    for (const problem of problems) console.error(`skill: ${SKILL_FILE}: ${problem}`);
    if (problems.length > 0) return 1;
    console.log(`skill ok: ${SKILL_FILE} names only shipped commands and its generated blocks are current`);
    return 0;
  }
  const text = readSkill();
  const next = renderSkill({ cli: readCli(), pages: readPages(), text });
  if (next !== text) writeFileSync(SKILL_PATH, next);
  console.log(`${next === text ? 'unchanged' : 'wrote'} ${SKILL_FILE}`);
  return 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2)).then(
    (code) => process.exit(code),
    (error) => {
      console.error(error.stack ?? String(error));
      process.exit(2);
    },
  );
}
