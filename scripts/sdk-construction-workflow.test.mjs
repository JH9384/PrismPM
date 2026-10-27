// Workflow policy checks only; synthetic mutations are not SDK qualification.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const {load}=createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const path=new URL('../.github/workflows/sdk-candidate.yml',import.meta.url);
const raw=()=>readFileSync(path,'utf8');
const predicate="github.repository == 'UOR-Foundation/PrismPM' && github.event_name == 'workflow_dispatch' && inputs.construction_source_revision != '' && !inputs.development_only";
function validate(text){
 const w=load(text),j=w.jobs['unpublished-construction'];
 assert.deepEqual(w.permissions,{});assert(j,'a separate no-publication construction owner is required');
 assert.equal(j.if,predicate);assert.deepEqual(j.permissions,{contents:'read'});
 assert.equal(j['timeout-minutes'],180);assert.equal(j['runs-on'],'${{ matrix.runner }}');
 assert.deepEqual(j.strategy,{'fail-fast':false,'max-parallel':2,matrix:{include:[{runner:'ubuntu-24.04',architecture:'amd64'},{runner:'ubuntu-24.04-arm',architecture:'arm64'}]}});
 assert.equal(j.environment,undefined);assert.equal(j.needs,'input-policy');
 assert.equal(w.jobs.policy.needs,'input-policy');
 const input=w.jobs['input-policy'];assert.deepEqual(input.permissions,{});
 assert.equal(input.if,"github.repository == 'UOR-Foundation/PrismPM'");
 assert.equal(input.steps.length,1);
 assert.deepEqual(input.steps[0].env,{SOURCE_REVISION:'${{ inputs.construction_source_revision }}',DEVELOPMENT_ONLY:'${{ inputs.development_only }}',WORKFLOW_REVISION:'${{ github.workflow_sha }}',INTEGRITY_SELECTION:'${{ inputs.construction_integrity }}',QUALIFICATION_SELECTION:'${{ inputs.unpublished_qualification }}'});
 assert.equal(input.steps[0].run,'[[ "$DEVELOPMENT_ONLY" = true || "$DEVELOPMENT_ONLY" = false ]]\nif test -n "$SOURCE_REVISION"; then\n  [[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]\n  test "$DEVELOPMENT_ONLY" = false\n  test "$SOURCE_REVISION" = "$WORKFLOW_REVISION"\nfi\nif test -n "$INTEGRITY_SELECTION"; then\n  test "$DEVELOPMENT_ONLY" = false\n  test -z "$SOURCE_REVISION"\nfi\nif test -n "$QUALIFICATION_SELECTION"; then\n  test "$DEVELOPMENT_ONLY" = false\n  test -z "$SOURCE_REVISION"\n  test -z "$INTEGRITY_SELECTION"\n  test "$WORKFLOW_REVISION" = "$GITHUB_SHA"\nfi\n');
 const steps=j.steps;assert.equal(steps.length,7);assert(steps.every(s=>!s['continue-on-error']));
 assert(steps.filter(s=>s.uses).every(s=>/^[a-zA-Z0-9_./-]+@[a-f0-9]{40}$/.test(s.uses)));
 assert(!JSON.stringify(j).match(/login-action|setup-qemu|packages:|id-token:|attestations:|secrets\.|github\.token|GH_TOKEN|GITHUB_TOKEN/));
 const check=steps.find(s=>s.name==='Validate immutable construction input');
 assert.equal(check.env.SOURCE_REVISION,'${{ inputs.construction_source_revision }}');
 assert.equal(check.env.WORKFLOW_REVISION,'${{ github.workflow_sha }}');
 assert.equal(check.run,'[[ "$SOURCE_REVISION" =~ ^[0-9a-f]{40}$ ]]\ntest "$SOURCE_REVISION" = "$WORKFLOW_REVISION"\n');
 const checkout=steps.find(s=>s.uses?.startsWith('actions/checkout@'));
 assert(steps.indexOf(check)<steps.indexOf(checkout));
 assert.deepEqual(checkout.with,{ref:'${{ inputs.construction_source_revision }}','persist-credentials':false,'fetch-depth':0});
 const build=steps.find(s=>s.name==='Construct the exact native SDK without publication');
 assert.equal(build.env.SOURCE_REVISION,'${{ inputs.construction_source_revision }}');
 assert.equal(build.env.ARCHITECTURE,'${{ matrix.architecture }}');
 assert(build.run.includes('test "$(git rev-parse HEAD)" = "$SOURCE_REVISION"'));
 assert(build.run.includes('test -z "$(git status --porcelain)"'));
 assert(build.run.includes('node scripts/sdk-image-inputs.mjs build . "$SOURCE_REVISION" runtime'));
 assert(build.run.includes('--platform "linux/$ARCHITECTURE"'));
 assert(build.run.includes('--output "type=oci,dest=$RUNNER_TEMP/construction/sdk.oci.tar,rewrite-timestamp=true"'));
 assert(!build.run.includes('true #'));
 assert(build.run.includes('node --test scripts/sdk-construction-record.test.mjs\n'));
 assert(build.run.includes('node scripts/sdk-construction-record.mjs "$RUNNER_TEMP/construction"\n'));
 assert(!build.run.match(/(?:oras|docker)\s+(?:push|login)|sdk-candidate\.mjs\s+(?:environment|sbom-publish)/));
 const upload=steps.find(s=>s.uses?.startsWith('actions/upload-artifact@'));
 assert.equal(upload.with.name,'unpublished-sdk-construction-${{ matrix.architecture }}-${{ inputs.construction_source_revision }}');
 assert.equal(upload.with.path,'${{ runner.temp }}/construction/');
 assert.equal(upload.with['if-no-files-found'],'error');assert.equal(upload.with['compression-level'],0);assert.equal(upload.with['retention-days'],7);
 for(const name of ['policy','build','publish'])assert(w.jobs[name].if.includes("github.ref == 'refs/heads/main'"));
 assert.deepEqual(w.jobs.publish.needs,'build');assert.equal(w.jobs.publish.environment,'sdk-candidate');
 const canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
 assert.equal(w.jobs.policy['timeout-minutes'],30);
 assert.equal(w.jobs.build.strategy['max-parallel'],2);
 // These are the only independently reviewed additive bounds layered onto
 // the historical protected owners.  Normalize those fields solely for the
 // old-body hash; every command, dependency, permission, and condition
 // remains covered by the hash and explicit assertions above.
 const protectedBody=(name)=>{const body=structuredClone(w.jobs[name]);if(name==='policy'){delete body.needs;delete body['timeout-minutes'];}if(name==='build')delete body.strategy['max-parallel'];return body;};
 // Complete original protected owners, captured before this additive change.
  for(const [name,expected] of Object.entries({policy:'33851cff53bf24eb20eb90e17edac1181d71ed1527dbe18735f1038788ad05e2',build:'35aeaa947a3dce79868519fde4edb2ad1ccde35ec85fe0f3a75e678ab2787ad8',publish:'341a4964415efc121c469d7f1a609771f91816471e3decb8fea51fe3f8f7a5f3'})){
  const original=protectedBody(name);
  assert.equal(createHash('sha256').update(canonical(original)).digest('hex'),expected,'protected publication owner changed: '+name);
 }
}
test('unpublished construction preserves protected publication and both real native build owners',()=>validate(raw()));
test('construction policy rejects privilege, target and native-host substitutions',()=>{
 const text=raw();
 for(const [from,to] of [[predicate,'true'],['contents: read','contents: write'],['runner: ubuntu-24.04-arm','runner: ubuntu-24.04'],['architecture: arm64','architecture: amd64'],['fail-fast: false','fail-fast: true'],['max-parallel: 2','max-parallel: 1'],['timeout-minutes: 180','timeout-minutes: 179'],['ref: ${{ inputs.construction_source_revision }}','ref: main'],['^\u005b0-9a-f\u005d{40}$','.*'],['--platform "linux/$ARCHITECTURE"','--platform linux/amd64'],['node scripts/sdk-construction-record.mjs','true # node scripts/sdk-construction-record.mjs'],['name: unpublished-sdk-construction-','name: sdk-candidate-']]){
  // Apply mutations to the new job, not a different, already protected owner.
  const start=text.indexOf('  unpublished-construction:');assert(start>=0);
  const suffix=text.slice(start);assert(suffix.includes(from),from);
  const changed=text.slice(0,start)+suffix.replace(from,to);assert.notEqual(changed,text);assert.throws(()=>validate(changed),from);
 }
});
test('actual input admission shell rejects ambiguous, malformed and injected revisions',()=>{
 const script=load(raw()).jobs['input-policy'].steps[0].run;
 for(const [revision,development,accepted] of [['','false',true],['','true',true],['a'.repeat(40),'false',true],['b'.repeat(40),'false',false],['a'.repeat(40),'true',false],['main','false',false],['a'.repeat(39),'false',false],['a'.repeat(41),'false',false],['A'.repeat(40),'false',false],['a'.repeat(40)+'\n','false',false],['$(exit 0)','false',false],['','yes',false],['','true\n',false]]){
  const r=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',script],{env:{PATH:process.env.PATH,SOURCE_REVISION:revision,DEVELOPMENT_ONLY:development,WORKFLOW_REVISION:'a'.repeat(40),GITHUB_SHA:'a'.repeat(40),INTEGRITY_SELECTION:'',QUALIFICATION_SELECTION:''},encoding:'utf8',timeout:5000});
  assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status===0,accepted,JSON.stringify({revision,development}));
 }
});
test('every protected owner and admission dependency remains intact under mutations',()=>{
 const text=raw();
 for(const changed of [text.replace('needs: input-policy','needs: nonexistent'),text.replace('if: github.repository', 'if: true # github.repository'),text.replace('environment: sdk-candidate','environment: unrelated'),text.replace('packages: write','packages: read'),text.replace("github.ref == 'refs/heads/main'",'true'),text.replace('needs: build','needs: input-policy')]){
  assert.notEqual(changed,text);assert.throws(()=>validate(changed));
 }
});
test('normalized capacity fields stay mandatory and construction strategy remains closed',()=>{
 const text=raw();
 const changeJob=(name,from,to)=>{
  const start=text.indexOf(`  ${name}:\n`);assert(start>=0);
  const next=text.slice(start+1).search(/\n  [a-z][a-z-]*:\n/);
  const end=next<0?text.length:start+1+next;
  const body=text.slice(start,end);assert(body.includes(from),`${name}: ${from}`);
  const changed=text.slice(0,start)+body.replace(from,to)+text.slice(end);
  assert.notEqual(changed,text);return changed;
 };
 for(const [name,from,to] of [
  ['policy','    timeout-minutes: 30\n',''],
  ['policy','timeout-minutes: 30','timeout-minutes: 29'],
  ['build','      max-parallel: 2\n',''],
  ['build','max-parallel: 2','max-parallel: 3'],
  ['unpublished-construction','      max-parallel: 2','      unknown-policy: true\n      max-parallel: 2'],
 ]) {
  const changed=changeJob(name,from,to);
  assert.throws(()=>validate(changed),`${name}: ${from}`);
 }
});
