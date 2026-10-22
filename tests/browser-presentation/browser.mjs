import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {maximumCases} from './maximum-fixtures.mjs';

const here = dirname(fileURLToPath(import.meta.url)), root = resolve(here, '../..');
const names = ['presentation-dom.mjs', 'presentation-wire.mjs', 'semantic-presentation-wire.mjs',
  'semantic-presentation-style.mjs', 'browser-fixture.mjs', 'maximum-fixtures.mjs'];
const path = name => join(['browser-fixture.mjs', 'maximum-fixtures.mjs'].includes(name) ? here : join(root, 'sdk/browser'), name);
const sha = value => createHash('sha256').update(value).digest('hex');
const closure = () => Object.fromEntries([...names.map(name => [name, path(name)]),
  ['identity.mjs', join(root, 'sdk/browser/identity.mjs')],
  ['browser-test-server.mjs', join(root, 'sdk/browser/browser-test-server.mjs')],
  ['browser.mjs', fileURLToPath(import.meta.url)],
].map(([name, path]) => [name, sha(readFileSync(path))]));
export const expectedCases = [
  'semantic-safe-text-catalogue-focus-live',
  'connected-atomic-status-lifecycle-and-idempotence',
  'full-validation-stale-and-secret-rejection-before-mutation',
  'keyed-edit-focus-reset-and-modeled-lifecycle',
  'source-owned-draft-reset-context-and-stale-response',
  'exact-default-bytes-and-native-edited-values',
  'required-utf8-request-bounds-and-choice-bindings',
  'serialized-reentrancy-stale-results-and-private-diagnostics',
  'terminal-close-listeners-late-result-and-root-ownership',
  'status-mount-and-retained-removal-failure-are-terminal',
  'native-byte-brands-detached-shared-and-closed-arity',
  'closed-options-and-immutable-catalogue-capture',
  'combined-structural-maxima-and-overruns',
  'private-dispatch-pending-progress-and-final-correlation',
  'source-progress-phase-revision-and-uint32-boundaries',
  'opaque-token-brands-foreign-pairs-and-terminal-revocation',
  'invalid-live-progress-atomic-preflight-and-own-result-revocation',
  'external-context-identical-refresh-and-terminal-phase-correlation',
  'diagnostics-belong-only-to-the-correlated-render-context',
  'progress-final-throw-reject-close-and-native-focus-retirement',
  'progress-reentrance-and-terminal-internal-dom-failure',
  'secret-sink-admission-and-closed-options',
  'secret-source-classification-capture-clearing-and-nonsecret-output',
  'secret-epoch-lifecycle-policy-removal-and-close-clearing',
  'secret-sink-failure-and-late-completion-no-echo',
  'ephemeral-secret-progress-with-nonsecret-final-result',
  'actual-native-keyboard-default-and-button-submission',
  'actual-native-password-keyboard-secret-submission',
];

export async function journey(build, replacements = {}, engine = 'chromium') {
  if (build) build.unchanged();
  try {return await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
      contentType: 'text/javascript', body: replacements[name] ?? readFileSync(path(name), 'utf8')}));
    await page.route(baseURL, route => route.fulfill({status: 200, headers: {
      'content-type': 'text/html', 'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    }, body: '<!doctype html><title>Private typed presentation acceptance</title>'}));
    await page.goto(baseURL);
    let timer;
    try {
      return await Promise.race([(async () => {
        const input = build ? {wire: [...build.wasmBytes], fixture: [...build.fixtureBytes], labels: [...build.labelsBytes],
          secret: [...build.secretBytes], route: [...build.routeBytes], sink: [...build.sinkBytes], progress: [...build.progressBytes]} : {adapterOnly: true};
        const initial = await page.evaluate(async input =>
          (await import('./browser-fixture.mjs')).runFixture(input), input);
        assert.equal(initial.modelChecked, Boolean(build), 'evidence level is explicit');
        const view = page.locator('[data-keyboard-presentation]');
        await view.getByLabel('Input', {exact: true}).fill('from real keyboard');
        await view.getByLabel('Input', {exact: true}).press('Enter');
        await page.waitForFunction(() => globalThis.__presentationJourney.count() === 1);
        await view.getByRole('button', {name: 'First', exact: true}).focus();
        await view.getByRole('button', {name: 'First', exact: true}).press('Enter');
        await page.waitForFunction(() => globalThis.__presentationJourney.count() === 2);
        const secret = page.locator('[data-keyboard-secret]');
        await secret.getByLabel('Input', {exact: true}).fill('synthetic keyboard secret');
        await secret.getByLabel('Input', {exact: true}).press('Enter');
        await page.waitForFunction(() => globalThis.__presentationJourney.secretCount() === 1);
        const result = await page.evaluate(() => globalThis.__presentationJourney.finish());
        assert.deepEqual(result.cases, expectedCases, 'every named DOM journey actually ran');
        assert.deepEqual(errors, [], 'no detached browser exceptions');
        assert.equal(result.keyboard[0][3][0][1], 'from real keyboard');
        return result;
      })(), new Promise((_, reject) => { timer = setTimeout(() => reject(Error('presentation browser journey deadline')), 90000); })]);
    } finally { clearTimeout(timer); }
  }, {engine});} finally {if (build) build.unchanged();}
}

