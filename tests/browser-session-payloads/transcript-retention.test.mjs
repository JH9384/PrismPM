import assert from 'node:assert/strict';
import {spawn,spawnSync} from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import fs, {chmodSync,copyFileSync,existsSync,linkSync,lstatSync,mkdirSync,mkdtempSync,
  readFileSync,readdirSync,readlinkSync,renameSync,rmSync,symlinkSync,truncateSync,unlinkSync,writeFileSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {runInNewContext} from 'node:vm';
import {pathToFileURL} from 'node:url';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import test from 'node:test';
import {gzipSync,gunzipSync} from 'node:zlib';
import {ownPayloadTranscripts,verifyTranscriptRetention,verifyCopiedTranscriptRetention,collectPayloadTranscriptReadbacks} from './transcript-retention.mjs';

const fields=['dev','ino','uid','gid','mode','nlink','size','mtimeNs','ctimeNs'];
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
function fixture(t,prefix='prismpm-transcript-test-') {
  const root=mkdtempSync(join(tmpdir(),prefix)),owner=ownPayloadTranscripts(root);
  t.after(()=>{owner.close();rmSync(root,{recursive:true,force:true});});return {root,owner};
}
function complete(f,names) {
  for(const standard of [true,false])f.owner.consume(standard,names,()=>{for(const name of names)assert(existsSync(join(f.root,name)));});
}
function small(f) {f.owner.write('record-input.bin',Buffer.from([0,1,10,255]));f.owner.write('record-output.bin',Buffer.alloc(0));complete(f,['record-input.bin','record-output.bin']);}
function refreshed(f,receipt,change) {
  const path=join(f.root,receipt.directory,'manifest.json'),document=JSON.parse(readFileSync(path));change(document);
  chmodSync(path,0o600);writeFileSync(path,JSON.stringify(document)+'\n');chmodSync(path,0o400);
  const bytes=readFileSync(path),stat=lstatSync(path,{bigint:true}),manifest={...Object.fromEntries(fields.map(k=>[k,stat[k].toString()])),sha256:sha(bytes)};
  return {...receipt,manifest,manifest_sha256:manifest.sha256};
}
function recapture(path) {const stat=lstatSync(path,{bigint:true});return {...Object.fromEntries(fields.map(k=>[k,stat[k].toString()])),sha256:sha(readFileSync(path))};}
async function gzipOracle(path,expected) {
  const child=spawn('gzip',['-dc','--',path],{stdio:['ignore','pipe','pipe']}),hash=createHash('sha256');let bytes=0,error='';
  child.stdout.on('data',part=>{bytes+=part.length;hash.update(part);});child.stderr.on('data',part=>{error+=part;assert(error.length<65536);});
  const result=await new Promise((resolve,reject)=>{child.on('error',reject);child.on('close',(status,signal)=>resolve({status,signal}));});
  assert.equal(result.status,0,error);assert.equal(result.signal,null);assert.equal(bytes,expected.bytes);assert.equal(hash.digest('hex'),expected.sha256);
}

test('complete source-owned transcript retention preserves binary and empty bytes with real independent gzip readback',async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted();
  assert(Object.isFrozen(receipt) && Object.isFrozen(receipt.logicalRaw.files));
  const readback=await verifyTranscriptRetention(f.root,receipt);assert.deepEqual(readback,receipt.logicalRaw);
  assert.equal(receipt.files,2);assert.equal(receipt.bytes,4);
  for(const row of readback.files) {assert(!existsSync(join(f.root,row.path)));await gzipOracle(join(f.root,receipt.directory,row.path+'.gz'),row);}
  await assert.rejects(f.owner.retainCompleted());
});
for(const size of [67108864,67108865])test(`streaming transcript retention keeps the complete original ${size}-byte boundary`,{timeout:120000},async t=>{
  const f=fixture(t),name='PartitionMaximum-input.bin',hash=createHash('sha256');f.owner.begin(name);
  for(let offset=0;offset<size;) {const part=Buffer.alloc(Math.min(65536,size-offset),(offset/65536)%251);hash.update(part);f.owner.append(name,part);offset+=part.length;}
  f.owner.finish(name);complete(f,[name]);const receipt=await f.owner.retainCompleted();
  assert.equal(receipt.bytes,size);const expected={bytes:size,sha256:hash.digest('hex')};
  assert.equal(receipt.logicalRaw.files[0].sha256,expected.sha256);await gzipOracle(join(f.root,receipt.directory,name+'.gz'),expected);
});
test('incompressible streamed raw bytes survive bounded gzip retention',async t=>{
  const f=fixture(t),name='random-input.bin';f.owner.begin(name);
  for(let i=0;i<32;i++)f.owner.append(name,randomBytes(65536));f.owner.finish(name);complete(f,[name]);
  const original=readFileSync(join(f.root,name)),receipt=await f.owner.retainCompleted();
  assert.deepEqual(gunzipSync(readFileSync(join(f.root,receipt.directory,name+'.gz'))),original);
  await gzipOracle(join(f.root,receipt.directory,name+'.gz'),{bytes:original.length,sha256:sha(original)});
});
for(const defect of ['unfinished','no-consumers','one-consumer','failed-consumer'])test(`retirement refuses ${defect} and retains original bytes`,async t=>{
  const f=fixture(t),name='record-input.bin';f.owner.begin(name);f.owner.append(name,Buffer.from('original'));
  if(defect!=='unfinished')f.owner.finish(name);
  if(['one-consumer','failed-consumer'].includes(defect))f.owner.consume(true,[name],()=>{});
  if(defect==='failed-consumer'){
    assert.throws(()=>f.owner.consume(false,[name],()=>{throw Error('native failure');}),/native failure/);
    assert.throws(()=>f.owner.consume(false,[name],()=>{}),'failed native consumer cannot be retried into success');
  }
  await assert.rejects(f.owner.retainCompleted());assert.equal(readFileSync(join(f.root,name),'utf8'),'original');assert(!existsSync(join(f.root,'payload-transcript-retention')));
});
test('creation rejects path escapes, duplicate enrollment and files beyond the unchanged one-over bound',t=>{
  const f=fixture(t);for(const name of ['../record-input.bin','/record-input.bin','record.bin','x/record-input.bin'])assert.throws(()=>f.owner.begin(name));
  f.owner.begin('record-input.bin');assert.throws(()=>f.owner.begin('record-input.bin'));
  assert.throws(()=>f.owner.append('record-input.bin',Buffer.alloc(262145)),/bounded transcript part/);
  f.owner.close();assert.throws(()=>f.owner.append('record-input.bin',Buffer.from('x')));
});
for(const [name,value] of [['native-promise',()=>Promise.resolve()],['foreign-promise',()=>runInNewContext('Promise.resolve()')],['thenable',()=>({then(){throw Error('must not invoke then');}})]])test(`native completion rejects ${name} without enabling retirement`,async t=>{
  const f=fixture(t);f.owner.write('record-input.bin',Buffer.from('original'));
  assert.throws(()=>f.owner.consume(true,['record-input.bin'],value),/synchronous native consumer required/);
  assert.throws(()=>f.owner.consume(true,['record-input.bin'],()=>{}));await assert.rejects(f.owner.retainCompleted());assert(existsSync(join(f.root,'record-input.bin')));
});
for(const defect of ['changed','same-byte-replacement','symlink','hardlink'])test(`creation-bound custody refuses ${defect} before retirement`,async t=>{
  const f=fixture(t);small(f);const path=join(f.root,'record-input.bin'),original=readFileSync(path);
  if(defect==='changed')writeFileSync(path,Buffer.from('changed'));
  else if(defect==='hardlink')linkSync(path,join(f.root,'alias.bin'));
  else {renameSync(path,join(f.root,'original.bin'));if(defect==='symlink')symlinkSync('original.bin',path);else writeFileSync(path,original,{mode:0o600});}
  await assert.rejects(f.owner.retainCompleted());assert(existsSync(path));
});
test('same-byte replacement during streaming is not enrolled as the producer',t=>{
  const f=fixture(t),path=f.owner.begin('record-input.bin');f.owner.append('record-input.bin',Buffer.from('original'));
  renameSync(path,join(f.root,'original.bin'));writeFileSync(path,'original',{mode:0o600});
  assert.throws(()=>f.owner.finish('record-input.bin'),/stable transcript descriptor and name/);
});
test('original parent substitution refuses retirement without deleting either namespace',async t=>{
  const f=fixture(t);small(f);const displaced=f.root+'-original';renameSync(f.root,displaced);mkdirSync(f.root,{mode:0o700});
  try {await assert.rejects(f.owner.retainCompleted());assert(existsSync(join(displaced,'record-input.bin')));assert.deepEqual(readdirSync(f.root),[]);}
  finally {rmSync(f.root,{recursive:true});renameSync(displaced,f.root);}
});
test('exclusive archive-directory collision preserves original and foreign bytes',async t=>{
  const f=fixture(t);small(f);mkdirSync(join(f.root,'payload-transcript-retention'),{mode:0o700});writeFileSync(join(f.root,'payload-transcript-retention','foreign'),'preserve');
  await assert.rejects(f.owner.retainCompleted(),/EEXIST/);assert(existsSync(join(f.root,'record-input.bin')));assert.equal(readFileSync(join(f.root,'payload-transcript-retention','foreign'),'utf8'),'preserve');
});
test('an original changed during actual compression fails before any retirement',async t=>{
  const f=fixture(t),name='record-input.bin';f.owner.begin(name);for(let i=0;i<64;i++)f.owner.append(name,randomBytes(65536));f.owner.finish(name);complete(f,[name]);
  const retained=f.owner.retainCompleted();setImmediate(()=>writeFileSync(join(f.root,name),'changed during compression'));
  await assert.rejects(retained);assert(existsSync(join(f.root,name)));
});
test('an original grown during compression cannot extend its captured stream',async t=>{
  const f=fixture(t),name='record-input.bin';f.owner.begin(name);for(let i=0;i<64;i++)f.owner.append(name,randomBytes(65536));f.owner.finish(name);complete(f,[name]);
  const retained=f.owner.retainCompleted();setImmediate(()=>fs.appendFileSync(join(f.root,name),'extra'));
  await assert.rejects(retained);assert(existsSync(join(f.root,name)));
});
test('a real FIFO substitution is refused without a blocking read or retirement',async t=>{
  const f=fixture(t);small(f);const path=join(f.root,'record-input.bin');renameSync(path,path+'.original');
  const result=spawnSync('mkfifo',[path],{encoding:'utf8',timeout:3000});assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);
  await assert.rejects(f.owner.retainCompleted(),/bounded single-link transcript file/);assert(existsSync(path+'.original'));
});
test('compression captures a fixed byte extent: genuine read-to-EOF mutation crosses the original limit',async t=>{
  const source=readFileSync(new URL('./transcript-retention.mjs',import.meta.url),'utf8');
  const originalGenerator=/function\* boundedChunks\(fd,length\) \{[\s\S]*?\n\}/;
  assert.equal(source.match(new RegExp(originalGenerator.source,'g')).length,1);
  const mutant=source.replace(originalGenerator,`function* boundedChunks(fd,length) {
    const buffer=Buffer.alloc(chunk);let offset=0;
    for(;;){const count=readSync(fd,buffer,0,buffer.length,offset);if(!count)break;offset+=count;yield Buffer.from(buffer.subarray(0,count));}
  }`);
  const copy=mkdtempSync(join(tmpdir(),'prismpm-transcript-extent-mutant-'));
  t.after(()=>rmSync(copy,{recursive:true,force:true}));
  writeFileSync(join(copy,'mutant.mjs'),mutant,{flag:'wx'});
  async function exercise(own) {
    const root=mkdtempSync(join(tmpdir(),'prismpm-transcript-extent-')),owner=own(root),name='record-input.bin',path=join(root,name);
    const captured=4*65536;owner.write(name,Buffer.alloc(captured,7));complete({root,owner},[name]);
    const originalOpen=fs.openSync,originalRead=fs.readSync;let descriptor=null,injected=false,observed=0;
    fs.openSync=(candidate,flags,...args)=>{
      const fd=originalOpen(candidate,flags,...args);
      if(typeof candidate==='string' && /^\/proc\/self\/fd\/\d+\/record-input\.bin$/.test(candidate)
        && !(flags & (fs.constants.O_CREAT|fs.constants.O_RDWR)))descriptor=fd;
      return fd;
    };
    fs.readSync=(fd,...args)=>{
      if(fd===descriptor && !injected){injected=true;fs.appendFileSync(path,Buffer.alloc(65536,9));}
      const count=originalRead(fd,...args);if(fd===descriptor)observed+=count;return count;
    };syncBuiltinESMExports();
    let failure;
    try {await owner.retainCompleted();}
    catch(error){failure=error;}
    finally {fs.openSync=originalOpen;fs.readSync=originalRead;syncBuiltinESMExports();owner.close();}
    try {assert(injected,'actual anchored compression descriptor reached');assert(failure);assert(existsSync(path));return {failure,observed,captured};}
    finally {rmSync(root,{recursive:true,force:true});}
  }
  function execute(module) {
    const script=`import assert from 'node:assert/strict';import fs,{mkdtempSync,existsSync,rmSync} from 'node:fs';
      import {join} from 'node:path';import {tmpdir} from 'node:os';import {syncBuiltinESMExports} from 'node:module';
      import {ownPayloadTranscripts} from ${JSON.stringify(module)};
      ${complete.toString()}
      const result=await (${exercise.toString()})(ownPayloadTranscripts);
      console.log(JSON.stringify({...result,failure:{message:result.failure.message}}));`;
    const result=spawnSync(process.execPath,['--input-type=module','-e',script],{encoding:'utf8',timeout:15000,maxBuffer:65536});
    assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.error,undefined);
    return JSON.parse(result.stdout);
  }
  const current=execute(new URL('./transcript-retention.mjs',import.meta.url).href);
  assert.match(current.failure.message,/bounded transcript stream grew/);assert.equal(current.observed,current.captured+1);
  const changed=execute(pathToFileURL(join(copy,'mutant.mjs')).href);
  assert.match(changed.failure.message,/immutable creation-bound transcript/);
  assert(changed.observed>changed.captured+1,'genuine unbounded generator traversed appended bytes before later custody refusal');
});
test('late FIFO compression-open has a genuine nonblocking guard counterexample',t=>{
  const source=readFileSync(new URL('./transcript-retention.mjs',import.meta.url),'utf8');
  const selected="const input=openSync(anchored(row.name),constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);";
  assert.equal(source.split(selected).length,2);
  const copy=mkdtempSync(join(tmpdir(),'prismpm-transcript-fifo-mutant-'));
  t.after(()=>rmSync(copy,{recursive:true,force:true}));
  writeFileSync(join(copy,'mutant.mjs'),source.replace(selected,"const input=openSync(anchored(row.name),constants.O_RDONLY|constants.O_NOFOLLOW);"),{flag:'wx'});
  const script=`import assert from 'node:assert/strict';import fs from 'node:fs';
    import {spawnSync} from 'node:child_process';import {syncBuiltinESMExports} from 'node:module';
    import {join} from 'node:path';import {ownPayloadTranscripts} from '__MODULE__';`;
  // Both children retain a complete static import and the identical OS-level
  // control. The copied mutant removes only the selected nonblocking flag.
  const child=script+`
    const root=process.argv[1],path=join(root,'record-input.bin'),owner=ownPayloadTranscripts(root);
    owner.write('record-input.bin',Buffer.from('original'));
    for(const mode of [true,false])owner.consume(mode,['record-input.bin'],()=>{});
    const original=fs.openSync;let witnessed=0;
    fs.openSync=(candidate,flags,...args)=>{
      if(typeof candidate==='string' && /^\\/proc\\/self\\/fd\\/\\d+\\/record-input\\.bin$/.test(candidate)
        && !(flags & (fs.constants.O_CREAT|fs.constants.O_RDWR))){
        assert.equal(++witnessed,1);fs.renameSync(path,path+'.original');
        const fifo=spawnSync('mkfifo',[path],{encoding:'utf8',timeout:1000});assert.equal(fifo.status,0,fifo.stderr);
        process.stdout.write('actual-compression-FIFO-open\\n');
      }
      return original(candidate,flags,...args);
    };syncBuiltinESMExports();
    try {await assert.rejects(owner.retainCompleted(),/Expected values to be strictly deep-equal/);
      assert.equal(witnessed,1);assert(fs.lstatSync(path).isFIFO());assert.equal(fs.readFileSync(path+'.original','utf8'),'original');}
    finally{fs.openSync=original;syncBuiltinESMExports();owner.close();}
    process.stdout.write('nonblocking-custody-refusal\\n');`;
  for(const mutated of [false,true]){
    const root=join(copy,mutated?'mutated':'current');mkdirSync(root,{mode:0o700});
    const module=mutated?pathToFileURL(join(copy,'mutant.mjs')).href:new URL('./transcript-retention.mjs',import.meta.url).href;
    const result=spawnSync(process.execPath,['--input-type=module','-e',child.replace("'__MODULE__'",JSON.stringify(module)),root],{encoding:'utf8',timeout:3000,maxBuffer:65536});
    assert.match(result.stdout,/actual-compression-FIFO-open/);
    if(mutated){assert.equal(result.error?.code,'ETIMEDOUT');assert.equal(result.signal,'SIGTERM');assert(!result.stdout.includes('nonblocking-custody-refusal'));}
    else {assert.equal(result.status,0,result.stderr);assert.equal(result.signal,null);assert.equal(result.error,undefined);assert.match(result.stdout,/nonblocking-custody-refusal/);}
    assert(fs.lstatSync(join(root,'record-input.bin')).isFIFO());assert.equal(readFileSync(join(root,'record-input.bin.original'),'utf8'),'original');
  }
});
test('a real first unlink followed by an I/O failure cannot publish a successful retirement receipt',async t=>{
  const f=fixture(t);small(f);const original=fs.unlinkSync;let calls=0;
  fs.unlinkSync=path=>{if(++calls===2)throw Object.assign(Error('injected unlink I/O failure'),{code:'EIO'});return original(path);};syncBuiltinESMExports();
  try {
    await assert.rejects(f.owner.retainCompleted(),/injected unlink I\/O failure/);assert.equal(calls,2);assert(!existsSync(join(f.root,'record-input.bin')));assert(existsSync(join(f.root,'record-output.bin')));assert(existsSync(join(f.root,'payload-transcript-retention','manifest.json')));await assert.rejects(f.owner.retainCompleted());
    const manifest=JSON.parse(readFileSync(join(f.root,'payload-transcript-retention','manifest.json')));
    for(const row of manifest.files)await gzipOracle(join(f.root,'payload-transcript-retention',row.name+'.gz'),{bytes:Number(row.original.size),sha256:row.original.sha256});
  }
  finally {fs.unlinkSync=original;syncBuiltinESMExports();}
});
for(const defect of ['missing','extra','corrupt','truncated','archive-replacement','archive-hardlink','manifest-replacement','parent-substitution','raw-reappeared'])test(`independent readback refuses ${defect}`,async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted(),root=join(f.root,receipt.directory),path=join(root,'record-input.bin.gz');
  if(defect==='missing')unlinkSync(path);
  if(defect==='extra')writeFileSync(join(root,'extra.gz'),'extra');
  if(defect==='corrupt'){chmodSync(path,0o600);const bytes=readFileSync(path);bytes[bytes.length-8]^=1;writeFileSync(path,bytes);}
  if(defect==='truncated'){chmodSync(path,0o600);truncateSync(path,5);}
  if(defect==='archive-replacement'){renameSync(path,path+'.original');copyFileSync(path+'.original',path);unlinkSync(path+'.original');}
  if(defect==='archive-hardlink')linkSync(path,join(root,'alias.gz'));
  if(defect==='manifest-replacement'){const manifest=join(root,'manifest.json');renameSync(manifest,manifest+'.original');copyFileSync(manifest+'.original',manifest);unlinkSync(manifest+'.original');}
  if(defect==='raw-reappeared')writeFileSync(join(f.root,'record-input.bin'),'reappeared');
  if(defect==='parent-substitution'){renameSync(root,root+'-original');mkdirSync(root,{mode:0o700});}
  await assert.rejects(verifyTranscriptRetention(f.root,receipt));
});
test('directory overflow is refused by bounded real enumeration',async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted(),root=join(f.root,receipt.directory);
  for(let index=0;index<4098;index++)writeFileSync(join(root,'extra-'+index+'.gz'),Buffer.alloc(0),{flag:'wx'});
  await assert.rejects(verifyTranscriptRetention(f.root,receipt),/bounded compressed transcript directory/);
});
test('manifest growth between bounded capture and held-descriptor read fails without unbounded allocation',async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted(),manifest=join(f.root,receipt.directory,'manifest.json');
  const original=fs.readSync;let reads=0;
  fs.readSync=(fd,...args)=>{if(readlinkSync('/proc/self/fd/'+fd)===manifest && ++reads===3){chmodSync(manifest,0o600);truncateSync(manifest,4*1024**2+1);}return original(fd,...args);};syncBuiltinESMExports();
  try {await assert.rejects(verifyTranscriptRetention(f.root,receipt),/bounded transcript stream grew/);assert(reads>=3);}
  finally {fs.readSync=original;syncBuiltinESMExports();}
});
test('an earlier compressed member changed during a later readback fails the final global sweep',async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted(),root=join(f.root,receipt.directory),earlier=join(root,'record-input.bin.gz'),later=join(root,'record-output.bin.gz');
  const original=fs.readSync;let changed=false;
  fs.readSync=(fd,...args)=>{if(!changed && readlinkSync('/proc/self/fd/'+fd)===later){changed=true;const bytes=readFileSync(earlier);chmodSync(earlier,0o600);bytes[0]^=1;writeFileSync(earlier,bytes);}return original(fd,...args);};syncBuiltinESMExports();
  try {await assert.rejects(verifyTranscriptRetention(f.root,receipt),/final complete compressed transcript descriptor sweep/);assert(changed);}
  finally {fs.readSync=original;syncBuiltinESMExports();}
});
for(const defect of ['invalid-gzip','extra-decoded','short-decoded','changed-decoded','duplicate-member','missing-member'])test(`reader rejects ${defect} even with recomputed unauthoritative archive metadata`,async t=>{
  const f=fixture(t);small(f);let receipt=await f.owner.retainCompleted();
  const path=join(f.root,receipt.directory,'record-input.bin.gz');
  if(!defect.endsWith('member')) {chmodSync(path,0o600);writeFileSync(path,defect==='invalid-gzip'?Buffer.from('not gzip'):gzipSync(defect==='extra-decoded'?Buffer.from([0,1,10,255,3]):defect==='short-decoded'?Buffer.from([0,1]):Buffer.from([0,1,10,254])));chmodSync(path,0o400);}
  receipt=refreshed(f,receipt,document=>{if(defect==='duplicate-member')document.files[1]=document.files[0];else if(defect==='missing-member')document.files.pop();else document.files[0].archive=recapture(path);});
  await assert.rejects(verifyTranscriptRetention(f.root,receipt));
});
test('a retained copy proves raw bytes without rewriting or claiming original execution custody',async t=>{
  const f=fixture(t);small(f);const receipt=await f.owner.retainCompleted();
  const copy=mkdtempSync(join(tmpdir(),'prismpm-transcript-copy-'));t.after(()=>rmSync(copy,{recursive:true,force:true}));
  const target=join(copy,receipt.directory);mkdirSync(target,{mode:0o700});
  for(const name of readdirSync(join(f.root,receipt.directory)))copyFileSync(join(f.root,receipt.directory,name),join(target,name));
  await assert.rejects(verifyTranscriptRetention(copy,receipt));
  const result=await verifyCopiedTranscriptRetention(copy,receipt);assert.equal(result.originalLiveCustodyVerified,false);
  assert.equal(result.scope,'retained-copy-transcript-bytes-only');assert.deepEqual(result.files,receipt.logicalRaw.files);
  assert.equal(sha(readFileSync(join(target,'manifest.json'))),receipt.manifest_sha256);
});
for(const defect of ['complete','absent-receipt','tampered-archive','omitted-logical-row'])test(`separate collector records ${defect} without borrowing an execution result`,async t=>{
  const f=fixture(t,'prismpm-session-payloads-');small(f);const receipt=await f.owner.retainCompleted();
  if(defect!=='absent-receipt'){
    const readback=structuredClone(receipt.logicalRaw);if(defect==='omitted-logical-row')readback.files.pop();
    writeFileSync(join(f.root,'payload-owner-evidence.json'),JSON.stringify({scope:'private-payload-source-and-browser-owner',publicApplicationAccepted:false,transcriptRetention:receipt,transcriptReadback:readback}));
  }
  if(defect==='tampered-archive'){const path=join(f.root,receipt.directory,'record-input.bin.gz');chmodSync(path,0o600);writeFileSync(path,'tampered');}
  const result=await collectPayloadTranscriptReadbacks([f.root]);assert.equal(result.roots.length,1);
  assert.equal(result.roots[0].state,defect==='complete'?'verified-retained-bytes':defect==='absent-receipt'?'incomplete':'failed');
  assert.equal(result.scope,'retained-raw-bytes-only-not-application-acceptance');assert(existsSync(join(f.root,receipt.directory,'manifest.json')));
});
