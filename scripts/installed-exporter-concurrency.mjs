// Installed-image qualification only. Observations never grant host authority
// and never enter a stable product build or verification attestation.
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {constants,closeSync,fstatSync,lstatSync,openSync,opendirSync,readlinkSync,realpathSync} from 'node:fs';
import {dirname,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {bindSeedInventory,bindSeedManifest} from '../sdk/exporter-seed-admission.mjs';
import {readSmall,snapshotFile,snapshotTree} from '../sdk/exporter-seed.mjs';
import {validateInventory} from '../sdk/platform-lock.mjs';

const inventoryPath='/opt/prismpm/share/inventory.json';
const seed='/opt/prismpm/share/exporter-seed';
const ownerPath='/opt/prismpm/share/conformance-root/scripts/portable-oracle-process-owner.py';
const maximum=8*1024*1024;
const sha=value=>createHash('sha256').update(value).digest('hex');
const canonical=value=>JSON.stringify(value,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)
 ?Object.fromEntries(Object.keys(item).sort().map(key=>[key,item[key]])):item);
const names=['dev','ino','uid','gid','mode','size','nlink','mtimeNs','ctimeNs'];
const key=name=>({mtimeNs:'mtime_ns',ctimeNs:'ctime_ns'}[name]??name);
const exact=(actual,expected)=>assert.equal(canonical(actual),canonical(expected));
const fields=(value,expected)=>{assert(value&&typeof value==='object'&&!Array.isArray(value));exact(Object.keys(value).sort(),expected.slice().sort());};
const hex=value=>{assert.equal(typeof value,'string');assert.match(value,/^[a-f0-9]{64}$/);};
const native=stat=>Object.fromEntries(names.map(name=>[key(name),String(stat[name])]));
const sameNative=(a,b)=>{for(const name of names)assert.equal(a[name],b[name],'original compiler identity changed: '+name);};
function kind(stat){assert(stat.isDirectory()||stat.isFile()||stat.isSymbolicLink(),'special compiler member');return stat.isDirectory()?'directory':stat.isFile()?'file':'symlink';}
const toolchainRoot=toolchain=>'/usr/local/elan/toolchains/'+toolchain.replace('/','--').replace(':','---');

export function installedEnvironment(temporary){
 const toolchain=readSmall(fileURLToPath(new URL('../lean-toolchain',import.meta.url)),65536).trim();
 assert.match(toolchain,/^leanprover\/lean4:v[0-9]+\.[0-9]+\.[0-9]+$/);
 const rust=[...readSmall(fileURLToPath(new URL('../rust-toolchain.toml',import.meta.url)),65536)
  .matchAll(/^channel = "([0-9]+\.[0-9]+\.[0-9]+)"$/gm)];assert.equal(rust.length,1);
 return {PATH:'/usr/local/elan/bin:/usr/local/cargo/bin:/usr/local/bin:/usr/bin:/bin',
  HOME:'/home/vscode',USER:'vscode',LOGNAME:'vscode',CARGO_HOME:'/opt/prismpm/cargo-home',
  RUSTUP_HOME:'/usr/local/rustup',RUSTUP_TOOLCHAIN:rust[0][1],ELAN_HOME:'/usr/local/elan',ELAN_TOOLCHAIN:toolchain,
  LANG:'C',LC_ALL:'C',TMPDIR:temporary,CARGO_NET_OFFLINE:'true',SOURCE_DATE_EPOCH:'0'};
}

