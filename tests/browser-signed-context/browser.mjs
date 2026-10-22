// Real generated statements, actual WebCrypto, immutable served SDK snapshots.
import assert from 'node:assert/strict';
import {createHash, createPublicKey, verify} from 'node:crypto';
import {lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {isDeepStrictEqual} from 'node:util';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {sha} from '../browser-view/compile.mjs';
import {tsv} from './runtime.mjs';
import {pointCases} from './corpus.mjs';

const modules = ['signed-context.mjs', 'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs'];
const invalidPoints = pointCases().filter(row => !row.valid);
const semanticFailures = new WeakMap();
export const isSemanticCounterexample = (error, expected) => semanticFailures.has(error)
  && isDeepStrictEqual(semanticFailures.get(error), expected);
export const journeys = Object.freeze([
  ...Array.from({length: 4}, (_, purpose) => ['purpose-' + purpose, [2, 1]]),
  ['bad-signature', [2, 1]], ['wrong-domain', [2, 1]], ['wrong-signing-key', [2, 1]],
  ...Array.from({length: 6}, (_, index) => ['binding-' + index, [2]]),
  ...[1, 2, 3, 4, 5, 6, 7, 8].map(index => ['context-' + index, [2]]),
  ['expected-key', [2]], ['invalid-point', [2]],
  ...invalidPoints.map(row => ['point-' + row.id, row.key.length > 65 ? [2] : [2, 2]]), ['accessor-options', []],
  ['captured-inputs', [2, 1]], ['returned-copies', []], ['opaque-instance', []],
  ['captured-bootstrap', [2, 1]], ['malleable-signature', [2, 1]],
].map(([id, tags]) => Object.freeze({id, tags: Object.freeze(tags)})));

export function captureSources(inputs) {
  return Object.freeze(Object.fromEntries(modules.map(name => {
    const path = fileURLToPath(new URL('../../sdk/browser/' + name, import.meta.url)), stat = lstatSync(path);
    assert.equal(realpathSync(path), path); assert.ok(stat.isFile() && stat.nlink === 1);
    const bytes = readFileSync(path); assert.equal(sha(bytes), inputs['sdk/browser/' + name]);
    return [name, bytes.toString('utf8')];
  })));
}
export function verifyObservations(result) {
  assert.deepEqual(result.journeys.map(row => row.id), journeys.map(row => row.id));
  let cursor = 0;
  for (const [index, row] of result.journeys.entries()) {
    const expected = journeys[index];
    assert.equal(row.start, cursor); assert.equal(row.end - row.start, expected.tags.length, expected.id);
    assert.deepEqual(result.calls.slice(row.start, row.end).map(call => decodeEffectWire(Buffer.from(call.request, 'hex'))[1]), expected.tags, expected.id);
    cursor = row.end;
  }
  assert.equal(result.calls.length, cursor);
  assert.equal(invalidPoints.length, 82);
  assert.equal(invalidPoints.filter(row => row.key.length > 65).length, 5);
  assert.equal(cursor, 195, 'independently fixed complete generated call count');
}
export async function browserFixture(build, engine, source = null) {
  const sources = captureSources(build.inputs), artifact = requireGeneratedWasm(build.wasmOwners['signed-context']);
  return artifact.runAsync(wire => withBrowser(async ({browser, baseURL}) => {
    const context = await browser.newContext(), failures = [];
    try {
      await context.route('**/*', route => {
        const request = route.request(), url = request.url();
        if (url === baseURL && request.method() === 'GET') return route.fulfill({status: 200, contentType: 'text/html', body: '<!doctype html><title>Private signed statement</title>'});
        if (url === baseURL + 'favicon.ico') return route.fulfill({status: 204, body: ''});
        const name = url.startsWith(baseURL) ? url.slice(baseURL.length) : '';
        if (request.method() !== 'GET' || !Object.hasOwn(sources, name)) {failures.push(url); return route.abort();}
        return route.fulfill({status: 200, contentType: 'text/javascript', body:
          name === 'signed-context.mjs' && source !== null ? source : sources[name]});
      });
      const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
      await page.goto(baseURL);
      await page.evaluate(bytes => {
        const originalCompile = WebAssembly.compile, OriginalInstance = WebAssembly.Instance, admitted = new WeakSet(), calls = [];
        const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        WebAssembly.compile = async input => {
          const captured = new Uint8Array(input).slice();
          if (captured.length !== bytes.length || !captured.every((byte, index) => byte === bytes[index])) throw Error('exact original artifact required');
          const module = await Reflect.apply(originalCompile, WebAssembly, [captured]); admitted.add(module); return module;
        };
        WebAssembly.Instance = class {
          constructor(module, imports) {
            if (!admitted.has(module)) throw Error('captured artifact module required');
            const real = new OriginalInstance(module, imports), exports = {...real.exports};
            exports.holo_run = (pointer, length) => {
              const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
              const result = real.exports.holo_run(pointer, length), packed = BigInt.asUintN(64, result);
              const offset = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
              const response = new Uint8Array(exports.memory.buffer, offset, size).slice();
              if (request.length > 2048 || response.length > 2048 || exports.memory.buffer.byteLength > 1073741824) throw Error('actual generated bounds');
              calls.push({request: hex(request), response: hex(response), memory: exports.memory.buffer.byteLength}); return result;
            };
            return {exports};
          }
        };
        globalThis.signedObservedCalls = calls;
      }, Array.from(wire));
      await page.addScriptTag({type: 'module', content: `
        import {openSignedContext} from './signed-context.mjs';
        import {createIdentity, signBytes} from './identity.mjs';
        import {encodeEffectWire as encode} from './effects-wire.mjs';
        globalThis.signedFixture = {openSignedContext, createIdentity, signBytes, encode};
      `});
      await page.waitForFunction(() => globalThis.signedFixture !== undefined);
      const result = await page.evaluate(async ({bytes, invalidPoints}) => {
        const calls = globalThis.signedObservedCalls;
        const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
        const {openSignedContext, createIdentity, signBytes, encode} = globalThis.signedFixture;
        const domains = ['prismpm/account-binding/1', 'prismpm/account-request/1', 'prismpm/organization-approval/1', 'prismpm/session-journal-context/1'];
        const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
        const wire = Uint8Array.from(bytes), wireDigest = await hash(wire);
        const verifier = await openSignedContext({wire, wireDigest}), other = await openSignedContext({wire, wireDigest});
        const identity = await createIdentity(), wrong = await createIdentity(), records = [], statements = [];
        const ref = value => new Uint8Array(32).fill(value);
        const context = purpose => [Array.from({length: 6}, (_, index) => ref(index)), ref(6), purpose,
          ref(7), ref(8), ref(9), ref(10), 0xffffffff, ref(11)];
        const assertions = new WeakMap(); let currentJourney = '';
        const check = (condition, label, expected = true, actual = condition) => {
          if (condition) return;
          const error = Error(label); assertions.set(error, {journey: currentJourney, check: label, expected, actual}); throw error;
        };
        const equal = (a, b, label) => check(hex(a) === hex(b), label, hex(b), hex(a));
        const rejects = async (operation, code, label) => {let actual; try {await operation(); actual = 'accepted';} catch (error) {actual = error.code;}
          check(actual === code, label, code, actual);};
        const make = async (purpose = 0, signer = identity, domain = domains[purpose]) => {
          const value = context(purpose), unsigned = encode([1, value, identity.publicKey]);
          const signature = await signBytes(signer, domain, unsigned);
          return {envelope: encode([1, value, identity.publicKey, signature]), expectedContext: encode(value), expectedKey: identity.publicKey.slice(), unsigned, signature, value};
        };
        const options = item => ({envelope: item.envelope, expectedContext: item.expectedContext, expectedKey: item.expectedKey});
        const run = async (id, action) => {currentJourney = id; const start = calls.length; await action(); records.push({id, start, end: calls.length});};
        let handle, base, facts;
        try {
        for (let purpose = 0; purpose < 4; purpose++) await run('purpose-' + purpose, async () => {
          const item = await make(purpose), selected = await verifier.authenticate(options(item)), value = verifier.readEvidence(selected);
          equal(value.envelope, item.envelope, 'exact envelope'); equal(value.context, item.expectedContext, 'exact expected context');
          equal(value.publicKey, identity.publicKey, 'exact key'); equal(value.unsigned, item.unsigned, 'exact unsigned projection');
          equal(value.signature, item.signature, 'exact signature projection'); equal(value.wireDigest, wireDigest, 'exact artifact digest');
          check(value.signingContext === domains[purpose] && value.keyIdentity === identity.principal, 'exact domain and key identity');
          statements.push({key: hex(value.publicKey), signature: hex(value.signature), unsigned: hex(value.unsigned), domain: value.signingContext});
          if (purpose === 0) {handle = selected; base = item; facts = value;}
        });
        await run('bad-signature', async () => {const item = await make(); item.envelope[item.envelope.length - 1] ^= 1;
          await rejects(() => verifier.authenticate(options(item)), 'signature-rejected', 'changed signature refused');});
        await run('wrong-domain', async () => {const item = await make(0, identity, domains[1]);
          await rejects(() => verifier.authenticate(options(item)), 'signature-rejected', 'wrong domain refused');});
        await run('wrong-signing-key', async () => {const item = await make(0, wrong);
          await rejects(() => verifier.authenticate(options(item)), 'signature-rejected', 'different signer refused');});
        for (let index = 0; index < 6; index++) await run('binding-' + index, async () => {
          const expected = structuredClone(base.value); expected[0][index][0] ^= 1;
          await rejects(() => verifier.authenticate({...options(base), expectedContext: encode(expected)}), 'model-rejected', 'binding mismatch refused');});
        for (const index of [1, 2, 3, 4, 5, 6, 7, 8]) await run('context-' + index, async () => {
          const expected = structuredClone(base.value);
          if (index === 2 || index === 7) expected[index] = index === 2 ? 1 : 0; else expected[index][0] ^= 1;
          await rejects(() => verifier.authenticate({...options(base), expectedContext: encode(expected)}), 'model-rejected', 'context mismatch refused');});
        await run('expected-key', async () => {
          await rejects(() => verifier.authenticate({...options(base), expectedKey: wrong.publicKey}), 'model-rejected', 'expected key mismatch refused');});
        await run('invalid-point', async () => {
          const key = new Uint8Array(65); key[0] = 4;
          await rejects(() => verifier.authenticate({envelope: encode([1, base.value, key, base.signature]),
            expectedContext: base.expectedContext, expectedKey: key}), 'model-rejected', 'invalid point refused');});
        for (const row of invalidPoints) await run('point-' + row.id, async () => {
          const key = Uint8Array.from(row.key), originalImport = crypto.subtle.importKey;
          let imports = 0;
          crypto.subtle.importKey = function (...args) {imports++; return Reflect.apply(originalImport, this, args);};
          try {
            await rejects(() => verifier.authenticate({...options(base), expectedKey: key}),
              key.length > 65 ? 'invalid-input' : 'model-rejected', 'invalid expected point refused before provider');
            await rejects(() => verifier.authenticate({...options(base),
              envelope: encode([1, base.value, key, base.signature])}),
              'model-rejected', 'invalid signer point refused before provider');
            check(imports === 0, 'invalid points never reach provider import', 0, imports);
          } finally {crypto.subtle.importKey = originalImport;}
        });
        await run('accessor-options', async () => {
          for (const name of ['envelope', 'expectedContext', 'expectedKey']) {let reads = 0; const item = options(base);
            Object.defineProperty(item, name, {get() {reads++; return base[name];}, enumerable: true});
            await rejects(() => verifier.authenticate(item), 'invalid-input', 'accessor refused'); check(reads === 0, 'accessor never called');}
        });
        await run('captured-inputs', async () => {
          const item = await make(), originals = structuredClone(options(item)), pending = verifier.authenticate(options(item));
          item.envelope.fill(0); item.expectedContext.fill(0); item.expectedKey.fill(0);
          const value = verifier.readEvidence(await pending);
          equal(value.envelope, originals.envelope, 'envelope captured before suspension');
          equal(value.context, originals.expectedContext, 'context captured before suspension');
          equal(value.publicKey, originals.expectedKey, 'key captured before suspension');
        });
        await run('returned-copies', async () => {
          for (const name of ['envelope', 'context', 'publicKey', 'unsigned', 'signature', 'wireDigest']) {
            const before = facts[name].slice(), exposed = verifier.readEvidence(handle); exposed[name].fill(0);
            equal(verifier.readEvidence(handle)[name], before, 'returned evidence copy ' + name);
          }
        });
        await run('opaque-instance', async () => {
          check(Object.getPrototypeOf(verifier) === null && Object.isFrozen(verifier) && !('constructor' in verifier), 'constructorless verifier');
          check(Object.getPrototypeOf(handle) === null && Object.isFrozen(handle) && Reflect.ownKeys(handle).length === 0, 'opaque handle');
          for (const forged of [{}, Object.create(null), Object.create(handle), {...handle}, new Proxy(handle, {})])
            await rejects(() => verifier.readEvidence(forged), 'invalid-evidence', 'forged handle refused');
          await rejects(() => other.readEvidence(handle), 'invalid-evidence', 'cross-instance handle refused');
          check(!Reflect.set(verifier, 'authenticate', () => handle), 'frozen method');
        });
        await run('captured-bootstrap', async () => {
          const options_ = {wire: wire.slice(), wireDigest: wireDigest.slice()}, pending = openSignedContext(options_);
          options_.wire.fill(0); options_.wireDigest.fill(0);
          const captured = await pending, value = captured.readEvidence(await captured.authenticate(options(base)));
          equal(value.wireDigest, wireDigest, 'bootstrap copied original artifact');
        });
        await run('malleable-signature', async () => {
          const order = BigInt('0xffffffff00000000ffffffffffffffffbce6faada7179e84f3b9cac2fc632551');
          const signature = base.signature.slice(), s = BigInt('0x' + hex(signature.subarray(32)));
          const opposite = (order - s).toString(16).padStart(64, '0');
          for (let i = 0; i < 32; i++) signature[32 + i] = parseInt(opposite.slice(i * 2, i * 2 + 2), 16);
          const changed = encode([1, base.value, identity.publicKey, signature]);
          const value = verifier.readEvidence(await verifier.authenticate({...options(base), envelope: changed}));
          equal(value.unsigned, facts.unsigned, 'same unsigned statement'); equal(value.publicKey, facts.publicKey, 'same key');
          check(value.keyIdentity === facts.keyIdentity && hex(value.envelope) !== hex(facts.envelope), 'signature is not key or account identity');
          statements.push({key: hex(value.publicKey), signature: hex(value.signature), unsigned: hex(value.unsigned), domain: value.signingContext});
        });
        return {journeys: records, calls, statements};
        } catch (error) {
          if (!assertions.has(error)) throw error;
          return {semanticFailure: assertions.get(error)};
        }
      }, {bytes: Array.from(wire), invalidPoints: invalidPoints.map(row => ({id: row.id, key: Array.from(row.key)}))});
      assert.deepEqual(failures, []);
      if (result.semanticFailure) {
        const error = Error('actual signed-context semantic counterexample');
        semanticFailures.set(error, Object.freeze({...result.semanticFailure})); throw error;
      }
      verifyObservations(result);
      for (const statement of result.statements) {
        const key = Buffer.from(statement.key, 'hex'), domain = Buffer.from(statement.domain), size = Buffer.alloc(2); size.writeUInt16BE(domain.length);
        const publicKey = createPublicKey({key: {kty: 'EC', crv: 'P-256', x: key.subarray(1, 33).toString('base64url'), y: key.subarray(33).toString('base64url')}, format: 'jwk'});
        const message = Buffer.concat([Buffer.from('prismpm/browser-signature/1\0'), size, domain, Buffer.from(statement.unsigned, 'hex')]);
        assert.equal(verify('sha256', message, {key: publicKey, dsaEncoding: 'ieee-p1363'}, Buffer.from(statement.signature, 'hex')), true);
      }
      assert.equal(result.statements.length, 5); return {engine, version: browser.version(), ...result};
    } finally {await context.close();}
  }, {engine}));
}
export function replayBrowser(build, result, stem) {
  verifyObservations(result);
  const rows = result.calls.map((row, index) => ({id: 'Observed' + index,
    request: Buffer.from(row.request, 'hex'), response: Buffer.from(row.response, 'hex')}));
  const path = join(build.work, stem + '.tsv'); writeFileSync(path, tsv(rows), {flag: 'wx'});
  const expected = rows.map(row => 'PASS ' + row.id + '\n').join('') + `PASS ${rows.length} signed context vectors twice\n`;
  for (const standard of [true, false]) assert.equal(build.runNative(standard, ['signed-context', path]), expected);
  const dropped = structuredClone(result); dropped.calls.pop(); assert.throws(() => verifyObservations(dropped));
  const relabelled = structuredClone(result); relabelled.journeys[0].id = 'unknown'; assert.throws(() => verifyObservations(relabelled));
  const changed = rows.map(row => ({...row, response: Buffer.from(row.response)})); changed[0].response[0] ^= 1;
  const defect = join(build.work, stem + '-changed.tsv'); writeFileSync(defect, tsv(changed), {flag: 'wx'});
  for (const standard of [true, false]) assert.throws(() => build.runNative(standard, ['signed-context', defect]), /native output mismatch/);
  return {journeys: result.journeys.length, calls: result.calls.length, transcript: sha(Buffer.from(tsv(rows))), native: build.nativeEvidence()};
}
