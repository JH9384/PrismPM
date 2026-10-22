// Fixed stored-ZIP construction transport, not a general extractor. Independently
// authenticated provider/metadata admission remains the caller's obligation.
// Integrity of original bytes is not installed SDK, filesystem or VV acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {Readable} from 'node:stream';
import {crc32} from 'node:zlib';
import {beginConstructionStage} from './sdk-construction-stage.mjs';

const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const verifiedArchives=new WeakMap();
export function constructionIntegrityArchive(receipt){const archive=verifiedArchives.get(receipt);assert(archive,'actual whole-stream integrity authority required');return {...archive};}
const integer=(n,max)=>assert(Number.isSafeInteger(n)&&n>0&&n<=max);
const digest=d=>assert.match(d,/^sha256:[0-9a-f]{64}$/);
const utf8=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const keys=(v,names)=>assert.deepEqual(Object.keys(v).sort(),names.slice().sort());
const number=n=>{assert(n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER));return Number(n);};
const json=b=>{assert(Buffer.isBuffer(b)&&b.length<=4*1024**2);return JSON.parse(utf8(b));};
const extras=b=>{
 const values=new Map();let p=0;
 while(p<b.length){assert(p+4<=b.length);const tag=b.readUInt16LE(p),size=b.readUInt16LE(p+2);p+=4;
  assert(p+size<=b.length&&!values.has(tag),'bounded unique ZIP extra fields required');values.set(tag,b.subarray(p,p+size));p+=size;}
 return values;
};
const cstring=b=>{const z=b.indexOf(0);assert(z<0||b.subarray(z).every(x=>x===0));return utf8(z<0?b:b.subarray(0,z));};
const octal=b=>{const text=b.toString('latin1');assert(/^ *[0-7]+[ \0]*$/.test(text),'ordinary bounded octal tar field required');
 const n=parseInt(text,8);assert(Number.isSafeInteger(n)&&n>=0);return n;};

export function resolveStoredZip64(fields,extra){
 keys(fields,['expanded','compressed','offset']);let at=0;
 const wide=()=>{assert(Buffer.isBuffer(extra)&&at+8<=extra.length,'complete ZIP64 member fields required');const n=number(extra.readBigUInt64LE(at));at+=8;return n;};
 const result={};for(const key of['expanded','compressed','offset']){
  const n=fields[key];assert((key==='offset'&&n===null)||(Number.isSafeInteger(n)&&n>=0&&n<=0xffffffff));result[key]=n===0xffffffff?wide():n;
 }
 if(at)assert.equal(at,extra.length,'unexpected ZIP64 member fields');return result;
}
export function validateStoredDataDescriptor(bytes,checksum,size){
 integer(size,64*1024**3);assert(Number.isSafeInteger(checksum)&&checksum>=0&&checksum<=0xffffffff);
 const wide=size>0xffffffff;assert(Buffer.isBuffer(bytes)&&bytes.length===(wide?24:16));
 assert.equal(bytes.readUInt32LE(0),0x08074b50);assert.equal(bytes.readUInt32LE(4),checksum);
 assert.equal(wide?number(bytes.readBigUInt64LE(8)):bytes.readUInt32LE(8),size);
 assert.equal(wide?number(bytes.readBigUInt64LE(16)):bytes.readUInt32LE(12),size);
}

