// Read-only original artifact acquisition, never SDK or product acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {constants,openSync,readSync,closeSync,fstatSync,readFileSync,mkdirSync,writeFileSync} from 'node:fs';
import {join,resolve,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {constructionProvider} from './sdk-construction-provider.mjs';
import {readConstructionMetadata} from './sdk-construction-metadata.mjs';
import {validateConstructionAuthority,validateConstructionMetadata,composeConstructionIndex} from './sdk-construction-handoff.mjs';
import {verifyConstructionArchiveStream} from './sdk-construction-archive.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');

export function constructionSelection(args){
 assert(Array.isArray(args)&&args.length===6,'source run attempt amd64-artifact arm64-artifact qualifier-source required');
 const [revision,run,attempt,amd64,arm64,qualifier]=args;
 for(const oid of[revision,qualifier])assert(typeof oid==='string'&&/^[a-f0-9]{40}$/.test(oid),'exact source revision required');
 const id=value=>{assert(typeof value==='string'&&/^[1-9][0-9]*$/.test(value));const n=Number(value);assert(Number.isSafeInteger(n));return n;};
 const expected={revision,run_id:id(run),run_attempt:id(attempt),artifact_ids:{amd64:id(amd64),arm64:id(arm64)}};
 assert.notEqual(expected.artifact_ids.amd64,expected.artifact_ids.arm64);return {expected,qualifier};
}
export function constructionSelectionJson(text,qualifier){
 assert(typeof text==='string'&&Buffer.byteLength(text)<=16384,'bounded closed selection JSON required');
 const value=JSON.parse(text);assert(value&&typeof value==='object'&&!Array.isArray(value));
 assert.deepEqual(Object.keys(value).sort(),['artifact_ids','revision','run_attempt','run_id']);
 assert.deepEqual(Object.keys(value.artifact_ids).sort(),['amd64','arm64']);
 for(const id of[value.run_id,value.run_attempt,...Object.values(value.artifact_ids)])assert(Number.isSafeInteger(id)&&id>0);
 return constructionSelection([value.revision,String(value.run_id),String(value.run_attempt),String(value.artifact_ids.amd64),String(value.artifact_ids.arm64),qualifier]);
}
function credential(){
 const buffer=Buffer.alloc(1024);let offset=0;
 while(offset<buffer.length){const n=readSync(0,buffer,offset,buffer.length-offset,null);if(!n)break;offset+=n;}
 assert(offset<buffer.length,'bounded credential input required');const token=new TextDecoder('utf-8',{fatal:true}).decode(buffer.subarray(0,offset)).trim();
 buffer.fill(0);return token;
}
function standardsBytes(path){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{const stat=fstatSync(fd);assert(stat.isFile()&&stat.size>0&&stat.size<=1024**2);const bytes=readFileSync(fd);assert.equal(bytes.length,stat.size);return bytes;}finally{closeSync(fd);}
}
export async function acquireConstruction(selection,standardsPath,workflowPath,destination,token){
 const {expected,qualifier}=constructionSelection([selection.expected.revision,String(selection.expected.run_id),String(selection.expected.run_attempt),
  String(selection.expected.artifact_ids.amd64),String(selection.expected.artifact_ids.arm64),selection.qualifier]);
 const out=resolve(destination);mkdirSync(out,{mode:0o700});
 const source=dirname(fileURLToPath(import.meta.url)),runtimeFiles=['sdk-construction-acquire.mjs','sdk-construction-provider.mjs','sdk-construction-metadata.mjs',
  'sdk-construction-archive.mjs','sdk-construction-stage.mjs','sdk-construction-handoff.mjs','sdk-candidate.mjs','sdk-candidate-sbom.mjs'];
 const inputs=runtimeFiles.map(path=>({path,sha256:sha(readFileSync(join(source,path)))}));
 const originalStandards=standardsBytes(standardsPath),originalWorkflow=standardsBytes(workflowPath),provider=constructionProvider(token);let sequence=0,failure,result,cleanup;
 const write=(path,bytes)=>{writeFileSync(join(out,path),bytes,{flag:'wx',mode:0o444});return {path,bytes:bytes.length,sha256:sha(bytes)};};
 const retained=[];
 try{
  const retain=bytes=>{const row=write(`provider-${String(++sequence).padStart(2,'0')}.json`,bytes);retained.push(row);console.log(JSON.stringify(row));};
  const before=await provider.authority(expected.run_id,retain),authority=validateConstructionAuthority(Buffer.from(JSON.stringify(before)),expected,Date.now(),originalWorkflow);
  write('source-standards.lock',originalStandards);
  write('source-workflow.yml',originalWorkflow);
  const metadataDeadline=performance.now()+900000,lanes=[];
  for(const [arch,id]of Object.entries(expected.artifact_ids)){
   const artifact=before.artifacts.find(a=>a.id===id),transport=provider.artifact(id,artifact.size_in_bytes);
   const metadata=await readConstructionMetadata(artifact.size_in_bytes,transport.range,Math.floor(metadataDeadline-performance.now()));
   const members=metadata.members,record=members.get('construction.json'),files=new Map([...members].filter(([p])=>p!=='construction.json'));
   const handle=validateConstructionMetadata(authority,arch,record,files,originalStandards);
   mkdirSync(join(out,arch),{mode:0o700});mkdirSync(join(out,arch,'evidence'),{mode:0o700});
   const rows=[...members].map(([path,bytes])=>write(arch+'/'+path,bytes));
   lanes.push({arch,id,artifact,transport,members,record:JSON.parse(record),handle,metadata:{selected_bytes:metadata.selected_bytes,range_calls:metadata.range_calls,files:rows}});
  }
  const index=composeConstructionIndex(lanes[0].handle,lanes[1].handle);write('composed-unqualified-index.json',index.bytes);
  const results=[];
  for(const lane of lanes){
   const started=new Date().toISOString(),stream=await lane.transport.stream();let observed=0;
   stream.on('data',b=>{observed+=b.length;});stream.pause();
   const progress=setInterval(()=>console.log(JSON.stringify({architecture:lane.arch,observed_bytes:observed,scope:'incomplete original stream progress only'})),30000);
   let integrity;try{
    integrity=await verifyConstructionArchiveStream(stream,{artifact:{byte_length:lane.artifact.size_in_bytes,digest:lane.artifact.digest},
     archive:{byte_length:lane.record.archive.byte_length,digest:lane.record.archive.digest},members:lane.members});assert(stream.complete);
   }finally{clearInterval(progress);stream.destroy();}
   const receipt={source:expected.revision,qualifier_source:qualifier,run_id:expected.run_id,run_attempt:expected.run_attempt,
    architecture:lane.arch,artifact_id:lane.id,started,completed:new Date().toISOString(),metadata:lane.metadata,...integrity};
   const row=write('original-'+lane.arch+'-integrity.json',Buffer.from(JSON.stringify(receipt)+'\n'));results.push(row);console.log(JSON.stringify(row));
  }
  const after=await provider.authority(expected.run_id,retain);validateConstructionAuthority(Buffer.from(JSON.stringify(after)),expected,Date.now(),originalWorkflow);
  for(const id of Object.values(expected.artifact_ids)){
   const a=before.artifacts.find(a=>a.id===id),b=after.artifacts.find(a=>a.id===id);
   for(const key of['id','name','size_in_bytes','digest','created_at','expires_at'])assert.equal(a[key],b[key]);
  }
  assert.deepEqual(standardsBytes(standardsPath),originalStandards,'source standards custody changed');
  assert.deepEqual(standardsBytes(workflowPath),originalWorkflow,'source workflow custody changed');
  for(const row of inputs)assert.equal(sha(readFileSync(join(source,row.path))),row.sha256,'acquirer source custody changed');
  result={scope:'authenticated original ZIP/OCI/blob integrity only; no expanded filesystem, registry, installed SDK, fullVV, release or product acceptance',
   expected,qualifier_source:qualifier,inputs,standards_sha256:sha(originalStandards),workflow_sha256:sha(originalWorkflow),original_provider_responses:retained,results,
   composed_index_digest:index.digest,archives_stored:false};
 }catch(error){failure=error;}
 try{cleanup=await provider.close();}catch(error){failure=failure?new AggregateError([failure,error],'acquisition and provider cleanup failed'):error;}
 try{
  const memory=Object.fromEntries(['memory.current','memory.peak','memory.events','memory.swap.current','memory.swap.peak','memory.swap.events']
   .map(k=>[k,readFileSync('/sys/fs/cgroup/'+k,'utf8')]));write('resource-terminal.json',Buffer.from(JSON.stringify({memory,cleanup})+'\n'));
 }catch(error){failure=failure?new AggregateError([failure,error],'acquisition and resource observation failed'):error;}
 if(failure){write('failed.json',Buffer.from(JSON.stringify({scope:'incomplete acquisition not acceptance',reason:String(failure.message).slice(0,2048),cleanup})+'\n'));throw failure;}
 write('completed.json',Buffer.from(JSON.stringify({...result,cleanup})+'\n'));return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 const selection=constructionSelection(process.argv.slice(2,8));assert.equal(process.argv.length,11);
 await acquireConstruction(selection,process.argv[8],process.argv[9],process.argv[10],credential());
}
