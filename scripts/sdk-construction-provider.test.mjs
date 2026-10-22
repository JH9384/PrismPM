// Pure transport boundary tests; only real authenticated CI establishes
// provider acquisition evidence. These streams are not SDK/service fixtures.
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import test,{mock} from 'node:test';
import https from 'node:https';
import {EventEmitter} from 'node:events';
import {constructionStorageLocation,constructionResponseHeaders,collectConstructionResponse,constructionProvider} from './sdk-construction-provider.mjs';
test('signed storage redirects are HTTPS allowlisted credential-free bounded and non-fragmented',()=>{
 for(const host of['x.blob.core.windows.net','x.githubusercontent.com'])assert.equal(constructionStorageLocation('https://'+host+'/file?sig=unit-only').hostname,host);
 for(const url of['http://x.blob.core.windows.net/file','https://x.blob.core.windows.net.evil.invalid/file',
  'https://githubusercontent.com/file','https://user:pass@x.blob.core.windows.net/file',
  'https://x.blob.core.windows.net:8443/file','https://x.blob.core.windows.net/file#fragment','invalid','x'.repeat(16384)])
  assert.throws(()=>constructionStorageLocation(url));
});
test('every original response status encoding range and total length is exact',()=>{
 const profile={kind:'range',start:10,length:5,total:30},headers={'content-range':'bytes 10-14/30','content-length':'5'};
 assert.doesNotThrow(()=>constructionResponseHeaders(206,headers,profile));
 for(const [status,h]of[[200,headers],[206,{...headers,'content-length':'05'}],[206,{...headers,'content-range':'bytes 10-15/30'}],
  [206,{...headers,'content-encoding':'gzip'}],[206,{...headers,'content-range':'bytes 10-14/31'}]])assert.throws(()=>constructionResponseHeaders(status,h,profile));
 assert.doesNotThrow(()=>constructionResponseHeaders(200,{'content-length':'30'},{kind:'archive',total:30}));
 assert.throws(()=>constructionResponseHeaders(200,{}, {kind:'archive',total:30}));
 assert.doesNotThrow(()=>constructionResponseHeaders(302,{location:'https://x.blob.core.windows.net/file'}, {kind:'redirect'}));
 assert.throws(()=>constructionResponseHeaders(302,{location:'https://evil.invalid/'},{kind:'redirect'}));
 assert.throws(()=>constructionResponseHeaders(302,{}, {kind:'api'}));
});
test('bounded provider response returns original bytes only after complete end and actual close',async()=>{
 const stream=Readable.from([Buffer.from('a'),Buffer.from('bc')]);stream.complete=true;
 const result=await collectConstructionResponse(stream,3);assert.equal(result.toString(),'abc');assert(stream.closed&&stream.readableEnded);
 const empty=Readable.from([]);empty.complete=true;assert.equal((await collectConstructionResponse(empty,0)).length,0);
});
test('truncated oversized errored or prematurely closed responses cannot produce bytes',async()=>{
 for(const stream of[Readable.from([Buffer.from('abc')]),new Readable({read(){this.destroy(Error('unit-only interruption'));}})])
  await assert.rejects(collectConstructionResponse(stream,3));
 const over=Readable.from([Buffer.from('abcd')]);over.complete=true;await assert.rejects(collectConstructionResponse(over,3),/byte budget exceeded/);
 assert(over.closed);
});
test('cancelled response waits for actual delayed close',async()=>{
 let observed=false;const stream=new Readable({read(){},destroy(error,callback){setTimeout(()=>{observed=true;callback(error);},30);}});
 const controller=new AbortController(),p=collectConstructionResponse(stream,10,controller.signal);controller.abort();
 await assert.rejects(p,/cancelled/);assert(observed&&stream.closed);
});
test('uncertain transport cleanup retains original cancellation and fails closed',async()=>{
 const stream=new Readable({read(){},destroy(){}}),controller=new AbortController(),p=collectConstructionResponse(stream,1,controller.signal);
 controller.abort();await assert.rejects(p,e=>e instanceof AggregateError&&e.errors.some(e=>/cancelled/.test(e.message))&&e.errors.some(e=>/closure uncertain/.test(e.message)));
 assert(!stream.closed);
});
test('invalid credentials are rejected without network or inclusion in diagnostics',()=>{
 for(const credential of['','unit-only\nAuthorization: secret','x'.repeat(1024),'unit-only\0header-value','unit-only credential space']){
  assert.throws(()=>constructionProvider(credential),e=>e.message==='valid GitHub credential form required');
 }
});
test('opaque variable-length installation bearer tokens are transported without local JWT interpretation',async()=>{
 // Deliberately not a valid signed JWT or credential; only format compatibility.
 for(const token of ['ghs_123_'+['a'.repeat(190),'b'.repeat(190),'c'.repeat(190)].join('.'),'x'.repeat(1023)]){
  const provider=constructionProvider(token);assert.equal((await provider.close()).active_requests,0);
 }
});
test('an unused provider closes its owned resources and cannot be reused',async()=>{
 const provider=constructionProvider('unit_only_token_not_a_real_credential');assert.deepEqual(await provider.close(),{active_requests:0,observed_sockets:0,all_sockets_closed:true});
 await assert.rejects(provider.authority(1,()=>{}),/already closed/);
 assert.throws(()=>provider.artifact(1,0));
});

