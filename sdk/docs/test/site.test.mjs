import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readCli, readPages, render, renderSite } from '../lib/generate.mjs';
import { prismCode } from '../lib/runtime.mjs';
import {
  LAYOUT,
  SITE_DIR,
  changelogProblems,
  commandProblems,
  fill,
  frontmatterProblems,
  layoutProblems,
  linkProblems,
  listNarrative,
  parseFrontmatter,
  readReleases,
} from '../lib/site.mjs';
import { loadSpec } from '../lib/spec.mjs';

const spec = await loadSpec();
const runtime = prismCode();
const releases = readReleases();
const files = await render({ spec, runtime });
const page = (text) => `---\ntitle: T\ndescription: D.\navailable_in: "0.2.0"\n---\n${text}`;

/** The committed narrative pages in a scratch directory, so a test can break them. */
function scratchSite() {
  const dir = mkdtempSync(join(tmpdir(), 'prism-docs-site-src-'));
  cpSync(SITE_DIR, dir, { recursive: true });
  return dir;
}

test('the built site is exactly the published layout', () => {
  const top = new Set([...files.keys()].map((f) => f.split('/')[0]));
  assert.deepEqual(layoutProblems([...top]), []);
  assert.deepEqual([...top].sort(), [...LAYOUT].sort());
});

test('every page, narrative and generated, carries title, description and a known available_in', () => {
  for (const [path, text] of files) {
    if (!path.endsWith('.md') || path === 'llms-full.md') continue;
    assert.deepEqual(frontmatterProblems(text, releases), [], path);
    const data = parseFrontmatter(text);
    assert.ok(releases.ids.has(data.available_in), `${path}: ${data.available_in}`);
    assert.match(text, /\navailable_in: "[^"]+"\n/, `${path} quotes available_in`);
  }
});

test('every narrative page is in the page list and none duplicates a generated page', () => {
  const entries = readPages().groups.flatMap((g) => g.pages);
  const narrative = entries.filter((p) => p.narrative).map((p) => p.path).sort();
  assert.deepEqual(listNarrative().sort(), narrative);
  const generated = new Set(entries.filter((p) => !p.narrative).map((p) => p.path));
  for (const path of narrative) assert.ok(!generated.has(path), path);
});

test('the release status page renders every release and every feature from release-status.json', () => {
  const text = files.get('reference/release-status.md');
  for (const name of ['distribution', 'releases', 'features']) assert.ok(text.includes(`<!-- generated:${name}:begin -->`), name);
  for (const release of releases.releases) assert.ok(text.includes(`| ${release.title} `), release.title);
  for (const feature of releases.features) assert.ok(text.includes(feature.feature), feature.feature);
  assert.equal(files.get('release-status.json'), readFileSync(join(SITE_DIR, 'release-status.json'), 'utf8').replace(/\r\n/g, '\n'));
});

test('narrative tokens are filled from the spec and the executed examples', () => {
  assert.ok(files.get('guides/audit.md').includes(`format revision ${spec.module.FORMAT_REVISION}`));
  assert.ok(files.get('sdks/typescript.md').includes('```text\nCalculator true\n"1\\tok\\t42"\n22 of 22 examples replayed\n```'));
  for (const [path, text] of files) assert.ok(!/\{\{[^}]+\}\}/.test(text), `${path} has an unfilled token`);
  assert.throws(() => fill('{{FORMAT_REVISON}}', { spec, examples: {}, releases }), /unknown token \{\{FORMAT_REVISON\}\}/);
  assert.throws(() => fill('{{example:nope}}', { spec, examples: {}, releases }), /unknown example nope/);
});

test('llms.txt lists every page, narrative pages included, at its site URL', () => {
  const llms = files.get('llms.txt');
  const { site } = readPages();
  assert.ok(llms.includes(`- [Prism docs](${site}/): `));
  assert.ok(llms.includes(`- [Quickstart](${site}/get-started/quickstart): `));
  assert.ok(llms.includes(`- [Policy reference](${site}/reference/policy): `));
  assert.ok(llms.includes(`- [prism-code at a glance](${site}/api): `));
  assert.ok(llms.includes('## SDKs\n') && llms.includes('## Changelog\n'));
});

