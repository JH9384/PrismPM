// Real small ZIP/OCI and filesystem adversaries only, not installed SDK proof.
import assert from 'node:assert/strict';
import test,{mock} from 'node:test';
import fs from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {Readable} from 'node:stream';
import {chmodSync,existsSync,linkSync,mkdtempSync,mkdirSync,readdirSync,readFileSync,
 readlinkSync,renameSync,rmSync,symlinkSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fixture} from './sdk-construction-archive-fixture.mjs';
import {stageConstructionArchiveStream,verifyConstructionArchiveStream} from './sdk-construction-archive.mjs';
import {beginConstructionStage,constructionStageDescriptor,consumeConstructionStage,retireConstructionStage} from './sdk-construction-stage.mjs';
const input=b=>Readable.from((function*(){for(let at=0;at<b.length;at+=257)yield b.subarray(at,at+257);})());
async function temporary(run){const root=mkdtempSync(join(tmpdir(),'oci-stage-test-'));chmodSync(root,0o700);
 try{return await run(root);}finally{rmSync(root,{recursive:true});}}
test('whole original ZIP admission alone publishes an opaque stage and exact tar readback',async()=>temporary(async root=>{
 for(const wide of [false,true]){
  const f=fixture({wide}),r=await stageConstructionArchiveStream(input(f.bytes),f.plan,root);
  assert(r.integrity.transport_closed);assert.deepEqual(Object.keys(r.handle),[]);assert(Object.isFrozen(r.handle));
  assert.deepEqual(constructionStageDescriptor(r.handle),{...f.plan.archive,scope:'verified original OCI tar custody only'});
  const stagedPath=join(root,readdirSync(root)[0]);
  const held=readdirSync('/proc/self/fd').filter(fd=>{
   try{return readlinkSync('/proc/self/fd/'+fd)===stagedPath;}catch(error){if(error.code==='ENOENT')return false;throw error;}
  });
  assert.equal(held.length,1,'one original stage descriptor must remain held');
  const flags=/^flags:\s+([0-7]+)$/m.exec(readFileSync('/proc/self/fdinfo/'+held[0],'utf8'));
  assert(flags);assert.equal(parseInt(flags[1],8)&3,fs.constants.O_RDONLY,'sealed descriptor itself must be read-only');
  assert.throws(()=>writeSync(Number(held[0]),Buffer.of(0),0,1,0),{code:'EBADF'});
  const parts=[];let active=0;
  const readback=await consumeConstructionStage(r.handle,async b=>{assert.equal(++active,1);await new Promise(resolve=>setImmediate(resolve));parts.push(b);active--;});
  assert.deepEqual(Buffer.concat(parts),f.archive);assert.equal(readback.digest,f.plan.archive.digest);
  assert(!readback.scope.includes('installed SDK acceptance'));assert.equal(readback.status,undefined);
  assert.deepEqual(retireConstructionStage(r.handle),{original_file_absent:true,descriptors_closed:true,scope:'owned OCI staging retirement only'});
  assert.deepEqual(readdirSync(root),[]);assert.throws(()=>constructionStageDescriptor(r.handle));assert.throws(()=>retireConstructionStage(r.handle));
 }
}));
test('copied integrity records and arbitrary objects cannot mint or impersonate stage authority',async()=>temporary(async root=>{
 const f=fixture(),integrity=await verifyConstructionArchiveStream(input(f.bytes),f.plan);
 const stage=beginConstructionStage(root,f.plan.archive,performance.now()+10000);await stage.write(f.archive);
 await assert.rejects(stage.seal(JSON.parse(JSON.stringify(integrity))),/whole-stream integrity authority/);
 for(const handle of [{},Object.freeze({}),integrity]){assert.throws(()=>constructionStageDescriptor(handle));await assert.rejects(consumeConstructionStage(handle,()=>{}));assert.throws(()=>retireConstructionStage(handle));}
 stage.retire();assert.deepEqual(readdirSync(root),[]);
}));
test('coherently resealed invalid OCI graph cannot publish staging authority',async()=>temporary(async root=>{
 const f=fixture({entries:rows=>rows.filter(r=>r.name!=='blobs/')});const stream=input(f.bytes);
 await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root),/original OCI layout ancestors required/);
 assert(stream.closed);assert.deepEqual(readdirSync(root),[]);
}));
test('provider digest rejection after original tar writing retires every owned stage byte',async()=>temporary(async root=>{
 const f=fixture();f.plan.artifact.digest='sha256:'+'0'.repeat(64);const stream=input(f.bytes);
 await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root),/original provider ZIP digest differs/);
 assert(stream.closed);assert.deepEqual(readdirSync(root),[]);
}));
test('unsafe staging directory and malformed authority retire the admitted input transport',async()=>temporary(async root=>{
 const privateRoot=join(root,'private');mkdirSync(privateRoot,{mode:0o700});const alias=join(root,'alias');symlinkSync(privateRoot,alias);
 for(const parent of [alias,root]){if(parent===root)chmodSync(root,0o777);const f=fixture(),stream=input(f.bytes);
  await assert.rejects(stageConstructionArchiveStream(stream,f.plan,parent));assert(stream.closed);assert.deepEqual(readdirSync(privateRoot),[]);}
 chmodSync(root,0o700);const f=fixture(),stream=input(f.bytes);
 await assert.rejects(stageConstructionArchiveStream(stream,{...f.plan,extra:true},root));assert(stream.closed);
 assert.deepEqual(readdirSync(root).sort(),['alias','private']);
}));
test('directory substitution fails closed and cleanup remains anchored to the original held directory',async()=>temporary(async root=>{
 const original=join(root,'original'),moved=join(root,'moved');mkdirSync(original,{mode:0o700});const f=fixture();
 const stream=Readable.from((async function*(){yield f.bytes.subarray(0,30);renameSync(original,moved);mkdirSync(original,{mode:0o700});writeFileSync(join(original,'unrelated'),'preserve');yield f.bytes.subarray(30);})());
 await assert.rejects(stageConstructionArchiveStream(stream,f.plan,original));assert(stream.closed);
 assert.deepEqual(readdirSync(moved),[]);assert.equal(readFileSync(join(original,'unrelated'),'utf8'),'preserve');
}));
test('file replacement is never followed overwritten or deleted during failed staging retirement',async()=>temporary(async root=>{
 const f=fixture(),stream=Readable.from((async function*(){yield f.bytes.subarray(0,30);const name=readdirSync(root)[0];
  renameSync(join(root,name),join(root,'held-original'));writeFileSync(join(root,'unrelated'),'preserve');symlinkSync('unrelated',join(root,name));yield f.bytes.subarray(30);})());
 await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root),/staging and retirement failed/);assert(stream.closed);
 assert.equal(readFileSync(join(root,'unrelated'),'utf8'),'preserve');assert(existsSync(join(root,'held-original')));
 assert.equal(readdirSync(root).length,3);
}));
test('hard-link aliasing cannot publish a handle or authorize deletion of an aliased inode',async()=>temporary(async root=>{
 const f=fixture(),stream=Readable.from((async function*(){yield f.bytes.subarray(0,30);linkSync(join(root,readdirSync(root)[0]),join(root,'alias'));yield f.bytes.subarray(30);})());
 await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root),/staging and retirement failed/);assert(stream.closed);assert.equal(readdirSync(root).length,2);
}));
test('post-admission byte and mode mutation invalidates descriptor and readback authority',async()=>temporary(async root=>{
 const f=fixture(),r=await stageConstructionArchiveStream(input(f.bytes),f.plan,root),path=join(root,readdirSync(root)[0]);
 chmodSync(path,0o600);writeFileSync(path,Buffer.alloc(f.archive.length,1));chmodSync(path,0o400);
 assert.throws(()=>constructionStageDescriptor(r.handle),/custody changed/);
 await assert.rejects(consumeConstructionStage(r.handle,()=>{}),/custody changed/);
 assert.throws(()=>retireConstructionStage(r.handle),/retirement unproven/);assert(existsSync(path));
}));
test('stalled and rejecting consumers fail within their unchanged bound without retaining stage ownership',async()=>temporary(async root=>{
 const f=fixture(),r=await stageConstructionArchiveStream(input(f.bytes),f.plan,root);
 await assert.rejects(consumeConstructionStage(r.handle,()=>new Promise(()=>{}),20),/consumer deadline exceeded/);
 await assert.rejects(consumeConstructionStage(r.handle,()=>{throw Error('real consumer failure');}),/real consumer failure/);
 assert(retireConstructionStage(r.handle).original_file_absent);assert.deepEqual(readdirSync(root),[]);
}));
test('overrun deadline and wrong archive length cannot publish a sealed handle',async()=>temporary(async root=>{
 const f=fixture(),stage=beginConstructionStage(root,f.plan.archive,performance.now()+10000);
 await assert.rejects(stage.write(Buffer.concat([f.archive,Buffer.alloc(1)])));stage.retire();
 const stream=new Readable({read(){}});await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root,10),/deadline exceeded/);
 assert(stream.closed);assert.deepEqual(readdirSync(root),[]);
}));
test('stage constructor cannot replace the original thirty-minute deadline with an unbounded future',async()=>temporary(async root=>{
 const f=fixture();for(const end of [Infinity,NaN,performance.now()-1]){
  assert.throws(()=>beginConstructionStage(root,f.plan.archive,end));assert.deepEqual(readdirSync(root),[]);
 }
 assert.throws(()=>beginConstructionStage(root,f.plan.archive,performance.now()+3600000));assert.deepEqual(readdirSync(root),[]);
}));
test('only one bounded write may hold copied bytes and no publication or retirement can race it',async()=>temporary(async root=>{
 const f=fixture({indexPadding:2*1024**2}),stage=beginConstructionStage(root,f.plan.archive,performance.now()+10000);
 const writing=stage.write(f.archive.subarray(0,1024**2));
 try{
  await assert.rejects(stage.write(f.archive.subarray(1024**2,2*1024**2)),/exclusive|in.flight/);
  await assert.rejects(stage.seal({}),/exclusive|in.flight/);
  assert.throws(()=>stage.retire(),/exclusive|in.flight/);
 }finally{await writing;stage.retire();}assert.deepEqual(readdirSync(root),[]);
}));
test('actual delayed final filesystem admission cannot publish after its original deadline',async()=>temporary(async root=>{
 const f=fixture(),integrity=await verifyConstructionArchiveStream(input(f.bytes),f.plan);
 const end=performance.now()+1000,stage=beginConstructionStage(root,f.plan.archive,end);
 await stage.write(f.archive);const original=fs.statfsSync;let finalReached=false;
 // Unit scheduling fault only: retain the real statfs result and actual clock.
 // No SDK, provider, filesystem or product qualification is claimed here.
 mock.method(fs,'statfsSync',function(...args){const result=original.apply(this,args);finalReached=true;while(performance.now()<=end+10){}return result;});
 syncBuiltinESMExports();
 try{await assert.rejects(stage.seal(integrity),/deadline exceeded/);assert(finalReached,'the final actual filesystem admission must be exercised');}
 finally{mock.restoreAll();syncBuiltinESMExports();stage.retire();}assert.deepEqual(readdirSync(root),[]);
}));
test('a concurrently renamed original inode cannot be reported retired from pathname absence alone',async()=>temporary(async root=>{
 const f=fixture(),r=await stageConstructionArchiveStream(input(f.bytes),f.plan,root),original=fs.unlinkSync;
 // Unit namespace fault at the actual unlink boundary. The trusted directory
 // owner can mutate it; this cannot prove immunity to same-owner host races.
 mock.method(fs,'unlinkSync',function(path){renameSync(path,join(root,'renamed-original'));writeFileSync(path,'unit-only replacement');return original.call(this,path);});
 syncBuiltinESMExports();
 try{assert.throws(()=>retireConstructionStage(r.handle),/retirement unproven/);assert(existsSync(join(root,'renamed-original')));}
 finally{mock.restoreAll();syncBuiltinESMExports();}
}));
test('failure immediately after exclusive file open cannot leak its original file descriptor',async()=>temporary(async root=>{
 const f=fixture(),original=fs.fstatSync;let failedFd;
 mock.method(fs,'fstatSync',function(fd,...args){const actual=original.call(this,fd,...args);
  if(actual.isFile()&&failedFd===undefined){failedFd=fd;throw Error('unit-only initial fstat failure');}return actual;});
 syncBuiltinESMExports();
 try{
  assert.throws(()=>beginConstructionStage(root,f.plan.archive,performance.now()+10000));assert(Number.isInteger(failedFd));
  assert.throws(()=>original(failedFd),{code:'EBADF'});assert.deepEqual(readdirSync(root),[]);
 }finally{mock.restoreAll();syncBuiltinESMExports();}
 for(const fault of ['readonly-open','readonly-stat']){
  const actualOpen=fs.openSync,actualStat=fs.fstatSync;let writer,reader,injected=false;
  mock.method(fs,'openSync',function(path,flags,...args){
   const reopening=String(path).startsWith('/proc/self/fd/')&&String(path).includes('/.prismpm-oci-')&&(flags&3)===fs.constants.O_RDONLY;
   if(reopening&&fault==='readonly-open'){injected=true;throw Error('unit-only readonly reopen failure');}
   const opened=actualOpen.call(this,path,flags,...args);
   if(flags&fs.constants.O_CREAT)writer=opened;if(reopening)reader=opened;return opened;
  });
  mock.method(fs,'fstatSync',function(fd,...args){
   if(fd===reader&&fault==='readonly-stat'&&!injected){injected=true;throw Error('unit-only readonly identity failure');}
   return actualStat.call(this,fd,...args);
  });
  syncBuiltinESMExports();
  try{
   const stream=input(f.bytes);await assert.rejects(stageConstructionArchiveStream(stream,f.plan,root));
   assert(injected,'readonly transition fault must execute');assert(stream.closed);
   assert(Number.isInteger(writer));assert.throws(()=>actualStat(writer),{code:'EBADF'});
   if(reader!==undefined)assert.throws(()=>actualStat(reader),{code:'EBADF'});
   assert.deepEqual(readdirSync(root),[]);
  }finally{mock.restoreAll();syncBuiltinESMExports();}
 }
}));
test('caller archive accessors cannot throw after file acquisition and leave an unowned descriptor',async()=>temporary(async root=>{
 const f=fixture(),original=fs.openSync;let reads=0,openedFd;
 const archive={get byte_length(){if(++reads===3)throw Error('unit-only post-open getter failure');return f.plan.archive.byte_length;},digest:f.plan.archive.digest};
 mock.method(fs,'openSync',function(path,flags,...args){const fd=original.call(this,path,flags,...args);if(flags&fs.constants.O_CREAT)openedFd=fd;return fd;});
 syncBuiltinESMExports();
 try{
  assert.throws(()=>beginConstructionStage(root,archive,performance.now()+10000));
  if(openedFd!==undefined)assert.throws(()=>fs.fstatSync(openedFd),{code:'EBADF'});
  assert.deepEqual(readdirSync(root),[]);
 }finally{mock.restoreAll();syncBuiltinESMExports();}
}));
