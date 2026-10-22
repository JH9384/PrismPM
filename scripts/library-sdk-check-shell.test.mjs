// Recording Docker boundary tests only: no SDK execution/acceptance is claimed.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {createHash} from 'node:crypto';
import {chmodSync,copyFileSync,cpSync,existsSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {capture} from './library-sdk-check.mjs';
import {lockFixture,resultFixture,qualificationFixture} from './library-sdk-fixture.mjs';
import {historicalLock,migrationChecks,expectedMigrationProcesses} from '../sdk/migration-qualification.mjs';

const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const sourceAuthority={archive_sha256:createHash('sha256').update(readFileSync(join(source,'vendor/lean4-prod/lean.tar'))).digest('hex'),toolchain:readFileSync(join(source,'lean-toolchain'),'utf8').trim()};
const revision='a'.repeat(40),sdk=lockFixture(sourceAuthority),image=sdk.image;
const metadata=await sdk.metadataEvidence();
const capturedSource=capture(source,revision);
const dockerMock=`#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),args=process.argv.slice(2),root=process.env.RECORDED_SOURCE,log=process.env.RECORDED_CALLS;
const earlier=fs.existsSync(log)?fs.readFileSync(log,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse):[];
fs.appendFileSync(log,JSON.stringify(args)+'\\n');
const id='c'.repeat(64);
if(args[0]==='pull')process.exit(0);
if(args[0]==='image'&&args[1]==='inspect'){console.log(JSON.stringify([{Os:'linux',Architecture:process.arch==='x64'?'amd64':'arm64',RepoDigests:[process.env.RECORDED_IMAGE],Config:{Entrypoint:['/usr/local/bin/prismpm-devcontainer-init'],Volumes:null,Labels:{'org.opencontainers.image.revision':process.env.RECORDED_REVISION,'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM','org.opencontainers.image.version':'0.3.0'}}}]));process.exit(0);}
if(args[0]==='container'&&args[1]==='create'){console.log(id);process.exit(0);}
if(args[0]==='container'&&args[1]==='cp'){
 const from=args[2].split(':').slice(1).join(':'),prefix='/opt/prismpm/share/conformance-root/';
 if(from==='/opt/prismpm/share/inventory.json'){fs.copyFileSync(process.env.RECORDED_INVENTORY,args[3]);process.exit(0);}
 if(from==='/opt/prismpm/share/standards.lock'){fs.copyFileSync(path.join(root,'standards.lock'),args[3]);process.exit(0);}
 const input=from.startsWith(prefix)?path.join(root,from.slice(prefix.length)):from==='/usr/local/bin/prismpm-devcontainer-init'?path.join(root,'sdk/devcontainer-init.sh'):null;
 if(!input)process.exit(65);fs.cpSync(input,args[3],{recursive:true,verbatimSymlinks:true});process.exit(0);
}
if(args[0]==='container'&&args[1]==='start'){
 const created=earlier.filter(row=>row[0]==='container'&&row[1]==='create').at(-1);
 if(created.includes('acquire-lock')){process.stdout.write(process.env.RECORDED_LOCK_OUTPUT===undefined?fs.readFileSync(process.env.RECORDED_ACQUISITION):process.env.RECORDED_LOCK_OUTPUT);process.exit(Number(process.env.RECORDED_START_STATUS||0));}
 if(created.includes('sdk/exporter-seed-custody.integration.mjs')){process.stdout.write(process.env.RECORDED_CUSTODY_OUTPUT===undefined?'{"scope":"filesystem-custody-only","checks":6,"status":"passed"}':process.env.RECORDED_CUSTODY_OUTPUT);process.exit(Number(process.env.RECORDED_CUSTODY_STATUS||0));}
 if(!fs.readFileSync(0).equals(fs.readFileSync(process.env.RECORDED_LOCK)))process.exit(66);
 if(created.includes('sdk/exporter-qualification.mjs')){process.stdout.write(process.env.RECORDED_COMPILER_OUTPUT===undefined?fs.readFileSync(process.env.RECORDED_COMPILER):process.env.RECORDED_COMPILER_OUTPUT);process.exit(Number(process.env.RECORDED_COMPILER_STATUS||0));}
 process.stdout.write(process.env.RECORDED_OUTPUT===undefined?fs.readFileSync(process.env.RECORDED_RESULT):process.env.RECORDED_OUTPUT);process.exit(Number(process.env.RECORDED_RUNTIME_STATUS||0));
}
if(args[0]==='container'&&args[1]==='inspect'){console.log(process.env.RECORDED_EXIT_STATUS||'0');process.exit(0);}
if(args[0]==='container'&&args[1]==='rm')process.exit(0);
process.exit(64);
`;

function fixture(t){
 const work=mkdtempSync(join(tmpdir(),'prismpm-library-shell-'));t.after(()=>rmSync(work,{recursive:true,force:true}));
 const root=join(work,'source');mkdirSync(root);
 for(const row of capturedSource.files){const destination=join(root,row.path);mkdirSync(dirname(destination),{recursive:true});if(row.kind==='directory')mkdirSync(destination,{recursive:true});else if(row.kind==='file')copyFileSync(join(source,row.path),destination);else symlinkSync(row.target,destination);}
 writeFileSync(join(root,'standards.lock'),sdk.standards);
 const architecture=process.arch==='x64'?'amd64':'arm64';
 writeFileSync(join(work,'lock.json'),sdk.bytes);
 const historical=historicalLock();
 writeFileSync(join(work,'acquisition.json'),sdk.encode({lock:sdk.lock,metadata,migration:{
  schema:'prismpm/installed-lock-migration/2',platform:'linux/'+architecture,historical_source:historical.authority,
  historical_sha256:historical.source.sha256,target_sha256:sdk.hash(sdk.bytes),checks:migrationChecks,
  processes:expectedMigrationProcesses(sdk.lock,'linux/'+architecture).map(row=>({...row,stdout_sha256:'1'.repeat(64),stderr_sha256:'2'.repeat(64)})),
  proposal:{schema:'prismpm/sdk-lock-migration/1',compatibility_review:'required',generated_output_diff:'required',security_review:'required',
   patch:[{op:'test',path:'',value:JSON.parse(historical.document)},{op:'replace',path:'',value:sdk.lock}]}}}));
 writeFileSync(join(work,'inventory.json'),sdk.lock.platforms.find(row=>row.platform==='linux/'+architecture).inventory_document);
 writeFileSync(join(work,'compiler.json'),JSON.stringify(qualificationFixture(sdk.binding(architecture),sourceAuthority)));
 writeFileSync(join(work,'result.json'),JSON.stringify(resultFixture(sdk.binding(architecture),{
  archive_sha256:createHash('sha256').update(readFileSync(join(root,'vendor/lean4-prod/lean.tar'))).digest('hex'),toolchain:readFileSync(join(root,'lean-toolchain'),'utf8').trim()})));
 const bin=join(work,'bin');mkdirSync(bin);writeFileSync(join(bin,'docker'),dockerMock);chmodSync(join(bin,'docker'),0o755);
 writeFileSync(join(bin,'git'),'#!/usr/bin/env node\nconst args=process.argv.slice(2);if(args.includes("rev-parse"))console.log(process.env.RECORDED_REVISION);else if(!args.includes("status"))process.exit(64);\n');chmodSync(join(bin,'git'),0o755);
 return{work,root,env:{...process.env,DOCKER_CONFIG:join(work,'absent-credentials'),PATH:bin+':'+process.env.PATH,RECORDED_SOURCE:root,RECORDED_CALLS:join(work,'calls.jsonl'),RECORDED_IMAGE:image,RECORDED_REVISION:revision,RECORDED_LOCK:join(work,'lock.json'),RECORDED_ACQUISITION:join(work,'acquisition.json'),RECORDED_INVENTORY:join(work,'inventory.json'),RECORDED_COMPILER:join(work,'compiler.json'),RECORDED_RESULT:join(work,'result.json')}};
}
async function execute(context){
 try{
  const result=await new Promise(resolve=>execFile('bash',[join(context.root,'scripts/library-sdk-check.sh'),image,revision],{encoding:'utf8',env:context.env,timeout:30000,maxBuffer:1024*1024},(error,stdout,stderr)=>resolve({status:error?.code??0,signal:error?.signal??null,error:error&&typeof error.code!=='number'?error:undefined,stdout,stderr})));
  assert.equal(result.error,undefined,'shell transport must complete within its resource bounds');assert.equal(result.signal,null,'shell transport must exit without a signal');
  const calls=readFileSync(context.env.RECORDED_CALLS,'utf8').trim().split('\n').map(JSON.parse);
  const retainedPath=join(context.root,'target/library-sdk-evidence/linux-'+(process.arch==='x64'?'amd64':'arm64'));
  let retained;
  if(existsSync(join(retainedPath,'evidence.json'))) {
    retained=JSON.parse(readFileSync(join(retainedPath,'evidence.json')));
    for(const row of retained.files) {const bytes=readFileSync(join(retainedPath,row.path));assert.equal(bytes.length,row.byte_length);assert.equal(sdk.hash(bytes),row.sha256);}
  }
  return{result,calls,retained};
 }finally{rmSync(context.work,{recursive:true,force:true});}
}
async function accepted(context){
 const {result,calls,retained}=await execute(context);assert.equal(result.status,0,result.stderr.slice(-2000));
 assert.equal(retained.schema,'prismpm/sdk-native-metadata-evidence/1');assert.equal(retained.scope,'original-native-gate-inputs-only');
 assert.equal(retained.source_revision,revision);assert.equal(retained.sdk_image,image);
 assert.deepEqual(retained.files.map(row=>row.path),['acquisition.json','compiler.json','custody.json','image.json','inventory.json','result.json','source.json','standards.lock']);
 const created=calls.filter(row=>row[0]==='container'&&row[1]==='create');assert.equal(created.length,5);
 const online=created[1];for(const arg of ['--read-only','--network','bridge','--cap-drop','ALL','--security-opt','no-new-privileges','--memory','512m','--pids-limit','128','DOCKER_CONFIG=/run/prismpm-registry-auth'])assert.ok(online.includes(arg),arg);
 assert.deepEqual(online.slice(-4),[image,'scripts/library-sdk-check.mjs','acquire-lock',image]);
 assert.equal(online[online.indexOf('--entrypoint')+1],'node');
 assert.equal(online[online.indexOf('--user')+1],process.getuid()+':'+process.getgid());
 const mount=online.indexOf('--mount');
 if(mount>=0)assert.equal(online[mount+1],'type=bind,source='+context.env.DOCKER_CONFIG+',target=/run/prismpm-registry-auth,readonly');
 assert.ok(!online.includes('PRISMPM_EPHEMERAL_HOME=1'));
 const compiler=created[2],custody=created[3];
 for(const phase of [compiler,custody]){for(const arg of ['--read-only','--network','none','--cap-drop','ALL','--security-opt','no-new-privileges'])assert.ok(phase.includes(arg));assert.equal(phase[phase.indexOf('--entrypoint')+1],'node');assert.ok(!phase.includes('--mount')&&!phase.includes('--volume'));}
 assert.equal(compiler[compiler.indexOf('--user')+1],'1000:1000');
 assert.ok(compiler.includes('/tmp:rw,exec,nosuid,nodev,size=768m')&&compiler.includes('/work:rw,exec,nosuid,nodev,size=2g,mode=1777'));
 assert.deepEqual(compiler.slice(-4),[image,'sdk/exporter-qualification.mjs','run',image]);
 assert.equal(custody[custody.indexOf('--user')+1],'0:0');
 assert.ok(custody.includes('/opt/prismpm-custody:rw,noexec,nosuid,nodev,size=16m,mode=0700'));
 assert.deepEqual(custody.slice(-2),[image,'sdk/exporter-seed-custody.integration.mjs']);
 const runtime=created[4];for(const arg of ['--interactive','--read-only','--network','none','--user','1000:1000','--cap-drop','ALL','--security-opt','no-new-privileges','--tmpfs','/tmp:rw,exec,nosuid,nodev,size=8g','PRISMPM_EPHEMERAL_HOME=1','CARGO_NET_OFFLINE=true'])assert.ok(runtime.includes(arg),arg);
 assert.ok(!runtime.includes('--mount')&&!runtime.includes('--volume')&&!runtime.includes('--entrypoint'));
 assert.deepEqual(runtime.slice(-5),[image,'node','scripts/library-sdk-check.mjs','run',image]);
 const start=calls.findIndex(row=>row[0]==='container'&&row[1]==='start');assert.ok(start>=0,'runtime must actually start');
 const inspected=calls.findIndex(row=>row[0]==='container'&&row[1]==='inspect');assert.ok(inspected>start,'runtime exit must be inspected after execution');
 const starts=calls.flatMap((row,index)=>row[0]==='container'&&row[1]==='start'?[index]:[]);assert.equal(starts.length,4);
 for(const index of starts)assert.equal(calls[index+1][1],'inspect');
 for(const index of [1,3])assert.ok(calls[starts[index]].includes('--interactive'));
 assert.ok(calls.some(row=>row[0]==='container'&&row[1]==='cp'&&row[2].endsWith('/scripts/library-sdk-check.test.mjs')));
 assert.match(result.stdout,/native-library SDK closure passed/);
}

// Each case owns its full source closure. Bound concurrency and delete each
// fixture promptly instead of retaining dozens of source copies until test end.
async function cases(tasks){
 let next=0;
 const outcomes=await Promise.allSettled(Array.from({length:2},async()=>{while(next<tasks.length){const run=tasks[next++];await run();}}));
 for(const outcome of outcomes)if(outcome.status==='rejected')throw outcome.reason;
}
test('real shell invokes the confined Docker sequence and inspects actual terminal status',async t=>{
 const tasks=[()=>accepted(fixture(t)),()=>{const context=fixture(t);mkdirSync(context.env.DOCKER_CONFIG);return accepted(context);}];
 for(const [field,outputs] of [
  ...['RECORDED_START_STATUS','RECORDED_RUNTIME_STATUS','RECORDED_EXIT_STATUS','RECORDED_COMPILER_STATUS','RECORDED_CUSTODY_STATUS'].map(field=>[field,['7']]),
  ['RECORDED_LOCK_OUTPUT',['', '{}',sdk.bytes.toString()+'\n']],
  ['RECORDED_OUTPUT',['', 'TAP version 13\n1..0 # SKIP\n','{}']],
  ['RECORDED_COMPILER_OUTPUT',['{}']],['RECORDED_CUSTODY_OUTPUT',['{}']],
 ])for(const output of outputs)tasks.push(async()=>{const context=fixture(t);context.env[field]=output;const {result}=await execute(context);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/closure passed/);});
 for(const transform of [
  raw=>'{"lock":{},'+raw.slice(1),raw=>'{"\\u006cock":{},'+raw.slice(1),
  raw=>JSON.stringify(JSON.parse(raw),null,2),raw=>raw+'\n',
 ])tasks.push(async()=>{
  const context=fixture(t),raw=readFileSync(join(context.work,'acquisition.json'),'utf8');
  context.env.RECORDED_LOCK_OUTPUT=transform(raw);
  const {result}=await execute(context);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/closure passed/);
 });
 for(const mutate of [value=>delete value.migration.historical_source,
  value=>{value.migration.schema='prismpm/installed-lock-migration/1';delete value.migration.historical_source;},
  value=>value.migration.historical_source.blob_oid='0'.repeat(40),
  value=>value.migration.historical_source.tree_sha256='0'.repeat(64),
  value=>value.migration.historical_source.source_document_sha256='0'.repeat(64)])tasks.push(async()=>{
   const context=fixture(t),path=join(context.work,'acquisition.json');
   const value=JSON.parse(readFileSync(path));mutate(value);writeFileSync(path,JSON.stringify(value));
   const {result}=await execute(context);assert.notEqual(result.status,0);assert.doesNotMatch(result.stdout,/closure passed/);
  });
 await cases(tasks);
});