test('frontmatter problems name what is missing or unknown', () => {
  assert.deepEqual(frontmatterProblems(page('x'), releases), []);
  assert.deepEqual(frontmatterProblems('# no frontmatter\n', releases), ['no frontmatter: the page must start with --- and title, description, available_in']);
  assert.deepEqual(frontmatterProblems('---\ntitle: T\ndescription: D.\n---\n', releases), ['frontmatter has no available_in']);
  assert.match(frontmatterProblems('---\ntitle: T\ndescription: D.\navailable_in: "9.9"\n---\n', releases)[0], /available_in 9\.9 is not a release in docs\/site\/release-status\.json/);
  assert.deepEqual(frontmatterProblems('---\ntitle: T\ndescription: D.\navailable_in: "0.5"\nslug: x\n---\n', releases), ['frontmatter key slug is not one of title, description, available_in']);
});

test('links must name a page of the site; code is not checked', () => {
  const known = new Set(['', 'guides/ship', 'api']);
  const text = [
    '[a](/docs/guides/ship) [b](/docs) [c](/docs/) [d](/docs/api#exports) [e](https://example.com) [f](#here)',
    '[g](/docs/guides/nope) [h](/api/index) [i](guides/ship.md)',
    '```md',
    '[j](/nowhere)',
    '```',
  ].join('\n');
  assert.deepEqual(linkProblems(text, known), [
    'line 2: link /docs/guides/nope names no page',
    'line 2: link /api/index is not a /docs/ path',
    'line 2: link guides/ship.md is not a /docs/ path',
  ]);
});

test('commands in bash blocks must use verbs and flags the CLI description has', () => {
  const cli = readCli();
  const text = [
    '```bash',
    "prism run calculator --input '{\"op\": \"add\"}' --policy p --allow-unverified",
    'prism build --provenance=max --json --unstable-streams',
    'cat x | prism push calculator ghcr.io/you/c --nope',
    'prism frobnicate',
    '```',
    '```text',
    'prism frobnicate --also-ignored',
    '```',
  ].join('\n');
  assert.deepEqual(commandProblems(text, cli), [
    'line 4: prism push has no flag --nope in sdk/docs/cli.json',
    'line 5: prism frobnicate is not a verb in sdk/docs/cli.json',
  ]);
});

test('the changelog has exactly one entry per release, titled as the release list titles it', () => {
  const titles = releases.releases.map((r) => `## ${r.title}\n`).join('\n');
  assert.deepEqual(changelogProblems(`${titles}\n## Next steps\n`, releases), []);
  const problems = changelogProblems('## 1.0-beta\n\n## Next steps\n', releases);
  assert.ok(problems.includes('changelog heading 1.0-beta is not a release title in docs/site/release-status.json'));
  assert.ok(problems.includes('changelog has no entry for release 0.2.0'));
});

test('a broken narrative page fails the build, named by the page', async () => {
  const dir = scratchSite();
  try {
    const edit = (rel, change) => writeFileSync(join(dir, rel), change(readFileSync(join(dir, rel), 'utf8')));
    edit('guides/ship.md', (t) => t.replace('available_in: "1.0-beta"\n', ''));
    edit('guides/audit.md', (t) => t.replace('(/docs/reference/attestations)', '(/docs/reference/attestation)'));
    edit('guides/agents.md', (t) => t.replace('npx @prism-code/mcp', 'prism run calculator --sandbox\nnpx @prism-code/mcp'));
    edit('index.md', (t) => t.replace('Prism turns', '{{VERSION}} Prism turns'));
    writeFileSync(join(dir, 'reference', 'cli.md'), page('A hand-written copy.\n'));
    writeFileSync(join(dir, 'guides', 'extra.md'), page('Not listed.\n'));
    const { files: rendered, problems } = await renderSite({ spec, runtime, site: dir });
    const shown = problems.map(String);
    const expect = [
      'guides/ship: frontmatter: frontmatter has no available_in',
      'guides/audit: link: line ',
      'guides/agents: command: line ',
      'index: source: unknown token {{VERSION}}',
      'reference/cli: source: docs/site/reference/cli.md duplicates a generated page; delete the hand-written copy',
      'guides/extra: source: docs/site/guides/extra.md is not in sdk/docs/pages.json',
    ];
    for (const prefix of expect) assert.ok(shown.some((s) => s.startsWith(prefix)), `${prefix}\n${shown.join('\n')}`);
    assert.ok(shown.some((s) => s.includes('prism run has no flag --sandbox')));
    assert.ok(!rendered.has('llms.txt'), 'the site index is not written from a broken site');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
