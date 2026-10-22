import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {captureMetadataLock} from './metadata-capture.mjs';
import {sha} from './metadata-layer.mjs';
import {fixture, encode} from './metadata-test-fixture.mjs';
test('bounded capture returns the ordinary complete lock from exact raw graph bytes without image pulls', async t => {
  const f = fixture(t);
  const lock = await captureMetadataLock(f.reference, sha(f.standards), f.transport);
  assert.equal(lock.schema, 'prismpm/sdk-lock/2'); assert.equal(lock.sdk_index, f.index.toString());
  assert.equal(lock.sdk_image, f.reference); assert.equal(lock.standards_lock, sha(f.standards));
  assert.equal(f.calls.length, 7); assert.deepEqual(f.calls.map(call => call.kind), ['manifest','manifest','blob','blob','manifest','blob','blob']);
  assert.deepEqual(lock.platforms.map(row => row.platform), ['linux/amd64','linux/arm64']);
  for (const row of lock.platforms) {
    const inventory = f.inventories.get(row.platform.split('/')[1]);
    assert.equal(row.inventory_document, inventory.toString()); assert.equal(row.inventory_digest, sha(inventory));
    assert.deepEqual(row.inventory, JSON.parse(inventory).artifacts);
  }
  for (const row of JSON.parse(readFileSync(new URL('./sdk-index-extensions.json', import.meta.url), 'utf8'))) {
    const original = f.index.toString();
    const raw = row.location === 'root' ? '{' + row.member + ',' + original.slice(1)
      : row.location === 'descriptor' ? original.replace('"manifests":[{', '"manifests":[{' + row.member + ',')
      : original.replace('"platform":{', '"platform":{' + row.member + ',');
    assert.notEqual(raw, original, row.id);
    const bytes = Buffer.from(raw), reference = f.reference.split('@')[0] + '@' + sha(bytes);
    const capture = () => captureMetadataLock(reference, sha(f.standards), request =>
      request.reference === reference ? Promise.resolve(bytes) : f.transport(request));
    if (row.accepted) assert.equal((await capture()).sdk_index, raw, row.id);
    else await assert.rejects(capture(), undefined, row.id);
  }
});

test('coherent image graphs cannot bypass standards, cross-platform identities, profile or DiffID checks', async t => {
  for (const mutation of ['identities','standards','legacy','platform','diffid']) {
    const f = fixture(t, mutation);
    await assert.rejects(captureMetadataLock(f.reference, sha(f.standards), f.transport), undefined, mutation);
    assert(f.calls.length <= 7, 'rejected capture must not retry or fall back to image pull');
  }
  const f = fixture(t);
  await assert.rejects(captureMetadataLock(f.reference, sha('wrong request'), f.transport), /standards digest/);
  assert.equal(f.calls.length, 4, 'first platform mismatch prevents further acquisition');
});

test('transport overflow and exact-byte mismatch refuse capture without subsequent requests', async t => {
  for (const fault of ['overflow','string','changed','failure']) {
    const f = fixture(t); let calls = 0;
    await assert.rejects(captureMetadataLock(f.reference, sha(f.standards), async request => {
      calls++;
      if (fault === 'overflow') return Buffer.alloc(request.maximum + 1);
      if (fault === 'string') return '{}';
      if (fault === 'failure') throw Error('synthetic acquisition failure');
      return Buffer.concat([await f.transport(request), Buffer.from(' ')]);
    }));
    assert.equal(calls, 1);
  }
});

test('coherently rehashed index mutations refuse duplicate platforms, extra children, aliases and blob indirection', async t => {
  for (const mutate of [
    value => {value.manifests[1].platform.architecture = 'amd64';},
    value => {value.manifests.push(structuredClone(value.manifests[0]));},
    value => {value.manifests[0].MediaType = 'text/plain';},
    value => {value.manifests[0].platform.OS = 'windows';},
    value => {value.manifests[0].urls = ['https://example.invalid/other'];},
    value => {value.manifests[0].data = '';},
    value => {value.Manifeſts = [];},
  ]) {
    const f = fixture(t), index = JSON.parse(f.index); mutate(index); const bytes = encode(index);
    const reference = f.reference.split('@')[0] + '@' + sha(bytes);
    await assert.rejects(captureMetadataLock(reference, sha(f.standards), async selected =>
      selected.reference === reference ? bytes : f.transport(selected)));
  }
  const f = fixture(t), bytes = Buffer.from('{"manifests":[],' + f.index.toString().slice(1));
  await assert.rejects(captureMetadataLock(f.reference.split('@')[0] + '@' + sha(bytes), sha(f.standards), async () => bytes), /duplicate/);
});

test('invalid repository paths and ports are refused before any acquisition', async () => {
  for (const repository of ['example.invalid/a/../b','example.invalid/a//b','example.invalid:0/a','example.invalid:65536/a']) {
    let fetched = false;
    await assert.rejects(captureMetadataLock(repository + '@' + sha('test'), sha('standards'), async () => {fetched = true;}));
    assert.equal(fetched, false);
  }
});

test('coherently digest-bound manifest numeric tokens cannot round into capture authority',async t=>{
  const paths=[['schemaVersion'],['config','size'],['layers',0,'size'],['layers',1,'size']];
  for(const path of paths) for(const fractional of [false,true]) {
    const f=fixture(t),index=JSON.parse(f.index),descriptor=index.manifests[0];
    const manifest=JSON.parse(f.blobs.get(descriptor.digest));
    let parent=manifest;for(const key of path.slice(0,-1)) parent=parent[key];
    const value=parent[path.at(-1)],marker='__exact_capture_numeric_token__';
    assert.equal(typeof value,'number');parent[path.at(-1)]=marker;
    const token=fractional?`${value}.0000000000000000001`:`${value}0e-1`;
    const encoded=JSON.stringify(manifest),quoted=JSON.stringify(marker);
    assert.equal(encoded.split(quoted).length,2);
    const bytes=Buffer.from(encoded.replace(quoted,token));
    assert.equal(path.reduce((current,key)=>current[key],JSON.parse(bytes)),value);
    descriptor.digest=sha(bytes);descriptor.size=bytes.length;f.blobs.set(descriptor.digest,bytes);
    const indexBytes=encode(index),reference=f.reference.split('@')[0]+'@'+sha(indexBytes);
    f.blobs.set(sha(indexBytes),indexBytes);
    const capture=()=>captureMetadataLock(reference,sha(f.standards),f.transport);
    if(fractional) {
      await assert.rejects(capture(),/fractional|bound/);
      assert.deepEqual(f.calls.map(call=>call.kind),['manifest','manifest'],'invalid original manifest bytes must prevent config/layer acquisition');
    } else {
      const lock=await capture();
      assert.equal(lock.sdk_image,reference);assert.equal(lock.sdk_index,indexBytes.toString());
      assert.equal(f.calls.length,7);assert.equal(lock.platforms[0].manifest_digest,sha(bytes));
    }
  }
});
