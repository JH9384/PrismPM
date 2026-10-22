import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {operationCorpus, captureExpected} from './corpus.mjs';
import {runOperationFixture} from './browser.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
export function summaryExpected(expected) {
  if (expected.error) return expected;
  return {
    frames: Object.fromEntries(Object.entries(expected.frames).map(([key, bytes]) =>
      [key, bytes === null ? null : {length: bytes.length, sha256: sha(bytes)}])),
    descriptions: Object.fromEntries(Object.entries(expected.descriptions).map(([key, row]) =>
      [key, row === null ? null : {descriptor: Array.from(row.descriptor), marker: Array.from(row.marker)}])),
  };
}
export async function transferInput(page, bytes) {
  await page.evaluate(length => {globalThis.operationInput = new Uint8Array(length);}, bytes.length);
  for (let at = 0; at < bytes.length; at += 262144) await page.evaluate(({at, text}) => {
    const raw = atob(text), part = Uint8Array.from(raw, c => c.charCodeAt(0)); operationInput.set(part, at);
  }, {at, text: Buffer.from(bytes.subarray(at, at + 262144)).toString('base64')});
}
export async function captureOnPage(page) {
  return page.evaluate(async () => {
    const {summary} = operationFixture;
    let value;
    try {value = await summary(operationOwner.read(await operationOwner.capture(operationInput)));}
    catch(error) {value = {error: error.code ?? error.message};}
    delete globalThis.operationInput;
    await operationObservationDone;
    return value;
  });
}
export async function verifyOperationVectors(build, rows = operationCorpus(), options = {}) {
  return runOperationFixture(build, async page => {
    await page.evaluate(async () => {globalThis.operationOwner = await operationFixture.open();});
    // Even a host-rejected one-over input is anchored to genuine execution;
    // a zero-invocation fixture cannot stand in for the generated owner.
    const anchor = operationCorpus().find(row => row.id === 'Initialize'); assert.ok(anchor);
    await transferInput(page, anchor.request);
    assert.deepEqual(await captureOnPage(page), summaryExpected(anchor.expected), 'operation anchor contract');
    const observed = [];
    for (const row of rows) {
      await transferInput(page, row.request);
      const expected = row.request.length > 67108864 ? {error: 'invalid-input'} : summaryExpected(row.expected ?? captureExpected(row));
      assert.deepEqual(await captureOnPage(page), expected, 'operation vector ' + row.id + ' contract');
      observed.push({id: row.id, request: sha(row.request), accepted: !expected.error});
    }
    await page.evaluate(() => {operationOwner.close(); delete globalThis.operationOwner;});
    return observed;
  }, options);
}

