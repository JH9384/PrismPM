import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {labels, designs, sourceFixture} from './corpus.mjs';
import {maximumIds} from './maximum-fixtures.mjs';

const require = createRequire(new URL('../../sdk/oracles/package.json', import.meta.url));
const oracleSearch = {paths: [new URL('../../sdk/oracles/', import.meta.url).pathname, '/opt/prismpm/oracles']};
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const roles = ['wire', 'semantic', 'fixture', 'labels', 'designs', 'intent', 'catalogue', 'size'];
export const journeyNames = Object.freeze(['source-names', 'selection', 'reorder-filter', 'default-epoch',
  'stale-text', 'annotations', 'lifecycle-kind']);
const initialRoles = ['fixture', 'labels', 'designs', 'semantic', 'catalogue'];
const expectedRoles = Object.freeze(Object.fromEntries(journeyNames.map(name => [name,
  [...initialRoles, ...(name === 'selection' ? ['intent', 'semantic'] :
    Array.from({length: ({'reorder-filter': 2, 'default-epoch': 3, annotations: 1, 'lifecycle-kind': 2})[name] ?? 0},
      () => ['semantic', 'catalogue']).flat())]])));

export async function journey(build = null, selected = journeyNames, replacements = {}) {
  assert.ok(selected.length && selected.every(name => journeyNames.includes(name)));
  build?.unchanged();
  const generated = build ? Object.fromEntries(roles.map(role => [role,
    build.withWasm(role, bytes => [...bytes])])) : null;
  const sources = Object.fromEntries(['presentation-dom.mjs', 'presentation-wire.mjs', 'identity.mjs',
    'semantic-presentation-wire.mjs', 'semantic-presentation-style.mjs'].map(name => [name,
    readFileSync(new URL('../../sdk/browser/' + name, import.meta.url), 'utf8')]));
  for (const [name, source] of Object.entries(replacements)) {
    assert.ok(Object.hasOwn(sources, name)); sources[name] = source;
  }
  const calls = [], cases = [], audits = [];
  try {
    await withBrowser(async ({browser, baseURL}) => {
      for (const name of selected) {
        const page = await browser.newPage();
        try {
          for (const [name, body] of Object.entries(sources)) await page.route('**/' + name,
            route => route.fulfill({status: 200, contentType: 'text/javascript', body}));
          await page.goto(baseURL);
          await page.evaluate(async ({generated, labels, designs, initial}) => {
            document.documentElement.lang = 'en';
            const dom = await import('./presentation-dom.mjs'), wire = await import('./presentation-wire.mjs');
            const semantic = await import('./semantic-presentation-wire.mjs');
            const observed = [], dispatches = [], hex = bytes => Array.from(bytes,
              value => value.toString(16).padStart(2, '0')).join('');
            const check = (condition, message) => { if (!condition) throw Error(message); };
            function execute(role, input, expected) {
              if (!generated) return expected;
              const module = new WebAssembly.Module(Uint8Array.from(generated[role]));
              check(WebAssembly.Module.imports(module).length === 0, 'import-free generated choice oracle');
              const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
              const pointer = holo_alloc(input.length) >>> 0;
              new Uint8Array(memory.buffer, pointer, input.length).set(input);
              const packed = BigInt.asUintN(64, holo_run(pointer, input.length));
              const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
              check(length <= 67108864 && at + length <= memory.buffer.byteLength
                && memory.buffer.byteLength <= 1073741824, 'bounded generated choice result');
              const output = new Uint8Array(memory.buffer, at, length).slice();
              observed.push({role, request: hex(input), response: hex(output), memory: memory.buffer.byteLength});
              check(hex(output) === hex(expected), 'exact generated choice oracle ' + role);
              return output;
            }
            const fixture = execute('fixture', wire.encodeWire([1, 1, 0, 0]), wire.encodeWire(initial));
            const actualLabels = execute('labels', new Uint8Array(), new TextEncoder().encode(JSON.stringify(labels)));
            labels = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(actualLabels));
            designs = semantic.decodeDesignCatalogue(execute('designs', new Uint8Array(), wire.encodeWire(designs)));
            const root = document.createElement('div'); document.body.append(root);
            let current = initial;
            const view = dom.openSemanticPresentation({root, labels, designs, maximum: 67108864,
              requestMaximum: 67108864, dispatch(bytes) {
                const intent = wire.decodeIntent(bytes);
                execute('intent', wire.encodeWire([current[1], intent]), Uint8Array.of(245));
                dispatches.push(intent);
                const next = structuredClone(current); next[1][1]++; next[1][2] = 1;
                next[1][6][2][1][2] = false; next[1][6][3][1][3] = false;
                const output = execute('semantic', wire.encodeWire(next), wire.encodeWire(next)); current = next;
                return output;
              }});
            function render(next) {
              const bytes = wire.encodeWire(next);
              const output = execute('semantic', bytes, bytes);
              execute('catalogue', output, Uint8Array.of(245));
              view.render(output); current = next;
            }
            execute('semantic', fixture, fixture); execute('catalogue', fixture, Uint8Array.of(245));
            view.render(fixture);
            globalThis.choiceTest = {root, view, wire, semantic, observed, dispatches,
              frame: initial, render, check, execute};
          }, {generated, labels, designs, initial: sourceFixture()});
          const select = page.getByRole('combobox', {name: 'Choose organization', exact: true});
          assert.equal(await select.inputValue(), '42', 'initial source selection');
          if (name === 'source-names') {
            assert.equal(await select.getByRole('option', {name: 'Shared name', exact: true}).count(), 2,
              'duplicate accessible names remain distinct options');
            assert.deepEqual(await select.locator('option').evaluateAll(options => options.map(option =>
              [option.value, option.textContent])), [['', ''], ['42', 'Shared name'], ['7', 'Shared name'],
              ['9', '<svg onload="bad()">😀</svg>']], 'plain option names and source order');
            assert.equal(await page.locator('svg,img,script').count(), 0, 'hostile names never become markup');
          } else if (name === 'selection') {
            await select.selectOption('7'); await page.getByRole('button', {name: 'Continue', exact: true}).click();
            await page.waitForFunction(() => globalThis.choiceTest.dispatches.length === 1);
            assert.deepEqual(await page.evaluate(() => globalThis.choiceTest.dispatches[0]),
              [1, 1, 1, [[3, 7]]], 'intent uses stable option ID');
            assert.equal(await select.isDisabled(), true, 'pending disables modeled choice');
          } else if (name === 'reorder-filter') {
            await select.selectOption('7');
            await page.evaluate(() => {
              const {frame, render} = globalThis.choiceTest; frame[1][1]++;
              frame[1][6][2][1][5].reverse(); render(frame);
            });
            assert.equal(await select.inputValue(), '7', 'edited selection survives option reorder');
            await page.evaluate(() => {
              const {frame, render} = globalThis.choiceTest; frame[1][1]++;
              frame[1][6][2][1][5] = frame[1][6][2][1][5].filter(([id]) => id !== 7); render(frame);
            });
            assert.equal(await select.inputValue(), '42', 'removed choice falls back to source default');
          } else if (name === 'default-epoch') {
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; frame[1][6][2][1][5].reverse(); render(frame); });
            assert.equal(await select.inputValue(), '42', 'unedited source default survives reorder');
            await select.selectOption('7');
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; frame[1][6][2][1][6]++; render(frame); });
            assert.equal(await select.inputValue(), '42', 'draft epoch resets edited choice');
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; frame[1][6][2][1][4] = 9; render(frame); });
            assert.equal(await select.inputValue(), '9', 'changed source default resets choice');
          } else if (name === 'stale-text') {
            const result = await page.evaluate(() => {
              const {frame, view, wire, root} = globalThis.choiceTest, changed = structuredClone(frame);
              const before = root.innerHTML; changed[1][6][2][1][5][0][1] = 'Different';
              let code; try { view.render(wire.encodeWire(changed)); } catch (error) { code = error.code; }
              return {code, unchanged: root.innerHTML === before};
            });
            assert.deepEqual(result, {code: 'stale', unchanged: true}, 'equal-revision changed text rejected before mutation');
          } else if (name === 'annotations') {
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; frame[5][1][3] = 5; render(frame); });
            assert.equal(await select.getAttribute('aria-invalid'), 'true', 'dynamic choice exposes modeled invalid state');
            assert.deepEqual(await select.evaluate(control => control.getAttribute('aria-describedby').split(' ')
              .map(id => document.getElementById(id).textContent)),
            ['Choose an organization.', 'Choose an available organization.'], 'dynamic helper and error association');
            const specification = JSON.parse(readFileSync(new URL('../../model/browser-semantic-presentation-oracles.json', import.meta.url)));
            assert.equal(require(require.resolve('axe-core/package.json', oracleSearch)).version, specification.engine.version);
            const axePath = require.resolve('axe-core/axe.min.js', oracleSearch), axe = readFileSync(axePath);
            assert.equal(sha(axe), specification.engine.sha256, 'exact imported axe oracle');
            await page.addScriptTag({content: axe.toString('utf8')});
            const result = await page.evaluate(async () => globalThis.axe.run(document, {
              runOnly: {type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']},
            }));
            assert.deepEqual(result.violations, [], 'actual dynamic-choice accessibility oracle violations');
            audits.push({engine: result.testEngine, incomplete: result.incomplete, passes: result.passes.map(row => row.id)});
          } else if (name === 'lifecycle-kind') {
            await select.selectOption('7');
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; const choice = frame[1][6][2][1]; choice[0] = 7;
              choice[4] = 2; choice[5] = [[1, 0], [2, 2]]; render(frame); });
            assert.equal(await select.inputValue(), '2', 'changed field kind cannot retain dynamic draft');
            await page.evaluate(() => { const {frame, render} = globalThis.choiceTest;
              frame[1][1]++; const choice = frame[1][6][2][1]; choice[0] = 11;
              choice[4] = 42; choice[5] = [[42, '\uFEFFExact label'], [7, 'Other']]; render(frame); });
            assert.equal(await select.inputValue(), '42', 'restored dynamic field uses source default');
            assert.equal(await select.locator('option[value="42"]').textContent(), '\uFEFFExact label', 'name bytes preserve BOM');
            await page.evaluate(() => globalThis.choiceTest.view.close());
            assert.equal(await page.locator('select').count(), 0, 'closed view removes dynamic controls');
          }
          cases.push(name);
        } finally {
          const observed = await page.evaluate(() => globalThis.choiceTest?.observed ?? []);
          for (const call of observed) calls.push({...call, journey: name});
          await page.close();
        }
      }
    });
    assert.deepEqual(cases, selected, 'exact closed journey inventory');
    for (const name of selected) assert.deepEqual(calls.filter(call => call.journey === name).map(call => call.role),
      build ? expectedRoles[name] : [], 'exact observed generated call inventory ' + name);
    return {modelChecked: Boolean(build), cases, calls, audits};
  } catch (error) {
    error.choiceCalls = calls; throw error;
  } finally { build?.unchanged(); }
}

