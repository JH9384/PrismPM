// Synthetic parser/recording-boundary data only; never an SDK execution claim.
import {createHash} from 'node:crypto';
import {dirname,join} from 'node:path';
import {readFileSync} from 'node:fs';
import {installedEnvironment} from './installed-exporter-concurrency.mjs';
import {fixture as metadataFixture} from '../sdk/metadata-test-fixture.mjs';
import {captureMetadataEvidence} from '../sdk/metadata-evidence.mjs';
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const encode=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);

export function seedManifestFixture(architecture, authority=sourceAuthorityFixture) {
 const directory=path=>({path,kind:'directory',mode:0o755});
 const file=path=>({path,kind:'file',mode:0o755,byte_length:12,sha256:hash(architecture+path)});
 const toolchain=authority.toolchain;
 return {schema:'prismpm/exporter-seed/1',platform:'linux/'+architecture,compiler_revision:'a'.repeat(40),
  archive_sha256:authority.archive_sha256,toolchain,
  configuration:{argv:['build','prod-export'],construction_root:'/tmp/prismpm-exporter-construction',temporary_directory:'private-bounded-tmpfs',
   environment:{PATH:'/usr/local/elan/toolchains/'+toolchain.replace('/','--').replace(':','---')+'/bin:/usr/bin:/bin',LANG:'C',LC_ALL:'C',ELAN_HOME:'/usr/local/elan',ELAN_TOOLCHAIN:toolchain,LEAN_NUM_THREADS:'2',SOURCE_DATE_EPOCH:'0'}},
  source_files:[directory('Prod'),file('Prod/Export.lean')],toolchain_files:[directory('bin'),file('bin/lake'),file('bin/lean')],
  runtime_files:[{selected:'/lib/libc.so.6',path:'/usr/lib/libc.so.6',mode:0o755,byte_length:12,sha256:hash('runtime')}],
  files:[directory('.lake'),directory('.lake/build'),directory('.lake/build/bin'),file('.lake/build/bin/prod-export')]};
}

export function lockFixture(authority=sourceAuthorityFixture,standards=Buffer.from('synthetic library SDK standards\n')){
 const platforms=[];
 for(const architecture of ['amd64','arm64']){
  const manifest=seedManifestFixture(architecture,authority);
  const artifacts=['adapter','base-image','binary','crate','dependency-lock','oracle','schema','test-corpus','trust-root','workflow']
   .map(kind=>({id:'test-'+kind,kind,version:'fixture',digest:'sha256:'+hash(architecture+kind)}));
  artifacts.push({id:'lean4-prod-exporter',kind:'binary',version:'a'.repeat(40),digest:'sha256:'+manifest.files.at(-1).sha256},
   {id:'lean4-prod-exporter-seed',kind:'dependency-lock',version:'1',digest:'sha256:'+hash(encode(manifest)+'\n')});
  artifacts.sort((a,b)=>a.id.localeCompare(b.id));
  const inventory_document=encode({schema:'prismpm/sdk-inventory/1',artifacts,
   commands:['cargo','devcontainer','docker','just','node','prismpm','python3','tar'].map(command=>({command,
    executable:command==='node'?'/usr/bin/node':command==='python3'?'/usr/bin/python3.12':command==='tar'?'/usr/bin/tar':'/usr/local/bin/'+command,sha256:hash(architecture+command)}))});
  platforms.push({platform:'linux/'+architecture,inventory_digest:'sha256:'+hash(inventory_document),inventory_document,inventory:artifacts});
 }
 const cleanup=[];
 let graph;
 try {
  graph=metadataFixture({after:fn=>cleanup.push(fn)},'',{standards,repository:'example.invalid/library-sdk',
   inventories:new Map(platforms.map(row=>[row.platform.split('/')[1],Buffer.from(row.inventory_document)]))});
 } finally {for(const fn of cleanup)fn();}
 const sdk_index=graph.index.toString(),image=graph.reference;
 for(const [index,descriptor] of JSON.parse(sdk_index).manifests.entries())platforms[index].manifest_digest=descriptor.digest;
 const lock={schema:'prismpm/sdk-lock/2',sdk_version:'0.3.0',sdk_image:image,sdk_index,standards_lock:'sha256:'+hash(standards),platforms};
 const bytes=Buffer.from(encode(lock));
 const binding=architecture=>({sdk_image:image,platform:'linux/'+architecture,lock_sha256:hash(bytes),
  inventory_sha256:hash(platforms.find(row=>row.platform==='linux/'+architecture).inventory_document),
  seed_manifest_sha256:hash(encode(seedManifestFixture(architecture,authority))+'\n'),exporter_sha256:seedManifestFixture(architecture,authority).files.at(-1).sha256,compiler_revision:'a'.repeat(40)});
 return {bytes,lock,image,standards,encode,hash,binding,
  metadataEvidence:async()=>{const captured=await captureMetadataEvidence(image,lock.standards_lock,graph.transport);
   if(encode(captured.lock)!==bytes.toString())throw Error('synthetic graph lock differs');return captured.evidence;}};
}

