// Closed orchestration/source controls only; no constructed SDK acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {existsSync,readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import {spawnSync} from 'node:child_process';
import {runInNewContext} from 'node:vm';
import {unpublishedQualificationPlan,qualificationStorageBudget,conserveQualificationContainer,qualificationCommandBudget} from './unpublished-sdk-qualification.mjs';
const revision='1'.repeat(40);
const selection={revision,run_id:123,run_attempt:1,artifact_ids:{amd64:456,arm64:789}};
const plan=(arch='amd64',phase='prerequisites',value=selection)=>unpublishedQualificationPlan(JSON.stringify(value),revision,arch,phase);
const source=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
const {load}=createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const workflowPath='.github/workflows/sdk-candidate.yml';
const privateJobs=text=>text.slice(text.indexOf('\n  unpublished-prerequisites:'));
test('both native phases select only the original complete installed owner commands and original360minute envelope',()=>{
 for(const arch of['amd64','arm64'])for(const phase of['prerequisites','installed']){
  const p=plan(arch,phase);assert.equal(p.arch,arch);assert.equal(p.phase,phase);assert.equal(p.original_job_minutes,360);
  assert.deepEqual(p.selection.expected,selection);assert.equal(p.selection.qualifier,revision);
  assert.deepEqual(p.commands,phase==='prerequisites'?[['bash','root-a/scripts/browser-api-sdk-check.sh'],['node','root-a/scripts/library-sdk-check.mjs','tests'],['bash','root-a/scripts/library-sdk-check.sh']]:[['bash','root-a/scripts/sdk-vv-outer.sh'],['node','root-a/scripts/product-sdk-check.mjs','tests'],['bash','root-a/scripts/product-sdk-check.sh']]);
  assert(p.scope.includes('not SDK release'));assert(p.scope.includes('downstream consumer'));
 }
});
test('old source, fabricated acceptance properties, duplicate artifacts, platform drift and arbitrary phases refuse',()=>{
 for(const changed of[{...selection,revision:'2'.repeat(40)},{...selection,production_accepted:true},{...selection,artifact_ids:{amd64:456,arm64:456}},{...selection,artifact_ids:{amd64:456,arm64:789,other:111}},{...selection,run_attempt:0},{...selection,run_id:1.5}])assert.throws(()=>plan('amd64','prerequisites',changed));
 for(const arch of['x64','aarch64','foreign',''])assert.throws(()=>plan(arch));
 for(const phase of['unit-only','smoke-only','skip-vv','publish',''])assert.throws(()=>plan('amd64',phase));
});
test('storage admission derives from genuine ordered expanded measurements and retains original reserves and full product scan allowance',()=>{
 const records=[{architecture:'amd64',expanded_tar_bytes:20},{architecture:'arm64',expanded_tar_bytes:30}];
 for(const arch of['amd64','arm64']){
  const a=qualificationStorageBudget(records,arch,'prerequisites'),b=qualificationStorageBudget(records,arch,'installed');
  assert.equal(a.required_free_bytes,(arch==='amd64'?20:30)+12*1024**3);
  assert.equal(b.required_free_bytes,50+30+12*1024**3);assert.equal(b.original_installed_vv_admission_unchanged,true);
 }
 for(const records of[[],[{architecture:'amd64',expanded_tar_bytes:1}], [{architecture:'arm64',expanded_tar_bytes:1},{architecture:'amd64',expanded_tar_bytes:1}],[{architecture:'amd64',expanded_tar_bytes:NaN},{architecture:'arm64',expanded_tar_bytes:1}]])assert.throws(()=>qualificationStorageBudget(records,'amd64','installed'));
});
test('manual workflow retains immutable exact-source selection, fixed two native runners, all phases and no publication permission',()=>{
 const entire=source(workflowPath),w=load(entire),text=privateJobs(entire);
 assert(w.on.workflow_dispatch);assert(!w.on.push&&!w.on.pull_request);
 assert.deepEqual(w.permissions,{});assert(w.on.workflow_dispatch.inputs.unpublished_qualification);
 for(const id of['unpublished-prerequisites','unpublished-installed'])assert.deepEqual(w.jobs[id].permissions,{contents:'read',actions:'read'});
 assert(!existsSync(new URL('../.github/workflows/sdk-unpublished-qualification.yml',import.meta.url)),'use the already registered candidate entry, not a new default-branch-only dispatch workflow');
 assert.match(text,/contents: read/);assert.match(text,/actions: read/);assert(!/packages:|id-token:|contents: write|actions: write/.test(text));
 assert.equal((text.match(/phase: prerequisites/g)||[]).length,2);assert.equal((text.match(/phase: installed/g)||[]).length,2);
 assert.equal((text.match(/os: ubuntu-24\.04\n/g)||[]).length,2);assert.equal((text.match(/os: ubuntu-24\.04-arm\n/g)||[]).length,2);
 assert.match(text,/timeout-minutes: 360/);assert.match(text,/max-parallel: 2/);assert.match(text,/fail-fast: false/);assert.equal(w.concurrency['cancel-in-progress'],false);
 assert.match(text,/ref: \$\{\{ github.sha \}\}/);assert.match(text,/persist-credentials: false/);
 assert.match(text,/printf '%s' "\$GH_TOKEN" \| env -u GH_TOKEN bash/);
 assert(!/path:[^\n]*private|inner\/private|sdk\.oci\.tar/.test(text),'private keys, stages and full archives must not be uploaded');
 for(const m of text.matchAll(/uses: ([^\n]+)/g))assert.match(m[1],/@[a-f0-9]{40}$/);
});
test('actual driver preserves complete whole-ZIP admission and opaque stage retirement before immutable publication',()=>{
 const text=source('scripts/unpublished-sdk-qualification.mjs');
 for(const token of['provider.authority','validateConstructionAuthority','readConstructionMetadata','validateConstructionMetadata','composeConstructionIndex','stageConstructionArchiveStream','importUnpublishedStage','retireConstructionStage','publishUnpublishedIndex','validateConstructionAuthority(Buffer.from(JSON.stringify(after))'])assert(text.includes(token),token);
 const importAt=text.indexOf('imported.push(await importUnpublishedStage'),publishAt=text.indexOf('const graph=await publishUnpublishedIndex');assert(importAt>0&&publishAt>importAt);
 assert(text.includes("for(const arch of['amd64','arm64'])"));assert(text.includes('for(const lane of lanes)'));
 for(const command of['bash root-a/scripts/browser-api-sdk-check.sh','node root-a/scripts/library-sdk-check.mjs tests','bash root-a/scripts/library-sdk-check.sh','bash root-a/scripts/sdk-vv-outer.sh','node root-a/scripts/product-sdk-check.mjs tests','bash root-a/scripts/product-sdk-check.sh'])assert.equal(text.split(command).length,2,command);
 assert(!/--test-name-pattern|test\.skip|mock|fake|green|accepted: true|production_accepted: true/.test(text));
});
test('optional trust is mechanical and default outer command remains the original complete test-plus-run sequence',()=>{
 const outer=source('scripts/sdk-vv-outer.sh');
 assert(outer.includes('node root-a/scripts/sdk-vv-check.mjs tests; node root-a/scripts/sdk-vv-check.mjs run "$1" "$2" "$3" "$4"'));
 assert(outer.includes('node root-a/scripts/sdk-vv-check.mjs tests; node root-a/scripts/sdk-vv-check.mjs run-owned-registry "$1" "$2" "$3" "$4" "$5"'));
 for(const script of['browser-api','library','product']){
  const text=source('scripts/'+script+'-sdk-check.sh');assert(text.includes('scripts/sdk-qualification-trust.mjs'));assert(!/NODE_TLS_REJECT_UNAUTHORIZED|--tls-verify=false|--insecure/.test(text));
 }
 assert(source('scripts/library-sdk-check.sh').includes('"${credential_mount[@]}" "${qualification_trust[@]}"'));
 assert(source('scripts/product-sdk-check.sh').includes('"${qualification_trust[@]}"'));
 for(const script of['browser-api','library'])assert(source('scripts/'+script+'-sdk-check.mjs').includes("'scripts/sdk-qualification-trust.mjs'"));
 assert(source('scripts/sdk-vv-check.mjs').includes("'scripts/sdk-qualification-trust.mjs'"));
});
test('outer host owner conserves exact source, ID-file ownership, original limits and non-forced retirement',()=>{
 const text=source('scripts/unpublished-sdk-qualification.sh');
 for(const token of['registry_qualification_tools','--iidfile','--cidfile','--pull=never','--platform "linux/$architecture"','--read-only','--memory 1g --memory-swap 1g --pids-limit 256','--cap-drop ALL --security-opt no-new-privileges','21600-(SECONDS-started)','--interactive','container-id-absence','container-name-absence','tools-tag-absence'])assert(text.includes(token),token);
 assert(!/container rm --force|image rm --force|\brm -rf\b|docker (?:system|builder) prune|GH_TOKEN/.test(text));
 assert(text.includes('owner-oom'));assert(text.includes('cleanup-owned.status'));
});
test('complete container configuration and mounts conserve only known Docker null and ordering transitions',()=>{
 const initial={Id:'1'.repeat(64),Name:'/owned',Created:'original-time',Path:'/bin/sh',Args:['original'],Image:'sha256:'+'2'.repeat(64),Config:{Image:'original',Env:['A=B']},HostConfig:{OomKillDisable:false,ReadonlyRootfs:true,Memory:1024},Mounts:[{Destination:'/z',Source:'/original-z',RW:false},{Destination:'/a',Source:'/original-a',RW:true}],State:{OOMKilled:false}};
 const current=structuredClone(initial);current.HostConfig.OomKillDisable=null;current.Mounts.reverse();conserveQualificationContainer(initial,current);
 for(const mutate of[row=>{row.Config.Env=['A=changed'];},row=>{row.HostConfig.Memory=2048;},row=>{row.Mounts[0].RW=false;},row=>{row.State.OOMKilled=true;},row=>{row.Id='3'.repeat(64);},row=>{row.Image='sha256:'+'4'.repeat(64);}]){
  const changed=structuredClone(current);mutate(changed);assert.throws(()=>conserveQualificationContainer(initial,changed));
 }
});
test('every work and cleanup command charges its original five-second supervisor retirement to the actual remaining whole budget',()=>{
 const verify=budget=>{
  assert.equal(budget(10000,180000,160000),10000);
  assert.equal(budget(25000,180000,160000),15000);
  assert.equal(budget(10000,180000,174999),1);
  for(const now of[175000,179999,180000,180001])assert.throws(()=>budget(10000,180000,now),/deadline exhausted/);
 };
 verify(qualificationCommandBudget);
 const text=source('scripts/unpublished-sdk-qualification.mjs');
 assert(text.includes('qualificationCommandBudget(timeout,cleaning?cleanupEnd:end)'));
 assert(text.includes('cleanupEnd=Math.min(wholeEnd,performance.now()+180000)'));
 const body=text.match(/export function qualificationCommandBudget\([^]*?\n}/)[0].replace('export ','');
 const original=runInNewContext('('+body+')',{assert});verify(original);
 const uncharged=body.replace('Math.floor(deadline-now)-5000','timeout+5000');assert.notEqual(uncharged,body);
 assert.throws(()=>verify(runInNewContext('('+uncharged+')',{assert})),/Expected values|Missing expected exception/,'original full-timeout cleanup near deadline must be detected');
 const shell=source('scripts/unpublished-sdk-qualification.sh');
 for(const token of['whole_deadline=$((started+21600))','work_deadline=$((whole_deadline-180))','remaining=$((deadline-SECONDS-2))','(( remaining>=bound )) || bound=$remaining','(( cleanup_deadline<=whole_deadline )) || cleanup_deadline=$whole_deadline','21600-(SECONDS-started)-180-5','PRISMPM_QUALIFICATION_WHOLE_END_UTC_MS=$owner_end_epoch_ms'])assert(shell.includes(token),token);
 assert(text.includes('Math.min(remaining*1000,utcRemaining)'),'host creation/startup must consume the same fixed remaining owner clock');
});
test('the private TLS registry runs as its actual owner and only its new empty volume receives bounded root initialization',()=>{
 const text=source('scripts/unpublished-sdk-qualification.mjs');
 const verify=value=>{
  const init=value.slice(value.indexOf('const initialize='),value.indexOf('const tls='));
  const registry=value.slice(value.indexOf('const reg=await own'),value.indexOf("await docker('start-owned-registry'"));
  assert.match(registry,/'--user',uid\+':'\+gid/);
  assert.match(init,/'--user','0:0'/);assert.match(init,/'--cap-drop','ALL','--cap-add','CHOWN'/);
  assert.match(init,/'--network','none','--read-only'/);
  assert.equal((init.match(/'--mount'/g)||[]).length,1);assert(init.includes("'type=volume,source='+volume.name+',target=/registry-data'"));
  for(const token of['a.equal(before.uid,0)','a.equal(before.gid,0)','a.deepEqual(f.readdirSync(p),[])','f.chmodSync(p,0o700)','f.chownSync(p,uid,gid)','conserveQualificationContainer(volumeInit.initial,initTerminal)',"assert.equal(initTerminal.State.ExitCode,0)","await absent('container',volumeInit.id)","await absent('container',volumeInit.name)",'volumeInit.retired=true'])assert(init.includes(token),token);
  assert.equal((init.match(/f\.readdirSync\(p\)/g)||[]).length,1,'CHOWN-only root checks emptiness before giving away its0700 directory, not through a denied read afterward');
  assert(init.indexOf('f.readdirSync(p)')<init.indexOf('f.chownSync(p,uid,gid)'));
  assert(!/type=bind|\/tls|--privileged/.test(init),'initializer cannot acquire host paths, private keys or broad privilege');
  for(const token of['mkdirSync(tls,{mode:0o700})','chmodSync(leafKey,0o400)','chmodSync(key,0o400)'])assert(value.includes(token),token);
 };
 verify(text);
 const wrongUser=text.replace("'--network','host','--read-only','--user',uid+':'+gid", "'--network','host','--read-only'");assert.notEqual(wrongUser,text);assert.throws(()=>verify(wrongUser));
 const unretired=text.replace("await absent('container',volumeInit.id)",'/* missing exact owned-ID absence */');assert.notEqual(unretired,text);assert.throws(()=>verify(unretired));
});
test('both native prerequisites must succeed before either original installed owner can start',()=>{
 const verify=text=>{
  assert.match(text,/\n  unpublished-prerequisites:\n    needs: input-policy\n/);assert.match(text,/\n  unpublished-installed:\n    needs: \[input-policy, unpublished-prerequisites\]\n/);
  const [prerequisites,installed]=privateJobs(text).split('\n  unpublished-installed:');
  assert.equal((prerequisites.match(/phase: prerequisites/g)||[]).length,2);assert(!prerequisites.includes('phase: installed'));
  assert.equal((installed.match(/phase: installed/g)||[]).length,2);assert(!installed.includes('phase: prerequisites'));
  for(const job of[prerequisites,installed]){
   assert(job.includes('timeout-minutes: 360'));assert(job.includes('fail-fast: false'));assert(job.includes('max-parallel: 2'));
   assert(!/continue-on-error:|if:.*(?:always|failure|cancelled)\(/.test(job.slice(0,job.indexOf('    steps:'))));
  }
 };
 const text=source(workflowPath);verify(text);
 const unordered=text.replace('    needs: [input-policy, unpublished-prerequisites]\n','');assert.notEqual(unordered,text);assert.throws(()=>verify(unordered));
 const release=source('.github/workflows/release.yml');
 assert.match(release,/needs: \[gate, images, native, reproducibility, installed-sdk\]/,'original release still requires both complete owner families');
});
test('the existing real admission shell excludes unpublished qualification from every original publication, construction and integrity mode',()=>{
 const w=load(source(workflowPath)),script=w.jobs['input-policy'].steps[0].run,qualified=JSON.stringify(selection);
 for(const development of['false','true'])for(const revision of['',selection.revision])for(const integrity of['','{}'])for(const qualification of['',qualified]){
  const expected=!(qualification&&(development==='true'||revision||integrity))&&!(integrity&&(development==='true'||revision))&&!(revision&&development==='true');
  const r=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',script],{env:{PATH:process.env.PATH,SOURCE_REVISION:revision,DEVELOPMENT_ONLY:development,WORKFLOW_REVISION:selection.revision,GITHUB_SHA:selection.revision,INTEGRITY_SELECTION:integrity,QUALIFICATION_SELECTION:qualification},encoding:'utf8',timeout:5000});
  assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status===0,expected,JSON.stringify({development,revision,integrity,qualification}));
 }
 for(const id of['unpublished-prerequisites','unpublished-installed']){
  const job=w.jobs[id];assert(job.if.includes("inputs.unpublished_qualification != ''"));
  assert(job.if.includes('!inputs.development_only'));assert(job.if.includes("inputs.construction_source_revision == ''"));assert(job.if.includes("inputs.construction_integrity == ''"));
 }
});
test('only the freshly owned ignored target is writable through wrapper namespaces and the original fixed library evidence path stays intact',()=>{
 const driver=source('scripts/unpublished-sdk-qualification.mjs'),shell=source('scripts/unpublished-sdk-qualification.sh');
 const verify=(text,outer)=>{
  assert.equal((text.match(/'type=bind,source='\+target\+',target='\+target/g)||[]).length,2,'daemon and original-owner runner need the same narrowly writable target');
  assert.equal((text.match(/'type=bind,source='\+source\+',target='\+source\+',readonly'/g)||[]).length,2,'tracked checkout stays read-only in both child namespaces');
  for(const token of['test ! -e "$root/target" && test ! -L "$root/target"','mkdir -m 0700 "$root/target"','git -C "$root" check-ignore --quiet -- target/','type=bind,source=$root,target=$root,readonly','type=bind,source=$root/target,target=$root/target'])assert(outer.includes(token),token);
  assert(text.includes('assert.deepEqual(targetIdentity(),targetBefore)'));
  assert(outer.includes('cmp "$output/owned-target-before.txt" "$output/owned-target-after.txt"'));
 };
 verify(driver,shell);
 const missing=driver.replace("'type=bind,source='+target+',target='+target", "'type=bind,source=/unrelated,target=/unrelated'");assert.notEqual(missing,driver);assert.throws(()=>verify(missing,shell));
 const writable=shell.replace('type=bind,source=$root,target=$root,readonly','type=bind,source=$root,target=$root');assert.notEqual(writable,shell);assert.throws(()=>verify(driver,writable));
 assert(source('scripts/library-sdk-check.sh').includes('"$root/target/library-sdk-evidence/linux-$architecture"'));
});
