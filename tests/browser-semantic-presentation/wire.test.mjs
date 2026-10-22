// Component-only evidence. Generated source/native/Wasm parity is mandatory
// in the owning gate; these independently constructed inputs cannot replace it.
import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {frozenInputs, assertFrozenInputs, assertBaselineSources, prepare, modules, repository, sha} from './compile.mjs';
import {sourceRoots} from '../../scripts/browser-api-sdk-check.mjs';
import {PresentationError, encodeWire} from '../../sdk/browser/presentation-wire.mjs';
import {captureDesignCatalogue, decodeSemanticPresentation, encodeSemanticPresentation,
  semanticCatalogueFits, semanticMainNode, semanticProgressFits} from '../../sdk/browser/semantic-presentation-wire.mjs';
import {corpus, fixture, designs, light} from './corpus.mjs';
import {semanticStyle} from '../../sdk/browser/semantic-presentation-style.mjs';
import {assertBrowserJourneyInventory, assertPaletteInventory, captureBrowserEvidence, completeEvidence, replayBrowser, verifyNativeInventory} from './checks.mjs';
import {journeyCallInventory, journeyNames} from './browser.mjs';

test('retained browser and mutant observations are detached and deeply immutable', () => {
  const original = {cases:['journey'], palettes:[{checks:[{foreground:'system'}]}],
    mutants:[{actual:{retained:true}}]};
  const captured = captureBrowserEvidence(original);
  original.cases[0] = 'substituted'; original.palettes[0].checks[0].foreground = 'changed';
  original.mutants[0].actual.retained = false;
  assert.deepEqual(captured, {cases:['journey'], palettes:[{checks:[{foreground:'system'}]}],
    mutants:[{actual:{retained:true}}]});
  assert.throws(() => {captured.cases[0] = 'changed';}, TypeError);
  assert.throws(() => {captured.palettes[0].checks[0].foreground = 'changed';}, TypeError);
  assert.throws(() => {captured.mutants[0].actual.retained = false;}, TypeError);
  assert.throws(() => {captured.palettes.push({});}, TypeError);
});

test('completion binds exact journey names and every case-owned generated call', () => {
  assert.equal(journeyNames.length, 7); assert.equal(journeyCallInventory.length, 39);
  assertBrowserJourneyInventory(journeyNames, journeyCallInventory);
  const changed = [...journeyNames]; changed[2] = 'substituted journey';
  const duplicate = [...journeyNames]; duplicate[2] = duplicate[1];
  const permutations = [changed, duplicate, journeyNames.slice(1), [...journeyNames].reverse()];
  for (const names of permutations) {
    assert.throws(() => assertBrowserJourneyInventory(names, journeyCallInventory), /exact ordered semantic journey inventory/);
    assert.throws(() => completeEvidence({
      mutationEvidence:['purpose','main','trailing','design','catalogue'].map(kind=>({kind})),
      browserEvidence:['chromium','firefox','webkit'].map(engine=>({engine,cases:names,callInventory:journeyCallInventory})),
      browserMutationEvidence:['chromium','firefox','webkit'].map(engine=>({engine})),
    }), /exact ordered semantic journey inventory/);
  }
  const duplicateCall = [...journeyCallInventory]; duplicateCall[5] = duplicateCall[0];
  for (const calls of [[], journeyCallInventory.slice(1), [...journeyCallInventory].reverse(), duplicateCall])
    assert.throws(() => assertBrowserJourneyInventory(journeyNames, calls), /exact case-bound generated browser call inventory/);
  const palettes = [['light',false,0],['light',true,5],['dark',false,0],['dark',true,5]]
    .map(([colorScheme,disabled,disabledCount])=>({colorScheme,disabled,disabledCount}));
  assertPaletteInventory(palettes);
  for (const changed of [palettes.slice(1), [...palettes].reverse(),
    palettes.map(row=>({...row,disabled:row.disabledCount})),
    palettes.map(({disabledCount,...row})=>row),
    palettes.map(row=>({...row,disabledCount:row.disabled?0:5}))]) {
    assert.throws(() => assertPaletteInventory(changed), /exact phase-bound palette observation inventory/);
    assert.throws(() => replayBrowser({browserEvidence:[]}, {engine:'chromium',modelChecked:true,
      cases:journeyNames,calls:journeyCallInventory,palettes:changed}), /exact phase-bound palette observation inventory/);
  }
});

