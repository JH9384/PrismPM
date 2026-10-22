// Invocation-owned TLS transport of original admitted OCI bytes. This module
// cannot grant SDK, full-VV, release, consumer or product acceptance.
import assert from 'node:assert/strict';
import {createHash,X509Certificate} from 'node:crypto';
import {Agent,request} from 'node:https';
import {isIP} from 'node:net';
import {createGunzip,createZstdDecompress} from 'node:zlib';
import {consumeConstructionOciStage} from './sdk-construction-archive.mjs';
import {validateConfig} from './sdk-candidate.mjs';

const registries=new WeakMap(),imports=new WeakMap();
const imageType='application/vnd.oci.image.manifest.v1+json';
const indexType='application/vnd.oci.image.index.v1+json';
const sha=b=>'sha256:'+createHash('sha256').update(b).digest('hex');
const keys=(v,n)=>assert.deepEqual(Object.keys(v).sort(),n.slice().sort());
const digest=d=>assert.match(d,/^sha256:[a-f0-9]{64}$/);
const maximum=4*1024**2,deadline=1800000;
function selection(repository){
 assert(typeof repository==='string'&&repository.length<=512);
 const m=/^(\d+\.\d+\.\d+\.\d+):([1-9][0-9]{0,4})\/([a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*(?:\/[a-z0-9]+(?:(?:[._]|__|-+)[a-z0-9]+)*)*)$/.exec(repository);
 assert(m&&isIP(m[1])===4&&Number(m[2])<=65535,'exact owned private IPv4 TLS registry required');
 const [a,b]=m[1].split('.').map(Number);
 assert(a===10||(a===172&&b>=16&&b<=31)||(a===192&&b===168),'owned non-loopback private registry required');
 return {authority:m[1]+':'+m[2],host:m[1],port:Number(m[2]),path:m[3]};
}
function live(handle){const row=registries.get(handle);assert(row&&!row.closed&&!row.failed,'live exclusive registry owner required');return row;}
function boundedJson(bytes){assert(Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=maximum);return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}
function remaining(row){assert(performance.now()<row.end,'original registry import deadline exceeded');return Math.max(1,Math.floor(row.end-performance.now()));}

export function createUnpublishedRegistry(repository,ca,options={}){
 keys(options,['timeout_ms']);assert(Number.isSafeInteger(options.timeout_ms)&&options.timeout_ms>0&&options.timeout_ms<=deadline);
 assert(Buffer.isBuffer(ca)&&ca.length>0&&ca.length<=65536,'bounded explicit CA bytes required');
 assert.match(ca.toString('ascii'),/^-----BEGIN CERTIFICATE-----\n(?:[A-Za-z0-9+/=]+\n)+-----END CERTIFICATE-----\n?$/);
 const cert=new X509Certificate(ca);assert(cert.ca&&cert.subject===cert.issuer&&cert.verify(cert.publicKey),'self-issued authentic owned CA required');
 const selected=selection(repository),agent=new Agent({ca:Buffer.from(ca),rejectUnauthorized:true,minVersion:'TLSv1.2',keepAlive:false,maxSockets:1,maxFreeSockets:0,maxCachedSessions:0,proxyEnv:{}});
 const handle=Object.freeze({});registries.set(handle,{...selected,repository,agent,timeout_ms:options.timeout_ms,end:performance.now()+options.timeout_ms,closed:false,failed:false,active:undefined,requests:new Set(),sockets:new Set(),records:[]});return handle;
}

// There is no redirect, credential, alternate endpoint, retry or caller network
// transport. One fixed request owns and closes its actual TLS socket.
function operation(row,method,path,size,contentType){
 assert(path.startsWith('/v2/'+row.path+'/')&&!/[\r\n#]/.test(path));
 assert(Number.isSafeInteger(size)&&size>=0&&size<=64*1024**3);
 remaining(row);assert.equal(row.requests.size,0,'one registry request at a time');
 let resolveResult,rejectResult,settled=false,responseDone=false,socketClosed=false,result,failure,timer;
 const complete=new Promise((resolve,reject)=>{resolveResult=resolve;rejectResult=reject;});
 const headers={'Content-Length':String(size),'Accept-Encoding':'identity',Accept:indexType+', '+imageType,...(contentType?{'Content-Type':contentType}:{})};
 const req=request({protocol:'https:',hostname:row.host,port:row.port,family:4,method,path,agent:row.agent,headers});
 row.requests.add(req);const parts=[];let received=0;
 const finish=()=>{
  if(settled||!socketClosed||(!responseDone&&!failure))return;
  settled=true;clearTimeout(timer);row.requests.delete(req);
  if(failure){row.failed=true;rejectResult(failure);}else resolveResult(result);
 };
 const fail=error=>{failure??=error;req.destroy(error);if(req.destroyed&&socketClosed)finish();};
 req.on('socket',socket=>{
  row.sockets.add(socket);socket.once('close',()=>{socketClosed=true;row.sockets.delete(socket);if(!responseDone&&!failure)failure=Error('registry socket closed before complete response');finish();});
  socket.once('secureConnect',()=>{if(!socket.authorized)fail(Error('registry TLS peer not authorized'));});
 });
 req.on('error',fail);
 req.on('close',()=>{if(!req.socket){socketClosed=true;finish();}});
 req.on('response',res=>{
  res.on('error',fail);res.once('aborted',()=>fail(Error('registry response aborted')));
  res.on('data',part=>{received+=part.length;if(received>maximum)fail(Error('registry response budget exceeded'));else parts.push(Buffer.from(part));});
  res.once('end',()=>{
   if(!res.complete)return fail(Error('registry response incomplete'));
   if(res.headers['content-encoding']!==undefined&&res.headers['content-encoding']!=='identity')return fail(Error('registry content coding refused'));
   const single=name=>{assert(res.rawHeaders.filter((v,i)=>i%2===0&&v.toLowerCase()===name).length<=1,'duplicate registry response field');return res.headers[name];};
   try{
    const length=single('content-length');if(length!==undefined)assert(/^\d+$/.test(length)&&Number(length)===received);
    result={status:res.statusCode,location:single('location'),digest:single('docker-content-digest'),bytes:Buffer.concat(parts)};
    responseDone=true;req.socket?.destroy();finish();
   }catch(error){fail(error);}
  });
  res.once('close',()=>{if(!res.complete)fail(Error('registry response close unproven'));});
 });
 timer=setTimeout(()=>fail(Error('registry request exceeded original import deadline')),remaining(row));
 // Attach a rejection observer immediately; the caller may still be consuming
 // bounded stage bytes when the remote endpoint fails.
 complete.catch(()=>{});
 return {req,complete,fail};
}
async function small(row,method,path,bytes=Buffer.alloc(0),type){
 assert(Buffer.isBuffer(bytes)&&bytes.length<=maximum);
 const owner=operation(row,method,path,bytes.length,type);owner.req.end(bytes);return owner.complete;
}
function uploadPath(row,value){
 assert(typeof value==='string'&&value.length<=4096,'bounded upload location required');
 const url=new URL(value,'https://'+row.authority);
 assert.equal(url.origin,'https://'+row.authority);assert(!url.username&&!url.password&&!url.hash);
 assert(url.pathname.startsWith('/v2/'+row.path+'/blobs/uploads/'));
 assert(!url.searchParams.has('digest'),'server cannot select uploaded digest');return url.pathname+url.search;
}

export async function importUnpublishedStage(handle,stage,manifestBytes,configBytes,revision){
 const row=live(handle);assert.equal(row.active,undefined,'exclusive original archive import required');
 row.end=performance.now()+row.timeout_ms;
 assert.match(revision,/^[a-f0-9]{40}$/);
 const manifest=boundedJson(manifestBytes),config=boundedJson(configBytes),arch=config.architecture;
 validateConfig(config,arch,revision);assert.equal(manifest.mediaType,imageType);
 const admitted={registry:handle,revision,arch,manifest:Buffer.from(manifestBytes),config:Buffer.from(configBytes),descriptor:{mediaType:imageType,digest:sha(manifestBytes),size:manifestBytes.length,platform:{os:'linux',architecture:arch}}};
 assert(config.rootfs&&config.rootfs.type==='layers'&&Array.isArray(config.rootfs.diff_ids)&&config.rootfs.diff_ids.length===manifest.layers.length);
 const layers=new Map();
 for(const [i,layer]of manifest.layers.entries()){
  digest(config.rootfs.diff_ids[i]);
  const previous=layers.get(layer.digest);if(previous)assert.equal(previous.diff_id,config.rootfs.diff_ids[i]);
  layers.set(layer.digest,{media_type:layer.mediaType,diff_id:config.rootfs.diff_ids[i]});
 }
 let upload,primary;const completed=[],expanded=new Map();row.active=admitted;
 try{
  const transfer=await consumeConstructionOciStage(stage,manifestBytes,configBytes,{
   async start(entry){
    assert.equal(upload,undefined);remaining(row);
    const response=await small(row,'POST','/v2/'+row.path+'/blobs/uploads/');assert.equal(response.status,202);
    const path=uploadPath(row,response.location),url=new URL('https://'+row.authority+path);url.searchParams.set('digest',entry.digest);
    const owner=operation(row,'PUT',url.pathname+url.search,entry.byte_length,'application/octet-stream');
    upload={entry,owner,written:0,hash:createHash('sha256')};
    const layer=layers.get(entry.digest);
    if(layer){
     const decoded={bytes:0,hash:createHash('sha256'),layer};upload.decoded=decoded;
     if(layer.media_type==='application/vnd.oci.image.layer.v1.tar+gzip')decoded.stream=createGunzip({chunkSize:65536});
     else if(layer.media_type==='application/vnd.oci.image.layer.v1.tar+zstd')decoded.stream=createZstdDecompress({chunkSize:65536});
     else assert.equal(layer.media_type,'application/vnd.oci.image.layer.v1.tar');
     decoded.observe=part=>{remaining(row);decoded.bytes+=part.length;assert(Number.isSafeInteger(decoded.bytes));decoded.hash.update(part);};
     if(decoded.stream){
      decoded.done=new Promise((resolve,reject)=>{decoded.stream.on('data',part=>{try{decoded.observe(part);}catch(error){decoded.stream.destroy(error);}});decoded.stream.once('error',reject);decoded.stream.once('end',resolve);});
      decoded.done.catch(()=>{});
     }
    }
   },
   async write(path,bytes){
    assert(upload&&upload.entry.path===path&&Buffer.isBuffer(bytes)&&bytes.length>0&&bytes.length<=65536);
    const current=upload;remaining(row);current.written+=bytes.length;assert(current.written<=current.entry.byte_length);
    current.hash.update(bytes);const copy=Buffer.from(bytes);
    if(current.decoded){
     if(current.decoded.stream)await new Promise((resolve,reject)=>current.decoded.stream.write(copy,error=>error?reject(error):resolve()));
     else current.decoded.observe(copy);
    }
    await new Promise((resolve,reject)=>{current.owner.req.write(copy,error=>error?reject(error):resolve());});
   },
   async end(entry){
    assert(upload&&upload.entry.path===entry.path&&upload.entry.digest===entry.digest);
    const current=upload;assert.equal(current.written,entry.byte_length);assert.equal('sha256:'+current.hash.digest('hex'),entry.digest);
    if(current.decoded){
     if(current.decoded.stream){current.decoded.stream.end();await current.decoded.done;}
     const diff='sha256:'+current.decoded.hash.digest('hex');assert.equal(diff,current.decoded.layer.diff_id,'actual expanded layer DiffID differs');
     expanded.set(entry.digest,{compressed_digest:entry.digest,expanded_bytes:current.decoded.bytes,diff_id:diff});
    }
    current.owner.req.end();const response=await current.owner.complete;assert.equal(response.status,201);assert.equal(response.digest,entry.digest);
    completed.push({...entry});upload=undefined;
   }
  },remaining(row));
  assert.equal(upload,undefined);assert.equal(completed.length,transfer.layout.blob_count);
  admitted.transfer=transfer;admitted.blobs=completed;const imported=Object.freeze({});imports.set(imported,admitted);
  const measured=manifest.layers.map(layer=>expanded.get(layer.digest));assert(measured.every(Boolean));
  const expanded_bytes=measured.reduce((n,layer)=>n+layer.expanded_bytes,0);assert(Number.isSafeInteger(expanded_bytes));
  row.records.push({architecture:arch,source_revision:revision,manifest_digest:admitted.descriptor.digest,archive_digest:transfer.readback.digest,blob_count:completed.length,expanded_tar_bytes:expanded_bytes,original_layers:measured});return imported;
 }catch(error){primary=error;row.failed=true;throw error;}
 finally{
  row.active=undefined;
  if(upload){upload.decoded?.stream?.destroy();upload.owner.fail(primary??Error('incomplete original blob upload'));try{await upload.owner.complete;}catch{};}
 }
}

export async function publishUnpublishedIndex(handle,amd64,arm64,indexBytes){
 const row=live(handle);assert.equal(row.active,undefined);
 row.end=performance.now()+Math.min(45000,row.timeout_ms);
 const a=imports.get(amd64),b=imports.get(arm64);
 assert(a&&b&&a.registry===handle&&b.registry===handle&&a.arch==='amd64'&&b.arch==='arm64','both actual complete native archive imports required');
 assert.equal(a.revision,b.revision);assert.notEqual(a.descriptor.digest,b.descriptor.digest);
 const index=boundedJson(indexBytes);keys(index,['schemaVersion','mediaType','manifests']);
 assert.deepEqual(index,{schemaVersion:2,mediaType:indexType,manifests:[a.descriptor,b.descriptor]});
 // Nothing is executable by name/digest until both whole original archive
 // imports/readbacks have succeeded; do not publish partial image graphs.
 for(const child of[a,b]){
  const response=await small(row,'PUT','/v2/'+row.path+'/manifests/'+child.descriptor.digest,child.manifest,imageType);
  assert.equal(response.status,201);assert.equal(response.digest,child.descriptor.digest);
 }
 const root=sha(indexBytes),response=await small(row,'PUT','/v2/'+row.path+'/manifests/'+root,indexBytes,indexType);
 assert.equal(response.status,201);assert.equal(response.digest,root);
 const returned=await small(row,'GET','/v2/'+row.path+'/manifests/'+root);
 assert.equal(returned.status,200);assert.equal(returned.digest,root);assert(returned.bytes.equals(indexBytes),'registry changed original composed index bytes');
 return {scope:'original source-bound unpublished registry graph only; installed qualification remains required',source_revision:a.revision,image:row.repository+'@'+root,index_sha256:root,imports:row.records.slice()};
}

export async function closeUnpublishedRegistry(handle){
 const row=registries.get(handle);assert(row&&!row.closed,'one registry retirement attempt required');row.closed=true;
 for(const req of row.requests)req.destroy(Error('original registry owner retiring'));row.agent.destroy();
 const end=performance.now()+5000;
 while(row.requests.size||row.sockets.size){assert(performance.now()<end,'actual registry sockets did not retire');await new Promise(resolve=>setTimeout(resolve,10));}
 return {scope:'owned registry TLS client retirement only',sockets_absent:true,requests_absent:true};
}
