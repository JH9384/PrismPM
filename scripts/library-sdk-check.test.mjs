import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {cpSync,mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,renameSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname,join,resolve} from 'node:path';
import {test} from 'node:test';
import {capture,verifySource,sourceRoots,sourceAliases,cli,readHistoricalLibraryEvidence,checkAccepted as checkAcceptedWithAuthority,mutateModule,tree,verifyImage,verifyResult,testOutput,validateCapturedLock} from './library-sdk-check.mjs';
import {lockFixture,resultFixture,sourceAuthorityFixture} from './library-sdk-fixture.mjs';
const checkAccepted=(project,receipt)=>readHistoricalLibraryEvidence(project,receipt,'3'.repeat(64));

const revision='a'.repeat(40),image='ghcr.io/uor-foundation/prismpm-sdk@sha256:'+'b'.repeat(64);
const temporary=t=>{const root=mkdtempSync(join(tmpdir(),'prismpm-library-gate-test-'));t.after(()=>rmSync(root,{recursive:true,force:true}));return root;};
const put=(root,path,bytes)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),bytes);};
function source(root){
 for(const path of sourceRoots)if(!Object.hasOwn(sourceAliases,path))put(root,path+'/input','source');
 for(const [path,target] of Object.entries(sourceAliases)){
  const full=join(root,path);mkdirSync(dirname(full),{recursive:true});
  if(path.includes('/embedded/')){const actual=resolve(dirname(full),target);mkdirSync(dirname(actual),{recursive:true});writeFileSync(actual,'bound alias target');}
  symlinkSync(target,full);
 }
}
const result=value=>({status:0,signal:null,stdout:JSON.stringify(value),stderr:''});
const error=(code,message)=>({status:code==='PP6101'?5:1,signal:null,stdout:JSON.stringify({schema:'prismpm/error-result/1',diagnostic:{code,message,primary:null,labels:[],notes:[],help:[],causes:[]}}),stderr:''});

test('closed shipped-library source binding includes implementation, fixtures, schemas and gate itself',t=>{
 const root=temporary(t);source(root);const expected=capture(root,revision);verifySource(root,expected);
 for(const path of ['crates/prismpm/src','crates/prismpm/schemas','tests/fixtures/library/native-library/project','scripts/library-sdk-check.mjs','scripts/library-sdk-check.test.mjs',
  'scripts/sdk-command-owner.mjs','scripts/sdk-command-owner.py',
  'scripts/hologram-source-pins.mjs','scripts/hologram-source-pins.test.mjs','crates/prismpm/tests/hologram_interop.rs',
  'tests/holo-codec-oracle/Cargo.toml','tests/holo-codec-oracle/Cargo.lock']){
  assert.ok(sourceRoots.includes(path));put(root,path+'/input','mutated');assert.throws(()=>verifySource(root,expected),/source closure/);put(root,path+'/input','source');
 }
 put(root,'crates/prismpm/src/nested/target/extra','ordinary source');assert.throws(()=>verifySource(root,expected),/source closure/);
});

test('source capture refuses symlinks, missing members and duplicate or altered evidence',t=>{
 const root=temporary(t);source(root);const expected=capture(root,revision);
 for(const change of [v=>v.files.pop(),v=>v.files.push(v.files[0]),v=>v.files.reverse(),v=>v.files[0].sha256='c'.repeat(64),v=>v.extra=true]){
  const changed=structuredClone(expected);change(changed);assert.throws(()=>verifySource(root,changed));
 }
 const path=join(root,sourceRoots[0]+'/input');rmSync(path);assert.throws(()=>verifySource(root,expected));symlinkSync('/etc/hosts',path);assert.throws(()=>capture(root,revision),/regular|symlink/);
 assert.throws(()=>capture(root,'main'));
});

test('only the exact reviewed source aliases and their canonical target bytes are accepted',t=>{
 const root=temporary(t);source(root);const expected=capture(root,revision),path=join(root,'crates/prismpm/model');
 rmSync(path);symlinkSync('../../schemas',path);assert.throws(()=>capture(root,revision),/changed source alias/);rmSync(path);symlinkSync('../../model',path);
 put(root,'tests/hologram-oracle/Cargo.lock','changed target');assert.throws(()=>verifySource(root,expected),/source closure/);
});

test('the immutable installed image must identify the exact current native source',()=>{
 const base=[{Os:'linux',Architecture:'amd64',RepoDigests:[image],Config:{Entrypoint:['/usr/local/bin/prismpm-devcontainer-init'],Volumes:null,Labels:{'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM','org.opencontainers.image.version':'0.3.0'}}}];
 verifyImage(base,image,'amd64',revision);
 for(const change of [v=>v[0].Architecture='arm64',v=>v[0].Config.Labels['org.opencontainers.image.revision']='c'.repeat(40),v=>v[0].RepoDigests=[],v=>v[0].Config.Volumes={'/opt/prismpm':{}}]){const bad=structuredClone(base);change(bad);assert.throws(()=>verifyImage(bad,image,'amd64',revision));}
 assert.throws(()=>verifyImage(base,'ghcr.io/uor-foundation/prismpm-sdk:latest','amd64',revision));
});