export async function verifyMutants(build = null) {
  const original = readFileSync(new URL('../../sdk/browser/presentation-dom.mjs', import.meta.url), 'utf8');
  const mutants = [
    ['option-id', "option.value = String(optionId);", "option.value = String(options.length);", 'source-names', 'initial source selection'],
    ['plain-text', "element('option', tag === 11 ? title : label(title))", "element('option', tag === 11 ? 'replaced' : label(title))", 'source-names', 'duplicate accessible names remain distinct options'],
    ['draft', 'const preserve = retained && record.defaultValue', 'const preserve = tag !== 11 && retained && record.defaultValue', 'reorder-filter', 'edited selection survives option reorder'],
    ['epoch', 'record.draftEpoch === content[6]', '(tag === 11 || record.draftEpoch === content[6])', 'default-epoch', 'draft epoch resets edited choice'],
    ['field-errors', '[5, 6, 7, 10, 11].includes(tag)', '[5, 6, 7, 10].includes(tag)', 'annotations', 'dynamic choice exposes modeled invalid state'],
  ];
  const calls = [];
  for (const [name, before, after, selected, message] of mutants) {
    assert.equal(original.split(before).length, 2, 'exact renderer mutation site ' + name);
    await assert.rejects(journey(build, [selected], {'presentation-dom.mjs': original.replace(before, after)}),
      error => {
        if (error.code !== 'ERR_ASSERTION' || !error.message.includes(message)) return false;
        const observed = error.choiceCalls ?? [];
        const expected = ({'option-id': 5, 'plain-text': 5, draft: 7, epoch: 9, 'field-errors': 7})[name];
        assert.equal(observed.length, build ? expected : 0, 'closed failed-journey transcript ' + name);
        calls.push(...observed.map(call => ({...call, mutation: name}))); return true;
      }, name + ' intended semantic assertion');
  }
  return {names: mutants.map(([name]) => name), calls};
}

