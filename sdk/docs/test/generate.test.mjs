import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { EXAMPLES, lintFiles, readPages, render, renderSite } from '../lib/generate.mjs';
import { runExample } from '../lib/examples.mjs';
import { FIXTURE_DIR, prismCode } from '../lib/runtime.mjs';
import { ROOT, headCommit, loadSpec } from '../lib/spec.mjs';
import { verify, writeOutput } from '../generate.mjs';
import { lintText } from '../lint.mjs';

const generate = fileURLToPath(new URL('../generate.mjs', import.meta.url));

const spec = await loadSpec();
const runtime = prismCode();
const files = await render({ spec, runtime });

test('every page in the list is rendered with the page shape', () => {
  const pages = readPages().groups.flatMap((g) => g.pages);
  // Every page, plus llms.txt, llms-full.md and release-status.json; then the Mintlify tree: every page, docs.json, llms.txt and llms-full.txt.
  assert.equal(files.size, pages.length + 3 + pages.length + 3);
  for (const page of pages) {
    const text = files.get(`${page.path}.md`);
    assert.ok(text, `${page.path} rendered`);
    assert.match(text, /\n## Next steps\n\n- \[/);
    assert.deepEqual(lintText(text, page.path), [], `${page.path} passes the vocabulary lint`);
    if (page.narrative) continue;
    assert.match(text, new RegExp(`^---\\ntitle: ${page.title}\\ndescription: .+\\navailable_in: "${page.available_in.replace(/\./g, '\\.')}"\\n---\\n`));
    assert.match(text, /\nGenerated from .+\.\n$/);
    if (page.status) assert.ok(text.includes(`\nStatus: ${page.status}\n`), `${page.path} carries its status line`);
  }
  assert.ok(files.get('llms.txt').startsWith('# Prism\n'));
  assert.ok(files.get('llms-full.md').includes('<!-- reference/holo-format -->'));
  assert.ok(files.get('llms-full.md').includes('<!-- get-started/quickstart -->'));
});

test('the spec pages name the checkout they were generated from', () => {
  assert.equal(spec.commit, headCommit());
  const holo = files.get('reference/holo-format.md');
  assert.ok(holo.includes(`Generated from @prism-code/spec ${spec.module.FORMAT_REVISION} at ${spec.commit}.`));
  assert.ok(holo.includes('| 202      | variable | section bodies'));
  assert.ok(holo.includes('| 0   | 15   | APP_MANIFEST'));
});

test('the spec package page lists every schema and predicate between generated-region markers', () => {
  const page = files.get('api/spec-package.md');
  const region = (name) => {
    const begin = `<!-- generated:${name}:begin -->`;
    const end = `<!-- generated:${name}:end -->`;
    const from = page.indexOf(begin);
    assert.ok(from >= 0 && page.indexOf(end) > from, `${name} region`);
    return page.slice(from, page.indexOf(end));
  };
  const schemas = region('schemas');
  for (const s of spec.registry.schemas) assert.ok(schemas.includes(`\`${s.id}\``) && schemas.includes(`\`${s.path}\``), s.path);
  const predicates = region('predicates');
  for (const p of spec.registry.predicates) assert.ok(predicates.includes(`\`${p.predicateType}\``), p.predicateType);
});

test('the executed examples print what the pages show', () => {
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  const outputs = Object.fromEntries(EXAMPLES.map((n) => [n, runExample(n, { map, cwd: FIXTURE_DIR }).output]));
  assert.equal(outputs.load, 'Calculator\ntrue\n{ request: 52, response: 27, guestAllocation: 65536 }\n');
  assert.equal(outputs.dispatch, '"1\\tok\\t42"\n');
  assert.equal(outputs.acceptance, '{ total: 22, passed: 22, failed: [] }\n');
  assert.equal(outputs.verify, "{ level: 'P0', passed: true }\nVerificationError verification_failed provenance.statement\n");
  assert.ok(outputs['spec-constants'].startsWith(`${spec.module.FORMAT_REVISION}\nHOLO 4 8\n`));
  assert.ok(files.get('api/load.md').includes(`\`\`\`text\n${outputs.load}\`\`\``));
  assert.ok(files.get('api/dispatch.md').includes(`\`\`\`text\n${outputs.dispatch}\`\`\``));
  assert.ok(files.get('api/history-and-replay.md').includes(`\`\`\`text\n${outputs.acceptance}\`\`\``));
  assert.ok(files.get('api/verify.md').includes(`\`\`\`text\n${outputs.verify}\`\`\``));
});

test('an example that fails to run fails the generation', () => {
  const map = { 'prism-code': runtime.url, '@prism-code/spec': spec.url };
  assert.throws(() => runExample('load', { map, cwd: tmpdir() }), /example load exited with/);
});

/** The spec package as committed, in a scratch directory, so a test can break it. */
function scratchSpec() {
  const root = mkdtempSync(join(tmpdir(), 'prism-docs-spec-'));
  const from = join(ROOT, 'sdk', 'npm', 'spec');
  const copy = (dir) => {
    for (const entry of readdirSync(join(from, dir))) {
      const rel = join(dir, entry);
      if (['node_modules', 'test'].includes(entry)) continue;
      if (statSync(join(from, rel)).isDirectory()) copy(rel);
      else {
        mkdirSync(dirname(join(root, rel)), { recursive: true });
        cpSync(join(from, rel), join(root, rel));
      }
    }
  };
  copy('');
  return root;
}

test('verify names the page whose example a spec change breaks', async () => {
  const dir = scratchSpec();
  try {
    // The spec-constants example imports MAGIC. Rename it in the scratch copy, as a careless schema change might.
    const constants = join(dir, 'constants.mjs');
    writeFileSync(constants, readFileSync(constants, 'utf8').replace('export const MAGIC =', 'export const MAGIC_NUMBER ='));
    const broken = await loadSpec({ dir, commit: 'scratch' });
    const { problems } = await verify({ spec: broken, runtime });
    const named = problems.filter((p) => p.page === 'api/spec-package');
    assert.ok(named.some((p) => p.kind === 'example' && /example spec-constants exited with/.test(p.message)), problems.map(String).join('\n'));
    // Pages that do not show that example are not blamed for it.
    assert.ok(!problems.some((p) => p.page === 'api/load'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify names every page that shows an example the runtime cannot run', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'prism-docs-runtime-'));
  try {
    const entry = join(dir, 'index.mjs');
    writeFileSync(entry, "throw new Error('the runtime does not load');\n");
    const { files: rendered, problems } = await renderSite({ spec, runtime: { ...runtime, url: pathToFileURL(entry).href } });
    assert.deepEqual(
      problems.map((p) => `${p.page} ${p.kind}`).sort(),
      ['api/history-and-replay example', 'api/dispatch example', 'api/index example', 'api/load example', 'api/verify example', 'examples/call-a-holo example', 'examples/check-a-holo example', 'examples/inspect-a-holo example', 'examples/replay-examples example', 'sdks/typescript example'].sort(),
    );
    assert.ok(rendered.has('reference/holo-format.md'), 'pages that run nothing still render');
    assert.ok(!rendered.has('llms.txt'), 'the site index is not written from a partial site');
    await assert.rejects(render({ spec, runtime: { ...runtime, url: pathToFileURL(entry).href } }), /api\/load: example: example load exited with/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('verify names the page whose prose breaks the vocabulary lint', () => {
  const problems = lintFiles(new Map([['api/load.md', '# Load\n\nOpens a hologram.\n'], ['api/dispatch.md', '# Dispatch\n\nSends a request.\n']]));
  assert.deepEqual(problems.map(String), ['api/load: lint: line 3, Hologram: Opens a hologram.']);
});

test('generate writes the site where it is told and verify exits 0 on this checkout', () => {
  const out = mkdtempSync(join(tmpdir(), 'prism-docs-site-'));
  try {
    const written = spawnSync(process.execPath, [generate, '--out', out], { encoding: 'utf8' });
    assert.equal(written.status, 0, written.stderr);
    assert.ok(existsSync(join(out, 'api', 'load.md')) && existsSync(join(out, 'llms.txt')));
    const verified = spawnSync(process.execPath, [generate, 'verify'], { encoding: 'utf8' });
    assert.equal(verified.status, 0, verified.stderr);
    assert.match(verified.stdout, /docs verified: \d+ files, every example ran/);
    const bad = spawnSync(process.execPath, [generate, '--pin', 'abc'], { encoding: 'utf8' });
    assert.notEqual(bad.status, 0, 'there is no pin to set');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});

test('nothing the generator writes is committed: no generated pages, no pin, the output directory is ignored', () => {
  assert.ok(!existsSync(join(ROOT, 'docs', 'generated')), 'docs/generated');
  assert.ok(!existsSync(join(ROOT, 'sdk', 'docs', 'spec.lock.json')), 'sdk/docs/spec.lock.json');
  assert.match(readFileSync(join(ROOT, '.gitignore'), 'utf8'), /^\/build\/$/m);
});

test('writeOutput writes every file under its relative path', () => {
  const out = mkdtempSync(join(tmpdir(), 'prism-docs-write-'));
  try {
    writeOutput(files, out);
    for (const rel of files.keys()) assert.ok(existsSync(join(out, ...rel.split('/'))), rel);
    assert.equal(relative(out, join(out, 'api', 'load.md')).split(sep).join('/'), 'api/load.md');
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
