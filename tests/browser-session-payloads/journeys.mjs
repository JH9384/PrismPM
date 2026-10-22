import assert from 'node:assert/strict';
import {boundaryLengths, expectedDescriptor, runPayloadFixture,verifyPayloadObservationCounts} from './browser.mjs';

export const payloadJourneys = Object.freeze([
  ...boundaryLengths.map(length => Object.freeze({id: 'boundary-' + length, length})),
  Object.freeze({id: 'duplicate-64-chunks', length: 67108864, repeated: true}),
  ...['capture', 'brand', 'versionchange', 'preserve', 'digest', 'partial', 'partial-published', 'close', 'corrupt', 'tabs'].map(id => Object.freeze({id})),
]);

function accepted(result,row) {
  let expected;
  if(row.length) {
    const unique=row.repeated?1:Math.ceil(row.length/1048576);
    expected={journal:3,partition:3,retention:3+2*Math.ceil((unique+1)/16)};
  } else {
    const fixed={capture:[3,3,5],brand:[3,3,5],versionchange:[0,0,1],preserve:[6,6,10],digest:[4,3,4],
      partial:[2,1,7],'partial-published':[5,4,10],close:[1,1,5],corrupt:[2,1,4]};
    const counts=row.id==='tabs'?[3,3,result.result.includes('frontier-conflict')?8:6]:fixed[row.id];
    assert.ok(counts);expected=Object.fromEntries(['journal','partition','retention'].map((name,index)=>[name,counts[index]]));
  }
  verifyPayloadObservationCounts(result.calls,expected);return result;
}

