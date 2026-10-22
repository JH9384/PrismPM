// Real HTTP/browser boundary controls; no authentication backend or substitute
// model is supplied. Foreign bytes come from an actual compiled source defect.
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {describeAccountGenesisArtifact,captureAccountGenesisBrowser,sha} from './compile.mjs';
import {renderAccountGenesisBinding} from '../../sdk/account-genesis-artifact.mjs';

export async function verifyBootstrapFaults(build, engine, foreignArtifact) {
  const assets=captureAccountGenesisBrowser(build),installedWire=assets.read('account-genesis.wasm');
  const names = ['account-genesis.mjs', 'account-genesis-binding.mjs', 'identity.mjs',
    'effects-wire.mjs', 'effects-module.mjs'];
  const sources = new Map(names.map(name => {
    const bytes = assets.read(name);
    assert.equal(sha(bytes), build.inputs['sdk/browser/' + name]);
    return ['/' + name, bytes];
  }));
  assert.equal(sources.get('/account-genesis-binding.mjs').toString(),
    renderAccountGenesisBinding(describeAccountGenesisArtifact(build)));
  return requireGeneratedWasm(foreignArtifact).runAsync(foreign =>
    requireGeneratedWasm(build.wasmOwners['account-genesis']).runAsync(wire =>
      withBrowser(async ({browser}) => {
        assert.deepEqual(installedWire,wire,'actual shipped artifact equals the fresh constructor');
        assert.notEqual(sha(foreign), sha(wire));
        let mode = 'positive', pending, resolvePending, pendingClosed = false;
        const unexpected = [], requests = [], results = [];
        const server = createServer((request, response) => {
          if (request.method !== 'GET') {unexpected.push('method'); response.writeHead(405).end(); return;}
          if (request.url === '/') {response.writeHead(200, {'content-type': 'text/html'}).end('<!doctype html><title>Account artifact custody</title>'); return;}
          if (request.url === '/favicon.ico') {response.writeHead(204).end(); return;}
          if (sources.has(request.url)) {
            let bytes = sources.get(request.url);
            if (request.url === '/account-genesis-binding.mjs' && mode.startsWith('binding-')) {
              const binding = {...describeAccountGenesisArtifact(build)};
              if (mode === 'binding-size') binding.wasm_bytes = Number.MAX_SAFE_INTEGER;
              if (mode === 'binding-digest') binding.wasm_sha256 = null;
              if (mode === 'binding-extra') binding.unregistered = true;
              bytes = Buffer.from('export const accountGenesisBinding=Object.freeze(' + JSON.stringify(binding) + ');');
            }
            response.writeHead(200, {'content-type': 'text/javascript'}).end(bytes); return;
          }
          if (request.url !== '/account-genesis.wasm') {unexpected.push('path'); response.writeHead(404).end(); return;}
          requests.push(mode);
          if (mode === 'redirect') {response.writeHead(302, {location: '/foreign.wasm'}).end(); return;}
          if (mode === 'status') {response.writeHead(404).end(); return;}
          response.writeHead(200, {'content-type': 'application/wasm', 'cache-control': 'no-store'});
          if (mode === 'pending') {
            response.once('close', () => {pendingClosed = true; resolvePending();});
            response.write(wire.subarray(0, 8)); // Actual unfinished HTTP body.
            return;
          }
          response.end(['foreign', 'cancel-reject', 'cancel-pending'].includes(mode) ? foreign : mode === 'short' ? installedWire.subarray(0, -1)
            : mode === 'over' ? Buffer.concat([installedWire, Buffer.from([0])]) : installedWire);
        });
        let context;
        try {
          await new Promise((resolve, reject) => {server.once('error', reject); server.listen(0, '127.0.0.1', resolve);});
          const baseURL = 'http://127.0.0.1:' + server.address().port + '/';
          context = await browser.newContext();
          for (const selected of ['positive', 'foreign', 'short', 'over', 'status', 'redirect', 'pending',
            'binding-size', 'binding-digest', 'binding-extra', 'cancel-reject', 'cancel-pending']) {
            mode = selected;
            pending = new Promise(resolve => {resolvePending = resolve;});
            const page = await context.newPage(), errors = [], events = [];
            let phase = 'navigation';
            const event = value => {
              assert(events.length < 64, 'bounded complete bootstrap event ledger');
              events.push({phase, ...value});
            };
            page.on('pageerror', error => {
              const value = {kind: 'pageerror', name: error.name, message: error.message};
              errors.push(value); event(value);
            });
            page.on('response', response => event({kind: 'response', path: new URL(response.url()).pathname, status: response.status()}));
            page.on('requestfailed', request => event({kind: 'requestfailed', path: new URL(request.url()).pathname, error: request.failure()?.errorText}));
            try {
              await page.goto(baseURL);
              phase = 'bootstrap-setup';
              const started = performance.now();
              await page.evaluate(selected => {
                const compile = WebAssembly.compile, actual = [];
                WebAssembly.compile = async bytes => {
                  const copied = new Uint8Array(bytes).slice();
                  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', copied));
                  actual.push({bytes: copied.length, sha256: Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('')});
                  return Reflect.apply(compile, WebAssembly, [copied]);
                };
                globalThis.accountArtifactCompilations = actual;
                const cancel = ReadableStreamDefaultReader.prototype.cancel;
                globalThis.accountArtifactCancellations = {called: 0, native_settled: 0};
                if (selected === 'cancel-reject' || selected === 'cancel-pending')
                  ReadableStreamDefaultReader.prototype.cancel = function (...args) {
                    globalThis.accountArtifactCancellations.called++;
                    // Always execute and observe the real platform cleanup first.
                    return Reflect.apply(cancel, this, args).then(() => {
                      globalThis.accountArtifactCancellations.native_settled++;
                      if (selected === 'cancel-reject') throw Error('actual cancellation completion fault');
                      return new Promise(() => {});
                    });
                  };
              }, selected);
              await page.addScriptTag({type: 'module', content:
                "import {openAccountGenesis} from './account-genesis.mjs'; globalThis.accountArtifactFactory=openAccountGenesis;"});
              await page.waitForFunction(() => globalThis.accountArtifactFactory !== undefined);
              phase = 'artifact-acquisition';
              const observed = await page.evaluate(async () => {
                const actual = globalThis.accountArtifactCompilations;
                try {
                  const verifier = await globalThis.accountArtifactFactory();
                  return {code: 'accepted', actual, opaque: Object.getPrototypeOf(verifier) === null && Object.isFrozen(verifier)};
                } catch (error) {return {code: error.code, actual};}
              });
              const elapsed = performance.now() - started;
              assert.deepEqual(errors, []);
              if (selected === 'positive') assert.deepEqual(observed, {code: 'accepted',
                actual: [{bytes: wire.length, sha256: sha(wire)}], opaque: true});
              else assert.deepEqual(observed, {code: 'artifact-mismatch', actual: []},
                'invalid acquisition must refuse before real native compilation: ' + selected);
              if (selected === 'pending') {
                assert(elapsed >= 25000 && elapsed < 45000, 'actual original 30-second acquisition deadline');
                let timer;
                try {await Promise.race([pending, new Promise((_, reject) => {
                  timer = setTimeout(() => reject(Error('unfinished HTTP body not cancelled')), 5000);
                })]);} finally {clearTimeout(timer);}
                assert(pendingClosed, 'native abort closed the actual unfinished response before context retirement');
              }
              if (selected.startsWith('cancel-')) {
                assert.deepEqual(await page.evaluate(() => globalThis.accountArtifactCancellations),
                  {called: 1, native_settled: 1}, 'actual cancellation executed before the injected completion defect');
                if (selected === 'cancel-pending') assert(elapsed >= 4500 && elapsed < 12000,
                  'unsettled cancellation cannot keep a refusal pending indefinitely');
              }
              results.push({mode: selected, ...observed, elapsed_ms: Math.round(elapsed)});
            } finally {
              console.log(JSON.stringify({scope: 'bootstrap-transport-diagnostic-not-acceptance', engine, mode: selected, phase, events}));
              await page.close();
            }
          }
          assert.deepEqual(requests, results.filter(row => !row.mode.startsWith('binding-')).map(row => row.mode),
            'one actual fixed-URL request per acquisition; malformed bindings refuse before fetching and redirects never follow');
          assert.deepEqual(unexpected, []);
          build.unchanged();
          return {engine, cases: results, pending_body_cancelled: pendingClosed,installed_browser_artifacts:assets.installed};
        } finally {
          try {await context?.close();}
          finally {try {server.closeAllConnections(); await new Promise(resolve => server.close(resolve));}finally{assets.unchanged();}}
        }
      }, {engine})));
}
