// Independent component probes only. The registered owner must additionally
// provide source-produced frames/catalogues and actual native/Wasm parity.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {maximumCases} from './maximum-fixtures.mjs';
import {withBrowser as realBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {openSemanticPresentation} from '../../sdk/browser/presentation-dom.mjs';
import {PresentationError} from '../../sdk/browser/presentation-wire.mjs';
import {fixture, labels, designs} from './corpus.mjs';

const cases = [];
const test = (name, run) => cases.push({name, run});
const DOM_CASE = 'actual DOM exposes names, purposes, descriptions, validation and skip target';
const LAYOUT_CASE = 'actual source-bound layout reflows, changes appearance and retains forced-color focus';
const PREFLIGHT_CASE = 'complete metadata preflight is atomic and changed equal revision cannot replace context';
const ORACLE_CASE = 'actual imported axe oracle audits rendered component and detects broken contrast and labels';
const semanticFailures = new WeakMap();
export const engines = Object.freeze(['chromium', 'firefox', 'webkit']);
let active;
function semanticEqual(check, actual, expected) {
  try { assert.deepEqual(actual, expected); }
  catch (cause) {
    const error = new Error('semantic counterexample: ' + check, {cause});
    semanticFailures.set(error, Object.freeze({case:active.currentCase, check, actual, expected}));
    throw error;
  }
}
async function withBrowser(callback) {
  return realBrowser(async context => {
    const result = await callback(context);
    for (const page of context.browser.contexts().flatMap(context => context.pages())) {
      const calls = await page.evaluate(() => globalThis.semanticTest?.observed ?? []);
      active.calls.push(...calls.map(row => ({...row, case:active.currentCase})));
    }
    return result;
  }, {engine: active.engine});
}

async function setup(page, baseURL, frame = fixture()) {
  for (const [name, source] of Object.entries(active.replacements)) {
    await page.route('**/' + name, route => route.fulfill({status: 200, contentType: 'text/javascript', body: source}));
  }
  await page.goto(baseURL);
  await page.evaluate(async ({frame, labels, designs, generated}) => {
    document.documentElement.lang = 'en';
    const dom = await import('./presentation-dom.mjs'), wire = await import('./presentation-wire.mjs');
    const observed = [];
    const hex = bytes => Array.from(bytes, value => value.toString(16).padStart(2, '0')).join('');
    function execute(role, input) {
      const module = new WebAssembly.Module(Uint8Array.from(generated[role]));
      if (WebAssembly.Module.imports(module).length) throw Error('generated oracle has imports');
      const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
      const pointer = holo_alloc(input.length) >>> 0;
      new Uint8Array(memory.buffer, pointer, input.length).set(input);
      const packed = BigInt.asUintN(64, holo_run(pointer, input.length));
      const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
      if (length > 67108864 || at + length > memory.buffer.byteLength || memory.buffer.byteLength > 1073741824) throw Error('unbounded generated output');
      const output = new Uint8Array(memory.buffer, at, length).slice();
      observed.push({role, request: hex(input), response: hex(output), memory: memory.buffer.byteLength});
      return output;
    }
    if (generated) {
      const rendered = execute('fixture', wire.encodeWire([1, 1, 0, 0]));
      const expected = generated.baseline;
      if (hex(rendered) !== hex(wire.encodeWire(expected))) throw Error('actual source-produced baseline differs');
      const actualLabels = JSON.parse(new TextDecoder('utf8', {fatal: true}).decode(execute('labels', new Uint8Array())));
      if (JSON.stringify(actualLabels) !== JSON.stringify(labels)) throw Error('actual source-produced labels differ');
      labels = actualLabels;
      const {decodeDesignCatalogue} = await import('./semantic-presentation-wire.mjs');
      const actualDesigns = decodeDesignCatalogue(execute('designs', new Uint8Array()));
      if (JSON.stringify(actualDesigns) !== JSON.stringify(designs)) throw Error('actual typed source-produced designs differ');
      designs = actualDesigns;
    }
    const root = document.createElement('div'); document.body.append(root);
    let settle;
    const calls = [], dispatch = (bytes, token) => {
      calls.push({intent: wire.decodeIntent(bytes), token});
      return new Promise(resolve => { settle = resolve; });
    };
    const originalView = dom.openSemanticPresentation({root, labels, designs, dispatch,
      secretDispatch: dispatch, maximum: 67108864, requestMaximum: 67108864});
    const view = {render(bytes) {
      if (generated) execute('wire', bytes);
      originalView.render(bytes);
    }, close: () => originalView.close()};
    view.render(wire.encodeWire(frame));
    globalThis.semanticTest = {view, root, frame, calls, wire, dom, observed, originalView,
      observe: bytes => { if (generated) execute('wire', bytes); return bytes; }, settle: bytes => settle(bytes)};
  }, {frame, labels, designs, generated: active.build ? {
    ...Object.fromEntries([['wire', 'a'], ['fixture', 'fixture'], ['labels', 'labels'], ['designs', 'designs']]
      .map(([name, role]) => [name, active.build.withWasm(role, bytes => [...bytes])])), baseline: fixture(),
  } : null});
}

test('semantic entry rejects accessor catalogues and open option extensions', () => {
  let calls = 0;
  const options = Object.defineProperty({}, 'designs', {get() { calls++; throw Error('payload'); }});
  assert.throws(() => openSemanticPresentation(options), PresentationError);
  assert.equal(calls, 0);
  assert.throws(() => openSemanticPresentation(null), PresentationError);
  assert.throws(() => openSemanticPresentation({}, 1), PresentationError);
});

test(DOM_CASE, async () => {
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), frame = fixture(); frame[5][2][3] = 5;
    await setup(page, baseURL, frame);
    semanticEqual('main-landmark', await page.getByRole('main').count(), 1);
    assert.equal(await page.getByRole('heading', {level: 1, name: 'Welcome'}).count(), 1);
    semanticEqual('email-autocomplete', await page.getByLabel('Email', {exact: true}).getAttribute('autocomplete'), 'email');
    semanticEqual('email-type', await page.getByLabel('Email', {exact: true}).getAttribute('type'), 'text');
    assert.equal(await page.getByLabel('Email', {exact: true}).getAttribute('inputmode'), 'email');
    assert.equal(await page.getByLabel('Recovery code', {exact: true}).getAttribute('autocomplete'), 'one-time-code');
    assert.equal(await page.getByLabel('Recovery code', {exact: true}).getAttribute('type'), 'password');
    const result = await page.evaluate(() => {
      const {root} = semanticTest, input = root.querySelector('input');
      return {invalid: input.getAttribute('aria-invalid'),
        descriptions: input.getAttribute('aria-describedby').split(' ').map(id => document.getElementById(id).textContent),
        error: document.getElementById(input.getAttribute('aria-errormessage'))?.textContent ?? null,
        sameTarget: root.querySelector('a').hash === '#' + root.querySelector('[role="main"]').id};
    });
    semanticEqual('error-associations', result, {invalid: 'true', descriptions: [labels[3].text, labels[4].text],
      error: labels[4].text, sameTarget: true});
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Skip to main content');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => document.activeElement.getAttribute('role') === 'main');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.getAttribute('autocomplete')), 'email');
  });
});