export async function verifyPayloadJourney(build, row, options = {}) {
  const run = operation => runPayloadFixture(build, operation, {...options, label: options.label ?? row.id});
  const semantic='payload journey '+row.id+' contract';
  if (row.length) {
    const result = await run(page => page.evaluate(async ({length, repeated}) => {
      const {open, payload, same, decode, decodeEffectWire} = payloadFixture;
      const {storage, payloads} = await open('payload-boundary');
      const input = payload(length, repeated), saved = await payloads.stage({bytes: input, root: 'staging', expected: null});
      const actual = await payloads.load(saved.descriptor), snapshot = decode(await storage.snapshot());
      const descriptor = decodeEffectWire(saved.descriptor);
      payloads.close(); storage.close();
      return {same: same(input, actual), descriptor: Array.from(saved.descriptor), marker: Array.from(saved.marker),
        revision: snapshot[1], objects: snapshot[2].length, roots: snapshot[3].length,
        head: Array.from(snapshot[3][0][1]), references: snapshot[3][0][2].map(value => Array.from(value)),
        chunks: descriptor[2].length};
    }, {length: row.length, repeated: row.repeated ?? false}));
    const unique = row.repeated ? 1 : Math.ceil(row.length / 1048576), batches = Math.ceil((unique + 1) / 16);
    assert.equal(result.result.same, true); assert.equal(result.result.chunks, Math.ceil(row.length / 1048576));
    assert.deepEqual(result.result.descriptor, Array.from(expectedDescriptor(row.length, row.repeated)));
    assert.equal(result.result.revision, batches); assert.equal(result.result.objects, unique + 1);
    assert.equal(result.result.roots, 1); assert.equal(result.result.references.length, unique + 1);
    assert.deepEqual(result.result.head, result.result.marker);
    assert.deepEqual(Object.fromEntries(['journal','partition','retention'].map(entry => [entry,
      result.calls.filter(call => call.entry === entry).length])), {journal: 3, partition: 3, retention: 3 + 2 * batches});
    return accepted(result,row);
  }
  if (row.id === 'capture') {
    const result = await run(page => page.evaluate(async () => {
      const {open, payload, same, fail, decode} = payloadFixture;
      const {storage, payloads} = await open('payload-capture'), bytes = payload(1048577), expected = bytes.slice();
      const pending = payloads.stage({bytes, root: 'staging', expected: null}); bytes.fill(91);
      const busy = await fail(() => payloads.stage({bytes: expected, root: 'staging', expected: null}));
      let saved;
      try {saved = await pending;} catch(error) {payloads.close();storage.close();return {stageError:error.code ?? error.message};}
      const descriptor = saved.descriptor.slice();
      const loaded = payloads.load(saved.descriptor); saved.descriptor.fill(0);
      const actual = await loaded, snapshot = decode(await storage.snapshot());
      payloads.close(); const closed = await fail(() => payloads.load(descriptor)); storage.close();
      return {busy, closed, same: same(actual, expected), revision: snapshot[1]};
    }));
    assert.deepEqual(result.result, {busy:'payload-busy', closed:'payload-closed', same:true, revision:1},semantic); return accepted(result,row);
  }
  if (row.id === 'brand') {
    const result = await run(page => page.evaluate(async () => {
      const {open, options, openSessionPayloads, payload, fail, same} = payloadFixture;
      const {storage, payloads} = await open('payload-brand'); payloads.close();
      const fake = await fail(() => openSessionPayloads(options({snapshot: async()=>new Uint8Array(), read:async()=>null, commit:async()=>new Uint8Array()})));
      const constructed = new storage.constructor({close(){}},()=>true);
      const forged = await fail(async()=>{const handle=await openSessionPayloads(options(constructed));handle.close();});
      constructed.close();
      const prototype=Object.getPrototypeOf(storage),original=prototype.snapshot;let prototypeCalls=0;
      try {
        prototype.snapshot=async()=>{prototypeCalls++;return new Uint8Array();};
        const opened=await open('payload-brand-prototype');opened.payloads.close();opened.storage.close();
      } finally {prototype.snapshot=original;}
      let called = false;
      for (const name of ['snapshot','read','commit']) storage[name] = () => {called = true; throw Error('overwritten');};
      const next = await openSessionPayloads(options(storage)), bytes = payload(2);
      const saved = await next.stage({bytes, root:'staging', expected:null}), actual = await next.load(saved.descriptor);
      next.close(); storage.close(); return {fake, forged, prototypeCalls, called, same:same(bytes,actual)};
    }));
    assert.deepEqual(result.result, {fake:'invalid-input', forged:'invalid-input', prototypeCalls:0, called:false, same:true},semantic); return accepted(result,row);
  }
  if (row.id === 'versionchange') {
    const result=await run(page=>page.evaluate(async()=>{
      const {open,fail}=payloadFixture,{storage,payloads}=await open('payload-versionchange');payloads.close();
      const close=storage.close.bind(storage),snapshot=storage.snapshot.bind(storage);let called=0,blocked=0,closed;
      storage.close=()=>{called++;};
      try {
        await new Promise((resolve,reject)=>{
          const request=indexedDB.open('prismpm.browser.session.v1/payload-versionchange',2);
          request.onblocked=()=>{blocked++;close();};request.onerror=()=>reject(request.error);
          request.onsuccess=()=>{request.result.close();resolve();};
        });
        closed=await fail(()=>snapshot());
      } finally {close();}
      return {called,blocked,closed};
    }));
    assert.deepEqual(result.result,{called:0,blocked:0,closed:'storage-closed'},semantic);return accepted(result,row);
  }
  if (row.id === 'preserve') {
    const result = await run(page => page.evaluate(async () => {
      const {open, payload, same, fail, decode, encode} = payloadFixture;
      const {storage, payloads} = await open('payload-preserve');
      const first = await payloads.stage({bytes:payload(1048577),root:'staging',expected:null});
      const old = decode(first.frontier)[3][0][2].map(value=>Array.from(value));
      const stale = await fail(()=>payloads.stage({bytes:payload(3),root:'staging',expected:null}));
      const expected=first.marker.slice(),pending=payloads.stage({bytes:payload(3),root:'staging',expected});
      expected.fill(0);const second=await pending;
      const snapshot = decode(await storage.snapshot());
      const kept = old.every(id=>snapshot[3][0][2].some(ref=>same(ref,id)));
      const retirement = await fail(()=>storage.commit({expected:second.frontier,replacement:encode([0]),objects:[],retire:encode([Uint8Array.from(old[0])])}));
      let oldSame=false;
      try {oldSame=same(await payloads.load(first.descriptor),payload(1048577));} catch { /* Independent expected result below remains false. */ }
      payloads.close();storage.close();
      return {kept,stale,retirement,oldSame,revision:snapshot[1]};
    }));
    assert.deepEqual(result.result, {kept:true,stale:'staging-conflict',retirement:'model-rejected',oldSame:true,revision:2},semantic); return accepted(result,row);
  }
  if (row.id === 'digest') {
    const result = await run(page => page.evaluate(async () => {
      const {open,payload,fail,encodeEffectWire,decodeEffectWire} = payloadFixture;
      const {storage,payloads}=await open('payload-digest');
      const saved=await payloads.stage({bytes:payload(1048577),root:'staging',expected:null});
      const changed=decodeEffectWire(saved.descriptor);changed[0][0]^=1;
      const digest=await fail(()=>payloads.load(encodeEffectWire(changed)));
      const reversed=decodeEffectWire(saved.descriptor);reversed[2].reverse();
      const order=await fail(()=>payloads.load(encodeEffectWire(reversed)));
      const empty=await fail(()=>payloads.stage({bytes:new Uint8Array(),root:'other',expected:null}));
      const over=await fail(()=>payloads.stage({bytes:new Uint8Array(67108865),root:'other',expected:null}));
      payloads.close();storage.close();return {digest,order,empty,over};
    }));
    assert.deepEqual(result.result,{digest:'payload-invalid',order:'chunk-missing',empty:'model-rejected',over:'invalid-input'},semantic);return accepted(result,row);
  }
  if (row.id === 'partial') {
    const result = await run(page => page.evaluate(async () => {
      const {open,payload,fail,decode,digest,encodeEffectWire}=payloadFixture;
      const {storage,payloads}=await open('payload-partial'), bytes=payload(16*1048576+1);
      const chunks=[];for(let at=0;at<bytes.length;at+=1048576)chunks.push(await digest(bytes.subarray(at,at+1048576)));
      const descriptor=encodeEffectWire([await digest(bytes),bytes.length,chunks]),marker=await digest(descriptor);
      const original=IDBObjectStore.prototype.put;let writes=0;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='roots'&&++writes===2){this.transaction.abort();throw new DOMException('injected batch quota','QuotaExceededError');}return original.apply(this,args);};
      let code;try{code=await fail(()=>payloads.stage({bytes,root:'staging',expected:null}));}finally{IDBObjectStore.prototype.put=original;}
      const snapshot=decode(await storage.snapshot()), root=snapshot[3][0], absent=await storage.read(marker);
      const uncertain=await fail(()=>payloads.stage({bytes:payload(1),root:'staging',expected:root[1]}));
      const missing=await fail(()=>payloads.load(descriptor));payloads.close();storage.close();
      return {code,writes,revision:snapshot[1],objects:snapshot[2].length,references:root[2].length,
        head:Array.from(root[1]),expectedHead:Array.from(chunks[15]),absent,uncertain,missing};
    }));
    assert.equal(result.result.code,'storage-quota',semantic);assert.equal(result.result.writes,2,semantic);
    assert.equal(result.result.revision,1,semantic);assert.equal(result.result.objects,16,semantic);assert.equal(result.result.references,16,semantic);
    assert.deepEqual(result.result.head,result.result.expectedHead,semantic);assert.equal(result.result.absent,null,semantic);
    assert.equal(result.result.uncertain,'publication-uncertain',semantic);assert.equal(result.result.missing,'chunk-missing',semantic);return accepted(result,row);
  }
  if (row.id === 'partial-published') {
    const result=await run(page=>page.evaluate(async()=>{
      const {open,payload,fail,decode,digest,encodeEffectWire,same}=payloadFixture;
      const {storage,payloads}=await open('payload-partial-published');
      const oldBytes=new Uint8Array(1048577).fill(91);
      const old=await payloads.stage({bytes:oldBytes,root:'staging',expected:null});
      const oldReferences=decode(old.frontier)[3][0][2],bytes=payload(16*1048576+1),chunks=[];
      for(let at=0;at<bytes.length;at+=1048576)chunks.push(await digest(bytes.subarray(at,at+1048576)));
      const descriptor=encodeEffectWire([await digest(bytes),bytes.length,chunks]),marker=await digest(descriptor);
      const original=IDBObjectStore.prototype.put;let writes=0;
      IDBObjectStore.prototype.put=function(...args){if(this.name==='roots'&&++writes===2){this.transaction.abort();throw new DOMException('injected batch quota','QuotaExceededError');}return original.apply(this,args);};
      let code;try{code=await fail(()=>payloads.stage({bytes,root:'staging',expected:old.marker}));}
      finally{IDBObjectStore.prototype.put=original;}
      const snapshot=decode(await storage.snapshot()),root=snapshot[3][0];
      const kept=oldReferences.every(id=>root[2].some(ref=>same(id,ref)));
      const oldSame=same(await payloads.load(old.descriptor),oldBytes),absent=await storage.read(marker);
      const uncertain=await fail(()=>payloads.stage({bytes:payload(1),root:'staging',expected:root[1]}));
      const missing=await fail(()=>payloads.load(descriptor));payloads.close();storage.close();
      return {code,writes,revision:snapshot[1],objects:snapshot[2].length,references:root[2].length,
        head:Array.from(root[1]),expectedHead:Array.from(chunks[15]),kept,oldSame,absent,uncertain,missing};
    }));
    assert.equal(result.result.code,'storage-quota',semantic);assert.equal(result.result.writes,2,semantic);
    assert.equal(result.result.revision,2,semantic);assert.equal(result.result.objects,19,semantic);
    assert.equal(result.result.references,19,semantic);assert.equal(result.result.kept,true,semantic);
    assert.equal(result.result.oldSame,true,semantic);assert.deepEqual(result.result.head,result.result.expectedHead,semantic);
    assert.equal(result.result.absent,null,semantic);assert.equal(result.result.uncertain,'publication-uncertain',semantic);
    assert.equal(result.result.missing,'chunk-missing',semantic);return accepted(result,row);
  }
  if (row.id === 'close') {
    const result = await run(page=>page.evaluate(async()=>{
      const {open,payload,fail,decode}=payloadFixture,{storage,payloads}=await open('payload-close');
      const original=Object.getOwnPropertyDescriptor(IDBTransaction.prototype,'oncomplete');let closed=false;
      Object.defineProperty(IDBTransaction.prototype,'oncomplete',{...original,set(handler){
        return original.set.call(this,event=>{if(this.mode==='readwrite'&&!closed){closed=true;payloads.close();}handler.call(this,event);});
      }});
      let code;try{code=await fail(()=>payloads.stage({bytes:payload(16*1048576+1),root:'staging',expected:null}));}
      finally{Object.defineProperty(IDBTransaction.prototype,'oncomplete',original);}
      const snapshot=decode(await storage.snapshot());storage.close();return {code,closed,revision:snapshot[1],objects:snapshot[2].length};
    }));
    assert.deepEqual(result.result,{code:'payload-closed',closed:true,revision:1,objects:16},semantic);return accepted(result,row);
  }
  if (row.id === 'corrupt') {
    const result=await run(page=>page.evaluate(async()=>{
      const {open,payload,fail}=payloadFixture,{storage,payloads}=await open('payload-corrupt');
      const original=IDBObjectStore.prototype.add;
      IDBObjectStore.prototype.add=function(value,...args){
        if(this.name==='objects'&&value.length===1){value=value.slice();value[0]^=1;}
        return original.call(this,value,...args);
      };
      let code;try{code=await fail(()=>payloads.stage({bytes:payload(1),root:'staging',expected:null}));}
      finally{IDBObjectStore.prototype.add=original;payloads.close();storage.close();}return code;
    }));
    assert.equal(result.result,'object-corrupt',semantic);return accepted(result,row);
  }
  assert.equal(row.id,'tabs');
  const result=await run(async(first,{prepare})=>{
    const second=await first.context().newPage();await prepare(second);
    const results=await Promise.all([first,second].map(page=>page.evaluate(async()=>{
      const {open,payload,fail}=payloadFixture,{storage,payloads}=await open('payload-tabs');
      const code=await fail(()=>payloads.stage({bytes:payload(1048577),root:'staging',expected:null}));
      payloads.close();storage.close();return code;
    })));
    assert.equal(results.filter(code=>code==='unexpected-success').length,1);
    assert.ok(results.some(code=>['staging-conflict','frontier-conflict'].includes(code)));return results;
  });
  return accepted(result,row);
}
