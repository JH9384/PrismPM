// The CLI groups of the nine modules (#441): `prism-code <module> <verb>` is the
// module's verb, or the flat verb it names, and a group's file is the one place
// its verbs are listed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { GROUPS, groupUsage, groupVerb } from '../src/cli/index.mjs';

const bin = fileURLToPath(new URL('../bin/prism-code.mjs', import.meta.url));
const holo = fileURLToPath(new URL('../fixtures/Calculator.holo', import.meta.url));
const cli = (...args) => spawnSync(process.execPath, [bin, ...args], { encoding: 'utf8', env: { PATH: dirname(process.execPath) } });
const MODULES = ['client', 'images', 'containers', 'networks', 'volumes', 'system', 'auth', 'errors', 'verify'];

test('every group is one of the nine modules, and every verb names a flat verb or runs itself', () => {
  for (const [module, verbs] of Object.entries(GROUPS)) {
    assert.ok(MODULES.includes(module), module);
    assert.ok(Object.isFrozen(verbs), module);
    for (const [name, verb] of Object.entries(verbs)) {
      assert.match(name, /^[a-z][a-z-]*$/);
      assert.ok((typeof verb.flat === 'string') !== (typeof verb.run === 'function'), `${module} ${name} is flat or runs, not both`);
    }
  }
});

test('a group verb is found only for a module and one of its verbs', () => {
  assert.equal(groupVerb('images', ['inspect', holo]).verb.flat, 'inspect');
  assert.equal(groupVerb('images', ['nope']), null);
  assert.equal(groupVerb('images', []), null);
  assert.equal(groupVerb('verify', ['--lean']), null);
  assert.equal(groupVerb('constructor', ['x']), null);
});

test('prism-code images inspect is prism-code inspect', () => {
  const flat = cli('inspect', holo, '--json');
  const grouped = cli('images', 'inspect', holo, '--json');
  assert.equal(flat.status, 0, flat.stderr);
  assert.equal(grouped.status, flat.status);
  assert.equal(grouped.stdout, flat.stdout);
});

test('the help lists every group verb, and a module alone is a usage error naming its verbs', () => {
  const help = cli('--help');
  assert.equal(help.status, 0);
  for (const line of groupUsage().split('\n')) assert.ok(help.stdout.includes(line), line);
  const bare = cli('containers');
  assert.equal(bare.status, 64);
  assert.match(bare.stderr, /^containers takes one of /);
  const group = cli('images', '--help');
  assert.equal(group.status, 0);
  assert.match(group.stdout, /^ {2}prism-code images push /m);
  assert.doesNotMatch(group.stdout, /prism-code containers/);
});
