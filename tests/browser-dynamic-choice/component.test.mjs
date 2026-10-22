import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {mutationNames, mutateSources} from './mutations.mjs';
import {frozenInputs, assertFrozenInputs} from './compile.mjs';

const names = ['Foundation.View.Browser.V1.Model', 'Foundation.View.Browser.V1.Wire',
  'Foundation.View.Browser.V1.Semantics', 'Foundation.Browser.Application.V1.Session'];
const sources = () => new Map(names.map(name => [name,
  readFileSync(new URL('../../stdlib/src/' + name.replaceAll('.', '/') + '.lex.tex', import.meta.url))]));
const module = bytes => JSON.parse(/\\semanticdata\{(.*)\}/.exec(bytes.toString('utf8'))[1]);

test('dynamic source constructors and all exhaustive presentation matches remain closed', () => {
  const all = sources(), model = module(all.get(names[0]));
  assert.equal(model.declarations.find(row => row.name === 'TextChoice').fields[1].type.kind, 'string');
  const content = model.declarations.find(row => row.name === 'Content');
  assert.deepEqual(content.constructors.map(row => row.name), ['Section', 'Navigation', 'Form',
    'Heading', 'Text', 'Input', 'Multiline', 'Select', 'Action', 'Table', 'SecretInput', 'TextSelect']);
  let matches = 0;
  function inspect(value) {
    if (!value || typeof value !== 'object') return;
    if (value.kind === 'match' && value.branches.some(row => row.constructor.name === 'Content.Select')) {
      assert.equal(value.branches.filter(row => row.constructor.name === 'Content.TextSelect').length, 1);
      matches++;
    }
    Object.values(value).forEach(child => Array.isArray(child) ? child.forEach(inspect) : inspect(child));
  }
  for (const bytes of all.values()) inspect(module(bytes));
  assert.equal(matches, 15);
});

test('every planned defect changes one actual source module and no acceptance fixture', () => {
  const before = sources();
  for (const kind of mutationNames) {
    const mutated = new Map(before); mutateSources(mutated, kind);
    assert.equal([...mutated].filter(([name, bytes]) => !bytes.equals(before.get(name))).length, 1, kind);
    for (const bytes of mutated.values()) assert.equal(module(bytes).spec, 'lexlean/semantic-module/1');
  }
  assert.throws(() => mutateSources(new Map(before), 'unknown'));
});

test('dynamic owning test remains registered and cannot report component checks as generated acceptance', () => {
  const root = new URL('../../', import.meta.url), owner = readFileSync(new URL('sdk/browser/dynamic-choice.test.mjs', root), 'utf8');
  assert.match(owner, /verifyDynamicChoice/);
  assert.match(readFileSync(new URL('model/ids.toml', root), 'utf8'), /id = "DK-31"/);
  assert.match(readFileSync(new URL('crates/conformance/tests/conformance.rs', root), 'utf8'), /conformance_dk_31/);
  const registry = JSON.parse(readFileSync(new URL('model/browser-semantic-presentation-diagnostics.json', root)));
  assert.equal(registry.capability, 'DK-38');
  assert.equal(registry.error_class, 'PresentationError');
  const checks = readFileSync(new URL('tests/browser-dynamic-choice/checks.mjs', root), 'utf8');
  assert.match(checks, /assert\.equal\(registry\.capability, 'DK-38'\)/);
  assert.match(checks, /unchanged DK-23, DK-26 and DK-38 full owners/);
  assert.doesNotMatch(checks, /DK-29/);
  const inputs = frozenInputs(), required = [
    'tests/browser-view/file-custody.mjs', 'tests/browser-view/compiler-owner.mjs',
    'tests/browser-view/compiler-artifact.mjs', 'tests/browser-view/compiler-owner-checks.mjs',
    'tests/browser-presentation/provenance.mjs', 'tests/browser-presentation/fixture-files.mjs',
  ];
  // Parse the actual entry's complete static import graph without linking or
  // evaluating project modules. Browser-context dynamic imports are separately
  // bound by the existing complete sdk/browser/*.mjs inventory.
  const parser = String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {dirname, relative, resolve} from 'node:path';
    import {SourceTextModule} from 'node:vm';
    const {root, inputs} = JSON.parse(readFileSync(0, 'utf8'));
    const pending = ['sdk/browser/dynamic-choice.test.mjs', 'tests/browser-dynamic-choice/checks.mjs'];
    const visited = new Set();
    while (pending.length) {
      const path = pending.pop(); if (visited.has(path)) continue;
      assert(visited.size < 256, 'bounded owning static module graph');
      assert(Object.hasOwn(inputs, path), 'captured local module input: ' + path);
      const bytes = readFileSync(resolve(root, path));
      assert(bytes.length <= 4194304, 'bounded owning static module');
      assert.equal(createHash('sha256').update(bytes).digest('hex'), inputs[path], 'captured module hash: ' + path);
      const source = new TextDecoder('utf-8', {fatal: true}).decode(bytes);
      const declarations = new SourceTextModule(source).dependencySpecifiers;
      visited.add(path);
      for (const specifier of declarations) {
        if (specifier.startsWith('node:')) continue;
        assert(specifier.startsWith('./') || specifier.startsWith('../'), 'closed local import');
        const dependency = relative(root, resolve(root, dirname(path), specifier));
        assert(dependency.endsWith('.mjs') && dependency.split('/').every(part =>
          /^[A-Za-z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'), 'confined local import');
        pending.push(dependency);
      }
    }
    process.stdout.write(JSON.stringify([...visited].sort()));
  `;
  const inspect = captured => spawnSync(process.execPath,
    ['--experimental-vm-modules', '--input-type=module', '-e', parser], {
      input: JSON.stringify({root: fileURLToPath(root), inputs: captured}), encoding: 'utf8',
      env: {NODE_NO_WARNINGS: '1', TZ: 'UTC'}, timeout: 10000, maxBuffer: 1048576,
    });
  const complete = inspect(inputs);
  assert.ifError(complete.error); assert.equal(complete.signal, null); assert.equal(complete.status, 0, complete.stderr);
  const graph = JSON.parse(complete.stdout);
  for (const path of required) {
    assert(graph.includes(path), 'actual imported helper: ' + path);
    const omitted = {...inputs}; delete omitted[path];
    const refused = inspect(omitted);
    assert.ifError(refused.error); assert.equal(refused.signal, null); assert.equal(refused.status, 1);
    assert(refused.stderr.includes('captured local module input: ' + path), refused.stderr);
    assert.throws(() => assertFrozenInputs(omitted), /complete frozen dynamic choice owner inputs/);
    assert.throws(() => assertFrozenInputs({...inputs, [path]: '0'.repeat(64)}),
      /complete frozen dynamic choice owner inputs/);
  }
  assert.ok(fileURLToPath(root).endsWith('/'));
});
