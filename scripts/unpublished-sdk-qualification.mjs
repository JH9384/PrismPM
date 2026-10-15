// Pre-publication execution of the original installed owners. Construction,
// image transport and execution receipts remain distinct; this is not release
// promotion or immutable downstream Hologram consumption.
import assert from 'node:assert/strict';
import {createHash,randomBytes,X509Certificate} from 'node:crypto';
import {chmodSync,lstatSync,mkdirSync,readFileSync,realpathSync,statfsSync,writeFileSync} from 'node:fs';
import {dirname,join,relative,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {constructionSelectionJson} from './sdk-construction-acquire.mjs';
import {constructionCredential} from './sdk-construction-observe.mjs';
import {constructionProvider} from './sdk-construction-provider.mjs';
import {readConstructionMetadata} from './sdk-construction-metadata.mjs';
import {validateConstructionAuthority,validateConstructionMetadata,composeConstructionIndex} from './sdk-construction-handoff.mjs';
import {stageConstructionArchiveStream} from './sdk-construction-archive.mjs';
import {retireConstructionStage} from './sdk-construction-stage.mjs';
import {createUnpublishedRegistry,importUnpublishedStage,publishUnpublishedIndex,closeUnpublishedRegistry} from './unpublished-sdk-registry.mjs';
import {executeOwnedSdkCommand} from './sdk-command-owner.mjs';
import {probeQualificationRegistry} from './sdk-registry-qualification.mjs';

const sha=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v,(_,item)=>item&&typeof item==='object'&&!Array.isArray(item)?Object.fromEntries(Object.keys(item).sort().map(k=>[k,item[k]])):item);
const source=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const ownerLabel='org.uor.prismpm.unpublished-qualification';
const subnet='172.29.88.0/24',gateway='172.29.88.1',port=5000;
const authority=gateway+':'+port,repository=authority+'/qualification/sdk';
const reserve=12*1024**3;
const scope='original installed-owner qualification only; not SDK release, promotion, or downstream consumer adoption';
export function qualificationCommandBudget(timeout,deadline,now=performance.now()){
 assert(Number.isSafeInteger(timeout)&&timeout>0&&Number.isFinite(deadline)&&Number.isFinite(now));
 // The unchanged SDK command supervisor may need five seconds AFTER its
 // command timeout to prove owned-descendant retirement. Charge that interval
 // to the same work/cleanup deadline, never extend the original whole owner.
 const available=Math.floor(deadline-now)-5000;
 assert(available>0,'original command and owned-retirement deadline exhausted');
 return Math.min(timeout,available);
}
export function conserveQualificationContainer(initial,current){
 for(const key of['Id','Name','Created','Path','Args','Image','Config'])assert.equal(canonical(current[key]),canonical(initial[key]),'original container configuration changed: '+key);
 const before=structuredClone(initial.HostConfig),after=structuredClone(current.HostConfig);
 if(before.OomKillDisable===false&&after.OomKillDisable===null)after.OomKillDisable=false;
 assert.equal(canonical(after),canonical(before),'original complete HostConfig changed');
 const mounts=rows=>rows.slice().sort((a,b)=>a.Destination.localeCompare(b.Destination));
 assert.equal(canonical(mounts(current.Mounts)),canonical(mounts(initial.Mounts)),'original complete mount graph changed');
 assert.equal(current.State.OOMKilled,false,'owned container was OOM-killed');
}

export function unpublishedQualificationPlan(text,qualifier,arch,phase){
 const selection=constructionSelectionJson(text,qualifier);
 assert.equal(selection.expected.revision,qualifier,'fresh same-source construction required for installed helper closure');
 assert(['amd64','arm64'].includes(arch));assert(['prerequisites','installed'].includes(phase));
 const commands=phase==='prerequisites'?
  [['bash','root-a/scripts/browser-api-sdk-check.sh'],['node','root-a/scripts/library-sdk-check.mjs','tests'],['bash','root-a/scripts/library-sdk-check.sh']]:
  [['bash','root-a/scripts/sdk-vv-outer.sh'],['node','root-a/scripts/product-sdk-check.mjs','tests'],['bash','root-a/scripts/product-sdk-check.sh']];
 return {selection,arch,phase,commands,original_job_minutes:360,scope};
}