test('CLI transport invokes the installed executable and rejects failed or malformed success',()=>{
 const valid={schema:'prismpm/check-result/1',semantic_id:'a'.repeat(64),snapshot_id:'b'.repeat(64),model_id:'c'.repeat(64),entity_count:0};
 let called;const launch=(...args)=>{called=args;return result(valid);};
 cli('/tmp/fixture',['check'],{schema:'prismpm/check-result/1'},launch);
 assert.equal(called[0],'/usr/local/bin/prismpm');assert.deepEqual(called[1],['--project','/tmp/fixture','--json','check']);
 assert.equal(called[2].env.CARGO_NET_OFFLINE,'true');assert.ok(called[2].timeout>0);assert.ok(called[2].maxBuffer<=16*1024*1024);
 for(const bad of [{...result(valid),status:1},{...result(valid),signal:'SIGTERM'},result({schema:'prismpm/check-result/1'}),result({...valid,extra:true}),result({...valid,entity_count:-1}),result({schema:'prismpm/verify-result/1'}),{...result({}),stdout:'noise\n{}'}, {...result({}),error:new Error('deadline')}])assert.throws(()=>cli('/tmp/fixture',['check'],{schema:'prismpm/check-result/1'},()=>bad));
 const buildId='d'.repeat(64),attestation='e'.repeat(64);
 for(const success of [valid,{schema:'prismpm/build-result/1',build_id:buildId,source_id:'a'.repeat(64),semantic_id:'b'.repeat(64),model_path:'.prism/build/'+buildId+'/model.prism.json',manifest_path:'.prism/build/'+buildId+'/manifest.json'},{schema:'prismpm/verify-result/1',build_id:buildId,attestation_id:attestation,verified_root:'.prism/verified/'+attestation}]){
  const expected={schema:success.schema};cli('/tmp/fixture',['check'],expected,()=>result(success));
  for(const field of Object.keys(success)){const changed={...success};delete changed[field];assert.throws(()=>cli('/tmp/fixture',['check'],expected,()=>result(changed)));}
  assert.throws(()=>cli('/tmp/fixture',['check'],expected,()=>result({...success,extra:true})));
 }
});

test('negative CLI probes require the owning diagnostic and expected exit class',()=>{
 cli('/tmp/fixture',['check'],{code:'PP2001',message:'facet closure is not exact'},()=>error('PP2001','facet closure is not exact'));
 cli('/tmp/fixture',['verify'],{code:'PP5006'},()=>error('PP5006','modeled acceptance failed'));
 cli('/tmp/fixture',['build','--locked','-t','ghcr.io/uor-foundation/prismpm-library-probe:0.1.0'],{code:'PP6101'},()=>error('PP6101','native library cannot release'));
 for(const bad of [result({schema:'prismpm/error-result/1',diagnostic:{code:'PP2001',message:'facet closure is not exact'}}),error('PP1001','facet closure is not exact'),error('PP2001','different failure'),{...error('PP2001','facet closure is not exact'),status:101}])assert.throws(()=>cli('/tmp/fixture',['check'],{code:'PP2001',message:'facet closure is not exact'},()=>bad));
 const root='LibraryProbe.Probe.acceptance',expected={code:'PP5006',assertion:root};
 const panic="native-library-std-acceptance exited 101: stdout=\"\"; stderr=\"\\nthread 'main' (123) panicked at src/main.rs:4:1:\\n"+root+'\\nnote: run with `RUST_BACKTRACE=1` environment variable to display a backtrace\\n"';
 for(const message of [panic,panic.replace(' (123)','')])
  cli('/tmp/fixture',['verify'],expected,()=>error('PP5006',message));
 for(const message of ['native modeled acceptance transcript differs','native-library-std-acceptance timed out',
  'native-library-std-acceptance exited 101: stdout=""; stderr="error[E0308]: could not compile"',
  panic.replace(root,'wrongRoot'),panic.replace(root,'wrongRoot\\n'+root),
  panic.replace('(123)','(not-a-pid)'),panic.replace('src/main.rs:4:1','src/other.rs:4:1'),
  panic.replace('src/main.rs:4:1','src/main.rs:x:1'),panic.replace('exited 101','exited 1'),
  panic.replace('std-acceptance','no_std-acceptance'),panic+' error[E0308]: could not compile'])
  assert.throws(()=>cli('/tmp/fixture',['verify'],expected,()=>error('PP5006',message)),
   'a build, transport, wrong-root or transcript failure cannot qualify the modeled assertion negative');
});

