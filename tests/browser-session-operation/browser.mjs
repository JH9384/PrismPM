// Real browser transport against the three freshly generated entry points.
// Observations stream in bounded chunks and replay through genuine native code.
import assert from 'node:assert/strict';
import {appendFileSync, lstatSync, readFileSync, realpathSync, writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {withBrowser} from '../../sdk/browser/browser-test-server.mjs';
import {requireGeneratedWasm} from '../browser-view/generated-wasm.mjs';
import {sha} from '../browser-view/compile.mjs';

import {payloadStream} from '../browser-session-payloads/stream.mjs';
import {createNativeTranscriptReplay} from './native-replay.mjs';

export function captureOperationSources(inputs, directory = new URL('../../sdk/browser/', import.meta.url)) {
  const files = {};
  for (const name of ['session-operation-capture.mjs', 'session-payloads.mjs', 'session-storage.mjs', 'session-retention-wire.mjs',
    'identity.mjs', 'effects-module.mjs', 'effects-wire.mjs']) {
    const path = fileURLToPath(new URL(name, directory)), stat = lstatSync(path);
    assert.equal(realpathSync(path), path); assert.ok(stat.isFile() && stat.nlink === 1);
    const bytes = readFileSync(path);
    assert.equal(sha(bytes), inputs['sdk/browser/' + name], 'original captured SDK operation module ' + name);
    files[name] = bytes.toString('utf8');
  }
  return Object.freeze(files);
}

// Evaluated in the browser as the exact captured function below. Keep queued
// byte ownership outside the instance/export method's lexical environment:
// async transcript delivery must not own a Wasm instance or its arena.
export function enqueueOperationObservation(entry, request, response, memory) {
  const job = {entry, request, response, memory};
  request = null; response = null;
  globalThis.operationObservationDone = globalThis.operationObservationDone.then(async () => {
    const id = await globalThis.operationRecordStart(job.entry, job.request.length, job.response.length, job.memory);
    for (const kind of ['request', 'response']) {
      for (let offset = 0; offset < job[kind].length; offset += 262144) {
        const part = job[kind].subarray(offset, offset + 262144); let raw = '';
        for (let at = 0; at < part.length; at += 8192) raw += String.fromCharCode(...part.subarray(at, at + 8192));
        await globalThis.operationRecordPart(id, kind, offset, btoa(raw));
      }
    }
    await globalThis.operationRecordEnd(id);
  }).finally(() => {job.request = null; job.response = null;});
  return globalThis.operationObservationDone;
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
      name === 'session-operation-capture.mjs' && options.source !== null ? options.source
        : name === 'session-storage.mjs' && options.storageSource !== null ? options.storageSource : options.sources[name]});
  });
  const streams = new Map(), protocol=payloadStream();
  await page.exposeFunction('operationRecordStart', (entry, requestLength, responseLength, memory) => {
    assert.ok(['predecessor', 'session', 'observation', 'partition', 'descriptor'].includes(entry));
    assert.ok(Number.isInteger(requestLength) && requestLength >= 0 && requestLength <= 67108864);
    assert.ok(Number.isInteger(responseLength) && responseLength >= 0 && responseLength <= 67108864);
    assert.ok(memory <= 1073741824);
    assert.equal(streams.size, 0, 'serial bounded transcript spool');
    const id = options.next++, stem = 'operation-active';
    protocol.begin(id,requestLength,responseLength);
    const record = {entry, requestLength, responseLength, memory, requestAt: 0, responseAt: 0,
      requestPath: join(build.work, stem + '-input.bin'), responsePath: join(build.work, stem + '-output.bin')};
    writeFileSync(record.requestPath, Buffer.alloc(0));
    writeFileSync(record.responsePath, Buffer.alloc(0)); streams.set(id, record); return id;
  });
  await page.exposeFunction('operationRecordPart', (id, kind, offset, text) => {
    assert.ok(streams.has(id) && ['request', 'response'].includes(kind));
    assert.equal(typeof text, 'string'); assert.ok(text.length <= 350000);
    const record = streams.get(id), bytes = Buffer.from(text, 'base64');
    assert.equal(bytes.toString('base64'), text); assert.ok(bytes.length > 0 && bytes.length <= 262144);
    protocol.part(id,kind,offset,bytes.length);
    assert.equal(offset, record[kind + 'At']); assert.ok(offset + bytes.length <= record[kind + 'Length']);
    appendFileSync(record[kind + 'Path'], bytes); record[kind + 'At'] += bytes.length;
  });
  await page.exposeFunction('operationRecordEnd', id => {
    const record = streams.get(id); assert.ok(record);
    assert.equal(record.requestAt, record.requestLength); assert.equal(record.responseAt, record.responseLength);
    protocol.end(id);
    const replayed = options.replay.observe(record.entry, record.requestPath, record.responsePath,
      record.requestLength, record.responseLength);
    if(!options.transcriptMutations) {
      assert.equal(record.entry,'predecessor','first actual predecessor invocation anchors transcript mutations');
      const changed=readFileSync(record.responsePath);changed[0]^=1;
      const path=record.responsePath+'.changed';writeFileSync(path,changed);
      for(const standard of [true,false]) {
        assert.throws(()=>build.runNative(standard,[record.entry,record.requestPath,path]),/binary native output mismatch/,
          'actual altered browser response must not replay');
        assert.throws(()=>build.runNative(standard,['observation',record.requestPath,record.responsePath]),/binary native output mismatch/,
          'actual relabelled browser invocation must not replay');
      }
      options.transcriptMutations=true;
    }
    const row = {...replayed, memory: record.memory};
    options.calls.push(row); streams.delete(id);
  });
  await page.goto(baseURL);
  await page.addScriptTag({content: 'globalThis.enqueueOperationObservation = ' + enqueueOperationObservation.toString() + ';'});
  const entries = Object.fromEntries(Object.entries(build.wasmOwners).map(([name, owner]) =>
    [name, requireGeneratedWasm(owner).run(bytes => Array.from(bytes))]));
  await page.evaluate(entries => {
    globalThis.operationArtifactBytes = entries;
    const originalCompile = WebAssembly.compile, OriginalInstance = WebAssembly.Instance, modules = new WeakMap();
    globalThis.operationObservationDone = Promise.resolve();
    globalThis.operationInvocationCounts = {predecessor:0,session:0,observation:0,partition:0,descriptor:0};
    WebAssembly.compile = async function(input) {
      const bytes = new Uint8Array(input).slice(), entry = Object.keys(entries).find(name =>
        entries[name].length === bytes.length && bytes.every((byte, index) => byte === entries[name][index]));
      if (!entry) throw Error('exact generated operation artifact required');
      const module = await Reflect.apply(originalCompile, WebAssembly, [bytes]); modules.set(module, entry); return module;
    };
    WebAssembly.Instance = class {
      constructor(module, imports) {
        const entry = modules.get(module); if (!entry) throw Error('captured operation module required');
        const real = new OriginalInstance(module, imports), exports = {...real.exports};
        exports.holo_run = (pointer, length) => {
          globalThis.operationInvocationCounts[entry]++;
          const request = new Uint8Array(exports.memory.buffer, pointer, length).slice();
          const result = real.exports.holo_run(pointer, length), packed = BigInt.asUintN(64, result);
          const start = Number(packed >> 32n), size = Number(packed & 0xffffffffn);
          const response = new Uint8Array(exports.memory.buffer, start, size).slice(), memory = exports.memory.buffer.byteLength;
          enqueueOperationObservation(entry, request, response, memory);
          return result;
        };
        return {exports};
      }
    };
  }, entries);
  await page.addScriptTag({type: 'module', content: `
    import {createSessionOperationCapture} from './session-operation-capture.mjs';
    const artifacts = Object.fromEntries(Object.entries(operationArtifactBytes).map(([name, bytes]) => [name, Uint8Array.from(bytes)]));
    delete globalThis.operationArtifactBytes;
    const digest = async bytes => new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
    const hashes = Object.fromEntries(await Promise.all(Object.entries(artifacts).map(async ([name, bytes]) => [name, await digest(bytes)])));
    const options = () => Object.fromEntries(Object.entries(artifacts).map(([role, bytes]) => [role, {bytes: bytes.slice(), sha256: hashes[role].slice()}]));
    const open = () => createSessionOperationCapture(options());
    const fail = async action => {try {await action(); return 'unexpected-success';} catch(error) {return error.code ?? error.message;}};
    const same = (left, right) => left.length === right.length && left.every((byte, index) => byte === right[index]);
    const summary = async record => {
      const hex = async bytes => Array.from(await digest(bytes), b => b.toString(16).padStart(2, '0')).join('');
      const frames = {}, descriptions = {};
      for (const [name, bytes] of Object.entries(record.frames)) frames[name] = bytes === null ? null : {length: bytes.length, sha256: await hex(bytes)};
      for (const [name, row] of Object.entries(record.descriptions)) descriptions[name] = row === null ? null :
        {descriptor: Array.from(row.descriptor), marker: Array.from(row.marker)};
      return {frames, descriptions};
    };
    globalThis.operationFixture = {open, options, createSessionOperationCapture, digest, fail, same, summary};
  `});
  await page.waitForFunction(() => globalThis.operationFixture !== undefined);
  return async () => {
    await page.evaluate(() => operationObservationDone); assert.equal(streams.size, 0);protocol.closed();
    return page.evaluate(() => operationInvocationCounts);
  };
}

