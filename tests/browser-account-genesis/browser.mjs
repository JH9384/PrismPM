import assert from 'node:assert/strict';
import {createHash, createPublicKey} from 'node:crypto';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {decodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {sha} from '../browser-view/compile.mjs';
import {describeAccountGenesisArtifact,captureAccountGenesisBrowser} from './compile.mjs';
import {renderAccountGenesisBinding} from '../../sdk/account-genesis-artifact.mjs';
import {inspectEffectModule} from '../../sdk/browser/effects-module.mjs';

const modules = ['account-genesis.mjs', 'account-genesis-binding.mjs', 'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs'];
const semanticEvidence = new WeakMap();
export function readSemanticCounterexample(error) {
  assert.ok(semanticEvidence.has(error), 'actual privately branded host counterexample required');
  return semanticEvidence.get(error);
}
export const journeyNames = Object.freeze(['declaration', 'repeat', 'namespace', 'invalid-point',
  'captured-inputs', 'returned-copies', 'opaque-handle', 'captured-bootstrap',
  'changed-artifact', 'accessor-options', 'noncanonical', 'malformed-genesis']);
export async function browserFixture(build, engine, changedHost = null, foreignArtifact = null) {
  const assets=captureAccountGenesisBrowser(build);
  const sources = Object.fromEntries(modules.map(name => {
    const bytes = assets.read(name);
    assert.equal(sha(bytes), build.inputs['sdk/browser/' + name]);
    return [name, bytes.toString('utf8')];
  }));
  assert.equal(sources['account-genesis-binding.mjs'], renderAccountGenesisBinding(describeAccountGenesisArtifact(build)),
    'installed binding equals actual complete unmutated model/kernel/package constructor');
  const foreign = requireGeneratedWasm(foreignArtifact);
  return foreign.runAsync(foreignWire => {
  const foreignBytes = Buffer.from(foreignWire); inspectEffectModule(foreignBytes, 16384);
  return requireGeneratedWasm(build.wasmOwners['account-genesis']).runAsync(wire =>
    withBrowser(async ({browser, baseURL}) => {
      assert.equal(sha(wire), build.inputs['sdk/browser/account-genesis.wasm'], 'exact actual committed generated binary');
      const installedWire=assets.read('account-genesis.wasm');assert.deepEqual(installedWire,wire);
      assert.notEqual(sha(foreignBytes), sha(wire), 'genuinely different compiled model for coherent-artifact refusal');
      const context = await browser.newContext(), failures = [];
      try {
        await context.route('**/*', route => {
          const url = route.request().url(), name = url.startsWith(baseURL) ? url.slice(baseURL.length) : null;
          if (route.request().method() === 'GET' && name === '') return route.fulfill({status: 200,
            contentType: 'text/html', body: '<!doctype html><title>Private account declaration</title>'});
          if (name === 'favicon.ico') return route.fulfill({status: 204, body: ''});
          if (route.request().method() === 'GET' && name === 'account-genesis.wasm')
            return route.fulfill({status: 200, contentType: 'application/wasm', body: installedWire});
          if (route.request().method() !== 'GET' || !Object.hasOwn(sources, name)) {failures.push(url); return route.abort();}
          return route.fulfill({status: 200, contentType: 'text/javascript', body:
            name === 'account-genesis.mjs' && changedHost !== null ? changedHost : sources[name]});
        });
        const page = await context.newPage(); page.on('pageerror', error => failures.push(error.message));
        await page.goto(baseURL);
        await page.evaluate(() => {
          const compile = WebAssembly.compile, Instance = WebAssembly.Instance, admitted = new WeakSet(), calls = [], compilations = [];
          const hex = value => Array.from(value, byte => byte.toString(16).padStart(2, '0')).join('');
          WebAssembly.compile = async input => {
            const captured = new Uint8Array(input).slice();
            // Observe genuine compilation; never mask a foreign-artifact
            // vulnerability by filtering bytes in the test harness.
            compilations.push({bytes: captured.length, sha256: hex(new Uint8Array(await crypto.subtle.digest('SHA-256', captured)))});
            const module = await Reflect.apply(compile, WebAssembly, [captured]); admitted.add(module); return module;
          };
          WebAssembly.Instance = class {
            constructor(module, imports) {
              if (!admitted.has(module)) throw Error('captured module required');
              const actual = new Instance(module, imports), exports = {...actual.exports};
              exports.holo_run = (at, length) => {
                const input = new Uint8Array(exports.memory.buffer, at, length).slice();
                const result = actual.exports.holo_run(at, length), packed = BigInt.asUintN(64, result);
                const pointer = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
                const output = new Uint8Array(exports.memory.buffer, pointer, size).slice();
                if (input.length > 512 || output.length > 512) throw Error('actual frame bounds');
                calls.push({request: hex(input), response: hex(output)}); return result;
              };
              return {exports};
            }
          };
          globalThis.genesisCalls = calls;
          globalThis.genesisCompilations = compilations;
        });
        await page.addScriptTag({type: 'module', content:
          "import {openAccountGenesis} from './account-genesis.mjs'; import {createIdentity} from './identity.mjs'; import {encodeEffectWire as encode} from './effects-wire.mjs'; globalThis.genesisFixture={openAccountGenesis,createIdentity,encode};"});
        await page.waitForFunction(() => globalThis.genesisFixture !== undefined);
        const result = await page.evaluate(async input => {
          const {openAccountGenesis, createIdentity, encode} = globalThis.genesisFixture;
          const calls = globalThis.genesisCalls, journeys = [];
          const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
          const semanticFailures = new WeakMap(); let activeJourney = null;
          const check = (value, name, expected = true, actual = value) => {if (!value) {
            const error = new Error(name);
            semanticFailures.set(error, {journey: activeJourney, check: name, expected, actual}); throw error;
          }};
          const same = (left, right, name) => check(hex(left) === hex(right), name, hex(right), hex(left));
          const rejects = async (body, expected, name) => {
            let code; try {await body(); code = 'accepted';} catch (error) {code = error.code;}
            check(code === expected, name, expected, code);
          };
          const journey = async (id, action) => {activeJourney = id;
            const start = calls.length; await action(); journeys.push({id, start, end: calls.length}); activeJourney = null;};
          const hash = async value => new Uint8Array(await crypto.subtle.digest('SHA-256', value));
          const wire = Uint8Array.from(input.wire), wireDigest = await hash(wire);
          const foreign = Uint8Array.from(input.foreign), foreignDigest = await hash(foreign);
          const verifier = await openAccountGenesis(), other = await openAccountGenesis({wire, wireDigest});
          const key = await createIdentity(), namespace = new Uint8Array(32).fill(11), nonce = new Uint8Array(32).fill(12);
          const value = [1, namespace, nonce, key.publicKey], genesis = encode(value);
          const options = () => ({genesis: genesis.slice(), expectedNamespace: namespace.slice()});
          let handle, facts;
          try {
          await journey('declaration', async () => {
            handle = await verifier.declare(options()); facts = structuredClone(verifier.readFacts(handle));
            same(facts.genesis, genesis, 'canonical-genesis'); same(facts.namespace, namespace, 'namespace');
            same(facts.publicKey, key.publicKey, 'initial-key');
            check(facts.keyIdentity === key.principal, 'key-identity', key.principal, facts.keyIdentity);
            const prefix = new TextEncoder().encode('prismpm/account-genesis/1\0');
            const material = new Uint8Array(prefix.length + genesis.length); material.set(prefix); material.set(genesis, prefix.length);
            same(facts.material, material, 'complete-domain'); same(facts.identity, await hash(material), 'identity-digest');
          });
          await journey('repeat', async () => same(verifier.readFacts(await verifier.declare(options())).identity, facts.identity, 'stable-declaration'));
          await journey('namespace', async () => {const input = options(); input.expectedNamespace[0] ^= 1;
            await rejects(() => verifier.declare(input), 'model-rejected', 'wrong-namespace');});
          await journey('invalid-point', async () => {const point = new Uint8Array(65); point[0] = 4;
            await rejects(() => verifier.declare({genesis: encode([1, namespace, nonce, point]), expectedNamespace: namespace}), 'invalid-key', 'modeled-curve-admission');});
          await journey('captured-inputs', async () => {const input = options(), pending = verifier.declare(input);
            input.genesis.fill(0); input.expectedNamespace.fill(0);
            same(verifier.readFacts(await pending).genesis, genesis, 'captured-before-await');});
          await journey('returned-copies', async () => {
            for (const name of ['genesis', 'namespace', 'publicKey', 'material', 'identity', 'wireDigest']) {
              const output = verifier.readFacts(handle); output[name].fill(0);
              same(verifier.readFacts(handle)[name], facts[name], 'copied-fact-' + name);
            }
          });
          await journey('opaque-handle', async () => {
            check(Object.getPrototypeOf(verifier) === null && Object.isFrozen(verifier) && !('constructor' in verifier), 'constructorless-verifier');
            check(Object.getPrototypeOf(handle) === null && Object.isFrozen(handle) && Reflect.ownKeys(handle).length === 0, 'opaque-handle');
            for (const fake of [{}, Object.create(null), Object.create(handle), {...handle}, new Proxy(handle, {})])
              await rejects(() => verifier.readFacts(fake), 'invalid-facts', 'forged-handle');
            await rejects(() => other.readFacts(handle), 'invalid-facts', 'other-verifier');
            check(!Reflect.set(verifier, 'declare', () => handle), 'immutable-verifier');
          });
          await journey('captured-bootstrap', async () => {const input = {wire: wire.slice(), wireDigest: wireDigest.slice()}, pending = openAccountGenesis(input);
            input.wire.fill(0); input.wireDigest.fill(0); const captured = await pending;
            same(captured.readFacts(await captured.declare(options())).wireDigest, wireDigest, 'captured-module');});
          await journey('changed-artifact', async () => {const changed = wire.slice(); changed[0] ^= 1;
            const before = globalThis.genesisCompilations.length;
            await rejects(() => openAccountGenesis({wire: changed, wireDigest}), 'artifact-mismatch', 'artifact-mismatch');
            await rejects(() => openAccountGenesis({wire: foreign, wireDigest: foreignDigest}), 'artifact-mismatch', 'coherent-foreign-artifact');
            check(globalThis.genesisCompilations.length === before, 'refuse-before-native-compilation');});
          await journey('accessor-options', async () => {
            for (const name of ['genesis', 'expectedNamespace']) {let reads = 0; const input = options();
              Object.defineProperty(input, name, {get() {reads++; return genesis;}, enumerable: true});
              await rejects(() => verifier.declare(input), 'invalid-input', 'accessor'); check(reads === 0, 'no-accessor-evaluation');}
          });
          await journey('noncanonical', async () => {const changed = new Uint8Array(genesis.length + 1); changed[0] = 0x98; changed[1] = 4; changed.set(genesis.subarray(1), 2);
            await rejects(() => verifier.declare({genesis: changed, expectedNamespace: namespace}), 'invalid-input', 'noncanonical');});
          await journey('malformed-genesis', async () =>
            rejects(() => verifier.declare({genesis: encode([1, namespace, new Uint8Array(31), key.publicKey]), expectedNamespace: namespace}), 'model-rejected', 'nonce-width'));
          return {journeys, calls, compilations: globalThis.genesisCompilations,
            facts: Object.fromEntries(Object.entries(facts).map(([name, item]) => [name, typeof item === 'string' ? item : hex(item)]))};
          } catch (error) {
            if (!semanticFailures.has(error)) throw error;
            return {semanticFailure: semanticFailures.get(error), fixtureGenesis: hex(genesis), journeys, calls};
          }
        }, {wire: Array.from(wire), foreign: Array.from(foreignBytes)});
        assert.deepEqual(failures, []);
        if (result.semanticFailure !== undefined) {
          assert.match(result.fixtureGenesis, /^[a-f0-9]{274}$/, 'captured original fixture genesis');
          const error = Error('actual account-genesis semantic counterexample: '
            + JSON.stringify(result.semanticFailure));
          semanticEvidence.set(error, Object.freeze({genesis: result.fixtureGenesis,
            failure: Object.freeze({...result.semanticFailure})})); throw error;
        }
        verifyObservations(result);
        assert.deepEqual(result.compilations, Array.from({length: 3}, () => ({bytes: wire.length, sha256: sha(wire)})),
          'all actual factory compilations use only the independently constructed fixed SDK artifact');
        const key = Buffer.from(result.facts.publicKey, 'hex');
        createPublicKey({key: {kty: 'EC', crv: 'P-256', x: key.subarray(1, 33).toString('base64url'), y: key.subarray(33).toString('base64url')}, format: 'jwk'});
        assert.equal(createHash('sha256').update(Buffer.from(result.facts.material, 'hex')).digest('hex'), result.facts.identity);
        return {engine, version: browser.version(), installed_browser_artifacts:assets.installed, ...result};
      } finally {try {await context.close();}finally{assets.unchanged();}}
    }, {engine}));
  });
}

export function verifyObservations(value) {
  assert.deepEqual(value.journeys.map(row => row.id), journeyNames);
  const tags = [[2, 1], [2, 1], [2], [2], [2, 1], [], [], [2, 1], [], [], [], [2]];
  let next = 0;
  value.journeys.forEach((row, i) => {
    assert.equal(row.start, next); next += tags[i].length; assert.equal(row.end, next);
    assert.deepEqual(value.calls.slice(row.start, row.end).map(call => {
      const frame = decodeEffectWire(Buffer.from(call.request, 'hex'));
      assert.ok(Array.isArray(frame) && frame[0] === 1, 'actual versioned model request');
      return frame[1];
    }), tags[i], 'exact source operation tags for ' + row.id);
  });
  assert.equal(value.calls.length, 11); assert.equal(next, 11);
}
