// Internal installed-SDK product construction. Never release promotion or
// crates.io qualification; every positive OCI byte must come from the real CLI.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {chmodSync,closeSync,constants,cpSync,existsSync,fstatSync,lstatSync,mkdirSync,openSync,readFileSync,readSync,readdirSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {tree,sourceRoots as libraryRoots,sourceAliases,verifyImage,validateCapturedLock,verifyExporterProcess,validateVerificationOwner} from './library-sdk-check.mjs';
import {verifyTap} from './browser-api-sdk-check.mjs';
import {capturePlatformLock,validateInventory} from '../sdk/platform-lock.mjs';

export {verifyImage};
export const sourceRoots=Object.freeze([...libraryRoots,
 'examples/Calculator','tests/browser-system','scripts/product-sdk-check.mjs',
 'scripts/product-sdk-check.sh','scripts/product-sdk-check.test.mjs','scripts/product-sdk-check.md',
].sort());
const shared='/opt/prismpm/share',installed=shared+'/conformance-root';
const work='/tmp/prismpm-product-cli',inputs='/tmp/prismpm-product-input';
const imagePattern=/^[a-z0-9.-]+(?::[0-9]{1,5})?\/[a-z0-9./_-]+@sha256:[0-9a-f]{64}$/;
const digestPattern=/^sha256:[0-9a-f]{64}$/;
const reference='ghcr.io/uor-foundation/prismpm-product-probe';
const proofType='application/vnd.prismpm.verification.v1+json';
const policyType='application/vnd.prismpm.supply-chain.v1+json';
const spdxType='application/spdx+json;version=3.0.1';
const unclaimed=Object.freeze(['sdk-release','crates.io-publication','producer-authorization','deployment','foundry-readiness']);
export const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
export const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
const equal=(left,right)=>assert.equal(canonical(left),canonical(right));
const keys=(value,names)=>{assert(value&&typeof value==='object'&&!Array.isArray(value));equal(Object.keys(value).sort(),names.slice().sort());};
const hex=value=>assert.match(value,/^[0-9a-f]{64}$/);
export function bytes(path,maximum=256*1024*1024){
 const before=lstatSync(path);assert(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum,'bounded regular file: '+path);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=fstatSync(fd);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(opened[key],before[key],'file changed');
  const value=Buffer.alloc(opened.size+1);let size=0;
  while(size<value.length){const count=readSync(fd,value,size,value.length-size,null);if(!count)break;size+=count;}
  assert.equal(size,opened.size,'file length changed');
  for(const after of [fstatSync(fd),lstatSync(path)]){assert(after.isFile()&&!after.isSymbolicLink());for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[key],opened[key],'file changed');}
  return value.subarray(0,size);
 }finally{closeSync(fd);}
}
function json(path){return JSON.parse(bytes(path));}
function put(path,value){mkdirSync(dirname(path),{recursive:true});writeFileSync(path,value,{flag:'wx',mode:0o600});}
function record(path,value){put(path,canonical(value));}
function copy(source,destination){
 assert(!existsSync(destination),'fresh output only');
 // Acquired OSV archives can exceed the source-tree hashing limit. Copy only
 // regular private files; the product CLI independently rechecks their pinned
 // digests and freshness when consuming the cache in each source root.
 function regular(path){const stat=lstatSync(path);assert(!stat.isSymbolicLink());if(stat.isDirectory())for(const name of readdirSync(path))regular(join(path,name));else assert(stat.isFile());}
 regular(source);cpSync(source,destination,{recursive:true,errorOnExist:true,force:false,dereference:false});
 function own(path){const stat=lstatSync(path);assert(!stat.isSymbolicLink());if(stat.isDirectory()){chmodSync(path,0o700);for(const name of readdirSync(path))own(join(path,name));}else{assert(stat.isFile());chmodSync(path,0o600);}}
 own(destination);
}
export function capture(root,revision){assert.match(revision,/^[0-9a-f]{40}$/);return{revision,files:tree(root,sourceRoots,sourceAliases)};}
export function verifySource(root,expected){equal(capture(root,expected.revision),expected);}

