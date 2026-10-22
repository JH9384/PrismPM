// Unpublished construction provenance, never installed SDK or release acceptance.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {closeSync,constants,fstatSync,lstatSync,openSync,opendirSync,readSync,realpathSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {performance} from 'node:perf_hooks';
import {validateConfig,validateEvidence} from './sdk-candidate.mjs';

const names=['authority-result.json','candidate.json','cli.json','config.json','digest.txt','inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'];
const fields=['dev','ino','uid','gid','mode','size','mtimeNs','ctimeNs'];
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const identity=stat=>Object.fromEntries(fields.map(key=>[key,stat[key].toString()]));

function inventory(path,expected){
 const directory=opendirSync(path),seen=[];
 try{
  for(;;){
   const entry=directory.readSync();if(!entry)break;
   assert(seen.length<expected.length&&expected.includes(entry.name),'unexpected construction member');
   seen.push(entry.name);
  }
 }finally{directory.closeSync();}
 assert.deepEqual(seen.sort(),expected);
}
function directory(path){
 const stat=lstatSync(path,{bigint:true});
 assert(stat.isDirectory()&&realpathSync(path)===path,'non-aliased evidence directories required');
 return identity(stat);
}
function captureDescriptor(fd,path,limit,retain=false){
 const before=fstatSync(fd,{bigint:true});
 assert(before.isFile()&&before.nlink===1n&&before.size>0n&&before.size<=BigInt(limit),'bounded non-aliased regular evidence required');
 const hash=createHash('sha256'),buffer=Buffer.alloc(1024*1024),chunks=[],start=performance.now();let bytes=0;
 for(;;){
  assert(performance.now()-start<=120000,'construction evidence read exceeded its bound');
  const count=readSync(fd,buffer,0,buffer.length,bytes);if(!count)break;
  bytes+=count;assert(bytes<=limit);hash.update(buffer.subarray(0,count));
  if(retain)chunks.push(Buffer.from(buffer.subarray(0,count)));
 }
 assert.equal(BigInt(bytes),before.size);
 for(const after of [fstatSync(fd,{bigint:true}),lstatSync(path,{bigint:true})]){
  assert(after.isFile()&&after.nlink===1n);
  assert.deepEqual(identity(after),identity(before),'construction evidence changed while reading');
 }
 return {byte_length:bytes,digest:'sha256:'+hash.digest('hex'),identity:identity(before),...(retain?{bytes:Buffer.concat(chunks)}:{})};
}
function capture(path,limit,retain=false){
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{return captureDescriptor(fd,path,limit,retain);}finally{closeSync(fd);}
}
const smoke=(program,args,environment)=>spawnSync(program,args,{env:environment,stdio:'inherit'});

// Failed construction only. Known public smoke fixtures contain no user data;
// omit command/environment/payload/details and never issue a success receipt.
function failureContext(evidence){
 const results=[];
 try{directory(evidence);}catch{return {scope:'failure-diagnostics-only',results};}
 for(const name of ['cli.json','authority-result.json','model-check.json']){
  try{
   const row=capture(join(evidence,name),64*1024,true);
   const value=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(row.bytes));
   if(value?.schema!=='prismpm/error-result/1'||!/^PP[0-9]{4}$/.test(value.diagnostic?.code)
    ||typeof value.diagnostic?.message!=='string'||value.diagnostic.message.length>2048)continue;
   results.push({path:name,byte_length:row.byte_length,digest:row.digest,
    code:value.diagnostic.code,message:value.diagnostic.message});
  }catch{/* Missing, malformed, oversized or aliased output cannot explain the failure. */}
 }
 return {scope:'failure-diagnostics-only',results};
}

