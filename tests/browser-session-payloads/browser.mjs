// Real browser transport against the three freshly generated entry points.
// Observations stream in bounded chunks and replay through genuine native code.
import assert from 'node:assert/strict';
import {lstatSync, readFileSync, realpathSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {sha} from '../browser-view/compile.mjs';
import {encodeEffectWire} from '../../sdk/browser/effects-wire.mjs';
import {payloadStream} from './stream.mjs';

const CHUNK = 1048576;
export const boundaryLengths = Object.freeze([1, CHUNK - 1, CHUNK, CHUNK + 1,
  15 * CHUNK, 16 * CHUNK, 16 * CHUNK + 1, 64 * CHUNK]);
export function fixturePayload(length, repeated = false) {
  const bytes = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += CHUNK)
    bytes.fill(repeated ? 11 : 11 + offset / CHUNK, offset, Math.min(length, offset + CHUNK));
  return bytes;
}
export function expectedDescriptor(length, repeated = false) {
  const whole = createHash('sha256'), chunks = [];
  for (let offset = 0; offset < length; offset += CHUNK) {
    const part = Buffer.alloc(Math.min(CHUNK, length - offset), repeated ? 11 : 11 + offset / CHUNK);
    whole.update(part); chunks.push(new Uint8Array(createHash('sha256').update(part).digest()));
  }
  return encodeEffectWire([new Uint8Array(whole.digest()), length, chunks]);
}
export function capturePayloadSources(inputs, directory = new URL('../../sdk/browser/', import.meta.url)) {
  const files = {};
  for (const name of ['session-payloads.mjs', 'session-storage.mjs', 'session-retention-wire.mjs',
    'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs']) {
    const path = fileURLToPath(new URL(name, directory)), stat = lstatSync(path);
    assert.equal(realpathSync(path), path); assert.ok(stat.isFile() && stat.nlink === 1);
    const bytes = readFileSync(path);
    assert.equal(sha(bytes), inputs['sdk/browser/' + name], 'original captured SDK payload module ' + name);
    files[name] = bytes.toString('utf8');
  }
  return Object.freeze(files);
}