export async function verifyJourneys(t, build, engine = 'chromium') {
  assert.ok(build?.wasmBytes && build?.fixtureBytes && build?.labelsBytes,
    'generated codec, modeled fixture and source catalogue are mandatory for owning acceptance');
  const before = closure(), result = await journey(build, {}, engine);
  assert.equal(result.modelChecked, true); assert.ok(result.calls.length > 0);
  assert.ok(result.maxMemory > 0 && result.maxMemory <= 16384 * 65536);
  assert.deepEqual(closure(), before, 'actual DOM and codec source closure remained frozen');
  t?.diagnostic(JSON.stringify({engine, cases: result.cases, calls: result.calls.length,
    maximum: result.maxMemory, sources: before}));
  return result;
}

export async function verifyMaximum(t, build) {
  assert.ok(build?.wasmBytes, 'generated codec is mandatory for maximum acceptance');
  build.unchanged();
  const before = closure();
  const results = await withBrowser(async ({browser, baseURL}) => {
    const observed = [];
    for (const id of maximumCases) {
      const page = await browser.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
        contentType: 'text/javascript', body: readFileSync(path(name), 'utf8')}));
      await page.goto(baseURL);
      let timer;
      try {
        const result = await Promise.race([
          page.evaluate(async input => (await import('./browser-fixture.mjs')).runMaximumFixture(input), {wire: [...build.wasmBytes], id}),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Error('presentation maximum browser deadline')), 180000); }),
        ]);
        assert.deepEqual(errors, []); assert.equal(result.id, id); observed.push(result);
      } finally { clearTimeout(timer); await page.close(); }
    }
    return observed;
  });
  assert.deepEqual(results.map(row => row.id), maximumCases);
  for (const result of results) {
    assert.equal(result.frame_length, 67108864);
    assert.equal(result.request_sha256, result.response_sha256);
    assert.ok(result.maximum_memory > 0 && result.maximum_memory <= 16384 * 65536);
    assert.equal(result.modelChecked, true);
    t?.diagnostic(JSON.stringify(result));
  }
  const secret = await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
      contentType: 'text/javascript', body: readFileSync(path(name), 'utf8')}));
    await page.goto(baseURL); let timer;
    try {
      const result = await Promise.race([
        page.evaluate(async input => (await import('./browser-fixture.mjs')).runSecretMaximumFixture(input),
          {wire: [...build.wasmBytes], maxsecret: [...build.maxsecretBytes], maxroute: [...build.maxrouteBytes], maxsink: [...build.maxsinkBytes]}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('secret maximum browser deadline')), 180000); }),
      ]);
      assert.deepEqual(errors, []); return result;
    } finally { clearTimeout(timer); await page.close(); }
  });
  for (const [role, id] of [['wire', 'SecretFramedWireMaximum'], ['route', 'SecretFramedRouteMaximum'], ['sink', 'SecretFramedSinkMaximum']]) {
    const expected = build.secretMaxima.find(row => row.id === id); assert.ok(expected);
    assert.equal(secret.request, expected.request); assert.equal(secret[role], expected.response);
  }
  assert.equal(secret.modelChecked, true); assert.equal(secret.frame_length, 67108864);
  assert.ok(secret.maximum_memory > 0 && secret.maximum_memory <= 16384 * 65536);
  t?.diagnostic(JSON.stringify(secret));
  build.progressMaximumBrowser = await verifyProgressMaximum(t, build);
  assert.deepEqual(closure(), before);
  build.unchanged();
  return results;
}

export async function verifyProgressMaximum(t, build) {
  build.unchanged();
  const before = closure();
  const progress = await withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
    for (const name of names) await page.route('**/' + name, route => route.fulfill({status: 200,
      contentType: 'text/javascript', body: readFileSync(path(name), 'utf8')}));
    await page.goto(baseURL); let timer;
    try {
      const result = await Promise.race([
        page.evaluate(async input => (await import('./browser-fixture.mjs')).runProgressMaximumFixture(input),
          {wire: [...build.wasmBytes], fixture: [...build.fixtureBytes], labels: [...build.labelsBytes], maxprogress: [...build.maxprogressBytes]}),
        new Promise((_, reject) => { timer = setTimeout(() => reject(Error('progress maximum browser deadline')), 180000); }),
      ]);
      assert.deepEqual(errors, []); return result;
    } finally { clearTimeout(timer); await page.close(); }
  });
  assert.deepEqual(progress.cases, ['dual-maximum-progress-and-final', 'maximum-plus-one-revokes-final']);
  assert.deepEqual([...progress.frames, ...progress.predicates].map(row => row.id), ['ProgressFrame2', 'ProgressFrame3', 'ProgressPair2', 'ProgressPair3']);
  for (const row of [...progress.frames, ...progress.predicates]) {
    const expected = build.progressMaxima.find(value => value.id === row.id); assert.ok(expected);
    assert.equal(row.request, expected.request); assert.equal(row.response, expected.response);
  }
  assert.equal(progress.over, build.progressMaxima.find(row => row.id === 'ProgressFrameOver').request);
  assert.equal(progress.modelChecked, true); assert.equal(progress.frame_length, 67108864);
  assert.ok(progress.maximum_memory > 0 && progress.maximum_memory <= 16384 * 65536);
  assert.equal(progress.calls.length, 5);
  t?.diagnostic(JSON.stringify({...progress, calls: progress.calls.length}));
  assert.deepEqual(closure(), before);
  build.unchanged();
  return progress;
}

