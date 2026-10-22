// Internal bootstrap admission only. Metadata and a composed OCI index do not
// qualify archives, installed SDKs, full VV, publication, or a product.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {validateConfig,validateEvidence} from './sdk-candidate.mjs';

const repository='UOR-Foundation/PrismPM';
const names=['authority-result.json','candidate.json','cli.json','config.json','digest.txt',
 'inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'];
const unclaimed=['full-vv','installed-dual-native-sdk-qualification','signing','release','product-readiness'];
const imageType='application/vnd.oci.image.manifest.v1+json';
const checkout='actions/checkout@11d5960a326750d5838078e36cf38b85af677262';
const node='actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38';
const buildx='docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f';
const nativeSteps=['Set up job','Validate immutable construction input',`Run ${checkout}`,`Run ${node}`,`Run ${buildx}`,
 'Install the exact OCI transport','Construct the exact native SDK without publication',
 'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
 `Post Run ${buildx}`,`Post Run ${node}`,`Post Run ${checkout}`,'Complete job'];
const metadataLimit=96*1024**2;
// Independently selected source workflow bytes, not the provider's returned
// job count, decide the complete inventory. Unknown workflows fail closed.
const workflowProfiles=new Map([
 ['sha256:50d8165fbab57b4022c0475d3cb9b80ad63ba1644bc7182089b1525f5f920043',6],
 ['sha256:bbfbd47a2ec3131cb00912c496f8c627e48f6e067937b9042f241764beb38a15',7],
 // Current source-reviewed candidate workflow.  Keep historical profiles
 // above immutable; a new workflow is admitted only by this exact digest.
 ['sha256:ed952dbab6305ff49d8d1a3c19376049567455b73b6e673a01d72c43904d1f96',7]
]);
const authorities=new WeakMap(),metadata=new WeakMap();
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const keys=(value,expected)=>{assert(value&&typeof value==='object'&&!Array.isArray(value));assert.deepEqual(Object.keys(value).sort(),expected.slice().sort());};
const positive=value=>assert(Number.isSafeInteger(value)&&value>0);
const digest=value=>assert.match(value,/^sha256:[0-9a-f]{64}$/);
const json=(bytes,limit)=>{
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=limit,'bounded original metadata bytes required');
 return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
};
const descriptor=value=>{digest(value.digest);positive(value.size);assert(value.size<=64*1024**3);};
const timestamp=value=>{
 assert.equal(typeof value,'string');assert.match(value,/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/);
 const time=Date.parse(value);assert(Number.isSafeInteger(time),'valid provider timestamp required');
 assert.equal(new Date(time).toISOString(),value.replace(/(?:\.(\d{1,3}))?Z$/,(_,fraction)=>'.'+(fraction??'').padEnd(3,'0')+'Z'),
  'provider timestamp cannot normalize an invalid calendar date');return time;
};
function completeSteps(job,expected,runStart,runEnd,declared=expected.length){
 const start=timestamp(job.started_at),end=timestamp(job.completed_at);
 assert(runStart<=start&&start<=end&&end<=runEnd,'ordered current-attempt job timestamps required');
 assert.deepEqual(job.steps.map(s=>s.name),expected,'complete ordered original job steps required');
 let previousNumber=0,previousTime=start;
 for(const [i,step]of job.steps.entries()){
  positive(step.number);assert(step.number>previousNumber);
  // The runner reserves internal post-action numbers. Pin declared-step
  // numbers, but do not mistake its genuine post-action gaps for skipped tests.
  if(i<declared)assert.equal(step.number,i+1);
  assert.equal(step.status,'completed');assert.equal(step.conclusion,'success');
  const first=timestamp(step.started_at),last=timestamp(step.completed_at);
  assert(previousTime<=first&&first<=last&&last<=end,'ordered original step timestamps required');
  previousNumber=step.number;previousTime=last;
 }
}

