// Unit lifecycle evidence only: no Docker, GitHub authority, SDK or product claims.
import assert from 'node:assert/strict';
import test,{mock} from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import cp from 'node:child_process';
import {EventEmitter} from 'node:events';
import {Readable,PassThrough,Writable} from 'node:stream';
import {createHash} from 'node:crypto';
import {constructionCredential,constructionEvidenceLocation,readConstructionRetained,verifyConstructionRetention,observeConstruction} from './sdk-construction-observe.mjs';
const source='a'.repeat(40),qualifier='b'.repeat(40),args=[source,'123','1','12','13',qualifier];
const root=new URL('..',import.meta.url).pathname.replace(/\/$/,'');
test('real evidence containment rejects source descendants and symlinked external parents',()=>{
 const temp=fs.mkdtempSync(os.tmpdir()+'/construction-location-');
 try{
  fs.symlinkSync(root,temp+'/alias');
  for(const destination of[root+'/scripts/new',temp+'/alias/new'])assert.throws(()=>constructionEvidenceLocation(root,destination),/outside source/);
  assert.deepEqual(constructionEvidenceLocation(root,temp+'/new'),{root:fs.realpathSync(root),out:temp+'/new'});
 }finally{fs.rmSync(temp,{recursive:true});}
});
test('credential input is bounded finite private and deadline enforced',async()=>{
 assert.equal((await constructionCredential(Readable.from([Buffer.from('unit-only')]),1000)).toString(),'unit-only');
 for(const bytes of[Buffer.alloc(0),Buffer.alloc(1024)])await assert.rejects(constructionCredential(Readable.from([bytes]),1000));
 const stalled=new Readable({read(){}});await assert.rejects(constructionCredential(stalled,5),/deadline/);assert(stalled.destroyed);
});
async function lifecycle(mode){
 const temp=fs.mkdtempSync(os.tmpdir()+'/construction-observer-'),out=temp+'/evidence',calls=[];
 const stdin=Object.getOwnPropertyDescriptor(process,'stdin');
 Object.defineProperty(process,'stdin',{configurable:true,value:Readable.from([Buffer.from('unit-only-no-real-credential')])});
 let child,running=false,nonce,changed=false;
 const originalRead=fs.readFileSync;
 if(mode==='late'){
  let late=false;const now=performance.now.bind(performance),open=fs.openSync,close=fs.closeSync,paths=new Map();
  mock.method(performance,'now',()=>now()+(late?60001:0));
  mock.method(fs,'openSync',function(path,...rest){const fd=open.call(this,path,...rest);paths.set(fd,String(path));return fd;});
  mock.method(fs,'closeSync',function(fd){close.call(this,fd);if(paths.get(fd)===out+'/acquisition/arm64/evidence/tamper.json')late=true;paths.delete(fd);});
 }
 mock.method(fs,'statfsSync',()=>({bavail:2048,bsize:1024**2}));
 mock.method(cp,'execFileSync',(_binary,argv,options)=>{
  if(argv.includes('show'))return Buffer.from('unit-only independently selected Git bytes\n');
  if(argv.includes('--show-toplevel'))return root;
  if(argv.includes('HEAD'))return qualifier;
  if(argv.includes('--porcelain'))return changed?' M SPEC.md':'';
  assert.fail('unexpected unit Git request');
 });
 mock.method(cp,'spawnSync',(_binary,argv)=>{
  calls.push(argv);const operation=argv[2];
  if(operation==='ps')return {status:0,signal:null,stdout:running?child.name+'\n':''};
  if(operation==='inspect')return {status:running?0:1,signal:null,stdout:JSON.stringify([{Config:{Labels:{'org.uor.prismpm.construction-integrity':mode==='foreign'?'different-owner':nonce}}}])};
  if(operation==='stop'){running=false;return {status:0,signal:null,stdout:''};}
  assert.fail('unexpected unit Docker request');
 });
 if(mode==='log')mock.method(fs,'createWriteStream',()=>new Writable({write(_b,_e,done){done(Error('unit-only log write failed'));}}));
 if(['missing-log','file'].includes(mode))mock.method(fs,'readFileSync',function(path,...rest){
  if(mode==='missing-log'&&String(path).endsWith('/docker.log'))throw Error('unit-only missing log');
  if(mode==='file'&&changed&&String(path).endsWith('/scripts/sdk-candidate.mjs'))return Buffer.from('unit-only source drift');
  return originalRead.call(this,path,...rest);
 });
 const originalOutput=process.stdout.write;
 if(['overflow','stdout'].includes(mode))mock.method(process.stdout,'write',function(bytes,...rest){
  // Preserve the test runner's own serialized results; intercept only our bytes.
  if(mode==='overflow'&&Buffer.isBuffer(bytes)&&bytes.length===1024**2&&bytes[0]===65)return true;
  if(mode==='stdout'&&Buffer.isBuffer(bytes)&&bytes.toString()==='unit-only diagnostic')throw Error('unit-only stdout failure');
  return originalOutput.call(this,bytes,...rest);
 });
 mock.method(cp,'spawn',(_binary,argv,options)=>{
  assert.equal(options.env.GH_TOKEN,undefined);assert(!JSON.stringify(argv).includes('unit-only-no-real-credential'));
  assert.deepEqual(argv.slice(-3),['/standards.lock','/workflow.yml','/evidence/acquisition']);
  child=new EventEmitter();child.name=argv[argv.indexOf('--name')+1];nonce=argv[argv.indexOf('--label')+1].split('=')[1];
  child.stdout=new PassThrough();child.stderr=new PassThrough();child.stdin=new PassThrough();
  child.kill=signal=>{if(!['timeout','early'].includes(mode))queueMicrotask(()=>child.emit('close',null,signal));return true;};
  child.stdin.on('finish',()=>setImmediate(()=>{
   if(mode==='timeout'){running=true;return;}
   if(mode==='early'){running=true;child.stderr.emit('error',Error('unit-only early stream failure'));return;}
   if(['source','file'].includes(mode))changed=true;
   if(mode==='late'){
    const f=retainedFixture(),intent=JSON.parse(originalRead(out+'/intent.json'));
    for(const [name,key]of [['source-standards.lock','standards_sha256'],['source-workflow.yml','workflow_sha256']])f.result[key]=f.write(name,originalRead(out+'/'+name)).sha256;
    f.result.inputs=f.result.inputs.map(row=>({...row,sha256:intent.inputs.find(input=>input.path==='scripts/'+row.path).sha256}));
    f.write('completed.json',JSON.stringify(f.result));fs.renameSync(f.directory,out+'/acquisition');
   }
   if(['owned','foreign'].includes(mode))running=true;
   if(['log','stdout'].includes(mode))child.stdout.end('unit-only diagnostic');
   else if(mode==='overflow')child.stdout.end(Buffer.alloc(1024**2+1,65));
   else {child.stdout.end();child.stderr.end();}
   child.emit('close',mode==='exit'?1:0,null);
  }));
  return child;
 });
 try{
  // Every path is unsuccessful. Only 'late' supplies tiny unit-only readback
  // documents, never provider authority, an SDK or real archive evidence.
  await assert.rejects(observeConstruction(args,out,mode==='timeout'?5:mode==='early'?60000:10000));
  const receipt=JSON.parse(originalRead(out+'/docker.json'));
  assert(receipt.orchestration_failure);if(mode!=='late')assert(!fs.existsSync(out+'/acquisition/completed.json'));
  return {receipt,calls};
 }finally{mock.restoreAll();Object.defineProperty(process,'stdin',stdin);fs.rmSync(temp,{recursive:true});}
}
test('zero Docker exit without a complete acquisition is rejected and retained honestly',async()=>{
 const {receipt}=await lifecycle('missing');assert.equal(receipt.status,0);assert.equal(receipt.container_absent,true);
 assert.match(receipt.orchestration_failure,/receipt unavailable/);
});
test('nonzero Docker exit and post-run Git drift cannot be accepted',async()=>{
 assert.equal((await lifecycle('exit')).receipt.status,1);
 assert.match((await lifecycle('source')).receipt.orchestration_failure,/custody changed/);
});
test('individual source byte drift is rejected independently of Git status',async()=>{
 assert.match((await lifecycle('file')).receipt.orchestration_failure,/observer source custody changed/);
});
test('nonce-owned leftover containers are stopped but cleanup is not retroactive acceptance',async()=>{
 const {receipt,calls}=await lifecycle('owned');assert(receipt.container_absent);assert(calls.some(v=>v[2]==='stop'));
 assert.match(receipt.orchestration_failure,/absence not established/);
});
test('foreign container identity is never stopped or adopted as cleanup',async()=>{
 const {receipt,calls}=await lifecycle('foreign');assert.equal(receipt.container_absent,false);assert(!calls.some(v=>v[2]==='stop'));
});
test('log failure or unavailable retained bytes still emits a truthful failure receipt',async()=>{
 for(const mode of['log','missing-log']){const {receipt}=await lifecycle(mode);assert.equal(receipt.log_sha256,null);assert(receipt.orchestration_failure);}
});
test('diagnostic byte overflow and synchronous stdout failure retire the observer',async()=>{
 const overflow=(await lifecycle('overflow')).receipt;assert.equal(overflow.observed_log_bytes,1024**2+1);
 assert.equal(overflow.retained_log_bytes,1024**2);assert.match(overflow.orchestration_failure,/output budget exceeded/);
 assert.match((await lifecycle('stdout')).receipt.orchestration_failure,/stdout failure/);
});
test('outer deadline terminates stalled Docker and cannot emit completion',async()=>{
 const {receipt,calls}=await lifecycle('timeout');assert.match(receipt.orchestration_failure,/deadline exceeded/);
 assert(receipt.container_absent);assert(calls.some(v=>v[2]==='stop'));
});
test('early failure escalates a TERM-ignoring Docker client without waiting for the execution deadline',async()=>{
 const started=performance.now(),{receipt,calls}=await lifecycle('early');assert(performance.now()-started<20000);
 assert.match(receipt.orchestration_failure,/early stream failure/);assert(receipt.container_absent);assert(calls.some(v=>v[2]==='stop'));
});
test('final retained readback cannot publish success after its cleanup deadline',async()=>{
 const {receipt}=await lifecycle('late');assert.equal(receipt.retention.files,34);
 assert.match(receipt.orchestration_failure,/cleanup deadline exceeded/);
});