// No layer is expanded and no archive path is materialized. Every stored blob
// must belong to the exact image DAG and match its original descriptor bytes.
function tarVerifier(manifestBytes,configBytes){
 const manifest=json(manifestBytes),config=json(configBytes),expected=new Map(),seen=new Set(),records=[];
 assert.equal(manifest.schemaVersion,2);assert.equal(manifest.mediaType,'application/vnd.oci.image.manifest.v1+json');
 assert(Array.isArray(manifest.layers)&&manifest.layers.length<=256);
 const add=(d,bytes)=>{digest(d.digest);integer(d.size,64*1024**3);assert.equal(d.urls,undefined);assert.equal(d.data,undefined);
  if(bytes){assert.equal(d.digest,sha(bytes));assert.equal(d.size,bytes.length);}
  const path='blobs/sha256/'+d.digest.slice(7);if(expected.has(path))assert.equal(expected.get(path).size,d.size);
  expected.set(path,{digest:d.digest,size:d.size});};
 const child={digest:sha(manifestBytes),size:manifestBytes.length,mediaType:manifest.mediaType};
 add(child,manifestBytes);add(manifest.config,configBytes);for(const layer of manifest.layers)add(layer);
 const header=Buffer.alloc(512);let at=0,active,padding=0,zeros=0,bytes=0;
 const documents=new Map();
 function finish(){
  const hash='sha256:'+active.hash.digest('hex');
  if(active.blob)assert.equal(hash,expected.get(active.name).digest,'original OCI blob digest differs');
  else documents.set(active.name,active.buffer);
  records.push({path:active.name,byte_length:active.size,digest:hash});padding=(512-active.size%512)%512;active=undefined;
 }
 function parse(){
  if(header.every(x=>x===0)){zeros++;return;}
  assert.equal(zeros,0,'nonzero content follows tar termination');
  const sum=header.reduce((n,x,i)=>n+(i>=148&&i<156?32:x),0);assert.equal(octal(header.subarray(148,156)),sum,'tar header checksum differs');
  assert.equal(header.subarray(257,265).toString('latin1'),'ustar\0'+'00','ordinary USTAR construction members required');
  assert.equal(cstring(header.subarray(157,257)),'','tar links prohibited');
  const prefix=cstring(header.subarray(345,500)),name=(prefix?prefix+'/':'')+cstring(header.subarray(0,100));
  assert(!seen.has(name),'duplicate OCI layout member');seen.add(name);assert(seen.size<=264);
  const size=octal(header.subarray(124,136)),type=header[156];
  assert([0,48,53].includes(type),'tar links devices sparse and extended entries prohibited');
  if(type===53){assert(['blobs/','blobs/sha256/'].includes(name)&&size===0);return;}
  const blob=expected.has(name);assert(blob||['index.json','oci-layout'].includes(name),'member outside exact OCI image DAG');
  integer(size,blob?64*1024**3:4*1024**2);if(blob)assert.equal(size,expected.get(name).size,'original OCI blob length differs');
  active={name,size,remaining:size,blob,hash:createHash('sha256'),buffer:blob?undefined:Buffer.alloc(size),offset:0};
 }
 return {
  feed(chunk){
   bytes+=chunk.length;assert(bytes<=64*1024**3);
   while(chunk.length){
    if(active){const n=Math.min(chunk.length,active.remaining),part=chunk.subarray(0,n);active.hash.update(part);
     if(!active.blob){part.copy(active.buffer,active.offset);active.offset+=n;}active.remaining-=n;chunk=chunk.subarray(n);if(active.remaining===0)finish();
    }else if(padding){const n=Math.min(chunk.length,padding);assert(chunk.subarray(0,n).every(x=>x===0),'nonzero tar padding');padding-=n;chunk=chunk.subarray(n);
    }else{const n=Math.min(chunk.length,512-at);chunk.copy(header,at,0,n);at+=n;chunk=chunk.subarray(n);if(at===512){parse();at=0;}}
   }
  },
  finish(){
   assert(!active&&padding===0&&at===0&&zeros>=2,'complete tar content and two terminators required');
   assert(seen.has('blobs/')&&seen.has('blobs/sha256/'),'original OCI layout ancestors required');
   for(const path of expected.keys())assert(seen.has(path),'missing original OCI DAG blob');
   const index=json(documents.get('index.json'));assert.equal(index.schemaVersion,2);
   assert.equal(index.mediaType,'application/vnd.oci.image.index.v1+json');assert.equal(index.manifests.length,1);
   const d=index.manifests[0];assert.equal(d.mediaType,child.mediaType);assert.equal(d.digest,child.digest);assert.equal(d.size,child.size);
   assert.equal(d.urls,undefined);assert.equal(d.data,undefined);
   if(d.platform){assert.equal(d.platform.os,config.os);assert.equal(d.platform.architecture,config.architecture);}
   assert.deepEqual(json(documents.get('oci-layout')),{imageLayoutVersion:'1.0.0'});
   return {members:records,layout_index_digest:sha(documents.get('index.json')),blob_count:expected.size};
  }
 };
}