// Independent inventory authority is supplied by the captured SDK lock. Full
// closure hashing supplements it; a fresh self-recomputed manifest cannot bind
// an SDK. Every namespace/alias identity is retained across both observations.
export function captureInstalledCustody(binding,identity){
 const entries=new Map();
 function remember(path,stat=lstatSync(path,{bigint:true}),digest){
  assert(entries.size<65536||entries.has(path),'compiler custody member bound');
  assert(stat.uid===0n&&(stat.isSymbolicLink()||(stat.mode&0o022n)===0n),'mutable installed compiler member');
  if(stat.isFile())assert.equal(stat.nlink,1n,'linked installed compiler member');
  const prior=entries.get(path);if(prior)sameNative(prior.stat,stat);
  const row={path,kind:kind(stat),...native(stat),...(stat.isSymbolicLink()?{target:readlinkSync(path)}:{}),
   ...(digest?{sha256:digest}:prior?.row.sha256?{sha256:prior.row.sha256}:{})};
  entries.set(path,{stat,row});return stat;
 }
 function pathCustody(path){
  assert(path.startsWith('/')&&path.length<=4096);remember('/');
  let current='/',links=0,steps=0;const parts=path.split('/').filter(Boolean);
  while(parts.length){
   assert(++steps<=16384);const part=parts.shift();
   if(part==='.')continue;if(part==='..'){current=dirname(current);continue;}
   const candidate=join(current,part),stat=remember(candidate);
   if(stat.isSymbolicLink()){
    assert(++links<=40);const target=entries.get(candidate).row.target;assert(target.length<=4096);
    if(target.startsWith('/'))current='/';parts.unshift(...target.split('/').filter(Boolean));
   }else current=candidate;
  }
  assert.equal(realpathSync(path),current,'installed namespace changed');return current;
 }
 pathCustody(inventoryPath);assert.equal(lstatSync(inventoryPath).mode&0o222,0);
  const inventory=Buffer.from(readSmall(inventoryPath,maximum));
 const inventory_document=inventory.toString(),catalog=validateInventory(inventory);
 const authority=bindSeedInventory(inventory,binding.inventory_sha256,identity.compiler_revision);assert(authority,'advertised compiler required');
 remember(inventoryPath,undefined,sha(inventory));
 pathCustody(seed);pathCustody(join(seed,'manifest.json'));
 const manifest_document=readSmall(join(seed,'manifest.json'),maximum);
 const manifest=bindSeedManifest(Buffer.from(manifest_document),authority,identity);
 remember(join(seed,'manifest.json'),undefined,sha(manifest_document));
 const toolchain=toolchainRoot(identity.toolchain);pathCustody(toolchain);
 function tree(root,expected,options){
  // snapshotTree binds regular members and directories at their first read;
  // explicitly retain declared toolchain links before its bounded traversal.
  for(const row of expected)if(row.kind==='symlink')remember(join(root,row.path));
  const custody=new Map(),rows=snapshotTree(root,{...options,custody});exact(rows,expected);
  for(const [relative,stat] of custody)remember(join(root,relative),stat);
  for(const row of rows){const path=join(root,row.path);pathCustody(path);remember(path,undefined,row.sha256);}
 }
 tree(seed,[...manifest.files,{path:'manifest.json',kind:'file',...snapshotFile(join(seed,'manifest.json'),maximum)}]
  .sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path))),
  {bounds:{files:4097,file:256*1024**2,total:520*1024**2}});
 tree(toolchain,manifest.toolchain_files,{toolchainAliases:true});
 for(const row of manifest.runtime_files){
  assert.equal(pathCustody(row.selected),row.path);assert.equal(pathCustody(row.path),row.path);
  const file=snapshotFile(row.path);exact(file,{byte_length:row.byte_length,mode:row.mode,sha256:row.sha256});remember(row.path,undefined,file.sha256);
 }
 const tools=[];
 for(const [command,selected] of [['prismpm','/usr/local/bin/prismpm'],['node',process.execPath],['python3','/usr/bin/python3'],['process-owner',ownerPath]]){
  const canonical_path=pathCustody(selected),file=snapshotFile(canonical_path,command==='process-owner'?65536:256*1024**2);
  if(command==='process-owner'){
   assert.equal(canonical_path,ownerPath);assert.equal(file.sha256,sha(readSmall(fileURLToPath(new URL('./portable-oracle-process-owner.py',import.meta.url)),65536)),'captured source helper differs');
  }else{
   const declared=catalog.commands.filter(row=>row.command===command);assert.equal(declared.length,1);
   assert.equal(canonical_path,declared[0].executable);assert.equal(file.sha256,declared[0].sha256,'installed command differs from independent inventory');
  }
  remember(canonical_path,undefined,file.sha256);tools.push({command,selected,canonical_path,...file});
 }
 for(const [path,{stat,row}] of entries){sameNative(stat,lstatSync(path,{bigint:true}));if(row.kind==='symlink')assert.equal(readlinkSync(path),row.target);}
 assert.equal(readSmall(inventoryPath,maximum),inventory.toString());
 assert.equal(readSmall(join(seed,'manifest.json'),maximum),manifest_document);
 const document=canonical([...entries.values()].map(item=>item.row).sort((a,b)=>Buffer.from(a.path).compare(Buffer.from(b.path))));
 assert(Buffer.byteLength(document)<=maximum,'bounded compiler custody document');
 return {manifest_document,inventory_document,inventory_sha256:binding.inventory_sha256,tools,document,sha256:sha(document)};
}