function unitRequests(sequence){
 const calls=[];
 mock.method(https,'request',(url,options,callback)=>{
  const row=sequence.shift();assert(row,'unexpected unit transport request');const req=new EventEmitter();
  let res,closed=false;const close=()=>{if(!closed){closed=true;req.emit('close');}};
  req.setTimeout=()=>{};
  req.destroy=e=>{if(e)req.emit('error',e);if(res)res.destroy(e);else queueMicrotask(close);return req;};
  req.end=()=>queueMicrotask(()=>{
   if(closed)return;
   if(row.noHeaders)return;
   res=row.stall?new Readable({read(){}}):Readable.from([Buffer.from(row.body??'')]);res.complete=row.complete??true;
   res.statusCode=row.status;res.headers=row.headers??{};res.on('close',close);callback(res);
  });
  calls.push({url:new URL(url),options,req,get response(){return res;}});return req;
 });
 return calls;
}
const token='unit_only_token_not_a_real_credential';
test('request transport never forwards bearer credentials to storage and binds the exact range',async()=>{
 const calls=unitRequests([
  {status:302,headers:{location:'https://x.blob.core.windows.net/file?sig=unit-only'}},
  {status:206,headers:{'content-range':'bytes 2-4/10','content-length':'3'},body:'abc'}]);
 const provider=constructionProvider(token);
 try{
  const controller=new AbortController(),bytes=await provider.artifact(123,10).range(2,3,controller.signal);
  assert.equal(bytes.toString(),'abc');assert.equal(calls.length,2);
  assert.equal(calls[0].url.origin,'https://api.github.com');assert.equal(calls[0].options.headers.Authorization,'Bearer '+token);
  assert.equal(calls[1].options.headers.Authorization,undefined);assert.deepEqual(calls[1].options.headers,{Range:'bytes=2-4'});
  assert(calls.every(c=>c.response.closed));assert.equal((await provider.close()).active_requests,0);
 }finally{await provider.close();mock.restoreAll();}
});
test('wrong response identity and an in-flight cancelled range retire actual response/request ownership',async()=>{
 for(const cancelled of[false,true]){
  const calls=unitRequests([{status:302,headers:{location:'https://x.blob.core.windows.net/file'}},
   {status:206,headers:{'content-range':cancelled?'bytes 0-2/10':'bytes 1-3/10','content-length':'3'},stall:true}]);
  const provider=constructionProvider(token),controller=new AbortController();
  try{
   const pending=provider.artifact(1,10).range(0,3,controller.signal);
   if(cancelled){while(!calls[1]?.response)await new Promise(r=>setImmediate(r));controller.abort();}
   await assert.rejects(pending);await provider.close();assert(calls.every(c=>c.response.closed));
  }finally{await provider.close();mock.restoreAll();}
 }
});
test('closing an acquired unconsumed archive cannot emit an unhandled response error',async()=>{
 const calls=unitRequests([{status:302,headers:{location:'https://x.blob.core.windows.net/file'}},
  {status:200,headers:{'content-length':'10'},stall:true}]);const provider=constructionProvider(token);
 try{const response=await provider.artifact(1,10).stream();assert(!response.closed);await provider.close();
  assert(response.closed&&response.errored);assert(calls.every(c=>c.response.closed));
 }finally{await provider.close();mock.restoreAll();}
});
test('authority awaits original raw-byte retention and propagates retention failure',async()=>{
 const body='{"id":1}';unitRequests([{status:200,body}]);const provider=constructionProvider(token);let retained=false;
 try{
  await assert.rejects(provider.authority(1,async b=>{assert.equal(b.toString(),body);await new Promise(r=>setImmediate(r));retained=true;throw Error('unit-only retention failure');}),/retention failure/);
  assert(retained);
 }finally{await provider.close();mock.restoreAll();}
});
test('complete authority selection retains all three original fixed-endpoint responses',async()=>{
 const bodies=['{"id":123}','{"total_count":1,"jobs":[{"id":1}]}','{"total_count":1,"artifacts":[{"id":2}]}'];
 const calls=unitRequests(bodies.map(body=>({status:200,body}))),provider=constructionProvider(token),retained=[];
 try{
  const result=await provider.authority(123,async b=>{await new Promise(r=>setImmediate(r));retained.push(b.toString());});
  assert.deepEqual(retained,bodies);assert.equal(result.run.id,123);assert.deepEqual(result.jobs,[{id:1}]);
  assert.deepEqual(calls.map(c=>c.url.pathname+c.url.search),['/repos/UOR-Foundation/PrismPM/actions/runs/123',
   '/repos/UOR-Foundation/PrismPM/actions/runs/123/jobs?per_page=100','/repos/UOR-Foundation/PrismPM/actions/runs/123/artifacts?per_page=100']);
 }finally{await provider.close();mock.restoreAll();}
});
test('the request header deadline retires a transport that never supplies a response',async()=>{
 const calls=unitRequests([{noHeaders:true}]),provider=constructionProvider(token);
 mock.timers.enable({apis:['setTimeout']});
 try{
  const pending=provider.authority(123,()=>{});mock.timers.tick(45000);
  await assert.rejects(pending,e=>e.message==='construction provider transport failed');
  assert.equal(calls.length,1);await provider.close();
 }finally{mock.timers.reset();await provider.close();mock.restoreAll();}
});
test('authority rejects incomplete inventories and fatal UTF8 from original responses',async()=>{
 for(const bodies of[['{"id":1}','{"total_count":2,"jobs":[]}','{"total_count":0,"artifacts":[]}'],[Buffer.from([255])]]){
  unitRequests(bodies.map(body=>({status:200,body})));const provider=constructionProvider(token);
  try{await assert.rejects(provider.authority(1,()=>{}));}finally{await provider.close();mock.restoreAll();}
 }
});
