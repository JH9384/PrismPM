// Private qualification evidence. Archived bytes are never executed inputs.
// Creation custody and both completed native consumers precede retirement.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {closeSync, constants, createWriteStream, fchmodSync,
  fstatSync, lstatSync, mkdirSync, openSync, readSync,
  opendirSync,
  realpathSync, unlinkSync, writeFileSync, writeSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {pipeline} from 'node:stream/promises';
import {Readable} from 'node:stream';
import {createGunzip, createGzip} from 'node:zlib';

const directory = 'payload-transcript-retention', manifestName = 'manifest.json';
const maximum = 67108865, chunk = 65536, memberLimit = 4096;
const fields = ['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'];
const parentFields = ['dev','ino','uid','gid','mode'];
const identity = stat => Object.fromEntries(fields.map(key => [key,stat[key].toString()]));
const parentIdentity = stat => Object.fromEntries(parentFields.map(key => [key,stat[key].toString()]));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const namePattern = /^[A-Za-z][A-Za-z0-9-]*-(input|output|expected)\.bin(?:\.changed)?$/;
function directoryNames(path) {
  const names=[],directory=opendirSync(path,{bufferSize:32});
  try {for(let row;(row=directory.readSync())!==null;){assert(names.length<memberLimit+1,'bounded compressed transcript directory');names.push(row.name);}}
  finally {directory.closeSync();}
  return names.sort();
}
function* boundedChunks(fd,length) {
  const buffer=Buffer.alloc(chunk);let offset=0;
  while(offset<length){const count=readSync(fd,buffer,0,Math.min(chunk,length-offset),offset);assert(count>0,'bounded transcript stream shortened');offset+=count;yield Buffer.from(buffer.subarray(0,count));}
  assert.equal(readSync(fd,buffer,0,1,offset),0,'bounded transcript stream grew');
}
function boundedDocument(path,limit) {
  const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const captured=capture(path,limit,fd),bytes=Buffer.alloc(Number(captured.size));let offset=0;
    for(const part of boundedChunks(fd,bytes.length)){part.copy(bytes,offset);offset+=part.length;}
    assert.equal(digest(bytes),captured.sha256,'exact bounded document bytes');
    assert.deepEqual(capture(path,limit,fd),captured,'stable bounded document descriptor');
    return {captured,bytes};
  } finally {closeSync(fd);}
}
function privateRoot(root) {
  assert.equal(resolve(root),root,'normalized transcript root');
  assert.equal(realpathSync(root),root,'unaliased transcript root');
  const stat = lstatSync(root,{bigint:true});
  assert(stat.isDirectory() && stat.uid === BigInt(process.getuid()) && (stat.mode & 0o077n) === 0n,
    'private owned transcript root');
  return parentIdentity(stat);
}
function capture(path, limit = maximum, held = null) {
  assert.equal(realpathSync(path),path,'unaliased transcript file');
  const fd = held ?? openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
  try {
    const before = fstatSync(fd,{bigint:true});
    assert(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid())
      && (before.mode & 0o022n) === 0n && before.size <= BigInt(limit),'bounded single-link transcript file');
    const buffer = Buffer.alloc(chunk), hash = createHash('sha256'); let length = 0;
    while(length < Number(before.size)) {
      const count = readSync(fd,buffer,0,Math.min(chunk,Number(before.size)-length),length);
      assert(count > 0,'transcript shortened'); hash.update(buffer.subarray(0,count)); length += count;
    }
    assert.equal(readSync(fd,buffer,0,1,length),0,'transcript grew');
    for(const after of [fstatSync(fd,{bigint:true}),lstatSync(path,{bigint:true})])
      assert.deepEqual(identity(after),identity(before),'stable transcript descriptor and name');
    assert.equal(realpathSync(path),path,'unchanged transcript ancestry');
    return {...identity(before),sha256:hash.digest('hex')};
  } finally {if(held === null)closeSync(fd);}
}
function frozen(value) {
  if(value && typeof value === 'object') {for(const child of Object.values(value))frozen(child);Object.freeze(value);}
  return value;
}

