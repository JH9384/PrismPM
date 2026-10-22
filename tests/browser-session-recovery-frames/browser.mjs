// Real Chromium execution. The test HTTP fixture only delivers captured bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import '../../sdk/browser/session-recovery-frames.mjs'; // Bind the fixed browser entry into the frozen closure.
import {encodeEffectWire as encode, decodeEffectWire as decode} from '../../sdk/browser/effects-wire.mjs';
import {expandState} from '../browser-session/wire.mjs';
import {expectedLayout, expectedLayoutReply, expectedTailReply, tailRequest} from './corpus.mjs';
import {sha} from '../browser-view/compile.mjs';

export const hostMutations = Object.freeze([
  {id: 'prefix-copy', from: 'result.set(captured.state.subarray(0, recipe[0]));',
    to: 'result.set(captured.state.subarray(1, recipe[0]));'},
  {id: 'tail-copy', from: 'result.set(recipe[1], recipe[0]);', to: 'result.set(recipe[1].subarray(1), recipe[0]);'},
  {id: 'final-validation', from: 'const validated = reply(layout(result), 6);', to: 'const validated = selected;'},
  {id: 'artifact-digest', from: '!equal(await digest(artifact.bytes), artifact.sha256)', to: 'false'},
  {id: 'layout-offset', from: 'authority = decode(captured.authority);', to: 'selected[0]++; authority = decode(captured.authority);'},
]);