test('real shell orchestration tests reject removed execution and changed runtime entrypoint mutants',async t=>{
 await cases([
  ['docker container start --attach "$container" > "$sdk_work/acquisition.json"','true > "$sdk_work/acquisition.json"'],
  ['docker container start --attach --interactive "$container" < "$sdk_work/lock.json" > "$sdk_work/result.json"','true > "$sdk_work/result.json"'],
  ['docker container start --attach --interactive "$container" < "$sdk_work/lock.json" > "$sdk_work/compiler.json"','true > "$sdk_work/compiler.json"'],
  ['docker container start --attach "$container" > "$sdk_work/custody.json"','true > "$sdk_work/custody.json"'],
  ['--entrypoint node --user "$(id -u):$(id -g)"','--user "$(id -u):$(id -g)"'],
  ['--entrypoint node --user 1000:1000','--entrypoint node --user 0:0'],
  ['/tmp:rw,exec,nosuid,nodev,size=768m','/tmp:rw,exec,nosuid,nodev,size=8g'],
  ['node scripts/library-sdk-check.mjs run "$image")','node scripts/browser-api-sdk-check.mjs run "$image")'],
 ].map(([before,after])=>async()=>{const context=fixture(t),path=join(context.root,'scripts/library-sdk-check.sh'),script=readFileSync(path,'utf8');assert.equal(script.split(before).length,2);writeFileSync(path,script.replace(before,after));await assert.rejects(()=>accepted(context),error=>error.code==='ERR_ASSERTION'&&!error.message.includes('shell transport'));}));
});