function launchProcess(program,args,{cwd,env,timeout,maxBuffer}){
 return new Promise((resolve,reject)=>{
  const child=spawn(program,args,{cwd,env,detached:true,stdio:['ignore','pipe','pipe']});
  const streams=[[],[]],lengths=[0,0];let failure;
  function killGroup(){if(child.pid)try{process.kill(-child.pid,'SIGKILL');}catch(error){if(error.code!=='ESRCH')failure??=error;}}
  // A trusted tool can create its own subgroup (GNU timeout does). Close local
  // readers on failure as well; inherited pipes cannot prevent rejection. The
  // outer wrapper then removes the owned container, including its namespace.
  const stop=error=>{failure??=error;killGroup();child.stdout.destroy();child.stderr.destroy();};
  const timer=setTimeout(()=>stop(new Error('command process group timed out')),timeout);
  const handlers=['SIGHUP','SIGINT','SIGTERM'].map(signal=>[signal,()=>stop(new Error('command interrupted by '+signal))]);
  for(const [signal,handler] of handlers)process.on(signal,handler);
  const clean=()=>{clearTimeout(timer);for(const [signal,handler] of handlers)process.removeListener(signal,handler);};
  for(const [index,stream] of [child.stdout,child.stderr].entries())stream.on('data',value=>{
   const remaining=Math.max(0,maxBuffer-lengths[index]);if(remaining)streams[index].push(value.subarray(0,remaining));
   lengths[index]+=value.length;if(lengths[index]>maxBuffer)stop(new Error('command output exceeds bound'));
  });
  child.once('error',error=>{clean();killGroup();reject(error);});
  child.once('close',(status,signal)=>{
   clean();killGroup();const result={status,signal,stdout:Buffer.concat(streams[0]).toString(),stderr:Buffer.concat(streams[1]).toString()};
   if(failure){failure.result=result;reject(failure);}else resolve(result);
  });
 });
}
export async function command(program,args,{cwd,env=process.env,timeout=1800000,maximum=16*1024*1024,status=0}={},launch=launchProcess){
 assert(program.startsWith('/'),'absolute installed executable required');
 assert(Number.isSafeInteger(timeout)&&timeout>0&&timeout<=1800000);assert(Number.isSafeInteger(maximum)&&maximum>0&&maximum<=64*1024*1024);
 const child=await launch(program,args,{cwd,env,encoding:'utf8',timeout,maxBuffer:maximum,killSignal:'SIGKILL'});
 assert.equal(child.error,undefined,'command execution failed');assert.equal(child.signal,null,'command terminated');
 assert.equal(child.status,status,'command exit status: '+program+' '+args.join(' ')+'\n'+(child.stderr??'').slice(-4000));
 return child;
}
export async function cli(project,args,expected,launch=launchProcess){
 // Acquisition is deliberately online. The SDK-owned fixture registry stays
 // local; all later construction/replay also has an OS-level network boundary.
 const env={...process.env,CARGO_NET_OFFLINE:args[0]==='fetch'?'false':'true'};delete env.CARGO_TARGET_DIR;
 const output=await command('/usr/local/bin/prismpm',['--project',project,'--json',...args],
  {env,status:expected.code?expected.exit:0,maximum:args[0]==='fetch'?64*1024*1024:16*1024*1024},launch);
 const value=JSON.parse(output.stdout);
 if(expected.code){assert.equal(value.schema,'prismpm/error-result/1');assert.equal(value.diagnostic?.code,expected.code);}
 else if(expected.schema)assert.equal(value.schema,expected.schema);
 return value;
}
export function productResult(value,release){
 keys(value,['schema','reference','product_digest','release_digest','model_digest','build_digest','evidence_path']);
 assert.equal(value.schema,'prismpm/product-release-result/1');assert(['A','B'].includes(release));
 assert.equal(value.reference,reference+':'+release.toLowerCase());
 for(const name of ['product_digest','release_digest','model_digest','build_digest'])assert.match(value[name],digestPattern);
 assert.equal(value.evidence_path,'.prism/releases/'+value.release_digest.slice(7)+'/result.json');return value;
}
function verifiedBlob(project,descriptor){
 assert.match(descriptor.digest,digestPattern);assert(Number.isSafeInteger(descriptor.size)&&descriptor.size>=0);
 const value=bytes(join(project,'.prism/oci/blobs/sha256',descriptor.digest.slice(7)));
 assert.equal(value.length,descriptor.size);assert.equal(sha(value),descriptor.digest);return value;
}
function rootBlob(project,digest){assert.match(digest,digestPattern);const value=bytes(join(project,'.prism/oci/blobs/sha256',digest.slice(7)));assert.equal(sha(value),digest);return JSON.parse(value);}
function referrer(project,digest,type){
 const index=json(join(project,'.prism/oci/index.json'));
 const matches=index.manifests.filter(row=>{const value=JSON.parse(verifiedBlob(project,row));return value.subject?.digest===digest&&value.artifactType===type;});
 assert.equal(matches.length,1,'one actual '+type+' referrer');
 return JSON.parse(verifiedBlob(project,matches[0]));
}
function evidence(project,digest,type){const manifest=referrer(project,digest,type);assert.equal(manifest.layers.length,1);return{descriptor:manifest.layers[0],value:JSON.parse(verifiedBlob(project,manifest.layers[0]))};}