export async function maximumJourney(build) {
  build.unchanged();
  const sources = Object.fromEntries(['presentation-dom.mjs', 'presentation-wire.mjs', 'identity.mjs',
    'semantic-presentation-wire.mjs', 'semantic-presentation-style.mjs'].map(name => [name,
    readFileSync(new URL('../../sdk/browser/' + name, import.meta.url), 'utf8')]));
  sources['combined-maximum-fixtures.mjs'] = readFileSync(new URL('../browser-presentation/maximum-fixtures.mjs', import.meta.url), 'utf8');
  sources['dynamic-maximum-fixtures.mjs'] = readFileSync(new URL('./maximum-fixtures.mjs', import.meta.url), 'utf8')
    .replace('../../sdk/browser/presentation-wire.mjs', './presentation-wire.mjs')
    .replace('../browser-presentation/maximum-fixtures.mjs', './combined-maximum-fixtures.mjs');
  const generated = Object.fromEntries(['wire', 'semantic', 'labels', 'designs'].map(role => [role,
    build.withWasm(role, bytes => [...bytes])]));
  const results = [], calls = [];
  try {
    await withBrowser(async ({browser, baseURL}) => {
      for (const id of maximumIds) {
        const page = await browser.newPage();
        try {
          for (const [name, body] of Object.entries(sources)) await page.route('**/' + name,
            route => route.fulfill({status: 200, contentType: 'text/javascript', body}));
          await page.goto(baseURL);
          const result = await page.evaluate(async ({id, generated}) => {
            const {maximumFrame} = await import('./dynamic-maximum-fixtures.mjs');
            const dom = await import('./presentation-dom.mjs');
            const semantic = await import('./semantic-presentation-wire.mjs');
            const row = maximumFrame(id), calls = [], observations = [];
            const check = (value, message) => { if (!value) throw Error(message); };
            const hex = bytes => Array.from(bytes, x => x.toString(16).padStart(2, '0')).join('');
            const hash = async bytes => hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
            function execute(role, input) {
              const module = new WebAssembly.Module(Uint8Array.from(generated[role]));
              check(WebAssembly.Module.imports(module).length === 0, 'import-free maximum guest');
              const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
              const pointer = holo_alloc(input.length) >>> 0;
              check(pointer + input.length <= memory.buffer.byteLength, 'maximum input allocation');
              new Uint8Array(memory.buffer, pointer, input.length).set(input);
              const packed = BigInt.asUintN(64, holo_run(pointer, input.length));
              const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
              check(length <= 67108864 && at + length <= memory.buffer.byteLength
                && memory.buffer.byteLength <= 1073741824, 'bounded maximum generated output');
              return {bytes: new Uint8Array(memory.buffer, at, length).slice(), memory: memory.buffer.byteLength};
            }
            function small(role) {
              const out = execute(role, new Uint8Array());
              calls.push({role, request: '', response: hex(out.bytes), memory: out.memory}); return out.bytes;
            }
            const labels = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(small('labels')));
            const designs = semantic.decodeDesignCatalogue(small('designs'));
            const requestHash = await hash(row.bytes);
            let output;
            for (let repeat = 0; repeat < 2; repeat++) {
              const result = execute(row.role, row.bytes), responseHash = await hash(result.bytes);
              check(result.bytes.length === 67108864 && requestHash === responseHash, 'exact maximum generated bytes');
              observations.push({repeat, role: row.role, request: requestHash, response: responseHash,
                length: result.bytes.length, memory: result.memory}); output = result.bytes;
            }
            const root = document.createElement('div'); document.body.append(root);
            const options = {root, labels, maximum: 67108864, requestMaximum: 67108864,
              dispatch() { throw Error('no synthetic maximum dispatch'); }};
            const view = row.role === 'semantic' ? dom.openSemanticPresentation({...options, designs}) : dom.openPresentation(options);
            view.render(output);
            const control = root.querySelector('[data-presentation-node="32"] select')
              ?? root.querySelector('select');
            check(control.value === '4294967295', 'maximum stable selection');
            const choices = [...control.options].filter(option => option.value !== '');
            check(choices.length === (id.includes('Mixed') ? 255 : 256), 'maximum dynamic option count');
            check(choices.every((option, index) => option.value === String(4294967295 - index)
              && new TextEncoder().encode(option.textContent).length === 4096), 'maximum names and source order');
            check(root.querySelector(row.selector).textContent.length === row.payload, 'actual maximum payload rendered');
            const previous = root.firstChild;
            let refused;
            try { view.render(new Uint8Array(67108865)); } catch (error) { refused = error.code; }
            check(refused === 'bytes' && root.firstChild === previous
              && root.querySelector(row.selector).textContent.length === row.payload, 'one-over refuses before DOM mutation');
            const over = new WebAssembly.Instance(new WebAssembly.Module(Uint8Array.from(generated[row.role])), {});
            let trapped = false;
            try { over.exports.holo_alloc(67108865); } catch (error) { trapped = error instanceof WebAssembly.RuntimeError; }
            check(trapped, 'actual maximum guest rejects one-over allocation');
            view.close(); check(root.childNodes.length === 0, 'maximum view closes');
            return {id, observations, calls, payload: row.payload};
          }, {id, generated});
          results.push({id: result.id, observations: result.observations, payload: result.payload});
          calls.push(...result.calls.map(call => ({...call, journey: id})));
        } finally { await page.close(); }
      }
    });
    assert.deepEqual(results.map(row => row.id), maximumIds);
    assert.equal(calls.length, maximumIds.length * 2);
    return {results, calls};
  } finally { build.unchanged(); }
}