test(LAYOUT_CASE, async () => {
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage({viewport: {width: 1280, height: 720}}), frame = fixture();
    frame[5][1][5] = 3;
    await setup(page, baseURL, frame);
    semanticEqual('wide-layout-columns', await page.locator('form').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 2);
    await page.setViewportSize({width: 320, height: 640});
    assert.equal(await page.locator('form').evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length), 1);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '320 CSS px has no horizontal overflow');
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), '200% root text remains reflowable');
    assert.equal(await page.getByRole('button', {name: 'Continue'}).isVisible(), true);
    await page.emulateMedia({colorScheme: 'dark'});
    assert.equal(await page.evaluate(() => getComputedStyle(semanticTest.root).backgroundColor), 'rgb(18, 18, 18)');
    await page.emulateMedia({colorScheme: 'light'});
    assert.equal(await page.evaluate(() => getComputedStyle(semanticTest.root).backgroundColor), 'rgb(255, 255, 255)');
    await page.emulateMedia({forcedColors: 'active'});
    await page.getByLabel('Email', {exact: true}).focus();
    assert.equal(await page.getByLabel('Email', {exact: true}).evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    assert.ok(await page.getByRole('button', {name: 'Continue'}).evaluate(node => node.getBoundingClientRect().height >= 44));
  });
});

