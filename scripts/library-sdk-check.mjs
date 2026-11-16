// Installed native-profile acceptance only; not SDK release or product acceptance.
import { readSemantic, writeSemantic } from './semantic-source.mjs';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {constants,closeSync,cpSync,existsSync,fstatSync,lstatSync,mkdirSync,mkdtempSync,openSync,readFileSync,readlinkSync,readdirSync,readSync,rmSync,chmodSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {verifyImage,verifyTap} from './browser-api-sdk-check.mjs';
import {compilerRevision} from '../sdk/inventory-metadata.mjs';
import {parseSdkIndex,validateInventory} from '../sdk/platform-lock.mjs';
import {verifiedCommands} from '../sdk/metadata-cli.mjs';
import {captureSdkMetadataEvidence} from '../sdk/metadata-evidence-cli.mjs';
import {verifyMetadataEvidence} from '../sdk/metadata-evidence.mjs';
import {qualifyMigration,verifyMigration} from '../sdk/migration-qualification.mjs';
import {captureInstalledCustody,runConcurrentInstalled,verifyCustody,installedEnvironment} from './installed-exporter-concurrency.mjs';
export {verifyImage};

export const sourceRoots=Object.freeze([
 '.cargo','Cargo.toml','Cargo.lock','rust-toolchain.toml','lean-toolchain',
 'crates/prismpm/Cargo.toml','crates/prismpm/src','crates/prismpm/model','crates/prismpm/schemas',
 'crates/prismpm/LICENSE-MIT','crates/prismpm/LICENSE-APACHE','crates/prismpm/vendor',
 'crates/prismpm/stdlib','crates/prismpm/sdk','crates/prismpm/standards','crates/prismpm/standards.lock',
 'crates/prismpm/adapters','crates/prismpm/language',
 'crates/prismpm/tests/native_library.rs','crates/conformance/src/cases/native_library.rs',
 'model','language','schemas','stdlib','sdk','standards','standards.lock','adapters','LICENSE-MIT','LICENSE-APACHE',
 'tests/fixtures/library/native-library/project','tests/hologram-oracle','vendor',
 'scripts/browser-api-sdk-check.mjs','scripts/library-sdk-check.mjs','scripts/library-sdk-check.sh',
 'scripts/sdk-command-owner.mjs','scripts/sdk-command-owner.py',
 'scripts/sdk-qualification-trust.mjs',
 'scripts/semantic-source.mjs','crates/conformance/src/bin/prismpm-semantic-source.rs',
 'scripts/library-sdk-check.test.mjs','scripts/library-sdk-check-shell.test.mjs','scripts/library-sdk-fixture.mjs','scripts/library-owner-reader-replay.mjs','.github/workflows/release.yml',
 'scripts/installed-exporter-concurrency.mjs','scripts/installed-exporter-concurrency.test.mjs','scripts/portable-oracle-process-owner.py',
 'scripts/hologram-source-pins.mjs','scripts/hologram-source-pins.test.mjs','crates/prismpm/tests/hologram_interop.rs',
 'scripts/library-sdk-metadata-evidence.mjs',
 'tests/holo-codec-oracle/Cargo.toml','tests/holo-codec-oracle/Cargo.lock',
]);
// Tracked compiler include aliases only. Their complete target roots are bound
// separately above; unknown, changed or escaping aliases are never followed.
export const sourceAliases=Object.freeze({
 'crates/prismpm/model':'../../model',
 'crates/prismpm/schemas':'../../schemas',
 'crates/prismpm/LICENSE-MIT':'../../LICENSE-MIT',
 'crates/prismpm/LICENSE-APACHE':'../../LICENSE-APACHE',
 'crates/prismpm/vendor':'../../vendor',
 'crates/prismpm/stdlib':'../../stdlib',
 'crates/prismpm/sdk':'../../sdk',
 'crates/prismpm/standards':'../../standards',
 'crates/prismpm/standards.lock':'../../standards.lock',
 'crates/prismpm/adapters':'../../adapters',
 'crates/prismpm/language':'../../language',
 'crates/prismpm/src/embedded/hologram-oracle.main.rs':'../../../../tests/hologram-oracle/src/main.rs',
 'crates/prismpm/src/embedded/hologram-oracle.Cargo.toml':'../../../../tests/hologram-oracle/Cargo.toml',
 'crates/prismpm/src/embedded/hologram-oracle.Cargo.lock':'../../../../tests/hologram-oracle/Cargo.lock',
 'crates/prismpm/src/embedded/lean4-prod-rust.MANIFEST.sha256':'../../../../vendor/lean4-prod/rust/MANIFEST.sha256',
});
const acceptanceRoot='LibraryProbe.Probe.acceptance',identityRoot='LibraryProbe.Probe.identity';
const roots=[acceptanceRoot,identityRoot],unclaimed=['application','browser','holo','production-release','deployment'];
const exits=Object.freeze({PP2001:1,PP5006:1,PP6101:5});
const completedChecks=Object.freeze(['read-only-check','std','no_std','exact-package-replay','two-root-reproduction','product-refusal','missing-root','wrong-result-root','parameterized-root','nominal-impostor','false-generated-acceptance','restored-acceptance','authenticated-seed-admission','cold-warm-two-root-equivalence','installed-concurrent-owner-equivalence','immutable-seed-original-custody']);
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
const hex=value=>{assert.equal(typeof value,'string');assert.match(value,/^[0-9a-f]{64}$/);return value;};
const canonical=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(key=>[key,v[key]])):v);
const same=(actual,expected,message)=>assert.ok(canonical(actual)===canonical(expected),message);
const keys=(value,names)=>{assert.ok(value&&typeof value==='object'&&!Array.isArray(value),'closed object');same(Object.keys(value).sort(),names.slice().sort(),'closed object fields');};
function regularBytes(path,maximum=64*1024*1024){
 const before=lstatSync(path);assert.ok(before.isFile()&&!before.isSymbolicLink()&&before.size<=maximum,'bounded regular file: '+path);
 const fd=openSync(path,constants.O_RDONLY|constants.O_NOFOLLOW|constants.O_NONBLOCK);
 try{
  const opened=fstatSync(fd);for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(opened[key],before[key],'file changed');
  const bytes=Buffer.alloc(opened.size+1);let size=0;
  while(size<bytes.length){const count=readSync(fd,bytes,size,bytes.length-size,null);if(!count)break;size+=count;}
  assert.equal(size,opened.size,'file length changed');
  for(const after of [fstatSync(fd),lstatSync(path)]){assert.ok(after.isFile()&&!after.isSymbolicLink());for(const key of ['dev','ino','size','mtimeMs','ctimeMs'])assert.equal(after[key],opened[key],'file changed');}
  return bytes.subarray(0,size);
 }finally{closeSync(fd);}
}

// Only independently acquired metadata is admitted. The native bytes below
// come from the selected immutable image, never the lock being checked.
export function validateAcquisitionBytes(bytes){
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=288*1024*1024,'bounded original acquisition record required');
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),value=JSON.parse(text);
 // Compare original bytes before projecting the nested lock. JSON.parse alone
 // discards duplicate keys; any such normalization must refuse this record.
 assert.equal(canonical(value),text,'original canonical acquisition record required');
 keys(value,['lock','migration','metadata']);
 return value;
}

