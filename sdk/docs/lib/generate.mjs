/**
 * Render every page into a map of relative path to text. `generate.mjs`
 * writes or verifies the map; tests call this directly.
 *
 * Two kinds of page share one page list (`pages.json`) and one contract:
 * generated pages, rendered here from the sources, and narrative pages,
 * written by hand under docs/site and filled in here. Every page, of either
 * kind, must carry `title`, `description` and an `available_in` that names a
 * release in docs/site/release-status.json, link only to pages of the site,
 * and use only CLI verbs and flags the CLI description has.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExample } from './examples.mjs';
import { bullets, footer, frontmatter, heading, page as assemble } from './markdown.mjs';
import * as api from './pages/api.mjs';
import { cli as cliPage } from './pages/cli.mjs';
import { llmsFull, llmsTxt } from './pages/llms.mjs';
import * as reference from './pages/reference.mjs';
import { FIXTURE_DIR, prismCode } from './runtime.mjs';
import {
  RELEASES_FILE,
  SITE_DIR,
  SITE_SUBDIR,
  changelogProblems,
  commandProblems,
  fill,
  frontmatterProblems,
  linkProblems,
  listNarrative,
  parseFrontmatter,
  readReleases,
  sitePath,
} from './site.mjs';
import { lintText } from '../lint.mjs';
import { DOCS_DIR, loadSpec } from './spec.mjs';

const GENERATORS = {
  'holo-format': reference.holoFormat,
  attestations: reference.attestations,
  manifest: reference.manifest,
  lockfile: reference.lockfile,
  errors: reference.errors,
  cli: cliPage,
  'api-index': api.apiIndex,
  load: api.load,
  inspect: api.inspect,
  verify: api.verify,
  instantiate: api.instantiate,
  dispatch: api.dispatch,
  'history-and-replay': api.historyAndReplay,
  'as-tool': api.asTool,
  'api-errors': api.apiErrors,
  'spec-package': api.specPackage,
  'verify-package': api.missingPackage,
  'testing-package': api.missingPackage,
};

export const EXAMPLES = ['load', 'dispatch', 'acceptance', 'three-calls', 'spec-constants', 'verify'];

export function readPages() {
  return JSON.parse(readFileSync(join(DOCS_DIR, 'pages.json'), 'utf8'));
}

export function readCli() {
  return JSON.parse(readFileSync(join(DOCS_DIR, 'cli.json'), 'utf8'));
}

function nextSteps(page, byPath) {
  const items = page.next.map((path) => {
    const target = byPath.get(path);
    if (!target) throw new Error(`${page.path}: next step ${path} is not in the page list`);
    if (!target.title) throw new Error(`${page.path}: next step ${path} has no title`);
    return `[${target.title}](/docs/${sitePath(path)})`;
  });
  return [heading(2, 'Next steps'), bullets(items)];
}

/** What went wrong on one page, named by the page. */
export class PageProblem {
  /**
   * @param {string} page the page path, such as `api/load`
   * @param {'example' | 'generation' | 'lint' | 'source' | 'frontmatter' | 'link' | 'command'} kind
   * @param {string} message
   */
  constructor(page, kind, message) {
    this.page = page;
    this.kind = kind;
    this.message = message;
  }

  toString() {
    return `${this.page}: ${this.kind}: ${this.message}`;
  }
}

class ExampleFailure extends Error {}

/**
 * Run the examples, then render every page, collecting each failure under the
 * page it breaks instead of stopping at the first. An example that fails to run
 * fails only the pages that show it.
 * @param {{ spec?: object, runtime?: object, pages?: object, cli?: object, site?: string }} [options] `site` is the narrative directory, docs/site by default
 * @returns {Promise<{ files: Map<string, string>, problems: PageProblem[] }>} relative output path to file text, LF only
 */