test('ordinary email and ephemeral recovery bytes survive native keyboard capture exactly', async () => {
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(); await setup(page, baseURL);
    await page.getByLabel('Email', {exact: true}).fill(' user@example.invalid ');
    await page.getByLabel('Recovery code', {exact: true}).fill('recovery synthetic secret');
    await page.getByLabel('Recovery code', {exact: true}).press('Enter');
    await page.waitForFunction(() => semanticTest.calls.length === 1);
    assert.deepEqual(await page.evaluate(() => semanticTest.calls[0].intent),
      [1, 1, 1, [[4, ' user@example.invalid '], [5, 'recovery synthetic secret']]]);
    assert.equal(await page.getByLabel('Recovery code', {exact: true}).inputValue(), '');
    assert.ok(!(await page.content()).includes('recovery synthetic secret'));
    assert.equal(await page.evaluate(() => {
      const target = semanticTest.root.querySelector('input[type=password]');
      const paste = new Event('paste', {bubbles: true, cancelable: true});
      return target.dispatchEvent(paste);
    }), true, 'adapter does not block native paste');
  });
});

test(PREFLIGHT_CASE, async () => {
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(); await setup(page, baseURL);
    await page.getByLabel('Recovery code', {exact: true}).fill('retained synthetic');
    const outcomes = await page.evaluate(() => {
      const {root, view, frame, wire} = semanticTest, before = root.outerHTML, outcomes = [];
      for (const change of [x => { x[2] = 1; }, x => { x[5][2][2] = 256; },
        x => { x[5][0][4] = 0; }, x => { x[5][2][1] = 6; }]) {
        const candidate = structuredClone(frame); candidate[1][1]++;
        change(candidate);
        let code = 'accepted', errorName = null;
        try { view.render(wire.encodeWire(candidate)); }
        catch (error) {
          if (error.name !== 'PresentationError') throw error;
          code = error.code; errorName = error.name;
        }
        outcomes.push({code, errorName, unchanged:root.outerHTML === before,
          secretRetained:root.querySelector('input[type=password]')?.value === 'retained synthetic'});
      }
      return outcomes;
    });
    assert.equal(outcomes.length, 4);
    for (const [at, code] of ['labels', 'labels', 'binding', 'binding'].entries())
      semanticEqual('catalogue-preflight-' + at, outcomes[at],
        {code, errorName:'PresentationError', unchanged:true, secretRetained:true});
    const equalRevision = await page.evaluate(() => {
      const {view, frame, wire} = semanticTest;
      const equal = structuredClone(frame); equal[5][2][3] = 5;
      try { view.render(wire.encodeWire(equal)); throw Error('same revision accepted'); }
      catch (error) { if (error.name !== 'PresentationError' || error.code !== 'stale') throw error; return error.code; }
    });
    assert.equal(equalRevision, 'stale');
    const context = await page.evaluate(() => {
      const {root, view, frame, wire} = semanticTest, held = root.querySelector('input[type=password]');
      const candidate = structuredClone(frame); candidate[1][1]++;
      candidate[5][3][1] = 6; view.render(wire.encodeWire(candidate));
      const cleared = held.value === ''; view.close();
      return {cleared, empty: root.childNodes.length === 0, released: !root.hasAttribute('data-semantic-presentation')};
    });
    assert.deepEqual(context, {cleared: true, empty: true, released: true});
  });
});

test('complete semantic progress binds metadata, revision and the actual one-use dispatcher', async () => {
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(); await setup(page, baseURL);
    await page.getByLabel('Email', {exact: true}).fill('person@example.invalid');
    await page.getByRole('button', {name: 'Continue'}).click();
    await page.waitForFunction(() => semanticTest.calls.length === 1);
    await page.evaluate(() => {
      const t = semanticTest, pending = structuredClone(t.frame); pending[1][1] = 2; pending[1][2] = 1;
      pending[1][6][3][1][2] = false; pending[1][6][4][1][2] = false; pending[1][6][5][1][3] = false;
      pending[5][2][3] = 5;
      t.dom.progressPresentation(t.originalView, t.calls[0].token, t.observe(t.wire.encodeWire(pending)));
      const final = structuredClone(t.frame); final[1][1] = 3;
      t.settle(t.observe(t.wire.encodeWire(final)));
    });
    await page.waitForFunction(() => !semanticTest.root.querySelector('button').disabled);
    assert.equal(await page.getByLabel('Email', {exact: true}).getAttribute('aria-errormessage'), null);
    assert.equal(await page.getByLabel('Recovery code', {exact: true}).inputValue(), '');
    const refused = await page.evaluate(() => {
      const t = semanticTest;
      try { t.dom.progressPresentation(t.originalView, t.calls[0].token, t.wire.encodeWire(t.frame)); }
      catch (error) { return error.code; }
    });
    assert.equal(refused, 'binding', 'a retired dispatcher cannot refresh semantic metadata');
  });
});