export function qualificationStorageBudget(records,arch,phase){
 assert(['amd64','arm64'].includes(arch)&&['prerequisites','installed'].includes(phase));
 assert(Array.isArray(records)&&records.length===2);
 assert.deepEqual(records.map(r=>r.architecture),['amd64','arm64']);
 for(const r of records)assert(Number.isSafeInteger(r.expanded_tar_bytes)&&r.expanded_tar_bytes>0);
 const native=records.find(r=>r.architecture===arch);assert(native);
 // Original OCI tar expanded lengths are measured without extracting layers.
 // Product acquisition genuinely pulls both children and saves one actual
 // image at a time. The original installed-VV owner separately plans all of its
 // pinned runtime images and preserves its own4x-compressed+12GiB admission.
 const expanded=records.reduce((n,r)=>n+r.expanded_tar_bytes,0);
 const save=phase==='installed'?Math.max(...records.map(r=>r.expanded_tar_bytes)):0;
 const required=(phase==='installed'?expanded:native.expanded_tar_bytes)+save+reserve;
 assert(Number.isSafeInteger(required));return {scope:'local storage admission, not a product acceptance criterion',measured_expanded_tar_bytes:records.map(r=>({architecture:r.architecture,bytes:r.expanded_tar_bytes})),phase,required_free_bytes:required,original_reserve_bytes:reserve,original_installed_vv_admission_unchanged:true};
}