export function validateCapturedLock(bytes,image,architecture,standards,nativeInventory){
 assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=64*1024*1024,'bounded captured SDK lock required');
 assert(['amd64','arm64'].includes(architecture));
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes),lock=JSON.parse(text);
 assert.equal(canonical(lock),text,'original canonical SDK lock required');
 keys(lock,['schema','sdk_version','sdk_image','sdk_index','standards_lock','platforms']);
 assert.equal(lock.schema,'prismpm/sdk-lock/2');assert.equal(lock.sdk_version,'0.3.0');assert.equal(lock.sdk_image,image);
 assert.equal(lock.standards_lock,'sha256:'+hash(standards));
 const children=parseSdkIndex(Buffer.from(lock.sdk_index),image);
 same(lock.platforms.map(row=>row.platform),['linux/amd64','linux/arm64'],'complete ordered SDK platforms');
 let identities;
 for(const [index,row] of lock.platforms.entries()){
  keys(row,['platform','manifest_digest','inventory_digest','inventory_document','inventory']);
  assert.equal(row.manifest_digest,children[index].descriptor.digest);
  const inventoryBytes=Buffer.from(row.inventory_document),inventory=validateInventory(inventoryBytes);
  assert.equal(row.inventory_digest,'sha256:'+hash(inventoryBytes));same(row.inventory,inventory.artifacts,'complete inventory document binding');
  const selected=inventory.artifacts.map(item=>[item.id,item.kind,item.version]);
  if(identities)same(selected,identities,'SDK platform artifact identities differ');identities=selected;
  const seeds=inventory.artifacts.filter(item=>item.id==='lean4-prod-exporter-seed');
  const exporters=inventory.artifacts.filter(item=>item.id==='lean4-prod-exporter');
  assert.equal(seeds.length,1,'advertised exporter seed required');assert.equal(exporters.length,1);
  assert.equal(seeds[0].kind,'dependency-lock');assert.equal(seeds[0].version,'1');assert.equal(exporters[0].kind,'binary');
  assert.match(exporters[0].version,/^[a-f0-9]{40}$/);
 }
 const native=lock.platforms.find(row=>row.platform==='linux/'+architecture);
 assert(Buffer.from(native.inventory_document).equals(nativeInventory),'captured native inventory differs from selected image');
 return {sdk_image:image,platform:native.platform,lock_sha256:hash(bytes),inventory_sha256:hash(nativeInventory),
  seed_manifest_sha256:native.inventory.find(row=>row.id==='lean4-prod-exporter-seed').digest.slice(7),
  exporter_sha256:native.inventory.find(row=>row.id==='lean4-prod-exporter').digest.slice(7),
  compiler_revision:native.inventory.find(row=>row.id==='lean4-prod-exporter').version};
}

function stdinLock(){
 const bytes=Buffer.alloc(64*1024*1024+1);let offset=0;
 while(offset<bytes.length){const size=readSync(0,bytes,offset,bytes.length-offset,null);if(!size)break;offset+=size;}
 assert(offset>0&&offset<bytes.length,'bounded explicit SDK lock input required');return bytes.subarray(0,offset);
}

async function acquireLock(root,image){
 const inventory='/opt/prismpm/share/inventory.json',standards=regularBytes(join(root,'standards.lock'));
 assert(standards.equals(regularBytes('/opt/prismpm/share/standards.lock')),'installed standards differ from captured source');
 const captured=await captureSdkMetadataEvidence(image,'sha256:'+hash(standards),verifiedCommands(inventory));
 const bytes=Buffer.from(canonical(captured.lock));
 validateCapturedLock(bytes,image,{x64:'amd64',arm64:'arm64'}[process.arch],standards,regularBytes(inventory));
 return {lock:JSON.parse(bytes),migration:qualifyMigration(bytes),metadata:captured.evidence};
}

export function tree(root,selected=[''],aliases={}){
 root=resolve(root);assert.ok(lstatSync(root).isDirectory()&&!lstatSync(root).isSymbolicLink(),'source root alias');
 const files=[];
 function walk(relative){
  assert.ok(files.length<100000,'source entry limit');const path=join(root,relative),stat=lstatSync(path);
  if(Object.hasOwn(aliases,relative)){
   assert.ok(stat.isSymbolicLink(),'required source alias: '+relative);assert.equal(readlinkSync(path),aliases[relative],'changed source alias');
   const target=resolve(dirname(path),aliases[relative]);assert.ok(target.startsWith(root+'/')&&existsSync(target),'missing or escaping alias target');
   files.push({path:relative,kind:'symlink',target:aliases[relative]});return;
  }
  assert.ok(!stat.isSymbolicLink(),'source symlink: '+relative);
  if(stat.isDirectory()){
   files.push({path:relative+'/',kind:'directory'});
   for(const name of readdirSync(path).sort()){
    // Only generated top-level caches of the selected dependency are excluded.
    if(['vendor/lexlean','vendor/lean4-prod/rust'].includes(relative)&&['target','.lake','.lexlean','.prism'].includes(name))continue;
    walk(relative?relative+'/'+name:name);
   }
  }else{const bytes=regularBytes(path);files.push({path:relative,kind:'file',size:bytes.length,sha256:hash(bytes)});}
 }
 for(const relative of selected){
  let parent=root;for(const part of relative.split('/').slice(0,-1)){parent=join(parent,part);const stat=lstatSync(parent);assert.ok(stat.isDirectory()&&!stat.isSymbolicLink(),'source parent alias');}
  walk(relative);
 }
 files.sort((a,b)=>a.path<b.path?-1:a.path>b.path?1:0);assert.equal(new Set(files.map(row=>row.path)).size,files.length,'duplicate source entries');
 same(files.filter(row=>row.kind==='symlink').map(row=>row.path),Object.keys(aliases).sort(),'complete tracked source aliases');return files;
}
export function capture(root,revision){assert.equal(typeof revision,'string');assert.match(revision,/^[0-9a-f]{40}$/);return{revision,files:tree(root,sourceRoots,sourceAliases)};}
export function verifySource(root,expected){same(capture(root,expected.revision),expected,'installed SDK source closure differs');}

