import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fence, footer, frontmatter, page, status, table } from '../lib/markdown.mjs';

test('table escapes pipes and pads columns', () => {
  const out = table(['Flag', 'Meaning'], [['--types <a|b>', 'one of two']]);
  assert.equal(out, '| Flag           | Meaning    |\n| -------------- | ---------- |\n| --types <a\\|b> | one of two |\n');
});

test('table refuses an empty body', () => {
  assert.throws(() => table(['A'], []), /at least one row/);
});

test('fence normalizes line endings and trailing newlines', () => {
  assert.equal(fence('text', 'a\r\nb\n\n'), '```text\na\nb\n```\n');
});

test('page collapses blank runs and ends with one newline', () => {
  const out = page([frontmatter('T', 'D'), '\n\n\n## H\n\n', status('x'), footer(['s 1', 's 2'])]);
  assert.equal(out, '---\ntitle: T\ndescription: D\n---\n\n## H\n\nStatus: x\n\nGenerated from s 1, s 2.\n');
});

test('frontmatter quotes available_in so 1.0 stays a string', () => {
  assert.equal(frontmatter('T', 'D', '1.0'), '---\ntitle: T\ndescription: D\navailable_in: "1.0"\n---\n');
});
