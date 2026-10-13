// Execute the unchanged selected upstream suite; source enumeration is not a pass.
import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import vm from 'node:vm';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';

const root = new URL('../../sdk/browser/oracles/wpt-ecdsa/', import.meta.url);
const scripts = Object.freeze(['WebCryptoAPI/util/helpers.js', 'WebCryptoAPI/sign_verify/ecdsa_vectors.js',
  'WebCryptoAPI/sign_verify/signature.js', 'WebCryptoAPI/sign_verify/ecdsa.js', 'WebCryptoAPI/sign_verify/ecdsa.https.any.js']);
const expectedFiles = Object.freeze(['LICENSE.md', ...scripts, 'resources/testharness.js'].sort());
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function read(path, directory = root) {
  const absolute = fileURLToPath(new URL(path, directory)), stat = lstatSync(absolute);
  assert.equal(realpathSync(absolute), absolute);
  assert.ok(stat.isFile() && stat.nlink === 1 && stat.size < 262144);
  return readFileSync(absolute);
}
export function captureWpt(directory = root) {
  const manifestBytes = read('source.json', directory), manifest = JSON.parse(manifestBytes);
  // Independently acquired original bytes were checked against every upstream
  // Git blob at the fixed commit; replacement inventory is not supplier proof.
  assert.equal(digest(manifestBytes), '2906c275caed0ea6dc1096de054e2e1c67f7ccd098d6d692530b56431478b4b7',
    'independently verified upstream WPT manifest');
  assert.equal(manifest.repository, 'https://github.com/web-platform-tests/wpt');
  assert.equal(manifest.revision, '37260931105fff57b17bbb80d15fd44b1eb3b930');
  assert.equal(manifest.entry, scripts.at(-1));
  assert.deepEqual(manifest.globals, ['window', 'dedicatedworker']);
  assert.deepEqual(manifest.files.map(row => row.path).sort(), expectedFiles);
  const sources = {};
  for (const row of manifest.files) {
    const bytes = read(row.path, directory);
    assert.equal(bytes.length, row.bytes); assert.equal(digest(bytes), row.sha256);
    assert.equal(createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex'), row.gitBlob);
    sources[row.path] = bytes.toString('utf8');
  }
  Object.freeze(sources);
  const names = [], context = vm.createContext({self: {crypto: {subtle: {}}}, Uint8Array, ArrayBuffer, structuredClone,
    promise_test: (_, name) => names.push(name)});
  for (const path of scripts) vm.runInContext(sources[path], context, {filename: path, timeout: 1000});
  assert.equal(names.length, 324); assert.equal(new Set(names).size, 324);
  const valid = vm.runInContext('getTestVectors()', context), invalid = vm.runInContext('getInvalidTestVectors()', context);
  assert.equal(valid.length, 12); assert.equal(invalid.length, 84);
  return Object.freeze({sources, names: Object.freeze(names.toSorted()), valid, invalid,
    manifest: digest(manifestBytes), unchanged() {
      assert.equal(digest(read('source.json', directory)), digest(manifestBytes));
      for (const row of manifest.files) assert.equal(digest(read(row.path, directory)), row.sha256);
    }});
}
export function verifyNativeWpt(capture) {
  const results = [];
  for (const [vectors, expected] of [[capture.valid, true], [capture.invalid, false]]) for (const row of vectors) {
    const key = createPublicKey({key: Buffer.from(row.publicKeyBuffer), format: 'der', type: 'spki'});
    const actual = verify(row.hashName.replace('-', '').toLowerCase(), Buffer.from(row.plaintext),
      {key, dsaEncoding: 'ieee-p1363'}, Buffer.from(row.signature));
    assert.equal(actual, expected, 'independent Node verification ' + row.name);
    results.push({name: row.name, valid: actual});
  }
  assert.equal(results.length, 96); capture.unchanged(); return results;
}
function verifyResult(capture, result) {
  assert.equal(result.status.status, 0, 'original WPT harness completed successfully');
  assert.equal(result.tests.length, 324);
  assert.deepEqual(result.tests.map(test => test.name).sort(), capture.names);
  assert.deepEqual(result.tests.filter(test => test.status !== 0), [], 'all original WPT assertions passed');
}
export async function collectBrowserWpt(engine, capture = captureWpt()) {
  return withBrowser(async ({browser}) => {
    const context = await browser.newContext(), failures = [];
    const completion = 'add_completion_callback((tests,status)=>{const result={tests:tests.map(t=>({name:t.name,status:t.status,message:t.message})),status:{status:status.status,message:status.message}};';
    const windowBody = '<!doctype html><title>Pinned original WPT ECDSA</title><script>window.wptDone=new Promise(resolve=>window.wptResolve=resolve)</script>'
      + '<script src="/resources/testharness.js"></script><script>setup({explicit_done:true});'
      + completion + 'wptResolve(result)});</script>' + scripts.map(path => `<script src="/${path}"></script>`).join('') + '<script>done()</script>';
    const workerBody = 'importScripts("/resources/testharness.js");setup({explicit_done:true});' + completion
      + 'postMessage({signedContextWpt:result})});importScripts(' + scripts.map(path => JSON.stringify('/' + path)).join(',') + ');done();';
    const pages = new Map([['/', ['text/html', windowBody]], ['/worker.html', ['text/html', '<!doctype html><title>WPT worker</title>']],
      ['/worker.js', ['text/javascript', workerBody]], ...Object.entries(capture.sources).filter(([path]) => path.endsWith('.js'))
        .map(([path, source]) => ['/' + path, ['text/javascript', source]])]);
    // Dedicated-worker imports are not intercepted consistently by automation
    // engines. Serve the same closed immutable byte capture to every realm.
    const server = createServer((request, response) => {
      if (request.method === 'GET' && request.url === '/favicon.ico') {response.writeHead(204).end(); return;}
      const selected = request.method === 'GET' ? pages.get(request.url) : null;
      if (!selected) {failures.push(request.method + ' ' + request.url); response.writeHead(404).end(); return;}
      response.writeHead(200, {'content-type': selected[0], 'cache-control': 'no-store'}).end(selected[1]);
    });
    try {
      await new Promise((resolve, reject) => {
        server.once('error', reject); server.listen(0, '127.0.0.1', resolve);
      });
      const baseURL = `http://127.0.0.1:${server.address().port}/`;
      const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
      await page.goto(baseURL);
      const window = await page.evaluate(() => window.wptDone);
      await page.goto(baseURL + 'worker.html');
      const worker = await page.evaluate(() => new Promise((resolve, reject) => {
        const worker = new Worker('/worker.js');
        const timer = setTimeout(() => {worker.terminate(); reject(Error('WPT worker timeout'));}, 120000);
        worker.onmessage = event => {if (event.data?.signedContextWpt) {clearTimeout(timer); worker.terminate(); resolve(event.data.signedContextWpt);}};
        worker.onerror = event => {clearTimeout(timer); worker.terminate(); reject(Error(event.message));};
      }));
      assert.deepEqual(failures, []); capture.unchanged();
      return {engine, version: browser.version(), revision: '37260931105fff57b17bbb80d15fd44b1eb3b930', manifest: capture.manifest,
        window: window.tests.length, dedicatedworker: worker.tests.length,
        results: {window, dedicatedworker: worker}};
    } finally {
      await context.close(); server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  }, {engine});
}
export async function verifyBrowserWpt(engine, capture = captureWpt()) {
  const result = await collectBrowserWpt(engine, capture);
  verifyCollectedWpt(capture, result);
  return result;
}
export function verifyCollectedWpt(capture, result) {
  verifyResult(capture, result.results.window);
  verifyResult(capture, result.results.dedicatedworker);
}
