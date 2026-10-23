/**
 * Render every page into a map of relative path to text. `generate.mjs`
 * writes or checks the map; tests call this directly.
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

export const EXAMPLES = ['load', 'dispatch', 'acceptance', 'three-calls', 'spec-constants'];

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

/** @returns {Promise<Map<string, string>>} relative output path to file text, LF only */
export async function render({ spec, runtime, pages = readPages(), cli = readCli() } = {}) {
  spec ??= await loadSpec();
  runtime ??= prismCode();
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  const examples = Object.fromEntries(EXAMPLES.map((name) => [name, runExample(name, { map, cwd: FIXTURE_DIR })]));

  const all = pages.groups.flatMap((g) => g.pages);
  const byPath = new Map(all.map((p) => [p.path, p]));
  const rendered = new Map();
  for (const page of all) {
    const generate = GENERATORS[page.id];
    if (!generate) throw new Error(`no generator for page ${page.id}`);
    const { parts, sources } = generate({ spec, runtime, cli, page, examples });
    const text = assemble([frontmatter(page.title, page.description), ...parts, ...nextSteps(page, byPath), footer(sources)]);
    rendered.set(page.path, text);
  }

  const out = new Map();
  for (const [path, text] of rendered) out.set(`${path}.md`, text);
  out.set('llms.txt', llmsTxt(pages, rendered));
  out.set('llms-full.md', llmsFull(pages, rendered));
  return out;
}