// Strict external readback. Synthetic metadata fixtures can test this parser,
// but only the source-bound installed gate can supply execution observations.
export function verifyCustody(record,binding,identity){
 fields(record,['manifest_document','inventory_document','inventory_sha256','tools','document','sha256']);assert.equal(record.inventory_sha256,binding.inventory_sha256);
 assert(typeof record.inventory_document==='string'&&Buffer.byteLength(record.inventory_document)<=maximum);
 assert.equal(sha(record.inventory_document),binding.inventory_sha256);const catalog=validateInventory(Buffer.from(record.inventory_document));
 assert(typeof record.manifest_document==='string'&&Buffer.byteLength(record.manifest_document)<=maximum);
 const manifest=bindSeedManifest(Buffer.from(record.manifest_document),
  {manifest_sha256:binding.seed_manifest_sha256,executable_sha256:binding.exporter_sha256},identity);
 assert(typeof record.document==='string'&&Buffer.byteLength(record.document)<=maximum);hex(record.sha256);assert.equal(sha(record.document),record.sha256);
 const rows=JSON.parse(record.document);assert(Array.isArray(rows)&&rows.length>0&&rows.length<=65536);assert.equal(canonical(rows),record.document);
 const entries=new Map();let previous='';
 for(const row of rows){
  assert(typeof row.path==='string'&&row.path.startsWith('/')&&row.path.length<=4096&&row.path>previous);previous=row.path;
  assert(['file','directory','symlink'].includes(row.kind));
  fields(row,['path','kind',...names.map(key),...(row.kind==='symlink'?['target']:[]),...(Object.hasOwn(row,'sha256')?['sha256']:[])]);
  for(const name of names.map(key)){assert(typeof row[name]==='string'&&/^(?:0|[1-9][0-9]{0,19})$/.test(row[name]));assert(BigInt(row[name])<=0xffffffffffffffffn);}
  const mode=BigInt(row.mode);assert.equal(row.uid,'0');assert(row.kind==='symlink'||(mode&0o022n)===0n);
  assert.equal(mode&0o170000n,{file:0o100000n,directory:0o040000n,symlink:0o120000n}[row.kind]);
  if(row.kind==='file')assert.equal(row.nlink,'1');if(row.sha256)hex(row.sha256);
  if(row.kind==='symlink')assert(typeof row.target==='string'&&row.target.length>0&&row.target.length<=4096);
  entries.set(row.path,row);
 }
 const used=new Set();
 function path(path){
  let current='/',links=0,steps=0;const parts=path.split('/').filter(Boolean);used.add('/');assert.equal(entries.get('/')?.kind,'directory');
  while(parts.length){assert(++steps<=16384);const part=parts.shift();if(part==='.')continue;if(part==='..'){current=dirname(current);continue;}
   const candidate=join(current,part),row=entries.get(candidate);assert(row,'missing compiler namespace member');used.add(candidate);
   if(row.kind==='symlink'){assert(++links<=40);if(row.target.startsWith('/'))current='/';parts.unshift(...row.target.split('/').filter(Boolean));}
   else {if(parts.length)assert.equal(row.kind,'directory');current=candidate;}
  }return current;
 }
 function member(root,row){
  const absolute=join(root,row.path);path(absolute);const actual=entries.get(absolute);assert(actual);used.add(absolute);
  assert.equal(actual.kind,row.kind);assert.equal(Number(BigInt(actual.mode)&0o777n),row.mode);
  if(row.kind==='file'){assert.equal(actual.size,String(row.byte_length));assert.equal(actual.sha256,row.sha256);}
  if(row.kind==='symlink')assert.equal(actual.target,row.target);
 }
 assert.equal(path(inventoryPath),inventoryPath);assert.equal(entries.get(inventoryPath).sha256,binding.inventory_sha256);
 assert.equal(Number(BigInt(entries.get(inventoryPath).mode)&0o222n),0);
 member(seed,{path:'manifest.json',kind:'file',mode:0o444,byte_length:Buffer.byteLength(record.manifest_document),sha256:binding.seed_manifest_sha256});
 assert.equal(path(seed),seed);for(const row of manifest.files)member(seed,row);
 const tools=toolchainRoot(identity.toolchain);assert.equal(path(tools),tools);for(const row of manifest.toolchain_files)member(tools,row);
 for(const row of manifest.runtime_files){assert.equal(path(row.selected),row.path);assert.equal(path(row.path),row.path);
  const actual=entries.get(row.path);assert.equal(actual.kind,'file');assert.equal(actual.size,String(row.byte_length));assert.equal(actual.sha256,row.sha256);assert.equal(Number(BigInt(actual.mode)&0o777n),row.mode);}
 assert(Array.isArray(record.tools)&&record.tools.length===4);
 exact(record.tools.map(row=>row.command),['prismpm','node','python3','process-owner']);
 for(const row of record.tools){
  fields(row,['command','selected','canonical_path','byte_length','mode','sha256']);hex(row.sha256);
  assert(typeof row.selected==='string'&&row.selected.startsWith('/')&&row.selected.length<=4096);
  assert(typeof row.canonical_path==='string'&&row.canonical_path.startsWith('/')&&row.canonical_path.length<=4096);
  assert.equal(path(row.selected),row.canonical_path);assert.equal(path(row.canonical_path),row.canonical_path);
  const actual=entries.get(row.canonical_path);assert.equal(actual.kind,'file');assert.equal(actual.size,String(row.byte_length));assert.equal(actual.sha256,row.sha256);
  assert(Number.isSafeInteger(row.byte_length)&&row.byte_length>0&&row.byte_length<=256*1024**2);
  assert(Number.isSafeInteger(row.mode)&&row.mode>=0&&row.mode<=0o777);assert.equal(Number(BigInt(actual.mode)&0o777n),row.mode);
  if(row.command==='process-owner'){
   assert.equal(row.selected,ownerPath);assert.equal(row.canonical_path,ownerPath);
   assert.equal(row.sha256,sha(readSmall(fileURLToPath(new URL('./portable-oracle-process-owner.py',import.meta.url)),65536)));
  }else{
   assert(row.mode&0o111);const declared=catalog.commands.filter(item=>item.command===row.command);assert.equal(declared.length,1);
   assert.equal(row.canonical_path,declared[0].executable);assert.equal(row.sha256,declared[0].sha256);
   if(row.command==='prismpm')assert.equal(row.selected,'/usr/local/bin/prismpm');
   if(row.command==='python3')assert.equal(row.selected,'/usr/bin/python3');
   if(row.command==='node')assert.equal(row.selected,row.canonical_path);
  }
 }
 exact([...used].sort(),[...entries.keys()].sort());return record;
}