export function validateScans(scans,lock,inventory){
 assert.equal(scans.length,2,'both SDK native image scans required');
 equal(scans.map(row=>row.platform).sort(),['linux/amd64','linux/arm64']);
 const scanner=inventory.commands.filter(row=>row.command==='osv-scanner');assert.equal(scanner.length,1);
 for(const scan of scans){
  assert.equal(scan.schema,'prismpm/image-advisory-scan/1');assert.equal(scan.reference,lock.sdk_image);
  assert.equal(scan.subject,lock.sdk_image.split('@')[1]);assert.equal(scan.subject_kind,'sdk-image');
  assert.equal(scan.scanner_digest,'sha256:'+scanner[0].sha256);assert(scan.package_count>0);
  assert.equal(scan.rejected_count,0);assert.equal(sha(canonical(scan.result)),scan.result_digest);
  assert.equal(sha(canonical(scan.database_set)),scan.database_set_digest);
  assert.equal(scan.index_manifest,lock.sdk_index);
  const platform=lock.platforms.find(row=>row.platform===scan.platform);assert(platform);
  assert.equal(scan.platform_descriptor.digest,platform.manifest_digest);
 }
}
function imageEnvironment(lock){
 assert.equal(process.getuid(),1000);assert.equal(process.env.PRISMPM_SDK_INVENTORY,shared+'/inventory.json');
 const inventoryBytes=bytes(shared+'/inventory.json'),inventory=validateInventory(inventoryBytes);
 const platform='linux/'+({x64:'amd64',arm64:'arm64'}[process.arch]);
 const native=lock.platforms.find(row=>row.platform===platform);assert(native);
 assert.equal(native.inventory_document,inventoryBytes.toString());assert.equal(native.inventory_digest,sha(inventoryBytes));
 assert.equal(lock.standards_lock,sha(bytes(shared+'/standards.lock')));
 const tool=inventory.commands.filter(row=>row.command==='prismpm');assert.equal(tool.length,1);
 assert.equal(tool[0].executable,'/usr/local/bin/prismpm');assert.equal('sha256:'+tool[0].sha256,sha(bytes('/usr/local/bin/prismpm')));
 return inventory;
}
async function projectSource(project){
 mkdirSync(join(project,'src/Production'),{recursive:true});
 for(const name of ['prismpm.toml','lakefile.toml','lake-manifest.json','lean-toolchain'])put(join(project,name),bytes(join(installed,'examples/Calculator',name)));
 put(join(project,'lexlean.toml'),bytes(join(installed,'tests/browser-system/lexlean.toml')));
 put(join(project,'src/Release.lex.tex'),bytes(join(installed,'tests/browser-system/Release.lex.tex')));
 put(join(project,'src/Calculator.lex.tex'),bytes(join(installed,'examples/Calculator/src/Calculator.lex.tex')));
 for(const name of ['Core','BrowserSystem'])put(join(project,'src/Production',name+'.lex.tex'),bytes(join(installed,'stdlib/src/Production',name+'.lex.tex')));
 put(join(project,'prismpm.lock'),bytes(join(inputs,'prismpm.lock')));put(join(project,'standards.lock'),bytes(shared+'/standards.lock'));
 await command('/usr/local/bin/lexlean',['lock'],{cwd:project,timeout:300000});
 await cli(project,['lock','check'],{});
}
async function registry(project){
 const path=join(project,'.prism/product-registry');mkdirSync(path,{recursive:true});
 await command('/usr/bin/tar',['-xf',join(installed,'vendor/registry.tar'),'-C',path],{timeout:60000});
 const release=json(shared+'/stdlib/release.json'),crate=bytes(shared+'/stdlib/generated/prism-stdlib-0.2.0.crate');
 assert.equal(sha(crate),'sha256:'+release.crate_sha256);
 const inventory=validateInventory(bytes(shared+'/inventory.json'));
 const row=inventory.artifacts.filter(item=>item.id==='prism-stdlib');assert.equal(row.length,1);assert.equal(row[0].digest,sha(crate));
 put(join(path,'prism-stdlib-0.2.0.crate'),crate);
 put(join(path,'index/pr/is/prism-stdlib'),JSON.stringify({name:'prism-stdlib',vers:'0.2.0',deps:[],cksum:release.crate_sha256,features:{default:['std'],std:[]},yanked:false})+'\n');
 // Scoped only to this fixture. The ordinary verifier has its own isolated
 // dependency homes; neither a host package nor a public-registry claim enters.
 put(join(project,'.cargo/config.toml'),'[net]\noffline = true\n[source.crates-io]\nreplace-with = "installed-sdk-probe"\n[source.installed-sdk-probe]\nlocal-registry = ".prism/product-registry"\n');
}
async function generatedPackage(project,build){
 hex(build.build_id);const root=join(project,'.prism/build',build.build_id,'cargo/package');
 assert(existsSync(root),'real generated application package is required');
 const files=tree(root).filter(row=>row.kind==='file');assert(files.some(row=>row.path==='Cargo.toml'));assert(files.some(row=>row.path==='Cargo.lock'));assert(files.some(row=>row.path==='src/lib.rs'));
 for(const row of files)put(join(project,row.path),bytes(join(root,row.path)));
 await registry(project);await command('/usr/local/cargo/bin/cargo',['metadata','--locked','--offline','--format-version','1'],{cwd:project,timeout:120000});
 return files;
}
function scans(project,lock){return ['amd64','arm64'].map(arch=>json(join(project,'.prism/cache/advisory-scans/sha256',lock.sdk_image.split('@sha256:')[1],'linux-'+arch+'.json')));}