async function preparePage(page, baseURL, build, options) {
  await page.route('**/*', route => {
    const url = new URL(route.request().url());
    if ([baseURL, baseURL + 'favicon.ico'].includes(url.href) && route.request().method() === 'GET') return route.continue();
    const name = url.pathname.slice(1);
    if (url.origin !== new URL(baseURL).origin || url.search || route.request().method() !== 'GET'
      || !Object.hasOwn(options.sources, name)) {
      options.unexpected.push(url.href); return route.abort('blockedbyclient');
    }
    return route.fulfill({status: 200, contentType: 'text/javascript', body:
      name === 'session-payloads.mjs' && options.source !== null ? options.source
        : name === 'session-storage.mjs' && options.storageSource !== null ? options.storageSource : options.sources[name]});
  });
  const streams = new Map(), protocol=payloadStream();
  await page.exposeFunction('payloadRecordStart', (entry, requestLength, responseLength, memory) => {
    assert.ok(['journal', 'partition', 'retention'].includes(entry));
    assert.ok(Number.isInteger(requestLength) && requestLength >= 0 && requestLength <= 67108864);
    assert.ok(Number.isInteger(responseLength) && responseLength >= 0 && responseLength <= 67108864);
    assert.ok(memory <= 1073741824);
    const id = options.next++, stem = options.label + '-' + id;
    protocol.begin(id,requestLength,responseLength);
    const record = {entry, requestLength, responseLength, memory, requestAt: 0, responseAt: 0,
      requestName: stem + '-input.bin', responseName: stem + '-output.bin'};
    record.requestPath = build.transcripts.begin(record.requestName);
    record.responsePath = build.transcripts.begin(record.responseName); streams.set(id, record); return id;
  });
  await page.exposeFunction('payloadRecordPart', (id, kind, offset, text) => {
    assert.ok(streams.has(id) && ['request', 'response'].includes(kind));
    assert.equal(typeof text, 'string'); assert.ok(text.length <= 350000);
    const record = streams.get(id), bytes = Buffer.from(text, 'base64');
    assert.equal(bytes.toString('base64'), text); assert.ok(bytes.length > 0 && bytes.length <= 262144);
    protocol.part(id,kind,offset,bytes.length);
    assert.equal(offset, record[kind + 'At']); assert.ok(offset + bytes.length <= record[kind + 'Length']);
    build.transcripts.append(record[kind + 'Name'], bytes); record[kind + 'At'] += bytes.length;
  });
  await page.exposeFunction('payloadRecordEnd', id => {
    const record = streams.get(id); assert.ok(record);
    assert.equal(record.requestAt, record.requestLength); assert.equal(record.responseAt, record.responseLength);
    protocol.end(id);
    build.transcripts.finish(record.requestName); build.transcripts.finish(record.responseName);
    for (const standard of [true, false]) build.transcripts.consume(standard,[record.requestName,record.responseName],()=>
      assert.equal(build.runNative(standard,[record.entry, record.requestPath, record.responsePath]), 'PASS binary session payload twice\n'));
    if(!options.transcriptMutations) {
      assert.equal(record.entry,'retention','first actual storage-open predicate anchors transcript mutations');
      const changed=readFileSync(record.responsePath);changed[0]^=1;
      const changedName=record.responseName+'.changed', path=build.transcripts.write(changedName,changed);
      for(const standard of [true,false]) {
        build.transcripts.consume(standard,[changedName],()=>{
          assert.throws(()=>build.runNative(standard,[record.entry,record.requestPath,path]),/binary native output mismatch/,
            'actual altered browser response must not replay');
          assert.throws(()=>build.runNative(standard,['journal',record.requestPath,record.responsePath]),/binary native output mismatch/,
            'actual relabelled browser invocation must not replay');
        });
      }
      options.transcriptMutations=true;
    }
    const row = {entry: record.entry, request: sha(readFileSync(record.requestPath)),
      response: sha(readFileSync(record.responsePath)), requestBytes: record.requestLength,
      responseBytes: record.responseLength, memory: record.memory};
    options.calls.push(row); streams.delete(id);
  });
  await page.goto(baseURL);
  const entries = Object.fromEntries(Object.entries(build.wasmOwners).map(([name, owner]) =>
    [name, requireGeneratedWasm(owner).run(bytes => Array.from(bytes))]));
  await page.evaluate(entries => {
    globalThis.payloadArtifactBytes = entries;
    const originalCompile = WebAssembly.compile, OriginalInstance = WebAssembly.Instance, modules = new WeakMap();
    globalThis.payloadObservationDone = Promise.resolve();
    globalThis.payloadInvocationCounts = {journal:0,partition:0,retention:0};
    WebAssembly.compile = async function(input) {
      const bytes = new Uint8Array(input).slice(), entry = Object.keys(entries).find(name =>
        entries[name].length === bytes.length && bytes.every((byte, index) => byte === entries[name][index]));
      if (!entry) throw Error('exact generated payload artifact required');
      const module = await Reflect.apply(originalCompile, WebAssembly, [bytes]); modules.set(module, entry); return module;
    };
    WebAssembly.Instance = class {
      constructor(module, imports) {
        const entry = modules.get(module); if (!entry) throw Error('captured payload module required');
        const real = new OriginalInstance(module, imports), exports = {...real.exports};
        exports.holo_run = (pointer, length) => {
          globalThis.payloadInvocationCounts[entry]++;
          const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
          const result = real.exports.holo_run(pointer, length), packed = BigInt.asUintN(64, result);
          const start = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
          const response = new Uint8Array(exports.memory.buffer, start, size).slice(), memory = exports.memory.buffer.byteLength;
          globalThis.payloadObservationDone = globalThis.payloadObservationDone.then(async () => {
            const id = await payloadRecordStart(entry, request.length, response.length, memory);
            for (const [kind, bytes] of [['request', request], ['response', response]])
              for (let offset = 0; offset < bytes.length; offset += 262144) {
                const part = bytes.subarray(offset, offset + 262144); let raw = '';
                for (let at = 0; at < part.length; at += 8192) raw += String.fromCharCode(...part.subarray(at, at + 8192));
                await payloadRecordPart(id, kind, offset, btoa(raw));
              }
            await payloadRecordEnd(id);
          });
          return result;
        };
        return {exports};
      }
    };
  }, entries);
  await page.addScriptTag({type: 'module', content: `
    import {openSessionPayloads} from './session-payloads.mjs';
    import {openSessionStorage} from './session-storage.mjs';
    import {encodeRetentionWire as encode, decodeRetentionWire as decode} from './session-retention-wire.mjs';
    import {encodeEffectWire, decodeEffectWire} from './effects-wire.mjs';
    const artifacts = Object.fromEntries(Object.entries(payloadArtifactBytes).map(([name, bytes]) => [name, Uint8Array.from(bytes)]));
    delete globalThis.payloadArtifactBytes;
    const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hashes = Object.fromEntries(await Promise.all(Object.entries(artifacts).map(async ([name, bytes]) => [name, await digest(bytes)])));
    const options = storage => ({storage, wire: artifacts.journal, wireDigest: hashes.journal,
      partition: artifacts.partition, partitionDigest: hashes.partition});
    const open = async namespace => {
      const storage = await openSessionStorage({namespace, wire: artifacts.retention, wireDigest: hashes.retention});
      return {storage, payloads: await openSessionPayloads(options(storage))};
    };
    const payload = (length, repeated = false) => {
      const bytes = new Uint8Array(length);
      for (let at = 0; at < length; at += 1048576) bytes.fill(repeated ? 11 : 11 + at / 1048576, at, Math.min(length, at + 1048576));
      return bytes;
    };
    const fail = async action => {try {await action(); return 'unexpected-success';} catch(error) {return error.code ?? error.message;}};
    const same = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
    globalThis.payloadFixture = {open, options, openSessionPayloads, payload, digest, fail, same,
      encode, decode, encodeEffectWire, decodeEffectWire};
  `});
  await page.waitForFunction(() => globalThis.payloadFixture !== undefined);
  return async () => {
    await page.evaluate(() => payloadObservationDone); assert.equal(streams.size, 0);protocol.closed();
    return page.evaluate(() => payloadInvocationCounts);
  };
}

