import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EXAMPLES, readPages, render } from '../lib/generate.mjs';
import { runExample } from '../lib/examples.mjs';
import { FIXTURE_DIR, prismCode } from '../lib/runtime.mjs';
import { loadSpec } from '../lib/spec.mjs';
import { diffAgainst, writeOutput } from '../generate.mjs';
import { lintText } from '../lint.mjs';

const generate = fileURLToPath(new URL('../generate.mjs', import.meta.url));
const committed = fileURLToPath(new URL('../../../docs/generated', import.meta.url));

const spec = await loadSpec();
const runtime = prismCode();
const files = await render({ spec, runtime });

test('every page in the list is rendered with the page shape', () => {
  const pages = readPages().groups.flatMap((g) => g.pages);
  assert.equal(files.size, pages.length + 2);
  for (const page of pages) {
    const text = files.get(`${page.path}.md`);
    assert.ok(text, `${page.path} rendered`);
    assert.match(text, new RegExp(`^---\\ntitle: ${page.title}\\ndescription: `));
    assert.match(text, /\n## Next steps\n\n- \[/);
    assert.match(text, /\nGenerated from .+\.\n$/);
    if (page.status) assert.ok(text.includes(`\nStatus: ${page.status}\n`), `${page.path} carries its status line`);
    assert.deepEqual(lintText(text, page.path), [], `${page.path} passes the vocabulary lint`);
  }
  assert.ok(files.get('llms.txt').startsWith('# Prism\n'));
  assert.ok(files.get('llms-full.md').includes('<!-- reference/holo-format -->'));
});

test('the spec pages carry the pinned revision and commit', () => {
  const holo = files.get('reference/holo-format.md');
  assert.ok(holo.includes(`Generated from @prism-code/spec ${spec.module.FORMAT_REVISION} at ${spec.commit}.`));
  assert.ok(holo.includes('| 202      | variable | section bodies'));
  assert.ok(holo.includes('| 0   | 15   | APP_MANIFEST'));
});

test('the executed examples print what the pages show', () => {
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  const outputs = Object.fromEntries(EXAMPLES.map((n) => [n, runExample(n, { map, cwd: FIXTURE_DIR }).output]));
  assert.equal(outputs.load, 'Calculator\ntrue\n{ request: 52, response: 27, guestAllocation: 65536 }\n');
  assert.equal(outputs.dispatch, '"1\\tok\\t42"\n');
  assert.equal(outputs.acceptance, '{ total: 22, passed: 22, failed: [] }\n');
  assert.ok(outputs['spec-constants'].startsWith(`${spec.module.FORMAT_REVISION}\nHOLO 4 8\n`));
  assert.ok(files.get('api/load.md').includes(`\`\`\`text\n${outputs.load}\`\`\``));
  assert.ok(files.get('api/dispatch.md').includes(`\`\`\`text\n${outputs.dispatch}\`\`\``));
  assert.ok(files.get('api/history-and-replay.md').includes(`\`\`\`text\n${outputs.acceptance}\`\`\``));
});

test('an example that fails to run fails the generation', () => {
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  assert.throws(() => runExample('load', { map, cwd: tmpdir() }), /example load exited with/);
});

test('check names the page that drifted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-docs-check-'));
  try {
    writeOutput(files, dir);
    assert.deepEqual(diffAgainst(files, dir), []);
    const target = join(dir, 'reference', 'lockfile.md');
    writeFileSync(target, readFileSync(target, 'utf8').replace('## `prismpm/sdk-lock/2`', '## `prismpm/sdk-lock/3`'));
    writeFileSync(join(dir, 'extra.md'), 'stray\n');
    assert.deepEqual(diffAgainst(files, dir), ['reference/lockfile.md: differs from the generated page', 'extra.md: not produced by the generator']);
    const result = spawnSync(process.execPath, [generate, '--check', '--out', dir], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /drift: reference\/lockfile\.md: differs from the generated page/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the committed output is current', () => {
  assert.deepEqual(diffAgainst(files, committed), []);
});