// Independently bind both original exports to authenticated, retained build
// bytes. The public Rust reader additionally verifies semantics and oracles.
export function validateSeededApplication(original,buildId,modelDigest,binding,sourceAuthority,buildEvidence){
 assert(Buffer.isBuffer(original)&&original.length>0&&original.length<=16*1024*1024);
 const text=new TextDecoder('utf-8',{fatal:true}).decode(original),manifest=JSON.parse(text);
 assert.equal(canonical(manifest),text);hex(buildId);assert.match(modelDigest,digestPattern);
 keys(manifest,['acceptance_sha256','build_id','exporter_owner','lexlean_attestation_sha256','model_sha256','processes','schema']);
 assert.equal(manifest.schema,'prismpm/application-verification-manifest/2');assert.equal(manifest.build_id,buildId);
 assert.equal('sha256:'+manifest.model_sha256,modelDigest);
 hex(manifest.acceptance_sha256);hex(manifest.lexlean_attestation_sha256);
 assert(Array.isArray(manifest.processes)&&manifest.processes.length>0);
 for(const row of manifest.processes)assert.equal(row.exit_code,0);
 const exporters=manifest.processes.filter(row=>row.tool==='application-export'||Object.hasOwn(row,'exporter'));
 assert.equal(exporters.length,1,'one actual application regeneration exporter required');
 verifyExporterProcess(exporters[0],'application-export','sdk-seed',binding,sourceAuthority);
 const owner=validateVerificationOwner(manifest,'application','sdk-seed',binding,sourceAuthority);
 keys(buildEvidence,['model','lexlean_manifest','artifacts']);
 assert(Buffer.isBuffer(buildEvidence.model)&&Buffer.isBuffer(buildEvidence.lexlean_manifest));
 assert.equal(sha(buildEvidence.model),modelDigest);
 const model=JSON.parse(buildEvidence.model),application=model.application;
 assert(application&&Array.isArray(application.library_roots)&&application.library_roots.length>0);
 const outputs=JSON.parse(buildEvidence.lexlean_manifest).outputs;assert(Array.isArray(outputs));
 const modules=outputs.filter(row=>row.kind==='lean').map(row=>{
  assert.match(row.path,/^modules\/[A-Za-z0-9_/]+\.lean$/);return row.path.slice(8,-5).replaceAll('/','.');
 }).sort();assert(modules.length>0&&new Set(modules).size===modules.length);
 const ir=Object.hasOwn(application,'profile')?application.cargo_name.replaceAll('-','_'):application.name;
 assert.match(ir,/^[A-Za-z_][A-Za-z0-9_]*$/);
 const argv=['exe','prod-export',...modules.flatMap(module=>['--module',module]),
  ...application.library_roots.flatMap(root=>['--root',root]),'--ir-module',ir,'--out','$APPLICATION_WORK/export'];
 assert(Array.isArray(buildEvidence.artifacts)&&buildEvidence.artifacts.length>0);
 for(const phase of owner.phases){
  assert.equal(phase.lexlean_manifest_sha256,sha(buildEvidence.lexlean_manifest).slice(7));
  equal(phase.artifacts,buildEvidence.artifacts);equal(phase.processes[2].argv,argv);
 }
 return {manifest:text,manifest_sha256:sha(original)};
}
function seededProof(project,proof,result,buildId,lock){
 const selected=proof.layers.filter(row=>row.annotations?.['org.opencontainers.image.title']==='runtime/manifest.json');
 assert.equal(selected.length,1,'one original runtime manifest required');
 const binding=validateCapturedLock(Buffer.from(canonical(lock)),lock.sdk_image,{x64:'amd64',arm64:'arm64'}[process.arch],
  bytes(shared+'/standards.lock'),bytes(shared+'/inventory.json'));
 const release=rootBlob(project,result.release_digest);
 const manifests=release.layers.filter(row=>row.annotations?.['org.prismpm.role']==='build-manifest');
 assert.equal(manifests.length,1);assert.equal(manifests[0].digest,result.build_digest);
 const build=JSON.parse(verifiedBlob(project,manifests[0]));
 assert.equal(sha(canonical(build.inputs)).slice(7),buildId);
 const retained=new Map();
 for(const row of release.layers.filter(row=>row.annotations?.['org.prismpm.role']==='release-artifact')){
  const path=row.annotations?.['org.opencontainers.image.title'];assert(typeof path==='string'&&!retained.has(path));
  assert(!path.includes('\\')&&!path.startsWith('/')&&path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
  retained.set(path,verifiedBlob(project,row));
 }
 const files=[...retained].map(([path,value])=>({path,byte_length:value.length,sha256:sha(value).slice(7)})).sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);
 equal(build.files.map(({kind,...row})=>row),files);
 const model=retained.get('model.prism.json'),lexlean_manifest=retained.get('application/lexlean-build-manifest.json');
 // This installed gate explicitly owns the browser-resident Calculator system.
 // No broad projections/* exclusion can hide an unowned application artifact.
 const system=JSON.parse(retained.get('system.prism.json'));assert.equal(system.schema,'prismpm/system-model/2');
 const excluded=new Set(['model.prism.json','system.prism.json','application/lexlean-snapshot.json',
  'application/lexlean-build-manifest.json','projections/browser-system-release.json','projections/spdx.json']);
 const artifacts=files.filter(row=>!row.path.startsWith('lexlean/')&&!row.path.startsWith('application/lexlean-build/')&&!excluded.has(row.path));
 return validateSeededApplication(verifiedBlob(project,selected[0]),buildId,result.model_digest,binding,
  {archive_sha256:sha(bytes(join(installed,'vendor/lean4-prod/lean.tar'))).slice(7),toolchain:bytes(join(installed,'lean-toolchain')).toString().trim()},
  {model,lexlean_manifest,artifacts});
}

