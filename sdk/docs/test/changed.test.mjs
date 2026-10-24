import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { changedPages, normalize, summary } from '../changed.mjs';

const footer = (commit) => `Generated from @prism-code/spec 2026-10-23 at ${commit.repeat(40)}.\n`;

function site(root, pages) {
  for (const [rel, text] of Object.entries(pages)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
}

test('only a real change shows: the commit in a footer does not', () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-docs-changed-'));
  try {
    site(join(root, 'base'), { 'api/load.md': `one\n${footer('1')}`, 'api/same.md': `same\n${footer('1')}`, 'api/gone.md': 'gone\n' });
    site(join(root, 'head'), { 'api/load.md': `two\n${footer('2')}`, 'api/same.md': `same\n${footer('2')}`, 'api/new.md': 'new\n' });
    const result = changedPages(join(root, 'base'), join(root, 'head'));
    assert.deepEqual({ changed: result.changed, added: result.added, removed: result.removed }, { changed: ['api/load.md'], added: ['api/new.md'], removed: ['api/gone.md'] });
    assert.match(result.diff, /^diff --git api\/load\.md api\/load\.md$/m);
    assert.match(result.diff, /^-one$/m);
    assert.match(result.diff, /^\+two$/m);
    assert.doesNotMatch(result.diff, /api\/same/);
    const text = summary(result);
    assert.match(text, /1 page\(s\) changed, 1 added, 1 removed\./);
    assert.match(text, /- `api\/load`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('identical sites report no change', () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-docs-changed-'));
  try {
    site(join(root, 'base'), { 'llms.txt': `x\n${footer('a')}` });
    site(join(root, 'head'), { 'llms.txt': `x\n${footer('b')}` });
    assert.match(summary(changedPages(join(root, 'base'), join(root, 'head'))), /No generated page differs\./);
    assert.equal(normalize(`x\r\n${footer('c')}`), `x\nGenerated from @prism-code/spec 2026-10-23 at <commit>.\n`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
