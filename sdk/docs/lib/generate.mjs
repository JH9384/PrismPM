/**
 * Render every page into a map of relative path to text. `generate.mjs`
 * writes or verifies the map; tests call this directly.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { runExample } from './examples.mjs';
import { bullets, footer, frontmatter, heading, page as assemble } from './markdown.mjs';
import * as api from './pages/api.mjs';
import { cli as cliPage } from './pages/cli.mjs';
import { llmsFull, llmsTxt, sitePath } from './pages/llms.mjs';
import * as reference from './pages/reference.mjs';
import { FIXTURE_DIR, prismCode } from './runtime.mjs';
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
    return `[${target.title}](/docs/${sitePath(path)})`;
  });
  return [heading(2, 'Next steps'), bullets(items)];
}

/** What went wrong on one page, named by the page. */
export class PageProblem {
  /** @param {string} page the page path, such as `api/load` @param {'example' | 'generation' | 'lint'} kind @param {string} message */
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
 * @returns {Promise<{ files: Map<string, string>, problems: PageProblem[] }>} relative output path to file text, LF only
 */
export async function renderSite({ spec, runtime, pages = readPages(), cli = readCli() } = {}) {
  spec ??= await loadSpec();
  runtime ??= prismCode();
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

  const all = pages.groups.flatMap((g) => g.pages);
  const byPath = new Map(all.map((p) => [p.path, p]));
  const rendered = new Map();
  const problems = [];
  for (const page of all) {
    try {
      const generate = GENERATORS[page.id];
      if (!generate) throw new Error(`no generator for page ${page.id}`);
      const { parts, sources } = generate({ spec, runtime, cli, page, examples });
      rendered.set(page.path, assemble([frontmatter(page.title, page.description), ...parts, ...nextSteps(page, byPath), footer(sources)]));
    } catch (error) {
      problems.push(new PageProblem(page.path, error instanceof ExampleFailure ? 'example' : 'generation', error.message));
    }
  }

  const files = new Map();
  for (const [path, text] of rendered) files.set(`${path}.md`, text);
  if (problems.length === 0) {
    files.set('llms.txt', llmsTxt(pages, rendered));
    files.set('llms-full.md', llmsFull(pages, rendered));
  }
  return { files, problems };
}

/** The vocabulary lint over generated files: a problem per hit, named by the page. */
export function lintFiles(files) {
  const problems = [];
  for (const [path, text] of files) {
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
