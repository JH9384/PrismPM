import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {compilerInputPaths, captureCompilerInputs} from './compiler-owner.mjs';
import * as publication from '../publication-context-linkage/compile.mjs';
import * as retention from '../browser-session-journal-retention/compile.mjs';
import * as reservation from '../browser-session-journal/reservation-compile.mjs';
import * as frames from '../browser-session-recovery-frames/compile.mjs';
import * as primary from '../holo-primary-component/compile.mjs';
import * as pkce from '../browser-pkce/compile.mjs';
import * as operation from '../browser-session-operation/compile.mjs';
import * as signed from '../browser-signed-context/compile.mjs';
import * as genesis from '../browser-account-genesis/compile.mjs';
import * as p256 from '../browser-p256/compile.mjs';
import * as view from './compile.mjs';
import * as effects from '../browser-effects/compile.mjs';
import * as presentation from '../browser-presentation/compile.mjs';
import * as session from '../browser-session/compile.mjs';
import * as journal from '../browser-operation-journal/compile.mjs';
import * as budget from '../browser-budget/compile.mjs';
import * as custody from '../browser-custody/compile.mjs';
import * as admission from '../publication-admission/compile.mjs';

// Four original adapters do not expose a separate model snapshot. Do not invent
// one or equate their source/pin barriers with the twelve captured model maps.
const components = [
  ['holo-primary-component', primary], ['pkce', pkce], ['session-operation', operation],
  ['signed-context', signed], ['session-retention', retention], ['session-journal-reservation', reservation],
  ['session-recovery-frames', frames],
  ['publication-linkage', publication],
  ['account-genesis', genesis], ['p256', p256], ['view', view], ['effects', effects],
  ['presentation', presentation], ['session', session], ['operation-journal', journal],
  ['budget', budget], ['custody', custody], ['publication', admission],
];
const directAdapters = new Set(['view', 'effects', 'operation-journal', 'custody']);

test('the component capture matrix covers the exact eighteen registered compiler families', () => {
  const source = readFileSync(new URL('./compiler-owner.mjs', import.meta.url), 'utf8');
  const begin = source.indexOf('const families = Object.freeze({'), end = source.indexOf('\nconst owners = ', begin);
  assert(begin >= 0 && end > begin);
  const registered = runInNewContext(source.slice(begin, end) + '\nObject.keys(families);');
  assert.deepEqual(components.map(([name]) => name).sort(), [...registered].sort());
  assert.equal(components.length, 18);
  assert.equal(directAdapters.size, 4);
});

for (const [family, component] of components) {
  test(family + ' captures the complete actual compiler closure before model construction', () => {
    const paths = compilerInputPaths(family), compiler = captureCompilerInputs(family);
    assert(Object.isFrozen(paths));
    assert.deepEqual(paths, Object.keys(compiler), 'one complete path authority serves actual compiler and model captures');
    assert(Object.isFrozen(compiler));
    for (const path of ['tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/verification-products.mjs'])
      assert.match(compiler[path], /^[a-f0-9]{64}$/, 'explicit non-import compiler input is captured: ' + path);
    if (directAdapters.has(family)) {
      assert.equal(component.frozenInputs, undefined, 'original direct adapter has no separate captured model map');
      assert.equal(typeof component.prepare, 'function', 'original direct model owner remains available');
      return;
    }
    const inputs = component.frozenInputs();
    assert(Object.isFrozen(inputs));
    assert(Object.keys(inputs).length > Object.keys(compiler).length, 'complete model inputs include more than compiler tools');
    for (const [path, digest] of Object.entries(compiler))
      assert.equal(family === 'presentation' ? inputs[path]?.sha256 : inputs[path], digest,
        'actual compiler input belongs to captured ' + family + ' model: ' + path);
  });
}

test('compiler path selection refuses caller-defined families without coercion', () => {
  let coerced = false;
  for (const name of ['', '../escape', 'caller-driver', null, {toString() {coerced = true; return 'pkce';}}])
    assert.throws(() => compilerInputPaths(name), /registered compiler family/);
  assert.equal(coerced, false);
});

for (const [family, component] of [['publication-linkage', publication], ['session-retention', retention]]) {
  test(family + ' joins the exact compiler subset to an authentic complete component snapshot', () => {
    const inputs = component.frozenInputs(), subset = component.compilerInputs(inputs);
    assert.deepEqual(subset, captureCompilerInputs(family));
    assert(Object.isFrozen(subset));
    assert(Object.keys(inputs).length > Object.keys(subset).length);
    for (const [path, digest] of Object.entries(subset)) assert.equal(inputs[path], digest);
    const missing = {...inputs}; delete missing['tests/browser-view/compiler-artifact.mjs'];
    const changed = {...inputs, 'tests/browser-view/compiler-artifact.mjs': '0'.repeat(64)};
    for (const forged of [{...inputs}, missing, changed, subset])
      assert.throws(() => component.compilerInputs(forged), /actual complete captured/);
    // Separately exercise the actual join predicate; forged-map admission
    // negatives above intentionally stop at snapshot authenticity first.
    const directory = family === 'publication-linkage' ? 'publication-context-linkage' : 'browser-session-journal-retention';
    const source = readFileSync(new URL('../' + directory + '/compile.mjs', import.meta.url), 'utf8');
    const begin = source.indexOf('function assertCompilerSubset('), end = source.indexOf('\nexport function compilerInputs(', begin);
    assert(begin >= 0 && end > begin);
    const join = runInNewContext(source.slice(begin, end) + '\nassertCompilerSubset;', {assert, Object});
    join(subset, inputs);
    for (const mismatched of [missing, changed])
      assert.throws(() => join(subset, mismatched), /actual compiler input belongs to complete/);
    for (const path of ['tests/browser-view/compiler-owner-checks.mjs', 'tests/browser-view/verification-products.mjs']) {
      assert.equal(inputs[path], subset[path], 'owning compiler helper is captured: ' + path);
      const omitted = {...inputs}; delete omitted[path];
      assert.throws(() => join(subset, omitted), /actual compiler input belongs to complete/);
    }
  });
}
