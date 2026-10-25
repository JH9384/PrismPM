/**
 * The Agent Skill for Prism, `skills/prism/SKILL.md`.
 *
 * The skill is hand-written prose around four generated blocks: the command
 * table (from `prismCode` in cli.json), the executed three-call example, the
 * commands to try on the sample holo, and the docs links (from pages.json).
 * Each block sits between `<!-- generated:<name>:begin -->` and `:end`
 * markers, which `skill.mjs` rewrites and `skill.mjs --check` verifies.
 *
 * The skill is held to the same rules as a docs page. It names only
 * `prism-code` verbs and flags the CLI description lists, names no `prism`
 * verb (that command has not shipped), points only at pages of the site, has
 * valid Agent Skill frontmatter, and passes the vocabulary lint.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { lintText } from '../lint.mjs';
import { runExample } from './examples.mjs';
import { code, fence, table } from './markdown.mjs';
import { FIXTURE_DIR, prismCode } from './runtime.mjs';
import { shippedCommandProblem, sitePath } from './site.mjs';
import { ROOT } from './spec.mjs';

export const SKILL_NAME = 'prism';
export const SKILL_FILE = 'skills/prism/SKILL.md';
export const SKILL_PATH = join(ROOT, ...SKILL_FILE.split('/'));

/** Where the sample holo is once `npm install prism-code` has run. */
const SAMPLE = 'node_modules/prism-code/fixtures/Calculator.holo';

/** The commands the skill tells an agent to try. `skill.mjs smoke` runs exactly these. */
export const TRY_IT = [
  { command: 'npx prism-code --version', note: 'print the installed version' },
  { command: `npx prism-code inspect ${SAMPLE}`, note: 'print what the holo says about itself, without running it' },
  { command: `npx prism-code vectors ${SAMPLE}`, note: 'replay its acceptance vectors; exit 0 means every one passed' },
];

/** The pages the skill points at, and what each answers. Every path must be in pages.json. */
export const DOC_PAGES = [
  { path: 'reference/cli', what: 'every command, flag and exit code' },
  { path: 'reference/release-status', what: 'what has shipped and what is planned' },
  { path: 'guides/verify-and-inspect', what: 'check and inspect a holo' },
  { path: 'guides/agents', what: 'agents and holos' },
  { path: 'reference/holo-format', what: 'the byte layout of a holo' },
];

export const BLOCKS = ['commands', 'example', 'try', 'docs'];

const marker = (name, edge) => `<!-- generated:${name}:${edge} -->`;

/** @returns {Record<string, string>} each block's text, without its markers */
export function skillBlocks({ cli, pages, exampleRun }) {
  const shipped = cli.prismCode;
  const commands = [
    table(
      ['Command', 'What it does'],
      shipped.verbs.map((v) => [code(v.usage), v.summary]),
    ),
    '',
    table(
      ['Exit code', 'Name', 'Meaning'],
      shipped.exitCodes.map((e) => [e.code, e.name, e.meaning]),
    ),
    '',
    shipped.needs,
    '',
  ]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n');

  const example = `${fence('js', exampleRun.source)}\n${fence('text', exampleRun.output)}`;

  const tryIt = fence('bash', TRY_IT.map((t) => `${t.command}   # ${t.note}`).join('\n'));

  const site = pages.site;
  const links = [
    `- ${site}/llms.txt: the index of every page, written for agents`,
    `- ${site}/llms-full.md: every page in one file`,
    ...DOC_PAGES.map((p) => `- ${site}/${sitePath(p.path)}: ${p.what}`),
    `- Append \`.md\` to any page URL to get that page as Markdown.`,
  ];
  return { commands, example, try: tryIt, docs: `${links.join('\n')}\n` };
}

/** Replace the text between each pair of markers. Throws when a marker is missing or repeated. */
export function fillSkill(text, blocks) {
  let out = text;
  for (const name of BLOCKS) {
    const begin = marker(name, 'begin');
    const end = marker(name, 'end');
    const start = out.indexOf(begin);
    const stop = out.indexOf(end);
    if (start < 0 || stop < 0 || stop < start || out.indexOf(begin, start + 1) >= 0) {
      throw new Error(`${SKILL_FILE} needs exactly one ${begin} ... ${end} pair`);
    }
    out = `${out.slice(0, start + begin.length)}\n${blocks[name].replace(/\n+$/, '')}\n${out.slice(stop)}`;
  }
  return out;
}