test(ORACLE_CASE, async t => {
  // Both source development and the installed SDK execute the exact pinned
  // engine bytes, never an ambient unversioned accessibility implementation.
  const pins = JSON.parse(readFileSync(new URL('../../model/browser-semantic-presentation-oracles.json', import.meta.url)));
  const locked = JSON.parse(readFileSync(new URL('../../sdk/oracles/package-lock.json', import.meta.url))).packages['node_modules/axe-core'];
  assert.equal(pins.capability, 'DK-38'); assert.equal(pins.complete_standard_acceptance, false);
  assert.equal(locked.version, pins.engine.version); assert.equal(locked.integrity, pins.engine.integrity);
  const require = createRequire(new URL('../../sdk/oracles/package.json', import.meta.url));
  const search = {paths: [new URL('../../sdk/oracles/', import.meta.url).pathname, '/opt/prismpm/oracles']};
  assert.equal(require(require.resolve('axe-core/package.json', search)).version, pins.engine.version);
  const source = readFileSync(require.resolve('axe-core/axe.min.js', search), 'utf8');
  assert.equal(createHash('sha256').update(source).digest('hex'), pins.engine.sha256);
  await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(); await setup(page, baseURL);
    await page.addScriptTag({content: source});
    const run = () => page.evaluate(async () => {
      const result = await axe.run(document);
      return {violations: result.violations.map(row => row.id),
        incomplete: result.incomplete.map(row => row.id), passes: result.passes.map(row => row.id)};
    });
    const valid = await run(); assert.deepEqual(valid.violations, []);
    assert.deepEqual(valid.incomplete, [], 'the actual component oracle must finish every selected check');
    assert.ok(valid.passes.includes('label') && valid.passes.includes('color-contrast'));
    t.diagnostic(JSON.stringify({scope: pins.scope, oracle: 'axe-core/4.13.0', sha256: pins.engine.sha256, ...valid}));
    async function checkPalette(colorScheme, disabled) {
      const palette = await page.evaluate(() => {
        const root = semanticTest.root;
        const system = name => {
          const probe = document.createElement('span'); probe.style.color = name; root.append(probe);
          const value = getComputedStyle(probe).color; probe.remove(); return value;
        };
        const buttonText = system('CanvasText'), buttonFace = system('Canvas');
        const fieldText = system('FieldText'), field = system('Field'), link = system('LinkText');
        const adjustmentSupport = {auto:CSS.supports('forced-color-adjust', 'auto'),
          none:CSS.supports('forced-color-adjust', 'none')};
        const adjustment = style => style.getPropertyValue('forced-color-adjust');
        const checks = [...root.querySelectorAll('button,input,textarea,select,a')].map(node => {
          const style = getComputedStyle(node), isButton = node.tagName === 'BUTTON', isLink = node.tagName === 'A';
          const foreground = node.disabled ? system('GrayText') : isButton ? buttonText : isLink ? link : fieldText;
          const background = isButton ? buttonFace : isLink ? undefined : field;
          return {tag:node.tagName, disabled:Boolean(node.disabled), foreground:style.color,
            fill:style.getPropertyValue('-webkit-text-fill-color'), actualBackground:style.backgroundColor,
            actualBorder:style.borderTopColor, actualAdjustment:adjustment(style),
            text:style.color === foreground && style.getPropertyValue('-webkit-text-fill-color') === foreground,
            background:background === undefined || style.backgroundColor === background,
            border:!isButton || (style.borderTopColor === foreground && style.borderTopStyle !== 'none'
              && Number.parseFloat(style.borderTopWidth) >= 1),
            adjustment:adjustment(style) === (adjustmentSupport.auto ? 'auto' : '')};
        });
        const borders = [...root.querySelectorAll('th,td')].map(node => getComputedStyle(node).borderTopColor);
        const errors = [...root.querySelectorAll('[data-presentation-error]')].map(node => getComputedStyle(node).color);
        // Observe the authored cascade with a deliberately unequal surface.
        // Only engines supporting adjustment can additionally isolate forced
        // repainting. All engines must detect the real rule-removal mutant.
        const before = root.innerHTML, originalControls = [...root.querySelectorAll('button,input,textarea,select,a')];
        const clone = root.querySelector('button').cloneNode(true); clone.removeAttribute('id'); clone.disabled = true;
        const sentinel = buttonFace === 'rgb(1, 2, 3)' ? 'rgb(4, 5, 6)' : 'rgb(1, 2, 3)';
        clone.style.setProperty('--sp-surface', sentinel); clone.style.forcedColorAdjust = 'none';
        let authoredBackground, cloneAdjustment, cloneSentinel;
        try {
          root.append(clone); const style = getComputedStyle(clone);
          cloneAdjustment = adjustment(style); cloneSentinel = style.getPropertyValue('--sp-surface') === sentinel;
          authoredBackground = style.backgroundColor === buttonFace;
        } finally {clone.remove();}
        const retained = [...root.querySelectorAll('button,input,textarea,select,a')];
        return {checks, adjustmentSupport, cloneAdjustment, cloneSentinel,
          text:checks.every(row=>row.text), background:checks.every(row=>row.background),
          buttonBorder:checks.every(row=>row.border),
          adjustment:checks.every(row=>row.adjustment)
            && retained.every((node,index)=>adjustment(getComputedStyle(node))===checks[index].actualAdjustment), controls:checks.length,
          disabledCount:root.querySelectorAll(':is(button,input,textarea,select):disabled').length,
          tags:[...root.querySelectorAll('button,input,textarea,select,a')].map(node=>node.tagName).sort(),
          borders, errors, canvasText:system('CanvasText'), authoredBackground,
          cloneRemoved:root.innerHTML === before && retained.length === originalControls.length
            && retained.every((node,index)=>node===originalControls[index])};
      });
      assert.equal(palette.controls, 6, 'all supported native form controls and local skip link observed');
      assert.deepEqual(palette.tags, ['A','BUTTON','INPUT','INPUT','SELECT','TEXTAREA']);
      assert.equal(palette.disabledCount, disabled ? 5 : 0, 'actual enabled and pending-disabled branches observed');
      semanticEqual('forced-system-palette', palette.text && palette.background && palette.buttonBorder, true);
      assert.equal(palette.adjustmentSupport.auto, palette.adjustmentSupport.none);
      assert.equal(palette.cloneAdjustment, palette.adjustmentSupport.none ? 'none' : '');
      assert.equal(palette.cloneSentinel, true); assert.equal(palette.cloneRemoved, true);
      semanticEqual('forced-authored-disabled-background', palette.authoredBackground, true);
      assert.equal(palette.background, true); assert.equal(palette.adjustment, true); assert.equal(palette.buttonBorder, true);
      assert.equal(palette.borders.length, 4); assert.ok(palette.borders.every(color=>color===palette.canvasText));
      assert.deepEqual(palette.errors, [palette.canvasText]);
      const forced = await run(); assert.deepEqual(forced.violations, []); assert.deepEqual(forced.incomplete, []);
      active.palettes.push({...palette, colorScheme, disabled, oracle:forced});
    }
    for (const [index, colorScheme] of ['light', 'dark'].entries()) {
      await page.emulateMedia({forcedColors:'active', colorScheme});
      await page.waitForFunction(() => matchMedia('(forced-colors:active)').matches);
      await page.evaluate(revision => {
        const t = semanticTest, frame = structuredClone(t.frame); frame[1][1] = revision;
        frame[1][6][3][1][5] = 'person@example.invalid'; frame[5][2][3] = 5;
        frame[1][6].push([3,[6,5,true,true,128,'Additional details',0]],
          [3,[7,0,true,false,1,[[1,0],[2,5]],0]],
          [1,[9,5,[2,7],[['Example mailbox','Example recovery']]]]);
        frame[5].push([7,0,0,0,0,0], [8,0,0,0,0,0]);
        t.view.render(t.wire.encodeWire(frame)); t.paletteFrame = frame;
        if (t.observed.length) {
          const row = t.observed.at(-1);
          if (row.role !== 'wire' || row.request !== row.response) throw Error('source must admit complete palette frame');
        }
      }, 2 + index * 3);
      await checkPalette(colorScheme, false);
      await page.getByLabel('Email', {exact:true}).focus();
      assert.equal(await page.getByLabel('Email', {exact:true}).evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
      await page.getByRole('button', {name:'Continue', exact:true}).click();
      await page.waitForFunction(count => semanticTest.calls.length === count, index + 1);
      await page.evaluate(() => {
        const t = semanticTest, pending = structuredClone(t.paletteFrame); pending[1][1]++; pending[1][2] = 1;
        for (const index of [3,4,6,7]) pending[1][6][index][1][2] = false;
        pending[1][6][5][1][3] = false;
        t.dom.progressPresentation(t.originalView, t.calls.at(-1).token, t.observe(t.wire.encodeWire(pending)));
        if (t.observed.length) {
          const row = t.observed.at(-1);
          if (row.role !== 'wire' || row.request !== row.response) throw Error('source must admit pending palette frame');
        }
      });
      await checkPalette(colorScheme, true);
      await page.evaluate(() => {
        const t = semanticTest, settled = structuredClone(t.paletteFrame); settled[1][1] += 2;
        t.settle(t.observe(t.wire.encodeWire(settled)));
      });
      await page.waitForFunction(() => !semanticTest.root.querySelector('button').disabled);
    }
    // The closed adapter exposes only a local skip link, not arbitrary URLs.
    // Its observable LinkText is covered; this does not claim visited-history evidence.
    await page.emulateMedia({forcedColors:'none', colorScheme:'light'});
    await page.evaluate(() => {
      const t = semanticTest, restored = structuredClone(t.frame); restored[1][1] = 8;
      t.view.render(t.wire.encodeWire(restored));
    });
    const restored = await run(); assert.deepEqual(restored, valid, 'normal modeled palette and oracle coverage are restored');
    await page.evaluate(() => {
      const {root} = semanticTest;
      root.querySelector('h1').style.color = '#eeeeee';
      const field = root.querySelector('input'); field.removeAttribute('aria-labelledby');
      field.parentElement.firstChild.remove();
      // Retain the input while removing every implicit label text source.
      field.parentElement.replaceWith(field);
    });
    const broken = await run();
    assert.ok(broken.violations.includes('label'), 'real external oracle detects actual missing accessible name');
    assert.ok(broken.violations.includes('color-contrast'), 'real external oracle detects actual unreadable modeled view');
  });
});