// The caller must acquire these original provider responses through the fixed
// authenticated GitHub endpoint and preserve them. Expected IDs/revision/attempt
// are independently selected inputs, never inferred from a latest/name lookup.
export function validateConstructionAuthority(bytes,expected,now,workflowBytes){
 assert(Buffer.isBuffer(workflowBytes)&&workflowBytes.length>0&&workflowBytes.length<=262144,'independently selected source workflow bytes required');
 const jobCount=workflowProfiles.get(sha(workflowBytes));assert(jobCount,'unreviewed source workflow profile');
 keys(expected,['revision','run_id','run_attempt','artifact_ids']);
 assert.match(expected.revision,/^[0-9a-f]{40}$/);positive(expected.run_id);positive(expected.run_attempt);
 keys(expected.artifact_ids,['amd64','arm64']);for(const id of Object.values(expected.artifact_ids))positive(id);
 assert.notEqual(expected.artifact_ids.amd64,expected.artifact_ids.arm64);
 assert(Number.isSafeInteger(now)&&now>0,'independent current time required');
 const value=json(bytes,16*1024**2);keys(value,['run','jobs','artifacts']);
 const {run,jobs,artifacts}=value,source=expected.revision;
 assert.equal(run.repository.full_name,repository);assert.equal(run.head_repository.full_name,repository);
 positive(run.repository.id);assert.equal(run.head_repository.id,run.repository.id);
 assert.equal(run.id,expected.run_id);assert.equal(run.run_attempt,expected.run_attempt);
 assert.equal(run.head_sha,source);assert.equal(run.path,'.github/workflows/sdk-candidate.yml');
 assert.equal(run.event,'workflow_dispatch');assert.equal(run.status,'completed');assert.equal(run.conclusion,'success');
 const created=timestamp(run.created_at),started=timestamp(run.run_started_at),ended=timestamp(run.updated_at);
 assert(created<=started&&started<=ended&&ended<=now,'completed provider run cannot be future or unordered');
 assert(Array.isArray(jobs)&&jobs.length===jobCount,'complete original no-publication construction job inventory required');
 assert.equal(new Set(jobs.map(j=>j.id)).size,jobs.length);
 const expectedJobs=new Map([['input-policy','success'],['policy','skipped'],['build','skipped'],['publish','skipped'],
  ['Unpublished native SDK construction (amd64)','success'],['Unpublished native SDK construction (arm64)','success']]);
 // Older source workflows have six jobs. The additive read-only integrity
 // owner must be skipped during genuine construction; no arbitrary job or
 // successful integrity-only run can substitute for either native builder.
 if(jobCount===7)expectedJobs.set('construction-integrity','skipped');
 for(const job of jobs){
  positive(job.id);assert.equal(job.run_id,run.id);assert.equal(job.run_attempt,run.run_attempt);
  assert.equal(job.head_sha,source);assert(expectedJobs.has(job.name),'unexpected or duplicate construction job');
  assert.equal(job.status,'completed');assert.equal(job.conclusion,expectedJobs.get(job.name));expectedJobs.delete(job.name);
 }
 assert.equal(expectedJobs.size,0);
 const policy=jobs.find(j=>j.name==='input-policy');
 completeSteps(policy,['Set up job','Reject ambiguous construction and publication requests','Complete job'],started,ended);
 const selected={};assert(Array.isArray(artifacts)&&artifacts.length===2);
 for(const arch of ['amd64','arm64']){
  const job=jobs.find(j=>j.name===`Unpublished native SDK construction (${arch})`);
  assert.deepEqual(job.labels,[arch==='amd64'?'ubuntu-24.04':'ubuntu-24.04-arm']);
  assert.equal(job.runner_group_name,'GitHub Actions');
  assert(Array.isArray(job.steps));completeSteps(job,nativeSteps,started,ended,8);
  assert(timestamp(policy.completed_at)<=timestamp(job.started_at),'native construction must follow successful input policy');
  const found=artifacts.filter(a=>a.id===expected.artifact_ids[arch]);assert.equal(found.length,1);
  const a=found[0];assert.equal(a.name,`unpublished-sdk-construction-${arch}-${source}`);
  assert.equal(a.expired,false);assert(timestamp(a.expires_at)>now);
  positive(a.size_in_bytes);assert(a.size_in_bytes<=64*1024**3+96*1024**2);digest(a.digest);
  assert.equal(a.workflow_run.id,run.id);assert.equal(a.workflow_run.head_sha,source);
  assert.equal(a.workflow_run.repository_id,run.repository.id);assert.equal(a.workflow_run.head_repository_id,run.repository.id);
  const uploaded=timestamp(a.created_at),upload=job.steps[7];
  assert(timestamp(upload.started_at)<=uploaded&&uploaded<=timestamp(upload.completed_at),
   'artifact must originate inside the selected attempt\'s actual upload window');
  selected[arch]={id:a.id,name:a.name,byte_length:a.size_in_bytes,digest:a.digest};
 }
 const handle=Object.freeze({scope:'provider-response-metadata-only-not-authentication',source_revision:source,
  run_id:run.id,run_attempt:run.run_attempt,provider_metadata_digest:sha(bytes)});
 authorities.set(handle,{source,run:run.id,attempt:run.run_attempt,selected});return handle;
}