test('browser transcript engine is closed and cannot overwrite an earlier replay', () => {
  const result = {modelChecked:true, calls:[{}]};
  for (const engine of ['unknown', '../webkit', 'WebKit', undefined])
    assert.throws(() => replayBrowser({browserEvidence:[]}, {...result, engine}), /closed browser transcript engine/);
  for (const [completed, engine] of [[[], 'firefox'], [['chromium'], 'chromium'],
    [['chromium','firefox'], 'firefox'], [['chromium','firefox','webkit'], 'webkit']]) {
    assert.throws(() => replayBrowser({browserEvidence:completed.map(engine=>({engine}))}, {...result, engine}),
      /each required engine is replayed exactly once in order/);
  }
});

test('owner completion refuses omitted duplicate or reordered browser and mutant inventories', () => {
  const names = ['chromium','firefox','webkit'];
  const mutationEvidence = ['purpose','main','trailing','design','catalogue'].map(kind=>({kind}));
  for (const inventory of [[], ['chromium'], ['chromium','firefox'],
    ['chromium','chromium','webkit'], ['webkit','firefox','chromium']]) {
    assert.throws(() => completeEvidence({mutationEvidence,
      browserEvidence:inventory.map(engine=>({engine})), browserMutationEvidence:names.map(engine=>({engine}))}),
    /complete required browser transcript inventory/);
    assert.throws(() => completeEvidence({mutationEvidence,
      browserEvidence:names.map(engine=>({engine})), browserMutationEvidence:inventory.map(engine=>({engine}))}),
    /complete required browser mutation inventory/);
  }
});

