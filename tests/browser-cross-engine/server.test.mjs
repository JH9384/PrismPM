import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdtempSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserPins, withBrowser} from '../../sdk/browser/browser-test-server.mjs';

test('browser selection is a closed explicit option without accessor execution', async () => {
  let accessed = false, called = false;
  const accessor = Object.defineProperty({}, 'engine', {get() {accessed = true; return 'chromium';}});
  for (const options of [null, 'firefox', [], Object.create(null), {engine: undefined}, {engine: 'chrome'},
    {engine: 'chromium', executablePath: '/tmp/arbitrary'}, {[Symbol('engine')]: 'chromium'}, accessor])
    await assert.rejects(withBrowser(() => {called = true;}, options));
  assert.equal(accessed, false); assert.equal(called, false);
  assert.ok(Object.isFrozen(browserPins));
  for (const pin of Object.values(browserPins)) assert.ok(Object.isFrozen(pin));
});

test('default remains the pinned Chromium and its local server is read-only', async () => {
  let captured;
  const result = await withBrowser(async ({browser, engine, baseURL}) => {
    captured = browser; assert.equal(engine, 'chromium');
    assert.equal(browser.version(), browserPins.chromium.version);
    assert.equal((await fetch(baseURL)).status, 200);
    assert.equal((await fetch(baseURL, {method: 'POST'})).status, 405);
    assert.equal((await fetch(baseURL + 'outside/path.mjs')).status, 404);
    assert.equal((await fetch(baseURL + 'identity.mjs')).headers.get('content-type'), 'text/javascript');
    return 'actual callback result';
  });
  assert.equal(result, 'actual callback result'); assert.equal(captured.isConnected(), false);
});

for (const engine of Object.keys(browserPins)) {
  test(engine + ' uses its exact pin for ephemeral and restarted persistent browsers', {timeout: 60000}, async () => {
    const profile = mkdtempSync(join(tmpdir(), 'prismpm-browser-engine-'));
    let passed = false, captured;
    try {
      await withBrowser(async ({browser, baseURL, launchPersistentContext, engine: selected}) => {
        captured = browser; assert.equal(selected, engine); assert.equal(browser.version(), browserPins[engine].version);
        const first = await launchPersistentContext(profile), page = await first.newPage();
        await page.goto(baseURL);
        await page.evaluate(value => localStorage.setItem('engine-proof', value), engine);
        await first.close();
        const second = await launchPersistentContext(profile), reopened = await second.newPage();
        await reopened.goto(baseURL);
        assert.equal(await reopened.evaluate(() => localStorage.getItem('engine-proof')), engine);
        // The wrapper must close this unclosed context before returning.
      }, {engine});
      assert.equal(captured.isConnected(), false); passed = true;
    } finally {if (passed) rmSync(profile, {recursive: true});}
  });

  test(engine + ' closes its real browser after callback failure', {timeout: 30000}, async () => {
    let captured;
    await assert.rejects(withBrowser(async ({browser}) => {
      captured = browser; throw new Error('intentional fixture callback failure');
    }, {engine}), /intentional fixture callback failure/);
    assert.equal(captured.isConnected(), false);
  });
}
