// Real tiny GNU-tar OCI archives and synthetic smoke facts test custody only.
// Unit transports below do not execute an SDK and never qualify construction.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,rmSync,symlinkSync,linkSync,renameSync,chmodSync} from 'node:fs';
import {syncBuiltinESMExports} from 'node:module';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';
import test from 'node:test';
import {constructionRecord} from './sdk-construction-record.mjs';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');

function fixture(t){
 const work=mkdtempSync(join(tmpdir(),'prism-construction-unit-'));t.after(()=>rmSync(work,{recursive:true,force:true}));
 const root=join(work,'construction'),evidence=join(root,'evidence'),layout=join(work,'layout');
 mkdirSync(root);mkdirSync(join(layout,'blobs','sha256'),{recursive:true});
 const source='a'.repeat(40),arch=process.arch==='arm64'?'arm64':'amd64';
 const env={SOURCE_REVISION:source,GITHUB_WORKFLOW_SHA:source,ARCHITECTURE:arch,GITHUB_REPOSITORY:'UOR-Foundation/PrismPM',GITHUB_EVENT_NAME:'workflow_dispatch',GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'1'};
 const put=bytes=>{writeFileSync(join(layout,'blobs','sha256',sha(bytes).slice(7)),bytes);return {digest:sha(bytes),size:bytes.length};};
 const layerRoot=join(work,'layer');mkdirSync(layerRoot);writeFileSync(join(layerRoot,'unit-only'),'metadata test, not an executable SDK');
 const layer=execFileSync('/usr/bin/tar',['--format=ustar','-cf','-','-C',layerRoot,'unit-only'],{timeout:5000,maxBuffer:1048576});
 const config=Buffer.from(JSON.stringify({os:'linux',architecture:arch,rootfs:{type:'layers',diff_ids:[sha(layer)]},config:{Labels:{
  'org.opencontainers.image.revision':source,'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM',
  'org.opencontainers.image.version':'0.3.0','org.opencontainers.image.created':'1970-01-01T00:00:00Z'}}}));
 const manifest=Buffer.from(JSON.stringify({schemaVersion:2,mediaType:'application/vnd.oci.image.manifest.v1+json',
  config:{...put(config),mediaType:'application/vnd.oci.image.config.v1+json'},
  layers:[{...put(layer),mediaType:'application/vnd.oci.image.layer.v1.tar'}]}));
 const index=Buffer.from(JSON.stringify({schemaVersion:2,manifests:[{...put(manifest),mediaType:'application/vnd.oci.image.manifest.v1+json'}]}));
 writeFileSync(join(layout,'index.json'),index);writeFileSync(join(layout,'oci-layout'),JSON.stringify({imageLayoutVersion:'1.0.0'}));
 execFileSync('/usr/bin/tar',['--format=ustar','-cf',join(root,'sdk.oci.tar'),'-C',layout,'index.json','oci-layout','blobs'],{timeout:5000});
 const standards=Buffer.from(JSON.stringify({schema:'prismpm/standards-lock/1',authorities:[],oracles:[]}));
 const inventory=Buffer.from(JSON.stringify({schema:'prismpm/sdk-inventory/1',commands:[{command:'unit-only'}],artifacts:[{id:'standards-and-oracles',digest:sha(standards)}]}));
 const authority=Buffer.from(JSON.stringify({schema:'prismpm/authority-result/1',lock_digest:sha(standards),path:'standards.lock',authorities:0,oracles:0,unchanged:true}));
 const candidate={source_revision:source,platform:'linux/'+arch,manifest_digest:sha(manifest),inventory_digest:sha(inventory),
  standards_lock_digest:sha(standards),authority_result_digest:sha(authority),development_only:true,production_accepted:false,
  checks:['non-root','inventory','standards-lock','model-check','shadowed-tool-rejected']};
 const rows={'authority-result.json':authority,'candidate.json':JSON.stringify(candidate),'cli.json':'{"schema":"unit-only"}',
  'config.json':config,'digest.txt':sha(manifest)+'\n','inventory.json':inventory,'manifest.json':manifest,
  'model-check.json':'{"scope":"unit-only"}','standards.lock':standards,'tamper.json':'unit-only negative bytes'};
 const f={work,root,evidence,env,candidate,rows,calls:0,after:undefined};
 f.smoke=(program,args)=>{
  f.calls++;assert.equal(program,'/bin/bash');assert.equal(args[0],new URL('./sdk-candidate.sh',import.meta.url).pathname);
  assert.equal(args[1],'smoke');assert.match(args[2],new RegExp('^/proc/'+process.pid+'/fd/[0-9]+$'));
  assert.deepEqual(args.slice(3),[arch,source,evidence]);
  // GNU tar actually reads the held descriptor, rather than the mutable path.
  assert.deepEqual(execFileSync('/usr/bin/tar',['-xOf',args[2],'index.json'],{timeout:5000,maxBuffer:1048576}),index);
  mkdirSync(evidence,{mode:0o700});for(const [name,bytes] of Object.entries(rows))writeFileSync(join(evidence,name),bytes);
  f.after?.();return {status:0,signal:null};
 };
 return f;
}
test('construction-only envelope binds held archive, workflow, source, run and native host',t=>{
 const f=fixture(t),r=constructionRecord(f.root,f.env,f.smoke);
 assert.equal(f.calls,1);assert.equal(r.workflow_revision,f.env.SOURCE_REVISION);assert.equal(r.source_revision,r.workflow_revision);
 assert.equal(r.run_id,'123');assert.equal(r.run_attempt,'1');assert.equal(r.scope,'construction-only-not-acceptance');
 assert.equal(r.smoke_evidence.length,10);assert.equal(r.archive.digest,sha(readFileSync(join(f.root,'sdk.oci.tar'))));
 assert.deepEqual(r.smoke,{status:0,signal:null,archive_binding:'held-descriptor-before-and-after'});
 assert.deepEqual(r.unclaimed,['full-vv','installed-dual-native-sdk-qualification','signing','release','product-readiness']);assert.equal(r.status,undefined);
});
test('foreign revisions, hosts, runs and acceptance labels fail before handoff',t=>{
 for(const changed of [{GITHUB_WORKFLOW_SHA:'b'.repeat(40)},{SOURCE_REVISION:'main'},{GITHUB_RUN_ID:'0'},{GITHUB_RUN_ATTEMPT:'01'},
  {GITHUB_REPOSITORY:'other/repo'},{GITHUB_EVENT_NAME:'push'},{ARCHITECTURE:'riscv64'},{ARCHITECTURE:process.arch==='arm64'?'amd64':'arm64'}]){
  const f=fixture(t);assert.throws(()=>constructionRecord(f.root,{...f.env,...changed},f.smoke));assert.equal(f.calls,0);
 }
 for(const [key,value] of [['source_revision','b'.repeat(40)],['platform','linux/riscv64'],['manifest_digest','sha256:'+'0'.repeat(64)],
  ['inventory_digest','sha256:'+'0'.repeat(64)],['production_accepted',true],['checks',[]]]){
  const f=fixture(t);f.rows['candidate.json']=JSON.stringify({...f.candidate,[key]:value});
  assert.throws(()=>constructionRecord(f.root,f.env,f.smoke),undefined,key);
 }
});
test('missing, additional, substituted, symlinked and hard-linked receipts fail closed',t=>{
 for(const change of [f=>writeFileSync(join(f.root,'unexpected'),'extra'),f=>rmSync(join(f.evidence,'inventory.json')),
  f=>writeFileSync(join(f.evidence,'inventory.json'),'changed'),
  f=>{rmSync(join(f.evidence,'inventory.json'));symlinkSync(join(f.evidence,'cli.json'),join(f.evidence,'inventory.json'));},
  f=>{rmSync(join(f.evidence,'inventory.json'));linkSync(join(f.evidence,'cli.json'),join(f.evidence,'inventory.json'));}]){
  const f=fixture(t);f.after=()=>change(f);assert.throws(()=>constructionRecord(f.root,f.env,f.smoke));
 }
});
test('archive substitution, changed layer bytes and aliases cannot retain earlier smoke facts',t=>{
 for(const change of [f=>writeFileSync(join(f.root,'sdk.oci.tar'),'substituted archive'),
  f=>{const bytes=readFileSync(join(f.root,'sdk.oci.tar'));bytes[bytes.indexOf('metadata test, not an executable SDK')]=88;writeFileSync(join(f.root,'sdk.oci.tar'),bytes);},
  f=>{renameSync(join(f.root,'sdk.oci.tar'),join(f.work,'original.tar'));writeFileSync(join(f.root,'sdk.oci.tar'),readFileSync(join(f.work,'original.tar')));},
  f=>linkSync(join(f.root,'sdk.oci.tar'),join(f.work,'alias.tar'))]){
  const f=fixture(t);f.after=()=>change(f);assert.throws(()=>constructionRecord(f.root,f.env,f.smoke));
 }
});
function duringFinalArchiveRead(f,change,run=constructionRecord){
 const original=fs.readSync;let reads=0,changed=false;
 fs.readSync=function(fd,buffer,offset,length,position){
  if(position===0&&fs.readlinkSync('/proc/self/fd/'+fd)===join(f.root,'sdk.oci.tar')&&++reads===2){changed=true;change();}
  return original(fd,buffer,offset,length,position);
 };
 syncBuiltinESMExports();
 try{return run(f.root,f.env,f.smoke);}finally{fs.readSync=original;syncBuiltinESMExports();assert(changed,'real post-smoke archive read must exercise the mutation');}
}
test('the final sweep refuses changed earlier receipts and replaced evidence directories',t=>{
 for(const change of [f=>writeFileSync(join(f.evidence,'cli.json'),'changed after capture'),
  f=>{const p=join(f.evidence,'cli.json'),b=readFileSync(p);rmSync(p);writeFileSync(p,b);},
  f=>chmodSync(join(f.evidence,'cli.json'),0o400),f=>linkSync(join(f.evidence,'cli.json'),join(f.work,'receipt-alias')),
  f=>writeFileSync(join(f.evidence,'additional'),'foreign'),
  f=>{renameSync(f.evidence,join(f.work,'old-evidence'));mkdirSync(f.evidence);for(const [name,b] of Object.entries(f.rows))writeFileSync(join(f.evidence,name),b);}]){
  const f=fixture(t);assert.throws(()=>duringFinalArchiveRead(f,()=>change(f)));
 }
});
test('unexpected directory members are refused with bounded streamed enumeration',t=>{
 const f=fixture(t),original=fs.opendirSync;let reads=0;
 f.after=()=>{for(let i=0;i<100;i++)writeFileSync(join(f.evidence,'foreign-'+i),'extra');};
 fs.opendirSync=function(path,...args){const dir=original(path,...args);if(path===f.evidence){const read=dir.readSync.bind(dir);dir.readSync=()=>{reads++;return read();};}return dir;};
 syncBuiltinESMExports();
 try{assert.throws(()=>constructionRecord(f.root,f.env,f.smoke));assert(reads>0&&reads<=11);}finally{fs.opendirSync=original;syncBuiltinESMExports();}
});
test('archive changes during the final receipt sweep also fail closed',t=>{
 const f=fixture(t),original=fs.lstatSync;let visits=0,changed=false;
 fs.lstatSync=function(path,...args){
  if(path===join(f.evidence,'authority-result.json')&&++visits===2){changed=true;writeFileSync(join(f.root,'sdk.oci.tar'),'late changed archive');}
  return original(path,...args);
 };
 syncBuiltinESMExports();
 try{assert.throws(()=>constructionRecord(f.root,f.env,f.smoke));assert(changed);}finally{fs.lstatSync=original;syncBuiltinESMExports();}
});
test('the actual smoke invocation cannot turn failed or interrupted processes into records',t=>{
 const failed=fixture(t);failed.rows['cli.json']=JSON.stringify({schema:'prismpm/error-result/1',diagnostic:{code:'PP1001',message:'actual fixture failure'}});
 assert.throws(()=>constructionRecord(failed.root,failed.env,(...args)=>{failed.smoke(...args);return{status:2,signal:null};}),
  error=>error.message.includes('PP1001')&&error.message.includes('actual fixture failure')&&error.message.includes('failure-diagnostics-only'));
 for(const mutate of [f=>{rmSync(join(f.evidence,'cli.json'));symlinkSync(join(f.evidence,'model-check.json'),join(f.evidence,'cli.json'));},
  f=>{linkSync(join(f.evidence,'cli.json'),join(f.work,'alias.json'));},
  f=>writeFileSync(join(f.evidence,'cli.json'),'x'.repeat(65537)),
  f=>writeFileSync(join(f.evidence,'cli.json'),JSON.stringify({schema:'prismpm/error-result/1',diagnostic:{code:'PP1001',message:'x'.repeat(2049)}})),
  f=>writeFileSync(join(f.evidence,'cli.json'),Buffer.from([255]))]){
  const f=fixture(t);f.rows['cli.json']=JSON.stringify({schema:'prismpm/error-result/1',diagnostic:{code:'PP1001',message:'must not be read'}});
  assert.throws(()=>constructionRecord(f.root,f.env,(...args)=>{f.smoke(...args);mutate(f);return{status:2,signal:null};}),
   error=>error.message.includes('failure-diagnostics-only')&&!error.message.includes('must not be read'));
 }
 for(const outcome of [{status:17,signal:null},{status:null,signal:'SIGTERM'},{status:null,signal:null,error:new Error('spawn failed')}]){
  const f=fixture(t);assert.throws(()=>constructionRecord(f.root,f.env,()=>outcome));
 }
});
test('real archive and receipt mutations kill omission guards in the actual record owner',async t=>{
 const original=readFileSync(new URL('./sdk-construction-record.mjs',import.meta.url),'utf8');
 const mutations=[
  ["  assert.deepEqual(captureDescriptor(fd,archive,64*1024**3),original,'the smoked archive changed before handoff');",f=>{f.after=()=>{const p=join(f.root,'sdk.oci.tar'),b=readFileSync(p);b[b.indexOf('metadata test, not an executable SDK')]=88;writeFileSync(p,b);};},false],
  ["   assert.deepEqual(identity(stat),row.identity,'earlier smoke evidence changed before handoff');",()=>{},true],
 ];
 for(const [removed,prepare,late] of mutations){
  assert(original.includes(removed));const f=fixture(t);prepare(f);
  let changed=original.replace(removed,'');
  if(!late){
   const final="assert.deepEqual(identity(stat),original.identity,'archive changed during the final evidence sweep');";
   assert(changed.includes(final));changed=changed.replace(final,'');
  }
  const mutated=changed.replace("'./sdk-candidate.mjs'",JSON.stringify(new URL('./sdk-candidate.mjs',import.meta.url).href))
   .replace("new URL('./sdk-candidate.sh',import.meta.url)",JSON.stringify(new URL('./sdk-candidate.sh',import.meta.url).href));
  const path=join(f.work,'mutated.mjs');writeFileSync(path,mutated);
  const owner=(await import(pathToFileURL(path).href)).constructionRecord;
  // Removing the guard must let the planted defect through: the positive
  // behavior of this mutant is what the original negative controls reject.
  if(late)duringFinalArchiveRead(f,()=>writeFileSync(join(f.evidence,'cli.json'),'mutant late receipt'),owner);
  else owner(f.root,f.env,f.smoke);
 }
});
