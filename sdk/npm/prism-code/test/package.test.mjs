// Measure npm's actual package, including the checkout's platform line endings.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { test } from 'node:test';
import { checkPackage, PACKAGE_LIMIT } from '../scripts/check-package.mjs';

const args = ['pack', '--dry-run', '--json'];
assert.ok(process.env.npm_execpath, 'Run this suite with npm test so npm uses the current Node executable');
const result = spawnSync(process.execPath, [process.env.npm_execpath, ...args], {
  cwd: new URL('../', import.meta.url), encoding: 'utf8', timeout: 60000,
});
assert.ifError(result.error);
assert.equal(result.status, 0, result.stderr);
const [pack] = JSON.parse(result.stdout);
const { files } = pack;

test('all required distributed files fit the package budget, the sum of the reviewed allowances', () => {
  checkPackage(pack);
});

test('one byte over budget is refused, and the exact boundary is accepted', () => {
  const atSize = (unpackedSize) => ({
    ...pack, unpackedSize,
    files: files.map((file, i) => i === 0 ? { ...file, size: file.size + unpackedSize - pack.unpackedSize } : file),
  });
  checkPackage(atSize(PACKAGE_LIMIT));
  assert.throws(() => checkPackage(atSize(PACKAGE_LIMIT + 1)), new RegExp(`cap is ${PACKAGE_LIMIT}$`));
});

test('a smaller package cannot pass by omitting a required file or changing its inventory', () => {
  const without = files.filter(({ path }) => path !== 'src/vendor/verify.mjs');
  assert.throws(() => checkPackage({ ...pack, files: without, unpackedSize: without.reduce((sum, f) => sum + f.size, 0) }), /distribution additions\/removals/);
  assert.throws(() => checkPackage({ ...pack, files: [...files, files[0]] }), /distribution additions\/removals/);
  assert.throws(() => checkPackage({ ...pack, files: [...files, { path: 'unexpected.txt', size: 0 }] }), /distribution additions\/removals/);
  assert.throws(() => checkPackage({ ...pack, unpackedSize: pack.unpackedSize - 1 }), /account for every distributed file/);
});

test('README guide links resolve to repository files and headings', () => {
  const root = new URL('../../../../', import.meta.url);
  const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
  const guide = readFileSync(new URL('sdk/npm/prism-code/docs/guide.md', root), 'utf8');
  const slugs = new Set([...guide.matchAll(/^#+ (.+)$/gm)].map(([, title]) => title.toLowerCase().replace(/[^\w\s-]/g, '').replace(/ /g, '-')));
  const links = [...readme.matchAll(/https:\/\/github\.com\/UOR-Foundation\/PrismPM\/blob\/main\/sdk\/npm\/prism-code\/docs\/guide\.md(?:#([\w-]+))?/g)];
  assert.ok(links.length > 0, 'the complete guide is discoverable from the npm README');
  for (const [, anchor] of links) if (anchor) assert.ok(slugs.has(anchor), anchor);
  for (const [, path] of guide.matchAll(/\]\(((?:\.\.\/)+docs\/proposals\/[^)#]+\.md)\)/g)) {
    assert.ok(statSync(new URL(path, new URL('sdk/npm/prism-code/docs/guide.md', root))).isFile(), path);
  }
});