export async function acquire(){
 const lock=json(join(inputs,'prismpm.lock')),inventory=imageEnvironment(lock);assert(!existsSync(work));mkdirSync(work);
 const first=join(work,'first');await projectSource(first);
 // The public check command has no release operand; system_root(None) selects
 // B. Both A and B must independently bind this same checked application.
 const checked=await cli(first,['check'],{schema:'prismpm/check-result/1'});
 const built=await cli(first,['build','--release','A'],{schema:'prismpm/build-result/1'});
 const packageFiles=await generatedPackage(first,built);
 const fetched=await cli(first,['fetch','--locked'],{});const actualScans=scans(first,lock);validateScans(actualScans,lock,inventory);
 const second=join(work,'second');await projectSource(second);
 for(const row of packageFiles)put(join(second,row.path),bytes(join(first,row.path)));
 await registry(second);copy(join(first,'.prism/cache'),join(second,'.prism/cache'));copy(join(first,'.prism/sdk'),join(second,'.prism/sdk'));
 record(join(work,'acquisition.json'),{sdk_image:lock.sdk_image,sdk_lock_sha256:sha(bytes(join(inputs,'prismpm.lock'))),inventory_sha256:sha(bytes(shared+'/inventory.json')),checked,fetched,package_files:packageFiles,scans:actualScans});
 return {phase:'acquired',sdk_image:lock.sdk_image,scan_count:actualScans.length};
}
function boundRelease(project,result,lock){
 const root=rootBlob(project,result.release_digest),config=JSON.parse(verifiedBlob(project,root.config));
 assert.equal(root.config.digest,result.product_digest);assert.equal(config.model_digest,result.model_digest);
 assert.equal(config.sdk_digest,lock.sdk_image.split('@')[1]);assert.equal(config.sdk_lock,sha(bytes(join(project,'prismpm.lock'))));
 assert.equal(config.standards_lock,sha(bytes(join(project,'standards.lock'))));assert.equal(config.status,'development');
 const manifestLayers=root.layers.filter(row=>row.annotations?.['org.prismpm.role']==='build-manifest');assert.equal(manifestLayers.length,1);assert.equal(manifestLayers[0].digest,result.build_digest);
 const manifest=JSON.parse(verifiedBlob(project,manifestLayers[0]));const buildId=sha(canonical(manifest.inputs)).slice(7);
 const model=json(join(project,'.prism/build',buildId,'model.prism.json'));assert.equal(result.model_digest,sha(canonical(model)));
 const system=json(join(project,'.prism/build',buildId,'system.prism.json'));assert.equal(system.schema,'prismpm/system-model/2');
 assert.equal(system.application_profile.contract,'prismpm/browser-resident-application/1');assert.equal(system.application_profile.application_model_digest,result.model_digest);
 const proof=referrer(project,result.release_digest,proofType);assert(proof.layers.length>0);
 const exporter_manifest=seededProof(project,proof,result,buildId,lock);
 const sbom=evidence(project,result.release_digest,spdxType),policy=evidence(project,result.release_digest,policyType);
 assert.equal(policy.value.release_digest,result.release_digest);assert.equal(policy.value.spdx.digest,sbom.descriptor.digest);
 assert.equal(policy.value.spdx.closure_matches_oci,true);assert.equal(policy.value.promotion.eligible,false);
 assert.equal(policy.value.vulnerability_result.cargo_vulnerability_count,0);assert.equal(policy.value.vulnerability_result.image_rejected_count,0);
 assert.equal(policy.value.vulnerability_input.status,'within-production-policy');assert(policy.value.vulnerability_input.expires_unix>Math.floor(Date.now()/1000));
 equal(policy.value.vulnerability_result.image_scans.map(row=>row.platform).sort(),['linux/amd64','linux/arm64']);
 for(const scan of policy.value.vulnerability_result.image_scans){assert.equal(scan.reference,lock.sdk_image);assert(scan.package_count>0);assert.equal(scan.rejected_count,0);}
 assert(Array.isArray(sbom.value['@graph'])&&sbom.value['@graph'].length>0);
 return{result,build_id:buildId,build_files:tree(join(project,'.prism/build',buildId)),proof,exporter_manifest,spdx_sha256:sbom.descriptor.digest,policy_sha256:policy.descriptor.digest};
}
export async function buildProducts(){
 const lock=json(join(inputs,'prismpm.lock'));imageEnvironment(lock);const rows=[];
 const acquired=json(join(work,'acquisition.json'));hex(acquired.checked.model_id);
 for(const name of ['first','second']){
  const project=join(work,name),before=bytes(join(project,'prismpm.lock'));
  const checked=await cli(project,['check'],{schema:'prismpm/check-result/1'});equal(checked,acquired.checked);
  for(const release of ['A','B']){
   const result=productResult(await cli(project,['build','--locked','--release',release,'-t',reference+':'+release.toLowerCase()],{schema:'prismpm/product-release-result/1'}),release);
   assert.equal(result.model_digest,'sha256:'+checked.model_id,'actual checked model must bind product');
   equal(bytes(join(project,'prismpm.lock')).toString(),before.toString());
   rows.push({source:name,release,...boundRelease(project,result,lock)});
  }
 }
 for(const release of ['A','B']){const pair=rows.filter(row=>row.release===release);equal(pair[0].result,pair[1].result);equal(pair[0].build_files,pair[1].build_files);}
 assert.notEqual(rows[0].result.release_digest,rows[1].result.release_digest,'A/B must be distinct genuine releases');
 const mutation=join(work,'first/prismpm.lock'),original=bytes(mutation),changed=JSON.parse(original);
 const native=changed.platforms.find(row=>row.platform==='linux/'+({x64:'amd64',arm64:'arm64'}[process.arch]));native.inventory_digest='sha256:'+'0'.repeat(64);
 writeFileSync(mutation,canonical(changed));try{await cli(join(work,'first'),['lock','check'],{code:'PP5401',exit:4});}finally{writeFileSync(mutation,original);}
 await cli(join(work,'first'),['lock','check'],{});
 const result={schema:'prismpm/installed-product-build-check/1',sdk_image:lock.sdk_image,releases:rows,checks:['two-roots','release-A','release-B','genuine-product-cli','genuine-sdk-inventory','genuine-advisory-scans','genuine-spdx','wrong-native-lock-refused'],unclaimed};
 record(join(work,'build.json'),result);return result;
}