async function readback(root, receipt, originalsRetired, originalCustody = true) {
  assert.equal(receipt.schema,'prismpm/payload-transcript-retention/1');
  assert.equal(receipt.directory,directory); assert.match(receipt.manifest_sha256,/^[a-f0-9]{64}$/);
  const rootIdentity=privateRoot(root);
  if(originalCustody)assert.deepEqual(rootIdentity,receipt.root,'original transcript root custody');
  const archiveRoot = join(root,directory); const parent = privateRoot(archiveRoot);
  if(originalCustody)assert.deepEqual(parent,receipt.archive_root,'original transcript archive custody');
  const manifestPath = join(archiveRoot,manifestName), {captured:manifestCapture,bytes}=boundedDocument(manifestPath,4*1024**2);
  const binding = record => originalCustody ? record : Object.fromEntries(['mode','nlink','size','sha256'].map(key=>[key,record[key]]));
  assert.deepEqual(binding(manifestCapture),binding(receipt.manifest),'original transcript manifest binding');
  assert.equal(manifestCapture.sha256,receipt.manifest_sha256,'immutable transcript manifest bytes');
  const manifest = JSON.parse(bytes);
  assert.deepEqual(Object.keys(manifest).sort(),['files','schema']);
  assert.equal(manifest.schema,receipt.schema); assert(Array.isArray(manifest.files));
  assert(manifest.files.length > 0 && manifest.files.length <= memberLimit);
  assert.equal(manifest.files.length,receipt.files);
  const expectedNames = [manifestName], raw = [], seen = new Set(), capturedArchives=new Map(); let total = 0;
  for(const row of manifest.files) {
    assert.deepEqual(Object.keys(row).sort(),['archive','consumers','name','original']);
    assert.match(row.name,namePattern);assert(row.name.length<=240); assert(!seen.has(row.name),'unique logical raw transcript');seen.add(row.name);
    assert.deepEqual(row.consumers,['std','no-std'],'both completed native consumers');
    for(const record of [row.original,row.archive]) {
      assert.deepEqual(Object.keys(record).sort(),[...fields,'sha256'].sort());
      assert.match(record.sha256,/^[a-f0-9]{64}$/);
      for(const field of fields){assert.match(record[field],/^[0-9]+$/);assert(record[field].length<=32);}
      assert.equal(record.nlink,'1');
    }
    const length = Number(row.original.size);assert(Number.isSafeInteger(length) && length >= 0 && length <= maximum);
    total += length;assert(total <= 8*1024**3,'bounded complete raw transcript inventory');
    const name = row.name+'.gz', path = join(archiveRoot,name); expectedNames.push(name);
    const archiveCapture=capture(path,maximum+1048576);
    assert.deepEqual(binding(archiveCapture),binding(row.archive),'immutable compressed transcript');capturedArchives.set(row.name,archiveCapture);
    const fd = openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
    try {
      assert.deepEqual(identity(fstatSync(fd,{bigint:true})),Object.fromEntries(fields.map(key=>[key,archiveCapture[key]])));
      const input = Readable.from(boundedChunks(fd,Number(row.archive.size)),{objectMode:false,highWaterMark:chunk});
      const output = createGunzip({chunkSize:chunk});
      const completed = pipeline(input,output);
      // Register rejection immediately; awaiting below still propagates it.
      completed.catch(()=>{});
      const hash = createHash('sha256');let observed = 0;
      try {
        for await(const bytes of output) {
          observed += bytes.length;assert(observed <= length,'extra decompressed transcript bytes');hash.update(bytes);
        }
        await completed;
      } catch(error) {input.destroy();output.destroy();await completed.catch(()=>{});throw error;}
      assert.equal(observed,length,'complete decompressed transcript length');
      assert.equal(hash.digest('hex'),row.original.sha256,'exact decompressed original transcript bytes');
      assert.deepEqual(capture(path,maximum+1048576,fd),archiveCapture,'compressed transcript stable through readback');
    } finally {closeSync(fd);}
    if(originalsRetired)assert.equal(lstatSync(join(root,row.name),{throwIfNoEntry:false}),undefined,'retired transcript reappeared');
    raw.push({path:row.name,bytes:length,sha256:row.original.sha256,consumers:row.consumers});
  }
  assert.equal(total,receipt.bytes);
  assert.deepEqual(directoryNames(archiveRoot),expectedNames.sort(),'complete compressed transcript inventory');
  assert.deepEqual(capture(manifestPath,4*1024**2),manifestCapture,'immutable manifest through all raw readbacks');
  for(const row of manifest.files) {
    const path=join(archiveRoot,row.name+'.gz');assert.equal(realpathSync(path),path,'final compressed transcript ancestry');
    assert.deepEqual(identity(lstatSync(path,{bigint:true})),Object.fromEntries(fields.map(key=>[key,capturedArchives.get(row.name)[key]])),
      'final complete compressed transcript descriptor sweep');
    if(originalsRetired)assert.equal(lstatSync(join(root,row.name),{throwIfNoEntry:false}),undefined,'final original transcript retirement');
  }
  assert.deepEqual(directoryNames(archiveRoot),expectedNames,'final complete compressed transcript inventory');
  assert.deepEqual(privateRoot(archiveRoot),parent);assert.deepEqual(privateRoot(root),rootIdentity);
  return frozen({scope:'retained-original-transcript-bytes-only',manifest_sha256:receipt.manifest_sha256,files:raw,bytes:total});
}

