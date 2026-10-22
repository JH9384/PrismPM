// Boundary/parser tests only. Synthetic values never satisfy installed CLI
// acceptance; that requires product-sdk-check.sh against the rebuilt image.
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {chmodSync,mkdtempSync,mkdirSync,readFileSync,rmSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import {bytes,canonical,capture,cli,command,productResult,sha,sourceRoots,testOutput,validateScans,validateSeededApplication,verifyResult,verifySource} from './product-sdk-check.mjs';
import {sourceAliases} from './library-sdk-check.mjs';
import {lockFixture,resultFixture,sourceAuthorityFixture,ownerFixture} from './library-sdk-fixture.mjs';

const image='ghcr.io/uor-foundation/prismpm-sdk@sha256:'+'a'.repeat(64),revision='b'.repeat(40);
const raw=value=>({status:0,signal:null,stdout:JSON.stringify(value),stderr:''});
const temporary=t=>{const root=mkdtempSync(join(tmpdir(),'prismpm-product-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
function source(root){
 for(const path of sourceRoots)if(!Object.hasOwn(sourceAliases,path))put(root,path+'/input','source');
 for(const [path,target] of Object.entries(sourceAliases)){
  const actual=resolve(dirname(join(root,path)),target);if(path.includes('/embedded/')){mkdirSync(dirname(actual),{recursive:true});writeFileSync(actual,'source');}
  mkdirSync(dirname(join(root,path)),{recursive:true});symlinkSync(target,join(root,path));
 }
}
const result=release=>({schema:'prismpm/product-release-result/1',reference:'ghcr.io/uor-foundation/prismpm-product-probe:'+release.toLowerCase(),
 product_digest:'sha256:'+'c'.repeat(64),release_digest:'sha256:'+(release==='A'?'d':'e').repeat(64),model_digest:'sha256:'+'f'.repeat(64),build_digest:'sha256:'+'1'.repeat(64),
 evidence_path:'.prism/releases/'+(release==='A'?'d':'e').repeat(64)+'/result.json'});
function completed(){
 const files=['app.css','app.js','index.html','prism_calculator.js','prism_calculator_bg.wasm','provenance.json'].map(path=>({path,digest:sha(path),size:Buffer.byteLength(path)}));
 return{schema:'prismpm/installed-product-cli-check/1',scope:'installed-cli-product-build-and-source-free-integrity',status:'passed',sdk_image:image,
  releases:['A','B'].map(release=>({release,release_digest:result(release).release_digest,model_digest:result(release).model_digest,build_digest:result(release).build_digest,
   files,tree_digest:sha(canonical(files)),checks:['source-free-proof-replay','exact-browser-export','missing-proof-refused','changed-proof-refused','restored-export']})),
  unclaimed:['sdk-release','crates.io-publication','producer-authorization','deployment','foundry-readiness']};
}

test('source closure binds actual model fixture, SDK implementation, registry and owning harness',t=>{
 const root=temporary(t);source(root);const before=capture(root,revision);verifySource(root,before);
 for(const path of ['tests/browser-system','examples/Calculator','scripts/product-sdk-check.mjs','scripts/product-sdk-check.sh','scripts/product-sdk-check.test.mjs']){
  assert(sourceRoots.includes(path));put(root,path+'/input','changed');assert.throws(()=>verifySource(root,before));put(root,path+'/input','source');
 }
 assert(sourceRoots.includes('vendor'));assert(sourceRoots.includes('sdk'));assert(sourceRoots.includes('standards.lock'));
});

test('source comparison refuses unbound extra files, symlinks and altered source identity',t=>{
 const root=temporary(t);source(root);const before=capture(root,revision);
 for(const mutation of [v=>v.files.pop(),v=>v.files.push(v.files[0]),v=>v.revision='main',v=>v.extra=true]){const value=structuredClone(before);mutation(value);assert.throws(()=>verifySource(root,value));}
 put(root,'tests/browser-system/extra','extra');assert.throws(()=>verifySource(root,before));rmSync(join(root,'tests/browser-system/extra'));
 const path=join(root,'scripts/product-sdk-check.mjs/input');rmSync(path);symlinkSync('/etc/hosts',path);assert.throws(()=>capture(root,revision));
});

test('captured evidence rejects symlinks, directories and over-bound bytes',t=>{
 const root=temporary(t);put(root,'data','real');assert.equal(bytes(join(root,'data'),4).toString(),'real');
 assert.throws(()=>bytes(join(root,'data'),3));assert.throws(()=>bytes(root));
 symlinkSync(join(root,'data'),join(root,'alias'));assert.throws(()=>bytes(join(root,'alias')));
});

test('owning test runner rejects skipped, missing or failed successful-shell TAP',()=>{
 const tap=['TAP version 13',...Array.from({length:19},(_,index)=>`ok ${index+1} - case ${index+1}`),
  '1..19','# tests 19','# suites 0','# pass 19','# fail 0','# cancelled 0','# skipped 0','# todo 0'].join('\n');
 testOutput({...raw({}),stdout:tap});
 for(const output of ['',tap.replace('# skipped 0','# skipped 1'),tap.replace('# tests 19','# tests 18'),tap.replace('ok 1 - case 1','ok 1 - case 1 # SKIP')])assert.throws(()=>testOutput({...raw({}),stdout:output}));
 assert.throws(()=>testOutput({...raw({}),stdout:tap,status:1}));
});

test('product invocation uses installed executable and exact locked release arguments',async()=>{
 let call;const launch=(...args)=>{call=args;return raw(result('A'));};
 const args=['build','--locked','--release','A','-t','ghcr.io/uor-foundation/prismpm-product-probe:a'];
 productResult(await cli('/tmp/owned-fixture',args,{schema:'prismpm/product-release-result/1'},launch),'A');
 assert.equal(call[0],'/usr/local/bin/prismpm');assert.deepEqual(call[1],['--project','/tmp/owned-fixture','--json',...args]);
 assert.equal(call[2].env.CARGO_NET_OFFLINE,'true');assert.equal(call[2].env.CARGO_TARGET_DIR,undefined);
 assert(call[2].timeout>0&&call[2].timeout<=1800000);assert(call[2].maxBuffer<=16*1024*1024);
 await cli('/tmp/owned-fixture',['fetch','--locked'],{},launch);assert.equal(call[2].env.CARGO_NET_OFFLINE,'false');
});

test('retained application regeneration requires source-bound native seed evidence, never cold fallback',()=>{
 for(const architecture of ['amd64','arm64']){
  const binding=lockFixture().binding(architecture),library=JSON.parse(resultFixture(binding).runs[2].manifest);
  const exporter=library.processes[7];exporter.tool='application-export';
  const generation=structuredClone(library.exporter_owner.phases[0].processes.slice(0,3));
  generation[0].tool='application-lean';generation[1].tool='application-exporter';generation[2]=exporter;
  const model=Buffer.from(canonical({application:{name:'Calculator',library_roots:['Probe.main']}}));
  const lexlean_manifest=Buffer.from(canonical({outputs:[{kind:'lean',path:'modules/Probe.lean'}]}));
  exporter.argv=['exe','prod-export','--module','Probe','--root','Probe.main','--ir-module','Calculator','--out','$APPLICATION_WORK/export'];
  const manifest={schema:'prismpm/application-verification-manifest/2',build_id:'a'.repeat(64),model_sha256:sha(model).slice(7),
   acceptance_sha256:'c'.repeat(64),lexlean_attestation_sha256:'d'.repeat(64),processes:[library.processes[1],...generation]};
  manifest.exporter_owner=ownerFixture(manifest,'application',generation);
  for(const phase of manifest.exporter_owner.phases)phase.lexlean_manifest_sha256=sha(lexlean_manifest).slice(7);
  const buildEvidence={model,lexlean_manifest,artifacts:structuredClone(manifest.exporter_owner.phases[0].artifacts)};
  const verify=value=>validateSeededApplication(Buffer.from(canonical(value)),manifest.build_id,'sha256:'+manifest.model_sha256,binding,sourceAuthorityFixture,buildEvidence);
  const actual=verify(manifest);assert.equal(actual.manifest,canonical(manifest));assert.equal(actual.manifest_sha256,sha(canonical(manifest)));
  for(const mutate of [v=>v.extra=true,v=>v.schema='prismpm/library-verification-manifest/1',v=>v.build_id='f'.repeat(64),
   v=>v.model_sha256='f'.repeat(64),v=>v.processes=[],v=>v.processes.push(v.processes[3]),v=>v.processes[3].tool='prod-export',
   v=>v.processes[3].argv=[],v=>v.processes[3].exit_code=1,v=>delete v.processes[3].exporter,
   v=>v.processes[3].exporter.acquisition={schema:'prismpm/exporter-acquisition/1',mode:'cold'},
   v=>v.processes[3].exporter.executable.sha256='f'.repeat(64),v=>v.processes[3].exporter.executable.mode=-1,
   v=>v.processes[3].exporter.source_archive_sha256='f'.repeat(64),
   ...['platform','inventory_sha256','manifest_sha256','archive_sha256','compiler_revision','toolchain','executable_sha256']
    .map(field=>v=>{v.processes[3].exporter.acquisition[field]='changed';}),
   v=>delete v.exporter_owner,v=>v.exporter_owner.phases.reverse(),v=>v.exporter_owner.phases.pop(),
   v=>v.exporter_owner.phases[0].artifacts[0].sha256='f'.repeat(64),
   v=>v.exporter_owner.phases[0].processes[2].exporter.source_archive_sha256='f'.repeat(64),
   v=>v.exporter_owner.phases[0].processes[2].exporter.acquisition.platform='linux/invalid',
   v=>v.exporter_owner.phases[0].processes[0].executable_sha256='f'.repeat(64),
   v=>v.exporter_owner.phases[1].processes[2].argv.push('--undeclared'),
   v=>{for(const phase of v.exporter_owner.phases)phase.processes[2].argv[5]='Foreign.main';v.processes[3].argv[5]='Foreign.main';},
   v=>{for(const phase of v.exporter_owner.phases)phase.artifacts[0].sha256='f'.repeat(64);},
   v=>{for(const phase of v.exporter_owner.phases)phase.lexlean_manifest_sha256='f'.repeat(64);},
  ]){
   const changed=structuredClone(manifest);mutate(changed);assert.throws(()=>verify(changed));
  }
  assert.throws(()=>validateSeededApplication(Buffer.from(canonical(manifest)+'\n'),manifest.build_id,'sha256:'+manifest.model_sha256,binding,sourceAuthorityFixture));
  assert.throws(()=>validateSeededApplication(Buffer.from(canonical(manifest)),manifest.build_id,'sha256:'+manifest.model_sha256,binding));
  assert.throws(()=>validateSeededApplication(Buffer.from(canonical(manifest)),manifest.build_id,'sha256:'+manifest.model_sha256,binding,sourceAuthorityFixture));
  for(const evidence of [{...buildEvidence,model:Buffer.from('{}')},{...buildEvidence,lexlean_manifest:Buffer.from('{}')},
   {...buildEvidence,artifacts:[]},{...buildEvidence,artifacts:[...buildEvidence.artifacts,{path:'extra',byte_length:0,sha256:'a'.repeat(64)}]}]){
   assert.throws(()=>validateSeededApplication(Buffer.from(canonical(manifest)),manifest.build_id,'sha256:'+manifest.model_sha256,binding,sourceAuthorityFixture,evidence));
  }
 }
});

test('CLI boundaries require actual success or exact modeled failure and exit class',async()=>{
 const expected={schema:'prismpm/product-release-result/1'};
 for(const invalid of [{...raw(result('A')),status:1},{...raw(result('A')),signal:'SIGTERM'},{...raw(result('A')),error:new Error('deadline')},raw({schema:'different'}),{...raw(result('A')),stdout:'noise\n{}'}])await assert.rejects(()=>cli('/tmp/project',['build','--locked'],expected,()=>invalid));
 for(const [code,exit] of [['PP5401',4],['PP6101',5]]){
  const error={schema:'prismpm/error-result/1',diagnostic:{code}};
  await cli('/tmp/project',['lock','check'],{code,exit},()=>({...raw(error),status:exit}));
  for(const invalid of [raw(error),{...raw(error),status:101},{...raw({...error,diagnostic:{code:'PP1001'}}),status:exit}])await assert.rejects(()=>cli('/tmp/project',['lock','check'],{code,exit},()=>invalid));
 }
 await assert.rejects(()=>command('prismpm',[],{},()=>raw({})),/absolute/);
});

test('actual subprocess transport preserves argv, cwd, failure and bounded output',async t=>{
 const root=temporary(t),actual=await command(process.execPath,['-e','process.stdout.write(JSON.stringify({cwd:process.cwd(),args:process.argv.slice(1)}))','a b',';literal'],{cwd:root,timeout:5000});
 assert.deepEqual(JSON.parse(actual.stdout),{cwd:root,args:['a b',';literal']});
 await assert.rejects(()=>command(process.execPath,['-e','process.exit(7)'],{timeout:5000}),/exit status/);
 await assert.rejects(()=>command(process.execPath,['-e','process.kill(process.pid,"SIGTERM")'],{timeout:5000}),/command terminated/);
 await assert.rejects(()=>command(process.execPath,['-e','process.stdout.write("x".repeat(65536));setInterval(()=>{},1000)'],{timeout:5000,maximum:64}),/output exceeds/);
 await assert.rejects(()=>command('/missing-installed-tool',[],{timeout:5000}),/ENOENT/);
});

test('actual deadline kills descendant process group and cannot hang on retained pipes',async t=>{
 const root=temporary(t),pidFile=join(root,'descendant');
 const source='const {spawn}=require("node:child_process");const fs=require("node:fs");const child=spawn(process.execPath,["-e","setTimeout(()=>{},6000)"],{stdio:["ignore",1,2]});fs.writeFileSync(process.argv[1],String(child.pid));setInterval(()=>{},1000)';
 const before=Date.now();await assert.rejects(()=>command(process.execPath,['-e',source,pidFile],{timeout:1000}),/timed out/);
 assert(Date.now()-before<5000,'deadline must not wait for descendant pipe closure');
 const pid=Number(readFileSync(pidFile,'utf8'));assert(Number.isSafeInteger(pid)&&pid>1);
 const state=()=>{try{return readFileSync('/proc/'+pid+'/stat','utf8').split(') ')[1][0];}catch(error){if(error.code==='ENOENT')return null;throw error;}};
 t.after(()=>{if(!['Z',null].includes(state()))try{process.kill(pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')throw error;}});
 for(let attempt=0;attempt<30&&!['Z',null].includes(state());attempt++)await new Promise(resolve=>setTimeout(resolve,10));
 assert(['Z',null].includes(state()),'timed-out descendant must not remain executing');
});

test('owning deadline test rejects direct-child-only termination mutant',t=>{
 const root=temporary(t),source=readFileSync(new URL('./product-sdk-check.mjs',import.meta.url),'utf8');
 const before="process.kill(-child.pid,'SIGKILL')";assert.equal(source.split(before).length,2);
 const module=source.replace(before,"child.kill('SIGKILL')")
  .replace("'./library-sdk-check.mjs'",JSON.stringify(new URL('./library-sdk-check.mjs',import.meta.url).href))
  .replace("'./browser-api-sdk-check.mjs'",JSON.stringify(new URL('./browser-api-sdk-check.mjs',import.meta.url).href))
  .replace("'../sdk/platform-lock.mjs'",JSON.stringify(new URL('../sdk/platform-lock.mjs',import.meta.url).href));
 put(root,'product-sdk-check.mjs',module);
 put(root,'product-sdk-check.test.mjs',readFileSync(new URL('./product-sdk-check.test.mjs',import.meta.url),'utf8')
  .replace("'./library-sdk-fixture.mjs'",JSON.stringify(new URL('./library-sdk-fixture.mjs',import.meta.url).href))
  .replace("'./library-sdk-check.mjs'",JSON.stringify(new URL('./library-sdk-check.mjs',import.meta.url).href)));
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--test','--test-name-pattern=actual deadline kills descendant',join(root,'product-sdk-check.test.mjs')],{env,encoding:'utf8',timeout:10000,maxBuffer:1024*1024});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1);assert.match(child.stdout,/timed-out descendant must not remain executing/);
});

test('product results close release, immutable digest and confined evidence bindings',()=>{
 for(const release of ['A','B']){
  productResult(result(release),release);
  for(const mutation of [v=>v.extra=true,v=>delete v.product_digest,v=>v.release_digest='latest',v=>v.reference+=';bad',v=>v.evidence_path='../outside',v=>v.schema='prismpm/build-result/1']){
   const value=result(release);mutation(value);assert.throws(()=>productResult(value,release));
  }
 }
 assert.throws(()=>productResult(result('A'),'B'));
});

test('actual image scan validation requires both immutable SDK children and measured scanner',()=>{
 const lock={sdk_image:image,sdk_index:'exact-index',platforms:['amd64','arm64'].map((arch,index)=>({platform:'linux/'+arch,manifest_digest:'sha256:'+String(index+1).repeat(64)}))};
 const inventory={commands:[{command:'osv-scanner',sha256:'3'.repeat(64)}]};
 const scans=lock.platforms.map(platform=>({schema:'prismpm/image-advisory-scan/1',reference:image,subject:image.split('@')[1],subject_kind:'sdk-image',platform:platform.platform,
  scanner_digest:'sha256:'+'3'.repeat(64),package_count:100,rejected_count:0,result:{results:[]},result_digest:sha(canonical({results:[]})),database_set:['locked-database'],database_set_digest:sha(canonical(['locked-database'])),
  index_manifest:'exact-index',platform_descriptor:{digest:platform.manifest_digest}}));
 validateScans(scans,lock,inventory);
 for(const mutation of [v=>v.pop(),v=>v[1].platform='linux/amd64',v=>v[0].reference='mutable',v=>v[0].subject='sha256:'+'9'.repeat(64),v=>v[0].scanner_digest='sha256:'+'9'.repeat(64),
  v=>v[0].package_count=0,v=>v[0].rejected_count=1,v=>v[0].result.results.push('changed'),v=>v[0].database_set.push('changed'),v=>v[0].index_manifest='changed',v=>v[0].platform_descriptor.digest='sha256:'+'0'.repeat(64)]){
  const value=structuredClone(scans);mutation(value);assert.throws(()=>validateScans(value,lock,inventory));
 }
});

test('final receipt accepts no missing journey, substituted image, extra file or expanded claim',()=>{
 verifyResult(completed(),image);
 for(const mutation of [v=>v.extra=true,v=>v.status='pending',v=>v.scope='sdk-release',v=>v.unclaimed.pop(),v=>v.releases.pop(),v=>v.releases.reverse(),v=>v.releases[1].release_digest=v.releases[0].release_digest,
  v=>v.releases[0].checks.pop(),v=>v.releases[0].files.pop(),v=>v.releases[0].files[0].size=-1,v=>v.releases[0].files[0].extra=true,v=>v.releases[0].tree_digest='sha256:'+'0'.repeat(64)]){
  const value=completed();mutation(value);assert.throws(()=>verifyResult(value,image));
 }
 assert.throws(()=>verifyResult(completed(),image.replace('a'.repeat(64),'b'.repeat(64))));
});

const wrapper=()=>readFileSync(new URL('./product-sdk-check.sh',import.meta.url),'utf8');
function confinedShell(script){
 const creates=script.match(/container=\$\(docker container create[\s\S]*?\)\n/g);assert.equal(creates?.length,4);
 for(const invocation of creates)assert(invocation.includes('--platform "linux/$architecture"'));
 assert(creates[0].includes('--entrypoint /usr/bin/true'));const [acquire,build,receiver]=creates.slice(1);
 for(const invocation of [acquire,build,receiver])for(const token of ['--user 1000:1000','--read-only','--cap-drop ALL','--security-opt no-new-privileges'])assert(invocation.includes(token),token);
 assert(acquire.includes('target=/var/run/docker.sock'));assert(acquire.includes('product-sdk-check.mjs acquire'));
 for(const [invocation,phase] of [[build,'build'],[receiver,'receive']]){
  assert(invocation.includes('--network none'));assert(!invocation.includes('/var/run/docker.sock'));assert(!invocation.includes('type=bind'));assert(!invocation.includes('--entrypoint'));
  assert(invocation.includes('product-sdk-check.mjs '+phase));
 }
 assert(build.includes('source=$project_volume'));assert(receiver.includes('source=$receiver_volume'));assert(!receiver.includes('source=$project_volume'));
 assert.equal((script.match(/docker container start --attach "\$container"/g)??[]).length,3);
 assert.equal((script.match(/\.State.ExitCode/g)??[]).length,3);
 assert(script.includes('first/.prism/oci" "$sdk_work/receiver/receiver/.prism/oci"'));
 assert(script.includes('node "$helper" result "$evidence/result.json" "$image"'));
 assert(script.includes('node "$helper" verify "$root" "$evidence/source.json"'));
 assert(script.includes('--cap-drop ALL --cap-add CHOWN --cap-add DAC_READ_SEARCH'));
 assert(script.includes('--entrypoint /usr/bin/chown "$image" -R 1000:1000 /tmp/prismpm-product-cli'));
}

test('real shell confines acquisition, offline build, and separate OCI-only receiver',()=>{
 confinedShell(wrapper());const checked=spawnSync('/bin/bash',['-n',new URL('./product-sdk-check.sh',import.meta.url).pathname],{encoding:'utf8',timeout:10000});assert.equal(checked.status,0,checked.stderr);
});

test('owning shell contract rejects missing executions, shared producer mount and network/socket leakage',()=>{
 const script=wrapper();
 for(const [before,after] of [
  ['docker container start --attach "$container"','true'],
  ['source=$receiver_volume,target=/tmp','source=$project_volume,target=/tmp'],
  ['--user 1000:1000 --read-only --network none --cap-drop ALL','--user 1000:1000 --read-only --cap-drop ALL'],
  ['node "$helper" result "$evidence/result.json" "$image"','true'],
 ]){assert(script.includes(before));assert.throws(()=>confinedShell(script.replace(before,after)));}
});

test('native release gate remains downstream of published images and mandatory alongside complete SDK VV',()=>{
 const source=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 const job=source.split('\n  installed-sdk:\n')[1]?.split('\n  native:\n')[0];assert(job);
 assert(job.includes('needs: [gate, images]'));assert(job.includes('os: ubuntu-24.04-arm'));assert(job.includes('arch: amd64'));assert(job.includes('arch: arm64'));
 const outer=job.indexOf('bash root-a/scripts/sdk-vv-outer.sh');
 assert(outer>=0&&outer<job.indexOf('product-sdk-check.sh'));
 assert(job.includes('node root-a/scripts/product-sdk-check.mjs tests'));
 assert(job.includes('bash root-a/scripts/product-sdk-check.sh "$(cat .shipped-image/sdk-image.txt)"'));
 assert(!job.includes('continue-on-error'));assert(!job.includes('if: false'));
 const script=readFileSync(new URL('./product-sdk-check.mjs',import.meta.url),'utf8');
 assert(script.includes("['build','--locked','--release',release,'-t'"));assert(script.includes("for(const name of ['first','second'])"));
 assert(script.includes("for(const release of ['A','B'])"));assert(script.includes("{code:'PP6101',exit:5}"));
 assert(script.includes("{code:'PP5401',exit:4}"));
});

test('actual owning CLI boundary test rejects a removed exit-status guard',t=>{
 const root=temporary(t),source=readFileSync(new URL('./product-sdk-check.mjs',import.meta.url),'utf8');
 const line=" assert.equal(child.status,status,'command exit status: '+program+' '+args.join(' ')+'\\n'+(child.stderr??'').slice(-4000));";
 assert.equal(source.split(line).length,2);
 const module=source.replace(line,'').replace("'./library-sdk-check.mjs'",JSON.stringify(new URL('./library-sdk-check.mjs',import.meta.url).href))
  .replace("'./browser-api-sdk-check.mjs'",JSON.stringify(new URL('./browser-api-sdk-check.mjs',import.meta.url).href))
  .replace("'../sdk/platform-lock.mjs'",JSON.stringify(new URL('../sdk/platform-lock.mjs',import.meta.url).href));
 put(root,'product-sdk-check.mjs',module);
 const testSource=readFileSync(new URL('./product-sdk-check.test.mjs',import.meta.url),'utf8')
  .replace("'./library-sdk-fixture.mjs'",JSON.stringify(new URL('./library-sdk-fixture.mjs',import.meta.url).href))
  .replace("'./library-sdk-check.mjs'",JSON.stringify(new URL('./library-sdk-check.mjs',import.meta.url).href));
 put(root,'product-sdk-check.test.mjs',testSource);
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const child=spawnSync(process.execPath,['--test','--test-name-pattern=CLI boundaries require actual success',join(root,'product-sdk-check.test.mjs')],{encoding:'utf8',env,timeout:10000,maxBuffer:1024*1024});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);assert.equal(child.status,1);assert.match(child.stdout,/Missing expected rejection/);
});

// Recording transport only: Docker and acquisition data are intentionally
// synthetic here. The actual helper independently validates result shape.
function shellFixture(t){
 const root=temporary(t),source=join(root,'source'),bin=join(root,'bin');mkdirSync(bin);mkdirSync(join(source,'scripts'),{recursive:true});
 put(source,'scripts/product-sdk-check.sh',wrapper());
 put(source,'sdk/devcontainer-init.sh',readFileSync(new URL('../sdk/devcontainer-init.sh',import.meta.url)));
 const logs=join(root,'calls.jsonl');
 const recording=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process');
const tool=path.basename(process.argv[1]),args=process.argv.slice(2),env=process.env;
let prior=[];if(fs.existsSync(env.RECORD_CALLS))prior=fs.readFileSync(env.RECORD_CALLS,'utf8').trim().split('\\n').filter(Boolean).map(JSON.parse);
fs.appendFileSync(env.RECORD_CALLS,JSON.stringify([tool,...args])+'\\n');
function put(p,v){fs.mkdirSync(path.dirname(p),{recursive:true});fs.writeFileSync(p,v);}
if(tool==='git'){if(args.includes('rev-parse'))console.log(env.RECORD_REVISION);else if(!args.includes('status'))process.exit(64);process.exit(0);}
if(tool==='stat'){console.log('1000');process.exit(0);}
if(tool==='node'){
 const mode=args[1];if(mode==='capture'){console.log('{}');process.exit(0);}if(['roots','verify','image'].includes(mode))process.exit(0);
 if(mode==='lock'){console.log('{}');process.exit(0);}
 if(mode==='result'){const c=cp.spawnSync(env.RECORD_NODE,[env.RECORD_HELPER,...args.slice(1)],{stdio:'inherit'});process.exit(c.status);}
 process.exit(64);
}
if(tool!=='docker')process.exit(64);
if(args[0]==='pull'||args[0]==='run')process.exit(0);
if(args[0]==='image'&&args[1]==='inspect'){console.log('{}');process.exit(0);}
if(args[0]==='volume'){if(args[1]==='create')console.log(String(prior.filter(v=>v[0]==='docker'&&v[1]==='volume'&&v[2]==='create').length+1).repeat(64));process.exit(0);}
if(args[0]!=='container')process.exit(64);
if(args[1]==='create'){console.log(String(prior.filter(v=>v[0]==='docker'&&v[1]==='container'&&v[2]==='create').length+3).repeat(64));process.exit(0);}
if(args[1]==='rm')process.exit(0);
if(args[1]==='cp'){
 const from=args[2],to=args[3];if(to.includes(':/tmp/'))process.exit(0);
 if(from.endsWith('/usr/local/bin/prismpm-devcontainer-init')){fs.copyFileSync(path.join(env.RECORD_SOURCE,'sdk/devcontainer-init.sh'),to);process.exit(0);}
 if(from.endsWith('/.prism/oci')){fs.mkdirSync(to,{recursive:true});put(path.join(to,'index.json'),'{}');process.exit(0);}
 put(to,'{}');process.exit(0);
}
if(args[1]==='start'){
 const id=args.at(-1),creates=prior.filter(v=>v[0]==='docker'&&v[1]==='container'&&v[2]==='create'),phase=creates.at(-1).at(-1);
 if(env.RECORD_FAIL===phase)process.exit(7);
 console.log(phase==='receive'?env.RECORD_RESULT:'{}');process.exit(0);
}
if(args[1]==='inspect'){console.log(env.RECORD_EXIT||'0');process.exit(0);}
process.exit(64);
`;
 for(const name of ['node','docker','git','stat']){put(bin,name,recording);chmodSync(join(bin,name),0o755);}
 return{root,source,env:{...process.env,PATH:bin+':'+process.env.PATH,RECORD_CALLS:logs,RECORD_SOURCE:source,RECORD_REVISION:revision,RECORD_RESULT:JSON.stringify(completed()),
  RECORD_NODE:process.execPath,RECORD_HELPER:new URL('./product-sdk-check.mjs',import.meta.url).pathname}};
}
function shellRun(context){
 const child=spawnSync('/bin/bash',[join(context.source,'scripts/product-sdk-check.sh'),image,revision,join(context.root,'evidence')],{env:context.env,encoding:'utf8',timeout:20000,maxBuffer:1024*1024});
 assert.equal(child.error,undefined);assert.equal(child.signal,null);
 const calls=readFileSync(context.env.RECORD_CALLS,'utf8').trim().split('\n').map(JSON.parse);return{child,calls};
}
test('actual shell starts all three stages, checks exit status, and sends only OCI to new receiver',t=>{
 const context=shellFixture(t),{child,calls}=shellRun(context);assert.equal(child.status,0,child.stderr);
 const creates=calls.filter(row=>row[0]==='docker'&&row[1]==='container'&&row[2]==='create');assert.equal(creates.length,4);
 assert.deepEqual(creates.slice(1).map(row=>row.at(-1)),['acquire','build','receive']);
 const starts=calls.filter(row=>row[0]==='docker'&&row[1]==='container'&&row[2]==='start');assert.equal(starts.length,3);
 assert.equal(calls.filter(row=>row[0]==='docker'&&row[1]==='container'&&row[2]==='inspect').length,3);
 const producer=creates[2],receiver=creates[3];assert(producer.includes('--network'));assert(receiver.includes('none'));
 assert(receiver.some(arg=>arg.includes('source='+ '2'.repeat(64))));assert(!receiver.some(arg=>arg.includes('source='+ '1'.repeat(64))));
 const copies=calls.filter(row=>row[0]==='docker'&&row[1]==='container'&&row[2]==='cp');assert(copies.some(row=>row[3].endsWith('/first/.prism/oci')));
 assert.match(child.stdout,/installed product CLI gate passed/);
});

test('actual shell rejects acquisition/build/receiver failures, absent JSON and bad terminal status',t=>{
 for(const phase of ['acquire','build','receive']){const context=shellFixture(t);context.env.RECORD_FAIL=phase;const {child}=shellRun(context);assert.notEqual(child.status,0);assert.doesNotMatch(child.stdout,/gate passed/);}
 for(const invalid of ['', '{}', JSON.stringify({...completed(),status:'pending'})]){const context=shellFixture(t);context.env.RECORD_RESULT=invalid;const {child}=shellRun(context);assert.notEqual(child.status,0);assert.doesNotMatch(child.stdout,/gate passed/);}
 const context=shellFixture(t);context.env.RECORD_EXIT='7';const {child}=shellRun(context);assert.notEqual(child.status,0);assert.doesNotMatch(child.stdout,/gate passed/);
});