export async function receive(){
 // Outer orchestration copies only these two data inputs into this fresh
 // container. No source, acquired cache or producer build directory is mounted.
 equal(readdirSync(work).sort(),['build.json','receiver']);
 const build=json(join(work,'build.json')),receiver=join(work,'receiver');equal(readdirSync(receiver),['.prism']);equal(readdirSync(join(receiver,'.prism')),['oci']);
 const outputs=[];
 for(const row of build.releases.filter(row=>row.source==='first')){
  const pinned=reference+'@'+row.result.release_digest;
  await cli(receiver,['inspect',pinned],{});
  const output='browser-'+row.release.toLowerCase();
  const result=await cli(receiver,['export-browser',pinned,'--output',output],{schema:'prismpm/browser-export/1'});
  assert.equal(result.release_digest,row.result.release_digest);assert.equal(result.model_digest,row.result.model_digest);assert.equal(result.build_digest,row.result.build_digest);
  const files=tree(join(receiver,output)).filter(item=>item.kind==='file');assert.equal(files.length,6,'exact six-file browser closure');
  equal(files.map(item=>item.path),result.files.map(item=>item.path));assert.equal(sha(canonical(result.files)),result.tree_digest);
  for(const item of result.files){const actual=files.find(candidate=>candidate.path===item.path);assert(actual);assert.equal(actual.size,item.size);assert.equal('sha256:'+actual.sha256,item.digest);}
  const proof=referrer(receiver,row.result.release_digest,proofType);
  const release=rootBlob(receiver,row.result.release_digest),locks=release.layers.filter(item=>item.annotations?.['org.prismpm.role']==='sdk-lock');assert.equal(locks.length,1);
  const lock=JSON.parse(verifiedBlob(receiver,locks[0]));assert.equal(lock.sdk_image,build.sdk_image);
  equal(seededProof(receiver,proof,row.result,row.build_id,lock),row.exporter_manifest);
  const victim=proof.layers.find(item=>item.annotations?.['org.opencontainers.image.title']?.startsWith('runtime/'));assert(victim);
  const path=join(receiver,'.prism/oci/blobs/sha256',victim.digest.slice(7)),original=bytes(path);
  for(const [name,change] of [['missing-proof',()=>rmSync(path)],['changed-proof',()=>writeFileSync(path,Buffer.concat([original,Buffer.from([0])]))]]){
   change();try{await cli(receiver,['export-browser',pinned,'--output',output+'-'+name],{code:'PP6101',exit:5});assert(!existsSync(join(receiver,output+'-'+name)));}finally{writeFileSync(path,original);}
  }
  const restored=await cli(receiver,['export-browser',pinned,'--output',output+'-restored'],{schema:'prismpm/browser-export/1'});assert.equal(restored.tree_digest,result.tree_digest);
  outputs.push({release:row.release,release_digest:row.result.release_digest,model_digest:result.model_digest,build_digest:result.build_digest,tree_digest:result.tree_digest,files:result.files,checks:['source-free-proof-replay','exact-browser-export','missing-proof-refused','changed-proof-refused','restored-export']});
 }
 return{schema:'prismpm/installed-product-cli-check/1',scope:'installed-cli-product-build-and-source-free-integrity',status:'passed',sdk_image:build.sdk_image,releases:outputs,unclaimed};
}

