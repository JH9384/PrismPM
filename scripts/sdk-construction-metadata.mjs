// Bounded, stored-ZIP metadata acquisition. This does not authenticate its
// range adapter or establish complete ZIP/OCI integrity; callers must do both.
import assert from 'node:assert/strict';
import {crc32} from 'node:zlib';
import {resolveStoredZip64,validateStoredDataDescriptor} from './sdk-construction-archive.mjs';

const names=['construction.json','sdk.oci.tar',...['authority-result.json','candidate.json','cli.json','config.json',
 'digest.txt','inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'].map(n=>'evidence/'+n)].sort();
const number=n=>{assert(n>=0n&&n<=BigInt(Number.MAX_SAFE_INTEGER));return Number(n);};
const utf8=b=>new TextDecoder('utf-8',{fatal:true}).decode(b);
const extras=b=>{
 const rows=new Map();for(let p=0;p<b.length;){assert(p+4<=b.length);const id=b.readUInt16LE(p),n=b.readUInt16LE(p+2);p+=4;
  assert(p+n<=b.length&&!rows.has(id));rows.set(id,b.subarray(p,p+n));p+=n;}
 return rows;
};

export async function readConstructionMetadata(byteLength,range,timeout=900000){
 assert(Number.isSafeInteger(byteLength)&&byteLength>22&&byteLength<=64*1024**3+96*1024**2);
 assert.equal(typeof range,'function');assert(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=900000);
 const deadline=performance.now()+timeout,controller=new AbortController();let readBytes=0,calls=0,expire;
 const expired=new Promise((_,reject)=>{expire=reject;});expired.catch(()=>{});
 const timer=setTimeout(()=>{const error=Error('construction metadata acquisition deadline exceeded');controller.abort(error);expire(error);},timeout);
 async function read(start,length){
  assert(Number.isSafeInteger(start)&&start>=0&&Number.isSafeInteger(length)&&length>0&&start+length<=byteLength);
  assert(length<=64*1024**2);readBytes+=length;assert(readBytes<=96*1024**2+1024**2,'complete metadata transport budget exceeded');
  const chunks=[];for(let p=0;p<length;p+=1024**2){
   assert(performance.now()<=deadline,'construction metadata acquisition deadline exceeded');assert(++calls<=512);
   const n=Math.min(length-p,1024**2),b=await Promise.race([range(start+p,n,controller.signal),expired]);
   assert(Buffer.isBuffer(b)&&b.length===n,'complete exact bounded range required');chunks.push(Buffer.from(b));
  }
  return Buffer.concat(chunks,length);
 }
 try{
  const tailLength=Math.min(byteLength,65577),tailStart=byteLength-tailLength,tail=await read(tailStart,tailLength);let end=-1;
  for(let p=tail.length-22;p>=0;p--)if(tail.readUInt32LE(p)===0x06054b50&&p+22+tail.readUInt16LE(p+20)===tail.length){
   assert.equal(end,-1,'ambiguous ZIP termination');end=p;}
  assert(end>=0,'complete ZIP termination required');assert.equal(tail.readUInt16LE(end+4),0);assert.equal(tail.readUInt16LE(end+6),0);
  const ordinary={count:tail.readUInt16LE(end+10),size:tail.readUInt32LE(end+12),offset:tail.readUInt32LE(end+16)};
  assert.equal(tail.readUInt16LE(end+8),ordinary.count);let {count,size,offset}=ordinary,directoryEnd=tailStart+end;
  if(count===65535||size===0xffffffff||offset===0xffffffff){
   assert(end>=20);const p=end-20;assert.equal(tail.readUInt32LE(p),0x07064b50);assert.equal(tail.readUInt32LE(p+4),0);assert.equal(tail.readUInt32LE(p+16),1);
   const zpos=number(tail.readBigUInt64LE(p+8)),z=await read(zpos,56);assert.equal(z.readUInt32LE(0),0x06064b50);assert.equal(z.readBigUInt64LE(4),44n);
   assert.equal(zpos+56,tailStart+p);assert.equal(z.readUInt32LE(16),0);assert.equal(z.readUInt32LE(20),0);assert.equal(z.readBigUInt64LE(24),z.readBigUInt64LE(32));
   count=number(z.readBigUInt64LE(32));size=number(z.readBigUInt64LE(40));offset=number(z.readBigUInt64LE(48));directoryEnd=zpos;
   for(const [key,sentinel]of[['count',65535],['size',0xffffffff],['offset',0xffffffff]])
    if(ordinary[key]!==sentinel)assert.equal(ordinary[key],{count,size,offset}[key]);
  }
  assert.equal(count,12);assert(size>0&&size<=262144);assert.equal(offset+size,directoryEnd);
  const directory=await read(offset,size),rows=[];let p=0,total=0;
  for(let i=0;i<count;i++){
   assert(p+46<=directory.length);const h=directory.subarray(p,p+46);assert.equal(h.readUInt32LE(0),0x02014b50);
   const flags=h.readUInt16LE(8),method=h.readUInt16LE(10);assert.equal(flags&~0x0808,0);assert.equal(method,0);assert.equal(h.readUInt16LE(34),0);
   assert([0,0o100000].includes((h.readUInt32LE(38)>>>16)&0o170000));
   const nl=h.readUInt16LE(28),el=h.readUInt16LE(30),cl=h.readUInt16LE(32);assert(nl>0&&nl<=256&&el<=4096);const next=p+46+nl+el+cl;assert(next<=directory.length);
   const name=utf8(directory.subarray(p+46,p+46+nl));assert(names.includes(name)&&!rows.some(r=>r.name===name));
   const e=extras(directory.subarray(p+46+nl,p+46+nl+el)),s=resolveStoredZip64({expanded:h.readUInt32LE(24),compressed:h.readUInt32LE(20),offset:h.readUInt32LE(42)},e.get(1));
   assert.equal(s.compressed,s.expanded);assert(s.expanded>0&&s.expanded<=64*1024**3);
   if(name!=='sdk.oci.tar'){
    const limit=['construction.json','evidence/candidate.json'].includes(name)?65536:
     ['evidence/config.json','evidence/manifest.json'].includes(name)?4*1024**2:64*1024**2;
    assert(s.expanded<=limit,'metadata member budget exceeded');total+=s.expanded;assert(total<=96*1024**2,'aggregate metadata budget exceeded');
   }
   rows.push({name,flags,size:s.expanded,local:s.offset,checksum:h.readUInt32LE(16)});p=next;
  }
  assert.equal(p,directory.length);assert.deepEqual(rows.map(r=>r.name).sort(),names);
  // Admit the complete directory and all allocation budgets before reading
  // any member payload. No SDK archive member payload is requested; bounded
  // terminal control reads may overlap its final bytes.
  for(const row of rows){
   const h=await read(row.local,30);assert.equal(h.readUInt32LE(0),0x04034b50);assert.equal(h.readUInt16LE(6),row.flags);assert.equal(h.readUInt16LE(8),0);
   const nl=h.readUInt16LE(26),el=h.readUInt16LE(28);assert(nl>0&&nl<=256&&el<=4096);
   const ne=await read(row.local+30,nl+el);assert.equal(utf8(ne.subarray(0,nl)),row.name);
   const e=extras(ne.subarray(nl)),s=resolveStoredZip64({compressed:h.readUInt32LE(18),expanded:h.readUInt32LE(22),offset:null},e.get(1));
   const check=(actual,want)=>assert((row.flags&8)?actual===0||actual===want:actual===want);
   check(s.compressed,row.size);check(s.expanded,row.size);check(h.readUInt32LE(14),row.checksum);
   row.start=row.local+30+nl+el;row.end=row.start+row.size;
   if(row.flags&8){const n=row.size>0xffffffff?24:16;validateStoredDataDescriptor(await read(row.end,n),row.checksum,row.size);row.end+=n;}
   assert(row.end<=offset);
  }
  const spans=rows.slice().sort((a,b)=>a.local-b.local);assert.equal(spans[0].local,0);
  for(let i=1;i<spans.length;i++)assert.equal(spans[i-1].end,spans[i].local,'closed nonoverlapping local spans required');assert.equal(spans.at(-1).end,offset);
  const members=new Map();for(const row of rows.filter(r=>r.name!=='sdk.oci.tar')){
   const b=await read(row.start,row.size);assert.equal(crc32(b),row.checksum,'original metadata CRC differs');members.set(row.name,b);
  }
  assert(performance.now()<=deadline,'construction metadata acquisition deadline exceeded');
  return {scope:'selected-metadata-only-not-authentication-or-complete-archive-integrity',members,selected_bytes:readBytes,range_calls:calls};
 }finally{clearTimeout(timer);controller.abort();}
}
