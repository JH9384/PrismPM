import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCli, readPages, render } from '../lib/generate.mjs';
import { docsJson, mintlifyPage, navigationProblems, releaseNote, treePath, treeProblems } from '../lib/mintlify.mjs';
import { prismCode } from '../lib/runtime.mjs';
import { readReleases } from '../lib/site.mjs';
import { lintText } from '../lint.mjs';
import { coverage, exportedValues, readScripts } from '../coverage.mjs';

const runtime = prismCode();
const files = await render({ runtime });
const pages = readPages();
const releases = readReleases();
const tree = new Map([...files].filter(([path]) => path.startsWith('mintlify/')));
const page = (availableIn, body) => `---\ntitle: T\ndescription: D.\navailable_in: "${availableIn}"\n---\n${body}`;

test('the tree holds every page, docs.json and both indexes, and nothing it refuses', () => {
  for (const group of pages.groups) {
    for (const entry of group.pages) assert.ok(tree.has(`mintlify/${treePath(entry.path)}.md`), entry.path);
  }
  for (const name of ['docs.json', 'llms.txt', 'llms-full.txt']) assert.ok(tree.has(`mintlify/${name}`), name);
  assert.ok(!tree.has('mintlify/llms-full.md'), 'Mintlify reads the full index only as llms-full.txt');
  assert.ok(!tree.has('mintlify/changelog.md'), 'Mintlify skips a file with this name');
  assert.deepEqual(treeProblems(tree), []);
});

test('docs.json has the three tabs, and the seven groups with API Reference and SDKs nested', () => {
  const docs = docsJson(pages);
  assert.equal(docs.$schema, 'https://mintlify.com/docs.json');
  assert.deepEqual(docs.navigation.versions.map((v) => v.version), ['v1']);
  const { tabs } = docs.navigation.versions[0];
  assert.deepEqual(tabs.map((t) => t.tab), ['Docs', 'Reference', 'Changelog']);
  const groups = tabs.flatMap((t) => t.groups.map((g) => g.group));
  assert.deepEqual(groups, ['Get started', 'Concepts', 'Guides', 'Examples', 'Reference', 'Changelog', 'Migration']);
  const reference = tabs[1].groups[0].pages.filter((p) => typeof p === 'object').map((p) => p.group);
  assert.deepEqual(reference, ['API Reference', 'SDKs']);
  assert.deepEqual(docs.redirects.at(-1), { source: '/docs/:slug*', destination: '/:slug*' });
});

test('a group in no tab, a group in two tabs and a version that is not a major are all refused', () => {
  assert.deepEqual(navigationProblems(pages), []);
  const withTabs = (tabs) => ({ ...pages, mintlify: { ...pages.mintlify, tabs } });
  const dropped = pages.mintlify.tabs.map((t) => ({ ...t, groups: t.groups.filter((g) => g.group !== 'Examples') }));
  assert.match(navigationProblems(withTabs(dropped)).join('\n'), /group Examples is in 0 tabs/);
  const doubled = pages.mintlify.tabs.map((t) => ({ ...t, groups: [...t.groups, { group: 'Examples' }] }));
  assert.match(navigationProblems(withTabs(doubled)).join('\n'), /group Examples is in 4 tabs/);
  for (const version of ['v1.1', '1', 'latest', 'v0']) {
    assert.match(navigationProblems({ ...pages, versions: [version] }).join('\n'), /one version per major/, version);
  }
  assert.match(navigationProblems({ ...pages, versions: [] }).join('\n'), /lists no version/);
});

test('a page loses its comments and /docs prefix, and code keeps both', () => {
  const body = [
    '<!-- generated:x:begin -->',
    'See [a](/docs/guides/ship#top), [b](/docs), [c](/docs/) and [d](https://example.com/docs/x).',
    '```md',
    '<!-- kept -->',
    '[e](/docs/kept)',
    '```',
    '<!-- generated:x:end -->',
  ].join('\n');
  const text = mintlifyPage(page('0.2.0', body), releases);
  assert.ok(text.includes('See [a](/guides/ship#top), [b](/), [c](/) and [d](https://example.com/docs/x).'));
  assert.ok(text.includes('<!-- kept -->\n[e](/docs/kept)'));
  assert.ok(!text.includes('generated:x'));
  assert.ok(!text.includes('<Note>'), 'a shipped release needs no note');
});

test('a page that needs an unshipped release says so, and the note follows the release list', () => {
  const list = { releases: [{ id: '0.5', title: '0.5.0', status: 'planned' }, { id: '0.2.0', title: '0.2.0', status: 'shipped' }] };
  const note = releaseNote('0.5', list);
  assert.match(note, /Prism 0\.5\.0, which has not shipped/);
  assert.equal(releaseNote('0.2.0', list), null);
  assert.ok(mintlifyPage(page('0.5', 'Body.\n'), list).startsWith(`---\ntitle: T\ndescription: D.\navailable_in: "0.5"\n---\n\n${note}\n\nBody.`));
  assert.deepEqual(lintText(note, 'note'), [], 'the note obeys the vocabulary lint');
  const shipped = pages.groups.flatMap((g) => g.pages).find((p) => p.path === 'get-started/quickstart');
  assert.ok(tree.get(`mintlify/${shipped.path}.md`).includes('<Note>'), 'the quickstart needs an unshipped release');
});

test('a tree that breaks a rule is named by the page', () => {
  const broken = new Map(tree);
  broken.set('mintlify/guides/ship.md', 'See [a](/docs/guides/audit).\n<!-- left -->\n');
  broken.set('mintlify/guides/extra.md', 'Not listed.\n');
  broken.delete('mintlify/guides/audit.md');
  const shown = treeProblems(broken).map((p) => `${p.page}: ${p.message}`);
  assert.ok(shown.some((s) => s.startsWith('guides/ship: keeps a /docs link')), shown.join('\n'));
  assert.ok(shown.some((s) => s.startsWith('guides/ship: keeps an HTML comment')), shown.join('\n'));
  assert.ok(shown.includes('guides/extra: has a file and is not in docs.json'), shown.join('\n'));
  assert.ok(shown.includes('guides/audit: is in docs.json and has no file'), shown.join('\n'));
});

test('command-line examples run, and their output is captured', () => {
  const text = files.get('examples/command-line.md');
  assert.ok(text.includes('```bash\nprism-code vectors Calculator.holo\nprism-code inspect Calculator.holo\n```'));
  assert.ok(text.includes('22 of 22 vectors passed'));
  assert.ok(text.includes('Name:      Calculator'));
});

test('coverage names every public item and tells executed examples from shown ones', () => {
  const cli = readCli();
  const items = coverage(files, cli, runtime.types, readScripts());
  const named = (name) => items.find((i) => i.name === name);
  assert.equal(items.filter((i) => i.kind === 'planned verb').length, cli.verbs.length);
  assert.equal(items.filter((i) => i.kind === 'shipped verb').length, cli.prismCode.verbs.length);
  assert.equal(named('prism-code vectors').example, 'executed');
  assert.equal(named('prism build').example, 'shown');
  assert.equal(named('load').example, 'executed');
  assert.ok(items.filter((i) => i.kind !== 'runtime export').every((i) => i.reference), 'every verb is on the CLI page');
  assert.deepEqual(exportedValues('export function a(): void;\nexport class B {}\nexport const C: 1;\nexport interface D {}\nexport type E = 1;\n'), ['a', 'B', 'C']);
});