export function verifyResult(value,image){
 keys(value,['schema','scope','status','sdk_image','releases','unclaimed']);
 assert.equal(value.schema,'prismpm/installed-product-cli-check/1');assert.equal(value.scope,'installed-cli-product-build-and-source-free-integrity');assert.equal(value.status,'passed');
 assert.match(image,imagePattern);assert.equal(value.sdk_image,image);equal(value.unclaimed,unclaimed);
 assert.equal(value.releases.length,2);equal(value.releases.map(row=>row.release),['A','B']);
 assert.notEqual(value.releases[0].release_digest,value.releases[1].release_digest);
 for(const row of value.releases){
  keys(row,['release','release_digest','model_digest','build_digest','tree_digest','files','checks']);
  for(const name of ['release_digest','model_digest','build_digest','tree_digest'])assert.match(row[name],digestPattern);
  equal(row.checks,['source-free-proof-replay','exact-browser-export','missing-proof-refused','changed-proof-refused','restored-export']);
  equal(row.files.map(file=>file.path),['app.css','app.js','index.html','prism_calculator.js','prism_calculator_bg.wasm','provenance.json']);
  for(const file of row.files){keys(file,['path','digest','size']);assert.match(file.digest,digestPattern);assert(Number.isSafeInteger(file.size)&&file.size>=0);}
  assert.equal(sha(canonical(row.files)),row.tree_digest);
 }
}