// Observe real owner directories while retaining both no-follow descriptors.
// A CLI process interval alone is not a compiler-owner concurrency witness.
export function observeOwners(roots){
 assert(Array.isArray(roots)&&roots.length===2&&roots[0]!==roots[1]);const held=[];
 try{
  for(const root of roots){
   const candidates=[],stream=opendirSync(root,{bufferSize:1});let count=0;
   try{for(let entry;(entry=stream.readSync())!==null;){assert(++count<=4096,'temporary owner namespace bound');if(/^prismpm-verify-exporter-[A-Za-z0-9]+$/.test(entry.name))candidates.push(entry.name);}}finally{stream.closeSync();}
   if(candidates.length===0)return null;assert.equal(candidates.length,1,'exactly one invocation-local exporter owner');
   const path=join(root,candidates[0]),stat=lstatSync(path,{bigint:true});
   assert(stat.isDirectory()&&!stat.isSymbolicLink()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o777n)===0o700n);
   const fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);held.push({fd,path,stat});
   for(const name of ['dev','ino','uid','gid','mode'])assert.equal(fstatSync(fd,{bigint:true})[name],stat[name]);
   const packagePath=join(path,'lean4-prod');let pkg;
   try{pkg=lstatSync(packagePath,{bigint:true});}catch(error){if(error.code==='ENOENT')return null;throw error;}
   assert(pkg.isDirectory()&&!pkg.isSymbolicLink()&&pkg.uid===stat.uid&&(pkg.mode&0o777n)===0o700n);
  }
  // Both original descriptors are still open at this shared observation.
  for(const {fd,path,stat} of held){const current=fstatSync(fd,{bigint:true});for(const name of ['dev','ino','uid','gid','mode'])assert.equal(current[name],stat[name]);
   const named=lstatSync(path,{bigint:true});for(const name of ['dev','ino','uid','gid','mode'])assert.equal(named[name],stat[name]);}
  assert.notEqual(held[0].stat.dev+':'+held[0].stat.ino,held[1].stat.dev+':'+held[1].stat.ino,'distinct actual exporter owners required');
  return held.map(({path,stat})=>({path,...Object.fromEntries(['dev','ino','uid','gid','mode'].map(name=>[name,String(stat[name])]))}));
 }catch(error){if(error.code==='ENOENT')return null;throw error;}
 finally{for(const {fd} of held)closeSync(fd);}
}

