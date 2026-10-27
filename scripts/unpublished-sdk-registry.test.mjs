// Real small filesystem/TLS boundary fixtures, not Distribution or SDK acceptance.
import assert from 'node:assert/strict';
import test from 'node:test';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {chmodSync,mkdtempSync,mkdirSync,readFileSync,rmSync} from 'node:fs';
import {createServer} from 'node:https';
import {networkInterfaces,tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {gzipSync,zstdCompressSync} from 'node:zlib';
import {tarEntry,storedZip} from './sdk-construction-archive-fixture.mjs';
import {stageConstructionArchiveStream,consumeConstructionOciStage} from './sdk-construction-archive.mjs';
import {retireConstructionStage} from './sdk-construction-stage.mjs';
import {createUnpublishedRegistry,importUnpublishedStage,publishUnpublishedIndex,closeUnpublishedRegistry} from './unpublished-sdk-registry.mjs';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const json=v=>Buffer.from(JSON.stringify(v));
const revision='1'.repeat(40),imageType='application/vnd.oci.image.manifest.v1+json';
const input=b=>Readable.from((function*(){for(let at=0;at<b.length;at+=257)yield b.subarray(at,at+257);})());
function fixture(arch='amd64',wrongDiff=false,codec='gzip',damage){
 const expanded=Buffer.alloc(1024),encode={tar:b=>Buffer.from(b),gzip:gzipSync,zstd:zstdCompressSync};assert(Object.hasOwn(encode,codec));
 let layer=encode[codec](expanded);
 if(damage==='truncated')layer=layer.subarray(0,Math.floor(layer.length/2));
 else if(damage==='corrupt'){layer=Buffer.from(layer);layer[0]^=0xff;}
 else assert.equal(damage,undefined);
 const config=json({architecture:arch,os:'linux',config:{Labels:{'org.opencontainers.image.revision':revision,'org.opencontainers.image.source':'https://github.com/UOR-Foundation/PrismPM','org.opencontainers.image.version':'0.4.0','org.opencontainers.image.created':'1970-01-01T00:00:00Z'}},rootfs:{type:'layers',diff_ids:[wrongDiff?'sha256:'+'0'.repeat(64):sha(expanded)]}});
 const manifest=json({schemaVersion:2,mediaType:imageType,config:{mediaType:'application/vnd.oci.image.config.v1+json',digest:sha(config),size:config.length},layers:[{mediaType:'application/vnd.oci.image.layer.v1.tar'+(codec==='tar'?'':'+'+codec),digest:sha(layer),size:layer.length}]});
 const child={mediaType:imageType,digest:sha(manifest),size:manifest.length,platform:{os:'linux',architecture:arch}};
 const blobs=[layer,config,manifest];
 const archive=Buffer.concat([tarEntry('blobs/',Buffer.alloc(0),'5'),tarEntry('blobs/sha256/',Buffer.alloc(0),'5'),...blobs.map(b=>tarEntry('blobs/sha256/'+sha(b).slice(7),b)),tarEntry('index.json',json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[child]})),tarEntry('oci-layout',json({imageLayoutVersion:'1.0.0'})),Buffer.alloc(1024)]);
 const members=new Map(['authority-result.json','candidate.json','cli.json','config.json','digest.txt','inventory.json','manifest.json','model-check.json','standards.lock','tamper.json'].map(n=>['evidence/'+n,n==='config.json'?config:n==='manifest.json'?manifest:json({unit_only:true})]));
 const descriptor={byte_length:archive.length,digest:sha(archive)};
 members.set('construction.json',json({archive:{path:'sdk.oci.tar',...descriptor},manifest:{digest:sha(manifest),byte_length:manifest.length},smoke_evidence:[...members].map(([path,b])=>({path,byte_length:b.length,digest:sha(b)}))}));
 const bytes=storedZip(new Map([...members,['sdk.oci.tar',archive]])).bytes;
 return {bytes,archive,manifest,config,child,blobs,plan:{artifact:{byte_length:bytes.length,digest:sha(bytes)},archive:descriptor,members}};
}
async function temporary(run){const root=mkdtempSync(join(tmpdir(),'unpublished-registry-unit-'));chmodSync(root,0o700);try{return await run(root);}finally{rmSync(root,{recursive:true});}}
async function staged(root,f,name){const parent=join(root,name);mkdirSync(parent,{mode:0o700});return stageConstructionArchiveStream(input(f.bytes),f.plan,parent);}
async function tls(root,mode='normal'){
 const host=Object.values(networkInterfaces()).flat().find(r=>r.family==='IPv4'&&!r.internal&&/^(?:10\.|172\.(?:1[6-9]|2\d|3[01])\.|192\.168\.)/.test(r.address))?.address;
 assert(host,'a genuine private Linux interface is required for the TLS boundary unit');
 const key=join(root,'tls.key'),cert=join(root,'tls.crt');
 execFileSync('/usr/bin/openssl',['req','-x509','-newkey','rsa:2048','-nodes','-days','1','-sha256','-subj','/CN=unit-only-private-registry','-addext','basicConstraints=critical,CA:TRUE','-addext','subjectAltName=IP:'+host,'-keyout',key,'-out',cert],{timeout:20000,maxBuffer:65536,stdio:['ignore','ignore','pipe']});
 const uploads=new Map(),blobs=new Map(),manifests=new Map(),calls=[];let sequence=0;
 const server=createServer({key:readFileSync(key),cert:readFileSync(cert)},(req,res)=>{
  const parts=[];let total=0;
  req.on('data',b=>{total+=b.length;if(total>1024**2)req.destroy();else parts.push(Buffer.from(b));});
  req.on('end',()=>{
   const bytes=Buffer.concat(parts),url=new URL(req.url,'https://'+req.headers.host);calls.push({method:req.method,path:url.pathname,bytes:bytes.length});
   if(req.method==='POST'&&url.pathname==='/v2/qualification/sdk/blobs/uploads/'){
    if(mode==='stalled-post')return;
    const path='/v2/qualification/sdk/blobs/uploads/'+(++sequence);uploads.set(path,true);
    res.writeHead(mode==='post-status'?500:202,{Location:mode==='foreign-location'?'https://example.invalid/stolen':path});res.end();
   }else if(req.method==='PUT'&&uploads.has(url.pathname)){
    const digest=url.searchParams.get('digest');assert.equal(sha(bytes),digest);blobs.set(digest,bytes);
    res.writeHead(201,{'Docker-Content-Digest':mode==='wrong-blob-digest'?'sha256:'+'0'.repeat(64):digest});res.end();
   }else if(req.method==='PUT'&&url.pathname.startsWith('/v2/qualification/sdk/manifests/')){
    const digest=url.pathname.split('/').pop();assert.equal(sha(bytes),digest);manifests.set(digest,bytes);res.writeHead(201,{'Docker-Content-Digest':digest});res.end();
   }else if(req.method==='GET'&&manifests.has(url.pathname.split('/').pop())){
    const digest=url.pathname.split('/').pop(),original=manifests.get(digest),body=mode==='changed-readback'?Buffer.from(original.toString().replace('schemaVersion','schemaVerson')):original;
    res.writeHead(200,{'Docker-Content-Digest':digest,'Content-Length':body.length});res.end(body);
   }else{res.writeHead(404);res.end();}
  });
 });
 server.on('tlsClientError',()=>{});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,host,resolve);});
 return {repository:host+':'+server.address().port+'/qualification/sdk',ca:readFileSync(cert),calls,blobs,manifests,close:()=>new Promise(resolve=>server.close(resolve))};
}
async function withRegistry(root,mode,run){const server=await tls(root,mode),client=createUnpublishedRegistry(server.repository,server.ca,{timeout_ms:30000});try{return await run(client,server);}finally{assert.deepEqual(await closeUnpublishedRegistry(client),{scope:'owned registry TLS client retirement only',sockets_absent:true,requests_absent:true});await server.close();}}

