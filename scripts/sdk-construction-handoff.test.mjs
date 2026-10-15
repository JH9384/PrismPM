// Synthetic metadata tests admission only, never SDK execution or qualification.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {validateConstructionAuthority,validateConstructionMetadata,composeConstructionIndex} from './sdk-construction-handoff.mjs';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const bytes=v=>Buffer.from(JSON.stringify(v));
const now=Date.parse('2026-10-08T00:00:00Z');
function fixture(runId=123,attempt=1){
 const source='a'.repeat(40),expected={revision:source,run_id:runId,run_attempt:attempt,artifact_ids:{amd64:12,arm64:13}};
 const run={repository:{id:1,full_name:'UOR-Foundation/PrismPM'},head_repository:{id:1,full_name:'UOR-Foundation/PrismPM'},
  id:runId,run_attempt:attempt,head_sha:source,path:'.github/workflows/sdk-candidate.yml',event:'workflow_dispatch',status:'completed',conclusion:'success',
  created_at:'2026-10-07T00:58:00Z',run_started_at:'2026-10-07T00:59:00Z',updated_at:'2026-10-07T01:02:00Z'};
 // Original declared workflow steps followed by genuine runner post-action gaps.
 const native=['Set up job','Validate immutable construction input',
  'Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262',
  'Run actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  'Run docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
  'Install the exact OCI transport','Construct the exact native SDK without publication',
  'Run actions/upload-artifact@ea165f8d65b6e75b540449e92b4886f43607fa02',
  'Post Run docker/setup-buildx-action@8d2750c68a42422c14e847fe6c8ac0403b4cbd6f',
  'Post Run actions/setup-node@249970729cb0ef3589644e2896645e5dc5ba9c38',
  'Post Run actions/checkout@11d5960a326750d5838078e36cf38b85af677262','Complete job'];
 const steps=names=>names.map((name,i)=>({name,number:i<8?i+1:i+6,status:'completed',conclusion:'success',
  started_at:`2026-10-07T01:00:${String(i).padStart(2,'0')}Z`,completed_at:`2026-10-07T01:00:${String(i+1).padStart(2,'0')}Z`}));
 const jobs=['input-policy','policy','build','publish','Unpublished native SDK construction (amd64)','Unpublished native SDK construction (arm64)']
  .map((name,i)=>({id:i+1,run_id:runId,run_attempt:attempt,head_sha:source,name,status:'completed',
   conclusion:['policy','build','publish'].includes(name)?'skipped':'success',labels:[name.endsWith('(arm64)')?'ubuntu-24.04-arm':'ubuntu-24.04'],
   runner_group_name:'GitHub Actions',started_at:'2026-10-07T01:00:00Z',completed_at:'2026-10-07T01:01:00Z',
   steps:steps(name==='input-policy'?['Set up job','Reject ambiguous construction and publication requests','Complete job']:native)}));
 jobs[0].started_at='2026-10-07T00:59:00Z';jobs[0].completed_at='2026-10-07T00:59:03Z';
 for(const s of jobs[0].steps){s.started_at=s.started_at.replace('T01:00:','T00:59:');s.completed_at=s.completed_at.replace('T01:00:','T00:59:');}
 const artifacts=['amd64','arm64'].map(arch=>({id:expected.artifact_ids[arch],name:`unpublished-sdk-construction-${arch}-${source}`,
  expired:false,created_at:'2026-10-07T01:00:08Z',expires_at:'2026-10-15T00:00:00Z',size_in_bytes:20000,digest:sha(Buffer.from('unit-only ZIP '+arch)),
  workflow_run:{id:runId,head_sha:source,repository_id:1,head_repository_id:1}}));
 const authority={run,jobs,artifacts};
 const standards=bytes({schema:'prismpm/standards-lock/1',authorities:[],oracles:[]});
 function lane(arch){
  const config=bytes({os:'linux',architecture:arch,config:{Labels:{'org.opencontainers.image.revision':source,
   'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM','org.opencontainers.image.version':'0.3.0',
   'org.opencontainers.image.created':'1970-01-01T00:00:00Z'}}});
  const manifest=bytes({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',
   config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:sha(config),size:config.length},layers:[{
    mediaType:'application/vnd.oci.image.layer.v1.tar+gzip',digest:sha(Buffer.from('unit-only layer '+arch)),size:100} ]});
  const inventory=bytes({schema:'prismpm/sdk-inventory/1',commands:['unit-only'],artifacts:[{id:'standards-and-oracles',digest:sha(standards)}]});
  const authorityResult=bytes({schema:'prismpm/authority-result/1',lock_digest:sha(standards),path:'standards.lock',authorities:0,oracles:0,unchanged:true});
  const candidate=bytes({source_revision:source,platform:'linux/'+arch,manifest_digest:sha(manifest),inventory_digest:sha(inventory),
   development_only:true,production_accepted:false,checks:['non-root','inventory','standards-lock','model-check','shadowed-tool-rejected'],
   standards_lock_digest:sha(standards),authority_result_digest:sha(authorityResult)});
  const files=new Map(Object.entries({'authority-result.json':authorityResult,'candidate.json':candidate,
   'cli.json':bytes({schema:'prismpm/completion-result/1',shell:'bash',script:'unit-only'}),
   'config.json':config,'digest.txt':Buffer.from(sha(manifest)+'\n'),'inventory.json':inventory,'manifest.json':manifest,
   'model-check.json':bytes({schema:'prismpm/check-result/1',model_id:'1'.repeat(64),semantic_id:'2'.repeat(64),snapshot_id:'3'.repeat(64)}),
   'standards.lock':standards,'tamper.json':bytes({schema:'prismpm/error-result/1',diagnostic:{code:'PP5401'}})} )
   .map(([name,value])=>['evidence/'+name,value]));
  const record={schema:'prismpm/unpublished-sdk-construction/1',scope:'construction-only-not-acceptance',workflow_revision:source,source_revision:source,
   run_id:String(runId),run_attempt:String(attempt),platform:'linux/'+arch,archive:{path:'sdk.oci.tar',byte_length:10240,digest:sha(Buffer.from('unit-only archive '+arch))},
   smoke:{status:0,signal:null,archive_binding:'held-descriptor-before-and-after'},manifest:{digest:sha(manifest),byte_length:manifest.length},
   smoke_evidence:[...files].map(([path,value])=>({path,byte_length:value.length,digest:sha(value)})),
   unclaimed:['full-vv','installed-dual-native-sdk-qualification','signing','release','product-readiness']};
  return {files,record};
 }
 const f={expected,authority,standards,workflow:readFileSync(new URL('../tests/sdk-construction/sdk-candidate-six.yml',import.meta.url)),lanes:{amd64:lane('amd64'),arm64:lane('arm64')}};
 f.admit=()=>validateConstructionAuthority(bytes(f.authority),f.expected,now,f.workflow);
 f.metadata=(handle,arch)=>validateConstructionMetadata(handle,arch,bytes(f.lanes[arch].record),f.lanes[arch].files,f.standards);
 return f;
}
// Repair all dependent bindings, not the mutated payload itself. This prevents
// a stale outer checksum from masking a missing inner semantic/source check.
function reseal(l){
 const standards=l.files.get('evidence/standards.lock'),lock=JSON.parse(standards);
 const inventory=JSON.parse(l.files.get('evidence/inventory.json'));
 for(const row of inventory.artifacts??[])if(row.id==='standards-and-oracles')row.digest=sha(standards);
 l.files.set('evidence/inventory.json',bytes(inventory));
 l.files.set('evidence/authority-result.json',bytes({schema:'prismpm/authority-result/1',lock_digest:sha(standards),path:'standards.lock',
  authorities:lock.authorities.length,oracles:lock.oracles.length,unchanged:true}));
 const mb=l.files.get('evidence/manifest.json');
 l.record.manifest={digest:sha(mb),byte_length:mb.length};l.files.set('evidence/digest.txt',Buffer.from(sha(mb)+'\n'));
 const c=JSON.parse(l.files.get('evidence/candidate.json'));
 Object.assign(c,{manifest_digest:sha(mb),inventory_digest:sha(l.files.get('evidence/inventory.json')),
  standards_lock_digest:sha(standards),authority_result_digest:sha(l.files.get('evidence/authority-result.json'))});
 l.files.set('evidence/candidate.json',bytes(c));
 resealOuter(l);
}
function resealOuter(l){l.record.smoke_evidence=[...l.files].map(([path,b])=>({path,byte_length:b.length,digest:sha(b)}));}
test('both exact native metadata handoffs compose a deterministic explicitly unqualified index',()=>{
 const f=fixture(),authority=f.admit(),a=f.metadata(authority,'amd64'),b=f.metadata(authority,'arm64');
 const index=composeConstructionIndex(a,b),again=composeConstructionIndex(a,b);
 assert.deepEqual(index,again);assert.equal(index.digest,sha(index.bytes));
 assert.deepEqual(JSON.parse(index.bytes).manifests.map(m=>m.platform),[{os:'linux',architecture:'amd64'},{os:'linux',architecture:'arm64'}]);
 assert.equal(authority.scope,'provider-response-metadata-only-not-authentication');assert.equal(a.scope,'construction-metadata-only-not-archive-or-sdk-acceptance');
 assert.equal(index.scope,'composed-index-only-not-registry-or-installed-qualification');assert.equal(index.status,undefined);
});
test('additive integrity owner must be skipped and cannot replace original native construction',()=>{
 const f=fixture();f.workflow=readFileSync(new URL('../tests/sdk-construction/sdk-candidate-seven.yml',import.meta.url));
 f.authority.jobs.push({...f.authority.jobs[3],id:7,name:'construction-integrity'});assert.doesNotThrow(()=>f.admit());
 const omitted=fixture();omitted.workflow=f.workflow;assert.throws(()=>omitted.admit(),/complete original/);
 const unknown=fixture();unknown.workflow=Buffer.concat([unknown.workflow,Buffer.from('\n')]);assert.throws(()=>unknown.admit(),/unreviewed source workflow/);
 const extra=fixture();extra.authority.jobs.push({...extra.authority.jobs[3],id:7,name:'construction-integrity'});assert.throws(()=>extra.admit(),/complete original/);
 for(const mutate of[j=>j.name='foreign-owner',j=>j.conclusion='success',j=>j.id=6,j=>j.run_attempt=2]){
  const g=fixture();g.workflow=f.workflow;g.authority.jobs.push({...g.authority.jobs[3],id:7,name:'construction-integrity'});mutate(g.authority.jobs[6]);assert.throws(()=>g.admit());
 }
 const g=fixture();g.authority.jobs[5]={...g.authority.jobs[3],id:6,name:'construction-integrity'};assert.throws(()=>g.admit());
});
test('the current nine-job workflow profile is exact and bounds or command mutations fail closed',()=>{
 const current=readFileSync(new URL('../.github/workflows/sdk-candidate.yml',import.meta.url));
 const skipped=f=>{for(const [i,name]of['construction-integrity','unpublished-prerequisites','unpublished-installed'].entries())f.authority.jobs.push({...f.authority.jobs[3],id:7+i,name});};
 const f=fixture();f.workflow=current;skipped(f);
 assert.doesNotThrow(()=>f.admit());
 for(const mutation of [
  ['timeout-minutes: 180','timeout-minutes: 179'],
  ['max-parallel: 2','max-parallel: 1'],
  ['node scripts/sdk-construction-record.mjs','node scripts/sdk-construction-record.mjs --mutated']
 ]){
  const altered=Buffer.from(current.toString().replace(mutation[0],mutation[1]));
  assert.notDeepEqual(altered,current,'the mutation must reach the actual workflow');
  const bad=fixture();bad.workflow=altered;skipped(bad);
  assert.throws(()=>bad.admit(),/unreviewed source workflow profile/);
 }
 for(const name of['unpublished-prerequisites','unpublished-installed'])for(const mutate of[j=>j.conclusion='success',j=>j.name='foreign-owner',j=>j.run_attempt=2,j=>j.id=6]){
  const bad=fixture();bad.workflow=current;skipped(bad);mutate(bad.authority.jobs.find(j=>j.name===name));assert.throws(()=>bad.admit());
 }
 for(const name of['construction-integrity','unpublished-prerequisites','unpublished-installed']){
  const bad=fixture();bad.workflow=current;skipped(bad);bad.authority.jobs=bad.authority.jobs.filter(j=>j.name!==name);assert.throws(()=>bad.admit(),/complete original/);
 }
 const qualificationOnly=fixture();qualificationOnly.workflow=current;skipped(qualificationOnly);
 for(const job of qualificationOnly.authority.jobs){
  if(job.name.startsWith('Unpublished native SDK construction'))job.conclusion='skipped';
  if(job.name==='unpublished-prerequisites'||job.name==='unpublished-installed')job.conclusion='success';
 }
 assert.throws(()=>qualificationOnly.admit(),'a successful installed-qualification run cannot substitute for original native construction');
});
test('provider admission rejects wrong repository workflow source run attempt and failed native jobs',()=>{
 for(const mutate of [f=>f.authority.run.repository.full_name='other/repo',f=>f.authority.run.head_repository.id=2,
  f=>f.authority.run.path='.github/workflows/release.yml',f=>f.authority.run.head_sha='b'.repeat(40),f=>f.authority.run.event='pull_request',
  f=>f.authority.run.id=124,f=>f.authority.run.run_attempt=2,f=>f.authority.run.conclusion='cancelled',
  f=>f.authority.jobs.pop(),f=>f.authority.jobs[5].name=f.authority.jobs[4].name,f=>f.authority.jobs[5].id=5,
  f=>f.authority.jobs[5].conclusion='failure',f=>f.authority.jobs[5].run_attempt=2,f=>f.authority.jobs[5].labels=['ubuntu-24.04'],
  f=>f.authority.jobs[4].runner_group_name='private',f=>f.authority.jobs[4].steps[0].conclusion='skipped',
  f=>f.authority.jobs[3].conclusion='success']){
  const f=fixture();mutate(f);assert.throws(()=>f.admit());
 }
});
test('artifact admission rejects name-only selection expired duplicates substitution and foreign provenance',()=>{
 for(const mutate of [f=>f.expected.artifact_ids.arm64=12,f=>f.authority.artifacts[0].id=14,
  f=>f.authority.artifacts[0].name='latest',f=>f.authority.artifacts[0].expired=true,
  f=>f.authority.artifacts[0].expires_at='2026-10-07T00:00:00Z',f=>f.authority.artifacts[0].digest='sha256:bad',
  f=>f.authority.artifacts[0].size_in_bytes=0,f=>f.authority.artifacts[0].workflow_run.id=124,
  f=>f.authority.artifacts[0].workflow_run.head_sha='b'.repeat(40),f=>f.authority.artifacts[0].workflow_run.repository_id=2,
  f=>f.authority.artifacts.push({...f.authority.artifacts[0]})]){
  const f=fixture();mutate(f);assert.throws(()=>f.admit());
 }
});
test('original successful job step inventories cannot be omitted replaced reordered or renumbered',()=>{
 for(const mutate of [j=>j.steps=[],j=>j.steps.pop(),j=>j.steps.splice(6,1),
  j=>j.steps=[{...j.steps[0],name:'unit-only success'}],j=>j.steps[6].name=j.steps[5].name,
  j=>[j.steps[5],j.steps[6]]=[j.steps[6],j.steps[5]],j=>j.steps[0].number=2,
  j=>j.steps[8].number=j.steps[7].number,j=>j.steps[7].conclusion='skipped']){
  const f=fixture();mutate(f.authority.jobs[4]);assert.throws(()=>f.admit());
 }
 const f=fixture();f.authority.jobs[0].steps[0].number=2;assert.throws(()=>f.admit());
});
test('provider timestamps and artifact upload windows bind the selected original attempt',()=>{
 for(const mutate of [f=>f.authority.run.created_at='2026-10-09T00:00:00Z',
  f=>f.authority.run.updated_at='2026-10-09T00:00:00Z',f=>f.authority.run.run_started_at='2026-02-31T00:00:00Z',
  f=>f.authority.jobs[4].started_at='2026-10-07T00:00:00Z',f=>f.authority.jobs[4].completed_at='2026-10-07T01:00:01Z',
  f=>f.authority.jobs[4].steps[6].completed_at='2026-10-07T01:00:09Z',
  f=>f.authority.jobs[4].steps[7].started_at='2026-10-07T01:00:06Z',
  f=>f.authority.artifacts[0].created_at='2026-10-06T01:00:08Z',
  f=>f.authority.artifacts[0].created_at='2026-10-07T01:00:09Z',
  f=>f.authority.artifacts[0].expires_at='2026-02-31T00:00:00Z']){
  const f=fixture();mutate(f);assert.throws(()=>f.admit());
 }
 // A genuine retry changes every run-attempt binding, but an old attempt's
 // artifact still cannot pass merely because its workflow_run has the same ID.
 const f=fixture(123,2);f.authority.artifacts[0].created_at='2026-10-06T01:00:08Z';assert.throws(()=>f.admit());
});
test('successful native jobs must actually follow their successful input-policy dependency',()=>{
 const f=fixture(),policy=f.authority.jobs[0];
 policy.started_at='2026-10-07T01:00:20Z';policy.completed_at='2026-10-07T01:00:23Z';
 for(const [i,s]of policy.steps.entries()){
  s.started_at=`2026-10-07T01:00:${20+i}Z`;s.completed_at=`2026-10-07T01:00:${21+i}Z`;
 }
 assert.throws(()=>f.admit(),/native construction must follow successful input policy/);
});
test('construction records preserve every identity scope original byte digest and closed inventory',()=>{
 for(const mutate of [l=>l.record.workflow_revision='b'.repeat(40),l=>l.record.run_attempt='2',l=>l.record.platform='linux/arm64',
  l=>l.record.scope='accepted',l=>l.record.unclaimed=[],l=>l.record.smoke.status=1,l=>l.record.status='passed',
  l=>l.record.archive.path='../sdk.oci.tar',l=>l.record.archive.digest='sha256:bad',l=>l.record.archive.byte_length=0,
  l=>l.record.manifest.digest='sha256:'+'0'.repeat(64),l=>l.record.smoke_evidence.pop(),
  l=>l.record.smoke_evidence[1]={...l.record.smoke_evidence[0]},l=>l.files.delete('evidence/tamper.json'),
  l=>l.files.set('evidence/extra',Buffer.from('foreign')),l=>l.files.set('evidence/cli.json',Buffer.from('substituted'))]){
  const f=fixture(),handle=f.admit();mutate(f.lanes.amd64);assert.throws(()=>f.metadata(handle,'amd64'));
 }
});
test('fully resealed source standards substitutions reach the independent exact-source guard',()=>{
 const f=fixture(),authority=f.admit(),l=f.lanes.amd64;
 l.files.set('evidence/standards.lock',bytes({schema:'prismpm/standards-lock/1',authorities:[{unit:'foreign'}],oracles:[]}));reseal(l);
 assert.throws(()=>f.metadata(authority,'amd64'),/exact-source standards must match/);
 // Positive counterfactual: with that different independently selected source
 // lock, all inner bindings really are coherent. No stale checksum masks it.
 assert.doesNotThrow(()=>validateConstructionMetadata(authority,'amd64',bytes(l.record),l.files,l.files.get('evidence/standards.lock')));
});
test('coherently resealed metadata still cannot substitute config manifest or release claims',()=>{
 for(const mutate of [(f,l)=>{const c=JSON.parse(l.files.get('evidence/candidate.json'));c.production_accepted=true;l.files.set('evidence/candidate.json',bytes(c));},
  (f,l)=>{const m=JSON.parse(l.files.get('evidence/manifest.json'));m.config.size++;l.files.set('evidence/manifest.json',bytes(m));},
  (f,l)=>{const m=JSON.parse(l.files.get('evidence/manifest.json'));m.layers[0].urls=['https://github.com/UOR-Foundation/PrismPM'];l.files.set('evidence/manifest.json',bytes(m));},
  (f,l)=>{const c=JSON.parse(l.files.get('evidence/config.json'));c.architecture='arm64';const cb=bytes(c);l.files.set('evidence/config.json',cb);
   const m=JSON.parse(l.files.get('evidence/manifest.json'));m.config.digest=sha(cb);m.config.size=cb.length;l.files.set('evidence/manifest.json',bytes(m));}]){
  const f=fixture(),authority=f.admit(),l=f.lanes.amd64;mutate(f,l);
  reseal(l);
  assert.throws(()=>f.metadata(authority,'amd64'));
 }
});
test('fully resealed smoke payloads must implement their original schemas and semantic constraints',()=>{
 for(const [name,mutate]of [
  ['cli.json',v=>v.schema='other'],['cli.json',v=>v.shell='zsh'],['cli.json',v=>v.script=''],
  ['cli.json',v=>v.script='x'.repeat(65537)],['model-check.json',v=>v.schema='other'],
  ['model-check.json',v=>v.model_id='0'],['model-check.json',v=>delete v.semantic_id],
  ['model-check.json',v=>v.snapshot_id='Z'.repeat(64)],['inventory.json',v=>v.schema='other'],
  ['inventory.json',v=>v.commands=[]],['inventory.json',v=>v.artifacts=[]],
  ['tamper.json',v=>v.schema='other'],['tamper.json',v=>v.diagnostic.code='PP0001']]){
  const f=fixture(),authority=f.admit(),l=f.lanes.amd64,path='evidence/'+name,v=JSON.parse(l.files.get(path));
  mutate(v);l.files.set(path,bytes(v));reseal(l);assert.throws(()=>f.metadata(authority,'amd64'));
 }
});
test('every JSON smoke input is decoded with fatal UTF-8 even after original outer hashes are resealed',()=>{
 for(const name of ['authority-result.json','candidate.json','cli.json','config.json','inventory.json','manifest.json',
  'model-check.json','standards.lock','tamper.json']){
  const f=fixture(),authority=f.admit(),l=f.lanes.amd64,path='evidence/'+name;
  // Valid replacement-character JSON under permissive decoding, not just
  // invalid JSON. This isolates the fatal UTF-8 requirement.
  l.files.set(path,Buffer.concat([Buffer.from('{"bad":"'),Buffer.from([255]),Buffer.from('"}')]));resealOuter(l);
  const selected=name==='standards.lock'?l.files.get(path):f.standards;
  assert.throws(()=>validateConstructionMetadata(authority,'amd64',bytes(l.record),l.files,selected),TypeError);
 }
});
test('forged copied swapped or cross-run handles cannot create admitted native indexes',()=>{
 const f=fixture(),h=f.admit(),a=f.metadata(h,'amd64'),b=f.metadata(h,'arm64');
 assert.throws(()=>f.metadata({...h},'amd64'));assert.throws(()=>composeConstructionIndex({...a},b));
 assert.throws(()=>composeConstructionIndex(b,a));assert.throws(()=>composeConstructionIndex(a,a));
 const other=fixture(124,2),otherH=other.admit(),otherB=other.metadata(otherH,'arm64');
 assert.notEqual(h.run_id,otherH.run_id);assert.notEqual(h.run_attempt,otherH.run_attempt);
 assert.throws(()=>composeConstructionIndex(a,otherB));
 assert(Object.isFrozen(a)&&Object.isFrozen(b)&&Object.isFrozen(h));
});
test('aggregate metadata limits are enforced before hashing or parsing individual payloads',()=>{
 const f=fixture(),h=f.admit(),l=f.lanes.amd64;
 for(const name of ['cli.json','inventory.json','tamper.json'])l.files.set('evidence/'+name,Buffer.alloc(33*1024**2));
 assert.throws(()=>f.metadata(h,'amd64'),/96 MiB aggregate construction metadata budget exceeded/);
});
test('tighter per-kind limits reject before the first JSON parse',()=>{
 for(const [name,limit]of [['manifest.json',4*1024**2],['config.json',4*1024**2],['candidate.json',65536]]){
  const f=fixture(),h=f.admit(),l=f.lanes.amd64;l.files.set('evidence/'+name,Buffer.alloc(limit+1));resealOuter(l);
  assert.throws(()=>f.metadata(h,'amd64'),/bounded original metadata bytes required/);
 }
});
test('oversized malformed and invalid UTF-8 authority and construction bytes are refused',()=>{
 const f=fixture();for(const b of [Buffer.alloc(0),Buffer.from([255]),Buffer.from('{'),Buffer.alloc(16*1024**2+1)])
  assert.throws(()=>validateConstructionAuthority(b,f.expected,now,f.workflow));
 const h=f.admit(),l=f.lanes.amd64;
 for(const b of [Buffer.alloc(0),Buffer.from([255]),Buffer.from('{'),Buffer.alloc(65537)])
  assert.throws(()=>validateConstructionMetadata(h,'amd64',b,l.files,f.standards));
 assert.throws(()=>validateConstructionAuthority(bytes(f.authority),f.expected,NaN,f.workflow));
});