export const journeyNames = Object.freeze([
  'semantic entry rejects accessor catalogues and open option extensions', DOM_CASE, LAYOUT_CASE,
  'ordinary email and ephemeral recovery bytes survive native keyboard capture exactly', PREFLIGHT_CASE,
  'complete semantic progress binds metadata, revision and the actual one-use dispatcher', ORACLE_CASE,
]);
// Each browser journey executes one source fixture/labels/designs prefix.
// Exact wire calls: initial renders; six refused/changed preflight candidates;
// two progress/final frames; and seven forced-palette/restoration frames.
export const journeyCallInventory = Object.freeze([0,1,1,1,7,3,8].flatMap((count, index) => count === 0 ? []
  : ['fixture','labels','designs', ...Array(count).fill('wire')]
    .map(role => Object.freeze({case:journeyNames[index], role}))));

export function assertPaletteInventory(palettes) {
  assert.deepEqual(palettes.map(({colorScheme, disabled, disabledCount})=>[colorScheme, disabled, disabledCount]),
    [['light',false,0],['light',true,5],['dark',false,0],['dark',true,5]],
    'exact phase-bound palette observation inventory');
}

export async function journey(t, build = null, replacements = {}, engine = 'chromium') {
  assert.equal(active, undefined, 'private oracle execution is nonreentrant');
  assert.ok(engines.includes(engine), 'closed pinned semantic oracle engine');
  assert.deepEqual(cases.map(row=>row.name), journeyNames, 'exact registered semantic journeys');
  if (build) for (const key of ['wasmBytes', 'fixtureBytes', 'labelsBytes', 'designsBytes']) assert.ok(build[key]?.length, key);
  active = {build, calls: [], replacements, engine, palettes:[]};
  const completed = [];
  try {
    for (const {name, run} of cases) {
      active.currentCase = name;
      await run(t); completed.push(name);
    }
    assertPaletteInventory(active.palettes);
    return {engine, modelChecked: Boolean(build), cases: completed, calls: active.calls, palettes:active.palettes};
  } finally { active = undefined; }
}