async function verifyStream(stream,plan,timeout,stage){
 assert(stream instanceof Readable,'owned bounded Node readable transport required');
 keys(plan,['artifact','archive','members']);
 for(const row of[plan.artifact,plan.archive])keys(row,['byte_length','digest']);
 const artifact={...plan.artifact},archive={...plan.archive};
 for(const row of[artifact,archive]){integer(row.byte_length,64*1024**3+96*1024**2);digest(row.digest);}
 integer(archive.byte_length,64*1024**3);integer(timeout,1800000);
 assert(plan.members instanceof Map&&plan.members.size===11);
 const names=['construction.json',...['authority-result.json','candidate.json','cli.json','config.json','digest.txt','inventory.json',
  'manifest.json','model-check.json','standards.lock','tamper.json'].map(n=>'evidence/'+n)].sort();
 assert.deepEqual([...plan.members.keys()].sort(),names);
 let total=0;const expected=new Map();
 for(const [path,b]of plan.members){assert(Buffer.isBuffer(b));integer(b.length,path==='construction.json'?65536:64*1024**2);total+=b.length;
  assert(total<=96*1024**2);}
 // Never retain mutable caller authority across an await. Budget admission
 // precedes the private snapshot allocation, hashing and parsing.
 const members=new Map([...plan.members].map(([path,b])=>[path,Buffer.from(b)]));
 for(const [path,b]of members)expected.set(path,{size:b.length,digest:sha(b)});
 const record=json(members.get('construction.json'));
 assert.deepEqual(record.archive,{path:'sdk.oci.tar',...archive},'construction record/archive binding differs');
 const mb=members.get('evidence/manifest.json');assert.deepEqual(record.manifest,{digest:sha(mb),byte_length:mb.length});
 assert.deepEqual(record.smoke_evidence.map(r=>[r.path,r.byte_length,r.digest]).sort(),
  [...members].filter(([p])=>p!=='construction.json').map(([p,b])=>[p,b.length,sha(b)]).sort(),'construction record/smoke binding differs');
 expected.set('sdk.oci.tar',{size:archive.byte_length,digest:archive.digest});
 const tar=tarVerifier(members.get('evidence/manifest.json'),members.get('evidence/config.json'));
 const end=performance.now()+timeout,iterator=stream[Symbol.asyncIterator](),hash=createHash('sha256');
 const deadline=new AbortController();
 const timer=setTimeout(()=>{const error=Error('construction stream deadline exceeded');deadline.abort(error);stream.destroy(error);},timeout);
 // A shared pending Promise.race loser retains every settled chunk. Own only
 // one abort listener, and detach it on each read's settlement instead.
 const next=()=>new Promise((resolve,reject)=>{
  let settled=false;
  const finish=(error,item)=>{if(settled)return;settled=true;deadline.signal.removeEventListener('abort',abort);
   if(error)reject(error);else resolve(item);};
  const abort=()=>finish(deadline.signal.reason);
  deadline.signal.addEventListener('abort',abort,{once:true});
  if(deadline.signal.aborted)abort();
  else {try{Promise.resolve(iterator.next()).then(item=>finish(null,item),error=>finish(error));}catch(error){finish(error);}}
 });
 let current=Buffer.alloc(0),position=0,done=false,completed=false;
 async function consume(length,observe){
  assert(Number.isSafeInteger(length)&&length>=0&&position+length<=artifact.byte_length,'bounded complete ZIP span required');
  while(length){assert(performance.now()<=end,'construction stream deadline exceeded');
   if(!current.length){const item=await next();assert(!item.done,'truncated original ZIP');
    assert(Buffer.isBuffer(item.value)&&item.value.length>0&&item.value.length<=1024**2,'bounded original stream chunks required');current=item.value;}
   const n=Math.min(length,current.length),part=current.subarray(0,n);hash.update(part);await observe?.(part);position+=n;length-=n;current=current.subarray(n);
  }
 }
 async function read(n){assert(n<=262144);const b=Buffer.alloc(n);let at=0;await consume(n,part=>{part.copy(b,at);at+=part.length;});return b;}
 const locals=[];
 try{
  for(let i=0;i<12;i++){
   const local=position,h=await read(30);assert.equal(h.readUInt32LE(0),0x04034b50);
   const flags=h.readUInt16LE(6),method=h.readUInt16LE(8),nl=h.readUInt16LE(26),el=h.readUInt16LE(28);
   assert.equal(flags&~0x0808,0);assert.equal(method,0,'locked compression-level-zero construction transport required');
   integer(nl,256);assert(el<=4096);const name=utf8(await read(nl)),extra=extras(await read(el));
   assert(expected.has(name)&&!locals.some(x=>x.name===name),'closed unique construction ZIP inventory required');
   const row=expected.get(name);let checksum=0;const memberHash=createHash('sha256');
   await consume(row.size,async part=>{checksum=crc32(part,checksum);memberHash.update(part);if(name==='sdk.oci.tar'){tar.feed(part);if(stage)await stage.write(part);}});
   assert.equal('sha256:'+memberHash.digest('hex'),row.digest,'original construction member digest differs');
   const zip64=row.size>0xffffffff,check=(n,want)=>assert((flags&8)?n===0||n===want:n===want,'ZIP local/actual member differs');
   check(h.readUInt32LE(14),checksum);const {compressed,expanded}=resolveStoredZip64({compressed:h.readUInt32LE(18),expanded:h.readUInt32LE(22),offset:null},extra.get(1));
   check(compressed,row.size);check(expanded,row.size);
   if(flags&8)validateStoredDataDescriptor(await read(zip64?24:16),checksum,row.size);
   locals.push({local,name,flags,method,checksum,size:row.size});
  }
  assert.deepEqual(locals.map(x=>x.name).sort(),[...expected.keys()].sort());
  const offset=position;
  for(const row of locals){
   const h=await read(46);assert.equal(h.readUInt32LE(0),0x02014b50);assert.equal(h.readUInt16LE(8),row.flags);assert.equal(h.readUInt16LE(10),row.method);
   assert.equal(h.readUInt32LE(16),row.checksum);assert.equal(h.readUInt16LE(34),0);
   const fileType=(h.readUInt32LE(38)>>>16)&0o170000;assert([0,0o100000].includes(fileType),'ZIP links and special files prohibited');
   const nl=h.readUInt16LE(28),el=h.readUInt16LE(30),cl=h.readUInt16LE(32);integer(nl,256);assert(el<=4096);
   assert.equal(utf8(await read(nl)),row.name);const extra=extras(await read(el));await read(cl);
   const {expanded,compressed,offset:local}=resolveStoredZip64({expanded:h.readUInt32LE(24),compressed:h.readUInt32LE(20),offset:h.readUInt32LE(42)},extra.get(1));
   assert.equal(expanded,row.size);assert.equal(compressed,row.size);assert.equal(local,row.local);
  }
  const size=position-offset;let h=await read(4),wide=false;
  if(h.readUInt32LE(0)===0x06064b50){
   wide=true;const z=Buffer.concat([h,await read(52)]),zip64Offset=position-56;
   assert.equal(z.readBigUInt64LE(4),44n);assert.equal(z.readUInt32LE(16),0);assert.equal(z.readUInt32LE(20),0);
   assert.equal(z.readBigUInt64LE(24),12n);assert.equal(z.readBigUInt64LE(32),12n);assert.equal(number(z.readBigUInt64LE(40)),size);assert.equal(number(z.readBigUInt64LE(48)),offset);
   const locator=await read(20);assert.equal(locator.readUInt32LE(0),0x07064b50);assert.equal(locator.readUInt32LE(4),0);assert.equal(number(locator.readBigUInt64LE(8)),zip64Offset);assert.equal(locator.readUInt32LE(16),1);h=await read(4);
  }
  assert.equal(h.readUInt32LE(0),0x06054b50);h=Buffer.concat([h,await read(18)]);
  assert.equal(h.readUInt16LE(4),0);assert.equal(h.readUInt16LE(6),0);
  for(const [n,want,sentinel]of[[h.readUInt16LE(8),12,65535],[h.readUInt16LE(10),12,65535],[h.readUInt32LE(12),size,0xffffffff],[h.readUInt32LE(16),offset,0xffffffff]])
   assert(n===want||(wide&&n===sentinel),'ordinary/ZIP64 directory identities differ');
  await read(h.readUInt16LE(20));assert.equal(position,artifact.byte_length);assert.equal(current.length,0,'trailing original ZIP bytes');
  done=(await next()).done;assert.equal(done,true,'trailing original ZIP stream');
  const artifactDigest='sha256:'+hash.digest('hex');assert.equal(artifactDigest,artifact.digest,'original provider ZIP digest differs');
  const layout=tar.finish();assert(performance.now()<=end,'construction stream deadline exceeded');completed=true;
  return {scope:'original-stored-zip-and-oci-blob-integrity-only',artifact:{byte_length:position,digest:artifactDigest},archive,
   members:locals.map(row=>({path:row.name,byte_length:row.size,crc32:row.checksum,digest:expected.get(row.name).digest})),layout,
   unclaimed:['provider-authentication','expanded-layer-filesystem-semantics','installed-sdk','full-vv','release','product-readiness']};
 }finally{clearTimeout(timer);if(!completed)stream.destroy();}
}