export async function renderSite({ spec, runtime, pages = readPages(), cli = readCli(), site = SITE_DIR } = {}) {
  spec ??= await loadSpec();
  runtime ??= prismCode();
  const releases = readReleases(site);
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  const examples = {};
  for (const name of EXAMPLES) {
    try {
      examples[name] = runExample(name, { map, cwd: FIXTURE_DIR });
    } catch (error) {
      Object.defineProperty(examples, name, {
        enumerable: true,
        get() {
          throw new ExampleFailure(error.message);
        },
      });
    }
  }

  // Copies, because a narrative page's title, description and release come from its file.
  const entries = pages.groups.flatMap((g) => g.pages.map((p) => ({ ...p })));
  const byPath = new Map();
  const problems = [];
  for (const entry of entries) {
    if (byPath.has(entry.path)) problems.push(new PageProblem(entry.path, 'source', 'listed twice in sdk/docs/pages.json'));
    byPath.set(entry.path, entry);
  }
  for (const path of listNarrative(site)) {
    const entry = byPath.get(path);
    if (entry?.narrative) continue;
    const message = entry
      ? `${SITE_SUBDIR}/${path}.md duplicates a generated page; delete the hand-written copy`
      : `${SITE_SUBDIR}/${path}.md is not in sdk/docs/pages.json`;
    problems.push(new PageProblem(path, 'source', message));
  }

  const rendered = new Map();
  const fail = (entry, error, kind) => problems.push(new PageProblem(entry.path, error instanceof ExampleFailure ? 'example' : kind, error.message));
  // Narrative pages first: their titles feed the next steps of generated pages.
  for (const entry of entries.filter((e) => e.narrative)) {
    try {
      const file = join(site, `${entry.path}.md`);
      if (!existsSync(file)) throw new Error(`${SITE_SUBDIR}/${entry.path}.md does not exist`);
      const text = `${fill(readFileSync(file, 'utf8'), { spec, examples, releases }).replace(/\n+$/, '')}\n`;
      const data = parseFrontmatter(text) ?? {};
      Object.assign(entry, { title: data.title, description: data.description, available_in: data.available_in });
      rendered.set(entry.path, text);
    } catch (error) {
      fail(entry, error, 'source');
    }
  }
  for (const entry of entries.filter((e) => !e.narrative)) {
    try {
      const generate = GENERATORS[entry.id];
      if (!generate) throw new Error(`no generator for page ${entry.id}`);
      const { parts, sources } = generate({ spec, runtime, cli, page: entry, examples });
      rendered.set(entry.path, assemble([frontmatter(entry.title, entry.description, entry.available_in), ...parts, ...nextSteps(entry, byPath), footer(sources)]));
    } catch (error) {
      fail(entry, error, 'generation');
    }
  }

  const known = new Set([...entries.map((e) => sitePath(e.path)), 'llms.txt', 'llms-full.md']);
  for (const [path, text] of rendered) {
    for (const message of frontmatterProblems(text, releases)) problems.push(new PageProblem(path, 'frontmatter', message));
    for (const message of linkProblems(text, known)) problems.push(new PageProblem(path, 'link', message));
    for (const message of commandProblems(text, cli)) problems.push(new PageProblem(path, 'command', message));
    if (path === 'changelog') for (const message of changelogProblems(text, releases)) problems.push(new PageProblem(path, 'source', message));
  }

  const files = new Map();
  for (const entry of entries) if (rendered.has(entry.path)) files.set(`${entry.path}.md`, rendered.get(entry.path));
  files.set(RELEASES_FILE, releases.text);
  if (problems.length === 0) {
    const listed = { ...pages, groups: pages.groups.map((g) => ({ ...g, pages: g.pages.map((p) => byPath.get(p.path)) })) };
    files.set('llms.txt', llmsTxt(listed, rendered));
    files.set('llms-full.md', llmsFull(listed, rendered));
  }
  return { files, problems };
}

/** The vocabulary lint over generated Markdown and text files: a problem per hit, named by the page. */
export function lintFiles(files) {
  const problems = [];
  for (const [path, text] of files) {
    if (!/\.(md|txt)$/.test(path)) continue;
    for (const hit of lintText(text, path)) problems.push(new PageProblem(path.replace(/\.(md|txt)$/, ''), 'lint', `line ${hit.line}, ${hit.word}: ${hit.text.trim()}`));
  }
  return problems;
}

/** Render every page; throws, naming each page that failed. @returns {Promise<Map<string, string>>} */
export async function render(options) {
  const { files, problems } = await renderSite(options);
  if (problems.length > 0) throw new Error(problems.map(String).join('\n'));
  return files;
}