export function testOutput(output){
 assert.equal(output.error,undefined);assert.equal(output.signal,null);assert.equal(output.status,0);
 assert.equal(verifyTap(output.stdout,19),19,'complete owning product gate test count');
}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='roots'&&args.length===0)console.log(sourceRoots.join('\n'));
 else if(mode==='capture'&&args.length===2)console.log(canonical(capture(...args)));
 else if(mode==='verify'&&args.length===2)verifySource(args[0],json(args[1]));
 else if(mode==='image'&&args.length===3)verifyImage(JSON.parse(readFileSync(0)),...args);
 else if(mode==='lock'&&args.length===2){assert.match(args[0],imagePattern);const lock=await capturePlatformLock(args[0],sha(bytes(args[1])));process.stdout.write(canonical(lock));}
 else if(mode==='acquire'&&args.length===0)console.log(canonical(await acquire()));
 else if(mode==='build'&&args.length===0)console.log(canonical(await buildProducts()));
 else if(mode==='receive'&&args.length===0)console.log(canonical(await receive()));
 else if(mode==='result'&&args.length===2)verifyResult(json(args[0]),args[1]);
 else if(mode==='tests'&&args.length===0){
  const env={...process.env};delete env.NODE_TEST_CONTEXT;
  const result=await launchProcess(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','--test-timeout=120000','scripts/product-sdk-check.test.mjs'],{cwd:dirname(dirname(fileURLToPath(import.meta.url))),env,timeout:150000,maxBuffer:16*1024*1024});
  process.stdout.write(result.stdout??'');process.stderr.write(result.stderr??'');testOutput(result);
 }
 else throw new Error('closed installed product CLI gate command');
}
