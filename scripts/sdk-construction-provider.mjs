// Fixed GitHub acquisition; credentials and signed redirects stay in memory.
// Authentication here is HTTPS plus the caller's GitHub credential, not a
// claim about arbitrary bytes supplied to the metadata/integrity validators.
import assert from 'node:assert/strict';
import https from 'node:https';
import {Readable} from 'node:stream';
const prefix='/repos/UOR-Foundation/PrismPM';
const safeError=()=>Error('construction provider transport failed');

export function constructionStorageLocation(value){
 assert(typeof value==='string'&&value.length<16384,'bounded provider redirect required');
 let url;try{url=new URL(value);}catch{throw Error('invalid provider redirect');}
 assert(url.protocol==='https:'&&!url.username&&!url.password&&!url.hash,'HTTPS credential-free provider redirect required');
 assert(url.port===''||url.port==='443','ordinary HTTPS storage port required');
 assert(url.hostname.endsWith('.blob.core.windows.net')||url.hostname.endsWith('.githubusercontent.com'),'provider storage authority refused');
 return url;
}

export function constructionResponseHeaders(status,headers,{kind,start,length,total}){
 assert(['api','redirect','range','archive'].includes(kind));
 assert.equal(status,{api:200,redirect:302,range:206,archive:200}[kind],'provider response status refused');
 assert.equal(headers['content-encoding'],undefined,'original unencoded bytes required');
 if(kind==='range')assert.equal(headers['content-range'],`bytes ${start}-${start+length-1}/${total}`,'exact provider range required');
 if(kind==='range'||kind==='archive')assert.equal(headers['content-length'],String(kind==='range'?length:total),'exact provider length required');
 if(kind==='redirect')constructionStorageLocation(headers.location);
}

// Bounded response parsing waits for real close, not merely end or destroy.
export async function collectConstructionResponse(res,limit,signal){
 assert(res instanceof Readable);assert(Number.isSafeInteger(limit)&&limit>=0&&limit<=1024**2);
 return await new Promise((resolve,reject)=>{
  const chunks=[];let size=0,failure,cleanup;
  const finish=()=>{
   clearTimeout(cleanup);res.off('data',data);res.off('error',error);res.off('close',finish);signal?.removeEventListener('abort',abort);
   if(!failure&&(!res.complete||!res.readableEnded))failure=Error('incomplete original provider response');
   if(failure)reject(failure);else resolve(Buffer.concat(chunks,size));
  };
  const retire=e=>{failure??=e;res.destroy();cleanup??=setTimeout(()=>{
   failure=new AggregateError([failure,Error('provider response closure uncertain')],'provider response and cleanup failed');finish();
  },5000);};
  const data=b=>{size+=b.length;if(!Buffer.isBuffer(b)||size>limit)retire(Error('provider response byte budget exceeded'));else chunks.push(Buffer.from(b));};
  const error=()=>retire(safeError()),abort=()=>retire(Error('provider response cancelled'));
  res.on('data',data);res.on('error',error);res.once('close',finish);signal?.addEventListener('abort',abort,{once:true});
  if(signal?.aborted)abort();if(res.closed)queueMicrotask(finish);
 });
}

export function constructionProvider(token){
 // Treat credentials as opaque RFC6750 bearer values, including GitHub's
 // variable-length stateless installation tokens. Do not interpret their JWT.
 assert(typeof token==='string'&&token.length>=20&&token.length<1024&&/^[A-Za-z0-9._~+/-]+=*$/.test(token),'valid GitHub credential form required');
 const agent=new https.Agent({keepAlive:true,family:4,maxSockets:2}),requests=new Set(),controller=new AbortController();let apiCount=0;
 async function request(url,headers,profile,signal=controller.signal){
  assert(!controller.signal.aborted&&!signal.aborted,'provider already closed or cancelled');
  return await new Promise((resolve,reject)=>{
   let timer;const req=https.request(url,{agent,family:4,headers},res=>{
    // Acquisition can be cancelled between returning a stream and its caller
    // installing an iterator. Preserve stream.errored without an unhandled
    // error event during that ownership handoff.
    res.on('error',()=>{});
    try{constructionResponseHeaders(res.statusCode,res.headers,profile);}catch{res.destroy();req.destroy();reject(Error('original provider response identity refused'));return;}
    if(profile.kind==='archive'){
     clearTimeout(timer);req.setTimeout(45000,()=>req.destroy(safeError()));resolve(res);
    }else collectConstructionResponse(res,profile.kind==='range'?profile.length:1024**2,signal)
     .then(bytes=>resolve({bytes,headers:res.headers}),reject);
   });
   requests.add(req);const abort=()=>req.destroy(safeError());signal.addEventListener('abort',abort,{once:true});
   controller.signal.addEventListener('abort',abort,{once:true});
   timer=setTimeout(()=>req.destroy(safeError()),45000);
   req.on('error',()=>reject(safeError()));req.once('close',()=>{
    clearTimeout(timer);requests.delete(req);signal.removeEventListener('abort',abort);controller.signal.removeEventListener('abort',abort);
   });req.end();
  });
 }
 async function api(path,kind='api'){
  assert(++apiCount<=32,'provider API request budget exceeded');assert(path.startsWith(prefix+'/actions/'));
  return await request(new URL('https://api.github.com'+path),{Authorization:'Bearer '+token,Accept:'application/vnd.github+json',
   'X-GitHub-Api-Version':'2022-11-28','User-Agent':'PrismPM-construction-integrity'}, {kind});
 }
 return Object.freeze({
  async authority(runId,retain){
   assert(Number.isSafeInteger(runId)&&runId>0);assert.equal(typeof retain,'function');
   const rows=[];for(const suffix of['', '/jobs?per_page=100','/artifacts?per_page=100']){
    const r=await api(`${prefix}/actions/runs/${runId}${suffix}`);await retain(r.bytes);
    rows.push(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(r.bytes)));
   }
   assert.equal(rows[1].total_count,rows[1].jobs.length);assert.equal(rows[2].total_count,rows[2].artifacts.length);
   return {run:rows[0],jobs:rows[1].jobs,artifacts:rows[2].artifacts};
  },
  artifact(id,total){
   assert(Number.isSafeInteger(id)&&id>0&&Number.isSafeInteger(total)&&total>0&&total<=64*1024**3+96*1024**2);
   let rangeLocation;
   const location=async()=>constructionStorageLocation((await api(`${prefix}/actions/artifacts/${id}/zip`,'redirect')).headers.location);
   return Object.freeze({
    async range(start,length,signal){
     assert(Number.isSafeInteger(start)&&start>=0&&Number.isSafeInteger(length)&&length>0&&length<=1024**2&&start+length<=total);
     rangeLocation??=await location();
     const r=await request(rangeLocation,{Range:`bytes=${start}-${start+length-1}`},{kind:'range',start,length,total},signal);
     assert.equal(r.bytes.length,length);return r.bytes;
    },
    async stream(){return await request(await location(),{},{kind:'archive',total});}
   });
  },
  async close(){
   controller.abort();const sockets=new Set([...Object.values(agent.sockets),...Object.values(agent.freeSockets)].flat());
   agent.destroy();const deadline=performance.now()+5000;
   while(requests.size||[...sockets].some(s=>!s.closed)){
    assert(performance.now()<deadline,'provider request/socket cleanup uncertain');await new Promise(r=>setTimeout(r,10));
   }
   return {active_requests:0,observed_sockets:sockets.size,all_sockets_closed:true};
  }
 });
}