export function readSkill() {
  return readFileSync(SKILL_PATH, 'utf8').replace(/\r\n/g, '\n');
}

/** The skill as it must be committed: the file's prose with every generated block rebuilt. */
export function renderSkill({ cli, pages, text = readSkill() }) {
  const runtime = prismCode();
  const exampleRun = runExample('three-calls', { map: { 'prism-code': runtime.url }, cwd: FIXTURE_DIR });
  return fillSkill(text, skillBlocks({ cli, pages, exampleRun }));
}

/** Code the skill shows: every line of a fenced block, and every inline code span in prose. */
function codeSegments(text) {
  const out = [];
  let fenced = false;
  text.split('\n').forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return;
    }
    const spans = fenced ? [line.replace(/\s+#\s.*$/, '')] : [...line.matchAll(/`([^`]+)`/g)].map((m) => m[1]);
    for (const span of spans) for (const segment of span.split(/\||&&|;/)) out.push([index + 1, segment]);
  });
  return out;
}

/**
 * Everything wrong with the skill's text. The markers and the frontmatter are
 * structure; the commands, the links and the vocabulary are what the skill may say.
 * @returns {string[]}
 */
export function skillProblems(text, { cli, pages }) {
  const problems = [];

  const front = /^---\n([\s\S]*?)\n---\n/.exec(text);
  if (!front) problems.push('no frontmatter: the skill starts with --- name and description ---');
  else {
    const keys = new Map(front[1].split('\n').map((l) => /^([a-z-]+):\s*(.*)$/.exec(l)).filter(Boolean).map((m) => [m[1], m[2]]));
    if (keys.get('name') !== SKILL_NAME) problems.push(`frontmatter name is ${JSON.stringify(keys.get('name'))}, must be ${JSON.stringify(SKILL_NAME)}, the directory's name`);
    const description = keys.get('description') ?? '';
    if (description.length === 0) problems.push('frontmatter has no description');
    if (description.length > 1024) problems.push(`frontmatter description is ${description.length} characters, the limit is 1024`);
    for (const key of keys.keys()) if (!['name', 'description'].includes(key)) problems.push(`frontmatter key ${key} is not name or description`);
  }

  for (const name of [...BLOCKS, 'mcp']) {
    for (const edge of ['begin', 'end']) {
      const count = text.split(name === 'mcp' ? `<!-- mcp:${edge} -->` : marker(name, edge)).length - 1;
      if (count !== 1) problems.push(`marker ${name}:${edge} appears ${count} times, must appear once`);
    }
  }

  for (const [line, segment] of codeSegments(text)) {
    const shipped = shippedCommandProblem(segment, cli);
    if (shipped) problems.push(`line ${line}: ${shipped}`);
    const notShipped = /^\s*(?:npx\s+)?(prism|prismpm)\s+(\S+)/.exec(segment);
    if (notShipped && !notShipped[2].startsWith('-')) problems.push(`line ${line}: ${notShipped[1]} ${notShipped[2]} names a command that has not shipped; name prism-code instead`);
  }

  const known = new Set([...pages.groups.flatMap((g) => g.pages.map((p) => `${pages.site}/${sitePath(p.path)}`)), `${pages.site}/llms.txt`, `${pages.site}/llms-full.md`]);
  text.split('\n').forEach((line, index) => {
    for (const match of line.matchAll(/https?:\/\/[^\s)>`]+/g)) {
      const url = match[0].replace(/[.,:;]+$/, '');
      if (url.startsWith(`${pages.site}/`) || url === pages.site) {
        if (url !== pages.site && !known.has(url)) problems.push(`line ${index + 1}: ${url} is not a page of the site`);
      }
    }
  });
  for (const page of DOC_PAGES) {
    if (!pages.groups.some((g) => g.pages.some((p) => p.path === page.path))) problems.push(`DOC_PAGES names ${page.path}, which is not in sdk/docs/pages.json`);
  }

  for (const hit of lintText(text, SKILL_FILE)) problems.push(`line ${hit.line}, ${hit.word}: ${hit.text.trim()}`);
  return problems;
}
