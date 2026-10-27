// npm create prism-code is prism-code init (#281); the full comparison is in prism-code/test/init.test.mjs.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../bin/create-prism-code.mjs', import.meta.url));

test('create-prism-code scaffolds a project and passes options through', () => {
  const dir = join(mkdtempSync(join(tmpdir(), 'create-prism-')), 'app');
  const r = spawnSync(process.execPath, [bin, dir, '--name', 'hello'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^Creating hello in /);
  assert.ok(existsSync(join(dir, 'prism.toml')) && existsSync(join(dir, 'lexlean.lock')));
  assert.equal(spawnSync(process.execPath, [bin, '--nope'], { encoding: 'utf8' }).status, 64);
});