export const boundaryJourneys = Object.freeze(['ownership', 'capture', 'artifacts', 'close-inflight', 'bounds', 'source-rejection']);
export async function verifyOperationBoundary(build, id, options = {}) {
  assert.ok(boundaryJourneys.includes(id));
  const baseline = operationCorpus().find(row => row.id === 'Initialize'); assert.ok(baseline);
  return runOperationFixture(build, async page => {
    await transferInput(page, baseline.request);
    const actual = await page.evaluate(async id => {
      const {open, options, createSessionOperationCapture: create, fail, same, summary} = operationFixture;
      const owner = await open(), input = operationInput.slice(), handle = await owner.capture(input);
      await operationObservationDone;
      if (id === 'ownership') {
        const other = await open(), rejects = [];
        for (const value of [{}, Object.freeze({}), Object.create(handle), Object.create(owner),
          new owner.constructor(), null, true, 1, 'handle']) rejects.push(await fail(() => owner.read(value)));
        const foreign = await fail(() => other.read(handle)); other.close();
        const pristine = await summary(owner.read(handle)), record = owner.read(handle);
        record.frames.operation.fill(0); record.descriptions.operation.descriptor.fill(0); record.descriptions.operation.marker.fill(0);
        for (const bytes of Object.values(record.artifacts)) bytes.fill(0);
        const after = await summary(owner.read(handle));
        const immutable = [owner, handle, record, record.frames, record.descriptions, record.descriptions.operation, record.artifacts].every(Object.isFrozen);
        const noConstructor = Object.getPrototypeOf(handle) === null && handle.constructor === undefined;
        const prototype = await fail(() => Object.setPrototypeOf(handle, {}));
        const ownMethod = owner.read;
        let intercepted = false; Object.prototype.read = () => {intercepted = true;};
        try {owner.read(handle);} finally {delete Object.prototype.read;}
        owner.close();
        return {rejects, foreign, pristine, after, immutable, noConstructor, prototypeRefused: prototype !== 'unexpected-success',
          intercepted, methodUnchanged: owner.read === ownMethod, closedRead: await fail(() => owner.read(handle)),
          closedCapture: await fail(() => owner.capture(input))};
      }
      if (id === 'capture') {
        const saved = input.slice(), pending = owner.capture(input); input.fill(0);
        const busy = await fail(() => owner.capture(saved));
        const captured = await pending, record = owner.read(captured), result = await summary(record);
        const actualOperation = same(record.frames.operation, saved);
        owner.close(); return {busy, actualOperation, result};
      }
      if (id === 'artifacts') {
        const captured = options(), pending = create(captured);
        for (const row of Object.values(captured)) {row.bytes.fill(0); row.sha256.fill(0);}
        let stable;
        try {stable = await pending;} catch(error) {owner.close(); return {error: error.code ?? error.message};}
        const result = await summary(stable.read(await stable.capture(input))); stable.close();
        const refusals = [];
        for (const role of Object.keys(options())) {
          const changed = options(); changed[role].bytes[changed[role].bytes.length - 1] ^= 1;
          refusals.push(await fail(() => create(changed)));
          const digest = options(); digest[role].sha256[0] ^= 1;
          refusals.push(await fail(() => create(digest)));
        }
        owner.close(); return {result, refusals};
      }
      if (id === 'close-inflight') {
        const pending = owner.capture(input); owner.close();
        return {pending: await fail(() => pending), old: await fail(() => owner.read(handle)), next: await fail(() => owner.capture(input))};
      }
      if (id === 'bounds') {
        const shared = new WebAssembly.Memory({initial: 1, maximum: 1, shared: true});
        const view = new Uint8Array(shared.buffer, 0, input.length); view.set(input);
        const results = [];
        for (const value of [new Uint8Array(67108865), view, new DataView(input.buffer), [], {}, 'input'])
          results.push(await fail(() => owner.capture(value)));
        const detached = input.slice(); structuredClone(detached, {transfer: [detached.buffer]});
        results.push(await fail(() => owner.capture(detached)));
        results.push(await fail(() => owner.capture(input, true)));
        owner.close(); return results;
      }
      const refused = [];
      for (const value of [new Uint8Array(), Uint8Array.of(0x82, 1, 0), Uint8Array.of(0x83, 1, 0, 0)])
        refused.push(await fail(() => owner.capture(value)));
      const next = await summary(owner.read(await owner.capture(input))); owner.close();
      return {refused, next};
    }, id);
    const expected = summaryExpected(baseline.expected), message = 'operation boundary ' + id + ' contract';
    if (id === 'ownership') assert.deepEqual(actual, {rejects: Array(9).fill('invalid-owner'), foreign: 'invalid-owner',
      pristine: expected, after: expected, immutable: true, noConstructor: true, prototypeRefused: true,
      intercepted: false, methodUnchanged: true, closedRead: 'capture-closed', closedCapture: 'capture-closed'}, message);
    else if (id === 'capture') assert.deepEqual(actual, {busy: 'capture-busy', actualOperation: true, result: expected}, message);
    else if (id === 'artifacts') assert.deepEqual(actual, {result: expected, refusals: Array(10).fill('artifact-mismatch')}, message);
    else if (id === 'close-inflight') assert.deepEqual(actual, {pending: 'capture-closed', old: 'capture-closed', next: 'capture-closed'}, message);
    else if (id === 'bounds') assert.deepEqual(actual, Array(8).fill('invalid-input'), message);
    else assert.deepEqual(actual, {refused: Array(3).fill('source-refused'), next: expected}, message);
    return actual;
  }, {...options, label: options.label ?? id});
}
