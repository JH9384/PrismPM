import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {sha} from './compile.mjs';
import {corpus, officialExample} from './corpus.mjs';

export const hostMutations = Object.freeze([
  {id: 'digest', from: 'return run(2, digest);', to: 'return run(2, digest.reverse());', check: 'official'},
  {id: 'caller-copy', from: 'const verifier = bytesCopy(value, 128);', to: 'const verifier = value;', check: 'input'},
  {id: 'closed', from: "const live = () => {if (closed) throw fail('closed');};", to: 'const live = () => {};', check: 'closed'},
  {id: 'fresh-random', from: 'entropy = randomBytes(32);', to: 'entropy = new Uint8Array(32);', check: 'random'},
]);
export async function browserRun(build, engine, mutation = null) {
  const sources = {};
  for (const name of ['pkce.mjs', 'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs']) {
    const bytes = readFileSync(new URL('../../sdk/browser/' + name, import.meta.url));
    assert.equal(sha(bytes), build.inputs['sdk/browser/' + name]); sources[name] = bytes.toString();
  }
  const entry = readFileSync(new URL('./browser-entry.mjs', import.meta.url));
  assert.equal(sha(entry), build.inputs['tests/browser-pkce/browser-entry.mjs']);
  sources['pkce-entry.mjs'] = entry.toString().replace('../../sdk/browser/pkce.mjs', './pkce.mjs');
  if (mutation) {
    assert.equal(sources['pkce.mjs'].split(mutation.from).length, 2, 'one real host mutation');
    sources['pkce.mjs'] = sources['pkce.mjs'].replace(mutation.from, mutation.to);
  }
  const artifact = requireGeneratedWasm(build.wasmOwners.pkce), official = officialExample();
  return withBrowser(async ({browser, baseURL}) => {
    const page = await browser.newPage(), unexpected = [], errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.route('**/*', route => {
      const url = new URL(route.request().url()), name = url.pathname.slice(1);
      if (url.href === baseURL && route.request().method() === 'GET') return route.fulfill({status: 200,
        contentType: 'text/html', headers: {'Cross-Origin-Opener-Policy': 'same-origin',
          'Cross-Origin-Embedder-Policy': 'require-corp'},
        body: '<!doctype html><title>PKCE browser oracle</title>'});
      if (url.origin !== new URL(baseURL).origin || url.search || route.request().method() !== 'GET' || !Object.hasOwn(sources, name)) {
        unexpected.push(url.href); return route.abort();
      }
      return route.fulfill({status: 200, contentType: 'text/javascript', body: sources[name]});
    });
    await page.goto(baseURL);
    await page.addScriptTag({type: 'module', url: baseURL + 'pkce-entry.mjs'});
    await page.waitForFunction(() => globalThis.pkceTest !== undefined);
    let completeCorpus = null;
    const observed = await artifact.runAsync(async bytes => page.evaluate(async ({bytes, verifier}) => {
      const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
      const calls = [], NativeInstance = WebAssembly.Instance;
      WebAssembly.Instance = function(module, imports) {
        const instance = new NativeInstance(module, imports), native = instance.exports;
        return {exports: {...native, holo_run(start, length) {
          const input = new Uint8Array(native.memory.buffer, start, length).slice();
          const result = native.holo_run(start, length), packed = BigInt.asUintN(64, result);
          const at = Number(packed >> 32n), count = Number(packed & 0xffffffffn);
          calls.push({request: hex(input), response: hex(new Uint8Array(native.memory.buffer, at, count))});
          return result;
        }}};
      };
      const {createPkceS256} = globalThis.pkceTest;
      const wire = new Uint8Array(bytes), digest = new Uint8Array(await crypto.subtle.digest('SHA-256', wire));
      const factory = await createPkceS256({bytes: wire, sha256: digest});
      wire.fill(0); digest.fill(0);
      const input = new TextEncoder().encode(verifier), output = await factory.challenge(input);
      const check = {official: new TextDecoder().decode(output), input: new TextDecoder().decode(input)};
      let randomCalls = 0;
      const nativeRandom = crypto.getRandomValues.bind(crypto);
      Object.defineProperty(crypto, 'getRandomValues', {configurable: true, value(value) {randomCalls++; return nativeRandom(value);}});
      const first = await factory.generate(), second = await factory.generate();
      check.random = {calls: randomCalls, different: hex(first.verifier) !== hex(second.verifier),
        firstLength: first.verifier.length, secondLength: second.verifier.length,
        firstChallenge: hex(first.challenge), firstExpected: hex(new TextEncoder().encode(btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', first.verifier))))
          .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '')))};
      Object.defineProperty(crypto, 'getRandomValues', {configurable: true, value: nativeRandom});
      const rejected = [];
      for (const bytes of [new Uint8Array(0), new Uint8Array(42).fill(65), new Uint8Array(129).fill(65),
        new Uint8Array(43).fill(255), new Uint8Array(new WebAssembly.Memory({initial: 1, maximum: 1, shared: true}).buffer, 0, 43)]) {
        try {await factory.challenge(bytes); rejected.push('accepted');} catch(error) {rejected.push(error.code);}
      }
      check.rejected = rejected;
      const lengths = [];
      for (let length = 43; length <= 128; length++) {
        const bytes = new Uint8Array(length).fill(length % 2 ? 46 : 126);
        const observed = await factory.challenge(bytes);
        const expected = btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))))
          .replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
        lengths.push({length, actual: new TextDecoder().decode(observed), expected});
      }
      check.lengths = lengths;
      const nativeDigestForFailure = crypto.subtle.digest.bind(crypto.subtle);
      Object.defineProperty(crypto.subtle, 'digest', {configurable: true, value() {throw Error('provider failed');}});
      try {await factory.challenge(new TextEncoder().encode(verifier)); check.digestFailure = 'accepted';}
      catch (error) {check.digestFailure = error.name + ':' + error.code;}
      Object.defineProperty(crypto.subtle, 'digest', {configurable: true, value: nativeDigestForFailure});
      Object.defineProperty(crypto, 'getRandomValues', {configurable: true, value() {throw Error('provider failed');}});
      try {await factory.generate(); check.randomFailure = 'accepted';}
      catch (error) {check.randomFailure = error.name + ':' + error.code;}
      Object.defineProperty(crypto, 'getRandomValues', {configurable: true, value: nativeRandom});
      // Close at an actual provider await, without replacing its cryptography.
      const nativeDigest = crypto.subtle.digest.bind(crypto.subtle);
      let enter, release;
      const entered = new Promise(resolve => {enter = resolve;}), gate = new Promise(resolve => {release = resolve;});
      Object.defineProperty(crypto.subtle, 'digest', {configurable: true, value: async (...args) => {
        const result = await nativeDigest(...args); enter(); await gate; return result;
      }});
      const pending = factory.challenge(new TextEncoder().encode(verifier));
      await entered; factory.close(); release();
      try {await pending; check.closed = 'accepted';} catch(error) {check.closed = error.code;}
      Object.defineProperty(crypto.subtle, 'digest', {configurable: true, value: nativeDigest});
      try {await factory.generate(); check.afterClose = 'accepted';} catch(error) {check.afterClose = error.code;}
      return {check, calls};
    }, {bytes: [...bytes], verifier: official.verifier}));
    assert.deepEqual(unexpected, []); assert.deepEqual(errors, []);
    assert.equal(observed.check.official, official.challenge, 'PKCE host official contract');
    assert.equal(observed.check.input, official.verifier, 'PKCE host input contract');
    assert.deepEqual(observed.check.random, {...observed.check.random, calls: 2, different: true, firstLength: 43, secondLength: 43,
      firstChallenge: observed.check.random.firstExpected}, 'PKCE host random contract');
    assert.deepEqual(observed.check.rejected, ['invalid-verifier', 'invalid-verifier', 'invalid-input', 'invalid-verifier', 'invalid-input']);
    assert.deepEqual(observed.check.lengths.map(row => row.length), Array.from({length: 86}, (_, at) => at + 43));
    for (const row of observed.check.lengths) assert.equal(row.actual, row.expected, 'complete verifier length ' + row.length);
    assert.equal(observed.check.closed, 'closed', 'PKCE host closed contract');
    assert.equal(observed.check.afterClose, 'closed', 'PKCE host closed contract');
    assert.equal(observed.check.digestFailure, 'PkceError:crypto-unavailable', 'PKCE digest provider failure');
    assert.equal(observed.check.randomFailure, 'PkceError:crypto-unavailable', 'PKCE random provider failure');
    assert.equal(observed.calls.length, 185, 'complete generated call inventory');
    if (!mutation) {
      const rows = corpus().map(row => ({id: row.id, request: [...row.request], response: [...row.response]}));
      completeCorpus = await artifact.runAsync(bytes => page.evaluate(async ({bytes, rows}) => {
        const module = await WebAssembly.compile(new Uint8Array(bytes));
        if (WebAssembly.Module.imports(module).length) throw Error('PKCE imported execution');
        let maximum = 0;
        for (const row of rows) for (let repeat = 0; repeat < 2; repeat++) {
          const {memory, holo_alloc, holo_run} = new WebAssembly.Instance(module, {}).exports;
          const start = holo_alloc(row.request.length) >>> 0;
          if (start + row.request.length > memory.buffer.byteLength) throw Error('PKCE allocation bound');
          new Uint8Array(memory.buffer, start, row.request.length).set(row.request);
          const packed = BigInt.asUintN(64, holo_run(start, row.request.length));
          const at = Number(packed >> 32n), length = Number(packed & 0xffffffffn);
          if (length > 129 || at + length > memory.buffer.byteLength) throw Error('PKCE output bound');
          const output = new Uint8Array(memory.buffer, at, length);
          if (output.length !== row.response.length || output.some((byte, index) => byte !== row.response[index]))
            throw Error(row.id + ' browser Wasm output mismatch');
          maximum = Math.max(maximum, memory.buffer.byteLength);
          if (maximum > 4194304) throw Error('PKCE memory bound');
        }
        return {cases: rows.length, invocations: rows.length * 2, maximum};
      }, {bytes: [...bytes], rows}));
      assert.equal(completeCorpus.cases, 33930); assert.equal(completeCorpus.invocations, 67860);
    }
    await page.close(); return {engine, completeCorpus, ...observed};
  }, {engine});
}