export const sourceAuthorityFixture={archive_sha256:'3'.repeat(64),toolchain:'leanprover/lean4:v4.32.1'};
export function qualificationFixture(binding,authority=sourceAuthorityFixture) {
 const manifest=seedManifestFixture(binding.platform.split('/')[1],authority),bytes=encode(manifest)+'\n';
 const lake=manifest.configuration.environment.PATH.split(':')[0]+'/lake';
 const base='/work/prismpm-exporter-qualification-fixture';
 const process=(argv,temporary)=>({argv,environment:{...manifest.configuration.environment,TMPDIR:temporary},executable_sha256:argv[0]===lake?manifest.toolchain_files[1].sha256:hash(binding.platform.split('/')[1]+'tar'),exit_code:0,stdout:'synthetic boundary fixture',stderr:''});
 const construction={scope:'exporter-construction-only',manifest_sha256:hash(bytes),files:manifest.files.length,
  raw_construction:['a','b'].map(name=>({extraction:process(['/usr/bin/tar','--extract','--file',base+'/source-'+name+'/vendor/lean4-prod/lean.tar','--directory','/proc/self/fd/3'],'/proc/self/fd/4'),build:process([lake,'build','prod-export'],'/proc/self/fd/4')}))};
 const observations=Array.from({length:4},(_,index)=>{
  const acquisition=index%2?'relocated':'cold',root=base+'/exporter-relocation-check-fixture/'+(index<2?'first-root/':'independent-second-root/')+acquisition,temporary='/tmp/exporter-relocation-fixture';
  return {root,acquisition,invocation_milliseconds:1,changed_build_files:[],
   extraction:process(['/usr/bin/tar','--extract','--file',base+'/source-a/vendor/lean4-prod/lean.tar','--directory',root],temporary),
   build:process([lake,'build','prod-export'],temporary),module:process([lake,'build','Conformance.LexLean11'],temporary),kernel:process([lake,'env','leanchecker','Conformance.LexLean11'],temporary),
   exports:['a','b'].map(replay=>({process:process([lake,'exe','prod-export','--module','Conformance.LexLean11','--root','SemanticFixture.Main.allConsecutive','--ir-module','exporter_relocation','--out',root+'/export-'+replay],temporary),artifacts:{'kernel.ir':'synthetic IR','roots.json':'synthetic roots','coverage.json':'synthetic coverage'}}))};
 });
 return {schema:'prismpm/exporter-qualification/1',scope:'installed-native-compiler-only',binding:structuredClone(binding),manifests:[bytes,bytes],construction,
  relocation:{scope:'compiler-relocation-measurement-only',manifest_sha256:hash(bytes),construction:{manifest_sha256:hash(bytes),construction:construction.raw_construction[0]},observations}};
}
export function resultFixture(binding,sourceAuthority=sourceAuthorityFixture){
 const build_id='d'.repeat(64);
 const tools=['lean-version','lake-version','rustfmt-version','rustc-version','timeout-version','lake-build-generated','lean4-prod-build','prod-export','native-library-package','native-library-std-lock','native-library-std-acceptance','native-library-no_std-lock','native-library-no_std-acceptance'];
 const runs=Array.from({length:4},(_,index)=>{
  const acquisition=index<2?'cold':'sdk-seed';
  const processes=tools.map(tool=>({tool,argv:[],executable_sha256:'e'.repeat(64),exit_code:0,stdout:'parser fixture',stderr:''}));
  processes[5].argv=['build','PrismGenerated'];processes[6].argv=['build','prod-export'];
  processes[8].argv=['package','--locked','--offline','--allow-dirty'];
  processes[7].argv=['exe','prod-export'];
  processes[7].exporter={schema:'prismpm/exporter-execution/1',source_archive_sha256:sourceAuthority.archive_sha256,
   executable:{byte_length:1234,mode:0o755,sha256:index<2?'4'.repeat(64):binding.exporter_sha256},
   acquisition:index<2?{schema:'prismpm/exporter-acquisition/1',mode:'cold'}:{schema:'prismpm/exporter-acquisition/1',mode:'sdk-seed',
    platform:binding.platform,inventory_sha256:binding.inventory_sha256,manifest_sha256:binding.seed_manifest_sha256,
    executable_sha256:binding.exporter_sha256,compiler_revision:binding.compiler_revision,toolchain:sourceAuthority.toolchain,archive_sha256:sourceAuthority.archive_sha256}};
  const value={schema:'prismpm/library-verification-manifest/2',scope:'native-library-only',build_id,processes,
   artifacts:['coverage.json','kernel.ir','model-binding.json','package/Cargo.lock','package/Cargo.toml','package/LICENSE-APACHE','package/LICENSE-MIT','package/README.md','package/generation-manifest.json','package/src/lib.rs','prism-library-probe-0.1.0.crate','roots.json'].map(path=>({path:'library/'+path,byte_length:12,sha256:hash(path)})),acceptance_sha256:'5'.repeat(64),lexlean_attestation_sha256:'6'.repeat(64),model_sha256:'7'.repeat(64)};
  value.exporter_owner=ownerFixture(value,'library',processes.slice(5,9));
  const manifest=encode(value);
  return {root:'/tmp/prismpm-library-sdk-fixture/fixture-'+index,acquisition,manifest,manifest_sha256:hash(manifest)};
 });
 const concurrentRuns=runs.slice(2).map((row,index)=>({...row,root:'/tmp/prismpm-library-sdk-fixture/fixture-'+(4+index)}));
 const custody=custodyFixture(binding,sourceAuthority);
 const concurrency={scope:'installed-exporter-concurrency-only',runs:concurrentRuns,
  overlap:[0,1].map(index=>({path:'/tmp/prismpm-library-sdk-fixture/invocation-'+index+'/prismpm-verify-exporter-ABCDEF',
   dev:'1',ino:String(100+index),uid:'1000',gid:'1000',mode:String(0o40700)})),
  retirements:[0,1].map(()=>({schema:'prismpm/portable-process-owner/1',exit_code:0,timed_out:false,interrupted:false,cleanup_verified:true})),
  environments:[0,1].map(index=>installedEnvironment('/tmp/prismpm-library-sdk-fixture/invocation-'+index)),
  custody:{before:custody,after:structuredClone(custody)}};
 const acceptance_rejection={schema:'prismpm/generated-acceptance-rejection/1',root:'LibraryProbe.Probe.acceptance',
  result:{schema:'prismpm/error-result/1',diagnostic:{code:'PP5006',primary:null,labels:[],notes:[],help:[],causes:[],
   message:'native-library-std-acceptance exited 101: stdout=""; stderr="\\nthread \'main\' (123) panicked at src/main.rs:4:1:\\nLibraryProbe.Probe.acceptance\\n"'}}};
 return {scope:'installed-native-library-only',build_id,binding:structuredClone(binding),runs,concurrency,acceptance_rejection,checks:['read-only-check','std','no_std','exact-package-replay','two-root-reproduction','product-refusal','missing-root','wrong-result-root','parameterized-root','nominal-impostor','false-generated-acceptance','restored-acceptance','authenticated-seed-admission','cold-warm-two-root-equivalence','installed-concurrent-owner-equivalence','immutable-seed-original-custody'],unclaimed:['application','browser','holo','production-release','deployment']};
}