export async function runOperationFixture(build, operation, {engine = 'chromium', source = null, storageSource = null, label = 'operation', inputs = build.inputs} = {}) {
  assert.match(label, /^[a-z][a-z0-9-]*$/);
  const options = {engine, source, storageSource, label, calls: [], next: 0, unexpected: [], sources: captureOperationSources(inputs),
    replay: createNativeTranscriptReplay(build)};
  assert.deepEqual(Object.keys(build.wasmOwners).sort(),['descriptor','observation','partition','predecessor','session']);
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
      const expected={predecessor:0,session:0,observation:0,partition:0,descriptor:0};
      const drains=await Promise.allSettled(pending.map(finish=>finish()));
      const errors=drains.filter(row=>row.status==='rejected').map(row=>row.reason);
      if(errors.length)throw new AggregateError(operationError?[operationError,...errors]:errors,'operation observation drain failed');
      for(const drained of drains)for(const [name,count]of Object.entries(drained.value))expected[name]+=count;
      options.replayEvidence = options.replay.finish(options.calls);
      verifyOperationObservationCounts(options.calls,expected);
      assert.throws(()=>verifyOperationObservationCounts(options.calls.slice(1),expected),/every actual generated browser invocation/,
        'an actual dropped generated invocation cannot preserve observed coverage');
      if(operationError)throw operationError;
      assert.deepEqual(options.unexpected, []); return value;
    } finally {await context.close();}
  }, {engine}));}finally{build.unchanged();}
  for (const owner of Object.values(build.wasmOwners)) requireGeneratedWasm(owner);
  build.unchanged(); assert.equal(options.transcriptMutations,true,'actual altered/relabelled transcript mutations required');
  return {result, calls: options.calls, nativeReplay: options.replayEvidence};
}

export function verifyOperationObservationCounts(calls,expected) {
  assert.deepEqual(Object.keys(expected).sort(),['descriptor','observation','partition','predecessor','session']);
  assert.ok(Object.values(expected).every(value=>Number.isInteger(value)&&value>=0));
  const actual={predecessor:0,session:0,observation:0,partition:0,descriptor:0};
  for(const row of calls){assert.ok(Object.hasOwn(actual,row.entry));actual[row.entry]++;}
  assert.deepEqual(actual,expected,'every actual generated browser invocation is replayed natively exactly once');
}
