// Acceptance infrastructure only. No server is included in browser releases.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {open} from 'node:fs/promises';
import {constants} from 'node:fs';
import {createRequire} from 'node:module';

const require = createRequire('/opt/prismpm/oracles/package.json');
assert.equal(require('playwright/package.json').version, '1.62.1');
const playwrightRequire = createRequire(require.resolve('playwright/package.json'));
assert.equal(playwrightRequire('playwright-core/package.json').version, '1.62.1');
const playwright = require('playwright');
assert.ok(['x64', 'arm64'].includes(process.arch), 'pinned browser architecture');
export const browserPins = Object.freeze({
  chromium: Object.freeze({version: '157.0.8099.0', executablePath: process.arch === 'x64'
    ? '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux64/chrome-headless-shell'
    : '/ms-playwright/chromium_headless_shell-cft-157.0.8099.0/chrome-headless-shell-linux-arm64/chrome-headless-shell'}),
  firefox: Object.freeze({version: '153.0', executablePath: '/ms-playwright/firefox-1538/firefox/firefox'}),
  webkit: Object.freeze({version: '26.5', executablePath: '/ms-playwright/webkit-2336/pw_run.sh'}),
});

function selectedEngine(options) {
  assert.equal(Object.getPrototypeOf(options), Object.prototype, 'plain browser test options');
  const fields = Object.getOwnPropertyDescriptors(options), keys = Reflect.ownKeys(fields);
  assert.ok(keys.length <= 1 && keys.every(key => key === 'engine'), 'closed browser test options');
  assert.ok(!fields.engine || Object.hasOwn(fields.engine, 'value'), 'browser engine is a data field');
  const engine = fields.engine ? fields.engine.value : 'chromium';
  assert.ok(typeof engine === 'string' && Object.hasOwn(browserPins, engine), 'closed pinned browser engine');
  return engine;
}

export async function withBrowser(callback, options = {}) {
  assert.equal(typeof callback, 'function');
  const engine = selectedEngine(options), {version, executablePath} = browserPins[engine];
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET') { response.writeHead(405).end(); return; }
    if (request.url === '/') {
      response.writeHead(200, {'content-type': 'text/html', 'cache-control': 'no-store'})
        .end('<!doctype html><title>Browser primitive acceptance</title>');
      return;
    }
    if (!/^\/[a-z][a-z0-9-]*\.mjs$/.test(request.url ?? '')) { response.writeHead(404).end(); return; }
    let handle;
    try {
      handle = await open(new URL(`.${request.url}`, import.meta.url), constants.O_RDONLY | constants.O_NOFOLLOW);
      const stat = await handle.stat();
      if (!stat.isFile() || stat.size > 1_048_576) { response.writeHead(404).end(); return; }
      const source = await handle.readFile();
      response.writeHead(200, {'content-type': 'text/javascript', 'cache-control': 'no-store'}).end(source);
    } catch { response.writeHead(404).end(); }
    finally { await handle?.close(); }
  });
  let browser;
  const persistentContexts = new Set();
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const baseURL = `http://127.0.0.1:${server.address().port}/`;
    browser = await playwright[engine].launch({headless: true, executablePath});
    assert.equal(browser.version(), version);
    const launchPersistentContext = async userDataDir => {
      const context = await playwright[engine].launchPersistentContext(userDataDir, {headless: true, executablePath});
      persistentContexts.add(context);
      context.on('close', () => persistentContexts.delete(context));
      assert.equal(context.browser().version(), version);
      return context;
    };
    return await callback({browser, baseURL, launchPersistentContext, engine});
  } finally {
    await Promise.all([...persistentContexts].map(context => context.close()));
    await browser?.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  }
}