// Only a strict-reader fixture; no stat, compiler or installed execution is
// represented by these constructed native metadata values.
export function custodyFixture(binding,authority=sourceAuthorityFixture){
 const manifest=seedManifestFixture(binding.platform.split('/')[1],authority),manifest_document=encode(manifest)+'\n';
 const inventory_document=lockFixture(authority).lock.platforms.find(row=>row.platform===binding.platform).inventory_document;
 const entries=new Map();let ino=1;
 function add(path,kind='directory',mode=0o755,size=4096,digest,target){
  if(entries.has(path))return;
  if(path!=='/')add(dirname(path));
  entries.set(path,{path,kind,dev:'1',ino:String(ino++),uid:'0',gid:'0',nlink:kind==='file'?'1':'2',
   size:String(size),mode:String(({file:0o100000,directory:0o040000,symlink:0o120000}[kind])+mode),mtime_ns:'1',ctime_ns:'1',
   ...(digest?{sha256:digest}:{}),...(target?{target}:{})});
 }
 const seed='/opt/prismpm/share/exporter-seed',toolchain='/usr/local/elan/toolchains/'+authority.toolchain.replace('/','--').replace(':','---');
 add('/opt/prismpm/share/inventory.json','file',0o444,Buffer.byteLength(inventory_document),binding.inventory_sha256);
 add(seed);add(seed+'/manifest.json','file',0o444,Buffer.byteLength(manifest_document),hash(manifest_document));
 for(const [root,rows] of [[seed,manifest.files],[toolchain,manifest.toolchain_files]]){
  add(root);for(const row of rows)add(join(root,row.path),row.kind,row.mode,row.byte_length??4096,row.sha256,row.target);
 }
 add('/usr/lib');add('/lib','symlink',0o777,7,undefined,'usr/lib');
 for(const row of manifest.runtime_files)add(row.path,'file',row.mode,row.byte_length,row.sha256);
 const helper=readFileSync(new URL('./portable-oracle-process-owner.py',import.meta.url)),ownerPath='/opt/prismpm/share/conformance-root/scripts/portable-oracle-process-owner.py';
 const tools=[];
 for(const command of ['prismpm','node','python3','process-owner']){
  const row=JSON.parse(inventory_document).commands.find(row=>row.command===command);
  const selected=command==='process-owner'?ownerPath:command==='python3'?'/usr/bin/python3':row.executable;
  const canonical_path=command==='process-owner'?ownerPath:row.executable;
  const file={byte_length:command==='process-owner'?helper.length:12,mode:command==='process-owner'?0o444:0o755,
   sha256:command==='process-owner'?hash(helper):row.sha256};
  add(canonical_path,'file',file.mode,file.byte_length,file.sha256);
  if(selected!==canonical_path)add(selected,'symlink',0o777,10,undefined,'python3.12');
  tools.push({command,selected,canonical_path,...file});
 }
 const document=encode([...entries.values()].sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path))));
 return {manifest_document,inventory_document,inventory_sha256:binding.inventory_sha256,tools,document,sha256:hash(document)};
}

// Structural negative-control bytes, never generated or accepted execution.
export function ownerFixture(manifest,role,processes){
 return {schema:'prismpm/verification-exporter-owner/1',phases:['controller-build','replay'].map(phase=>({
  phase,role,model_sha256:manifest.model_sha256,lexlean_manifest_sha256:'8'.repeat(64),
  artifacts:structuredClone(manifest.artifacts??[{path:'Calculator.holo',byte_length:12,sha256:'9'.repeat(64)}]),
  processes:structuredClone(processes),
 }))};
}