// Tiny custody-boundary documents, never provider/SDK/archive qualification.
function retainedFixture(){
 const directory=fs.mkdtempSync(os.tmpdir()+'/construction-retention-');
 const sha=bytes=>createHash('sha256').update(bytes).digest('hex'),standards=Buffer.from('unit-only standards'),workflow=Buffer.from('unit-only workflow');
 const selection={expected:{revision:source,run_id:123,run_attempt:1,artifact_ids:{amd64:12,arm64:13}},qualifier};
 const names=['acquire','provider','metadata','archive','stage','handoff'].map(n=>'sdk-construction-'+n+'.mjs').concat(['sdk-candidate.mjs','sdk-candidate-sbom.mjs']);
 const inputs=names.map(path=>({path:'scripts/'+path,sha256:sha(path)}));
 const write=(path,bytes)=>{bytes=Buffer.from(bytes);fs.writeFileSync(directory+'/'+path,bytes);return {path,bytes:bytes.length,sha256:sha(bytes)};};
 const result={scope:'authenticated original ZIP/OCI/blob integrity only; no expanded filesystem, registry, installed SDK, fullVV, release or product acceptance',
  expected:selection.expected,qualifier_source:qualifier,inputs:inputs.map(row=>({...row,path:row.path.slice(8)})),standards_sha256:sha(standards),workflow_sha256:sha(workflow),
  archives_stored:false,cleanup:{active_requests:0,all_sockets_closed:true},original_provider_responses:[],results:[]};
 write('source-standards.lock',standards);write('source-workflow.yml',workflow);
 result.composed_index_digest='sha256:'+write('composed-unqualified-index.json','unit-only index').sha256;
 for(let i=1;i<=6;i++)result.original_provider_responses.push(write(`provider-0${i}.json`,'unit-only original '+i));
 write('resource-terminal.json',JSON.stringify({cleanup:result.cleanup,memory:Object.fromEntries(
  ['memory.current','memory.peak','memory.events','memory.swap.current','memory.swap.peak','memory.swap.events'].map(key=>[key,'unit-only observation']))}));
 for(const arch of ['amd64','arm64']){
  fs.mkdirSync(directory+'/'+arch);fs.mkdirSync(directory+'/'+arch+'/evidence');
  const files=['construction.json',...['authority-result.json','candidate.json','cli.json','config.json','digest.txt','inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'].map(n=>'evidence/'+n)]
   .map(path=>write(arch+'/'+path,'unit-only small bytes '+path));
  const archive={byte_length:1,digest:'sha256:'+sha('unit-only-not-a-real-archive')};
  const receipt={source,qualifier_source:qualifier,run_id:123,run_attempt:1,architecture:arch,artifact_id:selection.expected.artifact_ids[arch],
   scope:'original-stored-zip-and-oci-blob-integrity-only',transport_closed:true,metadata:{files},archive,
   members:files.map(row=>({path:row.path.slice(arch.length+1),byte_length:row.bytes,digest:'sha256:'+row.sha256})).concat([{path:'sdk.oci.tar',...archive}])};
  result.results.push(write('original-'+arch+'-integrity.json',JSON.stringify(receipt)));
 }
 return {directory,result,outer:{selection,inputs,standards,workflow},write};
}
function withRetention(run){const f=retainedFixture();try{return run(f);}finally{fs.rmSync(f.directory,{recursive:true});}}
test('small-file readback binds all original retained references without claiming archive replay',()=>withRetention(f=>{
 const actualAcquire=fs.readFileSync(new URL('./sdk-construction-acquire.mjs',import.meta.url),'utf8');
 const actualObserver=fs.readFileSync(new URL('./sdk-construction-observe.mjs',import.meta.url),'utf8');
 assert(actualAcquire.includes("'sdk-construction-stage.mjs'"));
 assert(actualObserver.includes("['acquire','provider','metadata','archive','stage','handoff']"));
 assert(actualObserver.includes("['observe','acquire','provider','metadata','archive','stage','handoff']"));
 const receipt=verifyConstructionRetention(f.directory,f.result,f.outer);assert.equal(receipt.scope,'retained-small-file-custody-only');assert.equal(receipt.files,34);
}));
test('missing changed or coherently resealed cross-source retained evidence is rejected',()=>{
 for(const mutate of[
  f=>fs.unlinkSync(f.directory+'/provider-01.json'),
  f=>f.write('amd64/evidence/cli.json','changed unit bytes'),
  f=>{f.result.expected={...f.result.expected,run_attempt:2};},
  f=>{f.result.inputs[0].sha256='0'.repeat(64);},
  f=>{f.result.inputs=f.result.inputs.filter(row=>row.path!=='sdk-construction-stage.mjs');},
  f=>{f.outer.inputs=f.outer.inputs.filter(row=>row.path!=='scripts/sdk-construction-stage.mjs');},
  f=>{const path='original-amd64-integrity.json',receipt=JSON.parse(fs.readFileSync(f.directory+'/'+path));receipt.artifact_id=99;f.result.results[0]=f.write(path,JSON.stringify(receipt));},
  f=>{f.result.standards_sha256=f.write('source-standards.lock','coherently changed source').sha256;}
 ])withRetention(f=>{mutate(f);assert.throws(()=>verifyConstructionRetention(f.directory,f.result,f.outer));});
});
test('retained custody rejects symlink files and duplicate or missing lane and metadata references',()=>{
 for(const mutate of[
  f=>{fs.unlinkSync(f.directory+'/provider-01.json');fs.symlinkSync('provider-02.json',f.directory+'/provider-01.json');},
  f=>{f.result.results[1]=f.result.results[0];},
  f=>{const path='original-amd64-integrity.json',receipt=JSON.parse(fs.readFileSync(f.directory+'/'+path));receipt.metadata.files.pop();f.result.results[0]=f.write(path,JSON.stringify(receipt));},
  f=>{f.result.original_provider_responses.pop();}
 ])withRetention(f=>{mutate(f);assert.throws(()=>verifyConstructionRetention(f.directory,f.result,f.outer));});
});
test('held-FD reads reject real concurrent growth and pathname replacement within bounded allocations',()=>{
 for(const mode of ['growth','replacement']){
  const temp=fs.mkdtempSync(os.tmpdir()+'/construction-retained-growth-'),path=temp+'/file';fs.writeFileSync(path,'a');
  const originalRead=fs.readSync;let count=0,fd,changed=false;
  mock.method(fs,'readSync',function(descriptor,...rest){
   fd=descriptor;if(!changed){changed=true;if(mode==='growth')fs.appendFileSync(path,Buffer.alloc(65536));
    else {fs.renameSync(path,temp+'/previous');fs.writeFileSync(path,'a');}}
   const n=originalRead.call(this,descriptor,...rest);count+=n;return n;
  });
  try{assert.throws(()=>readConstructionRetained(path,1),/grew during read|custody changed/);assert(count<=2);
   assert.throws(()=>fs.fstatSync(fd),{code:'EBADF'});
  }finally{mock.restoreAll();fs.rmSync(temp,{recursive:true});}
 }
});
test('completed symlinks and per-file or aggregate byte overflow refuse before payload reads',()=>{
 const temp=fs.mkdtempSync(os.tmpdir()+'/construction-retained-bounds-');fs.writeFileSync(temp+'/original','abcd');fs.symlinkSync('original',temp+'/completed.json');
 const originalRead=fs.readSync;let reads=0;mock.method(fs,'readSync',function(...args){reads++;return originalRead.apply(this,args);});
 try{
  assert.throws(()=>readConstructionRetained(temp+'/completed.json',100),{code:'ELOOP'});assert.equal(reads,0);
  assert.throws(()=>readConstructionRetained(temp+'/original',3));assert.equal(reads,0);
  const budget={bytes:0,limit:6};assert.equal(readConstructionRetained(temp+'/original',4,budget).toString(),'abcd');const previous=reads;
  assert.throws(()=>readConstructionRetained(temp+'/original',4,budget),/aggregate/);assert.equal(reads,previous);
 }finally{mock.restoreAll();fs.rmSync(temp,{recursive:true});}
});