test('sealed stage consumer exposes only copied64KiB original blob bytes and exact ordered completions',async()=>temporary(async root=>{
 const f=fixture(),s=await staged(root,f,'stage'),events=[],parts=new Map();let active=0;
 try{
  const result=await consumeConstructionOciStage(s.handle,f.manifest,f.config,{async start(e){assert.equal(++active,1);assert(Object.isFrozen(e));events.push(['start',e.path]);parts.set(e.path,[]);},async write(path,b){assert(Buffer.isBuffer(b)&&b.length<=65536);parts.get(path).push(Buffer.from(b));b.fill(7);await new Promise(resolve=>setImmediate(resolve));},async end(e){assert.equal(active--,1);assert.equal(sha(Buffer.concat(parts.get(e.path))),e.digest);events.push(['end',e.path]);}});
  assert.equal(result.readback.digest,f.plan.archive.digest);assert.equal(result.layout.blob_count,3);assert.equal(events.length,6);assert.equal(active,0);
 }finally{retireConstructionStage(s.handle);}
}));
test('forged handles and accessor consumer methods cannot acquire staged byte authority',async()=>temporary(async root=>{
 const f=fixture(),consumer={start(){},write(){},end(){}};
 for(const handle of[{},Object.freeze({}),{digest:f.plan.archive.digest}])await assert.rejects(consumeConstructionOciStage(handle,f.manifest,f.config,consumer));
 const s=await staged(root,f,'stage');try{await assert.rejects(consumeConstructionOciStage(s.handle,f.manifest,f.config,{get start(){throw Error('must not invoke getter');},write(){},end(){}}),/data.only/);}finally{retireConstructionStage(s.handle);}
}));
test('wrong graph bytes and consumer failure refuse without publishing a successful transfer',async()=>temporary(async root=>{
 const f=fixture(),s=await staged(root,f,'stage');try{
  const wrong=JSON.parse(f.manifest);wrong.layers[0].digest='sha256:'+'0'.repeat(64);
  await assert.rejects(consumeConstructionOciStage(s.handle,json(wrong),f.config,{start(){},write(){},end(){}}));
  await assert.rejects(consumeConstructionOciStage(s.handle,f.manifest,f.config,{start(){throw Error('actual consumer refusal');},write(){},end(){}}),/actual consumer refusal/);
 }finally{retireConstructionStage(s.handle);}
}));
test('actual TLS imports both complete stage graphs, verifies DiffIDs and publishes exact immutable index last',async()=>temporary(async root=>{
 await withRegistry(root,'normal',async(client,server)=>{
  const fixtures=[fixture('amd64'),fixture('arm64')],handles=[];
  for(const [i,f]of fixtures.entries()){const s=await staged(root,f,'stage-'+i);try{handles.push(await importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}finally{retireConstructionStage(s.handle);}}
  assert.equal(server.manifests.size,0,'no child/index publication before both complete original imports');
  const index=json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:fixtures.map(f=>f.child)});
  const result=await publishUnpublishedIndex(client,...handles,index);
  assert.equal(result.image,server.repository+'@'+sha(index));assert.equal(result.imports.length,2);
  for(const row of result.imports){assert.equal(row.expanded_tar_bytes,1024);assert.equal(row.original_layers[0].diff_id,sha(Buffer.alloc(1024)));}
  assert.deepEqual([...server.manifests.keys()],[...fixtures.map(f=>sha(f.manifest)),sha(index)]);
  for(const f of fixtures)for(const blob of f.blobs)assert(server.blobs.get(sha(blob)).equals(blob));
  assert(!result.scope.includes('SDK acceptance'));
 });
}));
test('one missing, forged or same-platform import can never publish either native child or index',async()=>temporary(async root=>{
 await withRegistry(root,'normal',async(client,server)=>{
  const f=fixture(),s=await staged(root,f,'stage');let handle;
  try{handle=await importUnpublishedStage(client,s.handle,f.manifest,f.config,revision);}finally{retireConstructionStage(s.handle);}
  const index=json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:[f.child,f.child]});
  for(const other of[{},Object.freeze({}),handle])await assert.rejects(publishUnpublishedIndex(client,handle,other,index));
  assert.equal(server.manifests.size,0);
 });
}));
test('coherently sealed compressed layer with wrong actual expanded DiffID fails before manifest publication',async()=>temporary(async root=>{
 await withRegistry(root,'normal',async(client,server)=>{
  const f=fixture('amd64',true),s=await staged(root,f,'stage');
  try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision),/DiffID/);}finally{retireConstructionStage(s.handle);}
  assert.equal(server.manifests.size,0);
 });
}));
test('foreign upload redirects, wrong status and wrong server blob digest fail closed on real TLS boundaries',async()=>temporary(async root=>{
 for(const mode of['foreign-location','post-status','wrong-blob-digest']){
  const dir=join(root,mode);mkdirSync(dir,{mode:0o700});
  await withRegistry(dir,mode,async(client,server)=>{const f=fixture(),s=await staged(dir,f,'stage');try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}finally{retireConstructionStage(s.handle);}assert.equal(server.manifests.size,0);});
 }
}));
test('different composed index bytes or descriptor order cannot substitute imported originals',async()=>temporary(async root=>{
 await withRegistry(root,'normal',async(client,server)=>{
  const fs=[fixture('amd64'),fixture('arm64')],handles=[];
  for(const [i,f]of fs.entries()){const s=await staged(root,f,'stage-'+i);try{handles.push(await importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}finally{retireConstructionStage(s.handle);}}
  for(const manifests of[[fs[1].child,fs[0].child],[{...fs[0].child,size:fs[0].child.size+1},fs[1].child]])
   await assert.rejects(publishUnpublishedIndex(client,...handles,json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests})));
  assert.equal(server.manifests.size,0);
 });
}));
test('actual registry readback substitution cannot become a completed publication receipt',async()=>temporary(async root=>{
 await withRegistry(root,'changed-readback',async(client,server)=>{
  const fs=[fixture('amd64'),fixture('arm64')],handles=[];
  for(const [i,f]of fs.entries()){const s=await staged(root,f,'stage-'+i);try{handles.push(await importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}finally{retireConstructionStage(s.handle);}}
  await assert.rejects(publishUnpublishedIndex(client,...handles,json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:fs.map(f=>f.child)})),/changed original/);
  assert.equal(server.manifests.size,3,'failure retains actual side effects until owned registry retirement');
 });
}));
test('registry authority, trust, deadlines and retired handles are closed and cannot be caller-forged',async()=>temporary(async root=>{
 const server=await tls(root);
 try{
  for(const repository of['localhost:5000/x','127.0.0.1:5000/x','example.com:443/x','10.0.0.1:65536/x','10.0.0.1:5000/x/../other'])assert.throws(()=>createUnpublishedRegistry(repository,server.ca,{timeout_ms:10000}));
  for(const timeout_ms of[0,-1,Infinity,1800001])assert.throws(()=>createUnpublishedRegistry(server.repository,server.ca,{timeout_ms}));
  assert.throws(()=>createUnpublishedRegistry(server.repository,Buffer.from('not a CA'),{timeout_ms:10000}));
  const client=createUnpublishedRegistry(server.repository,server.ca,{timeout_ms:10000});
  assert.deepEqual(await closeUnpublishedRegistry(client),{scope:'owned registry TLS client retirement only',sockets_absent:true,requests_absent:true});
  await assert.rejects(closeUnpublishedRegistry(client));await assert.rejects(publishUnpublishedIndex(client,{},{},Buffer.of(0)));
 }finally{await server.close();}
}));
test('wrong genuine CA refuses before any HTTP operation and all actual TLS client resources retire',async()=>temporary(async root=>{
 const a=join(root,'a'),b=join(root,'b');mkdirSync(a,{mode:0o700});mkdirSync(b,{mode:0o700});
 const server=await tls(a),other=await tls(b),client=createUnpublishedRegistry(server.repository,other.ca,{timeout_ms:1000});
 try{
  const f=fixture(),s=await staged(root,f,'stage');try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision),/certificate|self.signed/i);}finally{retireConstructionStage(s.handle);}
  assert.equal(server.calls.length,0);
 }finally{assert((await closeUnpublishedRegistry(client)).sockets_absent);await server.close();await other.close();}
}));
test('real stalled TLS response obeys caller-lowered bound and never leaves an admitted image or open client',async()=>temporary(async root=>{
 const server=await tls(root,'stalled-post'),client=createUnpublishedRegistry(server.repository,server.ca,{timeout_ms:100});
 try{
  const f=fixture(),s=await staged(root,f,'stage'),before=performance.now();
  try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision),/deadline/);}finally{retireConstructionStage(s.handle);}
  assert(performance.now()-before<5000);assert.equal(server.manifests.size,0);assert.equal(server.calls.filter(r=>r.method==='POST').length,1);
 }finally{assert((await closeUnpublishedRegistry(client)).requests_absent);await server.close();}
}));
for(const codec of['tar','zstd'])test('actual TLS '+codec+' imports retain original bytes and verify actual expanded DiffIDs before complete two-native publication',async()=>temporary(async root=>{
 await withRegistry(root,'normal',async(client,server)=>{
  const fixtures=[fixture('amd64',false,codec),fixture('arm64',false,codec)],handles=[];
  for(const [i,f]of fixtures.entries()){
   const s=await staged(root,f,'stage-'+i);
   try{handles.push(await importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}
   finally{assert.deepEqual(retireConstructionStage(s.handle),{original_file_absent:true,descriptors_closed:true,scope:'owned OCI staging retirement only'});}
  }
  assert.equal(server.manifests.size,0);
  const index=json({schemaVersion:2,mediaType:'application/vnd.oci.image.index.v1+json',manifests:fixtures.map(f=>f.child)});
  const result=await publishUnpublishedIndex(client,...handles,index);
  for(const row of result.imports){assert.equal(row.expanded_tar_bytes,1024);assert.equal(row.original_layers[0].diff_id,sha(Buffer.alloc(1024)));}
  for(const f of fixtures)for(const blob of f.blobs)assert(server.blobs.get(sha(blob)).equals(blob));
  assert.deepEqual([...server.manifests.keys()],[...fixtures.map(f=>sha(f.manifest)),sha(index)]);
 });
}));
test('actual raw-tar and zstd DiffID mismatch refuses despite otherwise authentic whole-stage bytes and retires all client resources',async()=>temporary(async root=>{
 for(const codec of['tar','zstd']){
  const dir=join(root,codec);mkdirSync(dir,{mode:0o700});
  await withRegistry(dir,'normal',async(client,server)=>{
   const f=fixture('amd64',true,codec),s=await staged(dir,f,'stage');
   try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision),/DiffID/);}
   finally{assert.deepEqual(retireConstructionStage(s.handle),{original_file_absent:true,descriptors_closed:true,scope:'owned OCI staging retirement only'});}
   assert.equal(server.manifests.size,0);assert(server.calls.some(row=>row.method==='POST'));
  });
 }
}));
for(const damage of['corrupt','truncated'])test('genuine '+damage+' gzip and zstd layers refuse decompression without publishing manifests and retire actual stages and TLS clients',async()=>temporary(async root=>{
 for(const codec of['gzip','zstd']){
  const dir=join(root,codec);mkdirSync(dir,{mode:0o700});
  await withRegistry(dir,'normal',async(client,server)=>{
   const f=fixture('amd64',false,codec,damage),s=await staged(dir,f,'stage');
   try{await assert.rejects(importUnpublishedStage(client,s.handle,f.manifest,f.config,revision));}
   finally{assert.deepEqual(retireConstructionStage(s.handle),{original_file_absent:true,descriptors_closed:true,scope:'owned OCI staging retirement only'});}
   assert.equal(server.manifests.size,0);assert(server.calls.some(row=>row.method==='POST'));
  });
 }
}));