export async function verifyMutants(t, build = null, engine = 'chromium') {
  // A missing oracle or broken environment must fail before any kill is counted.
  const baseline = await journey(t, build, {}, engine);
  assert.equal(baseline.cases.length, 7);
  assert.deepEqual(baseline.cases, cases.map(row => row.name));
  const file = new URL('../../sdk/browser/presentation-dom.mjs', import.meta.url), original = readFileSync(file, 'utf8');
  const mutants = [
    ['input purpose', DOM_CASE, 'email-autocomplete', 'off', "'name', 'organization', 'email', 'username'", "'name', 'organization', 'off', 'username'"],
    ['native byte preservation', DOM_CASE, 'email-type', 'email', "if (purpose === 4) control.inputMode = 'email';", "if (purpose === 4) control.type = 'email';"],
    ['error association', DOM_CASE, 'error-associations', {invalid:'true', descriptions:[labels[3].text, labels[4].text], error:null, sameTarget:true},
      "control.setAttribute('aria-errormessage', `${scope}-error-${id}`);", "control.removeAttribute('aria-errormessage');"],
    ['landmark semantics', DOM_CASE, 'main-landmark', 0, "if (landmark) record.element.setAttribute('role', ['', 'main', 'banner', 'complementary', 'contentinfo'][landmark]);", ''],
    ['catalogue preflight', PREFLIGHT_CASE, 'catalogue-preflight-0', {code:'design', errorName:'PresentationError', unchanged:false, secretRetained:false},
      "if (semantic && !semanticCatalogueFits(envelope, labels.length, designs.length)) fail('labels');", ''],
  ];
  const evidence = [];
  async function reject(name, caseName, check, observed, replacements) {
    let failure;
    try { await journey(t, build, replacements, engine); }
    catch (error) {
      failure = semanticFailures.get(error);
      if (!failure) throw new Error('unrelated failure cannot kill semantic ' + name, {cause:error});
    }
    assert.ok(failure, 'semantic mutant survived: ' + name);
    assert.equal(failure.case, caseName, 'exact expected semantic journey');
    assert.equal(failure.check, check, 'exact expected semantic check');
    assert.deepEqual(failure.actual, observed, 'exact expected semantic counterexample');
    evidence.push(Object.freeze({name, ...failure}));
    t.diagnostic('killed semantic ' + name + ' at ' + check);
  }
  for (const [name, caseName, check, observed, from, to] of mutants) {
    assert.equal(original.split(from).length, 2, 'one exact adapter mutation ' + name);
    await reject(name, caseName, check, observed, {'presentation-dom.mjs': original.replace(from, to)});
  }
  const styleFile = new URL('../../sdk/browser/semantic-presentation-style.mjs', import.meta.url), style = readFileSync(styleFile, 'utf8');
  assert.equal(style.split('@media(max-width:').length, 2);
  await reject('reflow', LAYOUT_CASE, 'wide-layout-columns', 1,
    {'semantic-presentation-style.mjs': style.replace('@media(max-width:', '@media(min-width:')});
  const systemButton = '${root} button{background:Canvas;color:CanvasText;border-color:CanvasText}';
  assert.equal(style.split(systemButton).length, 2);
  await reject('forced system palette', ORACLE_CASE, 'forced-system-palette', false,
    {'semantic-presentation-style.mjs': style.replace(systemButton, '')});
  const disabledBackground = '${root} button:disabled{background:Canvas}';
  assert.equal(style.split(disabledBackground).length, 2);
  await reject('forced disabled authored background', ORACLE_CASE, 'forced-authored-disabled-background', false,
    {'semantic-presentation-style.mjs': style.replace(disabledBackground, '')});
  assert.equal(readFileSync(file, 'utf8'), original); assert.equal(readFileSync(styleFile, 'utf8'), style);
  assert.equal(evidence.length, 8);
  return Object.freeze(evidence);
}

