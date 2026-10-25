/**
 * The hand-written half of the site: the narrative pages under docs/site, the
 * release list every page's `available_in` must name, and the checks that hold
 * narrative and generated pages to one contract: frontmatter, links, CLI
 * commands, and the published layout.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fence, table } from './markdown.mjs';
import { ROOT } from './spec.mjs';

export const SITE_SUBDIR = 'docs/site';
export const SITE_DIR = join(ROOT, SITE_SUBDIR);
export const RELEASES_FILE = 'release-status.json';

/** The frontmatter keys every page carries, in order. Nothing else is allowed. */
export const FRONTMATTER_KEYS = ['title', 'description', 'available_in'];

/** The top level of the published site: exactly these entries, nothing else. */
export const LAYOUT = ['api', 'changelog.md', 'get-started', 'guides', 'index.md', 'llms-full.md', 'llms.txt', 'reference', RELEASES_FILE, 'sdks'];

/** Read and check the release list. @returns {{ releases: object[], distribution: object[], features: object[], ids: Set<string> }} */
export function readReleases(dir = SITE_DIR) {
  const file = join(dir, RELEASES_FILE);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  const where = `${SITE_SUBDIR}/${RELEASES_FILE}`;
  if (!Array.isArray(data.releases) || data.releases.length === 0) throw new Error(`${where}: releases must be a non-empty list`);
  const ids = new Set();
  for (const release of data.releases) {
    for (const key of ['id', 'title', 'status', 'summary']) {
      if (typeof release[key] !== 'string' || release[key] === '') throw new Error(`${where}: release ${release.id ?? '?'} has no ${key}`);
    }
    if (!['shipped', 'planned'].includes(release.status)) throw new Error(`${where}: release ${release.id} status must be shipped or planned`);
    if (release.status === 'shipped' && !/^\d{4}-\d{2}-\d{2}$/.test(release.date ?? '')) throw new Error(`${where}: shipped release ${release.id} needs a date`);
    if (ids.has(release.id)) throw new Error(`${where}: release ${release.id} is listed twice`);
    ids.add(release.id);
  }
  for (const feature of data.features ?? []) {
    if (!ids.has(feature.available_in)) throw new Error(`${where}: feature "${feature.feature}" names unknown release ${feature.available_in}`);
  }
  return { releases: data.releases, distribution: data.distribution ?? [], features: data.features ?? [], ids, text: readFileSync(file, 'utf8').replace(/\r\n/g, '\n') };
}

/** Parse `---` frontmatter of `key: value` lines; quoted values are unquoted. */
export function parseFrontmatter(text) {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(text.replace(/\r\n/g, '\n'));
  if (!match) return null;
  const data = {};
  for (const line of match[1].split('\n')) {
    const pair = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (!pair) throw new Error(`frontmatter line is not "key: value": ${line}`);
    data[pair[1]] = pair[2].replace(/^"(.*)"$/, '$1');
  }
  return data;
}

/** Every frontmatter problem of one page, as messages. */
export function frontmatterProblems(text, releases) {
  let data;
  try {
    data = parseFrontmatter(text);
  } catch (error) {
    return [error.message];
  }
  if (!data) return ['no frontmatter: the page must start with --- and title, description, available_in'];
  const problems = [];
  for (const key of FRONTMATTER_KEYS) if (!data[key]) problems.push(`frontmatter has no ${key}`);
  for (const key of Object.keys(data)) if (!FRONTMATTER_KEYS.includes(key)) problems.push(`frontmatter key ${key} is not one of ${FRONTMATTER_KEYS.join(', ')}`);
  if (data.available_in && !releases.ids.has(data.available_in)) {
    problems.push(`available_in ${data.available_in} is not a release in ${SITE_SUBDIR}/${RELEASES_FILE} (${[...releases.ids].join(', ')})`);
  }
  return problems;
}

/** Every Markdown file under the site directory, as page paths without `.md`. */
export function listNarrative(dir = SITE_DIR) {
  const out = [];
  const walk = (at) => {
    for (const entry of readdirSync(at).sort()) {
      const full = join(at, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith('.md')) out.push(relative(dir, full).split(sep).join('/').replace(/\.md$/, ''));
    }
  };
  if (existsSync(dir)) walk(dir);
  return out;
}

const TOKEN = /\{\{([^{}]+)\}\}/g;

/**
 * Fill a narrative page: `{{FORMAT_REVISION}}` from the spec, `{{example:<name>}}`
 * with an executed example and its output, and the release-status markers from
 * the release list. An unknown token is an error, so a typo cannot ship.
 */
export function fill(text, { spec, examples, releases }) {
  let out = text.replace(/\r\n/g, '\n').replace(TOKEN, (_, token) => {
    if (token === 'FORMAT_REVISION') return spec.module.FORMAT_REVISION;
    const example = /^example:([a-z0-9-]+)$/.exec(token);
    if (example) {
      if (!Object.hasOwn(examples, example[1])) throw new Error(`unknown example ${example[1]}`);
      const run = examples[example[1]];
      return `${fence('js', run.source)}\n${fence('text', run.output)}`.replace(/\n$/, '');
    }
    throw new Error(`unknown token {{${token}}}`);
  });
  for (const [name, render] of Object.entries(RELEASE_REGIONS)) {
    out = out.replace(`<!-- generated:${name} -->`, `<!-- generated:${name}:begin -->\n${render(releases)}<!-- generated:${name}:end -->`);
  }
  return out;
}

