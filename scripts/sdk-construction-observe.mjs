// Job-owned bounded acquisition container. No archives are stored locally.
import assert from 'node:assert/strict';
import cp from 'node:child_process';
import {createHash,randomBytes} from 'node:crypto';
import fs from 'node:fs';
import {finished} from 'node:stream/promises';
import {resolve,relative,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {constructionSelection,constructionSelectionJson} from './sdk-construction-acquire.mjs';
export const constructionObserverImage='docker.io/library/node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9';
const sha=b=>createHash('sha256').update(b).digest('hex');
const env={PATH:process.env.PATH,LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
const docker=(...args)=>cp.spawnSync('docker',['--host','unix:///var/run/docker.sock',...args],{env,encoding:'utf8',timeout:5000,maxBuffer:1024**2});
const git=(...args)=>cp.execFileSync('git',['--no-replace-objects','-c','core.fsmonitor=false',...args],{env,encoding:'utf8',timeout:10000,maxBuffer:1024**2}).trim();

export function constructionEvidenceLocation(root,destination){
 root=fs.realpathSync(root);const out=resolve(fs.realpathSync(dirname(resolve(destination))),resolve(destination).split('/').pop());
 const location=relative(root,out);assert(location==='..'||location.startsWith('../'),'evidence must be outside source tree');return {root,out};
}
export async function constructionCredential(stream,timeoutMs){
 assert(Number.isFinite(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000000);
 const secret=Buffer.alloc(1024);let offset=0,timer;
 try{
  await new Promise((resolve,reject)=>{
   const finish=error=>{clearTimeout(timer);stream.off('data',data);stream.off('end',end);stream.off('error',errorHandler);stream.off('close',close);
    if(error){stream.destroy();reject(error);}else resolve();};
   const data=bytes=>{if(offset+bytes.length>=secret.length)return finish(Error('bounded credential input required'));
    Buffer.from(bytes).copy(secret,offset);offset+=bytes.length;};
   const end=()=>finish(offset?null:Error('credential input required'));
   const errorHandler=()=>finish(Error('credential input transport failed'));
   const close=()=>finish(Error('credential input closed before end'));
   stream.on('data',data);stream.once('end',end);stream.once('error',errorHandler);stream.once('close',close);
   timer=setTimeout(()=>finish(Error('credential input deadline exceeded')),timeoutMs);stream.resume();
  });
  return secret.subarray(0,offset);
 }catch(error){secret.fill(0);throw error;}
}
// Retained small-file custody only, not independent transport authentication or
// replay of the multi-GiB original streams. Those proofs require the acquirer.
export function readConstructionRetained(path,limit,budget={bytes:0,limit:256*1024**2}){
 assert(Number.isSafeInteger(limit)&&limit>=0&&limit<=64*1024**2);
 assert.equal(resolve(path),path);assert.equal(fs.realpathSync(dirname(path)),dirname(path),'symlinked retained directory refused');
 const fd=fs.openSync(path,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
 try{
  const before=fs.fstatSync(fd);assert(before.isFile()&&before.size<=limit);
  assert(Number.isSafeInteger(budget.bytes)&&Number.isSafeInteger(budget.limit)&&budget.bytes>=0&&budget.limit<=256*1024**2);
  assert((budget.bytes+=before.size)<=budget.limit,'aggregate retained byte limit exceeded');
  const bytes=Buffer.alloc(before.size);let offset=0;
  while(offset<bytes.length){const n=fs.readSync(fd,bytes,offset,Math.min(1024**2,bytes.length-offset),offset);assert(n>0,'retained file truncated during read');offset+=n;}
  assert.equal(fs.readSync(fd,Buffer.alloc(1),0,1,offset),0,'retained file grew during read');
  for(const after of [fs.fstatSync(fd),fs.lstatSync(path)]){
   assert(after.isFile());for(const key of ['dev','ino','size','mtimeMs','ctimeMs','mode','nlink'])assert.equal(after[key],before[key],'retained file custody changed');
  }
  return bytes;
 }finally{fs.closeSync(fd);}
}
export function verifyConstructionRetention(directory,result,{selection,inputs,standards,workflow}){
 assert.equal(result.scope,'authenticated original ZIP/OCI/blob integrity only; no expanded filesystem, registry, installed SDK, fullVV, release or product acceptance');
 assert.deepEqual(result.expected,selection.expected);assert.equal(result.qualifier_source,selection.qualifier);
 assert.equal(result.archives_stored,false);assert.equal(result.cleanup.active_requests,0);assert.equal(result.cleanup.all_sockets_closed,true);
 assert.equal(result.standards_sha256,sha(standards));assert.equal(result.workflow_sha256,sha(workflow));
 const names=['acquire','provider','metadata','archive','stage','handoff'].map(n=>'sdk-construction-'+n+'.mjs').concat(['sdk-candidate.mjs','sdk-candidate-sbom.mjs']);
 assert.deepEqual(result.inputs,names.map(path=>({path,sha256:inputs.find(row=>row.path==='scripts/'+path)?.sha256})));
 const budget={bytes:0,limit:256*1024**2},seen=new Set();
 const read=(path,limit=64*1024**2)=>{
  assert(typeof path==='string'&&/^[a-zA-Z0-9./_-]+$/.test(path)&&!path.split('/').some(p=>p===''||p==='.'||p==='..'));
  assert(!seen.has(path),'duplicate retained reference');seen.add(path);
  return readConstructionRetained(directory+'/'+path,limit,budget);
 };
 const rowBytes=(row,path,limit)=>{assert.equal(row.path,path);const bytes=read(path,limit);assert.equal(row.bytes,bytes.length);assert.equal(row.sha256,sha(bytes));return bytes;};
 assert.deepEqual(read('source-standards.lock',1024**2),standards);assert.deepEqual(read('source-workflow.yml',262144),workflow);
 assert.equal('sha256:'+sha(read('composed-unqualified-index.json',1024**2)),result.composed_index_digest);
 assert.equal(result.original_provider_responses.length,6);
 result.original_provider_responses.forEach((row,i)=>rowBytes(row,`provider-${String(i+1).padStart(2,'0')}.json`,1024**2));
 const resource=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(read('resource-terminal.json',65536)));
 assert.deepEqual(resource.cleanup,result.cleanup);assert.deepEqual(Object.keys(resource.memory).sort(),
  ['memory.current','memory.peak','memory.events','memory.swap.current','memory.swap.peak','memory.swap.events'].sort());
 assert(Object.values(resource.memory).every(value=>typeof value==='string'&&value.length>0));
 assert.equal(result.results.length,2);
 const metadataNames=['construction.json',...['authority-result.json','candidate.json','cli.json','config.json','digest.txt',
  'inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'].map(n=>'evidence/'+n)];
 for(const [i,arch]of ['amd64','arm64'].entries()){
  const receipt=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(rowBytes(result.results[i],'original-'+arch+'-integrity.json',1024**2)));
  for(const [key,value]of Object.entries({source:selection.expected.revision,qualifier_source:selection.qualifier,run_id:selection.expected.run_id,
   run_attempt:selection.expected.run_attempt,architecture:arch,artifact_id:selection.expected.artifact_ids[arch]}))assert.equal(receipt[key],value);
  assert.equal(receipt.scope,'original-stored-zip-and-oci-blob-integrity-only');assert.equal(receipt.transport_closed,true);
  assert.deepEqual(receipt.metadata.files.map(row=>row.path).slice().sort(),metadataNames.map(n=>arch+'/'+n).sort());
  assert.equal(receipt.members.length,12);assert.deepEqual(receipt.members.map(row=>row.path).sort(),[...metadataNames,'sdk.oci.tar'].sort());
  for(const row of receipt.metadata.files){const bytes=rowBytes(row,row.path);const member=receipt.members.find(m=>m.path===row.path.slice(arch.length+1));
   assert.equal(member.byte_length,bytes.length);assert.equal(member.digest,'sha256:'+sha(bytes));}
  const archive=receipt.members.find(m=>m.path==='sdk.oci.tar');assert.equal(archive.byte_length,receipt.archive.byte_length);assert.equal(archive.digest,receipt.archive.digest);
 }
 return {scope:'retained-small-file-custody-only',files:seen.size,bytes:budget.bytes};
}

export async function observeConstruction(args,destination,timeoutMs=5000000){
 assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>0&&timeoutMs<=5000000);const deadline=performance.now()+timeoutMs;
 const selection=constructionSelection(args),{root,out}=constructionEvidenceLocation(git('rev-parse','--show-toplevel'),destination);
 assert(process.getuid()>0&&process.getgid()>0,'nonroot acquisition owner required');
 assert.equal(git('rev-parse','HEAD'),selection.qualifier);assert.equal(git('status','--porcelain'),'');
 for(const path of[root,dirname(out)]){const disk=fs.statfsSync(path);assert(disk.bavail*disk.bsize>=1536*1024**2,'at least1.5GiB storage reserve required');}
 const name='prism-construction-integrity-'+randomBytes(12).toString('hex'),owner='org.uor.prismpm.construction-integrity',nonce=randomBytes(12).toString('hex');
 const initial=docker('ps','--all','--format','{{.Names}}');assert.equal(initial.status,0);assert(!initial.stdout.split(/\r?\n/).includes(name));
 fs.mkdirSync(out,{mode:0o700});
 const selected=path=>cp.execFileSync('git',['--no-replace-objects','show',selection.expected.revision+':'+path],{env,timeout:10000,maxBuffer:1024**2});
 const standards=selected('standards.lock'),workflow=selected('.github/workflows/sdk-candidate.yml');
 assert(workflow.length>0&&workflow.length<=262144);
 fs.writeFileSync(out+'/source-standards.lock',standards,{flag:'wx',mode:0o444});
 fs.writeFileSync(out+'/source-workflow.yml',workflow,{flag:'wx',mode:0o444});
 const files=['.github/workflows/sdk-candidate.yml',...['observe','acquire','provider','metadata','archive','stage','handoff'].map(n=>'scripts/sdk-construction-'+n+'.mjs'),
  'scripts/sdk-candidate.mjs','scripts/sdk-candidate-sbom.mjs'];
 const inputs=files.map(path=>({path,sha256:sha(fs.readFileSync(root+'/'+path))}));
 const command=['run','--interactive','--rm','--init','--name',name,'--label',owner+'='+nonce,'--user',`${process.getuid()}:${process.getgid()}`,
  '--cpus','1','--memory','512m','--memory-swap','512m','--pids-limit','128','--network','bridge','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
  '--mount',`type=bind,source=${root},target=/source,readonly`,'--mount',`type=bind,source=${out}/source-standards.lock,target=/standards.lock,readonly`,
  '--mount',`type=bind,source=${out}/source-workflow.yml,target=/workflow.yml,readonly`,
  '--mount',`type=bind,source=${out},target=/evidence`,'--workdir','/source','--entrypoint','timeout',constructionObserverImage,
  '--signal=TERM','--kill-after=5s','5000s','node','scripts/sdk-construction-acquire.mjs',...args,'/standards.lock','/workflow.yml','/evidence/acquisition'];
 fs.writeFileSync(out+'/intent.json',JSON.stringify({selection,inputs,command,standards_sha256:sha(standards),workflow_sha256:sha(workflow),scope:'original artifact acquisition only; not installedSDK/fullVV/release acceptance'})+'\n',{flag:'wx'});
 const secret=await constructionCredential(process.stdin,deadline-performance.now());
 const log=fs.createWriteStream(out+'/docker.log',{flags:'wx'}),child=cp.spawn('docker',['--host','unix:///var/run/docker.sock',...command],{env,stdio:['pipe','pipe','pipe']});
 let observed=0,retained=0,failure,stopping=false,watchdog,killTimer,terminalTimer,settle,retirementDeadline;const cleanup=[];
 function stopOwned(reconcile=false){
  if(stopping&&!reconcile)return;stopping=true;const inspection=docker('inspect',name);
  if(inspection.status===0){
   let owned=false;try{owned=JSON.parse(inspection.stdout)[0].Config.Labels[owner]===nonce;}catch{}
   if(owned){const stopped=docker('stop','--time','5',name);cleanup.push({operation:'stop-owned',status:stopped.status,signal:stopped.signal});}
   else failure??=Error('owned-container identity changed; cleanup refused');
  }
  child.kill('SIGTERM');
 }
 const fail=error=>{
  failure??=error;
  if(!retirementDeadline){
   retirementDeadline=performance.now()+60000;
   killTimer=setTimeout(()=>child.kill('SIGKILL'),5000);
   terminalTimer=setTimeout(()=>settle?.({status:null,signal:null}),10000);
  }
  stopOwned();
 };
 process.stdout.on('error',fail);
 const handlers=['SIGINT','SIGTERM','SIGHUP'].map(signal=>[signal,()=>fail(Error('observer interrupted by '+signal))]);
 for(const [signal,handler]of handlers)process.on(signal,handler);
 log.on('error',fail);child.stdin.on('error',()=>fail(Error('credential input transport failed')));
 child.stdin.end(secret,()=>secret.fill(0));
 for(const stream of[child.stdout,child.stderr]){
  stream.on('error',fail);stream.on('data',b=>{observed+=b.length;const n=Math.max(0,Math.min(b.length,1024**2-retained));
   if(n&&!log.destroyed){try{log.write(b.subarray(0,n));retained+=n;process.stdout.write(b.subarray(0,n));}catch(error){fail(error);}}
   if(observed>1024**2)fail(Error('observer output budget exceeded; prefix is diagnostic only'));
  });
 }
 const status=await new Promise(r=>{
  settle=r;child.on('error',e=>{fail(e);r({status:null,signal:null});});child.on('close',(status,signal)=>r({status,signal}));
  watchdog=setTimeout(()=>fail(Error('outer acquisition execution deadline exceeded')),Math.max(0,deadline-performance.now()));
 });
 clearTimeout(watchdog);clearTimeout(killTimer);clearTimeout(terminalTimer);secret.fill(0);
 if(performance.now()>deadline)failure??=Error('outer acquisition execution deadline exceeded');
 const cleanupDeadline=retirementDeadline??performance.now()+60000;
 log.end();let logTimer;try{await Promise.race([finished(log,{cleanup:true}),new Promise((_,reject)=>{logTimer=setTimeout(()=>{log.destroy();reject(Error('observer log closure uncertain'));},5000);})]);}catch(e){failure??=e;}finally{clearTimeout(logTimer);}
 for(const row of inputs){try{assert.equal(sha(fs.readFileSync(root+'/'+row.path)),row.sha256);}catch{failure??=Error('observer source custody changed');}}
 try{assert.deepEqual(fs.readFileSync(out+'/source-standards.lock'),standards);assert.deepEqual(fs.readFileSync(out+'/source-workflow.yml'),workflow);assert.equal(git('rev-parse','HEAD'),selection.qualifier);assert.equal(git('status','--porcelain'),'');}catch{failure??=Error('observer source/standards custody changed');}
 const absent=()=>{const p=docker('ps','--all','--format','{{.Names}}');return p.status===0&&!p.stdout.split(/\r?\n/).includes(name);};
 let removed=absent();if(!removed){failure??=Error('owned observer terminal absence not established');stopOwned(true);
  for(let i=0;i<5&&!removed;i++){await new Promise(r=>setTimeout(r,200));removed=absent();}}
 for(const [signal,handler]of handlers)process.off(signal,handler);
 process.stdout.off('error',fail);
 if(performance.now()>cleanupDeadline)failure??=Error('observer cleanup deadline exceeded');
 let logSha=null;try{logSha=sha(fs.readFileSync(out+'/docker.log'));}catch{failure??=Error('observer retained log unavailable');}
 let result,retention;
 try{
  assert.equal(status.status,0);assert.equal(status.signal,null);
  result=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readConstructionRetained(out+'/acquisition/completed.json',1024**2)));
  retention=verifyConstructionRetention(out+'/acquisition',result,{selection,inputs,standards,workflow});
 }catch{failure??=Error('complete acquisition receipt unavailable or invalid');}
 if(performance.now()>cleanupDeadline)failure??=Error('observer cleanup deadline exceeded');
 clearTimeout(watchdog);clearTimeout(killTimer);clearTimeout(terminalTimer);
 fs.writeFileSync(out+'/docker.json',JSON.stringify({...status,inputs,container_absent:removed,cleanup,observed_log_bytes:observed,retained_log_bytes:retained,
  log_sha256:logSha,retention,...(failure?{orchestration_failure:failure.message}:{})})+'\n',{flag:'wx'});
 if(failure)throw failure;
 console.log(JSON.stringify({scope:result.scope,container_absent:true,artifacts:selection.expected.artifact_ids}));
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
assert.equal(process.argv.length,5);
const selection=constructionSelectionJson(process.argv[2],process.argv[3]),v=selection.expected;
await observeConstruction([v.revision,String(v.run_id),String(v.run_attempt),String(v.artifact_ids.amd64),String(v.artifact_ids.arm64),selection.qualifier],process.argv[4]);
}