export async function verifyMaximum(t, build) {
  assert.ok(build?.wasmBytes);
  const paths = ['tests/browser-semantic-presentation/maximum-fixtures.mjs',
    'tests/browser-presentation/maximum-fixtures.mjs', ...['presentation-dom', 'presentation-wire',
      'semantic-presentation-wire', 'semantic-presentation-style', 'identity'].map(name => 'sdk/browser/' + name + '.mjs')];
  const results = await realBrowser(async ({browser, baseURL}) => {
    const observed = [];
    for (const id of maximumCases) {
      const page = await browser.newPage();
      for (const path of paths) await page.route('**/' + path, route => route.fulfill({status: 200,
        contentType: 'text/javascript', body: readFileSync(new URL('../../' + path, import.meta.url), 'utf8')}));
      await page.goto(baseURL);
      let timer;
      try {
        observed.push(await Promise.race([page.evaluate(async ({id, wasm, designs}) => {
          const {maximumShape} = await import('./tests/browser-semantic-presentation/maximum-fixtures.mjs');
          const {encodeWire} = await import('./sdk/browser/presentation-wire.mjs');
          const {openSemanticPresentation} = await import('./sdk/browser/presentation-dom.mjs');
          const shape = maximumShape(id), textLength = 67108864 - encodeWire(shape.value).length - 4;
          const text = 'x'.repeat(textLength); shape.setText(text);
          const request = encodeWire(shape.value);
          if (request.length !== 67108864) throw Error('exact aggregate maximum');
          const module = new WebAssembly.Module(Uint8Array.from(wasm));
          if (WebAssembly.Module.imports(module).length) throw Error('maximum imports');
          const {exports: {memory, holo_alloc, holo_run}} = new WebAssembly.Instance(module, {});
          const pointer = holo_alloc(request.length) >>> 0;
          new Uint8Array(memory.buffer, pointer, request.length).set(request);
          const packed = BigInt.asUintN(64, holo_run(pointer, request.length));
          const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
          if (length !== request.length || at + length > memory.buffer.byteLength || memory.buffer.byteLength > 1073741824) throw Error('bounded maximum response');
          const response = new Uint8Array(memory.buffer, at, length);
          if (!request.every((byte, index) => byte === response[index])) throw Error('maximum source equality');
          const digest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
          const requestHash = await digest(request), responseHash = await digest(response);
          const root = document.createElement('div'); document.body.append(root);
          const labels = Array.from({length: 256}, (_, i) => ({id: 'label' + String(i).padStart(3, '0'), text: 'Label ' + i}));
          const view = openSemanticPresentation({root, labels, designs: Array(16).fill(designs[0]),
            dispatch() { throw Error('maximum display does not dispatch'); }, maximum: 67108864, requestMaximum: 67108864});
          try {
            view.render(response);
            const content = root.querySelector(shape.selector);
            if (content?.textContent !== text) throw Error('complete maximum DOM text');
            view.render(response); if (root.querySelector(shape.selector) !== content) throw Error('maximum idempotence');
            let rejected = false;
            try { view.render(new Uint8Array(67108865)); } catch (error) { rejected = error.code === 'bytes'; }
            if (!rejected || root.querySelector(shape.selector) !== content) throw Error('maximum overrun atomic refusal');
            return {id, length, request: requestHash, response: responseHash, maximumBytes: memory.buffer.byteLength, modelChecked: true};
          } finally { view.close(); root.remove(); }
        }, {id, wasm: build.withWasm('a', bytes => [...bytes]), designs}),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('semantic maximum deadline')), 180000); })]));
      } finally { clearTimeout(timer); await page.close(); }
    }
    return observed;
  });
  assert.deepEqual(results.map(row => row.id), maximumCases);
  for (const row of results) {
    const native = build.maxima.find(value => value.id === row.id); assert.ok(native);
    assert.equal(row.length, native.length); assert.equal(row.request, native.request); assert.equal(row.response, native.response);
    assert.equal(row.modelChecked, true); t.diagnostic(JSON.stringify(row));
  }
  return results;
}
