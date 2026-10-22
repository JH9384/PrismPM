// Workflow admission/resource policy; this cannot establish artifact integrity.
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import test from 'node:test';
const {load}=createRequire('/opt/prismpm/oracles/package.json')('js-yaml');
const text=()=>readFileSync(new URL('../.github/workflows/sdk-candidate.yml',import.meta.url),'utf8');
const predicate="github.repository == 'UOR-Foundation/PrismPM' && github.event_name == 'workflow_dispatch' && inputs.construction_integrity != '' && !inputs.development_only && inputs.construction_source_revision == ''";
function validate(raw){
 const w=load(raw),j=w.jobs['construction-integrity'];assert.deepEqual(w.permissions,{});assert.equal(j.if,predicate);assert.equal(j.needs,'input-policy');
 assert.equal(j['runs-on'],'ubuntu-24.04');assert.equal(j['timeout-minutes'],90);assert.deepEqual(j.permissions,{contents:'read',actions:'read'});
 assert.equal(j.environment,undefined);assert.equal(j.steps.length,4);assert(j.steps.every(s=>!s['continue-on-error']));
 assert.deepEqual(j.steps[0].with,{ref:'${{ github.sha }}','persist-credentials':false,'fetch-depth':0});
 assert.equal(j.steps[1].with['node-version'],'22.23.2');assert(j.steps.filter(s=>s.uses).every(s=>/^[a-zA-Z0-9_./-]+@[a-f0-9]{40}$/.test(s.uses)));
 const run=j.steps[2];assert.deepEqual(run.env,{INTEGRITY_SELECTION:'${{ inputs.construction_integrity }}',GH_TOKEN:'${{ github.token }}'});
 assert.equal(run.run,'test "$(git rev-parse HEAD)" = "$GITHUB_SHA"\ntest -z "$(git status --porcelain)"\nprintf \'%s\' "$GH_TOKEN" | env -u GH_TOKEN node scripts/sdk-construction-observe.mjs \\\n  "$INTEGRITY_SELECTION" "$GITHUB_SHA" "$RUNNER_TEMP/construction-integrity"\ntest "$(git rev-parse HEAD)" = "$GITHUB_SHA"\ntest -z "$(git status --porcelain)"\n');
 const upload=j.steps[3];assert.equal(upload.if,'always()');assert.deepEqual(upload.with,{name:'original-sdk-integrity-${{ github.run_id }}-${{ github.run_attempt }}',
  path:'${{ runner.temp }}/construction-integrity/','if-no-files-found':'error','compression-level':6,'retention-days':14});
 assert(!JSON.stringify(j).match(/packages:|id-token:|attestations:|login-action|setup-qemu|secrets\./));
 const observer=readFileSync(new URL('./sdk-construction-observe.mjs',import.meta.url),'utf8');
 for(const part of['node:22.23.2-bookworm-slim@sha256:48e4b67d85f87bd551df43704e24d252f56cc5f8e9718841aace50f19948f0f9',
  "'--memory','512m','--memory-swap','512m'","'--network','bridge','--read-only','--cap-drop','ALL'","'5000s'","'--interactive'","owner+'='+nonce",
  'container_absent:removed','orchestration_failure:failure.message','observer source custody changed'])assert(observer.includes(part),part);
}
test('read-only archive job has exact source credential resource and retention boundaries',()=>validate(text()));
test('archive job rejects privilege credential source timeout and upload weakening',()=>{
 const raw=text(),start=raw.indexOf('  construction-integrity:');assert(start>0);
 for(const [from,to]of[[predicate,'true'],['actions: read','actions: write'],['persist-credentials: false','persist-credentials: true'],
  ['timeout-minutes: 90','timeout-minutes: 120'],['if: always()','if: success()'],['if-no-files-found: error','if-no-files-found: warn'],
  ['"$INTEGRITY_SELECTION" "$GITHUB_SHA"','"$INTEGRITY_SELECTION" main']]){
  const suffix=raw.slice(start);assert(suffix.includes(from));const changed=raw.slice(0,start)+suffix.replace(from,to);assert.notEqual(changed,raw);assert.throws(()=>validate(changed));
 }
});
test('real admission shell rejects mixed publication construction and integrity modes',()=>{
 const script=load(text()).jobs['input-policy'].steps[0].run;
 for(const [revision,development,selection,accepted]of[['','false','{}',true],['a'.repeat(40),'false','{}',false],['','true','{}',false],['','false','',true],['','true','',true]]){
  const r=spawnSync('/bin/bash',['--noprofile','--norc','-euo','pipefail','-c',script],{env:{PATH:process.env.PATH,SOURCE_REVISION:revision,
   DEVELOPMENT_ONLY:development,WORKFLOW_REVISION:'a'.repeat(40),INTEGRITY_SELECTION:selection},encoding:'utf8',timeout:5000});
  assert.ifError(r.error);assert.equal(r.signal,null);assert.equal(r.status===0,accepted);
 }
});
