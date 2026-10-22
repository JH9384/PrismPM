import assert from 'node:assert/strict';
import test from 'node:test';
import {Readable} from 'node:stream';
import {spawnSync} from 'node:child_process';
import {fixture,sha} from './sdk-construction-archive-fixture.mjs';
import {verifyConstructionArchiveStream,resolveStoredZip64,validateStoredDataDescriptor} from './sdk-construction-archive.mjs';
const input=(b,step=257)=>Readable.from((function*(){for(let p=0;p<b.length;p+=step)yield b.subarray(p,p+step);})());
test('consumed archive chunks are collectible while the original stream and deadline remain active',()=>{
 const script=`import assert from 'node:assert/strict';
 import {Readable} from 'node:stream';
 import {fixture} from ${JSON.stringify(new URL('./sdk-construction-archive-fixture.mjs',import.meta.url).href)};
 import {verifyConstructionArchiveStream} from ${JSON.stringify(new URL('./sdk-construction-archive.mjs',import.meta.url).href)};
 const f=fixture({indexPadding:262144}),references=[];let measured=0;
 const stream=Readable.from((async function*(){
  for(let at=0;at<f.bytes.length;at+=512){
   const chunk=Buffer.from(f.bytes.subarray(at,at+512));references.push(new WeakRef(chunk));yield chunk;
   if(references.length===256){
    for(let i=0;i<3;i++){await new Promise(r=>setImmediate(r));global.gc();}
    const retained=references.filter(ref=>ref.deref()).length;
    assert(retained<=4,'deadline ownership retained consumed chunks: '+retained);measured++;
   }
  }
 })());
 const result=await verifyConstructionArchiveStream(stream,f.plan);
 assert.equal(measured,1);assert(result.transport_closed);assert.equal(result.artifact.digest,f.plan.artifact.digest);
 console.log(JSON.stringify({scope:'tiny real-byte unit retention only; not SDK or resource qualification',consumed:references.length,measured}));`;
 const result=spawnSync(process.execPath,['--expose-gc','--input-type=module','-e',script],{encoding:'utf8',timeout:20000,maxBuffer:65536});
 assert.ifError(result.error);assert.equal(result.signal,null);assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).measured,1);
});
function checksum(b,p=0){b.fill(32,p+148,p+156);const sum=b.subarray(p,p+512).reduce((n,x)=>n+x,0);b.write(sum.toString(8).padStart(6,'0')+'\0 ',p+148);}
test('complete original stored ZIP and OCI graph integrity across every parser boundary',async()=>{
 for(const step of[1,7,257,65536])for(const wide of[false,true]){
  const f=fixture({wide}),stream=input(f.bytes,step),r=await verifyConstructionArchiveStream(stream,f.plan);
  assert.equal(r.scope,'original-stored-zip-and-oci-blob-integrity-only');assert.equal(r.members.length,12);assert.equal(r.layout.blob_count,3);
  assert.deepEqual(r.artifact,f.plan.artifact);assert.deepEqual(r.archive,f.plan.archive);assert(stream.destroyed&&stream.closed&&r.transport_closed);
  assert(r.unclaimed.includes('installed-sdk')&&r.unclaimed.includes('provider-authentication'));assert.equal(r.status,undefined);
 }
});
test('actual large member ZIP64 widths and 24-byte descriptors use exact integer values',()=>{
 for(const size of[5169816064,5140752896]){
  const extra=Buffer.alloc(24);extra.writeBigUInt64LE(BigInt(size),0);extra.writeBigUInt64LE(BigInt(size),8);extra.writeBigUInt64LE(5000000000n,16);
  assert.deepEqual(resolveStoredZip64({expanded:0xffffffff,compressed:0xffffffff,offset:0xffffffff},extra),{expanded:size,compressed:size,offset:5000000000});
  const d=Buffer.alloc(24);d.writeUInt32LE(0x08074b50);d.writeUInt32LE(123,4);d.writeBigUInt64LE(BigInt(size),8);d.writeBigUInt64LE(BigInt(size),16);
  assert.doesNotThrow(()=>validateStoredDataDescriptor(d,123,size));
  for(const p of[0,4,8,16]){const bad=Buffer.from(d);bad[p]^=1;assert.throws(()=>validateStoredDataDescriptor(bad,123,size));}
  for(const b of[extra.subarray(0,16),Buffer.concat([extra,Buffer.alloc(8)])])assert.throws(()=>resolveStoredZip64({expanded:0xffffffff,compressed:0xffffffff,offset:0xffffffff},b));
  assert.throws(()=>validateStoredDataDescriptor(d.subarray(0,16),123,size));
 }
 const unsafe=Buffer.alloc(8,255);assert.throws(()=>resolveStoredZip64({expanded:0xffffffff,compressed:0,offset:null},unsafe));
});
test('final synchronous validation cannot publish after the monotonic deadline',async()=>{
 const f=fixture(),clock=globalThis.performance,parse=JSON.parse;let current=0;
 try{
  globalThis.performance={now:()=>current};JSON.parse=function(text,...args){const value=parse.call(this,text,...args);if(text.includes('imageLayoutVersion'))current=10001;return value;};
  await assert.rejects(verifyConstructionArchiveStream(input(f.bytes),f.plan,10000),/construction stream deadline exceeded/);
 }finally{globalThis.performance=clock;JSON.parse=parse;}
});
test('transport completion waits for actual delayed close and refuses uncertain cleanup',async()=>{
 const f=fixture();let sent=false,closeObserved=false;
 const delayed=new Readable({read(){if(!sent){sent=true;this.push(f.bytes);this.push(null);}},destroy(error,callback){setTimeout(()=>{closeObserved=true;callback(error);},30);}});
 const r=await verifyConstructionArchiveStream(delayed,f.plan);assert(closeObserved&&delayed.closed&&r.transport_closed);
 const stalled=new Readable({read(){},destroy(){}});
 await assert.rejects(verifyConstructionArchiveStream(stalled,f.plan,10),e=>e instanceof AggregateError&&
  e.errors.some(e=>/construction stream deadline exceeded/.test(e.message))&&e.errors.some(e=>/close not observed/.test(e.message)));
 assert.equal(stalled.closed,false);
});
test('asynchronous caller mutations cannot replace selected ZIP or returned archive authority',async()=>{
 const f=fixture(),original={...f.plan.artifact};f.bytes.writeUInt16LE(1,10); // Semantically ignored ZIP timestamp, but different original bytes.
 const attacker=Readable.from((async function*(){yield f.bytes.subarray(0,30);f.plan.artifact.digest=sha(f.bytes);yield f.bytes.subarray(30);})());
 await assert.rejects(verifyConstructionArchiveStream(attacker,f.plan),/original provider ZIP digest differs/);
 assert.notEqual(f.plan.artifact.digest,original.digest);
 const g=fixture(),archive={...g.plan.archive},artifact={...g.plan.artifact};
 const moved=Readable.from((async function*(){yield g.bytes.subarray(0,30);g.plan.archive.digest='sha256:'+'0'.repeat(64);
  g.plan.archive.byte_length=1;g.plan.artifact.byte_length=1;for(const b of g.plan.members.values())b.fill(0);yield g.bytes.subarray(30);})());
 const r=await verifyConstructionArchiveStream(moved,g.plan);assert.deepEqual(r.archive,archive);assert.deepEqual(r.artifact,artifact);
});
test('fully resealed tar numeric fields reject high-bit octal and embedded NUL junk',async()=>{
 for(const mutate of [b=>{b[124]|=0x80;checksum(b);},b=>{b[125]=0;b[126]=120;checksum(b);},
  b=>{b[148]|=0x80;},b=>{b[154]=0;b[155]=120;}]){
  const f=fixture({tar:b=>{mutate(b);return b;}});
  await assert.rejects(verifyConstructionArchiveStream(input(f.bytes),f.plan),/ordinary bounded octal tar field required/);
 }
});
test('one-byte fragments use bounded document buffers for large valid OCI metadata',async()=>{
 const f=fixture({indexPadding:65536});const r=await verifyConstructionArchiveStream(input(f.bytes,1),f.plan);
 assert.equal(r.layout.blob_count,3);assert(r.layout.members.find(r=>r.path==='index.json').byte_length>65536);
});
test('coherently rehashed ZIP metadata cannot change local headers central CRC offsets or file types',async()=>{
 for(const change of [f=>f.bytes.writeUInt16LE(1,6),f=>f.bytes.writeUInt16LE(8,8),
  f=>f.bytes.writeUInt32LE(1,14),f=>f.bytes.writeUInt32LE(1,18),f=>f.bytes.writeUInt32LE(1,f.central+16),
  f=>f.bytes.writeUInt32LE(1,f.central+20),f=>f.bytes.writeUInt32LE(1,f.central+42),
  f=>f.bytes.writeUInt32LE((0o120777<<16)>>>0,f.central+38),f=>f.bytes.writeUInt16LE(1,f.central+34),
  f=>f.bytes.writeUInt32LE(1,f.bytes.length-22+12)]){
  const f=fixture({zip:change});await assert.rejects(verifyConstructionArchiveStream(input(f.bytes),f.plan));
 }
});
test('signed data descriptors and original member bytes cannot be substituted',async()=>{
 for(const mutate of [f=>f.bytes[f.rows[0].data]^=1,
  f=>f.bytes.writeUInt32LE(0,f.rows[0].data+f.rows[0].length),
  f=>f.bytes.writeUInt32LE(0,f.rows[0].data+f.rows[0].length+4),
  f=>f.bytes.writeUInt32LE(0,f.rows[0].data+f.rows[0].length+8)]){
  const f=fixture({zip:mutate});await assert.rejects(verifyConstructionArchiveStream(input(f.bytes),f.plan));
 }
});
test('fully resealed tar substitution still fails exact OCI blob identity and complete graph',async()=>{
 const cases=[
  [rows=>rows.filter(r=>r.name!==rows[2].name),/missing original OCI DAG blob/],
  [rows=>rows.map((r,i)=>i===2?{...r,data:Buffer.alloc(r.data.length,1)}:r),/original OCI blob digest differs/],
  [rows=>[...rows,rows[2]],/duplicate OCI layout member/],
  [rows=>rows.map((r,i)=>i===2?{...r,name:'../escape'}:r),/member outside exact OCI image DAG/],
  [rows=>rows.map((r,i)=>i===2?{...r,type:'2'}:r),/tar links devices sparse and extended entries prohibited/],
  [rows=>rows.map((r,i)=>i===2?{...r,type:'3'}:r),/tar links devices sparse and extended entries prohibited/],
  [rows=>rows.filter(r=>r.name!=='blobs/'),/original OCI layout ancestors required/],
  [rows=>rows.map(r=>r.name==='oci-layout'?{...r,data:Buffer.from('{"imageLayoutVersion":"other"}')}:r),/Expected values/],
 ];
 for(const [entries,reason]of cases){const f=fixture({entries});await assert.rejects(verifyConstructionArchiveStream(input(f.bytes),f.plan),reason);}
});
test('original provider ZIP digest and record/archive/smoke bindings cannot be self-replaced',async()=>{
 for(const mutate of [f=>f.plan.artifact.digest='sha256:'+'0'.repeat(64),f=>f.plan.archive.digest='sha256:'+'0'.repeat(64),
  f=>f.plan.members.set('evidence/cli.json',Buffer.from('foreign'))]){
  const f=fixture();mutate(f);const stream=input(f.bytes);await assert.rejects(verifyConstructionArchiveStream(stream,f.plan));assert(stream.destroyed);
 }
});
test('truncated or trailing original ZIP and transport cancellation cannot issue integrity output',async()=>{
 for(const delta of[-1,1]){const f=fixture(),b=delta<0?f.bytes.subarray(0,-1):Buffer.concat([f.bytes,Buffer.from([1])]);
  f.plan.artifact={byte_length:b.length,digest:sha(b)};await assert.rejects(verifyConstructionArchiveStream(input(b),f.plan));}
 const f=fixture(),stream=new Readable({read(){this.destroy(Error('transport interrupted'));}});
 await assert.rejects(verifyConstructionArchiveStream(stream,f.plan),/transport interrupted/);assert(stream.destroyed);
});
test('bounded stalled streams are retired and no invalid plan leaves its input running',async()=>{
 const f=fixture(),stalled=new Readable({read(){}});
 await assert.rejects(verifyConstructionArchiveStream(stalled,f.plan,10),/construction stream deadline exceeded/);assert(stalled.destroyed);
 const stream=input(f.bytes);await assert.rejects(verifyConstructionArchiveStream(stream,{...f.plan,extra:true}));assert(stream.destroyed);
 const large=Readable.from([Buffer.alloc(1024**2+1)]);await assert.rejects(verifyConstructionArchiveStream(large,f.plan),/bounded original stream chunks/);assert(large.destroyed);
});