export async function verifyMutants(t, build) {
  const before = closure(), original = readFileSync(path('presentation-dom.mjs'), 'utf8');
  const mutants = [
    ['missing atomic status', "status.setAttribute('aria-atomic', 'true');", '', /status region explicitly announces the complete message/],
    ['replaced live region', 'if (status.parentNode === root) {', 'if (false) {', /status region stays connected across revisions/],
    ['repeated unchanged status', 'if (status.textContent !== message) status.textContent = message;',
      'status.textContent = message;', /unchanged status text has no duplicate mutation/],
    ['unsafe DOM sink', 'node.textContent = text', 'node.innerHTML = text', /text-only closed DOM/],
    ['stale equal revision', "if (frame && next[1] <= frame[1]) fail('stale');", '', /expected presentation refusal stale/],
    ['lost edited control value', 'const preserve = retained && record.defaultValue === defaultValue && record.draftEpoch === content[6]', 'const preserve = false', /keyed edits survive/],
    ['missing modeled draft epoch', ' && record.draftEpoch === content[6]', '', /modeled draft epoch clears/],
    ['changed kind steals implicit focus', 'surviving?.tag === focused?.tag ? surviving : undefined', 'surviving', /changed control kind cannot inherit/],
    ['reset restores stale selection', ' && chosen.preservedDraft', '', /same-kind reset retains focus/],
    ['normalized generated defaults', 'value = record.defaultValue;', 'value = control.value;', /untouched defaults retain/],
    ['forgotten listener cleanup', "root.removeEventListener('submit', onSubmit);", '', /terminal close removes/],
    ['old owner removes new DOM', 'if (roots.get(root) === ownership)', 'if (true)', /closed view and late result/],
    ['missing private secret sink admission', "if (!secretDispatch && presentationRequiresSecret(next)) fail('binding');", '', /expected presentation refusal binding/],
    ['secret routed through ordinary dispatch', '(secret ? secretDispatch : dispatch)(bytes, record.token)', 'dispatch(bytes, record.token)', /source-owned secret route is serialized/],
    ['secret not cleared before sink', 'if (secret) clearSecrets();', '', /source-owned secret route is serialized/],
    ['secret not cleared on close', "clearSecrets();\n    root.removeEventListener", "\n    root.removeEventListener", /explicit close clears held detached password/],
    ['secret exposed as text input', "control.type = 'password';", "control.type = 'text';", /labeled native password/],
    ['foreign progress token accepted', ' || entry.owner !== owner', '', /expected presentation refusal binding/],
    ['progress loses current correlation', 'record.frame = next; record.context = context;', '', /legitimate Pending progress must preserve/],
    ['failed progress remains live', 'catch (error) { revoke(record); throw error; }', 'catch (error) { throw error; }', /expected presentation refusal binding/],
    ['nonpending progress accepted', ' || !progressFits(frame, next)', '', /expected presentation refusal binding/],
    ['identical external refresh retains invocation', 'if (!record) { context = {}; revoke(active); } return;', 'return;', /expected presentation refusal binding/],
    ['new external context retains invocation', '\n    if (!record) revoke(active);\n', '\n', /expected presentation refusal binding/],
    ['final result leaves progress live during focus', 'revoke(record);\n        paint(value, record, false);', 'paint(value, record, false);', /sole final result retires progress/],
    ['reentrant progress accepted', "if (record.painting) { revoke(record); fail('binding'); }", '', /actual native focus exercises same-token progress reentrance/],
    ['pending invocation allows duplicate submission', ' || active !== null', '', /synchronous reentrant and pending duplicate submissions are serialized/],
    ['stale outcome writes new-context diagnostic', 'if (record.context === context) report();', 'report();', /stale async result cannot write a diagnostic/],
    ['rejection leaves progress live for another reaction', "}, () => { revoke(record); throw new PresentationError('binding'); })", "}, () => { throw new PresentationError('binding'); })", /first rejection observation retires progress/],
  ];
  for (const [name, from, to, diagnostic] of mutants) {
    assert.equal(original.split(from).length, 2, 'one exact actual adapter mutation: ' + name);
    const changed = original.replace(from, to);
    await assert.rejects(journey(build, {'presentation-dom.mjs': changed}), diagnostic, name);
    t?.diagnostic('killed ' + name);
  }
  assert.deepEqual(closure(), before, 'mutants never modify authoritative source');
}
