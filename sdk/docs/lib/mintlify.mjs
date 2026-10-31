/**
 * The site as Mintlify reads it: `mintlify/docs.json` and every page, derived
 * from the rendered pages so nothing here is a second source. A page changes in
 * three ways only. HTML comments outside code go, because they are a parse error
 * in Mintlify's MDX. Links lose the `/docs` prefix the other host serves them
 * under. A page that needs a release that has not shipped says so, because
 * Mintlify does not show `available_in`.
 */
import { parseFrontmatter, sitePath } from './site.mjs';

export const TREE = 'mintlify';

/** One version per major: `v1`, `v2`. A minor cannot gain a version. */
export const MAJOR = /^v[1-9][0-9]*$/;

/** Mintlify skips a file named changelog.md, so that page is an index. Its URL does not change. */
export const treePath = (path) => (path === 'changelog' ? 'changelog/index' : path);

/** Apply `change` to every line outside a fenced code block. */
function outsideFences(text, change) {
  let inFence = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return line;
      }
      return inFence ? line : change(line);
    })
    .join('\n');
}

const dropComments = (line) => line.replace(/<!--.*?-->/g, '');

/** `/docs/guides/ship#x` to `/guides/ship#x`, and `/docs` itself to `/`. */
const rootLinks = (line) => line.replace(/\]\(\/docs(\/[^)\s]*)?\)/g, (_, rest) => `](${rest && rest !== '/' ? rest : '/'})`);

/** The note a page carries while the release it needs has not shipped, or null. */
export function releaseNote(availableIn, releases) {
  const release = releases.releases.find((r) => r.id === availableIn);
  if (!release || release.status === 'shipped') return null;
  return `<Note>This page describes Prism ${release.title}, which has not shipped. [Release status](/reference/release-status) says what works today.</Note>`;
}

/** One rendered page as Mintlify takes it. */
export function mintlifyPage(text, releases) {
  const body = outsideFences(text, (line) => rootLinks(dropComments(line))).replace(/\n{3,}/g, '\n\n');
  const note = releaseNote(parseFrontmatter(text)?.available_in, releases);
  return note ? body.replace(/^(---\n[\s\S]*?\n---\n)/, `$1\n${note}\n\n`) : body;
}

/** A pages.json group as a docs.json group, with `nest` groups inside it. */
function navGroup({ group, nest = [] }, byTitle) {
  const paths = (title) => {
    const source = byTitle.get(title);
    if (!source) throw new Error(`the mintlify table names group ${title}, which is not in sdk/docs/pages.json`);
    return source.pages.map((p) => treePath(p.path));
  };
  return { group, pages: [...paths(group), ...nest.map((title) => ({ group: title, pages: paths(title) }))] };
}

/** Every pages.json group must sit in exactly one tab. @returns {string[]} problems */
export function navigationProblems(pages) {
  const problems = [];
  for (const version of pages.versions ?? []) {
    if (!MAJOR.test(version)) problems.push(`version ${version} is not a major: the site has one version per major, spelled v<N>`);
  }
  if (!pages.versions?.length) problems.push('pages.json lists no version');
  const placed = (pages.mintlify?.tabs ?? []).flatMap((tab) => tab.groups.flatMap((g) => [g.group, ...(g.nest ?? [])]));
  for (const group of pages.groups) {
    const count = placed.filter((title) => title === group.title).length;
    if (count !== 1) problems.push(`group ${group.title} is in ${count} tabs of the mintlify table, and must be in one`);
  }
  return problems;
}

/** docs.json from pages.json. */
export function docsJson(pages) {
  const byTitle = new Map(pages.groups.map((g) => [g.title, g]));
  const tabs = pages.mintlify.tabs.map((tab) => ({ tab: tab.tab, groups: tab.groups.map((g) => navGroup(g, byTitle)) }));
  return {
    $schema: 'https://mintlify.com/docs.json',
    theme: pages.mintlify.theme,
    name: pages.name,
    description: pages.summary,
    colors: pages.mintlify.colors,
    navigation: { versions: pages.versions.map((version) => ({ version, tabs })) },
    redirects: [
      { source: '/docs', destination: '/' },
      { source: '/docs/:slug*', destination: '/:slug*' },
    ],
  };
}

/**
 * The whole tree, as relative path to text, from the rendered site.
 * @param {Map<string, string>} files the rendered site
 */
export function mintlifyFiles(files, pages, releases) {
  const tree = new Map([[`${TREE}/docs.json`, `${JSON.stringify(docsJson(pages), null, 2)}\n`]]);
  for (const group of pages.groups) {
    for (const page of group.pages) tree.set(`${TREE}/${treePath(page.path)}.md`, mintlifyPage(files.get(`${page.path}.md`), releases));
  }
  tree.set(`${TREE}/llms.txt`, files.get('llms.txt'));
  // Mintlify takes a custom full index only under this name.
  tree.set(`${TREE}/llms-full.txt`, files.get('llms-full.md'));
  return tree;
}

/** What only this tree can get wrong, with no dependency on Mintlify. @returns {{ page: string, message: string }[]} */
export function treeProblems(tree) {
  const problems = [];
  const docs = JSON.parse(tree.get(`${TREE}/docs.json`));
  const listed = new Set();
  const walk = (entry) => (typeof entry === 'string' ? listed.add(entry) : entry.pages.forEach(walk));
  for (const version of docs.navigation.versions) for (const tab of version.tabs) tab.groups.forEach(walk);
  for (const path of listed) if (!tree.has(`${TREE}/${path}.md`)) problems.push({ page: path, message: 'is in docs.json and has no file' });
  for (const [file, text] of tree) {
    if (!file.endsWith('.md')) continue;
    const path = file.slice(TREE.length + 1, -3);
    if (!listed.has(path)) problems.push({ page: path, message: 'has a file and is not in docs.json' });
    outsideFences(text, (line) => {
      if (/<!--/.test(line)) problems.push({ page: path, message: `keeps an HTML comment: ${line.trim()}` });
      if (/\]\(\/docs[/)#]/.test(line)) problems.push({ page: path, message: `keeps a /docs link: ${line.trim()}` });
      return line;
    });
  }
  return problems;
}

export { sitePath };