export async function verifyTranscriptRetention(root, receipt) {
  assert.equal(receipt.state,'retired','completed original transcript retirement');
  return readback(root,receipt,true);
}

// An extracted review copy can prove recoverable bytes, never original live
// inode custody or execution. Original manifest identity records stay intact.
export async function verifyCopiedTranscriptRetention(root, receipt) {
  assert.equal(receipt.state,'retired');
  const result=await readback(root,receipt,true,false);
  return frozen({...result,scope:'retained-copy-transcript-bytes-only',originalLiveCustodyVerified:false});
}

// Separate post-owner collector. Preserve physical evidence even when this
// diagnostic inventory contains incomplete/failing roots; such roots must
// prevent qualification after the physical collection has completed.
export async function collectPayloadTranscriptReadbacks(roots) {
  assert(Array.isArray(roots) && roots.length<=32);
  const rows=[];
  for(const root of roots) {
    assert.equal(resolve(root),root);
    if(!/^prismpm-session-payloads-[A-Za-z0-9]+$/.test(root.split('/').at(-1)))continue;
    const path=join(root,'payload-owner-evidence.json');
    if(lstatSync(path,{throwIfNoEntry:false})===undefined){rows.push({directory:root,state:'incomplete'});continue;}
    try {
      privateRoot(root);const {bytes,captured}=boundedDocument(path,32*1024**2),evidence=JSON.parse(bytes);
      assert.equal(evidence.scope,'private-payload-source-and-browser-owner');assert.equal(evidence.publicApplicationAccepted,false);
      const readback=await verifyTranscriptRetention(root,evidence.transcriptRetention);
      assert.deepEqual(readback,evidence.transcriptRetention.logicalRaw,'complete producer logical raw inventory');
      assert.deepEqual(readback,evidence.transcriptReadback,'complete independent owner logical raw inventory');
      assert.deepEqual(capture(path,32*1024**2),captured,'original payload receipt stable through collector readback');
      rows.push({directory:root,state:'verified-retained-bytes',receipt_sha256:captured.sha256,readback});
    } catch(error) {rows.push({directory:root,state:'failed',error:String(error.code??error.name),message:String(error.message).slice(0,1024)});}
  }
  return frozen({schema:'prismpm/payload-transcript-readbacks/1',scope:'retained-raw-bytes-only-not-application-acceptance',roots:rows});
}

