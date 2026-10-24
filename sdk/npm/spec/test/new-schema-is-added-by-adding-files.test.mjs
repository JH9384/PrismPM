// The rule behind issue #340: a pull request that adds a schema adds files and edits none, so two such pull
// requests never conflict. These tests hold the package to it.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, sep } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { build, discover } from '../scripts/build.mjs';
import { fixtureProblems } from './fixtures.mjs';
import { here, readJson } from './reference.mjs';
import './spec.mjs';

/** Written by scripts/build.mjs, ignored by git: the only files a new schema may change. */
const GENERATED = ['index.mjs', 'index.d.ts', 'types/documents.d.ts', 'types/predicate-map.d.ts', 'predicates/registry.json'];

test('every schema file is reachable through the package exports map, with no registry to edit', () => {
  const pkg = readJson('../package.json');
  const patterns = Object.keys(pkg.exports).filter((key) => key.includes('*'));
  assert.ok(patterns.includes('./schemas/*') && patterns.includes('./predicates/*'), 'the exports map has subpath patterns');
  const root = pathToFileURL(here('../')).href;
  const { schemas } = discover();
  assert.ok(schemas.length >= 20);
  for (const { path } of schemas) {
    // Node's own resolution of the package's name, so this is what a consumer's import does.
    const url = import.meta.resolve(`${pkg.name}/${path}`);
    assert.equal(url, `${root}${path}`, `${path} does not resolve through the exports map`);
    assert.ok(existsSync(fileURLToPath(url)), path);
  }
});

function files(dir, base = dir, out = []) {
  for (const entry of readdirSync(dir).sort()) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'test') continue;
    if (statSync(full).isDirectory()) files(full, base, out);
    else out.push(relative(base, full).split(sep).join('/'));
  }
  return out;
}

function snapshot(root) {
  const out = new Map();
  const walk = (dir) => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) walk(full);
      else out.set(relative(root, full).split(sep).join('/'), createHash('sha256').update(readFileSync(full)).digest('hex'));
    }
  };
  walk(root);
  return out;
}

test('a new document schema and a new predicate are added by adding files only, and they appear in every registry', async () => {
  const root = mkdtempSync(join(tmpdir(), 'prism-spec-new-schema-'));
  try {
    // A copy of the package as it is committed: no generated file, no tests.
    for (const rel of files(here('../'))) {
      if (GENERATED.includes(rel) || rel.endsWith('.tmp')) continue;
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      cpSync(here(`../${rel}`), join(root, rel));
    }
    const before = snapshot(root);
    const add = (rel, text) => {
      mkdirSync(dirname(join(root, rel)), { recursive: true });
      writeFileSync(join(root, rel), typeof text === 'string' ? text : `${JSON.stringify(text, null, 2)}\n`);
    };

    add('schemas/documents/widget-v1.schema.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.uor.foundation/prismpm/widget/1',
      title: 'Widget',
      type: 'object',
      additionalProperties: false,
      required: ['schema', 'name'],
      properties: { schema: { const: 'prismpm/widget/1' }, name: { type: 'string', minLength: 1 } },
    });
    add('schemas/documents/widget-v2.schema.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://schemas.uor.foundation/prismpm/widget/2',
      title: 'WidgetV2',
      type: 'object',
      required: ['schema'],
      properties: { schema: { const: 'prismpm/widget/2' } },
    });
    add('predicates/widget-v1.json', { status: 'experimental', owner: { issue: 1 }, description: 'A throwaway predicate.' });
    add('predicates/widget-v1.d.ts', "export declare const WIDGET_PREDICATE_TYPE: 'https://uor.foundation/prism/widget/v1';\nexport interface WidgetPredicateV1 { name: string }\n");
    add('predicates/widget-v1.schema.json', {
      $schema: 'https://json-schema.org/draft/2020-12/schema',
      $id: 'https://uor.foundation/prism/widget/v1/schema.json',
      title: 'WidgetPredicateV1',
      type: 'object',
      required: ['name'],
      properties: { name: { type: 'string' } },
    });
    const added = [...snapshot(root).keys()].filter((rel) => !before.has(rel));
    assert.equal(added.length, 5);

    // The new schemas have no fixture yet: the fixture rule names what to add.
    const found = discover(root);
    const widget = found.schemas.find((s) => s.path === 'schemas/documents/widget-v1.schema.json');
    const fixtures = join(root, 'fixtures');
    assert.match(fixtureProblems(widget, fixtures).join('\n'), /schemas\/documents\/widget-v1\.schema\.json has no fixture\. Add a valid instance as test\/fixtures\/documents\/widget-v1\/<case>\.json/);
    add('fixtures/documents/widget-v1/one.json', { schema: 'prismpm/widget/1', name: 'one' });
    add('fixtures/documents/widget-v1/invalid/nameless.json', { schema: 'prismpm/widget/1' });
    assert.deepEqual(fixtureProblems(widget, fixtures), []);

    // The build derives every registry from the files.
    build(root);
    const spec = await import(pathToFileURL(join(root, 'index.mjs')).href);
    assert.equal(spec.SCHEMAS['prismpm/widget/1'], 'schemas/documents/widget-v1.schema.json');
    assert.equal(spec.SCHEMAS['prismpm/widget/2'], 'schemas/documents/widget-v2.schema.json');
    assert.equal(spec.WIDGET_PREDICATE_TYPE, 'https://uor.foundation/prism/widget/v1');
    const registry = JSON.parse(readFileSync(join(root, 'predicates/registry.json'), 'utf8'));
    assert.ok(registry.predicates.some((p) => p.predicateType === spec.WIDGET_PREDICATE_TYPE && p.schema === 'predicates/widget-v1.schema.json'));
    const types = readFileSync(join(root, 'types/documents.d.ts'), 'utf8');
    assert.match(types, /^export type WidgetV1 = /m);
    const index = readFileSync(join(root, 'index.d.ts'), 'utf8');
    assert.ok(index.includes('export type Widget = WidgetV1 | WidgetV2;'));
    assert.ok(index.includes("export { WIDGET_PREDICATE_TYPE } from './predicates/widget-v1.js';"));
    assert.ok(readFileSync(join(root, 'types/predicate-map.d.ts'), 'utf8').includes("'https://uor.foundation/prism/widget/v1': WidgetPredicateV1;"));

    // Nothing that was there before changed, except the generated files.
    const after = snapshot(root);
    const changed = [...before].filter(([rel, hash]) => after.get(rel) !== hash).map(([rel]) => rel);
    assert.deepEqual(changed, [], 'a hand-written file changed');
    const createdByBuild = [...after.keys()].filter((rel) => !before.has(rel) && !added.includes(rel) && !rel.startsWith('fixtures/'));
    assert.deepEqual(createdByBuild.sort(), [...GENERATED].sort());
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