export function validateConstructionMetadata(authority,arch,constructionBytes,files,standardsBytes){
 const admitted=authorities.get(authority);assert(admitted,'original admitted authority handle required');
 assert(['amd64','arm64'].includes(arch));assert(files instanceof Map);
 assert.deepEqual([...files.keys()].sort(),names.map(n=>'evidence/'+n).sort());
 assert(Buffer.isBuffer(standardsBytes),'independently selected exact-source standards bytes required');
 assert(Buffer.isBuffer(constructionBytes),'original construction bytes required');let total=constructionBytes.length;
 for(const bytes of files.values()){
  assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024**2);
  total+=bytes.length;assert(total<=metadataLimit,'96 MiB aggregate construction metadata budget exceeded');
 }
 const record=json(constructionBytes,65536);
 keys(record,['schema','scope','workflow_revision','source_revision','run_id','run_attempt','platform','archive','smoke','manifest','smoke_evidence','unclaimed']);
 assert.equal(record.schema,'prismpm/unpublished-sdk-construction/1');assert.equal(record.scope,'construction-only-not-acceptance');
 assert.equal(record.workflow_revision,admitted.source);assert.equal(record.source_revision,admitted.source);
 assert.equal(record.run_id,String(admitted.run));assert.equal(record.run_attempt,String(admitted.attempt));
 assert.equal(record.platform,'linux/'+arch);assert.deepEqual(record.unclaimed,unclaimed);
 assert.deepEqual(record.smoke,{status:0,signal:null,archive_binding:'held-descriptor-before-and-after'});
 keys(record.archive,['path','byte_length','digest']);assert.equal(record.archive.path,'sdk.oci.tar');
 positive(record.archive.byte_length);assert(record.archive.byte_length<=64*1024**3);digest(record.archive.digest);
 keys(record.manifest,['digest','byte_length']);digest(record.manifest.digest);positive(record.manifest.byte_length);
 assert(Array.isArray(record.smoke_evidence)&&record.smoke_evidence.length===names.length);
 const seen=new Set();
 for(const row of record.smoke_evidence){
  keys(row,['path','byte_length','digest']);assert(files.has(row.path)&&!seen.has(row.path));seen.add(row.path);
  const bytes=files.get(row.path);assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024**2);
  assert.equal(row.byte_length,bytes.length);assert.equal(row.digest,sha(bytes));
 }
 assert.deepEqual(files.get('evidence/standards.lock'),standardsBytes,'exact-source standards must match');
 const parsed=new Map([...files].filter(([path])=>path!=='evidence/digest.txt').map(([path,bytes])=>[path,
  json(bytes,path==='evidence/candidate.json'?65536:['evidence/manifest.json','evidence/config.json'].includes(path)?4*1024**2:64*1024**2)]));
 const cli=parsed.get('evidence/cli.json');assert.equal(cli.schema,'prismpm/completion-result/1');
 assert.equal(cli.shell,'bash');assert.equal(typeof cli.script,'string');assert(cli.script.length>0&&cli.script.length<=65536);
 const model=parsed.get('evidence/model-check.json');assert.equal(model.schema,'prismpm/check-result/1');
 for(const field of ['model_id','semantic_id','snapshot_id'])assert.match(model[field],/^[0-9a-f]{64}$/);
 const inventory=parsed.get('evidence/inventory.json');assert.equal(inventory.schema,'prismpm/sdk-inventory/1');
 assert(Array.isArray(inventory.commands)&&inventory.commands.length>0&&Array.isArray(inventory.artifacts)&&inventory.artifacts.length>0);
 const tamper=parsed.get('evidence/tamper.json');assert.equal(tamper.schema,'prismpm/error-result/1');
 assert.equal(tamper.diagnostic.code,'PP5401');
 const manifestBytes=files.get('evidence/manifest.json'),configBytes=files.get('evidence/config.json');
 assert.equal(record.manifest.byte_length,manifestBytes.length);assert.equal(record.manifest.digest,sha(manifestBytes));
 assert.equal(files.get('evidence/digest.txt').toString(),record.manifest.digest+'\n');
 const manifest=parsed.get('evidence/manifest.json'),config=parsed.get('evidence/config.json');
 assert.equal(manifest.schemaVersion,2);assert.equal(manifest.mediaType,imageType);
 descriptor(manifest.config);assert.equal(manifest.config.mediaType,'application/vnd.oci.image.config.v1+json');
 assert.equal(manifest.config.digest,sha(configBytes));assert.equal(manifest.config.size,configBytes.length);
 assert(Array.isArray(manifest.layers)&&manifest.layers.length<=256);
 let compressed=0;
 for(const layer of manifest.layers){
  descriptor(layer);assert(['application/vnd.oci.image.layer.v1.tar','application/vnd.oci.image.layer.v1.tar+gzip',
   'application/vnd.oci.image.layer.v1.tar+zstd'].includes(layer.mediaType));
  assert.equal(layer.urls,undefined,'external blob redirects are not an unpublished artifact');compressed+=layer.size;
 }
 assert(Number.isSafeInteger(compressed)&&compressed<=64*1024**3);assert.equal(manifest.config.urls,undefined);
 validateConfig(config,arch,admitted.source);
 validateEvidence(parsed.get('evidence/candidate.json'),arch,admitted.source,record.manifest.digest,
  files.get('evidence/inventory.json'),standardsBytes,files.get('evidence/authority-result.json'));
 const handle=Object.freeze({scope:'construction-metadata-only-not-archive-or-sdk-acceptance',architecture:arch,
  source_revision:admitted.source,construction_digest:sha(constructionBytes),manifest_digest:record.manifest.digest});
 metadata.set(handle,{authority,arch,manifest:{mediaType:imageType,digest:record.manifest.digest,size:manifestBytes.length,
  platform:{os:'linux',architecture:arch}},archive:{...record.archive},artifact:{...admitted.selected[arch]}});
 return handle;
}

export function composeConstructionIndex(amd64,arm64){
 const a=metadata.get(amd64),b=metadata.get(arm64);assert(a&&b,'original admitted metadata handles required');
 assert.equal(a.arch,'amd64');assert.equal(b.arch,'arm64');assert.equal(a.authority,b.authority,'same exact construction run/attempt required');
 assert.notEqual(a.manifest.digest,b.manifest.digest,'native images must be distinct');
 const bytes=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[a.manifest,b.manifest]})+'\n');
 return {scope:'composed-index-only-not-registry-or-installed-qualification',bytes,digest:sha(bytes)};
}