// Test-visible process custody primitive; production below fixes the installed
// executable and its argv. Test commands are never installed-SDK acceptance.
export function startOwnedCommand(command,temporary,receipt,seconds=900){
 assert(Array.isArray(command)&&command.length>0&&command.every(arg=>typeof arg==='string'));
 assert(Number.isFinite(seconds)&&seconds>0&&seconds<=900);
 const env=installedEnvironment(temporary);
 const owner=fileURLToPath(new URL('./portable-oracle-process-owner.py',import.meta.url));
 const child=spawn('/usr/bin/python3',['-I','-B',owner,String(seconds),receipt,...command],{env,stdio:['ignore','pipe','pipe']});
 let size=0,failed,finished=false;const chunks={stdout:[],stderr:[]};
 const abort=error=>{if(!finished){failed??=error;child.kill('SIGTERM');}};
 for(const [stream,name] of [[child.stdout,'stdout'],[child.stderr,'stderr']])stream.on('data',bytes=>{
  size+=bytes.length;if(size>16*1024*1024)abort(new Error('bounded concurrent CLI output exceeded'));
  else if(!failed)chunks[name].push(bytes);
 });
 // The Python owner carries the original 900-second child deadline. Its
 // existing five-second retirement allowance does not extend command work.
 const timer=setTimeout(()=>abort(new Error('concurrent owner deadline')),seconds*1000);
 const force=setTimeout(()=>{failed??=new Error('process retirement deadline');child.kill('SIGKILL');},seconds*1000+6000);
 const done=new Promise((accept,reject)=>{
  child.once('error',abort);child.once('close',(status,signal)=>{
   finished=true;clearTimeout(timer);clearTimeout(force);
   try{const bytes=readSmall(receipt,65536),record=JSON.parse(bytes);
    fields(record,['schema','exit_code','timed_out','interrupted','cleanup_verified']);
    assert.equal(record.schema,'prismpm/portable-process-owner/1');assert.equal(record.cleanup_verified,true,'actual descendant retirement required');
    assert.equal(record.exit_code,status);assert.equal(record.timed_out,false);assert.equal(record.interrupted,false);
    if(failed)throw failed;assert.equal(signal,null);accept({output:{stdout:Buffer.concat(chunks.stdout).toString('utf8'),stderr:Buffer.concat(chunks.stderr).toString('utf8'),status,signal},retirement:record,environment:env});
   }catch(error){reject(error);}
  });
 });
 // Install a rejection observer immediately, before the second child starts.
 done.catch(()=>{});return {done,cancel:()=>abort(new Error('paired invocation refused'))};
}

