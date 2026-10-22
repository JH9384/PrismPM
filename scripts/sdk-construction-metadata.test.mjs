import assert from 'node:assert/strict';
import test from 'node:test';
import {fixture,storedZip} from './sdk-construction-archive-fixture.mjs';
import {readConstructionMetadata} from './sdk-construction-metadata.mjs';
const range=f=>async(start,length,signal)=>{assert(!signal.aborted);return f.bytes.subarray(start,start+length);};
test('bounded ordinary and ZIP64 acquisition retains every original small member',async()=>{
 for(const wide of[false,true]){
  const f=fixture({wide}),r=await readConstructionMetadata(f.bytes.length,range(f));
  assert.equal(r.scope,'selected-metadata-only-not-authentication-or-complete-archive-integrity');assert.deepEqual(r.members,f.plan.members);
  assert(r.range_calls<=512&&r.selected_bytes<=96*1024**2+1024**2);assert.equal(r.status,undefined);
 }
});
test('closed original names methods flags types and local/central bindings cannot change',async()=>{
 for(const mutate of [f=>f.bytes.writeUInt16LE(8,f.central+10),f=>f.bytes.writeUInt16LE(1,f.central+8),
  f=>f.bytes.writeUInt32LE((0o120777<<16)>>>0,f.central+38),f=>f.bytes.writeUInt32LE(1,f.central+42),
  f=>f.bytes.writeUInt32LE(1,f.rows[0].data+f.rows[0].length+4),f=>f.bytes.writeUInt16LE(8,8),
  f=>f.bytes[f.central+46]^=1,f=>f.bytes.writeUInt16LE(1,f.bytes.length-22+4),f=>f.bytes.writeUInt32LE(0,f.bytes.length-22+16)]){
  const f=fixture({zip:mutate});await assert.rejects(readConstructionMetadata(f.bytes.length,range(f)));
 }
});
test('metadata budgets and complete exact inventories precede member payload selection',async()=>{
 const f=fixture(),at=f.central+f.rows.slice(0,f.rows.findIndex(r=>r.name==='construction.json')).reduce((n,r)=>n+46+Buffer.byteLength(r.name),0);
 f.bytes.writeUInt32LE(65537,at+20);f.bytes.writeUInt32LE(65537,at+24);
 const reads=[];await assert.rejects(readConstructionMetadata(f.bytes.length,async(s,n)=>{reads.push([s,n]);return f.bytes.subarray(s,s+n);}),/metadata member budget exceeded/);
 assert.equal(reads.length,2,'only terminal directory reads precede rejection');
 for(const files of[new Map([...f.plan.members,['foreign',Buffer.from('x')]]),new Map(f.plan.members)]){
  const z=storedZip(files);await assert.rejects(readConstructionMetadata(z.bytes.length,range(z)));
 }
});
test('substitution incomplete ranges and malformed UTF8 names cannot issue metadata',async()=>{
 const f=fixture();f.bytes[f.rows[0].data]^=1;await assert.rejects(readConstructionMetadata(f.bytes.length,range(f)),/metadata CRC differs/);
 for(const value of[Buffer.alloc(0),new Uint8Array(1),null])await assert.rejects(readConstructionMetadata(f.bytes.length,async()=>value),/complete exact bounded range required/);
 const g=fixture();g.bytes[g.central+46]=255;await assert.rejects(readConstructionMetadata(g.bytes.length,range(g)));
});
test('range cancellation is bounded and every caller observes terminal abort',async()=>{
 const f=fixture();let signal;
 await assert.rejects(readConstructionMetadata(f.bytes.length,async(s,n,a)=>{signal=a;return new Promise(()=>{});},10),/metadata acquisition deadline exceeded/);
 assert(signal.aborted);
 let last;const r=await readConstructionMetadata(f.bytes.length,async(s,n,a)=>{last=a;return range(f)(s,n,a);});assert(r.members.size===11&&last.aborted);
});
test('invalid ZIP64 end counts sizes offsets locator and truncation fail closed',async()=>{
 for(const mutate of[f=>f.bytes.writeUInt32LE(2,f.bytes.length-22-20+16),
  f=>f.bytes.writeBigUInt64LE(13n,f.bytes.length-22-20-56+32),
  f=>f.bytes.writeBigUInt64LE(1n,f.bytes.length-22-20-56+48),
  f=>f.bytes.writeBigUInt64LE(0xffffffffffffffffn,f.bytes.length-22-20+8)]){
  const f=fixture({wide:true,zip:mutate});await assert.rejects(readConstructionMetadata(f.bytes.length,range(f)));
 }
 const f=fixture();for(const d of[-1,1]){
  const bytes=d<0?f.bytes.subarray(0,-1):Buffer.concat([f.bytes,Buffer.from([0])]);await assert.rejects(readConstructionMetadata(bytes.length,range({bytes})));
 }
});
