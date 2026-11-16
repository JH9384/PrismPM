// The canonical path is what `npx prism-code@latest setup` leads every user to: an agent writes
// one JSON spec, `prism/spec.json`, which is deterministically rendered to LexLean and built.
// These tests hold the whole surface a new user meets to that one path, and to no other.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { INSTRUCTIONS } from '../src/journey/mcp.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const skill = readFileSync(new URL('../skill/SKILL.md', import.meta.url), 'utf8');
const scratch = () => mkdtempSync(join(tmpdir(), 'prism-canonical-'));
const run = (args, { cwd = scratch(), env = {} } = {}) => {
  const r = spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', timeout: 120000, cwd, env: { ...process.env, ...env } });
  return { code: r.status, out: r.stdout ?? '', err: r.stderr ?? '' };
};

/** A home with the agents setup looks for, so its plan is the plan a user would get. */
function agentHome() {
  const home = scratch();
  for (const d of ['.codex', '.cursor', '.config/Code/User']) mkdirSync(join(home, d), { recursive: true });
  return { HOME: home, USERPROFILE: home, APPDATA: join(home, 'AppData'), XDG_CONFIG_HOME: join(home, '.config'), PRISM_HOME: join(home, '.prism') };
}

test('setup gives every agent the local Prism server, and the hosted one only when asked', () => {
  const env = agentHome();
  const plan = JSON.parse(run(['setup', '--dry-run', '--agents-only', '--json'], { env }).out);
  assert.ok(plan.journey.some((row) => row.status === 'configure'), 'the local prism server is added');
  assert.deepEqual(plan.agents.filter((row) => row.status === 'configure'), [], 'no agent is given the hosted server');
  const asked = JSON.parse(run(['setup', '--dry-run', '--agents-only', '--json', '--hosted'], { env }).out);
  assert.ok(asked.agents.some((row) => row.status === 'configure'), '--hosted adds it');
  assert.match(run(['setup', '--dry-run', '--agents-only'], { env }).out, /not added; it stores models unlisted, not privately/);
});

test('setup ends by telling the user to ask an agent for an app', () => {
  const plan = JSON.parse(run(['setup', '--dry-run', '--agents-only', '--json'], { env: agentHome() }).out);
  assert.match(plan.next.join(' '), /build me a Prism app/);
});

test('the MCP instructions every agent receives name spec.json, state determinism and forbid LexLean', () => {
  assert.match(INSTRUCTIONS, /one input: prism\/spec\.json/);
  assert.match(INSTRUCTIONS, /The same JSON gives the same model\./);
  assert.match(INSTRUCTIONS, /Never write LexLean/);
  assert.ok(INSTRUCTIONS.split(/\s+/).length < 150, 'the instructions stay short enough to be read');
});

test('the skill setup installs teaches the canonical path and no other', () => {
  assert.match(skill, /\*\*The canonical path\.\*\* Every Prism app is built this way, and no other/);
  assert.match(skill, /There is no second way to build a Prism app\./);
  // The routes that competed with it: an agent drafting LexLean, and a repository made by hand.
  assert.doesNotMatch(skill, /lexlean_draft_assemble|lexlean_draft_write/);
  assert.doesNotMatch(skill, /gh repo create OWNER\/NAME --template/);
  assert.doesNotMatch(skill, /--unstable-author/);
});

test('a scaffolded LexLean project says it is not a Prism app, and names the app input', () => {
  const r = run(['init', join(scratch(), 'proj')]);
  assert.equal(r.code, 0, r.err);
  assert.match(r.out, /This is a LexLean project, not a Prism app\./);
  assert.match(r.out, /prism\/spec\.json/);
});

test('the route where an agent wrote the model stays removed', () => {
  const r = run(['build', '--unstable-author']);
  assert.equal(r.code, 64);
  assert.match(r.err, /unknown option --unstable-author/);
});

test('check holds a holo to a spec: --spec refuses one that carries no seal', () => {
  const dir = scratch();
  const policy = join(dir, 'p0.json');
  writeFileSync(policy, '{"minimum":"P0"}');
  const spec = join(dir, 'spec.json');
  writeFileSync(spec, JSON.stringify({ purpose: 'Decide whether a payment is approved.', fields: [{ name: 'role', kind: 'choice', values: ['clerk', 'manager'] }], outcomes: ['approved', 'refused'], rules: [{ when: [{ field: 'role', op: 'is', value: 'manager' }], then: 'approved' }], otherwise: 'refused' }));
  const holo = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
  const asked = run(['check', holo, '--policy', policy, '--spec', spec]);
  assert.equal(asked.code, 1, asked.err || asked.out);
  assert.match(asked.out, /^spec {6}none {4}The holo carries no spec seal/m);
  // Without the flag, and with no spec beside the holo, the check says nothing about a spec.
  const plain = run(['check', holo, '--policy', policy]);
  assert.equal(plain.code, 0, plain.err);
  assert.doesNotMatch(plain.out, /^spec /m);
});