// Qualification-only postcondition over an already held original namespace.
// A descendant-reaping receipt alone does not prove filesystem retirement.
export function verifyTemporaryRetirement({path,stat,fd}){
 for(const current of [lstatSync(path,{bigint:true}),fstatSync(fd,{bigint:true})])
  for(const name of ['dev','ino','uid','gid','mode'])assert.equal(current[name],stat[name],'original temporary namespace changed');
 assert(stat.isDirectory()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o777n)===0o700n);
 const stream=opendirSync('/proc/self/fd/'+fd,{bufferSize:1}),entries=[];
 try{for(let entry;(entry=stream.readSync())!==null;){assert(entries.length<4096);entries.push(entry.name);}}finally{stream.closeSync();}
 exact(entries,['process-owner.json']);const receipt=lstatSync(join(path,'process-owner.json'),{bigint:true});
 assert(receipt.isFile()&&receipt.uid===stat.uid&&receipt.nlink===1n&&receipt.size>0n&&receipt.size<=65536n
  &&(receipt.mode&0o133n)===0n,'bounded non-executable private process retirement receipt required');
}

export async function runConcurrentInstalled(projects,temporaries){
 assert(projects.length===2&&temporaries.length===2&&projects[0]!==projects[1]&&temporaries[0]!==temporaries[1]);
 for(const path of [...projects,...temporaries])assert.equal(realpathSync(path),path);
 const held=[];
 try{for(const path of temporaries){const stat=lstatSync(path,{bigint:true}),fd=openSync(path,constants.O_RDONLY|constants.O_DIRECTORY|constants.O_NOFOLLOW);held.push({path,stat,fd});
   sameNative(stat,fstatSync(fd,{bigint:true}));assert(stat.isDirectory()&&stat.uid===BigInt(process.getuid())&&(stat.mode&0o777n)===0o700n);}}
 catch(error){for(const {fd} of held)closeSync(fd);throw error;}
 const owners=[];let overlap=null,error,settled=0;
 const sample=()=>{if(!error&&!overlap)try{overlap=observeOwners(temporaries);}catch(cause){error=cause;for(const owner of owners)owner.cancel();}};
 const timer=setInterval(sample,25);
 try{
  for(let index=0;index<2;index++){
   const owner=startOwnedCommand(['/usr/local/bin/prismpm','--project',projects[index],'--json','verify'],temporaries[index],join(temporaries[index],'process-owner.json'));
   owners.push(owner);owner.done.then(()=>{settled++;},cause=>{error??=cause;for(const other of owners)other.cancel();});
  }
  const outcomes=await Promise.allSettled(owners.map(owner=>owner.done));
  if(error)throw error;assert.equal(settled,2);assert(outcomes.every(row=>row.status==='fulfilled'));
  assert(overlap,'both actual exporter owners must coexist, not merely CLI processes');
  for(const original of held)verifyTemporaryRetirement(original);
  return {outcomes:outcomes.map(row=>row.value),overlap};
 }finally{clearInterval(timer);for(const owner of owners)owner.cancel();await Promise.allSettled(owners.map(owner=>owner.done));for(const {fd} of held)closeSync(fd);}
}