test('whole-owner closure binds every source, compiler input and exact mutation baseline', () => {
  const inputs = frozenInputs(), sources = new Map();
  const helpers = ['tests/browser-view/file-custody.mjs', 'tests/browser-view/compiler-owner.mjs',
    'tests/browser-view/compiler-artifact.mjs', 'tests/browser-view/compiler-owner-checks.mjs',
    'tests/browser-view/generated-wasm.mjs', 'tests/browser-presentation/provenance.mjs',
    'tests/browser-presentation/fixture-files.mjs', 'sdk/account-genesis-artifact.mjs'];
  // Parse real static imports without linking or executing project modules.
  // Browser-context dynamic imports remain bound by the complete SDK inventory.
  const parser = String.raw`
    import assert from 'node:assert/strict';
    import {readFileSync} from 'node:fs';
    import {createHash} from 'node:crypto';
    import {dirname, relative, resolve} from 'node:path';
    import {SourceTextModule} from 'node:vm';
    const {root, inputs} = JSON.parse(readFileSync(0, 'utf8'));
    const pending = ['sdk/browser/semantic-presentation.test.mjs',
      'tests/browser-semantic-presentation/wire.test.mjs', 'tests/browser-semantic-presentation/dom.test.mjs'];
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
      input: JSON.stringify({root: fileURLToPath(new URL('../../', import.meta.url)), inputs: captured}),
      encoding: 'utf8', env: {NODE_NO_WARNINGS: '1', TZ: 'UTC'}, timeout: 10000, maxBuffer: 1048576,
    });
  const complete = inspect(inputs);
  assert.ifError(complete.error); assert.equal(complete.signal, null); assert.equal(complete.status, 0, complete.stderr);
  const graph = JSON.parse(complete.stdout);
  for (const path of helpers) {
    assert(graph.includes(path), 'actual imported helper: ' + path);
    const omitted = {...inputs}; delete omitted[path];
    const refused = inspect(omitted);
    assert.ifError(refused.error); assert.equal(refused.signal, null); assert.equal(refused.status, 1);
    assert(refused.stderr.includes('captured local module input: ' + path), refused.stderr);
    assert.throws(() => assertFrozenInputs(omitted), /complete frozen semantic presentation owner inputs/);
    assert.throws(() => assertFrozenInputs({...inputs, [path]: '0'.repeat(64)}),
      /complete frozen semantic presentation owner inputs/);
  }
  for (const path of Object.keys(inputs)) assert.ok(sourceRoots.some(root => path === root || path.startsWith(root + '/')),
    'installed SDK closure covers every owning input: ' + path);
  for (const module of modules) {
    const path = (module === 'Fixture' ? 'tests/browser-semantic-presentation' : 'stdlib')
      + '/src/' + module.replaceAll('.', '/') + '.lex.tex';
    const bytes = readFileSync(join(repository, path));
    assert.equal(inputs[path], sha(bytes), path); sources.set(module, bytes);
  }
  for (const path of ['model/authorities.toml', 'model/dependencies.toml', 'lean-toolchain',
    'rust-toolchain.toml', 'LICENSE-MIT', 'LICENSE-APACHE', 'vendor/lean4-prod/lean.tar',
    'tests/fixtures/library/native-library/project/lexlean.toml', 'sdk/browser/presentation-dom.mjs',
    'sdk/oracles/package-lock.json', 'tests/browser-view/compile.mjs', 'tests/browser-view/driver-cache.mjs',
    'tests/browser-view/generated-package.mjs', 'tests/browser-view/generated-package.test.mjs']) {
    assert.equal(inputs[path], sha(readFileSync(join(repository, path))), path);
  }
  for (const tree of ['vendor/lexlean', 'vendor/lean4-prod/rust']) {
    const rows = readFileSync(join(repository, tree, 'MANIFEST.sha256'), 'utf8').trimEnd().split('\n');
    for (const row of rows) {
      const match = /^([0-9a-f]{64})  (.+)$/.exec(row); assert.ok(match);
      assert.equal(inputs[tree + '/' + match[2]], match[1]);
    }
    const path = tree + '/' + /^([0-9a-f]{64})  (.+)$/.exec(rows[0])[2];
    assert.throws(() => prepare(null, null, {...inputs, [path]: '0'.repeat(64)}), /complete frozen semantic presentation owner inputs/);
    const missing = {...inputs}; delete missing[path];
    assert.throws(() => assertFrozenInputs(missing), /complete frozen semantic presentation owner inputs/);
  }
  assertBaselineSources(sources, new Map(sources));
  assert.throws(() => assertBaselineSources(sources, null), /positive source closure/);
  for (const module of modules) {
    const absent = new Map(sources); absent.delete(module);
    assert.throws(() => assertBaselineSources(absent, sources), /module inventory/);
    const changed = new Map(sources); changed.set(module, Buffer.concat([sources.get(module), Buffer.from('\n')]));
    assert.throws(() => assertBaselineSources(changed, sources), /immutable positive source/);
  }
});

test('every independent semantic wire corpus row is accepted or rejected', () => {
  const rows = [{id: 'first-row'}, {id: 'second-row'}], output = 'PASS first-row\nPASS second-row\nPASS 2 complete semantic vectors twice\n';
  verifyNativeInventory(output, rows);
  for (const changed of ['', output.replace('PASS first-row\n', ''), output + 'PASS extra\n',
    output.replace('PASS second-row', 'PASS first-row'), 'PASS 2 complete semantic vectors twice\n'])
    assert.throws(() => verifyNativeInventory(changed, rows));
  const seen = new Set();
  for (const {id, request, response} of corpus()) {
    assert.ok(!seen.has(id)); seen.add(id);
    if (Buffer.from(request).equals(Buffer.from(response))) {
      const decoded = decodeSemanticPresentation(request);
      assert.deepEqual(encodeSemanticPresentation(decoded), request, id);
      assert.ok(Object.isFrozen(decoded) && Object.isFrozen(decoded[1][6]), id);
    } else assert.throws(() => decodeSemanticPresentation(request), PresentationError, id);
  }
  assert.equal(seen.size, 150);
});

test('catalogue authority is independent of frame-local reference bounds', () => {
  assert.equal(semanticCatalogueFits(fixture(), 10, 1), true);
  assert.equal(semanticCatalogueFits(fixture(), 8, 1), false);
  assert.equal(semanticCatalogueFits(fixture(), 9, 1), false, 'base heading caption is catalogue-bound');
  assert.equal(semanticCatalogueFits(fixture(), 10, 0), false);
  const frame = fixture(); frame[2] = 1;
  assert.equal(semanticCatalogueFits(frame, 10, 1), false);
  assert.equal(semanticMainNode(fixture()), 1);
});

test('immutable design capture rejects malformed and out-of-range tokens', () => {
  const original = structuredClone(designs), captured = captureDesignCatalogue(original);
  original[0][0][0] = 0;
  assert.equal(captured[0][0][0], 0xffffff); assert.ok(Object.isFrozen(captured[0][0]));
  const bounds = [[0, 16777215], [0, 16777215], [0, 16777215], [0, 16777215],
    [0, 16777215], [0, 16777215], [0, 16777215], [0, 2], [1000, 4000],
    [1000, 3000], [0, 4000], [0, 4000], [16, 120], [8, 40], [20, 100], [24, 96]];
  for (let index = 0; index < bounds.length; index++) for (const value of [bounds[index][0] - 1, bounds[index][1] + 1, 0.5, NaN, '0']) {
    const invalid = structuredClone(designs); invalid[0][0][index] = value;
    assert.throws(() => captureDesignCatalogue(invalid), PresentationError, `token ${index}`);
  }
  for (const value of [[], Array(17).fill(designs[0]), [light], [[light]], [[light, light, light]], [[light.slice(1), light]]]) {
    assert.throws(() => captureDesignCatalogue(value), PresentationError);
  }
  let calls = 0; const tokens = [...light];
  Object.defineProperty(tokens, '0', {get() { calls++; return 0; }});
  assert.throws(() => captureDesignCatalogue([[tokens, light]]), PresentationError); assert.equal(calls, 0);
  const hole = [...light]; delete hole[3];
  assert.throws(() => captureDesignCatalogue([[hole, light]]), PresentationError);
  const injected = [...light]; injected.css = 'url(https://untrusted.invalid)';
  assert.throws(() => captureDesignCatalogue([[injected, light]]), PresentationError);
  for (const scope of ['', 'arbitrary', 'prismpm-semantic-1"]{background:red}']) {
    assert.throws(() => semanticStyle(scope, designs[0], 0), PresentationError);
  }
  assert.throws(() => semanticStyle('prismpm-semantic-1', [injected, light], 0), PresentationError);
  assert.throws(() => semanticStyle('prismpm-semantic-1', designs[0], 3), PresentationError);
});

test('semantic frame keeps exact aggregate bound and strict progress revision', () => {
  const bytes = encodeWire(fixture());
  assert.deepEqual(decodeSemanticPresentation(bytes, bytes.length), fixture());
  assert.throws(() => decodeSemanticPresentation(bytes, bytes.length - 1), PresentationError);
  assert.equal(semanticProgressFits(fixture(), fixture()), false);
  const pending = fixture(2); pending[1][2] = 1;
  pending[1][6][3][1][2] = false; pending[1][6][4][1][2] = false; pending[1][6][5][1][3] = false;
  assert.equal(semanticProgressFits(fixture(), pending), true);
});
