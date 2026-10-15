import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {captureCompilerInputs} from './compiler-owner.mjs';
import * as publication from '../publication-context-linkage/compile.mjs';
import * as retention from '../browser-session-journal-retention/compile.mjs';

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