export function ownPayloadTranscripts(root) {
  const parent = privateRoot(root), rootFd = openSync(root,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
  const rows = new Map();let state = 'writing', closed = false, totalBytes=0;
  const anchored = name => '/proc/self/fd/'+rootFd+'/'+name;
  function boundary() {assert(!closed,'transcript owner closed');assert.deepEqual(privateRoot(root),parent);assert.deepEqual(parentIdentity(fstatSync(rootFd,{bigint:true})),parent);}
  function check(row) {boundary();assert(row.sealed,'completed transcript producer');assert.deepEqual(capture(join(root,row.name)),row.original,'immutable creation-bound transcript');}
  function close() {if(!closed){for(const row of rows.values())if(row.fd !== null){closeSync(row.fd);row.fd=null;}closeSync(rootFd);closed=true;}}
  const owner = {
    begin(name) {
      assert.equal(state,'writing');assert.match(name,namePattern);assert(name.length<=240);assert(!rows.has(name) && rows.size < memberLimit,'exclusive transcript inventory');boundary();
      const fd = openSync(anchored(name),constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
      const created = identity(fstatSync(fd,{bigint:true}));
      rows.set(name,{name,fd,created,last:created,hash:createHash('sha256'),length:0,sealed:false,consumers:[]});
      return join(root,name);
    },
    append(name,bytes) {
      assert.equal(state,'writing');const row=rows.get(name);assert(row && !row.sealed);boundary();
      assert(bytes instanceof Uint8Array && bytes.length <= chunk*4 && row.length+bytes.length <= maximum && totalBytes+bytes.length<=8*1024**3,'bounded transcript part and complete inventory');
      for(const stat of [fstatSync(row.fd,{bigint:true}),lstatSync(join(root,name),{bigint:true})])assert.deepEqual(identity(stat),row.last,'original producer descriptor and name');
      for(let offset=0;offset<bytes.length;) {const count=writeSync(row.fd,bytes,offset,bytes.length-offset,row.length+offset);assert(count>0);offset+=count;}
      row.hash.update(bytes);row.length+=bytes.length;totalBytes+=bytes.length;row.last=identity(fstatSync(row.fd,{bigint:true}));boundary();
    },
    finish(name) {
      assert.equal(state,'writing');const row=rows.get(name);assert(row && !row.sealed);boundary();
      const original=capture(join(root,name),maximum,row.fd);
      assert.deepEqual(Object.fromEntries(fields.map(key=>[key,original[key]])),row.last,'original completed producer descriptor');
      for(const key of parentFields.concat('nlink'))assert.equal(original[key],row.created[key],'original creation identity');
      assert.equal(Number(original.size),row.length);assert.equal(original.sha256,row.hash.digest('hex'),'exact original producer bytes');
      row.original=original;row.sealed=true;closeSync(row.fd);row.fd=null;
    },
    write(name,bytes) {const path=owner.begin(name);for(let offset=0;offset<bytes.length;offset+=chunk)owner.append(name,bytes.subarray(offset,offset+chunk));owner.finish(name);return path;},
    consume(standard,names,operation) {
      assert.equal(state,'writing');
      try {
      assert.equal(typeof standard,'boolean');assert(Array.isArray(names) && names.length>0 && new Set(names).size===names.length);
      const selected=names.map(name=>{const row=rows.get(name);assert(row);check(row);assert(!row.consumers.includes(standard?'std':'no-std'),'native consumer cannot repeat');return row;});
      const result=operation();assert(!(result && (typeof result==='object'||typeof result==='function') && typeof result.then==='function'),'synchronous native consumer required');
      for(const row of selected)check(row);
      for(const row of selected)row.consumers.push(standard?'std':'no-std');return result;
      } catch(error) {state='failed';throw error;}
    },
    async retainCompleted() {
      assert.equal(state,'writing');assert(rows.size>0);boundary();
      for(const row of rows.values()){check(row);assert.deepEqual(row.consumers,['std','no-std'],'both native consumers precede archive retirement');}
      state='archiving';const files=[];let archiveFd;
      try {
        mkdirSync(anchored(directory),{mode:0o700});const archiveRoot=join(root,directory), archiveParent=privateRoot(archiveRoot);
        archiveFd=openSync(anchored(directory),constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);
        assert.deepEqual(parentIdentity(fstatSync(archiveFd,{bigint:true})),archiveParent);
        for(const row of rows.values()) {
          check(row);const path=join(archiveRoot,row.name+'.gz');
          const input=openSync(anchored(row.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
          let output,writer;
          try {
            output=openSync('/proc/self/fd/'+archiveFd+'/'+row.name+'.gz',constants.O_RDWR|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
            assert.deepEqual(identity(fstatSync(input,{bigint:true})),Object.fromEntries(fields.map(key=>[key,row.original[key]])));
            writer=createWriteStream(null,{fd:output,autoClose:false,highWaterMark:chunk});
            await pipeline(Readable.from(boundedChunks(input,Number(row.original.size)),{objectMode:false,highWaterMark:chunk}),createGzip({level:1,chunkSize:chunk}),writer);
            boundary();assert.deepEqual(privateRoot(archiveRoot),archiveParent);check(row);fchmodSync(output,0o400);
            files.push({name:row.name,original:row.original,consumers:row.consumers,archive:capture(path,maximum+1048576,output)});
          } finally {
            // pipeline destroys its destination on error and Node closes the
            // underlying descriptor even with autoClose:false. Never close
            // that descriptor twice or mask the original bounded-I/O refusal.
            if(output!==undefined && writer?.fd!==null)closeSync(output);
            closeSync(input);
          }
        }
        const manifest=Buffer.from(JSON.stringify({schema:'prismpm/payload-transcript-retention/1',files})+'\n');assert(manifest.length<=4*1024**2);
        boundary();assert.deepEqual(privateRoot(archiveRoot),archiveParent);
        writeFileSync('/proc/self/fd/'+archiveFd+'/'+manifestName,manifest,{flag:'wx',mode:0o400});
        const receipt={schema:'prismpm/payload-transcript-retention/1',state:'retired',directory,root:parent,archive_root:archiveParent,
          manifest_sha256:digest(manifest),manifest:capture(join(archiveRoot,manifestName),4*1024**2),
          files:files.length,bytes:files.reduce((sum,row)=>sum+Number(row.original.size),0)};
        await readback(root,receipt,false); // Independent streaming decoder before any original deletion.
        for(const row of rows.values())check(row);
        state='retiring';
        for(const row of rows.values()){check(row);unlinkSync(anchored(row.name));boundary();assert.equal(lstatSync(join(root,row.name),{throwIfNoEntry:false}),undefined);}
        state='retired';const logicalRaw=await verifyTranscriptRetention(root,receipt);return frozen({...receipt,logicalRaw});
      } catch(error) {state='failed';throw error;}
      finally {if(archiveFd!==undefined)closeSync(archiveFd);close();}
    },
    close,
  };
  return Object.freeze(owner);
}