export async function browserComposition(artifacts, row, options = {}) {
  const modules = Object.fromEntries(['session-recovery-frames', 'effects-wire', 'effects-module', 'identity'].map(name => {
    const bytes = readFileSync(fileURLToPath(new URL('../../sdk/browser/' + name + '.mjs', import.meta.url)));
    assert.equal(sha(bytes), options.inputs?.['sdk/browser/' + name + '.mjs'], 'captured actual browser module ' + name);
    return [name + '.mjs', bytes];
  }));
  const source = modules['session-recovery-frames.mjs'].toString('utf8');
  const mutation = options.mutation ?? null;
  if (mutation) assert.equal(source.split(mutation.from).length, 2, 'exact host defect location');
  return withBrowser(async ({browser, baseURL}) => {
    const context = await browser.newContext(), page = await context.newPage();
    const input = {state: row.state, authority: encode(row.values[0]), execution: row.values[1],
      selector: row.values[2], presentation: row.values[3]};
    try {
      for (const [name, bytes] of Object.entries({...input, layout: artifacts.layout, tail: artifacts.tail}))
        await page.route(baseURL + name + '.bin', route => route.fulfill({status: 200,
          contentType: 'application/octet-stream', body: Buffer.from(bytes)}));
      await page.route(baseURL + '*.mjs', route => {
        const name = new URL(route.request().url()).pathname.slice(1);
        assert.ok(Object.hasOwn(modules, name), 'closed captured browser module delivery');
        return route.fulfill({status: 200, contentType: 'text/javascript', body:
          mutation && name === 'session-recovery-frames.mjs' ? source.replace(mutation.from, mutation.to) : modules[name]});
      });
      await page.goto(baseURL);
      await page.addScriptTag({type: 'module', content: 'import {createSessionRecoveryFrames} from "./session-recovery-frames.mjs";'
        + 'globalThis.__framesCreate = createSessionRecoveryFrames;'});
      await page.waitForFunction(() => typeof globalThis.__framesCreate === 'function');
      return await page.evaluate(async ({maximum, corruptArtifact, extraLayout, mutateCaller, mutateArtifacts,
        inputGetter, artifactGetter, prototypeInput}) => {
        const createSessionRecoveryFrames = globalThis.__framesCreate;
        const hash = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', value)))
          .map(byte => byte.toString(16).padStart(2, '0')).join('');
        const bytes = async name => new Uint8Array(await (await fetch(name + '.bin')).arrayBuffer());
        const fields = Object.fromEntries(await Promise.all(['state', 'authority', 'execution', 'selector', 'presentation']
          .map(async name => [name, await bytes(name)])));
        const artifacts = Object.fromEntries(await Promise.all(['layout', 'tail'].map(async name => {
          const value = await bytes(name); return [name, {bytes: value, sha256: new Uint8Array(await crypto.subtle.digest('SHA-256', value))}];
        })));
        if (corruptArtifact) artifacts.layout.sha256[0] ^= 1;
        const RealInstance = WebAssembly.Instance, trace = [];
        WebAssembly.Instance = function(module, imports) {
          const actual = new RealInstance(module, imports), exports = actual.exports;
          return {exports: {...exports, holo_run(at, length) {
            const input = new Uint8Array(exports.memory.buffer, at, length).slice();
            const packed = exports.holo_run(at, length), value = BigInt.asUintN(64, packed);
            const output = new Uint8Array(exports.memory.buffer, Number(value >> 32n), Number(value & 0xffffffffn)).slice();
            trace.push({request: maximum ? null : Array.from(input), response: maximum ? null : Array.from(output),
              requestBytes: input.length, responseBytes: output.length, hashes: Promise.all([hash(input), hash(output)])});
            return packed;
          }}};
        };
        try {
          if (artifactGetter) Object.defineProperty(artifacts.layout, 'bytes', {get() {throw new Error('getter-executed');}});
          const creation = createSessionRecoveryFrames(artifacts);
          if (mutateArtifacts) for (const artifact of Object.values(artifacts)) {
            artifact.bytes.fill(0); artifact.sha256.fill(0);
          }
          const composer = await creation;
          if (extraLayout) fields.layout = [1];
          if (inputGetter) Object.defineProperty(fields, 'state', {get() {throw new Error('getter-executed');}});
          if (prototypeInput) Object.setPrototypeOf(fields, null);
          const pending = composer.recover(fields);
          if (mutateCaller) for (const value of Object.values(fields)) if (value instanceof Uint8Array) value.fill(0);
          const result = await pending;
          return {ok: true, bytes: maximum ? null : Array.from(result.bytes), length: result.bytes.length,
            result: await hash(result.bytes), hashes: Object.fromEntries(Object.entries(result.hashes)
              .map(([name, value]) => [name, Array.from(value).map(byte => byte.toString(16).padStart(2, '0')).join('')])),
            trace: await Promise.all(trace.map(async row => ({...row, hashes: await row.hashes})))};
        } catch (error) {return {ok: false, code: error.code ?? error.message,
          trace: await Promise.all(trace.map(async row => ({...row, hashes: await row.hashes})))};
        } finally {WebAssembly.Instance = RealInstance;}
      }, {maximum: options.maximum ?? false, corruptArtifact: options.corruptArtifact ?? false,
        extraLayout: options.extraLayout ?? false, mutateCaller: options.mutateCaller ?? false,
        mutateArtifacts: options.mutateArtifacts ?? false, inputGetter: options.inputGetter ?? false,
        artifactGetter: options.artifactGetter ?? false, prototypeInput: options.prototypeInput ?? false});
    } finally {await context.close();}
  });
}

export function verifyBrowserResult(row, result) {
  assert.equal(result.ok, true, row.id + ': ' + result.code);
  assert.equal(result.trace.length, 3, 'layout, tail, complete final generated validation');
  assert.equal(result.length, row.response.length); assert.equal(result.result, sha(row.response));
  if (result.bytes) assert.deepEqual(Uint8Array.from(result.bytes), row.response);
  const state = expandState(decode(row.state)[2]), selected = expectedLayout(state);
  const values = {state: row.state, authority: encode(row.values[0]), execution: row.values[1],
    selector: row.values[2], presentation: row.values[3], layout: expectedLayoutReply(state),
    operation: tailRequest(selected, row.values), tail: expectedTailReply(selected, row.values), result: row.response};
  assert.deepEqual(result.hashes, Object.fromEntries(Object.entries(values).map(([name, value]) => [name, sha(value)])));
  const finalLayout = expectedLayoutReply(expandState(decode(row.response)[2]));
  const calls = [[values.state, values.layout], [values.operation, values.tail], [values.result, finalLayout]];
  for (const [index, [request, response]] of calls.entries()) {
    assert.deepEqual(result.trace[index].hashes, [sha(request), sha(response)]);
    assert.equal(result.trace[index].requestBytes, request.length);
    assert.equal(result.trace[index].responseBytes, response.length);
  }
}