const RELEASE_REGIONS = {
  distribution: (r) => table(['What', 'Today', 'Note'], r.distribution.map((d) => [d.name, d.value, d.note ?? ''])),
  releases: (r) =>
    table(
      ['Release', 'Status', 'What it brings'],
      r.releases.map((x) => [x.title, x.status === 'shipped' ? `shipped ${x.date}` : 'planned', x.summary]),
    ),
  features: (r) => table(['Feature', 'Available in'], r.features.map((f) => [f.feature, r.releases.find((x) => x.id === f.available_in).title])),
};

/** The site path of a page: `api/index` is served at `api`, the root `index` at the site root. */
export function sitePath(path) {
  return path === 'index' ? '' : path.replace(/\/index$/, '');
}

/** Lines outside fenced code blocks, with their line numbers. */
function proseLines(text) {
  const out = [];
  let inFence = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    else if (!inFence) out.push([index + 1, line.replace(/`[^`]*`/g, ' ')]);
  });
  return out;
}

/**
 * Every link that starts with `/` must be a page of the site: `/docs/<site path>`,
 * optionally with a `#fragment`. A relative link is refused, because the site
 * serves pages at paths the source tree does not have.
 */
export function linkProblems(text, knownSitePaths) {
  const problems = [];
  for (const [line, prose] of proseLines(text)) {
    for (const match of prose.matchAll(/\]\(([^)\s]+)\)/g)) {
      const href = match[1];
      if (/^[a-z]+:/i.test(href) || href.startsWith('#')) continue;
      const path = href.split('#')[0];
      const target = /^\/docs(\/.*)?$/.exec(path);
      if (!target) {
        problems.push(`line ${line}: link ${href} is not a /docs/ path`);
        continue;
      }
      const page = (target[1] ?? '').replace(/^\/|\/$/g, '').replace(/\.md$/, '');
      if (!knownSitePaths.has(page)) problems.push(`line ${line}: link ${href} names no page`);
    }
  }
  return problems;
}

/** A flag as cli.json spells it, reduced to its name: `--policy <file>` and `--provenance=<min|max>` to `--policy`, `--provenance`. */
const flagName = (flag) => flag.split(/[\s=]/)[0];

/**
 * Every `prism <verb> ...` line in a `bash` block must use a verb the CLI
 * description has, and only that verb's flags or the global ones.
 */
export function commandProblems(text, cli) {
  const verbs = new Map(cli.verbs.map((v) => [v.name, new Set((v.flags ?? []).map((f) => flagName(f.flag)))]));
  const global = new Set(cli.globalFlags.map((f) => flagName(f.flag)));
  const problems = [];
  let fenceLanguage = null;
  text.split('\n').forEach((line, index) => {
    const open = /^\s*```(\S*)/.exec(line);
    if (open) {
      fenceLanguage = fenceLanguage === null ? open[1] : null;
      return;
    }
    if (fenceLanguage !== 'bash') return;
    for (const segment of line.split(/\||&&|;/)) {
      const command = /^\s*(?:prism|prismpm)\s+(\S+)(.*)$/.exec(segment);
      if (!command) continue;
      const [, verb, rest] = command;
      if (verb.startsWith('-')) continue;
      if (!verbs.has(verb)) {
        problems.push(`line ${index + 1}: prism ${verb} is not a verb in sdk/docs/cli.json`);
        continue;
      }
      const words = rest.replace(/'[^']*'|"[^"]*"/g, ' ').split(/\s+/);
      for (const word of words.filter((w) => w.startsWith('--'))) {
        const name = flagName(word);
        if (verbs.get(verb).has(name) || global.has(name) || name.startsWith('--unstable-')) continue;
        problems.push(`line ${index + 1}: prism ${verb} has no flag ${name} in sdk/docs/cli.json`);
      }
    }
  });
  return problems;
}

/** The changelog's release headings must be release titles from the release list. */
export function changelogProblems(text, releases) {
  const titles = new Set(releases.releases.map((r) => r.title));
  const headings = [...text.matchAll(/^## (.+)$/gm)].map((m) => m[1]).filter((h) => h !== 'Next steps');
  const problems = headings.filter((h) => !titles.has(h)).map((h) => `changelog heading ${h} is not a release title in ${SITE_SUBDIR}/${RELEASES_FILE}`);
  for (const release of releases.releases) {
    if (!headings.includes(release.title)) problems.push(`changelog has no entry for release ${release.title}`);
  }
  return problems;
}

/** The top-level entries of a built site that are not the contract's, or missing from it. */
export function layoutProblems(entries) {
  const have = new Set(entries);
  return [
    ...LAYOUT.filter((e) => !have.has(e)).map((e) => `missing ${e}`),
    ...[...have].filter((e) => !LAYOUT.includes(e)).map((e) => `unexpected ${e}`),
  ];
}