async function verifyAndClose(stream,plan,timeout,stage){
 assert(stream instanceof Readable,'owned bounded Node readable transport required');
 let result,failure;try{result=await verifyStream(stream,plan,timeout,stage);}catch(error){failure=error;}
 // Destroy is a request, not a close observation. Keep a separate fixed cleanup
 // budget, retain the original failure, and never issue output on uncertain close.
 try{
  await new Promise((resolve,reject)=>{
   if(stream.closed){if(stream.errored&&stream.errored!==failure)reject(stream.errored);else resolve();return;}
   let error;const timer=setTimeout(()=>finish(Error('owned artifact transport close not observed within 5 seconds')),5000);
   const onError=e=>{if(e!==failure)error??=e;},onClose=()=>finish(error);
   function finish(e){clearTimeout(timer);stream.off('error',onError);stream.off('close',onClose);if(e)reject(e);else resolve();}
   stream.on('error',onError);stream.once('close',onClose);stream.destroy();
  });
 }catch(error){if(failure)throw new AggregateError([failure,error],'artifact verification and transport cleanup failed');throw error;}
 if(failure)throw failure;assert(stream.closed,'actual original transport closure required');
 const receipt={...result,transport_closed:true};verifiedArchives.set(receipt,Object.freeze({...result.archive}));return receipt;
}

export async function verifyConstructionArchiveStream(stream,plan,timeout=1800000){return verifyAndClose(stream,plan,timeout);}

export async function stageConstructionArchiveStream(stream,plan,parent,timeout=1800000){
 let stage;
 try{
  assert(stream instanceof Readable);integer(timeout,1800000);
  const end=performance.now()+timeout;stage=beginConstructionStage(parent,plan.archive,end);
  const integrity=await verifyAndClose(stream,plan,timeout,stage);
  const handle=await stage.seal(integrity);return {integrity,handle};
 }catch(error){
  let cleanup;try{if(stage)stage.retire();}catch(e){cleanup=e;}
  // Admission can fail before the verifier takes transport ownership.
  if(stream instanceof Readable&&!stream.closed){try{await verifyAndClose(stream,{invalid:true},1);}catch(e){if(!stream.closed)cleanup=cleanup?new AggregateError([cleanup,e]):e;}}
  if(cleanup)throw new AggregateError([error,cleanup],'archive staging and retirement failed');throw error;
 }
}