// The optional transport is for filesystem unit tests; the CLI always executes
// the unchanged real smoke command against this process's held archive descriptor.
export function constructionRecord(location,environment,transport=smoke){
 const source=environment.SOURCE_REVISION,workflow=environment.GITHUB_WORKFLOW_SHA,arch=environment.ARCHITECTURE;
 assert.match(source,/^[0-9a-f]{40}$/);assert.equal(workflow,source,'workflow and constructed source revisions must match');
 assert.equal(environment.GITHUB_REPOSITORY,'UOR-Foundation/PrismPM');assert.equal(environment.GITHUB_EVENT_NAME,'workflow_dispatch');
 for(const key of ['GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT'])assert.match(environment[key],/^[1-9][0-9]{0,19}$/);
 assert.equal(process.platform,'linux');assert(['amd64','arm64'].includes(arch));
 assert.equal(process.arch,arch==='amd64'?'x64':'arm64','native process architecture required');
 const root=resolve(location),evidence=join(root,'evidence'),archive=join(root,'sdk.oci.tar');
 const originalRoot=directory(root);inventory(root,['sdk.oci.tar']);
 const fd=openSync(archive,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const original=captureDescriptor(fd,archive,64*1024**3);
  const outcome=transport('/bin/bash',[fileURLToPath(new URL('./sdk-candidate.sh',import.meta.url)),
   'smoke',`/proc/${process.pid}/fd/${fd}`,arch,source,evidence],environment);
  assert.ifError(outcome.error);assert.equal(outcome.signal,null);
  if(outcome.status!==0)assert.equal(outcome.status,0,'actual SDK construction smoke failed: '+JSON.stringify(failureContext(evidence)));
  const rootIdentity=directory(root),evidenceIdentity=directory(evidence);
  // Smoke creates evidence, so the root's size/timestamps legitimately change.
  for(const key of ['dev','ino','uid','gid','mode'])assert.equal(rootIdentity[key],originalRoot[key],'construction root replaced during smoke');
  inventory(root,['evidence','sdk.oci.tar']);inventory(evidence,names);
  const captures=names.map(path=>({path:'evidence/'+path,...capture(join(evidence,path),64*1024**2,true)}));
  const bytes=path=>captures.find(row=>row.path==='evidence/'+path).bytes;
  const manifest=JSON.parse(bytes('manifest.json')),config=JSON.parse(bytes('config.json')),candidate=JSON.parse(bytes('candidate.json'));
  const digest=sha(bytes('manifest.json'));assert.equal(bytes('digest.txt').toString(),digest+'\n');
  assert.equal(manifest.schemaVersion,2);assert.equal(manifest.mediaType,'application/vnd.oci.image.manifest.v1+json');
  assert.equal(manifest.config.digest,sha(bytes('config.json')));assert.equal(manifest.config.size,bytes('config.json').length);
  validateConfig(config,arch,source);
  validateEvidence(candidate,arch,source,digest,bytes('inventory.json'),bytes('standards.lock'),bytes('authority-result.json'));
  assert.deepEqual(captureDescriptor(fd,archive,64*1024**3),original,'the smoked archive changed before handoff');
  for(const row of captures){
   const stat=lstatSync(join(root,row.path),{bigint:true});assert(stat.isFile()&&stat.nlink===1n);
   assert.deepEqual(identity(stat),row.identity,'earlier smoke evidence changed before handoff');
  }
  inventory(root,['evidence','sdk.oci.tar']);inventory(evidence,names);
  assert.deepEqual(directory(root),rootIdentity);assert.deepEqual(directory(evidence),evidenceIdentity);
  for(const stat of [fstatSync(fd,{bigint:true}),lstatSync(archive,{bigint:true})]){
   assert(stat.isFile()&&stat.nlink===1n);assert.deepEqual(identity(stat),original.identity,'archive changed during the final evidence sweep');
  }
  const archiveRecord={byte_length:original.byte_length,digest:original.digest};
  return {schema:'prismpm/unpublished-sdk-construction/1',scope:'construction-only-not-acceptance',
   workflow_revision:workflow,source_revision:source,run_id:environment.GITHUB_RUN_ID,run_attempt:environment.GITHUB_RUN_ATTEMPT,
   platform:'linux/'+arch,archive:{path:'sdk.oci.tar',...archiveRecord},
   smoke:{status:0,signal:null,archive_binding:'held-descriptor-before-and-after'},
   manifest:{digest,byte_length:bytes('manifest.json').length},
   smoke_evidence:captures.map(({bytes,identity,...row})=>row),
   unclaimed:['full-vv','installed-dual-native-sdk-qualification','signing','release','product-readiness']};
 }finally{closeSync(fd);}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 assert.equal(process.argv.length,3,'usage: sdk-construction-record.mjs CONSTRUCTION_DIRECTORY');
 const value=constructionRecord(process.argv[2],process.env);
 writeFileSync(join(resolve(process.argv[2]),'construction.json'),JSON.stringify(value)+'\n',{flag:'wx',mode:0o444});
}
