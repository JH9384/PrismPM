import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintText } from '../lint.mjs';

const lint = fileURLToPath(new URL('../lint.mjs', import.meta.url));

test('a banned word in prose is reported with its line', () => {
  const hits = lintText('# Title\n\nThe hub stores every kappa.\n', 'x.md');
  assert.deepEqual(hits.map((h) => [h.line, h.word]), [[3, 'kappa']]);
});

test('code spans and fenced blocks are not prose', () => {
  const text = 'Read `requires_kappa` first.\n\n```json\n{ "kind": "oracle" }\n```\n\nDone.\n';
  assert.deepEqual(lintText(text, 'x.md'), []);
});

test('the predicate URIs and the site hostname are allowed in prose', () => {
  const text = 'Type https://uor.foundation/prism/proof/v1 lives at universal-coordinate-foundation.lovable.app.\n';
  assert.deepEqual(lintText(text, 'x.md'), []);
  assert.equal(lintText('See uor.foundation for more.\n', 'x.md').length, 2);
});

test('issue numbers, milestone names, profile numbers and em dashes are reported', () => {
  const text = 'Fixed in #300.\nMilestone M4 v1.0-beta.1.\nUses text/3.\nA dash — here.\n```\ncode — dash\n```\n';
  assert.deepEqual(
    lintText(text, 'x.md').map((h) => [h.line, h.word]),
    [
      [1, 'issue number'],
      [2, 'milestone name'],
      [3, 'profile number'],
      [4, 'em dash'],
      [6, 'em dash'],
    ],
  );
});

test('the command exits 1 and names file and line', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-lint-'));
  try {
    const file = join(dir, 'page.md');
    writeFileSync(file, '---\ntitle: Clean\n---\n\nThe registry holds it.\n\nA claim here.\n');
    const result = spawnSync(process.execPath, [lint, file], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /page\.md:7: claim: A claim here\./);
    writeFileSync(file, 'Nothing wrong.\n');
    assert.equal(spawnSync(process.execPath, [lint, file], { encoding: 'utf8' }).status, 0);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