export async function runPayloadFixture(build, operation, {engine = 'chromium', source = null, storageSource = null, label = 'payload', inputs = build.inputs} = {}) {
  assert.match(label, /^[a-z][a-z0-9-]*$/);
  const options = {engine, source, storageSource, label, calls: [], next: 0, unexpected: [], sources: capturePayloadSources(inputs)};
  assert.deepEqual(Object.keys(build.wasmOwners).sort(),['journal','partition','retention']);
  const owners=Object.values(build.wasmOwners).map(requireGeneratedWasm);
  const guarded=(index,operation)=>index===owners.length?operation():owners[index].runAsync(()=>guarded(index+1,operation));
  let result;
  try {result = await guarded(0,()=>withBrowser(async ({browser, baseURL}) => {
    const context = await browser.newContext(), pending = [];
    try {
      const prepare = async page => {pending.push(await preparePage(page, baseURL, build, options));};
      const page = await context.newPage(); await prepare(page);
      let value,operationError;
      try {value=await operation(page,{prepare});}catch(error){operationError=error;}
      const expected={journal:0,partition:0,retention:0};
      const drains=await Promise.allSettled(pending.map(finish=>finish()));
      const errors=drains.filter(row=>row.status==='rejected').map(row=>row.reason);
      if(errors.length)throw new AggregateError(operationError?[operationError,...errors]:errors,'payload observation drain failed');
      for(const drained of drains)for(const [name,count]of Object.entries(drained.value))expected[name]+=count;
      verifyPayloadObservationCounts(options.calls,expected);
      assert.throws(()=>verifyPayloadObservationCounts(options.calls.slice(1),expected),/every actual generated browser invocation/,
        'an actual dropped generated invocation cannot preserve observed coverage');
      if(operationError)throw operationError;
      assert.deepEqual(options.unexpected, []); return value;
    } finally {await context.close();}
  }, {engine}));}finally{build.unchanged();}
  for (const owner of Object.values(build.wasmOwners)) requireGeneratedWasm(owner);
  build.unchanged(); assert.equal(options.transcriptMutations,true,'actual altered/relabelled transcript mutations required');
  return {result, calls: options.calls};
}

export function verifyPayloadObservationCounts(calls,expected) {
  assert.deepEqual(Object.keys(expected).sort(),['journal','partition','retention']);
  assert.ok(Object.values(expected).every(value=>Number.isInteger(value)&&value>=0));
  const actual={journal:0,partition:0,retention:0};
  for(const row of calls){assert.ok(Object.hasOwn(actual,row.entry));actual[row.entry]++;}
  assert.deepEqual(actual,expected,'every actual generated browser invocation is replayed natively exactly once');
}