export async function qualifyUnpublishedSdk(plan,destination,secret){
 const started=performance.now(),remaining=Number(process.env.PRISMPM_QUALIFICATION_WHOLE_REMAINING);
 assert(Number.isSafeInteger(remaining)&&remaining>180&&remaining<=21600,'original whole-owner remaining budget required');
 const utcRemaining=Number(process.env.PRISMPM_QUALIFICATION_WHOLE_END_UTC_MS)-Date.now();
 assert(Number.isSafeInteger(utcRemaining)&&utcRemaining>180000,'actual host-owned remaining deadline required');
 // The earlier of the host's fixed end and admitted duration charges Docker
 // creation/startup too; neither a delayed start nor a clock jump adds time.
 const wholeEnd=started+Math.min(remaining*1000,utcRemaining),end=wholeEnd-180000;
 assert.equal(process.platform,'linux');assert.equal(process.arch,plan.arch==='amd64'?'x64':'arm64');
 assert.equal(process.env.GITHUB_ACTIONS,'true');assert.equal(process.env.RUNNER_ENVIRONMENT,'github-hosted');
 assert.equal(process.env.RUNNER_OS,'Linux');assert.equal(process.env.RUNNER_ARCH,plan.arch==='amd64'?'X64':'ARM64');
 assert.equal(process.env.GITHUB_REPOSITORY,'UOR-Foundation/PrismPM');assert.equal(process.env.GITHUB_SHA,plan.selection.qualifier);
 assert.match(process.env.GITHUB_RUN_ID,/^[1-9][0-9]*$/);assert.match(process.env.GITHUB_RUN_ATTEMPT,/^[1-9][0-9]*$/);
 assert.equal(realpathSync(source),source);assert.equal(source,join(dirname(source),'root-a'));
 const out=resolve(destination);assert.equal(realpathSync(dirname(out)),dirname(out));
 assert(relative(source,out).startsWith('../'),'fresh evidence outside checkout required');mkdirSync(out,{mode:0o700});
 const write=(name,value)=>{assert(/^[a-z0-9][a-z0-9._-]*$/.test(name));const bytes=Buffer.isBuffer(value)?value:Buffer.from(canonical(value)+'\n');writeFileSync(join(out,name),bytes,{flag:'wx',mode:0o444});return {path:name,byte_length:bytes.length,sha256:sha(bytes)};};
 const env={PATH:process.env.PATH,HOME:join(out,'home'),LANG:'C',LC_ALL:'C',GIT_CONFIG_NOSYSTEM:'1',GIT_CONFIG_GLOBAL:'/dev/null'};
 mkdirSync(env.HOME,{mode:0o700});mkdirSync(join(out,'private'),{mode:0o700});
 const nonce=randomBytes(12).toString('hex'),prefix='prism-unpublished-'+nonce;
 const abort=new AbortController(),resources=[],commands=[],secondary=[];let provider,providerRetirement,registry,registryRetirement,primary,sequence=0,cleaning=false,cleanupEnd,timer;
 const minimum=()=>{const fs=statfsSync(out);assert(fs.bavail*fs.bsize>=reserve,'original12GiB reserve exhausted');};
 const retireProvider=()=>providerRetirement??=provider.close();
 const retireRegistry=()=>registryRetirement??=closeUnpublishedRegistry(registry);
 const interrupt=reason=>{primary??=reason;abort.abort(reason);if(provider)retireProvider().catch(e=>secondary.push(String(e)));if(registry)retireRegistry().catch(e=>secondary.push(String(e)));};
 const handlers=['SIGINT','SIGTERM','SIGHUP'].map(signal=>[signal,()=>interrupt(Error('qualification interrupted by '+signal))]);
 for(const [signal,handler]of handlers)process.on(signal,handler);
 const run=async(label,program,args,timeout=120000,allowFailure=false)=>{
  assert(/^[a-z0-9-]+$/.test(label));const name=String(++sequence).padStart(4,'0')+'-'+label;
  if(!cleaning)minimum();
  const budget=qualificationCommandBudget(timeout,cleaning?cleanupEnd:end);
  let result,failure;
  try{result=await executeOwnedSdkCommand(program,args,{profile:'vv',environment:env,cwd:dirname(source),timeout:budget,limit:64*1024**2,aggregate:true,...(!cleaning?{signal:abort.signal}:{})});}
  catch(error){failure=error;result=error.result;}
  if(result){
   const stdout=write(name+'.stdout',result.stdout),stderr=write(name+'.stderr',result.stderr);
   const record={label,program,args,status:result.status,signal:result.signal,stdout,stderr,retirement:result.retirement,timed_out:result.timedOut,overflow:result.overflow,aborted:result.aborted};
   write(name+'.json',record);commands.push(record);
  }
  if(failure)throw failure;assert(result&&result.retirement.descendants_absent&&result.close_observed);
  if(!allowFailure){assert.equal(result.signal,null);assert.equal(result.status,0,label+' failed');}
  return result;
 };
 const docker=(label,args,timeout,allowFailure)=>run(label,'docker',['--host','unix:///var/run/docker.sock',...args],timeout,allowFailure);
 const git=async args=>(await run('source-git','git',['--no-replace-objects','-c','core.fsmonitor=false','-c','safe.directory='+source,'-C',source,...args],30000)).stdout;
 const absent=async(kind,name)=>{const r=await docker('prove-absence',[kind,'inspect',name],10000,true);assert.equal(r.signal,null);assert.equal(r.status,1);assert.match(r.stderr.toString(),/No such|not found/i);};
 const inspect=async(kind,id)=>{const r=JSON.parse((await docker('owned-inspect',[kind,'inspect',id],10000)).stdout);assert(Array.isArray(r)&&r.length===1);return r[0];};
 const own=async(kind,name,args)=>{
  await absent(kind,name);const entry={kind,name};resources.push(entry);
  if(kind==='container'){
   entry.cid=join(out,'private',name+'.cid');args=[...args.slice(0,2),'--cidfile',entry.cid,...args.slice(2)];
  }
  const response=await docker('create-owned-'+kind,args,120000);
  const id=response.stdout.toString().trim();assert(kind==='volume'?id===name:/^[a-f0-9]{64}$/.test(id));entry.id=id;
  if(entry.cid)assert.equal(readFileSync(entry.cid,'utf8').trim(),id);
  const actual=await inspect(kind,id),labels=kind==='container'?actual.Config.Labels:actual.Labels;
  assert.equal(labels?.[ownerLabel],nonce);assert.equal(kind==='container'?actual.Name.slice(1):actual.Name,name);
  entry.initial=actual;return entry;
 };
 const closed=[];
 try{
  timer=setTimeout(()=>interrupt(Error('original360min owning envelope exhausted')),Math.max(1,end-performance.now()));
  assert.equal((await git(['rev-parse','HEAD'])).toString().trim(),plan.selection.qualifier);
  assert.equal((await git(['status','--porcelain'])).length,0);
  const workflow=await git(['show',plan.selection.expected.revision+':.github/workflows/sdk-candidate.yml']);
  const standards=await git(['show',plan.selection.expected.revision+':standards.lock']);
  write('selection.json',plan);write('source-workflow.yml',workflow);write('source-standards.lock',standards);
  const scripts=(await git(['ls-files','-z','scripts','sdk','.github/workflows'])).toString().split('\0').filter(Boolean);
  const sourceInputs=scripts.map(path=>{const file=join(source,path),stat=lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());return {path,sha256:sha(readFileSync(file)),mode:stat.mode};});
  write('source-inputs-before.json',sourceInputs);
  const token=new TextDecoder('utf-8',{fatal:true}).decode(secret).trim();provider=constructionProvider(token);secret.fill(0);
  let providerSequence=0;const retain=bytes=>write('provider-'+String(++providerSequence).padStart(2,'0')+'.json',bytes);
  const before=await provider.authority(plan.selection.expected.run_id,retain);
  const authorityHandle=validateConstructionAuthority(Buffer.from(JSON.stringify(before)),plan.selection.expected,Date.now(),workflow);
  const lanes=[];
  for(const arch of['amd64','arm64']){
   const artifact=before.artifacts.find(a=>a.id===plan.selection.expected.artifact_ids[arch]);assert(artifact);
   const transport=provider.artifact(artifact.id,artifact.size_in_bytes),metadata=await readConstructionMetadata(artifact.size_in_bytes,transport.range);
   const members=metadata.members,record=members.get('construction.json'),files=new Map([...members].filter(([p])=>p!=='construction.json'));
   const admitted=validateConstructionMetadata(authorityHandle,arch,record,files,standards);
   for(const [name,bytes]of members)write('original-'+arch+'-'+name.replaceAll('/','-'),bytes);
   lanes.push({arch,artifact,transport,members,record:JSON.parse(record),admitted});
  }
  const index=composeConstructionIndex(lanes[0].admitted,lanes[1].admitted);write('original-index.json',index.bytes);
  const lock=JSON.parse(readFileSync(join(source,'sdk/vv-runtime.lock.json')));
  const toolImage=process.env.PRISMPM_QUALIFICATION_TOOLS_IMAGE;assert.match(toolImage,/^sha256:[a-f0-9]{64}$/);
  const toolInspect=await inspect('image',toolImage);assert.equal(toolInspect.Os,'linux');assert.equal(toolInspect.Architecture,plan.arch);
  const uid=process.getuid(),gid=process.getgid();assert(Number.isSafeInteger(uid)&&uid>0&&Number.isSafeInteger(gid)&&gid>=0);
  const target=join(source,'target'),targetIdentity=()=>{
   assert.equal(realpathSync(target),target);const s=lstatSync(target);assert(s.isDirectory()&&!s.isSymbolicLink());
   assert.equal(s.uid,uid);assert.equal(s.gid,gid);assert.equal(s.mode&0o777,0o700);
   return {dev:s.dev,ino:s.ino,mode:s.mode,uid:s.uid,gid:s.gid};
  },targetBefore=targetIdentity();write('owned-target-before.json',targetBefore);
  const network=await own('network',prefix+'-network',['network','create','--subnet',subnet,'--gateway',gateway,'--label',ownerLabel+'='+nonce,prefix+'-network']);
  assert.equal(network.initial.Driver,'bridge');assert.deepEqual(network.initial.IPAM.Config,[{Subnet:subnet,Gateway:gateway}]);
  const volume=await own('volume',prefix+'-registry-data',['volume','create','--label',ownerLabel+'='+nonce,prefix+'-registry-data']);
  // Only this invocation's newly created empty data volume is initialized by
  // root. Distribution itself runs as the actual CI owner: it can read the
  // owner's private TLS directory without exposing either private key.
  const initialize='const a=require("node:assert/strict"),f=require("node:fs"),p="/registry-data",uid=Number(process.argv[1]),gid=Number(process.argv[2]);a(Number.isSafeInteger(uid)&&uid>0&&Number.isSafeInteger(gid)&&gid>=0);a.equal(f.realpathSync(p),p);const before=f.lstatSync(p);a(before.isDirectory()&&!before.isSymbolicLink());a.equal(before.uid,0);a.equal(before.gid,0);a.deepEqual(f.readdirSync(p),[]);f.chmodSync(p,0o700);f.chownSync(p,uid,gid);const after=f.lstatSync(p);a.equal(after.uid,uid);a.equal(after.gid,gid);a.equal(after.mode&0o777,0o700);console.log(JSON.stringify({uid,gid,mode:after.mode&0o777,empty:true}));';
  const volumeInit=await own('container',prefix+'-registry-volume-init',['container','create','--name',prefix+'-registry-volume-init','--label',ownerLabel+'='+nonce,
   '--network','none','--read-only','--user','0:0','--cpus','1','--memory','128m','--memory-swap','128m','--pids-limit','64',
   '--cap-drop','ALL','--cap-add','CHOWN','--security-opt','no-new-privileges',
   '--mount','type=volume,source='+volume.name+',target=/registry-data','--entrypoint','node',toolImage,'--input-type=commonjs','-e',initialize,String(uid),String(gid)]);
  const initialized=await docker('initialize-owned-registry-volume',['start','--attach',volumeInit.id],30000);
  assert.deepEqual(JSON.parse(initialized.stdout),{uid,gid,mode:0o700,empty:true});
  const initTerminal=await inspect('container',volumeInit.id);conserveQualificationContainer(volumeInit.initial,initTerminal);
  assert.equal(initTerminal.State.Running,false);assert.equal(initTerminal.State.ExitCode,0);
  await docker('remove-owned-volume-initializer',['container','rm',volumeInit.id],10000);await absent('container',volumeInit.id);await absent('container',volumeInit.name);
  volumeInit.retired=true;closed.push({kind:'container',id:volumeInit.id,name:volumeInit.name,original_id_and_name_absent:true,force_removal:false});
  write('registry-volume-initialization.json',{scope:'new empty owned-volume permissions only; not registry acceptance',uid,gid,initial:volumeInit.initial,terminal:initTerminal});
  const tls=join(out,'private','tls');mkdirSync(tls,{mode:0o700});
  const ca=join(tls,'ca.crt'),key=join(tls,'ca.key'),leaf=join(tls,'server.crt'),leafKey=join(tls,'server.key'),csr=join(tls,'server.csr');
  await run('create-owned-ca','openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-sha256','-subj','/CN='+prefix+'-ca','-addext','basicConstraints=critical,CA:TRUE','-keyout',key,'-out',ca]);
  await run('create-owned-leaf','openssl',['req','-newkey','rsa:2048','-nodes','-sha256','-subj','/CN='+prefix,'-addext','subjectAltName=IP:'+gateway,'-keyout',leafKey,'-out',csr]);
  await run('sign-owned-leaf','openssl',['x509','-req','-in',csr,'-CA',ca,'-CAkey',key,'-set_serial','1','-days','1','-sha256','-copy_extensions','copy','-out',leaf]);
  const caBytes=readFileSync(ca);assert(new X509Certificate(leafBytes(leaf)).verify(new X509Certificate(caBytes).publicKey));
  chmodSync(ca,0o444);chmodSync(leaf,0o444);chmodSync(leafKey,0o400);chmodSync(key,0o400);
  const reg=await own('container',prefix+'-registry',['container','create','--name',prefix+'-registry','--label',ownerLabel+'='+nonce,
   '--network','host','--read-only','--user',uid+':'+gid,'--cpus','1','--memory','512m','--memory-swap','512m','--pids-limit','128','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--mount','type=volume,source='+volume.name+',target=/var/lib/registry','--mount','type=bind,source='+tls+',target=/tls,readonly',
   '--env','REGISTRY_HTTP_ADDR='+gateway+':'+port,'--env','REGISTRY_HTTP_TLS_CERTIFICATE=/tls/server.crt','--env','REGISTRY_HTTP_TLS_KEY=/tls/server.key',lock.images.distribution.reference]);
  await docker('start-owned-registry',['start',reg.id]);
  let registryReady=false;
  for(let attempt=0;attempt<20;attempt++){
   try{await probeQualificationRegistry(gateway,port,caBytes,abort.signal);registryReady=true;break;}
   catch(error){abort.signal.throwIfAborted();if(attempt===19)throw error;await new Promise(resolve=>setTimeout(resolve,250));}
  }
  assert(registryReady,'actual owned TLS registry not ready');
  registry=createUnpublishedRegistry(repository,caBytes,{timeout_ms:1800000});
  const imported=[];
  for(const lane of lanes){
   const parent=join(out,'private','stage-'+lane.arch);mkdirSync(parent,{mode:0o700});
   minimum();const stream=await lane.transport.stream();let staged,stageFailure;
   try{
    staged=await stageConstructionArchiveStream(stream,{artifact:{byte_length:lane.artifact.size_in_bytes,digest:lane.artifact.digest},archive:{byte_length:lane.record.archive.byte_length,digest:lane.record.archive.digest},members:lane.members},parent);
    write('original-'+lane.arch+'-whole-integrity.json',staged.integrity);
    imported.push(await importUnpublishedStage(registry,staged.handle,lane.members.get('evidence/manifest.json'),lane.members.get('evidence/config.json'),plan.selection.expected.revision));
   }catch(error){stageFailure=error;}
   if(staged){try{write('original-'+lane.arch+'-stage-retirement.json',retireConstructionStage(staged.handle));}catch(error){if(stageFailure)throw new AggregateError([stageFailure,error],'original import and owned stage retirement failed');throw error;}}
   if(stageFailure)throw stageFailure;
  }
  const graph=await publishUnpublishedIndex(registry,imported[0],imported[1],index.bytes);write('registry-original-graph.json',graph);
  write('registry-client-retirement.json',await retireRegistry());
  const after=await provider.authority(plan.selection.expected.run_id,retain);
  validateConstructionAuthority(Buffer.from(JSON.stringify(after)),plan.selection.expected,Date.now(),workflow);
  for(const lane of lanes){const a=after.artifacts.find(row=>row.id===lane.artifact.id);assert(a);for(const field of['id','name','digest','size_in_bytes','created_at','expires_at'])assert.equal(a[field],lane.artifact[field]);}
  write('provider-retirement.json',await retireProvider());
  const storage=qualificationStorageBudget(graph.imports,plan.arch,plan.phase),fs=statfsSync(out);
  write('measured-storage-admission.json',{...storage,actual_available_bytes:fs.bavail*fs.bsize});
  assert(fs.bavail*fs.bsize>=storage.required_free_bytes,'measured original installed-owner storage budget unavailable');
  const data=await own('volume',prefix+'-daemon-data',['volume','create','--label',ownerLabel+'='+nonce,prefix+'-daemon-data']);
  const socket=await own('volume',prefix+'-daemon-socket',['volume','create','--label',ownerLabel+'='+nonce,prefix+'-daemon-socket']);
  const daemon=await own('container',prefix+'-daemon',['container','create','--name',prefix+'-daemon','--label',ownerLabel+'='+nonce,'--privileged','--network',network.name,
   '--env','DOCKER_TLS_CERTDIR=','--mount','type=volume,source='+data.name+',target=/var/lib/docker','--mount','type=volume,source='+socket.name+',target=/var/run',
   '--mount','type=bind,source='+dirname(source)+',target='+dirname(source),'--mount','type=bind,source='+source+',target='+source+',readonly',
   '--mount','type=bind,source='+target+',target='+target,
   '--mount','type=bind,source='+ca+',target=/run/prismpm-qualification-ca.crt,readonly',
   '--mount','type=bind,source='+ca+',target=/etc/docker/certs.d/'+authority+'/ca.crt,readonly',lock.images.dind.reference,'dockerd','--host=unix:///var/run/docker.sock','--data-root=/var/lib/docker']);
  await docker('start-owned-daemon',['start',daemon.id]);
  let ready=false;
  for(let n=0;n<30;n++){
   const r=await docker('probe-owned-daemon',['exec',daemon.id,'docker','--host','unix:///var/run/docker.sock','version','--format','{{.Server.Version}}'],10000,true);
   if(r.status===0){assert.equal(r.stdout.toString().trim(),'28.4.0');ready=true;break;}
   await new Promise(resolve=>setTimeout(resolve,250));
  }
  assert(ready,'actual pinned daemon not ready');
  const trustCa='/run/prismpm-qualification-ca.crt';
  const script=plan.phase==='prerequisites'?
   'bash root-a/scripts/browser-api-sdk-check.sh "$1" "$2" "$3"; node root-a/scripts/library-sdk-check.mjs tests; bash root-a/scripts/library-sdk-check.sh "$1" "$2" "$3"':
   'bash root-a/scripts/sdk-vv-outer.sh "$1" "$2" "$4" "sdk-$4-full-sdk-vv" "$3"; node root-a/scripts/product-sdk-check.mjs tests; bash root-a/scripts/product-sdk-check.sh "$1" "$2" "sdk-$4-product-cli" "$3"';
  const runner=await own('container',prefix+'-owner',['container','create','--name',prefix+'-owner','--label',ownerLabel+'='+nonce,'--init','--read-only','--network',network.name,
   '--user',uid+':'+gid,'--group-add','0','--cap-drop','ALL','--security-opt','no-new-privileges',
   '--cpus','2','--memory','1g','--memory-swap','1g','--pids-limit','256',
   '--tmpfs','/tmp:rw,exec,nosuid,nodev,size=1g,mode=1777',
   '--mount','type=bind,source='+dirname(source)+',target='+dirname(source),
   '--mount','type=bind,source='+source+',target='+source+',readonly',
   '--mount','type=bind,source='+target+',target='+target,
   '--mount','type=volume,source='+socket.name+',target=/var/run','--mount','type=bind,source='+ca+',target='+trustCa+',readonly',
   '--workdir',dirname(source),...['GITHUB_ACTIONS','GITHUB_SHA','GITHUB_REPOSITORY','GITHUB_RUN_ID','GITHUB_RUN_ATTEMPT','RUNNER_ENVIRONMENT','RUNNER_OS','RUNNER_ARCH'].flatMap(k=>['--env',k+'='+process.env[k]]),
   '--env','NODE_EXTRA_CA_CERTS='+trustCa,'--entrypoint','/bin/bash',toolImage,'--noprofile','--norc','-euo','pipefail','-c',script,'unpublished-sdk',graph.image,plan.selection.expected.revision,trustCa,plan.arch]);
  const execution=await docker('complete-original-installed-owners',['start','--attach',runner.id],21600000-180000);
  const terminal=await inspect('container',runner.id);assert.equal(terminal.State.Running,false);assert.equal(terminal.State.ExitCode,0);assert.equal(terminal.State.OOMKilled,false);
  conserveQualificationContainer(runner.initial,terminal);
  assert(readFileSync(ca).equals(caBytes),'original explicit registry CA changed');assert.equal(lstatSync(ca).mode&0o777,0o444);
  write('original-owner-terminal.json',{scope,plan,graph,container_id:runner.id,initial:runner.initial,terminal,whole_command_status:execution.status});
  for(const row of sourceInputs){const file=join(source,row.path),stat=lstatSync(file);assert(stat.isFile()&&!stat.isSymbolicLink());assert.equal(stat.mode,row.mode);assert.equal(sha(readFileSync(file)),row.sha256,'qualification source changed');}
  assert.equal((await git(['rev-parse','HEAD'])).toString().trim(),plan.selection.qualifier);assert.equal((await git(['status','--porcelain'])).length,0);
  write('source-inputs-after.json',sourceInputs);
  assert.deepEqual(targetIdentity(),targetBefore);write('owned-target-after.json',targetBefore);
 }catch(error){primary??=error;}
 finally{
  clearTimeout(timer);cleaning=true;cleanupEnd=Math.min(wholeEnd,performance.now()+180000);
  if(provider)try{await retireProvider();}catch(error){secondary.push(String(error));}
  if(registry)try{await retireRegistry();}catch(error){secondary.push(String(error));}
  for(const row of resources.reverse()){
   if(row.retired)continue;
   try{
    assert(performance.now()<cleanupEnd,'original owned-resource cleanup deadline exceeded');
    if(!row.id&&row.cid){const value=readFileSync(row.cid,'utf8').trim();assert(/^[a-f0-9]{64}$/.test(value));row.id=value;}
    assert(row.id,'created resource identity unavailable; no destructive name/label-only recovery');
    const current=await inspect(row.kind,row.id),labels=row.kind==='container'?current.Config.Labels:current.Labels;
    assert.equal(labels?.[ownerLabel],nonce);assert.equal(row.kind==='container'?current.Name.slice(1):current.Name,row.name);
    if(row.kind==='container'){
     assert.equal(current.Id,row.id);
     if(row.initial){
      assert.equal(current.Image,row.initial.Image,'owned container image identity changed; cleanup refused');
      // A configuration failure remains a qualification failure. It cannot
      // suppress retirement after exact owned ID/name/image is established.
      try{conserveQualificationContainer(row.initial,current);}catch(error){secondary.push(String(error));}
     }
    }
    if(row.kind==='container'&&current.State.Running){await docker('stop-owned-container',['stop','--time','20',row.id],25000);const stopped=await inspect(row.kind,row.id);assert.equal(stopped.State.Running,false);}
    await docker('remove-owned-resource',[row.kind,'rm',row.id],10000);await absent(row.kind,row.id);if(row.id!==row.name)await absent(row.kind,row.name);
    closed.push({kind:row.kind,id:row.id,name:row.name,original_id_and_name_absent:true,force_removal:false});
   }catch(error){secondary.push(String(error));}
  }
  for(const [signal,handler]of handlers)process.off(signal,handler);
 }
 const terminal={scope,source_revision:plan.selection.expected.revision,architecture:plan.arch,phase:plan.phase,primary_failure:primary?String(primary.message).slice(0,4096):null,secondary_failures:secondary,whole_seconds:(performance.now()-started)/1000,commands,owned_retirement:closed,
  unclaimed:['SDK-release','publication','signing','immutable-Hologram-consumer-adoption','product-readiness']};
 write(primary||secondary.length?'failed.json':'completed.json',terminal);
 if(primary||secondary.length)throw new AggregateError([...(primary?[primary]:[]),...secondary.map(s=>Error(s))],'unpublished qualification incomplete');
 return terminal;
}
function leafBytes(path){return readFileSync(path);}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
 assert.equal(process.argv.length,6);
 const plan=unpublishedQualificationPlan(process.argv[2],process.env.GITHUB_SHA,process.argv[3],process.argv[4]);
 const secret=await constructionCredential(process.stdin,5000);
 console.log(canonical(await qualifyUnpublishedSdk(plan,process.argv[5],secret)));
}