test('source mutation preserves canonical LexLean module structure and changes the real identity body',t=>{
 const root=temporary(t),path='src/Probe.lex.tex',before='\\semanticdata{{"declarations":[{"body":{"kind":"var","name":"value"},"name":"identity"}]}}\n';put(root,path,before);
 mutateModule(root,module=>{module.declarations[0].body={right:{kind:'nat',value:'1'},left:{kind:'var',name:'value'},kind:'add'};});
 const after=readFileSync(join(root,path),'utf8');assert.match(after,/"body":\{"kind":"add","left"/);assert.notEqual(after,before);
 put(root,path,before+before);assert.throws(()=>mutateModule(root,()=>{}));
});

test('tree comparison includes empty directories, extra outputs and byte changes',t=>{
 const root=temporary(t);put(root,'source','original');const before=tree(root);mkdirSync(join(root,'unexpected'));assert.notDeepEqual(tree(root),before);rmSync(join(root,'unexpected'),{recursive:true});mkdirSync(join(root,'.prism'));assert.notDeepEqual(tree(root),before);rmSync(join(root,'.prism'),{recursive:true});put(root,'source','changed');assert.notDeepEqual(tree(root),before);symlinkSync('source',join(root,'alias'));assert.throws(()=>tree(root));
});

test('library evidence cannot be accepted without genuinely published closed artifacts',t=>{
 const root=temporary(t);for(const value of [{},{schema:'prismpm/verify-result/1',build_id:'a'.repeat(64),attestation_id:'b'.repeat(64),verified_root:'../../outside'},{schema:'prismpm/verify-result/1',build_id:'a'.repeat(64),attestation_id:'b'.repeat(64),verified_root:'.prism/verified/'+'b'.repeat(64)}])assert.throws(()=>checkAccepted(root,value));
});

test('outer acceptance refuses absent or partial run results and incomplete or skipped test suites',()=>{
 const fixture=lockFixture(),binding=fixture.binding('amd64'),value=resultFixture(binding);
 const verify=(value,authority=binding)=>verifyResult(value,authority,sourceAuthorityFixture);verify(value);
 for(const change of [v=>v.checks.pop(),v=>v.checks.reverse(),v=>v.extra=true,v=>v.scope='production-release',v=>v.build_id='mutable',
  v=>v.runs.pop(),v=>v.runs.reverse(),v=>v.runs[2].acquisition='cold',v=>v.runs[3].root=v.runs[2].root,
  v=>v.runs[2].manifest+=' ',v=>v.binding.inventory_sha256='f'.repeat(64),
  v=>delete v.acceptance_rejection,v=>v.acceptance_rejection.root='Other.Root',
  v=>v.acceptance_rejection.extra=true,v=>v.acceptance_rejection.result.diagnostic.code='PP5008',
  v=>v.acceptance_rejection.result.diagnostic.message='native modeled acceptance transcript differs',
  v=>v.acceptance_rejection.result.diagnostic.message=v.acceptance_rejection.result.diagnostic.message.replace('LibraryProbe.Probe.acceptance','Other.Root'),
  v=>v.acceptance_rejection.result.diagnostic.causes.push({code:'unaccepted'})]){
  const bad=structuredClone(value);change(bad);assert.throws(()=>verify(bad));
 }
 for(const change of [v=>delete v.concurrency,v=>v.concurrency.runs.pop(),v=>v.concurrency.overlap.pop(),
  v=>v.concurrency.runs[0].root=v.runs[0].root,v=>v.concurrency.overlap[1].ino=v.concurrency.overlap[0].ino,
  v=>v.concurrency.overlap[0].uid='0',v=>v.concurrency.overlap[0].path='/tmp/foreign/prismpm-verify-exporter-ABCDEF',
  v=>v.concurrency.retirements[0].cleanup_verified=false,v=>v.concurrency.retirements[1].exit_code=1,
  v=>v.concurrency.retirements[1].timed_out=true,v=>v.concurrency.retirements[0].interrupted=true,
  v=>v.concurrency.custody.after.sha256='a'.repeat(64),v=>v.concurrency.custody.before.inventory_sha256='a'.repeat(64)]){
  const bad=structuredClone(value);change(bad);assert.throws(()=>verify(bad));
 }
 for(const change of [v=>v.concurrency.environments.pop(),v=>v.concurrency.environments[0].PATH='/tmp/foreign',
  v=>v.concurrency.environments[0].LD_PRELOAD='/tmp/injected.so',v=>v.concurrency.environments[0].CARGO_TARGET_DIR='/tmp/reuse']){
  const bad=structuredClone(value);change(bad);assert.throws(()=>verify(bad));
 }
 for(const mutate of [m=>m.processes.pop(),m=>m.processes[7].exporter.acquisition.mode='cold',
  m=>m.processes[7].exporter.acquisition.platform='linux/arm64',m=>m.processes[7].exporter.executable.sha256='f'.repeat(64),
  m=>m.processes[6].exit_code=1,m=>m.processes[7].exporter.acquisition.compiler_revision='b'.repeat(40),
  m=>m.processes[7].argv=[],m=>m.processes[7].exporter.executable.mode=-1,
  m=>m.processes[7].exporter.acquisition.toolchain='not-a-toolchain',m=>m.artifacts=[{arbitrary:'not-the-cold-build'}],
  m=>m.artifacts[0].sha256='a'.repeat(64),m=>m.artifacts[0].byte_length=-1,
  m=>m.schema='prismpm/library-verification-manifest/1',m=>delete m.exporter_owner,
  m=>m.exporter_owner.phases.reverse(),m=>m.exporter_owner.phases.pop(),
  m=>m.exporter_owner.phases[0].artifacts[0].sha256='a'.repeat(64),
  m=>m.exporter_owner.phases[0].processes[2].exporter.acquisition.platform='linux/foreign',
  m=>m.exporter_owner.phases[0].processes[2].exporter.source_archive_sha256='a'.repeat(64),
  m=>m.exporter_owner.phases[0].processes[2].exporter.executable.sha256='a'.repeat(64),
  m=>m.exporter_owner.phases[0].processes[0].executable_sha256='a'.repeat(64),
  m=>m.exporter_owner.phases[1].processes[2].argv.push('--undeclared'),
  m=>m.exporter_owner.phases[0].extra=true]){
  const bad=structuredClone(value),manifest=JSON.parse(bad.runs[2].manifest);mutate(manifest);
  bad.runs[2].manifest=fixture.encode(manifest);bad.runs[2].manifest_sha256=fixture.hash(bad.runs[2].manifest);
  assert.throws(()=>verify(bad));
 }
 const resealed=structuredClone(value);
 for(const row of resealed.runs){const manifest=JSON.parse(row.manifest);manifest.processes[7].exporter.source_archive_sha256='a'.repeat(64);if(row.acquisition==='sdk-seed')manifest.processes[7].exporter.acquisition.archive_sha256='a'.repeat(64);row.manifest=fixture.encode(manifest);row.manifest_sha256=fixture.hash(row.manifest);}
 assert.throws(()=>verify(resealed));assert.throws(()=>verifyResult(value));assert.throws(()=>verify(value,fixture.binding('arm64')));
 assert.throws(()=>verifyResult(value,binding));
 const tap='TAP version 13\n'+Array.from({length:29},(_,i)=>'ok '+(i+1)+' - gate '+i+'\n').join('')+'1..29\n# tests 29\n# suites 0\n# pass 29\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n';
 testOutput({status:0,signal:null,stdout:tap});for(const stdout of ['',tap.replace('# skipped 0','# skipped 1'),tap.replace('# tests 29','# tests 28')])assert.throws(()=>testOutput({status:0,signal:null,stdout}));
});

test('captured seed lock requires both exact platforms and independently selected native bytes',()=>{
 const fixture=lockFixture(),{bytes,image,standards,lock,encode,hash}=fixture;
 for(const architecture of ['amd64','arm64']){
  const inventory=Buffer.from(lock.platforms.find(row=>row.platform==='linux/'+architecture).inventory_document);
  assert.deepEqual(validateCapturedLock(bytes,image,architecture,standards,inventory),fixture.binding(architecture));
  for(const row of JSON.parse(readFileSync(new URL('../sdk/sdk-index-extensions.json',import.meta.url),'utf8'))){
   const changed=structuredClone(lock),raw=lock.sdk_index;
   changed.sdk_index=row.location==='root'?'{'+row.member+','+raw.slice(1)
    :row.location==='descriptor'?raw.replace('"manifests":[{','"manifests":[{'+row.member+',')
    :raw.replace('"platform":{','"platform":{'+row.member+',');
   assert.notEqual(changed.sdk_index,raw,row.id);
   changed.sdk_image=image.split('@')[0]+'@sha256:'+hash(changed.sdk_index);
   const validate=()=>validateCapturedLock(Buffer.from(encode(changed)),changed.sdk_image,architecture,standards,inventory);
   if(row.accepted){const actual=validate();assert.equal(actual.sdk_image,changed.sdk_image,row.id);}
   else assert.throws(validate,row.id);
  }
  const originalIndex=JSON.parse(lock.sdk_index);
  for(const alter of [index=>{index.SchemaVersion=2;},index=>{index.Manifeſts=[];},
   index=>{index.manifests[0].urls=[];},index=>{index.manifests[0].data=null;},
   index=>{index.manifests[0].platform.variant=null;},index=>{index.manifests[0].platform.OS='linux';},
   index=>{index.manifests[0].platform['os.version']=null;},index=>{index.manifests[1].platform['os.features']=[];},
   index=>{index.manifests[0].size=1024*1024+1;},
   ()=>'{"schemaVersion":2,'+lock.sdk_index.slice(1),
   ...['2.0000000000000000001','1.9999999999999999999'].map(n=>()=>lock.sdk_index.replace('"schemaVersion":2','"schemaVersion":'+n)),
   ...['100.000000000000000001','1048576.00000000001','99.999999999999999999'].map(n=>()=>lock.sdk_index.replace(/"size":\d+/, '"size":'+n))]){
   assert.deepEqual(validateCapturedLock(bytes,image,architecture,standards,inventory),fixture.binding(architecture));
   const changed=structuredClone(lock),index=structuredClone(originalIndex),raw=alter(index);
   changed.sdk_index=typeof raw==='string'?raw:encode(index);
   changed.sdk_image=image.split('@')[0]+'@sha256:'+hash(changed.sdk_index);
   assert.throws(()=>validateCapturedLock(Buffer.from(encode(changed)),changed.sdk_image,architecture,standards,inventory));
  }
  for(const bad of [Buffer.concat([bytes,Buffer.from('\n')]),Buffer.from([255]),Buffer.alloc(64*1024*1024+1)])
   assert.throws(()=>validateCapturedLock(bad,image,architecture,standards,inventory));
  assert.throws(()=>validateCapturedLock(bytes,image,architecture,Buffer.from('changed'),inventory));
  assert.throws(()=>validateCapturedLock(bytes,image,architecture,standards,Buffer.from('changed')));
  for(const mutate of [v=>v.platforms.reverse(),v=>v.platforms.pop(),v=>v.schema='prismpm/sdk-lock/1',
   v=>v.sdk_image=image.replace('example.invalid','other.invalid'),v=>v.platforms[0].manifest_digest='sha256:'+'a'.repeat(64),
   v=>v.platforms[1].inventory_digest='sha256:'+'a'.repeat(64)]){
   const changed=structuredClone(lock);mutate(changed);
   assert.throws(()=>validateCapturedLock(Buffer.from(encode(changed)),image,architecture,standards,inventory));
  }
  const changed=structuredClone(lock);
  for(const row of changed.platforms){
   const document=JSON.parse(row.inventory_document);document.artifacts=document.artifacts.filter(item=>item.id!=='lean4-prod-exporter-seed');
   row.inventory=document.artifacts;row.inventory_document=encode(document);row.inventory_digest='sha256:'+hash(row.inventory_document);
  }
  assert.throws(()=>validateCapturedLock(Buffer.from(encode(changed)),image,architecture,standards,inventory),/seed required/);
 }
});

// Synthetic parser fixtures exercise resealed malformed evidence. These bytes
// never enter the installed CLI gate and are not generated execution evidence.
function parserFixture(root,change=()=>{}){
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex'),encode=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
 const lexId='b'.repeat(64),build='.prism/build/staging';
 const acceptanceRoot='LibraryProbe.Probe.acceptance',roots=[acceptanceRoot,'LibraryProbe.Probe.identity'];
 const model={schema:'prismpm/model-document/3',architecture:{component_kinds:[],components:[],concerns:[],edge_kinds:[],edges:[],model_kinds:[],stakeholders:[],viewpoints:[],views:[]},quality:{characteristics:[],measures:[],requirements:[],subcharacteristics:[]},security:{activities:[],assets:[],controls:[],impacts:[],likelihoods:[],measurements:[],risks:[],threats:[]},standards_profile:[],provenance:{compiler_semantics_id:'c'.repeat(64),emitter_semantics_id:'d'.repeat(64),facet_packages:[],semantic_id:'e'.repeat(64),snapshot_id:'f'.repeat(64),source_id:'1'.repeat(64)},library:{profile:'prismpm/native-library/1',name:'Library probe',cargo_name:'prism-library-probe',cargo_version:'0.1.0',cargo_description:'Finite native-library acceptance fixture',cargo_repository:'https://github.com/UOR-Foundation/PrismPM',cargo_homepage:'https://github.com/UOR-Foundation/PrismPM',export_roots:roots,acceptance_roots:[acceptanceRoot]}};
 const paths=['coverage.json','kernel.ir','model-binding.json','package/Cargo.lock','package/Cargo.toml','package/LICENSE-APACHE','package/LICENSE-MIT','package/README.md','package/generation-manifest.json','package/src/lib.rs','prism-library-probe-0.1.0.crate','roots.json'];
 const acceptance={build_id:'',executions:['std','no_std'].map(mode=>({mode,roots:[acceptanceRoot],status:'passed'})),export_roots:roots,lexlean_attestation_id:lexId,model_id:'',profile:'prismpm/native-library/1',regeneration:'byte-identical',schema:'prismpm/library-acceptance/1',scope:'native-library-only',status:'passed',unclaimed:['application','browser','holo','production-release','deployment']};
 const processes=['lean-version','lake-version','rustfmt-version','rustc-version','timeout-version','lake-build-generated','lean4-prod-build','prod-export','native-library-package','native-library-std-lock','native-library-std-acceptance','native-library-no_std-lock','native-library-no_std-acceptance'].map(tool=>({tool,argv:[],executable_sha256:'2'.repeat(64),exit_code:0,stdout:tool.endsWith('-acceptance')?encode({roots:[acceptanceRoot],status:'passed'}):'',stderr:''}));
 Object.assign(processes.find(row=>row.tool==='prod-export'),{argv:['exe','prod-export'],exporter:{schema:'prismpm/exporter-execution/1',source_archive_sha256:'3'.repeat(64),acquisition:{schema:'prismpm/exporter-acquisition/1',mode:'cold'},executable:{sha256:'4'.repeat(64),byte_length:1234,mode:0o755}}});
 const manifest={acceptance_sha256:'',artifacts:[],build_id:'',lexlean_attestation_sha256:'',model_sha256:'',processes,schema:'prismpm/library-verification-manifest/1',scope:'native-library-only'};
 const modules=[{lean_module:'LibraryProbe.Foundation.Library.V1.Model',declarations:[{lean_name:'NativeLibrary',axiom_policy:{kind:'none',axioms:[]}}]},{lean_module:'LibraryProbe.Probe',declarations:['acceptance','identity','probeLibrary'].map(lean_name=>({lean_name,axiom_policy:{kind:'none',axioms:[]}}))}];
 const lex={attestation_id:lexId,build_id:'3'.repeat(64),source_id:model.provenance.source_id,semantic_id:model.provenance.semantic_id,spec:'lexlean/attestation/1',status:'verified',declarations:modules.flatMap(module=>module.declarations.map(row=>({name:module.lean_module+'.'+row.lean_name,observed:[],policy:row.axiom_policy,result:'ok'})))};
 const inputs={schema:'prismpm/build-inputs/3',application_generator_sha256:'4'.repeat(64),dependency_register_sha256:'5'.repeat(64),emitter_semantics_id:model.provenance.emitter_semantics_id,lexlean_build_id:lex.build_id,lexlean_semantic_id:lex.semantic_id,lexlean_source_id:lex.source_id,library_artifacts_sha256:'',library_generator_sha256:'6'.repeat(64),model_id:'',system_id:null};
 change({model,acceptance,manifest,paths,lex,inputs});
 const modelBytes=encode(model);put(root,build+'/model.prism.json',modelBytes);manifest.model_sha256=digest(modelBytes);acceptance.model_id=manifest.model_sha256;
 for(const path of paths){const bytes=path==='model-binding.json'?encode({acceptance_roots:[acceptanceRoot],export_roots:roots,model_id:manifest.model_sha256,profile:'prismpm/native-library/1',schema:'prismpm/library-build-binding/1',scope:'native-library-only'}):'parser-only '+path;put(root,build+'/library/'+path,bytes);manifest.artifacts.push({path:'library/'+path,byte_length:Buffer.byteLength(bytes),sha256:digest(bytes)});}
 put(root,build+'/lexlean/build/manifest.json','parser only');put(root,build+'/lexlean/snapshot.json',encode({modules}));
 for(const name of ['Foundation/Library/V1/Model','Probe'])for(const path of ['coverage/LibraryProbe/'+name+'.coverage.json','lexicons/'+name.replaceAll('/','.')+'.closure.json','maps/LibraryProbe/'+name+'.map.json','modules/LibraryProbe/'+name+'.lean','modules/LibraryProbe/'+name+'.tex'])put(root,build+'/lexlean/build/'+path,'parser only');
 const rows=tree(join(root,build)).filter(row=>row.kind==='file').map(row=>({byte_length:row.size,kind:'artifact',path:row.path,sha256:row.sha256}));
 inputs.model_id=manifest.model_sha256;inputs.library_artifacts_sha256=digest(encode(rows));const buildId=digest(encode(inputs));put(root,build+'/manifest.json',encode({schema:'prismpm/build-manifest/1',files:rows,inputs}));renameSync(join(root,build),join(root,'.prism/build/'+buildId));
 manifest.build_id=buildId;acceptance.build_id=buildId;const lexBytes=encode(lex);manifest.lexlean_attestation_sha256=digest(lexBytes);
 const acceptanceBytes=encode(acceptance);manifest.acceptance_sha256=digest(acceptanceBytes);const manifestBytes=encode(manifest),attestation=digest(manifestBytes),verified='.prism/verified/'+attestation;
 put(root,verified+'/manifest.json',manifestBytes);put(root,verified+'/library-acceptance.json',acceptanceBytes);put(root,verified+'/lexlean-attestation.json',lexBytes);
 return{schema:'prismpm/verify-result/1',build_id:buildId,attestation_id:attestation,verified_root:verified};
}

test('closed native evidence parser rejects coherently resealed model, acceptance and process mutations',t=>{
 const valid=temporary(t),receipt=parserFixture(valid);checkAccepted(valid,receipt);
 assert.throws(()=>checkAcceptedWithAuthority(valid,receipt,'3'.repeat(64)),/both original exporter phases/);
 for(const change of [
  ({manifest})=>{manifest.extra=true;},({manifest})=>{delete manifest.scope;},
  ({manifest})=>{manifest.processes[0].extra=true;},({manifest})=>{delete manifest.processes[0].argv;},
  ({manifest})=>{manifest.processes[0].argv=[42];},({manifest})=>{manifest.processes.pop();},
  ({manifest})=>{manifest.processes[10].stdout='{}';},({manifest})=>{manifest.processes[0].executable_sha256='invalid';},
  ({manifest})=>{delete manifest.processes[7].exporter;},
  ({manifest})=>{manifest.processes[7].exporter.extra=true;},
  ({manifest})=>{delete manifest.processes[7].exporter.acquisition;},
  ({manifest})=>{manifest.processes[7].exporter.acquisition.mode='sdk-seed';},
  ({manifest})=>{manifest.processes[7].exporter.executable.mode=0o644;},
  ({manifest})=>{manifest.processes[7].exporter.executable.byte_length=0;},
  ({manifest})=>{manifest.processes[7].exporter.executable.sha256='invalid';},
  ({manifest})=>{manifest.processes[7].exporter.source_archive_sha256='invalid';},
  ({manifest})=>{manifest.processes[7].exporter.source_archive_sha256='5'.repeat(64);},
  ({manifest})=>{manifest.processes[7].argv=['build','prod-export'];},
  ({acceptance})=>{acceptance.extra=true;},({acceptance})=>{acceptance.executions.pop();},
  ({acceptance})=>{acceptance.lexlean_attestation_id=createHash('sha256').update(JSON.stringify({attestation_id:'b'.repeat(64)})).digest('hex');},
  ({model})=>{model.extra=true;},({model})=>{model.application=null;},({model})=>{model.provenance.extra=true;},
  ({model})=>{model.library.extra=true;},({model})=>{model.security.assets=['unmodeled'];},
  ({paths})=>{paths.pop();},({paths})=>{paths.push('extra.json');},
  ({inputs})=>{inputs.schema='prismpm/build-inputs/1';},({inputs})=>{inputs.extra=true;},
  ({lex})=>{lex.declarations.pop();},({lex})=>{lex.declarations.push(lex.declarations[0]);},
  ({lex})=>{lex.declarations[0].result='failed';},({lex})=>{lex.declarations[0].observed=['sorryAx'];},
 ]){const root=temporary(t);assert.throws(()=>checkAccepted(root,parserFixture(root,change)));}
 for(const change of [
  (root,receipt)=>rmSync(join(root,'.prism/build',receipt.build_id,'manifest.json')),
  (root,receipt)=>put(root,'.prism/build/'+receipt.build_id+'/manifest.json','{}'),
  (root,receipt)=>put(root,'.prism/build/'+receipt.build_id+'/unexpected','extra output'),
 ]){const root=temporary(t),receipt=parserFixture(root);change(root,receipt);assert.throws(()=>checkAccepted(root,receipt));}
 put(valid,'.prism/build/'+receipt.build_id+'/library/package/src/lib.rs','tampered actual bytes');assert.throws(()=>checkAccepted(valid,receipt));
 const compiler={revision:'6'.repeat(40),toolchain:'leanprover/lean4:v4.32.1',platform:'linux/amd64'};
 const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
 const encode=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
 for(const mutation of [null,'inventory','manifest','child','source','revision','toolchain','platform','seed-kind','seed-version','child-kind','unknown','index','missing-authority']) {
  const root=temporary(t);
  const artifacts=[
   ...['adapter','base-image','binary','crate','dependency-lock','oracle','schema','test-corpus','trust-root','workflow'].map(kind=>({id:kind,kind,version:'1',digest:'sha256:'+'7'.repeat(64)})),
   {id:'lean4-prod-exporter',kind:'binary',version:compiler.revision,digest:'sha256:'+'4'.repeat(64)},
   {id:'lean4-prod-exporter-seed',kind:'dependency-lock',version:'1',digest:'sha256:'+'8'.repeat(64)},
  ].sort((a,b)=>a.id.localeCompare(b.id));
  if(mutation==='seed-kind')artifacts.find(row=>row.id==='lean4-prod-exporter-seed').kind='binary';
  if(mutation==='seed-version')artifacts.find(row=>row.id==='lean4-prod-exporter-seed').version='2';
  if(mutation==='child-kind')artifacts.find(row=>row.id==='lean4-prod-exporter').kind='crate';
  const doc=encode({schema:'prismpm/sdk-inventory/1',artifacts,commands:['cargo','devcontainer','docker','just','prismpm'].map(command=>({command,executable:'/usr/local/bin/'+command,sha256:'9'.repeat(64)}))});
  const manifests=['amd64','arm64'].map((architecture,index)=>({mediaType:'application/vnd.oci.image.manifest.v1+json',digest:'sha256:'+String(index+1).repeat(64),size:100,platform:{os:'linux',architecture}}));
  const index=encode({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests});
  const lock={schema:'prismpm/sdk-lock/2',sdk_version:'0.3.0',sdk_image:'example.invalid/fixture@sha256:'+digest(index),sdk_index:index,standards_lock:'sha256:'+'a'.repeat(64),
   platforms:['amd64','arm64'].map((architecture,index)=>({platform:'linux/'+architecture,manifest_digest:manifests[index].digest,inventory_digest:'sha256:'+digest(doc),inventory_document:doc,inventory:artifacts}))};
  if(mutation==='index')lock.sdk_image='example.invalid/fixture@sha256:'+'f'.repeat(64);
  put(root,'prismpm.lock',encode(lock));
  const warm=parserFixture(root,({manifest})=>{
   const acquisition={schema:'prismpm/exporter-acquisition/1',mode:'sdk-seed',compiler_revision:compiler.revision,toolchain:compiler.toolchain,platform:compiler.platform,
    inventory_sha256:digest(doc),manifest_sha256:'8'.repeat(64),executable_sha256:'4'.repeat(64),archive_sha256:'3'.repeat(64)};
   const fields={inventory:'inventory_sha256',manifest:'manifest_sha256',child:'executable_sha256',source:'archive_sha256',revision:'compiler_revision',toolchain:'toolchain',platform:'platform'};
   if(fields[mutation])acquisition[fields[mutation]]=mutation==='toolchain'?'leanprover/lean4:v1.2.3':mutation==='platform'?'linux/arm64':'f'.repeat(64);
   if(mutation==='unknown')acquisition.extra=true;
   manifest.processes[7].exporter.acquisition=acquisition;
  });
  const verify=()=>readHistoricalLibraryEvidence(root,warm,'3'.repeat(64),mutation==='missing-authority'?undefined:compiler,'sdk-seed');
  if(mutation===null)verify();else assert.throws(verify,mutation);
 }
});

test('release job keeps both native library and browser gates mandatory for each SDK architecture',()=>{
 const workflow=readFileSync(new URL('../.github/workflows/release.yml',import.meta.url),'utf8');
 assert.match(workflow,/bash root-a\/scripts\/browser-api-sdk-check\.sh/);
 assert.match(workflow,/name: Verify exact current SDK native-library closure offline and read-only\n\s+if: matrix.image == 'sdk'/);
 assert.match(workflow,/bash root-a\/scripts\/library-sdk-check\.sh "\$\(cat \.shipped-image\/sdk-image.txt\)" "\$GITHUB_SHA"/);
 assert.match(workflow,/os: ubuntu-24.04-arm/);assert.match(workflow,/name: library-sdk-\$\{\{ matrix.name \}\}/);
 const wrapper=readFileSync(new URL('./library-sdk-check.sh',import.meta.url),'utf8');
 for(const required of ['--user 1000:1000 --read-only --network none','--cap-drop ALL','--security-opt no-new-privileges','--tmpfs /tmp:rw,exec,nosuid,nodev,size=8g','PRISMPM_EPHEMERAL_HOME=1','node scripts/library-sdk-check.mjs run'])assert.ok(wrapper.includes(required),required);
 const execution=wrapper.slice(wrapper.indexOf('# Execution has no network'));
 assert.ok(!execution.includes('--volume')&&!execution.includes('--mount'));
 const recipe=readFileSync(new URL('../sdk/Dockerfile',import.meta.url),'utf8');
 assert.match(recipe,/elan toolchain install leanprover\/lean4:v4\.32\.1 \\\n\s+&& chmod -R a\+rX,go-w \/usr\/local\/elan\/toolchains\/leanprover--lean4---v4\.32\.1/);
});

test('owning CLI test kills a removed process-exit guard',t=>{
 const root=temporary(t),module=readFileSync(new URL('./library-sdk-check.mjs',import.meta.url),'utf8');
 const guard='assert.equal(output.status,expected.code ? exits[expected.code] : 0, "CLI exit class");';assert.equal(module.split(guard).length,2);
 put(root,'scripts/library-sdk-check.mjs',module.replace(guard,''));put(root,'scripts/browser-api-sdk-check.mjs',readFileSync(new URL('./browser-api-sdk-check.mjs',import.meta.url)));put(root,'scripts/library-sdk-check.test.mjs',readFileSync(new URL('./library-sdk-check.test.mjs',import.meta.url)));
 put(root,'scripts/library-sdk-fixture.mjs',readFileSync(new URL('./library-sdk-fixture.mjs',import.meta.url)));
 for(const name of ['sdk-command-owner.mjs','sdk-command-owner.py'])
  put(root,'scripts/'+name,readFileSync(new URL('./'+name,import.meta.url)));
 put(root,'scripts/installed-exporter-concurrency.mjs',readFileSync(new URL('./installed-exporter-concurrency.mjs',import.meta.url)));
 cpSync(new URL('../sdk',import.meta.url),join(root,'sdk'),{recursive:true});
 const env={...process.env};delete env.NODE_TEST_CONTEXT;
 const output=spawnSync(process.execPath,['--test','--test-reporter=tap','--test-name-pattern=CLI transport invokes',join(root,'scripts/library-sdk-check.test.mjs')],{encoding:'utf8',env,timeout:15000,maxBuffer:1024*1024});assert.equal(output.error,undefined);assert.equal(output.status,1);assert.match(output.stdout,/Missing expected exception/);
});