export function cli(project,args,expected,launch=spawnSync){
 const env={...process.env,CARGO_NET_OFFLINE:'true'};delete env.CARGO_TARGET_DIR;
 const output=launch('/usr/local/bin/prismpm',['--project',project,'--json',...args],{encoding:'utf8',env,timeout:900000,maxBuffer:16*1024*1024});
 return cliOutput(output,expected);
}
export function cliOutput(output,expected){
 assert.equal(output.error,undefined,'CLI execution failed');assert.equal(output.signal,null,'CLI terminated');
 if(expected.code)assert.ok(Object.hasOwn(exits,expected.code),'declared diagnostic exit class');
 assert.equal(output.status,expected.code ? exits[expected.code] : 0, "CLI exit class");
 let value;try{value=JSON.parse(output.stdout);}catch{throw new Error('CLI did not emit exactly one JSON result');}
 if(expected.code){assert.equal(value.schema,'prismpm/error-result/1');assert.equal(value.diagnostic?.code,expected.code);if(expected.message)assert.equal(value.diagnostic.message,expected.message);
  if(expected.assertion!==undefined){assert.equal(expected.code,'PP5006');requireModeledAssertionFailure(value,expected.assertion);}}
 else{
  assert.equal(value.schema,expected.schema,'CLI success schema');
  const fields={
   'prismpm/check-result/1':['schema','semantic_id','snapshot_id','model_id','entity_count'],
   'prismpm/build-result/1':['schema','build_id','source_id','semantic_id','model_path','manifest_path'],
   'prismpm/verify-result/1':['schema','build_id','attestation_id','verified_root'],
  };
  assert.ok(Object.hasOwn(fields,value.schema),'declared result contract');keys(value,fields[value.schema]);
  for(const [name,item] of Object.entries(value))if(name.endsWith('_id'))hex(item);
  if(value.schema==='prismpm/check-result/1')assert.ok(Number.isSafeInteger(value.entity_count)&&value.entity_count>=0);
  if(value.schema==='prismpm/build-result/1'){assert.equal(value.model_path,'.prism/build/'+value.build_id+'/model.prism.json');assert.equal(value.manifest_path,'.prism/build/'+value.build_id+'/manifest.json');}
  if(value.schema==='prismpm/verify-result/1')assert.equal(value.verified_root,'.prism/verified/'+value.attestation_id);
 }
 return value;
}
// Code alone cannot distinguish an assertion from Cargo/compiler/transcript
// failure. This private oracle requires the actual generated main assertion.
export function requireModeledAssertionFailure(value,root){
 keys(value,['schema','diagnostic']);assert.equal(value.schema,'prismpm/error-result/1');
 const diagnostic=value.diagnostic;keys(diagnostic,['code','message','primary','labels','notes','help','causes']);
 assert.equal(diagnostic.code,'PP5006');assert.equal(diagnostic.primary,null);
 for(const field of ['labels','notes','help','causes'])same(diagnostic[field],[]);
 assert.equal(typeof root,'string');assert.match(root,/^[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+$/);
 const message=diagnostic.message;assert.equal(typeof message,'string');assert(Buffer.byteLength(message)<=16*1024*1024);
 assert(message.startsWith('native-library-std-acceptance exited 101: stdout=""; stderr="')&&message.endsWith('"'));
 assert(!message.includes('could not compile')&&!message.includes('error[E'));
 const parts=message.split("\\nthread 'main' ");assert.equal(parts.length,2,'one actual main panic required');
 const lines=parts[1].split('\\n');
 assert.match(lines[0],/^(?:\([0-9]+\) )?panicked at src\/main\.rs:[1-9][0-9]*:[1-9][0-9]*:$/);
 assert.equal(lines[1],root,'the first generated main panic must name the exact modeled assertion');
}
function document(path){const bytes=regularBytes(path),value=JSON.parse(bytes);assert.ok(bytes.equals(Buffer.from(canonical(value))),'canonical artifact bytes: '+path);return value;}
function noVerification(project){const path=join(project,'.prism/verified');assert.ok(!existsSync(path)||readdirSync(path).length===0,'unaccepted source published verification');}
export function checkAccepted(project,receipt,exporterArchiveSha256,compilerIdentity,requiredAcquisition='cold',binding){
 return readLibraryEvidence(project,receipt,exporterArchiveSha256,compilerIdentity,requiredAcquisition,binding,false);
}
// Compatibility parsing is deliberately not the current SDK acceptance API.
export function readHistoricalLibraryEvidence(project,receipt,exporterArchiveSha256,compilerIdentity,requiredAcquisition='cold',binding){
 return readLibraryEvidence(project,receipt,exporterArchiveSha256,compilerIdentity,requiredAcquisition,binding,true);
}
function readLibraryEvidence(project,receipt,exporterArchiveSha256,compilerIdentity,requiredAcquisition,binding,historical){
 assert(['cold','sdk-seed'].includes(requiredAcquisition));
 hex(exporterArchiveSha256);
 keys(receipt,['schema','build_id','attestation_id','verified_root']);
 assert.equal(receipt.schema,'prismpm/verify-result/1');hex(receipt.build_id);hex(receipt.attestation_id);
 assert.equal(receipt.verified_root,'.prism/verified/'+receipt.attestation_id);
 const verified=join(project,receipt.verified_root),build=join(project,'.prism/build',receipt.build_id);
 same(tree(verified).map(row=>row.path),['/','lexlean-attestation.json','library-acceptance.json','manifest.json'],'unexpected verified outputs');
 const manifestBytes=regularBytes(join(verified,'manifest.json')),manifest=JSON.parse(manifestBytes);
 const acceptanceBytes=regularBytes(join(verified,'library-acceptance.json')),acceptance=JSON.parse(acceptanceBytes);
 assert.ok(manifestBytes.equals(Buffer.from(canonical(manifest))),'canonical verification manifest');assert.ok(acceptanceBytes.equals(Buffer.from(canonical(acceptance))),'canonical library acceptance');
 const owned=manifest.schema==='prismpm/library-verification-manifest/2';
 assert(owned||historical,'current SDK acceptance requires both original exporter phases');
 keys(manifest,['acceptance_sha256','artifacts','build_id','lexlean_attestation_sha256','model_sha256','processes','schema','scope',...(owned?['exporter_owner']:[])]);
 assert.equal(hash(manifestBytes),receipt.attestation_id);assert(owned||manifest.schema==='prismpm/library-verification-manifest/1');assert.equal(manifest.scope,'native-library-only');assert.equal(manifest.build_id,receipt.build_id);
 const lexBytes=regularBytes(join(verified,'lexlean-attestation.json')),lexAttestation=JSON.parse(lexBytes);
 assert.equal(manifest.acceptance_sha256,hash(acceptanceBytes));assert.equal(manifest.lexlean_attestation_sha256,hash(lexBytes));hex(lexAttestation.attestation_id);
 const modelBytes=regularBytes(join(build,'model.prism.json')),model=JSON.parse(modelBytes);
 assert.ok(modelBytes.equals(Buffer.from(canonical(model))),'canonical model document');
 keys(model,['architecture','library','provenance','quality','schema','security','standards_profile']);
 same(model.architecture,{component_kinds:[],components:[],concerns:[],edge_kinds:[],edges:[],model_kinds:[],stakeholders:[],viewpoints:[],views:[]},'no application architecture claim');
 same(model.quality,{characteristics:[],measures:[],requirements:[],subcharacteristics:[]},'no application quality claim');
 same(model.security,{activities:[],assets:[],controls:[],impacts:[],likelihoods:[],measurements:[],risks:[],threats:[]},'no application security claim');same(model.standards_profile,[],'no application standards claim');
 keys(model.provenance,['compiler_semantics_id','emitter_semantics_id','facet_packages','semantic_id','snapshot_id','source_id']);same(model.provenance.facet_packages,[],'no application facet packages');
 for(const [key,value] of Object.entries(model.provenance))if(key!=='facet_packages')hex(value);
 same(model.library,{profile:'prismpm/native-library/1',name:'Library probe',cargo_name:'prism-library-probe',cargo_version:'0.1.0',cargo_description:'Finite native-library acceptance fixture',cargo_repository:'https://github.com/UOR-Foundation/PrismPM',cargo_homepage:'https://github.com/UOR-Foundation/PrismPM',export_roots:roots,acceptance_roots:[acceptanceRoot]},'exact fixture library descriptor');
 assert.equal(manifest.model_sha256,hash(modelBytes));assert.equal(model.schema,'prismpm/model-document/3');assert.equal(model.application,undefined);assert.equal(model.library.profile,'prismpm/native-library/1');
 same(acceptance,{build_id:receipt.build_id,executions:['std','no_std'].map(mode=>({mode,roots:[acceptanceRoot],status:'passed'})),export_roots:roots,lexlean_attestation_id:lexAttestation.attestation_id,model_id:hash(modelBytes),profile:'prismpm/native-library/1',regeneration:'byte-identical',schema:'prismpm/library-acceptance/1',scope:'native-library-only',status:'passed',unclaimed},'library acceptance scope or execution differs');
 assert.ok(Array.isArray(manifest.processes)&&manifest.processes.length>0);assert.ok(manifest.processes.every(row=>row.exit_code===0),'failed recorded execution');
 same(manifest.processes.map(row=>row.tool),['lean-version','lake-version','rustfmt-version','rustc-version','timeout-version','lake-build-generated','lean4-prod-build','prod-export','native-library-package','native-library-std-lock','native-library-std-acceptance','native-library-no_std-lock','native-library-no_std-acceptance'],'complete ordered native verification processes');
 for(const row of manifest.processes){
  keys(row,['tool','argv','executable_sha256','exit_code','stdout','stderr',...(row.tool==='prod-export'?['exporter']:[])]);
  hex(row.executable_sha256);assert.ok(Array.isArray(row.argv)&&row.argv.every(arg=>typeof arg==='string'));assert.equal(typeof row.stdout,'string');assert.equal(typeof row.stderr,'string');
  if(row.tool==='prod-export'){
   same(row.argv.slice(0,2),['exe','prod-export'],'actual Lake exporter invocation required');
   keys(row.exporter,['schema','source_archive_sha256','executable','acquisition']);assert.equal(row.exporter.schema,'prismpm/exporter-execution/1');assert.equal(row.exporter.source_archive_sha256,exporterArchiveSha256,'exporter source differs from independently captured SDK source');
   const acquisition=row.exporter.acquisition;
   assert.equal(acquisition?.mode,requiredAcquisition,'required exporter acquisition was not executed');
   if(acquisition?.mode==='cold') same(acquisition,{schema:'prismpm/exporter-acquisition/1',mode:'cold'},'closed cold acquisition required');
   else {
    keys(acquisition,['schema','mode','inventory_sha256','manifest_sha256','executable_sha256','archive_sha256','compiler_revision','platform','toolchain']);
    assert.equal(acquisition.schema,'prismpm/exporter-acquisition/1');assert.equal(acquisition.mode,'sdk-seed');
    for(const field of ['inventory_sha256','manifest_sha256','executable_sha256','archive_sha256']) hex(acquisition[field]);
    assert.equal(acquisition.archive_sha256,exporterArchiveSha256);assert.equal(acquisition.executable_sha256,row.exporter.executable.sha256);
    const lock=JSON.parse(regularBytes(join(project,'prismpm.lock')));assert.equal(lock.schema,'prismpm/sdk-lock/2');
    keys(lock,['schema','sdk_version','sdk_image','sdk_index','standards_lock','platforms']);assert.equal(lock.sdk_version,'0.3.0');
    const children=parseSdkIndex(Buffer.from(lock.sdk_index),lock.sdk_image);
    assert.equal(lock.platforms.length,2);same(lock.platforms.map(row=>row.platform),['linux/amd64','linux/arm64'],'complete ordered native SDK platforms');
    for(const [index,row] of lock.platforms.entries()) {
     keys(row,['platform','manifest_digest','inventory_digest','inventory_document','inventory']);
     assert.equal(row.manifest_digest,children[index].descriptor.digest);
     assert.equal(row.inventory_digest,'sha256:'+hash(Buffer.from(row.inventory_document)));
     same(validateInventory(Buffer.from(row.inventory_document)).artifacts,row.inventory,'exact locked artifact rows');
    }
    const platform=lock.platforms.find(value=>value.platform===acquisition.platform);assert(platform);
    assert.equal(platform.inventory_digest,'sha256:'+acquisition.inventory_sha256);
    const inventoryBytes=Buffer.from(platform.inventory_document);assert.equal(hash(inventoryBytes),acquisition.inventory_sha256);
    const artifacts=validateInventory(inventoryBytes).artifacts;
    const seed=artifacts.filter(value=>value.id==='lean4-prod-exporter-seed'),child=artifacts.filter(value=>value.id==='lean4-prod-exporter');
    assert.equal(seed.length,1);assert.equal(child.length,1);
    same(seed[0],{id:'lean4-prod-exporter-seed',kind:'dependency-lock',version:'1',digest:'sha256:'+acquisition.manifest_sha256},'closed seed authority required');
    same(child[0],{id:'lean4-prod-exporter',kind:'binary',version:acquisition.compiler_revision,digest:'sha256:'+acquisition.executable_sha256},'closed child authority required');
    assert.equal(seed[0].digest,'sha256:'+acquisition.manifest_sha256);assert.equal(child[0].digest,'sha256:'+acquisition.executable_sha256);
    assert(compilerIdentity,'independently captured compiler identity required');
    assert.equal(acquisition.compiler_revision,compilerIdentity.revision);assert.equal(acquisition.toolchain,compilerIdentity.toolchain);
    assert.equal(acquisition.platform,compilerIdentity.platform);
   }
   const executable=row.exporter.executable;keys(executable,['byte_length','mode','sha256']);hex(executable.sha256);
   assert(Number.isSafeInteger(executable.byte_length)&&executable.byte_length>0&&executable.byte_length<=256*1024*1024);
   assert(Number.isSafeInteger(executable.mode)&&executable.mode>=0&&executable.mode<=0o777&&(executable.mode&0o111));
  }
 }
 for(const mode of ['std','no_std']){const rows=manifest.processes.filter(row=>row.tool==='native-library-'+mode+'-acceptance');assert.equal(rows.length,1);same(JSON.parse(rows[0].stdout),{roots:[acceptanceRoot],status:'passed'},'actual native execution transcript');}
 const artifacts=tree(build).filter(row=>row.kind==='file');assert.ok(artifacts.every(row=>!row.path.endsWith('.holo')&&!row.path.startsWith('application/')),'native library claims application artifacts');
 const buildManifest=document(join(build,'manifest.json'));keys(buildManifest,['files','inputs','schema']);assert.equal(buildManifest.schema,'prismpm/build-manifest/1');
 const inputs=buildManifest.inputs;keys(inputs,['application_generator_sha256','dependency_register_sha256','emitter_semantics_id','lexlean_build_id','lexlean_semantic_id','lexlean_source_id','library_artifacts_sha256','library_generator_sha256','model_id','schema','system_id']);assert.equal(inputs.schema,'prismpm/build-inputs/3');assert.equal(inputs.system_id,null);
 for(const [name,value] of Object.entries(inputs))if(!['schema','system_id'].includes(name))hex(value);
 assert.equal(hash(canonical(inputs)),receipt.build_id,'artifact-bound build identity');assert.equal(inputs.model_id,hash(modelBytes));assert.equal(inputs.emitter_semantics_id,model.provenance.emitter_semantics_id);assert.equal(inputs.lexlean_semantic_id,model.provenance.semantic_id);assert.equal(inputs.lexlean_source_id,model.provenance.source_id);
 assert.ok(Array.isArray(buildManifest.files));for(const row of buildManifest.files){keys(row,['byte_length','kind','path','sha256']);assert.ok(['lean','latex','source-map','coverage','lexicon-closure','lexlean-manifest','semantic-snapshot','artifact'].includes(row.kind));}
 same(buildManifest.files.map(({kind,...row})=>row),artifacts.filter(row=>row.path!=='manifest.json').map(row=>({path:row.path,byte_length:row.size,sha256:row.sha256})),'complete build manifest file closure');
 assert.equal(inputs.library_artifacts_sha256,hash(canonical(buildManifest.files)),'complete artifact row digest');
 const lexPaths=['lexlean/build/manifest.json','lexlean/snapshot.json'];
 for(const name of ['Foundation/Library/V1/Model','Probe']){lexPaths.push('lexlean/build/coverage/LibraryProbe/'+name+'.coverage.json','lexlean/build/lexicons/'+name.replaceAll('/','.')+'.closure.json','lexlean/build/maps/LibraryProbe/'+name+'.map.json','lexlean/build/modules/LibraryProbe/'+name+'.lean','lexlean/build/modules/LibraryProbe/'+name+'.tex');}
 same(artifacts.filter(row=>!row.path.startsWith('library/')).map(row=>row.path),[...lexPaths,'manifest.json','model.prism.json'].sort(),'complete fixture non-library artifacts');
 // LexLean owns its snapshot serialization; the exact bytes are bound above.
 const snapshot=JSON.parse(regularBytes(join(build,'lexlean/snapshot.json')));assert.ok(Array.isArray(snapshot.modules));const declarations=snapshot.modules.flatMap(module=>module.declarations.map(declaration=>({name:module.lean_module+'.'+declaration.lean_name,policy:declaration.axiom_policy})));
 const names=['LibraryProbe.Foundation.Library.V1.Model.NativeLibrary','LibraryProbe.Probe.acceptance','LibraryProbe.Probe.identity','LibraryProbe.Probe.probeLibrary'];same(declarations.map(row=>row.name).sort(),names,'complete selected declaration closure');
 assert.equal(lexAttestation.spec,'lexlean/attestation/2');assert.equal(lexAttestation.status,'verified');assert.equal(lexAttestation.build_id,inputs.lexlean_build_id);assert.equal(lexAttestation.source_id,inputs.lexlean_source_id);assert.equal(lexAttestation.semantic_id,inputs.lexlean_semantic_id);
 assert.ok(Array.isArray(lexAttestation.declarations));
 // LexLean 1.2 also attests the runtime declarations the verified modules import.
 const runtimeAudit=row=>row.name.startsWith('LexLeanRuntime.');
 for(const row of lexAttestation.declarations.filter(runtimeAudit)){keys(row,['name','observed','policy','result']);assert.equal(row.result,'ok');assert.equal(row.policy.kind,'exact');same(row.observed,row.policy.axioms,'exact runtime declaration audit');}
 const ownedAudits=lexAttestation.declarations.filter(row=>!runtimeAudit(row));
 same(ownedAudits.map(row=>row.name).sort(),names,'complete published declaration audit');
 for(const row of ownedAudits){keys(row,['name','observed','policy','result']);assert.equal(row.result,'ok');same(row.policy,declarations.find(declaration=>declaration.name===row.name).policy,'exact declaration axiom policy');same(row.policy,{axioms:[],kind:'none'},'fixture has no admitted axioms');same(row.observed,[],'fixture has no observed axioms');}
 const library=artifacts.filter(row=>row.path.startsWith('library/'));
 same(library.map(row=>row.path),['library/coverage.json','library/kernel.ir','library/model-binding.json','library/package/Cargo.lock','library/package/Cargo.toml','library/package/LICENSE-APACHE','library/package/LICENSE-MIT','library/package/README.md','library/package/generation-manifest.json','library/package/src/lib.rs','library/prism-library-probe-0.1.0.crate','library/roots.json'],'complete fixture native artifact set');
 same(manifest.artifacts,library.map(row=>({path:row.path,byte_length:row.size,sha256:row.sha256})),'complete exact native package replay artifacts');
 same(document(join(build,'library/model-binding.json')),{acceptance_roots:[acceptanceRoot],export_roots:roots,model_id:hash(modelBytes),profile:'prismpm/native-library/1',schema:'prismpm/library-build-binding/1',scope:'native-library-only'},'closed native model binding');
 if(owned){
  assert(compilerIdentity,'independent compiler identity required');
  const owner=validateVerificationOwner(manifest,'library',requiredAcquisition,binding,
   {archive_sha256:exporterArchiveSha256,toolchain:compilerIdentity.toolchain});
  const leanManifest=regularBytes(join(build,'lexlean/build/manifest.json')),outputs=JSON.parse(leanManifest).outputs;
  assert(Array.isArray(outputs));const modules=outputs.filter(row=>row.kind==='lean').map(row=>{
   assert.match(row.path,/^modules\/[A-Za-z0-9_/]+\.lean$/);return row.path.slice(8,-5).replaceAll('/','.');
  }).sort();assert(modules.length>0&&new Set(modules).size===modules.length);
  const argv=['exe','prod-export',...modules.flatMap(module=>['--module',module]),...roots.flatMap(root=>['--root',root]),
   '--ir-module',model.library.cargo_name.replaceAll('-','_'),'--out','$LIBRARY_WORK/export'];
  for(const phase of owner.phases){assert.equal(phase.lexlean_manifest_sha256,hash(leanManifest));same(phase.processes[2].argv,argv);}
 }
 return {build,model_id:hash(modelBytes)};
}
export function mutateModule(project,change){
 const path=join(project,'src/Probe.lex.tex'),before=regularBytes(path).toString('utf8');
 const module=readSemantic(before);change(module);
 writeFileSync(path,writeSemantic(before,module));return before;
}
const declaration=(module,name)=>{const rows=module.declarations.filter(row=>row.name===name);assert.equal(rows.length,1);return rows[0];};
const rootField=(module,name)=>{const rows=declaration(module,'probeLibrary').body.fields.filter(row=>row.field===name);assert.equal(rows.length,1);return rows[0].value;};

export async function run(root,image,lockBytes){
 assert.equal(process.getuid(),1000,'native SDK gate must run non-root');
 const binding=validateCapturedLock(lockBytes,image,{x64:'amd64',arm64:'arm64'}[process.arch],
  regularBytes(join(root,'standards.lock')),regularBytes('/opt/prismpm/share/inventory.json'));
 const exporterArchiveSha256=hash(regularBytes(join(root,'vendor/lean4-prod/lean.tar')));
 const compilerIdentity={revision:compilerRevision(regularBytes(join(root,'model/dependencies.toml')).toString()),toolchain:regularBytes(join(root,'lean-toolchain')).toString().trim(),platform:'linux/'+{x64:'amd64',arm64:'arm64'}[process.arch]};
 const work=mkdtempSync('/tmp/prismpm-library-sdk-'),source=join(root,'tests/fixtures/library/native-library/project');let sequence=0;
 const runs=[];
 const retain=(project,receipt,acquisition,destination=runs)=>{
  const bytes=regularBytes(join(project,receipt.verified_root,'manifest.json'));
  destination.push({root:project,acquisition,manifest:bytes.toString('utf8'),manifest_sha256:hash(bytes)});
 };
 function fixture(){
  const destination=join(work,'fixture-'+sequence++);cpSync(source,destination,{recursive:true,errorOnExist:true,force:false});
  for(const row of tree(destination))chmodSync(join(destination,row.path),row.kind==='directory'?0o700:0o600);
  assert.ok(!existsSync(join(destination,'.prism')),'fixture must be fresh');return destination;
 }
 const positive=(project,args)=>cli(project,args,{schema:'prismpm/'+args[0]+'-result/1'});
 try{
  const first=fixture(),before=tree(first),checked=positive(first,['check']);same(tree(first),before,'check modified source');
  const accepted=positive(first,['verify']),evidence=checkAccepted(first,accepted,exporterArchiveSha256,compilerIdentity,'cold',binding);assert.equal(checked.model_id,evidence.model_id);
  retain(first,accepted,'cold');
  const firstBuild=tree(evidence.build),second=fixture(),secondBuild=positive(second,['build']);assert.equal(secondBuild.build_id,accepted.build_id);
  same(tree(join(second,'.prism/build',secondBuild.build_id)),firstBuild,'complete build differs across fresh absolute roots');noVerification(second);
  const secondVerify=positive(second,['verify']);assert.equal(secondVerify.build_id,accepted.build_id);checkAccepted(second,secondVerify,exporterArchiveSha256,compilerIdentity,'cold',binding);
  retain(second,secondVerify,'cold');
  const beforeProduct=tree(first);cli(first,['build','--locked','-t','ghcr.io/uor-foundation/prismpm-library-probe:0.1.0'],{code:'PP6101',message:'native-library acceptance is not product-release or deployment acceptance'});same(tree(first),beforeProduct,'product refusal wrote outputs');
  const descriptor=regularBytes(join(source,'src/Foundation/Library/V1/Model.lex.tex')).toString('utf8');const nominal=readSemantic(descriptor);
  const mutations=[
   [module=>{rootField(module,'exportRoots').tail.head.value='LibraryProbe.Probe.missing';},'native-library export LibraryProbe.Probe.missing is not defined'],
   [module=>{rootField(module,'acceptanceRoots').head.value=identityRoot;},'native-library acceptance root LibraryProbe.Probe.identity must have type Bool with no parameters'],
   [module=>{declaration(module,'acceptance').parameters=[{name:'unused',type:{kind:'nat'}}];},'native-library acceptance root LibraryProbe.Probe.acceptance must have type Bool with no parameters'],
   [module=>{module.declarations.unshift(nominal.declarations[0]);delete declaration(module,'probeLibrary').result.member.module;delete declaration(module,'probeLibrary').body.type.module;},'facet closure is not exact'],
  ];
  for(const [change,message] of mutations){const invalid=fixture();mutateModule(invalid,change);const before=tree(invalid);cli(invalid,['check'],{code:'PP2001',message});same(tree(invalid),before,'invalid check wrote outputs');noVerification(invalid);}
  const mutant=fixture(),original=mutateModule(mutant,module=>{declaration(module,'identity').body={kind:'add',left:{kind:'var',name:'value'},right:{kind:'nat',value:'1'}};});
  const changed=positive(mutant,['check']);assert.notEqual(changed.semantic_id,checked.semantic_id);
  const rejection=cli(mutant,['verify'],{code:'PP5006',assertion:acceptanceRoot});noVerification(mutant);
  const acceptance_rejection={schema:'prismpm/generated-acceptance-rejection/1',root:acceptanceRoot,result:rejection};
  writeFileSync(join(mutant,'src/Probe.lex.tex'),original);const restored=positive(mutant,['verify']);assert.equal(restored.build_id,accepted.build_id);checkAccepted(mutant,restored,exporterArchiveSha256,compilerIdentity,'cold',binding);
  for(let index=0;index<2;index++){
   const warm=fixture();assert(!existsSync(join(warm,'prismpm.lock')),'warm fixture must not replace a source lock');
   writeFileSync(join(warm,'prismpm.lock'),lockBytes,{flag:'wx',mode:0o600});
   const before=tree(warm),checked=positive(warm,['check']);same(tree(warm),before,'warm check modified source');
   assert.equal(checked.model_id,evidence.model_id);
   const verified=positive(warm,['verify']);assert.equal(verified.build_id,accepted.build_id);
   const warmEvidence=checkAccepted(warm,verified,exporterArchiveSha256,compilerIdentity,'sdk-seed',binding);
   retain(warm,verified,'sdk-seed');
   same(tree(warmEvidence.build),firstBuild,'complete cold/warm artifact closure differs');
   assert(regularBytes(join(warm,'prismpm.lock')).equals(lockBytes),'warm execution changed its independent lock');
  }
  // Keep all four original sequential cold/warm invocations. These additional
  // two commands are genuine installed SDK processes with separate temporary
  // namespaces, not replayed manifests or a transport-fixture acceptance.
  const projects=[fixture(),fixture()],temporaries=[0,1].map(index=>join(work,'invocation-'+index));
  for(const path of temporaries)mkdirSync(path,{mode:0o700});
  for(const project of projects)writeFileSync(join(project,'prismpm.lock'),lockBytes,{flag:'wx',mode:0o600});
  const identity={compiler_revision:compilerIdentity.revision,archive_sha256:exporterArchiveSha256,
   toolchain:compilerIdentity.toolchain,platform:compilerIdentity.platform};
  const beforeCustody=captureInstalledCustody(binding,identity);
  const concurrent=await runConcurrentInstalled(projects,temporaries),concurrentRuns=[];
  for(const [index,{output}] of concurrent.outcomes.entries()){
   const verified=cliOutput(output,{schema:'prismpm/verify-result/1'});assert.equal(verified.build_id,accepted.build_id);
   const evidence=checkAccepted(projects[index],verified,exporterArchiveSha256,compilerIdentity,'sdk-seed',binding);
   same(tree(evidence.build),firstBuild,'concurrent generated artifact closure differs');
   assert(regularBytes(join(projects[index],'prismpm.lock')).equals(lockBytes));
   retain(projects[index],verified,'sdk-seed',concurrentRuns);
  }
  const afterCustody=captureInstalledCustody(binding,identity);same(afterCustody,beforeCustody,'original immutable SDK custody changed during concurrent execution');
  const concurrency={scope:'installed-exporter-concurrency-only',runs:concurrentRuns,overlap:concurrent.overlap,
   retirements:concurrent.outcomes.map(row=>row.retirement),environments:concurrent.outcomes.map(row=>row.environment),custody:{before:beforeCustody,after:afterCustody}};
  return {scope:'installed-native-library-only',build_id:accepted.build_id,binding,runs,concurrency,acceptance_rejection,checks:completedChecks,unclaimed};
 }finally{rmSync(work,{recursive:true,force:true});}
}

export function verifyExporterProcess(process,role,mode,binding,sourceAuthority){
 assert(['prod-export','application-export'].includes(role));assert(['cold','sdk-seed'].includes(mode));
 keys(sourceAuthority,['archive_sha256','toolchain']);hex(sourceAuthority.archive_sha256);
 assert.match(sourceAuthority.toolchain,/^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/);
 keys(process,['tool','argv','executable_sha256','exit_code','stdout','stderr','exporter']);
 assert.equal(process.tool,role);assert.equal(process.exit_code,0);hex(process.executable_sha256);
 assert(Array.isArray(process.argv)&&process.argv.every(argument=>typeof argument==='string'));
 same(process.argv.slice(0,2),['exe','prod-export'],'retained Lake exporter invocation required');
 assert.equal(typeof process.stdout,'string');assert.equal(typeof process.stderr,'string');
 const exporter=process.exporter;assert.equal(exporter.acquisition.mode,mode);
 keys(exporter,['schema','source_archive_sha256','executable','acquisition']);assert.equal(exporter.schema,'prismpm/exporter-execution/1');
 assert.equal(exporter.source_archive_sha256,sourceAuthority.archive_sha256);
 keys(exporter.executable,['byte_length','mode','sha256']);hex(exporter.executable.sha256);
 assert(Number.isSafeInteger(exporter.executable.byte_length)&&exporter.executable.byte_length>0&&exporter.executable.byte_length<=256*1024*1024);
 assert(Number.isSafeInteger(exporter.executable.mode)&&exporter.executable.mode>=0&&exporter.executable.mode<=0o777&&(exporter.executable.mode&0o111));
 if(mode==='cold')same(exporter.acquisition,{schema:'prismpm/exporter-acquisition/1',mode:'cold'},'closed retained cold receipt');
 else{
  keys(exporter.acquisition,['schema','mode','inventory_sha256','manifest_sha256','executable_sha256','archive_sha256','compiler_revision','platform','toolchain']);
  assert.equal(exporter.acquisition.schema,'prismpm/exporter-acquisition/1');
  assert.equal(exporter.acquisition.archive_sha256,exporter.source_archive_sha256);
  assert.equal(exporter.acquisition.toolchain,sourceAuthority.toolchain);
  for(const [field,expected] of Object.entries({platform:binding.platform,inventory_sha256:binding.inventory_sha256,
   manifest_sha256:binding.seed_manifest_sha256,executable_sha256:binding.exporter_sha256,compiler_revision:binding.compiler_revision}))assert.equal(exporter.acquisition[field],expected);
  assert.equal(exporter.executable.sha256,binding.exporter_sha256);
 }
}

// Current qualification requires the two original executions. Historical /1
// parsing remains separate and never qualifies a newly installed SDK.
export function validateVerificationOwner(manifest,role,mode,binding,sourceAuthority){
 const owner=manifest.exporter_owner;
 keys(owner,['schema','phases']);assert.equal(owner.schema,'prismpm/verification-exporter-owner/1');
 assert(Array.isArray(owner.phases)&&owner.phases.length===2);
 const tools=role==='library'?['lake-build-generated','lean4-prod-build','prod-export','native-library-package']:
  ['application-lean','application-exporter','application-export'];
 assert(['library','application'].includes(role));
 const lake=manifest.processes.find(row=>row.tool==='lake-version');assert(lake,'independent native Lake preflight required');
 hex(lake.executable_sha256);
 for(const [index,phase] of owner.phases.entries()){
  keys(phase,['phase','role','model_sha256','lexlean_manifest_sha256','artifacts','processes']);
  assert.equal(phase.phase,['controller-build','replay'][index]);assert.equal(phase.role,role);
  assert.equal(phase.model_sha256,manifest.model_sha256);hex(phase.model_sha256);hex(phase.lexlean_manifest_sha256);
  assert(Array.isArray(phase.artifacts)&&phase.artifacts.length>0);let prior='';
  for(const artifact of phase.artifacts){
   keys(artifact,['path','byte_length','sha256']);assert.equal(typeof artifact.path,'string');
   assert(artifact.path>prior&&!artifact.path.includes('\\')&&!artifact.path.startsWith('/')
    &&artifact.path.split('/').every(part=>part!==''&&part!=='.'&&part!=='..'));
   prior=artifact.path;hex(artifact.sha256);assert(Number.isSafeInteger(artifact.byte_length)&&artifact.byte_length>=0);
  }
  assert(Array.isArray(phase.processes)&&phase.processes.length===tools.length);
  same(phase.processes.map(row=>row.tool),tools);
  for(const [number,row] of phase.processes.entries()){
   if(number===2)verifyExporterProcess(row,tools[2],mode,binding,sourceAuthority);
   else{
    keys(row,['tool','argv','executable_sha256','exit_code','stdout','stderr']);assert.equal(row.exit_code,0);
    same(row.argv,number===3?['package','--locked','--offline','--allow-dirty']:['build',number===0?'PrismGenerated':'prod-export']);
   }
   if(number<3)assert.equal(row.executable_sha256,lake.executable_sha256);
   else {hex(row.executable_sha256);assert.equal(row.executable_sha256,owner.phases[0].processes[3].executable_sha256);}
   for(const name of ['stdout','stderr'])assert(typeof row[name]==='string'&&Buffer.byteLength(row[name])<=16*1024*1024&&!row[name].includes('\r'));
  }
 }
 const [first,replay]=owner.phases;
 for(const field of ['role','model_sha256','lexlean_manifest_sha256','artifacts'])same(first[field],replay[field]);
 same(first.processes[2].exporter,replay.processes[2].exporter);
 same(first.processes[2].argv,replay.processes[2].argv);
 assert.equal(manifest.processes.slice(0,manifest.processes.length-tools.length+1).filter((_,index)=>canonical(manifest.processes.slice(index,index+tools.length))===canonical(replay.processes)).length,1,
  'replay must be exactly one original retained transcript window');
 if(role==='library')same(replay.artifacts,manifest.artifacts);
 return owner;
}

export function verifyResult(value,binding,sourceAuthority){
 hex(value.build_id);assert(binding,'independent captured SDK binding required');
 keys(sourceAuthority,['archive_sha256','toolchain']);hex(sourceAuthority.archive_sha256);
 assert.match(sourceAuthority.toolchain,/^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/);
 same(value,{scope:'installed-native-library-only',build_id:value.build_id,binding,runs:value.runs,concurrency:value.concurrency,acceptance_rejection:value.acceptance_rejection,checks:completedChecks,unclaimed},'complete installed native-library result');
 keys(value.acceptance_rejection,['schema','root','result']);
 assert.equal(value.acceptance_rejection.schema,'prismpm/generated-acceptance-rejection/1');
 assert.equal(value.acceptance_rejection.root,acceptanceRoot);
 requireModeledAssertionFailure(value.acceptance_rejection.result,acceptanceRoot);
 assert(Array.isArray(value.runs)&&value.runs.length===4,'complete cold/warm records required');
 assert.equal(new Set(value.runs.map(row=>row.root)).size,4,'four fresh absolute roots required');
 const concurrency=value.concurrency;keys(concurrency,['scope','runs','overlap','retirements','environments','custody']);
 assert.equal(concurrency.scope,'installed-exporter-concurrency-only');
 assert(Array.isArray(concurrency.runs)&&concurrency.runs.length===2);assert(Array.isArray(concurrency.overlap)&&concurrency.overlap.length===2);
 assert(Array.isArray(concurrency.retirements)&&concurrency.retirements.length===2);keys(concurrency.custody,['before','after']);
 assert(Array.isArray(concurrency.environments)&&concurrency.environments.length===2);
 const identity={compiler_revision:binding.compiler_revision,archive_sha256:sourceAuthority.archive_sha256,toolchain:sourceAuthority.toolchain,platform:binding.platform};
 for(const record of [concurrency.custody.before,concurrency.custody.after])verifyCustody(record,binding,identity);
 same(concurrency.custody.before,concurrency.custody.after,'original SDK native identities or bytes changed');
 for(const [index,row] of concurrency.overlap.entries()){
  keys(row,['path','dev','ino','uid','gid','mode']);
  const prefix=dirname(concurrency.runs[index].root)+'/invocation-'+index+'/';
  assert(row.path.startsWith(prefix));assert.match(row.path.slice(prefix.length),/^prismpm-verify-exporter-[A-Za-z0-9]+$/);
  same(concurrency.environments[index],installedEnvironment(prefix.slice(0,-1)),'closed installed environment differs');
  for(const name of ['dev','ino','uid','gid','mode']){assert(typeof row[name]==='string'&&/^(?:0|[1-9][0-9]{0,19})$/.test(row[name]));assert(BigInt(row[name])<=0xffffffffffffffffn);}
  assert.equal(row.uid,'1000');assert.equal(row.gid,'1000');assert.equal(BigInt(row.mode),0o40700n);
  same(concurrency.retirements[index],{schema:'prismpm/portable-process-owner/1',exit_code:0,timed_out:false,interrupted:false,cleanup_verified:true});
 }
 assert.notEqual(concurrency.overlap[0].dev+':'+concurrency.overlap[0].ino,concurrency.overlap[1].dev+':'+concurrency.overlap[1].ino);
 const allRuns=[...value.runs,...concurrency.runs];assert.equal(new Set(allRuns.map(row=>row.root)).size,6,'six independent source roots required');
 let nativeArtifacts;
 for(const [index,row] of allRuns.entries()){
  keys(row,['root','acquisition','manifest','manifest_sha256']);
  assert.match(row.root,/^\/tmp\/prismpm-library-sdk-[A-Za-z0-9]+\/fixture-[0-9]+$/);
  assert.equal(row.acquisition,index<2?'cold':'sdk-seed');assert.equal(typeof row.manifest,'string');
  assert(Buffer.byteLength(row.manifest)<=16*1024*1024);assert.equal(hash(Buffer.from(row.manifest)),row.manifest_sha256);
  const manifest=JSON.parse(row.manifest);assert.equal(canonical(manifest),row.manifest);
  keys(manifest,['acceptance_sha256','artifacts','build_id','exporter_owner','lexlean_attestation_sha256','model_sha256','processes','schema','scope']);
  assert.equal(manifest.schema,'prismpm/library-verification-manifest/2');assert.equal(manifest.scope,'native-library-only');assert.equal(manifest.build_id,value.build_id);
  for(const field of ['acceptance_sha256','lexlean_attestation_sha256','model_sha256'])hex(manifest[field]);
  same(manifest.artifacts.map(item=>item.path),['library/coverage.json','library/kernel.ir','library/model-binding.json','library/package/Cargo.lock','library/package/Cargo.toml','library/package/LICENSE-APACHE','library/package/LICENSE-MIT','library/package/README.md','library/package/generation-manifest.json','library/package/src/lib.rs','library/prism-library-probe-0.1.0.crate','library/roots.json'],'complete retained native artifact set');
  for(const artifact of manifest.artifacts){keys(artifact,['path','byte_length','sha256']);hex(artifact.sha256);assert(Number.isSafeInteger(artifact.byte_length)&&artifact.byte_length>=0&&artifact.byte_length<=64*1024*1024);}
  if(nativeArtifacts)same(manifest.artifacts,nativeArtifacts,'retained cold/warm artifact descriptors differ');
  nativeArtifacts=manifest.artifacts;
  same(manifest.processes.map(item=>item.tool),['lean-version','lake-version','rustfmt-version','rustc-version','timeout-version','lake-build-generated','lean4-prod-build','prod-export','native-library-package','native-library-std-lock','native-library-std-acceptance','native-library-no_std-lock','native-library-no_std-acceptance'],'complete retained library processes');
  for(const process of manifest.processes){
   keys(process,['tool','argv','executable_sha256','exit_code','stdout','stderr',...(process.tool==='prod-export'?['exporter']:[])]);
   assert.equal(process.exit_code,0,'retained process failed');hex(process.executable_sha256);
   assert(Array.isArray(process.argv)&&process.argv.every(argument=>typeof argument==='string'));
   assert.equal(typeof process.stdout,'string');assert.equal(typeof process.stderr,'string');
  }
  verifyExporterProcess(manifest.processes[7],'prod-export',row.acquisition,binding,sourceAuthority);
  validateVerificationOwner(manifest,'library',row.acquisition,binding,sourceAuthority);
 }
}
export function testOutput(output){assert.equal(output.error,undefined);assert.equal(output.signal,null);assert.equal(output.status,0);assert.equal(verifyTap(output.stdout,29),29,'complete owning gate test count');}

if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 const [mode,...args]=process.argv.slice(2);
 if(mode==='roots'&&args.length===0)console.log(sourceRoots.join('\n'));
 else if(mode==='capture'&&args.length===2)console.log(JSON.stringify(capture(...args)));
 else if(mode==='verify'&&args.length===2)verifySource(args[0],JSON.parse(readFileSync(args[1])));
 else if(mode==='image'&&args.length===3)verifyImage(JSON.parse(readFileSync(0)),...args);
 else if(mode==='result'&&args.length===6)verifyResult(JSON.parse(regularBytes(args[0])),
  validateCapturedLock(regularBytes(args[1]),args[2],args[3],regularBytes(args[4]),regularBytes(args[5])),
  {archive_sha256:hash(regularBytes(new URL('../vendor/lean4-prod/lean.tar',import.meta.url))),toolchain:regularBytes(new URL('../lean-toolchain',import.meta.url)).toString().trim()});
 else if(mode==='binding'&&args.length===5)console.log(JSON.stringify(validateCapturedLock(
  regularBytes(args[0]),args[1],args[2],regularBytes(args[3]),regularBytes(args[4]))));
 else if(mode==='tests'&&args.length===0){const root=resolve(dirname(fileURLToPath(import.meta.url)),'..'),env={...process.env};delete env.NODE_TEST_CONTEXT;const output=spawnSync(process.execPath,['--test','--test-concurrency=1','--test-reporter=tap','--test-timeout=120000','scripts/library-sdk-check.test.mjs','scripts/library-sdk-check-shell.test.mjs','scripts/installed-exporter-concurrency.test.mjs','sdk/exporter-qualification.test.mjs','sdk/migration-qualification.test.mjs','sdk/metadata-evidence.test.mjs'],{cwd:root,env,encoding:'utf8',timeout:150000,maxBuffer:16*1024*1024});process.stdout.write(output.stdout??'');process.stderr.write(output.stderr??'');testOutput(output);}
 else if(mode==='acquire-lock'&&args.length===1)process.stdout.write(canonical(await acquireLock(resolve(dirname(fileURLToPath(import.meta.url)),'..'),args[0])));
 else if(mode==='acquired-lock'&&args.length===1){const value=validateAcquisitionBytes(regularBytes(args[0],288*1024*1024));const lock=Buffer.from(canonical(value.lock));assert(lock.length<=64*1024*1024);assert.equal(value.migration.schema,'prismpm/installed-lock-migration/2');verifyMigration(value.migration,lock);await verifyMetadataEvidence(value.metadata,lock);assert.equal(value.migration.platform,'linux/'+{x64:'amd64',arm64:'arm64'}[process.arch]);process.stdout.write(lock);}
 else if(mode==='run'&&args.length===1)console.log(JSON.stringify(await run(resolve(dirname(fileURLToPath(import.meta.url)),'..'),args[0],stdinLock())));
 else throw Error('closed installed native-library gate command');
}
